import { describe, expect, it } from 'vitest';
import {
    CROSSFADE_DEFAULT_SEC,
    CROSSFADE_MAX_SEC,
    CROSSFADE_MIN_SEC,
    clampCrossfadeSeconds,
    planCrossfade,
} from '@/services/automix/crossfadePlanner';
import { modeNeedsBeatGrid, planForMode } from '@/services/automix/transitionStrategy';
import type { TransitionTrack } from '@/services/automix/transitionPlanner';
import { makeProfile } from './trackProfileFixture';

// test/unit/automix/crossfadePlanner.test.ts
// The crossfade mode's contract, which is almost entirely about what it does NOT do.

const bare = (duration: number): TransitionTrack => ({ duration, lines: null, profile: null });

describe('clampCrossfadeSeconds', () => {
    it('keeps the slider inside its own range and rounds to whole seconds', () => {
        expect(clampCrossfadeSeconds(0)).toBe(CROSSFADE_MIN_SEC);
        expect(clampCrossfadeSeconds(1000)).toBe(CROSSFADE_MAX_SEC);
        expect(clampCrossfadeSeconds(7.4)).toBe(7);
        // A stored value that was hand-edited, or a Number('') - the setting has to survive both.
        expect(clampCrossfadeSeconds(Number.NaN)).toBe(CROSSFADE_DEFAULT_SEC);
    });
});

describe('which modes are worth running the beat model for', () => {
    // The pairing this file is the guard for. `planCrossfade` reads nothing off a profile but its
    // silence edges, so a grid produced for crossfade has no reader - and producing one is a whole
    // decode plus an inference per prefetched track. The test above, "is the same plan every time",
    // is what catches a crossfade that starts using one; this is what says what to do about it.
    it('is automix only, because the crossfade planner reads no grid', () => {
        expect(modeNeedsBeatGrid('automix')).toBe(true);
        expect(modeNeedsBeatGrid('crossfade')).toBe(false);
    });
});

describe('planCrossfade', () => {
    it('gives the requested length, flush with the end of the outgoing track', () => {
        const plan = planCrossfade(bare(200), bare(200), 12);
        expect(plan.kind).toBe('fade');
        expect(plan.style).toBe('plainBlend');
        expect(plan.overlap).toBe(12);
        expect(plan.outStart).toBe(188);
        expect(plan.inStart).toBe(0);
    });

    it('is the same plan every time, whatever was measured about the pair', () => {
        // Everything automix reads, all at once: a tempo, a key, section edges, a hot start, a
        // fade-out slope. If any of it reached this planner one of these two would differ, and the
        // mode would have stopped being the predictable half of the setting.
        //
        // The BAR LINE fields carry non-null values here deliberately, and the fixture defaults
        // them to null - so this read as a full grid while covering nothing about one. It is the
        // field a bar-aligned crossfade would reach for first, and it is what `modeNeedsBeatGrid`
        // above stakes the whole beat model on: verified by sabotage, not by reading.
        const measured: TransitionTrack = {
            duration: 200,
            lines: [{ words: [], startTime: 5, endTime: 199, fullText: 'sings to the end' }],
            profile: makeProfile({
                bpm: 174, outroBpm: 174, sections: [180, 190], outroSlope: -3,
                key: 3, major: false, keyConfidence: 0.9,
                beatOffset: 0.21, downbeatOffset: 0.63, headDownbeatOffset: 0.44, beatsPerBar: 3,
            }),
        };
        const hot: TransitionTrack = {
            duration: 200,
            lines: null,
            profile: makeProfile({
                startsHot: true, bpm: 92, key: 9, keyConfidence: 0.9,
                beatOffset: 0.05, downbeatOffset: 0.17, headDownbeatOffset: 0.9, beatsPerBar: 4,
            }),
        };
        expect(planCrossfade(measured, hot, 8)).toEqual(planCrossfade(bare(200), bare(200), 8));
    });

    it('treats the setting as a maximum, not a length', () => {
        // Three seconds of the outgoing track left, so a ten second request cannot be met and the
        // plan says how much it actually got rather than what was asked for.
        const plan = planCrossfade(bare(200), bare(200), 10, 197);
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBe(3);
        expect(plan.reason).toContain('capped');
    });

    it('skips digital silence at both ends, because a fade into it is a fade into nothing', () => {
        const from: TransitionTrack = {
            duration: 200, lines: null, profile: makeProfile({ leadOut: 6 }),
        };
        const to: TransitionTrack = {
            duration: 200, lines: null, profile: makeProfile({ leadIn: 4 }),
        };
        const plan = planCrossfade(from, to, 10);
        // Ends where the music does, not where the file does.
        expect(plan.outStart).toBe(184);
        expect(plan.overlap).toBe(10);
        // A tenth of a second of the incoming silence is kept, so the first transient is not
        // clipped off by landing exactly on it.
        expect(plan.inStart).toBe(3.9);
    });

    it('cuts rather than scheduling a fade there is no room for', () => {
        // A two second interlude: the quarter-length ceiling leaves half a second, which is under
        // the floor a crossfade needs to be one.
        const plan = planCrossfade(bare(2), bare(200), 10);
        expect(plan.kind).toBe('hardCut');
        expect(plan.overlap).toBe(0);
    });

    it('will not fade for longer than the incoming track exists', () => {
        const plan = planCrossfade(bare(200), bare(3), 10);
        expect(plan.overlap).toBe(3);
    });
});

