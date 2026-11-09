import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { OmniPage } from '@/types/onlineMusic';
import type {
    LibraryCollectionDescriptor,
    LocalGridViewCollectionDescriptor,
    NavidromeGridViewCollectionDescriptor,
    OnlineGridViewCollectionDescriptor,
} from '@/library/core/collection/collection.contract';
import type { CollectionResource } from '@/library/core/shared/resource.contract';
import type { LibraryMutationPort } from '@/library/core/shared/ports.contract';
import type { LibraryEntryRef } from '@/library/core/collection/mutations/mutations.contract';
import {
    createCollectionMutationController,
    type CollectionMutationOmni,
} from '@/library/core/collection/mutations/collectionMutations.service';
import { createOnlineCollectionResource } from '@/library/core/collection/resource/onlineCollectionResource.service';
import { createNavidromeCollectionResource } from '@/library/core/collection/resource/navidromeCollectionResource.service';
import { createStaticCollectionResource } from '@/library/core/collection/resource/staticCollectionResource.service';
import { buildDuplicateOccurrences, entryKeyAt } from '@/library/core/collection/collectionEntries';

// test/unit/library/core/collectionMutations.test.ts
// 变更动作层：每个来源的删条目（重复条目的语义、原始下标、过期拒绝）、重复提交只发一次、
// 订阅切换、每日推荐的次数上限与换日期、共用的来源动作标记，以及 dispose 之后晚到的结果。
// omni 与宿主端口都是假的；资源用真实实现（在线资源的依赖照样注入），这样权威提交也一并验证。

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const settle = async () => {
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
};

// 失败用例会把 console.error 静音，别让它漏到后面的用例。
afterEach(() => {
    vi.restoreAllMocks();
});

const onlineSong = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: 'p', mediaId: id },
} as SongResult);
const localSong = (songId: string): SongResult => ({
    id: `local-${songId}`,
    name: songId,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    isLocal: true,
    localRef: { songId },
    sourceRef: { kind: 'local', mediaId: songId },
} as unknown as SongResult);
const naviSong = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'navidrome', mediaId: id },
} as SongResult);
const ids = (tracks: readonly SongResult[]) => tracks.map(track => String(track.id));

/** 第 index 个条目的引用（条目键按重复序号，与网格卡片 id 同格式）。 */
const entryOf = (tracks: SongResult[], index: number): LibraryEntryRef => ({
    entryKey: entryKeyAt(tracks, buildDuplicateOccurrences(tracks, null).occurrences, index)!,
    track: tracks[index],
});
const entryIn = (resource: CollectionResource, index: number) => entryOf(resource.getSnapshot().tracks, index);

const ownedPlaylist = (overrides: Partial<OnlineGridViewCollectionDescriptor> = {}): OnlineGridViewCollectionDescriptor => ({
    source: 'online',
    providerId: 'p',
    id: 'pl',
    name: 'Mine',
    type: 'playlist',
    creator: { id: 'u1', nickname: 'me' },
    tracksUpdatedAt: 1000,
    ...overrides,
});
const onlineAlbum: OnlineGridViewCollectionDescriptor = { source: 'online', providerId: 'p', id: 'al', name: 'Album', type: 'album' };
const daily: OnlineGridViewCollectionDescriptor = { source: 'online', providerId: 'p', id: 'daily', name: 'Daily', type: 'daily_recommendations' };
const localPlaylist: LocalGridViewCollectionDescriptor = {
    source: 'local', id: 'lp', name: 'Playlist', type: 'playlist', songIds: [], playlistId: 'pl-1',
};
const localFolder: LocalGridViewCollectionDescriptor = { source: 'local', id: 'f', name: 'Folder', type: 'folder', songIds: [] };
const localAlbum: LocalGridViewCollectionDescriptor = { source: 'local', id: 'al', name: 'Album', type: 'album', songIds: [], entityId: 'e-al' };
const naviPlaylist: NavidromeGridViewCollectionDescriptor = { source: 'navidrome', id: 'np', name: 'Navi', type: 'playlist', editable: true };
const naviAlbum: NavidromeGridViewCollectionDescriptor = { source: 'navidrome', id: 'na', name: 'Navi Album', type: 'album' };

const fakeOmni = (overrides: Partial<CollectionMutationOmni> = {}) => ({
    canEditCollectionTracks: vi.fn(() => true),
    canSubscribeCollection: vi.fn(() => true),
    canDislikeCollectionSongs: vi.fn(() => true),
    getSubscriptionStatus: vi.fn(async () => false),
    subscribe: vi.fn(async () => {}),
    likeSong: vi.fn(async () => {}),
    updateCollectionTracks: vi.fn(async () => {}),
    dislikeSong: vi.fn(async (): Promise<{ replacement?: SongResult; limitReached?: boolean }> => ({})),
    getRecommendationHistoryDates: vi.fn(async () => ['2024-01-02']),
    getRecommendationHistorySongs: vi.fn(async () => [onlineSong('h-0'), onlineSong('h-1')]),
    getDailySongs: vi.fn(async () => [onlineSong('fresh-0')]),
    ...overrides,
});

const fakePort = () => {
    const port = {
        local: {
            removePlaylistSongs: vi.fn(async () => {}),
            refresh: vi.fn(async () => {}),
            renamePlaylist: vi.fn(async () => {}),
            deletePlaylist: vi.fn(async () => {}),
            deleteFolder: vi.fn(async () => {}),
            resyncFolder: vi.fn(async () => {}),
            resyncAllFolders: vi.fn(async () => {}),
            exportPlaylist: vi.fn(async () => {}),
            editEntity: vi.fn(),
            organizeFolder: vi.fn(),
            matchSong: vi.fn(),
        },
        navidrome: {
            availablePlaylists: [{ id: 'np', name: 'Navi' }],
            removePlaylistSongs: vi.fn(async (_playlistId: string, _rawIndexes: number[]) => {}),
            renamePlaylist: vi.fn(async () => {}),
            deletePlaylist: vi.fn(async () => {}),
            addToPlaylist: vi.fn(async () => {}),
            createPlaylist: vi.fn(async () => {}),
        },
        onCollectionMutated: vi.fn(async () => {}),
        notifyFavoriteAlbumsChanged: vi.fn(),
    };
    return port satisfies LibraryMutationPort;
};

/** 一次取完的在线资源（首页里允许重复条目，与上游一致）；缓存写入记账。 */
const onlineResource = async (
    descriptor: OnlineGridViewCollectionDescriptor,
    tracks: SongResult[],
    getDailySongs = vi.fn(async () => tracks),
) => {
    const writes: Array<{ tracks: SongResult[]; snapshotTime: number }> = [];
    const page: OmniPage<SongResult> = { items: tracks, total: tracks.length, hasMore: false, nextOffset: tracks.length };
    const resource = createOnlineCollectionResource('k', {
        getCollectionTracks: vi.fn(async () => page),
        getCollectionDetail: vi.fn(async () => null),
        getPersonalFm: vi.fn(async () => []),
        getDailySongs,
        readCache: vi.fn(async () => ({ tracks: [], snapshotTime: 0, schemaVersion: 0 })),
        writeCache: vi.fn(async (_key, written, snapshotTime) => { writes.push({ tracks: written, snapshotTime }); }),
        wait: async () => {},
    });
    resource.ensure(descriptor, {});
    await settle();
    return { resource, writes };
};

