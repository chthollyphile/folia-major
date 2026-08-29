import { modelCanRun, noteModelFailed } from './modelAvailability';
import { fft } from './signalAnalysis';
import { YIELD_BUDGET_MS, yieldToUi } from './uiYield';

// src/services/automix/beatThis.ts
// The two halves of the Beat This! contract that are plain arithmetic: the mel spectrogram it
// expects on its input, and the peak picking that turns its two logit tracks into times.
//
// The network itself is not here. It runs in the Electron main process (electron/analysis/), so this
// file stays pure, testable without an audio device, and free of any model dependency - the same rule
// the rest of the evidence layer follows.
//
// Every constant below is a CONTRACT, not a tuning knob: the values the checkpoint was trained with,
// read off the reference C++ port (mosynthkey/beat_this_cpp, MIT). Changing one does not make the
// answer slightly different, it makes the model confidently wrong - the failure mode this codebase
// has been bitten by three times. If a beat grid ever looks subtly off, verify against `beats.json`
// before touching a number here.

/** Beat This! runs at 22.05kHz mono, which is also the rate the offline profile decodes at. */
export const BEAT_THIS_SAMPLE_RATE = 22050;
const N_FFT = 1024;
const HOP = 441;
/** 22050 / 441. Every output frame is one fiftieth of a second. */
export const BEAT_THIS_FPS = BEAT_THIS_SAMPLE_RATE / HOP;
const N_MELS = 128;
const F_MIN = 30;
const F_MAX = 11000;
/** Inside log1p, so the compressed scale matches what the checkpoint saw. */
const LOG_MULTIPLIER = 1000;
const AMIN = 1e-10;

/** Slaney mel, the torchaudio default - linear to 1kHz, logarithmic above it. */
const hzToMel = (hz: number): number => {
    const fSp = 200 / 3;
    if (hz < 1000) return hz / fSp;
    return 1000 / fSp + Math.log(hz / 1000) / (Math.log(6.4) / 27);
};

const melToHz = (mel: number): number => {
    const fSp = 200 / 3;
    const minLogMel = 1000 / fSp;
    if (mel < minLogMel) return fSp * mel;
    return 1000 * Math.exp((Math.log(6.4) / 27) * (mel - minLogMel));
};

/**
 * Triangular filterbank, built once and reused for every track.
 *
 * The triangles are laid out in HERTZ between mel-spaced corners, which is what torchaudio does -
 * not in the mel domain, where they would be symmetric. Same corners, different slopes.
 */
const buildFilterbank = (): Float64Array[] => {
    const bins = N_FFT / 2 + 1;
    const melMin = hzToMel(F_MIN);
    const melMax = hzToMel(F_MAX);
    const corners = Array.from({ length: N_MELS + 2 }, (_, index) =>
        melToHz(melMin + ((melMax - melMin) * index) / (N_MELS + 1)));

    // One row per mel band rather than per FFT bin: the inner loop of the transform walks a band's
    // own bins, so this is the layout that reads sequentially.
    return Array.from({ length: N_MELS }, (_, band) => {
        const row = new Float64Array(bins);
        const [left, centre, right] = [corners[band], corners[band + 1], corners[band + 2]];
        for (let bin = 0; bin < bins; bin += 1) {
            const hz = (bin * BEAT_THIS_SAMPLE_RATE) / N_FFT;
            const rising = centre === left ? 0 : (hz - left) / (centre - left);
            const falling = right === centre ? 0 : (right - hz) / (right - centre);
            row[bin] = Math.max(0, Math.min(rising, falling));
        }
        return row;
    });
};

let filterbank: Float64Array[] | null = null;
/**
 * Periodic Hann, the STFT convention - `size`, not `size - 1`, in the denominator.
 *
 * Not called `window`: that shadows the global one, and the only symptom is that the model call
 * further down silently stops finding the bridge.
 */
let hann: Float64Array | null = null;

export interface MelSpectrogram {
    /** Frames × 128, row-major, ready to hand to the model as [1, frames, 128]. */
    data: Float32Array;
    frames: number;
}


