import type { SongResult } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ExternalPlaybackStartOptions, OnlineExternalPlaybackProvider, ProviderExternalPlaybackStatus } from '../../../types/onlineMusic';
import { requireSpotifySong } from './spotifyNormalize';
import { requestSpotify } from './spotifyTransport';
import type { SpotifyWireClientStatus } from './spotifyTransport';

// src/services/onlineMusic/spotify/spotifyClientPlayback.ts
// Spotify's songs sound in Spotify's own desktop app (electron/spotify/officialClient.cjs): Spotify
// gives a free account no audio key for any other player. Folia keeps the queue; the app is told
// which track to play, where to move, and which tracks follow, and Folia follows its clock. The
// songs that follow are put in the app's queue, so it moves on by itself without a gap; when it
// does, the song Folia asked for is reported ended and the next play adopts the running track.
//
// This is the third way Spotify plays (spotifySoloistPlayback.ts keeps which one is on; the
// provider's `externalPlayback` picks this one or Soloist's by it). When the app is not on this
// computer a song fails with a reason that opens the setup checklist (spotifySetup.ts), where the
// other ways are offered. Nothing falls back to Folia's own player, which a free account cannot use
// (docs/spotify-official-client.md).
// The media session names no track. While it answers, nothing is prepared in the app's queue,
// its coarse position never replaces the song's duration, and a title it shows that is not the
// song Folia asked for ends this external session so Folia's own queue takes the next song.

/**
 * How many songs that follow are put in the app's queue. The app moves on to the first of them by
 * itself without a gap, so the tail is what it has to be given the song after that one.
 */
const PREPARED_SONGS = 3;
/**
 * What the app's own answer to a start says: it took the track, a newer start took over, it took
 * the track but an advertisement of a free account still runs before it, or it never got to it.
 */
type SpotifyClientPlayAnswer = 'loaded' | 'preempted' | 'not-loaded' | 'advertisement';
/**
 * What the app answers a queue write: how many songs it added, whether it emptied its queue first,
 * and the ids its queue holds afterwards, where the state it reports names them at all.
 */
type SpotifyClientQueueAnswer = { added?: number; cleared?: boolean; queue?: unknown };
/** A track change this close to the end of the song Folia asked for is that song ending. */
const END_TOLERANCE_MS = 3000;

interface Attempt {
    id: string;
    /** The song's own name and artist, as the app's page does not say them when it falls back. */
    name: string;
    artist: string;
    hasPlayed: boolean;
    positionMs: number;
    durationMs: number;
    /** The ids put in the app's queue after this song, in order. Written once the app took them. */
    nextIds: string[];
    /** The last answer came from the system media session: it names no track, so nothing is prepared. */
    degraded: boolean;
    /** The id Folia had the app play before this one: the track the app's own "previous" goes back to. */
    previousId: string;
    /** The app was moved to another track by its own controls and Folia already pulled it back once. */
    pulledBack: boolean;
}

let attempt: Attempt | null = null;
/** The id the app already moved on to by itself; the next play of it starts nothing. */
let handoffId: string | null = null;
/** The question being asked, so two songs in a row ask it once. */
let probing: Promise<boolean> | null = null;
/** The app was already told its queue cannot be read, so that is said once in a run. */
let queueUnreadable = false;

/** Whether this build can reach the desktop side at all: the Windows desktop app only. */
const spotifyTransportReady = (): boolean => (
    typeof window !== 'undefined' && typeof window.electron?.spotifyRequest === 'function' && window.electron?.platform === 'win32'
);

/** The steering runs on the Windows desktop app only. */
export const canSteerSpotifyApp = (): boolean => spotifyTransportReady();

/**
 * Whether Spotify's app is on this computer. The desktop side only looks at the launcher on disk
 * and keeps its answer for a minute, so this costs no process and no port. A question that could
 * not be asked says nothing about the app: it counts as a yes, and the call itself then fails with
 * the real reason.
 */
export const probeSpotifyClientApp = async (): Promise<boolean> => {
    if (!spotifyTransportReady()) return false;
    probing ??= requestSpotify<{ available?: boolean }>('client_probe')
        .then(answer => answer?.available === true, error => {
            console.warn('[SpotifyClient] whether Spotify\'s app is installed could not be read', error);
            return true;
        })
        .finally(() => { probing = null; });
    return probing;
};

const songIdOf = (song: SongResult): string | null => {
    try { return requireSpotifySong(song); } catch { return null; }
};

