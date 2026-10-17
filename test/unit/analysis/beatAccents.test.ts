import { describe, expect, it } from 'vitest';
import {
    BEAT_ACCENTS_VERSION,
    computeBeatAccents,
    isBeatAccents,
    PERCUSSIVE_GATE,
    resolveBarPercussiveShares,
    resolveRhythmicBeats,
    resolveTrackScale,
    TRACK_SCALE_MIN,
} from '@/services/analysis/beatAccents';
import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz } from '@/services/analysis/beatThis';

// test/unit/analysis/beatAccents.test.ts
// Each beat's impact and tone, and the track's dynamics scale, measured on a synthetic spectrogram
// where the hits are known.

const CENTRES = melBandCentresHz();
type Range = 'low' | 'mid' | 'high';
const inRange = (band: number, range: Range) => {
    const hz = CENTRES[band];
    return range === 'low' ? hz < 150 : range === 'mid' ? hz >= 150 && hz < 2000 : hz >= 2000;
};

/** A flat spectrogram of `seconds`, with `hits` raising the given bands by `amount` for three frames. */
const makeMel = (seconds: number, hits: { t: number; range: Range; amount: number }[]) => {
    const frames = Math.round(seconds * BEAT_THIS_FPS);
    const data = new Float32Array(frames * MEL_BANDS).fill(1);
    hits.forEach(({ t, range, amount }) => {
        const start = Math.round(t * BEAT_THIS_FPS);
        for (let frame = start; frame < Math.min(frames, start + 3); frame += 1) {
            for (let band = 0; band < MEL_BANDS; band += 1) {
                if (inRange(band, range)) data[frame * MEL_BANDS + band] += amount;
            }
        }
    });
    return { data, frames };
};

const beatsEvery = (period: number, count: number, from = 1) => Array.from({ length: count }, (_, index) => from + index * period);

describe('computeBeatAccents', () => {
    it('tells strong beats from weak ones, normalised over the track', () => {
        const beats = beatsEvery(0.5, 16);
        const mel = makeMel(10, beats.map((t, index) => ({ t, range: 'low' as const, amount: index % 2 ? 0.5 : 3 })));
        const accents = computeBeatAccents(mel, beats);
        expect(accents.v).toBe(BEAT_ACCENTS_VERSION);
        expect(accents.impact).toHaveLength(16);
        expect(accents.impact[0]).toBe(1);
        expect(accents.impact[1]).toBe(0);
        expect(isBeatAccents(accents, 16)).toBe(true);
    });

    it('measures which band carries the hit', () => {
        const beats = beatsEvery(0.5, 16);
        const mel = makeMel(10, beats.map((t, index) => ({ t, range: index % 2 ? 'high' as const : 'low' as const, amount: 2 })));
        const accents = computeBeatAccents(mel, beats);
        expect(accents.low[0]).toBeGreaterThan(0.95);
        expect(accents.high[1]).toBeGreaterThan(0.95);
        accents.low.forEach((low, index) => {
            expect(low + accents.mid[index] + accents.high[index]).toBeCloseTo(1, 2);
        });
    });

    it('gives a track whose beats rise clearly the full scale, and one whose barely rise less', () => {
        const beats = beatsEvery(0.5, 16);
        const punchy = computeBeatAccents(makeMel(10, beats.map(t => ({ t, range: 'low' as const, amount: 3 }))), beats);
        expect(punchy.trackScale).toBe(1);
        const soft = computeBeatAccents(makeMel(10, beats.map(t => ({ t, range: 'low' as const, amount: 0.05 }))), beats);
        expect(soft.trackScale).toBe(TRACK_SCALE_MIN);
    });

    it('treats every beat as a full one when there are too few, or all alike', () => {
        const few = beatsEvery(0.5, 4);
        const accents = computeBeatAccents(makeMel(4, few.map(t => ({ t, range: 'low' as const, amount: 1 }))), few);
        expect(accents.impact).toEqual([1, 1, 1, 1]);
        expect(accents.trackScale).toBe(1);
        const none = computeBeatAccents(makeMel(4, []), []);
        expect(none.impact).toEqual([]);
    });

    it('reads beats at the very ends of the spectrogram', () => {
        const beats = [0, ...beatsEvery(0.5, 8, 0.5), 4.98];
        const accents = computeBeatAccents(makeMel(5, beats.map(t => ({ t, range: 'mid' as const, amount: 1 }))), beats);
        expect(accents.impact.every(Number.isFinite)).toBe(true);
    });
});

