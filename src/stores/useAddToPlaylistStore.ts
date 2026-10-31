import { create } from 'zustand';
import type { SongResult } from '../types';

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
    /** The song the picker was asked for, when it is not the shown one (a scratchpad entry); null means the shown song. */
    song: SongResult | null;
    availability: AddToPlaylistAvailability;
    open: (song?: SongResult) => void;
    close: () => void;
    setAvailability: (availability: AddToPlaylistAvailability) => void;
};

export const useAddToPlaylistStore = create<AddToPlaylistState>((set) => ({
    isOpen: false,
    song: null,
    availability: UNAVAILABLE,
    open: song => set({ isOpen: true, song: song ?? null }),
    close: () => set({ isOpen: false, song: null }),
    setAvailability: (availability) => set({ availability }),
}));

export const openAddToPlaylist = () => useAddToPlaylistStore.getState().open();
/** The picker for a song other than the shown one (the scratchpad's rows). */
export const openAddSongToPlaylist = (song: SongResult) => useAddToPlaylistStore.getState().open(song);
