// dev/stemSplit/mixer.ts
// 原型的调音台：htdemucs 分出的四条音轨（drums / bass / other / vocals）各接一个 GainNode，
// 强度 0.0–2.0×（默认 1.0×）实时可调；四条音轨用同一个起点同一个偏移启动，采样级对齐。
// 另有一路原曲与四轨同步播放，「原曲」按钮在两路之间切换，切换时位置不变，方便 A/B。
// 主输出接左右两个 AnalyserNode 看峰值，提高强度后削波时标红（不加压限，免得 1.0× 时也改了音色）。

export const RATE = 44100;
/** 模型自己的音源顺序，与 page.ts 的 SOURCES 一致。 */
export const STEMS = [
    { key: 'drums', label: '鼓' },
    { key: 'bass', label: '贝斯' },
    { key: 'other', label: '其他' },
    { key: 'vocals', label: '人声' },
] as const;

export const GAIN_MIN = 0;
export const GAIN_MAX = 2;
export const GAIN_DEFAULT = 1;

export interface MixerTracks {
    /** 显示用：哪个引擎、哪首歌。 */
    label: string;
    /** 原曲左右声道（解码结果），用来做 A/B。 */
    mix: { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> };
    /** 四个音源，顺序同 STEMS，每个都是双声道。 */
    stems: AudioBuffer[];
}

/** 新建一个双声道 44.1kHz 的 AudioBuffer；不需要 AudioContext，分离时直接往它的声道里累加。 */
export const createStereoBuffer = (length: number) => new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, length), sampleRate: RATE });

