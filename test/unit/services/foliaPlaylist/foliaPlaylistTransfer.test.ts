import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addSongsToFoliaPlaylist,
    createFoliaPlaylist,
    getFoliaPlaylist,
    getFoliaPlaylists,
    refreshFoliaPlaylistFromOrigin,
    removeFoliaPlaylistEntries,
    resetFoliaPlaylistStorage,
    saveCollectionAsFoliaPlaylist,
    type FoliaCounterpartResolver,
    type FoliaTransferDeps,
} from '@/services/foliaPlaylist/foliaPlaylistService';
import { foliaPlaylistsDatabase } from '@/services/foliaPlaylist/foliaPlaylistDatabase';
import { parseFoliaPlaylistRow } from '@/services/foliaPlaylist/foliaPlaylistRows';
import { appDatabase } from '@/services/appDatabase';
import type { SongResult } from '@/types';
import { FoliaNothingToSaveError } from '@/utils/foliaPlaylistTransfer';
import type { FoliaPlaylistInfo } from '@/types/foliaPlaylist';

// test/unit/services/foliaPlaylist/foliaPlaylistTransfer.test.ts
// 转存平台歌单与从原歌单刷新（存储这一层）：换音源的记账、目标音源问不成、刷新不丢用户自己加的条目、
// 等音源的时候用户改了歌单。

