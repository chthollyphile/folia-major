import { create } from 'zustand';
import type { SongResult } from '../types';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { readStoredString, setStoredString } from './storagePrimitives';

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

/** Where a request for the picker came from, when that changes what it says afterwards. */
export type AddToPlaylistOrigin = 'scratchpad';

const UNAVAILABLE: AddToPlaylistAvailability = { isApplicable: false, canAdd: false };

type AddToPlaylistState = {
    isOpen: boolean;
    /** The songs the picker was asked for, when they are not the shown one (a scratchpad row, group or whole
     *  notebook, of any mix of sources); null means the shown song. */
    songs: SongResult[] | null;
    /** Who asked: the scratchpad's requests get a "clear the scratchpad" button on the result toast. */
    origin: AddToPlaylistOrigin | null;
    availability: AddToPlaylistAvailability;
    open: (songs?: SongResult[], origin?: AddToPlaylistOrigin) => void;
    close: () => void;
    setAvailability: (availability: AddToPlaylistAvailability) => void;
};

export const useAddToPlaylistStore = create<AddToPlaylistState>((set) => ({
    isOpen: false,
    songs: null,
    origin: null,
    availability: UNAVAILABLE,
    open: (songs, origin) => set({ isOpen: true, songs: songs?.length ? songs : null, origin: songs?.length ? origin ?? null : null }),
    close: () => set({ isOpen: false, songs: null, origin: null }),
    setAvailability: (availability) => set({ availability }),
}));

export const openAddToPlaylist = () => useAddToPlaylistStore.getState().open();
/** The picker for songs other than the shown one (the scratchpad's rows, groups and whole notebook, a card on the library wall); they may be of several sources. */
export const openAddSongsToPlaylist = (songs: SongResult[], origin?: AddToPlaylistOrigin) => useAddToPlaylistStore.getState().open(songs, origin);

/**
 * Whether the picker has anywhere to put this song. Its Folia pane takes a song of any source (a playlist can be made
 * on the spot), so every song that comes from a source can go: only a stage song, which belongs to no source, cannot.
 */
export const canOpenPlaylistPickerFor = (song: SongResult): boolean => {
    const source = getPlaybackSourceRef(song);
    return source.kind === 'local' || source.kind === 'navidrome' || source.kind === 'online';
};

// ---- What the picker remembers between two openings ----
// Two things (spec §7, §10): which pane was used last, and which Folia playlist was picked last. Plain strings in
// localStorage; a value that no longer makes sense (an unknown pane, a deleted playlist) is simply not used.

/** The picker's two panes: Folia's own playlists, and the playlists of the source the songs come from. */
export type AddToPlaylistPane = 'folia' | 'source';

const LAST_PANE_KEY = 'add_to_playlist_last_pane';
const LAST_FOLIA_PLAYLIST_KEY = 'add_to_playlist_last_folia_playlist';

export const readLastAddToPlaylistPane = (): AddToPlaylistPane => (readStoredString(LAST_PANE_KEY) === 'source' ? 'source' : 'folia');
export const rememberAddToPlaylistPane = (pane: AddToPlaylistPane) => {
    try {
        setStoredString(LAST_PANE_KEY, pane);
    } catch { /* remembering is a convenience: a full or closed storage does not fail the add */ }
};
export const readLastFoliaPlaylistId = (): string | null => readStoredString(LAST_FOLIA_PLAYLIST_KEY) || null;
export const rememberLastFoliaPlaylistId = (playlistId: string) => {
    try {
        setStoredString(LAST_FOLIA_PLAYLIST_KEY, playlistId);
    } catch { /* as above */ }
};
