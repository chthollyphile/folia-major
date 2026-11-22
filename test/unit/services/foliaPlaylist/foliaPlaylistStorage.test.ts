import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    addSongsToFoliaPlaylist,
    createFoliaPlaylist,
    createFoliaPlaylistFromEntries,
    deleteFoliaPlaylist,
    getFoliaPlaylist,
    getFoliaPlaylistEntryKeys,
    getFoliaPlaylistSummaries,
    getFoliaPlaylists,
    findFoliaPlaylistEntryKeys,
    removeFoliaPlaylistEntries,
    reorderFoliaPlaylistEntries,
    resetFoliaPlaylistStorage,
    setFoliaSongFavorite,
    toggleFoliaSongFavorite,
} from '@/services/foliaPlaylist/foliaPlaylistService';
import { FOLIA_PLAYLISTS_STATE_KEY, FoliaPlaylistsDatabase, foliaPlaylistsDatabase } from '@/services/foliaPlaylist/foliaPlaylistDatabase';
import { FOLIA_POSITION_STEP, appendPositions, planReorder, renumberedPositions } from '@/services/foliaPlaylist/foliaPlaylistPositions';
import { FOLIA_PLAYLISTS_META_KEY, foliaPlaylistRowKey } from '@/services/foliaPlaylist/foliaPlaylistRows';
import { FOLIA_COVER_SCAN_ENTRIES } from '@/services/foliaPlaylist/foliaPlaylistStorage';
import { appDatabase } from '@/services/appDatabase';
import type { LocalSong, SongResult } from '@/types';
import type { FoliaPlaylist, FoliaPlaylistEntry } from '@/types/foliaPlaylist';

// test/unit/services/foliaPlaylist/foliaPlaylistStorage.test.ts
// Folia 聚合歌单按条目存的那一层：位置号、把「一张歌单一行」的旧结构搬过来（空、只有旧行、搬到一半断了再来、
// 已经搬过）、加删重排之后的顺序、并发的写、一次操作写了几行（和歌单多大无关）。

const online = (providerId: string, id: number | string, coverUrl?: string): SongResult => ({
    id,
    name: `song ${id}`,
    artists: [{ id: 1, name: 'Singer' }],
    album: { id: 2, name: 'Album', ...(coverUrl ? { coverUrl } : {}) },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId, mediaId: String(id) },
} as SongResult);
const entryOf = (providerId: string, id: number | string, addedAt = 1): FoliaPlaylistEntry => ({
    key: `online:${providerId}:${id}`,
    song: online(providerId, id),
    addedAt,
});
const entryRowsOf = (playlistId: string) => (
    foliaPlaylistsDatabase.entries.where('[playlistId+pos]').between([playlistId, -Infinity], [playlistId, Infinity]).toArray()
);
const keysInOrder = async (playlistId: string) => (await entryRowsOf(playlistId)).map(row => row.key);
const positionsOf = async (playlistId: string) => (await entryRowsOf(playlistId)).map(row => row.pos);
/** 像重开应用那样：下一次读写重新准备存储。 */
const reopen = () => resetFoliaPlaylistStorage({ keepData: true });

/** 数这段时间里歌单库的两张表各写了几行（新建、改、删都算）。 */
const countWrites = async (run: () => Promise<unknown>): Promise<{ entries: number; playlists: number }> => {
    const counts = { entries: 0, playlists: 0 };
    const hooks = (['entries', 'playlists'] as const).flatMap((name) => {
        const table = foliaPlaylistsDatabase[name];
        const bump = () => { counts[name] += 1; };
        table.hook('creating', bump);
        table.hook('updating', bump);
        table.hook('deleting', bump);
        return () => {
            table.hook('creating').unsubscribe(bump);
            table.hook('updating').unsubscribe(bump);
            table.hook('deleting').unsubscribe(bump);
        };
    });
    try {
        await run();
    } finally {
        hooks.forEach(off => off());
    }
    return counts;
};

