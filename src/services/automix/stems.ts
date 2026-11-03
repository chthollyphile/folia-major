import type { SongResult } from '../../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { onAudioCached } from '../audioCache';
import { hasProviderKeptSongAudio } from '../onlineMusic/providerRegistry';
import { getSongResourceCacheKey } from '../onlineMusic/resourceKeys';
import type { PlaybackRepresentation } from '../../types/playbackRecovery';
import { getPlaybackAnalysisKey, getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';
import { decodeAtRate, readLocalTrackBytes } from '../analysis/trackAudio';
import { decodeTrackAtRate, loadTrackBytes, type TrackBytesSource } from '../analysis/trackBytes';
import { canRunBeatThis } from '../analysis/beatThis';
import { modelCanRun, noteModelFailed } from '../analysis/modelAvailability';
import { profilesSettled } from './profileService';
import { estimateGpuFinish, gpuStemsUsable } from '../analysis/beatThisGpu';
import { chooseCpuThreads, chooseExecutor, cpuThreads, EWMA, type Executor } from '../analysis/scheduler';
import { forgetStemRange, segmentsOver, separateStemRange, stemRangeSpan, wantStemRange } from '../analysis/stemRange';
// The one edge back the other way is `import type`, so it is erased and this is not a cycle.
import { envelopeOf, lastVocalMoment } from './stemGesture';

// src/services/automix/stems.ts
// Separated audio for the two ends of a transition: the outgoing track's tail and the incoming
// track's head, four stems each, ready to be played as buffers.
//
// This is the "material" half of automix and the reason the round-eleven vocal exit can exist at all.
// Everything the planner decides about WHEN is useless for that rule without a stream carrying only
// the voice, because a finished master offers no way to take a voice out of itself.
//
// Two rules keep it honest about cost:
//
// Bytes are never downloaded for this. Only a track already in the media cache, or a local file, is
// separated - the same rule profileService follows, and stricter, because separation is worth less
// than a download nobody agreed to. A non-local track simply has no stems and the transition falls
// back to the master crossfade, which is what every build before this did.
//
// Only a WINDOW is separated, never a whole track, kept at sixteen bits with the peak scaled out. A
// four-minute track is a minute of CPU and a third of a gigabyte of stems; the last thirty seconds is
// about ten seconds and 21MB - see STEM_WINDOW_SEC.
//
// @note Since the analysis service's phase 3 (docs/analysis-service-plan.md) a window is separated on
// the GPU by default, through the analysis scheduler (analysis/stemRange.ts: the segment grid the drum
// hits share, so a tail 智能动感模式 already separated is taken rather than run again, and the drums
// of a head separated here are the drum hits' when that track plays), and on the CPU (the analysis
// worker's MNN) only without a usable GPU, or when the GPU would be late for a deadline and the CPU
// would not (scheduler.ts chooseExecutor). On the CPU the threads are the scheduler's level: quiet, or
// hurry for a deadline the quiet level would miss. This file only asks: which window, and what to keep.

export type StemName = 'drums' | 'bass' | 'other' | 'vocals';
export const STEM_NAMES: readonly StemName[] = ['drums', 'bass', 'other', 'vocals'];

/** The rate htdemucs is bound to. Not a preference - the export has it baked in. */
export const STEM_SAMPLE_RATE = 44100;

/**
 * How much of a track's end (or start) is separated.
 *
 * The memory bound and the CPU bound at once: four stereo stems is 0.7MB per second stored (see `pcm`
 * below), and the model spends roughly a third of a second per second of window. A transition holds
 * two windows, so every second here is paid twice in bytes and twice in wait.
 *
 * NOT free to shorten, and the earlier claim that it was is retracted: the gesture needs the window to
 * cover the WHOLE overlap, and the planner may ask for up to AUTOMIX_MAX_OVERLAP_SEC (25s), so a blend
 * longer than this loses its stems and falls back to the master crossfade.
 *
 * It was briefly 20 to save memory, solving the wrong problem. Sixteen-bit storage halved what a window
 * costs on its own - 21MB rather than 42 - and MAX_WINDOWS bounds how many there are, which between
 * them is where this subsystem's resident cost is decided; the window length is not worth trading a
 * whole gesture against. So it is back at a number that covers every overlap the
 * planner can ask for, and the ten seconds the model spends on it are spent minutes before the blend
 * needs them.
 *
 * `stems do not cover this window` is the line that would say this number is too low; it prints both
 * figures for exactly that reason.
 */
export const STEM_WINDOW_SEC = 30;

/** Which end of a track a window came from. A track needs both over its life, never at once. */
export type StemRole = 'head' | 'tail';

export interface TrackStems {
    /** Media time of the window's first sample. Everything in `buffers` is relative to this. */
    from: number;
    duration: number;
    role: StemRole;
    /**
     * Seconds from `from` to the last moment this track is still singing, or null.
     *
     * Only ever measured on a `tail` window, which is the only end anyone asks the question about.
     * Null means either the wrong role or a window with no singing anywhere in it - both of which
     * say "not from here", and the caller falls back to the lyric file.
     */
    vocalEnd: number | null;
    /**
     * One stereo buffer per stem. They sum back to the mix - see `other` below.
     *
     * Built on first read, not on arrival. A window can sit in the cache for the length of a track
     * and be used for a few seconds at the end of it, or never be used at all when the plan comes
     * out as a cut, so the float copy that playback needs is the wrong thing to hold for minutes.
     */
    buffers: Record<StemName, AudioBuffer>;
}

/**
 * A window as it is KEPT, which is not how it is played.
 *
 * Sixteen-bit rather than float, with each stem's own peak divided out first. Quantisation puts
 * a floor at about -96 dBFS relative to that peak, which is 65 dB below the error htdemucs
 * itself introduces when its rows are summed, and halves the largest thing automix holds. The
 * float copy exists only while a transition is actually using it.
 */
interface StemWindow {
    from: number;
    duration: number;
    role: StemRole;
    /** See TrackStems. Measured once on arrival, off the floats, before anything is quantised. */
    vocalEnd: number | null;
    /** Samples per channel. */
    length: number;
    /** One array per stem, the two channels laid end to end: [L..., R...]. */
    pcm: Record<StemName, Int16Array>;
    /** What each stem was divided by going in, and is multiplied by coming back out. */
    gain: Record<StemName, number>;
}

const PCM_FULL_SCALE = 32767;

/**
 * How far a stem overshoots full scale, or 1. The divisor that keeps it inside the format.
 *
 * `other` is a difference of four signals and the master itself sits at full scale on a modern pop
 * record, so samples past ±1 are ordinary here, not exceptional. Storing them against a fixed ±1
 * ceiling clips them, and clipping the loudest samples of the loudest stem is audible in precisely the
 * seconds a transition is running - the first version of this storage did that, the only change in it
 * that could alter what a blend sounds like. Dividing by the peak costs one float per stem and uses
 * the format as meant: full scale means the loudest sample there is, not an arbitrary 1.0.
 */
export const peakOf = (left: Float32Array, right: Float32Array): number => {
    let peak = 1;
    for (let i = 0; i < left.length; i += 1) {
        const l = left[i] < 0 ? -left[i] : left[i];
        if (l > peak) peak = l;
        const r = right[i] < 0 ? -right[i] : right[i];
        if (r > peak) peak = r;
    }
    return peak;
};

/**
 * Float to int, divided by `gain` on the way in and clamped rather than wrapped.
 *
 * With `gain` taken from `peakOf` the clamp never fires. It stays because wrapping a sample turns
 * the loudest moment of a blend into its own negation, which is a click rather than a quiet error.
 */
export const toPcm = (left: Float32Array, right: Float32Array, gain = 1): Int16Array => {
    const length = left.length;
    const scale = PCM_FULL_SCALE / gain;
    const out = new Int16Array(length * 2);
    for (let i = 0; i < length; i += 1) {
        out[i] = Math.max(-32768, Math.min(32767, Math.round(left[i] * scale)));
        out[length + i] = Math.max(-32768, Math.min(32767, Math.round(right[i] * scale)));
    }
    return out;
};

const toBuffer = (pcm: Int16Array, length: number, gain: number): AudioBuffer => {
    // Constructed rather than taken from the live AudioContext: the rate is htdemucs's, not the
    // context's, so the context was never deciding anything here and threading one through every
    // caller of `getStems` would have bought nothing.
    const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: STEM_SAMPLE_RATE });
    const channel = new Float32Array(length);
    for (let c = 0; c < 2; c += 1) {
        const base = c * length;
        for (let i = 0; i < length; i += 1) channel[i] = (pcm[base + i] / PCM_FULL_SCALE) * gain;
        buffer.copyToChannel(channel, c);
    }
    return buffer;
};