/**
 * The log-mel spectrogram Beat This! was trained on.
 *
 * Centred like `torch.stft(center=True, pad_mode='reflect')`: the signal is reflected by half a
 * window at each end so frame `i` is centred on sample `i * HOP` rather than starting there. Load-
 * bearing, not cosmetic - without it every beat returns half a window (23ms) late, which is most of
 * the tolerance the whole grid is judged on.
 *
 * Async for the same reason `analyseTrack` is, and not optional: in the renderer this is 682ms in ONE
 * block on a four-minute track, 1017ms on a six-minute one - not a slow function but a frozen window
 * (lyrics stop, visualiser stops) once per analysed track. `analyseTrack` had been through this and
 * carries the fix; this arrived later without it, which is how a closed stutter came back.
 */
export const melSpectrogram = async (mono: Float32Array): Promise<MelSpectrogram> => {
    if (!filterbank) filterbank = buildFilterbank();
    if (!hann) {
        hann = new Float64Array(N_FFT);
        for (let index = 0; index < N_FFT; index += 1) {
            hann[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / N_FFT));
        }
    }

    const pad = N_FFT / 2;
    const padded = new Float64Array(mono.length + 2 * pad);
    for (let index = 0; index < pad; index += 1) {
        // Reflect without repeating the edge sample, which is numpy's 'reflect' and torch's default.
        padded[index] = mono[Math.min(pad - index, mono.length - 1)];
        padded[padded.length - 1 - index] = mono[Math.max(0, mono.length - 1 - (pad - index))];
    }
    padded.set(mono, pad);

    const frames = Math.floor((padded.length - N_FFT) / HOP) + 1;
    if (frames <= 0) return { data: new Float32Array(0), frames: 0 };

    const data = new Float32Array(frames * N_MELS);
    const real = new Float64Array(N_FFT);
    const imag = new Float64Array(N_FFT);
    const magnitude = new Float64Array(N_FFT / 2 + 1);
    // torchaudio normalises the transform by the square root of the window length.
    const scale = 1 / Math.sqrt(N_FFT);

    let yieldBy = performance.now() + YIELD_BUDGET_MS;
    for (let frame = 0; frame < frames; frame += 1) {
        // Checked per frame rather than per N frames: one frame is a 1024-point transform plus 128
        // band sums, which is a fixed and small amount of work, so a time budget spends exactly as
        // long as it says on any machine. A frame COUNT is the thing that turned out not to be an
        // amount of work the last time this bug was fixed - see YIELD_BUDGET_MS in uiYield.
        if (performance.now() >= yieldBy) {
            await yieldToUi();
            yieldBy = performance.now() + YIELD_BUDGET_MS;
        }
        const start = frame * HOP;
        for (let index = 0; index < N_FFT; index += 1) {
            real[index] = padded[start + index] * hann[index];
            imag[index] = 0;
        }
        fft(real, imag);
        for (let bin = 0; bin < magnitude.length; bin += 1) {
            magnitude[bin] = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]) * scale;
        }
        for (let band = 0; band < N_MELS; band += 1) {
            const row = filterbank[band];
            let energy = 0;
            for (let bin = 0; bin < magnitude.length; bin += 1) energy += magnitude[bin] * row[bin];
            data[frame * N_MELS + band] = Math.log1p(LOG_MULTIPLIER * Math.max(energy, AMIN));
        }
    }
    return { data, frames };
};

export interface BeatGrid {
    /** Every beat, in seconds. */
    beats: number[];
    /** The subset of those beats that start a bar. Always a subset - see `snapped` below. */
    downbeats: number[];
}

/**
 * Merges peaks that landed within `width` frames of each other, keeping their running mean.
 *
 * The model can fire on two adjacent frames for one beat; taking both would put a phantom beat 20ms
 * from a real one, and taking the first would bias every such beat early.
 */
