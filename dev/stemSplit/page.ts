/// <reference types="@webgpu/types" />
import { HtdemucsWgsl, HTDEMUCS_SEGMENT, type HtdemucsWgslManifest } from '../../src/services/analysis/htdemucsWgsl/runtime';
import { createMixer, createStereoBuffer, RATE } from './mixer';
import type * as NodeChildProcess from 'child_process';
import type * as NodeFs from 'fs';
import type * as NodePath from 'path';
import type { IpcRenderer } from 'electron';

// dev/stemSplit/page.ts
// 原型的页面（见 main.cjs）：ffmpeg 解码整首歌，按应用里 htdemucs.cjs 的分段与三角窗重叠相加切成
// 172032 采样的段，交给 CPU（主进程 MNN，经 IPC）或 GPU（本页 WebGPU）跑，拼回四个音源（另存人声与伴奏），
// 写成 WAV，记下每一步的耗时；跑完把四轨交给调音台（mixer.ts）试听。

// Node 的 require 从 window 上取，打包器就不去解析这几个模块；类型只从 import type 来。
const nodeRequire = (globalThis as unknown as { require: (id: string) => unknown }).require;
const { ipcRenderer } = nodeRequire('electron') as { ipcRenderer: IpcRenderer };
const fs = nodeRequire('fs') as typeof NodeFs;
const path = nodeRequire('path') as typeof NodePath;
const { spawn } = nodeRequire('child_process') as typeof NodeChildProcess;

/** 主进程（main.cjs）各个 handle 的答复。 */
interface CpuLoad { cached: boolean; ms: number; threads: number; isa: string; fastCores: number }
interface CpuRun { data: Float32Array; ms: number; rssMb: number }
const ipc = {
    config: () => ipcRenderer.invoke('stem-config') as Promise<Config>,
    pick: () => ipcRenderer.invoke('stem-pick') as Promise<string | null>,
    cpuLoad: (threads: number) => ipcRenderer.invoke('cpu-load', threads) as Promise<CpuLoad>,
    cpuRun: (input: Float32Array) => ipcRenderer.invoke('cpu-run', input) as Promise<CpuRun>,
};

const L = HTDEMUCS_SEGMENT;
/** 模型自己的音源顺序。 */
const SOURCES = ['drums', 'bass', 'other', 'vocals'] as const;
const VOCALS = SOURCES.indexOf('vocals');

type Engine = 'cpu' | 'gpu' | 'gpu-f16';

interface Config {
    weights: string; ffmpeg: string; results: string; auto: string[]; file: string;
    threads: number; cores: number; cpuModel: string;
}

interface Pcm { file: string; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; decodeMs: number }

/** 一个引擎跑一段：输入 [2, L]（先左后右），输出取第 s 个音源第 ch 声道的读取函数。 */
interface Runner {
    label: string;
    load(): Promise<{ ms: number; info: string }>;
    run(input: Float32Array): Promise<{ get: (s: number, ch: number) => Float32Array; ms: number; note?: string }>;
}

interface RunResult {
    engine: string; file: string; dir: string; seconds: number;
    decodeMs: number; decodeCached: boolean; loadMs: number; loadInfo: string;
    segments: number; segmentMs: number[]; firstMs: number; medianMs: number; maxMs: number;
    inferMs: number; stitchMs: number; writeMs: number; totalMs: number; speed: number;
    residualDb: number; vocalsDb: number; instrumentalDb: number; mixDb: number; extra: string;
}

