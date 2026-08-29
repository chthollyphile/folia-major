import {
    connectExpansion,
    connectStemBus,
    connectStemDeck,
    rampGain,
    rampGainDb,
    resetThrow,
    resetTone,
    scheduleBandBlend,
    scheduleCrossfade,
    scheduleEchoThrow,
    scheduleStemWindow,
    type AutomixDeckChain,
    type AutomixStemBus,
    type AutomixStemChain,
} from './crossfadeGraph';
import { diagMark } from './diag'; // TEMPORARY memory-diagnostic marks
import {
    envelopeOf,
    singsInWindow,
    incomingCurves,
    outgoingCurves,
    planStemHandover,
} from './stemGesture';
import {
    expansionMask,
    planExpansion,
    renderExpansion,
    type ExpansionPlan,
} from './expansionGesture';
import { STEM_NAMES, type TrackStems } from './stems';
import { createDeckClock, type DeckClock } from './deckClock';
import { barGrid, settledBpm, RAW_RATE_LIMIT, type Grid } from './musicalTime';
import { planBlendShape, trimForBalance, BEATS_PER_BAR } from './signalAnalysis';
import { applyTempoBend, resetTempoBend } from './tempoBend';
import { shapeBlend } from './transitionChooser';
import {
    AUTOMIX_MIN_OVERLAP_SEC,
    resolveOverlap,
    type TransitionPlan,
    type TransitionTrack,
} from './transitionPlanner';
import { planForMode, type TransitionSettings } from './transitionStrategy';
import { announceTransition } from './transitionCue';
import type { TrackProfile } from './trackProfile';

// src/services/automix/automixSession.ts
// The automix state machine, with every browser and React dependency behind a port so the
// decisions can be exercised without a DOM or an audio device.
//
// idle -> armed    a blend was planned; the next track has been requested and the deck roles have
//                  already swapped, so the outgoing track keeps sounding on the deck it started on
// armed -> fading  the incoming deck actually made a sound, and the ramp is on the audio clock
// fading -> idle   the overlap elapsed
//
// Arming happens a few seconds BEFORE the blend is due, and the app's autoplay is held over that
// gap - see AUTOMIX_ARM_LEAD_SEC. Loading a track and starting it are two different events, and
// the whole length of a blend depends on not treating them as one.
//
// Every arrow out of armed and fading also exists as a refusal: the transition can be dropped at
// any point up to the moment the ramp is scheduled, because a blend nobody can vouch for is worse
// than the plain cut it replaced.

export type AutomixDeckId = 'A' | 'B';
export type AutomixPhase = 'idle' | 'armed' | 'fading';

const otherDeck = (deck: AutomixDeckId): AutomixDeckId => (deck === 'A' ? 'B' : 'A');

/**
 * How early a blend is set up, ahead of the moment it is due to start sounding.
 *
 * Arming does two things at once, only one of them cheap. It starts the queue's advance - which puts the
 * next track's name, lyrics and progress bar on screen - and it used to also begin loading the audio.
 * Loading takes seconds; the handover does not.
 *
 * So the audio is loaded somewhere else entirely: the idle deck is handed the next track's source
 * seconds earlier, with nothing else moving (see `deckSrc` in useAutomixDecks). By the time this lead
 * starts the bytes are buffered and all that is left to pay for is `playSong`'s cache reads, a React
 * commit and `play()`.
 *
 * Which is why this is a second rather than the three it started at: a three second lead meant three
 * seconds of the next track's name on screen against a progress bar stuck at 0:00 while the previous
 * track was still playing - and on a short blend the frozen window was longer than the transition it was
 * protecting.
 */
export const AUTOMIX_ARM_LEAD_SEC = 1;

/**
 * How early the hold is lifted, to pay for the round trip between letting go and hearing it.
 *
 * Lifting the hold does not start a deck: it re-renders, runs the audio bridge's autoplay effect, calls
 * play() and waits for the element to say `playing`. Measured across real transitions that round trip is
 * a consistent 100-150ms, and all of it used to come off the front of the blend. Letting go a little
 * early instead costs the outgoing track the same amount off its very end - underneath a fade that has
 * already finished, so nothing is lost.
 */
const RELEASE_MARGIN_SEC = 0.25;

/** Long enough for the last scheduled curve point to be consumed before the deck is torn down. */
const FADE_CLEANUP_MARGIN_MS = 150;
/** A refused blend still has to get the outgoing deck to silence without a click. */
const CUT_SECONDS = 0.05;
/** How often the balance correction re-reads the two decks during a blend. */
const BALANCE_INTERVAL_MS = 100;
/** Slow enough that the correction is never heard arriving. */
const BALANCE_RAMP_SEC = 0.4;
/** Nothing smaller than this is worth moving a gain for. */
const BALANCE_STEP_DB = 0.75;
/**
 * Longest the incoming deck may be held silent to land the handover where it was planned.
 *
 * The hold is what turns "the deck started when it managed to" into "the blend starts where the
 * plan said", and the gap it is closing is the release round trip - a tenth of a second or two.
 * Capped because everything waited is taken off the outgoing track's remaining tail, so a hold that
 * grew unbounded would shorten the blend it exists to place.
 */
const MAX_ALIGN_HOLD_SEC = 1;

export interface AutomixSessionPorts {
    getContext: () => AudioContext | null;
    getElement: (deck: AutomixDeckId) => HTMLAudioElement | null;
    getChain: (deck: AutomixDeckId) => AutomixDeckChain | null;
    /** Hands the deck role over: repoints the app's audio ref and rebinds the src of both decks. */
    onActiveDeckChange: (deck: AutomixDeckId) => void;
    /**
     * Pins the outgoing source on the deck that is fading out; null once it is released. `harvest` is
     * true on every ordinary settle (the outgoing deck played a whole tail and its reading is worth
     * keeping) and false only when a transition is cancelled back onto the outgoing deck - nothing
     * played out there, so recording the deck would file away a track that never actually finished.
     */
    onTailSrcChange: (src: string | null, opts?: { harvest?: boolean }) => void;
    /**
     * Holds the app's autoplay while the incoming deck loads, until the blend is actually due.
     *
     * The deck still takes its source and buffers it - only pressing play is deferred. Released
     * from exactly one place, `setAutoplayHold`, so no path can leave the app silently held.
     */
    onAutoplayHoldChange: (held: boolean) => void;
    /** Runs the queue's ordinary advance, early. */
    advanceTrack: () => void;
    /**
     * Separated stems for one named track, or null when there are none.
     *
     * A function rather than a field on the request because separation finishes on its own clock: a plan
     * is made up to half a minute before it runs, and stems that arrive inside that gap should still be
     * used. Read once, at the moment the gesture is scheduled.
     *
     * Takes the playback key rather than a role, because the caller cannot answer "which track is the
     * outgoing one" at that moment - by the time a gesture is scheduled the app has advanced, so its idea
     * of the current song is the INCOMING one. The session is the only place that still holds both
     * identities from arm time, so it names them. See `getStemsByKey`.
     */
    getStems?: (key: string | null, role: 'tail' | 'head') => TrackStems | null;
}

export interface AutomixTransitionRequest {
    /** Seconds into the outgoing track. */
    time: number;
    /** The source the outgoing deck is playing; pinned to it across the swap. */
    audioSrc: string;
    from: TransitionTrack;
    to: TransitionTrack;
    /** Which strategy plans this song change, and the crossfade mode's length setting. */
    settings: TransitionSettings;
    /** Playback key of the track the queue will advance to, checked again before the ramp. */
    nextKey: string;
    /** Playback key of the track the outgoing deck is playing. */
    fromKey: string;
}