/** A stored window seen as something playable, decoded once and only if someone asks. */
const view = (window: StemWindow): TrackStems => {
    let buffers: Record<StemName, AudioBuffer> | null = null;
    return {
        from: window.from,
        duration: window.duration,
        role: window.role,
        vocalEnd: window.vocalEnd,
        get buffers(): Record<StemName, AudioBuffer> {
            if (!buffers) {
                const built = {} as Record<StemName, AudioBuffer>;
                for (const name of STEM_NAMES) {
                    built[name] = toBuffer(window.pcm[name], window.length, window.gain[name]);
                }
                buffers = built;
            }
            return buffers;
        },
    };
};

/**
 * Whether this build can separate right now. What the settings page reads to explain itself.
 *
 * The bridge is asked about separately from the model: for most of this feature's life the two were
 * the same question, and they stop being the same the moment the model is an optional download rather
 * than 166MB of every installer. Whether the model itself is runnable - weights present - is
 * modelAvailability's to answer.
 */
export const canSeparateStems = (): boolean => canSeparateStemsOnCpu() || canSeparateStemsOnGpu();

/** The analysis worker's MNN htdemucs. */
const canSeparateStemsOnCpu = (): boolean =>
    typeof window !== 'undefined'
    && typeof window.electron?.separateStems === 'function'
    && modelCanRun('htdemucs');

/** The renderer's WebGPU htdemucs (analysis/beatThisGpu.ts), the drum hits' (analysis/drumHits.ts canRunDrumStem). */
// Also false once this machine's GPU turned out unusable (found by review): otherwise every window
// went to a dead GPU first, and with the CPU model failed too, automix decoded and asked forever.
const canSeparateStemsOnGpu = (): boolean =>
    gpuStemsUsable()
    && typeof window !== 'undefined'
    && typeof window.electron?.getHtdemucsGpuWeights === 'function'
    && typeof navigator !== 'undefined' && 'gpu' in navigator
    && modelCanRun('htdemucs_gpu');

const cache = new Map<string, StemWindow>();
const inFlight = new Set<string>();
/**
 * How many windows are kept: the pair a transition is coming for, and the pair one just used.
 *
 * Four rather than three, and the second pair is the whole of the change. A window is ten seconds of
 * htdemucs and a multi-gigabyte spike for as long as it runs, so a hit here is worth more than
 * anything the bytes could be spent on instead - and the hit that was being thrown away is the one a
 * listener asks for by hand, by pressing Previous or replaying a transition to hear it again.
 *
 * Measured on a real session: six distinct windows, fourteen separations. Every repeat was a window
 * discarded seconds before it was asked for again, because the pair a blend had just used was treated
 * as spent the moment it finished. It is spent going FORWARDS. Both pairs fit here so that going back
 * one track costs nothing; going back further pays for itself again, and that is the line - one step
 * of history, not a history.
 */
export const MAX_WINDOWS = 4;

const keyOf = (song: SongResult, role: StemRole) => `${getPlaybackAnalysisKey(song)}:${role}`;

/**
 * Says why a window was not separated, once per window rather than once per render.
 *
 * The effect that asks for separation re-runs on several props, and a reason printed every time
 * would bury the transition lines it is meant to sit beside. Once is enough to answer "why is this
 * silent", which is the only question it exists for.
 */
const explained = new Set<string>();
const explainOnce = (key: string, message: string) => {
    if (explained.has(key)) return;
    explained.add(key);
    console.log(message);
};

/** Tail of the separation queue; see the gate in `ensureStems` for why one window at a time. */
let queue: Promise<void> = Promise.resolve();

/**
 * The two windows a transition would use right now. See `remember` for why eviction needs them.
 *
 * A set of keys rather than a pair of songs, because that is all the eviction question needs and
 * it keeps this file from having an opinion about what a queue is.
 */
let wanted = new Set<string>();

