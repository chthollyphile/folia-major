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
 * How many songs that follow are put in the app's queue while it can empty it. The app moves on to
 * the first of them by itself without a gap, so the tail is what it has to be given the song after
 * that one.
 */
export const PREPARED_SONGS = 3;
/**
 * How many are put in when the app's queue cannot be emptied. Such a queue only ever grows and a
 * song written behind another cannot be taken back, so one song at a time is what leaves room to
 * put the order right, and one song is all a wrong order costs.
 */
export const PREPARED_SONGS_UNCLEARABLE = 1;
/**
 * What the app's own answer to a start says: it took the track, a newer start took over, it took
 * the track but an advertisement of a free account still runs before it, or it never got to it.
 */
type SpotifyClientPlayAnswer = 'loaded' | 'preempted' | 'not-loaded' | 'advertisement' | SpotifyClientTrackUnavailable;

// Spotify named this track as one it will not play: its own player's code and the reasons beside it
// (ONE_TRACK_UNPLAYABLE with NOT_AVAILABLE_IN_CURRENT_REGION and the like). Nothing was waited out,
// and this song is taken down rather than a start that merely went wrong. `premium-only` is the same
// answer with the free account as the only reason the page gives: that song is not gone, and a plan
// plays it.
interface SpotifyClientTrackUnavailable {
    answer: 'unavailable' | 'premium-only';
    code?: string;
    reasons?: string[];
}

const isTrackUnavailable = (answer: unknown): answer is SpotifyClientTrackUnavailable => {
    const said = typeof answer === 'object' && answer !== null ? (answer as { answer?: unknown }).answer : null;
    return said === 'unavailable' || said === 'premium-only';
};
/**
 * What the app answers a queue write: whether it emptied its queue first, the ids it took, the ids
 * its queue names afterwards, whether it can empty its queue at all, and whether a newer play took
 * the app while the write was in flight (nothing written then).
 */
type SpotifyClientQueueAnswer = {
    cleared?: boolean;
    /**
     * Whether the songs the queue held were given back after it was emptied: false where the app
     * refused them. Such a write took the songs the listener queued in the app and wrote none.
     */
    restored?: boolean;
    written?: string[];
    read?: string[] | null;
    canClear?: boolean | null;
    aborted?: boolean;
};
/** A track change this close to the end of the song Folia asked for is that song ending. */
const END_TOLERANCE_MS = 3000;

/** A song by the names the media session shows it with: it names no id, so the two sides compare names. */
interface ShownTrack {
    title: string;
    artist: string;
}

/** A song's names as a coarse read would show them. */
const shownTrackOf = (song: SongResult): ShownTrack => ({
    title: song.name, artist: artistNamesOf(song),
});

interface Attempt {
    id: string;
    /** The song's own name and artist, as the app's page does not say them when it falls back. */
    name: string;
    artist: string;
    hasPlayed: boolean;
    positionMs: number;
    durationMs: number;
    /**
     * The ids put in the app's queue after this song, in Folia's queue order: what a handoff to the
     * app's own next track is read by. Written once the app took them.
     */
    nextIds: string[];
    /**
     * The ids of `nextIds` the app named when it said what its queue holds. Kept apart from
     * `nextIds` on purpose: a read taken a moment after a write names fewer songs than were
     * written, and taking that read for Folia's record loses a song the app does hold.
     */
    confirmedIds: string[];
    /** The last answer came from the system media session: it names no track, so nothing is prepared. */
    degraded: boolean;
    /** The id Folia had the app play before this one: the track the app's own "previous" goes back to. */
    previousId: string;
    /** The app was moved to another track by its own controls and Folia already pulled it back once. */
    pulledBack: boolean;
    /**
     * The title and artist of the songs Folia put behind this one, or took back from there. The
     * media session names no track, so a coarse read is told apart by its names: one of these is the
     * app moving on to the queue Folia wrote, and any other song was picked with the app's controls.
     */
    behindTracks: ShownTrack[];
}

let attempt: Attempt | null = null;
/** The id the app already moved on to by itself; the next play of it starts nothing. */
let handoffId: string | null = null;
/** The question being asked, so two songs in a row ask it once. */
let probing: Promise<boolean> | null = null;
/**
 * The ids Folia put in the app's queue that the app has not been seen playing. The player only adds
 * and can never take one song back, so this record - never a read taken after a write - is what a
 * write goes by: a song written once is not written again while it is held.
 */
