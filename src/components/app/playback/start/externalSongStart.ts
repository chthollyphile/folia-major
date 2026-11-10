import type { SongResult } from '../../../../types';
import type { PlaybackNavigationOptions } from '../../../../types/appPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { isExternalRoute } from '../../../../services/onlineMusic/externalPlayback';
import { currentTime } from '../../../../stores/motionSignals';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';

// src/components/app/playback/start/externalSongStart.ts
// Starting a song that sounds in a provider's own player, for the two places that need it outside
// the main play path: the transport's play button (a restored song has no player loaded yet) and
// a seek on that same song. The position shown on screen is where it starts; a song left at its
// end starts over, as a replay does.

type PlaySong = (
    song: SongResult,
    queue: SongResult[],
    isFm: boolean,
    options?: PlaybackNavigationOptions,
) => Promise<void>;

export const startExternalSong = (playSong: PlaySong): void => {
    const state = usePlaybackStore.getState();
    if (!state.currentSong) return;
    const shown = currentTime.get();
    const startAtSec = shown > 0 && state.duration > 0 && shown < state.duration - 0.25 ? shown : 0;
    void playSong(state.currentSong, state.playQueue, state.isFmMode, { shouldNavigateToPlayer: false, startAtSec });
};

/** A seek on an external song whose player has nothing loaded yet starts it there. True when it did. */
export const seekExternalSongIfNotLoaded = (timeSec: number, playSong: PlaySong): boolean => {
    const state = usePlaybackStore.getState();
    if (!state.currentSong || isExternalRoute() || !omni.canPlayExternally(state.currentSong)) return false;
    void playSong(state.currentSong, state.playQueue, state.isFmMode, {
        shouldNavigateToPlayer: false,
        startAtSec: Math.max(0, timeSec),
    });
    return true;
};
