import { createDeckAnalyser, type DeckAnalyser } from './deckAnalyser';
import {
    buildBandCurves,
    buildCrossfadeCurves,
    dbToGain,
    type BandBlendRequest,
    TONE_EDGE_HZ,
    TONE_MID_HZ,
} from './signalAnalysis';
import { STEM_NAMES, type StemName, type TrackStems } from './stems';
import { OTHER_SWEEP_END, OTHER_SWEEP_HZ } from './stemGesture';

// src/services/automix/crossfadeGraph.ts
// The Web Audio half of automix: two identical deck chains feeding one mix point, and the ramp
// that hands loudness from one to the other. No React, no DOM queries.

/** The three filters that give each region of the spectrum its own seam. All flat at rest. */
export interface AutomixToneStack {
    /** Low shelf at TONE_EDGE_HZ[0]. Owns the region an overlap goes muddy in. */
    low: BiquadFilterNode;
    /** Bell over the middle. Where both tracks stay recognisable; touched only by the tone match. */
    mid: BiquadFilterNode;
    /** High shelf at TONE_EDGE_HZ[1]. The outgoing track loses this on its way out. */
    high: BiquadFilterNode;
}

/** A short delay the outgoing track can be thrown into so a cut scatters instead of stopping. */
export interface AutomixThrow {
    send: GainNode;
    delay: DelayNode;
    feedback: GainNode;
}

export interface AutomixDeckChain {
    source: MediaElementAudioSourceNode;
    /** Per-track loudness compensation from the track's own metadata. Owned by the audio bridge. */
    replayGain: GainNode;
    /** Balance correction applied to the outgoing deck for the length of one blend. */
    trim: GainNode;
    /** Per-band shaping, so a handover is not one gain curve for the whole spectrum. */
    tone: AutomixToneStack;
    /** The 0..1 crossfade envelope. The only node a scheduled blend automates end to end. */
    fade: GainNode;
    /** The echo throw. Silent unless a transition asks for it. */
    throw: AutomixThrow;
    /** Measures this deck ahead of the fade, so it reads the track and not the blend. */
    analyser: DeckAnalyser;
    /** The shared mix point. Kept so a stem window can be wired in past this deck's own fade. */
    output: AudioNode;
}

/**
 * Bell width for the middle band.
 *
 * Wide - a Q under one spans well over two octaves - because this is not an equaliser correcting a
 * resonance, it is a tone control asked to lean a whole master slightly one way. A narrow bell
 * would be audible as a filter rather than as a difference in character.
 */
const MID_BELL_Q = 0.8;

/** Longest a scheduled band curve is allowed to still be running once its deck is alone. */
const TONE_RESET_SEC = 0.12;
/**
 * How far past a curve's end its reset is scheduled.
 *
 * Two render quanta at 48kHz. The engine's clock only moves in quanta, so a `currentTime` read just
 * before a curve is inserted can be one behind the one the engine compares against - and the tail
 * of a curve is not a boundary that forgives being crossed.
 */
const CURVE_TAIL_GUARD_SEC = 0.006;

/**
 * How long the thrown echo takes to repeat, when there is no tempo to derive it from.
 *
 * An eighth note at 120, which is the tempo nothing in a library is far from. With a tempo it is
 * derived instead, because an echo that repeats off the grid is heard as a fault rather than as an
 * effect.
 */
const DEFAULT_THROW_DELAY_SEC = 0.25;
/** How much of each repeat survives into the next. Four or five audible repeats, then gone. */
const THROW_FEEDBACK = 0.45;
/** How much of the outgoing track is fed in at the moment of the throw. */
const THROW_SEND = 0.6;
/** How long the send takes to open. Long enough not to click, short enough to be one gesture. */
const THROW_OPEN_SEC = 0.15;

