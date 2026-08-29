// src/services/automix/signalAnalysis.ts
// The measurement maths behind a blend: how loud a deck is, what tempo it is running at, and what
// shape the crossfade should take as a result. Pure - arrays and numbers in, numbers out - so
// every rule here is exercised without an audio device.

/** Slowest and fastest tempo worth looking for; outside this a "beat" is an artefact. */
const MIN_BPM = 60;
const MAX_BPM = 180;
/** Below this the autocorrelation peak is not distinguishable from its own noise floor. */
export const MIN_TEMPO_CONFIDENCE = 0.35;

/** Floor for every level reading. Digital silence and -Infinity both land here. */
export const SILENCE_DB = -90;

/** A dense, loud outro: it will bury whatever starts underneath it, so hand over early. */
const LOUD_OUTRO_DB = -14;
/** A decaying tail: letting it breathe sounds better than shouldering it aside. */
const QUIET_OUTRO_DB = -30;
/** Below this the track has already finished in every sense that matters; waiting is a hole. */
const SILENT_TAIL_DB = -45;
export const CROSSOVER_EARLY = 0.35;
export const CROSSOVER_LATE = 0.55;

/** Ceiling on how far the outgoing deck is pulled down to make room for the incoming one. */
export const MAX_TRIM_DB = 6;

/** How far the beat grid is allowed to stretch or shorten a planned blend. */
const BEAT_SNAP_TOLERANCE = 0.25;

/**
 * How many bars of evidence a bar-line vote is allowed to stand on.
 *
 * Long enough for a median to mean something, short enough that the grid has not walked off the
 * music by the far end of it. See the extrapolation note in `votePhase` for why both halves bind.
 */
const DOWNBEAT_WINDOW_BARS = 24;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export const dbToGain = (db: number): number => 10 ** (db / 20);

/** RMS of one analyser frame, in dBFS. */
export const rmsDb = (samples: Float32Array): number => {
    if (!samples.length) return SILENCE_DB;
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
        sum += samples[index] * samples[index];
    }
    const rms = Math.sqrt(sum / samples.length);
    return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
};

/**
 * Iterative radix-2 FFT, in place, real input.
 *
 * Hand-rolled rather than pulled in: it is thirty lines, it runs once per track in the background,
 * and the alternative is a dependency in the bundle of a music player that already ships an FFT in
 * the browser it runs on - just not one reachable from a decoded buffer.
 */
export const fft = (real: Float64Array, imag: Float64Array) => {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let curReal = 1;
            let curImag = 0;
            for (let k = 0; k < len / 2; k += 1) {
                const aReal = real[i + k];
                const aImag = imag[i + k];
                const bReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
                const bImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;
                real[i + k] = aReal + bReal;
                imag[i + k] = aImag + bImag;
                real[i + k + len / 2] = aReal - bReal;
                imag[i + k + len / 2] = aImag - bImag;
                const nextReal = curReal * wReal - curImag * wImag;
                curImag = curReal * wImag + curImag * wReal;
                curReal = nextReal;
            }
        }
    }
};

/**
 * Spectral flux: how much energy appeared since the previous frame.
 *
 * Only rises count. A note or drum hit starts as energy arriving across many bins at once, while energy
 * leaving is just the previous sound decaying - counting decay too would smear every onset into the
 * sustain that follows it and leave nothing periodic to find.
 */
export const spectralFlux = (current: Float32Array, previous: Float32Array, bins: number): number => {
    const limit = Math.min(bins, current.length, previous.length);
    let flux = 0;
    for (let index = 0; index < limit; index += 1) {
        const now = Number.isFinite(current[index]) ? current[index] : SILENCE_DB;
        const before = Number.isFinite(previous[index]) ? previous[index] : SILENCE_DB;
        if (now > before) flux += now - before;
    }
    return flux;
};

export interface TempoEstimate {
    bpm: number;
    periodSec: number;
    /** 0..1, from how far the winning lag stands above the average lag. */
    confidence: number;
    /** Hops before the newest envelope sample where the most recent beat fell. */
    beatOffsetHops: number;
}

/**
 * Weight on a candidate tempo before its correlation is judged.
 *
 * Autocorrelation cannot tell a tempo from half or double of it - both are genuinely periodic -
 * and picking the raw peak lands on the wrong octave often enough to be useless. A bump centred
 * on 120 BPM is the standard tie-breaker and costs one exponential per lag.
 */
const tempoPrior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.55) ** 2);

