import type { BeatFxEvent } from '../../../services/beatFx/clock';
import { NebbiaBeatCursor } from './nebbiaBeatCursor';
import type { NebbiaAquaUniforms } from './nebbiaGlUtils';
import { NebbiaJellies } from './nebbiaJellies';
import { NEBBIA_MAX_BURSTS, NEBBIA_MAX_JELLIES, type NebbiaTuning } from './types';
import { NebbiaWeedSway } from './nebbiaWeedSway';

// src/components/visualizer/nebbia/nebbiaAquarium.ts
// 窗外是水族箱时运行时每帧调的那一份：水母（nebbiaJellies.ts），和智能动感模式「舞潮踏拍」的三项——
// 水母跟拍收缩、水草跟拍摇一下（nebbiaWeedSway.ts）、每拍从沙底冒出一排大泡、聚光灯光斑跟拍放大。走过的拍由 nebbiaBeatCursor.ts 给，拖进度不补拍；
// 拍按听到的时刻走（getBeatFxHeard，扣掉输出延迟），蓝牙耳机上也不抢拍。
// 算好的都写进同一份 uniform（nebbiaGlUtils.ts 的 NebbiaAquaUniforms），着色器只读。

type Rgb = [number, number, number];

/** 跟拍时读的：这首歌的节拍表，听到的歌里时刻（秒），三项各自的强度（0 是这一项不跟）。 */
export interface NebbiaAquaBeats { events: readonly BeatFxEvent[]; heard: number; jelly: number; weed: number; bubble: number; spot: number }

/** 一排泡留多久（秒）：这么久早浮出画面了，之后那一格可以给新的一排。 */
const BURST_LIFE = 6;
/** 聚光灯跟拍：一下满力的拍光斑放大多少，60 毫秒放大、再 0.25 秒缩回。 */
const SPOT_GROW = 0.45, SPOT_ATTACK = 0.06, SPOT_DECAY = 0.25;

const rand = (n: number) => {
    const x = Math.sin(n * 91.7 + 47.3) * 43758.5453;
    return x - Math.floor(x);
};

export class NebbiaAquarium {
    private readonly jellies = new NebbiaJellies();
    private readonly cursor = new NebbiaBeatCursor();
    private readonly out: NebbiaAquaUniforms = {
        jelly: new Float32Array(NEBBIA_MAX_JELLIES * 4),
        jellyColor: new Float32Array(NEBBIA_MAX_JELLIES * 4),
        count: 0,
        bubbles: 0,
        sway: new Float32Array(4),
        weedIdle: 1,
        bursts: new Float32Array(NEBBIA_MAX_BURSTS * 4),
        burstCount: 0,
        beatRows: 0,
        spotScale: 1,
    };
    /** 聚光灯跟拍：这一下放大到多少、从多少开始放大、过了几秒。 */
    private spotKick = 0;
    private spotFrom = 0;
    private spotAge = 10;
    private readonly weed = new NebbiaWeedSway();
    /** 下一排泡写进哪一格（环形）。 */
    private nextBurst = 0;

    setPalette(la: Rgb, lb: Rgb, lc: Rgb) {
        this.jellies.setPalette(la, lb, lc);
    }

    /**
     * 走一帧：dt 是窗外时钟走的秒数（暂停时 0），time 是窗外时钟，aspect 是画面宽高比；
     * beats 为 null 时不跟拍。返回这一帧给着色器的水族箱 uniform（同一个对象，每帧改写）。
     */
    step(dt: number, time: number, aspect: number, tuning: NebbiaTuning, beats: NebbiaAquaBeats | null): NebbiaAquaUniforms {
        const { out } = this;
        const hits = this.cursor.step(beats?.events ?? null, beats?.heard ?? 0);
        this.jellies.step(out, dt, time, aspect, tuning, hits, beats?.jelly ?? 0);
        out.bubbles = tuning.bubbles;
        const { sway, bursts } = out;
        for (const hit of hits) {
            const weed = beats?.weed ?? 0, bubble = beats?.bubble ?? 0;
            // 水草：左右交替推一下，小节第一拍推得更大
            if (weed > 0) this.weed.kick(hit.gain * weed * (hit.down ? 1 : 0.7));
            // 聚光灯：光斑放大一下，从还没缩回的大小接着放大
            const spot = beats?.spot ?? 0;
            if (spot > 0) {
                this.spotFrom = this.spotLevel();
                this.spotKick = Math.max(this.spotFrom, Math.min(1.5, hit.gain * spot * (hit.down ? 1 : 0.7)));
                this.spotAge = 0;
            }
            // 大泡：每拍一排，小节第一拍大一些；位置每拍不同，只由拍的序号决定
            if (bubble > 0) {
                const o = this.nextBurst * 4;
                bursts[o] = 0.17 + rand(hit.index) * Math.max(0, aspect - 0.34);
                bursts[o + 1] = time;
                bursts[o + 2] = Math.min(1, hit.gain * bubble * (hit.down ? 1 : 0.75));
                bursts[o + 3] = rand(hit.index * 3.3 + 1) * 100;
                this.nextBurst = (this.nextBurst + 1) % NEBBIA_MAX_BURSTS;
            }
        }
        out.beatRows = beats && beats.bubble > 0 ? 1 : 0;
        this.spotAge += dt;
        out.spotScale = 1 + SPOT_GROW * this.spotLevel();
        this.weed.step(dt, sway);
        // 舞潮踏拍的水草一项开着：水草自己的摆动按 0.6 秒的时间常数收掉（0.6 秒剩约 1/3，2 秒左右收干净），只跟拍走；关掉时同样慢慢摆回来
        const idle = beats && beats.weed > 0 ? 0 : 1;
        out.weedIdle += (idle - out.weedIdle) * (1 - Math.exp(-dt / 0.6));
        // 着色器只看前 burstCount 排：把早浮出去的排除掉（时钟回绕、换歌归零时冒出时刻在将来的也丢）
        let n = 0;
        for (let i = 0; i < NEBBIA_MAX_BURSTS; i += 1) {
            const age = time - bursts[i * 4 + 1];
            if (bursts[i * 4 + 2] > 0 && age >= 0 && age < BURST_LIFE) n = i + 1;
            else bursts[i * 4 + 2] = 0;
        }
        out.burstCount = n;
        return out;
    }

    private spotLevel() {
        const a = this.spotAge;
        return a < SPOT_ATTACK ? this.spotFrom + (this.spotKick - this.spotFrom) * a / SPOT_ATTACK : this.spotKick * Math.exp(-(a - SPOT_ATTACK) / SPOT_DECAY);
    }
}