const log = (line: string) => {
    console.log(line);
    ipcRenderer.send('stem-log', line);
};
/** 按 id 取元素并核对类型：页面是固定的，对不上就是写错了。 */
const $ = <T extends HTMLElement>(id: string, type: abstract new () => T): T => {
    const element = document.getElementById(id);
    if (!(element instanceof type)) throw new Error(`#${id} is not a ${type.name}`);
    return element;
};
const fmtMs = (ms: number) => (ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);
const fmtDb = (db: number) => (Number.isFinite(db) ? `${db.toFixed(1)} dB` : '−∞');
const median = (values: number[]) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** ffmpeg 解码成 44.1kHz 双声道 f32，拆成左右两路。 */
const decode = (ffmpeg: string, file: string): Promise<Pcm> => new Promise((resolve, reject) => {
    const started = performance.now();
    // 应用自带的 ffmpeg 只编了 wav/flac 封装与整数 PCM，所以要 32 位整数的 WAV，再自己换成浮点。
    const child = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-f', 'wav', '-c:a', 'pcm_s32le', '-ac', '2', '-ar', String(RATE), 'pipe:1']);
    const chunks: Buffer[] = [];
    let errText = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { errText += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code: number) => {
        if (code !== 0) return reject(new Error(`ffmpeg 退出码 ${code}：${errText.trim()}`));
        const all = Buffer.concat(chunks);
        // 写到管道时 data 块的长度填不回去，所以找到 'data' 就读到文件尾。
        let at = 12;
        while (at + 8 <= all.byteLength && all.toString('latin1', at, at + 4) !== 'data') at += 8 + all.readUInt32LE(at + 4);
        if (at + 8 > all.byteLength) return reject(new Error('ffmpeg 输出里找不到 WAV data 块'));
        const body = all.subarray(at + 8);
        const frames = Math.floor(body.byteLength / 8);
        const interleaved = new Int32Array(body.buffer.slice(body.byteOffset, body.byteOffset + frames * 8));
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        const scale = 1 / 2147483648;
        for (let i = 0; i < frames; i += 1) {
            left[i] = interleaved[i * 2] * scale;
            right[i] = interleaved[i * 2 + 1] * scale;
        }
        resolve({ file, left, right, decodeMs: performance.now() - started });
    });
});

/** 16 位 PCM WAV，超出 ±1 的截掉。 */
const writeWav = (file: string, left: Float32Array, right: Float32Array) => {
    const frames = left.length;
    const buf = Buffer.alloc(44 + frames * 4);
    buf.write('RIFF', 0, 'latin1');
    buf.writeUInt32LE(36 + frames * 4, 4);
    buf.write('WAVEfmt ', 8, 'latin1');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(RATE, 24);
    buf.writeUInt32LE(RATE * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'latin1');
    buf.writeUInt32LE(frames * 4, 40);
    const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, frames * 2);
    for (let i = 0; i < frames; i += 1) {
        pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)));
        pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)));
    }
    fs.writeFileSync(file, buf);
};

const rmsDb = (channels: Float32Array[]) => {
    let sum = 0;
    let count = 0;
    for (const data of channels) {
        for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
        count += data.length;
    }
    return 10 * Math.log10(sum / Math.max(1, count));
};

const readPacked = (file: Uint8Array): { weights: Uint8Array; manifest: HtdemucsWgslManifest } => {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const tail = file.byteLength - 16;
    if (new TextDecoder().decode(file.subarray(tail, tail + 8)) !== 'FOLIABTW') throw new Error('不是打包的 htdemucs 导出');
    const at = Number(view.getBigUint64(tail + 8, true));
    return { weights: file.subarray(0, at), manifest: JSON.parse(new TextDecoder().decode(file.subarray(at, tail))) as HtdemucsWgslManifest };
};

const cpuRunner = (threads: number): Runner => ({
    label: `CPU ${threads} 线程`,
    async load() {
        const info = await ipc.cpuLoad(threads);
        return { ms: info.ms, info: `MNN ${info.isa}，${threads} 线程${info.fastCores ? `，优先 ${info.fastCores} 个性能核` : ''}${info.cached ? '（已加载）' : ''}` };
    },
    async run(input) {
        const started = performance.now();
        const { data: out, ms, rssMb } = await ipc.cpuRun(input);
        return {
            get: (s, ch) => out.subarray((s * 2 + ch) * L, (s * 2 + ch + 1) * L),
            ms: performance.now() - started,
            note: `模型 ${ms.toFixed(0)} ms，主进程 rss ${rssMb.toFixed(0)} MB`,
        };
    },
});

/** GPU 设备与模型按 f16 与否各留一份，重复跑不再上传权重。 */
const gpuModels = new Map<boolean, { model: HtdemucsWgsl; info: string }>();

