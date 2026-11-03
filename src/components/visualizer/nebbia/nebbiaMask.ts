import { NebbiaBreathMask } from './nebbiaBreath';
import { clamp, NEBBIA_FIXED, MASK_SCALE, smooth } from './nebbiaConstants';
import { windDrift, type NebbiaGlassMotion } from './nebbiaDrops';
import type { NebbiaHits } from './nebbiaHits';
import { drawChar, strokeTrail, type InkContext } from './nebbiaInk';
import { NebbiaSegments } from './nebbiaSegments';
import { yieldFactor, yieldMask, type LaidLine } from './nebbiaScene';
import { buildWipe, isSwept, streakProgress } from './nebbiaWipe';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaMask.ts
// 每帧收一次擦痕遮罩的线段（nebbiaSegments.ts，由 nebbiaMaskGl.ts 在 GPU 上画）：每句按它的淡出方式算清晰度（写的时候 1，下一句开始后保持 hold 秒、屏上还空着就多留一会儿，再用 refog 秒起雾；
// 或两根手指来回搓掉、抹过的地方再起雾），再画雨点和被震落的水珠留下的水痕。让位时被哈气盖掉的句子，
// 白气另画一张遮罩（nebbiaBreath.ts）。水珠实例同时攒进 motion。

/** 水珠甩出的印子停下后保持几秒、回雾用时是 refog 的几倍。 */
const SMEAR_HOLD = 8;
const SMEAR_REFOG = 2.5;

/** 写好的笔画多久重收一次（秒）。 */
const WET_EVERY = 0.05;

export class NebbiaMask {
    /** 这一帧的擦痕线段。 */
    readonly ctx = new NebbiaSegments();
    readonly breath = new NebbiaBreathMask();
    /** 画面高（CSS 像素）。 */
    private H = 1;
    /** 雪窗、凝露时收这一帧扫过的几段（写字的笔尖、抹字的手指、往下淌的水珠头）和写好的笔画，交给 nebbiaSnow.ts / nebbiaCondensation.ts；雨窗 null。 */
    sweeps: number[] | null = null;
    wet: number[] | null = null;
    /** 雪窗时收这一帧写字留下的水珠结的冰芯（nebbiaInkIce.ts），交给 nebbiaSnow.ts 画；别的玻璃 null。 */
    ice: number[] | null = null;
    /** 写好的笔画段多，用的地方（雪水、凝露被吸走）也只每 0.05 秒用一次：每 WET_EVERY 秒才重收一次，中间几帧沿用上次的。 */
    private wetAt = -Infinity;

    resize(W: number, H: number) {
        this.H = H;
        this.breath.resize(W, H);
    }

    /** `rainSize` 是大雨点的大小倍数（tuning.rainBig × 雨点强度）。 */
    draw(laid: LaidLine[], T: number, now: number, tuning: NebbiaTuning, motion: NebbiaGlassMotion, hits: NebbiaHits, rainSize: number) {
        const { ctx } = this;
        ctx.clear();
        this.breath.begin();
        if (this.sweeps) this.sweeps.length = 0;
        if (this.ice) this.ice.length = 0;
        const wetDue = !!this.wet && now - this.wetAt >= WET_EVERY;
        if (wetDue) { this.wet!.length = 0; this.wetAt = now; }
        const ink: InkContext = { ctx, motion, strokeWidth: tuning.strokeWidth, writeSpeed: tuning.writeSpeed, busSpeed: tuning.busSpeed, sweeps: this.sweeps, wet: wetDue ? this.wet : null,
            ice: this.ice ? { out: this.ice, k: this.H / 1000, H: this.H } : null };
        laid.forEach((line, i) => {
            if (line.breathAt < Infinity) this.breath.drawLine(line, i, T, line.breathAt, line.breathUntil, line.breathDur, true);
            if (line.appearBreathAt < Infinity) this.breath.drawLine(line, i, T, line.appearBreathAt, line.appearBreathUntil, NEBBIA_FIXED.breathSpread, false);
            if (T >= line.t - 0.5) this.drawLine(ink, line, i, T, tuning);
        });
        this.breath.end();
        hits.draw(ctx, motion, T, tuning.refog, NEBBIA_FIXED.beadHold, rainSize);
        this.drawTrails(motion, now, tuning);
    }

