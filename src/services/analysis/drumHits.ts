import { melSpectrogramOffThread } from '../automix/analysisOffThread';
import { getFromCache, saveToCache } from '../db';
import { BEAT_THIS_FPS, BEAT_THIS_SAMPLE_RATE } from './beatThis';
import {
    DRUM_HAT, DRUM_KICK, DRUM_SNARE, DRUMLESS_COVERAGE, drumBandTracks, drumCoverage, ENERGY_HOP, energyFrames, isDrumAnalysis,
    LIVE_EVERY_MS, LIVE_MIN_SECONDS, liveTailFrames, pickBandHits, SHARE_WINDOW, type DrumAnalysis, type DrumHits,
} from './drumHitPicking';
import { DRUM_HITS_PREFIX } from './beatGridKeys';
import { createDrumBandStream, streamNeedsFrom, type DrumBands } from './drumHitStream';
import { drumStemSegments, startDrumStem, type DrumStemProgress } from './drumStem';
import type { StemReader } from './stemPass';
import { runTrackStems, setWantedStemTrack, stemTrackWanted, type StemTask } from './trackStemRun';
import { dropStemDrums, setStemDrumsKeptListener } from './stemRange';
import { HTDEMUCS_GPU_SEGMENT } from './beatThisGpu';
import { modelCanRun } from './modelAvailability';

// src/services/analysis/drumHits.ts
// A whole track's drum hits, read off htdemucs' drum stem (drumStem.ts, the renderer's GPU) and kept:
// in memory, on disk under the track's analysis key (DRUM_HITS_PREFIX, registered with the beat lists
// in services/repositories/cacheRepository.ts as analysis data), and in flight for as long as one run
// is going - the layering of beatGrid.ts. 时计 plays them under 智能动感模式
// (components/visualizer/pendolo/usePendoloBeatFx.ts): the user found the drums' own hits far truer
// than any rule over beat_this' beats (2026-10-17).
//
// The hits themselves, and the drumless guard, are worked out in drumHitPicking.ts.
//
// GPU only, and only with htdemucs_gpu installed (`canRunDrumStem`): without them there are no hits,
// and 时计 plays beat_this' beats as it always did. A separation takes ~15 s of GPU for a four-minute
// track, so it runs only for the wanted track (`setWantedDrumTrack`) and stops at its next segment
// once another is wanted - skipping through tracks does not queue their separations up. The wanted
// track is the one 智能动感模式 plays while it is on (hooks/useBeatFxTrack.ts), not only while 时计 is
// on screen: a separation stopped on a picture switch threw away what it had, and coming back to 时计
// separated the track again from the start. Under 智能动感模式's `cached` nothing separates: only a
// stored analysis is read (`loadStoredDrumHits`), and switching to it stops a separation as leaving the
// track does - its hits so far go with it (the `finally` in loadTrackDrumHits).
// (From the PR #750 review: the two sentences above on a picture switch are PR #734's; since the
// analysis service's 2b a picture switch stops the separation again, and it keeps where it was and
// the hits so far (DrumResume) to carry on from - see the note at the end of hooks/useBeatFxTrack.ts.)
//
// A track separating now has hits before it is done: the stem is read as its head is finished
// (drumHitStream.ts), and about once a second (LIVE_EVERY_MS) the hits so far are picked again and
// handed over with `until`, the time they reach. Picked again, not appended: a band's loud hits
// (HIT_TOP), which every strength is a share of, are known only over what has been heard, so each
// pick rescales what came before - online softmax's running normaliser, and the hits ahead of the
// playhead are the better for it. The drumless guard is the same, over the head so far, and only
// from LIVE_MIN_SECONDS of it: before that, 时计 plays the beats. Separation runs far ahead of
// playback (some 15x on an M-series GPU), so the hits are there in about a second, and the stored
// analysis is the last pick - the whole track's.

// What callers have always imported from here.
export {
    DRUM_HAT, DRUM_KICK, DRUM_SNARE, DRUMLESS_COVERAGE, drumBandTracks, drumCoverage, energyFrames, pickBandHits, pickDrumHits,
} from './drumHitPicking';
export type { DrumAnalysis, DrumHitKind, DrumHits } from './drumHitPicking';

