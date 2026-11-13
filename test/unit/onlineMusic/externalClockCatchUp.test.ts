import { describe, expect, it } from 'vitest';
import { createExternalClock } from '../../../src/services/onlineMusic/externalClock';

// test/unit/onlineMusic/externalClockCatchUp.test.ts
// What the shown position does when a playing player answers from a little behind it, which is what a
// routine answer looks like after the player stalled for a moment: the clock ran on ahead of the spot
// the answer names, so the bar and the lyrics stand ahead of the player until it comes up to them. The
// lead is played out at the slower speed, so the position keeps moving and never steps back over where
// it stood. A stopped song keeps standing where the player put it.

/** One frame at 60 Hz: the spacing of every reading taken here. */
const FRAME_MS = 16;
/** How long the position may stand still between two frames before a listener calls it a hitch. */
const STILL_LIMIT_MS = 100;
/** How often the player is asked where it stands, which is the rate it is followed at. */
const ANSWER_EVERY_MS = 496;

/** The longest stretch, in ms, in which the position did not move between two frames. */
const longestStillMs = (shown: number[]): number => {
    let still = 0;
    let longest = 0;
    for (let index = 1; index < shown.length; index++) {
        still = shown[index] > shown[index - 1] ? 0 : still + FRAME_MS;
        longest = Math.max(longest, still);
    }
    return longest;
};

/** How far, in seconds, the position fell back between two frames. */
const largestFallSec = (shown: number[]): number => {
    let largest = 0;
    for (let index = 1; index < shown.length; index++) largest = Math.max(largest, shown[index - 1] - shown[index]);
    return largest;
};

describe('an external clock answered a little behind the shown position', () => {
    it('goes on moving while a playing player catches up', () => {
        // The player stalls for half a second and then sounds the song on at its own speed. The clock
        // ran on for the stall, so each answer names a spot behind the shown position until the player
        // has played its way up to it. Half a second is the lead a real player's log shows (leadSec
        // 0.49), and it is the shape of every routine answer: the two only drift apart by the age of
        // the answer.
        const clock = createExternalClock();
        const startSec = 10;
        const stallMs = 500;
        /** Where the player itself stands: it does not move for the stall, then sounds the song on. */
        const playerAtSec = (nowMs: number) => startSec + Math.max(0, nowMs - stallMs) / 1000;
        const spanMs = 4000;
        const shown: number[] = [];
        clock.sync({ positionSec: startSec, paused: false, nowMs: 0, durationSec: 200 });
        let answeredAtMs = 0;
        for (let nowMs = 0; nowMs <= spanMs; nowMs += FRAME_MS) {
            if (nowMs - answeredAtMs >= ANSWER_EVERY_MS) {
                answeredAtMs = nowMs;
                clock.sync({ positionSec: playerAtSec(nowMs), paused: false, nowMs, holdBackward: true });
            }
            shown.push(clock.read(nowMs));
        }
        const still = longestStillMs(shown);
        const fall = largestFallSec(shown);
        console.log('[catch up] still=' + still + 'ms fall=' + fall.toFixed(3) + ' last=' + shown[shown.length - 1].toFixed(3));
        expect(fall, 'never goes back over where it stood').toBe(0);
        expect(still, 'never stands still under a song that is playing').toBeLessThanOrEqual(STILL_LIMIT_MS);
        expect(Math.abs(shown[shown.length - 1] - playerAtSec(spanMs)), 'on the player once it catches up').toBeLessThanOrEqual(0.2);
    });

    it('stands where the player put it under a stopped song', () => {
        // A stopped song shows where the player stands: the pause is written down as it came, and the
        // position stands on that spot rather than running on past it.
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0, durationSec: 200 });
        expect(clock.read(900)).toBeCloseTo(10.9);
        clock.sync({ positionSec: 10, paused: true, nowMs: 900, holdBackward: true });
        expect(clock.read(2000)).toBeCloseTo(10.9);
        expect(clock.read(9000)).toBeCloseTo(10.9);
    });

    it('stands on the spot while the player answers from further behind than a lead is run out over', () => {
        // A player answering seconds behind is not catching up with the bar but saying the song is
        // somewhere else. The position stands where it is rather than running on slowly for seconds,
        // and it is never taken back over.
        const clock = createExternalClock();
        clock.sync({ positionSec: 10, paused: false, nowMs: 0, durationSec: 200 });
        expect(clock.read(4000)).toBeCloseTo(11);
        clock.sync({ positionSec: 10, paused: false, nowMs: 4000, holdBackward: true });
        expect(clock.read(5000)).toBeCloseTo(11);
        expect(clock.read(9000)).toBeCloseTo(11);
    });
});