const gpuRunner = (f16: boolean): Runner => {
    let model: HtdemucsWgsl | null = null;
    return {
        label: f16 ? 'GPU f16' : 'GPU f32',
        async load() {
            const cached = gpuModels.get(f16);
            if (cached) {
                model = cached.model;
                return { ms: 0, info: `${cached.info}（已加载）` };
            }
            const started = performance.now();
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter) throw new Error('没有 WebGPU 适配器');
            if (f16 && !adapter.features.has('shader-f16')) throw new Error('这块 GPU 不支持 shader-f16');
            const device = await adapter.requestDevice({
                requiredFeatures: f16 ? ['shader-f16'] : [],
                requiredLimits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
            });
            device.addEventListener('uncapturederror', (event) => log(`[stemSplit] GPU 错误：${event.error.message}`));
            void device.lost.then((lost) => {
                log(`[stemSplit] GPU 设备丢失：${lost.reason} ${lost.message}`);
                gpuModels.delete(f16);
            });
            const { weights, manifest } = readPacked(new Uint8Array(fs.readFileSync(config.weights)));
            model = await HtdemucsWgsl.create(device, weights, manifest, { f16, sources: [0, 1, 2, 3] });
            const info = `${adapter.info.vendor} ${adapter.info.architecture || adapter.info.description}，显存占用 ${(model.bytes / 1048576).toFixed(0)} MB`;
            gpuModels.set(f16, { model, info });
            return { ms: performance.now() - started, info };
        },
        async run(input) {
            if (!model) throw new Error('GPU 模型还没加载');
            const started = performance.now();
            const result = await model.run(input.subarray(0, L), input.subarray(L, 2 * L), { slice: 'none' });
            return {
                get: (s, ch) => (ch === 0 ? result.stems[s].left : result.stems[s].right),
                ms: performance.now() - started,
                note: `GPU 等待 ${result.gpuMs.toFixed(0)} ms`,
            };
        },
    };
};

/**
 * 整首分离：段长 L，步长 3/4 段，相邻两段在共有的 1/4 上用三角窗交叉淡化，再除以总权重
 * （electron/analysis/htdemucs.cjs 的 buildWindow，与参考实现一致）。四个音源各拼成一个双声道 AudioBuffer
 * （直接往它的声道里累加，调音台拿去就能播，不再拷一份）。人声是 vocals，伴奏是其余三个音源之和。
 */
const separate = async (runner: Runner, left: Float32Array, right: Float32Array, onSegment: (index: number, count: number, ms: number, note?: string) => void) => {
    const total = left.length;
    const overlap = Math.floor(L / 4);
    const win = new Float32Array(L).fill(1);
    for (let i = 0; i < overlap; i += 1) {
        const ramp = i / (overlap - 1);
        win[i] = ramp;
        win[L - 1 - i] = ramp;
    }
    const stride = L - overlap;
    const count = Math.max(1, Math.ceil(total / stride));
    const stems = SOURCES.map(() => createStereoBuffer(total));
    /** channels[s][ch]：第 s 个音源第 ch 声道。 */
    const channels = stems.map(buffer => [buffer.getChannelData(0), buffer.getChannelData(1)]);
    const weight = new Float32Array(total);
    const input = new Float32Array(2 * L);
    const segmentMs: number[] = [];
    let stitchMs = 0;
    for (let c = 0; c < count; c += 1) {
        const start = c * stride;
        const end = Math.min(start + L, total);
        if (end <= start) break;
        const n = end - start;
        input.fill(0);
        input.set(left.subarray(start, end), 0);
        input.set(right.subarray(start, end), L);
        const { get, ms, note } = await runner.run(input);
        segmentMs.push(ms);
        const stitchStarted = performance.now();
        for (let s = 0; s < SOURCES.length; s += 1) {
            for (let ch = 0; ch < 2; ch += 1) {
                const from = get(s, ch);
                const to = channels[s][ch];
                for (let i = 0; i < n; i += 1) to[start + i] += from[i] * win[i];
            }
        }
        for (let i = 0; i < n; i += 1) weight[start + i] += win[i];
        stitchMs += performance.now() - stitchStarted;
        onSegment(c, count, ms, note);
    }
    const normStarted = performance.now();
    for (let i = 0; i < total; i += 1) weight[i] = 1 / Math.max(weight[i], 1e-8);
    for (const stem of channels) {
        for (const data of stem) {
            for (let i = 0; i < total; i += 1) data[i] *= weight[i];
        }
    }
    // 伴奏 = drums + bass + other。
    const vocals = channels[VOCALS];
    const instrumental = [new Float32Array(total), new Float32Array(total)];
    channels.forEach((stem, s) => {
        if (s === VOCALS) return;
        for (let ch = 0; ch < 2; ch += 1) {
            const to = instrumental[ch];
            const from = stem[ch];
            for (let i = 0; i < total; i += 1) to[i] += from[i];
        }
    });
    stitchMs += performance.now() - normStarted;
    return { stems, channels, vocals, instrumental, segmentMs, stitchMs };
};

let config: Config;
let pcm: Pcm | null = null;
let busy = false;
const results: RunResult[] = [];

