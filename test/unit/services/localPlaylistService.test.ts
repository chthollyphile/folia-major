import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    addSongsToLocalPlaylist,
    buildCanonicalLocalSongIdIndex,
    getLocalPlaylists,
    removeDeletedSongIdsFromPlaylists,
    reorderLocalPlaylistSongs,
    setLocalSongFavorite,
} from '@/services/localPlaylistService';
import { appDatabase } from '@/services/appDatabase';
import { putCacheEntry, readCacheEntry } from '@/services/repositories/cacheRepository';
import type { LocalPlaylist, LocalSong } from '@/types';

// test/unit/services/localPlaylistService.test.ts
// Covers local playlist cache repair for repeated folder imports.

const createSong = (patch: Partial<LocalSong> & Pick<LocalSong, 'id' | 'filePath' | 'folderName'>): LocalSong => {
    const { id, filePath, folderName, ...songPatch } = patch;
    return {
        id,
        fileName: songPatch.fileName || filePath.split('/').pop() || 'song.mp3',
        filePath,
        title: songPatch.title || (songPatch.fileName || filePath.split('/').pop() || 'song.mp3').replace(/\.[^.]+$/, ''),
        titleOrigin: songPatch.titleOrigin || 'import',
        importedMetadata: songPatch.importedMetadata || {
            title: songPatch.title || (songPatch.fileName || filePath.split('/').pop() || 'song.mp3').replace(/\.[^.]+$/, ''),
            titleSource: 'filename',
            artistNames: [],
        },
        duration: songPatch.duration ?? 0,
        fileSize: songPatch.fileSize ?? 1234,
        fileLastModified: songPatch.fileLastModified ?? 1000,
        mimeType: songPatch.mimeType || 'audio/mpeg',
        addedAt: songPatch.addedAt ?? 100,
        folderName,
        ...songPatch,
    };
};

