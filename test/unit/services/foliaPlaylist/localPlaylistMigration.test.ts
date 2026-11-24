import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    createFoliaPlaylist,
    deleteFoliaPlaylist,
    getFoliaPlaylists,
    resetFoliaPlaylistStorage,
    setLocalSongFavorite,
} from '@/services/foliaPlaylist/foliaPlaylistService';
import { FOLIA_PLAYLISTS_STATE_KEY, foliaPlaylistsDatabase } from '@/services/foliaPlaylist/foliaPlaylistDatabase';
import { LEGACY_LOCAL_PLAYLISTS_CACHE_KEY, convertLegacyLocalPlaylists } from '@/services/foliaPlaylist/localPlaylistMigration';
import { appDatabase } from '@/services/appDatabase';
import type { LocalSong, UnifiedSong } from '@/types';
import type { FoliaPlaylist } from '@/types/foliaPlaylist';

// test/unit/services/foliaPlaylist/localPlaylistMigration.test.ts
// 旧的本地歌单（api_cache 的 `local_playlists` 一行）并进 Folia 聚合歌单：一张不少、顺序不变、只迁一次、旧数据不动。
// 「一张歌单一行」的那种旧结构搬进按条目存的库，在 foliaPlaylistStorage.test.ts。

const createSong = (id: string, filePath = `Library/${id}.mp3`, patch: Partial<LocalSong> = {}): LocalSong => ({
    id,
    fileName: filePath.split('/').pop() || 'song.mp3',
    filePath,
    title: `Title ${id}`,
    titleOrigin: 'import',
    importedMetadata: { title: `Title ${id}`, titleSource: 'filename', artistNames: ['Artist'], albumName: 'Album' },
    duration: 1000,
    fileSize: 1234,
    fileLastModified: 1000,
    mimeType: 'audio/mpeg',
    addedAt: 100,
    folderName: filePath.split('/').slice(0, -1).join('/'),
    ...patch,
});

const putLegacy = (data: unknown) => appDatabase.api_cache.put({ key: LEGACY_LOCAL_PLAYLISTS_CACHE_KEY, data, timestamp: 1 });
const readLegacy = async () => (await appDatabase.api_cache.get(LEGACY_LOCAL_PLAYLISTS_CACHE_KEY))?.data;
const readState = () => foliaPlaylistsDatabase.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
/** 像重开应用那样：下一次读写重新准备存储（再看一遍要不要搬）。 */
const reopen = () => resetFoliaPlaylistStorage({ keepData: true });
const keysOf = (playlist: FoliaPlaylist | undefined) => playlist?.entries.map(entry => entry.key);