/** The song's artist names, one entry each, as the provider lists them. */
const artistNameListOf = (song: SongResult): string[] => {
    const artists = (song as { artists?: unknown }).artists;
    if (!Array.isArray(artists)) return [];
    return artists
        .map(artist => (typeof artist === 'string' ? artist : String((artist as { name?: unknown })?.name ?? '')))
        .filter(Boolean);
};

/** The song's artist names, however the provider keeps them. */
const artistNamesOf = (song: SongResult): string => artistNameListOf(song).join(', ');

const ended = (current: Attempt): ProviderExternalPlaybackStatus => ({
    mediaId: current.id, isPlaying: false, ended: true,
    durationMs: current.durationMs, positionMs: current.durationMs || current.positionMs,
});

// NFKC folds the full-width letters and brackets a Chinese layout types into their plain forms.
const plainName = (text: unknown): string => String(text ?? '').normalize('NFKC').trim().toLocaleLowerCase();

/** A title without the trailing credit "(feat. …)", "(ft. …)" or "(featuring …)", which the two sides need not write alike. A "(with …)" stays: it is part of the title, not a credit. */
const plainTitle = (text: unknown): string => plainName(text).replace(/\s*[([]\s*(?:featuring|feat\.?|ft\.?)\b[^)\]]*[)\]]\s*$/i, '');

/** Whether one of the artist names the media session shows is the song's own (it joins them its way). */
const mentionsArtist = (wanted: string, shown: string): boolean => {
    const target = plainName(wanted);
    if (!target) return true;
    return shown.split(/[,;&/]/).map(part => plainName(part)).filter(Boolean)
        .some(part => part.includes(target) || target.includes(part));
};

/**
 * Whether the track the media session shows is another song than the one Folia asked for: its
 * title differs, or it names an artist that is not this song's. Without a title, nothing is known
 * and the answer is "no".
 */
const namesAnotherTrack = (current: Attempt, data: SpotifyWireClientStatus): boolean => {
    const title = String(data.title ?? '').trim();
    if (!title || !current.name) return false;
    if (plainTitle(title) !== plainTitle(current.name)) return true;
    const artist = String(data.artist ?? '').trim();
    return Boolean(artist && current.artist) && !mentionsArtist(current.artist, artist);
};

/**
 * Every whole artist name the media session's one string can hold: the string itself, and the names
 * it joins with a comma, a slash or an ampersand, or writes a collaboration with as "A x B". A name
 * is never cut: "DJ" is not a part of "DJ Snake".
 */
const shownArtistNames = (shown: string): string[] => {
    const whole = plainName(shown);
    const joined = shown.split(/[,/&]|\bfeat\.?\b|\bft\.?\b|\bx\b/i).map(part => plainName(part)).filter(Boolean);
    return whole ? [whole, ...joined] : joined;
};

/**
 * Whether the title and the artist the media session shows are this song's. Both are needed: that
 * answer names no track id. The session reports only the leading artist of a track - measured, a
 * song of two artists shows one - so one of the song's own names being one of the names shown is
 * enough. Names are compared whole, never as a part of each other. A song whose title or artists
 * are not known here is never taken for it.
 */
const namesThatSong = (song: SongResult, data: SpotifyWireClientStatus): boolean => {
    const title = String(data.title ?? '').trim();
    const shownArtist = String(data.artist ?? '').trim();
    const name = String(song.name ?? '').trim();
    if (!title || !shownArtist || !name) return false;
    if (plainTitle(title) !== plainTitle(name)) return false;
    const shown = shownArtistNames(shownArtist);
    return artistNameListOf(song)
        .map(artist => plainName(artist))
        .filter(Boolean)
        .some(artist => shown.includes(artist));
};

/** The one line of a read refused: what the app shows, and what Folia holds, so a pasted log says why. */
const logAnotherTrack = (song: SongResult, data: SpotifyWireClientStatus): void => {
    const id = String(data.id ?? '').trim();
    // The app's own player names the track and no title.
    const shown = id
        ? `the track ${id}`
        : `"${String(data.title ?? '').trim()}" by "${String(data.artist ?? '').trim()}"`;
    const held = `"${String(song.name ?? '').trim()}" by "${artistNamesOf(song)}"`;
    console.info(`[SpotifyClient] the app is on another track, so no position is read: it plays ${shown}, Folia holds ${held}`);
};

/** How long a session restore waits before asking the app again where its DevTools port is. */
const PORT_SEARCH_RETRY_MS = 3000;

