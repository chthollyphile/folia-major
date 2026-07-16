import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { migrateLegacyLocalSongRecords } from '@/services/localLibraryV8Migration';
import { AppDatabase } from '@/services/appDatabase';
import type { LocalSong } from '@/types';

// test/unit/localLibrary/localLibraryV8Migration.test.ts
// Verifies the released v6 flat records become canonical songs and stable entity assignments.

const legacySong = (patch: Record<string, unknown> = {}) => ({
    id: 'legacy-song',
    fileName: 'fallback title.flac',
    filePath: '/music/fallback title.flac',
    title: 'old title',
    artist: 'Fallback Artist',
    album: 'Fallback Album',
    duration: 1,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
    ...patch,
} as unknown as LocalSong & Record<string, unknown>);

describe('localLibraryV8Migration', () => {
    it('uses embedded import metadata and removes every legacy metadata field', () => {
        const migrated = migrateLegacyLocalSongRecords([legacySong({
            embeddedTitle: 'Embedded Title',
            embeddedArtist: 'Artist One / Artist Two',
            embeddedAlbum: 'Embedded Album',
        })], 100);

        expect(migrated.songs[0]).toMatchObject({
            title: 'Embedded Title',
            titleOrigin: 'import',
            importedMetadata: {
                title: 'Embedded Title',
                titleSource: 'embedded',
                artistNames: ['Artist One', 'Artist Two'],
                albumName: 'Embedded Album',
            },
        });
        expect(migrated.assignments[0]).toMatchObject({
            artistOrigin: 'import',
            albumOrigin: 'import',
        });
        expect(migrated.assignments[0].artistEntityIds).toHaveLength(2);
        expect(migrated.songs[0]).not.toHaveProperty('embeddedTitle');
        expect(migrated.songs[0]).not.toHaveProperty('artist');
        expect(migrated.songs[0]).not.toHaveProperty('album');
    });

    it('keeps generic QQ ids isolated from legacy NetEase compatibility ids', () => {
        const migrated = migrateLegacyLocalSongRecords([legacySong({
            useOnlineMetadata: true,
            matchedMetadataSource: 'qq',
            matchedMetadataSongId: 'qq-song-mid',
            matchedMetadataAlbumId: 'qq-album-mid',
            matchedSongId: 123,
            matchedAlbumId: 456,
            matchedTitle: 'Online Title',
            matchedArtistEntities: [{ id: 'qq-artist-mid', name: 'Online Artist' }],
            matchedAlbumName: 'Online Album',
            matchedCoverUrl: 'https://example.com/cover.jpg',
        })], 100);

        expect(migrated.songs[0]).toMatchObject({
            title: 'Online Title',
            titleOrigin: 'manual-match',
            onlineMetadata: {
                source: 'qq',
                songId: 'qq-song-mid',
                albumId: 'qq-album-mid',
                matchMode: 'legacy',
                matchedAt: 100,
            },
        });
        expect(migrated.songs[0]).not.toHaveProperty('matchedSongId');
        expect(migrated.songs[0]).not.toHaveProperty('matchedAlbumId');
    });

    it('drops invalid embedded cover values while preserving valid Blobs', () => {
        const validCover = new Blob(['cover'], { type: 'image/png' });
        const migrated = migrateLegacyLocalSongRecords([
            legacySong({ id: 'invalid', embeddedCover: { size: 5, type: 'image/png' } }),
            legacySong({ id: 'valid', embeddedCover: validCover }),
        ]);

        expect(migrated.songs[0].embeddedCover).toBeUndefined();
        expect(migrated.songs[1].embeddedCover).toBe(validCover);
    });

    it('migrates legacy manual artist and album overrides independently', () => {
        const artistOnly = migrateLegacyLocalSongRecords([legacySong({
            manualArtistNames: ['Manual Artist'],
        })]);
        expect(artistOnly.assignments[0]).toMatchObject({
            artistOrigin: 'manual',
            albumOrigin: 'import',
        });
        expect(artistOnly.assignments[0].albumEntityId).toBeTruthy();

        const albumOnly = migrateLegacyLocalSongRecords([legacySong({
            manualAlbumName: 'Manual Album',
        })]);
        expect(albumOnly.assignments[0]).toMatchObject({
            artistOrigin: 'import',
            albumOrigin: 'manual',
        });
        expect(albumOnly.assignments[0].artistEntityIds).toHaveLength(1);
    });

    it('atomically upgrades a native v6 database and persists invalid-cover cleanup', async () => {
        const databaseName = `local-library-v6-${crypto.randomUUID()}`;
        const legacyDatabase = new Dexie(databaseName);
        legacyDatabase.version(0.6).stores({
            session: '',
            api_cache: 'key',
            user_cache: 'key',
            media_cache: 'key',
            metadata_cache: 'key',
            local_music: 'id',
            theme_registry: 'fingerprint',
        });
        await legacyDatabase.open();
        await legacyDatabase.table('local_music').put(legacySong({
            embeddedTitle: 'Migrated Title',
            embeddedArtist: 'Migrated Artist',
            embeddedCover: { size: 5, type: 'image/png' },
        }));
        legacyDatabase.close();

        const migratedDatabase = new AppDatabase(databaseName);
        await migratedDatabase.open();
        const persistedSong = await migratedDatabase.local_music.get('legacy-song');
        expect(persistedSong).toMatchObject({
            title: 'Migrated Title',
            titleOrigin: 'import',
        });
        expect(persistedSong).not.toHaveProperty('embeddedCover');
        expect(await migratedDatabase.local_library_assignments.get('legacy-song')).toMatchObject({
            artistOrigin: 'import',
            albumOrigin: 'import',
        });
        expect(await migratedDatabase.local_library_entities.count()).toBe(2);
        migratedDatabase.close();
        await Dexie.delete(databaseName);
    });
});
