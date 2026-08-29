import {
    estimateTempo,
    rmsDb,
    spectralFlux,
    MIN_TEMPO_CONFIDENCE,
    SILENCE_DB,
    type TempoEstimate,
} from './signalAnalysis';

// src/services/automix/deckAnalyser.ts
// One measurement tap per deck. Taken ahead of the crossfade envelope on purpose: a deck has to
// report its own level, not wherever the running blend currently has it, or the balance correction
// would be chasing its own output.

const FFT_SIZE = 1024;
/** Onsets live below ~5kHz; above it is mostly cymbal wash and hiss, which blur the beat. */
const FLUX_CEILING_HZ = 5000;
/** Eight seconds of onset history: three periods of the slowest tempo the estimator looks for. */
const ENVELOPE_SIZE = 320;
/**
 * Loudness is a decaying peak rather than an average, so a rest between phrases does not read as
 * a quiet track and pull the whole balance correction with it. 12dB/s empties it in well under a
 * second once the music really does stop.
 */
const PEAK_DECAY_DB_PER_SEC = 12;
/** Roughly 400ms of frames before a level reading is worth acting on. */
const MIN_FRAMES_FOR_LEVEL = 16;
/** Re-running the autocorrelation on every frame would be the only expensive thing here. */
const TEMPO_REFRESH_SEC = 0.5;
/**
 * A gap longer than this between two frames means the sampler stopped, not that time passed.
 *
 * The sampler only runs while there is sound, so a pause, a stall or a throttled window comes back as
 * one enormous frame. Harmless for the tempo grid, which only looks at the last few seconds, but it
 * silently stretches the measured hop - so the level history flags it rather than describing a track
 * that was never played end to end.
 */
const CONTINUITY_GAP_SEC = 0.5;

/** A deck's own level readings for the track it is playing, and the real period between them. */
export interface DeckLevelHistory {
    db: readonly number[];
    hopSec: number;
}

export interface DeckAnalyser {
    /** Feeds one frame in. Driven by the hook's sampler, not by this module. */
    tick: (contextTime: number) => void;
    /** Recent level in dBFS, or null before there is enough of it to mean anything. */
    loudnessDb: () => number | null;
    /**
     * Every level read since this deck started its current track, or null if that series has a
     * hole in it and so describes something other than one continuous play-through.
     */
    levelHistory: () => DeckLevelHistory | null;
    tempo: () => TempoEstimate | null;
    /** Seconds from contextTime to this deck's next beat, or null without a usable grid. */
    nextBeatIn: (contextTime: number) => number | null;
    /** Forgets everything. Called when the deck starts a different track. */
    reset: () => void;
}

export const createDeckAnalyser = (
    context: AudioContext,
    input: AudioNode,
    sink: AudioNode,
): DeckAnalyser => {
    const node = context.createAnalyser();
    node.fftSize = FFT_SIZE;
    // Flux is the change between consecutive frames; the engine's own smoothing would average
    // exactly the change we are trying to measure.
    node.smoothingTimeConstant = 0;

    // K-weighting in front of the tap, so a level read here and one off a decoded file are the same
    // number. Two tracks at equal RMS are not equally loud if one is bass-heavy, and every comparison
    // this tap feeds - the balance correction, the energy step - is a loudness question.
    //
    // The offline path derives the same two sections from the analog prototype (see `kWeight`); these
    // are the engine's own RBJ shapes at the same corners, agreeing to a fraction of a decibel. Close
    // enough for a comparison, versus hand-rolling biquads in an AudioWorklet to save that fraction.
    const shelf = context.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 1681.974;
    shelf.gain.value = 4;
    const rumble = context.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 38.135;
    rumble.Q.value = 0.5003;

    // Out through a silent gain rather than left dangling. An engine only renders what something
    // downstream pulls on, and a tap that is never pulled reports digital silence forever - the
    // kind of failure that looks exactly like a track that happens to be quiet.
    const silent = context.createGain();
    silent.gain.value = 0;
    input.connect(shelf).connect(rumble).connect(node).connect(silent).connect(sink);

    const spectrum = new Float32Array(node.frequencyBinCount);
    const previous = new Float32Array(node.frequencyBinCount);
    const samples = new Float32Array(node.fftSize);
    const fluxBins = Math.max(
        8,
        Math.round(node.frequencyBinCount * FLUX_CEILING_HZ / (context.sampleRate / 2)),
    );

    let envelope: number[] = [];
    let levels: number[] = [];
    let continuous = true;
    let frames = 0;
    let firstTickTime = 0;
    let lastTickTime = 0;
    let peakDb = SILENCE_DB;
    let cachedTempo: TempoEstimate | null = null;
    let cachedAt = -Infinity;

    // Measured rather than assumed: the sampler is a timer, so its real period drifts with load.
    const hopSec = () => (frames > 1 ? (lastTickTime - firstTickTime) / (frames - 1) : 0);

    const tick = (contextTime: number) => {
        node.getFloatTimeDomainData(samples);
        node.getFloatFrequencyData(spectrum);

        const level = rmsDb(samples);
        const elapsed = frames ? Math.max(0, contextTime - lastTickTime) : 0;
        peakDb = Math.max(level, peakDb - PEAK_DECAY_DB_PER_SEC * elapsed);
        if (elapsed > CONTINUITY_GAP_SEC) continuous = false;
        levels.push(level);

        if (frames) {
            envelope.push(spectralFlux(spectrum, previous, fluxBins));
            if (envelope.length > ENVELOPE_SIZE) envelope.shift();
        } else {
            firstTickTime = contextTime;
        }
        previous.set(spectrum);

        lastTickTime = contextTime;
        frames += 1;
    };

    const tempo = () => {
        if (lastTickTime - cachedAt < TEMPO_REFRESH_SEC) return cachedTempo;
        cachedAt = lastTickTime;
        cachedTempo = estimateTempo(envelope, hopSec());
        return cachedTempo;
    };

    const nextBeatIn = (contextTime: number) => {
        const estimate = tempo();
        if (!estimate || estimate.confidence < MIN_TEMPO_CONFIDENCE) return null;

        const period = estimate.periodSec;
        const lastBeatAt = lastTickTime - estimate.beatOffsetHops * hopSec();
        const since = contextTime - lastBeatAt;
        return period - (((since % period) + period) % period);
    };

    return {
        tick,
        loudnessDb: () => (frames >= MIN_FRAMES_FOR_LEVEL ? peakDb : null),
        levelHistory: () => (
            continuous && frames > MIN_FRAMES_FOR_LEVEL ? { db: levels, hopSec: hopSec() } : null
        ),
        tempo,
        nextBeatIn,
        reset: () => {
            envelope = [];
            levels = [];
            continuous = true;
            frames = 0;
            peakDb = SILENCE_DB;
            cachedTempo = null;
            cachedAt = -Infinity;
        },
    };
};