/**
 * The app asked once more where its DevTools port is, a few seconds after a read the media session
 * answered. A read that fails again leaves the first answer standing.
 */
const askAgainWhereItsPortIs = async (first: SpotifyWireClientStatus): Promise<SpotifyWireClientStatus> => {
    await new Promise(resolve => setTimeout(resolve, PORT_SEARCH_RETRY_MS));
    try {
        return await requestSpotify<SpotifyWireClientStatus>('client_status_found');
    } catch (error) {
        console.warn('[SpotifyClient] the app could not be asked again which track it is on', error);
        return first;
    }
};

/**
 * The tail a handoff leaves: the ids the app still holds after the track it moved on to. The song it
 * moved to was the first of what Folia put there; the rest is still queued and is not written again.
 */
const tailAfter = (previous: Attempt | null, id: string): string[] => {
    const nextIds = previous ? previous.nextIds : [];
    const at = nextIds.indexOf(id);
    return at < 0 ? [] : nextIds.slice(at + 1);
};

/** The ids the app says its queue holds, where its answer names them at all. */
const queuedIdsOf = (answer: SpotifyClientQueueAnswer | null | undefined): string[] | null => {
    const queued = answer?.queue;
    return Array.isArray(queued) ? queued.filter((id): id is string => typeof id === 'string') : null;
};

/**
 * The songs that follow, written into the app's queue, which answers what it holds afterwards. Where
 * that is not these songs, or holds one of them twice, the write is made once more - and only where
 * the app emptied its queue first: a read taken a moment after a write cannot prove a song is
 * missing, so writing again on one would add a song the app already has. Answers the ids the app
 * says it holds, or null where its state does not name its queue.
 */
const writeClientQueue = async (ids: string[], held: string[]): Promise<string[] | null> => {
    const answer = await requestSpotify<SpotifyClientQueueAnswer>('client_queue', { ids, queued: held });
    const queued = queuedIdsOf(answer);
    if (!queued) {
        if (!queueUnreadable) {
            queueUnreadable = true;
            console.info('[SpotifyClient] the app does not say what its queue holds; the songs that follow are counted from what Folia wrote');
        }
        return null;
    }
    const missing = ids.filter(id => !queued.includes(id));
    if (new Set(queued).size === queued.length && missing.length === 0) return queued;
    if (answer?.cleared !== true) {
        // The queue it could not empty is left as it is: a song read as missing here is one the app
        // may simply not have written down yet.
        console.info(`[SpotifyClient] the app's queue held ${queued.length} songs where Folia wrote ${ids.length}; it cannot empty its queue, so nothing is written again`);
        return queued;
    }
    const again = await requestSpotify<SpotifyClientQueueAnswer>('client_queue', { ids, queued });
    const how = again?.cleared === true
        ? `it is emptied and ${ids.length} songs written once more`
        : `${typeof again?.added === 'number' ? again.added : 0} songs added behind what it already held`;
    console.info(`[SpotifyClient] the app's queue held ${queued.length} songs where Folia wrote ${ids.length}; ${how}`);
    return queuedIdsOf(again);
};