describe('resolveTrackScale', () => {
    it('maps the median beat rise onto 0.45..1', () => {
        expect(resolveTrackScale(0)).toBe(TRACK_SCALE_MIN);
        expect(resolveTrackScale(0.05)).toBe(TRACK_SCALE_MIN);
        expect(resolveTrackScale(0.5)).toBe(1);
        const between = resolveTrackScale(0.2);
        expect(between).toBeGreaterThan(TRACK_SCALE_MIN);
        expect(between).toBeLessThan(1);
    });
});

describe('isBeatAccents', () => {
    const valid = { v: BEAT_ACCENTS_VERSION, impact: [0.5], low: [0.2], mid: [0.3], high: [0.5], rhythmic: [1], trackScale: 0.8 };
    it('rejects another version, length or range', () => {
        expect(isBeatAccents(valid, 1)).toBe(true);
        expect(isBeatAccents(valid, 2)).toBe(false);
        expect(isBeatAccents({ ...valid, v: BEAT_ACCENTS_VERSION + 1 }, 1)).toBe(false);
        expect(isBeatAccents({ ...valid, impact: [1.5] }, 1)).toBe(false);
        expect(isBeatAccents({ ...valid, trackScale: 0.1 }, 1)).toBe(false);
        // A list from before the gate (version 1) has no `rhythmic` and is measured again.
        const { rhythmic: _rhythmic, ...withoutGate } = valid;
        expect(isBeatAccents(withoutGate, 1)).toBe(false);
        expect(isBeatAccents(null, 1)).toBe(false);
    });
});

/** Per-frame energy (50 fps) where each second has the given percussive share. */
const energyOf = (sharesPerSecond: number[]) => {
    const frames = sharesPerSecond.length * BEAT_THIS_FPS;
    const percussive = new Float32Array(frames);
    const total = new Float32Array(frames).fill(1);
    sharesPerSecond.forEach((share, second) => percussive.fill(share, second * BEAT_THIS_FPS, (second + 1) * BEAT_THIS_FPS));
    return { percussive, total };
};

describe('rhythm gate', () => {
    // 4 beats a second, a bar a second: 12 bars, the first two sustained sound only.
    const beats = beatsEvery(0.25, 48, 0);
    const downbeats = beats.filter((_, index) => index % 4 === 0);
    const shares = [0.03, 0.1, 0.3, 0.32, 0.28, 0.3, 0.31, 0.2, 0.3, 0.29, 0.33, 0.3];

    it('measures each bar\'s percussive share', () => {
        const bars = resolveBarPercussiveShares(energyOf(shares), beats, downbeats);
        expect(bars.starts).toEqual(downbeats.map((_, bar) => bar * 4));
        bars.shares.forEach((share, bar) => expect(share).toBeCloseTo(shares[bar]));
    });

    it('turns off the beats of bars well under the track\'s usual share, and only those', () => {
        const rhythmic = resolveRhythmicBeats(energyOf(shares), beats, downbeats);
        expect(rhythmic.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        // 0.2 of a 0.3 median is above PERCUSSIVE_GATE: a sparse bar stays on.
        expect(0.2 / 0.3).toBeGreaterThan(PERCUSSIVE_GATE);
        expect(rhythmic.slice(8).every(value => value === 1)).toBe(true);
    });

    it('falls back to bars of four beats without downbeats, and keeps everything without energy', () => {
        expect(resolveRhythmicBeats(energyOf(shares), beats, []).slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(resolveRhythmicBeats(null, beats, downbeats).every(value => value === 1)).toBe(true);
        expect(resolveRhythmicBeats(energyOf([0.01, 0.3]), beats.slice(0, 8), downbeats.slice(0, 2))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('is carried in the accents', () => {
        const mel = makeMel(12, beats.map(t => ({ t, range: 'low' as const, amount: 1 })));
        expect(computeBeatAccents(mel, beats, downbeats, energyOf(shares)).rhythmic.slice(0, 9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
        expect(computeBeatAccents(mel, beats, downbeats).rhythmic.every(value => value === 1)).toBe(true);
    });
});
