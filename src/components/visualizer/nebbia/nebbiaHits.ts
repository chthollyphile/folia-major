import { clamp, MASK_SCALE, smooth } from './nebbiaConstants';
import type { NebbiaGlassMotion } from './nebbiaDrops';
import type { NebbiaSegments } from './nebbiaSegments';
import { lineRect, type LaidLine } from './nebbiaScene';
import { createVisualizerRng, mixVisualizerSeed } from '../visualizerSeedHash';
import { VOCAL_FPS, type VocalEnvelope } from '../../../services/analysis/vocalEnvelope';

// src/components/visualizer/nebbia/nebbiaHits.ts
// 雨点打在玻璃上，跟人声走：
// - 小雨点：每 20 毫秒一格，按这一格的人声能量以泊松速率 0.15–7 个/秒落下；每格的随机数只由歌和格号决定，
//   同一时刻同一首歌落在同一处。
// - 大雨点：每个吐字砸一颗，溅出一圈小水珠，躲开正在唱的那句。整首一次排好。
// 落定前先被拍扁一下；大雨点砸开一个不规则的小清点，0.4 秒后用 0.3 × 起雾时间回雾。
//
// 人声有两个来源：
// - 智能动感模式的「疏雨轻车」开着（雨点跟人声）、这首歌分析过时，用 HTDemucs 分出的人声轨（services/analysis/vocalEnvelope.ts）：
//   能量是逐帧响度按这首歌自己 ±1.5 秒内的人声范围归一（和原型 vocal-fx-demo 的「吐字明暗」一样），
//   大雨点砸在真实的起音上（够响的都砸，轻的三成）。整首按时间定死，拖进度、暂停都对得上。
// - 否则退回播放器的人声频段（1–3.5 kHz，按最近几秒自己的范围归一），大雨点砸在六成的词开唱处。
// 中途切到雾笺时人声轨只从切过来时的播放位置往后分（包络的 `from`）：那之前的格子和词照旧走频段这条路。

export interface Hit { t: number; x: number; y: number; R: number; big: boolean; sat: [number, number, number][] | null; seed: number }

/** 一格 20 毫秒，正好是人声包络的一帧。 */
const BUCKET = 1 / VOCAL_FPS;

/** 升序数组里第一个不小于 v 的位置。 */
const lowerBound = (sorted: number[], v: number) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    return lo;
};

/**
 * 人声轨逐帧能量 0..1：按 ±1.5 秒内唱着的帧（高于 top − 28 dB）的 10%–95% 范围归一，再 ^1.2。按包络缓存。
 * 窗口是一个随帧滑动的有序数组，进一帧插一个、出一帧删一个，不再每帧重排（结果逐位相同）。
 */
const energies = new WeakMap<VocalEnvelope, Float32Array>();
export const vocalEnvelopeEnergy = (env: VocalEnvelope): Float32Array => {
    const known = energies.get(env);
    if (known) return known;
    const { db, top, fps } = env;
    const n = db.length, reach = Math.round(1.5 * fps), floor = top - 28;
    const e = new Float32Array(n);
    // 帧 i 的窗口是 [i − reach, i + reach)
    const win: number[] = [];
    for (let j = 0; j < Math.min(n, reach); j += 1) if (db[j] > floor) win.splice(lowerBound(win, db[j]), 0, db[j]);
    for (let i = 0; i < n; i += 1) {
        if (i > 0) {
            const enter = i + reach - 1, leave = i - reach - 1;
            if (enter < n && db[enter] > floor) win.splice(lowerBound(win, db[enter]), 0, db[enter]);
            if (leave >= 0 && db[leave] > floor) win.splice(lowerBound(win, db[leave]), 1);
        }
        if (db[i] <= floor) continue;
        const a = win[Math.floor(win.length * 0.1)], b = Math.max(a + 3, win[Math.floor(win.length * 0.95)]);
        e[i] = clamp((db[i] - a) / (b - a)) ** 1.2;
    }
    energies.set(env, e);
    return e;
};

