import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line } from '@/types';
import {
    createAutomixSession,
    AUTOMIX_ARM_LEAD_SEC,
    type AutomixDeckId,
    type AutomixSessionPorts,
} from '@/services/automix/automixSession';
import { AUTOMIX_MIN_OVERLAP_SEC, type TransitionTrack } from '@/services/automix/transitionPlanner';
import { DEFAULT_TRANSITION_SETTINGS } from '@/services/automix/transitionStrategy';
import { type TrackProfile } from '@/services/automix/trackProfile';
import { makeProfile } from './trackProfileFixture';
import { subscribeToTransitionCue, type TransitionCue } from '@/services/automix/transitionCue';
import {
    asElement,
    createFakeChain,
    createFakeContext,
    createFakeElement,
    finalTarget,
    lastCurve,
    type FakeAnalyserReadings,
    type FakeAudioElement,
    type FakeDeckChain,
} from './fakeAudioGraph';

// test/unit/automix/automixSession.test.ts
// Exercises the arm -> fade -> settle machine and, just as importantly, every path that refuses.

const line = (startTime: number, endTime: number, fullText = 'la'): Line => ({
    words: [], startTime, endTime, fullText,
});

/**
 * A pair with a six second instrumental outro and a five second instrumental intro.
 *
 * The outro is read off the lyric timeline; the intro is measured off the audio, so it only exists
 * on tracks that carry a profile - `withIntro` is how a test asks for one.
 */
const BLENDABLE_FROM: TransitionTrack = { duration: 100, lines: [line(10, 94)] };
const BLENDABLE_TO: TransitionTrack = { duration: 100, lines: [line(5, 90)] };
const withIntro = (overrides: Partial<TrackProfile> = {}): TransitionTrack => ({
    ...BLENDABLE_TO,
    profile: makeProfile({ duration: 100, sectionStart: 5, ...overrides }),
});

const createHarness = (readings: Partial<Record<AutomixDeckId, FakeAnalyserReadings>> = {}) => {
    // Deck A sits exactly on the planned outStart: a six second outro against a five second
    // intro gives a five second overlap, so the track has five seconds left to give.
    const elements: Record<AutomixDeckId, FakeAudioElement> = {
        A: createFakeElement(100, 95),
        B: createFakeElement(100, 0),
    };
    const chains: Record<AutomixDeckId, FakeDeckChain> = {
        A: createFakeChain(readings.A),
        B: createFakeChain(readings.B),
    };
    const context = createFakeContext();

    const activeDeckChanges: AutomixDeckId[] = [];
    const tailSrcChanges: (string | null)[] = [];
    const autoplayHolds: boolean[] = [];
    const advanceTrack = vi.fn();

    /** Every stem lookup the session makes, so a test can check WHICH pair it asked about. */
    const stemAsks: { key: string | null; role: 'tail' | 'head' }[] = [];

    const ports: AutomixSessionPorts = {
        getContext: () => context,
        getElement: deck => asElement(elements[deck]),
        getChain: deck => chains[deck],
        onActiveDeckChange: deck => { activeDeckChanges.push(deck); },
        onTailSrcChange: src => { tailSrcChanges.push(src); },
        onAutoplayHoldChange: held => { autoplayHolds.push(held); },
        advanceTrack,
        // Always empty, so every other test here keeps taking the master crossfade it was written
        // against. Only the keys are under test.
        getStems: (key, role) => { stemAsks.push({ key, role }); return null; },
    };

    const session = createAutomixSession(ports);

    /**
     * Drives the machine to the point where the incoming deck is about to be heard.
     *
     * The default `time` is the planned outStart itself, so unless a test asks for an earlier one
     * there is no lead left to wait out and the blend is due the moment it is armed.
     */
    const arm = (overrides: Partial<Parameters<typeof session.requestTransition>[0]> = {}) => (
        session.requestTransition({
            time: 95,
            audioSrc: 'outgoing.mp3',
            from: BLENDABLE_FROM,
            to: BLENDABLE_TO,
            // Automix, because that is what every expectation in this file was written against.
            settings: DEFAULT_TRANSITION_SETTINGS,
            nextKey: 'local:next-song',
            fromKey: 'local:this-song',
            ...overrides,
        })
    );

    return {
        session, elements, chains, context, stemAsks,
        activeDeckChanges, tailSrcChanges, autoplayHolds, advanceTrack, arm,
    };
};