/**
 * How many multiples of a candidate period have to agree with it before it is believed.
 *
 * The prior above handles the octave, and `foldRatio` downstream forgives what is left of it. What
 * neither touches is the 3:2 and the 4:3, which were actually costing us the tempo: a tresillo - 3+3+2
 * sixteenths, most of what modern pop is built on - is genuinely periodic at three quarters of the
 * beat, so the single strongest lag has no reason to prefer the beat over it. Real logs carried "92
 * BPM, 123 at the end", 4:3 to within a rounding error, and `settledBpm` then correctly threw BOTH
 * readings away. One window locking onto a subdivision is why so many tracks ended up with no tempo at
 * all - and with no tempo there is no bend, no grid, no bar line and no entry alignment.
 *
 * What separates them: a true beat period repeats at every multiple of itself, so its 2x, 3x and 4x
 * lags sit on real peaks too; three quarters of a beat has exactly one of its first four multiples on a
 * peak. Summing the multiples is the entire discrimination, and it reuses correlations this pass
 * already computes.
 */
const TEMPO_HARMONICS = 4;

/**
 * How many beats back from the anchor the beat phase is measured over.
 *
 * Same bound and same reason as `DOWNBEAT_WINDOW_BARS`, one layer earlier: a phase is only as good
 * as the grid it was summed along, and that grid is straight while the music is not.
 */
const PHASE_BEATS = 96;

/**
 * Tempo and beat phase from an onset-strength envelope.
 *
 * Autocorrelation rather than a comb filter bank: one pass over a few hundred samples, no
 * dependency, and the by-product we actually need - the lag of the strongest self-similarity - is
 * the beat period directly. Returns null rather than a guess when the envelope is too short or
 * carries no periodicity at all, because a wrong grid is worse than no grid.
 */
export const estimateTempo = (envelope: readonly number[], hopSec: number): TempoEstimate | null => {
    if (!(hopSec > 0)) return null;
    const count = envelope.length;
    const minLag = Math.max(2, Math.round(60 / (MAX_BPM * hopSec)));
    const maxLag = Math.round(60 / (MIN_BPM * hopSec));
    // Three periods of the slowest tempo, or the longest lags are measured over a handful of
    // samples and win on noise alone.
    if (count < maxLag * 3) return null;

    let mean = 0;
    for (const value of envelope) mean += value;
    mean /= count;

    // Half-wave rectified around the mean: only above-average onsets carry the pulse.
    const centred = new Float64Array(count);
    let energy = 0;
    for (let index = 0; index < count; index += 1) {
        const value = Math.max(0, envelope[index] - mean);
        centred[index] = value;
        energy += value * value;
    }
    if (energy <= 0) return null;

    // Correlated past `maxLag`, because the harmonic test asks about multiples of candidates that
    // are themselves at the top of the range. Bounded by a third of the envelope as well: a lag
    // with only a handful of samples left to correlate over is one loud coincidence away from
    // outscoring everything, and this is the same reasoning as the length guard above.
    const topLag = Math.min(Math.floor(count / 3), maxLag * TEMPO_HARMONICS);
    const correlation = new Float64Array(topLag + 1);
    for (let lag = minLag; lag <= topLag; lag += 1) {
        let sum = 0;
        for (let index = lag; index < count; index += 1) {
            sum += centred[index] * centred[index - lag];
        }
        // Divided by the overlap: a long lag correlates over fewer samples and would otherwise
        // lose to a short one purely by construction.
        correlation[lag] = sum / (count - lag);
    }

    let bestLag = 0;
    let bestScore = 0;
    let scoreSum = 0;
    let scored = 0;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
        // Weighted 1/k: the candidate itself is the claim, and each further multiple is weaker
        // evidence for it, because a real performance drifts across a lag four beats long in a way
        // it does not across one.
        let sum = 0;
        for (let harmonic = 1; harmonic <= TEMPO_HARMONICS; harmonic += 1) {
            const at = lag * harmonic;
            if (at > topLag) break;
            sum += correlation[at] / harmonic;
        }
        const score = sum * tempoPrior(60 / (lag * hopSec));
        scoreSum += score;
        scored += 1;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }

    const average = scored ? scoreSum / scored : 0;
    if (!bestLag || bestScore <= 0 || average <= 0) return null;

    // The period to a FRACTION of a hop, which is the difference between having a beat grid and not.
    //
    // `bestLag` is a whole number of hops because the correlation was sampled at whole hops, and at 512
    // samples per hop the rungs of that ladder are 5 to 7 BPM apart around 130. Nothing in a real
    // library lands on a rung: against synthesised click tracks, seven tempos out of eight came back
    // between 0.3% and 1.1% wrong, and the eighth - period exactly 34 hops - came back exact. That error
    // is invisible in a BPM readout and fatal one layer down, because every consumer EXTRAPOLATES it. A
    // grid laid from one end of a four minute track walks off the music by five beats, so
    // `estimateDownbeat` medians over bars no longer on the music and correctly reports no pattern.
    // Handing the same detector the true period made it answer instantly. It was never the detector.
    //
    // Two ways the correlation carries more precision than its sampling:
    //
    // - The peak has a SHAPE. Three samples across it fix a parabola, whose vertex is where the peak
    //   actually is. Standard, and it costs three array reads.
    // - The peak repeats at every multiple of the period, and the h-th multiple sits h times further
    //   along the lag axis - so reading it there and dividing by h divides the error by h too. The
    //   multiples are already computed: the harmonic sum above needed them.
    //
    // Together the residual is a few hundredths of a hop rather than half of one.
    const refinePeriod = (lag: number): number => {
        for (let harmonic = TEMPO_HARMONICS; harmonic >= 1; harmonic -= 1) {
            const centre = lag * harmonic;
            if (centre + 1 > topLag) continue;
            // `lag` is only known to half a hop, so its h-th multiple is only known to h halves of
            // one. Search that far and no further: peaks sit a whole period apart and `minLag` is
            // an order of magnitude more than TEMPO_HARMONICS, so this cannot reach the next one.
            let peak = centre;
            const from = Math.max(minLag + 1, centre - harmonic);
            const to = Math.min(topLag - 1, centre + harmonic);
            for (let at = from; at <= to; at += 1) if (correlation[at] > correlation[peak]) peak = at;
            if (peak <= minLag || peak >= topLag) continue;

            const before = correlation[peak - 1];
            const after = correlation[peak + 1];
            const curve = before - 2 * correlation[peak] + after;
            // Not concave here means this multiple is sitting on a shoulder rather than a peak, and
            // a parabola through it points anywhere. Fall to the next multiple down.
            if (!(curve < 0)) continue;
            const period = (peak + (before - after) / (2 * curve)) / harmonic;
            // A refinement that moves further than the sampling error it exists to remove is not a
            // refinement; it is a different peak. Keep looking.
            if (Math.abs(period - lag) <= 0.5) return period;
        }
        return lag;
    };
    const period = refinePeriod(bestLag);

    // Which offset within the period the beats actually sit on: sum every sample the grid would land on
    // and keep the alignment that collects the most onset strength.
    //
    // Stepped by the refined period and stopped after a bounded number of beats, both for one reason:
    // this is an extrapolation like every other, and summing all the way back through a four minute
    // track adds up hundreds of positions the accumulated error has already walked off the music. They
    // contribute the same average nothing to every candidate offset, so the winner is decided by the
    // near end anyway - but they are noise on the comparison, and an offset that wins by noise is a beat
    // grid out by a fraction of a beat everywhere.
    let beatOffsetHops = 0;
    let bestPhase = -1;
    for (let offset = 0; offset < bestLag; offset += 1) {
        let sum = 0;
        for (let beat = 0; beat < PHASE_BEATS; beat += 1) {
            const index = Math.round(count - 1 - offset - beat * period);
            if (index < 0) break;
            sum += centred[index];
        }
        if (sum > bestPhase) {
            bestPhase = sum;
            beatOffsetHops = offset;
        }
    }

    return {
        bpm: 60 / (period * hopSec),
        periodSec: period * hopSec,
        confidence: clamp((bestScore / average - 1) / 2, 0, 1),
        beatOffsetHops,
    };
};

