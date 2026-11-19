// src/services/stemMixer/stemMixer.worklet.ts
// 分轨调音台的发声端：一个 AudioWorklet，插在 deck 的 MediaElementSource 与 replayGain 之间
// （stemMixerPlayer.ts）。它的输入就是元素的声音：
//   - 四个强度都是 1.0×、或播放头这里还没有分轨、或没在跟着播放时，原样透传输入——听到的就是原曲本身；
//   - 否则放自己按强度混出来的声音，和输入之间 5 ms 交叉。
// 所以分离慢了、失败了、跳到还没分的地方，听到的都是原曲，不断音；默认强度下也不改音质。
//
// 混音用的是播放头附近的一段「块」：每块是一段 [from, to) 的原曲与鼓、贝斯、人声三轨（44.1 kHz 双声道
// Int16，按 ±2 满幅存），由主线程分好、分配好再转交过来；这里不做大块分配。其他 = 原曲 − 三轨，四轨各乘
// 强度相加。主线程按播放头告诉这里留哪一段（`keep`），之外的块丢掉。
//
// 位置由主线程给（`play`：某个 AudioContext 时刻在第几个采样），这里按 44.1k → 设备采样率的比例自己走，
// 三次 Hermite 插值；采样率正好 44.1k 时走整数位置，不插值。正在放自己的声音时来了新位置（对齐）：新位置
// 有块就从旧位置直接交叉过去，不漏出原曲；没有块（跳到了还没分的地方）就先交叉回输入、换位置。强度高于 1.0× 时过一道和 automix
// 分轨交接同样的软限幅。
//
// 不 import 任何东西：这个文件单独打包给 audioWorklet.addModule。

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}

export {};

const STEM_RATE = 44100;
/** 原曲与分轨都按 ±2 满幅存：有损解码的原曲常有略超满幅的过冲，不削。 */
const SCALE = 2 / 32767;
/** 输入与自己的声音之间的交叉。 */
const BLEND_SEC = 0.005;
/** 强度变化的平滑时间常数。 */
const GAIN_TAU_SEC = 0.015;
/** 多久向主线程报一次位置。 */
const REPORT_SEC = 0.25;
const LIMIT_KNEE = 0.95;
/** 一块的声道：原曲 L/R、鼓 L/R、贝斯 L/R、人声 L/R。 */
const CHANNELS = 8;

/** 与 automix/crossfadeGraph.ts 的 softLimit 同一条曲线：0.95 以下原样，以上 tanh 收住。 */
const softLimit = (x: number): number => {
    const level = x < 0 ? -x : x;
    if (level <= LIMIT_KNEE) return x;
    const room = 1 - LIMIT_KNEE;
    const held = LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room);
    return x < 0 ? -held : held;
};

interface Chunk { from: number; to: number; data: Int16Array[]; gen: number }

type Message =
    /** 一首新歌（或不再放）：之前的块在交叉回输入之后丢掉。 */
    | { type: 'load'; gen: number }
    | { type: 'chunk'; gen: number; from: number; to: number; data: Int16Array[] }
    /** 只留与 [from, to) 有交集的块。 */
    | { type: 'keep'; from: number; to: number }
    | { type: 'gains'; gains: number[] }
    /** `seq` 随位置报回去：主线程据此丢掉这次起播之前发出、晚到的位置。 */
    | { type: 'play'; position: number; at: number; speed: number; seq: number }
    | { type: 'stop' };

