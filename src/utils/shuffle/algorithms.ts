import type { Rng } from './rng.ts';

export type ShuffleStrategy = 'fisher-yates' | 'round' | 'fewer-repeats' | 'weighted';
export const STRATEGIES: readonly ShuffleStrategy[] = ['fisher-yates', 'round', 'fewer-repeats', 'weighted'];
export function parseStrategy(v: unknown): ShuffleStrategy {
    return STRATEGIES.includes(v as ShuffleStrategy) ? (v as ShuffleStrategy) : 'fisher-yates';
}

export interface HistoryEntry { k: string; t: number }

export interface ShuffleInput<T> {
    queue: readonly T[];
    currentIndex: number;                    // -1 = 无当前曲目
    keyOf: (song: T) => string;
    history: readonly HistoryEntry[];        // 旧→新
    playedThisRound?: ReadonlySet<string>;   // 仅 round 使用
    rng: Rng;
    now: number;
}

export interface ShuffleOutput<T> {
    nextQueue: T[];
    stats: { fresh: number; deferred: number; recentWindow: number };
    resetRound?: boolean;
    nextPlayedThisRound?: Set<string>;       // 仅 round 返回
}

export function fisherYates<T>(items: readonly T[], rng: Rng): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = rng.nextIndex(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** 单条历史是否合法：k 是字符串且 t 是有限数。 */
function isHistoryEntry(e: unknown): e is HistoryEntry {
    if (!e || typeof e !== 'object') return false;
    const { k, t } = e as { k?: unknown; t?: unknown };
    return typeof k === 'string' && Number.isFinite(t);
}

/** 损坏历史防御：丢弃 k 非字符串 / t 非有限数的条目；同 key 重复时只保留最后一条（保持旧→新顺序） */
export function sanitizeHistory(h: unknown): HistoryEntry[] {
    if (!Array.isArray(h)) return [];
    const valid = h.filter(isHistoryEntry);
    const lastPos = new Map<string, number>();
    valid.forEach((e, i) => lastPos.set(e.k, i));
    return valid.filter((e, i) => lastPos.get(e.k) === i);
}

function excludeCurrent<T>(queue: readonly T[], currentIndex: number): T[] {
    return currentIndex >= 0 && currentIndex < queue.length
        ? queue.filter((_, i) => i !== currentIndex)   // B1：按索引排除，不按 key
        : queue.slice();
}
function pin<T>(queue: readonly T[], currentIndex: number, rest: T[]): T[] {
    return currentIndex >= 0 && currentIndex < queue.length ? [queue[currentIndex], ...rest] : rest;
}
const ZERO = { fresh: 0, deferred: 0, recentWindow: 0 };

function fisherYatesStrategy<T>(i: ShuffleInput<T>): ShuffleOutput<T> {
    return { nextQueue: pin(i.queue, i.currentIndex, fisherYates(excludeCurrent(i.queue, i.currentIndex), i.rng)), stats: { ...ZERO } };
}

function roundStrategy<T>(i: ShuffleInput<T>): ShuffleOutput<T> {
    const { queue, currentIndex, keyOf, rng } = i;
    const played = new Set(i.playedThisRound ?? []);
    const hasCur = currentIndex >= 0 && currentIndex < queue.length;
    if (hasCur) played.add(keyOf(queue[currentIndex]));
    const rest = excludeCurrent(queue, currentIndex);
    const allPlayed = queue.length > 0 && queue.every(s => played.has(keyOf(s)));
    if (allPlayed) {
    // 一轮播完：清空，仅把当前歌记为新一轮已播，其余全量重洗
        const next = new Set<string>();
        if (hasCur) next.add(keyOf(queue[currentIndex]));
        return { nextQueue: pin(queue, currentIndex, fisherYates(rest, rng)), stats: { ...ZERO }, resetRound: true, nextPlayedThisRound: next };
    }
    const unplayed = rest.filter(s => !played.has(keyOf(s)));
    const done = rest.filter(s => played.has(keyOf(s)));
    return {
        nextQueue: pin(queue, currentIndex, [...fisherYates(unplayed, rng), ...fisherYates(done, rng)]),
        stats: { fresh: unplayed.length, deferred: done.length, recentWindow: 0 },
        nextPlayedThisRound: played,
    };
}

const TAU = 30 * 60_000;     // 30 分钟：每过一个 TAU 权重 +1
const NEVER = 1e6;           // 历史里没有的歌：权重极大（几乎必排前）
export function weightedShuffle<T>(i: ShuffleInput<T>): ShuffleOutput<T> {
    const { queue, currentIndex, keyOf, rng, now } = i;
    const rest = excludeCurrent(queue, currentIndex);
    const tsMap = new Map(i.history.map(h => [h.k, h.t] as const));
    const scored = rest.map((song, idx) => {
        const t = tsMap.get(keyOf(song));
        const w = t == null ? NEVER : 1 + Math.max(0, now - t) / TAU;
        const u = Math.max(rng.nextUint32() / 4294967296, Number.EPSILON);
        // 等价于 u^(1/w) 降序，但用对数避免 w 很大（如 1e6）时的精度问题
        return { song, idx, key: Math.log(u) / w };
    });
    scored.sort((a, b) => b.key - a.key || a.idx - b.idx);
    return { nextQueue: pin(queue, currentIndex, scored.map(x => x.song)), stats: { ...ZERO } };
}

function fewerRepeats<T>(i: ShuffleInput<T>): ShuffleOutput<T> {
    const { queue, currentIndex, keyOf, history, rng } = i;
    const rest = excludeCurrent(queue, currentIndex);
    const W = Math.min(history.length, Math.max(2, queue.length - 2));
    const recent = new Set(history.slice(history.length - W).map(h => h.k));
    const fresh: T[] = [], deferred: T[] = [];
    for (const s of rest) (recent.has(keyOf(s)) ? deferred : fresh).push(s);
    const stats = { fresh: fresh.length, deferred: deferred.length, recentWindow: W };
    const shuffledFresh = fisherYates(fresh, rng);
    if (shuffledFresh.length < 2) {
    // B2：fresh 太少时 deferred 走加权随机，避免每次洗牌结果确定
        const inner = weightedShuffle({ ...i, queue: deferred, currentIndex: -1 });
        return { nextQueue: pin(queue, currentIndex, [...shuffledFresh, ...inner.nextQueue]), stats };
    }
    const tsMap = new Map(history.map(h => [h.k, h.t] as const));   // O2
    deferred.sort((a, b) => (tsMap.get(keyOf(a)) ?? 0) - (tsMap.get(keyOf(b)) ?? 0)); // 最久没听的在前
    return { nextQueue: pin(queue, currentIndex, [...shuffledFresh, ...deferred]), stats };
}

export function computeShuffledQueue<T>(strategy: ShuffleStrategy, input: ShuffleInput<T>): ShuffleOutput<T> {
    const safe = { ...input, history: sanitizeHistory(input.history) };
    switch (strategy) {
        case 'fisher-yates': return fisherYatesStrategy(safe);
        case 'round': return roundStrategy(safe);
        case 'weighted': return weightedShuffle(safe);
        case 'fewer-repeats':
        default: return fewerRepeats(safe);
    }
}