/** Turns what the app said into Folia's status for the song it asked for. */
export const statusOfClient = (data: SpotifyWireClientStatus): ProviderExternalPlaybackStatus => {
    const current = attempt;
    const isPlaying = !data.isPaused && !data.isBuffering;
    // An advertisement plays between songs of a free account: it is read as the song still loading,
    // so it is never taken for the song's end or for another song to stop. Nothing is muted.
    if (data.ad) {
        return { mediaId: current?.id ?? '', isPlaying: false, ended: false, starting: true, advertisement: true,
            positionMs: current?.positionMs ?? 0, durationMs: current?.durationMs ?? 0 };
    }
    // The media session answered instead of the app's own player: the DevTools port is down and the
    // app is steered through SMTC (electron/spotify/officialClient.cjs).
    const fallback = data.fallback === true;
    if (current) current.degraded = fallback;
    const id = fallback ? current?.id ?? '' : data.id;
    const status: ProviderExternalPlaybackStatus = {
        mediaId: id, isPlaying, ended: false, positionMs: data.positionMs,
        // A coarse answer knows no duration for this song: it never replaces the one held.
        durationMs: fallback && current ? current.durationMs : data.durationMs,
        starting: !data.isPaused && data.isBuffering,
        degraded: fallback,
    };
    if (!current) return status;
    if (fallback) {
        // The media session names no track, so the app's own move to another song is read from the
        // title it shows: the external session ends and Folia's queue takes the next song.
        if (current.hasPlayed && namesAnotherTrack(current, data)) {
            console.info('[SpotifyClient] Spotify moved on to another track; the external session ends');
            return ended(current);
        }
        if (isPlaying) current.hasPlayed = true;
        current.positionMs = data.positionMs;
        return status;
    }
    if (id === current.id) {
        current.hasPlayed ||= isPlaying;
        if (data.durationMs > 0) current.durationMs = data.durationMs;
        current.positionMs = data.positionMs;
        return status;
    }
    if (id && current.hasPlayed && current.nextIds[0] === id) {
        // The app moved on to the song Folia put next: the asked-for song is over.
        handoffId = id;
        return ended(current);
    }
    if (id && current.hasPlayed && current.durationMs > 0 && current.positionMs >= current.durationMs - END_TOLERANCE_MS) {
        // The song ran out and the app went on to a song of its own (its autoplay): the asked-for song
        // is over; Folia's next play replaces what the app chose.
        return ended(current);
    }
    if (id && current.hasPlayed && !current.pulledBack) {
        // Not Folia's doing and not the song's end: the listener used the app's own controls (its
        // window, a media key it got). The queue is Folia's, so the step is pulled back to Folia's
        // queue in the direction the app moved: onto the track it played before, or on.
        current.pulledBack = true;
        const skipped = id === current.previousId ? 'previous' : 'next';
        console.info(`[SpotifyClient] Spotify was moved to another track by its own controls; Folia's queue goes ${skipped}`);
        return { ...ended(current), skipped };
    }
    return status;
};

/**
 * The failures that mean Spotify's app itself is out of reach: it was closed, its DevTools port
 * stopped answering, or the call to steer it never got there. A track the app will not load, a call
 * it refuses, and the app not being on this computer are about the song or the setup instead, and
 * take the ordinary path of a play that failed.
 */
const unreachableClientFailure = (error: unknown): boolean => {
    if (!(error instanceof OnlineProviderError)) return false;
    if (error.cause === 'client-missing') return false;
    return error.code === 'unavailable' || error.code === 'network';
};

