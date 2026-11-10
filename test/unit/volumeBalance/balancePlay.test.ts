import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomixDeckChain } from '@/services/automix/crossfadeGraph';
import type { SongResult } from '@/types';

// test/unit/volumeBalance/balancePlay.test.ts
// Which play a song is in: a reload goes on, a cancelled blend hands the song back, a loop starts anew.

const state = vi.hoisted(() => ({
    writes: [] as Array<{ deck: string; db: number; sec: number }>,
    records: new Map<string, { file?: { loudness: number; peak?: number } }>(),
}));

vi.mock('@/utils/appPlaybackGuards', () => ({
    getPlaybackSongKey: (song: { id: string }) => song.id,
    getPlaybackSourceRef: (song: { id: string }) => ({ kind: 'online', providerId: 'x', mediaId: song.id }),
}));
vi.mock('@/services/automix/crossfadeGraph', () => ({
    rampGain: (_context: unknown, param: { deck: string }, linear: number, sec: number) => {
        state.writes.push({ deck: param.deck, db: Math.round(200 * Math.log10(linear)) / 10, sec });
    },
}));
vi.mock('@/services/automix/profileService', () => ({ getTrackProfile: () => null }));
vi.mock('@/services/automix/trackProfile', () => ({ programIsWholeTrack: () => false }));
vi.mock('@/services/playbackRecovery/representationRegistry', () => ({ getPlaybackAnalysisKey: (song: { id: string }) => song.id }));
vi.mock('@/services/volumeBalance/balanceRecords', () => ({
    getBalanceRecord: (song: { id: string }) => state.records.get(song.id) ?? null,
    loadBalanceRecord: async () => undefined,
    noteSongStarted: () => undefined,
    noteWholeReading: () => undefined,
    typicalGains: () => [],
}));

const { createBalancePlay } = await import('@/services/volumeBalance/balancePlay');

const deck = (name: string) => {
    const meter = { heard: 0, plays: 0, wraps: 0, live: null as number | null };
    const balanceMeter = {
        tick: () => undefined,
        heardSec: () => meter.heard,
        plays: () => meter.plays,
        wraps: () => meter.wraps,
        liveLoudness: () => meter.live,
        play: () => null,
    };
    return { meter, chain: { replayGain: { deck: name }, balanceMeter } as unknown as AutomixDeckChain };
};
const X = { id: 'X', name: 'X' } as SongResult;
const Y = { id: 'Y', name: 'Y' } as SongResult;
/** Loudness that asks for `gainDb` against the -14 LUFS target. */
const asking = (gainDb: number) => ({ file: { loudness: -14 - gainDb, peak: 1 } });

describe('volume balance play', () => {
    beforeEach(() => {
        state.writes = [];
        state.records.clear();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    const apply = (balance: ReturnType<typeof createBalancePlay>, song: SongResult, chain: AutomixDeckChain) => (
        balance.apply({ song, info: undefined, chain, context: {} as AudioContext, transitionAudible: false })
    );

    it('goes on through a reload of the source: the move it made is not undone (F1)', () => {
        const balance = createBalancePlay();
        const A = deck('A');
        apply(balance, X, A.chain);
        A.meter.heard = 4;
        state.records.set('X', asking(-8));
        apply(balance, X, A.chain);
        expect(state.writes.at(-1)).toEqual({ deck: 'A', db: -8, sec: 2 });
        state.writes = [];
        // The deck reloads the same song (a stream re-resolved): its meter starts again from zero.
        A.meter.plays += 1;
        A.meter.heard = 0;
        state.records.set('X', asking(-3));
        expect(apply(balance, X, A.chain)).toMatchObject({ gainDb: -8 });
        A.meter.heard = 3;
        expect(apply(balance, X, A.chain)).toMatchObject({ gainDb: -8 });
        expect(state.writes).toEqual([]);
    });

    it('hands a song back to the deck still playing it as the same play (F2)', () => {
        const balance = createBalancePlay();
        const A = deck('A');
        const B = deck('B');
        apply(balance, X, A.chain);
        A.meter.heard = 4;
        state.records.set('X', asking(-8));
        apply(balance, X, A.chain);
        // A blend is armed onto Y, then cancelled back onto X, which never stopped sounding.
        A.meter.heard = 200;
        apply(balance, Y, B.chain);
        A.meter.heard = 205;
        state.writes = [];
        state.records.set('X', asking(-12));
        expect(apply(balance, X, A.chain)).toMatchObject({ gainDb: -8 });
        A.meter.heard = 206;
        expect(apply(balance, X, A.chain)).toMatchObject({ gainDb: -8 });
        expect(state.writes).toEqual([]);
    });

    it('hands a song back to its deck after a look at the armed incoming deck (F2)', () => {
        const balance = createBalancePlay();
        const A = deck('A');
        const B = deck('B');
        apply(balance, X, A.chain);
        A.meter.heard = 40;
        apply(balance, X, A.chain);
        // A file reading 40 s in: too late to move.
        state.records.set('X', asking(-9));
        apply(balance, X, A.chain);
        // The blend arms: the active deck is B, holding Y and silent, while the app still names X.
        A.meter.heard = 200;
        apply(balance, X, B.chain);
        apply(balance, X, B.chain);
        apply(balance, Y, B.chain);
        // Cancelled back onto A, which never stopped playing X.
        A.meter.heard = 205;
        state.writes = [];
        expect(apply(balance, X, A.chain)).toMatchObject({ gainDb: -5 });
        expect(state.writes).toEqual([]);
    });

    it('carries the play\'s gain to another deck the same song goes on on', () => {
        const balance = createBalancePlay();
        const A = deck('A');
        const B = deck('B');
        state.records.set('X', asking(-8));
        apply(balance, X, A.chain);
        A.meter.heard = 100;
        apply(balance, X, A.chain);
        state.writes = [];
        // The same song blended into itself: the bridge now hands over deck B.
        B.meter.heard = 1;
        expect(apply(balance, X, B.chain)).toMatchObject({ gainDb: -8 });
        expect(state.writes).toEqual([{ deck: 'B', db: -8, sec: 0.1 }]);
    });

    it('starts each loop as a new play, on the best reading at the wrap (F3)', () => {
        const balance = createBalancePlay();
        const A = deck('A');
        apply(balance, X, A.chain);
        A.meter.heard = 40;
        state.records.set('X', asking(-3));
        apply(balance, X, A.chain);
        expect(state.writes).toHaveLength(1);
        // The loop comes round.
        A.meter.wraps += 1;
        A.meter.plays += 1;
        A.meter.heard = 0;
        apply(balance, X, A.chain);
        expect(state.writes.at(-1)).toEqual({ deck: 'A', db: -3, sec: 0.1 });
        A.meter.heard = 4;
        state.records.set('X', asking(-6));
        apply(balance, X, A.chain);
        expect(state.writes.at(-1)).toEqual({ deck: 'A', db: -6, sec: 2 });
    });
});
