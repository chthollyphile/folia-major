import type { SongResult } from '../../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { notifyAudioCached, onAudioCached, saveAudioBlob } from '../audioCache';
import { getFromCache, saveToCache } from '../db';
import { omni } from '../onlineMusic/omni';
import { hasProviderKeptSongAudio, keepProviderSongAudio, keepsOwnSongAudio } from '../onlineMusic/providerRegistry';
import { getCachedSongAudioBlob, hasCachedSongAudio, saveSongAudioLevel } from '../onlineMusic/resourceCache';
import { getSongResourceCacheKey } from '../onlineMusic/resourceKeys';
import { isCacheableAudioResponse } from '../playbackRecovery/mediaCacheGuard';
import type { PlaybackRepresentation } from '../../types/playbackRecovery';
import { getPlaybackAnalysisKey, getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';
import { mayStoreSongAudio, whyNotTheSong, whyNotTheSongPlayed, whyPreviewClip } from '../wholeSongCheck';
import { analyseTrackOffThread, measureProgramLoudnessOffThread, melSpectrogramOffThread } from './analysisOffThread';
import { analyseBeatGrid, canRunBeatThis } from '../analysis/beatThis';
import { getTrackBeatGrid } from '../analysis/beatGrid';
import { decodeAtRate, readLocalTrackFile, toMidSide } from '../analysis/trackAudio';
import { decodeTrackAtRate, giveTrackBytes, trackBytesFit } from '../analysis/trackBytes';
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
// A library server's stream (Navidrome) is never cached, so only its front is read, whatever the
// setting: see `downloadRuleOf`.

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

/**
 * What became of the last request for a track that left no profile behind: dropped for being out of
 * scope, or skipped for want of bytes. A failure needs no entry - it is a null profile. Only for
 * `describeProfileState`.
 *
 * Kept because "no profile" alone could not tell a track never asked for from one asked for and
 * turned away, and the first is a bug while the second is the bandwidth rule working. Every local
 * and Navidrome transition planned blind for months, and the log said "never analysed" - the same
 * words a track still waiting its turn prints. Nothing is recorded for a track nobody asked about.
 */
const outcomes = new Map<string, string>();
const noteOutcome = (songKey: string, outcome: string) => rememberCapped(outcomes, songKey, outcome);

/**
 * Downloads whose server answered a range request with the whole file, by the song and its URL.
 *
 * A transcoding server does this every time - the stream it makes has no length to take a range of -
 * so without it every prefetch pass (one per song start) asked again, and the server started a
 * transcode for the analyser to cut off. A URL names one stream, so the answer holds for the session.
 */
const rangeRefusedDownloads = new Map<string, string>();
const RANGE_REFUSED = 'the server would not serve a partial range, and a full download is not ours to spend';

/** Sets `key`, keeping no more entries than there are profiles. */
const rememberCapped = (map: Map<string, string>, key: string, value: string) => {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_PROFILES) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
    }
};

/**
 * Files found this session not to be their song (wholeSongCheck.ts), with why: a download by the
 * song and its URL, a copy in the media cache by the song's audio key. Without them every prefetch
 * pass (one per song start) downloaded the whole file again, or read the whole copy and its header
 * again, to learn the same thing. A URL names one file; a copy is forgotten when the song's audio
 * is written (a new copy) or is found gone (playback deleted it). Any other skip stays retryable.
 */
const notTheSongDownloads = new Map<string, string>();
const notTheSongCopies = new Map<string, string>();
onAudioCached(cacheKey => { notTheSongCopies.delete(cacheKey); });