/**
 * Wires one deck into the shared mix point.
 *
 * Gain is split across three nodes rather than one because three authorities set it on different
 * timescales - the track's ReplayGain metadata, the blend's balance correction, and the crossfade
 * curve - and a running setValueCurveAtTime owns its parameter outright: anything else writing to the
 * same param during a blend throws, and folding them together would let a discrete gain change scale
 * the curve.
 *
 * The three tone filters sit between the trim and the fade and are exactly transparent at rest: a
 * shelf or bell at 0dB reduces to unity, not an approximation of it - which matters because this chain
 * carries every second of playback, not only the transitions.
 */
export const connectAutomixDeck = (
    context: AudioContext,
    element: HTMLAudioElement,
    output: AudioNode,
): AutomixDeckChain => {
    const source = context.createMediaElementSource(element);
    const replayGain = context.createGain();
    const trim = context.createGain();
    const fade = context.createGain();

    const band = (type: BiquadFilterType, frequency: number, q?: number) => {
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.gain.value = 0;
        if (q !== undefined) filter.Q.value = q;
        return filter;
    };
    const tone: AutomixToneStack = {
        low: band('lowshelf', TONE_EDGE_HZ[0]),
        mid: band('peaking', TONE_MID_HZ, MID_BELL_Q),
        high: band('highshelf', TONE_EDGE_HZ[1]),
    };

    source.connect(replayGain).connect(trim)
        .connect(tone.low).connect(tone.mid).connect(tone.high)
        .connect(fade).connect(output);

    // Fed from BEFORE the fade on purpose. The whole point of a throw is that the outgoing track
    // scatters instead of stopping, so what is thrown has to survive the curve that is removing it.
    const send = context.createGain();
    send.gain.value = 0;
    const delay = context.createDelay(2);
    delay.delayTime.value = DEFAULT_THROW_DELAY_SEC;
    const feedback = context.createGain();
    feedback.gain.value = THROW_FEEDBACK;
    tone.high.connect(send).connect(delay).connect(output);
    delay.connect(feedback).connect(delay);

    // Tapped off replayGain: the reading has to include the track's own loudness compensation and
    // exclude our trim, or the balance correction would be measuring its own effect.
    return {
        source,
        replayGain,
        trim,
        tone,
        fade,
        throw: { send, delay, feedback },
        analyser: createDeckAnalyser(context, replayGain, output),
        output,
    };
};

/**
 * Clears a parameter's schedule, including a curve that is already running.
 *
 * `cancelScheduledValues` only removes events that have not STARTED. A setValueCurveAtTime part way
 * through survives it, and the next write inside that curve's span is a NotSupportedError - thrown from
 * settle, the one path every ending shares. `cancelAndHoldAtTime` truncates the curve and holds its
 * current value, exactly what a cancelled blend wants; the fallback is only for engines that predate it.
 */
const releaseParam = (param: AudioParam, now: number) => {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
};

/** Moves a gain to a value, instantly when seconds is 0 and over a short ramp otherwise. */
export const rampGain = (context: AudioContext, gain: GainNode, value: number, seconds = 0) => {
    const now = context.currentTime;
    releaseParam(gain.gain, now);
    if (seconds <= 0) {
        gain.gain.setValueAtTime(value, now);
        return;
    }
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(value, now + seconds);
};

/** Same as rampGain, in the unit the balance correction is actually reasoning in. */
export const rampGainDb = (context: AudioContext, gain: GainNode, db: number, seconds: number) =>
    rampGain(context, gain, dbToGain(db), seconds);

/**
 * Puts a deck's tone back where it belongs. Runs on every settle, like the trim does.
 *
 * All three bands together, because a deck left with its low end twenty-four decibels down is a
 * deck that plays the next track with no bass in it - the same class of failure as a deck left at
 * zero gain, and just as impossible for a listener to work around.
 */
export const resetTone = (context: AudioContext, tone: AutomixToneStack, seconds = 0.05) => {
    const now = context.currentTime;
    const span = Math.max(0.01, seconds);
    ([tone.low, tone.mid, tone.high]).forEach(filter => {
        releaseParam(filter.gain, now);
        filter.gain.setValueAtTime(filter.gain.value, now);
        filter.gain.linearRampToValueAtTime(0, now + span);
    });
};

