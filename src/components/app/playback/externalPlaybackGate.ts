import { useMemo } from 'react';
import type { SongResult, StageLoopMode } from '../../../types';
import type { PlaybackRoute } from '../../../types/hifi';
import { omni } from '../../../services/onlineMusic/omni';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { nextQueueIndex, queueIndexOf, queueLoopMode } from '../../../utils/playbackNeighbors';

// src/components/app/playback/externalPlaybackGate.ts
// Automix blends two of the app's own <audio> decks. A track that sounds in a provider's player
// outside the app has no deck to blend into, so a blend must not be armed into it. This is the
// same "is the next track one the decks cannot sound" question the HiFi gate asks, asked of the
// `externalPlayback` capability instead of the HiFi settings.

type IsExternalSong = (song: SongResult) => boolean;

export type ExternalAutomixGateInput = {
    playbackRoute: PlaybackRoute;
    playQueue: SongResult[];
    currentSong: SongResult | null;
    loopMode: StageLoopMode;
    isFmMode: boolean;
};

/**
 * Whether the external player blocks a blend: it is sounding now, or the current song or the next
 * one (the same index rules `handleNextTrack` follows, no wrap in Personal FM) is its song.
 */
export const externalBlocksAutomix = (
    { playbackRoute, playQueue, currentSong, loopMode, isFmMode }: ExternalAutomixGateInput,
    isExternal: IsExternalSong = omni.canPlayExternally,
): boolean => {
    if (playbackRoute === 'external') return true;
    if (currentSong && isExternal(currentSong)) return true;
    const nextIndex = nextQueueIndex(playQueue.length, queueIndexOf(playQueue, currentSong), queueLoopMode(loopMode, isFmMode));
    return nextIndex >= 0 && isExternal(playQueue[nextIndex]);
};

export function useExternalAutomixGate(): boolean {
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const loopMode = useAudioSettingsStore(state => state.loopMode);
    return useMemo(
        () => externalBlocksAutomix({ playbackRoute, playQueue, currentSong, loopMode, isFmMode }),
        [currentSong, isFmMode, loopMode, playQueue, playbackRoute],
    );
}
