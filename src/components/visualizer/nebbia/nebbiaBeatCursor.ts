import type { BeatFxEvent } from '../../../services/beatFx/clock';

// src/components/visualizer/nebbia/nebbiaBeatCursor.ts
// 舞潮踏拍的节拍游标（nebbiaAquarium.ts 每帧调）：返回这一帧走过的拍。节拍表换了、拖了进度只把游标挪到当前时刻，不补拍；
// 没有节拍的小节（rhythmic 为 false）不算。

/** 一拍：在节拍表里的序号（每拍不同的伪随机用）、力度（按 accent，最低 0.35）、是不是小节第一拍。 */
export interface NebbiaBeatHit { index: number; gain: number; down: boolean }

/** 一帧里歌的时间往前走超过这么多秒就当作跳了进度。 */
const MAX_STEP = 0.5;

export class NebbiaBeatCursor {
    private events: readonly BeatFxEvent[] | null = null;
    private cursor = 0;
    private lastT = -Infinity;
    /** 这一帧走过的拍（每帧清空重用）。 */
    private readonly hits: NebbiaBeatHit[] = [];

    /** 走到歌里的 T 秒；events 为 null（不跟拍）时忘掉游标，返回空。 */
    step(events: readonly BeatFxEvent[] | null, T: number): readonly NebbiaBeatHit[] {
        const { hits } = this;
        hits.length = 0;
        if (!events) {
            this.events = null;
            return hits;
        }
        const jumped = events !== this.events || T < this.lastT || T - this.lastT > MAX_STEP;
        this.lastT = T;
        if (jumped) {
            this.events = events;
            let lo = 0, hi = events.length;
            while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].t <= T) lo = m + 1; else hi = m; }
            this.cursor = lo;
            return hits;
        }
        for (; this.cursor < events.length && events[this.cursor].t <= T; this.cursor += 1) {
            const e = events[this.cursor];
            if (e.rhythmic === false) continue;
            hits.push({ index: this.cursor, gain: Math.max(0.35, e.impact ?? 1), down: e.kind === 'downbeat' });
        }
        return hits;
    }
}
