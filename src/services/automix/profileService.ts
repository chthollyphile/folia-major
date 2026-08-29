import type { SongResult } from '../../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { saveAudioBlob } from '../audioCache';
import { getFromCache, saveToCache } from '../db';
import { getCachedSongAudioBlob } from '../onlineMusic/resourceCache';
import { getSongResourceCacheKey } from '../onlineMusic/resourceKeys';
import { analyseTrackOffThread, melSpectrogramOffThread } from './analysisOffThread';
import { analyseBeatGrid, canRunBeatThis } from './beatThis';
import {
    measureEdges,
    PROFILE_SAMPLE_RATE,
    TRACK_PROFILE_VERSION,
    type TrackProfile,
} from './trackProfile';

// src/services/automix/profileService.ts
// Gets the bytes of a track that has not been played yet, measures it once, and remembers the
// answer. The impure half of the evidence layer; the maths is in trackProfile.ts.
//
// The bandwidth rule is the important one. Analysis needs the whole file, and a music player that
// quietly downloads every upcoming track to sound slightly better is not a trade anyone agreed to. So
// bytes are only taken from where they were going to come from anyway: the media cache when it already
// holds the track, a local file, or - when song caching is on - the one download that would have
// happened after playback, moved earlier and written to the same cache. With caching off, an online
// track is simply not analysed and the blend falls back to the live measurement of the outgoing deck.

const profiles = new Map<string, TrackProfile | null>();
const inFlight = new Set<string>();
/**
 * Tracks whose bytes were not reachable this time round.
 *
 * Deliberately NOT stored as a null profile: "no bytes yet" is a passing condition - the media
 * cache fills up as tracks finish playing - while a failed decode is permanent. Recording the two
 * the same way meant a track skipped once was never looked at again for the rest of the session.
 * Kept only to log the reason once per track instead of on every prefetch pass.
 */
const skipped = new Map<string, string>();
/** Same order of magnitude as the prefetch cache; each entry is a couple of hundred bytes. */
const MAX_PROFILES = 200;

/** One at a time: decoding a track allocates tens of megabytes, and two at once is the spike. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The only tracks worth measuring right now: what is playing, and what plays next.
 *
 * A queued analysis is not free to leave queued. It holds the whole decoded track - tens of megabytes
 * of float - and puts a spectrogram through the beat model, and the queue is strictly serial, so work
 * for a track the listener has already moved past does not just waste itself: it stands in front of
 * the track they moved TO. Skipping through four songs used to leave four full analyses ahead of the
 * one that mattered.
 *
 * Set by the prefetcher, which is the only thing that knows where the queue is. Checked when a task
 * reaches the front rather than when it is enqueued, because the point is precisely that the answer
 * changes while it waits.
 */
let wanted: ReadonlySet<string> = new Set();

/**
 * Narrows analysis to these tracks. Anything queued for a track not in the list is dropped when its
 * turn comes; anything already running finishes, since a decode cannot be taken back mid-way.
 *
 * Dropping is safe to do at any time: nothing is remembered for a dropped track, so it is simply
 * measured on a later pass if it comes back into range.
 */
export const setAnalysisScope = (songs: readonly SongResult[]): void => {
    wanted = new Set(songs.map(getPlaybackSongKey));
};

/**
 * Resolves once everything queued for analysis so far has finished. Awaited by separation.
 *
 * The two subsystems share one inference worker, and left to race they arrived in the wrong order:
 * separation is asked for the instant a track starts, profiling trickles in behind the prefetcher, so
 * two ten-second separations regularly landed ahead of the profile the transition could not choose a
 * style without. Measured on a real session: a profile finished three seconds after the transition
 * that needed it.
 *
 * Profiles win because of what each one gates, not what it costs. Without a profile the planner has no
 * tempo, key or outro, so every transition collapses to the plain crossfade - whereas without stems a
 * fully-planned transition still renders, just through the master fade. The cheaper input decides more.
 */
export const profilesSettled = (): Promise<unknown> => queue;

const storageKey = (songKey: string) => `automix_profile_${songKey}`;

const remember = (songKey: string, profile: TrackProfile | null) => {
    profiles.delete(songKey);
    profiles.set(songKey, profile);
    while (profiles.size > MAX_PROFILES) {
        const oldest = profiles.keys().next().value;
        if (oldest === undefined) break;
        profiles.delete(oldest);
    }
};