/** Shuts the throw off. The delay line's own feedback lets whatever is in it ring out. */
export const resetThrow = (context: AudioContext, send: AutomixThrow, seconds = 0.05) =>
    rampGain(context, send.send, 0, seconds);

/**
 * Gives each region of the spectrum its own seam across one blend.
 *
 * This replaced sweeping a high-pass across the incoming deck. The filter version could only answer one
 * question - who owns the bass - and answered it by removing a band outright. Three curves answer
 * three: who owns the bass, how the departing track is taken out of the way, and how far the arriving
 * one bends towards the departing one's character on the way in. All three run on the audio clock as
 * curves, so a busy main thread cannot dent them, and all three are relative to the overall gain
 * envelope rather than replacing it.
 */
export const scheduleBandBlend = (
    context: AudioContext,
    outgoing: AutomixToneStack,
    incoming: AutomixToneStack,
    startAt: number,
    seconds: number,
    request: BandBlendRequest,
): boolean => {
    const curves = buildBandCurves(request);
    const bands = (stack: AutomixToneStack) => [stack.low, stack.mid, stack.high];
    // A curve asked to start in the past does not start in the past. The engine slides it forward to
    // `currentTime` and keeps its full duration, so it ENDS later than the arithmetic says - and an
    // event placed at `startAt + seconds` then lands INSIDE the running curve, which the engine refuses
    // outright rather than nudging. The whole three-band shaping is lost with it.
    //
    // Two render quanta of main-thread lateness was all it took, measured off a real log: the curve came
    // back reported at a start 5.33ms after the one asked for. A blend running late is not a rare
    // accident - it is the blend that was already short of time, which is why the log line sits directly
    // under "the next deck took more than its 1s of lead to start".
    //
    // Anchoring everything on the clamped start is the same move `scheduleEchoThrow` makes with `opensAt`.
    const begins = Math.max(startAt, context.currentTime);
    // Past the end rather than on it, because the clock ticks in quanta: the `currentTime` read here
    // can be one quantum behind the one the engine clamps against a microsecond later, and a curve's
    // end is a boundary where being on the wrong side is refused rather than rounded. The param
    // spends the guard holding the value the curve left it at, so it costs nothing audible.
    const resetAt = begins + seconds + CURVE_TAIL_GUARD_SEC;
    try {
        ([[bands(outgoing), curves.out], [bands(incoming), curves.in]] as const).forEach(
            ([filters, shapes]) => filters.forEach((filter, band) => {
                // No event AT the start ahead of the curve: the engine refuses a curve that overlaps
                // any other automation, and that includes its own first instant. The curve's first
                // value lands there of its own accord.
                filter.gain.cancelScheduledValues(begins);
                filter.gain.setValueCurveAtTime(shapes[band], begins, seconds);
                // Explicitly back to flat straight after the curve. A setValueCurveAtTime leaves
                // the param at its last value forever, and "forever" here is the next track.
                filter.gain.setValueAtTime(shapes[band][shapes[band].length - 1], resetAt);
                filter.gain.linearRampToValueAtTime(0, resetAt + TONE_RESET_SEC);
            }),
        );
        return true;
    } catch (error) {
        // Band shaping is an improvement on a crossfade, not a precondition for one. Both stacks go
        // back to flat and the gain curve carries the transition on its own.
        console.warn('[Automix] band shaping rejected by the audio engine, blending flat', error);
        resetTone(context, outgoing, 0.05);
        resetTone(context, incoming, 0.05);
        return false;
    }
};

/**
 * Throws the outgoing track into a short delay just before it is taken away.
 *
 * The one thing that makes a cut sound like a decision rather than a fault. A track that simply stops
 * has an edge on it; a track thrown into a delay carries on scattering after it is gone, and the
 * incoming one arrives into that instead of into a hole. The single most recognisable move a human DJ
 * makes, and it needs no analysis of either track - only a beat length, so the repeats land on the grid
 * rather than across it.
 *
 * The send is opened, not the delay: the line is always connected and always silent, so nothing is
 * created or routed at the moment it is needed.
 */