/**
 * How far into the blend the two tracks should change places.
 *
 * 0.5 - the plain equal-power midpoint - assumes both tracks are equally loud, and mastering levels
 * vary by 10dB across a library, which is why a symmetric fade so often sounds like the old song
 * sitting on top of the new one. The outgoing track's own measured level is the one thing known before
 * the incoming track has made a sound, so it sets the handover point: a loud dense outro gives way
 * early, a quiet decaying tail is allowed to run.
 */
export const crossoverFor = (outgoingDb: number | null): number => {
    if (outgoingDb === null || !Number.isFinite(outgoingDb)) {
        return (CROSSOVER_EARLY + CROSSOVER_LATE) / 2;
    }
    // Not monotonic on purpose. A quiet tail is worth waiting for; a track that has already faded
    // to nothing is not, and holding the incoming one back for it leaves an audible hole.
    if (outgoingDb <= SILENT_TAIL_DB) return CROSSOVER_EARLY;
    const loudness = clamp((outgoingDb - QUIET_OUTRO_DB) / (LOUD_OUTRO_DB - QUIET_OUTRO_DB), 0, 1);
    return CROSSOVER_LATE + (CROSSOVER_EARLY - CROSSOVER_LATE) * loudness;
};

/**
 * dB to pull the outgoing deck down by so the incoming track is not buried under it.
 *
 * Only ever an attenuation, and only ever of the track that is leaving. Lifting the incoming one
 * instead would risk clipping, and would have to be undone afterwards - an audible swell on every
 * song change.
 */
export const trimForBalance = (outgoingDb: number, incomingDb: number): number =>
    clamp(outgoingDb - incomingDb, 0, MAX_TRIM_DB);

