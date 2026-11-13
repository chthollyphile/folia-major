import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    decideRoundStep,
    isRoundQueue,
    queueFingerprint,
    queueOrderHash,
    shuffleForRound,
    type ShuffleRoundState,
} from '@/components/app/playback/shuffle/shuffleRound';
import { readShuffleRoundState, SHUFFLE_ROUND_STATE_KEY, writeShuffleRoundState } from '@/components/app/playback/shuffle/shuffleRoundState';

// test/unit/playback/shuffleRound.test.ts
// 「一轮不重复」的规则：听过的排到后面、整轮听完清零、播不了的不拦住一轮、只认洗出来的那一队、同一批歌接着
// 上一轮；切歌时记下 / 重洗的判断；存下来的那一轮读坏数据时的容错。

const keyOf = (song: string) => song;
const SONGS = ['a', 'b', 'c', 'd', 'e', 'f'];
const round = (order: string[], played: string[]): ShuffleRoundState => (
    { fingerprint: queueFingerprint(order), orderHash: queueOrderHash(order), played }
);

describe('queue hashes', () => {
    it('fingerprints the batch regardless of order, and hashes the order itself', () => {
        expect(queueFingerprint(['a', 'b', 'c'])).toBe(queueFingerprint(['c', 'a', 'b']));
        expect(queueFingerprint(['a', 'b', 'c'])).not.toBe(queueFingerprint(['a', 'b', 'd']));
        expect(queueFingerprint(['a', 'b'])).not.toBe(queueFingerprint(['a', 'b', 'b']));
        expect(queueFingerprint(['ab', 'c'])).not.toBe(queueFingerprint(['a', 'bc']));
        expect(queueOrderHash(['a', 'b', 'c'])).not.toBe(queueOrderHash(['c', 'a', 'b']));
    });
});

describe('shuffleForRound', () => {
    it('starts the first round with the whole batch shuffled when nothing is kept', () => {
        const { queue, state, newRound } = shuffleForRound({ songs: SONGS, keyOf, pinnedIndex: -1, state: null });
        expect([...queue].sort()).toEqual(SONGS);
        expect(newRound).toBe(false);
        expect(state.played).toEqual([]);
        expect(isRoundQueue(state, queue)).toBe(true);
        expect(state.fingerprint).toBe(queueFingerprint(SONGS));
    });

    it('pins the playing song first, counts it heard, and puts the songs heard this round after the rest', () => {
        const kept = round(SONGS, ['a', 'b']);
        for (let run = 0; run < 20; run += 1) {
            const { queue, state, newRound } = shuffleForRound({ songs: SONGS, keyOf, pinnedIndex: 2, state: kept });
            expect(newRound).toBe(false);
            expect(queue[0]).toBe('c');
            expect([...queue.slice(1, 4)].sort()).toEqual(['d', 'e', 'f']);
            expect([...queue.slice(4)].sort()).toEqual(['a', 'b']);
            expect([...state.played].sort()).toEqual(['a', 'b', 'c']);
        }
    });

    it('carries the round of the same batch into a new queue (a shuffle-play of the same playlist again)', () => {
        const kept = round(['f', 'e', 'd', 'c', 'b', 'a'], ['f', 'e', 'd']);
        const { queue } = shuffleForRound({ songs: SONGS, keyOf, pinnedIndex: -1, state: kept });
        expect([...queue.slice(0, 3)].sort()).toEqual(['a', 'b', 'c']);
        expect([...queue.slice(3)].sort()).toEqual(['d', 'e', 'f']);
    });

    it('does not carry a round of another batch', () => {
        const kept: ShuffleRoundState = { ...round(['x', 'y'], []), played: ['a', 'b', 'c'] };
        const { state } = shuffleForRound({ songs: SONGS, keyOf, pinnedIndex: 0, state: kept });
        expect(state.played).toEqual(['a']);
    });

    it('starts a new round once every song was heard, keeping only the playing one', () => {
        const { queue, state, newRound } = shuffleForRound({ songs: SONGS, keyOf, pinnedIndex: 5, state: round(SONGS, [...SONGS]) });
        expect(newRound).toBe(true);
        expect(queue[0]).toBe('f');
        expect(state.played).toEqual(['f']);
    });

    it('does not let a song that never plays hold the round open', () => {
        // 'f' cannot be played (a greyed-out song): every song that can was heard, so this is a new round.
        const counts = (song: string) => song !== 'f';
        const { newRound } = shuffleForRound({ songs: SONGS, keyOf, pinnedIndex: 0, state: round(SONGS, ['a', 'b', 'c', 'd', 'e']), counts });
        expect(newRound).toBe(true);
    });

    it('shuffles with the given draws (Fisher–Yates over each part)', () => {
        const { queue } = shuffleForRound({ songs: ['a', 'b', 'c'], keyOf, pinnedIndex: -1, state: null, random: () => 0 });
        expect(queue).toEqual(['b', 'c', 'a']);
    });
});