/**
 * 整首歌唱得多响，乘在人声轨的小雨点密度上：上面的逐帧能量只看前后几秒的起伏，一首从头喊到尾的和轻声的慢歌
 * 平均下来雨一样大。按人声轨的 `top`（响的那一档）算：−17.4 dB（郑润泽《你》）为 1 倍，每响 8 dB 翻一倍，
 * 夹在 0.5–3 倍（《凤舞九天》的 −3.8 dB 约 3 倍）。
 */
export const songLoudness = (top: number) => clamp(2 ** ((top + 17.4) / 8), 0.5, 3);

/** 某时刻正在唱的那句（原型 activeRect：开唱前 0.3 秒到唱完后 1 秒）。 */
const activeLine = (laid: LaidLine[], t: number) => laid.find(line => t >= line.t - 0.3 && t <= line.end + 1) ?? null;

/** 人声频段的自适应归一：峰值慢慢回落、底慢慢抬升，大约对应原型的「±1.5 秒内的人声范围」。 */
export class VocalEnergy {
    private floor = 0;
    private peak = 1;
    value = 0;

    update(raw: number, dt: number) {
        const k = 1 - Math.exp(-dt / 3);
        this.peak = Math.max(raw, this.peak + (raw - this.peak) * k * 0.5);
        this.floor = Math.min(raw, this.floor + (raw - this.floor) * k * 0.3);
        this.value = clamp((raw - this.floor) / Math.max(this.peak - this.floor, 8)) ** 1.2;
        return this.value;
    }
}

export class NebbiaHits {
    private big: Hit[] = [];
    private small: Hit[] = [];
    private lastBucket = -1;
    /** 人声轨的逐帧能量（帧 = 20 毫秒 = 一格），没有人声轨时 null。 */
    private vocal: Float32Array | null = null;
    /** 人声轨从哪一格起有（包络的 `from`），之前的格子走频段。 */
    private vocalFrom = 0;
    /** 整首的响度倍数（songLoudness），只乘人声轨的格子。 */
    private loud = 1;

    constructor(private seed: number) {}

    /**
     * 排好整首的大雨点，W、H 是 CSS 像素，大小按 1 倍排、画的时候再乘（`draw` 的 size），拖强度滑杆不用重排。
     * 有人声轨（`env`）时砸在起音上，否则砸在词开唱处；小雨点也改用人声轨逐格的能量。
     */
    buildBig(laid: LaidLine[], words: number[][][], W: number, H: number, env: VocalEnvelope | null = null) {
        this.big = [];
        this.small = [];
        this.lastBucket = -1;
        this.vocal = env && env.fps === VOCAL_FPS ? vocalEnvelopeEnergy(env) : null;
        this.vocalFrom = this.vocal ? env?.from ?? 0 : 0;
        this.loud = env && this.vocal ? songLoudness(env.top) : 1;
        const rnd = createVisualizerRng(mixVisualizerSeed(this.seed, 911));
        const k = Math.min(W, H) / 720;
        const add = (t: number, line: LaidLine | null) => {
            const rect = line ? lineRect(line) : null;
            let x = 0, y = 0;
            for (let tries = 0; tries < 8; tries += 1) {
                x = W * (0.03 + 0.94 * rnd()); y = H * (0.03 + 0.94 * rnd());
                if (!rect || x < rect.x0 - 20 || x > rect.x1 + 20 || y < rect.y0 - 20 || y > rect.y1 + 20) break;
            }
            const R = (7 + rnd() * 6) * k;
            const sat = Array.from({ length: 4 + Math.floor(rnd() * 5) }, (): [number, number, number] => {
                const a = rnd() * 6.28, d = R * (1.5 + rnd() * 1.4);
                return [Math.cos(a) * d, Math.sin(a) * d * 0.85 + R * 0.2, (1 + rnd() * 1.6) * k];
            });
            this.big.push({ t, x, y, R, big: true, sat, seed: rnd() * 100 });
        };
        // 人声轨开始之前（没有人声轨时是整首）砸在词开唱处，之后砸在起音上
        const vocalStart = env && this.vocal ? this.vocalFrom / env.fps : Infinity;
        laid.forEach((line, li) => {
            for (const w of words[li] ?? []) {
                const t = line.chars[w[0]].t;
                if (t < vocalStart && rnd() < 0.6) add(t, line);
            }
        });
        if (env && this.vocal) {
            const e = this.vocal;
            for (const o of env.onsets) if (e[o] > 0.15 || rnd() < 0.3) add(o / env.fps, activeLine(laid, o / env.fps));
        }
        this.big.sort((a, b) => a.t - b.t);
    }

