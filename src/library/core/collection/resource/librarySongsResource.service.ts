import type { SongResult } from '../../../../types';
import type { CollectionResource } from '../../shared/resource.contract';
import type { OnlineGridViewCollectionDescriptor } from '../collection.contract';
import type { OnlineCollectionResourceDeps } from './onlineCollectionResource.service';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { errorMessage } from '../../../../utils/errorText';
import { collectionKey, collectionRevision } from '../collectionIdentity';
import { createCollectionResourceState } from './collectionResourceState.service';
import { canAccessCollectionResource } from './collectionResourceScope.service';

// Account-scoped, memory-only library pagination; refresh stages a replacement without hiding the old list.
export const createLibrarySongsResource = (
    key: string,
    deps: Pick<OnlineCollectionResourceDeps, 'getCollectionTracks'>,
): CollectionResource => {
    const state = createCollectionResourceState(key, 'online', {
        librarySongs: { complete: false, loadedCount: 0, refreshing: false },
    });
    let descriptor: OnlineGridViewCollectionDescriptor | null = null;
    let userId: string | null = null;
    let disposed = false;
    let loading = false;
    let generation = 0;
    let offset = 0;
    let refreshing = false;
    let staged: SongResult[] = [];
    const seen = new Set<string>();

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        generation += 1;
        loading = false;
        descriptor = null;
        userId = null;
        staged = [];
        seen.clear();
        state.set({
            tracks: [], status: 'idle', error: null, sync: { status: 'none' }, generation,
            librarySongs: { complete: false, loadedCount: 0, refreshing: false },
        }, 'urgent');
        state.clear();
    };

    // Every awaited page belongs to this generation. Only validated pages enter staged/visible memory.
    const readPages = async () => {
        const collection = descriptor;
        if (!collection || disposed || loading) return;
        loading = true;
        const currentGeneration = generation;
        const isStale = () => disposed || generation !== currentGeneration;
        state.set({
            status: state.get().tracks.length > 0 ? 'ready' : 'loading',
            error: null, sync: { status: 'syncing' },
        }, 'urgent');
        try {
            while (!isStale()) {
                const page = await deps.getCollectionTracks(collection, { limit: offset === 0 ? 100 : 500, offset });
                if (isStale()) return;
                if (page.hasMore && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)) {
                    throw new Error(`Library songs pagination did not advance beyond offset ${offset}`);
                }
                const appended: SongResult[] = [];
                for (const track of page.items) {
                    const identity = getPlaybackSongKey(track);
                    if (seen.has(identity)) continue;
                    seen.add(identity);
                    appended.push(track);
                }
                staged = [...staged, ...appended];
                const complete = !page.hasMore;
                state.set({
                    ...(!refreshing || complete ? { tracks: staged } : {}),
                    status: 'ready', error: null,
                    sync: { status: complete ? 'none' : 'syncing' },
                    librarySongs: { complete, loadedCount: staged.length, refreshing: refreshing && !complete },
                }, offset === 0 || complete ? 'urgent' : 'background');
                if (complete) {
                    refreshing = false;
                    return;
                }
                offset = page.nextOffset;
            }
        } catch (cause) {
            if (isStale()) return;
            const message = errorMessage(cause);
            console.warn('[LibrarySongs] Library page read interrupted:', cause);
            state.set({
                status: 'error', error: { kind: 'generic', message, cause },
                sync: { status: 'interrupted', message, offset, cause },
                librarySongs: { complete: false, loadedCount: staged.length, refreshing },
            }, 'urgent');
        } finally {
            if (!isStale()) loading = false;
        }
    };

    const start = (refresh: boolean) => {
        if (disposed || loading || !descriptor) return;
        generation += 1;
        offset = 0;
        refreshing = refresh;
        staged = [];
        seen.clear();
        state.set({
            generation, revision: collectionRevision(descriptor),
            librarySongs: { complete: false, loadedCount: 0, refreshing },
        }, 'urgent');
        void readPages();
    };

    return {
        key, kind: 'online', getSnapshot: state.get, subscribe: state.subscribe,
        ensure: (next, context) => {
            if (disposed) return;
            const nextUserId = context.currentUserId == null ? null : String(context.currentUserId);
            if (next.source !== 'online' || next.type !== 'library_songs'
                || !canAccessCollectionResource(next, context)
                || (descriptor && (collectionKey(descriptor) !== collectionKey(next) || userId !== nextUserId))) {
                dispose();
                return;
            }
            if (descriptor) return;
            descriptor = next;
            userId = nextUserId;
            start(false);
        },
        reload: () => start(true),
        resumeSync: () => {
            if (state.get().sync.status === 'interrupted') void readPages();
        },
        canReuse: next => !disposed && descriptor !== null && collectionKey(descriptor) === collectionKey(next),
        // Losing the last view subscriber never stops or evicts this session's library read.
        pause: () => {},
        dispose,
        removeTracks: async () => {},
        removeAt: () => false,
        replaceTrackAt: () => false,
        replaceAll: async () => false,
    };
};