describe('automix session', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // The blend is due at 95s (a five second overlap on a hundred second track), so the transition
    // arms a lead ahead of that. Derived rather than written out, because the lead is a tuning
    // number: hard-coding it here would turn every adjustment into a pile of unrelated test edits.
    const ARM_AT = 95 - AUTOMIX_ARM_LEAD_SEC;
    /** How long the incoming deck may spend loading, less the quarter second the release costs. */
    const HOLD_MS = (AUTOMIX_ARM_LEAD_SEC - 0.25) * 1000;

    it('leaves the track alone until the overlap is within its lead', () => {
        const harness = createHarness();

        const plan = harness.arm({ time: ARM_AT - 1 });

        expect(plan?.kind).toBe('fade');
        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.advanceTrack).not.toHaveBeenCalled();
    });

    it('requests the next track a lead ahead of the blend, not at the moment it is due', () => {
        // The lead pays for playSong's own cache reads, the React commit and play(). The audio
        // itself is loaded well before this, on the idle deck - see resolveDeckSrc.
        const harness = createHarness();

        harness.arm({ time: ARM_AT });

        expect(harness.session.getPhase()).toBe('armed');
        expect(harness.advanceTrack).toHaveBeenCalledTimes(1);
    });

    it('holds the autoplay over the lead and lifts it just before the blend is due', () => {
        const harness = createHarness();

        harness.arm({ time: ARM_AT });
        expect(harness.autoplayHolds).toEqual([true]);

        vi.advanceTimersByTime(HOLD_MS - 100);
        expect(harness.autoplayHolds).toEqual([true]);

        vi.advanceTimersByTime(200);
        expect(harness.autoplayHolds).toEqual([true, false]);
    });

    it('gives the blend its full planned length even when the next deck is slow to load', () => {
        // The regression this whole lead exists for. Armed at outStart, a deck that took a moment
        // to make a sound left that much less of the outgoing track and that much less blend - the
        // same subtraction on every song change, which is why a planner that asks for anything
        // between 1.5 and 8 seconds was only ever heard as about three.
        const harness = createHarness();
        harness.arm({ time: ARM_AT });

        vi.advanceTimersByTime(AUTOMIX_ARM_LEAD_SEC * 1000);
        harness.elements.A.currentTime = 95;
        harness.session.handleActiveDeckPlaying('local:next-song');

        expect(lastCurve(harness.chains.A.fadeNode)?.duration).toBe(5);
        expect(lastCurve(harness.chains.B.fadeNode)?.duration).toBe(5);
    });

    it('measures the lead from where the music stops, not from the end of the file', () => {
        // The blend is now aimed in front of a padded master's trailing silence, and the release
        // has to follow it there. Re-deriving the wait from the duration would hold the autoplay
        // through the whole of that silence and hand the fade what was left - a quarter of a
        // second, under its own floor - so the blend would not run short, it would be dropped.
        const padded: TransitionTrack = {
            ...BLENDABLE_FROM,
            // Its own lyric end rather than the shared fixture's 94s, which sings to one second
            // before its music stops. Now that the vocal floor is a real floor, that fixture can
            // only ever produce a one second blend - a correct answer to a different question,
            // and it left this test measuring the floor rather than the lead. Eight seconds of
            // instrumental tail is what this one needs to have a length worth measuring.
            lines: [line(10, 87)],
            profile: makeProfile({ duration: 100, leadOut: 5 }),
        };
        const harness = createHarness();

        const plan = harness.arm({ time: 87 - AUTOMIX_ARM_LEAD_SEC, from: padded });
        // Whatever the length works out to, it finishes where the MUSIC does - 95s - and not
        // where the file does.
        expect(plan!.outStart + plan!.overlap).toBeCloseTo(95, 6);
        expect(plan?.outStart).toBe(87);
        expect(harness.autoplayHolds).toEqual([true]);

        vi.advanceTimersByTime(HOLD_MS + 100);
        expect(harness.autoplayHolds).toEqual([true, false]);

        harness.elements.A.currentTime = 87;
        harness.session.handleActiveDeckPlaying('local:next-song');

        // Close to the planned eight, and nudged off it only by the beat snap - which is the grid
        // moving the length, not the release round trip eating it.
        const duration = lastCurve(harness.chains.A.fadeNode)!.duration;
        expect(duration).toBeGreaterThan(6);
        expect(duration).toBeLessThanOrEqual(8);
        // 120 BPM from the profile: the handover itself lands on a beat.
        expect((duration * 0.45) % 0.5).toBeCloseTo(0, 6);
    });

    it('holds nothing when the blend is already due as it arms', () => {
        const harness = createHarness();

        harness.arm();

        // Nothing to wait out, so the app's autoplay is never touched: a hold that is set and
        // cleared in the same tick is a render nobody needs.
        expect(harness.autoplayHolds).toEqual([]);
    });

    it('lifts the hold when the listener pauses during the lead', () => {
        // A held autoplay outlives its transition exactly once before the app is silent for good:
        // the deck is loaded, nothing is going to press play on it, and nothing says why.
        const harness = createHarness();
        harness.arm({ time: ARM_AT });

        harness.session.abort();

        expect(harness.autoplayHolds).toEqual([true, false]);
    });

    it('lifts the hold when the outgoing track ends before the blend was due', () => {
        const harness = createHarness();
        harness.arm({ time: ARM_AT });

        harness.session.handleTailEnded();

        expect(harness.autoplayHolds).toEqual([true, false]);
        expect(harness.session.getPhase()).toBe('idle');
    });

    it('lifts the hold when something else starts the deck first', () => {
        // The stall check, or the listener pressing play. Either way the deck is sounding, so a
        // hold left standing would only suppress the NEXT track's autoplay.
        const harness = createHarness();
        harness.arm({ time: ARM_AT });

        harness.session.handleActiveDeckPlaying('local:next-song');

        expect(harness.autoplayHolds).toEqual([true, false]);
    });

    it('hands the deck role over and requests the next track once the overlap begins', () => {
        const harness = createHarness();

        harness.arm();

        expect(harness.session.getPhase()).toBe('armed');
        expect(harness.session.getActiveDeck()).toBe('B');
        expect(harness.activeDeckChanges).toEqual(['B']);
        // Pinned before the roles moved, so the outgoing deck's src never changes and its
        // playback is never interrupted.
        expect(harness.tailSrcChanges).toEqual(['outgoing.mp3']);
        expect(harness.advanceTrack).toHaveBeenCalledTimes(1);
    });

    it('silences the incoming deck before it is allowed to make a sound', () => {
        const harness = createHarness();

        harness.arm();

        expect(finalTarget(harness.chains.B.fadeNode)).toBe(0);
    });

    it('never starts the next track early when there is no fade to schedule', () => {
        const harness = createHarness();

        // A stream of unknown length: there is no end to place a fade before.
        const plan = harness.arm({ from: { duration: Infinity, lines: [line(10, 94)] } });

        expect(plan?.kind).toBe('hardCut');
        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.session.getActiveDeck()).toBe('A');
        expect(harness.advanceTrack).not.toHaveBeenCalled();
    });

    it('arms two tracks that sing end to end rather than declining them', () => {
        const harness = createHarness();

        const plan = harness.arm({
            from: { duration: 100, lines: [line(10, 99.9)] },
            to: { duration: 100, lines: [line(0.1, 90)] },
        });

        expect(plan?.kind).toBe('fade');
        expect(harness.session.getPhase()).toBe('armed');
        expect(harness.advanceTrack).toHaveBeenCalledTimes(1);
    });

    // The bug this replaces was invisible for the stems' entire life: the gesture asked the React
    // shell for "the current song's tail", but a gesture is scheduled AFTER the app advances, so
    // `currentSong` was already the incoming track by then. Every transition asked for the tail of
    // a track that had not ended and the head of one that was not playing, got null for both, and
    // fell back to the master crossfade without a word. Naming the armed pair is the fix, so the
    // names are what this pins.
    it('asks for stems by the pair it armed with, not by whatever is current when it fires', () => {
        const harness = createHarness();
        harness.arm();

        harness.session.handleActiveDeckPlaying('local:next-song');

        // Four asks, two moments, and the same PAIR at both. The first two are the PLANNER's: where
        // the outgoing track stops singing is read off its vocal stem, and whether either voice can
        // be held at all decides how long a blend is allowed - so both windows are looked up while
        // the plan is being made as well as when the gesture is scheduled. Same keys both times,
        // which is the property under test: a second identity resolved at a second moment is
        // exactly the bug above.
        expect(harness.stemAsks).toEqual([
            { key: 'local:this-song', role: 'tail' },
            { key: 'local:next-song', role: 'head' },
            { key: 'local:this-song', role: 'tail' },
            { key: 'local:next-song', role: 'head' },
        ]);
    });

    it('schedules complementary curves over the planned overlap once the incoming deck plays', () => {
        const harness = createHarness();
        harness.arm();

        harness.session.handleActiveDeckPlaying('local:next-song');

        expect(harness.session.getPhase()).toBe('fading');
        const outgoing = lastCurve(harness.chains.A.fadeNode);
        const incoming = lastCurve(harness.chains.B.fadeNode);
        expect(outgoing?.duration).toBe(5);
        expect(incoming?.duration).toBe(5);
        expect(outgoing?.curve[0]).toBeCloseTo(1, 6);
        expect(outgoing?.curve.at(-1)).toBeCloseTo(0, 6);
        expect(incoming?.curve[0]).toBeCloseTo(0, 6);
        expect(incoming?.curve.at(-1)).toBeCloseTo(1, 6);
    });

    it('holds the outgoing track down when it is measurably the louder of the two', () => {
        // Equal power is not equal loudness: masters differ by up to 10dB across a library, and
        // that difference is exactly what "the old song sits on top of the new one" sounds like.
        const harness = createHarness({ A: { loudnessDb: -10 }, B: { loudnessDb: -20 } });
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        vi.advanceTimersByTime(150);

        expect(finalTarget(harness.chains.A.trimNode)).toBeCloseTo(0.501, 3);
        // The arriving track is never lifted: that risks clipping and has to be undone afterwards.
        expect(harness.chains.B.trimNode.events).toHaveLength(0);
    });

    it('leaves the levels alone when the track arriving is the louder one', () => {
        const harness = createHarness({ A: { loudnessDb: -24 }, B: { loudnessDb: -14 } });
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        vi.advanceTimersByTime(300);

        expect(harness.chains.A.trimNode.events).toHaveLength(0);
    });

    it('gives the trim back so the deck is not still attenuated next time it is used', () => {
        const harness = createHarness({ A: { loudnessDb: -10 }, B: { loudnessDb: -20 } });
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        vi.advanceTimersByTime(5_200);

        expect(finalTarget(harness.chains.A.trimNode)).toBe(1);
    });

    it('lands the handover on a beat of the outgoing track', () => {
        const harness = createHarness({ A: { loudnessDb: -20, bpm: 120, nextBeatIn: 0.1 } });
        harness.arm({ to: withIntro() });

        harness.session.handleActiveDeckPlaying('local:next-song');

        // Beats every half second from 0.1s in. At -20dBFS the handover sits at 42.5% of the
        // blend, so the length moves until that lands on the beat at 1.6s.
        expect(lastCurve(harness.chains.A.fadeNode)?.duration).toBeCloseTo(1.6 / 0.425, 5);
    });

    it('drops the blend when the queue moved to a song it never measured', () => {
        const harness = createHarness();
        harness.arm();

        harness.session.handleActiveDeckPlaying('local:some-other-song');

        expect(lastCurve(harness.chains.B.fadeNode)).toBeNull();
        expect(finalTarget(harness.chains.A.fadeNode)).toBe(0);
        expect(finalTarget(harness.chains.B.fadeNode)).toBe(1);
    });

    it('drops the blend when the outgoing track ran out while the next one loaded', () => {
        const harness = createHarness();
        harness.arm();
        // Only 0.4s left by the time the incoming deck finally started.
        harness.elements.A.currentTime = 99.6;

        harness.session.handleActiveDeckPlaying('local:next-song');

        expect(lastCurve(harness.chains.B.fadeNode)).toBeNull();
        expect(finalTarget(harness.chains.B.fadeNode)).toBe(1);
    });

    it('clamps the blend to the time the outgoing track actually has left', () => {
        const harness = createHarness();
        harness.arm();
        harness.elements.A.currentTime = 97.5;

        harness.session.handleActiveDeckPlaying('local:next-song');

        expect(lastCurve(harness.chains.A.fadeNode)?.duration).toBe(2.5);
    });

    it('releases both decks once the overlap has elapsed', () => {
        const harness = createHarness();
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        vi.advanceTimersByTime(5_200);

        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.elements.A.pause).toHaveBeenCalled();
        expect(harness.tailSrcChanges.at(-1)).toBeNull();
        expect(finalTarget(harness.chains.A.fadeNode)).toBe(1);
        expect(finalTarget(harness.chains.B.fadeNode)).toBe(1);
    });

    // The one thing a blend tells the screen. Checked here rather than against the animation,
    // because everything the animation decides - whether to draw at all, how long for, where the
    // mark goes - is arithmetic done in this file, and the component only believes it.
    it('announces the blend it actually scheduled, and its end', () => {
        const announced: (TransitionCue | null)[] = [];
        const unsubscribe = subscribeToTransitionCue(cue => announced.push(cue));

        try {
            const harness = createHarness();
            harness.arm();
            harness.session.handleActiveDeckPlaying('local:next-song');

            // The five second overlap this harness is built around, on the audio clock. Not the
            // planned number: a cue that reported the plan rather than the schedule would draw a
            // ring that finishes somewhere other than where the sound does.
            const cue = announced[0]!;
            expect(cue).not.toBeNull();
            expect(cue.seconds).toBeCloseTo(5, 2);
            expect(cue.crossover).toBeGreaterThan(0);
            expect(cue.crossover).toBeLessThan(1);

            vi.advanceTimersByTime(5_200);

            expect(announced.at(-1)).toBeNull();
        } finally {
            unsubscribe();
        }
    });

    // The case the announcement exists to refuse. Nothing is measured about a track dropped into
    // the queue by hand, so automix hands the change to the crossfade planner - and a crossfade is
    // not the thing the animation is drawing.
    it('says nothing when automix had no evidence and a crossfade ran instead', () => {
        const announced: (TransitionCue | null)[] = [];
        const unsubscribe = subscribeToTransitionCue(cue => announced.push(cue));

        try {
            const harness = createHarness();
            const plan = harness.arm({
                from: { duration: 100, lines: [] },
                to: { duration: 100, lines: [] },
            });
            harness.session.handleActiveDeckPlaying('local:next-song');

            // It still blends - the refusal is about what is drawn, not about what is heard.
            expect(plan?.kind).toBe('fade');
            expect(plan?.fellBack).toBe(true);
            expect(announced.filter(cue => cue !== null)).toEqual([]);
        } finally {
            unsubscribe();
        }
    });

    it('keeps the role on the loading deck when the outgoing track runs out first', () => {
        const harness = createHarness();
        harness.arm();

        harness.session.handleTailEnded();

        expect(harness.session.getPhase()).toBe('idle');
        // Handing the role back here is what used to leave the app silent: audioSrc is already on
        // its way to this deck and the audio bridge has already aimed play() at it, so moving the
        // role would drop the next track onto an element nothing is going to start.
        expect(harness.session.getActiveDeck()).toBe('B');
        expect(harness.activeDeckChanges).toEqual(['B']);
        expect(harness.tailSrcChanges.at(-1)).toBeNull();
    });

    it('lets the scheduled ramp finish when the outgoing track ends on cue', () => {
        const harness = createHarness();
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');
        const incomingEventCount = harness.chains.B.fadeNode.events.length;

        harness.session.handleTailEnded();

        expect(harness.session.getPhase()).toBe('fading');
        expect(harness.chains.B.fadeNode.events).toHaveLength(incomingEventCount);
    });

    it('ends the transition when playback is paused while armed', () => {
        const harness = createHarness();
        harness.arm();

        // True tells the caller the in-flight advance still has to have its autoplay suppressed.
        expect(harness.session.abort()).toBe(true);

        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.session.getActiveDeck()).toBe('B');
        // Deck A is the one actually making a sound while armed, so it is the one to stop.
        expect(harness.elements.A.pause).toHaveBeenCalled();
        expect(finalTarget(harness.chains.B.fadeNode)).toBe(1);
    });

    it('reports nothing to suppress when the pause lands mid-blend', () => {
        const harness = createHarness();
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        // The next track is already playing by now, so its autoplay is not pending.
        expect(harness.session.abort()).toBe(false);
        expect(harness.session.getActiveDeck()).toBe('B');
    });

    it('keeps the outgoing deck when the cancel comes from a control aimed at the displayed track', () => {
        const harness = createHarness();
        harness.arm();

        // What a mid-blend seek or pause asks for: the listener is acting on the track they can
        // hear, which is deck A. Ordinary abort settles onto B and would need the whole song-change
        // path run again to get back to A.
        expect(harness.session.abort(true)).toBe(true);

        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.session.getActiveDeck()).toBe('A');
        // The roles swapped, so settle's tail is now the INCOMING deck. A is left sounding for the
        // caller to move or to stop; B is the one that gets stopped here.
        expect(harness.elements.B.pause).toHaveBeenCalled();
        expect(harness.elements.A.pause).not.toHaveBeenCalled();
        // Both back to unity: a deck left attenuated is silent playback the listener cannot fix.
        expect(finalTarget(harness.chains.A.fadeNode)).toBe(1);
        expect(finalTarget(harness.chains.B.fadeNode)).toBe(1);
    });

    it('reports nothing to suppress when the keep-tail cancel lands mid-blend', () => {
        const harness = createHarness();
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        // Same asymmetry as the plain abort: past the arm the advance's autoplay has been spent, so
        // a pause here has nothing left to suppress and must not leave the flag set for a later track.
        expect(harness.session.abort(true)).toBe(false);
        expect(harness.session.getActiveDeck()).toBe('A');
    });

    it('stops the tail when the listener picks a third song in the middle of the blend', () => {
        const harness = createHarness();
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');
        expect(harness.session.getPhase()).toBe('fading');

        // Two decks are sounding at this point and only one of them - the incoming one - is what
        // any control on screen is pointing at. Without this the outgoing deck keeps its scheduled
        // fade running underneath whatever the listener just chose, and nothing can reach it.
        harness.session.handleSongChanged('local:something-else');

        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.elements.A.pause).toHaveBeenCalled();
        expect(finalTarget(harness.chains.B.fadeNode)).toBe(1);
    });

    it('leaves the blend alone for the two songs the blend is between', () => {
        const harness = createHarness();
        harness.arm();

        // The advance the transition started IS a song change, and so is the app still showing the
        // outgoing track through the lead. Treating either as a skip would mean no blend ever
        // survives its own arming.
        harness.session.handleSongChanged('local:next-song');
        expect(harness.session.getPhase()).toBe('armed');
        harness.session.handleSongChanged('local:this-song');
        expect(harness.session.getPhase()).toBe('armed');
    });

    it('stops the tail when the listener asks for the outgoing track back mid-blend', () => {
        const harness = createHarness();
        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');

        // The one skip that cannot be left alone: the app's source now names the same file the
        // tail deck is pinned to, so there is nothing distinct left to hand the active deck and it
        // ends up with an empty source, which surfaces as a playback error on a perfectly good
        // track. Ending the transition first is what leaves one deck, one source.
        harness.session.handleSongChanged('local:this-song');

        expect(harness.session.getPhase()).toBe('idle');
        expect(harness.elements.A.pause).toHaveBeenCalled();
    });

    it('forces a deck playing outside a transition back to unity', () => {
        const harness = createHarness();
        // A blend that was cancelled could have left this deck silent; nothing else would fix it.
        harness.chains.A.fade.gain.value = 0;

        harness.session.handleActiveDeckPlaying('local:whatever');

        expect(finalTarget(harness.chains.A.fadeNode)).toBe(1);
    });

    it('sets the blend length in beats of the outgoing track rather than in seconds', () => {
        // 90 BPM: eight bars is 21.33s, where a fixed five seconds would be five.
        const harness = createHarness({ A: { bpm: 90 } });

        const plan = harness.arm({
            // Eight bars of room is the point of the test, so the request has to be made while
            // there is still eight bars of track: the planner bounds a blend by what is ahead of
            // the playhead, and the harness default asks from five seconds out.
            time: 78,
            from: { duration: 100, lines: [] },
            to: { duration: 100, lines: [] },
        });

        expect(plan?.overlap).toBeCloseTo(60 / 90 * 32, 2);
        expect(plan?.reason).toContain('32 beats');
    });

    it('alternates the decks across consecutive transitions', () => {
        const harness = createHarness();

        harness.arm();
        harness.session.handleActiveDeckPlaying('local:next-song');
        vi.advanceTimersByTime(5_200);
        expect(harness.session.getActiveDeck()).toBe('B');

        harness.elements.B.currentTime = 96;
        harness.arm({ audioSrc: 'second.mp3', nextKey: 'local:third-song' });

        expect(harness.session.getActiveDeck()).toBe('A');
        expect(harness.tailSrcChanges.at(-1)).toBe('second.mp3');
    });

    it('ignores a second request while a transition is already running', () => {
        const harness = createHarness();
        harness.arm();

        expect(harness.arm()).toBeNull();
        expect(harness.advanceTrack).toHaveBeenCalledTimes(1);
    });
});

