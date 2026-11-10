import { melSpectrogramOffThread } from '../automix/analysisOffThread';
import { HTDEMUCS_GPU_SEGMENT } from './beatThisGpu';
import { canRunDrumStem, resampleStem } from './drumHits';
import { movingStemWindow, startStemReader, stemWholeFrom, type StemReader } from './stemPass';
import { stemSegmentStarts } from './stemRange';
import { releaseTrackStems, runTrackStems, stemTrackWanted, type StemTask } from './trackStemRun';
import { loadStoredVocalEnvelope, rememberVocalEnvelope, type VocalEnvelope } from './vocalEnvelope';
import { createVocalStream, VOCAL_STREAM_KEEP } from './vocalStream';

// src/services/analysis/vocalStemRun.ts
// 雾笺's vocal envelope (vocalEnvelope.ts) read off a track's stem run (trackStemRun.ts): a task of its
// own beside the drum hits' (drumHits.ts), so the two share the run's decode and its segments.
//
// Switched to mid-track, 雾笺 wants the voice from the playhead on: the head already played is not
// separated for it. The reader starts at the segment before the one holding the playhead, so the voice
// is whole from at most a segment before it (`vocalStartFor`). Asked for while the drums run (时计 to
// 雾笺 mid-separation), it joins their run at the next segment: segments the drums already passed are
// run again for the voice alone until it catches them up, then they share - not the whole track twice.
// Let go (雾笺 back to 时计, `releaseTrackVocals`), it stops and the drums carry on. A track whose drum
// hits are in already has a run for the voice alone. The stem is read a stretch at a time as it is
// finished (vocalStream.ts, in a window about a segment long), never held whole.

const STEM_RATE = 44100;
/** A tail shorter than this is not read: a 97th percentile over a few seconds is noise. */
const MIN_VOCAL_SECONDS = 20;

/** The vocal envelope's kind of task on a track's stem run. */
export const VOCAL_ENVELOPE_TASK = 'vocal envelope';

/** The segment to start the vocals at for a playhead `at` samples in: the one before the segment holding it. */
export const vocalSegmentAt = (total: number, at: number, segment = HTDEMUCS_GPU_SEGMENT): number => {
    const starts = stemSegmentStarts(total, segment);
    let holding = 0;
    while (holding + 1 < starts.length && starts[holding + 1] <= at) holding += 1;
    return Math.max(0, holding - 1);
};

/** The segment the vocals start at for a playhead `at` seconds in, or null when too little is left to read. */
export const vocalStartFor = (total: number, at: number): number | null => {
    const from = vocalSegmentAt(total, Math.max(0, Math.round(at * STEM_RATE)));
    return from > 0 && total - stemWholeFrom(total, from) < MIN_VOCAL_SECONDS * STEM_RATE ? null : from;
};

/**
 * Whether the voice is worth separating at all, from the track's length `seconds` (0: unknown) and the
 * playhead `at`, before anything is decoded. Never no where `vocalStartFor` would say yes: the voice is
 * whole from at most one segment before the playhead.
 */
export const vocalTailWorthReading = (seconds: number, at: number): boolean =>
    !(seconds > 0) || at <= 0 || seconds - at + HTDEMUCS_GPU_SEGMENT / STEM_RATE >= MIN_VOCAL_SECONDS;

/**
 * The vocal envelope as a task on `key`'s stem run: from the playhead `at()` (s, read once the track
 * is decoded) on, its stem read as it is separated. Answers the envelope (kept, and stored when whole),
 * or null when stopped first or too little of the track is left.
 */
const vocalEnvelopeTask = (key: string, at: () => number): StemTask<VocalEnvelope | null> => ({
    kind: VOCAL_ENVELOPE_TASK,
    open: ({ left }) => {
        const total = left.length;
        const playhead = at();
        const from = vocalStartFor(total, playhead);
        if (from === null) {
            console.info(`[VocalEnvelope] ${key}: too little of the track left at ${playhead.toFixed(1)}s to read the voice`);
            return { readers: [], finish: async () => null, stop: async () => null };
        }
        const started = performance.now();
        const wholeFrom = stemWholeFrom(total, from);
        const stream = createVocalStream(total, { resample: resampleStem, mel: melSpectrogramOffThread }, wholeFrom);
        const reader: StemReader = {
            source: 'vocals',
            ...startStemReader(total, from),
            window: movingStemWindow(total, from, VOCAL_STREAM_KEEP),
            read: (final, end) => stream.advance(reader.window, final, end),
        };
        return {
            readers: [reader],
            finish: async () => {
                const envelope = stream.envelope();
                console.info(`[VocalEnvelope] ${key}: voice from ${(wholeFrom / STEM_RATE).toFixed(1)}s separated in ${((performance.now() - started) / 1000).toFixed(1)}s`);
                await rememberVocalEnvelope(key, envelope);
                return envelope;
            },
            // Nothing carried on: the voice is read again from the playhead next time.
            stop: async () => {
                console.info(`[VocalEnvelope] ${key}: voice stopped at ${(reader.divided / STEM_RATE).toFixed(1)}s`);
                return null;
            },
        };
    },
});

const runs = new Map<string, Promise<VocalEnvelope | null>>();
/** The track whose voice was last asked for and not let go: one let go while its ask read the store does not start. */
let voiceWanted: string | null = null;

/**
 * `key`'s vocal envelope for a play heard at `at()` (s): kept this play or stored (a part way one does
 * for a playhead at or past its start), or read off the track's stem run - only while `key` is the
 * wanted track (trackStemRun.ts) and the GPU can separate (drumHits.ts' `canRunDrumStem`). `seconds`,
 * the track's length when known, spares a decode for a tail too short to read. Null when none is had
 * now; a later ask tries again.
 */
export const loadTrackVocalEnvelope = (
    key: string,
    readBytes: () => Promise<ArrayBuffer | null>,
    { at = () => 0, seconds = 0 }: { at?: () => number; seconds?: number } = {},
): Promise<VocalEnvelope | null> => {
    voiceWanted = key;
    const existing = runs.get(key);
    // Joined, as the drum hits are: one stopped (the track left and wanted again before its next segment)
    // is asked again - not one let go (`releaseTrackVocals`), which answers null as well.
    if (existing) return existing.then(found => (found === null && stemTrackWanted(key) && voiceWanted === key && !runs.has(key) ? loadTrackVocalEnvelope(key, readBytes, { at, seconds }) : found));
    const run = (async () => {
        const known = await loadStoredVocalEnvelope(key);
        if (known && (!known.from || known.from <= at() * known.fps)) return known;
        if (!vocalTailWorthReading(seconds, at()) || !canRunDrumStem() || !stemTrackWanted(key) || voiceWanted !== key) return known;
        return (await runTrackStems(key, readBytes, vocalEnvelopeTask(key, at))) ?? known;
    })().catch((error) => {
        console.warn(`[VocalEnvelope] ${key}: failed`, error);
        return null;
    });
    runs.set(key, run);
    void run.then(() => {
        if (runs.get(key) === run) runs.delete(key);
    });
    return run;
};

/** Lets `key`'s voice go (雾笺 left for 时计): its task stops at the next segment, the drums carry on. */
export const releaseTrackVocals = (key: string): void => {
    if (voiceWanted === key) voiceWanted = null;
    releaseTrackStems(key, VOCAL_ENVELOPE_TASK);
};
