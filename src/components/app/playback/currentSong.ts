import type { SongResult } from '../../../types';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { setCurrentSong, usePlaybackStore } from '../../../stores/usePlaybackStore';

// src/components/app/playback/currentSong.ts
//
// The only place where "which song is current" changes.
//
// It is recorded twice, and the two do not always move at the same moment:
//   - the store's `currentSong` is the song the app shows;
//   - the key below is the song the player was last ASKED for. It moves at once, before a load
//     starts waiting, and work that finishes later compares its own key with it and drops out when
//     another song was asked for in the meantime. The automix decks read it for the same reason
//     (see `currentSongKeyRef` in useAutomixDecks).
//
// To make a song current from a new place in the app: `makeSongCurrent(song)`. One call.
//
// A load that has to wait between the two takes them as two steps: `askForSong` before the wait,
// `showSong` after it. test/unit/playback/currentSongArchitecture.test.ts lists the files that may.
//
// A play that asked for its song and then gives up before showing it calls `withdrawAsk`: the key
// goes back to the song that is shown, so it never stays on a song nobody sees.
//
// Work that finishes late on the song that is shown (a restore that rebuilt it, a library refresh
// that found its file gone) uses `replaceShownSong`, which never takes the key from a newer ask.
//
// A change to the SAME song (its lyrics state, replay gain, metadata) is not a change of which song
// is current. It stays a plain `setCurrentSong(previous => ...)` on the store, and has no way to
// reach the key.
//
// A play that is still reading its file or fetching its address has not asked for its song yet, so
// the key cannot tell it that it is no longer wanted. Every play (playSong, a local file, a
// Navidrome song) therefore takes `startPlay()` when it starts and asks the answer after each wait:
// no, once a newer play has started, or once a route that empties the player or leaves the main
// player for the stage has called `dropPlaysInFlight`. A play that is answered no writes nothing more.
// A play of an online song names its platform (`startPlay(providerId)`): signing out of that platform
// (`dropPlaysOfProvider`) answers no to its plays alone, and leaves every other play as it was. Those
// other plays still carry the queue they were given, which may hold the signed-out platform's songs:
// they mark `providerDropsSoFar()` when they start and land in `keepSongsOfProvidersStanding(queue, mark)`.
//
// What a play leaves running after it showed its song asks a second answer, `onceShown`: no while a
// newer play is on its way, and yes again once every newer play gave up without showing its song.
// The HiFi route keeps it on the track and asks it when mpv moves on, fails or is switched off. A
// play that gives up before it shows its song (its file cannot be read, its record is gone, the
// platform refused it, it was answered no) therefore calls `abandon()` on what it took, and so does
// one that hands over to another play (playSong to a local or Navidrome song, which takes its own).
// The plain answer does not change with it: a play that was still on its way when a newer one
// started stays overtaken, whatever that newer play does after.
//
// A restore of a remembered song (the last session, the hand-off to a rebuilt window) is not a
// play: it ends no play, and it makes its song current before its first wait. The key cannot tell
// it from a play of that same song, so it takes `startRestore()` at that moment and asks the answer
// after each wait: no, once a song was asked for again, or once the plays in flight were dropped.

/** The key, for reading only. `usePlaybackRuntimeRefs` hands this out as `currentSongRef`. */
export type AskedSongKeyRef = { readonly current: string | null };

let askedSongKey: string | null = null;

export const askedSongKeyRef: AskedSongKeyRef = {
    get current() {
        return askedSongKey;
    },
};

let playsStarted = 0;
let playsDropped = 0;
/**
 * The plays started since the last drop that have not been abandoned, oldest first (for
 * `onceShown`). Only the newest PLAYS_KEPT are kept: a play older than those is answered no for good
 * (`playsForgotten`), which it already is while any of them stands.
 */
let playsStanding: number[] = [];
const PLAYS_KEPT = 64;
let playsForgotten = 0;
/** How often a song was asked for. The key cannot tell two asks for the same song apart; this can. */
let asks = 0;

/** Every play that has started and has not shown its song yet gives up at its next check. */
export const dropPlaysInFlight = (): void => {
    playsDropped += 1;
    // Every play started so far is answered no by the count above, whatever is abandoned later.
    playsStanding = [];
};

/** How often the plays of each online platform were dropped (its sign-out): see `dropPlaysOfProvider`. */
const providerDrops = new Map<string, number>();
/** The platforms whose plays were dropped, in order (one per sign-out, so it stays short). */
const providerDropLog: string[] = [];

/**
 * The plays of this platform that have started and not shown their song give up at their next check,
 * and what one that showed its song leaves running (`onceShown`) is answered no. Plays of other
 * platforms, local files and Navidrome go on.
 */
export const dropPlaysOfProvider = (providerId: string): void => {
    providerDrops.set(providerId, (providerDrops.get(providerId) ?? 0) + 1);
    providerDropLog.push(providerId);
};

/** A mark for `keepSongsOfProvidersStanding`: how many platform drops there were so far. */
export const providerDropsSoFar = (): number => providerDropLog.length;

/** The queue without the songs of the platforms whose plays were dropped after `mark` (the same array when none was). */
export const keepSongsOfProvidersStanding = <T extends SongResult>(queue: T[], mark: number): T[] => {
    if (providerDropLog.length === mark) return queue;
    const gone = new Set(providerDropLog.slice(mark));
    return queue.filter(song => {
        const providerId = getOnlineProviderIdForSong(song);
        return !providerId || !gone.has(providerId);
    });
};