    /**
     * 补上新到的格子里的小雨点；拖进度时只补最近 life 秒。有人声轨时每格用那一格的能量，
     * 否则用这一帧播放器频段的 `energy`。
     */
    advance(T: number, energy: number, density: number, life: number, W: number, H: number) {
        const bucket = Math.floor(T / BUCKET);
        if (bucket < this.lastBucket || bucket - this.lastBucket > life / BUCKET) {
            this.small = [];
            this.lastBucket = bucket - Math.ceil(life / BUCKET);
        }
        if (density > 0) {
            const k = Math.min(W, H) / 720, vocal = this.vocal;
            const rateOf = (e: number) => (0.15 + 7 * e * e) * density * BUCKET;
            const live = rateOf(energy);
            for (let b = this.lastBucket + 1; b <= bucket; b += 1) {
                const rnd = createVisualizerRng(mixVisualizerSeed(this.seed + b, 0x5ad1));
                if (rnd() >= (vocal && (b < 0 || b >= this.vocalFrom) ? rateOf(b >= 0 && b < vocal.length ? vocal[b] : 0) * this.loud : live)) continue;
                this.small.push({ t: (b + rnd()) * BUCKET, x: W * (0.03 + 0.94 * rnd()), y: H * (0.03 + 0.94 * rnd()), R: (2 + rnd() * 3.5) * k, big: false, sat: null, seed: rnd() * 100 });
            }
        }
        this.lastBucket = bucket;
        while (this.small.length && this.small[0].t < T - life) this.small.shift();
    }

    /** 画还活着的雨点：清点进遮罩，水珠进 motion。`size` 乘大雨点的半径和溅开的距离，半径不到 1 像素的不画。 */
    draw(ctx: NebbiaSegments, motion: NebbiaGlassMotion, T: number, refog: number, beadHold: number, size: number) {
        const fogT = refog * 0.3, life = 0.4 + fogT + beadHold * 0.5 + refog;
        let lo = 0, hi = this.big.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (this.big[m].t < T - life) lo = m + 1; else hi = m; }
        ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
        const one = (h: Hit, s: number) => {
            const R = h.R * s;
            const age = T - h.t;
            const v = 1 - smooth(clamp((age - 0.4) / fogT));
            const bv = 1 - smooth(clamp((age - 0.4 - beadHold * 0.5) / refog));
            // 大雨点砸开的清点比水珠略大一圈、很快回雾，不然显成一个暗环
            if (h.big && v > 0.002) {
                for (let j = 0; j < 7; j += 1) {
                    const a = h.seed + j * 0.9, d = R * 0.3;
                    const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a * 1.3) * d;
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + 0.1, y);
                }
                ctx.stroke(R * 1.3, v);
            }
            if (bv > 0.01) {
                // 刚砸上时拍扁、横向摊开，0.12 秒内回弹
                const sq = Math.exp(-age / 0.05);
                motion.put(h.x, h.y + R * 0.1, R * 0.9 * (0.6 + 0.4 * bv), bv, 1 + 0.5 * sq, 1 - 0.35 * sq);
                if (h.sat) for (const [dx0, dy0, r] of h.sat) {
                    const out = clamp(age / 0.08), dx = dx0 * s, dy = dy0 * s;
                    motion.put(h.x + dx * out, h.y + dy * out, r * (0.55 + 0.45 * bv), bv * out);
                }
            }
        };
        if (size > 0) for (let i = lo; i < this.big.length && this.big[i].t <= T; i += 1) if (this.big[i].R * size >= 1) one(this.big[i], size);
        for (const h of this.small) if (h.t <= T) one(h, 1);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /** 排好的大雨点和还留着的小雨点（单测读）。 */
    scheduled(): { big: readonly Hit[]; small: readonly Hit[] } {
        return { big: this.big, small: this.small };
    }

    /** 一颗雨点从落下到完全消失要几秒。 */
    static lifeOf(refog: number, beadHold: number) {
        return 0.4 + refog * 0.3 + beadHold * 0.5 + refog;
    }
}
