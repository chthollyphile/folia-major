import { PlayerState, type SongResult } from '../../../../types';
import type { OnlineProviderId, ProviderExternalPlaybackStatus } from '../../../../types/onlineMusic';
import { adoptExternalPlayback, getExternalSong, isExternalRoute, yieldExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { markProgrammaticPause, playbackFade } from '../../../../services/playbackFade';
import { currentTime } from '../../../../stores/motionSignals';
import { setDuration, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { findPlaybackDecks, unloadDeck } from '../../../hifi/useWebEngineYield';
import { askedSongKeyRef, makeSongCurrent, startOfAskedSong } from '../currentSong';
import { queueWithRunningTrack, resolveRunningTrack, resolveRunningTrackOf } from '../restore/runningTrack';

// src/components/app/playback/bridges/externalPlayerFollow.ts
// What a player outside the app holds, taken over as it stands: the song it is sounding, or the
// track it moved on to, becomes the song this app shows and the external route follows it from
// there. Nothing here starts, resumes or pauses the player - it is the playing player's own - and a
// track it names is looked up in its own platform's catalogue by the id it carries.
//
// Three callers read it: the session restore, which finds the player as the listener left it when
// Folia was reopened; the watcher of a way of playing whose listener keeps using the player's own
// window (`followsPlayerChanges`); and the route itself, whose poll sees a track it did not ask for
// and takes that one over instead of stopping it. A player taken over keeps its own queue and level
// until a song is started here, so none of the three writes either of them.

/** What taking a running player over came to. */
export type RunningPlayerOutcome =
    // The player is this app's now: the external route, its clock and the transport follow it.
    | 'adopted'
    // A paused track was put on screen at its own position without a session: the press of play starts it.
    | 'shown'
    // Nothing of the player was taken, and the caller is where it was.
    | 'untouched';

/** What a caller of a take-over adds to it: its guard, its hooks and what it owns beyond it. */
export type RunningPlayerTakeOverOptions = {
    /** Whether the answer still belongs to what the caller shows: a late one is dropped. */
    isWanted?: () => boolean;
    /** The player sounds a song: the caller's own intent to play is spent, nothing here starts it. */
    spendPlayIntent?: () => void;
    /**
     * The track is now the song this app shows: the caller writes what belongs to that song there.
     * `stillCurrent` answers for a read that lands after the listener moved on, so nothing of the
     * track lands on the next song.
     */
    onTrackTaken?: (track: SongResult, stillCurrent: () => boolean) => Promise<void> | void;
    /**
     * The caller writes the queue of the track it takes over, and saves it (a restore, whose caller
     * holds the list the player was found in). Left out, the track is put in this app's queue where
     * the song it replaced stood, which is what every other caller wants.
     */
    ownsQueue?: boolean;
    /**
     * A track the player is paused on is taken over as it stands, rather than only shown where it is:
     * the session is the track the screen shows, so the press of play continues it. Meant for the
     * way of playing whose listener keeps using the player's own window, whose pause there is the
     * listener's own choice of track. A caller that leaves it out (a restore) only shows the pause.
     */
    adoptsPausedTrack?: boolean;
};

/**
 * Shows a position on a song: never past its end, where a song shown at its end starts over as a
 * replay does, and never where what is on screen was overtaken while the take-over waited.
 */
const showTrackPosition = (song: SongResult, positionMs: number | null, overtaken: () => boolean): void => {
    if (positionMs === null || !Number.isFinite(positionMs) || positionMs <= 0) return;
    if (overtaken()) return;
    const seconds = positionMs / 1000;
    currentTime.set(song.durationMs > 0 ? Math.min(seconds, song.durationMs / 1000) : seconds);
};

/**
 * Whether the player said which track it is on: by the id it carries, or - on a channel that names
 * no track at all - by the title and artist it shows. An advertisement names nothing of the song.
 */
const namesItsTrack = (status: ProviderExternalPlaybackStatus): boolean => (
    status.advertisement !== true && (status.mediaId !== '' || status.shownTrack !== undefined)
);

/**
 * The player is this app's now: nothing of this window may sound beside it. A pause pressed a moment
 * before the take-over only ramped the gain down, and the deck itself is paused about 200ms later -
 * by a pending pause the transport drops once another song is on screen. That pending pause is not
 * what this can rely on: otherwise the deck would be stopped by a pause that may belong to another
 * song, or not stopped at all once the pause is dropped, so the fade is dropped and the decks are
 * paused and emptied here, which a null source on its own does not do. Each pause is marked as this
 * app's own: left unmarked, the deck's pause event would drop the transport to PAUSED over the song
 * the player is sounding.
 *
 * Only a take-over that still answers for the song it was asked for stops them, never one a listener
 * overtook: a song started in this window meanwhile is the one they just pressed play on, and it
 * keeps its deck.
 */
const stopLocalDecksForTakeOver = (): void => {
    playbackFade.cancel();
    findPlaybackDecks(null).forEach(deck => {
        markProgrammaticPause(deck);
        unloadDeck(deck);
    });
};

/**
 * The queue the app plays on from here: the track taken over is put where the song it replaced
 * stood, with that song right behind it, so the songs before and after it are still the ones they
 * were and the previous and next buttons go on working. A queue that already holds the track is
 * left as it is.
 */
const putTakenTrackInQueue = (track: SongResult, replaced: SongResult): void => {
    const queue = usePlaybackStore.getState().playQueue;
    const trackKey = getPlaybackSongKey(track);
    if (queue.some(song => getPlaybackSongKey(song) === trackKey)) return;
    usePlaybackStore.getState().setPlayQueue(queueWithRunningTrack(queue, track, replaced));
};

/** Whether `song` is the song this app shows now. */
const isShownSong = (song: SongResult): boolean => {
    const shown = usePlaybackStore.getState().currentSong;
    return shown !== null && getPlaybackSongKey(shown) === getPlaybackSongKey(song);
};

/**
 * Takes over what a player holds for `remembered`, the song this app shows: a player sounding that
 * very song is taken over as it stands, and one on another track, named by the id it carries, has
 * that track looked up, made the song this app shows and taken over in its place. A paused track is
 * only shown where it is - unless the caller asks for a pause to be taken over too
 * (`adoptsPausedTrack`) - and a track that cannot be looked up leaves everything as it was.
 */
export const takeOverRunningPlayer = async (
    remembered: SongResult,
    running: ProviderExternalPlaybackStatus,
    options: RunningPlayerTakeOverOptions = {},
): Promise<RunningPlayerOutcome> => {
    // The take-over answers for the song it was asked about. A song asked for in Folia while the
    // player was read or a track looked up owns the screen then, and nothing of this take-over lands
    // on it: the ask is checked beside the caller's own guard, every time it is asked.
    const wanted = () => isShownSong(remembered) && (options.isWanted?.() ?? true);
    if (omni.isExternalPlaybackStatusForSong(remembered, running)) {
        // A player that answers through its coarse channel is not taken over: the app cannot steer it.
        if (running.isPlaying && running.degraded !== true) {
            const adopted = await adoptExternalPlayback(remembered);
            // A song asked for while the player was taken over owns the screen: the route just taken
            // is given up rather than left following a song nobody shows. A play of that song may have
            // begun a session of its own meanwhile, and that one is left sounding.
            if (wanted()) {
                // Either way nothing of this window plays the song now: what sounds there is the
                // player's, and a take-over that failed left the route to this app. So the intent the
                // caller armed is dropped with it, as the window hand-off's restore drops its own.
                if (adopted) stopLocalDecksForTakeOver();
                options.spendPlayIntent?.();
                if (adopted) return 'adopted';
            } else {
                if (adopted) yieldExternalPlayback('another song was asked for while the player was taken over', adopted);
                return 'untouched';
            }
        }
        showTrackPosition(remembered, running.positionMs, () => !wanted());
        return 'shown';
    }
    if (running.degraded === true) {
        // The player answered on its coarse channel: that one names no track at all, only the names
        // it shows. The song behind those names is found by searching for them, and nothing else
        // stands for it; a player pulled back or stopped over a track the listener chose is exactly
        // what this way of playing must not do.
        return await takeOverCoarseTrack(remembered, running, options, wanted);
    }
    if (!namesItsTrack(running)) return 'untouched';
    const track = await resolveRunningTrack(remembered, running, wanted);
    // A late answer landing after another song was asked for leaves everything as it is.
    if (!track) return 'untouched';
    // Shown before the player is asked whether it holds the track, so the screen carries the track
    // while that read waits; the take-over itself asks again before and after that read, and a song
    // asked for meanwhile sends the player back to this app's own engine.

    if (options.ownsQueue !== true) putTakenTrackInQueue(track, remembered);
    makeSongCurrent(track);
    return await settleTrackTakeOver(track, remembered, running, options);
};

/** The name as both sides of a comparison write it: no full-width forms, no case, no stray spaces. */
const plainName = (text: string): string => text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();

/**
 * A title without the bracketed version notes after it - a credit, a remaster, a live take - since
 * the player's own window and the platform's catalogue need not write the same song alike. A title
 * that is nothing but such a note keeps it: then the note is the title.
 */
const plainTitle = (text: string): string => {
    const withoutNotes = plainName(text).replace(/\s*[([{][^)\]}]*[)\]}]/gu, '').trim();
    return withoutNotes || plainName(text);
};