/**
 * Requests waiting for their bytes to reach the media cache, under the same key as a stored window.
 *
 * Separation may not download, so for an online track it is asked at the one moment the media cache
 * is guaranteed to be EMPTY: the effect fires when the track starts, and the file arrives only when
 * analysis downloads it - which for the incoming track is behind a URL resolve of its own, seconds
 * later. Giving up there made stems a coin flip decided by whether some unrelated re-render happened
 * to fall inside those few seconds.
 *
 * Measured on a real queue, two consecutive pairs, both uncached: the first was asked four times and
 * the fourth landed after the download, so it separated; the second was asked three times, all three
 * inside one second, all three before it - and that transition ran with no stems while the bytes had
 * been on disk for over three minutes. Nothing distinguished the two but timing.
 *
 * So the request waits instead. There is no deadline to miss: the whole design has minutes of lead,
 * and the reason the wait is bounded at all is `setWantedStems`, not a timer.
 */
const parked = new Map<string, StemRequest>();

// Subscribed at module scope. The listener has to be in place before the first request can park,
// and the first request parks inside the first call to `ensureStems` - there is no earlier hook.
onAudioCached((cacheKey, keptUrl) => {
    for (const [key, request] of [...parked]) {
        if (getSongResourceCacheKey('audio', request.song) !== cacheKey) continue;
        parked.delete(key);
        // Asked here as well as inside `ensureStems`, because this can fire long after the request
        // was parked. The check in there sits after the decode, which is tens of megabytes spent to
        // learn something already known at this line.
        if (request.stillWanted && !request.stillWanted()) continue;
        // A song its provider keeps is read by its URL, and the request may have parked before
        // the song had one (the next song is asked for as soon as the current one starts).
        void ensureStems(keptUrl ? { ...request, audioUrl: keptUrl } : request);
    }
});

/** The key a window is cached under, so a caller can name the pair it still needs. */
export const stemWindowKey = (song: SongResult, role: StemRole) => keyOf(song, role);

/** Names the pair the next transition would use. Anything else becomes evictable. */
export const setWantedStems = (keys: readonly string[]) => {
    wanted = new Set(keys);
    // The same rule `pickStemVictim` applies to stored windows, applied to waiting ones. This runs on
    // every track change with the pair that is now coming, so it is also what bounds `parked`: a
    // listener skipping through an album would otherwise leave one entry per track they passed,
    // each waiting on a file nothing will ever ask for.
    for (const key of [...parked.keys()]) {
        if (!wanted.has(key)) parked.delete(key);
    }
};

/**
 * Which window to drop when the budget is full: the oldest one NOBODY IS WAITING ON.
 *
 * Age alone gets this exactly backwards, and was measured doing so. Separation for a transition the
 * listener had already skipped away from finished twenty seconds later, and storing that dead result
 * evicted the tail of the track playing at that moment - the one window the next transition was
 * certain to ask for. That transition then fell back to the crossfade without even re-separating,
 * because the other half of the pair was still cached.
 *
 * The budget was never the problem. The slots hold the pair that is coming and the pair that just
 * played, as the MAX_WINDOWS comment says; what it could not survive was throwing the pair that is
 * coming away to make room for one nobody is waiting on.
 *
 * Falls back to the oldest when everything is wanted, so a stale or empty `wanted` degrades to the
 * plain LRU this replaced rather than to nothing being evictable.
 *
 * `arriving` is the window being stored right now, and it is here because "not wanted" covers two
 * things that are worth opposite amounts. A window the listener has merely STEPPED PAST is next
 * door to where they are and will be asked for again - it is the Previous hit MAX_WINDOWS exists to
 * hold. A window that finished for an excursion they have already LEFT will not be. Age cannot
 * separate them, and it picked the wrong one: measured twice in one session, a tail separated for a
 * track skipped away from six seconds earlier took the last of four slots, evicting a window the
 * very next transition asked for, which was then separated again to the same numbers.
 *
 * The arrival can be told apart, because it is the only one whose own `stillWanted` can still be
 * asked. So it goes first - but ONLY when the budget is actually full. Free is free, and that half
 * is not a nicety, it is the whole difference between this and discarding such a result outright
 * before storing it. That version was written, shipped for a listening test, and was worse: a
 * listener who cancels a blend by seeking stays on the SAME track, so the pair that was being
 * prepared is the pair coming back in a minute. Each cancel threw away ten seconds of htdemucs that
 * the next arm then paid for again - seven model runs across four minutes where this rule needs
 * four. A result that is already paid for costs only a slot, and a slot is what this decides.
 */
export const pickStemVictim = (
    keys: readonly string[],
    stillWanted: ReadonlySet<string>,
    arriving?: string,
): string | undefined => (arriving !== undefined && !stillWanted.has(arriving)
    ? arriving
    : keys.find(key => !stillWanted.has(key)) ?? keys[0]);

/*
 * There was a `dropUnwantedStems()` here, called at the end of every transition, on the reasoning
 * that the pair a blend had just used was dead: the outgoing track will not be played out of again,
 * and the incoming one now needs its tail rather than the head it entered on. So keeping them
 * "buys a hit that cannot happen".
 *
 * That hit happens. It is what pressing Previous asks for, and what replaying a transition to listen
 * to it again asks for - and both windows had been in this cache seconds earlier. Deleted rather than
 * narrowed: `wanted` plus `pickStemVictim` already evict in exactly this order, the budget above now
 * has room for both pairs, and a second mechanism emptying the cache ahead of the first could only
 * ever take away hits the first was keeping.
 */

/** Windows whose presence in the cache has been reported. See the hit branch in `ensureStems`. */
const announced = new Set<string>();

const remember = (key: string, value: StemWindow) => {
    cache.delete(key);
    cache.set(key, value);
    announced.delete(key);
    while (cache.size > MAX_WINDOWS) {
        const victim = pickStemVictim([...cache.keys()], wanted, key);
        if (victim === undefined) break;
        cache.delete(victim);
        // Dropping the arrival IS the eviction - it cannot free a second slot, and without this the
        // next turn asks to delete a key that has already gone, for the rest of the session.
        if (victim === key) break;
    }
};

/**
 * Read a window and mark it as used.
 *
 * Re-keyed on READ and not only on write, or "least recently used" means "least recently
 * separated": a window read by every transition still ages out behind one nobody has touched
 * since it arrived.
 */
const touch = (key: string): StemWindow | null => {
    const found = cache.get(key);
    if (!found) return null;
    cache.delete(key);
    cache.set(key, found);
    return found;
};