const deduplicate = (peaks: number[], width: number): number[] => {
    if (!peaks.length) return [];
    const merged: number[] = [];
    let mean = peaks[0];
    let count = 1;
    for (let index = 1; index < peaks.length; index += 1) {
        const peak = peaks[index];
        if (peak - mean <= width) {
            count += 1;
            mean += (peak - mean) / count;
        } else {
            merged.push(Math.round(mean));
            mean = peak;
            count = 1;
        }
    }
    merged.push(Math.round(mean));
    return merged;
};

/**
 * Beat This!'s own post-processing, which is the point of the paper: no DBN.
 *
 * A dynamic Bayesian network is what every previous tracker used to turn frame scores into beats,
 * and it works by imposing a tempo and a metre - exactly the assumptions our own `estimateDownbeat`
 * dies on. Here a beat is simply a local maximum over seven frames that is also positive, which
 * imposes nothing at all. Keep it that way: any smoothing added here reintroduces the assumption
 * the model was built to avoid.
 */
export const beatsFromLogits = (
    beatLogits: Float32Array | readonly number[],
    downbeatLogits: Float32Array | readonly number[],
    fps = BEAT_THIS_FPS,
): BeatGrid => {
    const pick = (logits: Float32Array | readonly number[]): number[] => {
        const peaks: number[] = [];
        for (let index = 0; index < logits.length; index += 1) {
            const value = logits[index];
            if (!(value > 0)) continue;
            let isPeak = true;
            for (let offset = -3; offset <= 3 && isPeak; offset += 1) {
                const other = index + offset;
                if (other >= 0 && other < logits.length && logits[other] > value) isPeak = false;
            }
            if (isPeak) peaks.push(index);
        }
        return deduplicate(peaks, 1);
    };

    const beats = pick(beatLogits).map(frame => frame / fps);
    const downbeats = pick(downbeatLogits).map(frame => frame / fps);
    if (!beats.length) return { beats, downbeats: [] };

    // A downbeat IS a beat, so each one is moved onto the nearest one rather than left a frame or
    // two off it. Two heads reading the same audio disagree by a frame often enough that leaving
    // them apart would put a bar line 20ms off its own beat - and everything downstream measures
    // the distance between the two grids.
    const snapped = downbeats.map((time) => {
        let best = beats[0];
        for (const beat of beats) {
            if (Math.abs(beat - time) < Math.abs(best - time)) best = beat;
        }
        return best;
    });
    return { beats, downbeats: [...new Set(snapped)].sort((a, b) => a - b) };
};

/**
 * Frames the model will accept in one call. Thirty seconds at 50fps.
 *
 * Not a batching convenience - the export refuses anything longer, which is how this was found:
 * a whole four-minute track returns `invalid expand shape` from inside the attention block, not a
 * wrong answer. Chunking is also what the official Python inference does, so it is the only way to
 * reproduce the reference output at all.
 */
export const MODEL_CHUNK_FRAMES = 1500;
/**
 * Frames discarded from each end of every chunk's prediction.
 *
 * A frame near a chunk edge has only half its context, and the model is a transformer over the
 * whole window - so its answer there is worse than the same frame's answer from the neighbouring
 * chunk, where it sits in the middle. The chunks overlap by twice this and each keeps only its
 * confident middle.
 */
const BORDER_FRAMES = 6;

export interface MelChunk {
    /** Up to MODEL_CHUNK_FRAMES × 128, zero-padded where the chunk runs off either end. */
    data: Float32Array;
    frames: number;
    /** Frame index in the whole piece of this chunk's first row. Negative before the start. */
    start: number;
}

/** Where each chunk begins, following the reference implementation exactly. */
const chunkStarts = (frames: number): number[] => {
    const stride = MODEL_CHUNK_FRAMES - 2 * BORDER_FRAMES;
    const starts: number[] = [];
    for (let start = -BORDER_FRAMES; start < frames - BORDER_FRAMES; start += stride) {
        starts.push(start);
    }
    if (!starts.length) return [-BORDER_FRAMES];
    // "avoid_short_end": rather than let the last chunk be a stub with almost no context, it is
    // pulled back to end flush with the piece. It then overlaps its predecessor by more than the
    // border, which the keep-first aggregation below already handles.
    if (frames > stride) starts[starts.length - 1] = frames - (MODEL_CHUNK_FRAMES - BORDER_FRAMES);
    return starts;
};