const safeName = (file: string) => path.basename(file, path.extname(file)).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

const runOne = async (engine: Engine, file: string, setStatus: (text: string, fraction?: number) => void): Promise<{ result: RunResult; stems: AudioBuffer[]; pcm: Pcm }> => {
    const overallStarted = performance.now();
    let decodeCached = true;
    if (!pcm || pcm.file !== file) {
        setStatus('解码中…', 0);
        pcm = await decode(config.ffmpeg, file);
        decodeCached = false;
        log(`[stemSplit] 解码 ${fmtMs(pcm.decodeMs)}，${(pcm.left.length / RATE).toFixed(1)} s`);
    }
    const { left, right } = pcm;
    const seconds = left.length / RATE;
    const threads = Number($('threads', HTMLInputElement).value) || config.threads;
    const runner = engine === 'cpu' ? cpuRunner(threads) : gpuRunner(engine === 'gpu-f16');

    setStatus(`${runner.label}：加载模型…`, 0);
    const loaded = await runner.load();
    log(`[stemSplit] ${runner.label} 加载 ${fmtMs(loaded.ms)}（${loaded.info}）`);

    const inferStarted = performance.now();
    const lines: string[] = [];
    const separated = await separate(runner, left, right, (index, count, ms, note) => {
        lines.push(`段 ${index + 1}/${count}：${ms.toFixed(0)} ms${note ? `（${note}）` : ''}`);
        const elapsed = performance.now() - inferStarted;
        const eta = (elapsed / (index + 1)) * (count - index - 1);
        setStatus(`${runner.label}：段 ${index + 1}/${count}，这段 ${fmtMs(ms)}，已用 ${fmtMs(elapsed)}，约剩 ${fmtMs(eta)}`, (index + 1) / count);
    });
    const separateMs = performance.now() - inferStarted;
    const inferMs = separated.segmentMs.reduce((a, b) => a + b, 0);

    setStatus(`${runner.label}：写 WAV…`, 1);
    const dir = path.join(config.results, `${safeName(file)}-${engine}${engine === 'cpu' ? threads : ''}`);
    fs.mkdirSync(dir, { recursive: true });
    const writeStarted = performance.now();
    writeWav(path.join(dir, 'vocals.wav'), separated.vocals[0], separated.vocals[1]);
    writeWav(path.join(dir, 'instrumental.wav'), separated.instrumental[0], separated.instrumental[1]);
    writeWav(path.join(dir, 'mix.wav'), left, right);
    SOURCES.forEach((source, s) => {
        if (s !== VOCALS) writeWav(path.join(dir, `${source}.wav`), separated.channels[s][0], separated.channels[s][1]);
    });
    const writeMs = performance.now() - writeStarted;

    // 重建误差：原曲减去人声加伴奏剩下的能量，相对原曲。htdemucs 的四个音源加起来本应还原原曲。
    const residual = [new Float32Array(left.length), new Float32Array(left.length)];
    [left, right].forEach((mix, ch) => {
        for (let i = 0; i < mix.length; i += 1) residual[ch][i] = mix[i] - separated.vocals[ch][i] - separated.instrumental[ch][i];
    });
    const mixDb = rmsDb([left, right]);

    const totalMs = performance.now() - overallStarted;
    const result: RunResult = {
        engine: runner.label,
        file,
        dir,
        seconds,
        decodeMs: pcm.decodeMs,
        decodeCached,
        loadMs: loaded.ms,
        loadInfo: loaded.info,
        segments: separated.segmentMs.length,
        segmentMs: separated.segmentMs,
        firstMs: separated.segmentMs[0] ?? 0,
        medianMs: median(separated.segmentMs),
        maxMs: Math.max(...separated.segmentMs),
        inferMs,
        stitchMs: separated.stitchMs,
        writeMs,
        totalMs,
        speed: seconds / (separateMs / 1000),
        residualDb: rmsDb(residual) - mixDb,
        vocalsDb: rmsDb(separated.vocals),
        instrumentalDb: rmsDb(separated.instrumental),
        mixDb,
        extra: lines.join('\n'),
    };
    fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ ...result, extra: undefined }, null, 1));
    return { result, stems: separated.stems, pcm };
};