/** The artist names one side writes, whole: an entry is never cut into a part of another one. */
const artistNames = (text: string): string[] => text
    .split(/[,/&;]|\bfeat\.?\b|\bft\.?\b|\bx\b/iu)
    .map(part => plainName(part))
    .filter(Boolean);

/**
 * The songs of this app that answer to the name the player shows: its title, and one of its artists
 * under the artist the player shows. Both have to answer, and names are compared whole - the song
 * "Song a" is not the song shown as "Song a b" - since this is the only identity that channel gives.
 */
const tracksNamedLike = (candidates: SongResult[], shown: { title: string; artist: string }): SongResult[] => {
    const title = plainTitle(shown.title);
    const shownArtists = artistNames(shown.artist);
    if (!title || shownArtists.length === 0) return [];
    return candidates.filter(song => {
        if (plainTitle(song.name) !== title) return false;
        const own = (Array.isArray(song.artists) ? song.artists : [])
            .map(artist => plainName(typeof artist === 'string' ? artist : artist.name))
            .filter(Boolean);
        return own.length > 0 && own.every(artist => shownArtists.includes(artist));
    });
};

/** How many of the search's songs are read for the one the coarse channel shows. */
const COARSE_SEARCH_ROWS = 30;
/**
 * The search a coarse read is answered by, kept apart from the listener's own search on screen: it
 * is asked and dropped, and never pages on.
 */
