import { clamp, MASK_SCALE, smooth } from './nebbiaConstants';
import type { NebbiaSegments } from './nebbiaSegments';

// src/components/visualizer/nebbia/nebbiaSnowTrails.ts
// 雪窗上走动的水珠在雾上擦出的一道（nebbiaSnowWater.ts 用）：只擦掉一半，宽是水珠直径的六成（全擦开的话后面清楚的街景透出来，
// 一道道像黑条）；停下后过 hold 的一半、用 refog 的六成回雾（库里水痕上的雾也回得快），完全回雾的丢掉。

export interface FogWipe { pts: number[]; w: number; end: number | null }

/** 走过多远才记一个点；擦掉多少（1 = 全擦开）。 */
const MOVE_MIN = 3;
const WIPE_CLEAR = 0.5;

export class NebbiaSnowTrails {
    private readonly list: FogWipe[] = [];

    clear() { this.list.length = 0; }

    /** 水珠走到 (x, y)，擦痕宽 w：接着它正在擦的那一道往下记，没有就开一道新的。 */
    track(wipe: FogWipe | null, x: number, y: number, w: number): FogWipe {
        if (!wipe) { const n: FogWipe = { pts: [x, y], w, end: null }; this.list.push(n); return n; }
        const p = wipe.pts;
        wipe.w = Math.max(wipe.w * 0.98, w);
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > MOVE_MIN) p.push(x, y);
        return wipe;
    }

    /** 画进擦痕遮罩：time 是水的时钟。 */
    draw(ctx: NebbiaSegments, time: number, hold: number, refog: number) {
        ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
        for (let i = this.list.length - 1; i >= 0; i -= 1) {
            const wp = this.list[i];
            const v = wp.end === null ? 1 : 1 - smooth(clamp((time - wp.end - hold * 0.5) / (refog * 0.6)));
            if (v <= 0.002) { this.list.splice(i, 1); continue; }
            const p = wp.pts;
            if (p.length < 4) continue;
            ctx.moveTo(p[0], p[1]);
            for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
            ctx.stroke(wp.w, v * WIPE_CLEAR);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}
