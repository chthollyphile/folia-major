import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '../../../../src/types';
import type { NavidromeSong } from '../../../../src/types/navidrome';
import { buildNavidromeQueue } from '../../../../src/services/playbackAdapters';
import {
    resolveTrackAlbumLink,
    resolveTrackAlbumTargetId,
    resolveTrackArtistLinks,
    resolveTrackArtistTargetId,
} from '../../../../src/library/core/shared/trackLinks';

// test/unit/library/core/trackLinks.test.ts
// Locks track links (grid cards, TUI rows) to source identities instead of display-only metadata IDs.
// P4.3 起规则在 core/shared/trackLinks（原 suites/grid/shared/gridTrackNavigation），网格卡片与 TUI 行共用。

describe('track link targets', () => {
    it('uses Navidrome service IDs from the nested GridView queue carrier', () => {
        const navidromeSong: NavidromeSong = {
            id: -1,
            name: 'Song',
            artists: [{ id: 0, name: 'Artist' }],
            album: { id: 0, name: 'Album' },
            durationMs: 180_000,
            isNavidrome: true,
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

        expect(resolveTrackArtistTargetId(track, track.artists[0])).toBe('artist-1');
        expect(resolveTrackAlbumTargetId(track)).toBe('album-1');
    });

    it('preserves local entity IDs and regular provider IDs', () => {
        const localTrack = {
            id: -2,
            name: 'Local song',
            artists: [{ id: 0, entityId: 'local-artist', name: 'Artist' }],
            album: { id: 0, entityId: 'local-album', name: 'Album' },
            durationMs: 180_000,
            isLocal: true,
            sourceRef: { kind: 'local', mediaId: 'local-song' },
        } satisfies UnifiedSong;
        const onlineTrack = {
            id: 1,
            name: 'Online song',
            artists: [{ id: 11, name: 'Artist' }],
            album: { id: 22, name: 'Album' },
            durationMs: 180_000,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
        } satisfies UnifiedSong;

        expect(resolveTrackArtistTargetId(localTrack, localTrack.artists[0])).toBe('local-artist');
        expect(resolveTrackAlbumTargetId(localTrack)).toBe('local-album');
        expect(resolveTrackArtistTargetId(onlineTrack, onlineTrack.artists[0])).toBe(11);
        expect(resolveTrackAlbumTargetId(onlineTrack)).toBe(22);
    });


    it('opens an online song\'s artist or album only when the provider resolves its catalog reference', () => {
        const onlineTrack = {
            id: 1,
            name: 'Online song',
            artists: [{ id: 11, name: 'Artist' }, { id: '', name: 'No id' }],
            album: { id: 22, name: 'Album' },
            durationMs: 180_000,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
        } satisfies UnifiedSong;
        const resolves = () => true;
        expect(resolveTrackArtistLinks(onlineTrack, resolves).map(link => link.targetId)).toEqual([11, undefined]);
        expect(resolveTrackAlbumLink(onlineTrack, resolves)).toEqual({ album: onlineTrack.album, targetId: 22 });
        const refuses = () => false;
        expect(resolveTrackArtistLinks(onlineTrack, refuses).map(link => link.targetId)).toEqual([undefined, undefined]);
        expect(resolveTrackAlbumLink(onlineTrack, refuses)).toBeNull();
        // 本地歌不问 provider：有实体 id 就能打开。
        const localTrack = {
            id: -2,
            name: 'Local song',
            artists: [{ id: 0, entityId: 'local-artist', name: 'Artist' }],
            album: { id: 0, entityId: 'local-album', name: 'Album' },
            durationMs: 180_000,
            isLocal: true,
            sourceRef: { kind: 'local', mediaId: 'local-song' },
        } satisfies UnifiedSong;
        expect(resolveTrackArtistLinks(localTrack, refuses)[0].targetId).toBe('local-artist');
        expect(resolveTrackAlbumLink(localTrack, refuses)?.targetId).toBe('local-album');
    });
});
