// src/stores/useShuffleSettingsStore.ts
import { create } from 'zustand';
import type { ShuffleStrategy } from '../utils/shuffle/algorithms';
import type { RngKind } from '../utils/shuffle/rng';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';
import {
    parseShuffleRng, parseShuffleStrategy,
    SHUFFLE_RNG_KEY, SHUFFLE_STRATEGY_KEY, SHUFFLE_TOAST_KEY,
} from '../utils/shuffle/persistence';

export const STRATEGIES: readonly ShuffleStrategy[] = ['fisher-yates', 'round', 'fewer-repeats', 'weighted'];
export const RNG_KINDS: readonly RngKind[] = ['mt19937', 'math'];

// 设置读写走 storagePrimitives（D508：渲染进程不直接读写 localStorage）；键集中定义在 utils/shuffle/persistence.ts。
// 测试或非浏览器环境可能 window 存在但没有 localStorage：读取一律容错回落默认值。
const readSetting = (read: () => string | null): string | null => {
    try { return read(); } catch { return null; }
};
export const readShuffleStrategy = (): ShuffleStrategy => parseShuffleStrategy(readSetting(() => getStoredString(SHUFFLE_STRATEGY_KEY, '')));
export const readShuffleRng = (): RngKind => parseShuffleRng(readSetting(() => getStoredString(SHUFFLE_RNG_KEY, '')));
export const readShuffleToast = (): boolean => {
    try { return getStoredBoolean(SHUFFLE_TOAST_KEY, true); } catch { return true; }
};
const writeSetting = (write: () => void): void => { try { write(); } catch { /* 无存储环境：内存态继续 */ } };
export const writeShuffleStrategy = (value: ShuffleStrategy): void => { writeSetting(() => setStoredString(SHUFFLE_STRATEGY_KEY, value)); };
export const writeShuffleRng = (value: RngKind): void => { writeSetting(() => setStoredString(SHUFFLE_RNG_KEY, value)); };
export const writeShuffleToast = (value: boolean): void => { writeSetting(() => setStoredBoolean(SHUFFLE_TOAST_KEY, value)); };

type ShuffleSettingsState = {
    shuffleStrategy: ShuffleStrategy;
    shuffleRng: RngKind;
    shuffleToast: boolean;
    handleSetShuffleStrategy: (value: ShuffleStrategy) => void;
    handleSetShuffleRng: (value: RngKind) => void;
    handleSetShuffleToast: (value: boolean) => void;
};

export const useShuffleSettingsStore = create<ShuffleSettingsState>((set) => ({
    shuffleStrategy: readShuffleStrategy(),
    shuffleRng: readShuffleRng(),
    shuffleToast: readShuffleToast(),
    handleSetShuffleStrategy: (value) => { writeShuffleStrategy(value); set({ shuffleStrategy: value }); },
    handleSetShuffleRng: (value) => { writeShuffleRng(value); set({ shuffleRng: value }); },
    handleSetShuffleToast: (value) => { writeShuffleToast(value); set({ shuffleToast: value }); },
}));