export const splitForModel = (mel: MelSpectrogram): MelChunk[] => {
    if (!mel.frames) return [];
    return chunkStarts(mel.frames).map((start) => {
        const from = Math.max(0, start);
        const to = Math.min(start + MODEL_CHUNK_FRAMES, mel.frames);
        const leftPad = Math.max(0, -start);
        const rightPad = Math.max(0, Math.min(BORDER_FRAMES, start + MODEL_CHUNK_FRAMES - mel.frames));
        const frames = leftPad + Math.max(0, to - from) + rightPad;
        const data = new Float32Array(frames * 128);
        if (to > from) data.set(mel.data.subarray(from * 128, to * 128), leftPad * 128);
        return { data, frames, start };
    });
};

export interface ChunkPrediction {
    start: number;
    frames: number;
    beat: Float32Array;
    downbeat: Float32Array;
}

/**
 * Stitches the chunks back into one prediction per frame of the piece.
 *
 * Earlier chunks win where two overlap, which is the reference's "keep_first". The order matters
 * only for the pulled-back last chunk, whose overlap is larger than the border.
 */
export const aggregateChunks = (
    predictions: readonly ChunkPrediction[],
    frames: number,
): { beat: Float32Array; downbeat: Float32Array } => {
    // Below any threshold the peak picker uses, so a frame no chunk covered can never be a beat.
    const beat = new Float32Array(frames).fill(-1000);
    const downbeat = new Float32Array(frames).fill(-1000);
    for (let index = predictions.length - 1; index >= 0; index -= 1) {
        const chunk = predictions[index];
        const wide = chunk.frames >= 2 * BORDER_FRAMES;
        const from = wide ? BORDER_FRAMES : 0;
        const to = wide ? chunk.frames - BORDER_FRAMES : chunk.frames;
        for (let offset = from; offset < to; offset += 1) {
            const target = chunk.start + offset;
            if (target < 0 || target >= frames) continue;
            beat[target] = chunk.beat[offset];
            downbeat[target] = chunk.downbeat[offset];
        }
    }
    return { beat, downbeat };
};

/** Seconds of the tail the outgoing tempo is read over. Matches the profile's own window. */
const OUTRO_WINDOW_SEC = 30;
/** Fewest beats worth fitting a grid to. Below this a median interval is one number, not a tempo. */
const MIN_BEATS = 8;

const modulo = (value: number, span: number) => ((value % span) + span) % span;

