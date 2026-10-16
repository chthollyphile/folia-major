import { getFromCache, saveToCache } from '../db';
import { melSpectrogramOffThread } from '../automix/analysisOffThread';
import { analyseBeatGrid, canRunBeatThis, type BeatGrid, type BeatThisModel } from './beatThis';
import { BEAT_GRID_PREFIXES } from './beatGridKeys';

// src/services/analysis/beatGrid.ts
// A whole track's beats from Beat This!, run once and kept: on disk under the track's analysis key,
// and in flight for as long as one run is going.
//
// Two features want them and neither should pay twice. Automix's profile keeps only the collapsed
// `{offset, period}` grid, while 智能动感模式 needs every beat and downbeat; whichever asks
// first runs the model and stores the list, and the other reads it - or, if it asks while the run is
// still going, waits for that run instead of decoding and inferring the same track beside it. It is
// also what lets a replayed track have beat FX from its first second.
//
// Only whole tracks belong here: automix may measure just the head of a track that is still
// streaming, and a beat list that stops at twelve seconds would leave the FX silent for the rest.
// Such a caller runs `analyseBeatGrid` itself and stores nothing.
//
// Kept per model. Automix runs final0; the beat FX (智能动感模式) run small0, which ships with the app, and
// agrees with final0 on most beats but not every downbeat. A list from one is never read, filed or
// joined as the other's: automix would otherwise build transitions on small0's downbeats, and the
// beat FX would land differently on a track depending on whether automix had seen it.
//
// Both key prefixes (beatGridKeys.ts) are registered in services/repositories/cacheRepository.ts as
// analysis data, so "clear analysis cache" clears these with the profiles they feed.

/** Bumped when the model, the spectrogram or the peak picking changes what a track's beats are. */
const BEAT_GRID_VERSION = 1;

interface StoredBeatGrid {
    version: number;
    beats: number[];
    downbeats: number[];
}

const storageKey = (key: string, model: BeatThisModel) => `${BEAT_GRID_PREFIXES[model]}${key}`;

const isTimeList = (value: unknown): value is number[] =>
    Array.isArray(value) && value.every(time => typeof time === 'number' && Number.isFinite(time));

/** The stored whole-track beat list for this analysis key and model, or null. */
export const readStoredBeatGrid = async (key: string, model: BeatThisModel = 'beat_this'): Promise<BeatGrid | null> => {
    const stored = await getFromCache<StoredBeatGrid>(storageKey(key, model));
    if (!stored || stored.version !== BEAT_GRID_VERSION) return null;
    if (!isTimeList(stored.beats) || !isTimeList(stored.downbeats) || !stored.beats.length) return null;
    return { beats: stored.beats, downbeats: stored.downbeats };
};

/** Stores a whole-track beat list; an empty one is not worth keeping. */
export const storeBeatGrid = async (key: string, grid: BeatGrid, model: BeatThisModel = 'beat_this'): Promise<void> => {
    if (!grid.beats.length) return;
    const entry: StoredBeatGrid = { version: BEAT_GRID_VERSION, beats: [...grid.beats], downbeats: [...grid.downbeats] };
    await saveToCache(storageKey(key, model), entry);
};

interface Run {
    grid: Promise<BeatGrid | null>;
    cpuFallback: boolean;
}

const running = new Map<string, Run>();

export interface TrackBeatGridOptions {
    /**
     * Whether the CPU may take what the GPU cannot (see `analyseBeatGrid`). A caller that may not
     * can still be handed a list an earlier CPU run stored; it just never starts one. Ignored for
     * small0, which only the GPU runs.
     */
    cpuFallback?: boolean;
    /** Which model's list: final0 (the default, automix's) or the bundled small0 (the beat FX'). */
    model?: BeatThisModel;
}

/**
 * A whole track's beats: stored, joined from a run in flight, or run now. Null when the model could
 * not answer; a grid with no beats when it answered "none".
 *
 * `readMid` is called only when the model actually has to run - a stored list or a joined run never
 * decodes anything. It answers the track's mono (mid) samples at the Beat This! rate, or null when
 * they cannot be had, which is not remembered: a later call may find the bytes.
 *
 * A GPU-only run that came back null does not answer a caller allowed the CPU; that caller runs again
 * with the fallback, which is the one case two runs of a track can follow each other.
 */
export const getTrackBeatGrid = async (
    key: string,
    readMid: () => Promise<Float32Array | null>,
    { cpuFallback: wantsCpu = false, model = 'beat_this' }: TrackBeatGridOptions = {},
): Promise<BeatGrid | null> => {
    const cpuFallback = model === 'beat_this' && wantsCpu;
    const stored = await readStoredBeatGrid(key, model);
    if (stored) return stored;

    const runKey = `${model}:${key}`;
    const joined = running.get(runKey);
    if (joined) {
        const grid = await joined.grid;
        if (grid || joined.cpuFallback || !cpuFallback) return grid;
    }
    if (!canRunBeatThis(model)) return null;

    const grid = (async () => {
        const mid = await readMid();
        if (!mid) return null;
        const found = await analyseBeatGrid(await melSpectrogramOffThread(mid), { cpuFallback, model });
        if (found) await storeBeatGrid(key, found, model);
        return found;
    })();
    const run: Run = { grid, cpuFallback };
    running.set(runKey, run);
    try {
        return await grid;
    } finally {
        if (running.get(runKey) === run) running.delete(runKey);
    }
};