/** Remembers why `key` is not the song, as many as there are profiles, and answers with the why. */
const noteNotTheSong = (notTheSong: Map<string, string>, key: string, why: string): string => {
    notTheSong.delete(key);
    notTheSong.set(key, why);
    while (notTheSong.size > MAX_PROFILES) {
        const oldest = notTheSong.keys().next().value;
        if (oldest === undefined) break;
        notTheSong.delete(oldest);
    }
    return why;
};

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
 *
 * Keyed by the song, not by the analysis key. The analysis key changes when a transcode registers
 * (getPlaybackAnalysisTarget), and the scope is set at the track change, before playback has found it
 * cannot play the file - so a scope of analysis keys dropped the one request that reads the transcode,
 * for a track that never left the scope.
 */
let wanted: ReadonlySet<string> = new Set();

/**
 * Narrows analysis to these tracks. Anything queued for a track not in the list is dropped when its
 * turn comes; anything already running finishes, since a decode cannot be taken back mid-way.
 *
 * Dropping is safe to do at any time: nothing measured is remembered for a dropped track (only that
 * it was dropped, for the log), so it is simply measured on a later pass if it comes back into range.
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

const profileListeners = new Set<() => void>();

/** Told each time a track's profile is measured or read back; the volume balance waits on its loudness. */
export const onTrackProfile = (listener: () => void): (() => void) => {
    profileListeners.add(listener);
    return () => { profileListeners.delete(listener); };
};

/** A stored profile as it is on disk, read only. The volume balance takes an old whole-track reading from it. */
export const readStoredTrackProfile = (analysisKey: string): Promise<TrackProfile | null> => (
    getFromCache<TrackProfile>(storageKey(analysisKey))
);

/** A whole track's BS.1770 loudness, measured ahead of the rest of its profile, and when each step ended (performance.now()). */
export interface ProgramMeasurement {
    /** The analysis key. */
    key: string;
    song: SongResult;
    loudness: number;
    peak: number;
    queuedAt: number;
    startedAt: number;
    bytesAt: number;
    decodedAt: number;
    measuredAt: number;
    /** When the full profile was done, or null when it failed. */
    profiled: Promise<number | null>;
}

const programListeners = new Set<(measurement: ProgramMeasurement) => void>();

/** Told as soon as a whole track's loudness is measured, before the beat model runs; the volume balance listens. */
export const onProgramMeasured = (listener: (measurement: ProgramMeasurement) => void): (() => void) => {
    programListeners.add(listener);
    return () => { programListeners.delete(listener); };
};

const remember = (songKey: string, profile: TrackProfile | null) => {
    profiles.delete(songKey);
    profiles.set(songKey, profile);
    profileListeners.forEach(listener => listener());
    // The answer replaces whatever an earlier request came to; left behind, it would be read back once
    // this profile is evicted, older than the measurement that superseded it.
    outcomes.delete(songKey);
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
    song ? profiles.get(getPlaybackAnalysisKey(song)) ?? null : null
);

/**
 * Where a track's analysis stands, in words for a log line: measured, still queued, or why not.
 * "never requested" is the one that points at a caller rather than at the track.
 */
export const describeProfileState = (song: SongResult): string => {
    const analysisKey = getPlaybackAnalysisKey(song);
    const state = describeKey(analysisKey);
    if (state) return state;
    // Transcoded since it was looked at: the original's key holds what became of that, and saying it
    // keeps a track measured before its transcode from reading as one nobody asked about.
    const songKey = getPlaybackSongKey(song);
    const original = songKey === analysisKey ? null : describeKey(songKey);
    return original ? `nothing measured from its transcode (the original file: ${original})` : 'never requested';
};

/** What `describeProfileState` says of one key, or null when nothing was ever asked of it. */
const describeKey = (key: string): string | null => {
    const profile = profiles.get(key);
    if (profile) return profile.partial ? 'measured (head only)' : 'measured';
    if (inFlight.has(key)) return 'queued, not finished yet';
    if (profiles.has(key)) return 'could not be measured';
    return outcomes.get(key) ?? null;
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
    // `held`: already held to the whole-song rule on the way in (or a local file, which is the song),
    // so the hand-over to the shared bytes need not check it again (from the PR #750 review, B6).
    | { bytes: ArrayBuffer; partial: boolean; held?: boolean }
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
        return { skipped: RANGE_REFUSED };
    }
    return { bytes: await response.arrayBuffer(), partial: true };
};

