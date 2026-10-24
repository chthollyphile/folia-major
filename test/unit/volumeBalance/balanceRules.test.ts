import { describe, expect, it } from 'vitest';
import {
    chooseBalance,
    planBalanceMove,
    typicalGainDb,
    TYPICAL_FALLBACK_DB,
    VOLUME_BALANCE_MAX_BOOST_DB,
    VOLUME_BALANCE_PEAK_CEILING_DB,
    VOLUME_BALANCE_TARGET_DB,
    whyNotWholePlay,
    type MeteredPlay,
} from '@/services/volumeBalance/balanceRules';
import { gatedLoudness, LUFS_OFFSET_DB, SILENCE_DB } from '@/services/automix/signalAnalysis';

// test/unit/volumeBalance/balanceRules.test.ts

const TARGET = VOLUME_BALANCE_TARGET_DB;
const dbfs = (db: number) => 10 ** (db / 20);

describe('volume balance readings', () => {
    it('lifts a whole-track reading only within the cap and the peak ceiling', () => {
        const at = (loudness: number, peak?: number) => chooseBalance({ file: { loudness, peak }, typicalDb: -5 }).effectiveGainDb;
        expect(at(TARGET + 6, 1)).toBeCloseTo(-6, 8);
        expect(at(TARGET - 5, dbfs(-10))).toBeCloseTo(5, 8);
        expect(at(TARGET - 5, dbfs(-4))).toBeCloseTo(VOLUME_BALANCE_PEAK_CEILING_DB + 4, 8);
        expect(at(TARGET - 20, dbfs(-30))).toBe(VOLUME_BALANCE_MAX_BOOST_DB);
        expect(at(TARGET - 5)).toBe(0);
        expect(at(TARGET - 5, 1)).toBe(0);
    });

    it('takes a silent whole-track reading as none', () => {
        const silent = { loudness: SILENCE_DB, peak: 0.001 };
        expect(chooseBalance({ file: silent, played: silent, profile: silent, typicalDb: -5 }))
            .toMatchObject({ reading: 'typical', effectiveGainDb: -5, estimated: true });
        expect(chooseBalance({ file: silent, played: { loudness: -10, peak: 1 }, typicalDb: -5 })).toMatchObject({ reading: 'played' });
    });

    it('takes the most trusted reading there is', () => {
        const all = {
            file: { loudness: -10, peak: 1 },
            played: { loudness: -11, peak: 1 },
            profile: { loudness: -12, peak: 1 },
            tag: { gainDb: -3, peak: 1 },
            head: -8,
            platformDb: -2,
            live: -9,
            typicalDb: -5,
        };
        expect(chooseBalance(all)).toMatchObject({ reading: 'file', estimated: false });
        expect(chooseBalance({ ...all, file: null })).toMatchObject({ reading: 'played', effectiveGainDb: -3 });
        expect(chooseBalance({ ...all, file: null, played: null })).toMatchObject({ reading: 'profile', effectiveGainDb: -2 });
        expect(chooseBalance({ ...all, file: null, played: null, profile: null })).toMatchObject({ reading: 'tag', estimated: false });
        expect(chooseBalance({ typicalDb: -5, head: -8, platformDb: -2, live: -9 })).toMatchObject({ reading: 'head', effectiveGainDb: -6, estimated: true });
        expect(chooseBalance({ typicalDb: -5, platformDb: -2, live: -9 })).toMatchObject({ reading: 'platform', effectiveGainDb: -2 });
        expect(chooseBalance({ typicalDb: -5, live: -9 })).toMatchObject({ reading: 'live', effectiveGainDb: -5 });
        expect(chooseBalance({ typicalDb: -4 })).toMatchObject({ reading: 'typical', effectiveGainDb: -4, estimated: true });
    });

    it('turns down only on an estimate', () => {
        expect(chooseBalance({ typicalDb: -5, head: TARGET - 6 }).effectiveGainDb).toBe(0);
        expect(chooseBalance({ typicalDb: -5, platformDb: 3 }).effectiveGainDb).toBe(0);
        expect(chooseBalance({ typicalDb: -5, live: TARGET - 6 }).effectiveGainDb).toBe(0);
    });

    it('reads a ReplayGain 2 tag 4 dB higher, and lifts by it only with a known peak', () => {
        expect(chooseBalance({ typicalDb: -5, tag: { gainDb: -8 } })).toMatchObject({ gainDb: -4, effectiveGainDb: -4 });
        expect(chooseBalance({ typicalDb: -5, tag: { gainDb: -2 } }).effectiveGainDb).toBe(0);
        expect(chooseBalance({ typicalDb: -5, tag: { gainDb: -2, peak: dbfs(-10) } }).effectiveGainDb).toBeCloseTo(2, 8);
        expect(chooseBalance({ typicalDb: -5, tag: { gainDb: -2, peak: dbfs(-2) } }).effectiveGainDb).toBeCloseTo(0.5, 8);
    });

    it('guesses the median of the last twenty whole readings, never a lift', () => {
        expect(typicalGainDb([])).toBe(TYPICAL_FALLBACK_DB);
        expect(typicalGainDb([-6, -2, -4])).toBe(-4);
        expect(typicalGainDb([-6, -2, -4, -8])).toBe(-5);
        expect(typicalGainDb([2, 3, -1])).toBe(0);
        // Only the last twenty count.
        expect(typicalGainDb([...Array(5).fill(-20), ...Array(20).fill(-3)])).toBe(-3);
    });
});

