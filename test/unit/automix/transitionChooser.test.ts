import { describe, expect, it } from 'vitest';
import {
    BEAT_CUT_SEC,
    chooseTransitionStyle,
    keyRelation,
    shapeBlend,
} from '@/services/automix/transitionChooser';
import type { TrackProfile } from '@/services/automix/trackProfile';
import { makeProfile as profile } from './trackProfileFixture';

// test/unit/automix/transitionChooser.test.ts

const inKey = (key: number, major: boolean) => profile({ key, major, keyConfidence: 0.8 });

describe('keyRelation', () => {
    it('reads the circle of fifths and the relative minor as compatible', () => {
        expect(keyRelation(inKey(0, true), inKey(0, true))).toBe('compatible');   // C  -> C
        expect(keyRelation(inKey(0, true), inKey(7, true))).toBe('compatible');   // C  -> G
        expect(keyRelation(inKey(0, true), inKey(5, true))).toBe('compatible');   // C  -> F
        expect(keyRelation(inKey(0, true), inKey(9, false))).toBe('compatible');  // C  -> Am
        expect(keyRelation(inKey(9, false), inKey(0, true))).toBe('compatible');  // Am -> C
    });

    it('calls a semitone and a tritone a clash', () => {
        expect(keyRelation(inKey(0, true), inKey(1, true))).toBe('clashing');
        expect(keyRelation(inKey(0, true), inKey(11, true))).toBe('clashing');
        expect(keyRelation(inKey(0, true), inKey(6, true))).toBe('clashing');
    });

    it('leaves everything else alone rather than inventing a grade for it', () => {
        expect(keyRelation(inKey(0, true), inKey(4, true))).toBe('neutral');
    });

    it('knows the two relations that are neither the same seven notes nor a clash', () => {
        // Two steps round the circle of fifths - one accidental apart - and the parallel major and
        // minor, which share a tonic. Both are on every DJ's wheel and neither is a full match.
        expect(keyRelation(inKey(0, true), inKey(2, true))).toBe('adjacent');
        expect(keyRelation(inKey(0, true), inKey(10, true))).toBe('adjacent');
        expect(keyRelation(inKey(0, true), inKey(0, false))).toBe('adjacent');
    });

    it('asks about the two ends of the tracks, not their averages', () => {
        // A song that modulates has more than one key, and a transition only ever touches twenty
        // seconds of it. The whole-track figure is the fallback for an end too percussive to read.
        const modulating = profile({
            key: 0, major: true, keyConfidence: 0.9,
            outroKey: { key: 6, major: true, confidence: 0.9 },
        });
        expect(keyRelation(modulating, inKey(0, true))).toBe('clashing');
        expect(keyRelation(inKey(0, true), modulating)).toBe('compatible');
    });

    it('treats a low-confidence estimate as no answer', () => {
        // Key detection on a full mix is right about three times in four. Acting on the quarter
        // where it is wrong would shorten blends that had nothing wrong with them.
        expect(keyRelation(inKey(0, true), profile({ key: 6, keyConfidence: 0.05 }))).toBe('unknown');
        expect(keyRelation(inKey(0, true), null)).toBe('unknown');
    });
});

