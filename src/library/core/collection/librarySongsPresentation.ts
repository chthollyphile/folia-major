import type { CollectionLoadStatus, CollectionSyncState } from '../shared/resource.contract';

// Shared all-songs status semantics; suites keep their own layout and retry controls.

export type LibrarySongsProgress = {
    complete: boolean;
    loadedCount: number;
    refreshing: boolean;
};

export const projectLibrarySongsPresentation = (
    progress: LibrarySongsProgress | undefined,
    status: CollectionLoadStatus | null,
    syncStatus: CollectionSyncState['status'],
) => {
    if (!progress) return null;
    const retry = syncStatus === 'interrupted';
    const active = status === 'idle' || status === 'loading' || syncStatus === 'syncing';
    const key = progress.refreshing
        ? retry || status === 'error' ? 'refreshFailed' : 'refreshing'
        : progress.complete ? 'loaded' : active ? 'loading' : 'incomplete';
    return { key, count: progress.loadedCount, retry, filterPartial: !progress.complete };
};

export type LibrarySongsPresentation = NonNullable<ReturnType<typeof projectLibrarySongsPresentation>>;
