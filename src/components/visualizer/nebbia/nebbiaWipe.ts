import { clamp } from './nebbiaConstants';
import { lineRect, type LaidLine } from './nebbiaScene';
import { createVisualizerRng } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaWipe.ts
// 「几根手指来回抹掉」的几何：三四根手指并排，在这句上来回快速抹几趟；每条拖痕有自己的时间窗 [a, b]
// （占整个抹除过程的比例）。最后一趟手指抬起的地方留几颗被推过去的水珠。

export interface WipeStreak { pts: [number, number][]; w: number; a: number; b: number }
export interface NebbiaWipe {
    streaks: WipeStreak[];
    beads: { x: number; y: number; r: number }[];
    /** 抹完要几秒。 */
    dur: number;
}

export const buildWipe = (line: LaidLine, idx: number): NebbiaWipe | null => {
    const rnd = createVisualizerRng((idx * 4241 + 77) >>> 0);
    const { x0, x1, y0, y1, S } = lineRect(line);
    if (!Number.isFinite(x0)) return null;
    const fw = Math.max(14, S * 0.26), n = 3 + (rnd() < 0.5 ? 1 : 0), gap = fw * (1.25 + rnd() * 0.25);
    const handH = (n - 1) * gap + fw, cy = (y0 + y1) / 2;
    // 一趟的手要盖住整句的高度：句子比手高时，来回的几趟往下错开
    const passes = Math.max(3, Math.min(5, Math.ceil((y1 - y0) / (handH * 0.8)) + 2));
    const span = (y1 - y0) - handH * 0.6;
    const startDir = rnd() < 0.7 ? 1 : -1, pad = S * 0.35;
    const streaks: WipeStreak[] = [];
    for (let k = 0; k < passes; k += 1) {
        const dir = k % 2 === 0 ? startDir : -startDir;
        // 每趟的高度在句子范围里来回错开；越到后面越短、越潦草
        const yc = cy + (passes > 1 ? (k / (passes - 1) - 0.5) * Math.max(0, span) : 0) + (rnd() - 0.5) * fw * 0.8;
        const shrink = 1 - k * 0.08, mid = (x0 + x1) / 2, half = ((x1 - x0) / 2 + pad) * shrink;
        const xa = mid - dir * half + (rnd() - 0.5) * S * 0.3, xb = mid + dir * half + (rnd() - 0.5) * S * 0.3;
        const tilt = (rnd() - 0.5) * 0.16, bow = (rnd() - 0.5) * S * 0.35;
        // 来回之间没有停顿；每趟占的时间略有重叠
        const a = k / passes * 0.92, b = Math.min(1, (k + 1) / passes * 0.92 + 0.08);
        for (let f = 0; f < n; f += 1) {
            const yOff = (f - (n - 1) / 2) * gap + (rnd() - 0.5) * fw * 0.25;
            const lenK = f === n - 1 ? 0.84 + rnd() * 0.1 : 0.95 + rnd() * 0.05, wav = S * 0.04 * rnd();
            const pts: [number, number][] = [];
            for (let i = 0; i <= 24; i += 1) {
                const t = i / 24, x = xa + (xb - xa) * lenK * t;
                pts.push([x, yc + yOff + bow * Math.sin(Math.PI * t) + tilt * (x - mid) + wav * Math.sin(t * 5 + f)]);
            }
            streaks.push({ pts, w: fw * (0.85 + rnd() * 0.3), a, b });
        }
    }
    const beads: NebbiaWipe['beads'] = [];
    for (const st of streaks.slice(-n)) {
        const [ex, ey] = st.pts[st.pts.length - 1];
        beads.push({ x: ex, y: ey, r: st.w * 0.22 + 1.5 * rnd() });
        if (rnd() < 0.6) beads.push({ x: ex - (st.pts[1][0] - st.pts[0][0]) * 0.6, y: ey + (rnd() - 0.5) * st.w * 0.6, r: 1.5 + rnd() * 2.5 });
    }
    return { streaks, beads, dur: 0.32 * passes };
};

/** 拖痕在整体进度 ue 下画到哪：0..1。 */
export const streakProgress = (st: WipeStreak, ue: number) => clamp((ue - st.a) / (st.b - st.a));

/** (x, y) 处字边的水珠是否已经被手指带走。 */
export const isSwept = (wipe: NebbiaWipe, ue: number, x: number, y: number) => wipe.streaks.some(st => {
    const lp = streakProgress(st, ue);
    if (lp <= 0) return false;
    const p0 = st.pts[0][0], p1 = st.pts[st.pts.length - 1][0], front = p0 + (p1 - p0) * lp;
    if ((x - p0) * (front - x) < 0) return false;
    const k = clamp((x - p0) / (p1 - p0)), py = st.pts[Math.round(k * (st.pts.length - 1))][1];
    return Math.abs(y - py) < st.w * 0.7;
});