describe('automix session, transition styles', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const profile = (overrides: Partial<TrackProfile> = {}): TrackProfile =>
        makeProfile({ duration: 100, ...overrides });

    it('does not read the arriving track\'s intro as a mastering imbalance', () => {
        // The incoming deck is measured a second into its own track, which is nearly always its
        // intro - quiet on purpose. Comparing that against the outgoing track's tail said "10dB
        // out" on song changes that were not out at all, and pulled the outgoing track down by the
        // whole ceiling every single time. A correction that saturates on every input is a
        // constant. The profile says where this track actually lives, so that is the comparison.
        const harness = createHarness({ A: { loudnessDb: -10 }, B: { loudnessDb: -30 } });
        harness.arm({
            from: { ...BLENDABLE_FROM, profile: profile() },
            to: { ...BLENDABLE_TO, profile: profile({ loudness: -9 }) },
        });

        harness.session.handleActiveDeckPlaying('local:next-song');
        vi.advanceTimersByTime(300);

        expect(harness.chains.A.trimNode.events).toHaveLength(0);
    });

    it('does not read the leaving track\'s last loud bars as a mastering imbalance either', () => {
        // The mirror of the test above, and the half that stayed broken. The outgoing side was a
        // LIVE tap - a short window, so it reads several dB above the same track's integrated value
        // on anything with dynamics - while the incoming side was the whole-track figure. The
        // difference between two different kinds of measurement carries a constant offset, and the
        // trim duly sat on its 6dB clamp across a whole real log. Two tracks mastered to the same
        // level must come out at no correction however loud the final bars happen to be.
        const harness = createHarness({ A: { loudnessDb: -4 }, B: { loudnessDb: -30 } });
        harness.arm({
            from: { ...BLENDABLE_FROM, profile: profile({ loudness: -14 }) },
            to: { ...BLENDABLE_TO, profile: profile({ loudness: -14 }) },
        });

        harness.session.handleActiveDeckPlaying('local:next-song');
        vi.advanceTimersByTime(300);

        expect(harness.chains.A.trimNode.events).toHaveLength(0);
    });

    it('still holds down a master that really is the louder of the two', () => {
        const harness = createHarness({ A: { loudnessDb: -8 }, B: { loudnessDb: -30 } });
        harness.arm({
            from: { ...BLENDABLE_FROM, profile: profile() },
            to: { ...BLENDABLE_TO, profile: profile({ loudness: -20 }) },
        });

        harness.session.handleActiveDeckPlaying('local:next-song');
        vi.advanceTimersByTime(300);

        // A track that lives at -20 against one still at -8: the ceiling, and this time it means it.
        expect(finalTarget(harness.chains.A.trimNode)).toBeCloseTo(0.501, 3);
    });

    it('spaces the beat grid by the profile, which cannot land an octave out', () => {
        // The live tap heard a few seconds and called it 160; the file measured end to end is 80,
        // and 160 is exactly the double an autocorrelation has no way to rule out. Where the beats
        // fall is still the tap's answer - the profile's phase has drifted by the end of a track.
        const harness = createHarness({ A: { loudnessDb: -20, bpm: 160, nextBeatIn: 0.3 } });
        harness.arm({
            time: 96,
            from: { ...BLENDABLE_FROM, profile: profile({ bpm: 80, outroBpm: 80 }) },
            to: withIntro(),
        });

        harness.session.handleActiveDeckPlaying('local:next-song');

        // Beats every 0.75s, and the handover at 42.5% is moved onto one of them - so it lands on
        // 1.5s. At the tap's 160 the grid would be 0.375s apart and it would land on 1.125s.
        expect(lastCurve(harness.chains.A.fadeNode)?.duration).toBeCloseTo(1.5 / 0.425, 5);
    });

    it('takes the low end off the arriving track and gives it back at the handover', () => {
        // The one thing two overlapping tracks cannot share. Everything below ~250Hz doubles in
        // level, beats against itself and cancels; the mids overlap perfectly happily.
        const harness = createHarness({ A: { loudnessDb: -20 } });
        harness.arm({
            from: { ...BLENDABLE_FROM, profile: profile({ outroSlope: -3 }) },
            to: withIntro({ leadIn: 2 }),
        });

        harness.session.handleActiveDeckPlaying('local:next-song');

        // The arriving deck opens with no low end and ends with all of it; the leaving deck does
        // the opposite, and both are back at flat by the time the curve is over.
        const arriving = lastCurve(harness.chains.B.toneParams[0])!.curve;
        const leaving = lastCurve(harness.chains.A.toneParams[0])!.curve;
        expect(arriving[0]).toBeLessThan(-12);
        expect(arriving.at(-1)).toBeCloseTo(0, 5);
        expect(leaving[0]).toBeCloseTo(0, 5);
        expect(leaving.at(-1)!).toBeLessThan(-12);
    });

    it('puts every band back to flat on both decks when the transition settles', () => {
        const harness = createHarness();
        harness.arm({
            from: { ...BLENDABLE_FROM, profile: profile({ outroSlope: -3 }) },
            to: withIntro({ leadIn: 2 }),
        });
        harness.session.handleActiveDeckPlaying('local:next-song');

        vi.advanceTimersByTime(9_000);

        // A deck left shelved would come back thin the next time it is used - the same failure
        // mode the trim reset exists for, and now in three places rather than one.
        for (const deck of ['A', 'B'] as const) {
            for (const band of harness.chains[deck].toneParams) expect(finalTarget(band)).toBe(0);
        }
    });

    it('blends a pair the record already runs together, instead of doing nothing', () => {
        // Both ends at full level off one album used to take a six-millisecond splice, on the
        // grounds that the record already joins them. It does - and on a continuous album that was
        // two thirds of the song changes, so switching blending on produced no audible blending.
        const harness = createHarness();
        // A two second blend starts at 98s rather than the harness default's 95s.
        harness.arm({
            time: 98,
            from: { ...BLENDABLE_FROM, profile: profile({ endsHot: true }) },
            // 0.3s, measured off a real master: less than a beat, so not enough to place a cut in.
            to: { ...BLENDABLE_TO, profile: profile({ startsHot: true, leadIn: 0.3 }) },
        });

        harness.session.handleActiveDeckPlaying('local:next-song');

        const blend = lastCurve(harness.chains.A.fadeNode);
        expect(blend?.duration).toBeGreaterThanOrEqual(AUTOMIX_MIN_OVERLAP_SEC);
        // And it is a real overlap, so the low end is handed over rather than stacked.
        expect(harness.chains.A.toneParams[0].events.length).toBeGreaterThan(0);
    });

    it('cuts rather than fades into a track that starts at full level', () => {
        const harness = createHarness();
        const plan = harness.arm({
            time: 99,
            from: { ...BLENDABLE_FROM, profile: profile({ bpm: 120 }) },
            // A beat of leading silence: at 120 BPM that is the half second the cut needs to be
            // placeable. Without it the chooser keeps a short overlap instead.
            to: { ...BLENDABLE_TO, profile: profile({ startsHot: true, leadIn: 0.8 }) },
        });
        expect(plan?.style).toBe('beatCut');

        harness.session.handleActiveDeckPlaying('local:next-song');

        expect(lastCurve(harness.chains.A.fadeNode)?.duration).toBeCloseTo(0.04, 4);
    });

    it('leaves an unanalysed pair on the plain crossfade it always had', () => {
        const harness = createHarness();
        const plan = harness.arm();

        expect(plan?.style).toBe('plainBlend');
        harness.session.handleActiveDeckPlaying('local:next-song');
        expect(harness.chains.A.toneParams[0].events).toHaveLength(0);
    });
});