const online = (providerId: string, id: string, name = `song ${id}`): SongResult => ({
    id,
    name,
    artists: [{ id: 1, name: 'Singer' }],
    album: { id: 2, name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
} as SongResult);
const origin = { sourceId: 'netease', collectionId: 'pl-1', name: 'My List' };
const songs = ['1', '2', '3'].map(id => online('netease', id));
/** 这张歌单现在在库里的条目 key，按顺序（写操作返回的是摘要，条目从库里读回来看）。 */
const keysOf = async (playlist: Pick<FoliaPlaylistInfo, 'id'> | null | undefined) => (
    playlist ? (await getFoliaPlaylist(playlist.id))?.entries.map(entry => entry.key) : undefined
);

/** 目标音源 lx：对 ids 里的歌有对应的。 */
const resolver = (ids: readonly string[]): FoliaCounterpartResolver => vi.fn<FoliaCounterpartResolver>(async (_target, asked) => ({
    songs: asked.map(song => (ids.includes(String(song.id)) ? online('lx', `wy:${song.id}`, song.name) : null)),
}));
const depsOf = (resolveCounterparts: FoliaCounterpartResolver): FoliaTransferDeps => ({ resolveCounterparts });
const noTarget = depsOf(vi.fn(async () => { throw new Error('should not be asked'); }));

describe('saveCollectionAsFoliaPlaylist', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await resetFoliaPlaylistStorage();
    });

    it('saves the collection as it is when no target is chosen', async () => {
        const { playlist, result } = await saveCollectionAsFoliaPlaylist({ name: ' Saved ', songs, origin }, noTarget);
        expect(playlist.name).toBe('Saved');
        expect(playlist.origin).toMatchObject({ sourceId: 'netease', collectionId: 'pl-1', name: 'My List' });
        expect(playlist.origin).not.toHaveProperty('playVia');
        expect(await keysOf(playlist)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(result).toEqual({ swapped: 0, notSwapped: 3, duplicates: 0, rejected: 0 });
        expect(noTarget.resolveCounterparts).not.toHaveBeenCalled();
        expect(playlist).toMatchObject({ entryCount: 3 });
        const stored = await getFoliaPlaylist(playlist.id);
        expect(stored).toMatchObject({ id: playlist.id, name: 'Saved', origin: playlist.origin });
        expect((await getFoliaPlaylists()).map(item => item.id)).toContain(playlist.id);
    });

    it('swaps every song when the target has them all', async () => {
        const deps = depsOf(resolver(['1', '2', '3']));
        const { playlist, result } = await saveCollectionAsFoliaPlaylist({ name: 'Saved', songs, origin, playVia: 'lx' }, deps);
        expect(deps.resolveCounterparts).toHaveBeenCalledTimes(1);
        expect(deps.resolveCounterparts).toHaveBeenCalledWith('lx', songs);
        expect(await keysOf(playlist)).toEqual(['online:lx:wy:1', 'online:lx:wy:2', 'online:lx:wy:3']);
        expect((await getFoliaPlaylist(playlist.id))?.entries.map(entry => entry.originalKey)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(playlist.origin?.playVia).toBe('lx');
        expect(result).toEqual({ swapped: 3, notSwapped: 0, duplicates: 0, rejected: 0 });
    });

    it('swaps only the songs the target has, and says how many of each', async () => {
        const { playlist, result } = await saveCollectionAsFoliaPlaylist({ name: 'Saved', songs, origin, playVia: 'lx' }, depsOf(resolver(['2'])));
        expect(await keysOf(playlist)).toEqual(['online:netease:1', 'online:lx:wy:2', 'online:netease:3']);
        expect(result).toEqual({ swapped: 1, notSwapped: 2, duplicates: 0, rejected: 0 });
        // 读回来还是一样（标记都留着）。
        const stored = await getFoliaPlaylist(playlist.id);
        expect(stored?.entries.map(entry => [entry.fromOrigin, entry.originalKey])).toEqual([
            [true, undefined], [true, 'online:netease:2'], [true, undefined],
        ]);
    });

    it('still saves everything when the target cannot be asked, and remembers the target', async () => {
        const unavailable = depsOf(async (_target, asked) => ({ songs: asked.map(() => null), unavailable: 'not-configured' }));
        const first = await saveCollectionAsFoliaPlaylist({ name: 'A', songs, origin, playVia: 'lx' }, unavailable);
        expect(await keysOf(first.playlist)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(first.result).toEqual({ swapped: 0, notSwapped: 3, duplicates: 0, rejected: 0, playViaUnavailable: 'not-configured' });
        expect(first.playlist.origin?.playVia).toBe('lx');

        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const second = await saveCollectionAsFoliaPlaylist({ name: 'B', songs, origin, playVia: 'lx' }, depsOf(async () => { throw new Error('boom'); }));
        expect(await keysOf(second.playlist)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(second.result.playViaUnavailable).toBe('failed');
        vi.restoreAllMocks();

        // 问了，但全都超时或出错：也说出来；只是一部分没问成的另外记首数（下一条），问了没有对应的不算。
        const allFailed = depsOf(async (_target, asked) => ({ songs: asked.map(() => null), asked: 3, failed: 3 }));
        expect((await saveCollectionAsFoliaPlaylist({ name: 'C', songs, origin, playVia: 'lx' }, allFailed)).result.playViaUnavailable).toBe('failed');
        const someFailed = depsOf(async (_target, asked) => ({ songs: asked.map(() => null), asked: 3, failed: 1 }));
        expect((await saveCollectionAsFoliaPlaylist({ name: 'D', songs, origin, playVia: 'lx' }, someFailed)).result).not.toHaveProperty('playViaUnavailable');
    });

    it('counts the songs the target could not be asked about when only some of them failed', async () => {
        // 第 1 首问成了并换过去，第 2 首问成了但没有对应的，第 3 首没问成。
        const partly = depsOf(async (_target, asked) => ({ songs: asked.map((song, index) => (index === 0 ? online('lx', `wy:${song.id}`) : null)), asked: 3, failed: 1 }));
        const { playlist, result } = await saveCollectionAsFoliaPlaylist({ name: 'Partly', songs, origin, playVia: 'lx' }, partly);
        expect(await keysOf(playlist)).toEqual(['online:lx:wy:1', 'online:netease:2', 'online:netease:3']);
        expect(result).toEqual({ swapped: 1, notSwapped: 2, duplicates: 0, rejected: 0, playViaFailed: 1 });

        // 都问成了：没有这一项。
        const all = await saveCollectionAsFoliaPlaylist({ name: 'All asked', songs, origin, playVia: 'lx' }, depsOf(async (_target, asked) => ({ songs: asked.map(() => null), asked: 3, failed: 0 })));
        expect(all.result).not.toHaveProperty('playViaFailed');

        // 从原歌单更新也一样记。
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [...songs, online('netease', '4')], depsOf(async (_target, asked) => ({ songs: asked.map(() => null), asked: 3, failed: 2 })));
        expect(refreshed?.result).toMatchObject({ added: 1, swapped: 0, playViaFailed: 2 });
        expect(refreshed?.result).not.toHaveProperty('playViaUnavailable');
    });

    it('creates no playlist when none of the songs can go into one', async () => {
        const stage = (id: string): SongResult => ({ ...online('netease', id), sourceRef: { kind: 'stage', mediaId: id } } as SongResult);
        const before = (await getFoliaPlaylists()).map(item => item.id);
        const attempt = saveCollectionAsFoliaPlaylist({ name: 'Stage only', songs: [stage('a'), stage('b')], origin }, noTarget);
        await expect(attempt).rejects.toBeInstanceOf(FoliaNothingToSaveError);
        await expect(attempt).rejects.toMatchObject({ rejected: 2 });
        expect((await getFoliaPlaylists()).map(item => item.id)).toEqual(before);

        // 有一首能收就照常建，不收的计在结果里。
        const { playlist, result } = await saveCollectionAsFoliaPlaylist({ name: 'Mixed', songs: [stage('a'), songs[0]], origin }, noTarget);
        expect(await keysOf(playlist)).toEqual(['online:netease:1']);
        expect(result).toEqual({ swapped: 0, notSwapped: 1, duplicates: 0, rejected: 1 });
    });

    it('does not ask when the target is the origin source, and rejects an empty name before asking', async () => {
        const { playlist } = await saveCollectionAsFoliaPlaylist({ name: 'Same', songs, origin, playVia: 'netease' }, noTarget);
        expect(playlist.origin).not.toHaveProperty('playVia');
        const deps = depsOf(resolver(['1']));
        await expect(saveCollectionAsFoliaPlaylist({ name: '  ', songs, origin, playVia: 'lx' }, deps)).rejects.toThrow();
        await expect(saveCollectionAsFoliaPlaylist({ name: 'x', songs, origin: { ...origin, collectionId: '' } }, deps)).rejects.toThrow();
        expect(deps.resolveCounterparts).not.toHaveBeenCalled();
    });
});

describe('refreshFoliaPlaylistFromOrigin', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await resetFoliaPlaylistStorage();
    });

    const save = async (deps: FoliaTransferDeps = noTarget, playVia?: string) => (
        (await saveCollectionAsFoliaPlaylist({ name: 'Saved', songs, origin, ...(playVia ? { playVia } : {}) }, deps)).playlist
    );

    it('is null for a playlist that is not there or was not saved from a collection', async () => {
        const fetch = vi.fn(async () => songs);
        expect(await refreshFoliaPlaylistFromOrigin('missing', fetch, noTarget)).toBeNull();
        const own = await createFoliaPlaylist('Mine', songs);
        expect(await refreshFoliaPlaylistFromOrigin(own.id, fetch, noTarget)).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('adds what the origin gained, keeps what it lost and what the user added', async () => {
        const playlist = await save();
        await addSongsToFoliaPlaylist(playlist.id, [online('qq', 'mine')]);
        const fetch = vi.fn(async () => [songs[2], songs[0], online('netease', '4')]);
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, fetch, noTarget);
        expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'netease', collectionId: 'pl-1' }));
        // 3、1 填原来 1、2 占的两个位置；原歌单里没有了的 2 留在原地（它排第 2，所以填的是第 1、3 两个位置）。
        expect(await keysOf(refreshed?.playlist)).toEqual(['online:netease:3', 'online:netease:2', 'online:netease:1', 'online:qq:mine', 'online:netease:4']);
        expect(refreshed?.result).toEqual({ added: 1, swapped: 0, detached: 1, duplicates: 0, rejected: 0 });
        expect(refreshed?.playlist.origin?.refreshedAt).toEqual(expect.any(Number));
        expect(await keysOf(await getFoliaPlaylist(playlist.id))).toEqual(await keysOf(refreshed?.playlist));
    });

    it('swaps new songs through the target chosen when it was saved', async () => {
        const playlist = await save(depsOf(resolver(['1'])), 'lx');
        expect(await keysOf(playlist)).toEqual(['online:lx:wy:1', 'online:netease:2', 'online:netease:3']);
        const deps = depsOf(resolver(['1', '4']));
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [...songs, online('netease', '4'), online('netease', '5')], deps);
        expect(deps.resolveCounterparts).toHaveBeenCalledWith('lx', expect.any(Array));
        expect(await keysOf(refreshed?.playlist)).toEqual([
            'online:lx:wy:1', 'online:netease:2', 'online:netease:3', 'online:lx:wy:4', 'online:netease:5',
        ]);
        expect(refreshed?.result).toMatchObject({ added: 2, swapped: 1, detached: 0 });
        expect(refreshed?.playlist.origin?.playVia).toBe('lx');
    });

    it('refreshes without swapping when the target cannot be asked now', async () => {
        const playlist = await save(depsOf(resolver(['1', '2', '3'])), 'lx');
        const off = depsOf(async (_target, asked) => ({ songs: asked.map(() => null), unavailable: 'switched-off' }));
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [...songs, online('netease', '4')], off);
        expect(await keysOf(refreshed?.playlist)).toEqual(['online:lx:wy:1', 'online:lx:wy:2', 'online:lx:wy:3', 'online:netease:4']);
        expect(refreshed?.result).toMatchObject({ added: 1, swapped: 0, detached: 0, playViaUnavailable: 'switched-off' });
        // 目标音源还记着：下次能问了，没换的那首也换过去。
        const again = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [...songs, online('netease', '4')], depsOf(resolver(['4'])));
        expect(await keysOf(again?.playlist)).toEqual(['online:lx:wy:1', 'online:lx:wy:2', 'online:lx:wy:3', 'online:lx:wy:4']);
        expect(again?.result).toMatchObject({ added: 0, swapped: 1 });
    });

    it('takes a new target, or none, when the caller says so', async () => {
        const playlist = await save();
        const deps = depsOf(resolver(['2']));
        const withTarget = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => songs, deps, { playVia: 'lx' });
        expect(await keysOf(withTarget?.playlist)).toEqual(['online:netease:1', 'online:lx:wy:2', 'online:netease:3']);
        expect(withTarget?.playlist.origin?.playVia).toBe('lx');
        const without = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [...songs, online('netease', '4')], noTarget, { playVia: null });
        expect(without?.playlist.origin).not.toHaveProperty('playVia');
        // 已经换过的不换回去。
        expect(await keysOf(without?.playlist)).toEqual(['online:netease:1', 'online:lx:wy:2', 'online:netease:3', 'online:netease:4']);
    });

    it('writes nothing when the origin cannot be read, or reads back empty', async () => {
        const playlist = await save();
        await addSongsToFoliaPlaylist(playlist.id, [online('qq', 'mine')]);
        const before = await getFoliaPlaylist(playlist.id);
        await expect(refreshFoliaPlaylistFromOrigin(playlist.id, async () => { throw new Error('offline'); }, noTarget)).rejects.toThrow('offline');
        expect(await getFoliaPlaylist(playlist.id)).toEqual(before);
        const empty = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [], noTarget);
        expect(empty?.result).toEqual({ added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0, originEmpty: true });
        expect(await getFoliaPlaylist(playlist.id)).toEqual(before);
    });

    it('keeps what the user did to the playlist while the source was being asked', async () => {
        const playlist = await save();
        let release: (songs: SongResult[]) => void = () => {};
        const pending = refreshFoliaPlaylistFromOrigin(playlist.id, () => new Promise<SongResult[]>((resolve) => { release = resolve; }), noTarget);
        // 等原歌单的时候：用户加了一首、删了一首。
        await addSongsToFoliaPlaylist(playlist.id, [online('qq', 'mine')]);
        await removeFoliaPlaylistEntries(playlist.id, ['online:netease:2']);
        // 让 refresh 走到 fetch 之后再放行。
        await new Promise(resolve => setTimeout(resolve, 10));
        release([...songs, online('netease', '4')]);
        const refreshed = await pending;
        // 用户加的还在；用户删的那首原歌单里还有，所以又回来了（跟着原歌单的歌单就是这样）。
        expect(await keysOf(refreshed?.playlist)).toEqual(['online:netease:1', 'online:netease:2', 'online:qq:mine', 'online:netease:3', 'online:netease:4']);
        expect((await getFoliaPlaylist(playlist.id))?.entries.find(entry => entry.key === 'online:qq:mine')?.fromOrigin).toBeUndefined();
    });

    it('keeps fields of a later version on the playlist and its entries', async () => {
        const playlist = await save();
        await foliaPlaylistsDatabase.playlists.update(playlist.id, { later: 'kept' } as never);
        await foliaPlaylistsDatabase.entries.toCollection().modify({ note: 'n' } as never);
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [songs[1], songs[0], songs[2]], noTarget);
        expect(refreshed?.playlist).toMatchObject({ later: 'kept' });
        const stored = await getFoliaPlaylist(playlist.id);
        expect(stored?.entries).toHaveLength(3);
        expect(stored?.entries.every(entry => (entry as unknown as { note: string }).note === 'n')).toBe(true);
    });
});

