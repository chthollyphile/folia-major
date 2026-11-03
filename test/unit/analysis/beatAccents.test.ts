import { describe, expect, it } from 'vitest';
import {
    BEAT_ACCENTS_VERSION,
    computeBeatAccents,
    isBeatAccents,
    PERCUSSIVE_GATE,
    resolveBarPercussiveShares,
    formatBeatMeter,
    readBeatMeter,
    resolvePulseBeats,
    resolveUnsureBeats,
    restoreDrivenBeats,
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

    it('reads a loud full section as stronger than a sparse quiet intro of bigger transients', () => {
        // 玛丽亚: hits out of silence first, then smaller hits on a loud, dense mix.
        const intro = beatsEvery(0.5, 16, 1);
        const full = beatsEvery(0.5, 16, 10);
        const mel = makeMel(20, intro.map(t => ({ t, range: 'low' as const, amount: 2 })));
        for (let frame = Math.round(9.5 * BEAT_THIS_FPS); frame < mel.frames; frame += 1) {
            for (let band = 0; band < MEL_BANDS; band += 1) mel.data[frame * MEL_BANDS + band] += 3;
        }
        full.forEach((t) => {
            const start = Math.round(t * BEAT_THIS_FPS);
            for (let frame = start; frame < start + 3; frame += 1) {
                for (let band = 0; band < MEL_BANDS; band += 1) if (inRange(band, 'low')) mel.data[frame * MEL_BANDS + band] += 1;
            }
        });
        const accents = computeBeatAccents(mel, [...intro, ...full]);
        const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
        expect(mean(accents.impact.slice(16))).toBeGreaterThan(mean(accents.impact.slice(0, 16)));
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
    const valid = { v: BEAT_ACCENTS_VERSION, impact: [0.5], low: [0.2], mid: [0.3], high: [0.5], rhythmic: [1], pulse: [1], trackScale: 0.8 };
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

describe('compound time', () => {
    // Twelve bars of six eighth notes (小半, 麦恩莉 as Beat This! counts them), with a pickup beat.
    const eighths = beatsEvery(0.4, 73, 0);
    const downbeats = eighths.filter((_, index) => index > 0 && (index - 1) % 6 === 0);
    /** The rise of each beat by its position in the bar; the pickup beat is position -1. */
    const risesOf = (byPosition: number[]) => eighths.map((_, index) => (index === 0 ? 0.5 : byPosition[(index - 1) % 6]));

    it('keeps the head of every three in 6/8, where position 4 stands out', () => {
        const pulse = resolvePulseBeats(risesOf([1.35, 0.3, 0.32, 0.93, 0.36, 0.75]), eighths, downbeats);
        // The pickup beat counts back from the first downbeat: one before it, not a group head.
        expect(pulse[0]).toBe(0);
        expect(pulse.slice(1, 13)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
        // The last bar runs to the end of the track and is thinned like the rest.
        expect(pulse.slice(67)).toEqual([1, 0, 0, 1, 0, 0]);
        expect(resolvePulseBeats(risesOf([1.53, 0.35, 0.39, 1.11, 0.88, 0.85]), eighths, downbeats).filter(Boolean)).toHaveLength(24);
    });

    it('thins a bar the model miscounted, from its own downbeat', () => {
        // The downbeat of the third bar put one beat late: a bar of 7, then one of 5.
        const shifted = downbeats.map((t, bar) => (bar === 2 ? eighths[14] : t));
        const pulse = resolvePulseBeats(risesOf([1.35, 0.3, 0.32, 0.93, 0.36, 0.75]), eighths, shifted);
        // The bar's last head sits one eighth before the late downbeat: too close, the downbeat wins.
        expect(pulse.slice(7, 14)).toEqual([1, 0, 0, 1, 0, 0, 0]);
        // The bar of five: its second head two eighths before the next downbeat, which wins again.
        expect(pulse.slice(14, 19)).toEqual([1, 0, 0, 0, 0]);
        expect(pulse.slice(19, 25)).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('keeps every beat of a six-beat bar without that accent', () => {
        expect(resolvePulseBeats(risesOf([1.3, 0.4, 0.8, 0.85, 0.4, 0.8]), eighths, downbeats).every(Boolean)).toBe(true);
        // No downbeats: no bars to read a meter off.
        expect(resolvePulseBeats(risesOf([1.35, 0.3, 0.32, 0.93, 0.36, 0.75]), eighths, []).every(Boolean)).toBe(true);
    });

    it('reads into one log line', () => {
        const rises = risesOf([1.35, 0.3, 0.32, 0.93, 0.36, 0.75]);
        const meter = readBeatMeter(rises, eighths, downbeats);
        expect(meter).toMatchObject({ bpm: 150, barLengths: [[6, 11]], usual: 6, group: 3 });
        expect(formatBeatMeter(meter, resolvePulseBeats(rises, eighths, downbeats)))
            .toBe('bpm 150 | bars 6x11 | usual 6 rise by position 1.35 0.30 0.32 0.93 0.36 0.75 | logit by position - | 1 in 3 (24/73)');
        expect(formatBeatMeter(readBeatMeter([], [], []), [])).toBe('bpm 0 | bars - | usual 0 rise by position - | logit by position - | every beat (0/0)');
    });

    it('takes the model\'s confidence too, when it has it', () => {
        const rises = risesOf([1.35, 0.3, 0.32, 0.93, 0.36, 0.75]);
        // 小半's logits by position: the heads stand ~2 above their neighbours.
        const sure = eighths.map((_, index) => (index === 0 ? 6 : [8.9, 5.2, 5.9, 7.8, 5.6, 6.0][(index - 1) % 6]));
        expect(readBeatMeter(rises, eighths, downbeats, sure)).toMatchObject({ group: 3, confidenceByPosition: [8.9, 5.2, 5.9, 7.8, 5.6, 6.0] });
        // A model as sure of every beat: the rise alone does not thin it.
        const flat = eighths.map(() => 7);
        expect(resolvePulseBeats(rises, eighths, downbeats, flat).every(Boolean)).toBe(true);
    });

    it('is carried in the accents', () => {
        const hits = eighths.map((t, index) => ({ t, range: 'low' as const, amount: index > 0 && (index - 1) % 3 === 0 ? 3 : 0.5 }));
        const accents = computeBeatAccents(makeMel(30, hits), eighths, downbeats);
        expect(accents.pulse.slice(1, 7)).toEqual([1, 0, 0, 1, 0, 0]);
        expect(isBeatAccents(accents, eighths.length)).toBe(true);
    });
});

describe('double time', () => {
    // 走马 as small0 counts it: 143 BPM, bars of four, a felt beat on every other one.
    const beats = beatsEvery(0.42, 64, 0);
    const downbeats = beats.filter((_, index) => index % 4 === 0);
    const rises = beats.map((_, index) => [0.91, 0.3, 0.63, 0.33][index % 4]);
    const logits = beats.map((_, index) => [8.6, 5.5, 7.4, 5.2][index % 4]);

    it('keeps every other beat when the third stands out in rise and logit', () => {
        const meter = readBeatMeter(rises, beats, downbeats, logits);
        expect(meter).toMatchObject({ bpm: 143, usual: 4, group: 2 });
        expect(resolvePulseBeats(rises, beats, downbeats, logits).slice(0, 8)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    });

    it('leaves 4/4 counted right alone', () => {
        // 裏表ラバーズ: the third beat no louder than the others, logits within 0.5.
        const right = beats.map((_, index) => [0.63, 0.65, 0.32, 0.82][index % 4]);
        const sure = beats.map((_, index) => [9.2, 7.2, 7.7, 7.2][index % 4]);
        expect(resolvePulseBeats(right, beats, downbeats, sure).every(Boolean)).toBe(true);
        // Loud on 1 and 3 but the model as sure of 2 and 4 (パラジクロロベンゼン's logits).
        expect(resolvePulseBeats(rises, beats, downbeats, beats.map((_, index) => [9.4, 7.8, 8.3, 8.1][index % 4])).every(Boolean)).toBe(true);
    });

    it('halves an evenly strummed song on the logits', () => {
        // 理想三旬: counted at 100 BPM, every eighth rising alike, the model surer of 1 and 3.
        const strummed = beatsEvery(0.6, 64, 0);
        const bars = strummed.filter((_, index) => index % 4 === 0);
        const even = strummed.map((_, index) => [1.13, 0.77, 0.78, 0.77][index % 4]);
        const sure = strummed.map((_, index) => [8.8, 6.5, 7.6, 6.5][index % 4]);
        expect(readBeatMeter(even, strummed, bars, sure)).toMatchObject({ bpm: 100, group: 2 });
        // Without the logits the rise alone is not clear enough.
        expect(resolvePulseBeats(even, strummed, bars).every(Boolean)).toBe(true);
    });

    it('halves a song whose off-beats rise more, on the logits alone', () => {
        // 夢灯籠 with the band in: hi-hats and snare on the eighths, the model surer of 1 and 3.
        const offLoud = beats.map((_, index) => [1.06, 0.93, 0.83, 0.94][index % 4]);
        const sure = beats.map((_, index) => [7.6, 4.8, 6.5, 5.5][index % 4]);
        expect(readBeatMeter(offLoud, beats, downbeats, sure)).toMatchObject({ group: 2 });
        // Without the logits the rise alone keeps every beat.
        expect(resolvePulseBeats(offLoud, beats, downbeats).every(Boolean)).toBe(true);
    });

    it('needs a tempo that still has a beat when halved', () => {
        const slow = beatsEvery(0.7, 64, 0);
        expect(resolvePulseBeats(rises, slow, slow.filter((_, index) => index % 4 === 0), logits).every(Boolean)).toBe(true);
    });
});

describe('waltz and slips', () => {
    // 雪绒花 as small0 counts it: 107 BPM, three a bar, the downbeat standing out.
    const beats = beatsEvery(0.56, 48, 0);
    const bars = beats.filter((_, index) => index % 3 === 0);
    const rises = beats.map((_, index) => [1.29, 0.38, 0.52][index % 3]);
    const logits = beats.map((_, index) => [6.6, 5.5, 5.8][index % 3]);

    it('feels a waltz a bar at a time when its downbeat stands out', () => {
        expect(readBeatMeter(rises, beats, bars, logits)).toMatchObject({ usual: 3, group: 3 });
        expect(resolvePulseBeats(rises, beats, bars, logits).slice(0, 6)).toEqual([1, 0, 0, 1, 0, 0]);
        // The model as sure of every beat: all three kept.
        expect(resolvePulseBeats(rises, beats, bars, beats.map(() => 6)).every(Boolean)).toBe(true);
    });

    it('drops the beats of a stretch counted a level finer', () => {
        // 4/4 at 0.5 s, with two bars in the middle counted in eighths.
        const steady = beatsEvery(0.5, 40, 0);
        const slipped = [...steady.slice(0, 16), ...beatsEvery(0.25, 16, 8), ...steady.slice(24)];
        const downbeats = slipped.filter(time => Math.abs(time / 2 - Math.round(time / 2)) < 1e-9);
        const flat = slipped.map(() => 1);
        const pulse = resolvePulseBeats(flat, slipped, downbeats);
        expect(slipped.filter((_, index) => pulse[index])).toEqual(steady);
    });
});

describe('unsure stretches', () => {
    // 夢灯籠: an intro the model is unsure of (logit ~3), then the band (~7 to 9).
    const pulse = Array.from({ length: 80 }, () => 1);
    const confidence = pulse.map((_, index) => (index < 30 ? 3 : 7 + (index % 3)));

    it('silences a long stretch of beats the model is unsure of', () => {
        const unsure = resolveUnsureBeats(confidence, pulse);
        expect(unsure.slice(0, 26).every(Boolean)).toBe(true);
        expect(unsure.slice(34).some(Boolean)).toBe(false);
    });

    it('leaves a short dip, and anything without the logits', () => {
        const dip = confidence.map((value, index) => (index >= 50 && index < 53 ? 2 : index < 30 ? 8 : value));
        expect(resolveUnsureBeats(dip, pulse).some(Boolean)).toBe(false);
        expect(resolveUnsureBeats(null, pulse).some(Boolean)).toBe(false);
    });

    it('reads the felt beats only, so faint off-beats do not count', () => {
        // Counted at twice the tempo: the off-beats faint, the felt beats sure.
        const halved = pulse.map((_, index) => (index % 2 ? 0 : 1));
        const offFaint = pulse.map((_, index) => (index % 2 ? 2 : 8));
        expect(resolveUnsureBeats(offFaint, halved).some(Boolean)).toBe(false);
    });

    it('is carried in the accents\' rhythm gate', () => {
        const beats = beatsEvery(0.5, 80, 0);
        const accents = computeBeatAccents(makeMel(41, []), beats, [], null, { confidence });
        expect(accents.rhythmic.slice(0, 26).every(value => value === 0)).toBe(true);
        expect(accents.rhythmic.slice(34).every(value => value === 1)).toBe(true);
    });
});

describe('drum-driven stretches', () => {
    // 夢灯籠 halved: a verse with the off-beats faint, then a chorus with them nearly as sure.
    const halved = () => Array.from({ length: 80 }, (_, index) => (index % 2 ? 0 : 1));
    const confidence = Array.from({ length: 80 }, (_, index) => (index % 2 ? (index < 40 ? 4 : 6) : 7.5));

    it('puts the off-beats back where the drums drive them', () => {
        const pulse = halved();
        expect(restoreDrivenBeats(pulse, 2, confidence, 0.36)).toBeGreaterThan(0);
        expect(pulse.slice(0, 20).filter(Boolean)).toHaveLength(10);
        // Up to the last felt beat: a beat after it has no group to be put back in.
        expect(pulse.slice(60, 79).every(Boolean)).toBe(true);
    });

    it('leaves a track without drums, one not halved, or a silent stretch', () => {
        const strummed = halved();
        expect(restoreDrivenBeats(strummed, 2, confidence, 0.23)).toBe(0);
        expect(strummed).toEqual(halved());
        expect(restoreDrivenBeats(halved(), 3, confidence, 0.36)).toBe(0);
        expect(restoreDrivenBeats(halved(), 2, null, 0.36)).toBe(0);
        // An intro left silent as unsure is neither read nor put back.
        const intro = halved();
        const sureOfAll = intro.map(() => 7);
        restoreDrivenBeats(intro, 2, sureOfAll, 0.36, intro.map((_, index) => (index < 40 ? 1 : 0)));
        expect(intro.slice(0, 38).filter(Boolean)).toHaveLength(19);
        expect(intro.slice(42, 79).every(Boolean)).toBe(true);
    });
});
