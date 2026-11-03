import { describe, it, expect } from 'vitest';
import { resolvePlaybackNeighbors } from '../../../src/utils/playbackNeighbors';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import type { SongResult } from '../../../src/types';

// test/unit/playback/playbackNeighbors.test.ts
// 这些用例锁定「浮动播放条箭头」的邻居。它和 usePlaybackQueueController 现在调的是同一组下标规则
// （playbackNeighbors.ts 的 nextQueueIndex / prevQueueIndex / queueLoopMode），不用再靠手动让两侧保持一致。
// 邻居还带着艺术家/封面，遥控窗口靠它预读下一首，字段缺了过渡就会退化成硬切；
// 这两项要走 provider 元数据，所以只在 withMetadata 时解析。

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

        expect(resolve({ playQueue: detailedQueue, withMetadata: true }).next).toEqual({
            canGo: true,
            key: keyOf(detailedQueue[2]),
            title: 'Charlie',
            artist: 'Charlie Artist',
            coverUrl: 'https://example.com/charlie.jpg',
        });
    });

    it('skips provider metadata unless the caller asks for it', () => {
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
            artist: null,
            coverUrl: null,
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

    it('lets both arrows replay the only track of a one-track queue in repeat-all', () => {
        const only = [queue[0]];
        const result = resolve({ playQueue: only, currentSong: only[0], loopMode: 'all' });
        expect(result.prev).toMatchObject({ canGo: true, title: 'Alpha' });
        expect(result.next).toMatchObject({ canGo: true, title: 'Alpha' });
    });

    it('blocks next in FM when the queue is empty — handleNextTrack returns before fetching', () => {
        expect(resolve({ playQueue: [], isFmMode: true }).next.canGo).toBe(false);
    });

    // 私人 FM 的队列不绕回：第一首按上一首不会跳到队尾那首最新拉来的，列表循环开着也一样。
    it('has no previous track on the first Personal FM track, repeat-all or not', () => {
        for (const loopMode of ['off', 'all', 'one'] as const) {
            const result = resolve({ currentSong: queue[0], loopMode, isFmMode: true });
            expect(result.prev.canGo, loopMode).toBe(false);
            expect(result.next, loopMode).toMatchObject({ canGo: true, title: 'Bravo' });
        }
    });

    it('still steps back inside the Personal FM queue', () => {
        expect(resolve({ currentSong: queue[2], loopMode: 'all', isFmMode: true }).prev)
            .toMatchObject({ canGo: true, title: 'Bravo' });
    });
});

// canGo 为 true 即按下去 handler 会去试。下面两个判断式照 usePlaybackQueueController 的
// handleNextTrack / handlePrevTrack 抄：早退在前；FM 走到最后两首时先去拉新曲目（拉不拉得到
// 事先不知道，算会去试）；其余看有没有下标可去。
// 下标规则在这里重写了一遍，没有调模块里的 nextQueueIndex / prevQueueIndex：两边调同一个函数的话，
// 函数写错了这条也照过。这两个判断式是抄的，不是 handler 本身：handler 改了规则，这里要跟着改。
describe('canGo against what the handlers do', () => {
    const tracks = [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Charlie'), song('d', 'Delta')];
    const outsider = song('zzz', 'Outsider');
    const indexIn = (playQueue: SongResult[], current: SongResult) =>
        playQueue.findIndex(item => keyOf(item) === keyOf(current));
    // 只有列表循环会从队列一头绕到另一头，私人 FM 的队列不绕。
    const goesRound = (loopMode: 'off' | 'all' | 'one', isFmMode: boolean) => loopMode === 'all' && !isFmMode;

    const nextDoesSomething = (
        playQueue: SongResult[],
        current: SongResult | null,
        loopMode: 'off' | 'all' | 'one',
        isFmMode: boolean,
        isStageActive: boolean,
    ): boolean => {
        if (isStageActive) return false;
        if (!current || playQueue.length === 0) return false;
        const index = indexIn(playQueue, current);
        if (isFmMode && index >= playQueue.length - 2) return true;
        // 不在队列里的曲目去队首；队列里的去后一首；最后一首只有绕回才有地方去。
        return index < playQueue.length - 1 || goesRound(loopMode, isFmMode);
    };

    const prevDoesSomething = (
        playQueue: SongResult[],
        current: SongResult | null,
        loopMode: 'off' | 'all' | 'one',
        isFmMode: boolean,
        isStageActive: boolean,
    ): boolean => {
        if (isStageActive) return false;
        if (!current || playQueue.length === 0) return false;
        // 第一首和不在队列里的曲目，只有绕到队尾才有地方去。
        return indexIn(playQueue, current) > 0 || goesRound(loopMode, isFmMode);
    };

    it('agrees on every queue of up to four tracks, current song, repeat mode, FM and stage state', () => {
        for (let length = 0; length <= tracks.length; length += 1) {
            const playQueue = tracks.slice(0, length);
            for (const currentSong of [null, outsider, ...playQueue]) {
                for (const loopMode of ['off', 'all', 'one'] as const) {
                    for (const isFmMode of [false, true]) {
                        for (const isStageActive of [false, true]) {
                            const label = `${length} tracks, on ${currentSong?.name ?? 'nothing'}, ${loopMode}, fm ${isFmMode}, stage ${isStageActive}`;
                            const result = resolvePlaybackNeighbors({ playQueue, currentSong, loopMode, isFmMode, isStageActive });
                            expect(result.next.canGo, `next: ${label}`)
                                .toBe(nextDoesSomething(playQueue, currentSong, loopMode, isFmMode, isStageActive));
                            expect(result.prev.canGo, `prev: ${label}`)
                                .toBe(prevDoesSomething(playQueue, currentSong, loopMode, isFmMode, isStageActive));
                        }
                    }
                }
            }
        }
    });
});