export const scheduleEchoThrow = (
    context: AudioContext,
    node: AutomixThrow,
    /** When the track is taken away. The throw opens just before it. */
    at: number,
    /** Beat period of the outgoing track, for the repeat length. Null falls back to an eighth at 120. */
    periodSec: number | null,
): void => {
    const repeat = periodSec && periodSec > 0
        ? Math.min(1, Math.max(0.08, periodSec / 2))
        : DEFAULT_THROW_DELAY_SEC;
    const opensAt = Math.max(context.currentTime, at - THROW_OPEN_SEC);

    try {
        node.delay.delayTime.cancelScheduledValues(opensAt);
        node.delay.delayTime.setValueAtTime(repeat, opensAt);
        node.send.gain.cancelScheduledValues(opensAt);
        node.send.gain.setValueAtTime(0, opensAt);
        node.send.gain.linearRampToValueAtTime(THROW_SEND, Math.max(opensAt + 0.001, at));
        // Shut again the moment the track goes: what is already in the line keeps repeating, which
        // is the effect. Leaving the send open would feed it the silence of a paused deck instead.
        node.send.gain.setValueAtTime(THROW_SEND, Math.max(opensAt + 0.001, at));
        node.send.gain.linearRampToValueAtTime(0, Math.max(opensAt + 0.001, at) + 0.03);
    } catch (error) {
        console.warn('[Automix] the echo throw was refused, cutting dry instead', error);
        node.send.gain.value = 0;
    }
};

/**
 * How long the deck takes to change over between its media element and its stems.
 *
 * Eight milliseconds, from a measurement not a feel. Chromium aligns an AudioBufferSourceNode to a
 * MediaElementAudioSourceNode EXACTLY when the file is uncompressed: a phase-inverted buffer scheduled
 * from `element.currentTime` nulled the element to the meter floor, -222 dB, with no drift over nine
 * seconds. On a lossy file the same test came back at +3.8 dB - no cancellation at all - because
 * `currentTime` on a compressed stream is quantised to the codec's frames and lands the buffer up to a
 * frame out.
 *
 * So the changeover cannot assume alignment. Eight milliseconds is short enough that a misaligned splice
 * is a few milliseconds of comb filtering rather than an audible phase artefact, and long enough that a
 * perfectly aligned one - a FLAC or WAV library - has no step in it. A hard cut would be exact in the
 * first case and a click in the second.
 */
const SPLICE_SEC = 0.008;

/**
 * Where the soft limiter stops being a straight line, and how far past full scale it can see.
 *
 * 0.95 is -0.45 dBFS: a master that fits inside full scale passes through all but untouched, and the
 * shaping is spent on what does not fit. 4 is +12 dB of visible range, well past anything two records
 * have been measured to reach together; beyond it a WaveShaper clamps to the end of its curve, the hard
 * clip this exists to avoid.
 */
const LIMIT_KNEE = 0.95;
const LIMIT_RANGE = 4;

/**
 * The transfer curve the two stem chains are summed through. Straight line, then a soft knee.
 *
 * The gesture REPLACES the master crossfade, and the allowance that keeps a blend under full scale
 * lived inside the crossfade it replaced. Two 0 dBFS masters handed over stem by stem were measured
 * summing to +3.4 dBFS with 1445 samples hard-clipped at the destination; where either had headroom the
 * same gesture peaked at -0.75, which is why nothing constant is right either.
 *
 * This replaces a measured, time-varying attenuation over the whole pair, for arithmetic reasons not
 * taste. That correction was driven by the loudest SAMPLE in each 50ms cell and spread over 400ms
 * either side, so on the pair above it pulled every sample down by about four decibels to keep 1445 of
 * them legal - a tenth of a percent of the window, protected by moving all of it. Four decibels through
 * the middle of a transition is audible, and was reported as the transition ducking. A memoryless curve
 * touches only the samples actually over, leaves the level alone, and needs nothing measured, no
 * threshold, no pair refused.
 *
 * `tanh` above the knee because it is smooth where it joins the line (no corner for a transient to find)
 * and asymptotic to 1 (no input, however far over, can reach full scale). Below the knee it is the
 * identity, exactly - a WaveShaper interpolates linearly between curve points, so a straight segment
 * comes back out straight, and the majority of every window passes through unchanged.
 */
