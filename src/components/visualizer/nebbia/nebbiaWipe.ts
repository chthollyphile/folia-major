import { clamp } from './nebbiaConstants';
import { lineRect, type LaidLine } from './nebbiaScene';
import { createVisualizerRng } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaWipe.ts
// 「手指来回搓掉」的几何：食指中指并拢，手从句子左头往右走，边走边快速上下来回搓。一来一回基本走同一条道，
// 搓的角度随着手往右走慢慢偏（离竖直 ±35° 里摆），指尖走一道带点弧的短线，搓过的地方连成一片盖住整句。
// 两根手指压在一起没有缝，只在端头看得出两个错开的圆头；哪根长、各多宽，整次抹除不变。
// 每条拖痕（一根手指搓的一下）有自己的时间窗 [a, b]（占整个抹除过程的比例）。最后一下手指抬起的地方留几颗被推过去的水珠。

/** box：外扩了带走水珠半径的包围盒 [x0, y0, x1, y1]，isSwept 先用它排除。 */
export interface WipeStreak { pts: [number, number][]; w: number; a: number; b: number; box: [number, number, number, number] }
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
    const fw = Math.max(14, S * 0.28), n = 2, gap = fw * 0.8;
    const handW = gap + fw, cy = (y0 + y1) / 2, pad = S * 0.3;
    // 上下搓一下的长度盖住整句的高度；手每往右走半只手宽搓一下
    // 同一只手：两根手指各多宽、哪根长（中指），整次不变；弧往哪边弯也不变（手腕转的方向）
    const fingers = [{ w: fw * (0.92 + rnd() * 0.08), lenK: 0.88 + rnd() * 0.04 }, { w: fw * (0.97 + rnd() * 0.08), lenK: 1 }];
    const bowDir = rnd() < 0.5 ? 1 : -1, phase = rnd() * Math.PI * 2, swing = 0.45 + rnd() * 0.15;
    // 搓是斜的，两头的上下角会漏：起止各往外多走斜出去的那一截
    const len = (y1 - y0) + pad * 2, slant = Math.sin(swing) * len * 0.5, xs = x0 - pad - slant, xe = x1 + pad + slant;
    const rubs = Math.max(6, Math.ceil((xe - xs) / (handW * 0.5)));
    const streaks: WipeStreak[] = [];
    for (let k = 0; k < rubs; k += 1) {
        const hx = xs + (xe - xs) * (k + 0.5) / rubs, down = k % 2 === 0 ? 1 : -1, pair = Math.floor(k / 2);
        // 一来一回同一个角度（只差一点），每来回一趟往一边慢慢偏
        const ang = swing * Math.sin(phase + pair * 0.5) + (rnd() - 0.5) * 0.06, ca = Math.cos(ang), sa = Math.sin(ang);
        const L = len * (0.95 + rnd() * 0.1), bow = bowDir * S * (0.08 + rnd() * 0.03);
        // 搓得快：一下接一下没有停顿，前后略有重叠
        const a = k / rubs * 0.96, b = Math.min(1, (k + 1) / rubs * 0.96 + 0.04);
        for (let f = 0; f < n; f += 1) {
            const off = (f - (n - 1) / 2) * gap, { w: fwk, lenK } = fingers[f];
            const pts: [number, number][] = [];
            for (let i = 0; i <= 12; i += 1) {
                // v 沿着搓的方向（-L/2..L/2，短的那根两头各短一点），w 是横向的偏移（手指并排 + 弧）
                const t = i / 12, u = 2 * t - 1, v = down * (t - 0.5) * L * lenK, w = off + bow * (1 - u * u);
                pts.push([hx + sa * v + ca * w, cy + ca * v - sa * w]);
            }
            const r = fwk * 0.7, xsP = pts.map(q => q[0]), ysP = pts.map(q => q[1]);
            streaks.push({ pts, w: fwk, a, b, box: [Math.min(...xsP) - r, Math.min(...ysP) - r, Math.max(...xsP) + r, Math.max(...ysP) + r] });
        }
    }
    const beads: NebbiaWipe['beads'] = [];
    for (const st of streaks.slice(-n)) {
        const [ex, ey] = st.pts[st.pts.length - 1];
        beads.push({ x: ex, y: ey, r: st.w * 0.22 + 1.5 * rnd() });
        if (rnd() < 0.6) beads.push({ x: ex - (st.pts[1][0] - st.pts[0][0]) * 0.6 + (rnd() - 0.5) * st.w * 0.6, y: ey - (st.pts[1][1] - st.pts[0][1]) * 0.6, r: 1.5 + rnd() * 2.5 });
    }
    // 搓一下 0.08 秒，句子长的搓得更快，整次不超过 1.6 秒
    return { streaks, beads, dur: Math.min(0.08 * rubs, 1.6) };
};

/** 拖痕在整体进度 ue 下画到哪：0..1。 */
export const streakProgress = (st: WipeStreak, ue: number) => clamp((ue - st.a) / (st.b - st.a));

/** (x, y) 处字边的水珠是否已经被手指带走：离哪条拖痕已经画到的那段足够近。 */
export const isSwept = (wipe: NebbiaWipe, ue: number, x: number, y: number) => wipe.streaks.some(st => {
    const lp = streakProgress(st, ue);
    if (lp <= 0) return false;
    const bx = st.box;
    if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) return false;
    const pts = st.pts, last = lp * (pts.length - 1), r = st.w * 0.7, r2 = r * r;
    for (let i = 0; i < last; i += 1) {
        const [ax, ay] = pts[i], b = pts[i + 1], f = Math.min(1, last - i);
        const dx = (b[0] - ax) * f, dy = (b[1] - ay) * f;
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
        const ex = x - ax - dx * t, ey = y - ay - dy * t;
        if (ex * ex + ey * ey < r2) return true;
    }
    return false;
});
