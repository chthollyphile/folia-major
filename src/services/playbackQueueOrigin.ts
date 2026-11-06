import type { SongResult } from '../types';
import type { PersonalFmLaunch } from '../types/personalFm';
import { getOnlineProviderIdForSong, getPlaybackSongKey, isSamePlaybackSong } from '../utils/appPlaybackGuards';
import { replacePlayQueue as replacePlaybackQueue, usePlaybackStore, type AcceptedFmPlayback } from '../stores/usePlaybackStore';
import { getPersonalFmSelection, selectActiveStation, usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';
import { usePlayingSongLocatorStore } from '../stores/usePlayingSongLocatorStore';

// Accepted radio and collection origins are coordinated here so the playback store owns only its state.

export const getAcceptedFmSelection = (providerId: string): PersonalFmLaunch => {
    const station = selectActiveStation(usePersonalFmModeStore.getState(), providerId);
    return station ? { ...station.selection, station: station.id } : getPersonalFmSelection(providerId);
};

const acceptedFmPlaybackOf = (song: SongResult | null, queue: SongResult[], isFmMode: boolean, selection?: PersonalFmLaunch): AcceptedFmPlayback | null => {
    const providerId = getOnlineProviderIdForSong(song);
    if (!isFmMode || !song || !providerId || !queue.some(entry => isSamePlaybackSong(entry, song))) return null;
    return { providerId, selection: selection ?? getAcceptedFmSelection(providerId), songKeys: new Set(queue.map(getPlaybackSongKey)) };
};

/** Called after the song and its accepted queue land; a request still waiting for audio cannot claim their origin. */
export const noteAcceptedFmPlayback = (song: SongResult | null, queue: SongResult[], isFmMode: boolean, selection?: PersonalFmLaunch): void => {
    usePlaybackStore.getState().setAcceptedFmPlayback(acceptedFmPlaybackOf(song, queue, isFmMode, selection));
};

/** A whole-queue replacement updates its accepted radio origin in the same store write. */
export const replacePlayQueue = (queue: SongResult[], isFmMode: boolean): void => {
    replacePlaybackQueue(queue, isFmMode, acceptedFmPlaybackOf(usePlaybackStore.getState().currentSong, queue, isFmMode));
    // Replacing a queue supplies no collection origin, even when its songs overlap the old one.
    // An undo restores songs/FM explicitly; it cannot infer a collection from membership alone.
    usePlayingSongLocatorStore.getState().setSource(null);
};