// ---- 旧结构：api_cache 里一张歌单一行 ----
const oldPlaylist = (id: string, name: string, keys: readonly (number | string)[], patch: Partial<FoliaPlaylist> = {}): FoliaPlaylist => ({
    id,
    name,
    createdAt: 10,
    updatedAt: 20,
    entries: keys.map((key, index) => entryOf('netease', key, index + 1)),
    ...patch,
});
const putOldRows = async (playlists: readonly unknown[], order: readonly string[], meta: Record<string, unknown> = {}) => {
    await appDatabase.api_cache.bulkPut(playlists.map(playlist => ({
        key: foliaPlaylistRowKey((playlist as { id: string }).id),
        data: playlist,
        timestamp: 1,
    })));
    await appDatabase.api_cache.put({
        key: FOLIA_PLAYLISTS_META_KEY,
        data: { version: 1, order: [...order], localPlaylistsMigratedAt: 5, localPlaylistsMigratedCount: 0, ...meta },
        timestamp: 1,
    });
};

beforeEach(async () => {
    await appDatabase.delete();
    await appDatabase.open();
    await resetFoliaPlaylistStorage();
});

describe('positions', () => {
    it('appends after the last position, with room in between', () => {
        expect(appendPositions(null, 3)).toEqual([FOLIA_POSITION_STEP, 2 * FOLIA_POSITION_STEP, 3 * FOLIA_POSITION_STEP]);
        expect(appendPositions(5000, 2)).toEqual([5000 + FOLIA_POSITION_STEP, 5000 + 2 * FOLIA_POSITION_STEP]);
        expect(renumberedPositions(0)).toEqual([]);
    });

    const current = (keys: readonly string[], positions = renumberedPositions(keys.length)) => keys.map((key, index) => ({ key, position: positions[index] }));
    const applied = (items: ReadonlyArray<{ key: string; position: number }>, plan: ReturnType<typeof planReorder>) => (
        items.map(item => ({ key: item.key, position: plan.positions.get(item.key) ?? item.position }))
            .sort((first, second) => first.position - second.position)
    );

    it('changes nothing when the order is the same', () => {
        const plan = planReorder(current(['a', 'b', 'c']), ['a', 'b', 'c']);
        expect(plan.kind).toBe('move');
        expect(plan.positions.size).toBe(0);
    });

    it('moves only the entries that changed place', () => {
        const items = current(['a', 'b', 'c', 'd', 'e']);
        // 把 e 拖到最前：只有 e 换号。
        const toFront = planReorder(items, ['e', 'a', 'b', 'c', 'd']);
        expect([...toFront.positions.keys()]).toEqual(['e']);
        expect(applied(items, toFront).map(item => item.key)).toEqual(['e', 'a', 'b', 'c', 'd']);
        // 把 a 拖到最后。
        const toEnd = planReorder(items, ['b', 'c', 'd', 'e', 'a']);
        expect([...toEnd.positions.keys()]).toEqual(['a']);
        expect(applied(items, toEnd).map(item => item.key)).toEqual(['b', 'c', 'd', 'e', 'a']);
        // 把 d 拖到 a 和 b 之间。
        const between = planReorder(items, ['a', 'd', 'b', 'c', 'e']);
        expect([...between.positions.keys()]).toEqual(['d']);
        expect(applied(items, between).map(item => item.key)).toEqual(['a', 'd', 'b', 'c', 'e']);
    });

    it('gives every moved entry its own whole number, in the order asked for', () => {
        const keys = Array.from({ length: 200 }, (_, index) => `k${index}`);
        const items = current(keys);
        const shuffled = [...keys].sort((first, second) => (first.length - second.length) || second.localeCompare(first)).reverse();
        const plan = planReorder(items, shuffled);
        const after = applied(items, plan);
        expect(after.map(item => item.key)).toEqual(shuffled);
        expect(new Set(after.map(item => item.position)).size).toBe(keys.length);
        expect(after.every(item => Number.isSafeInteger(item.position))).toBe(true);
    });

    it('renumbers the whole playlist when a gap is too small', () => {
        const tight = current(['a', 'b', 'c', 'd'], [1, 2, 3, 4]);
        const squeezed = planReorder(tight, ['a', 'd', 'b', 'c']);
        // 留下 a、b、c（最长的一串），d 要放进 a 和 b 之间：1 和 2 之间没有整数。
        expect(squeezed.kind).toBe('renumber');
        expect(squeezed.positions.size).toBe(4);
        expect(applied(tight, squeezed).map(item => item.key)).toEqual(['a', 'd', 'b', 'c']);
        expect(applied(tight, squeezed).map(item => item.position)).toEqual(renumberedPositions(4));
    });

    it('keeps working when the same entry is dragged between the same neighbours again and again', async () => {
        const playlist = await createFoliaPlaylist('Mix', [1, 2, 3].map(id => online('netease', id)));
        let order = await keysInOrder(playlist.id);
        // 每次把最后一条拖到第一条后面：那个空隙每次减半，十来次之后装不下，整张重新编号，顺序照样对。
        for (let round = 0; round < 40; round += 1) {
            const next = [order[0], order[order.length - 1], ...order.slice(1, -1)];
            expect(await reorderFoliaPlaylistEntries(playlist.id, next, order)).not.toBeNull();
            order = await keysInOrder(playlist.id);
            expect(order).toEqual(next);
        }
        const positions = await positionsOf(playlist.id);
        expect(new Set(positions).size).toBe(3);
    });
});