    // 一句：慢慢起雾，或手指抹除（另画拖痕，拖过的地方字边水珠被带走）
    private drawLine(ink: InkContext, line: LaidLine, idx: number, T: number, tuning: NebbiaTuning) {
        const { refog } = tuning, beadHold = NEBBIA_FIXED.beadHold;
        const { fogAt } = line;
        const yf = yieldFactor(line, T), ym = yieldMask(line, T);
        // 被哈气盖掉的手指句不搓（不然先搓开、又哈上白气，两个效果打架）：和起雾的一样慢慢淡进雾里
        if (line.mode === 'fog' || line.breathAt < Infinity) {
            const v = (1 - smooth(clamp((T - fogAt) / refog))) * ym;
            // 擦痕边的水珠：擦痕开始起雾后再挂 beadHold 秒，再用 refog × 3 慢慢缩小消失
            const vb = (1 - smooth(clamp((T - fogAt - beadHold) / (refog * 3)))) * yf;
            if (vb > 0.002 || v > 0.002) for (const c of line.chars) drawChar(ink, c, T, v, vb);
            return;
        }
        if (line.wipe === undefined) line.wipe = buildWipe(line, idx);
        const w = line.wipe;
        if (!w) return;
        // 要让位的句子：唱完了就提前抹，赶在后面那句开写前抹完
        const early = line.yieldAt - w.dur - 0.9;
        const t0 = fogAt > early && early >= line.end ? early : fogAt;
        const ue = clamp((T - t0) / w.dur);
        // 抹完先清亮一会儿，再慢慢起雾
        const back = 1 - smooth(clamp((T - t0 - w.dur - 0.5) / refog)), vw = back * ym;
        // 拖痕不留印子：让位淡掉时一起淡掉
        const vs = back * yf;
        const vbw = (1 - smooth(clamp((T - t0 - w.dur - 0.5 - beadHold) / (refog * 3)))) * yf;
        if (vbw <= 0.002 && vw <= 0.002) return;
        const alive = ue <= 0 ? null : (x: number, y: number) => (isSwept(w, ue, x, y) ? 0 : 1);
        for (const c of line.chars) drawChar(ink, c, T, ue <= 0 ? ym : vw, ue <= 0 ? yf : vbw, alive);
        if (ue <= 0) return;
        const { ctx } = ink;
        ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
        if (vs > 0.002) for (const st of w.streaks) {
            const lp = streakProgress(st, ue);
            if (lp <= 0) continue;
            const pts = st.pts, n = pts.length - 1, f = lp * n, i = Math.floor(f);
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let k = 1; k <= Math.min(i, n); k += 1) ctx.lineTo(pts[k][0], pts[k][1]);
            if (i < n) { const a = pts[i], b = pts[i + 1], r = f - i; ctx.lineTo(a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r); }
            ctx.stroke(st.w, vs);
            // 雪窗、凝露：手指正扫过的一段（指尖和它身后一点）
            if (ink.sweeps && lp < 1) {
                const [ax, ay] = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
                ink.sweeps.push(ax, ay, b[0], b[1], st.w);
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (ue >= 1 && vbw > 0.002) for (const b of w.beads) ink.motion.put(b.x, b.y, b.r * (0.55 + 0.45 * vbw), vbw);
    }

    // 被震落的水珠留下的水痕、颠簸时水珠甩过的印子，和手指擦痕一样过一会儿重新起雾；完全回雾的丢掉
    private drawTrails(motion: NebbiaGlassMotion, now: number, tuning: NebbiaTuning) {
        const { ctx } = this;
        const smears = motion.smears;
        ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
        for (let i = smears.length - 1; i >= 0; i -= 1) {
            const m = smears[i];
            // 甩出的印子留得久：停下后保持 SMEAR_HOLD 秒，再用 refog 的 SMEAR_REFOG 倍慢慢回雾
            const v = m.end === null ? 1 : 1 - smooth(clamp((now - m.end - SMEAR_HOLD) / (tuning.refog * SMEAR_REFOG)));
            if (v <= 0.002) { m.gone = true; smears.splice(i, 1); continue; }
            ctx.moveTo(m.x + m.ax, m.y + m.ay);
            ctx.lineTo(m.x + m.bx, m.y + m.by);
            ctx.stroke(m.w * 0.14, v * 0.9);
        }
        const trails = motion.trails;
        for (let i = trails.length - 1; i >= 0; i -= 1) {
            const tr = trails[i];
            const v = tr.end === null ? 1 : 1 - smooth(clamp((now - tr.end - tuning.hold) / tuning.refog));
            if (v <= 0.002) { trails.splice(i, 1); continue; }
            // 太短的、整条在屏幕下面的不画（照样按时间回雾、丢掉）
            if (tr.y1 - tr.y0 < 2 || tr.y0 > this.H) continue;
            ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
            const wob = (y: number) => Math.sin(y * 0.07 + tr.seed) * 1.4 + Math.sin(y * 0.021 + tr.seed * 2) * 2.2 + windDrift(y - tr.y0, tuning.busSpeed);
            strokeTrail(ctx, tr.x, tr.y0, tr.y1, tr.w * 0.18, v * 0.95, tr.seed, wob);
            for (let y = tr.y0 + 10 + (tr.seed % 9); y < tr.y1 - tr.w * 0.25; y += 16 + ((y * 7 + tr.seed * 13) % 13)) {
                motion.put(tr.x + wob(y), y, tr.w * (0.03 + 0.03 * (((y + tr.seed) * 0.37) % 1)), v);
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}
