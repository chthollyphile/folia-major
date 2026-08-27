import { getPlaybackSongKey } from './appPlaybackGuards';
import { resolvePlaybackSongArtist, resolvePlaybackSongCoverUrl } from './playbackSongMeta';
import type { SongResult } from '../types';
// src/utils/playbackNeighbors.ts

export type PlaybackNeighbor = {
    /** 该方向是否可以跳转 */
    canGo: boolean;
    /** 目标曲目标识；与快照里的 trackKey 同一套规则，便于遥控窗口把预读的面和切歌后的面认成同一个 */
    key: string | null;
    /** 目标曲目标题；可跳但目标未知时为 null */
    title: string | null;
    /** 目标曲目艺术家；用于遥控窗口提前渲染下一首 */
    artist: string | null;
    /** 目标曲目封面；用于遥控窗口提前预热图片与取色 */
    coverUrl: string | null;
};

export type PlaybackNeighbors = {
    prev: PlaybackNeighbor;
    next: PlaybackNeighbor;
};

const UNKNOWN_NEIGHBOR: PlaybackNeighbor = { canGo: true, key: null, title: null, artist: null, coverUrl: null };
const BLOCKED_NEIGHBOR: PlaybackNeighbor = { canGo: false, key: null, title: null, artist: null, coverUrl: null };

const BLOCKED: PlaybackNeighbors = {
    prev: BLOCKED_NEIGHBOR,
    next: BLOCKED_NEIGHBOR,
};

type ResolvePlaybackNeighborsParams = {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    loopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isStageActive: boolean;
};

/**
 * 按 usePlaybackQueueController 中 handlePrevTrack / handleNextTrack 的同一套下标规则，
 * 推导上一首/下一首能否跳转，以及目标曲目的标题、艺术家与封面。
 * FM 模式停在队列最后一首时，跳转会现拉新曲目，此时 canGo 为 true 但目标信息未知。
 */
export const resolvePlaybackNeighbors = ({
    playQueue,
    currentSong,
    loopMode,
    isFmMode,
    isStageActive,
}: ResolvePlaybackNeighborsParams): PlaybackNeighbors => {
    // 舞台播放时两个 handler 都会直接 return，这里必须同步禁用，否则箭头点了没反应
    if (isStageActive || !currentSong || playQueue.length === 0) {
        return BLOCKED;
    }

    const currentKey = getPlaybackSongKey(currentSong);
    const currentIndex = playQueue.findIndex(song => getPlaybackSongKey(song) === currentKey);
    const lastIndex = playQueue.length - 1;

    const neighborAt = (index: number): PlaybackNeighbor => {
        const song = playQueue[index] ?? null;
        return {
            canGo: true,
            key: song ? getPlaybackSongKey(song) : null,
            title: song?.name ?? null,
            artist: resolvePlaybackSongArtist(song),
            coverUrl: resolvePlaybackSongCoverUrl(song),
        };
    };

    let prevIndex = -1;
    if (currentIndex > 0) {
        prevIndex = currentIndex - 1;
    } else if (loopMode === 'all') {
        prevIndex = lastIndex;
    }

    let nextIndex = -1;
    if (currentIndex >= 0 && currentIndex < lastIndex) {
        nextIndex = currentIndex + 1;
    } else if (currentIndex < 0) {
        nextIndex = 0;
    } else if (loopMode === 'all') {
        nextIndex = 0;
    }

    // FM 走到队列末尾时会追加新曲目再跳，标题此刻无法预知
    const fmWillFetch = isFmMode && currentIndex === lastIndex;

    return {
        prev: prevIndex >= 0 ? neighborAt(prevIndex) : BLOCKED_NEIGHBOR,
        next: fmWillFetch
            ? UNKNOWN_NEIGHBOR
            : nextIndex >= 0
                ? neighborAt(nextIndex)
                : BLOCKED_NEIGHBOR,
    };
};
