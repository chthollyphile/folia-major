import { DRUM_KICK, type DrumHits } from '../../../services/analysis/drumHits';

// src/components/visualizer/nebbia/nebbiaDrumBumps.ts
// 疏雨轻车的鼓点颠簸：车压过底鼓颠一下，代替随机颠簸。只看底鼓（军鼓、镲片一颠就太碎），
// 力度不到 MIN_STRENGTH 的不颠，两次至少隔 MIN_GAP 秒；幅度随鼓点力度。
// 只在播放时间往前走一小段时触发这段里的鼓点；拖进度、暂停后跳回、换歌都只把游标挪过去，不补颠。

const MIN_STRENGTH = 0.35;
const MIN_GAP = 0.3;
/** 一帧里时间往前走超过这么多秒就当作跳了进度。 */
const MAX_STEP = 0.5;

export class NebbiaDrumBumps {
    private list: DrumHits | null = null;
    private key: string | null = null;
    private next = 0;
    private lastT = -Infinity;
    private lastBump = -Infinity;

    /**
     * 走到 `T`（歌里的秒），返回这一段里要颠的幅度（0 = 不颠，取这一段里最响的一下）。
     * `hits` 是这首歌的鼓点（还在分离时带 `until`）。
     */
    step(hits: DrumHits, key: string | null, T: number): number {
        // 边分离边出的鼓点每秒换一份新的表：时间不变，游标按时间重新找
        if (hits !== this.list || key !== this.key) {
            this.list = hits;
            this.key = key;
            this.seek(T);
            return 0;
        }
        if (T < this.lastT || T - this.lastT > MAX_STEP) {
            this.seek(T);
            return 0;
        }
        let amount = 0;
        const { times, strengths, kinds } = hits;
        for (; this.next < times.length && times[this.next] <= T; this.next += 1) {
            const at = times[this.next];
            if (kinds[this.next] !== DRUM_KICK || strengths[this.next] < MIN_STRENGTH || at - this.lastBump < MIN_GAP) continue;
            this.lastBump = at;
            amount = Math.max(amount, 0.3 + 0.7 * strengths[this.next]);
        }
        this.lastT = T;
        return amount;
    }

    /** 不在跟鼓点（没开、没鼓点）：下次有了从那时起算。 */
    reset() {
        this.list = null;
        this.key = null;
    }

    private seek(T: number) {
        const times = this.list?.times;
        let lo = 0, hi = times?.length ?? 0;
        while (lo < hi) { const m = (lo + hi) >> 1; if (times![m] <= T) lo = m + 1; else hi = m; }
        this.next = lo;
        this.lastT = T;
        this.lastBump = -Infinity;
    }
}