/** htdemucs' rate. A change to the stem or the picking bumps the version in DRUM_HITS_PREFIX. */
const STEM_RATE = 44100;
/** The drum hits' kind on a track's stem run (trackStemRun.ts). */
export const DRUM_HITS_TASK = 'drum hits';

/** Whether the GPU drum stem can run here: htdemucs_gpu installed and a WebGPU to run it on. */
export const canRunDrumStem = (): boolean =>
    typeof window !== 'undefined'
    && typeof window.electron?.getHtdemucsGpuWeights === 'function'
    && typeof navigator !== 'undefined' && 'gpu' in navigator
    && modelCanRun('htdemucs_gpu');

/** 44.1 kHz mono to the 22.05 kHz beat_this rate, by the browser's own resampler; the vocal envelope's too (vocalStemRun.ts). */
export const resampleStem = async (signal: Float32Array): Promise<Float32Array> => {
    const length = Math.ceil(signal.length * BEAT_THIS_SAMPLE_RATE / STEM_RATE);
    const context = new OfflineAudioContext(1, length, BEAT_THIS_SAMPLE_RATE);
    const source = context.createBufferSource();
    const input = context.createBuffer(1, signal.length, STEM_RATE);
    input.copyToChannel(signal as Float32Array<ArrayBuffer>, 0);
    source.buffer = input;
    source.connect(context.destination);
    source.start();
    return (await context.startRendering()).getChannelData(0);
};


/** Per key, the hits 时计 plays, set once a track's analysis is in and it has drums. */
const hitLists = new Map<string, DrumHits>();
const runs = new Map<string, Promise<DrumAnalysis | null>>();
/** Hit lists kept in memory; the analyses themselves are on disk. */
const MAX_TRACKS = 24;


/**
 * Names the track whose drum hits are wanted now, or null for none (it was left, or 智能动感模式 is
 * off). Set when a picture asks for the hits; cleared when it is left - the track changes, the
 * picture switches (since the analysis service's 2b: the separation stops and keeps where it was, see
 * DrumResume) or the switch goes off.
 */
export const setWantedDrumTrack = (key: string | null): void => {
    setWantedStemTrack(key);
};

/** The drum hits of `key`, or null when the track has none (yet, or drumless). */
export const getDrumHits = (key: string | null): DrumHits | null => (key ? hitLists.get(key) ?? null : null);

/**
 * Keys whose analysis is in (separated to the end, or read from the store), drumless ones included:
 * nothing separates them again, so automix's drums for them are not kept (stemRange.ts, from the PR
 * #750 review). Kept apart from `hitLists`, which holds no drumless track and only MAX_TRACKS; a key is
 * a short string, so this keeps many more.
 */
const settled = new Set<string>();
const MAX_SETTLED = 1024;

/** Whether `key`'s drum hits are in, whole: its separation will not run again. */
export const drumHitsSettled = (key: string): boolean => settled.has(key);

/** Keys already looked up in the store for `lookInStore`, so each is read at most once. */
const lookedUp = new Set<string>();

/**
 * Drums kept for a track not settled this session (stemRange.ts): its analysis may be stored from an
 * earlier one. Read once; if it is, it settles like any read from the store, and the drums go.
 */
const lookInStore = (key: string) => {
    if (settled.has(key) || lookedUp.has(key)) return;
    lookedUp.add(key);
    while (lookedUp.size > MAX_SETTLED) {
        const oldest = lookedUp.keys().next().value;
        if (oldest === undefined) break;
        lookedUp.delete(oldest);
    }
    void loadStoredDrumHits(key);
};
setStemDrumsKeptListener(lookInStore);

/**
 * Forgets which tracks settled and were looked up, for when the stored analyses are cleared (the
 * settings' 分析 cache): a track judged in from a store that is now empty would otherwise have its
 * drums go unkept for the rest of the session (from the review of the PR #750 fixes).
 */
export const forgetSettledDrumHits = (): void => {
    settled.clear();
    lookedUp.clear();
};

