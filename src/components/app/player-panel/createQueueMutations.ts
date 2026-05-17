import type { Dispatch, SetStateAction } from 'react';
import { buildNavidromeQueue } from '../../../services/playbackAdapters';
import type { NavidromeSong } from '../../../types/navidrome';
import type { SongResult, StatusMessage } from '../../../types';

// src/components/app/player-panel/createQueueMutations.ts

type CreateQueueMutationsParams = {
    currentSong: SongResult | null;
    playQueue: SongResult[];
    setPlayQueue: Dispatch<SetStateAction<SongResult[]>>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    setStatusMsg: Dispatch<SetStateAction<StatusMessage | null>>;
    t: (key: string) => string;
};

// Creates queue mutations that are triggered from app-level panel and home surfaces.
export const createQueueMutations = ({
    currentSong,
    playQueue,
    setPlayQueue,
    persistLastPlaybackCache,
    setStatusMsg,
    t,
}: CreateQueueMutationsParams) => {
    const addNavidromeSongsToQueue = (songs: NavidromeSong[]) => {
        if (songs.length === 0) {
            return;
        }

        const unifiedSongs = buildNavidromeQueue(songs);
        const existingIds = new Set(playQueue.map(song => song.id));
        const appendedSongs = unifiedSongs.filter(song => !existingIds.has(song.id));
        const nextQueue = appendedSongs.length > 0 ? [...playQueue, ...appendedSongs] : playQueue;

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);
        setStatusMsg({ type: 'success', text: t('status.queueUpdated') || '已添加到播放队列' });
    };

    return {
        addNavidromeSongsToQueue,
    };
};
