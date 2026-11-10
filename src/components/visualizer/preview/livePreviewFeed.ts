import { motionValue, type MotionValue } from 'framer-motion';
import type { LyricData } from '../../../types';
import { HELD_TIME_STEP, valuesOf, type ClockValues } from './usePreviewClock';

// src/components/visualizer/preview/livePreviewFeed.ts
// What a lyric preview draws in its "live" source: the song the player is showing now, instead of
// the sample song built into the window. This file is the part that does not know React or the
// player's stores, so it can be tested alone: a source says what the player shows, and the feed
// keeps a copy of it that the preview can hold still.
//
// The preview follows the player while it runs. While it is paused it holds the picture of the
// moment it was paused: nothing is subscribed, so a song change, or lyrics arriving in the several
// writes a song change is made of, cannot change what is held. A style that is mounted while the
// time stands still (a held picture, or a player that is itself paused) has no change of time to
// tell it where it is, so the time is stirred for a short while (see createTimePulse).

export type LivePreviewContent = {
    lines: LyricData['lines'];
    /** Seconds; 0 when the player does not know it. */
    duration: number;
    songTitle?: string;
    coverUrl?: string | null;
    currentLineIndex: number;
    /** One per song, as the player's seed is, so a style tells a new song from the same one. */
    seed: string;
};

export type LivePreviewSource = {
    /** What the player shows now, or null while it has no lyric lines to draw. */
    read: () => LivePreviewContent | null;
    /** Calls `listener` whenever what `read` returns may have changed; returns the way to stop. */
    subscribe: (listener: () => void) => () => void;
    /** The player's own signals: the lyric clock and the audio levels. */
    signals: ClockValues;
    /** Media position, before lyric offsets and preview clip starts are applied. */
    playbackTime: MotionValue<number>;
};

export type LivePreviewScheduler = {
    now: () => number;
    requestFrame: (callback: () => void) => number;
    cancelFrame: (handle: number) => void;
};

const browserScheduler: LivePreviewScheduler = {
    now: () => performance.now(),
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: handle => window.cancelAnimationFrame(handle),
};

/** How long a still picture is stirred after it is held, and after something is mounted in it. */
export const PULSE_MS = 1500;

/** The player's clock counts as standing still after this long without a change. */
const STILL_MS = 250;

/**
 * Stirs a clock that stands still: for PULSE_MS the time steps back and forth by a hair, once a
 * frame, and it ends on the time `base` gives. A word whose edge lies on that time changes its mind
 * only within the pulse; afterwards its state is the one the time says.
 */
export const createTimePulse = (time: MotionValue<number>, scheduler: LivePreviewScheduler = browserScheduler) => {
    let frame: number | null = null;
    const stop = () => {
        if (frame !== null) scheduler.cancelFrame(frame);
        frame = null;
    };
    return {
        running: () => frame !== null,
        stop,
        start: (base: () => number) => {
            stop();
            const end = scheduler.now() + PULSE_MS;
            let odd = false;
            const step = () => {
                if (scheduler.now() >= end) {
                    frame = null;
                    time.set(base());
                    return;
                }
                odd = !odd;
                time.set(odd ? base() + HELD_TIME_STEP : base());
                frame = scheduler.requestFrame(step);
            };
            step();
        },
    };
};

/**
 * The time a clock stands at while it is being stirred: it follows what is set to the clock from
 * outside (a sample that starts over with another style), told from the stirring's own steps by
 * being further off than they ever are.
 */
export const trackRestTime = (time: MotionValue<number>) => {
    let rest = time.get();
    const stop = time.on('change', (latest) => {
        if (Math.abs(latest - rest) > 2 * HELD_TIME_STEP) rest = latest;
    });
    return { get: () => rest, stop };
};

const sameContent = (a: LivePreviewContent | null, b: LivePreviewContent | null): boolean => (
    a === b
    || (a !== null && b !== null
        && a.lines === b.lines
        && a.duration === b.duration
        && a.songTitle === b.songTitle
        && a.coverUrl === b.coverUrl
        && a.currentLineIndex === b.currentLineIndex
        && a.seed === b.seed)
);

