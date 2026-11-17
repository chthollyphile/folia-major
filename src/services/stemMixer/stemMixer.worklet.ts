// src/services/stemMixer/stemMixer.worklet.ts
// 分轨调音台的发声端：AudioWorklet 里放一首歌的原曲和三条分轨（鼓、贝斯、人声，44.1 kHz 双声道
// Int16），按四个强度混出来代替播放元素发声（stemMixerPlayer.ts 把元素静音、把这里接进同一个 deck）。
//
// 「其他」不另存：其他 = 原曲 − 鼓 − 贝斯 − 人声。四个强度都是 1.0× 时输出就是原曲本身，不受 htdemucs 四轨
// 之和与原曲的那点出入影响。还没分出来的地方（刚开始、跳到前面、分离停了）放原曲，两者之间 5 ms 交叉，
// 所以分离慢了、失败了，听到的都是原曲，不断音。
//
// 位置由主线程给（`play`：某个 AudioContext 时刻在第几个采样），这里按 44.1k → 设备采样率的比例自己走，
// 三次 Hermite 插值；采样率正好 44.1k 时落在整数位置上，不插值。暂停、跳转、缓冲由主线程跟着元素发
// `stop` / `play`，起停各淡 4 ms。强度高于 1.0× 时可能超出满幅，过一道和 automix 分轨交接同样的软限幅。
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
/** 原曲按满幅存；分轨可能略超满幅，按 ±2 存。 */
const MIX_SCALE = 1 / 32767;
const STEM_SCALE = 2 / 32767;
/** 原曲与分轨之间的交叉、起停的淡入淡出。 */
const BLEND_SEC = 0.005;
const EDGE_SEC = 0.004;
/** 强度变化的平滑时间常数。 */
const GAIN_TAU_SEC = 0.015;
/** 多久向主线程报一次位置。 */
const REPORT_SEC = 0.25;
const LIMIT_KNEE = 0.95;

/** 与 automix/crossfadeGraph.ts 的 softLimit 同一条曲线：0.95 以下原样，以上 tanh 收住。 */
const softLimit = (x: number): number => {
    const level = x < 0 ? -x : x;
    if (level <= LIMIT_KNEE) return x;
    const room = 1 - LIMIT_KNEE;
    const held = LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room);
    return x < 0 ? -held : held;
};

/** 三次 Hermite（Catmull-Rom）在 `at` 处的值；越界处按 0。 */
const hermite = (data: Int16Array, at: number): number => {
    const i = Math.floor(at);
    const t = at - i;
    const n = data.length;
    const y1 = i >= 0 && i < n ? data[i] : 0;
    if (t === 0) return y1;
    const y0 = i - 1 >= 0 && i - 1 < n ? data[i - 1] : 0;
    const y2 = i + 1 >= 0 && i + 1 < n ? data[i + 1] : 0;
    const y3 = i + 2 >= 0 && i + 2 < n ? data[i + 2] : 0;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
};

const sampleAt = (data: Int16Array, at: number): number => (at >= 0 && at < data.length ? data[at] : 0);

type Message =
    | { type: 'load'; total: number; mixL: Int16Array; mixR: Int16Array }
    | { type: 'stems'; from: number; to: number; data: Int16Array[] }
    | { type: 'gains'; gains: number[] }
    /** `seq` 随位置报回去：主线程据此丢掉这次起播之前发出、晚到的位置。 */
    | { type: 'play'; position: number; at: number; speed: number; seq: number }
    | { type: 'stop' }
    | { type: 'unload' };