/**
 * The stem lookup, keyed by playback key rather than by song.
 *
 * What the session uses, and the distinction is the whole bug this replaced. A gesture is scheduled
 * AFTER the app has advanced, so `currentSong` is already the incoming track by then; asking for "the
 * current song's tail" then asks for the tail of a track that has not ended and the head of one that
 * is not playing, neither separated. The session already pins both identities at arm time
 * (`plannedFromKey` and `plannedNextKey`, the keys this cache is built from), so it names the pair
 * instead of re-deriving it from a value that has moved on.
 *
 * Still read late, which was the reason the old lookup was a function: separation finishes on its own
 * clock and a window that lands between the plan and the gesture is still worth using. Late is the
 * property worth keeping; re-deriving WHICH pair was never part of it.
 */
export const getStemsByKey = (key: string | null, role: StemRole): TrackStems | null => {
    const found = key ? touch(`${key}:${role}`) : null;
    return found ? view(found) : null;
};

/**
 * The bytes, but only if having them costs nothing.
 *
 * Deliberately narrower than profileService's version, which is allowed to move a download earlier.
 * Separation is not worth a byte of anyone's bandwidth, so this reads the media cache, a local URL
 * already in hand, a file its provider keeps, or - for a local track with no URL - the file straight
 * off its own handle (`readBytes`), and gives up otherwise: the shared local ladder
 * (analysis/trackAudio.ts), through analysis/trackBytes.ts, so bytes another analyser already read -
 * automix's profile download, 智能动感模式's stream read - are handed over instead of waited for.
 */
const readLocalBytes = async (
    request: StemRequest,
    key: string,
    representation: PlaybackRepresentation | null,
): Promise<{ bytes: ArrayBuffer | null; source: TrackBytesSource }> => {
    const { song, audioUrl } = request;
    return loadTrackBytes(key, async () => {
        const found = await readLocalTrackBytes(song, {
            representation,
            audioUrl,
            // No reader of its own: the registered one is asked for a local track, as before.
            ...(request.readBytes ? { readLocalFile: request.readBytes } : {}),
            // An online URL is left alone - separation never downloads - unless its provider keeps
            // the file on this machine itself: reading that URL is then a read of the kept file.
            mayReadOnlineUrl: url => hasProviderKeptSongAudio(song, url),
        });
        if (found && 'bytes' in found) return found.bytes;
        // A copy under half the song (a clip a version before wholeSongCheck.ts kept) is not
        // separated: its window is not the song's. The request waits as for no copy, and the song's
        // own file wakes it when it is stored.
        if (found && found.skipped.startsWith('the copy in the media cache is')) {
            explainOnce(`${keyOf(song, request.role)}:not-the-song`, `[Automix] not separating the ${request.role} of "${song.name}": ${found.skipped}`);
        }
        return null;
    });
};

export interface StemRequest {
    song: SongResult;
    role: StemRole;
    /** Used only when it is a local URL; an online one is left alone. */
    audioUrl?: string | null;
    /**
     * Reads the track's bytes straight off its own source, for a local track that has no URL and no
     * cached copy - the incoming head. Injected rather than imported so this file does not pull the
     * local-library service into the automix core (and its documented init cycle). Null-returning when
     * the local file is unreachable; absent for online tracks, which are never read this way.
     */
    readBytes?: () => Promise<ArrayBuffer | null>;
    /**
     * Whether this window is still the one a transition is coming for, asked just before the model.
     *
     * A request can sit in the queue for a minute, and a listener skipping through an album leaves a
     * trail of pairs nobody will ever hear. Nothing here could cancel, so the worker went on separating
     * an abandoned album while the one now playing waited behind it - measured: two tracks from a
     * playlist the listener had already left were still being separated and profiled twenty seconds
     * after they left it.
     */
    stillWanted?: () => boolean;
    /**
     * When the window must be separated by (performance.now() ms): the transition it is for. With it
     * the scheduler may take the CPU, or hurry it, when the GPU would be late; without it the GPU it is.
     */
    deadline?: number;
}

/**
 * Decodes a track and hands back only the window that will be separated.
 *
 * A function rather than four lines inline, and the scope IS the point. decodeAudioData gives back
 * the whole track as float at the model's rate - about 105MB for five minutes - and what is kept
 * from it is thirty seconds. Inline, that buffer stays in the async frame across the await on the
 * model below, so the renderer sat on a hundred megabytes it had finished with for the thirteen
 * seconds the separation ran: the exact moment the sidecar is at its own peak, and the two were
 * adding. Returning from here drops it before the expensive part starts.
 *
 * Decoded at the model's rate rather than the context's, because the model's rate is not negotiable
 * and resampling twice to land back where we started would only add error.
 */
const cutWindow = async (key: string, bytes: ArrayBuffer, source: TrackBytesSource, role: StemRole) => {
    // The same decode as the drum hits' (analysis/trackAudio.ts decodeAtRate, at the model's rate),
    // joined with it when both ask at once (analysis/trackBytes.ts); shared, so only read here.
    const decoded = await decodeTrackAtRate(key, STEM_SAMPLE_RATE, bytes, decodeAtRate, `stems ${role}`, source);
    if (!decoded) return null;

    const total = decoded.length;
    const windowLength = Math.min(total, Math.round(STEM_WINDOW_SEC * STEM_SAMPLE_RATE));
    const start = role === 'tail' ? total - windowLength : 0;
    // Since phase 3: the samples of every grid segment that reaches into the window (a segment's
    // worth more at most), for the GPU path; the window itself is a view of them.
    const span = stemRangeSpan(total, start, start + windowLength);
    const spanLeft = decoded.getChannelData(0).slice(span.start, span.end);
    const spanRight = decoded.numberOfChannels > 1
        ? decoded.getChannelData(1).slice(span.start, span.end)
        : spanLeft.slice();
    const left = spanLeft.subarray(start - span.start, start - span.start + windowLength);
    const right = spanRight.subarray(start - span.start, start - span.start + windowLength);
    return { left, right, start, total, spanLeft, spanRight, spanStart: span.start };
};

type StemParts = Record<'drums' | 'bass' | 'vocals', { left: Float32Array; right: Float32Array }>;

