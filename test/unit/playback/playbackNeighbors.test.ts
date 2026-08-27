import { describe, it, expect } from 'vitest';
import { resolvePlaybackNeighbors } from '../../../src/utils/playbackNeighbors';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import type { SongResult } from '../../../src/types';

// test/unit/playback/playbackNeighbors.test.ts
// 这些用例锁定的是「浮动播放条箭头」与 usePlaybackQueueController 的下标规则保持一致，
// 任何一侧改了跳转规则，另一侧必须同步，否则箭头会显示成可点却跳不动（或反过来）。
// 邻居还带着艺术家/封面，遥控窗口靠它预读下一首，字段缺了过渡就会退化成硬切。

const song = (id: string, name: string): SongResult => ({
    id,
    name,
    artists: [],
    album: {} as SongResult['album'],
    durationMs: 1000,
} as SongResult);

const queue = [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Charlie')];
const keyOf = (target: SongResult) => getPlaybackSongKey(target);

const resolve = (overrides: Partial<Parameters<typeof resolvePlaybackNeighbors>[0]> = {}) =>
    resolvePlaybackNeighbors({
        playQueue: queue,
        currentSong: queue[1],
        loopMode: 'off',
        isFmMode: false,
        isStageActive: false,
        ...overrides,
    });

describe('resolvePlaybackNeighbors', () => {
    it('returns both neighbours in the middle of the queue', () => {
        expect(resolve()).toEqual({
            prev: { canGo: true, key: keyOf(queue[0]), title: 'Alpha', artist: null, coverUrl: null },
            next: { canGo: true, key: keyOf(queue[2]), title: 'Charlie', artist: null, coverUrl: null },
        });
    });

    it('blocks prev at the head and next at the tail when loop is off', () => {
        expect(resolve({ currentSong: queue[0] }).prev).toEqual({ canGo: false, key: null, title: null, artist: null, coverUrl: null });
        expect(resolve({ currentSong: queue[2] }).next).toEqual({ canGo: false, key: null, title: null, artist: null, coverUrl: null });
    });

    it('wraps around both ends when loopMode is all', () => {
        expect(resolve({ currentSong: queue[0], loopMode: 'all' }).prev)
            .toEqual({ canGo: true, key: keyOf(queue[2]), title: 'Charlie', artist: null, coverUrl: null });
        expect(resolve({ currentSong: queue[2], loopMode: 'all' }).next)
            .toEqual({ canGo: true, key: keyOf(queue[0]), title: 'Alpha', artist: null, coverUrl: null });
    });

    it('does not wrap when loopMode is one — handleNextTrack leaves nextIndex at -1', () => {
        expect(resolve({ currentSong: queue[2], loopMode: 'one' }).next)
            .toEqual({ canGo: false, key: null, title: null, artist: null, coverUrl: null });
    });

    it('marks next as reachable but unknown when FM will fetch past the tail', () => {
        expect(resolve({ currentSong: queue[2], isFmMode: true }).next)
            .toEqual({ canGo: true, key: null, title: null, artist: null, coverUrl: null });
    });

    it('still knows the title one before the FM tail', () => {
        expect(resolve({ currentSong: queue[1], isFmMode: true }).next)
            .toEqual({ canGo: true, key: keyOf(queue[2]), title: 'Charlie', artist: null, coverUrl: null });
    });

    it('blocks both directions while the stage is active', () => {
        const result = resolve({ isStageActive: true });
        expect(result.prev.canGo).toBe(false);
        expect(result.next.canGo).toBe(false);
    });

    it('carries the neighbour artist and cover for prefetching', () => {
        const detailedQueue = [
            song('a', 'Alpha'),
            queue[1],
            {
                ...song('c', 'Charlie'),
                artists: [{ id: 1, name: 'Charlie Artist' }],
                album: { id: 1, name: 'Charlie Album', coverUrl: 'https://example.com/charlie.jpg' },
            } as SongResult,
        ];

        expect(resolve({ playQueue: detailedQueue }).next).toEqual({
            canGo: true,
            key: keyOf(detailedQueue[2]),
            title: 'Charlie',
            artist: 'Charlie Artist',
            coverUrl: 'https://example.com/charlie.jpg',
        });
    });

    it('blocks both directions without a current song or with an empty queue', () => {
        expect(resolve({ currentSong: null }).next.canGo).toBe(false);
        expect(resolve({ playQueue: [] }).next.canGo).toBe(false);
    });

    it('falls back to the queue head when the current song is not in the queue', () => {
        expect(resolve({ currentSong: song('zzz', 'Outsider') })).toEqual({
            prev: { canGo: false, key: null, title: null, artist: null, coverUrl: null },
            next: { canGo: true, key: keyOf(queue[0]), title: 'Alpha', artist: null, coverUrl: null },
        });
    });
});