const COARSE_SEARCH_SESSION = 'external-player-shown-track';

/**
 * The song a player's coarse channel shows, looked up by the names it gives and by nothing else:
 * that channel carries no id. The search is the platform's own, through Omni like any other read,
 * and the answer has to carry a track id: a row found by these names is the song the listener is on,
 * one merely written alike is not. Null where nothing answers, where the search failed, and where the
 * caller no longer wants it.
 */
const searchShownTrack = async (
    providerId: OnlineProviderId,
    shown: { title: string; artist: string },
    isWanted: () => boolean,
): Promise<SongResult | null> => {
    let found: SongResult[];
    try {
        const page = await omni.searchProviderSongs(
            providerId,
            `${shown.title} ${shown.artist}`.trim(),
            { limit: COARSE_SEARCH_ROWS, offset: 0 },
            { session: COARSE_SEARCH_SESSION },
        );
        // Only a song the catalogue itself named can be played on: a row without its own reference
        // is a listing, not a track.
        found = page.items.filter(song => Boolean(song.sourceRef));
    } catch (error) {
        console.warn('[externalPlayerFollow] The track the player shows could not be searched for', error);
        return null;
    }
    if (!isWanted()) return null;
    return tracksNamedLike(found, shown)[0] ?? null;
};

/**
 * A player that answered on its coarse channel and is on another song: that song is searched for by
 * the title and artist the channel shows, and taken over in place of the remembered one when the
 * search answers with that very title and artist. A song that cannot be found (the search failed, or
 * it answered nothing that is named alike) is not taken over, and nothing is stopped or pulled back
 * over it either: the player is sounding a song the listener chose, and the most this app can do is
 * leave it sounding.
 */