/**
 * For a song whose provider keeps its audio in a cache of its own. With `store` the provider is
 * asked to keep the file (a download, when it is not there); without, only whether it holds one.
 * A kept file is announced like a media-cache write, with the URL it is read by: that wakes a
 * separation waiting for the song, and gives it the URL if it was asked before the song had one.
 *
 * Called on every way through `ensureTrackProfile`, not only before a read. A song measured
 * earlier is never read here again, and its file may not be kept (measured before files were
 * kept, or dropped by the cache's size limit since); a separation asked before the URL existed
 * has to hear of a file that was kept all along.
 */
const keepWithProvider = async (song: SongResult, audioUrl: string | null | undefined, store: boolean): Promise<boolean> => {
    // A clip its provider marked is not the song, and is not kept as it (wholeSongCheck.ts).
    if (!audioUrl || whyPreviewClip(audioUrl) || !keepsOwnSongAudio(song)) return false;
    const kept = await (store ? keepProviderSongAudio : hasProviderKeptSongAudio)(song, audioUrl);
    if (kept) notifyAudioCached(getSongResourceCacheKey('audio', song), audioUrl);
    return kept;
};

/**
 * What reading a track's URL for analysis costs, which decides how much of it may be read.
 *
 * - `free`: a blob: or file: URL, or a song from this machine. Already here, so read whole whatever
 *   the setting says, and never stored - there is nothing to download again.
 * - `library`: a library server's stream (Navidrome). Only the front of it, whatever the setting:
 *   the media cache keeps online songs only, so a whole read would be thrown away after measuring -
 *   every track downloaded a second time, beside the stream playing it. That is what happened while
 *   it counted as "local" for not being an online song. Its ending is measured as it plays out.
 * - `online`: a real download, the whole file only with song caching on, and then stored.
 */
export const downloadRuleOf = (song: SongResult, audioUrl: string): 'free' | 'library' | 'online' => {
    if (audioUrl.startsWith('blob:') || audioUrl.startsWith('file:')) return 'free';
    const kind = getPlaybackSourceRef(song).kind;
    if (kind === 'online') return 'online';
    return kind === 'navidrome' ? 'library' : 'free';
};