describe('chooseTransitionStyle', () => {
    it('still blends two tracks a record joins together itself', () => {
        // Consecutive tracks off a run-together album used to get a splice too short to hear, on
        // the grounds that the record already joins them. True about the record - but on a
        // continuous album it took two thirds of the song changes, so switching blending on
        // produced no audible blending. Every style left is one the listener can hear.
        const choice = chooseTransitionStyle({
            from: profile({ endsHot: true }),
            to: profile({ startsHot: true, bpm: 120 }),
        });
        expect(choice.style).toBe('bassSwap');
    });

    it('cuts into a hot start only when there is a beat of silence to place the cut in', () => {
        // 120 BPM = half a second a beat, and the wait can only be paid for out of the incoming
        // track's own leading silence.
        const choice = chooseTransitionStyle({
            from: profile({ bpm: 120 }),
            to: profile({ startsHot: true, leadIn: 0.8 }),
        });
        expect(choice.style).toBe('beatCut');
    });

    it('shortens the overlap instead of chopping when the cut cannot be placed', () => {
        // Every transition in a real playlist came out as a 40ms cut once, because a hot start was
        // taken as licence to cut whether or not the cut could land anywhere musical. An
        // unplaceable cut is not a transition - it is the feature appearing to be switched off.
        const choice = chooseTransitionStyle({
            from: profile({ bpm: 120 }),
            to: profile({ startsHot: true, leadIn: 0.07 }),
        });
        expect(choice.style).toBe('bassSwap');
        expect(choice.lengthScale).toBeLessThan(1);
        expect(choice.lengthScale).toBeGreaterThan(0);
    });

    it('swaps the low end under a track that fades itself out', () => {
        const choice = chooseTransitionStyle({
            from: profile({ outroSlope: -3 }),
            to: profile({ leadIn: 2 }),
        });
        expect(choice.style).toBe('bassSwap');
    });

    it('rides a decaying tail when the next track has an intro to come up through it', () => {
        const choice = chooseTransitionStyle({
            from: profile({ endsHot: false, outroSlope: -0.5 }),
            to: profile({ leadIn: 1.5 }),
        });
        expect(choice.style).toBe('tailRide');
        expect(choice.lengthScale).toBeGreaterThan(1);
    });

    it('falls back to a plain crossfade only when nothing was measured', () => {
        // This used to be every transition there was. It should now be the rarest one.
        expect(chooseTransitionStyle({ from: null, to: null }).style).toBe('plainBlend');
        expect(chooseTransitionStyle({ from: profile(), to: null }).style).toBe('bassSwap');
    });

    it('still cuts into a hot start when only the heads of both tracks were readable', () => {
        // Song caching off: all we could read is the front of each file. Both halves of the cut
        // rule are head-side, so this is the case that has to keep working.
        const head = (overrides: Partial<TrackProfile> = {}) =>
            profile({ partial: true, leadOut: null, endsHot: null, outroSlope: null, ...overrides });

        const choice = chooseTransitionStyle({
            from: head({ bpm: 128 }),
            to: head({ startsHot: true, leadIn: 1 }),
        });
        expect(choice.style).toBe('beatCut');
    });

    it('does not read an unknown tail as a known one', () => {
        // null means "not knowable without downloading the file". Treating it as false would pick
        // tailRide for tracks that end dead flat.
        const head = profile({ partial: true, leadOut: null, endsHot: null, outroSlope: null });

        expect(chooseTransitionStyle({ from: head, to: profile({ leadIn: 2, bpm: null }) }).style)
            .toBe('bassSwap');
    });

    it('shortens an overlap between clashing keys instead of trying to fix it', () => {
        const clash = chooseTransitionStyle({ from: inKey(0, true), to: inKey(6, true) });
        const fits = chooseTransitionStyle({ from: inKey(0, true), to: inKey(7, true) });
        expect(clash.lengthScale).toBeLessThan(fits.lengthScale);
    });

    it('never lets penalties multiply a blend out of existence', () => {
        // Every penalty at once: keys a tritone apart, tempos past what a fader can pull, and an
        // incoming track that opens at full level. Each says "shorter" and each is right; their
        // product said 0.12, which is not shorter but a hard cut nobody chose. The floor is one bar
        // out of a phrase - the shortest span that still reads as a join.
        const worst = chooseTransitionStyle({
            from: profile({ key: 0, major: true, keyConfidence: 0.8, bpm: 90, outroBpm: 90 }),
            to: profile({ key: 6, major: true, keyConfidence: 0.8, bpm: 120, startsHot: true, leadIn: 0.1 }),
        });
        expect(worst.relation).toBe('clashing');
        expect(worst.tempo.relation).toBe('far');
        expect(worst.lengthScale).toBeGreaterThanOrEqual(0.25);
    });
});

describe('shapeBlend', () => {
    const base = {
        room: 1.5,
        overlap: 4,
        crossover: 0.4,
        nextBeatIn: null,
        periodSec: null,
        incomingLeadIn: null,
    };

    it('cuts on the spot when there is no beat it can afford to wait for', () => {
        const shape = shapeBlend({
            ...base, style: 'beatCut', nextBeatIn: 0.3, periodSec: 0.5, incomingLeadIn: 0,
        });
        expect(shape.hold).toBe(0);
        expect(shape.overlap).toBe(BEAT_CUT_SEC);
        expect(shape.shapeBands).toBe(false);
    });

    it('takes the latest beat that fits inside the next track\'s own silence', () => {
        const shape = shapeBlend({
            ...base, style: 'beatCut', nextBeatIn: 0.2, periodSec: 0.5, incomingLeadIn: 1,
        });
        expect(shape.hold).toBeCloseTo(0.7, 6);
    });

    it('leaves an overlapping style alone, and only shapes bands where shaping makes sense', () => {
        expect(shapeBlend({ ...base, style: 'bassSwap' }))
            .toMatchObject({ hold: 0, overlap: 4, shapeBands: true, sweepOut: true });
        // A decaying tail is already leaving of its own accord; taking the top off it as well
        // removes the shimmer that is the entire reason to come up underneath one.
        expect(shapeBlend({ ...base, style: 'tailRide' }))
            .toMatchObject({ shapeBands: true, sweepOut: false });
        // The fallback stays what it always was: one gain curve for the whole spectrum.
        expect(shapeBlend({ ...base, style: 'plainBlend' }))
            .toMatchObject({ shapeBands: false, sweepOut: false });
    });
});