export interface BlendShapeInput {
    /** Blend length the planner asked for, already clamped to what the track has left. */
    overlap: number;
    /** Recent level of the outgoing deck in dBFS, or null when it was never measured. */
    outgoingDb: number | null;
    /** Seconds from the start of the blend to the outgoing track's next beat, or null. */
    nextBeatIn: number | null;
    /** Beat period of the outgoing track in seconds, or null. */
    periodSec: number | null;
    minOverlap: number;
    /** Everything the outgoing track actually has left. */
    maxOverlap: number;
}

export interface BlendShape {
    overlap: number;
    crossover: number;
    /** True when the beat grid moved the length. Reported, so a claim can be checked. */
    snappedToBeat: boolean;
}

/**
 * Turns the planner's length plus whatever was measured into the blend that gets scheduled.
 *
 * The beat snap moves the crossover, not the start: the start is fixed by when the incoming deck
 * managed to load, and the crossover - the one moment in a blend where both tracks are equally present
 * - is what a listener hears as the transition happening. Landing it on a beat of the outgoing track is
 * the whole of the alignment honestly available without stretching time, which no browser can do
 * without shifting pitch with it.
 */
export const planBlendShape = (input: BlendShapeInput): BlendShape => {
    const crossover = crossoverFor(input.outgoingDb);
    const shape: BlendShape = { overlap: input.overlap, crossover, snappedToBeat: false };

    const { nextBeatIn, periodSec } = input;
    if (nextBeatIn === null || periodSec === null || !(periodSec > 0)) return shape;

    const low = Math.max(input.minOverlap, input.overlap * (1 - BEAT_SNAP_TOLERANCE));
    const high = Math.min(input.maxOverlap, input.overlap * (1 + BEAT_SNAP_TOLERANCE));
    if (low > high) return shape;

    // Beats fall at nextBeatIn + k periods; take whichever sits closest to the unsnapped crossover.
    const target = input.overlap * crossover;
    const beat = nextBeatIn + Math.round((target - nextBeatIn) / periodSec) * periodSec;
    if (!(beat > 0)) return shape;

    const overlap = beat / crossover;
    if (overlap < low || overlap > high) return shape;

    return { overlap, crossover, snappedToBeat: true };
};

/**
 * Headroom the summed blend is given while both masters are stacked.
 *
 * Equal power guarantees constant POWER, not constant PEAK: two modern masters both a decibel under
 * full scale can and do sum past it, and what that sounds like is a few hundred milliseconds of
 * distortion in the middle of every song change. A decibel and a half is the standard inter-sample
 * allowance and is inaudible as a level change.
 */
export const BLEND_HEADROOM_DB = 1.5;

/**
 * How much of the headroom applies at a given point through the blend.
 *
 * Zero at both ends and one in the middle, so the curves still start and finish at exactly unity.
 * That is what makes this free: a flat 1.5dB dip would have to be handed back at the end of every
 * transition, which is a 1.5dB swell on the incoming track the moment it is alone.
 */
const headroomBell = (progress: number) => Math.sin(clamp(progress, 0, 1) * Math.PI);

/**
 * The pair of gain curves for one blend.
 *
 * Both sides read the same warped progress, so cos^2 + sin^2 keeps the summed power at exactly one
 * wherever the crossover is put: moving the handover changes the two tracks' relative speeds
 * without ever letting the blend sag or swell in the middle.
 *
 * `together` is the difference between a mix and a fade, and the whole reason this takes a second
 * parameter. A fade's signature is not its length - it is that the outgoing track descends CONTINUOUSLY
 * for the whole span, so you hear it receding the entire time. A mix's signature is that the outgoing
 * track is simply THERE, at strength, then gone. Three rounds of making these blends longer did not
 * change that, because length was never what the ear was reading: the level curve was a full-span
 * cosine in every style, and three bands of filtering on top of a crossfade is a crossfade.
 *
 * So the warp gets a flat middle. `together` is the fraction of the blend both tracks spend held at one
 * level, centred on the crossover - exactly where the bass swap happens, so the two sit at equal
 * strength with only one carrying a low end, the actual DJ move and the actual reason it does not turn
 * to mud.
 *
 * Crucially this costs NO headroom. The plateau sits at cos(pi/4) = sin(pi/4), so the summed power
 * across it is still exactly one - the same as every other instant. A different shape at identical
 * energy, not a louder one.
 */
