import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import {
    getPlaybackSongKey,
    hasMixedPlaybackSources,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
} from '@/utils/appPlaybackGuards';

// test/unit/utils/playbackSongIdentity.test.ts

const neteaseSong = (id: number, name = 'NetEase'): SongResult => ({
    id,
    name,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
});

const kugouSong = (hash: string, id = -1): SongResult => ({
    ...neteaseSong(id, 'Kugou'),
    id: hash,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: hash, providerData: { hash } },
});

const localSong = (songId: string, id = -1, name = 'Local'): SongResult => ({
    ...neteaseSong(id, name),
    isLocal: true,
    localRef: { songId },
    sourceRef: { kind: 'local', mediaId: songId },
} as SongResult);

const navidromeSong = (songId: string, id = -1, name = 'Navidrome'): SongResult => ({
    ...neteaseSong(id, name),
    isNavidrome: true,
    navidromeData: {
        id: songId,
        streamUrl: `https://example.com/${songId}`,
        albumId: 'album-1',
        artistId: 'artist-1',
        path: `${songId}.flac`,
        suffix: 'flac',
    },
    sourceRef: { kind: 'navidrome', mediaId: songId },
} as SongResult);

describe('playback song identity', () => {
    it('keeps equal numeric ids distinct across playback sources', () => {
        const netease = neteaseSong(-1);
        const kugou = kugouSong('-1');
        const local = localSong('local-1');
        const navidrome = navidromeSong('navi-1');

        expect(new Set([
            getPlaybackSongKey(netease),
            getPlaybackSongKey(kugou),
            getPlaybackSongKey(local),
            getPlaybackSongKey(navidrome),
        ]).size).toBe(4);
        expect(isSamePlaybackSong(local, navidrome)).toBe(false);
    });

    it('uses stable source ids instead of generated numeric ids', () => {
        expect(getPlaybackSongKey(localSong('local-stable', -123))).toBe('local:local-stable');
        expect(getPlaybackSongKey(navidromeSong('navi-stable', -123))).toBe('navidrome:navi-stable');
        expect(getPlaybackSongKey(kugouSong('ABCDEF'))).toBe('online:kugou:ABCDEF');
    });

    it('replaces the loaded song without discarding other queue sources', () => {
        const local = localSong('local-1', -1, 'Before');
        const queue = [neteaseSong(1), local, navidromeSong('navi-1')];
        const replacement = localSong('local-1', -99, 'After');

        const nextQueue = replacePlaybackSongInQueue(queue, replacement);

        expect(nextQueue.map(getPlaybackSongKey)).toEqual([
            'online:netease:1',
            'local:local-1',
            'navidrome:navi-1',
        ]);
        expect(nextQueue[1].name).toBe('After');
        expect(hasMixedPlaybackSources(nextQueue)).toBe(true);
    });
});