const keep = (key: string, hits: DrumHits) => {
    hitLists.delete(key);
    hitLists.set(key, hits);
    while (hitLists.size > MAX_TRACKS) {
        const oldest = hitLists.keys().next().value;
        if (oldest === undefined) break;
        hitLists.delete(oldest);
    }
};

const remember = (key: string, analysis: DrumAnalysis, note: string) => {
    const coverage = drumCoverage(analysis.drumEnergy, analysis.mixEnergy);
    const counted = [0, 0, 0];
    analysis.hits.kinds.forEach((kind) => { counted[kind] += 1; });
    const drumless = coverage < DRUMLESS_COVERAGE;
    console.info(`[DrumHits] ${key}: ${drumless ? 'drumless' : `${analysis.hits.times.length} hits`} | drum coverage ${coverage.toFixed(3)} | kick ${counted[DRUM_KICK]} snare ${counted[DRUM_SNARE]} hat ${counted[DRUM_HAT]} | ${note}`);
    // A track whose head looked drummed may still be judged drumless as a whole: its live hits go.
    if (drumless) hitLists.delete(key);
    else keep(key, analysis.hits);
    settled.delete(key);
    settled.add(key);
    while (settled.size > MAX_SETTLED) {
        const oldest = settled.keys().next().value;
        if (oldest === undefined) break;
        settled.delete(oldest);
    }
    dropStemDrums(key);
};

/**
 * What a separation stopped part way keeps, to carry on from (analysis service plan, 2b): the hits it
 * had, and of everything else only what the rest needs - the stem from where the band stream and the
 * energy will read it again up to the last sample a separated segment reached, the bands and the
 * drum energy so far (only as far as they go), and the next segment (no weight since the stem pass:
 * stemPass.ts works it out at each sample). Some 0.4 MB plus about 0.3 KB per second separated, against the ~80 MB the decoded
 * track and the stem take while separating, which are let go. In memory only: a track not finished is
 * never stored, and after a restart it separates from the start.
 */
interface DrumResume {
    total: number;
    next: number;
    divided: number;
    tailStart: number;
    /** The stem in [tailStart, reached): divided up to `divided`, a running sum past it. */
    drums: Float32Array;
    /** The bands of the frames before `done`. */
    bands: DrumBands;
    done: number;
    /** The drum energy's cells up to the one `measured` reaches into. */
    drumEnergy: Float32Array;
    measured: number;
    hits: DrumHits | null;
}
const resumes = new Map<string, DrumResume>();
/** The tracks whose separation can carry on, the most recently stopped kept. */
const MAX_RESUMES = 4;

const keepResume = (key: string, resume: DrumResume) => {
    resumes.delete(key);
    resumes.set(key, resume);
    while (resumes.size > MAX_RESUMES) {
        const oldest = resumes.keys().next().value;
        if (oldest === undefined) break;
        resumes.delete(oldest);
    }
};

/**
 * The drum hits as a task on the track's stem run (trackStemRun.ts): one drum reader on its pass, the
 * whole stem laid into `progress.drums`; the live picks as segments come in, the analysis at the end,
 * and what carries it on when the run stops first (DrumResume) - the stopped run's own `resume` taken
 * up here when it was of this decode's length.
 */