export const buildCrossfadeCurves = (
    crossover: number,
    /** 0 is a pure crossfade, which is what a crossfade should be. Up to 0.8 of held middle. */
    together = 0,
    points = 64,
): {
    out: Float32Array;
    in: Float32Array;
} => {
    const pivot = clamp(crossover, 0.15, 0.85);
    const held = clamp(together, 0, 0.8);
    // Where the incoming track finishes arriving and where the outgoing one starts leaving. They
    // collapse onto the pivot at together = 0, which is where this reduces to the old curve exactly.
    const lead = pivot * (1 - held);
    const trail = pivot + (1 - pivot) * held;
    const out = new Float32Array(points);
    const incoming = new Float32Array(points);

    for (let index = 0; index < points; index += 1) {
        const progress = index / (points - 1);
        // Piecewise linear through (0,0) (lead,0.5) (trail,0.5) (1,1): monotonic, flat across the
        // middle, and exact at both ends whatever `together` is.
        const warped = progress <= lead
            ? (progress / Math.max(1e-3, lead)) * 0.5
            : progress >= trail
                ? 0.5 + ((progress - trail) / Math.max(1e-3, 1 - trail)) * 0.5
                : 0.5;
        const angle = warped * (Math.PI / 2);
        const headroom = dbToGain(-BLEND_HEADROOM_DB * headroomBell(progress));
        out[index] = Math.cos(angle) * headroom;
        incoming[index] = Math.sin(angle) * headroom;
    }

    return { out, in: incoming };
};

// ---------------------------------------------------------------------------------------------
// Three bands, three seams
// ---------------------------------------------------------------------------------------------

/**
 * Where the spectrum is cut into the three regions a blend treats differently.
 *
 * One number per region rather than a filter bank: these same two edges define what the offline
 * analysis measures a track's tone as, and what the deck chain's three filters act on, so a single
 * pair keeps the measurement and the actuator describing the same thing.
 */
export const TONE_EDGE_HZ = [250, 4000] as const;
/** Centre of the middle region, geometrically. The peaking filter's frequency. */
export const TONE_MID_HZ = Math.round(Math.sqrt(TONE_EDGE_HZ[0] * TONE_EDGE_HZ[1]));

/** How far down the low end goes while the other deck owns it. Gone, without being a filter. */
const BASS_KILL_DB = 24;
/** How much of the top the outgoing track loses on its way out. */
const SWEEP_OUT_HIGH_DB = 9;
/** Fraction of the blend the low end takes to change hands. Short enough to read as one moment. */
const BASS_SWAP_WIDTH = 0.12;
/** Ceiling on the tone match. Past this it stops being "arriving in character" and is an effect. */
export const MAX_TILT_DB = 3;

export interface BandBlendRequest {
    /** Where through the blend the two tracks change places, 0..1. */
    crossover: number;
    /** The low end changes hands as a step at the crossover instead of crossfading through it. */
    swapBass: boolean;
    /** The outgoing track is filtered out of the way as it leaves, not only turned down. */
    sweepOut: boolean;
    /** dB the incoming deck's mid and top start bent by, so it arrives wearing the outgoing
     *  track's tone and returns to its own. Clamped; zero disables the match. */
    tiltDb: readonly [number, number];
    points?: number;
}

/** Three dB curves per deck, in the order [low, mid, high]. */
export interface BandBlendCurves {
    out: [Float32Array, Float32Array, Float32Array];
    in: [Float32Array, Float32Array, Float32Array];
}

/**
 * The per-band shape of one blend, on top of the overall gain curve.
 *
 * One gain curve for the whole spectrum is what makes a crossfade sound like a crossfade: every
 * frequency of both tracks is present through the middle of it, so two arrangements, two bass lines and
 * two sets of cymbals are all stacked at once. Giving each region its own seam is the answer the
 * literature reaches for too - the ideal version picks a seam per frequency bin by graph cut over a
 * spectrogram, which needs phase-preserving resynthesis and is not something a browser does to live
 * audio. Three regions is the same idea at the resolution a pair of shelves and a bell can act on, and
 * it costs three automation curves.
 *
 * What each region does, and why:
 *
 * - LOW changes hands at a stroke. Almost all of the mud in an overlap is below 250Hz, where two bass
 *   lines double the energy, beat against each other and cancel. One track owns it at a time.
 * - MID crossfades with the overall curve, unshaped. It is where both tracks are recognisable, and the
 *   region the listener is following the transition in.
 * - HIGH leaves early on the outgoing side. Rolling the top off a departing track makes it read as
 *   being pulled away rather than merely turned down, and clears its cymbals out of the way of the
 *   arriving ones, which are the other thing that stacks badly.
 *
 * The incoming deck's mid and top additionally start bent towards the outgoing track's tone and relax
 * to flat by the crossover: a dull master following a bright one is a step in timbre at the seam, and
 * this walks it instead.
 */