describe('stored marks', () => {
    it('reads the marks back strictly, and old rows without them stay as they were', () => {
        const row = parseFoliaPlaylistRow({
            id: 'p',
            name: 'P',
            origin: { sourceId: 'netease', collectionId: 'c', name: 'n', savedAt: 1, playVia: 'lx', refreshedAt: 5 },
            entries: [
                { key: 'a', song: {}, addedAt: 1, fromOrigin: true },
                { key: 'b', song: {}, addedAt: 1, fromOrigin: 'yes' },
                { key: 'c', song: {}, addedAt: 1 },
            ],
        });
        expect(row?.origin).toEqual({ sourceId: 'netease', collectionId: 'c', name: 'n', savedAt: 1, playVia: 'lx', refreshedAt: 5 });
        expect(row?.entries.map(entry => entry.fromOrigin)).toEqual([true, undefined, undefined]);
        const old = parseFoliaPlaylistRow({ id: 'p', name: 'P', origin: { sourceId: 'netease', collectionId: 'c', name: 'n', savedAt: 1, playVia: 3 }, entries: [] });
        expect(old?.origin).toEqual({ sourceId: 'netease', collectionId: 'c', name: 'n', savedAt: 1 });
        // 以后的版本在 origin 上加的字段留着。
        const later = parseFoliaPlaylistRow({ id: 'p', origin: { sourceId: 'netease', collectionId: 'c', name: 'n', savedAt: 1, later: 'kept' }, entries: [] });
        expect(later?.origin).toMatchObject({ later: 'kept' });
    });
});

