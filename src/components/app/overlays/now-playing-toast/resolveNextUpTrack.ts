import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import type { SongResult } from '../../../../types';
// src/components/app/overlays/now-playing-toast/resolveNextUpTrack.ts

type ResolveNextUpTrackParams = {
    playQueue: SongResult[];
    /**
     * 以哪一首为基准找后继：普通倒计时预览用 currentSong，混合期间用画面上那一首
     * （即将淡出的），因为 currentSong 在 arm 时就已经异步推进过去了。
     */
    song: SongResult | null;
    loopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isStageActive: boolean;
    /** 基准曲目不在队列里时是否退回队首，对齐 handleNextTrack 的下标规则 */
    fallbackToQueueHead?: boolean;
};

/**
 * 一次自然结束的切歌会推进到的那一首，推不出来就是 null。
 * 只喂「接下来播放」这类预览，所以宁可返回 null 也不猜 —— 卡片报错一首歌
 * 比不报要难看得多。
 */
export const resolveNextUpTrack = ({
    playQueue,
    song,
    loopMode,
    isFmMode,
    isStageActive,
    fallbackToQueueHead = false,
}: ResolveNextUpTrackParams): SongResult | null => {
    // 舞台播放不推进主队列，单曲循环原地重播，两种情况都没有「下一首」
    if (!song || playQueue.length === 0 || isStageActive || loopMode === 'one') {
        return null;
    }

    const songKey = getPlaybackSongKey(song);
    const currentIndex = playQueue.findIndex(item => getPlaybackSongKey(item) === songKey);
    // FM 走到队列尾部会现拉新曲目，下一首此刻还不存在
    if (isFmMode && currentIndex >= 0 && currentIndex >= playQueue.length - 2) {
        return null;
    }

    if (currentIndex < 0) {
        return fallbackToQueueHead ? playQueue[0] ?? null : null;
    }
    if (currentIndex < playQueue.length - 1) {
        return playQueue[currentIndex + 1] ?? null;
    }
    return loopMode === 'all' ? playQueue[0] ?? null : null;
};