export const spotifyClientPlayback: OnlineExternalPlaybackProvider = {
    canPlay: song => songIdOf(song) !== null,
    // This way plays in Spotify's own app, which keeps a media session of its own: while it sounds
    // Folia's song, the keys are held by Folia (electron/mediaKeys.cjs says why).
    holdsMediaKeys: () => true,
    // And that session is Spotify's for as long as the app runs, not only while Folia's song sounds in
    // it: at the end of a queue, on leaving this route for Folia's own decks, and after the app stopped
    // playing, the app still holds the session Windows hands an unheld media key to. So the keys are
    // Folia's for the whole run while this way is the one picked, and only turning this way off (or
    // quitting Folia) lets them go. The listener's switch for it is the desktop settings' (it is the
    // only place that decides, so nothing here reads it).
    holdsMediaKeysWhileRunning: () => true,
    isUnreachableFailure: unreachableClientFailure,
    isPrepared(song) {
        const id = songIdOf(song);
        return id !== null && (handoffId === id || Boolean(attempt?.hasPlayed && attempt.nextIds[0] === id));
    },
    async prepareNext(song, upcoming) {
        const current = attempt;
        if (!current || current.id !== songIdOf(song)) return;
        // The media session names no track: what the app would move on to cannot be checked, so
        // nothing is prepared while the app is steered coarsely.
        if (current.degraded) return;
        const ids: string[] = [];
        for (const next of upcoming) {
            const id = songIdOf(next);
            if (!id || ids.length >= PREPARED_SONGS) break;
            ids.push(id);
        }
        // Already what the app was given, in that order: there is nothing to write.
        if (ids.join() === current.nextIds.join()) return;
        // Written only once the app took them: a queue write that failed leaves nothing prepared,
        // so the next try asks again instead of reporting a song as ready. What is kept is what the
        // app says it holds; where it names no queue there is only this record to go by, and it is
        // what keeps the next write from adding these songs a second time.
        const confirmed = await writeClientQueue(ids, current.nextIds);
        current.nextIds = confirmed ? ids.filter(id => confirmed.includes(id)) : ids;
    },
    async play(song, startSec, options: ExternalPlaybackStartOptions = {}) {
        const id = songIdOf(song);
        if (!id) throw new OnlineProviderError('not-playable', 'Not a Spotify track', 'spotify');
        if (!(await probeSpotifyClientApp())) {
            console.warn('[SpotifyClient] the Spotify app is not on this computer; the song cannot play in it');
            throw new OnlineProviderError('unavailable', 'The Spotify app is not installed', 'spotify', 'client-missing');
        }
        const startMs = Math.max(0, Math.round(startSec * 1000));
        const adopt = handoffId === id && startMs === 0;
        const previousId = attempt && attempt.id !== id ? attempt.id : attempt?.previousId ?? '';
        // The app moved to the song Folia put first: what it still holds after that one is its queue,
        // and is not written again.
        const carried = adopt ? tailAfter(attempt, id) : [];
        handoffId = null;
        attempt = {
            id, name: String(song.name ?? ''), artist: artistNamesOf(song),
            hasPlayed: adopt, positionMs: startMs, durationMs: song.durationMs ?? 0, nextIds: carried, degraded: false,
            previousId, pulledBack: false,
        };
        if (adopt) {
            console.info('[SpotifyClient] The app already plays the next song; it is adopted');
            return;
        }
        // An advance Folia made by itself is not a press: the desktop side is told so, and does not
        // start or restart Spotify for it: that one stops there when the app cannot be reached.
        const userAction = options.userAction !== false;
        const answer = await requestSpotify<SpotifyClientPlayAnswer>('client_play', { id, startMs, userAction });
        // A newer start replaced this one: nothing went wrong, and there is nothing to report.
        if (answer === 'preempted') {
            console.info('[SpotifyClient] a newer play took the app; this one stops');
            return;
        }
        // An advertisement of a free account was on the screen when the app took the call: the track
        // is accepted, and the status reads follow it (an advertisement reads as the song loading).
        if (answer === 'advertisement') {
            console.info('[SpotifyClient] an advertisement plays before the song; the app follows it');
            return;
        }
        // The app took the call and never got to the track: that is a failure of this song.
        // One track Spotify will not load says nothing about the next one.
        if (answer !== 'loaded') {
            throw new OnlineProviderError('not-playable', 'The Spotify app did not load the song', 'spotify');
        }
        console.info('[SpotifyClient] The app plays the song');
    },
    // The attempt of the window that started the song died with it: a fresh one lets prepareNext
    // write the app's queue again, and lets the app's own advance be read as this song's end, for the
    // track it is still playing. Nothing is started here. A window that takes a track over while it
    // still holds this run's attempt keeps what the app has queued behind it, so it is not written
    // twice; one that does not has nothing to keep.
    adopt(song) {
        const id = songIdOf(song);
        if (!id) return;
        const carried = tailAfter(attempt, id);
        handoffId = null;
        attempt = {
            id, name: String(song.name ?? ''), artist: artistNamesOf(song),
            hasPlayed: true, positionMs: 0, durationMs: song.durationMs ?? 0, nextIds: carried, degraded: false,
            previousId: '', pulledBack: false,
        };
    },
    async pause() {
        await requestSpotify('client_pause');
    },
    async resume() {
        try {
            await requestSpotify('client_resume');
        } catch (error) {
            // The listener pressed play and the app cannot be resumed: it was closed (or is gone
            // from its port). That press is the listener's own action, so the app is started again
            // on the song Folia holds, from the position Folia holds. A pause, and the advance
            // Folia makes by itself, never come here.
            const code = (error as { code?: string } | null)?.code;
            const current = attempt;
            if (!current || (code !== 'unavailable' && code !== 'network')) throw error;
            console.info('[SpotifyClient] Spotify cannot be resumed; the listener pressed play, so it is started on the song again', error);
            // A new start empties the app's queue and history: what was prepared is written again
            // below, because Folia's own record of what it prepared does not change and would not ask.
            const prepared = current.nextIds;
            current.nextIds = [];
            current.hasPlayed = false;
            current.pulledBack = false;
            current.degraded = false;
            const answer = await requestSpotify<SpotifyClientPlayAnswer>('client_play', {
                id: current.id, startMs: Math.max(0, Math.round(current.positionMs)), userAction: true,
            });
            if (answer === 'preempted') return;
            if (answer !== 'loaded') throw new OnlineProviderError('not-playable', 'The Spotify app did not load the song', 'spotify');
            // A song asked for in the meantime owns the queue now.
            if (attempt !== current || prepared.length === 0) return;
            try {
                // The start the app was just given emptied its queue: it holds none of them, and what
                // Folia wrote before is no report of the app's queue now.
                const confirmed = await writeClientQueue(prepared, []);
                current.nextIds = confirmed ? prepared.filter(id => confirmed.includes(id)) : prepared;
            } catch (queueError) {
                // The song plays; only its tail is missing, and the next queue edit writes it again.
                console.warn('[SpotifyClient] the songs that follow could not be put back after the restart', queueError);
            }
        }
    },
    async seek(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new OnlineProviderError('invalid-response', 'Spotify seek position is invalid', 'spotify');
        }
        await requestSpotify('client_seek', { ms: Math.round(seconds * 1000) });
    },
    async setVolume(volume) {
        await requestSpotify('client_volume', { value: Math.min(1, Math.max(0, volume)) });
    },
    // Where the app is on this song right now. A fresh run has found no port yet, so the answer is the
    // media session's, which names the track only by the title and artist it shows: both have to be
    // this song's. The call reads the app's state and nothing else - it starts, resumes and pauses
    // nothing - and an answer that cannot be had is no position at all.
    async runningPositionMs(song) {
        let data: SpotifyWireClientStatus;
        try {
            data = await requestSpotify<SpotifyWireClientStatus>('client_status');
        } catch (error) {
            console.warn('[SpotifyClient] the app could not say which track it is on', error);
            return null;
        }
        if (data.ad) return null;
        // An answer that names the track comes from the app's own player: the id decides, whatever
        // artist names its page lists. Only a media session's answer, which names no track, is read
        // by the title and artist it shows. A refused read says both sides, once.
        const shownId = String(data.id ?? '').trim();
        if (!(shownId ? shownId === songIdOf(song) : namesThatSong(song, data))) {
            logAnotherTrack(song, data);
            return null;
        }
        return Math.max(0, Math.round(Number(data.positionMs) || 0));
    },
    // What the app has for a song Folia did not start, as a session restore finds it: the read brings
    // this run's one search for the app's DevTools port, so an app left running is named by the track
    // it is on. Nothing is started, resumed or paused for it; an app that cannot be asked, one on
    // another track and one that fell back to the media session all answer a status that names no
    // track of this song, and the restore tells those apart by `isStatusForSong`.
    async runningStatus(song) {
        try {
            let data = await requestSpotify<SpotifyWireClientStatus>('client_status_found');
            // The media session answered instead of the app: it named no track id. Where its title and
            // artist are already this song's there is nothing to wait for. Otherwise a run that starts
            // both apps asks this before the app has opened its port, so the question is put once more a
            // few seconds later (the desktop side searches at most twice in a run, that far apart).
            // Where the second read fails, the first answer stands.
            if (data.fallback === true && !namesThatSong(song, data)) {
                data = await askAgainWhereItsPortIs(data);
            }
            const status = statusOfClient(data);
            // The media session names the track only by the title and the artist it shows. Where
            // those are this song's, the answer is this song's own, with the position it has: a
            // restore reads that once and shows it instead of asking the player again. It stays
            // degraded - the app cannot steer this channel.
            const songId = status.mediaId ? '' : songIdOf(song) ?? '';
            if (songId && !status.advertisement && namesThatSong(song, data)) {
                return { ...status, mediaId: songId };
            }
            return status;
        } catch (error) {
            console.warn('[SpotifyClient] the app could not say which track it is on', error);
            return null;
        }
    },
    async getStatus() {
        return statusOfClient(await requestSpotify<SpotifyWireClientStatus>('client_status'));
    },
    isStatusForSong(song, status) {
        return status.mediaId !== '' && status.mediaId === songIdOf(song);
    },
    // The setting that wakes the player with Folia: the app has to be running with its DevTools
    // port before a song can be steered into it.
    warmUp: () => launchSpotifyApp(),
};

/** Starts Spotify's app with its DevTools port (the setting that wakes it with Folia). */
export const launchSpotifyApp = async (): Promise<void> => {
    if (!canSteerSpotifyApp()) return;
    await requestSpotify('client_launch');
};

/** Test seam: forgets the song asked for and what was read about the app. */
export const resetSpotifyClientPlayback = (): void => {
    attempt = null;
    handoffId = null;
    probing = null;
    queueUnreadable = false;
};

/** Test seam: what is held of the song asked for. */
export const spotifyClientAttempt = (): Attempt | null => attempt;
