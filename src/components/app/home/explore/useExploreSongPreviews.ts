import { useMemo } from 'react';
import type { OmniExploreSection } from '../../../../types/onlineMusic';
import type { LatticeTile } from '../../lattice/latticeModel';
import { selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../../stores/usePlayingSongLocatorStore';
import { playbackSourceOf } from '../../playing-song-locator/playingSongLocator';
import { withExploreSongPreviews, withExploreTileSongPreviews, type ExplorePreviewPlayback } from './exploreSongPreviews';

// Both Explore layouts share this low-frequency view of recommendation-card playback.

const useExplorePreviewPlayback = (): ExplorePreviewPlayback => {
    const song = usePlaybackStore(selectDisplaySong);
    const queue = usePlaybackStore(state => state.playQueue);
    const acceptedFmPlayback = usePlaybackStore(state => state.acceptedFmPlayback);
    const source = usePlayingSongLocatorStore(state => state.source);
    return useMemo(() => ({
        song,
        queue,
        acceptedFmPlayback,
        playingFrom: playbackSourceOf(source, queue, song),
    }), [acceptedFmPlayback, queue, song, source]);
};

export const useExploreSongPreviews = (sections: OmniExploreSection[]): OmniExploreSection[] => {
    const playback = useExplorePreviewPlayback();
    return useMemo(() => withExploreSongPreviews(sections, playback), [playback, sections]);
};

export const useExploreTileSongPreviews = (tiles: LatticeTile[], t: (key: string) => string): LatticeTile[] => {
    const playback = useExplorePreviewPlayback();
    return useMemo(() => withExploreTileSongPreviews(tiles, playback, t), [playback, t, tiles]);
};