const navidromeResource = async (tracks: SongResult[]) => {
    const resource = createNavidromeCollectionResource('k', vi.fn(async () => ({ tracks, failed: false })));
    resource.ensure(naviPlaylist, {});
    await settle();
    return resource;
};

const setup = ({
    descriptor,
    resource,
    omni = fakeOmni(),
    port = fakePort(),
    currentUserId = 'u1',
}: {
    descriptor: LibraryCollectionDescriptor;
    resource: CollectionResource | null;
    omni?: ReturnType<typeof fakeOmni>;
    port?: ReturnType<typeof fakePort>;
    currentUserId?: string | null;
}) => {
    const removeCacheEntry = vi.fn(async (_key: string) => {});
    const controller = createCollectionMutationController({ descriptor, resource, port, currentUserId, omni, removeCacheEntry });
    return { controller, omni, port, removeCacheEntry };
};

describe('removing an entry from an online playlist', () => {
    it('removes the song upstream once, every entry of it locally, commits urgently and invalidates the caches', async () => {
        const tracks = [onlineSong('s0'), onlineSong('s1'), onlineSong('s0'), onlineSong('s2')];
        const { resource, writes } = await onlineResource(ownedPlaylist(), tracks);
        const hints: string[] = [];
        resource.subscribe(() => hints.push(resource.getSnapshot().hint));
        const { controller, omni, port, removeCacheEntry } = setup({ descriptor: ownedPlaylist(), resource });

        // 删的是第二次出现的那一条：上游按歌删，所以两条都没了。
        const result = await controller.removeEntry(entryIn(resource, 2));

        expect(result).toEqual({ ok: true });
        expect(omni.updateCollectionTracks).toHaveBeenCalledTimes(1);
        expect(omni.updateCollectionTracks).toHaveBeenCalledWith(ownedPlaylist(), 'del', [tracks[2]]);
        expect(omni.likeSong).not.toHaveBeenCalled();
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s1', 's2']);
        expect(hints).toEqual(['urgent']);
        expect(writes.at(-1)?.snapshotTime).not.toBe(1000);
        expect(removeCacheEntry).toHaveBeenCalledWith('online_provider_p_playlist_detail_pl');
        expect(port.onCollectionMutated).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().pendingEntryKeys).toEqual([]);
    });

    it('unlikes the song when the collection is the liked-songs list', async () => {
        const descriptor = ownedPlaylist({ isLiked: true });
        const { resource } = await onlineResource(descriptor, [onlineSong('s0'), onlineSong('s1')]);
        const { controller, omni } = setup({ descriptor, resource });

        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: true });
        expect(omni.likeSong).toHaveBeenCalledWith(expect.objectContaining({ id: 's0' }), false);
        expect(omni.updateCollectionTracks).not.toHaveBeenCalled();
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s1']);
    });

    it('answers busy to the same entry, or another entry of the same song, while the request is out', async () => {
        const tracks = [onlineSong('s0'), onlineSong('s1'), onlineSong('s0')];
        const { resource } = await onlineResource(ownedPlaylist(), tracks);
        const upstream = deferred<void>();
        const omni = fakeOmni({ updateCollectionTracks: vi.fn(() => upstream.promise) });
        const { controller } = setup({ descriptor: ownedPlaylist(), resource, omni });
        const listener = vi.fn();
        controller.subscribe(listener);

        const first = controller.removeEntry(entryIn(resource, 0));
        expect(controller.getSnapshot().pendingEntryKeys).toEqual([entryIn(resource, 0).entryKey]);
        expect(controller.getSnapshot().capabilities.removeEntry).toMatchObject({ enabled: true, pending: true });
        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'busy' });
        expect(await controller.removeEntry(entryIn(resource, 2))).toEqual({ ok: false, reason: 'busy' });

        upstream.resolve();
        expect(await first).toEqual({ ok: true });
        expect(omni.updateCollectionTracks).toHaveBeenCalledTimes(1);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s1']);
        expect(controller.getSnapshot().pendingEntryKeys).toEqual([]);
    });

    it('lets different songs go out side by side', async () => {
        const { resource } = await onlineResource(ownedPlaylist(), [onlineSong('s0'), onlineSong('s1'), onlineSong('s2')]);
        const gates = [deferred<void>(), deferred<void>()];
        let call = 0;
        const omni = fakeOmni({ updateCollectionTracks: vi.fn(() => gates[call++].promise) });
        const { controller } = setup({ descriptor: ownedPlaylist(), resource, omni });

        const first = controller.removeEntry(entryIn(resource, 0));
        const second = controller.removeEntry(entryIn(resource, 2));
        gates[1].resolve();
        gates[0].resolve();
        expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s1']);
    });

    it('leaves the list alone and reports failed when upstream refuses', async () => {
        const { resource } = await onlineResource(ownedPlaylist(), [onlineSong('s0'), onlineSong('s1')]);
        const omni = fakeOmni({ updateCollectionTracks: vi.fn(async () => { throw new Error('denied'); }) });
        const { controller, port, removeCacheEntry } = setup({ descriptor: ownedPlaylist(), resource, omni });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'failed', message: 'denied' });
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s0', 's1']);
        expect(removeCacheEntry).not.toHaveBeenCalled();
        expect(port.onCollectionMutated).not.toHaveBeenCalled();
        expect(controller.getSnapshot().pendingEntryKeys).toEqual([]);
    });

    it('refuses playlists the user cannot edit without asking upstream', async () => {
        const descriptor = ownedPlaylist({ creator: { id: 'u2', nickname: 'them' } });
        const { resource } = await onlineResource(descriptor, [onlineSong('s0')]);
        const { controller, omni } = setup({ descriptor, resource });

        expect(controller.getSnapshot().capabilities.removeEntry.supported).toBe(false);
        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'unsupported' });
        expect(omni.updateCollectionTracks).not.toHaveBeenCalled();
    });
});

describe('removing an entry from a local playlist', () => {
    it('removes by song id: every entry of that song goes, then the library refreshes', async () => {
        const tracks = [localSong('a'), localSong('b'), localSong('a'), localSong('c')];
        const resource = createStaticCollectionResource('k', tracks);
        const { controller, port } = setup({ descriptor: localPlaylist, resource });

        expect(await controller.removeEntry(entryIn(resource, 2))).toEqual({ ok: true });
        expect(port.local.removePlaylistSongs).toHaveBeenCalledTimes(1);
        expect(port.local.removePlaylistSongs).toHaveBeenCalledWith('pl-1', ['a']);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['local-b', 'local-c']);
        expect(port.local.refresh).toHaveBeenCalledTimes(1);
    });

    it('commits into the resource the host holds when the answer arrives', async () => {
        const tracks = [localSong('a'), localSong('b')];
        const first = createStaticCollectionResource('k', tracks);
        const upstream = deferred<void>();
        const port = fakePort();
        port.local.removePlaylistSongs = vi.fn(() => upstream.promise);
        const { controller } = setup({ descriptor: localPlaylist, resource: first, port });

        const pending = controller.removeEntry(entryIn(first, 0));
        // 曲库刷新换了新的静态资源（例如别处改了歌单）：删除提交给新的那一个。
        const second = createStaticCollectionResource('k', [localSong('a'), localSong('b'), localSong('c')]);
        controller.update({ resource: second });
        upstream.resolve();

        expect(await pending).toEqual({ ok: true });
        expect(ids(second.getSnapshot().tracks)).toEqual(['local-b', 'local-c']);
    });
});

