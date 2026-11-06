import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { CollectionResource, CollectionResourceSnapshot } from '@/library/core/shared/resource.contract';
import type { CollectionView } from '@/library/core/collection/useCollectionView';
import { useCollectionActions } from '@/library/core/collection/mutations/useCollectionActions';

// 动作层不依赖按钮禁用：未完成的全库禁止批量操作，单曲仍可播，未支持条目从队列排除并报数。
vi.mock('react', () => ({ useMemo: (build: () => unknown) => build(), useRef: (current: unknown) => ({ current }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values: { count: number }) => `${key}:${values.count}` }) }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ canPlaySongInCurrentRoute: (track: SongResult) => track.id !== 'unsupported' }));

const song = (id: string): SongResult => ({ id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 1000 });
const playable = song('playable');
const unsupported = song('unsupported');
const view: CollectionView = {
    displayTracks: [playable, unsupported], playableTracks: [playable], contextTracks: [playable],
    matchIndexes: null, isFilterActive: false, occurrences: new Map(), entryKeyAt: () => null, findEntryIndex: () => -1,
};
const setup = (complete: boolean) => {
    const snapshot: CollectionResourceSnapshot = {
        key: 'library', kind: 'online', revision: '', status: 'ready', tracks: view.displayTracks,
        error: null, sync: complete ? { status: 'none' } : { status: 'syncing' }, detail: null, hint: 'urgent', generation: 1,
        librarySongs: { complete, loadedCount: 2, refreshing: false },
    };
    const port = { playTrack: vi.fn(), enqueueTrack: vi.fn(), playAll: vi.fn(), enqueueAll: vi.fn(), statusMessage: vi.fn() };
    let liveSnapshot = snapshot;
    const resource: CollectionResource = {
        key: snapshot.key, kind: 'online', getSnapshot: () => liveSnapshot,
        subscribe: () => () => undefined, ensure: vi.fn(), pause: vi.fn(), dispose: vi.fn(),
        resumeSync: vi.fn(), canReuse: () => true, removeTracks: async () => undefined,
        removeAt: () => false, replaceTrackAt: () => false, replaceAll: async () => false,
        reload: () => {
            liveSnapshot = {
                ...snapshot, sync: { status: 'syncing' },
                librarySongs: { complete: false, loadedCount: 0, refreshing: true },
            };
        },
    };
    const actions = useCollectionActions({ resource, snapshot, view, port, collectionType: 'library_songs' });
    return { actions, port };
};

describe('library songs playback actions', () => {
    it('blocks partial-library scope calls even when called directly', () => {
        const { actions, port } = setup(false);
        expect(actions.capabilities.scope.enabled).toBe(false);
        actions.playScope();
        actions.enqueueScope();
        expect(port.playAll).not.toHaveBeenCalled();
        expect(port.enqueueAll).not.toHaveBeenCalled();
        actions.playTrack(playable);
        expect(port.playTrack).toHaveBeenCalledWith(playable, [playable]);
    });

    it('marks reload pending while background library pages are still arriving', () => {
        const { actions } = setup(false);
        expect(actions.capabilities.reload).toMatchObject({ supported: true, enabled: false, pending: true });
    });

    it('rejects a stale bulk callback immediately when refresh starts before rerender', () => {
        const { actions, port } = setup(true);
        expect(actions.capabilities.scope.enabled).toBe(true);
        actions.reload();
        actions.playScope();
        actions.enqueueScope();
        expect(port.playAll).not.toHaveBeenCalled();
        expect(port.enqueueAll).not.toHaveBeenCalled();
    });

    it('blocks unsupported singles while retaining them in the displayed view', () => {
        const { actions, port } = setup(true);
        actions.playTrack(unsupported);
        actions.playTrackInFullList(unsupported);
        actions.enqueueTrack(unsupported);
        expect(port.playTrack).not.toHaveBeenCalled();
        expect(port.enqueueTrack).not.toHaveBeenCalled();
        expect(view.displayTracks).toContain(unsupported);
    });

    it('uses only supported tracks after completion and reports the skipped count', () => {
        const { actions, port } = setup(true);
        expect(actions.capabilities.scope.enabled).toBe(true);
        actions.playScope();
        actions.enqueueScope();
        expect(port.playAll).toHaveBeenCalledWith([playable]);
        expect(port.enqueueAll).toHaveBeenCalledWith([playable]);
        expect(port.statusMessage).toHaveBeenCalledWith({ type: 'info', text: 'librarySongs.skipped:1' });
    });
});