/**
 * CPU seconds per second of window at four threads: a 30 s window in 3.2-3.6 s on an M4 with MNN
 * (electron/analysis/worker.cjs). Was 0.35, the onnxruntime figure STEM_WINDOW_SEC still quotes;
 * found by review, three times too slow, which made the hurry level look needed when it was not.
 * (Measured after PR #750, 2026-10-19: was 0.12, half what a Ryzen 7 9700X takes - its worker ran a
 * 30 s window at four threads in 6.9-7.3 s in one session and 7.9-9.1 s (median 8.7) in another the
 * same evening, and the stems take another 0.3 s to cross from the worker - so some 3.5 s of a window
 * went unestimated, in the late direction. One figure cannot hold for every machine, nor for one
 * machine at every moment, so this is now only the guess before this one has measured a window
 * (cpuSecondsPerSecond): the slower session's 9.0 s for 30, because a guess too fast is a transition
 * without its stems.)
 */
const CPU_SECONDS_PER_SECOND = 0.3;
/**
 * A second of window at `threads` against one at four, as the threads are granted: the square root of
 * 4/threads. (Measured after PR #750, 2026-10-19, on the Ryzen 7 9700X: a 30 s window in a worker of
 * its own at each count, medians of six runs - 16.0 s at one thread, 12.2 at two, 10.0 at three, 8.7
 * at four, 7.2 at six, 6.4 at eight: 1.85, 1.41, 1.16, 0.83 and 0.73 times four's, where the square
 * root says 2, 1.41, 1.15, 0.82 and 0.71. Was 4/threads below four and no faster above - twice four's
 * time at two threads; single model runs had made eight look barely faster than four.)
 */
const threadCost = (threads: number) => Math.sqrt(4 / threads);
/**
 * CPU seconds per second of window as this machine measured them, by the thread count asked for: a
 * moving average of each CPU window's wait less the model's build (the worker's `buildMs`, which
 * CPU_REBUILD_MS stands for), weighted as the scheduler's GPU units are, the first measurement
 * replacing the guess outright. The wait rather than the worker's run, because the stems crossing two
 * processes each way are part of it: 0.3 s for a 30 s window between the main process and the worker
 * alone (measured with the curve above). By the count asked for rather than the count run: a worker
 * that built for fewer threads first runs a later build on that many (electron/analysis/worker.cjs
 * poolThreads), and what the estimate needs is what asking for a count gets. Forgotten at a restart,
 * as the GPU's averages are.
 * (Measured after PR #750, 2026-10-19, later the same evening: the two are one count now - the host
 * sends a build for another count to a worker of its own (electron/analysis/host.cjs, threads.cjs
 * poolFits) - and a hurried window after a quiet one measures the hurry level: 6.6 s for 30 s at eight
 * threads on the Ryzen 7 9700X, where the shared pool gave it four's 8.6.)
 */
const measuredCpuSeconds = new Map<number, number>();
/** CPU seconds per second of window at `threads`: as measured there, else as at the nearest count measured, else the guess. */
const cpuSecondsPerSecond = (threads: number): number => {
    const measured = measuredCpuSeconds.get(threads);
    if (measured !== undefined) return measured;
    let nearest: number | null = null;
    for (const count of measuredCpuSeconds.keys()) {
        if (nearest === null || Math.abs(count - threads) < Math.abs(nearest - threads)) nearest = count;
    }
    return nearest === null
        ? CPU_SECONDS_PER_SECOND * threadCost(threads)
        : measuredCpuSeconds.get(nearest)! * (threadCost(threads) / threadCost(nearest));
};
/** Notes `ms` of a CPU window's wait, the build left out, over `seconds` of window at `threads`. */
const noteCpuRun = (threads: number, seconds: number, ms: number) => {
    if (!(ms > 0) || !(seconds > 0)) return;
    const sample = ms / 1000 / seconds;
    const previous = measuredCpuSeconds.get(threads);
    measuredCpuSeconds.set(threads, previous === undefined ? sample : previous + EWMA * (sample - previous));
};
/**
 * Building htdemucs on the CPU for another thread count (MNN fixes it per build): a 92 MB read and the network.
 * (From the PR #750 re-review, 2026-10-19: also charged for the reload after the worker's idle
 * release, which now follows every run on every machine.)
 * (Measured after PR #750, 2026-10-19: was 1500, about three times what it takes. Charged after every
 * idle release, the excess sent windows to the hurry level, or to the GPU, that the quiet CPU would have
 * finished in time. End to end through host.cjs and worker.cjs on a Ryzen 7 9700X, over the same window
 * with the model loaded: 0.42-0.57 s (median 0.50, one 1.75 s round aside, the machine slow then) with
 * the worker running and only the model released, and 0.48-0.66 s (median 0.57) once the host has
 * stopped the worker - the new utilityProcess reaches its first line in about 50 ms, and koffi binds
 * folia_mnn in 6. The two are 0.1 s apart against a 5 s margin (DEADLINE_MARGIN_MS), so one number
 * covers both: the second, rounded up.)
 * (Measured later the same evening: another count is the second case now - the host starts a worker
 * of its own for it (electron/analysis/host.cjs) - and costs about the same. Over 30 s windows on the
 * same machine, six of each: the new worker built htdemucs in 498-543 ms (median 530), where
 * rebuilding for another count in the old one had taken 532-663 ms (median 630), the old model's
 * release included; the request that started the new worker took 265-707 ms longer than the next one
 * at its count, whose runs themselves differed by up to 0.5 s.)
 */
const CPU_REBUILD_MS = 600;
/** The thread count the CPU htdemucs was last asked for: another one rebuilds it. */
let lastCpuThreads: number | null = null;
/**
 * When the last CPU run ended, and whether it was kept loaded (`resident`): a fallback model on a GPU
 * machine is released FALLBACK_IDLE_MS after its run (electron/analysis/worker.cjs), so then the same
 * thread count rebuilds too (from the PR #750 review: the estimate left that out).
 * (From the PR #750 re-review, 2026-10-19: no run is kept loaded now - the worker releases htdemucs
 * a minute after every run, on a machine without a GPU too - so only the time since the last run
 * says whether it is still built. The host stops an idle worker after two minutes, later than that.)
 */