describe('removing an entry from a Navidrome playlist', () => {
    it('sends the raw index of that one duplicate and removes only it', async () => {
        const resource = await navidromeResource([naviSong('a'), naviSong('b'), naviSong('a'), naviSong('c')]);
        const firstA = resource.getSnapshot().tracks[0];
        const { controller, port } = setup({ descriptor: naviPlaylist, resource });

        expect(await controller.removeEntry(entryIn(resource, 2))).toEqual({ ok: true });
        expect(port.navidrome.removePlaylistSongs).toHaveBeenCalledWith('np', [2]);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['a', 'b', 'c']);
        expect(resource.getSnapshot().tracks[0]).toBe(firstA);
    });

    it('uses the index in the current list after an earlier removal', async () => {
        const resource = await navidromeResource([naviSong('a'), naviSong('b'), naviSong('c'), naviSong('d')]);
        const { controller, port } = setup({ descriptor: naviPlaylist, resource });

        await controller.removeEntry(entryIn(resource, 1));
        const d = entryOf(resource.getSnapshot().tracks, 2);
        expect(d.track.id).toBe('d');
        expect(await controller.removeEntry(d)).toEqual({ ok: true });
        expect(vi.mocked(port.navidrome.removePlaylistSongs).mock.calls.map(call => call[1])).toEqual([[1], [2]]);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['a', 'c']);
    });

    it('refuses an entry that is no longer in the list without sending anything', async () => {
        const resource = await navidromeResource([naviSong('a'), naviSong('b')]);
        const { controller, port } = setup({ descriptor: naviPlaylist, resource });

        expect(await controller.removeEntry({ entryKey: 'navidrome:gone-0', track: naviSong('gone') })).toEqual({ ok: false, reason: 'stale' });
        // 第二个 a 并不存在：重复序号对不上也算过期。
        expect(await controller.removeEntry({ entryKey: 'navidrome:a-1', track: naviSong('a') })).toEqual({ ok: false, reason: 'stale' });
        expect(port.navidrome.removePlaylistSongs).not.toHaveBeenCalled();
    });

    it('does not touch the list when it changed while the request was out', async () => {
        const resource = await navidromeResource([naviSong('a'), naviSong('b'), naviSong('c')]);
        const upstream = deferred<void>();
        const port = fakePort();
        port.navidrome.removePlaylistSongs = vi.fn(() => upstream.promise);
        const { controller } = setup({ descriptor: naviPlaylist, resource, port });

        const pending = controller.removeEntry(entryIn(resource, 2));
        await resource.replaceAll(async () => [naviSong('x'), naviSong('y'), naviSong('z')]);
        upstream.resolve();

        expect(await pending).toEqual({ ok: false, reason: 'stale' });
        expect(ids(resource.getSnapshot().tracks)).toEqual(['x', 'y', 'z']);
    });

    it('runs one removal at a time: a second index would already be off upstream', async () => {
        const resource = await navidromeResource([naviSong('a'), naviSong('b'), naviSong('c')]);
        const upstream = deferred<void>();
        const port = fakePort();
        port.navidrome.removePlaylistSongs = vi.fn(() => upstream.promise);
        const { controller } = setup({ descriptor: naviPlaylist, resource, port });

        const first = controller.removeEntry(entryIn(resource, 0));
        expect(controller.getSnapshot().capabilities.removeEntry).toMatchObject({ enabled: false, reason: 'pending' });
        expect(await controller.removeEntry(entryIn(resource, 2))).toEqual({ ok: false, reason: 'busy' });
        upstream.resolve();
        expect(await first).toEqual({ ok: true });
        expect(port.navidrome.removePlaylistSongs).toHaveBeenCalledTimes(1);
    });
});

describe('disliking a daily recommendation', () => {
    const dailyTracks = () => [onlineSong('d0'), onlineSong('d1'), onlineSong('d2')];

    it('replaces the disliked song in place', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        const omni = fakeOmni({ dislikeSong: vi.fn(async () => ({ replacement: onlineSong('r') })) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        expect(await controller.removeEntry(entryIn(resource, 1))).toEqual({ ok: true });
        expect(omni.dislikeSong).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
        expect(ids(resource.getSnapshot().tracks)).toEqual(['d0', 'r', 'd2']);
    });

    it('remembers that the limit was reached and stops asking upstream', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        const omni = fakeOmni({ dislikeSong: vi.fn(async () => ({ limitReached: true })) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'limit-reached' });
        expect(controller.getSnapshot().dailyLimitReached).toBe(true);
        expect(controller.getSnapshot().capabilities.removeEntry).toMatchObject({ supported: true, enabled: false, reason: 'limit-reached' });
        expect(await controller.removeEntry(entryIn(resource, 1))).toEqual({ ok: false, reason: 'limit-reached' });
        expect(omni.dislikeSong).toHaveBeenCalledTimes(1);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['d0', 'd1', 'd2']);
    });

    // 有的平台的不喜欢是把歌拉进黑名单，没有替换曲：成功就把这一行从当天的列表里去掉（removed）。
    it('removes the entry when the write succeeded without a replacement', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        const omni = fakeOmni({ dislikeSong: vi.fn(async () => ({ removed: true })) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        expect(await controller.removeEntry(entryIn(resource, 1))).toEqual({ ok: true });
        expect(omni.dislikeSong).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
        expect(ids(resource.getSnapshot().tracks)).toEqual(['d0', 'd2']);
    });

    it('keeps a matching song in history when a removal returns after switching dates', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        const upstream = deferred<{ removed: boolean }>();
        const omni = fakeOmni({
            dislikeSong: vi.fn(() => upstream.promise),
            getRecommendationHistorySongs: vi.fn(async () => [onlineSong('d1'), onlineSong('history')]),
            getProviderCapabilities: vi.fn(() => ({ historyRecommendations: true, dailyStyleRecommendations: false })),
        });
        const { controller } = setup({ descriptor: daily, resource, omni });
        const removal = controller.removeEntry(entryIn(resource, 1));
        expect(await controller.setDailyDate('2024-01-02')).toEqual({ ok: true });
        upstream.resolve({ removed: true });
        expect(await removal).toEqual({ ok: false, reason: 'stale' });
        expect(ids(resource.getSnapshot().tracks)).toEqual(['d1', 'history']);
    });

    it('keeps history when a removal starts while the date is loading', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        const history = deferred<SongResult[]>();
        const upstream = deferred<{ removed: boolean }>();
        const omni = fakeOmni({
            dislikeSong: vi.fn(() => upstream.promise),
            getRecommendationHistorySongs: vi.fn(() => history.promise),
            getProviderCapabilities: vi.fn(() => ({ historyRecommendations: true, dailyStyleRecommendations: false })),
        });
        const { controller } = setup({ descriptor: daily, resource, omni });
        const switching = controller.setDailyDate('2024-01-02');
        const removal = controller.removeEntry(entryIn(resource, 1));
        expect(omni.dislikeSong).toHaveBeenCalledTimes(1);
        history.resolve([onlineSong('d1'), onlineSong('history')]);
        expect(await switching).toEqual({ ok: true });
        upstream.resolve({ removed: true });
        expect(await removal).toEqual({ ok: false, reason: 'stale' });
        expect(ids(resource.getSnapshot().tracks)).toEqual(['d1', 'history']);
    });

    it('reports failed when upstream gives neither a replacement, a removal nor a limit, or throws', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const empty = setup({ descriptor: daily, resource, omni: fakeOmni({ dislikeSong: vi.fn(async () => ({})) }) });
        expect(await empty.controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'failed' });

        const throwing = setup({ descriptor: daily, resource, omni: fakeOmni({ dislikeSong: vi.fn(async () => { throw new Error('boom'); }) }) });
        expect(await throwing.controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'failed', message: 'boom' });
        expect(throwing.controller.getSnapshot().dailyLimitReached).toBe(false);
    });

    it('dislikes one song at a time', async () => {
        const { resource } = await onlineResource(daily, dailyTracks());
        const upstream = deferred<{ replacement?: SongResult }>();
        const omni = fakeOmni({ dislikeSong: vi.fn(() => upstream.promise) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        const first = controller.removeEntry(entryIn(resource, 0));
        expect(await controller.removeEntry(entryIn(resource, 2))).toEqual({ ok: false, reason: 'busy' });
        upstream.resolve({ replacement: onlineSong('r') });
        expect(await first).toEqual({ ok: true });
        expect(omni.dislikeSong).toHaveBeenCalledTimes(1);
    });
});

