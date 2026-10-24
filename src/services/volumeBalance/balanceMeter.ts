import { ABSOLUTE_GATE_LUFS, gatedLoudness, kWeightStep, LUFS_OFFSET_DB } from '../automix/signalAnalysis';
import { LIVE_MIN_SOUND_SEC, PLAY_MISS_TOLERANCE_SEC, type BrokenPlay, type MeteredPlay } from './balanceRules';

// src/services/volumeBalance/balanceMeter.ts
// One BS.1770 meter per deck, tapped from the deck's source ahead of the song's balance gain, so it reads
// the song and not what the balance did to it. Left and right are kept apart, cut to the band the file
// measurement hears (its decode to 22.05 kHz drops what is above about 10 kHz), K-weighted with the same
// filter (kWeightStep) and gated the same way (gatedLoudness): on pink noise a reading learned from a
// whole play is within 0.1 dB of the file's. The peak is the full band's, at or above the file's. How long a
// play went and where it started and stopped are read off the media clock, so a stall or a bent tempo
// does not count as heard.

/**
 * How much audio each tap keeps, in seconds: a tick up to about 170 ms late, plus its own 25 ms period,
 * still finds every sample it has not read yet.
 */
const MIN_BUFFER_SEC = 0.2;

/**
 * Where the file measurement's band ends. Its decode to 22.05 kHz (decodeAtRate) low-passes near 10 kHz
 * on the way; without the same cut, a played reading came out 0.2 to 1 dB louder than the file's.
 */
const ANALYSIS_BAND_HZ = 10000;

/** A 4th-order Butterworth low-pass at ANALYSIS_BAND_HZ, running: each call takes the next sample. */
const bandStep = (sampleRate: number): ((x: number) => number) => {
    // A context running at 22.05 kHz or under is already cut there, as the decode is.
    if (ANALYSIS_BAND_HZ >= sampleRate * 0.45) return x => x;
    const stages = [0.5412, 1.3066].map((q) => {
        const w = (2 * Math.PI * ANALYSIS_BAND_HZ) / sampleRate;
        const cos = Math.cos(w);
        const a0 = 1 + Math.sin(w) / (2 * q);
        const b0 = (1 - cos) / 2 / a0;
        const a1 = (-2 * cos) / a0;
        const a2 = (1 - Math.sin(w) / (2 * q)) / a0;
        let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
        return (x: number) => {
            // b1 = 2 b0 and b2 = b0 for a low-pass.
            const y = b0 * (x + 2 * x1 + x2) - a1 * y1 - a2 * y2;
            x2 = x1; x1 = x; y2 = y1; y1 = y;
            return y;
        };
    });
    return x => stages[1](stages[0](x));
};

export interface BalanceMeter {
    /** Reads what the deck played since the last tick. Driven by the decks' sampler. */
    tick: (contextTime: number) => void;
    /** Media seconds this play has gone through, pauses and stalls left out. */
    heardSec: () => number;
    /** Counts the plays this deck has started (a new source, or a loop come round), so a reading taken before can be told apart. */
    plays: () => number;
    /** Counts the plays that ended by going from the end back to the start: a loop, or the song started over. */
    wraps: () => number;
    /** The loudness heard so far, once LIVE_MIN_SOUND_SEC of it was sound; null before. */
    liveLoudness: () => number | null;
    /** This play so far, or null before it sounded. */
    play: () => MeteredPlay | null;
}

type WrapListener = (meter: BalanceMeter, ended: MeteredPlay) => void;
const wrapListeners = new Set<WrapListener>();

/** Told when a deck went from the end of its song back to the start while playing: the play that ended, then a new one began. */
export const onPlayWrapped = (listener: WrapListener): (() => void) => {
    wrapListeners.add(listener);
    return () => { wrapListeners.delete(listener); };
};