/** How often the plays of this platform were dropped, for a play that has not started yet (see `playsDroppedSoFar`). */
export const providerPlaysDroppedSoFar = (providerId: string | null | undefined): number => (
    providerId ? providerDrops.get(providerId) ?? 0 : 0
);

/** What `startPlay` hands a play: call it for the answer, the rest as below. */
export type PlayStart = {
    /** Is this play still wanted: yes until a newer play starts or the plays in flight are dropped. */
    (): boolean;
    /**
     * For what the play leaves running once it showed its song (the HiFi track): yes until a newer
     * play starts or the plays in flight are dropped, and yes again once every newer play abandoned.
     */
    onceShown: () => boolean;
    /**
     * The play gives up without showing its song, or hands over to another play: it stops counting
     * as a newer play for the plays before it (their `onceShown`). Its own answers stay as they were.
     * Calling it again does nothing.
     */
    abandon: () => void;
};

/**
 * A play calls this when it starts and keeps what it gets: the answer to "is this play still
 * wanted", and the two parts above. A play of an online song passes its platform.
 */
export const startPlay = (providerId?: string | null): PlayStart => {
    playsStarted += 1;
    const started = playsStarted;
    const dropped = playsDropped;
    const providerDropped = providerPlaysDroppedSoFar(providerId);
    const providerStands = () => providerPlaysDroppedSoFar(providerId) === providerDropped;
    playsStanding.push(started);
    if (playsStanding.length > PLAYS_KEPT) playsForgotten = playsStanding.shift() ?? playsForgotten;
    const stillWanted = () => playsStarted === started && playsDropped === dropped && providerStands();
    return Object.assign(stillWanted, {
        onceShown: () => playsDropped === dropped
            && providerStands()
            && started > playsForgotten
            && (playsStanding.length === 0 || playsStanding[playsStanding.length - 1] <= started),
        abandon: () => {
            playsStanding = playsStanding.filter(play => play !== started);
        },
    });
};

/**
 * How often the plays in flight were dropped. For a play that has not started yet (playSong while
 * a mod's before-play hook decides about it): it keeps the count and compares it after that wait.
 * And for the work a play leaves running after it showed its song (a local file's match): the key
 * tells that work of another song, not of a drop that left the key where it was.
 */
export const playsDroppedSoFar = (): number => playsDropped;

/**
 * Which start of a song the song asked for is, for telling one start from the next
 * (previewNotice.ts tells of a preview clip once per start). One more for every ask that starts a
 * song: a play, a restore, the same song played again. An ask that puts back the song asked for
 * just before (`putBack`: a blend cancelled onto the outgoing song, a play that gave up) gives that
 * song its own start back: it never stopped. A new address for the song asked for (the recovery)
 * asks nothing.
 */
let starts = 0;
let askedStart = 0;
let askedBefore: { key: string | null; start: number } = { key: null, start: 0 };

export const startOfAskedSong = (): number => askedStart;

/** Step one: the player is asked for this song (or for none). Writes the key, not the store. */
export const askForSong = (song: SongResult | null, { putBack = false }: { putBack?: boolean } = {}): void => {
    const key = song ? getPlaybackSongKey(song) : null;
    const replaced = { key: askedSongKey, start: askedStart };
    askedStart = putBack && askedBefore.key === key ? askedBefore.start : (starts += 1);
    askedBefore = replaced;
    askedSongKey = key;
    asks += 1;
};

/**
 * A restore of a remembered song calls this right after it made that song current, and keeps what
 * it gets: the answer to "is this restore still wanted". It is yes until a song is asked for again
 * (another song or this same one, by a play, the stage or a route that empties the player), or
 * until the plays in flight are dropped.
 */
export const startRestore = (): (() => boolean) => {
    const asked = asks;
    const dropped = playsDropped;
    return () => asks === asked && playsDropped === dropped;
};

/**
 * Step two: the store shows this song. Writes the store, not the key.
 *
 * The key stays on the song asked for last. So a load that was overtaken while it waited shows its
 * song for a moment and then stops at its next comparison with the key, instead of taking the key
 * back from the load that overtook it.
 */
export const showSong = (song: SongResult | null): void => {
    setCurrentSong(song);
};

/**
 * A play that asked for `song` gives up before showing it. The key goes back to the song the store
 * shows, unless another song was asked for since: that ask stands.
 */
export const withdrawAsk = (song: SongResult): void => {
    if (askedSongKey === getPlaybackSongKey(song)) {
        askForSong(usePlaybackStore.getState().currentSong, { putBack: true });
    }
};

/** Both steps at once: this song (or none) is the one asked for and the one shown. */
export const makeSongCurrent = (song: SongResult | null): void => {
    askForSong(song);
    showSong(song);
};

/**
 * The store shows `next` (or nothing) in the place of `shown`. The key follows only while it still
 * names `shown`: if another song was asked for in the meantime, that ask stands.
 */
export const replaceShownSong = (shown: SongResult, next: SongResult | null): void => {
    if (askedSongKey === getPlaybackSongKey(shown)) {
        // The same ask goes on under the song's new key: this is not a new ask.
        askedSongKey = next ? getPlaybackSongKey(next) : null;
    }
    showSong(next);
};