describe('daily recommendation dates', () => {
    it('loads the history dates once, when someone first looks', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller, omni } = setup({ descriptor: daily, resource });
        expect(omni.getRecommendationHistoryDates).not.toHaveBeenCalled();

        controller.subscribe(() => {});
        controller.subscribe(() => {});
        await settle();
        expect(omni.getRecommendationHistoryDates).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().dailyHistoryDates).toEqual(['2024-01-02']);
    });

    it('switches through the resource, records the date only on success, and locks editing on history', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller, omni } = setup({ descriptor: daily, resource });

        expect(await controller.setDailyDate('2024-01-02')).toEqual({ ok: true });
        expect(omni.getRecommendationHistorySongs).toHaveBeenCalledWith('2024-01-02');
        expect(ids(resource.getSnapshot().tracks)).toEqual(['h-0', 'h-1']);
        expect(controller.getSnapshot().dailyDate).toBe('2024-01-02');
        expect(controller.getSnapshot().capabilities.removeEntry.supported).toBe(false);
        expect(controller.getSnapshot().capabilities.editCollection.supported).toBe(false);
        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'unsupported' });

        expect(await controller.setDailyDate('', { afresh: true })).toEqual({ ok: true });
        expect(omni.getDailySongs).toHaveBeenCalledWith(true);
        expect(controller.getSnapshot().dailyDate).toBe('');

        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(omni.getRecommendationHistorySongs).mockRejectedValueOnce(new Error('offline'));
        expect(await controller.setDailyDate('2024-01-03')).toEqual({ ok: false, reason: 'failed' });
        expect(controller.getSnapshot().dailyDate).toBe('');
        expect(ids(resource.getSnapshot().tracks)).toEqual(['fresh-0']);
    });

    it('answers busy while a switch is loading', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const history = deferred<SongResult[]>();
        const { controller, omni } = setup({
            descriptor: daily,
            resource,
            omni: fakeOmni({ getRecommendationHistorySongs: vi.fn(() => history.promise) }),
        });

        const first = controller.setDailyDate('2024-01-02');
        expect(controller.getSnapshot().capabilities.dailyDate).toMatchObject({ enabled: false, pending: true });
        expect(await controller.setDailyDate('2024-01-03')).toEqual({ ok: false, reason: 'busy' });
        history.resolve([onlineSong('h')]);
        expect(await first).toEqual({ ok: true });
        expect(omni.getRecommendationHistorySongs).toHaveBeenCalledTimes(1);
    });
});

describe('daily recommendations after the account preferences are saved', () => {
    const listening = (overrides?: Partial<CollectionMutationOmni>) => {
        const listeners = new Set<(providerId: string) => void>();
        const omni = fakeOmni({
            ...overrides,
            subscribeRecommendationPreferenceSaves: vi.fn((listener: (providerId: string) => void) => {
                listeners.add(listener);
                return () => { listeners.delete(listener); };
            }),
        });
        const tell = (providerId: string) => listeners.forEach(listener => listener(providerId));
        return { listeners, omni, tell };
    };

    it('reads today again for a save on its own provider, once someone looks', async () => {
        const { listeners, omni, tell } = listening();
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller } = setup({ descriptor: daily, resource, omni });
        expect(listeners.size).toBe(0);

        controller.subscribe(() => {});
        await settle();
        expect(listeners.size).toBe(1);

        tell('another-provider');
        await settle();
        expect(omni.getDailySongs).not.toHaveBeenCalled();

        tell('p');
        await settle();
        expect(omni.getDailySongs).toHaveBeenCalledWith(true);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['fresh-0']);
    });

    it('leaves a history date as it is', async () => {
        const { omni, tell } = listening();
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller } = setup({ descriptor: daily, resource, omni });
        controller.subscribe(() => {});
        expect(await controller.setDailyDate('2024-01-02')).toEqual({ ok: true });

        tell('p');
        await settle();
        expect(omni.getDailySongs).not.toHaveBeenCalled();
        expect(ids(resource.getSnapshot().tracks)).toEqual(['h-0', 'h-1']);
    });

    it('reads today once more when preferences are saved during the first load', async () => {
        const { omni, tell } = listening();
        const initial = deferred<SongResult[]>();
        const { resource } = await onlineResource(daily, [], vi.fn(() => initial.promise));
        const { controller } = setup({ descriptor: daily, resource, omni });
        controller.subscribe(() => {});
        expect(resource.getSnapshot().status).toBe('loading');

        tell('p');
        tell('p');
        expect(omni.getDailySongs).not.toHaveBeenCalled();

        initial.resolve([onlineSong('before-save')]);
        await settle();
        expect(omni.getDailySongs).toHaveBeenCalledExactlyOnceWith(true);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['fresh-0']);
    });

    it('reads today again after returning from history if preferences were saved during the switch', async () => {
        const { omni, tell } = listening();
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller } = setup({ descriptor: daily, resource, omni });
        controller.subscribe(() => {});
        await controller.setDailyDate('2024-01-02');
        const returning = deferred<SongResult[]>();
        vi.mocked(omni.getDailySongs).mockReturnValueOnce(returning.promise);

        const change = controller.setDailyDate('');
        tell('p');
        expect(omni.getDailySongs).toHaveBeenCalledExactlyOnceWith(false);

        returning.resolve([onlineSong('before-save')]);
        expect(await change).toEqual({ ok: true });
        await settle();
        expect(vi.mocked(omni.getDailySongs).mock.calls).toEqual([[false], [true]]);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['fresh-0']);
    });

    it.each(['account change', 'provider change', 'dispose'])('drops a queued read on %s', async change => {
        const { omni, tell } = listening();
        const initial = deferred<SongResult[]>();
        const { resource } = await onlineResource(daily, [], vi.fn(() => initial.promise));
        const { controller } = setup({ descriptor: daily, resource, omni });
        controller.subscribe(() => {});

        tell('p');
        if (change === 'account change') controller.update({ currentUserId: 'u2' });
        if (change === 'provider change') controller.update({ descriptor: { ...daily, providerId: 'p2' } });
        if (change === 'dispose') controller.dispose();
        initial.resolve([onlineSong('before-save')]);
        await settle();

        expect(omni.getDailySongs).not.toHaveBeenCalled();
    });

    it.each(['history', 'style'])('drops the queued read once %s is shown even if today is opened again immediately', async view => {
        const history = deferred<SongResult[]>();
        const style = deferred<{ songs: SongResult[]; selection: null }>();
        const { omni, tell } = listening({
            getRecommendationHistorySongs: vi.fn(() => history.promise),
            getProviderCapabilities: () => ({ historyRecommendations: true, dailyStyleRecommendations: true }),
            getDailyStyleSongs: vi.fn(() => style.promise),
            setDailyStyle: vi.fn(async () => {}),
        });
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller } = setup({ descriptor: daily, resource, omni });
        let returned = false;
        controller.subscribe(() => {
            const { dailyDate, dailyStyleShown, capabilities } = controller.getSnapshot();
            if (returned || capabilities.dailyDate.pending || !(dailyDate || dailyStyleShown)) return;
            returned = true;
            void controller.setDailyDate('');
        });

        const change = view === 'history' ? controller.setDailyDate('2024-01-02') : controller.showDailyStyle();
        tell('p');
        history.resolve([onlineSong('history')]);
        style.resolve({ songs: [onlineSong('style')], selection: null });
        expect(await change).toEqual({ ok: true });
        await settle();

        expect(controller.getSnapshot()).toMatchObject({ dailyDate: '', dailyStyleShown: false });
        expect(omni.getDailySongs).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('does not listen for other collections, and stops listening once disposed', async () => {
        const { listeners, omni } = listening();
        const { resource: playlist } = await onlineResource(ownedPlaylist(), [onlineSong('s0')]);
        setup({ descriptor: ownedPlaylist(), resource: playlist, omni }).controller.subscribe(() => {});
        await settle();
        expect(listeners.size).toBe(0);

        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller } = setup({ descriptor: daily, resource, omni });
        controller.subscribe(() => {});
        await settle();
        expect(listeners.size).toBe(1);
        controller.dispose();
        expect(listeners.size).toBe(0);
    });
});

