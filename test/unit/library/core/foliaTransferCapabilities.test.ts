import { describe, expect, it, vi } from 'vitest';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import type { LibraryMutationPort } from '@/library/core/shared/ports.contract';
import { isCloudDriveCollection } from '@/library/core/collection/collectionIdentity';
import {
    resolveCollectionMutationBranches,
    resolveCollectionMutationCapabilities,
    type CollectionMutationCapabilityState,
} from '@/library/core/collection/mutations/collectionMutationCapabilities';
import { buildCoreSurfaceParams, buildGridSurfaceState } from '@/library/core/collection/collectionSurface';
import { LIBRARY_ACTION_MUTATION_CAPABILITY } from '@/library/core/suite/librarySuites';

// test/unit/library/core/foliaTransferCapabilities.test.ts
// Folia 聚合歌单的两个集合动作在哪些集合上出现：
// - 「存成 Folia 歌单」：在线音源的歌单与专辑、Navidrome 的歌单与专辑；云盘、每日推荐、电台、本地集合都没有；
// - 「从原歌单更新」：转存来的 Folia 歌单（宿主说它记着出处）才有。
// 两个都要宿主给了对应的端口才算支持。

const IDLE: CollectionMutationCapabilityState = {
    hasResource: true,
    pendingRemovalCount: 0,
    subscribing: false,
    sourceActionPending: false,
    dailyLimitReached: false,
    dailyDatePending: false,
};

const portWith = (origins: readonly string[] = []): LibraryMutationPort => ({
    folia: {
        saveCollection: vi.fn(),
        refreshFromOrigin: vi.fn(),
        hasOrigin: playlistId => origins.includes(playlistId),
    },
});

const capabilitiesOf = (descriptor: LibraryCollectionDescriptor, port: LibraryMutationPort, state = IDLE) => {
    const branches = resolveCollectionMutationBranches({
        descriptor,
        resourceKind: descriptor.source === 'online' ? 'online' : descriptor.source === 'navidrome' ? 'navidrome' : 'static',
        currentUserId: null,
        canEditCollectionTracks: false,
        canSubscribeCollection: true,
        canDislikeCollectionSongs: false,
        isCloudDrive: isCloudDriveCollection(descriptor),
        dailyDate: '',
        port,
    });
    return resolveCollectionMutationCapabilities({ descriptor, branches, port, state });
};

const online = (type: string, extra: object = {}): LibraryCollectionDescriptor => (
    { source: 'online', providerId: 'alpha', type, id: 'c1', name: 'Collection', ...extra } as LibraryCollectionDescriptor
);
const navidrome = (type: string): LibraryCollectionDescriptor => (
    { source: 'navidrome', type, id: 'n1', name: 'Navidrome collection' } as LibraryCollectionDescriptor
);
const foliaPlaylist = (playlistId: string, isVirtual = false): LibraryCollectionDescriptor => (
    { source: 'local', type: 'playlist', id: `playlist-${playlistId}`, name: 'Folia playlist', songIds: [], playlistId, isVirtual }
);

describe('save as a Folia playlist', () => {
    it('is offered on platform playlists and albums, of an online source or of Navidrome', () => {
        const port = portWith();
        for (const descriptor of [online('playlist'), online('album'), navidrome('playlist'), navidrome('album')]) {
            expect(capabilitiesOf(descriptor, port).saveToFolia).toMatchObject({ supported: true, enabled: true });
            expect(capabilitiesOf(descriptor, port).refreshFromOrigin.supported).toBe(false);
        }
    });

    it('is not offered on lists that are nobody\'s playlist, nor on local collections', () => {
        const port = portWith();
        const others = [
            online('daily_recommendations'),
            online('radio'),
            online('cloud'),
            online('listening_rank'),
            online('artist_songs'),
            navidrome('artist'),
            navidrome('random'),
            navidrome('favorites'),
            foliaPlaylist('p1'),
            { source: 'local', type: 'folder', id: 'folder', name: 'Folder', songIds: [] } as LibraryCollectionDescriptor,
        ];
        for (const descriptor of others) expect(capabilitiesOf(descriptor, port).saveToFolia.supported).toBe(false);
    });

    it('needs the host to offer it, and does not grey out while another source action runs (it only opens a dialog)', () => {
        expect(capabilitiesOf(online('playlist'), {}).saveToFolia.supported).toBe(false);
        expect(capabilitiesOf(online('playlist'), { folia: { refreshFromOrigin: vi.fn() } }).saveToFolia.supported).toBe(false);
        expect(capabilitiesOf(online('playlist'), portWith(), { ...IDLE, sourceActionPending: true }).saveToFolia.enabled).toBe(true);
    });
});

describe('update from the original', () => {
    it('is offered only on a Folia playlist that was saved from a platform playlist', () => {
        const port = portWith(['saved']);
        expect(capabilitiesOf(foliaPlaylist('saved'), port).refreshFromOrigin).toMatchObject({ supported: true, enabled: true });
        expect(capabilitiesOf(foliaPlaylist('own'), port).refreshFromOrigin.supported).toBe(false);
        // 「我喜欢的音乐」不是转存来的，宿主说有出处也不给。
        expect(capabilitiesOf(foliaPlaylist('saved', true), port).refreshFromOrigin.supported).toBe(false);
        expect(capabilitiesOf(online('playlist'), port).refreshFromOrigin.supported).toBe(false);
    });

    it('needs both the query and the action from the host', () => {
        expect(capabilitiesOf(foliaPlaylist('saved'), { folia: { hasOrigin: () => true } }).refreshFromOrigin.supported).toBe(false);
        expect(capabilitiesOf(foliaPlaylist('saved'), { folia: { refreshFromOrigin: vi.fn() } }).refreshFromOrigin.supported).toBe(false);
    });
});

describe('the two actions on the command surface', () => {
    it('map to their capabilities and are published only where the capability is supported', () => {
        expect(LIBRARY_ACTION_MUTATION_CAPABILITY['save-to-folia']).toBe('saveToFolia');
        expect(LIBRARY_ACTION_MUTATION_CAPABILITY['refresh-from-origin']).toBe('refreshFromOrigin');

        const controller = { saveToFolia: vi.fn(), refreshFromOrigin: vi.fn() } as never;
        const stateFor = (descriptor: LibraryCollectionDescriptor, port: LibraryMutationPort) => buildGridSurfaceState(buildCoreSurfaceParams({
            filteredTrackCount: 3,
            isFilterActive: false,
            supportsLocalTrackSorting: false,
            sortField: 'fileName',
            sortDirection: 'asc',
            setSortField: vi.fn(),
            setSortDirection: vi.fn(),
            canReloadOnlineCollection: false,
            playFiltered: vi.fn(),
            enqueueFiltered: vi.fn(),
            reloadOnlineCollection: vi.fn(),
            mutationSnapshot: { capabilities: capabilitiesOf(descriptor, port), sourceActionPending: false, subscribing: false } as never,
            mutations: controller,
        })).availableActions;

        const port = portWith(['saved']);
        expect(stateFor(online('album'), port)).toContain('save-to-folia');
        expect(stateFor(online('album'), port)).not.toContain('refresh-from-origin');
        expect(stateFor(foliaPlaylist('saved'), port)).toContain('refresh-from-origin');
        expect(stateFor(foliaPlaylist('saved'), port)).not.toContain('save-to-folia');
        expect(stateFor(foliaPlaylist('own'), port)).not.toContain('refresh-from-origin');
    });
});