export const softLimit = (x: number): number => {
    const level = x < 0 ? -x : x;
    if (level <= LIMIT_KNEE) return x;
    const room = 1 - LIMIT_KNEE;
    const held = LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room);
    return x < 0 ? -held : held;
};

/** The point both stem chains sum at, and the only thing between them and the mix. */
export interface AutomixStemBus {
    input: GainNode;
    stop: () => void;
}

/**
 * The shared bus, built per transition and thrown away with it.
 *
 * Per transition rather than permanently in the mix, because the sum of two decks is the only thing
 * that overshoots: one master on its own is under full scale by definition, and a curve in its path for
 * the other 99% of playback would be a nonlinearity nobody asked for.
 *
 * The pre-gain is what makes the shaper usable at all: its curve is indexed over an input of [-1, 1] and
 * CLAMPS outside that, so a sum at +3.4 dBFS would hit the end of the table and be hard-clipped by the
 * very node meant to prevent it. Scaling by 1/LIMIT_RANGE going in, with a curve written in the same
 * units coming out, is the standard way round that.
 */
export const connectStemBus = (context: AudioContext, output: AudioNode): AutomixStemBus => {
    const points = 8192;
    const curve = new Float32Array(points);
    for (let i = 0; i < points; i += 1) {
        curve[i] = softLimit(((i / (points - 1)) * 2 - 1) * LIMIT_RANGE);
    }
    const shaper = context.createWaveShaper();
    shaper.curve = curve;
    // Memoryless on purpose. Oversampling resamples EVERYTHING passing through, including the
    // straight-line region that is most of every window and has to stay exactly straight.
    shaper.oversample = 'none';
    const input = context.createGain();
    input.gain.value = 1 / LIMIT_RANGE;
    input.connect(shaper).connect(output);
    return {
        input,
        stop: () => {
            input.disconnect();
            shaper.disconnect();
        },
    };
};

/** One deck's stems, wired and ready to be scheduled. Built per transition and thrown away. */
export interface AutomixStemChain {
    sources: Record<StemName, AudioBufferSourceNode>;
    gains: Record<StemName, GainNode>;
    /** The high-pass that thins the outgoing pad bed. Flat (25Hz) unless a sweep is scheduled. */
    sweep: BiquadFilterNode;
    /** The changeover gain: 0 while the element owns this deck, 1 while the stems do. */
    output: GainNode;
    stop: () => void;
}

/**
 * Wires one deck's four stems into the same mix point its element feeds.
 *
 * Every source is started at ONE absolute time, which is what makes the four exactly aligned with each
 * other - `start(when, offset)` is sample-accurate by specification, and they came from one decode. The
 * alignment that is not guaranteed is against the element, which is what SPLICE_SEC is for.
 *
 * Wired into the shared mix point, PAST this deck's own fade, trim and tone stack. It has to be: the
 * changeover ramps that fade to zero, so anything hanging off it would go with the element. The
 * equaliser and analyser sit downstream of the mix point and still apply, which keeps a stem transition
 * sounding like the same player rather than a different one.
 */