let lastCpuEndedAt = -Infinity;
/** The worker's FALLBACK_IDLE_MS. (From the PR #750 re-review, 2026-10-19: STEMS_IDLE_MS there now.) */
const CPU_STEMS_IDLE_MS = 60_000;
/**
 * Whether the CPU htdemucs is built for `threads` still, as far as this side can tell.
 * (Measured after PR #750, 2026-10-19: what it cannot tell is a beat_this run on the CPU between two
 * windows that asks for another thread count - a quarter of the cores, against htdemucs' four at the
 * quiet level from 20 cores up, or its hurry level from 8 - which the host runs in a worker of its own,
 * so the next window builds htdemucs again: CPU_REBUILD_MS left out, inside DEADLINE_MARGIN_MS.)
 */
const cpuBuiltFor = (threads: number, now: number) => threads === lastCpuThreads
    && now - lastCpuEndedAt < CPU_STEMS_IDLE_MS;
/**
 * Each window's deadline as it stands, by window key: a later `ensureStems` for a window in flight
 * moves it (the duration arrives after the track does; a resume after a pause), and a pause clears
 * them (`clearStemDeadlines`). Read at the executor choice and at every GPU segment.
 */
const deadlines = new Map<string, number>();

/** No window is due while nothing plays: a paused transition is not coming (useAutomixDecks). */
export const clearStemDeadlines = (): void => {
    deadlines.clear();
    // A parked request's too: woken by the media cache while paused, it would bring its deadline back.
    for (const [key, request] of [...parked]) {
        if (request.deadline !== undefined) parked.set(key, { ...request, deadline: undefined });
    }
};

/** Test-only: forgets the CPU's last thread count, what its runs measured, and every deadline. */
export const resetStemExecutorForTests = (): void => {
    lastCpuThreads = null;
    lastCpuEndedAt = -Infinity;
    measuredCpuSeconds.clear();
    deadlines.clear();
};

/**
 * Where a window is separated and how hard (see the header): the GPU unless it is missing or late,
 * and on the CPU the quiet threads unless they would be late. With the CPU's estimate (ms), for the log.
 */
const chooseStemExecutor = (deadline: number | undefined, total: number, start: number, length: number): { executor: Executor; threads: number; cpuMs: number } => {
    const gpuAvailable = canSeparateStemsOnGpu();
    const cpuAvailable = canSeparateStemsOnCpu();
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 4;
    const quietThreads = cpuThreads(cores, 'quiet', 'htdemucs');
    // Fewer threads than four, proportionally longer; another count than the last, a rebuild first.
    // (From the PR #750 re-review, 2026-10-19: and the same count too once a minute has passed since
    // the last CPU run - the worker has let the model go by then; see cpuBuiltFor.)
    // (Measured after PR #750, 2026-10-19: a second of window at a count is what this machine's runs
    // at that count took - see cpuSecondsPerSecond.)
    const now = performance.now();
    const cpuMs = (threads: number) => (length / STEM_SAMPLE_RATE) * cpuSecondsPerSecond(threads) * 1000
        + (cpuBuiltFor(threads, now) ? 0 : CPU_REBUILD_MS);
    const units = segmentsOver(total, start, start + length).length;
    const gpuFinish = gpuAvailable ? estimateGpuFinish('htdemucs', units, 'background', deadline) : Infinity;
    // The level first, so the CPU is judged on time at the level it would run at.
    const hurryThreads = cpuThreads(cores, 'hurry', 'htdemucs');
    const level = chooseCpuThreads({ deadline, quietFinish: now + cpuMs(quietThreads), hurryFinish: now + cpuMs(hurryThreads) });
    const threads = cpuThreads(cores, level, 'htdemucs');
    const executor = !cpuAvailable ? 'gpu' : chooseExecutor({ gpuAvailable, deadline, gpuFinish, cpuFinish: now + cpuMs(threads) });
    return { executor, threads, cpuMs: cpuMs(threads) };
};

/**
 * Separates one window of one track if it has not been separated yet. Safe to call repeatedly.
 *
 * Fire and forget from the caller's point of view: nothing waits on this, and a transition that
 * arrives before it finishes simply uses the master crossfade. That is the whole failure mode, and
 * it is the behaviour every build before stems existed had.
 */