let writtenIds: string[] = [];

/**
 * The names of the songs written into the app's queue, by id: the record of ids is what a write goes
 * by, and this is what a coarse read of the app is told apart by, since the media session names no
 * track at all.
 */
const writtenTracks = new Map<string, ShownTrack>();
/**
 * Whether the app's queue can be emptied, as the first write of this run found it. Null until then:
 * a queue that may only grow is given one song, which is what leaves room to put the order right.
 */
let queueClearable: boolean | null = null;

/** Whether this build can reach the desktop side at all: the Windows desktop app only. */
const spotifyTransportReady = (): boolean => (
    typeof window !== 'undefined' && typeof window.electron?.spotifyRequest === 'function' && window.electron.platform === 'win32'
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
        .then(answer => answer.available === true, (error: unknown) => {
            console.warn('[SpotifyClient] whether Spotify\'s app is installed could not be read', error);
            return true;
        })
        .finally(() => { probing = null; });
    return probing;
};

const songIdOf = (song: SongResult): string | null => {
    try { return requireSpotifySong(song); } catch { return null; }
};

/** One artist entry's name: the provider keeps them as words or as objects with a name. */
const artistNameOf = (artist: unknown): string => {
    if (typeof artist === 'string') return artist;
    const name = (artist as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' ? name : '';
};

/** The song's artist names, one entry each, as the provider lists them. */
const artistNameListOf = (song: SongResult): string[] => {
    const artists = (song as { artists?: unknown }).artists;
    if (!Array.isArray(artists)) return [];
    return artists
        .map(artist => (typeof artist === 'string' ? artist : artistNameOf(artist)))
        .filter(Boolean);
};

/** The song's artist names, however the provider keeps them. */
const artistNamesOf = (song: SongResult): string => artistNameListOf(song).join(', ');

const ended = (current: Attempt): ProviderExternalPlaybackStatus => ({
    mediaId: current.id, isPlaying: false, ended: true,
    durationMs: current.durationMs, positionMs: current.durationMs || current.positionMs,
});

// NFKC folds the full-width letters and brackets a Chinese layout types into their plain forms.
const plainName = (text: unknown): string => (typeof text === 'string' ? text : '').normalize('NFKC').trim().toLocaleLowerCase();

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
    const title = (data.title ?? '').trim();
    if (!title || !current.name) return false;
    if (plainTitle(title) !== plainTitle(current.name)) return true;
    const artist = (data.artist ?? '').trim();
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
    const title = (data.title ?? '').trim();
    const shownArtist = (data.artist ?? '').trim();
    const name = song.name.trim();
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
    const id = data.id.trim();
    // The app's own player names the track and no title.
    const shown = id
        ? `the track ${id}`
        : `"${(data.title ?? '').trim()}" by "${(data.artist ?? '').trim()}"`;
    const held = `"${song.name.trim()}" by "${artistNamesOf(song)}"`;
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
 * The ids a handoff leaves: what is still behind the track the app moved on to. The song it moved to
 * was the first of what Folia put there; the rest is still queued and is not written again.
 */
const tailAfter = (list: string[], id: string): string[] => {
    const at = list.indexOf(id);
    return at < 0 ? [] : list.slice(at + 1);
};

/**
 * The songs that follow, written into the app's queue once. Answers the app's own answer, or null
 * where a play of a newer song took the app while the write was in flight: that write is not
 * recorded, so the next one asks again instead of leaving the app short of a song.
 *
 * What the app read back is used for the log and for whether its queue can be emptied; what Folia
 * has written and not seen played is what decides whether a song is written at all. Every song that
 * comes back written joins that record, and it is given up only where the app emptied its queue
 * first, because a player that cannot empty one keeps every song it was ever given.
 */
const writeClientQueue = async (ids: string[]): Promise<SpotifyClientQueueAnswer | null> => {
    const answer = await requestSpotify<SpotifyClientQueueAnswer>('client_queue', { ids, queued: writtenIds });
    if (answer.aborted === true) {
        console.info('[SpotifyClient] a play took the app while the songs that follow were being written; nothing was written');
        return null;
    }
    // The queue was emptied and the songs it held were refused: what the app queue held is gone with
    // it, and nothing of this write is there. Said here, since the page's own line stays in its
    // console and the run's log is Folia's.
    // A refusal of that kind is answered, not thrown: the caller keeps its prepared-queue key and
    // the write is not made again for this song. Writing again would empty the queue a second time,
    // and take whatever the listener put there meanwhile with it.
    if (answer.restored === false) {
        console.warn('[SpotifyClient] the songs the app queue held were lost: it refused to take them back');
    }
    const written = (Array.isArray(answer.written) ? answer.written : [])
        .filter((id): id is string => typeof id === 'string');
    const read = Array.isArray(answer.read) ? answer.read.filter((id): id is string => typeof id === 'string') : null;
    // An emptied queue holds only what this write put there. One that could not be emptied still
    // holds what was written before it, and whatever the app itself names: a tail a window before
    // this one wrote, or songs the listener queued in the app. None of those is written again.
    const kept: string[] = answer.cleared === true ? [] : [...writtenIds, ...(read ?? [])];
    for (const id of written) if (!kept.includes(id)) kept.push(id);
    writtenIds = kept;
    queueClearable = typeof answer.canClear === 'boolean' ? answer.canClear : null;
    // Said on every write, the ones that went as asked included (docs/client-logging.md).
    const lede = answer.cleared === true ? 'its queue was emptied first' : 'it kept its queue';
    const saw = read === null
        ? 'it does not say what it holds'
        : `${read.length} read back, ${read.length === written.length && written.every(id => read.includes(id)) ? 'the same songs' : 'not the same songs'}`;
    const why = queueClearable === true ? '' : '; it cannot empty its queue, so one song is kept at a time';
    console.info(`[SpotifyClient] the songs that follow: ${lede}, ${written.length} of ${ids.length} written, ${saw}${why}`);
    return answer;
};

/**
 * What a write left behind the song playing: the ids the app holds, in Folia's order. A queue that
 * could not be emptied may hold fewer of them, and those it does hold are what a handoff to its own
 * next track is read by. What the app named is kept apart in `confirmedIds`, for the log alone.
 */
const recordTail = (current: Attempt, ids: string[], answer: SpotifyClientQueueAnswer): void => {
    current.nextIds = ids.filter(id => writtenIds.includes(id));
    // Every name, whether the app took it or is still holding it: a queue that cannot be emptied keeps
    // the songs taken back from it, and the app going on to one of them is read by its name.
    current.behindTracks = ids.map(id => writtenTracks.get(id)).filter((track): track is ShownTrack => Boolean(track));
    current.confirmedIds = (Array.isArray(answer.read) ? answer.read.filter((id): id is string => typeof id === 'string') : [])
        .filter(id => ids.includes(id));
};

/**
 * Whether the title and artist a coarse read shows are one of the songs Folia put behind the song
 * playing, or took back from there. Names are compared as the session writes them - it reports only
 * the leading artist of a track - so a title and one whole artist name are what is needed.
 */
const namesBehindTrack = (current: Attempt, data: SpotifyWireClientStatus): boolean => {
    const title = (data.title ?? '').trim();
    const shownArtist = (data.artist ?? '').trim();
    if (!title || !shownArtist) return false;
    const shown = shownArtistNames(shownArtist);
    return current.behindTracks.some(track => {
        if (plainTitle(track.title) !== plainTitle(title)) return false;
        return track.artist.split(', ').map(artist => plainName(artist)).filter(Boolean)
            .some(artist => shown.includes(artist));
    });
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
        // title and artist it shows. A song of the names Folia wrote behind this one - or took back
        // from there, since a queue that cannot be emptied keeps them - is the app moving on by
        // itself: the external session ends and Folia's own queue takes the next song. Any other
        // song was picked with the app's controls, and is pulled back as one is on the app's own
        // answer, so repeat one replays this song instead of the app's pick.
        if (current.hasPlayed && namesAnotherTrack(current, data)) {
            if (namesBehindTrack(current, data)) {
                console.info('[SpotifyClient] Spotify moved on to the track Folia wrote next; the external session ends');
                return ended(current);
            }
            // The app's own answer says which way it went by the id it names; a coarse read has no id
            // to compare with the song before this one, so the step is on, as an unknown track always
            // is. Pulled back once only, and a second read of the same other song is left alone.
            if (current.pulledBack) return status;
            current.pulledBack = true;
            console.info('[SpotifyClient] Spotify was moved to another track by its own controls; Folia\'s queue goes next');
            return { ...ended(current), skipped: 'next' };
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
        // The app moved on to the song Folia put next: the asked-for song is over. That song is now
        // the app's own track, not something still waiting behind this one.
        handoffId = id;
        writtenIds = writtenIds.filter(queued => queued !== id);
        // The app plays this one now: its name is held only while it is one of the songs behind the
        // song Folia asked for.
        writtenTracks.delete(id);
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
    // The app sounds the song in a program of its own, so a real spectrum has to come from the
    // machine's own sound; a start is asked for and the interface moves on instead of waiting for
    // the app's answer; its status is read at a slower cadence while it sounds Folia's song; the
    // keys stay Folia's for a song started here. A move of the song runs the bar and the lyrics on
    // for eight seconds: that is the default the main process gives every call it makes (CALL_LIMIT_MS
    // in electron/spotify/officialClient.cjs), while the hop that falls back to the system media
    // session has a limit of its own, so no call is promised to answer within it - a call that runs
    // past it leaves the bar standing at the limit it extrapolated to until an answer comes.
    capturesSystemAudio: true,
    startsWithoutWaiting: true,
    backsOffStatusPolls: true,
    holdsMediaKeysWhilePlaying: true,
    seekLimitMs: 8000,
    canPlay: song => songIdOf(song) !== null,
    isUnreachableFailure: unreachableClientFailure,
    isPrepared(song) {
        const id = songIdOf(song);
        return id !== null && (handoffId === id || Boolean(attempt?.hasPlayed && attempt.nextIds[0] === id));
    },
    async prepareNext(song, upcoming, options) {
        const current = attempt;
        if (!current || current.id !== songIdOf(song)) return;
        // The media session names no track: what the app would move on to cannot be checked, so
        // nothing is prepared while the app is steered coarsely.
        if (current.degraded) return;
        // A queue that cannot be emptied takes one song, so a wrong order costs one song; the one
        // that can be emptied takes the whole tail. Until the first write of the run has found out
        // which it is, one song is what goes: that write is the one that asks, and it cannot take
        // anything back. The page takes no more than its MAX_QUEUED, and a test holds that ceiling
        // to this window.
        const most = queueClearable === true ? PREPARED_SONGS : PREPARED_SONGS_UNCLEARABLE;
        const ids: string[] = [];
        for (const next of upcoming) {
            const id = songIdOf(next);
            if (!id || ids.length >= most) break;
            ids.push(id);
            // The names are kept for as long as the run: a coarse read names no track, and these are
            // what a song coming up in the app is told apart by (see `behindTracks`).
            writtenTracks.set(id, shownTrackOf(next));
        }
        // More than one song to follow: the successors are written behind this one, and the app moves
        // on to the first of them by itself. A song that goes on to nothing - the end of the queue,
        // or repeat one - writes nothing, and the app's queue is left as it is: emptying it for a
        // list that has nothing to say would take back what the listener put there.
        // Repeat one is the one case that does write: the app would otherwise go on to whatever it
        // still holds behind this song, so the songs Folia wrote there are taken back - only those,
        // since the songs the listener queued in the app are given back by the write itself, and only
        // where the app can empty its queue. A queue that cannot be emptied keeps them, and the replay
        // of this song is what covers that case.
        if (ids.length === 0) {
            // A play of a newer song owns the app now: this one leaves the queue to it.
            if (options?.retract !== true || writtenIds.length === 0 || attempt !== current) return;
            const takenBack = await writeClientQueue([]);
            if (!takenBack || attempt !== current) return;
            // A queue that could not be emptied still holds them, and the record keeps naming them:
            // the app going on to one of them is then read as the end of this song, the handoff it
            // would have been before repeat one was asked for, and not as the listener pressing next.
            recordTail(current, [...new Set(writtenIds)], takenBack);
            return;
        }
        // Already what the app was given behind this song, in this order: there is nothing to write.
        if (ids.join() === current.nextIds.join()) return;
        const answer = await writeClientQueue(ids);
        // A play of a newer song owns the app's queue now, and a write that was dropped says nothing
        // about what the app holds.
        if (!answer || attempt !== current) return;
        recordTail(current, ids, answer);
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
        const carried = adopt ? tailAfter(attempt?.nextIds ?? [], id) : [];
        const carriedConfirmed = adopt ? tailAfter(attempt?.confirmedIds ?? [], id) : [];
        handoffId = null;
        attempt = {
            id, name: song.name, artist: artistNamesOf(song),
            hasPlayed: adopt, positionMs: startMs, durationMs: song.durationMs,
            nextIds: carried, confirmedIds: carriedConfirmed, degraded: false,
            behindTracks: carried.map(held => writtenTracks.get(held)).filter((track): track is ShownTrack => Boolean(track)),
            previousId, pulledBack: false,
        };
        if (adopt) {
            console.info('[SpotifyClient] The app already plays the next song; it is adopted');
            return;
        }
        // An advance Folia made by itself is not a press: the desktop side is told so, and does not
        // start or restart Spotify for it: that one stops there when the app cannot be reached.
        const userAction = options.userAction !== false;
        // The songs this run wrote into the app's queue that it has not played: a start empties that
        // queue, and only these places are Folia's. What the listener queued there is given back
        // where it was, so a song they put in Spotify's window is not taken by Folia's start - except
        // where this play replaces the whole queue with a list of Folia's, which is the listener
        // asking for that list and nothing else, and then the app's queue is emptied whole.
        const answer = await requestSpotify<SpotifyClientPlayAnswer>('client_play', {
            id, startMs, userAction, written: writtenIds, replaceQueue: options.replaceQueue === true,
        });
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
        // Spotify said it will not play this track at all: the song is taken down, which Folia shows
        // with the words it already has for one, and the queue moves on instead of stopping. A track
        // its own player refuses for the free account alone is not taken down: that one is shown as
        // needing a plan, and the queue moves on the same way.
        if (isTrackUnavailable(answer)) {
            console.warn('[SpotifyClient] Spotify will not play this song', {
                answer: answer.answer, code: answer.code, reasons: (answer.reasons ?? []).join(', '),
            });
            const planOnly = answer.answer === 'premium-only';
            throw new OnlineProviderError(
                'not-playable', 'Spotify will not play this song', 'spotify',
                planOnly ? 'premium-only' : 'track-unavailable',
            );
        }
        // The app took the call and never got to the track: that is a failure of this song.
        // One track Spotify will not load says nothing about the next one.
        if (answer !== 'loaded') {
            throw new OnlineProviderError('not-playable', 'The Spotify app did not load the song', 'spotify');
        }
        // A start empties the app's queue where it can, so what Folia wrote before is not behind this
        // song any more. Where it cannot empty one, those songs are still there and stay written.
        if (queueClearable === true) {
            writtenIds = [];
            // The names are held only for the songs a coarse read can name: an emptied queue holds
            // none of them, and a name kept for nothing would read the listener's own pick as a song
            // Folia wrote.
            writtenTracks.clear();
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
        const carried = tailAfter(attempt?.nextIds ?? [], id);
        const carriedConfirmed = tailAfter(attempt?.confirmedIds ?? [], id);
        handoffId = null;
        attempt = {
            id, name: song.name, artist: artistNamesOf(song),
            hasPlayed: true, positionMs: 0, durationMs: song.durationMs,
            nextIds: carried, confirmedIds: carriedConfirmed, degraded: false,
            behindTracks: carried.map(held => writtenTracks.get(held)).filter((track): track is ShownTrack => Boolean(track)),
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
            current.confirmedIds = [];
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
                // The restart began a new player: its queue is empty, so none of the songs written
                // before is in it and every one of them is written again.
                writtenIds = [];
                const answer = await writeClientQueue(prepared);
                if (answer && attempt === current) recordTail(current, prepared, answer);
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
        const shownId = data.id.trim();
        if (!(shownId ? shownId === songIdOf(song) : namesThatSong(song, data))) {
            logAnotherTrack(song, data);
            return null;
        }
        return Math.max(0, Math.round(data.positionMs || 0));
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
    writtenIds = [];
    writtenTracks.clear();
    queueClearable = null;
};

/** Test seam: what is held of the song asked for. */
export const spotifyClientAttempt = (): Attempt | null => attempt;

/** Test seam: the ids whose names are held for the app's own coarse reads. */
export const spotifyClientWrittenTrackIds = (): string[] => [...writtenTracks.keys()];
