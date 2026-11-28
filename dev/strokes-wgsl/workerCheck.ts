/// <reference types="@webgpu/types" />
import { runStrokesGpu, type StrokesGpuGlyph } from '../../src/services/analysis/beatThisGpu';
import { SERIAL_PACING } from '../../src/services/analysis/gpuSlices';
import { StrokesJob } from '../../src/services/analysis/strokesWgsl/strokesJob';
import { glyphFeatures, renderCanon } from '../../src/services/fontStrokes/fontStrokesRaster';
import { fs, ipcRenderer } from './node';

// dev/strokes-wgsl/workerCheck.ts
// 真实 GPU worker 路径走一趟（main.cjs 的 SW_URL，页面由 web 开发服务器 npm run dev 供，new Worker(new URL(...)) 照 app 里那样解析）：
// window.electron.getStrokesGpuWeights 换成读 ~/bihua 的模型文件，同一批字经 runStrokesGpu（beatThisGpu.ts → beatThisGpu.worker.ts → strokesJob.ts）
// 和本页直接跑的 StrokesJob 各算一遍，比 owner（own2 的归属）、along、pens 是否逐字节一样。

const log = (line: string) => ipcRenderer.send('sw-log', line);
const CHARS = Array.from(env('SW_CHARS_SET') ?? '木龍鬱藏擊月永我');
const FAMILY = env('SW_FAMILY') ?? 'PingFang SC';

function env(name: string): string | undefined {
    return (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env[name] || undefined;
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);

async function main() {
    const config = await ipcRenderer.invoke('sw-config') as { full6: string; own2: string };
    const read = (p: string) => new Uint8Array(fs.readFileSync(p));
    (window as unknown as { electron: { getStrokesGpuWeights: () => Promise<{ full6: Uint8Array<ArrayBuffer>; own2: Uint8Array<ArrayBuffer> }> } }).electron = {
        getStrokesGpuWeights: () => Promise.resolve({ full6: read(config.full6), own2: read(config.own2) }),
    };
    const canons = CHARS.map(ch => {
        const canon = renderCanon(ch, FAMILY, 400);
        if (!canon) throw new Error(`${ch} drew no ink`);
        return canon;
    });
    const feats = () => canons.map(c => glyphFeatures(c.img));
    const viaWorker: StrokesGpuGlyph[] = [];
    for (let at = 0; at < feats().length; at += 8) {
        const res = await runStrokesGpu(feats().slice(at, at + 8));
        if (!res) throw new Error('runStrokesGpu gave null');
        viaWorker.push(...res);
    }
    // 直接跑：和 worker 一样按适配器有没有 shader-f16 选
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const f16 = adapter.features.has('shader-f16');
    const device = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [], requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
    const job = await StrokesJob.create(device, read(config.full6), read(config.own2), f16);
    const direct = await job.run(feats(), SERIAL_PACING);
    let bad = 0;
    CHARS.forEach((ch, i) => {
        const w = viaWorker[i], d = direct[i];
        const inkW = w.owner.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0), inkD = d.owner.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
        const ok = w.owner instanceof Int8Array && w.owner.length === 256 * 256 && inkW > 0
            && same(w.owner, d.owner) && same(w.along, d.along) && w.pens.length === d.pens.length && w.pens.every((p, k) => same(p, d.pens[k]));
        if (!ok) bad += 1;
        log(`[worker-check] ${ch}: worker owner ${w.owner.constructor.name} len ${w.owner.length}, ink px ${inkW} (direct ${inkD}), pens ${w.pens.length}/${d.pens.length}, owner same ${same(w.owner, d.owner)}, along same ${same(w.along, d.along)}, pens same ${w.pens.length === d.pens.length && w.pens.every((p, k) => same(p, d.pens[k]))}`);
    });
    log(`[worker-check] ${FAMILY}, f16 ${f16}: ${CHARS.length - bad} of ${CHARS.length} glyphs match the direct run`);
    job.destroy();
    ipcRenderer.send('sw-done', bad ? 1 : 0);
}

main().catch((error: unknown) => {
    log(`[worker-check] FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    ipcRenderer.send('sw-done', 1);
});