const drumHitsTask = (key: string, resume: DrumResume | null): StemTask<DrumAnalysis | null> => ({
    kind: DRUM_HITS_TASK,
    open: ({ left, right }) => {
        const started = performance.now();
        const total = left.length;
        const mix = new Float32Array(total);
        for (let at = 0; at < total; at += 1) mix[at] = (left[at] + right[at]) / 2;
        const mixEnergy = energyFrames(mix);
        const drumEnergy = new Float32Array(mixEnergy.length);
        let measured = 0;
        const progress = startDrumStem(total);
        // Carried on only from a stop of this very decode's length; anything else starts again.
        const from = resume && resume.total === total ? resume : null;
        if (resume && !from) console.info(`[DrumHits] ${key}: the track decodes to another length than when it stopped, separating from the start`);
        if (from) {
            progress.drums.set(from.drums, from.tailStart);
            progress.next = from.next;
            progress.divided = from.divided;
            drumEnergy.set(from.drumEnergy);
            measured = from.measured;
            console.info(`[DrumHits] ${key}: carrying on from ${(from.divided / STEM_RATE).toFixed(1)}s`);
        }
        // Kept until this run stops again (and keeps its own) or finishes: a run that throws loses nothing.
        if (resume && !from) resumes.delete(key);
        const stream = createDrumBandStream(total, { resample: resampleStem, mel: melSpectrogramOffThread, bands: drumBandTracks }, from ? { bands: from.bands, done: from.done } : undefined);
        // The hits of the head so far, for 时计 while the rest separates (see the header).
        const pickLive = async (drums: Float32Array, final: number) => {
            for (; measured < final; measured += 1) drumEnergy[Math.floor(measured / ENERGY_HOP)] += drums[measured] * drums[measured];
            await stream.advance(drums, final, false);
            if (!stemTrackWanted(key)) return;
            const windows = Math.floor(final / ENERGY_HOP / SHARE_WINDOW) * SHARE_WINDOW;
            if (drumCoverage(drumEnergy.subarray(0, windows), mixEnergy.subarray(0, windows)) < DRUMLESS_COVERAGE) {
                hitLists.delete(key);
                return;
            }
            const until = Math.max(0, stream.done - liveTailFrames()) / BEAT_THIS_FPS;
            const hits = pickBandHits(stream.bands, stream.done);
            const count = hits.times.findIndex(time => time >= until);
            const head = count < 0 ? hits.times.length : count;
            if (!shown) {
                shown = true;
                console.info(`[DrumHits] ${key}: live hits ${((performance.now() - started) / 1000).toFixed(1)}s in, to ${until.toFixed(1)}s of the track`);
            }
            keep(key, {
                times: hits.times.slice(0, head),
                strengths: hits.strengths.slice(0, head),
                kinds: hits.kinds.slice(0, head),
                until,
            });
        };
        let shown = false;
        let live: Promise<void> | null = null;
        let liveAt = -Infinity;
        const reader: StemReader = {
            source: 'drums',
            next: progress.next,
            divided: progress.divided,
            window: { samples: progress.drums, base: 0 },
            read: (final) => {
                progress.next = reader.next;
                progress.divided = final;
                if (!live && final >= LIVE_MIN_SECONDS * STEM_RATE && performance.now() - liveAt >= LIVE_EVERY_MS) {
                    liveAt = performance.now();
                    live = pickLive(progress.drums, final)
                        .catch(error => console.warn(`[DrumHits] ${key}: live hits failed`, error))
                        .finally(() => { live = null; });
                }
                // The whole stem stays: the live picks read it after the segment is in.
                return 0;
            },
        };
        return {
            readers: [reader],
            finish: async () => {
                await live;
                const drums = progress.drums;
                // The energy the live picks summed so far, finished to the end: the same sums in the same order
                // as `energyFrames(drums)`, so the same bits, without the stem's head (gone after a resume).
                for (; measured < drums.length; measured += 1) drumEnergy[Math.floor(measured / ENERGY_HOP)] += drums[measured] * drums[measured];
                await stream.advance(drums, drums.length, true);
                const analysis: DrumAnalysis = {
                    hits: pickBandHits(stream.bands, stream.frames),
                    drumEnergy,
                    mixEnergy,
                };
                resumes.delete(key);
                remember(key, analysis, `separated in ${((performance.now() - started) / 1000).toFixed(1)}s`);
                await saveToCache(`${DRUM_HITS_PREFIX}${key}`, analysis);
                return analysis;
            },
            stop: async () => {
                await live;
                if (!stemTrackWanted(key)) console.info(`[DrumHits] ${key}: separation stopped at ${(progress.divided / STEM_RATE).toFixed(1)}s, the track or the picture was left`);
                if (progress.next > 0) await stopForLater(key, progress, stream, drumEnergy, measured, total);
                return null;
            },
        };
    },
});

/**
 * Keeps what a separation stopped at a segment boundary needs to carry on (DrumResume): the energy and
 * the bands brought up to what is final, then the stem from where they will read it next.
 */