export const connectStemDeck = (
    context: AudioContext,
    stems: TrackStems,
    output: AudioNode,
    /** Media time the window should start playing from. */
    fromMediaTime: number,
    /** Absolute context time to start at. */
    startAt: number,
    /**
     * Whether this deck's pad bed is routed through the sweep filter.
     *
     * Only the OUTGOING deck's is. The filter is a high-pass, and one sitting at 25Hz is not
     * transparent - it would quietly thin the sub-bass out of the arriving track for the whole
     * window, which is a change nobody asked for on the side that is not being swept.
     */
    sweepPad: boolean,
): AutomixStemChain => {
    const gains = {} as Record<StemName, GainNode>;
    const sources = {} as Record<StemName, AudioBufferSourceNode>;
    const changeover = context.createGain();
    changeover.gain.value = 0;
    changeover.connect(output);

    const sweep = context.createBiquadFilter();
    sweep.type = 'highpass';
    sweep.frequency.value = OTHER_SWEEP_HZ[0];
    sweep.Q.value = 0.7;
    sweep.connect(changeover);

    const offset = Math.max(0, fromMediaTime - stems.from);
    const begins = Math.max(context.currentTime, startAt);
    for (const name of STEM_NAMES) {
        const gain = context.createGain();
        const source = context.createBufferSource();
        source.buffer = stems.buffers[name];
        source.connect(gain);
        // Only the pad bed goes through the sweep, and only on the deck being swept; sending the
        // others through a filter that is flat at rest would still cost four biquads on every
        // sample of the window.
        gain.connect(sweepPad && name === 'other' ? sweep : changeover);
        source.start(begins, offset);
        gains[name] = gain;
        sources[name] = source;
    }

    return {
        sources,
        gains,
        sweep,
        output: changeover,
        stop: () => {
            for (const name of STEM_NAMES) {
                try { sources[name].stop(); } catch { /* already stopped */ }
                sources[name].disconnect();
                gains[name].disconnect();
            }
            sweep.disconnect();
            changeover.disconnect();
        },
    };
};

/**
 * Plays performance mode's pre-rendered build into the same mix point the stems use.
 *
 * One ordinary source at rate 1.0 - all the stuttering, the rise and the reverse are already in the
 * samples (see expansionGesture). That is what keeps this additive: nothing here can perturb the
 * four stems' timing, because it never touches them. Fails soft, like everything else on this path;
 * a build that could not be scheduled leaves a transition that is merely the shipped one.
 */
export const connectExpansion = (
    context: AudioContext,
    channels: readonly Float32Array[],
    sampleRate: number,
    output: AudioNode,
    startAt: number,
    /** The outgoing deck's loudness compensation, which this sits downstream of - see the stems. */
    level: number,
): (() => void) | null => {
    if (channels.length === 0 || channels[0].length === 0) return null;
    try {
        const buffer = context.createBuffer(channels.length, channels[0].length, sampleRate);
        for (let channel = 0; channel < channels.length; channel += 1) {
            buffer.getChannelData(channel).set(channels[channel]);
        }
        const gain = context.createGain();
        gain.gain.value = level;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain).connect(output);
        source.start(Math.max(context.currentTime, startAt));
        return () => {
            try { source.stop(); } catch { /* already stopped */ }
            source.disconnect();
            gain.disconnect();
        };
    } catch {
        return null;
    }
};

/**
 * Runs one window of the stem gesture on the audio clock.
 *
 * All four curves plus the changeover go in as scheduled automation, for the same reason the plain
 * crossfade does: a busy main thread must not be able to dent a gesture whose whole effect is in
 * its timing.
 *
 * Returns false having put the deck back into a defined state if the engine refused anything - a
 * stem gesture is an improvement on a crossfade, not a precondition for one.
 */