describe('moving the one-row-per-playlist structure over', () => {
    it('has nothing to move on a new profile: only the favorite playlist, and the mark', async () => {
        const summaries = await getFoliaPlaylistSummaries();
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toMatchObject({ isFavorite: true, entryCount: 0 });
        expect(await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY)).toMatchObject({ version: 1, importedFrom: 'nothing', importedCount: 0 });
        expect(await appDatabase.api_cache.count()).toBe(0);
    });

    it('moves every playlist with its order, times, origin, entries and fields it does not know, and leaves the old rows alone', async () => {
        const origin = { sourceId: 'netease', collectionId: 'pl-1', name: 'Theirs', savedAt: 3, playVia: 'lxmusic' };
        const saved = {
            ...oldPlaylist('saved', 'Saved', [7, 8, 9], { origin }),
            pinned: true,
            entries: [
                { ...entryOf('lxmusic', 'wy:7', 100), originalKey: 'online:netease:7', fromOrigin: true, note: 'later version' },
                { ...entryOf('netease', 8, 101), fromOrigin: true },
                { key: 'local:l1', song: { id: 1, name: 'Local', localRef: { songId: 'l1' } }, addedAt: 102 },
            ],
        };
        const favorite = oldPlaylist('fav', 'Liked Songs', [1, 2], { isFavorite: true, createdAt: 1, updatedAt: 2 });
        const empty = oldPlaylist('empty', 'Empty', []);
        // 条目里那首本地歌曲库里有（没有的话读列表时会被修掉，那是另一回事）。
        await appDatabase.local_music.put({
            id: 'l1',
            fileName: 'l1.mp3',
            filePath: 'Library/l1.mp3',
            title: 'l1',
            titleOrigin: 'import',
            importedMetadata: { title: 'l1', titleSource: 'filename', artistNames: ['Artist'] },
            duration: 1000,
            fileSize: 1234,
            fileLastModified: 1000,
            mimeType: 'audio/mpeg',
            addedAt: 100,
            folderName: 'Library',
        } as LocalSong);
        // 存的先后和行的键的先后不一样：按旧 meta 里的 order。
        await putOldRows([saved, favorite, empty], ['saved', 'fav', 'empty']);
        const before = await appDatabase.api_cache.toArray();

        const summaries = await getFoliaPlaylistSummaries();
        expect(summaries.map(item => [item.id, item.name, item.createdAt, item.updatedAt, Boolean(item.isFavorite), item.entryCount])).toEqual([
            ['saved', 'Saved', 10, 20, false, 3],
            ['fav', 'Liked Songs', 1, 2, true, 2],
            ['empty', 'Empty', 10, 20, false, 0],
        ]);
        expect(summaries[0]).toMatchObject({ origin, pinned: true, coverLocalSongIds: ['l1'] });
        // 没有第二张「我喜欢的音乐」。
        expect(summaries.filter(item => item.isFavorite)).toHaveLength(1);

        const stored = await getFoliaPlaylist('saved');
        expect(stored?.entries).toEqual(saved.entries);
        expect(stored).not.toHaveProperty('entryCount');
        expect((await getFoliaPlaylist('fav'))?.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:netease:2']);
        expect(await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY)).toMatchObject({ importedFrom: 'folia-rows', importedCount: 3 });
        // 旧的行一个字都没动。
        expect(await appDatabase.api_cache.toArray()).toEqual(before);
    });

    it('moves the rows even when the old meta row is damaged or missing, and skips a row it cannot read', async () => {
        await putOldRows([oldPlaylist('b', 'B', [2]), oldPlaylist('a', 'A', [1], { createdAt: 5 })], []);
        await appDatabase.api_cache.put({ key: FOLIA_PLAYLISTS_META_KEY, data: 'garbage', timestamp: 1 });
        await appDatabase.api_cache.put({ key: foliaPlaylistRowKey('broken'), data: { name: 'no id' }, timestamp: 1 });

        const summaries = await getFoliaPlaylistSummaries();
        // 「我喜欢的音乐」补一张在最前；旧 meta 没提到的歌单按建的时间。
        expect(summaries.map(item => item.name)).toEqual(['Liked Songs', 'A', 'B']);
        expect(await appDatabase.api_cache.get(foliaPlaylistRowKey('broken'))).toBeDefined();
    });

    it('picks up where it stopped when it was interrupted half way, without doubling anything', async () => {
        const playlists = ['one', 'two', 'three', 'four'].map((id, index) => oldPlaylist(id, id.toUpperCase(), [index * 10 + 1, index * 10 + 2]));
        await putOldRows(playlists, ['four', 'three', 'two', 'one']);
        let created = 0;
        const failOnThird = () => {
            created += 1;
            if (created === 3) throw new Error('window closed');
        };
        foliaPlaylistsDatabase.playlists.hook('creating', failOnThird);
        try {
            await expect(getFoliaPlaylistSummaries()).rejects.toThrow('window closed');
        } finally {
            foliaPlaylistsDatabase.playlists.hook('creating').unsubscribe(failOnThird);
        }
        // 断在第三张：前两张已经在了（各自一个事务），第三张的条目没有留下半截，标记还没写。
        expect(await foliaPlaylistsDatabase.playlists.count()).toBe(2);
        expect(await foliaPlaylistsDatabase.entries.count()).toBe(4);
        const halfWay = await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
        expect(typeof halfWay?.importStartedAt).toBe('number');
        expect(halfWay?.importedAt).toBeUndefined();

        await reopen();
        const summaries = await getFoliaPlaylistSummaries();
        expect(summaries.map(item => item.id)).toEqual([expect.stringMatching(/^folia_playlist_/), 'four', 'three', 'two', 'one']);
        expect(summaries.map(item => item.entryCount)).toEqual([0, 2, 2, 2, 2]);
        expect(await foliaPlaylistsDatabase.entries.count()).toBe(8);
        expect((await getFoliaPlaylist('three'))?.entries.map(entry => entry.key)).toEqual(['online:netease:21', 'online:netease:22']);
        expect(typeof (await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY))?.importedAt).toBe('number');
    });

    it('moves once: what happens to the old rows afterwards changes nothing, and a deleted playlist stays deleted', async () => {
        await putOldRows([oldPlaylist('keep', 'Keep', [1]), oldPlaylist('gone', 'Gone', [2])], ['keep', 'gone']);
        await getFoliaPlaylistSummaries();
        const movedAt = (await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY))?.importedAt;
        expect(await deleteFoliaPlaylist('gone')).toBe(true);
        await addSongsToFoliaPlaylist('keep', [online('qq', 5)]);
        // 回到旧版本用了一阵又升回来：旧的行变了、多了一张。
        await putOldRows([oldPlaylist('keep', 'Keep (old)', [1, 3, 4]), oldPlaylist('gone', 'Gone', [2]), oldPlaylist('late', 'Late', [9])], ['keep', 'gone', 'late']);

        await reopen();
        const playlists = await getFoliaPlaylists();
        expect(playlists.map(item => [item.name, item.entries.map(entry => entry.key)])).toEqual([
            ['Liked Songs', []],
            ['Keep', ['online:netease:1', 'online:qq:5']],
        ]);
        expect((await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY))?.importedAt).toBe(movedAt);
    });

    it('moves once even when the first reads race', async () => {
        await putOldRows([oldPlaylist('a', 'A', [1, 2]), oldPlaylist('fav', 'Liked Songs', [3], { isFavorite: true })], ['fav', 'a']);
        const reads = await Promise.all([getFoliaPlaylistSummaries(), getFoliaPlaylist('a'), getFoliaPlaylistEntryKeys('fav'), setFoliaSongFavorite(online('qq', 1), true)]);
        expect(reads[0].map(item => item.id)).toEqual(['fav', 'a']);
        expect(reads[1]?.entries).toHaveLength(2);
        expect(await foliaPlaylistsDatabase.playlists.count()).toBe(2);
        expect((await getFoliaPlaylistEntryKeys('fav')).sort()).toEqual(['online:netease:3', 'online:qq:1']);
    });

    it('does not move again when the mark is gone but playlists are there: a deleted playlist stays deleted', async () => {
        await putOldRows([oldPlaylist('a', 'A', [1]), oldPlaylist('b', 'B', [2])], ['a', 'b']);
        await getFoliaPlaylistSummaries();
        await foliaPlaylistsDatabase.playlists.delete('b');
        await foliaPlaylistsDatabase.meta.delete(FOLIA_PLAYLISTS_STATE_KEY);
        await reopen();
        expect((await getFoliaPlaylistSummaries()).map(item => item.name)).toEqual(['Liked Songs', 'A']);
        const state = await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
        expect(state?.importedFrom).toBe('nothing');
        expect(state?.importedAt).toBeTypeOf('number');
    });

    it('does not take another window that is half way through the move for a lost mark', async () => {
        await putOldRows(['one', 'two', 'three'].map((id, index) => oldPlaylist(id, id, [index + 1])), ['one', 'two', 'three']);
        // 这个窗口第一次读标记读到「没有」；紧接着另一个窗口开始搬：写了「开始搬了」，第一张也进来了。
        const meta = foliaPlaylistsDatabase.meta as unknown as { get: (key: string) => Promise<unknown> };
        const original = meta.get.bind(meta);
        let first = true;
        meta.get = (key: string) => {
            if (!first) return original(key);
            first = false;
            return (async () => {
                const value = await original(key);
                const other = new FoliaPlaylistsDatabase();
                await other.meta.put({ key: FOLIA_PLAYLISTS_STATE_KEY, version: 1, importStartedAt: 1 });
                await other.playlists.put({ id: 'one', name: 'one', createdAt: 10, updatedAt: 20, rank: 0, entryCount: 0 });
                other.close();
                return value;
            })();
        };
        try {
            const summaries = await getFoliaPlaylistSummaries();
            expect(summaries.map(item => item.id).slice(1)).toEqual(['one', 'two', 'three']);
            expect((await foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY))?.importedFrom).toBe('folia-rows');
        } finally {
            meta.get = original;
        }
    });

    it('keeps the order of a very long playlist', async () => {
        const keys = Array.from({ length: 3000 }, (_, index) => (index * 7919) % 3001);
        await putOldRows([oldPlaylist('long', 'Long', keys)], ['long']);
        const stored = await getFoliaPlaylist('long');
        expect(stored?.entries.map(entry => entry.key)).toEqual(keys.map(key => `online:netease:${key}`));
        expect((await getFoliaPlaylistSummaries()).find(item => item.id === 'long')?.entryCount).toBe(3000);
    });
});

