import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addLocalSongsToFoliaPlaylist,
    addPickedSongsToFoliaPlaylist,
    addSongsToFoliaPlaylist,
    createFoliaPlaylist,
    createFoliaPlaylistFromLocalSongs,
    createFoliaPlaylistFromPickedSongs,
    deleteFoliaPlaylist,
    getFoliaPlaylist,
    getFoliaPlaylists,
    removeDeletedLocalSongsFromFoliaPlaylists,
    removeFoliaPlaylistEntries,
    renameFoliaPlaylist,
    reorderFoliaPlaylistEntries,
    reorderFoliaPlaylists,
    setFoliaSongFavorite,
    setLocalSongFavorite,
    subscribeFoliaPlaylists,
} from '@/services/foliaPlaylist/foliaPlaylistService';
import { FOLIA_PLAYLISTS_META_KEY, foliaPlaylistRowKey } from '@/services/foliaPlaylist/foliaPlaylistRows';
import { buildCanonicalLocalSongIdIndex } from '@/services/foliaPlaylist/localSongDuplicates';
import { appDatabase } from '@/services/appDatabase';
import { clearCacheTables, getCacheTableName } from '@/services/repositories/cacheRepository';
import { matchesCategory } from '@/services/repositories/cacheUsage';
import { toScratchpadSong } from '@/stores/useScratchpadStore';
import { toStoredSongSnapshot } from '@/utils/songSnapshot';
import type { LocalSong, SongResult, UnifiedSong } from '@/types';
import type { FoliaPlaylist } from '@/types/foliaPlaylist';

// test/unit/services/foliaPlaylist/foliaPlaylistService.test.ts
// Folia 聚合歌单的读写：建、改名、删、加歌去重、移除、重排、红心、删本地歌时的清理、并发写。

const createSong = (patch: Partial<LocalSong> & Pick<LocalSong, 'id' | 'filePath' | 'folderName'>): LocalSong => {
    const { id, filePath, folderName, ...songPatch } = patch;
    const fileName = songPatch.fileName || filePath.split('/').pop() || 'song.mp3';
    const title = songPatch.title || fileName.replace(/\.[^.]+$/, '');
    return {
        id,
        fileName,
        filePath,
        title,
        titleOrigin: 'import',
        importedMetadata: { title, titleSource: 'filename', artistNames: ['Artist'] },
        duration: 1000,
        fileSize: 1234,
        fileLastModified: 1000,
        mimeType: 'audio/mpeg',
        addedAt: 100,
        folderName,
        ...songPatch,
    };
};
const track = (id: string) => createSong({ id, filePath: `Library/${id}.mp3`, folderName: 'Library' });
const onlineSong = (providerId: string, id: number, name = `song ${id}`): SongResult => ({
    id,
    name,
    artists: [{ id: 1, name: 'Singer' }],
    album: { id: 2, name: 'Album', coverUrl: 'https://img.example/cover.jpg' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId, mediaId: String(id) },
} as SongResult);
const navidromeSong = (id: string): SongResult => ({
    id,
    name: `navi ${id}`,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'navidrome', mediaId: id },
} as SongResult);
const localPlaybackSong = (id: string): SongResult => ({
    id: 1,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    isLocal: true,
    localRef: { songId: id },
    sourceRef: { kind: 'local', mediaId: id },
    localData: { id, fileHandle: {} },
} as unknown as SongResult);
const keysOf = (playlist: FoliaPlaylist | null | undefined) => playlist?.entries.map(entry => entry.key);

