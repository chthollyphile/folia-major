// src/utils/shuffle/persistence.ts
// 洗牌设置 / 历史 / round 的存储键与纯解析、序列化。
// 真正的 localStorage 读写放在两个 shuffle store 里（settings 与 status）：D508 要求渲染进程的存储访问只经
// storagePrimitives；D102 又要求 utils 不依赖 stores，所以算法层这边保持纯函数。
import { parseStrategy, sanitizeHistory, type HistoryEntry, type ShuffleStrategy } from './algorithms';
import { parseRngKind, type RngKind } from './rng';

export const SHUFFLE_STRATEGY_KEY = 'folia_shuffle_strategy';
export const SHUFFLE_RNG_KEY = 'folia_shuffle_rng';
export const SHUFFLE_TOAST_KEY = 'folia_shuffle_toast';
export const SHUFFLE_HISTORY_KEY = 'folia_shuffle_history';
export const SHUFFLE_ROUND_KEY = 'folia_shuffle_round';

/** 设置值 → 合法策略，非法回落默认（fisher-yates，A1 裁决）。 */
export const parseShuffleStrategy = (raw: string | null): ShuffleStrategy => parseStrategy(raw);
/** 设置值 → 合法 RngKind，非法回落 mt19937。 */
export const parseShuffleRng = (raw: string | null): RngKind => parseRngKind(raw);
/** 未设置时默认开启（A1 裁决）。 */
export const parseShuffleToast = (raw: string | null): boolean => (raw === null ? true : raw === 'true');

export interface ShuffleRoundState { fp: string; played: string[]; }

/** localStorage 原文 → 历史；损坏数据一律当空历史。 */
export const parseShuffleHistory = (raw: string | null): HistoryEntry[] => {
    if (!raw) return [];
    try { return sanitizeHistory(JSON.parse(raw)); } catch { return []; }
};
export const serializeShuffleHistory = (history: readonly HistoryEntry[]): string => JSON.stringify(history);

/** localStorage 原文 → round 状态；损坏数据一律当没有。 */
export const parseShuffleRound = (raw: string | null): ShuffleRoundState | null => {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && typeof (parsed as { fp?: unknown }).fp === 'string' && Array.isArray((parsed as { played?: unknown }).played)) {
            const { fp, played } = parsed as { fp: string; played: unknown[] };
            return { fp, played: played.filter((x): x is string => typeof x === 'string') };
        }
        return null;
    } catch { return null; }
};
/** null 表示删除该键。 */
export const serializeShuffleRound = (state: ShuffleRoundState | null): string | null => (state === null ? null : JSON.stringify(state));