describe('order after adding, removing and reordering', () => {
    it('keeps the entries in the order a user would see', async () => {
        const playlist = await createFoliaPlaylist('Mix', [1, 2, 3, 4].map(id => online('netease', id)));
        const key = (id: number) => `online:netease:${id}`;
        await addSongsToFoliaPlaylist(playlist.id, [online('netease', 5), online('netease', 2), online('netease', 6)]);
        expect(await keysInOrder(playlist.id)).toEqual([1, 2, 3, 4, 5, 6].map(key));
        await removeFoliaPlaylistEntries(playlist.id, [key(1), key(4)]);
        expect(await keysInOrder(playlist.id)).toEqual([2, 3, 5, 6].map(key));
        await reorderFoliaPlaylistEntries(playlist.id, [6, 2, 5, 3].map(key), [2, 3, 5, 6].map(key));
        expect(await keysInOrder(playlist.id)).toEqual([6, 2, 5, 3].map(key));
        // 重排之后再加的还是在最后，删掉又加回来的也在最后。
        await addSongsToFoliaPlaylist(playlist.id, [online('netease', 7), online('netease', 1)]);
        expect(await keysInOrder(playlist.id)).toEqual([6, 2, 5, 3, 7, 1].map(key));
        const summary = (await getFoliaPlaylistSummaries()).find(item => item.id === playlist.id);
        expect(summary?.entryCount).toBe(6);
        expect((await getFoliaPlaylist(playlist.id))?.entries.map(entry => entry.key)).toEqual([6, 2, 5, 3, 7, 1].map(key));
    });

    it('answers "is it in there" from the primary key, and lists the keys without the entries', async () => {
        const playlist = await createFoliaPlaylist('Mix', [1, 2, 3].map(id => online('netease', id)));
        expect([...await findFoliaPlaylistEntryKeys(playlist.id, ['online:netease:2', 'online:netease:9'])]).toEqual(['online:netease:2']);
        expect([...await findFoliaPlaylistEntryKeys(playlist.id, [])]).toEqual([]);
        expect((await getFoliaPlaylistEntryKeys(playlist.id)).sort()).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(await getFoliaPlaylistEntryKeys('missing')).toEqual([]);
    });

    it('keeps the cover details on the summary in step with the head of the playlist', async () => {
        const playlist = await createFoliaPlaylist('Mix', [online('netease', 1), online('netease', 2, 'https://img/2.jpg'), online('netease', 3, 'https://img/3.jpg')]);
        expect(playlist.coverUrl).toBe('https://img/2.jpg');
        // 移走封面用着的那一条：换成后面第一条带封面的。
        expect((await removeFoliaPlaylistEntries(playlist.id, ['online:netease:2']))?.coverUrl).toBe('https://img/3.jpg');
        // 把一条带封面的排到它前面：封面跟着换。
        await addSongsToFoliaPlaylist(playlist.id, [online('netease', 4, 'https://img/4.jpg')]);
        const reordered = await reorderFoliaPlaylistEntries(
            playlist.id,
            ['online:netease:4', 'online:netease:1', 'online:netease:3'],
            ['online:netease:1', 'online:netease:3', 'online:netease:4'],
        );
        expect(reordered?.coverUrl).toBe('https://img/4.jpg');
        expect((await removeFoliaPlaylistEntries(playlist.id, ['online:netease:4', 'online:netease:3']))?.coverUrl).toBeUndefined();
    });

    it('only looks at the head of a long playlist for the cover', async () => {
        const entries = Array.from({ length: FOLIA_COVER_SCAN_ENTRIES + 5 }, (_, index) => entryOf('netease', index));
        const playlist = await createFoliaPlaylistFromEntries('Long', entries);
        const { playlist: added } = await addSongsToFoliaPlaylist(playlist.id, [online('qq', 1, 'https://img/far.jpg')]);
        expect(added?.coverUrl).toBeUndefined();
        expect(added?.entryCount).toBe(FOLIA_COVER_SCAN_ENTRIES + 6);
    });
});