describe('local playlist migration', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await resetFoliaPlaylistStorage();
    });

    it('creates only the favorite playlist when there was nothing to migrate, and marks the migration done', async () => {
        const playlists = await getFoliaPlaylists();
        expect(playlists).toHaveLength(1);
        expect(playlists[0].isFavorite).toBe(true);
        expect(await readState()).toMatchObject({ version: 1, importedFrom: 'nothing', importedCount: 0 });
        expect(typeof (await readState())?.importedAt).toBe('number');
        expect(await readLegacy()).toBeUndefined();
    });

    it('carries over a profile that only has the favorite playlist: same id, time and songs, no second favorite', async () => {
        await appDatabase.local_music.bulkPut([createSong('a'), createSong('b')]);
        const legacy = [{ id: 'local_playlist_1_fav', name: 'Liked Songs', songIds: ['b', 'a'], createdAt: 10, updatedAt: 20, isFavorite: true }];
        await putLegacy(legacy);

        const playlists = await getFoliaPlaylists();

        expect(playlists).toHaveLength(1);
        expect(playlists[0]).toMatchObject({ id: 'local_playlist_1_fav', name: 'Liked Songs', createdAt: 10, updatedAt: 20, isFavorite: true });
        expect(keysOf(playlists[0])).toEqual(['local:b', 'local:a']);
        // 条目只留引用和名字。
        const song = playlists[0].entries[0].song as UnifiedSong;
        expect(song).toMatchObject({ name: 'Title b', isLocal: true, localRef: { songId: 'b' }, sourceRef: { kind: 'local', mediaId: 'b' } });
        expect(song.artists.map(artist => artist.name)).toEqual(['Artist']);
        // 旧数据原样留着。
        expect(await readLegacy()).toEqual(legacy);
    });

    it('keeps every playlist, their order, names and times', async () => {
        await appDatabase.local_music.bulkPut(['a', 'b', 'c'].map(id => createSong(id)));
        const legacy = [
            { id: 'p2', name: 'Second made, shown first', songIds: ['c', 'a'], createdAt: 5, updatedAt: 6 },
            { id: 'fav', name: 'Liked Songs', songIds: ['a'], createdAt: 1, updatedAt: 2, isFavorite: true },
            { id: 'p1', name: 'Empty', songIds: [], createdAt: 3, updatedAt: 4, isFavorite: false },
        ];
        await putLegacy(legacy);

        const playlists = await getFoliaPlaylists();

        expect(playlists.map(playlist => [playlist.id, playlist.name, playlist.createdAt, playlist.updatedAt, Boolean(playlist.isFavorite), keysOf(playlist)])).toEqual([
            ['p2', 'Second made, shown first', 5, 6, false, ['local:c', 'local:a']],
            ['fav', 'Liked Songs', 1, 2, true, ['local:a']],
            ['p1', 'Empty', 3, 4, false, []],
        ]);
        expect(await readState()).toMatchObject({ importedFrom: 'local-playlists', importedCount: 3 });
        expect(await readLegacy()).toEqual(legacy);
    });

    it('reads the older shapes, drops duplicate and stale ids, and collapses repeated imports', async () => {
        const original = createSong('original', 'Library/Disc 1/Track 01.mp3', { addedAt: 100 });
        const duplicate = createSong('duplicate', 'Library (2)/Disc 1/Track 01.mp3', { addedAt: 200 });
        await appDatabase.local_music.bulkPut([original, duplicate, createSong('a'), createSong('b')]);
        await putLegacy([
            { id: 'songs-shape', name: 'Objects', songs: [{ id: 'a' }, null, { id: 'gone' }, { id: 'a' }, 'b'] },
            { id: 'tracks-shape', tracks: ['b', 'b', '', 'a'], createdAt: 7 },
            { id: 'track-ids', name: 'Repeated', trackIds: ['duplicate', 'missing', 'original', 'duplicate'], createdAt: 1, updatedAt: 1 },
            'not a playlist',
            null,
            { name: 'No id', songIds: ['a'], createdAt: 1, updatedAt: 1 },
            { id: 'songs-shape', name: 'Same id again', songIds: ['b'], createdAt: 1, updatedAt: 1 },
        ]);

        const playlists = await getFoliaPlaylists();
        const byName = new Map(playlists.map(playlist => [playlist.name, playlist]));

        expect(keysOf(byName.get('Objects'))).toEqual(['local:a', 'local:b']);
        expect(byName.get('Untitled Playlist')).toMatchObject({ id: 'tracks-shape', createdAt: 7 });
        expect(keysOf(byName.get('Untitled Playlist'))).toEqual(['local:b', 'local:a']);
        expect(keysOf(byName.get('Repeated'))).toEqual(['local:original']);
        expect(keysOf(byName.get('No id'))).toEqual(['local:a']);
        expect(byName.get('No id')?.id).toMatch(/^folia_playlist_/);
        // 两张旧歌单撞了 id：第二张换一个 id，不盖掉第一张。
        expect(keysOf(byName.get('Same id again'))).toEqual(['local:b']);
        expect(byName.get('Same id again')?.id).not.toBe('songs-shape');
        // 旧数据里没有「我喜欢」：补一张，排在最前。
        expect(playlists[0].isFavorite).toBe(true);
        expect(playlists.filter(playlist => playlist.isFavorite)).toHaveLength(1);
        expect(playlists).toHaveLength(6);
    });

    it('keeps only the first favorite as the favorite playlist when old data has two', () => {
        const converted = convertLegacyLocalPlaylists([
            { id: 'one', name: 'Liked Songs', songIds: [], isFavorite: true },
            { id: 'two', name: 'Liked Songs', songIds: [], isFavorite: true },
        ], [], 5);
        expect(converted.playlists.map(playlist => [playlist.id, Boolean(playlist.isFavorite), playlist.createdAt])).toEqual([
            ['one', true, 5],
            ['two', false, 5],
        ]);
    });

    it('treats unreadable old data as nothing to migrate', async () => {
        await putLegacy({ not: 'an array' });
        const playlists = await getFoliaPlaylists();
        expect(playlists).toHaveLength(1);
        expect(await readLegacy()).toEqual({ not: 'an array' });
    });

    it('migrates once: later reads, and changes to the old row, do not bring playlists back or duplicate them', async () => {
        await appDatabase.local_music.bulkPut([createSong('a'), createSong('b')]);
        await putLegacy([
            { id: 'fav', name: 'Liked Songs', songIds: [], createdAt: 1, updatedAt: 1, isFavorite: true },
            { id: 'mix', name: 'Mix', songIds: ['a'], createdAt: 1, updatedAt: 1 },
        ]);
        await getFoliaPlaylists();
        const migratedAt = (await readState())?.importedAt;
        expect(typeof migratedAt).toBe('number');

        await deleteFoliaPlaylist('mix');
        await setLocalSongFavorite(createSong('b'), true);
        const created = await createFoliaPlaylist('New');
        // 回到旧版本用了一阵又升回来：旧的那一行变了，也不再迁第二次。
        await putLegacy([
            { id: 'fav', name: 'Liked Songs', songIds: ['a'], createdAt: 1, updatedAt: 9, isFavorite: true },
            { id: 'mix', name: 'Mix', songIds: ['a', 'b'], createdAt: 1, updatedAt: 9 },
            { id: 'later', name: 'Made in the old version', songIds: ['a'], createdAt: 8, updatedAt: 9 },
        ]);
        await reopen();

        const playlists = await getFoliaPlaylists();

        expect(playlists.map(playlist => playlist.id)).toEqual(['fav', created.id]);
        expect(keysOf(playlists[0])).toEqual(['local:b']);
        expect((await readState())?.importedAt).toBe(migratedAt);
    });

    it('runs the migration once even when the first reads race', async () => {
        await appDatabase.local_music.put(createSong('a'));
        await putLegacy([{ id: 'mix', name: 'Mix', songIds: ['a'], createdAt: 1, updatedAt: 1 }]);
        const reads = await Promise.all([getFoliaPlaylists(), getFoliaPlaylists(), getFoliaPlaylists()]);
        reads.forEach(playlists => {
            expect(playlists.map(playlist => playlist.name).sort()).toEqual(['Liked Songs', 'Mix']);
        });
        expect(await foliaPlaylistsDatabase.playlists.count()).toBe(2);
        // 旧的那张表里只有原来那一行：这一版不往里写。
        expect(await appDatabase.api_cache.count()).toBe(1);
    });

    it('writes nothing when the migration fails half way, and succeeds on the next read', async () => {
        await appDatabase.local_music.bulkPut([createSong('a'), createSong('b')]);
        const legacy = [
            { id: 'one', name: 'One', songIds: ['a'], createdAt: 1, updatedAt: 1 },
            { id: 'two', name: 'Two', songIds: ['b'], createdAt: 1, updatedAt: 1 },
        ];
        await putLegacy(legacy);
        let writes = 0;
        const failOnSecondWrite = () => {
            writes += 1;
            if (writes === 2) throw new Error('disk full');
        };
        foliaPlaylistsDatabase.playlists.hook('creating', failOnSecondWrite);
        try {
            await expect(getFoliaPlaylists()).rejects.toThrow('disk full');
        } finally {
            foliaPlaylistsDatabase.playlists.hook('creating').unsubscribe(failOnSecondWrite);
        }
        // 事务回滚：没有写到一半的歌单，没有迁移标记，旧数据还在。
        expect(await foliaPlaylistsDatabase.playlists.count()).toBe(0);
        expect(await foliaPlaylistsDatabase.entries.count()).toBe(0);
        expect(await readState()).toBeUndefined();
        expect(await readLegacy()).toEqual(legacy);

        const playlists = await getFoliaPlaylists();
        expect(playlists.map(playlist => playlist.name)).toEqual(['Liked Songs', 'One', 'Two']);
    });

    it('does not overwrite a playlist that already exists under the same id', async () => {
        await appDatabase.local_music.bulkPut([createSong('a'), createSong('b')]);
        const first = await getFoliaPlaylists();
        // 模拟标记丢了之后重开：已经在的那张保持现在的内容。
        await putLegacy([{ id: first[0].id, name: 'Liked Songs', songIds: ['a'], createdAt: 1, updatedAt: 1, isFavorite: true }]);
        await setLocalSongFavorite(createSong('b'), true);
        await foliaPlaylistsDatabase.meta.delete(FOLIA_PLAYLISTS_STATE_KEY);
        await reopen();

        const playlists = await getFoliaPlaylists();

        expect(playlists).toHaveLength(1);
        expect(keysOf(playlists[0])).toEqual(['local:b']);
    });

    it('does not bring back a migrated playlist the user deleted when the mark is lost', async () => {
        await appDatabase.local_music.bulkPut([createSong('a')]);
        await putLegacy([
            { id: 'keep', name: 'Keep', songIds: ['a'], createdAt: 1, updatedAt: 1 },
            { id: 'gone', name: 'Gone', songIds: ['a'], createdAt: 2, updatedAt: 2 },
        ]);
        await getFoliaPlaylists();
        expect(await deleteFoliaPlaylist('gone')).toBe(true);
        await foliaPlaylistsDatabase.meta.delete(FOLIA_PLAYLISTS_STATE_KEY);
        await reopen();

        const playlists = await getFoliaPlaylists();

        expect(playlists.map(playlist => playlist.name).sort()).toEqual(['Keep', 'Liked Songs']);
        expect(typeof (await readState())?.importedAt).toBe('number');
    });

    it('migrates even when a referenced library record is malformed: the reference is kept', async () => {
        const broken = { ...createSong('a'), importedMetadata: undefined } as unknown as LocalSong;
        await appDatabase.local_music.bulkPut([broken, createSong('b')]);
        await putLegacy([{ id: 'p', name: 'P', songIds: ['a', 'b'], createdAt: 1, updatedAt: 1 }]);

        const playlists = await getFoliaPlaylists();

        expect(keysOf(playlists.find(playlist => playlist.id === 'p'))).toEqual(['local:a', 'local:b']);
    });
});