describe('daily style recommendations (#938)', () => {
    const genre = { id: '1000', name: 'Genre', tags: [{ id: '10004', name: 'EDM' }, { id: '10015', name: 'ACG' }] };
    const styleOmni = (overrides: Partial<CollectionMutationOmni> = {}) => fakeOmni({
        getProviderCapabilities: vi.fn(() => ({ historyRecommendations: true, dailyStyleRecommendations: true })),
        getDailyStyleGroups: vi.fn(async () => [genre]),
        getDailyStyleSongs: vi.fn(async () => ({ songs: [onlineSong('s-0'), onlineSong('s-1')], selection: { groupId: '1000', tagIds: ['10004'] } })),
        setDailyStyle: vi.fn(async () => {}),
        ...overrides,
    });

    it('is only there when the provider says so', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const { controller } = setup({ descriptor: daily, resource });
        expect(controller.getSnapshot().dailyStyleAvailable).toBe(false);
        expect(await controller.showDailyStyle()).toEqual({ ok: false, reason: 'unsupported' });

        const { controller: styled } = setup({ descriptor: daily, resource, omni: styleOmni() });
        expect(styled.getSnapshot().dailyStyleAvailable).toBe(true);
    });

    it('shows the style songs with the pick they came with, loads the groups once, and locks editing', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const omni = styleOmni();
        const { controller } = setup({ descriptor: daily, resource, omni });

        expect(await controller.showDailyStyle()).toEqual({ ok: true });
        await settle();
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-0', 's-1']);
        expect(controller.getSnapshot()).toMatchObject({
            dailyStyleShown: true,
            dailyDate: '',
            dailyStyleGroups: [genre],
            dailyStyleSelection: { groupId: '1000', tagIds: ['10004'] },
        });
        expect(controller.getSnapshot().capabilities.removeEntry.supported).toBe(false);
        expect(controller.getSnapshot().capabilities.editCollection.supported).toBe(false);

        controller.loadDailyStyleGroups();
        expect(await controller.showDailyStyle()).toEqual({ ok: true });
        expect(omni.getDailyStyleGroups).toHaveBeenCalledTimes(1);

        // 换回默认推荐（今天）。
        expect(await controller.setDailyDate('')).toEqual({ ok: true });
        expect(controller.getSnapshot().dailyStyleShown).toBe(false);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['fresh-0']);
        expect(controller.getSnapshot().capabilities.editCollection.supported).toBe(true);
    });

    it('saves a new pick before reading the songs, and changes nothing when the save fails', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const omni = styleOmni({ getDailyStyleSongs: vi.fn(async () => ({ songs: [onlineSong('s-2')], selection: null })) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        const pick = { groupId: '1000', tagIds: ['10004', '10015'] };
        expect(await controller.setDailyStyle(pick)).toEqual({ ok: true });
        expect(omni.setDailyStyle).toHaveBeenCalledWith(pick);
        expect(vi.mocked(omni.setDailyStyle!).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(omni.getDailyStyleSongs!).mock.invocationCallOrder[0]);
        expect(controller.getSnapshot()).toMatchObject({ dailyStyleShown: true, dailyStyleSelection: pick });
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-2']);

        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(omni.setDailyStyle!).mockRejectedValueOnce(new Error('refused'));
        const result = await controller.setDailyStyle({ groupId: '1000', tagIds: ['10015'] });
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
        expect(omni.getDailyStyleSongs).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().dailyStyleSelection).toEqual(pick);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-2']);

        expect(await controller.setDailyStyle({ groupId: '1000', tagIds: [] })).toEqual({ ok: false, reason: 'unsupported' });
    });

    it('keeps the shown pick when the save went through but the songs did not, so the same pick can be retried', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const omni = styleOmni();
        const { controller } = setup({ descriptor: daily, resource, omni });
        expect(await controller.showDailyStyle()).toEqual({ ok: true });
        const shown = controller.getSnapshot().dailyStyleSelection;

        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(omni.getDailyStyleSongs!).mockRejectedValueOnce(new Error('offline'));
        const pick = { groupId: '1000', tagIds: ['10004', '10015'] };
        expect(await controller.setDailyStyle(pick)).toMatchObject({ ok: false, reason: 'failed' });
        expect(omni.setDailyStyle).toHaveBeenCalledWith(pick);
        expect(controller.getSnapshot().dailyStyleSelection).toEqual(shown);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-0', 's-1']);

        vi.mocked(omni.getDailyStyleSongs!).mockResolvedValueOnce({ songs: [onlineSong('s-3')], selection: null });
        expect(await controller.setDailyStyle(pick)).toEqual({ ok: true });
        expect(controller.getSnapshot().dailyStyleSelection).toEqual(pick);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s-3']);
    });

    it('marks the style groups as failed when they do not come, and loads them again on request', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const omni = styleOmni({ getDailyStyleGroups: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]).mockResolvedValue([genre]) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        controller.loadDailyStyleGroups();
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ dailyStyleGroups: [], dailyStyleGroupsFailed: true });
        controller.loadDailyStyleGroups();
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ dailyStyleGroups: [], dailyStyleGroupsFailed: true });
        controller.loadDailyStyleGroups();
        expect(controller.getSnapshot().dailyStyleGroupsFailed).toBe(false);
        await settle();
        expect(controller.getSnapshot()).toMatchObject({ dailyStyleGroups: [genre], dailyStyleGroupsFailed: false });
        controller.loadDailyStyleGroups();
        expect(omni.getDailyStyleGroups).toHaveBeenCalledTimes(3);
    });

    it('starts where the last visit left off and writes every switch back', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('s-loaded')]);
        const omni = styleOmni();
        const listeners = new Set<() => void>();
        const remembered = { prefersStyle: true, styleSelection: null as { groupId: string; tagIds: string[] } | null };
        const dailyMode = {
            read: () => ({ ...remembered }),
            setPrefersStyle: vi.fn((prefersStyle: boolean) => { remembered.prefersStyle = prefersStyle; }),
            noteStyleSelection: vi.fn((selection: { groupId: string; tagIds: string[] } | null) => { remembered.styleSelection = selection; }),
            subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        };
        const controller = createCollectionMutationController({
            descriptor: daily, resource, port: fakePort(), currentUserId: 'u1', omni, removeCacheEntry: vi.fn(async () => {}), dailyMode,
        });
        expect(controller.getSnapshot()).toMatchObject({ dailyStyleShown: true, dailyStyleSelection: null });
        expect(controller.getSnapshot().capabilities.editCollection.supported).toBe(false);

        // 第一个订阅者到来：取分组；资源加载完记下的风格到了就通知。
        const listener = vi.fn();
        controller.subscribe(listener);
        await settle();
        expect(omni.getDailyStyleGroups).toHaveBeenCalledTimes(1);
        remembered.styleSelection = { groupId: '1000', tagIds: ['10015'] };
        listeners.forEach(notify => notify());
        expect(controller.getSnapshot().dailyStyleSelection).toEqual({ groupId: '1000', tagIds: ['10015'] });
        expect(listener).toHaveBeenCalled();

        expect(await controller.setDailyDate('')).toEqual({ ok: true });
        expect(dailyMode.setPrefersStyle).toHaveBeenLastCalledWith(false);
        expect(controller.getSnapshot().dailyStyleSelection).toBeNull();
        expect(await controller.showDailyStyle()).toEqual({ ok: true });
        expect(dailyMode.setPrefersStyle).toHaveBeenLastCalledWith(true);
        // 换成功的风格写回，下一个控制器从它起步。
        expect(dailyMode.noteStyleSelection).toHaveBeenLastCalledWith({ groupId: '1000', tagIds: ['10004'] });

        // 自动取分组只有第一次；宿主之后的 update 不再重发。
        controller.update({});
        controller.update({});
        expect(omni.getDailyStyleGroups).toHaveBeenCalledTimes(1);

        controller.dispose();
        expect(listeners.size).toBe(0);
    });

    it('shows no styles when the answer names none, even after another pick', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const omni = styleOmni({ getDailyStyleSongs: vi.fn(async () => ({ songs: [], selection: null })) });
        const noted: unknown[] = [];
        const dailyMode = { read: () => ({ prefersStyle: false, styleSelection: null }), setPrefersStyle: vi.fn(), noteStyleSelection: vi.fn((s: unknown) => { noted.push(s); }), subscribe: () => () => {} };
        const controller = createCollectionMutationController({
            descriptor: daily, resource, port: fakePort(), currentUserId: 'u1', omni, removeCacheEntry: vi.fn(async () => {}), dailyMode,
        });
        expect(await controller.setDailyStyle({ groupId: '1000', tagIds: ['10004'] })).toEqual({ ok: true });
        expect(controller.getSnapshot().dailyStyleSelection).toEqual({ groupId: '1000', tagIds: ['10004'] });
        expect(await controller.showDailyStyle()).toEqual({ ok: true });
        expect(controller.getSnapshot().dailyStyleSelection).toBeNull();
        expect(noted.at(-1)).toBeNull();
    });

    it('starts on the default list where the provider has no style recommendations', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const dailyMode = { read: () => ({ prefersStyle: true, styleSelection: null }), setPrefersStyle: vi.fn(), noteStyleSelection: vi.fn(), subscribe: () => () => {} };
        const controller = createCollectionMutationController({
            descriptor: daily, resource, port: fakePort(), currentUserId: 'u1', omni: fakeOmni(), removeCacheEntry: vi.fn(async () => {}), dailyMode,
        });
        expect(controller.getSnapshot().dailyStyleShown).toBe(false);
    });

    it('shares the busy lock with the date switch', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0')]);
        const songs = deferred<{ songs: SongResult[]; selection: null }>();
        const omni = styleOmni({ getDailyStyleSongs: vi.fn(() => songs.promise) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        const first = controller.showDailyStyle();
        expect(await controller.setDailyDate('2024-01-02')).toEqual({ ok: false, reason: 'busy' });
        expect(await controller.setDailyStyle({ groupId: '1000', tagIds: ['10004'] })).toEqual({ ok: false, reason: 'busy' });
        songs.resolve({ songs: [onlineSong('s')], selection: null });
        expect(await first).toEqual({ ok: true });
        expect(omni.setDailyStyle).not.toHaveBeenCalled();
    });
});

