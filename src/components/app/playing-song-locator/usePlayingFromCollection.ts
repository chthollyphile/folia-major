import { useMemo } from 'react';
import type { GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import { playbackSourceOf } from './playingSongLocator';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';

// src/components/app/playing-song-locator/usePlayingFromCollection.ts

/** The collection the queue is of (`playbackSourceOf`), followed as the queue and the song change. */
export const usePlayingFromCollection = (): GridViewCollectionDescriptor | null => {
    const source = usePlayingSongLocatorStore(state => state.source);
    const queue = usePlaybackStore(state => state.playQueue);
    const song = usePlaybackStore(state => state.currentSong);
    return useMemo(() => playbackSourceOf(source, queue, song), [source, queue, song]);
};