class StemMixerProcessor extends AudioWorkletProcessor {
    private chunks: Chunk[] = [];
    /** 主线程最新的一代（一首歌一代）。 */
    private gen = 0;
    /** 正在放的那一代：换歌后交叉回输入的 5 ms 里还读上一首的块，回到输入了才换成最新的。 */
    private playGen = 0;
    /** 上一次找到的块，下一个采样多半还在它里面。 */
    private last: Chunk | null = null;
    /** 目标强度，顺序同模型：鼓、贝斯、其他、人声。 */
    private target = [1, 1, 1, 1];
    private gains = [1, 1, 1, 1];
    private readonly from = [1, 1, 1, 1];
    private position = 0;
    private speed = STEM_RATE / sampleRate;
    private playing = false;
    private pending: { position: number; speed: number; seq: number; at: number } | null = null;
    private seq = 0;
    /** 0 透传输入 → 1 自己的声音。 */
    private blend = 0;
    private sinceReport = 0;
    private readonly values = new Float64Array(CHANNELS);
    /** 放着自己的声音时重新给了位置（对齐）：从旧位置交叉到新位置，旧位置在这里接着走。 */
    private jumpFrom: number | null = null;
    private jumpMix = 0;
    private ownL = 0;
    private ownR = 0;
    /** 交叉回输入的途中来的 `keep`：正在读的块先留着，回到输入了再按它丢。 */
    private keepLater: { from: number; to: number } | null = null;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
    }

    private receive(message: Message) {
        switch (message.type) {
            case 'load':
                this.gen = message.gen;
                this.jumpFrom = null;
                this.playing = false;
                this.pending = null;
                break;
            case 'chunk':
                if (message.gen !== this.gen) return;
                this.chunks.push({ from: message.from, to: message.to, data: message.data, gen: message.gen });
                this.chunks.sort((a, b) => a.from - b.from);
                break;
            case 'keep':
                this.keep(message.from, message.to);
                break;
            case 'gains':
                this.target = message.gains.slice(0, 4);
                break;
            case 'play':
                this.pending = { position: message.position, speed: message.speed, seq: message.seq, at: message.at };
                break;
            case 'stop':
                this.pending = null;
                this.playing = false;
                this.jumpFrom = null;
                break;
            default:
        }
    }

    /**
     * 只留与 [from, to) 有交集的块。还没交叉回输入时（跳转了，正淡出旧位置）旧位置附近的块先留着，
     * 否则淡出的那几毫秒读到的是 0。
     */
    private keep(from: number, to: number) {
        const span = 2 * BLEND_SEC * sampleRate * this.speed;
        const near = this.blend > 0
            ? [this.position, this.jumpFrom ?? this.position].map(at => [Math.floor(at) - 2, Math.ceil(at + span) + 2])
            : null;
        this.chunks = this.chunks.filter(chunk => (chunk.to > from && chunk.from < to)
            || (near !== null && near.some(([a, b]) => chunk.to > a && chunk.from < b)));
        this.keepLater = near ? { from, to } : null;
        this.last = null;
    }

    /** 含第 `at` 个采样的块（正在放的这一代的）。 */
    private chunkAt(at: number): Chunk | null {
        const last = this.last;
        if (last && last.gen === this.playGen && at >= last.from && at < last.to) return last;
        for (const chunk of this.chunks) {
            if (chunk.gen === this.playGen && at >= chunk.from && at < chunk.to) {
                this.last = chunk;
                return chunk;
            }
        }
        return null;
    }

    /** [from, to] 是否整段都有块（块之间首尾相接，逐块走过去）。 */
    private covered(from: number, to: number): boolean {
        let at = Math.max(0, from);
        while (at <= to) {
            const chunk = this.chunkAt(at);
            if (!chunk) return false;
            at = chunk.to;
        }
        return true;
    }

    private sample(k: number, at: number): number {
        const chunk = this.chunkAt(at);
        return chunk ? chunk.data[k][at - chunk.from] : 0;
    }

    /** 八个声道在 `position` 处的值（未缩放）写进 `values`。 */
    private read(position: number) {
        const values = this.values;
        const i = Math.floor(position);
        const t = position - i;
        const chunk = this.chunkAt(i);
        if (t === 0) {
            for (let k = 0; k < CHANNELS; k += 1) values[k] = chunk ? chunk.data[k][i - chunk.from] : 0;
            return;
        }
        // 四个点都在同一块里时直接读，跨块时逐点找。
        const inside = chunk !== null && i - 1 >= chunk.from && i + 2 < chunk.to;
        for (let k = 0; k < CHANNELS; k += 1) {
            let y0: number; let y1: number; let y2: number; let y3: number;
            if (inside) {
                const data = chunk.data[k];
                const o = i - chunk.from;
                y0 = data[o - 1]; y1 = data[o]; y2 = data[o + 1]; y3 = data[o + 2];
            } else {
                y0 = this.sample(k, i - 1); y1 = this.sample(k, i); y2 = this.sample(k, i + 1); y3 = this.sample(k, i + 2);
            }
            const c1 = 0.5 * (y2 - y0);
            const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
            const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            values[k] = ((c3 * t + c2) * t + c1) * t + y1;
        }
    }

    /** 自己的声音在 `position` 处（四个强度），写进 ownL / ownR。 */
    private own(position: number, gd: number, gb: number, go: number, gv: number) {
        this.read(position);
        const v = this.values;
        // 四轨各乘强度之和，其他 = 原曲 − 三轨：原曲 × 其他的强度，加三轨各自与它之差。
        this.ownL = (go * v[0] + (gd - go) * v[2] + (gb - go) * v[4] + (gv - go) * v[6]) * SCALE;
        this.ownR = (go * v[1] + (gd - go) * v[3] + (gb - go) * v[5] + (gv - go) * v[7]) * SCALE;
    }

    process(inputs: Array<Array<Float32Array | undefined>>, outputs: Float32Array[][]): boolean {
        const out = outputs[0];
        const left = out[0];
        const right = out[1] ?? out[0];
        const frames = left.length;
        const input = inputs[0] ?? [];
        const inL: Float32Array | undefined = input[0];
        const inR: Float32Array | undefined = input[1] ?? input[0];

        // 到点的新位置：放着输入时直接换；放着自己的声音时，新位置也有块（对齐、近处跳转）就从旧位置交叉过去，
        // 没有就先交叉回输入、回到输入了再换。没到点之前照旧放。
        const pending = this.pending !== null && this.pending.at < currentTime + frames / sampleRate ? this.pending : null;
        const due = pending !== null;
        // 这个 quantum 从 currentTime 起：`at` 在它里面时往回算，晚到了往前补。
        const raw = pending ? Math.max(0, pending.position + (currentTime - pending.at) * pending.speed * sampleRate) : 0;
        const target = pending?.speed === 1 ? Math.round(raw) : raw;
        const jumpable = pending !== null && this.blend > 0 && this.playing && this.jumpFrom === null && pending.speed === this.speed
            && this.covered(Math.floor(target) - 1, Math.ceil(target + (frames + BLEND_SEC * sampleRate) * this.speed) + 2);
        if (jumpable) {
            this.jumpFrom = this.position;
            this.jumpMix = 0;
        }
        if (pending && (this.blend === 0 || jumpable)) {
            this.position = target;
            this.speed = pending.speed;
            this.seq = pending.seq;
            this.sinceReport = 0;
            this.playing = true;
            this.pending = null;
        }
        if (this.blend === 0 && this.keepLater) this.keep(this.keepLater.from, this.keepLater.to);
        // 上一首的块：交叉回输入以后丢掉。
        if (this.blend === 0 && this.playGen !== this.gen) {
            this.playGen = this.gen;
            this.chunks = this.chunks.filter(chunk => chunk.gen === this.gen);
            this.last = null;
        }

        // 强度：每个 quantum 朝目标走一步，quantum 内线性插。
        const k = 1 - Math.exp(-frames / (GAIN_TAU_SEC * sampleRate));
        // 音频线程上不分配：上一个 quantum 的强度抄进预先留好的数组。
        const from = this.from;
        let unity = true;
        let limit = false;
        for (let s = 0; s < 4; s += 1) {
            from[s] = this.gains[s];
            this.gains[s] += (this.target[s] - this.gains[s]) * k;
            if (Math.abs(this.target[s] - this.gains[s]) < 1e-4) this.gains[s] = this.target[s];
            if (from[s] !== 1 || this.gains[s] !== 1 || this.target[s] !== 1) unity = false;
            if (from[s] > 1 || this.gains[s] > 1) limit = true;
        }
        // 往前多看一个交叉的长度：走出有块的地方之前就已交叉回输入。
        const ahead = Math.ceil(this.position + (frames + BLEND_SEC * sampleRate) * this.speed) + 2;
        // 到点了却还没换（新位置没有块，要先交叉回输入）：这时不要自己的声音。换过了就照常。
        const want = this.playing && !(due && this.pending !== null) && this.playGen === this.gen && !unity && this.covered(Math.floor(this.position) - 1, ahead);
        const step = 1 / (BLEND_SEC * sampleRate);

        for (let i = 0; i < frames; i += 1) {
            this.blend = want ? Math.min(1, this.blend + step) : Math.max(0, this.blend - step);
            const xL = inL ? inL[i] : 0;
            const xR = inR ? inR[i] : 0;
            if (this.blend === 0) {
                left[i] = xL;
                right[i] = xR;
                this.jumpFrom = null;
            } else {
                const t = i / frames;
                const gd = from[0] + (this.gains[0] - from[0]) * t;
                const gb = from[1] + (this.gains[1] - from[1]) * t;
                const go = from[2] + (this.gains[2] - from[2]) * t;
                const gv = from[3] + (this.gains[3] - from[3]) * t;
                this.own(this.position, gd, gb, go, gv);
                let l = this.ownL;
                let r = this.ownR;
                if (this.jumpFrom !== null) {
                    this.own(this.jumpFrom, gd, gb, go, gv);
                    l = this.ownL + (l - this.ownL) * this.jumpMix;
                    r = this.ownR + (r - this.ownR) * this.jumpMix;
                    this.jumpFrom += this.speed;
                    this.jumpMix += step;
                    if (this.jumpMix >= 1) this.jumpFrom = null;
                }
                if (limit) {
                    l = softLimit(l);
                    r = softLimit(r);
                }
                left[i] = xL + (l - xL) * this.blend;
                right[i] = xR + (r - xR) * this.blend;
            }
            // 停下以后交叉回输入的那几毫秒里也照常往前走，不在一个采样上停住。
            if (this.playing || this.blend > 0) this.position += this.speed;
        }
        for (let c = 2; c < out.length; c += 1) out[c].fill(0);
        this.sinceReport += frames / sampleRate;
        if (this.playing && this.sinceReport >= REPORT_SEC) {
            this.sinceReport = 0;
            this.port.postMessage({ type: 'position', position: this.position, time: currentTime + frames / sampleRate, seq: this.seq });
        }
        return true;
    }
}

registerProcessor('folia-stem-mixer', StemMixerProcessor);