describe('subscription', () => {
    const publicPlaylist = ownedPlaylist({ creator: { id: 'u2', nickname: 'them' } });

    it('asks for the status once, when the first renderer subscribes', async () => {
        const { resource } = await onlineResource(publicPlaylist, [onlineSong('s0')]);
        const omni = fakeOmni({ getSubscriptionStatus: vi.fn(async () => true) });
        const { controller } = setup({ descriptor: publicPlaylist, resource, omni });
        expect(controller.getSnapshot().subscribed).toBeNull();
        expect(omni.getSubscriptionStatus).not.toHaveBeenCalled();

        controller.subscribe(() => {});
        controller.subscribe(() => {});
        await settle();
        expect(omni.getSubscriptionStatus).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().subscribed).toBe(true);
    });

    it('shows a toggle at once, asks omni behind it, follows a second press and refreshes the account', async () => {
        const { resource } = await onlineResource(publicPlaylist, [onlineSong('s0')]);
        const upstream = deferred<void>();
        const omni = fakeOmni({ subscribe: vi.fn(() => upstream.promise) });
        const { controller, port } = setup({ descriptor: publicPlaylist, resource, omni });

        const first = controller.toggleSubscribe();
        // 一按就变：请求还在路上，星星已经是「已订阅」，而且还能再按。
        expect(controller.getSnapshot()).toMatchObject({ subscribed: true, subscribing: true, capabilities: { subscribe: { enabled: true, pending: false } } });
        // 请求期间再按：只改「要的」，立即答 ok，请求跟着它走。
        expect(await controller.toggleSubscribe()).toEqual({ ok: true });
        expect(controller.getSnapshot().subscribed).toBe(false);
        upstream.resolve();
        expect(await first).toEqual({ ok: true });

        // 状态还不知道时按「未订阅」处理，所以第一次是订阅；第二次按下跟着取消，一次一个。
        expect(vi.mocked(omni.subscribe).mock.calls).toEqual([[publicPlaylist, true], [publicPlaylist, false]]);
        expect(controller.getSnapshot()).toMatchObject({ subscribed: false, subscribing: false });
        expect(port.onCollectionMutated).toHaveBeenCalledTimes(2);
        expect(port.notifyFavoriteAlbumsChanged).not.toHaveBeenCalled();

        expect(await controller.toggleSubscribe()).toEqual({ ok: true });
        expect(omni.subscribe).toHaveBeenLastCalledWith(publicPlaylist, true);
        expect(controller.getSnapshot().subscribed).toBe(true);
    });

    it('puts the star back to what the platform holds when it refuses, and says the toggle failed', async () => {
        const refused = ownedPlaylist({ id: 'refused-playlist', creator: { id: 'u2', nickname: 'them' } });
        const { resource } = await onlineResource(refused, [onlineSong('s0')]);
        const omni = fakeOmni({ subscribe: vi.fn(async () => { throw new Error('refused'); }) });
        const { controller } = setup({ descriptor: refused, resource, omni });
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const toggled = controller.toggleSubscribe();
        expect(controller.getSnapshot().subscribed).toBe(true);
        expect(await toggled).toEqual({ ok: false, reason: 'failed' });
        expect(controller.getSnapshot()).toMatchObject({ subscribed: false, subscribing: false });
    });

    it('tells the favorite albums list when an album changes', async () => {
        const { resource } = await onlineResource(onlineAlbum, [onlineSong('s0')]);
        const { controller, port } = setup({ descriptor: onlineAlbum, resource });

        expect(await controller.toggleSubscribe()).toEqual({ ok: true });
        expect(port.notifyFavoriteAlbumsChanged).toHaveBeenCalledTimes(1);
    });

    it('ignores a status that arrives after the user already toggled', async () => {
        const { resource } = await onlineResource(publicPlaylist, [onlineSong('s0')]);
        const status = deferred<boolean>();
        const omni = fakeOmni({ getSubscriptionStatus: vi.fn(() => status.promise) });
        const { controller } = setup({ descriptor: publicPlaylist, resource, omni });

        controller.subscribe(() => {});
        expect(await controller.toggleSubscribe()).toEqual({ ok: true });
        status.resolve(false);
        await settle();
        expect(controller.getSnapshot().subscribed).toBe(true);
    });

    it('is not offered on a playlist the user owns', async () => {
        const { resource } = await onlineResource(ownedPlaylist(), [onlineSong('s0')]);
        const { controller, omni } = setup({ descriptor: ownedPlaylist(), resource });

        controller.subscribe(() => {});
        await settle();
        expect(controller.getSnapshot().capabilities.subscribe.supported).toBe(false);
        expect(omni.getSubscriptionStatus).not.toHaveBeenCalled();
        expect(await controller.toggleSubscribe()).toEqual({ ok: false, reason: 'unsupported' });
        expect(omni.subscribe).not.toHaveBeenCalled();
    });
});