/**
 * Whether a profile we already have is worth measuring again because no model ever saw the track.
 *
 * All three clauses carry weight. The caller has to want a grid - crossfade does not. The model has to
 * have never run - `gridless === false` means it ran, grid or not, and that is settled. And this build
 * has to be able to run it now: drop that clause and a machine with no weights re-analyses every track
 * on every prefetch pass forever, because what comes back is gridless too.
 *
 * `!== false` rather than `=== true` so profiles from before the field existed count. They have to:
 * the weights are a new optional download, so every cache built before this was built without a model,
 * and reading their silence as "already gridded" would mean downloading the model changed nothing for
 * any cached track. It costs one re-measure per cached track, once, only on machines that have the weights.
 */
export const needsGrid = (request: ProfileRequest, profile: TrackProfile | null | undefined): boolean =>
    request.wantGrid && !!profile && profile.gridless !== false && canRunBeatThis();

/** What the planner reads. Synchronous on purpose: a plan cannot wait on a decode. */
export const getTrackProfile = (song: SongResult | null | undefined): TrackProfile | null => (
    song ? profiles.get(getPlaybackSongKey(song)) ?? null : null
);

/**
 * Splits the decode into mid and side.
 *
 * Mid - (L+R)/2 - is the mono sum every other measurement here wants. Side - (L-R)/2 - is what is left
 * when the two channels cancel: everything the mix placed off-centre. Keeping it is what makes a voice
 * findable - lead vocals are panned dead centre on essentially every commercial master, so they live
 * almost entirely in mid and almost not at all in side. Cancelling one against the other is the same
 * arithmetic karaoke machines have used to drop the lead vocal for decades.
 *
 * Null side for a mono file: no two channels to cancel, so the question cannot be asked.
 */
const toMidSide = (buffer: AudioBuffer): { mid: Float32Array; side: Float32Array | null } => {
    const left = buffer.getChannelData(0);
    if (buffer.numberOfChannels < 2) return { mid: Float32Array.from(left), side: null };

    const right = buffer.getChannelData(1);
    const mid = new Float32Array(buffer.length);
    const side = new Float32Array(buffer.length);
    for (let index = 0; index < mid.length; index += 1) {
        mid[index] = (left[index] + right[index]) / 2;
        side[index] = (left[index] - right[index]) / 2;
    }
    return { mid, side };
};

/**
 * Decodes straight to the analysis rate.
 *
 * decodeAudioData resamples to the context's own sample rate, so a context created at 22.05kHz
 * does the downsampling in the decoder - no render pass, no resampler here, and a four-minute
 * track lands as ~10MB of floats instead of ~80MB.
 */
const decodeAtProfileRate = async (bytes: ArrayBuffer): Promise<AudioBuffer | null> => {
    const OfflineContext = window.OfflineAudioContext
        || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineContext) return null;
    try {
        return await new OfflineContext(1, 1, PROFILE_SAMPLE_RATE).decodeAudioData(bytes);
    } catch (error) {
        console.warn('[Automix] could not decode a track for analysis', error);
        return null;
    }
};

interface ProfileRequest {
    song: SongResult;
    /**
     * Run the beat model. False in crossfade mode, where the answer is thrown away.
     *
     * Not optional: the whole point is that the caller has to say, and a defaulted `false` would
     * silently take the grid off any future caller that forgot the field.
     */
    wantGrid: boolean;
    /** Where the bytes could be fetched from, when they are not already cached. */
    audioUrl?: string | null;
    /** Song caching is on, so downloading this track now costs nothing it was not going to cost. */
    enableMediaCache: boolean;
}

/**
 * How much of the front of a track to read when the whole file is off limits.
 *
 * Enough for the head-side evidence at any bitrate this player deals with: about 40 seconds at
 * 320kbps and a minute and a half at 128, which comfortably covers the leading silence, whether
 * the track opens at full level, the intro's shape, a tempo and a key. Roughly a tenth of a
 * typical track rather than all of it.
 */
const PREFIX_BYTES = 1_572_864;

/** Either the bytes, or the reason there are none - which is the more useful answer most days. */
type BytesResult =
    | { bytes: ArrayBuffer; partial: boolean }
    | { skipped: string };

