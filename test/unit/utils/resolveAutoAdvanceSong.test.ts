import { describe, expect, it } from 'vitest';
import { resolveAutoAdvanceSong } from '@/utils/playbackNeighbors';
import type { SongResult } from '@/types';

// test/unit/utils/resolveAutoAdvanceSong.test.ts

const song = (id: string): SongResult => ({ id, name: id, artists: [], album: { id: 0, name: '' }, durationMs: 1000, sourceRef: { kind: 'online', providerId: 'applemusic', mediaId: id } });
const queue = [song('a'), song('b'), song('c')];

describe('resolveAutoAdvanceSong', () => {
    it('follows the queue, wraps only when looping all, and repeats for loop one', () => {
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: queue[0], loopMode: 'off', isFmMode: false })).toBe(queue[1]);
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: queue[2], loopMode: 'off', isFmMode: false })).toBeNull();
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: queue[2], loopMode: 'all', isFmMode: false })).toBe(queue[0]);
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: queue[1], loopMode: 'one', isFmMode: false })).toBe(queue[1]);
    });
    it('gives up at the FM tail where fresh tracks are fetched, and restarts an unknown song from the top', () => {
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: queue[2], loopMode: 'all', isFmMode: true })).toBeNull();
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: queue[1], loopMode: 'off', isFmMode: true })).toBe(queue[2]);
        expect(resolveAutoAdvanceSong({ playQueue: queue, currentSong: song('zzz'), loopMode: 'off', isFmMode: false })).toBe(queue[0]);
        expect(resolveAutoAdvanceSong({ playQueue: [], currentSong: queue[0], loopMode: 'all', isFmMode: false })).toBeNull();
    });
});