export const ensureStems = async (request: StemRequest): Promise<void> => {
    if (!canSeparateStems()) return;
    // The key and the representation read for it, resolved together (see analysis/README.md), so a
    // transcode registering mid-window cannot file one's stems under the other's key.
    const target = getPlaybackAnalysisTarget(request.song);
    const key = `${target.key}:${request.role}`;
    if (inFlight.has(key)) {
        // Under way: only its deadline moves.
        if (request.deadline !== undefined) deadlines.set(key, request.deadline);
        return;
    }
    if (cache.has(key)) {
        // A hit says something, and it used to say it by staying quiet. "We already have this" and
        // "nothing ever asked for this" then read identically - and the second is a dead subsystem,
        // so the log could not tell the two apart in the one direction that matters. It was read the
        // wrong way the first time the cache started working.
        //
        // Once per stored copy rather than once per call: this function is reached from an effect
        // with eight dependencies. `remember` clears the key, so a window that is evicted and
        // separated again announces itself again.
        if (!announced.has(key)) {
            announced.add(key);
            console.log(`[Automix] the ${request.role} of "${request.song.name}" is already separated`);
        }
        return;
    }
    inFlight.add(key);
    if (request.deadline !== undefined) deadlines.set(key, request.deadline);
    // After the cache and in-flight guards, so this is once per window rather than once per render.
    //
    // "Asked for" and "asked for and gave up" look identical without it, and only one is a bug in this
    // file - the exact confusion that let the gesture never run for its whole life. Every way out below
    // says why; this line makes their absence mean something. The first track of a session having no
    // line here at all is the case to watch.
    console.log(`[Automix] separating the ${request.role} of "${request.song.name}"`);

    // One window at a time, for profileService's reason and one of its own.
    //
    // Its own: the inference worker serialises anyway, so two windows in flight only means the second
    // WAITS INSIDE its own measurement. Not a harmless cosmetic error - it is the number the whole "can
    // a weaker machine run this" question rests on, and unserialised it read 23.4s for a window whose
    // model time was 9.5s, the difference between three times realtime and not keeping up. A
    // measurement taken around a queue measures the queue. Holding the slot here means the timer below
    // starts when the work does.
    const ahead = queue;
    let release = () => { };
    queue = new Promise<void>(resolve => { release = resolve; });

    try {
        await ahead;
        // Behind every profile queued so far - see `profilesSettled` for why that order and not the
        // other one. Held before the decode as well as the model, because the decode is tens of
        // megabytes on the same main thread the profile's own decode wants.
        await profilesSettled();

        const started = performance.now();
        const { bytes, source } = await readLocalBytes(request, target.key, target.representation);
        if (!bytes) {
            // A local file the handle could not reach - permission not restored, moved, or deleted.
            // NOT parked: nothing fires a media-cache event for a local file, so a parked request would
            // wait for the rest of the session. Distinct from the online reason below on purpose - the
            // two used to print the same "not in the media cache yet", which for a local track was never
            // true and never going to resolve.
            if (getPlaybackSourceRef(request.song).kind === 'local') {
                explainOnce(key, `[Automix] cannot separate the ${request.role} of "${request.song.name}":`
                    + ' its local file is not accessible');
                return;
            }
            // Parked rather than dropped - see `parked`. Still once per window in the log: what comes
            // next is either `separating` again or nothing, and both say more than repeating this.
            explainOnce(key, `[Automix] waiting to separate the ${request.role} of "${request.song.name}":`
                + ' the file is not in the media cache yet');
            // With the deadline as it stands, not as first asked: a pause may have cleared it since, and
            // a request woken from here would write the stale one back (from the PR #750 review).
            parked.set(key, { ...request, deadline: deadlines.get(key) });
            return;
        }

        const cut = await cutWindow(target.key, bytes, source, request.role);
        if (!cut) return;
        const { left, right, start } = cut;
        const windowLength = left.length;

        // Last check before the expensive part: the wait above and the decode below it are long
        // enough for the listener to have moved on twice. Returning here leaves nothing cached and
        // clears `inFlight`, so coming back to this track asks again rather than finding a hole.
        if (request.stillWanted && !request.stillWanted()) {
            console.log(`[Automix] dropped the ${request.role} of "${request.song.name}":`
                + ' no longer the pair a transition is coming for');
            return;
        }
        const modelStarted = performance.now();
        const { executor, threads, cpuMs } = chooseStemExecutor(deadlines.get(key), cut.total, start, windowLength);
        let parts: StemParts | null = null;
        // On the GPU the time includes the scheduler's queue (the picture's segments, its frames), so
        // it is not the model's alone: said so, rather than read as what the machine can do.
        // On the CPU beside what it was estimated at, so a paste of the log shows how far the estimate is.
        const cpuEstimate = `${(cpuMs / 1000).toFixed(1)}s estimated`;
        let ranOn = executor === 'gpu' ? 'the GPU, queue included' : `the CPU (${threads} threads, ${cpuEstimate})`;
        if (executor === 'gpu') {
            // Said before it runs, so a segment the drum hits separate meanwhile is kept for it.
            wantStemRange(target.key, start, start + windowLength, cut.total);
            try {
                const stems = await separateStemRange({
                    key: target.key,
                    left: cut.spanLeft,
                    right: cut.spanRight,
                    offset: cut.spanStart,
                    total: cut.total,
                    from: start,
                    to: start + windowLength,
                    // Not `stillWanted`: asked once, above, as before phase 3 - a window under way is
                    // finished and kept (stemLateResult.test.ts). Its own log key: `raiseGpuUrgency` of
                    // the playing track's beats must not raise automix's units with them.
                    options: { urgency: 'background', key: `stems ${target.key}` },
                    deadlineOf: () => deadlines.get(key),
                });
                // htdemucs' order: drums, bass, other, vocals. `other` is derived below, as on the CPU.
                if (stems) parts = { drums: stems[0], bass: stems[1], vocals: stems[3] };
            } finally {
                forgetStemRange(target.key, start, start + windowLength, cut.total);
            }
            if (!parts && request.stillWanted && !request.stillWanted()) {
                console.log(`[Automix] dropped the ${request.role} of "${request.song.name}":`
                    + ' no longer the pair a transition is coming for');
                return;
            }
            // The GPU could not (no device, a failed run): the CPU, as before phase 3, when it can.
            if (!parts && canSeparateStemsOnCpu()) {
                console.log(`[Automix] the GPU could not separate the ${request.role} of "${request.song.name}", trying the CPU`);
                ranOn = `the CPU (${threads} threads, after the GPU, ${cpuEstimate})`;
            }
        }
        let triedCpu = false;
        // Why the CPU model declined, when it says (the worker's reason, e53569f5).
        let declined: string | null = null;
        if (!parts && canSeparateStemsOnCpu() && (executor === 'cpu' || ranOn.includes('after the GPU'))) {
            const separate = window.electron?.separateStems;
            if (!separate) return;
            triedCpu = true;
            // Copies of the window alone: a view would carry its whole span across the IPC.
            // Kept loaded only where the CPU is the separator; a GPU machine's fallback goes after a minute.
            // (From the PR #750 re-review, 2026-10-19: kept nowhere now - every run's model goes a
            // minute after it, where the CPU is the separator too - so no `resident` is sent.)
            lastCpuThreads = threads;
            let answer: Awaited<ReturnType<typeof separate>>;
            const asked = performance.now();
            try {
                answer = await separate({ left: left.slice(), right: right.slice(), threads });
            } finally {
                lastCpuEndedAt = performance.now();
            }
            if (answer && 'declined' in answer) declined = answer.declined;
            else if (answer) {
                parts = answer;
                // The wait less the model's build (CPU_REBUILD_MS's part): what the CPU estimate learns from.
                if (typeof answer.buildMs === 'number') noteCpuRun(threads, windowLength / STEM_SAMPLE_RATE, lastCpuEndedAt - asked - answer.buildMs);
            }
        }
        if (!parts) {
            // The GPU's own failures are its runtime's to note (analysis/beatThisGpu.ts); only the
            // CPU model's answer is written down here.
            if (!triedCpu) {
                console.log(`[Automix] could not separate the ${request.role} of "${request.song.name}" on the GPU`);
                return;
            }
            // Said here, in the console the listener reads. The worker's own line goes to the main
            // process's stdout only, so a library that would not load once looked like a separation
            // that never finished: "separating" and then nothing, track after track.
            console.warn(`[Automix] could not separate the ${request.role} of "${request.song.name}":`
                + ` ${declined ?? 'the analysis worker answered nothing'}`);
            // Nothing came back. The window this can happen in is the widest in the app - separation
            // is asked for the instant a track starts and runs for tens of seconds - so weights
            // disappearing under one, or the worker restarting under it on a folder switch, is
            // ordinary rather than a race. Both heal on their own, so this only makes the on-disk
            // answer current again; the transition falls back to the master crossfade.
            await noteModelFailed('htdemucs');
            return;
        }

        const pcm = {} as Record<StemName, Int16Array>;
        const gain = {} as Record<StemName, number>;
        const store = (name: StemName, l: Float32Array, r: Float32Array) => {
            gain[name] = peakOf(l, r);
            pcm[name] = toPcm(l, r, gain[name]);
        };
        for (const name of ['drums', 'bass', 'vocals'] as const) {
            store(name, parts[name].left, parts[name].right);
        }
        // `other` by SUBTRACTION rather than as a fourth model output, which is what the listening
        // harness did for eleven rounds and is not a shortcut. htdemucs is trained to reconstruct but
        // does not guarantee it: measured on a real track its four rows sum back to the mix only within
        // -31 dB. Deriving the fourth makes the sum exact, so a window with every stem at unity matches
        // the master - which matters because that is exactly the deck's state at the moment it splices
        // over from the element.
        //
        // Subtracted in float, before quantising, so the only error left at that splice is the -96 dBFS
        // storage floor rather than four stems' worth of rounding.
        const otherL = new Float32Array(windowLength);
        const otherR = new Float32Array(windowLength);
        for (let i = 0; i < windowLength; i += 1) {
            otherL[i] = left[i] - parts.drums.left[i] - parts.bass.left[i] - parts.vocals.left[i];
            otherR[i] = right[i] - parts.drums.right[i] - parts.bass.right[i] - parts.vocals.right[i];
        }
        store('other', otherL, otherR);

        // Measured here rather than at plan time, off the floats already in hand. Reading it later
        // would mean building the playback copy of a window that may never be played, to answer a
        // question worth one number - and the answer cannot change once separated, so the natural place
        // is the one moment it is free.
        //
        // `left`/`right` are the mix rather than a sum of the four rows, which matters for the same
        // reason `other` is subtracted above: the rows do not reconstruct exactly, and the reference
        // this threshold is taken against should be what was actually playing.
        const vocalEnd = request.role !== 'tail' ? null : lastVocalMoment(
            envelopeOf([parts.vocals.left, parts.vocals.right], STEM_SAMPLE_RATE),
            envelopeOf([left, right], STEM_SAMPLE_RATE),
        );

        remember(key, {
            from: start / STEM_SAMPLE_RATE,
            duration: windowLength / STEM_SAMPLE_RATE,
            role: request.role,
            vocalEnd,
            length: windowLength,
            pcm,
            gain,
        });
        // The two costs, printed separately and on purpose.
        //
        // This is the only number that says whether the feature is viable on a machine that is not the
        // one it was written on. The window is STEM_WINDOW_SEC of audio, so anything near or above that
        // here means separation is not keeping ahead of playback and the listener mostly hears the
        // crossfade - and nobody can tune the thread count for hardware they cannot measure. A log that
        // carries it turns any user's paste into a measurement.
        const modelSec = (performance.now() - modelStarted) / 1000;
        const totalSec = (performance.now() - started) / 1000;
        // In MEDIA time, not window time, because that is the clock every other automix log and
        // the planner's own floor are written in - a window-relative number here would have to be
        // added to a figure from a different line before it meant anything.
        const sung = request.role !== 'tail' ? ''
            : vocalEnd === null
                ? ', no singing anywhere in it'
                : `, still singing at ${(start / STEM_SAMPLE_RATE + vocalEnd).toFixed(2)}s`;
        console.log(`[Automix] separated the ${request.role} of "${request.song.name}"`
            + ` (${(windowLength / STEM_SAMPLE_RATE).toFixed(1)}s from ${(start / STEM_SAMPLE_RATE).toFixed(1)}s)`
            + ` - ${modelSec.toFixed(1)}s in the model on ${ranOn}, ${totalSec.toFixed(1)}s with the decode${sung}`);
    } catch (error) {
        console.warn('[Automix] separation failed', error);
    } finally {
        inFlight.delete(key);
        deadlines.delete(key);
        // Unconditionally, including after a throw: a slot never handed back stalls every window
        // for the rest of the session, and the failure mode is the subsystem going quiet forever.
        release();
    }
};