const renderResults = () => {
    $('results', HTMLElement).innerHTML = results.map(r => `<tr>
        <td>${r.engine}</td><td>${(r.seconds / 60).toFixed(0)}:${String(Math.round(r.seconds % 60)).padStart(2, '0')}</td>
        <td>${r.decodeCached ? '缓存' : fmtMs(r.decodeMs)}</td><td>${fmtMs(r.loadMs)}</td><td>${r.segments}</td>
        <td>${fmtMs(r.firstMs)}</td><td>${fmtMs(r.medianMs)}</td><td>${fmtMs(r.maxMs)}</td><td>${fmtMs(r.inferMs)}</td>
        <td>${fmtMs(r.stitchMs)}</td><td>${fmtMs(r.writeMs)}</td><td>${fmtMs(r.totalMs)}</td><td>${r.speed.toFixed(1)}×</td><td>${fmtDb(r.residualDb)}</td>
    </tr>`).join('');
    const last = results.at(-1);
    if (last) {
        $('detail', HTMLElement).textContent = [
            `${last.engine}：${last.loadInfo}`,
            `输出：${last.dir}`,
            `电平（RMS）：原曲 ${fmtDb(last.mixDb)}，人声 ${fmtDb(last.vocalsDb)}，伴奏 ${fmtDb(last.instrumentalDb)}`,
            `倍速 = 歌长 ÷（推理 + 拼接）；首段含首次运行的预热。`,
            '',
            last.extra,
        ].join('\n');
    }
};

let currentDir = '';
let mixer: ReturnType<typeof createMixer> | null = null;

const setStatus = (text: string, fraction?: number) => {
    $('status', HTMLElement).textContent = text;
    if (fraction !== undefined) $('progress', HTMLProgressElement).value = fraction;
};

const runSelected = async (engines: Engine[], file: string) => {
    if (busy || !file) return;
    busy = true;
    $('run', HTMLButtonElement).disabled = true;
    try {
        for (const engine of engines) {
            const { result, stems, pcm: decoded } = await runOne(engine, file, setStatus);
            results.push(result);
            renderResults();
            log(`[stemSplit] ${result.engine}：${result.segments} 段，首段 ${fmtMs(result.firstMs)}，中位 ${fmtMs(result.medianMs)}，最慢 ${fmtMs(result.maxMs)}，推理 ${fmtMs(result.inferMs)}，拼接 ${fmtMs(result.stitchMs)}，写盘 ${fmtMs(result.writeMs)}，${result.speed.toFixed(1)}× 实时，重建误差 ${fmtDb(result.residualDb)}；人声 ${fmtDb(result.vocalsDb)} 伴奏 ${fmtDb(result.instrumentalDb)} 原曲 ${fmtDb(result.mixDb)} → ${result.dir}`);
            currentDir = result.dir;
            $('folder', HTMLButtonElement).disabled = false;
            // 无界面跑（STEM_AUTO）时没有调音台，四轨随这次结果一起放掉。
            mixer?.load({ label: `${result.engine} · ${path.basename(file)}`, mix: decoded, stems });
        }
        setStatus('完成', 1);
    } catch (error) {
        console.error('[stemSplit] 分离失败', error);
        log(`[stemSplit] 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        setStatus(`失败：${error instanceof Error ? error.message : String(error)}`);
        throw error;
    } finally {
        busy = false;
        $('run', HTMLButtonElement).disabled = false;
    }
};

const main = async () => {
    config = await ipc.config();
    let file = config.file;
    $('threads', HTMLInputElement).value = String(config.threads);
    $('file', HTMLElement).textContent = file || '未选择';
    log(`[stemSplit] ${config.cpuModel}，${config.cores} 逻辑核；ffmpeg ${config.ffmpeg}`);

    $('pick', HTMLElement).addEventListener('click', () => void ipc.pick().then((picked) => {
        if (picked) {
            file = picked;
            $('file', HTMLElement).textContent = file;
        }
    }));
    $('run', HTMLElement).addEventListener('click', () => {
        const engines = [...document.querySelectorAll<HTMLInputElement>('input[name=engine]:checked')].map(i => i.value as Engine);
        void runSelected(engines, file).catch(() => undefined);
    });
    if (!config.auto.length) mixer = createMixer();
    $('folder', HTMLElement).addEventListener('click', () => void ipcRenderer.invoke('stem-open', currentDir));

    if (config.auto.length) {
        try {
            await runSelected(config.auto as Engine[], file);
            await ipcRenderer.invoke('cpu-release');
            ipcRenderer.send('stem-done', 0);
        } catch {
            ipcRenderer.send('stem-done', 1);
        }
    }
};

void main();