describe('foliaPlaylistService', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    it('starts with the fixed favorite playlist and keeps it across reads', async () => {
        const first = await getFoliaPlaylists();
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ isFavorite: true, entries: [] });
        const second = await getFoliaPlaylists();
        expect(second.map(playlist => playlist.id)).toEqual([first[0].id]);
    });

    it('stores each playlist in its own row of api_cache, outside every cache category', async () => {
        const playlist = await createFoliaPlaylist('Mix', [onlineSong('netease', 1)]);
        const rowKey = foliaPlaylistRowKey(playlist.id);
        expect(getCacheTableName(rowKey)).toBe('api_cache');
        expect(getCacheTableName(FOLIA_PLAYLISTS_META_KEY)).toBe('api_cache');
        expect((await appDatabase.api_cache.get(rowKey))?.data).toMatchObject({ id: playlist.id, name: 'Mix' });
        for (const category of ['playlist', 'lyrics', 'cover', 'media', 'analysis', 'volumeBalance'] as const) {
            expect(matchesCategory(rowKey, category)).toBe(false);
            expect(matchesCategory(FOLIA_PLAYLISTS_META_KEY, category)).toBe(false);
        }
        // 整库清缓存也不带走歌单。
        await clearCacheTables();
        expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(['online:netease:1']);
    });

    it('holds songs of several sources in one playlist, each key once', async () => {
        await appDatabase.local_music.put(track('a'));
        const playlist = await createFoliaPlaylist(' Mixed ', [onlineSong('netease', 1), localPlaybackSong('a')]);
        expect(playlist.name).toBe('Mixed');
        const { playlist: updated, result } = await addSongsToFoliaPlaylist(playlist.id, [
            onlineSong('qq', 1),
            onlineSong('netease', 1, 'again'),
            navidromeSong('n1'),
            navidromeSong('n1'),
            { ...onlineSong('netease', 9), sourceRef: { kind: 'stage', mediaId: 's' } } as SongResult,
        ]);
        expect(result).toEqual({ added: 2, duplicates: 2, rejected: 1 });
        expect(keysOf(updated)).toEqual(['online:netease:1', 'local:a', 'online:qq:1', 'navidrome:n1']);
        // 第一次加进去的快照不被后来的重复项改掉。
        expect(updated?.entries[0].song.name).toBe('song 1');
        // 本地歌只留引用：文件句柄之类不进存储。
        expect(updated?.entries[1].song).not.toHaveProperty('localData');
        expect((updated?.entries[1].song as UnifiedSong).localRef).toEqual({ songId: 'a' });
        expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(keysOf(updated));
    });

    it('snapshots songs with the same function the scratchpad uses', () => {
        expect(toScratchpadSong).toBe(toStoredSongSnapshot);
    });

    it('has no entry limit', async () => {
        const songs = Array.from({ length: 1500 }, (_, index) => onlineSong('netease', index + 1));
        const playlist = await createFoliaPlaylist('Long', songs);
        expect(playlist.entries).toHaveLength(1500);
        expect((await getFoliaPlaylist(playlist.id))?.entries).toHaveLength(1500);
    });

    it('rejects an empty name and leaves nothing behind', async () => {
        await expect(createFoliaPlaylist('   ')).rejects.toThrow('Playlist name is empty');
        expect(await getFoliaPlaylists()).toHaveLength(1);
    });

    it('renames and deletes ordinary playlists but never the favorite one', async () => {
        const [favorite] = await getFoliaPlaylists();
        const playlist = await createFoliaPlaylist('Mix');
        await expect(renameFoliaPlaylist(playlist.id, ' Renamed ')).resolves.toMatchObject({ name: 'Renamed' });
        await expect(renameFoliaPlaylist(playlist.id, '  ')).resolves.toBeNull();
        await expect(renameFoliaPlaylist(favorite.id, 'Mine')).resolves.toBeNull();
        await expect(renameFoliaPlaylist('missing', 'x')).resolves.toBeNull();
        await expect(deleteFoliaPlaylist(favorite.id)).resolves.toBe(false);
        await expect(deleteFoliaPlaylist('missing')).resolves.toBe(false);
        await expect(deleteFoliaPlaylist(playlist.id)).resolves.toBe(true);
        expect((await getFoliaPlaylists()).map(item => item.name)).toEqual([favorite.name]);
        expect(await appDatabase.api_cache.get(foliaPlaylistRowKey(playlist.id))).toBeUndefined();
    });

    it('removes entries by key', async () => {
        const playlist = await createFoliaPlaylist('Mix', [onlineSong('netease', 1), onlineSong('qq', 2), navidromeSong('n')]);
        await expect(removeFoliaPlaylistEntries(playlist.id, ['online:qq:2', 'nope'])).resolves.toMatchObject({
            entries: [expect.objectContaining({ key: 'online:netease:1' }), expect.objectContaining({ key: 'navidrome:n' })],
        });
        await expect(removeFoliaPlaylistEntries(playlist.id, ['nope'])).resolves.toBeNull();
    });

    it('keeps the playlists in creation order and lets them be reordered as a whole', async () => {
        const [favorite] = await getFoliaPlaylists();
        const a = await createFoliaPlaylist('A');
        const b = await createFoliaPlaylist('B');
        expect((await getFoliaPlaylists()).map(item => item.id)).toEqual([favorite.id, a.id, b.id]);
        await expect(reorderFoliaPlaylists([b.id, favorite.id, a.id])).resolves.toBe(true);
        expect((await getFoliaPlaylists()).map(item => item.id)).toEqual([b.id, favorite.id, a.id]);
        await expect(reorderFoliaPlaylists([b.id, a.id])).resolves.toBe(false);
        await expect(reorderFoliaPlaylists([b.id, a.id, a.id])).resolves.toBe(false);
    });

    it('toggles any song in the favorite playlist', async () => {
        const song = onlineSong('lxmusic', 7);
        expect(keysOf(await setFoliaSongFavorite(song, true))).toEqual(['online:lxmusic:7']);
        expect(keysOf(await setFoliaSongFavorite(song, true))).toEqual(['online:lxmusic:7']);
        expect(keysOf(await setFoliaSongFavorite(song, false))).toEqual([]);
    });

    it('takes songs as the interface has them: local ones as their library record, the rest as they are', async () => {
        await appDatabase.local_music.bulkPut([track('a'), track('b')]);
        const playlist = await createFoliaPlaylist('Mix', []);
        const first = await addPickedSongsToFoliaPlaylist(playlist.id, [localPlaybackSong('a'), onlineSong('lxmusic', 7), localPlaybackSong('gone')]);
        expect(first.result).toEqual({ added: 2, duplicates: 0, rejected: 1 });
        expect(keysOf(first.playlist)).toEqual(['local:a', 'online:lxmusic:7']);
        // 存下的是曲库记录的快照，不是播放用的那份（它带着句柄）。
        expect(first.playlist?.entries[0].song.name).toBe('a');
        expect(JSON.stringify(first.playlist?.entries[0].song)).not.toContain('fileHandle');

        // 再存一遍只追加还不在里面的。
        const second = await addPickedSongsToFoliaPlaylist(playlist.id, [localPlaybackSong('a'), localPlaybackSong('b'), onlineSong('lxmusic', 7)]);
        expect(second.result).toEqual({ added: 1, duplicates: 2, rejected: 0 });
        expect(keysOf(second.playlist)).toEqual(['local:a', 'online:lxmusic:7', 'local:b']);
    });

    it('makes a playlist out of picked songs of any mix of sources, and none when nothing can go in', async () => {
        await appDatabase.local_music.bulkPut([track('a')]);
        const made = await createFoliaPlaylistFromPickedSongs('Queue', [localPlaybackSong('a'), onlineSong('netease', 1), onlineSong('netease', 1), navidromeSong('n1')]);
        expect(keysOf(made.playlist)).toEqual(['local:a', 'online:netease:1', 'navidrome:n1']);
        expect(made.result).toEqual({ added: 3, duplicates: 1, rejected: 0 });

        await expect(createFoliaPlaylistFromPickedSongs('Empty', [localPlaybackSong('gone')])).rejects.toThrow();
        expect((await getFoliaPlaylists()).map(item => item.name)).not.toContain('Empty');
    });

    it('tells subscribers after a write, not after a read that changed nothing', async () => {
        await getFoliaPlaylists();
        const listener = vi.fn();
        const unsubscribe = subscribeFoliaPlaylists(listener);
        await getFoliaPlaylists();
        expect(listener).not.toHaveBeenCalled();
        const playlist = await createFoliaPlaylist('Mix');
        expect(listener).toHaveBeenCalledTimes(1);
        await removeFoliaPlaylistEntries(playlist.id, ['nope']);
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        await deleteFoliaPlaylist(playlist.id);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    describe('local songs', () => {
        const original = createSong({ id: 'original', filePath: 'Library/Disc 1/Track 01.mp3', folderName: 'Library/Disc 1', addedAt: 100 });
        const duplicate = createSong({ id: 'duplicate', filePath: 'Library (2)/Disc 1/Track 01.mp3', folderName: 'Library (2)/Disc 1', addedAt: 200 });

        it('keeps same child folder and file names from different roots distinct', async () => {
            const alpha = createSong({ id: 'alpha', filePath: 'RootA/Disc 1/Track 01.mp3', folderName: 'RootA/Disc 1' });
            const beta = createSong({ id: 'beta', filePath: 'RootB/Disc 1/Track 01.mp3', folderName: 'RootB/Disc 1' });
            await appDatabase.local_music.bulkPut([alpha, beta]);
            const playlist = await createFoliaPlaylistFromLocalSongs('Both roots', [alpha, beta]);
            expect(keysOf((await getFoliaPlaylists()).find(item => item.id === playlist.id))).toEqual(['local:alpha', 'local:beta']);
        });

        it('repairs repeated imports to the canonical song when the list is read, and persists it', async () => {
            await appDatabase.local_music.bulkPut([original, duplicate]);
            const playlist = await createFoliaPlaylistFromLocalSongs('Repeated', [duplicate, original]);
            expect(keysOf(playlist)).toEqual(['local:duplicate', 'local:original']);
            expect(keysOf((await getFoliaPlaylists()).find(item => item.id === playlist.id))).toEqual(['local:original']);
            expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(['local:original']);
        });

        it('favorites and unfavorites a repeated import through the canonical song id', async () => {
            await appDatabase.local_music.bulkPut([original, duplicate]);
            // 播放中的是第二次导入的副本，但歌单里只会留下 canonical 那一份。
            expect(keysOf(await setLocalSongFavorite(duplicate, true))).toEqual(['local:original']);
            expect(keysOf((await getFoliaPlaylists()).find(item => item.isFavorite))).toEqual(['local:original']);
            expect(keysOf(await setLocalSongFavorite(duplicate, false))).toEqual([]);
        });

        it('indexes only the repeated imports that resolve to another song id', () => {
            const sole = createSong({ id: 'sole', filePath: 'Other/Track 09.mp3', folderName: 'Other' });
            const index = buildCanonicalLocalSongIdIndex([original, duplicate, sole]);
            expect(index.get('duplicate')).toBe('original');
            expect(index.has('original')).toBe(false);
            expect(index.has('sole')).toBe(false);
        });

        it('drops the rows of deleted local songs from every playlist and leaves other sources alone', async () => {
            await appDatabase.local_music.bulkPut(['a', 'b'].map(track));
            const playlist = await createFoliaPlaylist('Mix', [localPlaybackSong('a'), onlineSong('netease', 1), localPlaybackSong('b')]);
            await setLocalSongFavorite(track('a'), true);
            await removeDeletedLocalSongsFromFoliaPlaylists(['a']);
            const playlists = await getFoliaPlaylists();
            expect(keysOf(playlists.find(item => item.id === playlist.id))).toEqual(['online:netease:1', 'local:b']);
            expect(keysOf(playlists.find(item => item.isFavorite))).toEqual([]);
        });

        it('drops local rows whose song is no longer in the library when the list is read', async () => {
            await appDatabase.local_music.bulkPut(['a', 'b'].map(track));
            const playlist = await createFoliaPlaylistFromLocalSongs('Mix', ['a', 'b'].map(track));
            await appDatabase.local_music.delete('a');
            expect(keysOf((await getFoliaPlaylists()).find(item => item.id === playlist.id))).toEqual(['local:b']);
        });
    });

    describe('reorderFoliaPlaylistEntries', () => {
        const initial = ['local:a', 'local:b', 'local:c'];
        const seed = async () => {
            await appDatabase.local_music.bulkPut(['a', 'b', 'c', 'd'].map(track));
            return createFoliaPlaylistFromLocalSongs('Mix', ['a', 'b', 'c'].map(track));
        };

        it('persists the submitted order and rejects a draft made from an older order', async () => {
            const playlist = await seed();
            const next = ['local:c', 'local:a', 'local:b'];
            expect(keysOf(await reorderFoliaPlaylistEntries(playlist.id, next, initial))).toEqual(next);
            expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(next);
            await expect(reorderFoliaPlaylistEntries(playlist.id, ['local:b', 'local:a', 'local:c'], initial)).resolves.toBeNull();
            expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(next);
            await expect(reorderFoliaPlaylistEntries('missing', initial, initial)).resolves.toBeNull();
        });

        it.each([
            ['omit', ['local:a', 'local:b']],
            ['add', ['local:a', 'local:b', 'local:c', 'local:d']],
            ['replace', ['local:a', 'local:b', 'local:d']],
            ['duplicate', ['local:a', 'local:b', 'local:b']],
        ] as const)('rejects drafts that %s members without writing', async (_label, next) => {
            const playlist = await seed();
            const before = await appDatabase.api_cache.get(foliaPlaylistRowKey(playlist.id));
            await expect(reorderFoliaPlaylistEntries(playlist.id, next, initial)).resolves.toBeNull();
            expect(await appDatabase.api_cache.get(foliaPlaylistRowKey(playlist.id))).toEqual(before);
        });

        it('keeps concurrent additions and deletions when saving a draft', async () => {
            const playlist = await seed();
            const [reordered] = await Promise.all([
                reorderFoliaPlaylistEntries(playlist.id, ['local:b', 'local:c', 'local:a'], initial),
                addLocalSongsToFoliaPlaylist(playlist.id, [track('d')]),
                removeDeletedLocalSongsFromFoliaPlaylists(['c']),
            ]);
            const expected = reordered ? ['local:b', 'local:a', 'local:d'] : ['local:a', 'local:b', 'local:d'];
            expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(expected);
        });

        it('propagates storage errors and leaves the original order available for retry', async () => {
            const playlist = await seed();
            const fail = () => { throw new Error('storage unavailable'); };
            appDatabase.api_cache.hook('updating', fail);
            try {
                await expect(reorderFoliaPlaylistEntries(playlist.id, ['local:c', 'local:a', 'local:b'], initial)).rejects.toThrow('storage unavailable');
            } finally {
                appDatabase.api_cache.hook('updating').unsubscribe(fail);
            }
            expect(keysOf(await getFoliaPlaylist(playlist.id))).toEqual(initial);
            expect(keysOf(await reorderFoliaPlaylistEntries(playlist.id, ['local:c', 'local:a', 'local:b'], initial))).toEqual(['local:c', 'local:a', 'local:b']);
        });
    });

    it('serializes concurrent writes: none of them overwrites another', async () => {
        const playlist = await createFoliaPlaylist('Mix');
        await Promise.all([
            ...Array.from({ length: 20 }, (_, index) => addSongsToFoliaPlaylist(playlist.id, [onlineSong('netease', index + 1)])),
            ...Array.from({ length: 5 }, (_, index) => setFoliaSongFavorite(onlineSong('qq', index + 1), true)),
            ...Array.from({ length: 5 }, (_, index) => createFoliaPlaylist(`P${index}`)),
        ]);
        const playlists = await getFoliaPlaylists();
        expect(playlists.find(item => item.id === playlist.id)?.entries).toHaveLength(20);
        expect(playlists.find(item => item.isFavorite)?.entries).toHaveLength(5);
        expect(playlists).toHaveLength(7);
        expect(new Set(playlists.map(item => item.id)).size).toBe(7);
    });

    it('survives a damaged meta row: the playlists are still there', async () => {
        const playlist = await createFoliaPlaylist('Mix', [onlineSong('netease', 1)]);
        await appDatabase.api_cache.put({ key: FOLIA_PLAYLISTS_META_KEY, data: 'garbage', timestamp: 1 });
        const playlists = await getFoliaPlaylists();
        expect(playlists.map(item => item.id)).toContain(playlist.id);
        expect(playlists.filter(item => item.isFavorite)).toHaveLength(1);
    });

    it('keeps fields it does not know on a playlist and its entries when it writes the row back', async () => {
        const playlist = await createFoliaPlaylist('Mix', [onlineSong('netease', 1)]);
        const row = await appDatabase.api_cache.get(foliaPlaylistRowKey(playlist.id));
        const stored = row?.data as FoliaPlaylist;
        await appDatabase.api_cache.put({
            key: foliaPlaylistRowKey(playlist.id),
            data: { ...stored, pinned: true, entries: stored.entries.map(entry => ({ ...entry, note: 'later version' })) },
            timestamp: 1,
        });

        await addSongsToFoliaPlaylist(playlist.id, [onlineSong('netease', 2)]);
        await renameFoliaPlaylist(playlist.id, 'Renamed');

        const after = (await appDatabase.api_cache.get(foliaPlaylistRowKey(playlist.id)))?.data as Record<string, unknown>;
        expect(after).toMatchObject({ name: 'Renamed', pinned: true });
        expect((after.entries as Array<Record<string, unknown>>).map(entry => entry.note)).toEqual(['later version', undefined]);
    });

    it('only reads playlists written by a newer version: no repair, no write', async () => {
        await appDatabase.local_music.bulkPut([track('a')]);
        const playlist = await createFoliaPlaylistFromLocalSongs('Local', [track('a')]);
        const meta = (await appDatabase.api_cache.get(FOLIA_PLAYLISTS_META_KEY))?.data as Record<string, unknown>;
        await appDatabase.api_cache.put({ key: FOLIA_PLAYLISTS_META_KEY, data: { ...meta, version: 2 }, timestamp: 1 });
        // 曲库里那首歌没了：平时读的时候会把这一条修掉，这里不许动。
        await appDatabase.local_music.clear();

        const playlists = await getFoliaPlaylists();
        expect(playlists.find(item => item.id === playlist.id)?.entries).toHaveLength(1);
        await expect(renameFoliaPlaylist(playlist.id, 'Nope')).rejects.toThrow(/newer version/);
        await expect(createFoliaPlaylist('New', [])).rejects.toThrow(/newer version/);
        expect(((await appDatabase.api_cache.get(foliaPlaylistRowKey(playlist.id)))?.data as FoliaPlaylist).name).toBe('Local');
        expect(((await appDatabase.api_cache.get(FOLIA_PLAYLISTS_META_KEY))?.data as Record<string, unknown>).version).toBe(2);
    });
});
