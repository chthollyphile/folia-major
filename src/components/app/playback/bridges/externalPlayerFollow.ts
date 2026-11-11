import { PlayerState, type SongResult } from '../../../../types';
import type { ProviderExternalPlaybackStatus } from '../../../../types/onlineMusic';
import { adoptExternalPlayback, getExternalSong, isExternalRoute, yieldExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { currentTime } from '../../../../stores/motionSignals';
import { setDuration, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { askedSongKeyRef, makeSongCurrent, startOfAskedSong } from '../currentSong';
import { resolveRunningTrack, resolveRunningTrackOf } from '../restore/runningTrack';

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

/** Whether the player named the track it is on, rather than only its coarse channel or an advertisement. */
const namesItsTrack = (status: ProviderExternalPlaybackStatus): boolean => (
    status.mediaId !== '' && status.advertisement !== true && status.degraded !== true
);

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
            // is given up rather than left following a song nobody shows.
            if (wanted()) {
                // Either way nothing of this window plays the song now: what sounds there is the
                // player's, and a take-over that failed left the route to this app. So the intent the
                // caller armed is dropped with it, as the window hand-off's restore drops its own.
                options.spendPlayIntent?.();
                if (adopted) return 'adopted';
            } else {
                if (adopted) yieldExternalPlayback('another song was asked for while the player was taken over');
                return 'untouched';
            }
        }
        showTrackPosition(remembered, running.positionMs, () => !wanted());
        return 'shown';
    }
    if (!namesItsTrack(running)) return 'untouched';
    const track = await resolveRunningTrack(remembered, running, wanted);
    // A late answer landing after another song was asked for leaves everything as it is.
    if (!track) return 'untouched';
    // Shown before the player is asked whether it holds the track, so the screen carries the track
    // while that read waits; the take-over itself asks again before and after that read, and a song
    // asked for meanwhile sends the player back to this app's own engine.
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
        if (!await adoptExternalPlayback(track)) {
            // The player did not hold the track any more: the remembered song is the song this app
            // shows again, and nothing of the track was written anywhere. The player is left as it is.
            // A song asked for while the take-over waited keeps the screen.
            if (stillCurrent()) makeSongCurrent(remembered);
            return 'untouched';
        }
        // The player took the track under another song that is now on screen: it is this window's
        // again and nothing of the track is shown, so it is given up as a stop gives it up.
        if (!stillCurrent()) {
            yieldExternalPlayback('another song was asked for while the player took the track');
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
    if (options.adoptsPausedTrack === true && stillCurrent() && await adoptExternalPlayback(track)) {
        if (!stillCurrent()) {
            yieldExternalPlayback('another song was asked for while the paused track was taken over');
            return 'untouched';
        }
        options.spendPlayIntent?.();
        await options.onTrackTaken?.(track, stillCurrent);
        return 'adopted';
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
 * Whether Folia itself is making sound now: its own engine playing a song. A paused or idle screen
 * is silent, whatever song it holds, and so is a screen whose song is only taken over.
 */
const isFoliaSoundingSong = (): boolean => usePlaybackStore.getState().playerState === PlayerState.PLAYING;

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