export const buildBandCurves = (request: BandBlendRequest): BandBlendCurves => {
    const points = request.points ?? 64;
    const seam = clamp(request.crossover, 0.15, 0.85);
    const width = Math.max(0.02, Math.min(BASS_SWAP_WIDTH, seam, 1 - seam));
    const tiltMid = clamp(request.tiltDb[0], -MAX_TILT_DB, MAX_TILT_DB);
    const tiltHigh = clamp(request.tiltDb[1], -MAX_TILT_DB, MAX_TILT_DB);

    const band = () => [
        new Float32Array(points), new Float32Array(points), new Float32Array(points),
    ] as [Float32Array, Float32Array, Float32Array];
    const out = band();
    const incoming = band();

    for (let index = 0; index < points; index += 1) {
        const progress = index / (points - 1);
        // 0 while the outgoing track still owns the low end, 1 once the incoming one has it.
        const handover = clamp((progress - (seam - width / 2)) / width, 0, 1);
        // Nothing at the seam, then accelerating: the top thins out as the track leaves rather
        // than stepping down the moment the two change places.
        const leaving = clamp((progress - seam) / Math.max(1e-3, 1 - seam), 0, 1) ** 2;
        // Full at the start of the blend, gone by the time the two change places.
        const settling = clamp(1 - progress / Math.max(1e-3, seam), 0, 1);

        if (request.swapBass) {
            out[0][index] = -BASS_KILL_DB * handover;
            incoming[0][index] = -BASS_KILL_DB * (1 - handover);
        }
        if (request.sweepOut) {
            out[2][index] = -SWEEP_OUT_HIGH_DB * leaving;
        }
        incoming[1][index] = tiltMid * settling;
        incoming[2][index] = tiltHigh * settling;
    }

    return { out, in: incoming };
};

/**
 * How far apart two tracks' tone sits, as the bend that would close the gap.
 *
 * Shares are used rather than absolute levels because the two tracks are already being matched for
 * loudness elsewhere; what is left is the SHAPE, and a share is what a shape is. The answer is the
 * mid and top corrections for the incoming deck, in dB, so that a bright track arriving after a
 * dull one is briefly dulled to match.
 */
export const toneTilt = (
    outgoing: readonly number[] | null | undefined,
    incoming: readonly number[] | null | undefined,
): [number, number] => {
    if (!outgoing || !incoming || outgoing.length < 3 || incoming.length < 3) return [0, 0];
    const bend = (band: number) => {
        const a = outgoing[band];
        const b = incoming[band];
        if (!(a > 0) || !(b > 0)) return 0;
        return clamp(10 * Math.log10(a / b), -MAX_TILT_DB, MAX_TILT_DB);
    };
    return [bend(1), bend(2)];
};

// ---------------------------------------------------------------------------------------------
// Loudness, in the unit broadcasting settled on
// ---------------------------------------------------------------------------------------------

/**
 * The offset that turns mean K-weighted power into LUFS, from ITU-R BS.1770.
 *
 * Exposed rather than folded in because the same weighting is applied twice - once in software over
 * a decoded file, once as two biquads in front of the live tap - and the two have to land in the
 * same unit or every level comparison between an offline profile and a playing deck is nonsense.
 */
export const LUFS_OFFSET_DB = -0.691;

/**
 * K-weighting, as two biquad sections. The filter every loudness number in broadcasting goes
 * through.
 *
 * RMS answers "how much energy is there", which is not the question. Two tracks at the same RMS differ
 * by several decibels of perceived loudness if one is bass-heavy, because the ear is far less sensitive
 * down there - so an RMS-matched blend leaves the denser master sounding louder, exactly the "old song
 * sitting on top of the new one" the balance correction exists to remove. K-weighting is a shelf
 * lifting everything above ~1.7kHz by 4dB and a high-pass at ~38Hz that discards rumble; what comes out
 * correlates with loudness well enough that the entire streaming industry normalises to it.
 *
 * Coefficients derived from the analog prototype at the caller's sample rate rather than copied from the
 * 48kHz table in the standard: the analysis runs at 22.05kHz, where the tabulated numbers are a
 * different filter.
 */
export const kWeight = (samples: Float32Array, sampleRate: number): Float32Array => {
    const out = new Float32Array(samples.length);
    if (!(sampleRate > 0) || !samples.length) return out;

    // Stage 1: the head/torso shelf.
    const shelfHz = 1681.974450955533;
    const shelfGainDb = 3.999843853973347;
    const shelfQ = 0.7071752369554196;
    const k1 = Math.tan((Math.PI * shelfHz) / sampleRate);
    const vh = 10 ** (shelfGainDb / 20);
    const vb = vh ** 0.4996667741545416;
    const d0 = 1 + k1 / shelfQ + k1 * k1;
    const b = [
        (vh + (vb * k1) / shelfQ + k1 * k1) / d0,
        (2 * (k1 * k1 - vh)) / d0,
        (vh - (vb * k1) / shelfQ + k1 * k1) / d0,
    ];
    const a = [(2 * (k1 * k1 - 1)) / d0, (1 - k1 / shelfQ + k1 * k1) / d0];

    // Stage 2: the RLB high-pass.
    const hpHz = 38.13547087602444;
    const hpQ = 0.5003270373238773;
    const k2 = Math.tan((Math.PI * hpHz) / sampleRate);
    const d1 = 1 + k2 / hpQ + k2 * k2;
    const c = [(2 * (k2 * k2 - 1)) / d1, (1 - k2 / hpQ + k2 * k2) / d1];

    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    let p1 = 0; let p2 = 0; let q1 = 0; let q2 = 0;
    for (let index = 0; index < samples.length; index += 1) {
        const x = samples[index];
        const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        // b coefficients of the high-pass are exactly 1, -2, 1.
        const z = y - 2 * p1 + p2 - c[0] * q1 - c[1] * q2;
        p2 = p1; p1 = y; q2 = q1; q1 = z;
        out[index] = z;
    }
    return out;
};

