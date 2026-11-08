// src/stores/useShuffleStatusStore.ts
// 最近一次洗牌的观测信息（内存态，供状态面板 D-4 显示；持久化的「最近 N 次」属 P2）。
// 洗牌历史与 round 进度也在这里持久化：D508 要求渲染进程的存储访问集中在 src/stores，经 storagePrimitives。
import { create } from 'zustand';
import type { HistoryEntry, ShuffleStrategy } from '../utils/shuffle/algorithms';
import type { RngKind } from '../utils/shuffle/rng';
import { getStoredString, removeStoredKey, setStoredString } from './storagePrimitives';
import {
    parseShuffleHistory, parseShuffleRound, serializeShuffleHistory, serializeShuffleRound,
    SHUFFLE_HISTORY_KEY, SHUFFLE_RNG_KEY, SHUFFLE_ROUND_KEY, SHUFFLE_STRATEGY_KEY, SHUFFLE_TOAST_KEY,
    type ShuffleRoundState,
} from '../utils/shuffle/persistence';

export const readShuffleHistory = (): HistoryEntry[] => parseShuffleHistory(getStoredString(SHUFFLE_HISTORY_KEY, ''));
export const writeShuffleHistory = (history: readonly HistoryEntry[]): void => { setStoredString(SHUFFLE_HISTORY_KEY, serializeShuffleHistory(history)); };

export const readShuffleRound = (): ShuffleRoundState | null => parseShuffleRound(getStoredString(SHUFFLE_ROUND_KEY, ''));
export const writeShuffleRound = (state: ShuffleRoundState | null): void => {
    const raw = serializeShuffleRound(state);
    if (raw === null) removeStoredKey(SHUFFLE_ROUND_KEY);
    else setStoredString(SHUFFLE_ROUND_KEY, raw);
};

/** 删除三个设置键并清空历史 / round，用于 §11 门禁「删除设置键重启回落默认」。 */
export const clearShuffleState = (): void => {
    removeStoredKey(SHUFFLE_STRATEGY_KEY);
    removeStoredKey(SHUFFLE_RNG_KEY);
    removeStoredKey(SHUFFLE_TOAST_KEY);
    removeStoredKey(SHUFFLE_HISTORY_KEY);
    removeStoredKey(SHUFFLE_ROUND_KEY);
};

export interface LastShuffleInfo {
    strategy: ShuffleStrategy;
    rng: RngKind;
    seedHex?: string;
    stats: { fresh: number; deferred: number; recentWindow: number };
    timestamp: number;
}

type ShuffleStatusState = {
    lastShuffle: LastShuffleInfo | null;
    setLastShuffle: (info: LastShuffleInfo) => void;
};

export const useShuffleStatusStore = create<ShuffleStatusState>((set) => ({
    lastShuffle: null,
    setLastShuffle: (info) => set({ lastShuffle: info }),
}));

export const reportLastShuffle = (info: LastShuffleInfo) => {
    useShuffleStatusStore.getState().setLastShuffle(info);
};
