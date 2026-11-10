import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { applyQueueAddBehavior, queueForPlayingNow } from '@/utils/queueAddBehavior';

// test/unit/utils/queueAddBehavior.test.ts

const song = (id: number, patch: Partial<SongResult> = {}): SongResult => ({
    id,
    name: String(id),
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    ...patch,
});

describe('applyQueueAddBehavior', () => {
    it('does not deduplicate different sources that share a numeric id', () => {
        const local = song(-1, {
            isLocal: true,
            localRef: { songId: 'local-1' },
        } as Partial<SongResult>);
        const navidrome = song(-1, {
            isNavidrome: true,
            navidromeData: {
                id: 'navi-1',
                streamUrl: 'https://example.com/navi-1',
                albumId: 'album-1',
                artistId: 'artist-1',
                path: 'navi-1.flac',
                suffix: 'flac',
            },
        } as Partial<SongResult>);

        const result = applyQueueAddBehavior({
            queue: [local],
            songs: [navidrome],
            currentSong: local,
            behavior: 'append',
        });

        expect(result.nextQueue.map(getPlaybackSongKey)).toEqual([
            'local:local-1',
            'navidrome:navi-1',
        ]);
    });

    it('moves an existing same-source song next to the current song', () => {
        const first = song(1);
        const second = song(2);
        const third = song(3);

        const result = applyQueueAddBehavior({
            queue: [first, second, third],
            songs: [third],
            currentSong: first,
            behavior: 'next',
        });

        expect(result.nextQueue.map(getPlaybackSongKey)).toEqual([
            'online:netease:1',
            'online:netease:3',
            'online:netease:2',
        ]);
    });
});

describe('queueForPlayingNow', () => {
    const ids = (queue: SongResult[]) => queue.map(entry => entry.id);
    const [a, b, c, d] = [song(1), song(2), song(3), song(4)];

    it('puts a song not in the queue where the add-to-queue setting puts songs', () => {
        expect(ids(queueForPlayingNow({ queue: [a, b, c], song: d, currentSong: a, behavior: 'next' }))).toEqual([1, 4, 2, 3]);
        expect(ids(queueForPlayingNow({ queue: [a, b, c], song: d, currentSong: a, behavior: 'append' }))).toEqual([1, 2, 3, 4]);
    });

    it('plays a song already in the queue where it stands', () => {
        const queue = [a, b, c];
        expect(queueForPlayingNow({ queue, song: c, currentSong: a, behavior: 'next' })).toBe(queue);
    });

    it('keeps the current song when the queue is empty, and makes a queue of the song alone with nothing playing', () => {
        expect(ids(queueForPlayingNow({ queue: [], song: d, currentSong: a, behavior: 'next' }))).toEqual([1, 4]);
        expect(ids(queueForPlayingNow({ queue: [], song: d, currentSong: null, behavior: 'append' }))).toEqual([4]);
        expect(ids(queueForPlayingNow({ queue: [], song: a, currentSong: a, behavior: 'next' }))).toEqual([1]);
    });
});