describe('decideRoundStep', () => {
    const order = ['b', 'a', 'c'];
    const kept = round(order, ['b']);
    const step = (overrides: Partial<Parameters<typeof decideRoundStep>[0]>) => decideRoundStep({
        state: kept, keys: order, currentKey: 'a', countedKeys: order, loopMode: 'all', ...overrides,
    });

    it('notes the playing song of the queue it shuffled', () => {
        expect(step({})).toEqual({ kind: 'write', state: { ...kept, played: ['b', 'a'] } });
        // Already heard: nothing to write.
        expect(step({ currentKey: 'b' })).toEqual({ kind: 'none' });
    });

    it('leaves any other queue alone: reordered, grown, not shuffled at all, or a song not in it', () => {
        expect(step({ keys: ['a', 'b', 'c'] })).toEqual({ kind: 'none' });
        expect(step({ keys: [...order, 'd'] })).toEqual({ kind: 'none' });
        expect(step({ state: null })).toEqual({ kind: 'none' });
        expect(step({ currentKey: 'z' })).toEqual({ kind: 'none' });
    });

    it('reshuffles a finished round only under list loop', () => {
        const almost = round(order, ['b', 'a']);
        expect(step({ state: almost, currentKey: 'c' })).toEqual({ kind: 'reshuffle' });
        expect(step({ state: almost, currentKey: 'c', loopMode: 'off' })).toEqual({ kind: 'write', state: { ...almost, played: ['b', 'a', 'c'] } });
        expect(step({ state: almost, currentKey: 'c', loopMode: 'one' })).toEqual({ kind: 'write', state: { ...almost, played: ['b', 'a', 'c'] } });
    });

    it('finishes a round without the songs that cannot play', () => {
        expect(step({ state: round(order, ['b']), currentKey: 'a', countedKeys: ['b', 'a'] })).toEqual({ kind: 'reshuffle' });
    });

    it('does not reshuffle again right after a reshuffle (only the playing song is heard then)', () => {
        const reshuffled = shuffleForRound({ songs: order, keyOf, pinnedIndex: 2, state: round(order, [...order]) });
        expect(decideRoundStep({
            state: reshuffled.state, keys: reshuffled.queue, currentKey: 'c', countedKeys: order, loopMode: 'all',
        })).toEqual({ kind: 'none' });
    });
});

describe('the kept round', () => {
    let values: Map<string, string>;
    let failWrites: boolean;
    beforeEach(() => {
        values = new Map();
        failWrites = false;
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                if (failWrites) throw new DOMException('full', 'QuotaExceededError');
                values.set(key, String(value));
            },
            removeItem: (key: string) => { values.delete(key); },
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('reads back what was written', () => {
        const kept = round(SONGS, ['a']);
        writeShuffleRoundState(kept);
        expect(readShuffleRoundState()).toEqual(kept);
    });

    it('reads nothing from a missing, broken or foreign value', () => {
        expect(readShuffleRoundState()).toBeNull();
        values.set(SHUFFLE_ROUND_STATE_KEY, '{not json');
        expect(readShuffleRoundState()).toBeNull();
        values.set(SHUFFLE_ROUND_STATE_KEY, JSON.stringify({ fingerprint: 'x', order: ['a'], played: ['a'] }));
        expect(readShuffleRoundState()).toBeNull();
        values.set(SHUFFLE_ROUND_STATE_KEY, JSON.stringify({ fingerprint: 'x', orderHash: 'y', played: [1] }));
        expect(readShuffleRoundState()).toBeNull();
    });

    it('does not throw when the round cannot be saved', () => {
        failWrites = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => writeShuffleRoundState(round(SONGS, []))).not.toThrow();
        expect(warn).toHaveBeenCalled();
    });
});