// ---------------------------------------------------------------------------------------------
// Where the bar line is
// ---------------------------------------------------------------------------------------------

/** How many beats a bar is taken to be. Everything this player is likely to meet is in four. */
export const BEATS_PER_BAR = 4;

/** Which of a bar's phases one kind of evidence votes for, and how hard. */
interface PhaseVote {
    phase: number;
    /** The winner over the average of all phases. 1 is four phases that cannot be told apart. */
    contrast: number;
}

/**
 * Which phase of the bar an evidence envelope puts its weight on.
 *
 * Shared by the two kinds of evidence below, because the question and the guards are identical for
 * both and only the array differs. Returns null when the phases are indistinguishable, which is
 * what "this envelope has no opinion" must look like for the caller to prefer the other one.
 */
const votePhase = (
    envelope: readonly number[],
    hopSec: number,
    periodSec: number,
    beatOffsetSec: number,
    beatsPerBar: number,
): PhaseVote | null => {
    // The strongest frame within an eighth of a beat, not the frame the arithmetic lands on.
    //
    // Two errors to absorb, different sizes. A kick is one or two frames wide, so a grid half a frame
    // out already reads the shoulder of every hit instead of the hit. On top of that the grid is an
    // extrapolation from a period known to about a thousandth, so bars further from the anchor land
    // progressively further off - a few frames by the far end of the window. One frame either side
    // covers the first and not the second, and a phase that reads the gap beside its own hits scores
    // like a phase that has none.
    //
    // An eighth of a beat is the widest this can be without answering a different question: the four
    // candidate phases sit a WHOLE beat apart, so a window of a quarter beat around each can never reach
    // the next one's hits, and the vote still measures what it says it measures.
    const radius = Math.max(1, Math.round(periodSec / hopSec / 8));
    const at = (seconds: number) => {
        const centre = Math.round(seconds / hopSec);
        if (centre < 0 || centre >= envelope.length) return null;
        let peak = envelope[centre];
        for (let index = centre - radius; index <= centre + radius; index += 1) {
            if (index >= 0 && index < envelope.length && envelope[index] > peak) {
                peak = envelope[index];
            }
        }
        return peak;
    };

    // The TYPICAL strength on each candidate phase, not the average one.
    //
    // A median rather than a mean, and that is the whole robustness of this. A downbeat happens every
    // bar; an average is moved by one event, so a single loud moment anywhere - the first note after the
    // leading silence, say - is enough to nominate whichever phase it landed on. A median asks "does this
    // phase usually carry a hit", which is the question, and one transient cannot answer it.
    const middle = (values: number[]) => {
        if (!values.length) return 0;
        values.sort((a, b) => a - b);
        return values[values.length >> 1];
    };
    const scores: number[] = [];
    const span = envelope.length * hopSec;
    const barSec = periodSec * beatsPerBar;
    for (let phase = 0; phase < beatsPerBar; phase += 1) {
        const hits: number[] = [];
        const first = beatOffsetSec + phase * periodSec;
        // Only the last stretch of bars, because a grid is a straight line and music is not.
        //
        // One period times a bar number is an EXTRAPOLATION, only as good as the period it multiplies.
        // The period is measured to about a thousandth; four minutes is five hundred beats; a thousandth
        // of five hundred beats is half a beat. `at` forgives one frame - a fiftieth of a beat - so past
        // a couple of dozen bars from the anchor the arithmetic lands between the hits, on every phase
        // equally, and four equal medians is exactly what "no bar line" is made of. Synthesised click
        // tracks: unbounded, five tempos out of eight found nothing; bounded, eight out of eight.
        //
        // Counted back from the end of what it was handed, because that is where the phase is anchored -
        // `estimateTempo` reports the most recent beat, not the first. Which end of a track the window
        // covers is the caller's to decide, by choosing what to pass in.
        const bars = Math.floor((span - first) / barSec) + 1;
        for (let bar = Math.max(0, bars - DOWNBEAT_WINDOW_BARS); bar < bars; bar += 1) {
            const value = at(first + bar * barSec);
            if (value !== null) hits.push(value);
        }
        scores.push(middle(hits));
    }

    let best = 0;
    for (let phase = 1; phase < beatsPerBar; phase += 1) if (scores[phase] > scores[best]) best = phase;
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;

    // Two guards, ruling out two different kinds of nothing.
    //
    // Contrast: phases carrying the same evidence cannot be told apart, and picking the largest of four
    // equal numbers is picking noise.
    //
    // Height: the winning phase has to stand above the envelope's own floor. Contrast alone passes on a
    // signal with no onsets at all, because the ratio between four tiny numbers is still a ratio.
    //
    // That floor is measured over the same bars the scores were, and it has to be. The vote above only
    // looks at the last two dozen, for the extrapolation reason; a mean over the whole file then puts a
    // different piece of music on the other side of the inequality - and on anything that fades out,
    // very nearly every track, a LOUDER one. The choruses are inside that mean and the outro being
    // measured is not, so the kick plainly there gets rejected for not being as loud as the chorus was.
    // Six of the nine tracks in one listening log answered `no bar line found` this way, every one
    // profiled `decays out`, several at a rock-steady tempo - a near miss rather than a rout, which is
    // why the next log went three for three: on the synthetic fade-out in the tests the winner clears
    // the window's own floor comfortably and lands about 20% under the whole file's. Costing, each time
    // it does not clear it, all four of the things named below.
    const windowStart = Math.min(
        envelope.length - 1,
        Math.max(0, Math.round((span - DOWNBEAT_WINDOW_BARS * barSec) / hopSec)),
    );
    let floor = 0;
    for (let index = windowStart; index < envelope.length; index += 1) floor += envelope[index];
    floor /= envelope.length - windowStart;
    if (!(mean > 0) || scores[best] < mean * 1.25 || scores[best] < floor * 1.5) return null;

    return { phase: best, contrast: scores[best] / mean };
};

