import i18n from '../../../../i18n/config';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../../../../services/coverCache';
import { getLocalSongs } from '../../../../services/db';
import { applyLocalLibraryEntityDisplay, buildUnifiedLocalSong } from '../../../../services/playbackAdapters';
import { getLocalLibraryCatalogSnapshot } from '../../../../services/localLibraryEntityRepository';
import { getNavidromeConfig } from '../../../../services/navidromeService';
import { applyOnlineAudioSourceMetadata, loadOnlineSongLyrics } from '../../../../services/onlinePlayback';
import { notifyPlaybackFailed } from '../../../../services/hostExtensionHooks';
import { wholeQueueWritesSoFar } from '../../../../services/wholeQueueWrites';
import type { ThemeCacheSongKey } from '../../../../services/themeCache';
import type { LyricData, LocalSong, SongResult, StatusMessage } from '../../../../types';
import type { NavidromeSong } from '../../../../types/navidrome';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../../../../utils/appNavidromeLyrics';
import { hasRenderableLyrics } from '../../../../utils/appPlaybackHelpers';
import {
    getOnlineProviderIdForSong,
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
    replacePlaybackSongWhereQueued,
} from '../../../../utils/appPlaybackGuards';
import { getLocalCoverAssetUrl } from '../../../../services/localCoverAssetUrl';
import { isPureMusicLyricText } from '../../../../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../../../../utils/lyrics/renderHints';
import { resolveLocalSongLyrics } from '../../../../utils/lyrics/localSongLyrics';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../../../utils/onlineLyricsState';
import type { AudioQualityPreference, MediaId, ProviderExternalPlaybackStatus } from '../../../../types/onlineMusic';
import { omni } from '../../../../services/onlineMusic/omni';
import { onlineFailureOf, type OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { getCachedSongCoverUrl, getSongCacheWithLegacyMigration } from '../../../../services/onlineMusic/resourceCache';
import { getSongCoverUrl } from '../../../../services/onlineMusic/songMetadata';
import { currentTime } from '../../../../stores/motionSignals';
import { useOnlineProviderAccountStore } from '../../../../stores/useOnlineProviderAccountStore';
import { setStatusMessage as setStatusMsg, useStatusMessageStore } from '../../../../stores/useStatusMessageStore';
import { setActiveLocalLyricsSource, setAudioSrc, setCachedCoverUrl, setCurrentSong, setDuration, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { askedSongKeyRef, keepSongsOfProvidersStanding, providerDropsSoFar, replaceShownSong } from '../currentSong';
import { onlineFailureToast } from '../source/onlineFailureToast';
import { loadLocalSongAudio, loadLocalSongHifiSource, loadNavidromeSongAudio, loadOnlineSongAudio } from '../source/songAudioSource';
import { queueWithRunningTrack } from './runningTrack';
import { takeOverRunningPlayer } from '../bridges/externalPlayerFollow';
import { useLyricSettingsStore } from '../../../../stores/useLyricSettingsStore';
import { useHifiSettingsStore } from '../../../../stores/useHifiSettingsStore';
import { beginHifiTrack, hifiRouteFor, releaseUnclaimedHifiTrack, whenHifiRuntimeKnown } from '../../../../services/hifi/hifiPlayback';
import type { PlaybackRoute } from '../../../../types/hifi';

// src/components/app/playback/restore/restorePlaybackSource.ts
// Rehydrates playable audio and lyrics for a remembered song without reusing stale blob URLs.
//
// The restore is for the song that is asked for when it starts: its caller makes it current first
// and takes `startRestore()` at that moment. It waits several times, some of them on a network.
// After each wait it asks that answer and looks at the key again: when a song was asked for in the
// meantime (another one, or this same one by a play) or the plays in flight were dropped, it stops
// and answers 'stale', so that nothing of the remembered song (its address, lyrics, cover, the
// last-playback record, a message) lands on what plays now, and no blob URL in use is revoked.

type SetState<T> = Dispatch<SetStateAction<T>>;

/**
 * Shows a position on the remembered song: never past its end, where a song shown at its end starts
 * over as a replay does, and never where the restore was overtaken while it waited, so a song asked
 * for meanwhile keeps its own place.
 */
const showExternalPosition = (song: SongResult, positionMs: number | null, overtaken: () => boolean): void => {
    if (positionMs === null || !Number.isFinite(positionMs) || positionMs <= 0) return;
    if (overtaken()) return;
    const seconds = positionMs / 1000;
    currentTime.set(song.durationMs > 0 ? Math.min(seconds, song.durationMs / 1000) : seconds);
};

/**
 * Asks the provider's own player where it is on the remembered song and shows it. An answer that
 * fails or names another track leaves the song where it was.
 */
const showRunningExternalPosition = async (song: SongResult, overtaken: () => boolean): Promise<void> => {
    let positionMs: number | null;
    try {
        positionMs = await omni.getExternalPlaybackRunningPositionMs(song);
    } catch (error) {
        console.warn('[restorePlaybackSourceForSong] The player could not say where the song is; it stays at its beginning', error);
        return;
    }
    showExternalPosition(song, positionMs, overtaken);
};

/** The intent to play the caller armed, dropped where nothing of this window plays the song. */
const dropPlayIntent = (shouldAutoPlayRef?: RefObject<boolean>): void => {
    if (shouldAutoPlayRef) shouldAutoPlayRef.current = false;
};

/** A song change's theme restore, with the guard a read that lands late needs. */
type RestoreSongTheme = (songId: ThemeCacheSongKey | SongResult, options?: {
    allowLastUsedFallback?: boolean;
    preserveCurrentOnMiss?: boolean;
    isCurrent?: () => boolean;
}) => Promise<unknown>;

/** What a restore offers a track the player moved on to while it shows it. */
type RunningTrackRestoreOptions = {
    shouldAutoPlayRef?: RefObject<boolean>;
    userId?: MediaId;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setPlayQueue?: SetState<SongResult[]>;
    /** The queue that track goes in front of the remembered song in. */
    queueBase: () => SongResult[];
    persistLastPlaybackCache?: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    restoreCachedThemeForSong?: RestoreSongTheme;
};

/**
 * The track taken over is shown with its own details, loaded as a song change loads them: its cover
 * and its lyrics. A load that lands after the listener moved on writes nothing.
 */
const loadRunningTrackDetails = async (
    track: SongResult,
    { userId, setLyrics }: Pick<RunningTrackRestoreOptions, 'userId' | 'setLyrics'>,
    stillCurrent: () => boolean,
): Promise<void> => {
    try {
        const coverUrl = await getCachedSongCoverUrl(track);
        if (!stillCurrent()) return;
        setCachedCoverUrl(coverUrl ?? getSongCoverUrl(track) ?? null);
        await loadOnlineSongLyrics(track, null, userId, {
            isCurrent: stillCurrent,
            onLyrics: nextLyrics => {
                if (stillCurrent()) setLyrics(nextLyrics);
            },
            onPureMusicChange: isPureMusic => setCurrentSong(previous => (
                !previous || !isSamePlaybackSong(previous, track) ? previous : { ...previous, isPureMusic }
            )),
            onStateChange: state => setCurrentSong(previous => (
                !previous || !isSamePlaybackSong(previous, track) ? previous : { ...previous, onlineLyricsState: state ?? undefined }
            )),
            onDone: () => undefined,
        });
    } catch (error) {
        console.warn('[restorePlaybackSourceForSong] The track taken over could not be shown with its own cover and lyrics', error);
    }
};

/**
 * The remembered song's own player outlived the app: read once what it has now. A player sounding
 * this song is taken over as it stands - the external route, its clock, the media keys and the songs
 * that follow it are the ones this app follows anyway - and the intent to play the restore armed is
 * dropped, because what sounds there is the player's and nothing here starts it. A player on another
 * track, named by the id it carries, has that track taken over as well, so the app follows what
 * sounds instead of showing a song nobody plays. Anything else (a pause, an advertisement, an answer
 * that names no track at all) only shows where it is.
 * Nothing here steers the player: it starts, resumes and pauses nothing, and it leaves the rest of its
 * state as it is. Once a track is taken over, the volume and the songs that follow it are Folia's
 * (docs/spotify-official-client.md).
 */
const resumeRunningExternalPlayback = async (
    song: SongResult,
    overtaken: () => boolean,
    options: RunningTrackRestoreOptions,
): Promise<void> => {
    let running: ProviderExternalPlaybackStatus | null = null;
    try {
        running = await omni.getExternalPlaybackRunningStatus(song);
    } catch (error) {
        console.warn('[restorePlaybackSourceForSong] The player could not say what it has; the song stays paused at its beginning', error);
    }
    if (overtaken()) return;
    if (running === null) {
        await showRunningExternalPosition(song, overtaken);
        return;
    }
    const outcome = await takeOverRunningPlayer(song, running, {
        isWanted: () => !overtaken(),
        spendPlayIntent: () => dropPlayIntent(options.shouldAutoPlayRef),
        onTrackTaken: async (track, stillCurrent) => {
            if (!stillCurrent()) return;
            const queue = queueWithRunningTrack(options.queueBase(), track, song);
            options.setPlayQueue?.(queue);
            void options.persistLastPlaybackCache?.(track, queue);
            void options.restoreCachedThemeForSong?.(track, {
                allowLastUsedFallback: true, preserveCurrentOnMiss: false, isCurrent: stillCurrent,
            }).catch((error: unknown) => {
                console.warn('[restorePlaybackSourceForSong] The theme of the track taken over could not be restored', error);
            });
            await loadRunningTrackDetails(track, options, stillCurrent);
        },
    });
    // A track the player turned out not to hold, and one that names no track of its own: where the
    // player says, the remembered song's own position is shown.
    if (outcome === 'untouched') await showRunningExternalPosition(song, overtaken);
};

// 'restored': the song plays from a fresh source. 'failed': it could not be restored (what went
// wrong is said, unless the caller has a source of its own to fall back on). 'stale': overtaken.
export type RestorePlaybackSourceOutcome = 'restored' | 'failed' | 'stale';

type RestorePlaybackSourceParams = {
    audioQuality: AudioQualityPreference;
    userId?: MediaId;
    blobUrlRef: RefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: RefObject<number | null>;
    setPlayQueue?: SetState<SongResult[]>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    restoreCachedThemeForSong?: RestoreSongTheme;
    persistLastPlaybackCache?: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    queue?: SongResult[];
    /** What `startRestore()` gave the caller when it made the song current. */
    stillWanted: () => boolean;
    /**
     * The caller has a source of its own to fall back on (the window hand-off's address from before).
     * An online restore then asks for the address once instead of asking again where the platform
     * could not be reached, and says nothing when it fails: the fallback plays, and should it fail
     * too, its media error is told like any other.
     */
    hasFallbackSource?: boolean;
    /**
     * The caller's `wholeQueueWritesSoFar()` when it started the restore. Given, and a whole-queue write
     * (a mod's replaceQueue, its undo) came since, the queue written and saved is the store's as it is
     * now with the restored song swapped in where it holds it, never put in front, instead of `queue`.
     */
    queueWritesAtStart?: number;
    /**
     * The time to resume at that the caller left (the window hand-off's position). On the web route
     * <audio>'s loadedmetadata spends it; a local or Navidrome song restored on the HiFi route starts
     * there and spends it here. Not given: it starts at its beginning.
     */
    pendingResumeTimeRef?: RefObject<number | null>;
    /**
     * A session read back at launch, rather than a window hand-off: a provider's own player outlives
     * this app, so it may still be running the remembered song where the listener left it. That one
     * state is read: a player sounding the song is taken over as it stands, and anything else is shown
     * at its position, from where the press of play starts. A hand-off takes its position from the old
     * window's snapshot instead, and asks the player nothing.
     */
    resumeExternalPosition?: boolean;
    /**
     * The caller's intent to play, taken by the restore where it takes a running player over: what
     * sounds there is the player's own, so nothing of this window's autoplay is left to fire.
     */
    shouldAutoPlayRef?: RefObject<boolean>;
};

// null on the HiFi route, which makes no blob URL: the one that was there is revoked all the same.
const replaceBlobUrl = (
    blobUrlRef: RefObject<string | null>,
    nextBlobUrl: string | null,
) => {
    if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = nextBlobUrl;
};

/**
 * The engine a restored local or Navidrome song plays on. A restore runs at launch, often before the
 * mpv runtime was first asked about: with HiFi on, that answer is waited for, or the song would go to
 * the web engine for want of it. With HiFi off nothing is waited for: the route is web whatever it says.
 */
const restoredSongRoute = async (kind: 'local' | 'navidrome', songKey: string): Promise<PlaybackRoute> => {
    if (useHifiSettingsStore.getState().enabled) await whenHifiRuntimeKnown();
    return hifiRouteFor(kind, songKey);
};

/** The time a HiFi restore starts at: what the caller left to resume at, spent here. */
const takeResumeTime = (pendingResumeTimeRef: RefObject<number | null> | undefined): number => {
    const startSec = pendingResumeTimeRef?.current ?? 0;
    if (pendingResumeTimeRef) pendingResumeTimeRef.current = null;
    return startSec;
};

/*
 * A HiFi restore that does not take over a running mpv is not loaded yet: until the first play (or a seek,
 * or an intent to play left by the caller, which the HiFi bridge acts on), mpv does not open the output
 * device, so a session restored paused does not hold an exclusive DAC. Its HiFi failure falls back to
 * the web route only while the restore is still wanted.
 */
const deferredHifiLoad = (overtaken: () => boolean) => ({
    deferLoad: true,
    stillWanted: () => !overtaken(),
});

// A failed restore shows its one message, with no countdown and no buttons. It never takes the place
// of a toast that stays (a newer play's retry or countdown, which the store cannot tell apart from
// this song while that play loads). Answers whether the message shows: one kept off the screen this
// way is not told to the extensions either.
const showRestoreMessage = (message: StatusMessage): boolean => {
    if (useStatusMessageStore.getState().message?.persistent) return false;
    setStatusMsg(message);
    return true;
};

/**
 * The restore itself (see restorePlaybackSourceForSong). A window that took nothing over from mpv and
 * whose restore lands on the web route, fails or is overtaken leaves the track an earlier window left
 * playing to nobody: restorePlaybackSourceForSong stops it then.
 */
const restoreSourceForSong = async (
    song: SongResult,
    {
        audioQuality,
        userId,
        blobUrlRef,
        currentOnlineAudioUrlFetchedAtRef,
        setPlayQueue,
        setLyrics,
        restoreCachedThemeForSong,
        persistLastPlaybackCache,
        queue,
        stillWanted,
        hasFallbackSource = false,
        queueWritesAtStart,
        pendingResumeTimeRef,
        resumeExternalPosition = false,
        shouldAutoPlayRef,
    }: RestorePlaybackSourceParams,
): Promise<RestorePlaybackSourceOutcome> => {
    let restoredSongKey = getPlaybackSongKey(song);
    const overtaken = () => !stillWanted() || askedSongKeyRef.current !== restoredSongKey;
    // A sign-out of another platform while this restore waits takes that platform's songs out of the queue it
    // writes and saves as well (as a play does, see keepSongsOfProvidersStanding): the store's queue lost them already.
    const providerDropsAtStart = providerDropsSoFar();
    // The queue to write (`write`, null for nothing) and to save once the restored song is in it: `own`,
    // or after a whole-queue write since the caller started, the store's queue of now (see queueWritesAtStart).
    const queueAfterRestore = (restoredSong: SongResult, own: () => SongResult[]): { write: SongResult[] | null; save: SongResult[] } => {
        if (queueWritesAtStart === undefined || wholeQueueWritesSoFar() === queueWritesAtStart) {
            const given = keepSongsOfProvidersStanding(own(), providerDropsAtStart);
            return { write: given, save: given };
        }
        const live = usePlaybackStore.getState().playQueue;
        const swapped = replacePlaybackSongWhereQueued(live, restoredSong);
        return { write: swapped, save: swapped ?? live };
    };

    // The queue a track a player moved on to goes in front of the remembered song: the one this
    // restore was given, or after a whole-queue write since it started, the store's as it is now.
    const queueBaseForRunningTrack = (): SongResult[] => (
        queueWritesAtStart === undefined || wholeQueueWritesSoFar() === queueWritesAtStart
            ? keepSongsOfProvidersStanding(queue && queue.length > 0 ? queue : [song], providerDropsAtStart)
            : usePlaybackStore.getState().playQueue
    );

    await restoreCachedThemeForSong?.(song, {
        allowLastUsedFallback: true,
        preserveCurrentOnMiss: false,
    });

    const rememberedCoverUrl = await getCachedSongCoverUrl(song);
    if (overtaken()) return 'stale';
    setCachedCoverUrl(rememberedCoverUrl);

    if (isNavidromePlaybackSong(song)) {
        const navidromeSongToRestore = (song as unknown as SongResult & { navidromeData?: NavidromeSong }).navidromeData;
        const config = getNavidromeConfig();
        const navidromeId = navidromeSongToRestore?.navidromeData?.id;

        if (!navidromeSongToRestore || !config || !navidromeId) {
            console.warn('[restorePlaybackSourceForSong] Navidrome song could not be restored');
            return 'failed';
        }

        currentOnlineAudioUrlFetchedAtRef.current = null;
        const audio = loadNavidromeSongAudio(config, navidromeSongToRestore);
        const onHifi = await restoredSongRoute('navidrome', `navidrome:${navidromeId}`) === 'hifi';
        // The HiFi route also takes the file's format from the server's record: its signal path shows it.
        await (onHifi ? audio.takeServerGainAndFormat() : audio.takeServerGain());
        if (overtaken()) return 'stale';
        if (onHifi) {
            // Taken over where mpv still plays it (a rebuilt window), else held at the resume time and loaded on the first play.
            void beginHifiTrack({
                song,
                source: { kind: 'navidrome', carrier: navidromeSongToRestore, streamUrl: audio.rawStreamUrl() },
                startSec: takeResumeTime(pendingResumeTimeRef),
                adoptRunning: true,
                ...deferredHifiLoad(overtaken),
            });
        } else {
            setAudioSrc(audio.streamUrl);
        }
        const restoredCoverUrl = getSongCoverUrl(song) || navidromeSongToRestore.navidromeData.coverArtUrl;
        if (restoredCoverUrl) {
            setCachedCoverUrl(restoredCoverUrl);
        }

        if (navidromeSongToRestore.lyricsSource === 'online' && navidromeSongToRestore.matchedLyrics) {
            setLyrics(navidromeSongToRestore.matchedLyrics);
        } else {
            await hydrateNavidromeLyricPayload(config, navidromeSongToRestore);
            const restoredLyrics = await resolvePreferredNavidromeLyrics(navidromeSongToRestore);
            if (overtaken()) return 'stale';
            if (hasRenderableLyrics(restoredLyrics)) {
                navidromeSongToRestore.lyricsSource = 'navi';
            }
            setLyrics(restoredLyrics);
        }

        const restoredCarrier = { ...song, navidromeData: navidromeSongToRestore } as SongResult;
        // Recomputed rather than carried over from the persisted object: without a revision every
        // representation lookup misses, and a restored session re-transcodes what is already cached.
        const restoredSong = {
            ...restoredCarrier,
            playbackSourceRevision: audio.revisionOf(restoredCarrier),
        } as SongResult;
        replaceShownSong(song, restoredSong);
        void persistLastPlaybackCache?.(restoredSong, queueAfterRestore(restoredSong, () => (queue && queue.length > 0 ? queue : [restoredSong])).save);
        return 'restored';
    }

    const legacyLocalData = (song as SongResult & { localData?: LocalSong }).localData;
    if (isLocalPlaybackSong(song) || legacyLocalData?.id) {
        const localSongId = isLocalPlaybackSong(song) ? song.localRef.songId : legacyLocalData?.id;
        let songToRestore: LocalSong | undefined;
        // A local file that cannot be restored has no case of its own: told to the extensions with none,
        // and only where the listener sees the message.
        const tellLocalFailure = (textKey: 'status.localSongNotInLibrary' | 'status.localFileReauthorize') => {
            if (showRestoreMessage({ type: 'info', text: i18n.t(textKey) })) {
                notifyPlaybackFailed({ song, reason: null, phase: 'restore', willAutoSkip: false });
            }
        };
        const songs = await getLocalSongs();
        if (overtaken()) return 'stale';

        if (localSongId) {
            songToRestore = songs.find(candidate => candidate.id === localSongId);
        }

        if (!songToRestore) {
            songToRestore = songs.find(candidate =>
                (candidate.title || candidate.fileName) === song.name &&
                Math.abs(candidate.duration - song.durationMs) < 1000,
            );
        }

        if (!songToRestore) {
            console.warn('[restorePlaybackSourceForSong] Could not find local song in library');
            tellLocalFailure('status.localSongNotInLibrary');
            return 'failed';
        }

        // Asked before the file is read: on the HiFi route mpv reads the file itself, and no blob URL is made.
        const onHifi = await restoredSongRoute('local', `local:${songToRestore.id}`) === 'hifi';
        if (overtaken()) return 'stale';
        const audio = onHifi ? await loadLocalSongHifiSource(songToRestore) : await loadLocalSongAudio(songToRestore);
        if (overtaken()) {
            // Never played: nothing holds this URL.
            if (audio && 'blobUrl' in audio) URL.revokeObjectURL(audio.blobUrl);
            return 'stale';
        }
        if (!audio) {
            console.warn('[restorePlaybackSourceForSong] Local song file not accessible - needs resync');
            tellLocalFailure('status.localFileReauthorize');
            return 'failed';
        }

        // null on the HiFi route.
        const blobUrl = 'blobUrl' in audio ? audio.blobUrl : null;
        songToRestore = audio.localSong;
        const localCoverUrl = getLocalCoverAssetUrl(songToRestore.localCoverAssetId, 1024);
        const catalog = await getLocalLibraryCatalogSnapshot();
        if (overtaken()) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            return 'stale';
        }
        const restoredSong = applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: songToRestore,
            matchedSong: null,
            coverUrl: songToRestore.useOnlineCover
                ? songToRestore.onlineMetadata?.coverUrl || localCoverUrl
                : localCoverUrl,
            preferOnlineMetadata: false,
        }), catalog);
        replaceShownSong(song, restoredSong);
        // A file found again under another id: the key has followed the rebuilt song.
        restoredSongKey = getPlaybackSongKey(restoredSong);
        replaceBlobUrl(blobUrlRef, blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
        if ('file' in audio) {
            // Taken over where mpv still plays it (a rebuilt window), else held at the resume time and loaded on the first play.
            void beginHifiTrack({
                song: restoredSong,
                source: { kind: 'local', localSong: songToRestore, file: audio.file },
                startSec: takeResumeTime(pendingResumeTimeRef),
                adoptRunning: true,
                ...deferredHifiLoad(overtaken),
            });
        } else {
            setAudioSrc(audio.blobUrl);
        }

        const resolvedLyrics = await resolveLocalSongLyrics(
            songToRestore,
            useLyricSettingsStore.getState().localLyricsPriority,
        );
        if (overtaken()) return 'stale';
        setLyrics(resolvedLyrics.lyrics);
        setActiveLocalLyricsSource(resolvedLyrics.source);

        const cacheKey = `cover_local_${songToRestore.id}`;
        const cachedCoverUrl = songToRestore.useOnlineCover
            ? await getCachedCoverUrl(cacheKey)
            : null;
        if (overtaken()) return 'stale';
        if (cachedCoverUrl) setCachedCoverUrl(cachedCoverUrl);
        else if (songToRestore.useOnlineCover && songToRestore.onlineMetadata?.coverUrl) {
            const fetchedCoverUrl = await loadCachedOrFetchCover(cacheKey, songToRestore.onlineMetadata.coverUrl);
            if (overtaken()) return 'stale';
            setCachedCoverUrl(fetchedCoverUrl);
        } else if (localCoverUrl) {
            setCachedCoverUrl(localCoverUrl);
        } else {
            setCachedCoverUrl(null);
        }
        const restoredQueue = queueAfterRestore(restoredSong, () => replacePlaybackSongInQueue(queue || [restoredSong], restoredSong));
        void persistLastPlaybackCache?.(restoredSong, restoredQueue.save);
        return 'restored';
    }

    // The restore never skips: it says what went wrong and leaves the song where it is. Told to the
    // extensions only where the listener sees it: not where the caller's own source takes over, nor
    // where a newer play's toast keeps the message off the screen (a mod acting on it would act on a
    // song the listener has left).
    const tellFailure = (shown: OnlineFailure) => {
        if (hasFallbackSource) console.warn('[restorePlaybackSourceForSong] Source not refreshed; the caller falls back to its own', shown.case);
        else if (showRestoreMessage(onlineFailureToast(shown, i18n.t))) {
            notifyPlaybackFailed({ song, reason: shown.case, phase: 'restore', willAutoSkip: false });
        }
    };

    const onlineLyricsState = await loadOnlineLyricsState(song);
    if (overtaken()) return 'stale';
    if (onlineLyricsState) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, onlineLyricsState };
        });
    }

    if (omni.canPlayExternally(song)) {
        // A provider's own player outlives the app: a session restore reads what it has (a track it
        // sounds is taken over, anything else is shown where it is), and the play path starts the song
        // otherwise. Its lyrics are still restored, so the screen is not empty. (A window rebuild is
        // different: the player outlives the window, and the hand-off's restore takes the running
        // track over itself; see useElectronWindowPlaybackHandoff.)
        try {
            const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
            if (overtaken()) return 'stale';
            if (song.durationMs > 0) setDuration(song.durationMs / 1000);
            const restoredLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
            if (restoredLyrics) setLyrics(restoredLyrics);
        } catch (error) {
            if (overtaken()) return 'stale';
            console.warn('[restorePlaybackSourceForSong] Lyrics could not be restored for the external player', error);
        }
        if (resumeExternalPosition) {
            await resumeRunningExternalPlayback(song, overtaken, {
                shouldAutoPlayRef,
                userId,
                setLyrics,
                setPlayQueue,
                queueBase: queueBaseForRunningTrack,
                persistLastPlaybackCache,
                restoreCachedThemeForSong,
            });
        }
        return 'restored';
    }

    if (!omni.canPlaySong(song)) {
        tellFailure(onlineFailureOf({ operation: 'audio', providerId: getOnlineProviderIdForSong(song) ?? undefined }, {}));
        return 'failed';
    }

    // Where the platform could not be reached the load asks again by itself while the restore is wanted,
    // unless the caller has a source to fall back on.
    const audioResult = await loadOnlineSongAudio(song, audioQuality, null, hasFallbackSource
        ? {}
        : { retry: { isCurrent: () => !overtaken() } });
    if (overtaken()) {
        // Never played: nothing holds this URL.
        if (audioResult.kind === 'ok' && audioResult.blobUrl) URL.revokeObjectURL(audioResult.blobUrl);
        return 'stale';
    }
    if (audioResult.kind === 'unavailable') {
        tellFailure(audioResult.failure);
        return 'failed';
    }

    if (audioResult.blobUrl) {
        replaceBlobUrl(blobUrlRef, audioResult.blobUrl);
    }
    currentOnlineAudioUrlFetchedAtRef.current = audioResult.fetchedAt;
    setAudioSrc(audioResult.audioSrc);

    const restoredSong = applyOnlineAudioSourceMetadata(song, audioResult.replayGain);
    if (restoredSong.replayGain) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, replayGain: restoredSong.replayGain };
        });
        const restoredQueue = queueAfterRestore(restoredSong, () => replacePlaybackSongInQueue(queue || [restoredSong], restoredSong));
        if (restoredQueue.write) setPlayQueue?.(restoredQueue.write);
        void persistLastPlaybackCache?.(restoredSong, restoredQueue.save);
    }

    // The source has landed, so lyrics that fail from here on are not a failed restore: told as one,
    // the session restore would take back the autoplay and the window hand-off would put the old
    // address back over the fresh one. A throw that comes after the listener moved on is stale.
    try {
        const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
        if (overtaken()) return 'stale';
        const restoredPreferredLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
        if (restoredPreferredLyrics) {
            const cachedText = restoredPreferredLyrics.lines.map(line => line.fullText).join('\n');
            setCurrentSong(prev => {
                if (!prev || !isSamePlaybackSong(prev, song)) return prev;
                return {
                    ...prev,
                    isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                        ? onlineLyricsState.matchedIsPureMusic
                        : isPureMusicLyricText(cachedText),
                };
            });
            setLyrics(restoredPreferredLyrics);
            return 'restored';
        }

        const songProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
        const effectiveUserId = songProviderId
            ? (useOnlineProviderAccountStore.getState().accounts[songProviderId]?.user?.id ?? userId)
            : userId;
        const processed = await omni.getLyrics(song, { userId: effectiveUserId });
        if (overtaken()) return 'stale';
        const resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, processed.lyrics);
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return {
                ...prev,
                isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : processed.isPureMusic,
            };
        });
        setLyrics(resolvedLyrics);
        return 'restored';
    } catch (error) {
        if (overtaken()) return 'stale';
        console.warn('[restorePlaybackSourceForSong] Lyrics could not be restored after the source landed', error);
        return 'restored';
    }
};

export const restorePlaybackSourceForSong = async (
    song: SongResult,
    params: RestorePlaybackSourceParams,
): Promise<RestorePlaybackSourceOutcome> => {
    let outcome: RestorePlaybackSourceOutcome | 'threw' = 'threw';
    try {
        outcome = await restoreSourceForSong(song, params);
        return outcome;
    } finally {
        // A restore that landed on the web route has set its address, and the route guard has stopped
        // mpv then; this covers the restores that set none. Nothing happens where this window holds a
        // HiFi track of its own (it took the running one over, or its own load replaces it).
        if (outcome !== 'restored') releaseUnclaimedHifiTrack(`restore ${outcome}`);
    }
};