export const createBalanceMeter = (
    context: AudioContext,
    source: AudioNode,
    sink: AudioNode,
    element: HTMLAudioElement,
): BalanceMeter => {
    // Two channels whatever the file has: a mono file reaches both, as the file measurement counts it.
    const stereo = context.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';
    const splitter = context.createChannelSplitter(2);
    const size = Math.min(32768, 2 ** Math.ceil(Math.log2(context.sampleRate * MIN_BUFFER_SEC)));
    // Out through a silent gain: an engine only renders what something downstream pulls on.
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(stereo).connect(splitter);
    const taps = [0, 1].map((channel) => {
        const tap = context.createAnalyser();
        tap.fftSize = size;
        tap.smoothingTimeConstant = 0;
        splitter.connect(tap, channel);
        tap.connect(silent);
        return tap;
    });
    silent.connect(sink);
    const buffers = taps.map(() => new Float32Array(size));
    const sampleRate = context.sampleRate;
    const stepLength = Math.round(sampleRate / 10);
    const audibleStep = 10 ** ((ABSOLUTE_GATE_LUFS - LUFS_OFFSET_DB) / 10);

    let weighLeft = kWeightStep(sampleRate);
    let weighRight = kWeightStep(sampleRate);
    let bandLeft = bandStep(sampleRate);
    let bandRight = bandStep(sampleRate);
    let steps: number[] = [];
    let power = 0;
    let filled = 0;
    let peak = 0;
    let heard = 0;
    let from: number | null = null;
    let to = 0;
    let audibleSteps = 0;
    let last: number | null = null;
    /** The media position at the last tick or seek; null until the next tick reads it. */
    let position: number | null = null;
    let broken: BrokenPlay | null = null;
    let plays = 0;
    let wraps = 0;

    const play = (): MeteredPlay | null => (heard > 0
        ? { loudness: gatedLoudness(steps), peak, heardSec: heard, fromSec: from ?? 0, toSec: to, broken }
        : null);

    // A new play; the old readings describe a play that is over.
    const reset = () => {
        weighLeft = kWeightStep(sampleRate);
        weighRight = kWeightStep(sampleRate);
        bandLeft = bandStep(sampleRate);
        bandRight = bandStep(sampleRate);
        steps = [];
        power = 0;
        filled = 0;
        peak = 0;
        heard = 0;
        from = null;
        to = 0;
        audibleSteps = 0;
        last = null;
        position = null;
        broken = null;
        plays += 1;
    };

    const meter: BalanceMeter = {
        tick: (contextTime: number) => {
            const at = element.currentTime;
            // A paused deck plays nothing; only the time it sounds is read.
            if (element.paused || last === null || position === null) {
                last = contextTime;
                position = at;
                return;
            }
            // ponytail: the sample count comes from the audio clock read on this thread, which can be a render
            // quantum off now and then; exact would be an AudioWorklet, not worth it for a level over minutes.
            const fresh = Math.round((contextTime - last) * sampleRate);
            last = contextTime;
            // Heard is how far the media went: a stall moves it nowhere, a bent tempo by what was played.
            const advanced = at - position;
            if (advanced > 0) {
                from ??= position;
                to = at;
                heard += advanced;
            }
            position = at;
            if (fresh <= 0) return;
            if (fresh > size) broken ??= 'gap';
            const take = Math.min(fresh, size);
            taps.forEach((tap, channel) => tap.getFloatTimeDomainData(buffers[channel]));
            const [left, right] = buffers;
            for (let index = size - take; index < size; index += 1) {
                const l = left[index];
                const r = right[index];
                peak = Math.max(peak, Math.abs(l), Math.abs(r));
                const wl = weighLeft(bandLeft(l));
                const wr = weighRight(bandRight(r));
                power += wl * wl + wr * wr;
                filled += 1;
                if (filled === stepLength) {
                    const step = power / stepLength;
                    steps.push(step);
                    if (step > audibleStep) audibleSteps += 1;
                    power = 0;
                    filled = 0;
                }
            }
        },
        heardSec: () => heard,
        plays: () => plays,
        wraps: () => wraps,
        liveLoudness: () => (audibleSteps / 10 >= LIVE_MIN_SOUND_SEC ? gatedLoudness(steps) : null),
        play,
    };

    element.addEventListener('loadstart', reset);
    element.addEventListener('seeking', () => {
        const at = element.currentTime;
        // From the end back to the start while playing: a loop come round (no 'ended' fires for it), or
        // the song started over. The play that ended is handed on whole, and the next one is metered anew.
        if (heard > 0 && !element.paused && position !== null
            && position >= element.duration - PLAY_MISS_TOLERANCE_SEC && at <= PLAY_MISS_TOLERANCE_SEC) {
            const ended = play()!;
            const clock = last;
            reset();
            // The audio clock runs on through a loop, and the next play is heard from where it starts.
            last = clock;
            position = at;
            wraps += 1;
            wrapListeners.forEach(listener => listener(meter, ended));
            return;
        }
        if (heard > 0) broken ??= 'seek';
        // What plays next starts here, not where the last tick left it.
        position = at;
    });

    return meter;
};