export const scheduleStemWindow = (
    context: AudioContext,
    chain: AutomixStemChain,
    curves: Record<StemName, Float32Array>,
    /** The deck's element gain, which hands over to the stems and may take them back. */
    element: GainNode,
    startAt: number,
    seconds: number,
    /** 'out' hands the element to the stems and stops there; 'in' hands them back at the end. */
    direction: 'out' | 'in',
): boolean => {
    const begins = Math.max(startAt, context.currentTime);
    const ends = begins + seconds;
    try {
        for (const name of STEM_NAMES) {
            const param = chain.gains[name].gain;
            param.cancelScheduledValues(begins);
            param.setValueCurveAtTime(curves[name], begins, seconds);
        }

        // The pad bed is thinned from below as it goes. Exponential because a linear sweep through
        // a decade of frequency spends almost all of its time at the top - the reference harness
        // sweeps f0 * (f1/f0)^t, which is exactly what exponentialRampToValueAtTime traces.
        if (direction === 'out') {
            chain.sweep.frequency.cancelScheduledValues(begins);
            chain.sweep.frequency.setValueAtTime(OTHER_SWEEP_HZ[0], begins);
            chain.sweep.frequency.exponentialRampToValueAtTime(
                OTHER_SWEEP_HZ[1],
                begins + seconds * OTHER_SWEEP_END,
            );
        }

        const changeover = chain.output.gain;
        changeover.cancelScheduledValues(begins);
        element.gain.cancelScheduledValues(begins);
        if (direction === 'out') {
            // The element owns the deck up to here and the stems own it afterwards. Equal power on
            // both sides so a perfectly aligned pair - which is what an uncompressed library gets -
            // passes through unity rather than dipping.
            changeover.setValueAtTime(0, begins);
            changeover.linearRampToValueAtTime(1, begins + SPLICE_SEC);
            element.gain.setValueAtTime(element.gain.value, begins);
            element.gain.linearRampToValueAtTime(0, begins + SPLICE_SEC);
        } else {
            // The incoming deck runs on stems for the window and on its own element afterwards,
            // because the stems only cover the window and the track carries on.
            changeover.setValueAtTime(0, context.currentTime);
            changeover.setValueAtTime(1, begins);
            changeover.setValueAtTime(1, ends - SPLICE_SEC);
            changeover.linearRampToValueAtTime(0, ends);
            // Silenced NOW rather than at `begins`, the same thing scheduleCrossfade does with its
            // `hold` and for the same reason: this deck is already playing by the time anything is
            // scheduled - that is what triggered it - and the window can be up to a second away. Muting
            // only at the window start plays the next track at full level over the end of the current
            // one for that whole second.
            element.gain.setValueAtTime(0, context.currentTime);
            element.gain.setValueAtTime(0, ends - SPLICE_SEC);
            element.gain.linearRampToValueAtTime(1, ends);
        }
        return true;
    } catch (error) {
        console.warn('[Automix] the stem gesture was refused, using the plain crossfade', error);
        chain.stop();
        rampGain(context, element, direction === 'out' ? 0 : 1, 0.05);
        return false;
    }
};

/**
 * Schedules both halves of one blend on the audio clock.
 *
 * Scheduled rather than driven from rAF: the ramp runs at audio rate inside the rendering thread, so a
 * dropped frame or busy main thread cannot dent the envelope. The crossover moves where the two tracks
 * change places without touching that guarantee - the curves are built before handover and nothing
 * rewrites them once running.
 *
 * `hold` is how long the incoming deck stays silent first, and is what makes a cut a cut: the incoming
 * deck cannot be told when to start - it starts when the media element manages to - so placing a
 * handover anywhere other than "right now" means letting it run muted until the moment arrives. Zero
 * for an ordinary crossfade.
 *
 * Returns false if the engine rejected the curves, having first put both decks back into a defined
 * state - a blend is optional, but audio stuck at zero gain is not recoverable.
 */
export const scheduleCrossfade = (
    context: AudioContext,
    outgoing: GainNode,
    incoming: GainNode,
    seconds: number,
    crossover = 0.5,
    hold = 0,
    /** Fraction of the blend both tracks stay held at level. 0 is a plain crossfade. */
    together = 0,
): boolean => {
    const curves = buildCrossfadeCurves(crossover, together);
    const now = context.currentTime;
    const startAt = now + Math.max(0, hold);
    try {
        outgoing.gain.cancelScheduledValues(now);
        incoming.gain.cancelScheduledValues(now);
        if (hold > 0) {
            outgoing.gain.setValueAtTime(1, now);
            incoming.gain.setValueAtTime(0, now);
        }
        outgoing.gain.setValueCurveAtTime(curves.out, startAt, seconds);
        incoming.gain.setValueCurveAtTime(curves.in, startAt, seconds);
        return true;
    } catch (error) {
        console.warn('[Automix] Crossfade rejected by the audio engine, cutting instead', error);
        rampGain(context, outgoing, 0, 0.05);
        rampGain(context, incoming, 1, 0.05);
        return false;
    }
};