class StemMixerProcessor extends AudioWorkletProcessor {
    private mix: [Int16Array, Int16Array] | null = null;
    /** 鼓 L/R、贝斯 L/R、人声 L/R。 */
    private stems: Int16Array[] = [];
    /** 已有分轨的 [from, to) 区间，按 from 排好、互不相交。 */
    private have: Array<[number, number]> = [];
    /** 目标强度，顺序同模型：鼓、贝斯、其他、人声。 */
    private target = [1, 1, 1, 1];
    private gains = [1, 1, 1, 1];
    private position = 0;
    private speed = STEM_RATE / sampleRate;
    /** 0 静音 → 1 发声。 */
    private level = 0;
    private playing = false;
    private startAt = Infinity;
    private pending: { position: number; speed: number; seq: number } | null = null;
    private seq = 0;
    /** 0 原曲 → 1 分轨。 */
    private blend = 0;
    private sinceReport = 0;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
    }

    private receive(message: Message) {
        switch (message.type) {
            case 'load':
                this.mix = [message.mixL, message.mixR];
                this.stems = Array.from({ length: 6 }, () => new Int16Array(message.total));
                this.have = [];
                this.blend = 0;
                break;
            case 'stems':
                if (!this.mix) return;
                message.data.forEach((chunk, k) => this.stems[k].set(chunk, message.from));
                this.addRange(message.from, message.to);
                break;
            case 'gains':
                this.target = message.gains.slice(0, 4);
                break;
            case 'play':
                this.pending = { position: message.position, speed: message.speed, seq: message.seq };
                this.startAt = message.at;
                break;
            case 'stop':
                this.pending = null;
                this.startAt = Infinity;
                this.playing = false;
                break;
            case 'unload':
                this.mix = null;
                this.stems = [];
                this.have = [];
                this.playing = false;
                this.pending = null;
                this.startAt = Infinity;
                this.level = 0;
                break;
            default:
        }
    }

    private addRange(from: number, to: number) {
        const merged: Array<[number, number]> = [];
        let next: [number, number] = [from, to];
        for (const range of this.have) {
            if (range[1] < next[0] || range[0] > next[1]) merged.push(range);
            else next = [Math.min(range[0], next[0]), Math.max(range[1], next[1])];
        }
        merged.push(next);
        merged.sort((a, b) => a[0] - b[0]);
        this.have = merged;
    }

    /** [from, to] 是否整段都有分轨。 */
    private covered(from: number, to: number) {
        return this.have.some(([a, b]) => a <= from && to < b);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const out = outputs[0];
        const left = out[0];
        const right = out[1] ?? out[0];
        const frames = left.length;
        // 要开始：在这个 quantum 里的哪一帧开始（之前的帧还静着）。没有要开始的，从第 0 帧起照常走。
        let startFrame = 0;
        if (this.pending && this.startAt < currentTime + frames / sampleRate) {
            startFrame = Math.max(0, Math.min(frames - 1, Math.round((this.startAt - currentTime) * sampleRate)));
            if (!this.playing) this.level = 0;
            // 消息晚到（主线程忙）：起播时刻已过，按晚了多久往前补，免得一起播就落后元素。
            const late = Math.max(0, currentTime - this.startAt);
            this.position = this.pending.position + late * this.pending.speed * sampleRate;
            this.speed = this.pending.speed;
            this.seq = this.pending.seq;
            this.sinceReport = 0;
            this.playing = true;
            this.pending = null;
            this.startAt = Infinity;
        }
        const mix = this.mix;
        if (!mix || (!this.playing && this.level <= 0)) {
            left.fill(0);
            if (right !== left) right.fill(0);
            return true;
        }
        const exact = this.speed === 1 && Number.isInteger(this.position);
        const read = exact ? sampleAt : hermite;
        const span = frames * this.speed;
        const toStems = this.covered(Math.floor(this.position) - 1, Math.ceil(this.position + span) + 2) ? 1 : 0;
        const blendStep = 1 / (BLEND_SEC * sampleRate);
        const edgeStep = 1 / (EDGE_SEC * sampleRate);
        const levelTarget = this.playing ? 1 : 0;
        // 强度：每个 quantum 朝目标走一步，quantum 内线性插。
        const k = 1 - Math.exp(-frames / (GAIN_TAU_SEC * sampleRate));
        const from = this.gains.slice();
        for (let s = 0; s < 4; s += 1) {
            this.gains[s] += (this.target[s] - this.gains[s]) * k;
            if (Math.abs(this.target[s] - this.gains[s]) < 1e-5) this.gains[s] = this.target[s];
        }
        const limit = this.gains.some(g => g > 1) || from.some(g => g > 1);
        const [d0, d1, b0, b1, v0, v1] = this.stems;
        for (let i = 0; i < frames; i += 1) {
            if (i < startFrame && levelTarget === 1 && this.level === 0) {
                left[i] = 0;
                right[i] = 0;
                continue;
            }
            const at = this.position;
            const mL = read(mix[0], at) * MIX_SCALE;
            const mR = read(mix[1], at) * MIX_SCALE;
            let l = mL;
            let r = mR;
            if (this.blend > 0 || toStems) {
                const t = i / frames;
                const gd = from[0] + (this.gains[0] - from[0]) * t;
                const gb = from[1] + (this.gains[1] - from[1]) * t;
                const go = from[2] + (this.gains[2] - from[2]) * t;
                const gv = from[3] + (this.gains[3] - from[3]) * t;
                const dL = read(d0, at) * STEM_SCALE; const dR = read(d1, at) * STEM_SCALE;
                const bL = read(b0, at) * STEM_SCALE; const bR = read(b1, at) * STEM_SCALE;
                const vL = read(v0, at) * STEM_SCALE; const vR = read(v1, at) * STEM_SCALE;
                // 原曲 × 其他的强度，加上三轨各自与「其他」强度之差：即四轨各乘强度之和，其他 = 原曲 − 三轨。
                const sL = go * mL + (gd - go) * dL + (gb - go) * bL + (gv - go) * vL;
                const sR = go * mR + (gd - go) * dR + (gb - go) * bR + (gv - go) * vR;
                this.blend = toStems ? Math.min(1, this.blend + blendStep) : Math.max(0, this.blend - blendStep);
                l = mL + (sL - mL) * this.blend;
                r = mR + (sR - mR) * this.blend;
            }
            this.level = levelTarget ? Math.min(1, this.level + edgeStep) : Math.max(0, this.level - edgeStep);
            if (limit) {
                l = softLimit(l);
                r = softLimit(r);
            }
            left[i] = l * this.level;
            right[i] = r * this.level;
            if (this.playing || this.level > 0) this.position += exact ? 1 : this.speed;
        }
        if (right !== left && out.length > 2) for (let c = 2; c < out.length; c += 1) out[c].fill(0);
        this.sinceReport += frames / sampleRate;
        if (this.playing && this.sinceReport >= REPORT_SEC) {
            this.sinceReport = 0;
            this.port.postMessage({ type: 'position', position: this.position, time: currentTime + frames / sampleRate, seq: this.seq });
        }
        return true;
    }
}

registerProcessor('folia-stem-mixer', StemMixerProcessor);
