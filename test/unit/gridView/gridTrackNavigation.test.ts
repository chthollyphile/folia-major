import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '../../../src/types';
import type { NavidromeSong } from '../../../src/types/navidrome';
import { buildNavidromeQueue } from '../../../src/services/playbackAdapters';
import {
    resolveGridTrackAlbumTargetId,
    resolveGridTrackArtistTargetId,
} from '../../../src/components/folia-grid/gridTrackNavigation';

// Locks GridView links to source identities instead of display-only metadata IDs.

describe('GridView track navigation targets', () => {
    it('uses Navidrome service IDs from the nested GridView queue carrier', () => {
        const navidromeSong: NavidromeSong = {
            id: -1,
            name: 'Song',
            artists: [{ id: 0, name: 'Artist' }],
            album: { id: 0, name: 'Album' },
            duration: 180_000,
            isNavidrome: true,
            ar: [{ id: 0, name: 'Artist' }],
            al: { id: 0, name: 'Album' },
            navidromeData: {
                id: 'song-1',
                streamUrl: 'https://example.com/stream',
                artistId: 'artist-1',
                albumId: 'album-1',
                path: 'Artist/Album/Song.mp3',
                suffix: 'mp3',
            },
        };
        const [track] = buildNavidromeQueue([navidromeSong]);

        expect(resolveGridTrackArtistTargetId(track, track.ar![0])).toBe('artist-1');
        expect(resolveGridTrackAlbumTargetId(track)).toBe('album-1');
    });

    it('preserves local entity IDs and regular provider IDs', () => {
        const localTrack = {
            id: -2,
            name: 'Local song',
            artists: [{ id: 0, entityId: 'local-artist', name: 'Artist' }],
            album: { id: 0, entityId: 'local-album', name: 'Album' },
            duration: 180_000,
            isLocal: true,
            ar: [{ id: 0, entityId: 'local-artist', name: 'Artist' }],
            al: { id: 0, entityId: 'local-album', name: 'Album' },
        } satisfies UnifiedSong;
        const onlineTrack = {
            id: 1,
            name: 'Online song',
            artists: [{ id: 11, name: 'Artist' }],
            album: { id: 22, name: 'Album' },
            duration: 180_000,
            ar: [{ id: 11, name: 'Artist' }],
            al: { id: 22, name: 'Album' },
        } satisfies UnifiedSong;

        expect(resolveGridTrackArtistTargetId(localTrack, localTrack.ar![0])).toBe('local-artist');
        expect(resolveGridTrackAlbumTargetId(localTrack)).toBe('local-album');
        expect(resolveGridTrackArtistTargetId(onlineTrack, onlineTrack.ar![0])).toBe(11);
        expect(resolveGridTrackAlbumTargetId(onlineTrack)).toBe(22);
    });
});