describe('concurrent writes', () => {
    it('loses nothing and repeats no position when writes to one playlist interleave', async () => {
        const playlist = await createFoliaPlaylist('Mix', [1, 2, 3, 4, 5, 6].map(id => online('netease', id)));
        const key = (id: number) => `online:netease:${id}`;
        const initial = [1, 2, 3, 4, 5, 6].map(key);
        const results = await Promise.all([
            reorderFoliaPlaylistEntries(playlist.id, [6, 5, 4, 3, 2, 1].map(key), initial),
            ...Array.from({ length: 30 }, (_, index) => addSongsToFoliaPlaylist(playlist.id, [online('qq', index), online('qq', index + 1)])),
            removeFoliaPlaylistEntries(playlist.id, [key(3)]),
            removeFoliaPlaylistEntries(playlist.id, [key(3), key(4)]),
            ...Array.from({ length: 10 }, (_, index) => setFoliaSongFavorite(online('qq', index), true)),
            ...Array.from({ length: 6 }, () => toggleFoliaSongFavorite(online('kugou', 1))),
        ]);
        const rows = await entryRowsOf(playlist.id);
        const keys = rows.map(row => row.key);
        // 重排排在最前面提交（它先进的队），之后的加歌都接在后面；3、4 被删掉了。
        expect(results[0]).not.toBeNull();
        expect(keys.slice(0, 4)).toEqual([6, 5, 2, 1].map(key));
        expect(keys.slice(4).sort()).toEqual(Array.from({ length: 31 }, (_, index) => `online:qq:${index}`).sort());
        expect(new Set(rows.map(row => row.pos)).size).toBe(rows.length);
        const summaries = await getFoliaPlaylistSummaries();
        expect(summaries.find(item => item.id === playlist.id)?.entryCount).toBe(rows.length);
        // 红心：十首各进一次；同一首连按六下是三进三出。
        const favorite = summaries.find(item => item.isFavorite);
        expect(favorite?.entryCount).toBe(10);
        expect((await getFoliaPlaylistEntryKeys(favorite!.id)).sort()).toEqual(Array.from({ length: 10 }, (_, index) => `online:qq:${index}`).sort());
    });

    it('loses nothing when another window writes to the same playlist at the same time', async () => {
        const playlist = await createFoliaPlaylist('Mix', [online('netease', 1)]);
        // 另一个窗口：自己的一条数据库连接，做同样的「读最后一个位置号、追加一行、改条目数」。
        const other = new FoliaPlaylistsDatabase();
        const appendFromOtherWindow = (id: number) => other.transaction('rw', other.playlists, other.entries, other.meta, async () => {
            const last = await other.entries.where('[playlistId+pos]').between([playlist.id, -Infinity], [playlist.id, Infinity]).last();
            const row = await other.playlists.get(playlist.id);
            await other.entries.add({ ...entryOf('other', id), playlistId: playlist.id, pos: (last?.pos ?? 0) + FOLIA_POSITION_STEP });
            await other.playlists.put({ ...row!, entryCount: row!.entryCount + 1 });
        });
        try {
            await Promise.all(Array.from({ length: 20 }, (_, index) => (
                index % 2 === 0 ? addSongsToFoliaPlaylist(playlist.id, [online('here', index)]) : appendFromOtherWindow(index)
            )));
        } finally {
            other.close();
        }
        const rows = await entryRowsOf(playlist.id);
        expect(rows).toHaveLength(21);
        expect(new Set(rows.map(row => row.pos)).size).toBe(21);
        expect((await getFoliaPlaylistSummaries()).find(item => item.id === playlist.id)?.entryCount).toBe(21);
    });

    it('rolls a write back as a whole when it fails in the middle', async () => {
        const playlist = await createFoliaPlaylist('Mix', [online('netease', 1)]);
        const fail = () => { throw new Error('disk full'); };
        // 条目写进去了、摘要那一行写不进去：条目也不留。
        foliaPlaylistsDatabase.playlists.hook('updating', fail);
        try {
            await expect(addSongsToFoliaPlaylist(playlist.id, [online('netease', 2)])).rejects.toThrow('disk full');
        } finally {
            foliaPlaylistsDatabase.playlists.hook('updating').unsubscribe(fail);
        }
        expect(await keysInOrder(playlist.id)).toEqual(['online:netease:1']);
        expect((await foliaPlaylistsDatabase.playlists.get(playlist.id))?.entryCount).toBe(1);
    });
});

