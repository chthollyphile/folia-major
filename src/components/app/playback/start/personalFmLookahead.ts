import { omni } from '../../../../services/onlineMusic/omni';
import { wholeQueueWritesSoFar } from '../../../../services/wholeQueueWrites';
import { getPersonalFmSelection, getStationRequestOptions } from '../../../../stores/usePersonalFmModeStore';
import { setPlayQueue, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import type { SongResult } from '../../../../types';
import { getOnlineProviderIdForSong, getPlaybackSongKey, isSamePlaybackSong } from '../../../../utils/appPlaybackGuards';
import { freshFmSongs } from '../../../../utils/fmQueue';
import { fmNeedsTopUpAt, queueIndexOf } from '../../../../utils/playbackNeighbors';
import { personalFmEndingsSoFar } from '../personalFmEndings';
import { queueStartsSoFar } from './queueStarts';

// src/components/app/playback/start/personalFmLookahead.ts
// 私人 FM 的提前续歌：正在播放的歌一落到队列最后两首（fmNeedsTopUpAt），就向电台要一批接在后面，不等「下一首」。
// 「下一首」自己也会在那里续歌（usePlaybackQueueController 的 handleNextTrack），但直接点一首后面的歌
// （电台墙上点卡）跳到队尾附近时不经过它，之前要等下一次切歌才拉，右边接下来的歌就一直空着。

/** 这一刻该不该为正在播放的歌提前续歌：私人 FM 里、它在队列里、并且落在最后两首。 */
export const fmLookaheadWanted = (isFmMode: boolean, queue: readonly SongResult[], currentSong: SongResult | null): boolean => {
    if (!isFmMode || !currentSong) return false;
    const index = queueIndexOf(queue as SongResult[], currentSong);
    return index >= 0 && fmNeedsTopUpAt(queue.length, index);
};

/**
 * 为 fromSong 向电台要一批，把队列里还没有的接到队列后面；返回接上的首数。等这一批的时候有别的事发生了就丢掉它：
 * 私人 FM 关了或从外面结束了、开始了别的队列、整个队列被换掉、换了模式或电台、正在播放的已经不是 fromSong。
 * 只接歌，不切歌。
 */
export const topUpPersonalFm = async (fromSong: SongResult): Promise<number> => {
    const providerId = getOnlineProviderIdForSong(fromSong) ?? undefined;
    const selection = getPersonalFmSelection(providerId);
    const station = providerId ? getStationRequestOptions(providerId) : undefined;
    const writesAtStart = wholeQueueWritesSoFar();
    const startsAtStart = queueStartsSoFar();
    const endingsAtStart = personalFmEndingsSoFar();
    const songKey = getPlaybackSongKey(fromSong);

    let batch: SongResult[];
    try {
        batch = await omni.getPersonalFm(station);
    } catch (error) {
        console.warn('[FmLookahead] fetch failed, the next track tops up instead', error);
        return 0;
    }

    const live = usePlaybackStore.getState();
    const selectedNow = getPersonalFmSelection(providerId);
    const stationNow = providerId ? getStationRequestOptions(providerId) : undefined;
    if (!live.isFmMode
        || wholeQueueWritesSoFar() !== writesAtStart
        || queueStartsSoFar() !== startsAtStart
        || personalFmEndingsSoFar() !== endingsAtStart
        || !live.currentSong || !isSamePlaybackSong(live.currentSong, fromSong)
        || selection.mode !== selectedNow.mode || selection.scene !== selectedNow.scene
        || station?.station !== stationNow?.station || station?.mode !== stationNow?.mode || station?.submode !== stationNow?.submode) {
        console.info('[FmLookahead] batch dropped: the radio or the queue changed while it came', { songKey });
        return 0;
    }

    // 接在队列现在的样子后面（等的时候可能已经有人续过一批了，freshFmSongs 去掉重复的）。
    const fresh = freshFmSongs(live.playQueue, batch);
    if (fresh.length > 0) setPlayQueue([...live.playQueue, ...fresh]);
    console.info('[FmLookahead] topped up', { songKey, fetched: batch.length, appended: fresh.length });
    return fresh.length;
};