const takeOverCoarseTrack = async (
    remembered: SongResult,
    running: ProviderExternalPlaybackStatus,
    options: RunningPlayerTakeOverOptions,
    wanted: () => boolean,
): Promise<RunningPlayerOutcome> => {
    const shown = running.shownTrack;
    if (!shown) return 'untouched';
    const providerId = getOnlineProviderIdForSong(remembered) ?? omni.followingPlayerChangesProviderId();
    if (!providerId) return 'untouched';
    const track = await searchShownTrack(providerId, shown, wanted);
    if (!track) {
        console.info(
            '[externalPlayerFollow] The player shows a track no search answers to; it is left sounding',
            { title: shown.title, artist: shown.artist },
        );
        return 'untouched';
    }

    if (options.ownsQueue !== true) putTakenTrackInQueue(track, remembered);
    makeSongCurrent(track);
    return await settleTrackTakeOver(track, remembered, running, options);
};

/**
 * The second half of a take-over of another track: the player either holds it now (the session is
 * the track's) or only shows it paused, in which case nothing is taken and the press of play starts
 * it. The remembered song comes back where the player no longer holds the track.
 */
const settleTrackTakeOver = async (
    track: SongResult,
    remembered: SongResult,
    running: ProviderExternalPlaybackStatus,
    options: RunningPlayerTakeOverOptions,
): Promise<RunningPlayerOutcome> => {
    // The take-over's own ask of the track, kept apart from an ask for that same song landing while
    // it waits: the key cannot tell two asks of one song apart, and a play of this song asks again.
    const trackKey = getPlaybackSongKey(track);
    const askedStart = startOfAskedSong();
    const stillCurrent = () => askedSongKeyRef.current === trackKey && startOfAskedSong() === askedStart;
    if (running.isPlaying) {
        // A song asked for while the track was shown owns the screen: the player is left as it is
        // rather than asked to hold a track nothing on screen belongs to.
        if (!stillCurrent()) return 'untouched';
        const adopted = await adoptExternalPlayback(track);
        if (!adopted) {
            // The player did not hold the track any more: the remembered song is the song this app
            // shows again, and nothing of the track was written anywhere. The player is left as it is.
            // A song asked for while the take-over waited keeps the screen.
            if (stillCurrent()) makeSongCurrent(remembered);
            return 'untouched';
        }
        // This window sounds nothing of the track from here: the player has it. Where the player took
        // the track under another song that is now on screen, it is this window's again and nothing of
        // the track is shown, so it is given up as a stop gives it up. The two asks answer alike, and
        // the stop below changes neither the key of the song it asked about nor when that song began.
        if (stillCurrent()) {
            stopLocalDecksForTakeOver();
        } else {
            yieldExternalPlayback('another song was asked for while the player took the track', adopted);
            return 'untouched';
        }
        // The player sounds the track, so the caller's own intent to play is spent - but only where
        // nothing asked for a song meanwhile: a play that did armed the intent that starts it.
        options.spendPlayIntent?.();
        await options.onTrackTaken?.(track, stillCurrent);
        return 'adopted';
    }
    // Paused there: where the caller follows the player's own window, the track is taken over as it
    // stands as well, so the session is the track the screen shows and the press of play continues
    // that one rather than the song the player left behind. Nothing is started for it, and the intent
    // to play the caller armed is dropped - unless a song was asked for while the take-over waited.
    // A caller that does not ask for this (a restore, whose pause there is only shown) keeps showing
    // the track where it is.
    if (options.adoptsPausedTrack === true && stillCurrent()) {
        const adopted = await adoptExternalPlayback(track);
        if (adopted) {
            if (stillCurrent()) {
                stopLocalDecksForTakeOver();
            } else {
                yieldExternalPlayback('another song was asked for while the paused track was taken over', adopted);
                return 'untouched';
            }
            options.spendPlayIntent?.();
            await options.onTrackTaken?.(track, stillCurrent);
            return 'adopted';
        }
    }
    // The player did not hold the track after all: it is shown where it is, and the press of play
    // starts it. A song asked for while the take-over waited keeps the screen and its own play.
    if (stillCurrent()) options.spendPlayIntent?.();
    // The progress bar reads this track's own length: the duration still held is the remembered
    // song's, which is another one. The player's own answer comes first.
    const durationMs = running.durationMs > 0 ? running.durationMs : track.durationMs;
    if (durationMs > 0) setDuration(durationMs / 1000);
    showTrackPosition(track, running.positionMs, () => !stillCurrent());
    await options.onTrackTaken?.(track, stillCurrent);
    return 'shown';
};