const median = (values: readonly number[]): number => {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const intervals = (times: readonly number[]): number[] => {
    const out: number[] = [];
    for (let index = 1; index < times.length; index += 1) out.push(times[index] - times[index - 1]);
    return out;
};

/** The profile's grid fields, in the shape `analyseTrack` returns them. */
export interface BeatThisGrid {
    bpm: number;
    outroBpm: number | null;
    beatOffset: number;
    downbeatOffset: number | null;
    headDownbeatOffset: number | null;
    beatsPerBar: number;
}

/**
 * Folds a list of real beat times into the uniform `{offset, period}` grid everything downstream
 * speaks.
 *
 * Some accuracy is given up, worth naming: the model returns where each beat ACTUALLY is, and a track
 * that drifts has no single period. But `barGrid`, `snapToGrid` and `alignEntry` all take an offset
 * and a period, and measured bar jitter on a real library is under one percent of a bar - so a
 * uniform fit costs a couple of milliseconds while a representation change would touch every consumer.
 * Revisit only if something downstream starts caring about drift.
 *
 * The MEDIAN interval, not the mean: a missed beat produces one interval of twice the period, which a
 * mean would spread across the whole track and the median does not notice.
 *
 * Anchored on the LAST beat for the same reason the estimator it replaces is - the outgoing track is
 * what a handover is scheduled against, and that is its end. `headDownbeatOffset` is the same bar line
 * measured at the other end, for the incoming side.
 */
export const gridFromBeats = (
    grid: BeatGrid,
    options: { partial?: boolean } = {},
): BeatThisGrid | null => {
    if (grid.beats.length < MIN_BEATS) return null;
    const period = median(intervals(grid.beats));
    if (!Number.isFinite(period) || period <= 0) return null;

    const last = grid.beats[grid.beats.length - 1];
    const beatOffset = modulo(last, period);

    // Beats to the bar, counted rather than assumed - the one place a 3/4 track can announce itself.
    const spans = intervals(grid.downbeats).map(span => Math.round(span / period));
    const perBar = Math.round(median(spans.filter(span => span >= 2 && span <= 12)));
    const beatsPerBar = Number.isFinite(perBar) && perBar >= 2 ? perBar : 4;
    const barSec = period * beatsPerBar;

    const outroFrom = last - OUTRO_WINDOW_SEC;
    const outroBeats = grid.beats.filter(beat => beat >= outroFrom);
    const outroPeriod = outroBeats.length >= MIN_BEATS ? median(intervals(outroBeats)) : NaN;

    return {
        bpm: 60 / period,
        // Null on a partial profile for the same reason every other tail field is: the end of a
        // truncated file describes the truncation.
        outroBpm: options.partial || !Number.isFinite(outroPeriod) || outroPeriod <= 0
            ? null
            : 60 / outroPeriod,
        beatOffset,
        downbeatOffset: grid.downbeats.length
            ? modulo(grid.downbeats[grid.downbeats.length - 1], barSec)
            : null,
        headDownbeatOffset: grid.downbeats.length ? modulo(grid.downbeats[0], barSec) : null,
        beatsPerBar,
    };
};

/**
 * Whether this build can run the model right now.
 *
 * Two questions, and answering fewer than both is how a settings page promises something it cannot
 * do: the bridge only exists in Electron (a web build is permanently on the built-in estimator and
 * should say so rather than appear broken), and the model's weights have to be on disk, which
 * `modelCanRun` answers.
 */
export const canRunBeatThis = (): boolean =>
    typeof window !== 'undefined'
    && typeof window.electron?.runBeatThis === 'function'
    && modelCanRun('beat_this');

/**
 * The whole Beat This! pass: spectrogram in, beat grid out.
 *
 * Takes the spectrogram rather than the samples because making one is a second and a half of FFT and
 * belongs off this thread, while the line below is an IPC call that cannot leave it. So the caller
 * must check `canRunBeatThis` BEFORE paying for a spectrogram - the guard here is a backstop now, not
 * the thing that saves the work.
 *
 * Null whenever the model is not there, which is not an error - the browser build, and any desktop
 * install whose weights are missing. Every caller must treat null as "use the estimator you already
 * had", the only answer in those environments.
 *
 * Verified against the official Python inference on thirty tracks from the user's own library:
 * beat and downbeat F-measure 1.0000, mean offset 0.00 ms, identical beat counts on every track.
 * If that ever stops being true, the cause is in the spectrogram or the chunking above, not here.
 */
export const analyseBeatGrid = async (mel: MelSpectrogram): Promise<BeatGrid | null> => {
    const run = typeof window !== 'undefined' ? window.electron?.runBeatThis : undefined;
    if (!canRunBeatThis() || typeof run !== 'function') return null;

    const chunks = splitForModel(mel);
    if (!chunks.length) return null;

    const logits = await run(chunks.map(({ data, frames }) => ({ data, frames })));
    if (!logits || logits.beat.length !== chunks.length) {
        // Nothing usable came back. Not remembered as a failure - the same empty answer arrives when
        // the weights were just deleted or the worker was restarted under this request - so this only
        // re-checks disk, and the caller falls back to its own estimator.
        await noteModelFailed('beat_this');
        return null;
    }

    const predictions: ChunkPrediction[] = chunks.map((chunk, index) => ({
        start: chunk.start,
        frames: chunk.frames,
        beat: logits.beat[index],
        downbeat: logits.downbeat[index],
    }));
    const track = aggregateChunks(predictions, mel.frames);
    return beatsFromLogits(track.beat, track.downbeat);
};