const stopForLater = async (
    key: string,
    progress: DrumStemProgress,
    stream: ReturnType<typeof createDrumBandStream>,
    drumEnergy: Float32Array,
    measuredSoFar: number,
    total: number,
) => {
    let measured = measuredSoFar;
    const { drums, divided, next } = progress;
    for (; measured < divided; measured += 1) drumEnergy[Math.floor(measured / ENERGY_HOP)] += drums[measured] * drums[measured];
    try {
        await stream.advance(drums, divided, false);
    } catch (error) {
        console.warn(`[DrumHits] ${key}: could not keep where it stopped`, error);
        return;
    }
    const starts = drumStemSegments(total);
    // The last sample a separated segment reached: past it the sum is all zeros.
    const reached = Math.min(total, starts[next - 1] + HTDEMUCS_GPU_SEGMENT);
    const tailStart = Math.min(streamNeedsFrom(stream.done), measured, divided);
    keepResume(key, {
        total,
        next,
        divided,
        tailStart,
        drums: drums.slice(tailStart, reached),
        bands: [stream.bands[0].slice(0, stream.done), stream.bands[1].slice(0, stream.done), stream.bands[2].slice(0, stream.done)],
        done: stream.done,
        drumEnergy: drumEnergy.slice(0, Math.ceil(measured / ENERGY_HOP)),
        measured,
        hits: getDrumHits(key),
    });
};

/**
 * A track's drum analysis from the cache only, never separated (智能动感模式's `cached`). Once it is
 * in, `getDrumHits(key)` answers its hits. Null when none is stored. A run in flight is not joined:
 * only `on` starts one, and leaving `on` stops it (`setWantedDrumTrack(null)`).
 */
export const loadStoredDrumHits = async (key: string): Promise<DrumAnalysis | null> => {
    try {
        const stored = await getFromCache<DrumAnalysis>(`${DRUM_HITS_PREFIX}${key}`);
        if (!isDrumAnalysis(stored)) return null;
        remember(key, stored, 'from the cache');
        return stored;
    } catch (error) {
        console.warn(`[DrumHits] ${key}: cache read failed`, error);
        return null;
    }
};

/**
 * A track's drum analysis: from the cache, joined from a run in flight, or a separation of
 * `readBytes`' bytes now (only when `canRunDrumStem`). Once it is in, `getDrumHits(key)` answers its
 * hits. Null when none can be had now, which is not remembered: a later play may find the bytes.
 * Separates only while `key` is the wanted track (`setWantedDrumTrack`).
 */
export const loadTrackDrumHits = (key: string, readBytes: () => Promise<ArrayBuffer | null>): Promise<DrumAnalysis | null> => {
    const existing = runs.get(key);
    // Joined - but a run whose track was left and is wanted again before it reached its next segment
    // is stopping, and answers null: then one fresh run, rather than no hits for the rest of the play.
    // Only on null: a drumless track answers an analysis, and is not separated again.
    if (existing) return existing.then(found => (found === null && stemTrackWanted(key) && !runs.has(key) ? loadTrackDrumHits(key, readBytes) : found));
    const run = (async (): Promise<DrumAnalysis | null> => {
        const stored = await getFromCache<DrumAnalysis>(`${DRUM_HITS_PREFIX}${key}`);
        if (isDrumAnalysis(stored)) {
            remember(key, stored, 'from the cache');
            return stored;
        }
        if (!canRunDrumStem() || !stemTrackWanted(key)) return null;
        // A separation stopped earlier: its hits play at once, while the track decodes again.
        const resume = resumes.get(key) ?? null;
        if (resume?.hits) keep(key, resume.hits);
        let analysis: DrumAnalysis | null = null;
        try {
            analysis = await runTrackStems(key, readBytes, drumHitsTask(key, resume));
            return analysis;
        } finally {
            // Hits put back from a stop, or picked live, and no analysis came (no bytes, no decode, a
            // separation left or failed part way): taken off again - a later play would read them as whole.
            if (!analysis && getDrumHits(key)?.until !== undefined) hitLists.delete(key);
        }
    })().catch((error) => {
        console.warn(`[DrumHits] ${key}: failed`, error);
        return null;
    });
    runs.set(key, run);
    // Only the run in flight is kept: an answer lives on in `hitLists` and on disk, a null is retried.
    void run.then(() => {
        if (runs.get(key) === run) runs.delete(key);
    });
    return run;
};
