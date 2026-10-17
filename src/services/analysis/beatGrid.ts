import { getFromCache, saveToCache } from '../db';
import { melSpectrogramOffThread } from '../automix/analysisOffThread';
import { analyseBeatGrid, canRunBeatThis, type BeatGrid, type BeatThisModel } from './beatThis';
import { runPercussiveEnergyGpu } from './beatThisGpu';
import { BEAT_GRID_PREFIXES } from './beatGridKeys';
import { computeBeatAccents, formatBeatMeter, isBeatAccents, resolveBeatConfidence, type BeatAccents, type BeatMeter } from './beatAccents';

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
// small0's list also carries the beats' accents (beatAccents.ts) - how hard and how low or high each
// one hits - measured on the same spectrogram in the same run. They are an optional field: a list
// stored before they existed stays valid, and `getTrackBeatAccents` fills them in later. final0's
// lists never carry them; automix does not read them.
//
// Both key prefixes (beatGridKeys.ts) are registered in services/repositories/cacheRepository.ts as
// analysis data, so "clear analysis cache" clears these with the profiles they feed.

/** Bumped when the model, the spectrogram or the peak picking changes what a track's beats are. */
const BEAT_GRID_VERSION = 1;

interface StoredBeatGrid {
    version: number;
    beats: number[];
    downbeats: number[];
    accents?: BeatAccents;
}

/** A beat list, with small0's accents when they have been measured. */
export interface AccentedBeatGrid extends BeatGrid {
    accents?: BeatAccents;
}

const storageKey = (key: string, model: BeatThisModel) => `${BEAT_GRID_PREFIXES[model]}${key}`;

const isTimeList = (value: unknown): value is number[] =>
    Array.isArray(value) && value.every(time => typeof time === 'number' && Number.isFinite(time));

/**
 * The stored whole-track beat list for this analysis key and model, or null. Accents that do not fit
 * the list (another version, another length) are left off rather than failing the beats.
 */
export const readStoredBeatGrid = async (key: string, model: BeatThisModel = 'beat_this'): Promise<AccentedBeatGrid | null> => {
    const stored = await getFromCache<StoredBeatGrid>(storageKey(key, model));
    if (!stored || stored.version !== BEAT_GRID_VERSION) return null;
    if (!isTimeList(stored.beats) || !isTimeList(stored.downbeats) || !stored.beats.length) return null;
    const grid: AccentedBeatGrid = { beats: stored.beats, downbeats: stored.downbeats };
    if (model === 'beat_this_small' && isBeatAccents(stored.accents, stored.beats.length)) grid.accents = stored.accents;
    return grid;
};

/** Stores a whole-track beat list; an empty one is not worth keeping. Accents only for small0. */
export const storeBeatGrid = async (key: string, grid: AccentedBeatGrid, model: BeatThisModel = 'beat_this'): Promise<void> => {
    if (!grid.beats.length) return;
    const entry: StoredBeatGrid = { version: BEAT_GRID_VERSION, beats: [...grid.beats], downbeats: [...grid.downbeats] };
    if (model === 'beat_this_small' && grid.accents && isBeatAccents(grid.accents, grid.beats.length)) entry.accents = grid.accents;
    await saveToCache(storageKey(key, model), entry);
};

interface Run {
    grid: Promise<AccentedBeatGrid | null>;
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
): Promise<AccentedBeatGrid | null> => {
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
        const mel = await melSpectrogramOffThread(mid);
        const small = model === 'beat_this_small';
        // small0 also has the GPU measure the spectrogram's percussive energy, for the accents' gate.
        const analysed = await analyseBeatGrid(mel, { cpuFallback, model, percussive: small });
        // The energy is only an input: the grid kept and handed on is the beats alone.
        const grid: BeatGrid | null = analysed ? { beats: analysed.beats, downbeats: analysed.downbeats } : null;
        // The accents ride on the spectrogram the beats were found on: a few ms, no second decode.
        const found: AccentedBeatGrid | null = grid?.beats.length && small
            ? {
                ...grid,
                accents: computeBeatAccents(mel, grid.beats, grid.downbeats, analysed?.percussive ?? null, {
                    confidence: analysed?.beatLogits ? resolveBeatConfidence(analysed.beatLogits, grid.beats) : null,
                    onMeter: logBeatMeter(key),
                }),
            }
            : grid;
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

/**
 * Logs how a track's bars read once its accents are measured - the model's tempo, its bar lengths,
 * the rise by bar position and whether only every few beats fire - so a track whose beat FX feel off
 * can be looked at from the console log alone. The key is the track's id, no URL or account data.
 */
const logBeatMeter = (key: string) => (meter: BeatMeter, pulse: readonly number[]) => {
    console.info(`[BeatMeter] ${key}: ${formatBeatMeter(meter, pulse)}`);
};

const accentRuns = new Map<string, Promise<BeatAccents | null>>();

/**
 * small0's accents for a stored list that has none - one stored before they existed. Decodes and
 * transforms the track again (on the worker), runs small0 again on the GPU for its percussive energy
 * and its confidence in each stored beat (the beats themselves are already known), measures, and
 * stores the list back with them. Null when the bytes cannot be had, which is not remembered: a later
 * play may find them. Concurrent callers for one key share the run.
 */
export const getTrackBeatAccents = (
    key: string,
    grid: BeatGrid,
    readMid: () => Promise<Float32Array | null>,
): Promise<BeatAccents | null> => {
    const running = accentRuns.get(key);
    if (running) return running;
    const run = (async () => {
        const mid = await readMid();
        if (!mid) return null;
        const mel = await melSpectrogramOffThread(mid);
        // small0 again for its logits at the stored beats and the percussive energy (~0.5 s on the
        // GPU, once per track); when it cannot run, the energy alone, and null leaves every beat rhythmic.
        const analysed = await analyseBeatGrid(mel, { model: 'beat_this_small', percussive: true });
        const energy = analysed?.percussive ?? (analysed ? null : await runPercussiveEnergyGpu(mel));
        const accents = computeBeatAccents(mel, grid.beats, grid.downbeats, energy, {
            confidence: analysed?.beatLogits ? resolveBeatConfidence(analysed.beatLogits, grid.beats) : null,
            onMeter: logBeatMeter(key),
        });
        // Stored against the list now on disk, so a list replaced meanwhile is not given another's accents.
        const stored = await readStoredBeatGrid(key, 'beat_this_small');
        if (stored && stored.beats.length === grid.beats.length && stored.beats.every((time, index) => time === grid.beats[index])) {
            await storeBeatGrid(key, { ...stored, accents }, 'beat_this_small');
        }
        return accents;
    })();
    accentRuns.set(key, run);
    void run.finally(() => {
        if (accentRuns.get(key) === run) accentRuns.delete(key);
    }).catch(() => undefined);
    return run;
};
