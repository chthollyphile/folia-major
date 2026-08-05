import { getFromCache, removeFromCache, saveToCache } from '../../../services/db';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { createShuffleOrderState, parseShuffleOrderState, type ShuffleOrderState } from './shuffleOrder';
import type { SongResult } from '../../../types';

// src/components/app/playback/playbackPositionCache.ts
// 上次播放进度与随机播放路线图的持久化，供会话恢复和播放中的节流保存共用。

export const PLAYBACK_POSITION_CACHE_KEY = 'last_playback_position';
export const SHUFFLE_ORDER_CACHE_KEY = 'last_shuffle_order';

// 开头几秒不值得恢复，结尾附近恢复会立刻触发切歌，两端都直接丢弃记录。
const MIN_RESUMABLE_POSITION_SECONDS = 3;
const END_OF_TRACK_GUARD_SECONDS = 5;

export type PlaybackPositionSnapshot = {
    songKey: string;
    position: number;
};

/**
 * 判断某个播放位置是否值得写入缓存。
 * duration 未知（流式音源、metadata 未就绪）时只做起始端保护。
 */
export const isPersistablePlaybackPosition = (position: number, duration: number | null): boolean => {
    if (!Number.isFinite(position) || position < MIN_RESUMABLE_POSITION_SECONDS) {
        return false;
    }

    if (duration === null || !Number.isFinite(duration) || duration <= 0) {
        return true;
    }

    return duration - position > END_OF_TRACK_GUARD_SECONDS;
};

/**
 * 从缓存快照解析可用的恢复位置。
 * 歌曲不匹配、数据损坏或位置不合理时返回 null，让调用方走从头播放。
 */
export const resolveResumablePosition = (
    snapshot: PlaybackPositionSnapshot | null,
    song: SongResult | null,
): number | null => {
    if (!snapshot || !song) {
        return null;
    }

    const { songKey, position } = snapshot;
    if (typeof songKey !== 'string' || typeof position !== 'number') {
        return null;
    }

    if (songKey !== getPlaybackSongKey(song)) {
        return null;
    }

    if (!Number.isFinite(position) || position < MIN_RESUMABLE_POSITION_SECONDS) {
        return null;
    }

    return position;
};

export const readPlaybackPositionSnapshot = async (): Promise<PlaybackPositionSnapshot | null> => (
    getFromCache<PlaybackPositionSnapshot>(PLAYBACK_POSITION_CACHE_KEY)
);

export const clearPlaybackPositionSnapshot = async (): Promise<void> => {
    await removeFromCache(PLAYBACK_POSITION_CACHE_KEY);
};

// 位置不值得保留时主动清除，避免下次启动从歌尾恢复。
export const persistPlaybackPosition = async (
    song: SongResult | null,
    position: number,
    duration: number | null,
): Promise<void> => {
    if (!song) {
        return;
    }

    if (!isPersistablePlaybackPosition(position, duration)) {
        await clearPlaybackPositionSnapshot();
        return;
    }

    await saveToCache(PLAYBACK_POSITION_CACHE_KEY, {
        songKey: getPlaybackSongKey(song),
        position,
    } satisfies PlaybackPositionSnapshot);
};

// 随机播放的路线图跟着会话走：重启后按原顺序接着播，而不是重新洗牌。
export const persistShuffleOrderState = async (state: ShuffleOrderState): Promise<void> => {
    if (state.order.length === 0) {
        await removeFromCache(SHUFFLE_ORDER_CACHE_KEY);
        return;
    }

    await saveToCache(SHUFFLE_ORDER_CACHE_KEY, state);
};

export const readShuffleOrderState = async (): Promise<ShuffleOrderState> => {
    try {
        return parseShuffleOrderState(await getFromCache<unknown>(SHUFFLE_ORDER_CACHE_KEY));
    } catch (error) {
        console.warn('Failed to restore shuffle order', error);
        return createShuffleOrderState();
    }
};

export const clearShuffleOrderState = async (): Promise<void> => {
    await removeFromCache(SHUFFLE_ORDER_CACHE_KEY);
};
