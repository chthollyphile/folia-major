import { create } from 'zustand';
import type { SongResult } from '../types';
import { omni } from '../services/onlineMusic/omni';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';

// src/stores/useAddToPlaylistStore.ts
// The "add the current song to a playlist" dialog: whether it is up, and whether it could do
// anything if it were.
//
// The dialog used to be a local useState inside UnifiedPanel, next to the star button that opened
// it, which meant it only existed while the player panel was mounted. It is a decision about the
// current song, not about the panel, so a command should be able to reach it from anywhere — and
// that requires the open state to outlive the panel.
//
// `availability` is published by the host rather than derived per caller: answering it needs the
// Navidrome playlist list, which is fetched, and two consumers each fetching it would be worse
// than one owner saying what it found.

export type AddToPlaylistAvailability = {
    /** The current song is the sort of song that can go in a playlist at all. */
    isApplicable: boolean;
    /** There is somewhere to put it, and this provider allows it. */
    canAdd: boolean;
    /** Why not, when `canAdd` is false and the answer is worth stating. */
    disabledReason?: string;
};

const UNAVAILABLE: AddToPlaylistAvailability = { isApplicable: false, canAdd: false };

type AddToPlaylistState = {
    isOpen: boolean;
    /** The songs the picker was asked for, when they are not the shown one (a scratchpad row or group,
     *  all of one source); null means the shown song. */
    songs: SongResult[] | null;
    availability: AddToPlaylistAvailability;
    open: (songs?: SongResult[]) => void;
    close: () => void;
    setAvailability: (availability: AddToPlaylistAvailability) => void;
};

export const useAddToPlaylistStore = create<AddToPlaylistState>((set) => ({
    isOpen: false,
    songs: null,
    availability: UNAVAILABLE,
    open: songs => set({ isOpen: true, songs: songs?.length ? songs : null }),
    close: () => set({ isOpen: false, songs: null }),
    setAvailability: (availability) => set({ availability }),
}));

export const openAddToPlaylist = () => useAddToPlaylistStore.getState().open();
/** The picker for songs other than the shown one (the scratchpad's rows and groups, a card on the library wall), all of one source. */
export const openAddSongsToPlaylist = (songs: SongResult[]) => useAddToPlaylistStore.getState().open(songs);

/**
 * Whether a song's source can take it anywhere the picker offers: local and Navidrome songs always (a playlist can
 * be made on the spot), an online song when its platform edits playlists or takes likes ("Liked songs" is a row of
 * its own). The picker still checks that there is something to pick once it is up.
 */
export const canOpenPlaylistPickerFor = (song: SongResult): boolean => {
    const source = getPlaybackSourceRef(song);
    if (source.kind === 'local' || source.kind === 'navidrome') return true;
    return source.kind === 'online' && (omni.canAddSongToPlaylist(song) || omni.canLikeSong(song));
};
