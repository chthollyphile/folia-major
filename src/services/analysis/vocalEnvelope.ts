import { MEL_BANDS, type MelSpectrogram } from './beatThis';
import { getFromCache, saveToCache } from '../db';
import { VOCAL_ENVELOPE_PREFIX } from './beatGridKeys';

// src/services/analysis/vocalEnvelope.ts
// A track's vocal envelope off htdemucs' vocal stem: how loud the singing is, frame by frame, and
// where each sung syllable starts. 雾笺 (Nebbia) drops its rain on it: the louder the voice, the
// more small drops hit the glass, and a big one on every onset.
//
// The stem comes from the track's stem run (trackStemRun.ts), the one the drum hits read: htdemucs
// gives back all four stems for every segment anyway, so the vocal task (vocalStemRun.ts) reads the
// fourth off the segments the drums are separated for, and the GPU runs no more than it did. Its features are read a stretch at a time as
// the stem is finished (vocalStream.ts: two numbers a frame, the samples let go), and the envelope is
// made of them once the whole stretch is in (`vocalEnvelopeOfFeatures`) - there is no live head as for
// the drum hits, as the loudness is read against the track's own top - and stored under the track's
// analysis key (VOCAL_ENVELOPE_PREFIX, in the 分析 cache beside the drum hits).
//
// The features are the ones the prototype's data was made of (the user's vocal-fx-demo, 50 fps):
// - `db`: RMS level in dB over 40 ms, centred on every frame (a frame every 20 ms).
// - `top`: the track's loud singing, the 97th percentile of `db`.
// - `onsets`: spectral flux of the stem's beat_this spectrogram (the drum hits' frames), peaks above
//   their own neighbourhood, over a floor below `top`, where the level is not falling away (a note
//   let go splatters across the spectrum too). Checked against that data on its three stems
//   (2026-10-28): the level within 0.04-0.14 dB on average, `top` within 0.2 dB, and 80-90% of its
//   onsets found within 40 ms, 83-98% of these onsets among its.
//
// An envelope can start part way (`from`, a frame): 雾笺 switched to mid-track separates the voice from
// the playhead on (vocalStemRun.ts' `vocalStartFor`), the head before it being zeros. `top`, the flux's spread
// and the onsets are then read from `from` on - a few frames in from where the stem is whole, as the
// level's window and the spectrogram's reach back across it, and the step from silence is a flux peak
// of its own. Such an envelope is kept for the play but not stored: the stored one is the whole track's,
// from a play that separates the voice from the start.

/** beat_this' frame rate (BEAT_THIS_FPS), spelled out: read at load, where a test may stand in for beatThis.ts. */
export const VOCAL_FPS = 50;

export interface VocalEnvelope {
    fps: number;
    /** Level per frame, dB. */
    db: Float32Array;
    /** The track's loud singing, dB: the 97th percentile of `db`. */
    top: number;
    /** Frames where a sung syllable starts, ascending. */
    onsets: Uint32Array;
    /** The first frame read (see the header): before it the stem was not separated. Missing for the whole track. */
    from?: number;
}

/** Samples per frame at 44.1 kHz (20 ms), and the level's window: one frame either side. */
const FRAME = 882;
const TOP_SHARE = 0.97;
/** Below `top` minus this it is not singing: no onset there (the prototype's floor). */
const SINGING_DB = 28;
/** A peak is the highest of PEAK_REACH frames either side... */
const PEAK_REACH = 3;
/** ...above the mean from AVERAGE_BEFORE frames before to PEAK_REACH after, by ONSET_DELTA flux deviations. */
const AVERAGE_BEFORE = 10;
const ONSET_DELTA = 0.7;
/** The level falling by more than this across a frame's neighbours: a release, not an onset. */
const FALLING_DB = 3;
/** Onsets at least this many frames apart (60 ms). */
const ONSET_GAP = 3;
/** Frames past the first whole sample before an envelope starting part way is read (see the header). */
const FROM_MARGIN = 2;

/** RMS dB per frame of a 44.1 kHz mono stem, over the frame's 40 ms around it. */
export const vocalLevels = (stem: Float32Array, frames = Math.ceil(stem.length / FRAME)): Float32Array => {
    const db = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
        const from = frame * FRAME - FRAME;
        let sum = 0;
        for (let at = Math.max(0, from); at < Math.min(stem.length, from + 2 * FRAME); at += 1) sum += stem[at] * stem[at];
        db[frame] = 10 * Math.log10(sum / (2 * FRAME) + 1e-12);
    }
    return db;
};