/** 按 id 取元素并核对类型：页面是固定的，对不上就是写错了。 */
const $ = <T extends HTMLElement>(id: string, type: abstract new () => T): T => {
    const element = document.getElementById(id);
    if (!(element instanceof type)) throw new Error(`#${id} is not a ${type.name}`);
    return element;
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtGain = (g: number) => `${g.toFixed(2)}×`;
const RAMP = 0.015;

interface Graph {
    ctx: AudioContext;
    stemGains: GainNode[];
    stemBus: GainNode;
    mixBus: GainNode;
    analysers: AnalyserNode[];
}

/**
 * 把调音台挂到 index.html 的 #mixer 上，返回 load（换一组音轨）。
 * 播放用 AudioBufferSourceNode：暂停与跳转都是停掉全部源、按新偏移重建。
 */
export const createMixer = () => {
    const gains: number[] = STEMS.map(() => GAIN_DEFAULT);
    let tracks: { label: string; mix: AudioBuffer; stems: AudioBuffer[] } | null = null;
    let mixSource: Float32Array | null = null;
    let graph: Graph | null = null;
    let sources: AudioBufferSourceNode[] = [];
    let generation = 0;
    let playing = false;
    let startedAt = 0;
    let pausedAt = 0;
    let original = false;
    let seeking = false;
    let peak = { value: 0, at: 0 };
    let frame = 0;

    const playButton = $('mixer-play', HTMLButtonElement);
    const originalButton = $('mixer-original', HTMLButtonElement);
    const seek = $('mixer-seek', HTMLInputElement);
    const timeLabel = $('mixer-time', HTMLElement);
    const peakLabel = $('mixer-peak', HTMLElement);
    const whichLabel = $('mixer-which', HTMLElement);
    const strips = $('mixer-strips', HTMLElement);

    const duration = () => tracks?.mix.duration ?? 0;
    const position = () => {
        if (!playing || !graph) return pausedAt;
        return Math.min(duration(), Math.max(0, graph.ctx.currentTime - startedAt));
    };

    // 每条音轨一行：名字、滑块、读数。双击滑块复位到 1.0×。
    const rows = STEMS.map((stem, index) => {
        const row = document.createElement('div');
        row.className = 'strip';
        row.innerHTML = `<span class="strip-name">${stem.label}<span class="hint"> ${stem.key}</span></span>`
            + `<input type="range" min="${GAIN_MIN}" max="${GAIN_MAX}" step="0.01" value="${GAIN_DEFAULT}" disabled>`
            + `<output class="strip-value">${fmtGain(GAIN_DEFAULT)}</output>`;
        strips.appendChild(row);
        const input = row.querySelector('input');
        const output = row.querySelector('output');
        if (!input || !output) throw new Error('mixer strip markup changed');
        input.addEventListener('input', () => setGain(index, Number(input.value)));
        input.addEventListener('dblclick', () => setGain(index, GAIN_DEFAULT));
        return { input, output };
    });

    const applyGain = (index: number) => {
        if (!graph) return;
        graph.stemGains[index].gain.setTargetAtTime(gains[index], graph.ctx.currentTime, RAMP);
    };

    const setGain = (index: number, value: number) => {
        const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number.isFinite(value) ? value : GAIN_DEFAULT));
        gains[index] = clamped;
        rows[index].input.value = String(clamped);
        rows[index].output.textContent = fmtGain(clamped);
        rows[index].output.classList.toggle('changed', clamped !== GAIN_DEFAULT);
        applyGain(index);
    };

    const applyOriginal = () => {
        originalButton.classList.toggle('on', original);
        strips.classList.toggle('bypassed', original);
        if (!graph) return;
        const now = graph.ctx.currentTime;
        graph.stemBus.gain.setTargetAtTime(original ? 0 : 1, now, RAMP / 3);
        graph.mixBus.gain.setTargetAtTime(original ? 1 : 0, now, RAMP / 3);
    };

    /** 第一次播放时才建 AudioContext（要用户手势），之后一直复用。 */
    const ensureGraph = (): Graph => {
        if (graph) return graph;
        const ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'playback' });
        const master = ctx.createGain();
        const stemBus = ctx.createGain();
        const mixBus = ctx.createGain();
        stemBus.gain.value = original ? 0 : 1;
        mixBus.gain.value = original ? 1 : 0;
        const stemGains = STEMS.map((_, index) => {
            const gain = ctx.createGain();
            gain.gain.value = gains[index];
            gain.connect(stemBus);
            return gain;
        });
        stemBus.connect(master);
        mixBus.connect(master);
        master.connect(ctx.destination);
        const splitter = ctx.createChannelSplitter(2);
        master.connect(splitter);
        const analysers = [0, 1].map((ch) => {
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            splitter.connect(analyser, ch);
            return analyser;
        });
        graph = { ctx, stemGains, stemBus, mixBus, analysers };
        return graph;
    };

    const stopSources = () => {
        generation += 1;
        for (const source of sources) {
            source.onended = null;
            try { source.stop(); } catch { /* 还没 start 的源 stop 会抛，忽略 */ }
            source.disconnect();
        }
        sources = [];
    };

    /** 从 offset 秒处同时启动原曲与四轨。 */
    const startAt = (offset: number) => {
        if (!tracks) return;
        const g = ensureGraph();
        stopSources();
        const gen = generation;
        const when = g.ctx.currentTime + 0.03;
        const at = Math.min(Math.max(0, offset), duration());
        const make = (buffer: AudioBuffer, to: AudioNode) => {
            const source = g.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(to);
            source.start(when, at);
            return source;
        };
        sources = [make(tracks.mix, g.mixBus), ...tracks.stems.map((buffer, index) => make(buffer, g.stemGains[index]))];
        sources[0].onended = () => {
            if (gen !== generation) return;
            playing = false;
            pausedAt = 0;
            stopSources();
            render();
        };
        startedAt = when - at;
        playing = true;
        tick();
    };

    const play = async () => {
        if (!tracks) return;
        const g = ensureGraph();
        if (g.ctx.state === 'suspended') await g.ctx.resume();
        startAt(pausedAt >= duration() ? 0 : pausedAt);
        render();
    };

    const pause = () => {
        pausedAt = position();
        playing = false;
        stopSources();
        render();
    };

    const seekTo = (seconds: number) => {
        pausedAt = Math.min(Math.max(0, seconds), duration());
        if (playing) startAt(pausedAt);
        render();
    };

    /** 左右声道里最大的绝对值；1.0 即 0 dBFS。 */
    const readPeak = () => {
        if (!graph) return 0;
        let max = 0;
        const data = new Float32Array(graph.analysers[0].fftSize);
        for (const analyser of graph.analysers) {
            analyser.getFloatTimeDomainData(data);
            for (let i = 0; i < data.length; i += 1) {
                const v = Math.abs(data[i]);
                if (v > max) max = v;
            }
        }
        return max;
    };

    const render = () => {
        const at = position();
        playButton.textContent = playing ? '暂停' : '播放';
        if (!seeking) seek.value = String(at);
        timeLabel.textContent = `${fmtTime(seeking ? Number(seek.value) : at)} / ${fmtTime(duration())}`;
        if (!playing) peakLabel.textContent = '';
    };

    // 播放时每帧取一次峰值（2048 采样 ≈ 46 ms，盖得住一帧），最大值保持 1.5 秒。
    const tick = () => {
        cancelAnimationFrame(frame);
        if (!playing) return;
        const now = performance.now();
        const value = readPeak();
        if (value >= peak.value || now - peak.at > 1500) peak = { value, at: now };
        const db = 20 * Math.log10(Math.max(peak.value, 1e-6));
        peakLabel.textContent = `峰值 ${db >= -0.05 ? '0.0' : db.toFixed(1)} dBFS${peak.value >= 1 ? ' 削波' : ''}`;
        peakLabel.classList.toggle('clip', peak.value >= 1);
        render();
        frame = requestAnimationFrame(tick);
    };

    playButton.addEventListener('click', () => (playing ? pause() : void play()));
    originalButton.addEventListener('click', () => {
        original = !original;
        applyOriginal();
    });
    seek.addEventListener('input', () => {
        seeking = true;
        render();
    });
    seek.addEventListener('change', () => {
        seeking = false;
        seekTo(Number(seek.value));
    });
    document.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((button) => {
        button.addEventListener('click', () => {
            const preset = button.dataset.preset;
            STEMS.forEach((stem, index) => {
                const value = preset === 'vocals' ? (stem.key === 'vocals' ? 1 : 0)
                    : preset === 'karaoke' ? (stem.key === 'vocals' ? 0 : 1)
                        : GAIN_DEFAULT;
                setGain(index, value);
            });
        });
    });

    /** 换一组音轨（新跑完的引擎）：保留各滑块的强度与播放位置，正在播就接着播。 */
    const load = (next: MixerTracks) => {
        const wasPlaying = playing;
        const at = position();
        if (playing) {
            playing = false;
            stopSources();
        }
        // 原曲同一首就复用上一次的 AudioBuffer，不再拷一份。
        const mix = tracks && mixSource === next.mix.left ? tracks.mix : createStereoBuffer(next.mix.left.length);
        if (mix !== tracks?.mix) {
            mix.copyToChannel(next.mix.left, 0);
            mix.copyToChannel(next.mix.right, 1);
        }
        mixSource = next.mix.left;
        tracks = { label: next.label, mix, stems: next.stems };
        whichLabel.textContent = next.label;
        seek.max = String(duration());
        pausedAt = Math.min(at, duration());
        for (const control of [playButton, originalButton, seek, ...rows.map(r => r.input)]) control.disabled = false;
        document.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((b) => { b.disabled = false; });
        if (wasPlaying) void play();
        render();
    };

    STEMS.forEach((_, index) => setGain(index, GAIN_DEFAULT));
    render();
    return { load };
};