/**
 * Which beat of the bar is the "one".
 *
 * A beat grid says when the pulses are; it does not say which of them a bar starts on, and that is the
 * difference between a transition that lands and one that is a quarter note out for its whole length. A
 * null here is not one missing feature but four: no bar-line snap for the handover, no phrase alignment,
 * no bar grid for the live tap, and an incoming track that can only ever be entered at 0.00s. The cost
 * of answering "I do not know" is much higher than it looks from here.
 *
 * TWO kinds of evidence, because the first has a blind spot that covers most of a real library.
 *
 * The kick drum is the obvious one, and it was here alone: the bass drum marks the downbeat and the
 * snare the backbeat, so the bottom of the spectrum votes. But on four-on-the-floor - house, disco,
 * most dance pop, a lot of anything with a mastered bottom end - there is a kick on EVERY beat. All four
 * phases score the same, the contrast guard fires, and the answer is null. Correct on that evidence and
 * useless in effect: the tracks it fails on are precisely the ones whose grids are strongest and most
 * worth aligning to.
 *
 * Harmony is the second, and it sees exactly where the first is blind. Chords change on bar lines and
 * not with the kick pattern - so a four-on-the-floor track with a chord per bar answers clearly on
 * evidence the low band cannot carry. It reads per-frame chroma flux, from a spectrum the profiler was
 * computing anyway.
 *
 * Whichever votes with more contrast wins. Deliberately not an average of the two: they disagree by
 * whole beats when they disagree at all, and the mean of two phases is a third phase neither proposed.
 *
 * A trained classifier does this better. This does not have to be better, it has to beat picking a
 * phase at random, which is the alternative.
 *
 * Returns seconds from the start of the envelope to a downbeat, or null when neither kind of evidence
 * can tell the phases apart.
 */
export const estimateDownbeat = (
    lowEnvelope: readonly number[],
    hopSec: number,
    periodSec: number,
    /** Seconds from the start of the envelope to any beat of the grid. */
    beatOffsetSec: number,
    beatsPerBar = BEATS_PER_BAR,
    /** Per-frame harmonic change, on the same time base as `lowEnvelope`. */
    harmonicEnvelope?: readonly number[],
): number | null => {
    if (!(hopSec > 0) || !(periodSec > 0) || lowEnvelope.length < beatsPerBar * 4) return null;

    const kick = votePhase(lowEnvelope, hopSec, periodSec, beatOffsetSec, beatsPerBar);
    const harmony = harmonicEnvelope && harmonicEnvelope.length >= beatsPerBar * 4
        ? votePhase(harmonicEnvelope, hopSec, periodSec, beatOffsetSec, beatsPerBar)
        : null;

    const winner = kick === null ? harmony
        : harmony === null ? kick
            : harmony.contrast > kick.contrast ? harmony : kick;
    if (winner === null) return null;

    const barSec = periodSec * beatsPerBar;
    return ((beatOffsetSec + winner.phase * periodSec) % barSec + barSec) % barSec;
};