describe('what the interface adds: the kind of the original, and cancelling', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await resetFoliaPlaylistStorage();
    });

    it('keeps the kind of the original and the data its source reads it with, through a refresh', async () => {
        const { playlist } = await saveCollectionAsFoliaPlaylist({
            name: 'Album copy',
            songs,
            origin: { ...origin, collectionType: 'album', collectionData: { mid: 'abc' } },
        }, noTarget);
        expect(playlist.origin).toMatchObject({ collectionType: 'album', collectionData: { mid: 'abc' } });

        const seen: unknown[] = [];
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, async stored => {
            seen.push(stored);
            return [...songs, online('netease', '4')];
        }, noTarget);
        expect(seen[0]).toMatchObject({ collectionType: 'album', collectionData: { mid: 'abc' } });
        expect(refreshed?.playlist.origin).toMatchObject({ collectionType: 'album', collectionData: { mid: 'abc' } });
        expect((await getFoliaPlaylist(playlist.id))?.origin).toMatchObject({ collectionType: 'album', collectionData: { mid: 'abc' } });
    });

    it('writes nothing when saving was cancelled while the target was being asked', async () => {
        const controller = new AbortController();
        const deps = depsOf(vi.fn<FoliaCounterpartResolver>(async (_target, asked) => {
            controller.abort();
            return { songs: asked.map(() => null) };
        }));
        const before = (await getFoliaPlaylists()).length;
        await expect(saveCollectionAsFoliaPlaylist({ name: 'Cancelled', songs, origin, playVia: 'lx', signal: controller.signal }, deps))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect((await getFoliaPlaylists()).length).toBe(before);
    });

    it('leaves the playlist as it was when a refresh was cancelled while the original was being read', async () => {
        const { playlist } = await saveCollectionAsFoliaPlaylist({ name: 'Saved', songs, origin }, noTarget);
        const controller = new AbortController();
        await expect(refreshFoliaPlaylistFromOrigin(playlist.id, async () => {
            controller.abort();
            return [...songs, online('netease', '4')];
        }, noTarget, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        const stored = await getFoliaPlaylist(playlist.id);
        expect(await keysOf(stored)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(stored?.origin).not.toHaveProperty('refreshedAt');
    });
});