/**
 * Reads the player of the song on screen once and takes over whatever it is playing: that song, or
 * the track it moved on to. Nothing is read where no player of this kind is wanted (no song, a way
 * of playing that does not follow its listener) and where a session of this route already follows the
 * player, whose own polls are the read. A screen showing a song that never plays in this player - a
 * file of the listener's own, a song of another platform - is read too, as long as Folia is not
 * sounding it: what they start in the player's own window then is still the listener's own doing.
 * Reading a player starts, resumes and pauses nothing, so a player nobody uses is not woken by it.
 */
export const followRunningExternalPlayer = async (
    options: RunningPlayerTakeOverOptions = {},
): Promise<RunningPlayerOutcome> => {
    const shown = usePlaybackStore.getState().currentSong;
    if (!shown) return 'untouched';
    // The way of playing that follows its listener's own window, whoever is on screen: only one way
    // declares it, and it is not read at all where none does.
    const followProviderId = omni.followingPlayerChangesProviderId();
    if (!followProviderId) return 'untouched';
    // A song of that player is read as that song; a song of another kind (a file of the listener's
    // own, another platform's) is read off the player itself, which could never have held it.
    const shownPlaysThere = omni.canPlayExternally(shown) && getOnlineProviderIdForSong(shown) === followProviderId;
    // Folia sounding a song of its own and the listener's player sounding one too would be two
    // songs at once: nothing is followed while this app is the one making the sound.
    if (isFoliaSoundingSong()) return 'untouched';
    if (isExternalRoute() && getExternalSong() !== null) return 'untouched';
    let running: ProviderExternalPlaybackStatus | null;
    try {
        running = shownPlaysThere
            ? await omni.getExternalPlaybackRunningStatus(shown)
            : await omni.getExternalPlaybackRunningTrack(followProviderId);
    } catch (error) {
        console.warn('[externalPlayerFollow] The player could not say what it has', error);
        return 'untouched';
    }
    // A song asked for while the player was read owns the screen now: nothing of that read is acted on.
    if (!isShownSong(shown) || !(options.isWanted?.() ?? true)) return 'untouched';
    // Only what the player is actually playing is taken over: a pause there is the listener's own,
    // and the press of play in Folia is what starts it. The track looked up is the song this app
    // shows from here, whichever song the screen held while it was read.
    if (!running || !running.isPlaying || running.degraded === true || running.advertisement === true) return 'untouched';
    if (!shownPlaysThere) {
        const track = await resolveRunningTrackOf(followProviderId, running, () => isShownSong(shown) && (options.isWanted?.() ?? true));
        if (!track) return 'untouched';
        makeSongCurrent(track);
        return await settleTrackTakeOver(track, track, running, options);
    }
    return await takeOverRunningPlayer(shown, running, options);
};

/**
 * Whether a deck of this window is still sounding: paused after the fade-out, or finished, is silence.
 * `paused` is the element's own, and it is trustworthy only because `unloadDeck` follows its pause
 * with a `load()`: that empties the element and leaves it paused, so a deck a hand-off has let go of
 * reads paused here instead of as the sound it was making a moment before.
 */
const isDeckSounding = (): boolean => findPlaybackDecks(null).some(deck => !deck.paused && !deck.ended);

/**
 * Whether Folia itself is making sound now: its own engine playing a song. A deck still sounding is
 * sound even where the screen already reads paused - the transport shows PAUSED at the press, and
 * the fade-out pauses the element about 200ms later. A paused or idle screen with no deck sounding
 * is silent, whatever song it holds, and so is a screen whose song is only taken over.
 */
const isFoliaSoundingSong = (): boolean => (
    usePlaybackStore.getState().playerState === PlayerState.PLAYING || isDeckSounding()
);

/**
 * Whether the song on screen is watched for what the listener starts in a player of their own: a way
 * of playing that follows its listener's own window has to be the one that is set, and Folia must not
 * be the one making the sound. The screen's song may be of any kind: a file of the listener's own, a
 * song of another platform, or nothing this player could ever hold.
 */
export const followsPlayerChangesForShownSong = (): boolean => (
    usePlaybackStore.getState().currentSong !== null
    && !isFoliaSoundingSong()
    && omni.followingPlayerChangesProviderId() !== null
);
