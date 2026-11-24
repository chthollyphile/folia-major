// @builtin-sources
import { describe, expect, it } from 'vitest';
import {
    createSearchAlbumCollection,
    createSearchArtistCollection,
} from '@/components/app/search/searchCollectionAdapters';
import type { UnifiedSong } from '@/types';
import { hostKugouSong } from '../helpers/kugouSource';

// Verifies all search sources produce GridView-native collection descriptors.

const baseTrack = (): UnifiedSong => ({
    id: 1,
    name: 'Track',
    artists: [{ id: 2, name: 'Artist' }],
    album: { id: 3, name: 'Album', coverUrl: 'https://example.com/cover.jpg' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
});

describe('search collection adapters', () => {
    it('creates NetEase artist and album descriptors', async () => {
        const track = baseTrack();
        await expect(createSearchArtistCollection(track, 'Artist', 2)).resolves.toEqual(expect.objectContaining({
            source: 'online',
            providerId: 'netease',
            id: 2,
            type: 'artist',
        }));
        await expect(createSearchAlbumCollection(track, 'Album', 3)).resolves.toEqual(expect.objectContaining({
            source: 'online',
            providerId: 'netease',
            id: 3,
            type: 'album',
        }));
    });

    it('uses stable local entity ids and refuses unresolved local links', async () => {
        const track: UnifiedSong = {
            ...baseTrack(),
            isLocal: true,
            localRef: { songId: 'song-1' },
            sourceRef: { kind: 'local', mediaId: 'song-1' },
        };
        await expect(createSearchArtistCollection(track, 'Artist', 0, 'artist-1')).resolves.toEqual(expect.objectContaining({
            source: 'local',
            id: 'artist-1',
            entityId: 'artist-1',
            songIds: ['song-1'],
        }));
        await expect(createSearchAlbumCollection(track, 'Album')).resolves.toBeNull();
    });

    it('uses Navidrome source ids from the playback carrier', async () => {
        const track: UnifiedSong = {
            ...baseTrack(),
            isNavidrome: true,
            sourceRef: { kind: 'navidrome', mediaId: 'song-1' },
            navidromeData: {
                ...baseTrack(),
                id: 'song-1',
                isNavidrome: true,
                artistId: 'artist-1',
                albumId: 'album-1',
            } as any,
        };
        await expect(createSearchArtistCollection(track, 'Artist')).resolves.toEqual(expect.objectContaining({
            source: 'navidrome',
            id: 'artist-1',
        }));
        await expect(createSearchAlbumCollection(track, 'Album')).resolves.toEqual(expect.objectContaining({
            source: 'navidrome',
            id: 'album-1',
        }));
    });

    // KuGou is a source mod: its songs carry the catalog ids as their ids (the adapter makes the refs from them), and an
    // artist without an id of KuGou's cannot be opened.
    it('uses the catalog references of KuGou, and opens no artist KuGou gave no id', async () => {
        const track = hostKugouSong({
            FileHash: 'HASH',
            SongName: 'Track',
            Singers: [{ author_id: 6539, name: 'Artist' }],
            AlbumID: 10729818,
            AlbumName: 'Album',
        });

        await expect(createSearchArtistCollection(track, 'Artist', track.artists[0].id)).resolves.toMatchObject({
            providerId: 'kugou', id: '6539', type: 'artist',
        });
        await expect(createSearchAlbumCollection(track, 'Album', track.album.id)).resolves.toMatchObject({
            providerId: 'kugou', id: '10729818', type: 'album',
        });
        const unknownArtist = hostKugouSong({ FileHash: 'HASH', SongName: 'Track', SingerName: 'Someone' });
        await expect(createSearchArtistCollection(unknownArtist, 'Someone', unknownArtist.artists[0].id)).resolves.toBeNull();
    });
});
