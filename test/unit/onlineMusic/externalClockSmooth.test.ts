import { describe, expect, it } from 'vitest';
import { createExternalClock } from '../../../src/services/onlineMusic/externalClock';

// test/unit/onlineMusic/externalClockSmooth.test.ts
// What the shown position does over a long song that is followed at a fixed rate. Every answer of the
// player carries the age of the call and the jitter of the player's own clock, and some of them come
// back late. The bar and the lyrics are one continuous line through all of it: no frame goes back, no
// frame stands still, and the speed leaves the player's own by no more than a tenth either way.
//
// Measured over the run: the largest step between two frames, the longest stretch in which the
// position did not move, the fastest and slowest frame, and how far the line ends from the player.

const FRAME_MS = 16;
const ANSWER_EVERY_MS = 500;
const DURATION_SEC = 200;
const START_SEC = 30;
const RUN_MS = 60000;
/** How far an answer is off the spot the player truly stands on, in seconds. */
const JITTER_SEC = 0.15;
/** When, in ms, an answer takes LATE_MS to come back instead of landing at once. */
const LATE_AT_MS = [20000, 47000];
const LATE_MS = 1600;
/** The longest age a status read is compensated for, as the route compensates it. */
const MAX_AGE_SEC = 1;

/** A small generator with a seed: the same song on every run. */
const seededRandom = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};

/** Every answer of the player over the run: when it is asked, when it lands, and where it says. */
const answersOver = () => {
    const random = seededRandom(20261113);
    const playerAtSec = (nowMs: number) => START_SEC + nowMs / 1000;
    const answers: { atMs: number; positionSec: number }[] = [];
    for (let askedAtMs = ANSWER_EVERY_MS; askedAtMs <= RUN_MS; askedAtMs += ANSWER_EVERY_MS) {
        const lateMs = LATE_AT_MS.some(at => askedAtMs >= at && askedAtMs < at + LATE_MS) ? LATE_MS : 0;
        // The spot the answer names is the one the player stood on when it was asked, put forward by
        // the age the route compensates the call for, with the jitter of the player's own clock on it.
        const jitterSec = (random() * 2 - 1) * JITTER_SEC;
        answers.push({
            atMs: askedAtMs + lateMs,
            positionSec: playerAtSec(askedAtMs) + Math.min(lateMs / 1000, MAX_AGE_SEC) + jitterSec,
        });
    }
    return answers.sort((a, b) => a.atMs - b.atMs);
};

/** What one run of the song reads, one frame apart. */
const playThrough = (): number[] => {
    const clock = createExternalClock();
    clock.sync({ positionSec: START_SEC, paused: false, nowMs: 0, durationSec: DURATION_SEC });
    const answers = answersOver();
    const shown: number[] = [clock.read(0)];
    let next = 0;
    for (let nowMs = FRAME_MS; nowMs <= RUN_MS; nowMs += FRAME_MS) {
        while (next < answers.length && answers[next].atMs <= nowMs) {
            clock.sync({ positionSec: answers[next].positionSec, paused: false, nowMs, holdBackward: true });
            next += 1;
        }
        shown.push(clock.read(nowMs));
    }
    return shown;
};

/** The measurements the assertions are written on, said in one line so a run can be compared. */
const measure = (shown: number[]) => {
    let largestStepMs = 0;
    let smallestStepMs = Number.POSITIVE_INFINITY;
    let largestFallSec = 0;
    let stillMs = 0;
    let longestStillMs = 0;
    for (let index = 1; index < shown.length; index++) {
        const stepMs = (shown[index] - shown[index - 1]) * 1000;
        if (stepMs < 0) largestFallSec = Math.max(largestFallSec, -stepMs / 1000);
        if (stepMs <= 0) {
            stillMs += FRAME_MS;
            longestStillMs = Math.max(longestStillMs, stillMs);
        } else {
            stillMs = 0;
            largestStepMs = Math.max(largestStepMs, stepMs);
            smallestStepMs = Math.min(smallestStepMs, stepMs);
        }
    }
    return { largestStepMs, smallestStepMs, largestFallSec, longestStillMs };
};