describe('volume balance moves', () => {
    const move = (playSec: number, nextDb: number, extra: { moved?: boolean; blendAudible?: boolean } = {}) => planBalanceMove({
        playSec, nextDb, currentDb: -5, moved: extra.moved ?? false, blendAudible: extra.blendAudible ?? false,
    });

    it('sets the level before the song sounds, eases early, and only cuts clearly later', () => {
        expect(move(0, -1, { moved: true, blendAudible: true })).toBe('set');
        expect(move(4, -1)).toEqual({ rampSec: 2 });
        expect(move(12, -1)).toBeNull();
        expect(move(12, -7)).toBeNull();
        expect(move(12, -8)).toEqual({ rampSec: 5 });
        expect(move(31, -12)).toBeNull();
        expect(move(4, -5.01)).toBeNull();
    });

    it('moves once per play and holds while a blend is heard', () => {
        expect(move(4, -1, { moved: true })).toBeNull();
        expect(move(4, -1, { blendAudible: true })).toBe('hold');
        expect(move(20, -9, { blendAudible: true })).toBe('hold');
        expect(move(20, -6, { blendAudible: true })).toBeNull();
    });
});

describe('shared BS.1770 gating', () => {
    it('averages audible blocks and leaves out silence and quiet passages', () => {
        const loud = 10 ** ((-20 - LUFS_OFFSET_DB) / 10);
        expect(gatedLoudness(Array(40).fill(loud))).toBeCloseTo(-20, 6);
        // Only the three blocks that straddle the change pull it under -20.
        expect(gatedLoudness([...Array(40).fill(loud), ...Array(40).fill(0)])).toBeCloseTo(-20, 0);
        expect(gatedLoudness([...Array(40).fill(loud), ...Array(40).fill(loud / 1000)])).toBeCloseTo(-20, 0);
        expect(gatedLoudness([...Array(40).fill(loud), ...Array(40).fill(loud / 4)])).toBeCloseTo(-22, 0);
        expect(gatedLoudness(Array(40).fill(0))).toBe(SILENCE_DB);
    });
});

describe('whole plays', () => {
    const play = (fromSec: number, toSec: number, extra: Partial<MeteredPlay> = {}): MeteredPlay => ({
        loudness: -12, peak: 0.9, heardSec: toSec - fromSec, fromSec, toSec, broken: null, ...extra,
    });

    it('takes a play from the start to near the end as whole', () => {
        expect(whyNotWholePlay(play(0, 200), { duration: 200 })).toBeNull();
        // A blend stops the song a little before its media runs out.
        expect(whyNotWholePlay(play(0, 198.5), { duration: 200 })).toBeNull();
        expect(whyNotWholePlay(play(0, 197), { duration: 200 })).toBe('stopped at 197.0s');
    });

    it('lets a blend enter past the leading silence and up to a bar on (F5)', () => {
        expect(whyNotWholePlay(play(4.9, 199), { duration: 200, leadInSec: 3 })).toBeNull();
        expect(whyNotWholePlay(play(5.5, 199), { duration: 200, leadInSec: 3 })).toBe('started at 5.5s');
        expect(whyNotWholePlay(play(1.8, 199), { duration: 200 })).toBeNull();
        expect(whyNotWholePlay(play(2.5, 199), { duration: 200, leadInSec: null })).toBe('started at 2.5s');
    });

    it('reads media time, not wall time, so a play that stalled is still whole (F4)', () => {
        expect(whyNotWholePlay(play(0, 200, { heardSec: 200 }), { duration: 200 })).toBeNull();
    });

    it('refuses a seek, missed audio, a clip, an unknown length and silence', () => {
        expect(whyNotWholePlay(play(0, 200, { broken: 'seek' }), { duration: 200 })).toBe('seek');
        expect(whyNotWholePlay(play(0, 200, { broken: 'gap' }), { duration: 200 })).toBe('gap');
        expect(whyNotWholePlay(play(0, 30), { duration: 30, clip: 'a 30s preview' })).toBe('not the whole song (a 30s preview)');
        expect(whyNotWholePlay(play(0, 200), { duration: Number.NaN })).toBe('length unknown');
        expect(whyNotWholePlay(play(0, 200, { loudness: SILENCE_DB }), { duration: 200 })).toBe('silence');
    });
});