const readBytes = async (
    { song, audioUrl, enableMediaCache }: ProfileRequest,
    /** The representation `songKey` names, resolved with it (getPlaybackAnalysisTarget). */
    representation: PlaybackRepresentation | null,
    /** A head-only profile is already stored, so there is nothing a second range request buys. */
    hasStoredPartial: boolean,
): Promise<BytesResult> => {
    if (representation) {
        try {
            const response = await fetch(representation.url);
            // An evicted transcode answers 404 with a text body. Decoding that would be stored as a
            // permanent "unsupported" verdict for a track that is merely no longer cached.
            if (!response.ok) throw new Error(`representation responded ${response.status}`);
            return { bytes: await response.arrayBuffer(), partial: false };
        } catch (error) {
            console.warn('[Automix] could not read the playback representation for analysis', error);
            return { skipped: 'the playback representation could not be read' };
        }
    }
    // Nothing measured from a file that is not the song is kept as the song's (wholeSongCheck.ts):
    // a stored profile is read before anything is measured again, so a clip's would stand in for
    // the song for good. Not measured at all, also for the play now: a profile in memory is as
    // final for this session (see the top of `ensureTrackProfile`), and a blend without one falls
    // back to the live measurement of the deck, as for a track nothing could be read of. Skipped
    // rather than failed, so the song is measured once its own file can be had; and remembered
    // (`notTheSongCopies`, `notTheSongDownloads`), so the same file is not read again meanwhile.
    const copyKey = getSongResourceCacheKey('audio', song);
    const knownCopy = notTheSongCopies.get(copyKey);
    if (knownCopy && await hasCachedSongAudio(song)) return { skipped: knownCopy };
    notTheSongCopies.delete(copyKey);
    const cached = await getCachedSongAudioBlob(song);
    if (cached) {
        const notTheSong = await whyNotTheSong(song, null, cached);
        if (notTheSong) return { skipped: noteNotTheSong(notTheSongCopies, copyKey, `the copy in the media cache is ${notTheSong}`) };
        return { bytes: await cached.arrayBuffer(), partial: false, held: true };
    }

    if (!audioUrl) {
        // A local track with no URL in hand (the prefetcher has none to give for a local file) is read
        // off its own file handle (analysis/trackAudio.ts).
        const file = await readLocalTrackFile(song);
        if (file) return { bytes: file, partial: false, held: true };
        return { skipped: 'not cached yet and no URL to read it from' };
    }
    // Before any read: a clip its provider marked is not downloaded only to be refused.
    const previewClip = whyPreviewClip(audioUrl);
    if (previewClip) return { skipped: `its URL is ${previewClip}` };
    const downloadKey = `${getPlaybackSongKey(song)} ${audioUrl}`;
    const knownDownload = notTheSongDownloads.get(downloadKey);
    if (knownDownload) return { skipped: knownDownload };
    const rule = downloadRuleOf(song, audioUrl);
    const isLocal = rule === 'free';

    try {
        // A provider with a cache of its own is asked to keep the file before it is read, so the
        // read below is of the kept copy and the track comes down once. With song caching off
        // nothing is kept, but a file kept earlier is as free to read as any cached one.
        const ownCache = !isLocal && keepsOwnSongAudio(song);
        const kept = ownCache && await keepWithProvider(song, audioUrl, enableMediaCache);

        if (rule === 'library' || (!isLocal && !enableMediaCache && !kept)) {
            // Song caching is off, so the full file would be bandwidth nobody agreed to. Take the
            // front of it instead: less than the transition is worth, and it still answers the
            // questions about how this track STARTS - which is what the chooser needs from the
            // track it is blending into. How it ends is filled in once it has played out
            // (`recordPlayedTail`). A library stream takes this road whatever the setting: nothing
            // keeps it, so a whole read would be the second download of every track.
            if (hasStoredPartial) return { skipped: '' };
            const refused = rangeRefusedDownloads.get(downloadKey);
            if (refused) return { skipped: refused };
            const prefix = await readPrefix(audioUrl);
            if ('skipped' in prefix && prefix.skipped === RANGE_REFUSED) {
                rememberCapped(rangeRefusedDownloads, downloadKey, RANGE_REFUSED);
            }
            return prefix;
        }

        const response = await fetch(audioUrl);
        // An error page is a body too: without this check it is saved below as the track's audio.
        if (!response.ok) throw new Error(`audio request failed with status ${response.status}`);
        const blob = await response.blob();
        // A JSON refusal or a truncated body is not audio either: cached, it would stand in for the
        // real track on every later play, and decoded, it would be remembered as a permanent
        // "unsupported" verdict for a track that merely failed to download this once.
        if (!isCacheableAudioResponse(response, blob)) {
            console.warn('[Automix] the download for analysis does not look like audio', {
                status: response.status,
                contentType: response.headers?.get('content-type') ?? blob.type,
                size: blob.size,
            });
            return { skipped: 'the download was not audio' };
        }
        if (rule === 'online' && !ownCache) {
            // The same write the audio bridge would have done after playback, under the same check
            // (wholeSongCheck.ts: a preview clip, or a file under half the song, is not stored).
            // Fetching once and feeding both is the whole reason a full read is allowed here at all.
            // The song has no copy (read above), so this never writes over one.
            // A file not stored is not the song (under half of it: a marked clip never gets here),
            // so it is not measured either.
            const level = omni.levelOfAudioSource(audioUrl);
            const check = await mayStoreSongAudio(song, audioUrl, blob, false);
            if (!check.store) {
                console.log(`[Automix] "${song.name}" not saved to the media cache from the analysis read, the file fetched at ${level ?? 'an unknown level'} is ${check.why}`);
                return { skipped: noteNotTheSong(notTheSongDownloads, downloadKey, `the file fetched is ${check.why}`) };
            }
            await saveAudioBlob(getSongResourceCacheKey('audio', song), blob);
            // With the level this URL was fetched at, so that playback can tell the copy from one of
            // the level the quality option asks for later.
            await saveSongAudioLevel(song, level);
            console.log(`[Automix] "${song.name}" saved to the media cache from the analysis read, fetched at ${level ?? 'an unknown level'}`);
            return { bytes: await blob.arrayBuffer(), partial: false, held: true };
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
    // Resolved together: the bytes read below must be the representation this key names.
    const { key: songKey, representation } = getPlaybackAnalysisTarget(request.song);
    // The scope is kept by song (see `wanted`): a transcode registering moves `songKey` - which, despite
    // its name, is the analysis key - and not this.
    const scopeKey = getPlaybackSongKey(request.song);
    if (inFlight.has(songKey)) return;
    if (profiles.has(songKey) && !needsGrid(request, profiles.get(songKey))) {
        // Only asked, never stored from here: this runs on every track change, ahead of the
        // queue that drops the songs a listener skips past, and a download cannot be taken back.
        void keepWithProvider(request.song, request.audioUrl, false);
        return;
    }
    inFlight.add(songKey);
    const queuedAt = performance.now();
    let profiled: (at: number | null) => void = () => undefined;

    queue = queue.then(async () => {
        const startedAt = performance.now();
        try {
            // Asked here, at the front of the queue, not when this was enqueued - see `wanted`. The
            // listener may have skipped past this track while it was waiting its turn, and the whole
            // point is to not spend a decode and a model pass on where they no longer are.
            if (!wanted.has(scopeKey)) {
                noteOutcome(songKey, 'dropped, not the current or the next track when its turn came');
                return;
            }

            const stored = await getFromCache<TrackProfile>(storageKey(songKey));
            // A whole-file profile names the length of the file it measured. One under half the
            // song was made from a clip (a version before the check above kept them): it is not
            // used, and the song is measured again; a new profile takes its place. A head-only one
            // names only the length of the head, which says nothing.
            const madeFromClip = stored && !stored.partial ? whyNotTheSongPlayed(request.song, null, stored.duration) : null;
            if (madeFromClip) {
                console.log(`[Automix] the stored profile of "${request.song.name}" is not used, the file it measured is ${madeFromClip}`);
            }
            const usable = stored?.version === TRACK_PROFILE_VERSION && !madeFromClip ? stored : null;
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
                void keepWithProvider(request.song, request.audioUrl, request.enableMediaCache);
                return;
            }

            const result = await readBytes(request, representation, Boolean(usable?.partial));
            const bytesAt = performance.now();
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
                noteOutcome(songKey, `skipped: ${result.skipped || 'nothing more to read'}`);
                return;
            }
            skipped.delete(songKey);
            // Asked a second time, because reading the bytes is the slow part: a full track off the
            // media cache or the network is seconds, and everything after this line - the decode, the
            // spectrogram, the beat model - is the expensive part it would be buying for nobody.
            // Asked before the bytes are kept too (from the PR #750 review): a dropped song's bytes would
            // push the current or next song's out of the shared cache.
            if (!wanted.has(scopeKey)) {
                noteOutcome(songKey, 'dropped, not the current or the next track when its turn came');
                return;
            }

            // The whole song, read or downloaded under this file's rules, is kept for 智能动感模式 and
            // the stems (analysis/trackBytes.ts), so neither reads or streams it again. Only kept from
            // here, never taken: this read's download is also the media-cache write above, which a
            // copy handed over from elsewhere would skip.
            // A file its provider keeps was not held to the whole-song rule on the way in: held here,
            // on a copy taken now (the decode below detaches the read), without holding the decode up.
            // Only a file that would be kept is copied, and that copy is the one kept (from the PR #750
            // review: a copy for the cache, then another inside it, and a file over the cache's limit
            // copied only to be thrown away).
            // Checked here only when the read did not check it already (`held`): a file its provider
            // keeps, the playback representation, or a blob: / file: URL (from the PR #750 review, B6).
            if (!result.partial && trackBytesFit(result.bytes.byteLength)) {
                const copy = result.bytes.slice(0);
                if (result.held) {
                    giveTrackBytes(songKey, copy);
                } else {
                    const song = request.song;
                    void whyNotTheSong(song, null, new Blob([copy]))
                        .then((notTheSong) => { if (!notTheSong) giveTrackBytes(songKey, copy); })
                        .catch(() => undefined);
                }
            }

            // A head-only read is not the track its key names: decoded on its own, so a whole-track
            // decode of the same key and rate cannot join it and store the head's beats as the track's
            // (from the PR #750 review).
            const buffer = result.partial
                ? await decodeAtRate(result.bytes, PROFILE_SAMPLE_RATE)
                : await decodeTrackAtRate(songKey, PROFILE_SAMPLE_RATE, result.bytes, decodeAtRate, 'automix profile', 'own');
            const channels = buffer ? toMidSide(buffer) : null;
            // The volume balance's reading, ahead of the beat model: a whole track is read once, so its
            // loudness is known seconds sooner than the profile it also goes into.
            if (buffer && channels && !result.partial) {
                const decodedAt = performance.now();
                const program = await measureProgramLoudnessOffThread(channels.mid, channels.side, buffer.sampleRate);
                if (program) {
                    const measurement: ProgramMeasurement = {
                        key: songKey, song: request.song, ...program, queuedAt, startedAt, bytesAt, decodedAt,
                        measuredAt: performance.now(),
                        profiled: new Promise<number | null>((resolve) => { profiled = resolve; }),
                    };
                    programListeners.forEach(listener => listener(measurement));
                }
            }
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
            // Automix analyses minutes ahead of the transition, so the CPU may stand in for the GPU.
            //
            // A whole track goes through analysis/beatGrid.ts: read back if an earlier
            // run already has it, joined if one is running it right now, kept for the next one otherwise.
            // A head-only read neither uses nor stores one there: its profile describes the head, and so
            // must its grid.
            const mid = channels?.mid;
            const grid = mid && runModel
                ? result.partial
                    ? await analyseBeatGrid(await melSpectrogramOffThread(mid), { cpuFallback: true })
                    : await getTrackBeatGrid(songKey, async () => mid, { cpuFallback: true })
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
            profiled(profile ? performance.now() : null);
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
            profiled(null);
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
    /** What the deck played from. */
    src: string | null,
): void => {
    // The song's own key, not the analysis key, and on purpose. A head-only profile is only ever made
    // from the original file, before any transcode registers: a transcode is read whole, so the key
    // naming it never holds a head-only profile to complete. What the deck played may be that
    // transcode - lossless, on the original's timeline - so its ending is the original's ending.
    const songKey = getPlaybackSongKey(song);
    const known = profiles.get(songKey);
    if (!known || !known.partial) return;
    // What the deck played was not the song (a clip): how it ended is not how the song ends, and it
    // is not kept as the song's (wholeSongCheck.ts).
    if (whyNotTheSongPlayed(song, src, duration)) return;
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
        // Nor does it give a BS.1770 reading or a peak, so those stay the head's, and say so.
        programFromHead: true,
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
    notTheSongDownloads.clear();
    notTheSongCopies.clear();
    // What the requests came to goes with the profiles: kept, it would describe a session that is gone.
    outcomes.clear();
    // Nothing is in range until a prefetch pass says so again, which is what a cleared session means.
    wanted = new Set();
};
