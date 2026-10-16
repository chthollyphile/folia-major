import { hasExternalPlayback, routeExternalPlayback } from '../../../services/externalPlaybackSession';
import type { Dispatch, SetStateAction } from 'react';
import { buildNavidromeQueue } from '../../../services/playbackAdapters';
import { applyQueueAddBehavior } from '../../../utils/queueAddBehavior';
import type { NavidromeSong } from '../../../types/navidrome';
import type { QueueAddBehavior, SongResult, StatusMessage } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { applyQueueBatchOperation as transformQueueBatch } from '../../../utils/queueBatchOperations';
import { moveQueueItem, moveQueueItemToNext } from '../../../utils/queueReorder';
import { refreshPrefetchAfterQueueEdit } from '../../../services/prefetchService';
import type { AudioQualityPreference, MediaId } from '../../../types/onlineMusic';
import type { QueueBatchAction } from '../../command-palette/queueQuery';
import { setStatusMessage as setStatusMsg } from '../../../stores/useStatusMessageStore';
import { setPlayQueue } from '../../../stores/usePlaybackStore';

// src/components/app/player-panel/createQueueMutations.ts

type CreateQueueMutationsParams = {
    currentSong: SongResult | null;
    playQueue: SongResult[];
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    t: (key: string) => string;
    queueAddBehavior: QueueAddBehavior;
    /** 就地编辑后重新预取用（与切歌预取同一份音质与账号）。 */
    audioQuality: AudioQualityPreference;
    userId?: MediaId | null;
};

// Creates queue mutations that are triggered from app-level panel and home surfaces.
export const createQueueMutations = ({
    currentSong,
    playQueue,
    persistLastPlaybackCache,
    t,
    queueAddBehavior,
    audioQuality,
    userId,
}: CreateQueueMutationsParams) => {
    const addNavidromeSongsToQueue = (songs: NavidromeSong[]) => {
        if (songs.length === 0) {
            return;
        }

        const unifiedSongs = buildNavidromeQueue(songs);
        if (routeExternalPlayback({ type: 'enqueue', songs: unifiedSongs })) return;
        const baseQueue = playQueue.length > 0 ? playQueue : (currentSong ? [currentSong] : []);
        const { nextQueue, affectedSongs, changed } = applyQueueAddBehavior({
            queue: baseQueue,
            songs: unifiedSongs,
            currentSong,
            behavior: queueAddBehavior,
        });

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);

        if (changed && affectedSongs.length > 0) {
            setStatusMsg({
                type: 'success',
                text: queueAddBehavior === 'next' ? t('status.insertedToNext') : t('status.queueUpdated'),
                nonce: Date.now(),
                durationMs: 1200,
            });
        }
    };

    // 所有就地编辑（播放页队列页、命令面板、墙面工具的队列浮岛）都经这里：写 store、持久化，正在播放那首前后的
    // 预取窗口变了就重新预取（prefetchService.refreshPrefetchAfterQueueEdit；编辑前的队列就是这一份 playQueue）。
    const updateQueueOrder = (nextQueue: SongResult[]) => {
        if (hasExternalPlayback()) { setStatusMsg({ type: 'info', text: t('status.externalPlaybackActive') }); return; }
        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);
        refreshPrefetchAfterQueueEdit(currentSong, playQueue, nextQueue, audioQuality, userId);
    };

    const removeQueueSong = (index: number) => {
        updateQueueOrder(playQueue.filter((_, songIndex) => songIndex !== index));
    };

    const moveQueueSongToEnd = (index: number) => {
        if (index < 0 || index >= playQueue.length - 1) return;
        const nextQueue = [...playQueue];
        const [song] = nextQueue.splice(index, 1);
        nextQueue.push(song);
        updateQueueOrder(nextQueue);
    };

    const moveQueueSongToNext = (index: number) => {
        const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        const currentIndex = currentSongKey
            ? playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey)
            : -1;
        const nextQueue = moveQueueItemToNext(playQueue, index, currentIndex);
        if (nextQueue === playQueue) return;
        updateQueueOrder(nextQueue);
    };

    // 把 from 的那首移到 to（拖拽排序）；没变或越界时什么都不做。
    const moveQueueSong = (from: number, to: number) => {
        const nextQueue = moveQueueItem(playQueue, from, to);
        if (nextQueue === playQueue) return;
        updateQueueOrder(nextQueue);
    };

    const applyQueueBatchOperation = (action: QueueBatchAction, targetIndices: number[]) => {
        if (hasExternalPlayback()) { setStatusMsg({ type: 'info', text: t('status.externalPlaybackActive') }); return false; }
        const result = transformQueueBatch({
            queue: playQueue,
            targetIndices,
            currentSong,
            action,
        });
        if (result.affectedCount === 0) {
            return false;
        }

        if (result.changed) {
            updateQueueOrder(result.nextQueue);
        }
        const statusKey = action === 'remove'
            ? 'status.queueBatchRemoved'
            : action === 'next'
                ? 'status.queueBatchMovedNext'
                : 'status.queueBatchMovedEnd';
        setStatusMsg({
            type: 'success',
            text: t(statusKey).replace('{{count}}', String(result.affectedCount)),
            nonce: Date.now(),
            durationMs: 1600,
        });
        return true;
    };

    return {
        addNavidromeSongsToQueue,
        applyQueueBatchOperation,
        removeQueueSong,
        moveQueueSongToEnd,
        moveQueueSongToNext,
        moveQueueSong,
    };
};