/** The value at `share` of the sorted values. */
const quantile = (values: Float32Array, share: number): number => {
    if (!values.length) return -120;
    const sorted = values.slice().sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

/** The mean rise of the spectrogram's bands from row `before` to row `at` of `data` (the positive spectral flux). */
export const fluxBetween = (data: Float32Array, at: number, beforeData: Float32Array, before: number): number => {
    let sum = 0;
    for (let band = 0; band < MEL_BANDS; band += 1) {
        const rise = data[at * MEL_BANDS + band] - beforeData[before * MEL_BANDS + band];
        if (rise > 0) sum += rise;
    }
    return sum / MEL_BANDS;
};

/** Positive spectral flux per frame: the mean rise of the spectrogram's bands from the frame before. */
const spectralFlux = (mel: MelSpectrogram): Float32Array => {
    const flux = new Float32Array(mel.frames);
    for (let frame = 1; frame < mel.frames; frame += 1) flux[frame] = fluxBetween(mel.data, frame, mel.data, frame - 1);
    return flux;
};

/**
 * Onset frames: a flux peak (the highest within PEAK_REACH either side), clear of the local mean by
 * ONSET_DELTA of the flux's deviation, while singing (`db` over `top` - SINGING_DB), ONSET_GAP apart.
 */
export const pickVocalOnsets = (flux: Float32Array, db: Float32Array, top: number, from = 0): Uint32Array => {
    const n = Math.min(flux.length, db.length);
    // Part way, the flux of the frame at `from` is the step from silence: its spread is read after it.
    const first = from > 0 ? from + 1 : 0;
    const count = Math.max(1, n - first);
    let mean = 0;
    for (let at = first; at < n; at += 1) mean += flux[at];
    mean /= count;
    let variance = 0;
    for (let at = first; at < n; at += 1) variance += (flux[at] - mean) ** 2;
    const delta = ONSET_DELTA * Math.sqrt(variance / count);
    const onsets: number[] = [];
    let last = -Infinity;
    for (let frame = from > 0 ? first + AVERAGE_BEFORE : PEAK_REACH; frame < n - PEAK_REACH; frame += 1) {
        if (db[frame] <= top - SINGING_DB || frame - last < ONSET_GAP) continue;
        // A note let go splatters across the spectrum as it falls: an onset is where the level holds or rises.
        if (db[frame + 1] < db[frame - 1] - FALLING_DB) continue;
        let peak = true;
        for (let at = frame - PEAK_REACH; at <= frame + PEAK_REACH && peak; at += 1) peak = flux[at] <= flux[frame];
        if (!peak) continue;
        let local = 0;
        const from = Math.max(0, frame - AVERAGE_BEFORE);
        for (let at = from; at <= frame + PEAK_REACH; at += 1) local += flux[at];
        if (flux[frame] < local / (frame + PEAK_REACH + 1 - from) + delta) continue;
        onsets.push(frame);
        last = frame;
    }
    return Uint32Array.from(onsets);
};

/**
 * The envelope of a 44.1 kHz mono vocal stem and its beat_this spectrogram (22.05 kHz, 50 fps), whole
 * from sample `wholeFrom` on (0: the whole track; see the header).
 */
export const vocalEnvelopeOf = (stem: Float32Array, mel: MelSpectrogram, wholeFrom = 0): VocalEnvelope => {
    const db = vocalLevels(stem, mel.frames);
    const from = wholeFrom > 0 ? Math.min(db.length, Math.ceil(wholeFrom / FRAME) + FROM_MARGIN) : 0;
    return vocalEnvelopeOfFeatures(db, spectralFlux(mel), from);
};

/**
 * The envelope of a stem's level `db` and flux per frame, read from frame `from` on (0: the whole
 * track; see the header): `db` before it is set to silence.
 */
export const vocalEnvelopeOfFeatures = (db: Float32Array, flux: Float32Array, from: number): VocalEnvelope => {
    if (from > 0) db.fill(-120, 0, from);
    const top = quantile(db.subarray(from), TOP_SHARE);
    const onsets = pickVocalOnsets(flux, db, top, from);
    return from > 0 ? { fps: VOCAL_FPS, db, top, onsets, from } : { fps: VOCAL_FPS, db, top, onsets };
};

const isVocalEnvelope = (value: unknown): value is VocalEnvelope => {
    const entry = value as VocalEnvelope | null;
    return Boolean(entry && entry.fps === VOCAL_FPS && entry.db instanceof Float32Array
        && entry.onsets instanceof Uint32Array && Number.isFinite(entry.top) && !entry.from);
};

/** Per key, the envelopes read this session, the most recent kept. */
const envelopes = new Map<string, VocalEnvelope>();
const MAX_TRACKS = 8;

const keep = (key: string, envelope: VocalEnvelope) => {
    envelopes.delete(key);
    envelopes.set(key, envelope);
    while (envelopes.size > MAX_TRACKS) {
        const oldest = envelopes.keys().next().value;
        if (oldest === undefined) break;
        envelopes.delete(oldest);
    }
};

/** The vocal envelope of `key` once it is in, or null. */
export const getVocalEnvelope = (key: string | null): VocalEnvelope | null => (key ? envelopes.get(key) ?? null : null);

/** Keeps a freshly read envelope, and stores it when it is the whole track's (see the header). */
export const rememberVocalEnvelope = async (key: string, envelope: VocalEnvelope): Promise<void> => {
    keep(key, envelope);
    const part = envelope.from ? ` | from ${(envelope.from / envelope.fps).toFixed(1)}s, not stored` : '';
    console.info(`[VocalEnvelope] ${key}: ${envelope.onsets.length} onsets | top ${envelope.top.toFixed(1)} dB${part}`);
    if (!envelope.from) await saveToCache(`${VOCAL_ENVELOPE_PREFIX}${key}`, envelope);
};

/** The stored envelope of `key` (kept for `getVocalEnvelope`), or null when none is stored. */
export const loadStoredVocalEnvelope = async (key: string): Promise<VocalEnvelope | null> => {
    const known = envelopes.get(key);
    if (known) return known;
    try {
        const stored = await getFromCache<VocalEnvelope>(`${VOCAL_ENVELOPE_PREFIX}${key}`);
        if (!isVocalEnvelope(stored)) return null;
        keep(key, stored);
        return stored;
    } catch (error) {
        console.warn(`[VocalEnvelope] ${key}: cache read failed`, error);
        return null;
    }
};
