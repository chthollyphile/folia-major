import type { Dispatch, SetStateAction } from 'react';
import { buildNavidromeQueue } from '../../../services/playbackAdapters';
import { applyQueueAddBehavior } from '../../../utils/queueAddBehavior';
import type { NavidromeSong } from '../../../types/navidrome';
import type { QueueAddBehavior, SongResult, StatusMessage } from '../../../types';

// src/components/app/player-panel/createQueueMutations.ts

type CreateQueueMutationsParams = {
    currentSong: SongResult | null;
    playQueue: SongResult[];
    setPlayQueue: Dispatch<SetStateAction<SongResult[]>>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    setStatusMsg: Dispatch<SetStateAction<StatusMessage | null>>;
    t: (key: string) => string;
    queueAddBehavior: QueueAddBehavior;
};

// Creates queue mutations that are triggered from app-level panel and home surfaces.
export const createQueueMutations = ({
    currentSong,
    playQueue,
    setPlayQueue,
    persistLastPlaybackCache,
    setStatusMsg,
    t,
    queueAddBehavior,
}: CreateQueueMutationsParams) => {
    const addNavidromeSongsToQueue = (songs: NavidromeSong[]) => {
        if (songs.length === 0) {
            return;
        }

        const unifiedSongs = buildNavidromeQueue(songs);
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

    return {
        addNavidromeSongsToQueue,
    };
};