describe('the shown position over a song that is followed at a fixed rate', () => {
    it('runs one continuous line through the jitter and the late answers', () => {
        const shown = playThrough();
        const { largestStepMs, smallestStepMs, largestFallSec, longestStillMs } = measure(shown);
        const endErrorSec = Math.abs(shown[shown.length - 1] - (START_SEC + RUN_MS / 1000));
        console.log('[smooth] largest step=' + largestStepMs.toFixed(2) + 'ms smallest=' + smallestStepMs.toFixed(2)
            + 'ms still=' + longestStillMs + 'ms fall=' + largestFallSec.toFixed(3) + ' end error=' + endErrorSec.toFixed(3) + 's');
        expect(largestFallSec, 'never goes back').toBe(0);
        expect(longestStillMs, 'never stands still').toBeLessThan(FRAME_MS);
        // A frame is never longer or shorter than the ease allows: no jump, no stall, no step.
        expect(smallestStepMs, 'the slowest frame').toBeGreaterThanOrEqual(FRAME_MS * 0.85);
        expect(largestStepMs, 'the fastest frame').toBeLessThanOrEqual(FRAME_MS * 1.15);
        expect(endErrorSec, 'on the player at the end').toBeLessThan(0.1);
    });

    it('puts the line where an answer says when the player is seconds away', () => {
        // A player that went on without the app is not a little ahead of the bar: easing a gap of
        // seconds out would take half a minute, so the line is put where the player says at once.
        const clock = createExternalClock();
        clock.sync({ positionSec: START_SEC, paused: false, nowMs: 0, durationSec: DURATION_SEC });
        expect(clock.read(1000)).toBeCloseTo(31, 5);
        clock.sync({ positionSec: 34, paused: false, nowMs: 1000, holdBackward: true });
        expect(clock.read(1016), 'aligned in one frame').toBeCloseTo(34.016, 2);
        expect(clock.read(2000), 'and running on from there').toBeCloseTo(35, 2);
    });

    it('stands on the line while an answer is seconds behind it', () => {
        // The same the other way is not a jitter either: an answer from seconds behind is the player
        // saying the song is somewhere else, and easing it out would take half a minute. The line
        // stands where it is until the player comes up to it, and it is never taken back over.
        const clock = createExternalClock();
        clock.sync({ positionSec: START_SEC, paused: false, nowMs: 0, durationSec: DURATION_SEC });
        expect(clock.read(4000), 'runs on at most the extrapolation it is given').toBeCloseTo(START_SEC + 3, 5);
        clock.sync({ positionSec: 31, paused: false, nowMs: 4000, holdBackward: true });
        expect(clock.read(4016), 'never taken back over').toBeCloseTo(START_SEC + 3, 1);
        // It goes on sounding rather than standing still on the spot it had reached, which is the line
        // the listener sees the words move along.
        expect(clock.read(4500), 'goes on at the song own speed').toBeGreaterThan(START_SEC + 3.2);
    });

    it('still stands where the player put it under a stopped song', () => {
        // A stop is written down as it comes: a stopped song shows where the player stands.
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0, durationSec: DURATION_SEC });
        expect(clock.read(900), 'sounding').toBeCloseTo(10.9, 5);
        // The player stops where it has got to, which is the spot the line had reached as well.
        clock.sync({ positionSec: 10.9, paused: true, nowMs: 900, holdBackward: true });
        expect(clock.read(2000), 'stopped').toBeCloseTo(10.9, 5);
        expect(clock.read(9000), 'and still stopped later').toBeCloseTo(10.9, 5);
        // Pressing play again goes on from that spot at once rather than waiting for an answer.
        clock.sync({ positionSec: 10.9, paused: false, nowMs: 14000, holdBackward: true });
        expect(clock.read(14100), 'sounding again').toBeCloseTo(11, 5);
    });

    it('goes on from the shown position the moment a stopped song starts again', () => {
        // The one the listener meets most: the song was stopped for a while, and pressing play used to
        // hold the line on the spot it was stopped on until an answer from the player arrived. The
        // line runs on from the first frame instead, and the answers that follow ease it onto the
        // player rather than stepping it there.
        const clock = createExternalClock();
        // The player stops two seconds in, on the spot the line has reached by then.
        const stopSec = START_SEC + 2;
        clock.sync({ positionSec: START_SEC, paused: false, nowMs: 0, durationSec: DURATION_SEC });
        clock.sync({ positionSec: stopSec, paused: true, nowMs: 2000, holdBackward: true });
        expect(clock.read(3000), 'stopped, so it stands').toBeCloseTo(stopSec, 3);
        // Five seconds later the listener presses play: the player sounds the song on from the spot it
        // was stopped on, and the answer that says so is a few hundred ms late.
        const resumedAtMs = 8000;
        const playerAtSec = (nowMs: number) => stopSec + Math.max(0, nowMs - resumedAtMs) / 1000;
        // The answers are the shape the user reported: each one names the spot the player stood on when
        // it was asked, and comes back a good fraction of a second later, so the line is ahead of what
        // it says by the age of the call.
        const delaysMs = [100, 300, 600];
        const answers: { atMs: number; positionSec: number }[] = [];
        for (let askedAtMs = resumedAtMs + ANSWER_EVERY_MS, index = 0; askedAtMs <= resumedAtMs + 12000; askedAtMs += ANSWER_EVERY_MS) {
            const delayMs = delaysMs[index % delaysMs.length];
            answers.push({ atMs: askedAtMs + delayMs, positionSec: playerAtSec(askedAtMs) });
            index += 1;
        }
        const shown: number[] = [];
        clock.sync({ positionSec: playerAtSec(resumedAtMs), paused: false, nowMs: resumedAtMs, holdBackward: true });
        let next = 0;
        for (let nowMs = resumedAtMs + FRAME_MS; nowMs <= resumedAtMs + 12000; nowMs += FRAME_MS) {
            while (next < answers.length && answers[next].atMs <= nowMs) {
                clock.sync({ positionSec: answers[next].positionSec, paused: false, nowMs, holdBackward: true });
                next += 1;
            }
            shown.push(clock.read(nowMs));
        }
        const step = measure(shown);
        console.log('[resume] largest step=' + step.largestStepMs.toFixed(2) + 'ms still=' + step.longestStillMs
            + 'ms fall=' + step.largestFallSec.toFixed(3));
        expect(step.largestFallSec, 'never goes back after the press').toBe(0);
        expect(step.longestStillMs, 'never stands still after the press').toBeLessThan(FRAME_MS);
        expect(step.largestStepMs, 'no jump on the first answers').toBeLessThanOrEqual(FRAME_MS * 1.15);
        // A line eased onto the player sits within a tenth of a second of it once the answers have
        // settled, which is the age they are read at.
        expect(Math.abs(shown[shown.length - 1] - playerAtSec(resumedAtMs + 12000)), 'on the player').toBeLessThan(0.25);
    });
});