/**
 * Reads only the front of a file, and only if the server will genuinely serve only the front.
 *
 * A range off the END would be the more useful half - it is the outgoing track's tail that decides
 * most transitions - but it is not decodable: strip a file's container header and no decoder will
 * touch what is left. A range off the front keeps the header, so it decodes as a short track.
 *
 * If the server ignores the Range header it answers 200 with the whole file, which is exactly the
 * download this path exists to avoid, so the body is cancelled rather than used.
 */
const readPrefix = async (audioUrl: string): Promise<BytesResult> => {
    const response = await fetch(audioUrl, { headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` } });
    if (response.status !== 206) {
        await response.body?.cancel();
        return { skipped: 'the server would not serve a partial range, and a full download is not ours to spend' };
    }
    return { bytes: await response.arrayBuffer(), partial: true };
};

const readBytes = async (
    { song, audioUrl, enableMediaCache }: ProfileRequest,
    /** A head-only profile is already stored, so there is nothing a second range request buys. */
    hasStoredPartial: boolean,
): Promise<BytesResult> => {
    const cached = await getCachedSongAudioBlob(song);
    if (cached) return { bytes: await cached.arrayBuffer(), partial: false };

    if (!audioUrl) return { skipped: 'not cached yet and no URL to read it from' };
    // A blob: or file: URL is already on this machine, so reading it is free whatever the setting
    // says. Anything else is a real download and needs a reason.
    const isLocal = audioUrl.startsWith('blob:') || audioUrl.startsWith('file:')
        || getPlaybackSourceRef(song).kind !== 'online';

    try {
        if (!isLocal && !enableMediaCache) {
            // Song caching is off, so the full file would be bandwidth nobody agreed to. Take the
            // front of it instead: less than the transition is worth, and it still answers the
            // questions about how this track STARTS - which is what the chooser needs from the
            // track it is blending into.
            if (hasStoredPartial) return { skipped: '' };
            return await readPrefix(audioUrl);
        }

        const blob = await (await fetch(audioUrl)).blob();
        if (!isLocal) {
            // The same write the audio bridge would have done after playback. Fetching once and
            // feeding both is the whole reason a full read is allowed here at all.
            await saveAudioBlob(getSongResourceCacheKey('audio', song), blob);
        }
        return { bytes: await blob.arrayBuffer(), partial: false };
    } catch (error) {
        console.warn('[Automix] could not read a track for analysis', error);
        return { skipped: 'the download failed' };
    }
};

/**
 * Measures a track if it has not been measured yet. Safe to call repeatedly.
 *
 * Every outcome is remembered, failures included: a track that cannot be analysed - no bytes, an
 * unsupported codec - must not be retried on every pass of the prefetcher.
 */
export const ensureTrackProfile = async (request: ProfileRequest): Promise<void> => {
    const songKey = getPlaybackSongKey(request.song);
    if (inFlight.has(songKey)) return;
    if (profiles.has(songKey) && !needsGrid(request, profiles.get(songKey))) return;
    inFlight.add(songKey);

    queue = queue.then(async () => {
        try {
            // Asked here, at the front of the queue, not when this was enqueued - see `wanted`. The
            // listener may have skipped past this track while it was waiting its turn, and the whole
            // point is to not spend a decode and a model pass on where they no longer are.
            if (!wanted.has(songKey)) return;

            const stored = await getFromCache<TrackProfile>(storageKey(songKey));
            const usable = stored?.version === TRACK_PROFILE_VERSION ? stored : null;
            // A complete profile is the end of it. A head-only one is worth revisiting: the track
            // may have finished playing since and be sitting in the media cache now, in which case
            // the tail - the half that decides most transitions - is finally readable.
            if (usable && !usable.partial && !needsGrid(request, usable)) {
                remember(songKey, usable);
                // Said out loud, because the alternative is silence - and a track measured on an
                // earlier run then reads exactly like a track nothing ever measured. That is not a
                // hypothetical misreading: it is the one this log was actually put through, on a
                // pair of tracks whose profiles had been on disk for days. Leads with the same two
                // figures `analysed` does, so the two cases sit beside each other.
                console.log(`[Automix] "${request.song.name}" was measured on an earlier run:`
                    + ` ${usable.bpm ? `${Math.round(usable.bpm)} BPM` : 'no tempo'}`
                    + `${usable.gridless === false ? ' (Beat This!)' : ''}`
                    + `, ${usable.loudness.toFixed(1)} LUFS`);
                return;
            }

            const result = await readBytes(request, Boolean(usable?.partial));
            if ('skipped' in result) {
                if (usable) {
                    remember(songKey, usable);
                    return;
                }
                // Once per track, not once per prefetch pass. Without this the feature can sit
                // completely inert - every transition falling through to the plain crossfade -
                // and print nothing at all to say why.
                if (result.skipped && skipped.get(songKey) !== result.skipped) {
                    skipped.set(songKey, result.skipped);
                    console.log(`[Automix] not analysing "${request.song.name}": ${result.skipped}`);
                }
                return;
            }
            skipped.delete(songKey);
            // Asked a second time, because reading the bytes is the slow part: a full track off the
            // media cache or the network is seconds, and everything after this line - the decode, the
            // spectrogram, the beat model - is the expensive part it would be buying for nobody.
            if (!wanted.has(songKey)) return;

            const buffer = await decodeAtProfileRate(result.bytes);
            const channels = buffer ? toMidSide(buffer) : null;
            // The beat grid, from a model rather than autocorrelation, when this build has one. Asked
            // for here rather than inside `analyseTrack` because it is the impure step - it crosses
            // into the main process. Null keeps `analyseTrack` on the estimator it has always used,
            // the browser build's permanent state and no worse than before.
            //
            // The guard is here with the spectrogram and has to be: it used to sit inside
            // `analyseBeatGrid`, in front of the mel pass it now receives instead of making, and
            // leaving it there would make a model-less build pay a second of FFT per track to hand the
            // answer to nobody. `runModel` records whether the model RUNS; what it then answers is
            // separate, and the profile records this one - see `TrackProfile.gridless`.
            const runModel = request.wantGrid && canRunBeatThis();
            const grid = channels && runModel
                ? await analyseBeatGrid(await melSpectrogramOffThread(channels.mid))
                : null;
            const profile = buffer && channels
                ? await analyseTrackOffThread(channels.mid, buffer.sampleRate, {
                    partial: result.partial,
                    side: channels.side,
                    grid,
                    gridless: !runModel,
                })
                : null;
            remember(songKey, profile);
            if (profile) {
                await saveToCache(storageKey(songKey), profile);
                // The analysed length is printed for the partial case on purpose: "nothing found"
                // and "nothing found in the twelve seconds we were allowed to read" look identical
                // in every other field, and only one of them says the measurement is wrong.
                const at = (seconds: number | null) => (seconds === null ? 'none' : `${seconds.toFixed(2)}s`);
                console.log(
                    `[Automix] analysed "${request.song.name}"`
                    + `${profile.partial ? ` (head only, ${profile.duration.toFixed(1)}s of it)` : ''}:`
                    // Which of the two tempo readers this line came from, said out loud. The fallback
                    // is silent by design - a null grid just leaves `analyseTrack` on the
                    // autocorrelation estimator - so without this the two cases print identically and a
                    // build where the model never loaded is indistinguishable from one where it ran on
                    // every track. That is the difference between the feature being on and off.
                    + ` ${profile.bpm ? `${Math.round(profile.bpm)} BPM (${grid ? 'Beat This!' : 'estimated'})` : ''}`
                    + `${profile.outroBpm && profile.bpm && Math.abs(profile.outroBpm - profile.bpm) > 1
                        ? ` (${Math.round(profile.outroBpm)} at the end)` : ''}`
                    + `${profile.bpm ? `, ${profile.downbeatOffset === null
                        ? 'no bar line found' : `bar line at ${profile.downbeatOffset.toFixed(2)}s`}` : ''}`
                    // The head's own reading of the same line, printed whether or not the whole-track
                    // pass found one - the two cases say different things.
                    //
                    // With both, the gap between them is the point: how far the end-anchored grid has
                    // walked off the music by the time a track is entered.
                    //
                    // With only this one, the point is larger. The head pass reads the FIRST thirty
                    // seconds against its own period; the whole-track pass reads the LAST two dozen bars
                    // against the track's. So a head answer beside `no bar line found` says the evidence
                    // is in the audio and the whole-track window or period could not use it - and a
                    // track with neither has no bar line to read. Requiring both to print threw that
                    // distinction away, on exactly the tracks that needed explaining.
                    + `${profile.bpm && profile.headDownbeatOffset !== null
                        ? ` (head ${profile.headDownbeatOffset.toFixed(2)}s)` : ''}`
                    + `${profile.bpm ? ', ' : ''}`
                    + `${profile.loudness.toFixed(1)} LUFS,`
                    + ` lead-in ${profile.leadIn.toFixed(2)}s,`
                    + ` lead-out ${at(profile.leadOut)}, body ends ${at(profile.bodyOut)} early,`
                    + ` section ${at(profile.sectionStart)} of ${profile.sections.length},`
                    + ` voice ${at(profile.vocalStart)},`
                    + ` ${profile.startsHot ? 'starts hot' : 'has an intro'}`
                    + `${profile.endsHot === null ? '' : `, ${profile.endsHot ? 'ends hot' : 'decays out'}`}`,
                );
            }
        } catch (error) {
            console.warn('[Automix] track analysis failed', error);
            remember(songKey, null);
        } finally {
            inFlight.delete(songKey);
        }
    });

    await queue;
};

/**
 * How far the readings may fall short of the track's length and still describe how it ends.
 *
 * Deliberately not zero. A blend stops the outgoing deck as soon as its fade finishes, a fraction
 * before the media would have run out on its own, so demanding the whole file would throw away every
 * track that was blended - all of them. Wide enough for that, narrow enough that the two cases worth
 * refusing never pass: a seek, and a track skipped part way, both of which move this by tens of seconds.
 */
const TAIL_MISS_TOLERANCE_SEC = 2;

/**
 * Completes a head-only profile from the deck's own readings, once a track has played out.
 *
 * The only way the END of an uncached track is ever knowable. A range request off the tail is not
 * decodable - see readPrefix - so with song caching off the analysis can only describe how a track
 * STARTS, leaving `endsHot` and `outroSlope` null and taking three of the five transition styles off
 * the table. But those bytes are not missing: they pass the deck on the way to the speakers, and the
 * analyser tap reads a level off every frame. So the half a download cannot reach is measured on the
 * first listen instead, and the couple of hundred bytes it produces are kept - the audio itself is not.
 *
 * It converges over a rotation rather than working first time, which is inherent: nothing can know how
 * a song ends before hearing it end.
 */
export const recordPlayedTail = (
    song: SongResult,
    levels: readonly number[],
    hopSec: number,
    /** The track's real length, to check these readings actually span it. */
    duration: number,
): void => {
    const songKey = getPlaybackSongKey(song);
    const known = profiles.get(songKey);
    if (!known || !known.partial) return;
    // One test for both ways this can be the wrong track's shape: too little played means it was
    // skipped or seeked forward, too much means it was seeked back and some of it counted twice.
    // Either way a level series that does not span the file describes an ending it never had.
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (Math.abs(levels.length * hopSec - duration) > TAIL_MISS_TOLERANCE_SEC) return;

    const edges = measureEdges(levels, hopSec);
    if (!edges) return;

    const profile: TrackProfile = {
        ...known,
        partial: false,
        duration,
        leadOut: Math.max(0, duration - edges.soundingEnd),
        bodyOut: Math.max(0, duration - edges.bodyEnd),
        endsHot: edges.endsHot,
        outroSlope: edges.outroSlope,
        // Measured over the whole track rather than the head, so it supersedes the stored one.
        loudness: edges.loudness,
        tailDb: edges.tailDb,
        // Everything the tap cannot answer stays null rather than being filled with the head's
        // value. A level series says how loud the end was; it says nothing about what key it is in,
        // how bright it is or whether it slowed down, and a head-shaped guess at those would be
        // indistinguishable from a measurement to everything downstream.
        outroTone: null,
        outroKey: null,
        outroBpm: null,
    };
    remember(songKey, profile);
    void saveToCache(storageKey(songKey), profile);
    console.log(
        `[Automix] heard out "${song.name}": ${edges.loudness.toFixed(1)} dBFS,`
        + ` lead-out ${profile.leadOut?.toFixed(2)}s, body ends ${profile.bodyOut?.toFixed(2)}s early,`
        + ` ${edges.endsHot ? 'ends hot' : 'decays out'} (${edges.outroSlope.toFixed(2)} dB/s)`,
    );
};

/** Drops the in-memory side. The stored profiles stay: they describe the file, not the session. */
export const clearTrackProfileRuntime = () => {
    profiles.clear();
    inFlight.clear();
    skipped.clear();
    // Nothing is in range until a prefetch pass says so again, which is what a cleared session means.
    wanted = new Set();
};
