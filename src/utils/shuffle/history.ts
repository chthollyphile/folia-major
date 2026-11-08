import type { HistoryEntry } from './algorithms.ts';

const STEP = 180_000;     // 旧版 3 分钟间隔语义
const MAX = 300;

export interface RecordOptions {
    /**
   * false（默认，旧版语义）：已在历史里的 key 不更新时间戳、不移位。
   * true：已存在的 key 移到末尾并刷新时间戳 → 历史真正反映"最近播放"，W 窗口与 weighted 才准确。
   * 默认值以 Step 0 的 legacy-notes 与人类裁决为准。
   */
    refresh?: boolean;
}

/** 把"当前歌之前的歌 + 当前歌"记入历史（保留最近 300 条）。fisher-yates 策略不调用它（B3）。 */
export function recordHistory<T>(queue: readonly T[], currentIndex: number, keyOf: (s: T) => string,
    history: readonly HistoryEntry[], now: number, opts: RecordOptions = {}): HistoryEntry[] {
    if (currentIndex < 0 || currentIndex >= queue.length) return history.slice();
    const out = history.slice();
    const touch = (k: string, t: number) => {
        if (opts.refresh) {
            const at = out.findIndex(h => h.k === k);
            if (at >= 0) out.splice(at, 1);
            out.push({ k, t });
        } else if (!out.some(h => h.k === k)) {
            out.push({ k, t });
        }
    };
    for (let i = 0; i < currentIndex; i++) touch(keyOf(queue[i]), now - (currentIndex - i) * STEP);
    touch(keyOf(queue[currentIndex]), now);
    return out.length > MAX ? out.slice(out.length - MAX) : out;
}
