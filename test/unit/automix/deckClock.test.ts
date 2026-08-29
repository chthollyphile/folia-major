import { describe, expect, it } from 'vitest';
import { createDeckClock, fitClock } from '@/services/automix/deckClock';

// test/unit/automix/deckClock.test.ts
// The sensor the whole alignment problem turned out to need. Everything here is about one claim:
// a line fitted through a staircase recovers the phase far below the step size.

/** What a media element reports: the true position, quantised to its update quantum. */
const staircase = (
    count: number,
    { start = 0, rate = 1, step = 0.02, interval = 0.025 } = {},
) => Array.from({ length: count }, (_, index) => {
    const context = index * interval;
    const truth = start + rate * context;
    return { media: Math.floor(truth / step) * step, context };
});

describe('fitClock', () => {
    it('recovers a position far more precisely than the readings themselves', () => {
        // This is the entire argument for the module. Each reading is up to 20ms stale and the
        // staleness is a sawtooth; the line through sixty of them turns that sawtooth into a
        // CONSTANT offset of about half a quantum, and a constant offset is exactly what a
        // comparison between two decks - measured the same way - is immune to.
        const samples = staircase(60, { start: 100.317, rate: 1 });
        const fit = fitClock(samples)!;

        const errors = samples.map(sample =>
            fit.offset + fit.rate * sample.context - (100.317 + sample.context));
        const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
        // Within half a quantum of the truth, and within a millisecond of ITSELF everywhere.
        expect(Math.abs(mean)).toBeLessThan(0.02);
        for (const error of errors) expect(error - mean).toBeCloseTo(0, 3);
        expect(fit.rate).toBeCloseTo(1, 3);
    });

    it('measures a rate rather than assuming one', () => {
        // A deck bent onto another tempo is not running at 1, and everything scheduled against it
        // has to know that from the audio rather than from what it was asked for.
        expect(fitClock(staircase(60, { rate: 1.12 }))!.rate).toBeCloseTo(1.12, 2);
    });

    it('has no answer from too few readings, or from readings at one instant', () => {
        expect(fitClock(staircase(3))).toBeNull();
        expect(fitClock([
            { media: 1, context: 5 }, { media: 1, context: 5 },
            { media: 1, context: 5 }, { media: 1, context: 5 },
        ])).toBeNull();
    });
});

describe('createDeckClock', () => {
    const feed = (clock: ReturnType<typeof createDeckClock>, samples: { media: number; context: number }[]) => {
        for (const sample of samples) clock.sample(sample.media, sample.context);
    };

    it('says where a deck will be, and when it will reach somewhere', () => {
        const clock = createDeckClock();
        feed(clock, staircase(60, { start: 90 }));

        const last = 59 * 0.025;
        expect(clock.positionAt(last)!).toBeCloseTo(90 + last, 1);
        // The useful direction: not "where is it" but "when does it get to the bar line".
        expect(clock.reaches(92, last)!).toBeCloseTo(2, 1);
    });

    it('refuses to answer backwards', () => {
        const clock = createDeckClock();
        feed(clock, staircase(60, { start: 90 }));
        expect(clock.reaches(80, 59 * 0.025)).toBeNull();
    });

    it('throws the window away rather than fitting across a seek', () => {
        // A seek does not bend the line, it replaces it, and a fit spanning both describes neither.
        const clock = createDeckClock();
        feed(clock, staircase(40, { start: 90 }));
        feed(clock, staircase(40, { start: 12 }).map(sample => ({
            ...sample,
            context: sample.context + 1,
        })));

        expect(clock.positionAt(1 + 39 * 0.025)!).toBeCloseTo(12 + 39 * 0.025, 1);
    });

    it('has nothing to say about a stopped deck', () => {
        // A flat line through a stopped clock is a rate of zero, and a rate of zero would be
        // believed by everything downstream.
        const clock = createDeckClock();
        for (let index = 0; index < 60; index += 1) clock.sample(42, index * 0.025);
        expect(clock.positionAt(1)).toBeNull();
        expect(clock.rate()).toBeNull();
    });

    it('forgets everything when a deck starts a different track', () => {
        const clock = createDeckClock();
        feed(clock, staircase(60, { start: 90 }));
        clock.reset();
        expect(clock.positionAt(1)).toBeNull();
    });

    it('ignores readings that are not numbers', () => {
        const clock = createDeckClock();
        clock.sample(NaN, 0);
        clock.sample(1, Infinity);
        expect(clock.fit()).toBeNull();
    });
});