describe('source actions', () => {
    it('renames with the trimmed name, skips no-op names and shares one pending flag', async () => {
        const resource = createStaticCollectionResource('k', [localSong('a')]);
        const upstream = deferred<void>();
        const port = fakePort();
        port.local.renamePlaylist = vi.fn(() => upstream.promise);
        const { controller } = setup({ descriptor: localPlaylist, resource, port });

        const rename = controller.rename('  New name  ');
        expect(controller.getSnapshot()).toMatchObject({
            sourceActionPending: true,
            capabilities: { rename: { enabled: false, pending: true, reason: 'pending' }, exportPlaylist: { enabled: false } },
        });
        expect(await controller.exportPlaylist()).toEqual({ ok: false, reason: 'busy' });
        // 只打开对话框的动作不占这个标记。
        expect(await controller.matchSong(localSong('a'))).toEqual({ ok: true });
        upstream.resolve();
        expect(await rename).toEqual({ ok: true });
        expect(port.local.renamePlaylist).toHaveBeenCalledWith('pl-1', 'New name');
        expect(port.local.exportPlaylist).not.toHaveBeenCalled();
        expect(port.local.matchSong).toHaveBeenCalledWith('a');
        expect(controller.getSnapshot().sourceActionPending).toBe(false);

        // 空名字、与当前显示的名字相同（刚改成的那个）都是空操作。
        expect(await controller.rename('New name ')).toEqual({ ok: true });
        expect(await controller.rename('   ')).toEqual({ ok: true });
        expect(port.local.renamePlaylist).toHaveBeenCalledTimes(1);
    });

    it('shows the new name until the host catches up, without touching the descriptor', async () => {
        const resource = await navidromeResource([naviSong('a')]);
        const descriptor = { ...naviPlaylist };
        const { controller, port } = setup({ descriptor, resource });
        expect(controller.getSnapshot().renamedTo).toBeNull();

        expect(await controller.rename('Renamed')).toEqual({ ok: true });
        expect(controller.getSnapshot().renamedTo).toBe('Renamed');
        expect(descriptor.name).toBe('Navi');

        // 改回原名不是空操作：上游现在叫 Renamed。
        expect(await controller.rename('Navi')).toEqual({ ok: true });
        expect(port.navidrome.renamePlaylist).toHaveBeenLastCalledWith('np', 'Navi');
        expect(controller.getSnapshot().renamedTo).toBeNull();

        expect(await controller.rename('Third')).toEqual({ ok: true });
        expect(controller.getSnapshot().renamedTo).toBe('Third');
        // 宿主带回了新名字（或者别处改了名）：以宿主为准。
        controller.update({ descriptor: { ...naviPlaylist, name: 'Third' } });
        expect(controller.getSnapshot().renamedTo).toBeNull();
        controller.update({ descriptor: { ...naviPlaylist, name: 'Navi' } });
        expect(controller.getSnapshot().renamedTo).toBeNull();
    });

    it('keeps the old name when the rename fails', async () => {
        const resource = createStaticCollectionResource('k', [localSong('a')]);
        const port = fakePort();
        port.local.renamePlaylist = vi.fn(async () => { throw new Error('nope'); });
        const { controller } = setup({ descriptor: localPlaylist, resource, port });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await controller.rename('Other')).toEqual({ ok: false, reason: 'failed', message: 'nope' });
        expect(controller.getSnapshot().renamedTo).toBeNull();
    });

    it('renames a Navidrome playlist through its own port', async () => {
        const resource = await navidromeResource([naviSong('a')]);
        const { controller, port } = setup({ descriptor: naviPlaylist, resource });
        expect(await controller.rename('Renamed')).toEqual({ ok: true });
        expect(port.navidrome.renamePlaylist).toHaveBeenCalledWith('np', 'Renamed');
    });

    it('reports a failure with its message and clears the pending flag', async () => {
        const resource = createStaticCollectionResource('k', [localSong('a')]);
        const port = fakePort();
        port.local.deletePlaylist = vi.fn(async () => { throw new Error('nope'); });
        const { controller } = setup({ descriptor: localPlaylist, resource, port });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await controller.deleteCollection()).toEqual({ ok: false, reason: 'failed', message: 'nope' });
        expect(controller.getSnapshot().sourceActionPending).toBe(false);
    });

    it('deletes along the branch the collection belongs to', async () => {
        const folder = setup({ descriptor: localFolder, resource: createStaticCollectionResource('k', []) });
        expect(await folder.controller.deleteCollection()).toEqual({ ok: true });
        expect(folder.port.local.deleteFolder).toHaveBeenCalledWith(localFolder);

        const playlist = setup({ descriptor: localPlaylist, resource: createStaticCollectionResource('k', []) });
        expect(await playlist.controller.deleteCollection()).toEqual({ ok: true });
        expect(playlist.port.local.deletePlaylist).toHaveBeenCalledWith('pl-1');

        const navi = setup({ descriptor: naviPlaylist, resource: await navidromeResource([]) });
        expect(await navi.controller.deleteCollection()).toEqual({ ok: true });
        expect(navi.port.navidrome.deletePlaylist).toHaveBeenCalledWith('np');
    });

    it('resyncs, organizes and exports only where GridView offered them', async () => {
        const folder = setup({ descriptor: localFolder, resource: createStaticCollectionResource('k', []) });
        expect(await folder.controller.resyncFolder()).toEqual({ ok: true });
        expect(folder.port.local.resyncFolder).toHaveBeenCalledWith(localFolder);
        expect(await folder.controller.organizeSongInfo()).toEqual({ ok: true });
        expect(folder.port.local.organizeFolder).toHaveBeenCalledWith(localFolder);
        expect(await folder.controller.exportPlaylist()).toEqual({ ok: false, reason: 'unsupported' });
        expect(await folder.controller.resyncAllFolders()).toEqual({ ok: false, reason: 'unsupported' });

        const playlist = setup({ descriptor: localPlaylist, resource: createStaticCollectionResource('k', []) });
        expect(await playlist.controller.exportPlaylist()).toEqual({ ok: true });
        expect(playlist.port.local.exportPlaylist).toHaveBeenCalledWith('pl-1');
        expect(await playlist.controller.resyncFolder()).toEqual({ ok: false, reason: 'unsupported' });
        expect(playlist.port.local.resyncFolder).not.toHaveBeenCalled();

        const album = setup({ descriptor: localAlbum, resource: createStaticCollectionResource('k', []) });
        expect(await album.controller.editEntity()).toEqual({ ok: true });
        expect(album.port.local.editEntity).toHaveBeenCalledWith('e-al');
        expect(await album.controller.matchSong(onlineSong('x'))).toEqual({ ok: false, reason: 'unsupported' });
    });

    it('adds a Navidrome album to a playlist, or creates one, with the tracks the renderer passes', async () => {
        const resource = await navidromeResource([naviSong('a'), naviSong('b')]);
        const { controller, port } = setup({ descriptor: naviAlbum, resource });
        const tracks = resource.getSnapshot().tracks;

        expect(controller.getSnapshot().availablePlaylists).toEqual([{ id: 'np', name: 'Navi' }]);
        expect(await controller.addToPlaylist('np', tracks)).toEqual({ ok: true });
        expect(port.navidrome.addToPlaylist).toHaveBeenCalledWith('np', tracks);
        expect(await controller.createPlaylist('Fresh', tracks)).toEqual({ ok: true });
        expect(port.navidrome.createPlaylist).toHaveBeenCalledWith('Fresh', tracks);

        // Navidrome 歌单本身不提供「加入歌单」（与网格的按钮一致）。
        const navi = setup({ descriptor: naviPlaylist, resource });
        expect(await navi.controller.addToPlaylist('np', tracks)).toEqual({ ok: false, reason: 'unsupported' });
    });
});