describe('localPlaylistService', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
    });

    it('keeps same child folder and file names from different roots distinct', async () => {
        const alphaSong = createSong({
            id: 'alpha',
            filePath: 'RootA/Disc 1/Track 01.mp3',
            folderName: 'RootA/Disc 1',
        });
        const betaSong = createSong({
            id: 'beta',
            filePath: 'RootB/Disc 1/Track 01.mp3',
            folderName: 'RootB/Disc 1',
        });
        const playlists: LocalPlaylist[] = [{
            id: 'playlist',
            name: 'Both roots',
            songIds: ['alpha', 'beta'],
            createdAt: 1,
            updatedAt: 1,
        }];

        await putCacheEntry('local_playlists', playlists);
        await appDatabase.local_music.bulkPut([alphaSong, betaSong]);

        const result = await getLocalPlaylists();

        expect(result.find(playlist => playlist.id === 'playlist')?.songIds).toEqual(['alpha', 'beta']);
        expect(await readCacheEntry('local_playlists')).toEqual(expect.arrayContaining([
            expect.objectContaining({ isFavorite: true }),
            expect.objectContaining({ id: 'playlist', songIds: ['alpha', 'beta'] }),
        ]));
    });

    it('repairs repeated imports from the same root family to the canonical song id', async () => {
        const originalSong = createSong({
            id: 'original',
            filePath: 'Library/Disc 1/Track 01.mp3',
            folderName: 'Library/Disc 1',
            addedAt: 100,
        });
        const duplicatedSong = createSong({
            id: 'duplicate',
            filePath: 'Library (2)/Disc 1/Track 01.mp3',
            folderName: 'Library (2)/Disc 1',
            addedAt: 200,
        });
        const playlists: LocalPlaylist[] = [{
            id: 'playlist',
            name: 'Repeated imports',
            songIds: ['duplicate', 'original', 'duplicate'],
            createdAt: 1,
            updatedAt: 1,
        }];

        await putCacheEntry('local_playlists', playlists);
        await appDatabase.local_music.bulkPut([originalSong, duplicatedSong]);

        const result = await getLocalPlaylists();

        expect(result.find(playlist => playlist.id === 'playlist')?.songIds).toEqual(['original']);
        expect(await readCacheEntry('local_playlists')).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'playlist', songIds: ['original'] }),
        ]));
    });

    it('favorites and unfavorites a repeated import through the canonical song id', async () => {
        const originalSong = createSong({
            id: 'original',
            filePath: 'Library/Disc 1/Track 01.mp3',
            folderName: 'Library/Disc 1',
            addedAt: 100,
        });
        const duplicatedSong = createSong({
            id: 'duplicate',
            filePath: 'Library (2)/Disc 1/Track 01.mp3',
            folderName: 'Library (2)/Disc 1',
            addedAt: 200,
        });
        await putCacheEntry('local_playlists', [{
            id: 'favorite',
            name: 'Liked Songs',
            songIds: [],
            createdAt: 1,
            updatedAt: 1,
            isFavorite: true,
        }]);
        await appDatabase.local_music.bulkPut([originalSong, duplicatedSong]);

        // 播放中的是第二次导入的副本，但歌单里只会留下 canonical 那一份的 id。
        await setLocalSongFavorite(duplicatedSong, true);
        const afterFavorite = await getLocalPlaylists();
        expect(afterFavorite.find(playlist => playlist.isFavorite)?.songIds).toEqual(['original']);

        await setLocalSongFavorite(duplicatedSong, false);
        const afterUnfavorite = await getLocalPlaylists();
        expect(afterUnfavorite.find(playlist => playlist.isFavorite)?.songIds).toEqual([]);
    });

    it('indexes only the repeated imports that resolve to another song id', () => {
        const originalSong = createSong({
            id: 'original',
            filePath: 'Library/Disc 1/Track 01.mp3',
            folderName: 'Library/Disc 1',
            addedAt: 100,
        });
        const duplicatedSong = createSong({
            id: 'duplicate',
            filePath: 'Library (2)/Disc 1/Track 01.mp3',
            folderName: 'Library (2)/Disc 1',
            addedAt: 200,
        });
        const soleSong = createSong({
            id: 'sole',
            filePath: 'Other/Track 09.mp3',
            folderName: 'Other',
        });

        const index = buildCanonicalLocalSongIdIndex([originalSong, duplicatedSong, soleSong]);

        expect(index.get('duplicate')).toBe('original');
        expect(index.has('original')).toBe(false);
        expect(index.has('sole')).toBe(false);
    });

    describe('reorderLocalPlaylistSongs', () => {
        const initial = ['a', 'b', 'c'];
        const makeTrack = (id: string) => createSong({ id, filePath: `Library/${id}.mp3`, folderName: 'Library' });
        const target = { id: 'mix', name: 'Mix', songIds: initial, createdAt: 1, updatedAt: 1 };
        const other = { ...target, id: 'favorite', isFavorite: true, songIds: ['c'] };
        const seed = async () => {
            await appDatabase.local_music.bulkPut([...initial, 'd'].map(makeTrack));
            await putCacheEntry('local_playlists', [target, other]);
        };

        it('persists the submitted order after reopening and preserves the other playlists', async () => {
            await seed();
            const next = ['c', 'a', 'b'];
            await expect(reorderLocalPlaylistSongs('mix', next, initial)).resolves.toMatchObject({ songIds: next });
            await expect(getLocalPlaylists()).resolves.toEqual([
                expect.objectContaining({ id: 'mix', songIds: next, name: 'Mix', createdAt: 1 }),
                other,
            ]);
            await expect(reorderLocalPlaylistSongs('mix', ['b', 'a', 'c'], initial)).resolves.toBeNull();
            expect((await getLocalPlaylists())[0].songIds).toEqual(next);
        });

        it.each([
            ['omit', ['a', 'b']],
            ['add', ['a', 'b', 'c', 'd']],
            ['replace', ['a', 'b', 'd']],
            ['duplicate', ['a', 'b', 'b']],
        ] as const)('rejects drafts that %s members without updating the cache', async (_label, next) => {
            await seed();
            await expect(reorderLocalPlaylistSongs('mix', next, initial)).resolves.toBeNull();
            expect(await readCacheEntry('local_playlists')).toEqual([target, other]);
        });

        it('keeps concurrent additions and deletions when saving a draft', async () => {
            await seed();
            const [reordered] = await Promise.all([
                reorderLocalPlaylistSongs('mix', ['b', 'c', 'a'], initial),
                addSongsToLocalPlaylist('mix', [makeTrack('d')]),
                removeDeletedSongIdsFromPlaylists(['c']),
            ]);
            const expected = reordered ? ['b', 'a', 'd'] : ['a', 'b', 'd'];
            expect((await getLocalPlaylists())[0].songIds).toEqual(expected);
            await expect(reorderLocalPlaylistSongs('mix', initial, initial)).resolves.toBeNull();
            await expect(reorderLocalPlaylistSongs('missing', initial, initial)).resolves.toBeNull();
        });

        it('propagates storage errors and leaves the original order available for retry', async () => {
            await seed();
            const fail = () => { throw new Error('storage unavailable'); };
            appDatabase.api_cache.hook('updating', fail);
            try {
                await expect(reorderLocalPlaylistSongs('mix', ['c', 'a', 'b'], initial)).rejects.toThrow('storage unavailable');
            } finally {
                appDatabase.api_cache.hook('updating').unsubscribe(fail);
            }
            expect(await readCacheEntry('local_playlists')).toEqual([target, other]);
            await expect(reorderLocalPlaylistSongs('mix', ['c', 'a', 'b'], initial)).resolves.toMatchObject({ songIds: ['c', 'a', 'b'] });
        });

        it('keeps every playlist intact when reading the song catalog fails', async () => {
            await seed();
            const fail = () => { throw new Error('catalog unavailable'); };
            appDatabase.local_music.hook('reading', fail);
            try {
                await expect(reorderLocalPlaylistSongs('mix', ['c', 'a', 'b'], initial)).rejects.toThrow('catalog unavailable');
            } finally {
                appDatabase.local_music.hook('reading').unsubscribe(fail);
            }
            expect(await readCacheEntry('local_playlists')).toEqual([target, other]);
        });
    });
});
