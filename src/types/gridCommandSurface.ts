import type { LocalSongFolderSortDirection, LocalSongFolderSortField } from '../utils/localSongSorting';

// src/types/gridCommandSurface.ts
// What the command palette is allowed to ask of the track grid currently on screen.
//
// GridView keeps its filter result, its sort choice and its two panels in component-local state,
// so none of it is reachable from a store. Rather than lifting all of that out — the grid is the
// only reader of most of it — the grid publishes one handle, the same way it already publishes a
// filter box through `registerCommandFilter`.

export type GridSurfaceActionId =
    | 'play-filtered'
    | 'enqueue-filtered'
    | 'collect-filtered'
    | 'sort-file-name'
    | 'sort-modified-date'
    | 'sort-album-track'
    | 'sort-toggle-direction'
    | 'toggle-info-panel'
    | 'toggle-track-list'
    | 'resync-folder'
    | 'resync-all-folders'
    | 'organize-song-info'
    | 'export-playlist'
    | 'edit-entity'
    | 'set-cover'
    | 'toggle-edit-mode'
    | 'reload-online-collection'
    | 'toggle-subscribe';

export type GridSurfaceState = {
    /**
     * The actions this grid's current branch really supports — a local folder sorts, an online
     * playlist does not. A command's `isAvailable` asks this and nothing else, so the branch rules
     * stay written once, next to the buttons that already obey them.
     */
    availableActions: readonly GridSurfaceActionId[];
    /** How many songs `play-filtered` / `enqueue-filtered` / `collect-filtered` would act on right now. */
    filteredTrackCount: number;
    isFilterActive: boolean;
    sortField: LocalSongFolderSortField;
    sortDirection: LocalSongFolderSortDirection;
    isInfoPanelOpen: boolean;
    isTrackListOpen: boolean;
    isEditMode: boolean;
};

export type GridSurfaceHandle = {
    /**
     * Read fresh on every call, never memoised.
     *
     * The palette asks `isAvailable` each time it opens precisely because answers like these change
     * with nothing re-rendering it — a snapshot taken when the context was built would still claim
     * the folder is mid-resync long after it finished.
     */
    getState: () => GridSurfaceState;
    run: (action: GridSurfaceActionId) => void;
};