/**
 * Which of the two builds this is.
 *
 * The desktop app and the web app run the SAME planner over different evidence, a design decision not
 * a limitation: everything needing a native runtime - the beat grid from Beat This!, the four stems
 * from htdemucs - lives in the Electron main process, so the browser build never gets an answer and
 * falls through to the estimators and the master crossfade it always had. Nothing is disabled and
 * nothing throws; the same code takes a different branch because it was handed less.
 *
 * Lives here rather than in transitionStrategy, its natural home, because that module is imported by
 * a settings STORE and this one reaches the media cache: the edge transitionStrategy -> stems ->
 * resourceCache -> audioCache -> a settings store closes a real cycle, whose symptom is not a warning
 * but `DEFAULT_TRANSITION_SETTINGS` being undefined while the store initialises. Kept out of that graph
 * on purpose.
 *
 * After the store split the two ends are useAutomixSettingsStore (imports transitionStrategy) and
 * useAudioSettingsStore (reached via audioCache). They are different stores now, so the cycle is not
 * currently closed — but moving this back into transitionStrategy would still put a store on both
 * ends of that path, so the reason to keep it here stands.
 */
export interface TransitionCapabilities {
    /** Bar lines from the model rather than from the built-in estimator. */
    beatGrid: boolean;
    /** Separated stems, which is the whole of what the vocal-exit gesture needs. */
    stems: boolean;
    /** Both: the desktop build, with its weights present and working. */
    full: boolean;
    /**
     * Whether this is the desktop build at all, whatever it has downloaded.
     *
     * "The browser cannot do this" and "the weights are not here yet" used to be one sentence
     * because they were one situation. They are now two: the first is permanent and the second is a
     * download, and telling a desktop listener that their browser is the problem is both wrong and
     * gives them nothing to do about it.
     */
    desktop: boolean;
}

export const transitionCapabilities = (): TransitionCapabilities => {
    const beatGrid = canRunBeatThis();
    const stems = canSeparateStems();
    // The bridge rather than the weights: this is the question the weights check was standing in
    // for, and it is the only one of the two that a listener cannot change.
    const desktop = typeof window !== 'undefined' && typeof window.electron?.separateStems === 'function';
    return { beatGrid, stems, full: beatGrid && stems, desktop };
};