describe('how much one operation writes on a very large playlist', () => {
    const SIZE = 20000;
    const seed = async () => {
        await getFoliaPlaylistSummaries();
        const favoriteId = (await getFoliaPlaylistSummaries())[0].id;
        // 直接把两万条放进「我喜欢的音乐」和一张普通歌单（摘要跟着对上）。
        const rowsFor = (playlistId: string) => Array.from({ length: SIZE }, (_, index) => ({
            ...entryOf('netease', index),
            playlistId,
            pos: (index + 1) * FOLIA_POSITION_STEP,
        }));
        const big = await createFoliaPlaylist('Big');
        await foliaPlaylistsDatabase.entries.bulkAdd([...rowsFor(favoriteId), ...rowsFor(big.id)]);
        await foliaPlaylistsDatabase.playlists.update(favoriteId, { entryCount: SIZE });
        await foliaPlaylistsDatabase.playlists.update(big.id, { entryCount: SIZE });
        return { favoriteId, bigId: big.id };
    };

    it('writes one entry row and the summary row for a heart, an added song and a removed song', async () => {
        const { favoriteId, bigId } = await seed();

        // 点一次红心（放进）：一行条目 + 摘要那一行。
        expect(await countWrites(() => toggleFoliaSongFavorite(online('qq', 1)))).toEqual({ entries: 1, playlists: 1 });
        // 再点一次（移出）：还是一行条目 + 摘要那一行。
        expect(await countWrites(() => toggleFoliaSongFavorite(online('qq', 1)))).toEqual({ entries: 1, playlists: 1 });
        // 已经在里面的再放一次：什么都不写。
        expect(await countWrites(() => setFoliaSongFavorite(online('netease', 5), true))).toEqual({ entries: 0, playlists: 0 });
        expect((await foliaPlaylistsDatabase.playlists.get(favoriteId))?.entryCount).toBe(SIZE);

        // 追加一首、移除歌单深处的一首。
        expect(await countWrites(() => addSongsToFoliaPlaylist(bigId, [online('qq', 2)]))).toEqual({ entries: 1, playlists: 1 });
        expect(await countWrites(() => removeFoliaPlaylistEntries(bigId, ['online:netease:15000']))).toEqual({ entries: 1, playlists: 1 });
        expect((await foliaPlaylistsDatabase.playlists.get(bigId))?.entryCount).toBe(SIZE);
    }, 120_000);

    it('rewrites only the moved rows when one song is dragged, however long the playlist is', async () => {
        const { bigId } = await seed();
        const order = await keysInOrder(bigId);
        const next = [order[SIZE - 1], ...order.slice(0, SIZE - 1)];
        expect(await countWrites(() => reorderFoliaPlaylistEntries(bigId, next, order))).toEqual({ entries: 1, playlists: 1 });
        expect((await keysInOrder(bigId)).slice(0, 3)).toEqual([order[SIZE - 1], order[0], order[1]]);
    }, 120_000);
});