describe('controller lifecycle', () => {
    it('follows the host: capabilities change with the inputs and only real changes notify', async () => {
        const { resource } = await onlineResource(ownedPlaylist(), [onlineSong('s0')]);
        const { controller, port } = setup({ descriptor: ownedPlaylist(), resource, currentUserId: null });
        const listener = vi.fn();
        controller.subscribe(listener);
        await settle();
        listener.mockClear();
        // 用户信息还没到：看起来是别人的歌单，可以订阅、不能删。
        expect(controller.getSnapshot().capabilities).toMatchObject({ subscribe: { supported: true }, removeEntry: { supported: false } });

        controller.update({ currentUserId: 'u1' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().capabilities).toMatchObject({ subscribe: { supported: false }, removeEntry: { supported: true } });

        const before = controller.getSnapshot();
        controller.update({ currentUserId: 'u1', port: { ...port } });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toBe(before);

        controller.update({ port: { ...port, navidrome: { ...port.navidrome, availablePlaylists: [{ id: 'n2', name: 'Other' }] } } });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot().availablePlaylists).toEqual([{ id: 'n2', name: 'Other' }]);
        expect(controller.getSnapshot().capabilities).toBe(before.capabilities);
    });

    it('after dispose: no notifications and a frozen snapshot, while the upstream request completes once', async () => {
        const { resource } = await onlineResource(ownedPlaylist(), [onlineSong('s0'), onlineSong('s1')]);
        const upstream = deferred<void>();
        const status = deferred<boolean>();
        const omni = fakeOmni({
            updateCollectionTracks: vi.fn(() => upstream.promise),
            getSubscriptionStatus: vi.fn(() => status.promise),
        });
        const { controller, port } = setup({ descriptor: ownedPlaylist(), resource, omni });
        const listener = vi.fn();
        controller.subscribe(listener);

        const pending = controller.removeEntry(entryIn(resource, 0));
        const frozen = controller.getSnapshot();
        listener.mockClear();
        controller.dispose();
        upstream.resolve();
        status.resolve(true);

        expect(await pending).toEqual({ ok: true });
        await settle();
        expect(listener).not.toHaveBeenCalled();
        expect(controller.getSnapshot()).toBe(frozen);
        expect(omni.updateCollectionTracks).toHaveBeenCalledTimes(1);
        // 上游已经删了：资源仍要与上游一致（在线资源可能留在 LRU 里，重进时被复用）。
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s1']);
        expect(port.onCollectionMutated).toHaveBeenCalledTimes(1);

        // 销毁之后的新动作一律不做。
        expect(await controller.removeEntry(entryIn(resource, 0))).toEqual({ ok: false, reason: 'stale' });
        expect(await controller.toggleSubscribe()).toEqual({ ok: false, reason: 'stale' });
        expect(await controller.rename('x')).toEqual({ ok: false, reason: 'stale' });
        expect(omni.updateCollectionTracks).toHaveBeenCalledTimes(1);
        expect(omni.subscribe).not.toHaveBeenCalled();
    });

    it('drops a late dislike result for the session but keeps the resource in step', async () => {
        const { resource } = await onlineResource(daily, [onlineSong('d0'), onlineSong('d1')]);
        const upstream = deferred<{ limitReached?: boolean; replacement?: SongResult }>();
        const omni = fakeOmni({ dislikeSong: vi.fn(() => upstream.promise) });
        const { controller } = setup({ descriptor: daily, resource, omni });

        const pending = controller.removeEntry(entryIn(resource, 0));
        controller.dispose();
        upstream.resolve({ limitReached: true });
        expect(await pending).toEqual({ ok: false, reason: 'limit-reached' });
        expect(controller.getSnapshot().dailyLimitReached).toBe(false);
    });
});

describe('resource edit bridge: removeAt', () => {
    it('removes exactly one entry and refuses a position that moved', async () => {
        const navi = await navidromeResource([naviSong('a'), naviSong('b'), naviSong('a')]);
        expect(navi.removeAt(2, 'navidrome:b')).toBe(false);
        expect(navi.removeAt(2, 'navidrome:a')).toBe(true);
        expect(ids(navi.getSnapshot().tracks)).toEqual(['a', 'b']);
        expect(navi.getSnapshot().hint).toBe('urgent');

        const local = createStaticCollectionResource('k', [localSong('a'), localSong('b')]);
        expect(local.removeAt(5, 'local:a')).toBe(false);
        expect(local.removeAt(0, 'local:a')).toBe(true);
        expect(ids(local.getSnapshot().tracks)).toEqual(['local-b']);
    });

    it('online: removes a single entry with a tombstone and invalidates the cache, but refuses a song that has other entries', async () => {
        const { resource, writes } = await onlineResource(ownedPlaylist(), [onlineSong('s0'), onlineSong('s1'), onlineSong('s0')]);
        const key = (id: string) => `online:p:${id}`;

        expect(resource.removeAt(0, key('s0'))).toBe(false);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s0', 's1', 's0']);
        expect(resource.removeAt(1, key('s1'))).toBe(true);
        expect(ids(resource.getSnapshot().tracks)).toEqual(['s0', 's0']);
        await settle();
        expect(writes.at(-1)).toMatchObject({ snapshotTime: expect.any(Number) });
        expect(writes.at(-1)?.snapshotTime).not.toBe(1000);
        expect(ids(writes.at(-1)!.tracks)).toEqual(['s0', 's0']);
    });
});