export const createAutomixSession = (ports: AutomixSessionPorts) => {
    const clocks: Record<AutomixDeckId, DeckClock> = { A: createDeckClock(), B: createDeckClock() };
    let activeDeck: AutomixDeckId = 'A';
    let phase: AutomixPhase = 'idle';
    let plan: TransitionPlan | null = null;
    let plannedNextKey: string | null = null;
    let plannedFromKey: string | null = null;
    /** Both offline profiles, kept from planning until the blend is actually scheduled. */
    let plannedFrom: TrackProfile | null = null;
    let plannedTo: TrackProfile | null = null;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let balanceTimer: ReturnType<typeof setInterval> | null = null;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    let holdingAutoplay = false;
    let appliedTrimDb = 0;

    const clearTimers = () => {
        if (cleanupTimer !== null) {
            clearTimeout(cleanupTimer);
            cleanupTimer = null;
        }
        if (balanceTimer !== null) {
            clearInterval(balanceTimer);
            balanceTimer = null;
        }
        if (releaseTimer !== null) {
            clearTimeout(releaseTimer);
            releaseTimer = null;
        }
    };

    /** The only writer of the hold, so "held" and "the app is not playing" cannot come apart. */
    const setAutoplayHold = (held: boolean) => {
        if (holdingAutoplay === held) return;
        holdingAutoplay = held;
        ports.onAutoplayHoldChange(held);
    };

    /**
     * One reading of each deck's position against the audio clock.
     *
     * Called from the same timer that feeds the level analysers, so it costs a property read. What
     * it buys is the entire difference between "the incoming deck started at some point in a
     * hundred millisecond window" and "the outgoing track is at 187.4213 seconds right now" - see
     * deckClock. A paused or stalled deck is skipped rather than fitted, because a flat line
     * through a stopped clock is a rate of zero and would be believed.
     */
    const sampleDecks = (contextTime: number) => {
        (['A', 'B'] as const).forEach(deck => {
            const element = ports.getElement(deck);
            if (!element || element.paused || !Number.isFinite(element.currentTime)) return;
            clocks[deck].sample(element.currentTime, contextTime);
        });
    };

    /**
     * Seconds of WALL time from a media position to the next line of that track's own grid.
     *
     * Both halves of the conversion in one place: the grid is in the track's own seconds, the
     * answer is in the audio clock's, and a deck bent onto another tempo is running at neither one.
     */
    const waitToGrid = (grid: Grid | null, fromMedia: number, rate: number): number | null => {
        if (!grid || !(grid.period > 0) || !(rate > 0)) return null;
        const next = grid.offset + Math.ceil((fromMedia - grid.offset) / grid.period) * grid.period;
        return (next - fromMedia) / rate;
    };

    /**
     * Puts the incoming deck's playhead where the plan wants it to enter.
     *
     * Two reasons it is not zero, and they compose: the file's leading silence is not music, and
     * once past it the entry can be walked to whichever of the track's bar lines lands on one of
     * the outgoing track's. Applied twice - once on arming, once again just before the hold is
     * lifted - because everything else in the app that touches a fresh element also touches
     * currentTime, and the last write before play() is the one that counts.
     */
    const seekTo = (element: HTMLAudioElement, position: number) => {
        if (!(position > 0.05)) return;
        const apply = () => {
            if (Math.abs(element.currentTime - position) < 0.02) return;
            try {
                element.currentTime = position;
            } catch {
                // Not seekable yet. The second attempt before release usually is.
            }
        };
        if (element.readyState >= 1) apply();
        else element.addEventListener('loadedmetadata', apply, { once: true });
    };

    /**
     * Keeps the outgoing track from sitting on top of the incoming one for the length of a blend.
     *
     * The curves hand over equal *power*, which only means equal *loudness* if the two masters were cut
     * at the same level - and across a real library they differ by up to 10dB, exactly what "the old song
     * drowns the new one" sounds like. Both decks are measured ahead of their fade, so the comparison is
     * master against master whatever the curves are doing.
     *
     * The correction only ever attenuates, only ever the track that is leaving, and never backs off once
     * applied: a monotonic one-way trim cannot oscillate, and over-trimming a track halfway out of the
     * door costs nothing.
     *
     * `incomingReference` is what the incoming track settles at rather than what it is doing in the second
     * it starts, and that distinction is the whole correctness of this. A track's first seconds are nearly
     * always its intro, quiet *on purpose*; measuring it live and calling the difference a mastering
     * imbalance pulled the outgoing track down by the full ceiling on essentially every song change, which
     * is a constant, not a correction.
     */
    const startBalanceCorrection = (
        context: AudioContext,
        tailChain: AutomixDeckChain,
        activeChain: AutomixDeckChain,
        incomingReference: number | null,
    ) => {
        appliedTrimDb = 0;
        balanceTimer = setInterval(() => {
            const outgoingDb = referenceDb(plannedFrom, tailChain) ?? tailChain.analyser.loudnessDb();
            const incomingDb = incomingReference ?? activeChain.analyser.loudnessDb();
            if (outgoingDb === null || incomingDb === null) return;

            const target = trimForBalance(outgoingDb, incomingDb);
            if (target < appliedTrimDb + BALANCE_STEP_DB) return;

            appliedTrimDb = target;
            rampGainDb(context, tailChain.trim, -appliedTrimDb, BALANCE_RAMP_SEC);
        }, BALANCE_INTERVAL_MS);
    };

    /**
     * Either track's own average level, in the units the taps report.
     *
     * Both sides go through here, and the symmetry is the point. This correction exists to cancel a
     * MASTERING imbalance - one record cut six decibels hotter than another - a property of a whole track.
     * It does not exist to cancel musical dynamics: a quiet intro and a decaying outro are the music, and
     * flattening them is deleting it.
     *
     * So both sides must be the same KIND of measurement, and for two rounds they were not. The incoming
     * side was the whole-track integrated value while the outgoing side was a live tap - a short window
     * over the last few seconds - and a short window over anything with dynamics reads several decibels
     * above the same track's integrated value. The difference carried a built-in offset in the same
     * direction every time, and the symptom was the trim sitting on its 6dB clamp on nearly every
     * transition in a real log. A correction that saturates on every input is a constant, not a correction.
     *
     * The live tap stays as the fallback, for a track that was never analysed - there it is the only
     * reading, and both sides fall back together.
     *
     * The taps read *after* each deck's ReplayGain and the profile was measured *before* it, so the deck's
     * current compensation is added back on - otherwise with ReplayGain switched on the comparison would
     * credit a track with an imbalance ReplayGain had already removed.
     */
    const referenceDb = (
        profile: TrackProfile | null,
        chain: AutomixDeckChain,
    ): number | null => (
        profile === null
            ? null
            : profile.loudness + 20 * Math.log10(Math.max(chain.replayGain.gain.value, 1e-6))
    );

    /** Live for exactly one transition. Emptied by settle, which every ending goes through. */
    let stemChains: AutomixStemChain[] = [];
    /** The soft limiter both of those sum through. Same lifetime, same reason. */
    let stemBus: AutomixStemBus | null = null;
    /** Performance mode's build, if one was rendered. Torn down with the chains it plays beside. */
    let expansionStop: (() => void) | null = null;
    /**
     * What the build did, for the one log line the transition prints.
     *
     * Reported through here rather than printed where it happens, because a gesture whose only output is
     * its own failures is a gesture nobody can confirm ever ran - exactly how the stem handover managed to
     * run zero times for a day after it shipped. Set on every transition performance mode is on for,
     * INCLUDING the ones where it could not fit.
     */
    let expansionNote: string | null = null;

    /** One bar of a track, in seconds. Null unless both halves of the answer were measured. */
    const barSecOf = (profile: TrackProfile | null | undefined): number | null =>
        (profile?.bpm ? (60 / profile.bpm) * (profile.beatsPerBar || 4) : null);

    /**
     * Puts the round-eleven gesture on the clock, or reports that it could not.
     *
     * Everything here is a port of `render11.mts`, which is the harness eight blind listening
     * rounds were scored from. The one thing this adds is the changeover: the harness had the whole
     * track as an array, and a player has a stream it has to take over from.
     */
    const scheduleStemGesture = (args: {
        context: AudioContext;
        tailChain: AutomixDeckChain;
        activeChain: AutomixDeckChain;
        fromStems: TrackStems;
        toStems: TrackStems;
        /** Media time of the outgoing track where the window opens. */
        startMedia: number;
        /**
         * Media time the INCOMING element will actually be at when the window opens.
         *
         * Deliberately not `plan.inStart`. The element is seeked there and then plays, and the
         * window can be up to a second later - so by the time it opens the element has already
         * moved on by the length of the hold. Lining the stems up with the plan instead of with the
         * element leaves them that far apart, which is inaudible while the stems are playing and
         * a jump at the end of the window when the element takes the track back.
         */
        inAt: number;
        startAt: number;
        wall: number;
        outgoingBarSec: number | null;
        incomingBarSec: number | null;
        /** The three halves of a bar line, straight off the outgoing track's profile. */
        outgoingBpm: number | null;
        outgoingDownbeat: number | null;
        outgoingBeatsPerBar: number | null;
        /** The two keys are a semitone or a tritone apart. Stops the voice riding a note out. */
        keysClash: boolean;
        /** Media time of the incoming track's first structural boundary, or null if unmeasured. */
        incomingSectionStart: number | null;
        /** Performance mode's build strength, or null when the mode is off. See TransitionPlan. */
        expansion: number | null;
    }): boolean => {
        const { context, fromStems, toStems, startMedia, wall } = args;
        const rate = fromStems.buffers.vocals.sampleRate;
        const offset = Math.round((startMedia - fromStems.from) * rate);
        const length = Math.round(wall * rate);
        // The window has to fit inside what was separated at BOTH ends. A plan made before the
        // separation finished can ask for a longer overlap than the stems cover, and half a window
        // of stems followed by silence is far worse than the crossfade this replaces.
        const inOffset = Math.round((args.inAt - toStems.from) * rate);
        if (offset < 0 || inOffset < 0
            || offset + length > fromStems.buffers.vocals.length
            || inOffset + length > toStems.buffers.vocals.length) {
            // With the numbers, because this line is the only evidence that STEM_WINDOW_SEC is set
            // too short: the blend it names would have had a stem gesture under a longer window.
            console.log(`[Automix] stems do not cover this ${wall.toFixed(2)}s window`
                + ` (${fromStems.duration.toFixed(0)}s separated, needing from ${(startMedia - fromStems.from).toFixed(2)}s`
                + ` out and ${(args.inAt - toStems.from).toFixed(2)}s in), using the master crossfade`);
            return false;
        }

        const slice = (buffer: AudioBuffer, at: number) => Array.from(
            { length: buffer.numberOfChannels },
            (_, channel) => buffer.getChannelData(channel).subarray(at, at + length),
        );
        // Measured off the SUM of the four stems rather than off any one of them: "quiet" for a
        // vocal exit means quiet against everything else that is playing, which is what makes the
        // same threshold work on a ballad and on a wall of guitars.
        const mixEnvelope = (stems: TrackStems, at: number, span: number) => envelopeOf(
            Array.from(
                { length: stems.buffers.vocals.numberOfChannels },
                (_, channel) => {
                    const out = new Float32Array(span);
                    for (const name of ['vocals', 'drums', 'bass', 'other'] as const) {
                        const data = stems.buffers[name].getChannelData(channel);
                        for (let i = 0; i < span; i += 1) out[i] += data[at + i];
                    }
                    return out;
                },
            ),
            rate,
        );
        const vocals = envelopeOf(slice(fromStems.buffers.vocals, offset), rate);
        const mix = mixEnvelope(fromStems, offset, length);
        /**
         * Whether the incoming track's vocal stem finds any singing in this window. Only the
         * NEGATIVE is usable - see `singsInWindow` and the conjunction below. The entry itself is
         * still placed on the choreography; see `planStemHandover`.
         *
         * The reference is the whole separated head rather than the blend window, and that is what the
         * first attempt got wrong: the relative floor both ends share lands where a voice lives in a
         * full-band outro and down among htdemucs's leakage in a quiet intro, so the window's own median
         * reported a voice at 0.00s on tracks whose intros run 15, 21 and 46 seconds. Thirty separated
         * seconds contain the first verse of essentially any song, which puts this end back on the same
         * measurement as the other.
         */
        const stemFindsVoice = singsInWindow(
            envelopeOf(slice(toStems.buffers.vocals, inOffset), rate),
            mixEnvelope(toStems, 0, toStems.buffers.vocals.length),
        );

        // The outgoing track's bar lines inside the window, so the drums change hands on the count.
        //
        // Built from `downbeatOffset` and the track's own `beatsPerBar`, NOT from the beat grid the rest
        // of this function uses. They are different questions: `beatGrid.offset` is a phase in the BEAT
        // grid, so feeding it to `barGrid` would space the lines a bar apart and put them at the wrong
        // place inside the bar - which looks like a bar line and is one three times in four. Null
        // downbeats means no bar lines, and `planStemHandover` then places the swap on the plain fraction,
        // the honest answer rather than a guessed line.
        const bars: number[] = [];
        const barLines = barGrid(
            args.outgoingBpm, args.outgoingDownbeat, args.outgoingBeatsPerBar ?? BEATS_PER_BAR,
        );
        if (barLines) {
            const first = Math.ceil((startMedia - barLines.offset) / barLines.period);
            for (let k = first; ; k += 1) {
                const at = barLines.offset + k * barLines.period - startMedia;
                if (at > wall) break;
                if (at >= 0) bars.push(at);
            }
        }
        const barSec = args.outgoingBarSec;

        /**
         * Whether the incoming track sings anywhere inside this window - and it takes TWO
         * measurements agreeing, because neither one is trustworthy alone.
         *
         * `singsInWindow` is over-eager: it reads separation bleed as singing on most heads, so a positive
         * from it means nothing. Its NEGATIVE is the useful half - nothing anywhere in the window cleared a
         * floor that bleed usually clears. The structural boundary is the opposite shape: `sectionStart` is
         * measured over the whole track and is believable about WHERE the intro ends, but it answers "where
         * does the arrangement change", not always "where does the singing start".
         *
         * So they are ANDed, and only in the direction where both are strong: the voice is called absent
         * when the stem found none AND the first boundary is beyond the window's far end. On one real
         * session this fired on exactly one transition out of twenty-seven - a 6.57s blend under an 8.19s
         * intro - the one the listener reported as 压音. The other stem negative in that session was
         * overruled by a boundary at 6.5s of a 16.6s window, the case this conjunction exists to catch.
         */
        const introAt = args.incomingSectionStart === null
            ? null
            : args.incomingSectionStart - args.inAt;
        const incomingSings = !(!stemFindsVoice && introAt !== null && introAt > wall);

        const handover = planStemHandover(
            wall, barSec, args.incomingBarSec, bars, vocals, mix,
            { keysClash: args.keysClash, sings: incomingSings },
        );

        const outCurves = outgoingCurves(wall, handover);
        const inCurves = incomingCurves(wall, handover);

        /**
         * The build, laid out against the swap the handover just chose.
         *
         * Planned here rather than in `planForMode` because this is the first moment the drop
         * exists: the swap is decided from the outgoing track's own downbeats and its vocal, and
         * a build that ends anywhere else is a build that ends nowhere.
         */
        const expansion: ExpansionPlan | null = args.expansion === null
            ? null
            : planExpansion(
                args.expansion, handover.swap, barSec, wall, args.outgoingBeatsPerBar ?? 4,
            );
        if (args.expansion !== null) {
            expansionNote = expansion
                ? expansion.reason
                // Named, not swallowed. A 25% build needs 0.35s in front of the swap and almost
                // every window has it, so this line means the handover landed unusually early -
                // which is a fact about the transition, not about this feature.
                : `no room for a build before the swap at ${handover.swap.toFixed(2)}s`;
        }
        if (expansion) {
            // Multiplied into the shipped curves, exactly where ReplayGain is, so `stemGesture`
            // stays a function of the handover alone. Only the stems the build took over: without
            // it the listener hears the stutter AND the drums it was rendered from.
            const mask = expansionMask(wall, expansion);
            for (const name of expansion.stems) {
                for (let i = 0; i < outCurves[name].length; i += 1) outCurves[name][i] *= mask[i];
            }
        }

        // Each deck's loudness compensation sits UPSTREAM of the point these buffers are wired
        // into, so without this the stem gesture is the one part of playback ReplayGain never
        // reaches: with it switched on, every transition would step to the raw level and back.
        // Folded into the curves rather than hung off the changeover so that the clipping walk
        // below measures the levels that will actually play - and because all four of a deck's
        // curves are at unity across its own splice, the stems still meet their element there.
        const outLevel = args.tailChain.replayGain.gain.value;
        const inLevel = args.activeChain.replayGain.gain.value;
        for (const name of STEM_NAMES) {
            for (let i = 0; i < outCurves[name].length; i += 1) outCurves[name][i] *= outLevel;
            for (let i = 0; i < inCurves[name].length; i += 1) inCurves[name][i] *= inLevel;
        }

        // Everything above was measured against a start time chosen BEFORE it ran, and it does not run for
        // free. Whatever it overran by, both elements have already played - so handing the buffers the
        // planned media position would open the window by replaying what was just heard and close it by
        // skipping the same amount, on the track that is by then the loud one. The buffers start that much
        // further in instead, which keeps them on the elements however long the analysis took.
        //
        // The curves are left where they are: they describe the SHAPE of the window and the shape has not
        // moved. What shifts is which fraction of a second the shape starts on, and the hoisted walk above
        // put that back into the tens of milliseconds.
        const at = Math.max(context.currentTime, args.startAt);
        const late = Math.min(
            at - args.startAt,
            (fromStems.buffers.vocals.length - (offset + length)) / rate,
            (toStems.buffers.vocals.length - (inOffset + length)) / rate,
        );

        // Both decks sum through one soft limiter rather than straight into the mix. The pair
        // is the only thing here that can go past full scale - a master on its own cannot -
        // and this is the whole of what keeps it under, in place of a pass that predicted the
        // overshoot and pulled the entire blend down to cover it. See `softLimit`.
        stemBus = connectStemBus(context, args.tailChain.output);
        const outgoing = connectStemDeck(
            context, fromStems, stemBus.input, startMedia + late, at, true,
        );
        const incoming = connectStemDeck(
            context, toStems, stemBus.input, args.inAt + late, at, false,
        );
        stemChains = [outgoing, incoming];

        if (expansion) {
            // Read from where the STEMS were told to start, not from where the plan said. Both are
            // offset by `late`, and a build sourced from the other one would stutter material the
            // window is not about to play.
            const lateSamples = Math.round(late * rate);
            const rendered = expansion.stems.flatMap(name => renderExpansion(
                slice(fromStems.buffers[name], offset + lateSamples), expansion, rate,
            ).map((channel, index) => ({ name, index, channel })));
            // The two stems are summed rather than given a source each: they are going into one
            // gain at one time, and one buffer is one thing to stop.
            const channels = Array.from(
                { length: fromStems.buffers.drums.numberOfChannels },
                (_, index) => {
                    const parts = rendered.filter(part => part.index === index);
                    const out = new Float32Array(parts[0]?.channel.length ?? 0);
                    for (const part of parts) {
                        for (let i = 0; i < out.length; i += 1) out[i] += part.channel[i];
                    }
                    return out;
                },
            );
            // Into the deck's CHANGEOVER, not straight at the bus. Everything else leaving this
            // element crosses the 8ms splice on its way to the stems, and a build may legally
            // start at the window's first sample (real log: `25% build, 0.81s`, from 0.00s, on a
            // swap at 0.81s) - hung off the bus it would be the one thing at full level while the
            // element it replaces is still fading, which is 8ms of doubled drums.
            expansionStop = connectExpansion(
                context, channels, rate, outgoing.output, at + expansion.from, outLevel,
            );
            if (!expansionStop) expansionNote = `${expansion.reason}, but it could not be scheduled`;
        }

        const ok = scheduleStemWindow(
            context, outgoing, outCurves,
            args.tailChain.fade, at, wall, 'out',
        ) && scheduleStemWindow(
            context, incoming, inCurves,
            args.activeChain.fade, at, wall, 'in',
        );
        if (!ok) {
            // The last silent way to decline. Everything else here says why it gave up; this one
            // tore the chains down and returned to the crossfade without a word, which from the
            // outside is identical to the gesture having worked.
            console.log('[Automix] stems could not be scheduled, using the master crossfade');
            expansionStop?.();
            expansionStop = null;
            stemChains.forEach(chain => chain.stop());
            stemChains = [];
            return false;
        }

        /**
         * How long the blend goes with no lead vocal at all - the outgoing one already gone, the
         * incoming one not yet due.
         *
         * Printed on every transition rather than only when it is bad, because this is the number
         * that was wrong and nothing named it. A blend where the listener heard both tracks lose
         * their vocal is not two edits; it is one HOLE, and the log described its two edges on
         * separate lines in different units so the distance between them was never on screen.
         * Measured across one session: every blend that sounded right came out at about -0.5s -
         * the incoming voice arriving while the outgoing one is still leaving, so the handover is
         * a pass - and the one the listener flagged came out at +13.8s.
         */
        const vocalGap = handover.vocalIn - handover.exit.to;
        console.log(
            `[Automix] stems: voice ${{ rest: 'cut in a rest', recede: 'receding', release: 'riding a held note out' }[handover.exit.kind]}`
            + ` ${handover.exit.from.toFixed(2)}-${handover.exit.to.toFixed(2)}s`
            + ` (quietest half-second ${handover.exit.loudDb.toFixed(0)}dB under the mix),`
            + ` drums at ${handover.swap.toFixed(2)}s${bars.length ? ' on a bar line' : ''},`
            + ` bass at ${handover.bassAt.toFixed(2)}s,`
            + (incomingSings
                ? ` next voice at ${handover.vocalIn.toFixed(2)}s`
                : ' the next track does not sing in this window, so no deadline')
            // Whether the ride moved it. This is the one place the gesture changes its own
            // choreography, so it says so rather than leaving a reader to subtract two numbers.
            + (handover.vocalIn > handover.dueAt + 0.005
                ? ` (held back from ${handover.dueAt.toFixed(2)}s to meet the note)`
                : '')
            + (vocalGap > 0
                ? `, ${vocalGap.toFixed(2)}s with neither voice`
                : `, voices overlap by ${(-vocalGap).toFixed(2)}s`)
            // What is left of the blend once the outgoing track has handed over everything it had.
            // Printed because it is the quantity that went wrong and nothing named it: a blend
            // reading 16.64s looks like a length decision, and it was a placement one.
            + `, ${(wall - Math.max(handover.bassAt, handover.vocalIn)).toFixed(2)}s of blend after that`
            // What the voice is actually DOING as it leaves, which is the question neither the
            // branch name nor the quietest-half-second answers. `receding 0.83-8.03s` reads the
            // same whether it faded across a phrase that was ending anyway or across a note the
            // singer was still holding, and those are opposite events - the first is invisible and
            // the second is the one that gets reported as leaving too fast. `let go at` is the
            // moment a fade would have cost nothing; `still holding` means there was no such
            // moment inside the window and the fade had to cross a note that never released.
            + (handover.exit.held === null
                ? ', not on a held note'
                : `, holding a ${(handover.exit.held.to - handover.exit.held.from).toFixed(2)}s note`
                    + ` at ${handover.exit.held.holdDb.toFixed(0)}dB`
                    + (handover.exit.held.to >= wall - 0.05
                        ? ', still holding when the window ends'
                        : `, let go at ${handover.exit.held.to.toFixed(2)}s`))
            + (late > 0.01 ? `, wired ${late.toFixed(2)}s late and lined up on that` : ''),
        );
        return true;
    };

    /**
     * Returns both decks to a defined idle state. The one path every ending shares.
     *
     * Deliberately never hands the deck role back, however the transition ended. The role decides which
     * element React renders `audioSrc` onto, and by the time anything can go wrong the advance is already
     * in flight: moving the role would drop the next track's source onto a different element than the one
     * the audio bridge already called play() on, and the bridge only reacts to the *source* changing -
     * which it did not. Nothing would ever press play again, and the listener hears the song end and then
     * silence.
     */
    const settle = (options: { pauseTail: boolean; harvest?: boolean }) => {
        diagMark(`settle (pauseTail=${options.pauseTail})`);
        clearTimers();
        // Before the gains are put back, because the changeover node is one of them: a stem chain
        // left connected would keep its window playing under the next track.
        expansionStop?.();
        expansionStop = null;
        stemChains.forEach(chain => chain.stop());
        stemChains = [];
        stemBus?.stop();
        stemBus = null;
        // Before anything else: a transition that ends while still holding the autoplay would
        // leave the app with a loaded deck nothing is ever going to press play on.
        setAutoplayHold(false);
        const tailDeck = otherDeck(activeDeck);

        if (appliedTrimDb > 0) {
            console.log(`[Automix] held the outgoing track ${appliedTrimDb.toFixed(1)}dB down to keep it off the next one`);
            appliedTrimDb = 0;
        }

        if (options.pauseTail) {
            ports.getElement(tailDeck)?.pause();
        }

        // Unity on both decks, always. A deck left at zero gain is silent playback: the one
        // failure here a listener cannot work around by pressing anything. The trim, the three
        // tone bands, the throw and the tempo go with it, or a deck that was faded out would come
        // back attenuated, thin, and running at the wrong speed the next time it is used.
        const context = ports.getContext();
        if (context) {
            (['A', 'B'] as const).forEach(deck => {
                const chain = ports.getChain(deck);
                if (!chain) return;
                rampGain(context, chain.fade, 1, 0.03);
                rampGain(context, chain.trim, 1, 0.03);
                resetTone(context, chain.tone);
                resetThrow(context, chain.throw);
                resetTempoBend(ports.getElement(deck));
            });
        }
        // The tail deck is about to be paused or handed a different track; either way the line
        // fitted to its position describes a track nobody is listening to any more.
        clocks[tailDeck].reset();

        phase = 'idle';
        plan = null;
        plannedNextKey = null;
        plannedFromKey = null;
        plannedFrom = null;
        plannedTo = null;
        ports.onTailSrcChange(null, { harvest: options.harvest ?? true });
        // Last, and unconditional: this is the only settle, so it is the only place that
        // can tell the screen a blend is over when the blend was cut short rather than
        // finished. A cue with a length is not enough on its own - a skipped track would
        // leave the animation running against a song nobody is transitioning out of.
        announceTransition(null);
    };

    /**
     * Plans the change and, only if the answer is a blend, starts the next track early.
     *
     * Doing nothing is the other half of the feature: for a clean cut we let the track end on its
     * own, so the queue advances exactly as it does today and the listener hears no difference.
     */
    const requestTransition = (request: AutomixTransitionRequest): TransitionPlan | null => {
        if (phase !== 'idle') return null;

        // The deck still playing is the one whose tempo sets the length: at this point it is the
        // active one, and the only track with any audio behind it to measure.
        const outgoingTempo = ports.getChain(activeDeck)?.analyser.tempo() ?? null;
        // Where the outgoing track actually stops singing, if its tail has been separated by now.
        //
        // Read through `request.fromKey` for the same reason the gesture does: it is the identity the
        // session PINS, and the ref tracking "the current song" is already the incoming track by the time
        // anything downstream runs. Asked here rather than inside the planner because transitionStrategy
        // importing stems would close a real cycle - see the note in stems.ts.
        //
        // Absent on the web build, and on the first transition after a cold start when the model has not
        // finished. Both fall back to the lyric file, which every build before this used unconditionally.
        const outgoingStems = ports.getStems?.(request.fromKey, 'tail') ?? null;
        // The incoming track's head stems, by the key pinned at arm.
        const incomingStems = ports.getStems?.(request.nextKey, 'head') ?? null;
        // An extent each, and only when BOTH ends have one - the `&&` is the point rather than a tidiness.
        // `scheduleStemGesture` refuses unless it has the pair, so a plan that lifted the vocal ceiling on
        // the strength of one window would hand a master crossfade a length only the gesture could carry.
        // "May this blend be long" and "will the gesture run" have to be answered off the same evidence, in
        // one place, or they are two facts again.
        const extent = (stems: TrackStems | null) => (
            outgoingStems && incomingStems && stems
                ? { from: stems.from, to: stems.from + stems.duration }
                : null
        );
        const outgoing: TransitionTrack = {
            ...request.from,
            separated: extent(outgoingStems),
            ...(outgoingStems?.vocalEnd == null
                ? {}
                : { vocalEnd: outgoingStems.from + outgoingStems.vocalEnd }),
        };
        const nextPlan = planForMode(
            request.settings,
            outgoing,
            { ...request.to, separated: extent(incomingStems) },
            // The offline profile measured the whole file; the live tap only heard the last few
            // seconds. Prefer the profile, fall back to the tap for anything never analysed.
            request.from.profile?.bpm ?? outgoingTempo?.bpm ?? null,
            // Where the track actually is. This function is not called on a schedule - it is
            // called when nothing else is blocking it, and the previous blend blocks it for its
            // whole length - so the first look at a track can land after its own handover point.
            request.time,
        );
        // Early by the lead, not on the dot: everything between here and `outStart` is what the
        // next track gets to load in, instead of taking it out of the blend.
        if (nextPlan.kind !== 'fade' || request.time < nextPlan.outStart - AUTOMIX_ARM_LEAD_SEC) {
            return nextPlan;
        }

        const context = ports.getContext();
        const incoming = otherDeck(activeDeck);
        const incomingElement = ports.getElement(incoming);
        const incomingChain = ports.getChain(incoming);
        // Without both chains there is nothing to fade with, and swapping anyway would put two
        // tracks through the default output at full level - the worst outcome available here.
        if (!context || !incomingElement || !incomingChain || !ports.getChain(activeDeck)) {
            return nextPlan;
        }

        // Silence the incoming deck before it is allowed to make a sound, so the blend owns its
        // first sample instead of the track punching in at full level.
        rampGain(context, incomingChain.fade, 0);
        seekTo(incomingElement, nextPlan.inStart);
        // Its old readings describe wherever this deck was left after the last transition.
        clocks[incoming].reset();

        phase = 'armed';
        diagMark(`armed -> ${request.nextKey}`);
        plan = nextPlan;
        plannedNextKey = request.nextKey;
        plannedFromKey = request.fromKey;
        plannedFrom = request.from.profile ?? null;
        plannedTo = request.to.profile ?? null;

        // The order matters: pin the outgoing source to the deck it is already playing on before
        // the roles change, so that deck's src string never changes and its playback is never
        // interrupted. Then advance, which is what eventually swaps in the new source.
        activeDeck = incoming;
        ports.onTailSrcChange(request.audioSrc);
        ports.onActiveDeckChange(incoming);

        // Off the media clock rather than a stopwatch started later: this is how much of the
        // outgoing track is left over once the blend has had its share, which is exactly how long
        // the incoming deck may load for. Set before the advance, because the advance is what
        // eventually reaches the autoplay this is holding back.
        //
        // Read off the plan rather than re-derived from the duration. The two agreed for as long as
        // a blend ended where the file did; now that it ends where the MUSIC does, re-deriving it
        // here would release the hold a track's worth of trailing silence too late and the fade
        // would be clipped by exactly the amount the plan just moved.
        const startIn = nextPlan.outStart - request.time;
        if (startIn > RELEASE_MARGIN_SEC) {
            setAutoplayHold(true);
            releaseTimer = setTimeout(
                () => {
                    // Last write before play(): whatever else touched this element during the
                    // advance, the entry point is what it starts from.
                    seekTo(incomingElement, nextPlan.inStart);
                    setAutoplayHold(false);
                },
                (startIn - RELEASE_MARGIN_SEC) * 1000,
            );
        }

        ports.advanceTrack();
        return nextPlan;
    };

    /** The active deck started making sound. The last moment the blend can still be refused. */
    const handleActiveDeckPlaying = (currentKey: string | null) => {
        // Whatever started this deck - the released hold, the stall check, the listener - it is
        // making a sound now, so there is nothing left to hold back.
        setAutoplayHold(false);

        const context = ports.getContext();
        const activeChain = ports.getChain(activeDeck);

        // A deck that just started is playing something new; its old measurements describe a
        // track nobody is listening to any more.
        activeChain?.analyser.reset();
        clocks[activeDeck].reset();

        if (phase !== 'armed') {
            // Whatever a cancelled blend left behind, a deck playing outside a transition sits at
            // unity. Cheap insurance against the only failure that is not self-correcting.
            if (context && activeChain) rampGain(context, activeChain.fade, 1, 0.02);
            return;
        }

        const tailDeck = otherDeck(activeDeck);
        const tailElement = ports.getElement(tailDeck);
        const tailChain = ports.getChain(tailDeck);

        if (!context || !plan || !activeChain || !tailChain || !tailElement) {
            settle({ pauseTail: true });
            return;
        }

        // How much of the outgoing track is still worth using, which stops where the music does -
        // `outStart + overlap` is the plan's own answer. Taking the element's duration instead would offer
        // the beat snap a track's trailing silence to move the handover into, the one place it must never
        // land. Clamped by the element as well: the profile and the media are two independent measurements
        // of the same file and can disagree.
        const soundingLeft = Math.min(tailElement.duration, plan.outStart + plan.overlap);

        // Where the outgoing track really is, to a fraction of a millisecond, rather than to the
        // tens of milliseconds `currentTime` reports. Everything below is placed against this.
        const now = context.currentTime;
        const tailClock = clocks[tailDeck];
        const position = tailClock.positionAt(now) ?? tailElement.currentTime;
        const tailRate = tailClock.rate() ?? 1;

        // The handover starts where the plan put it, not where the incoming deck happened to make its
        // first sound. The two differ by the release round trip - a tenth of a second or two - and closing
        // that gap is what makes a bar line a bar line rather than a near miss. Never backwards: if the
        // deck was late, the blend starts now and is shorter, as it always was. Clamped here rather than
        // after the fact: everything below measures the blend from this moment, so a wait trimmed later
        // would leave the length describing a start the transition never had.
        const startMedia = Math.min(
            Math.max(position, Math.min(plan.outStart, soundingLeft)),
            position + MAX_ALIGN_HOLD_SEC,
        );
        const remaining = soundingLeft - startMedia;
        const overlap = resolveOverlap(plan, remaining);
        // The queue can move under us between planning and playing: a manual skip, or a track
        // that turned out to be unavailable and auto-skipped. Blending into a song we never
        // measured is precisely the bad transition this feature exists to refuse.
        const refusal = currentKey !== plannedNextKey
            ? 'the queue moved after planning'
            : overlap <= 0 ? 'the outgoing track ran out first' : null;

        phase = 'fading';
        diagMark('fading');

        // Two independent ways to lose part of a blend, and the message used to name only one - the deck
        // being slow. Which sent the next reader looking at load times for a clipped blend whose deck had
        // started on time: the other way is the planning being late, and it takes seconds off rather than
        // tenths. They are told apart by where the outgoing track was when its deck spoke, so print that
        // rather than a conclusion drawn from it.
        if (overlap > 0 && overlap < plan.overlap - 0.05) {
            const lateBy = position - plan.outStart;
            console.log(
                `[Automix] blend clipped to ${overlap}s of the planned ${plan.overlap}s: `
                + (lateBy > 0.05
                    ? `the handover point went by ${lateBy.toFixed(2)}s before this deck spoke`
                    + ` (its ${AUTOMIX_ARM_LEAD_SEC}s of lead started later than that)`
                    : `the outgoing track stops ${(plan.outStart + plan.overlap - tailElement.duration).toFixed(2)}s`
                    + ' earlier than the plan was built for'),
            );
        }

        if (refusal) {
            // Both keys, always: "the queue moved" is a claim about two strings, and when it is
            // wrong it is wrong silently - a perfectly good blend becomes a hard cut and the log
            // reads exactly the same as a real skip.
            console.log(
                `[Automix] dropping blend, ${refusal}`
                + (currentKey === plannedNextKey ? '' : ` (deck has "${currentKey}", planned "${plannedNextKey}")`),
            );
            rampGain(context, tailChain.fade, 0, CUT_SECONDS);
            rampGain(context, activeChain.fade, 1, CUT_SECONDS);
            cleanupTimer = setTimeout(
                () => settle({ pauseTail: true }),
                CUT_SECONDS * 1000 + 70,
            );
            return;
        }

        // Everything measured about the outgoing track, spent here: its level decides how fast the
        // two swap places, and its beat grid decides where that swap lands.
        const tempo = tailChain.analyser.tempo();
        const outgoingDb = tailChain.analyser.loudnessDb();
        // The tail's own tempo where the track's two readings of it agree - a track that slows into
        // its last chorus has two tempos, and one whose readings are a third apart has none. Null
        // falls through to the live tap, which is the only thing that actually heard the tail.
        const outgoingBpm = settledBpm(plannedFrom?.bpm, plannedFrom?.outroBpm);
        const periodSec = outgoingBpm ? 60 / outgoingBpm : tempo?.periodSec ?? null;

        // Whether this song change is handed over stem by stem rather than as two masters.
        //
        // Both ends have to be separated: the gesture is a conversation between them - A's drums
        // leave as B's arrive - and half of it is not a quieter version of it, it is a different
        // and untested thing. `beatCut` is excluded because a cut has no overlap for stems to be
        // handed over across, and a too-short window is excluded for the same reason.
        // Named by the keys pinned at arm, not by whatever the app now calls the current song.
        const fromStems = ports.getStems?.(plannedFromKey, 'tail') ?? null;
        const toStems = ports.getStems?.(plannedNextKey, 'head') ?? null;
        const useStems = Boolean(fromStems && toStems)
            && plan.style !== 'beatCut'
            && overlap >= AUTOMIX_MIN_OVERLAP_SEC;

        // The rate is set before the wait is measured, because the wait is spent AT that rate.
        //
        // Never bent under a stem gesture. The stems are buffers and the element is a stream, and
        // bending one without the other would slide them apart across the window; bending both
        // means two clocks that have to stay locked for twenty-five seconds. The listening test
        // that killed the tempo bend makes that a cost with nothing on the other side of it.
        const stretch = plan.style === 'beatCut' || overlap < AUTOMIX_MIN_OVERLAP_SEC || useStems
            ? 1
            : plan.stretch;
        const applied = applyTempoBend(tailElement, stretch);
        const alignHold = Math.max(0, (startMedia - position) / (tailRate * applied));

        // Where the beats are, from the file rather than from the last few seconds of it.
        //
        // This used to be a live autocorrelation, because nothing else could answer it: the offline
        // profile knows where the beats sit in the FILE, and until the deck clock there was no way to say
        // where the file was on the audio clock. There is now, so the grid is arithmetic rather than an
        // estimate - measured forward from where the blend will START, not from where the deck happens to
        // be while this runs.
        //
        // Only when one tempo describes the whole track, though. `beatOffset` is a phase in the whole-track
        // grid; pairing it with a DIFFERENT period measured over the last half minute gives a grid right
        // about spacing and wrong about position, the worse of the two errors. Where a track slowed down,
        // the tap is the only thing that heard it.
        const steady = plannedFrom?.bpm
            && (plannedFrom.outroBpm === null || Math.abs((plannedFrom.outroBpm ?? 0) - plannedFrom.bpm) < 0.5);
        const beatGrid = steady && plannedFrom?.bpm
            ? { offset: plannedFrom.beatOffset % (60 / plannedFrom.bpm), period: 60 / plannedFrom.bpm }
            : null;
        const nextBeatIn = waitToGrid(beatGrid, startMedia, tailRate * applied)
            ?? tailChain.analyser.nextBeatIn(now + alignHold);
        const fade = planBlendShape({
            overlap,
            outgoingDb,
            nextBeatIn,
            periodSec,
            minOverlap: plan.minOverlap,
            maxOverlap: remaining,
        });
        const shape = shapeBlend({
            style: plan.style,
            room: overlap,
            overlap: fade.overlap,
            crossover: fade.crossover,
            nextBeatIn,
            periodSec,
            incomingLeadIn: plannedTo?.leadIn ?? null,
        });

        // Everything above is in the outgoing track's own seconds. Everything below is on the audio
        // clock, and the two stop being the same unit the moment that track is bent to meet the
        // incoming tempo: eight of its seconds at 1.1x take seven and a bit to play. One division,
        // in one place, is the whole of the conversion.
        const hold = alignHold + shape.hold;
        const startAt = now + hold;
        const wall = shape.overlap / applied;

        // Where each element will be when the window opens. Both sides ask the same question of
        // the same clock, and that symmetry is the point: a stem buffer lined up against anything
        // other than where its element ACTUALLY is drifts by exactly that error, silently while the
        // stems play and audibly as a jump when the element takes the track back.
        //
        // The outgoing side is `startMedia` today, because `shape.hold` is only ever nonzero for a
        // beatCut and stems refuse those. Written as a projection anyway rather than relying on
        // that: the invariant lives in another file, and if it ever changes this is not a line
        // anyone would think to come back to.
        const outgoingAt = clocks[tailDeck].positionAt(startAt) ?? (startMedia + shape.hold * tailRate * applied);
        const incomingAt = clocks[activeDeck].positionAt(startAt)
            ?? ((ports.getElement(activeDeck)?.currentTime ?? plan.inStart) + hold);

        // The stem gesture replaces the crossfade rather than layering on top of it: the four
        // envelopes already say what every stem does across the window, and a master fade running
        // underneath would take the outgoing track away a second time.
        // Cleared per transition: this is read once, just below, and a note left over from the
        // previous song change would print against a blend that never built anything.
        expansionNote = null;
        const stemmed = useStems && fromStems && toStems
            && scheduleStemGesture({
                context, tailChain, activeChain, fromStems, toStems,
                startMedia: outgoingAt, inAt: incomingAt, startAt, wall,
                outgoingBarSec: barSecOf(plannedFrom), incomingBarSec: barSecOf(plannedTo),
                outgoingBpm: plannedFrom?.bpm ?? null,
                outgoingDownbeat: plannedFrom?.downbeatOffset ?? null,
                outgoingBeatsPerBar: plannedFrom?.beatsPerBar ?? null,
                keysClash: plan.relation === 'clashing',
                incomingSectionStart: plannedTo?.sectionStart ?? null,
                expansion: plan.expansion ?? null,
            });

        /**
         * What actually happened, not what was planned.
         *
         * This line used to print above, before the stem branch had run, so `three bands` named a FIELD OF
         * THE PLAN while the stem gesture that replaces those bands left no trace at all - and its own log
         * only speaks up when it declines. Success was therefore indistinguishable from never having been
         * attempted, in the one subsystem hardest to hear. A log that only reports failures cannot confirm
         * anything, which is why this question had to be answered by reading the source, not the output.
         */
        /**
         * Whether this transition was laid out on one grid and started on another.
         *
         * `barSecOf` reads the WHOLE-track tempo; `periodSec` above prefers the tail's own reading and
         * falls back to the live tap. Twenty lines apart, `steady` already encodes this codebase's
         * position that the whole-track number is not to be trusted when the outro disagrees - and the
         * stem gesture's bar grid is the one place that test is not applied.
         *
         * Printed rather than reconciled, and that is the whole of what this line claims. Which reading is
         * right is not decidable from here, and both ways of unifying them move where the drums change
         * hands - an audible change to the one gesture eleven listening rounds settled. So this makes the
         * condition sayable instead of leaving it to be derived from arithmetic on two other numbers in the
         * same line, which is how it was found.
         */
        const snapBpm = periodSec ? 60 / periodSec : null;
        const gridBpm = plannedFrom?.bpm ?? null;
        // `RAW_RATE_LIMIT` rather than a number of its own: it is already this codebase's line
        // between one tempo measured twice and two different tempos, and the first run of this
        // diagnostic printed `125 BPM but started on 121` - a track easing off into its outro,
        // which is not the condition being looked for. NOT folded, deliberately: `settledBpm` can
        // no longer hand back an octave but the live tap still can, and half the true period is
        // exactly the case that cost the beat snap.
        const splitGrid = gridBpm !== null && snapBpm !== null
            && Math.abs(gridBpm - snapBpm) / snapBpm > RAW_RATE_LIMIT;

        const rendering = stemmed ? ', four stems'
            : fromStems && toStems ? `${shape.shapeBands ? ', three bands' : ''}`
                : `, no stems (${!fromStems && !toStems ? 'neither end' : fromStems ? 'the incoming end' : 'the outgoing end'}`
                    + ` is not separated yet)${shape.shapeBands ? ', three bands' : ''}`;
        console.log(
            `[Automix] ${shape.style}${shape.style === plan.style ? '' : ` (planned ${plan.style})`}:`
            + `${hold > 0.01 ? ` waits ${hold.toFixed(2)}s, then` : ''}`
            + ` ${wall < 0.1 ? `${Math.round(wall * 1000)}ms` : `${wall.toFixed(2)}s`}`
            + ` at ${Math.round(shape.crossover * 100)}%`
            + `${shape.together > 0 ? `, both held for ${Math.round(shape.together * 100)}%` : ''}`
            + rendering
            // Performance mode always says something when it is on, whether it built or not. A
            // gesture that reports only its failures cannot be used to confirm it ever ran.
            + `${plan.expansion == null ? '' : `, ${expansionNote ?? `no build (no stem gesture on a ${shape.style})`}`}`
            + `${shape.sweepOut && !stemmed ? ', swept out' : ''}`
            + `${plan.echoThrow ? ', thrown' : ''}`
            + `${applied === 1 ? '' : `, outgoing at ${applied.toFixed(3)}x`}`
            + `${fade.snappedToBeat && shape.style === plan.style ? ` on a beat (${periodSec ? Math.round(60 / periodSec) : '?'} BPM)` : ''}`
            + `${outgoingDb === null ? '' : `, outgoing ${outgoingDb.toFixed(1)} LUFS`}`
            + `${splitGrid ? `, laid out on ${Math.round(gridBpm!)} BPM but started on ${Math.round(snapBpm!)}` : ''}`
            + `${tailClock.fit() === null ? ', position estimated' : ''}`,
        );

        // Announced from here rather than from the arm, the whole reason these lines are where they are:
        // `requestTransition` fires seconds early so the next track can load, and nothing at that point
        // knows how long the blend will be or whether there will be one. By here both are settled, and the
        // numbers below are the ones actually scheduled.
        //
        // Nothing is announced for a plan that fell back. A track dropped into the queue by hand arrives
        // with nothing measured about it, automix hands that change to the crossfade planner, and what
        // plays is a crossfade - so anything on screen claiming a mix is happening would describe a
        // transition that is not the one being heard.
        //
        // `hold` folded into the length rather than reported beside it: the two are one span from the
        // screen's side, so the crossover is re-expressed against that same span instead of leaving a
        // fraction that means something different from the number next to it. Divided by `applied` for the
        // same reason `wall` is - a bent outgoing track counts beats faster than its own tempo says, and a
        // pulse on the untouched period would drift across the window.
        if (!plan.fellBack) {
            announceTransition({
                seconds: hold + wall,
                crossover: hold + wall > 0 ? (hold + wall * shape.crossover) / (hold + wall) : 0,
                periodSec: periodSec === null ? null : periodSec / applied,
            });
        }

        if (stemmed) {
            cleanupTimer = setTimeout(
                () => settle({ pauseTail: true }),
                (hold + wall) * 1000 + FADE_CLEANUP_MARGIN_MS,
            );
            return;
        }

        if (shape.shapeBands) {
            scheduleBandBlend(context, tailChain.tone, activeChain.tone, startAt, wall, {
                crossover: shape.crossover,
                swapBass: true,
                sweepOut: shape.sweepOut,
                tiltDb: plan.tiltDb,
            });
        }
        if (plan.echoThrow) {
            // A cut goes at the start of its own 40ms; an overlap goes where the two change places,
            // which is the moment the outgoing track stops being the one being listened to.
            scheduleEchoThrow(
                context,
                tailChain.throw,
                startAt + (shape.style === 'beatCut' ? 0 : wall * shape.crossover),
                periodSec,
            );
        }
        scheduleCrossfade(
            context, tailChain.fade, activeChain.fade, wall, shape.crossover, hold, shape.together,
        );
        // Only where there is an overlap to balance. Across a splice or a cut the two tracks are
        // never both audible, so pulling one down would just be a level step nobody asked for.
        if (shape.overlap >= AUTOMIX_MIN_OVERLAP_SEC) {
            startBalanceCorrection(
                context, tailChain, activeChain, referenceDb(plannedTo, activeChain),
            );
        }

        cleanupTimer = setTimeout(
            () => settle({ pauseTail: true }),
            (hold + wall) * 1000 + FADE_CLEANUP_MARGIN_MS,
        );
    };

    /** The non-active deck reached its end, or failed to load. */
    const handleTailEnded = () => {
        // Outside a transition the non-active deck is not a tail at all - it is the idle deck, holding the
        // next track's source so it can buffer ahead. If that source fails to load there is no transition
        // to end, and settling one that was never started would pause a deck and fire the stall check for
        // nothing.
        if (phase === 'idle') return;

        // Mid-blend this is just the outgoing track running out on schedule. Leave it to the scheduled
        // ramp, which still owns the incoming deck's fade-in; resetting gains here would jump that fade to
        // full a fraction early.
        if (phase === 'fading') return;

        // Still armed means the outgoing track ran out before the next one managed to make a sound - a slow
        // URL resolve, a cold buffer. There is no blend left to have, but the deck loading the next track
        // keeps the role: it is where audioSrc is already headed and the only element anything will press
        // play on.
        settle({ pauseTail: false });
    };

    /**
     * The app committed to a track this transition is not about - someone skipped, mid-blend.
     *
     * A transition owns two decks for as long as it lasts, and only one is the one the rest of the app can
     * see. Pick a different song while the two are overlapping and the active deck takes the new source,
     * as it should - while the other plays on with its scheduled fade still running, because nothing was
     * watching for this. The listener hears the track they chose underneath the tail of a track they
     * skipped away from, and no control on screen points at the second one.
     *
     * `handleActiveDeckPlaying` already refuses a blend whose queue moved, but only once, at the moment
     * the incoming deck starts. This is the same check for the rest of the blend, where a listener
     * actually does the skipping.
     *
     * The incoming key always passes - that advance is this transition's own doing. The OUTGOING key
     * passes only while armed, and the asymmetry is the point: until the advance commits, the app is still
     * legitimately showing the track that is finishing. Once the incoming deck is sounding, seeing the
     * outgoing track's key again means a listener asked for it back, and that is worse than an ordinary
     * skip - the app's source then matches the source pinned to the OTHER deck, `resolveDeckSrc` has
     * nothing distinct left to give the active one, and a media element handed an empty source raises an
     * error the listener sees as a failed track.
     */
    const handleSongChanged = (key: string | null): void => {
        if (phase === 'idle' || key === plannedNextKey) return;
        if (phase === 'armed' && key === plannedFromKey) return;
        console.log(`[Automix] transition dropped: the queue moved to "${key}" mid-blend`);
        diagMark(`dropped -> ${key}`);
        settle({ pauseTail: true });
    };

    /**
     * Any pause, from the UI, a media key or the OS.
     *
     * Returns true when it interrupted an armed transition, which the caller has to act on: the
     * early advance is already in flight and cannot be recalled, so without suppressing its
     * autoplay the listener would press pause and hear the next song start anyway.
     */
    const abort = (keepTail = false): boolean => {
        if (phase === 'idle') return false;
        const wasArmed = phase === 'armed';
        if (keepTail) {
            // Cancel the blend back onto the OUTGOING deck instead of the incoming one. Making the
            // deck that is fading out the active deck flips what `settle` treats as the tail, so it
            // pauses the incoming deck and leaves the outgoing one playing - the track the listener
            // was hearing, already loaded, keeps sounding with nothing reloaded. `harvest: false`
            // because nothing here played out; the deck now in the tail role is the INCOMING one,
            // and recording it would file away a track that never actually played.
            const outgoing = otherDeck(activeDeck);
            activeDeck = outgoing;
            ports.onActiveDeckChange(outgoing);
            settle({ pauseTail: true, harvest: false });
            return wasArmed;
        }
        settle({ pauseTail: true });
        return wasArmed;
    };

    return {
        getActiveDeck: () => activeDeck,
        getPhase: () => phase,
        sampleDecks,
        requestTransition,
        handleActiveDeckPlaying,
        handleTailEnded,
        handleSongChanged,
        abort,
        /**
         * Tear the session down to a defined state. More than the timers: a transition in flight holds
         * stem chains, a stem bus, an expansion stopper, an autoplay hold and two attenuated decks, and
         * none of those is a timer - so a dispose mid-blend used to leave buffers playing to their end
         * and the decks at the wrong gain. `settle` stops all of it. When idle there is nothing running
         * and settle would only fire spurious state updates (it drives onTailSrcChange), so the timers
         * are the whole of the work then.
         */
        dispose: () => { if (phase === 'idle') clearTimers(); else settle({ pauseTail: true }); },
    };
};

export type AutomixSession = ReturnType<typeof createAutomixSession>;
