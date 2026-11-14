import { getStoredString, setStoredString } from '../../../../stores/storagePrimitives';
import type { ShuffleRoundState } from './shuffleRound';

// src/components/app/playback/shuffle/shuffleRoundState.ts
// 「一轮不重复」记着的那一轮，存在本机（重启后接着同一轮）。只记一轮：最近一次按轮洗出来的那队歌。

export const SHUFFLE_ROUND_STATE_KEY = 'folia_shuffle_round';

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** 读记着的那一轮；没有、或存的东西认不出来时为 null。 */
export const readShuffleRoundState = (): ShuffleRoundState | null => {
    try {
        const raw = getStoredString(SHUFFLE_ROUND_STATE_KEY, '');
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { fingerprint, orderHash, played } = parsed as Record<string, unknown>;
        if (typeof fingerprint !== 'string' || typeof orderHash !== 'string' || !isStringArray(played)) return null;
        return { fingerprint, orderHash, played };
    } catch {
        return null;
    }
};

/** 写下这一轮。存不下（配额满、存储不可用）只记一行日志：一轮记不住不该让切歌或洗牌失败。 */
export const writeShuffleRoundState = (state: ShuffleRoundState): void => {
    try {
        setStoredString(SHUFFLE_ROUND_STATE_KEY, JSON.stringify(state));
    } catch (error) {
        console.warn('[ShuffleRound] Could not save the round', error);
    }
};
