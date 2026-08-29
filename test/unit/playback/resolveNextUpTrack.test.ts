import { describe, it, expect } from 'vitest';
import { resolveNextUpTrack } from '../../../src/components/app/overlays/now-playing-toast/resolveNextUpTrack';
import type { SongResult } from '../../../src/types';

// test/unit/playback/resolveNextUpTrack.test.ts
// now playing 卡片的「接下来播放」预览必须和 handleNextTrack 的下标规则一致：
// 预览错一首比不预览更难看，所以推不出来时一律 null。

const song = (id: string, name: string): SongResult => ({
    id,
    name,
    artists: [],
    album: {} as SongResult['album'],
    durationMs: 1000,
} as SongResult);

const queue = [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Charlie')];

const resolve = (overrides: Partial<Parameters<typeof resolveNextUpTrack>[0]> = {}) =>
    resolveNextUpTrack({
        playQueue: queue,
        song: queue[1],
        loopMode: 'off',
        isFmMode: false,
        isStageActive: false,
        ...overrides,
    });

describe('resolveNextUpTrack', () => {
    it('returns the following track in the middle of the queue', () => {
        expect(resolve()?.name).toBe('Charlie');
    });

    it('returns null at the tail when loop is off', () => {
        expect(resolve({ song: queue[2] })).toBeNull();
    });

    it('wraps to the queue head at the tail when loopMode is all', () => {
        expect(resolve({ song: queue[2], loopMode: 'all' })?.name).toBe('Alpha');
    });

    it('returns null for loopMode one — the same track repeats, there is no next up', () => {
        expect(resolve({ loopMode: 'one' })).toBeNull();
    });

    it('returns null while the stage is active — it does not advance the main queue', () => {
        expect(resolve({ isStageActive: true })).toBeNull();
    });

    it('returns null without a base song or with an empty queue', () => {
        expect(resolve({ song: null })).toBeNull();
        expect(resolve({ playQueue: [] })).toBeNull();
    });

    // FM 只在队尾那一首上不确定：它的后继是刚拉回来的第一首，此刻还不存在。
    it('returns null on the last FM track', () => {
        expect(resolve({ song: queue[2], isFmMode: true })).toBeNull();
    });

    // 倒数第二首上 handleNextTrack 也会去拉新曲目，但拉完播的是 nextQueue[currentIndex + 1]，
    // 也就是旧队列的最后一首 —— 已经在手里了，所以这一首照常预览。
    it('previews the known successor on the penultimate FM track', () => {
        expect(resolve({ song: queue[1], isFmMode: true })?.name).toBe('Charlie');
    });

    // 队尾也不能落到 loopMode === 'all' 那条：FM 到底是拉新歌，不是回到队首。
    it('does not offer the FM queue head as the successor of the last track', () => {
        expect(resolve({ song: queue[2], isFmMode: true, loopMode: 'all' })).toBeNull();
    });

    it('still previews further from the FM tail', () => {
        expect(resolve({ song: queue[0], isFmMode: true })?.name).toBe('Bravo');
    });

    it('only falls back to the queue head for an off-queue song when asked', () => {
        const outsider = song('zzz', 'Outsider');
        expect(resolve({ song: outsider })).toBeNull();
        expect(resolve({ song: outsider, fallbackToQueueHead: true })?.name).toBe('Alpha');
    });
});