describe('planForMode', () => {
    const settings = { mode: 'crossfade' as const, crossfadeMaxSec: 9, performance: false };

    it('uses the listener\'s length in crossfade mode', () => {
        const plan = planForMode(settings, bare(200), bare(200), 120, 0);
        expect(plan.overlap).toBe(9);
        expect(plan.style).toBe('plainBlend');
    });

    it('ignores the crossfade length in automix mode', () => {
        // A pair automix has something to say about: the outgoing track fades out on its own, so
        // it picks bassSwap and a length of its own choosing.
        const from: TransitionTrack = {
            duration: 200, lines: null, profile: makeProfile({ outroSlope: -3 }),
        };
        const plan = planForMode(
            { mode: 'automix', crossfadeMaxSec: 9, performance: false }, from, bare(200), 120, 0,
        );
        expect(plan.style).toBe('bassSwap');
        expect(plan.overlap).not.toBe(9);
    });

    it('degrades to a crossfade, and says so, when automix has nothing measured', () => {
        // The honest failure. With no profile, no tempo and no lyrics, automix cannot reach any of
        // the decisions it exists to make, so the song change is handed to the planner that does
        // not need them - rather than reaching a beat cut or a tempo bend out of an empty profile.
        const plan = planForMode({ mode: 'automix', crossfadeMaxSec: 9, performance: false }, bare(200), bare(200));
        expect(plan.style).toBe('plainBlend');
        expect(plan.stretch).toBe(1);
        expect(plan.echoThrow).toBe(false);
        expect(plan.overlap).toBe(CROSSFADE_DEFAULT_SEC);
        expect(plan.reason).toContain('automix has no evidence here');
    });

    it('does not call a live tempo "nothing measured"', () => {
        // A track with no offline profile is still measurable: the sounding deck's own tap gives a
        // tempo, and that tempo is the difference between a blend eight bars long and one five
        // seconds long. Guarding on the profile alone threw that away.
        const plan = planForMode(
            { mode: 'automix', crossfadeMaxSec: 9, performance: false }, bare(200), bare(200), 90, 150,
        );
        expect(plan.reason).not.toContain('automix has no evidence');
        expect(plan.overlap).toBeGreaterThan(CROSSFADE_DEFAULT_SEC);
    });

    it('takes a stored length that is out of range without passing it on', () => {
        const plan = planForMode({ mode: 'crossfade', crossfadeMaxSec: 999, performance: false }, bare(400), bare(400));
        expect(plan.overlap).toBe(CROSSFADE_MAX_SEC);
    });
});