export const createLivePreviewFeed = (source: LivePreviewSource, scheduler: LivePreviewScheduler = browserScheduler) => {
    const { signals } = source;
    const sourceValues = valuesOf(signals);
    // The feed's own values, the same objects for its life, so a renderer never re-subscribes.
    const currentTime = motionValue(signals.currentTime.get());
    const playbackTime = motionValue(source.playbackTime.get());
    const audioPower = motionValue(signals.audioPower.get());
    const audioBands: ClockValues['audioBands'] = {
        bass: motionValue(signals.audioBands.bass.get()),
        lowMid: motionValue(signals.audioBands.lowMid.get()),
        mid: motionValue(signals.audioBands.mid.get()),
        vocal: motionValue(signals.audioBands.vocal.get()),
        treble: motionValue(signals.audioBands.treble.get()),
        spectrum: motionValue(signals.audioBands.spectrum?.get() ?? new Uint8Array(64)),
    };
    const ownValues = valuesOf({ currentTime, audioPower, audioBands });
    const pulse = createTimePulse(currentTime, scheduler);

    let content: LivePreviewContent | null = null;
    const listeners = new Set<() => void>();
    const setContent = (next: LivePreviewContent | null) => {
        if (sameContent(content, next)) return;
        content = next;
        listeners.forEach(listener => listener());
    };
    const copySignals = () => {
        ownValues.forEach((own, index) => own.set(sourceValues[index].get()));
        playbackTime.set(source.playbackTime.get());
    };

    // While attached: whether the picture is held, the time it stands at, and when the player's clock last moved.
    let attached = false;
    let held = false;
    let heldTime = 0;
    let lastSourceMove = Number.NEGATIVE_INFINITY;

    let detachCurrent: (() => void) | null = null;

    /**
     * Takes the player's picture now, then, when `follow`, keeps up with it; otherwise holds it.
     * Returns the way to stop. One attachment at a time: a new one ends the one before.
     */
    const attach = (follow: boolean): (() => void) => {
        detachCurrent?.();
        setContent(source.read());
        copySignals();
        attached = true;
        held = !follow;
        lastSourceMove = Number.NEGATIVE_INFINITY;
        const stops: Array<() => void> = [];
        if (follow) {
            stops.push(source.subscribe(() => setContent(source.read())));
            sourceValues.forEach((value, index) => stops.push(value.on('change', latest => ownValues[index].set(latest))));
            stops.push(source.playbackTime.on('change', latest => playbackTime.set(latest)));
            stops.push(signals.currentTime.on('change', () => { lastSourceMove = scheduler.now(); }));
        } else {
            heldTime = currentTime.get();
            pulse.start(() => heldTime);
        }
        const detach = () => {
            stops.forEach(stop => stop());
            pulse.stop();
            attached = false;
            held = false;
            if (detachCurrent === detach) detachCurrent = null;
        };
        detachCurrent = detach;
        return detach;
    };

    return {
        currentTime,
        playbackTime,
        audioPower,
        audioBands,
        getContent: () => content,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        attach,
        /** Whether a pulse is running. */
        pulsing: () => pulse.running(),
        /**
         * Stirs the time once more, for a style that has just been mounted: a held picture at the time it
         * is held at, a followed one at the player's time, and only while the player's clock stands still
         * (a moving one tells the style where it is). Not while a pulse is still running. The picture
         * itself is not taken again.
         */
        nudge: () => {
            if (!attached || pulse.running()) return;
            if (held) pulse.start(() => heldTime);
            else if (scheduler.now() - lastSourceMove > STILL_MS) pulse.start(() => signals.currentTime.get());
        },
        /** Forgets the picture, for a preview that is no longer live. */
        clear: () => setContent(null),
    };
};

export type LivePreviewFeed = ReturnType<typeof createLivePreviewFeed>;
