import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getFromCache, getLocalSongs } from '../../../../services/db';
import { getLocalLibraryCatalogSnapshot } from '../../../../services/localLibraryEntityRepository';
import { buildLocalQueue } from '../../../../services/playbackAdapters';
import { prefetchNearbySongs } from '../../../../services/prefetchService';
import { reportYieldedQueue, wholeQueueWritesSoFar } from '../../../../services/wholeQueueWrites';
import type { ThemeCacheSongKey } from '../../../../services/themeCache';
import { restorePlaybackSourceForSong, type RestorePlaybackSourceOutcome } from './restorePlaybackSource';
import { getPlaybackSongKey, isStagePlaybackSong, normalizePlaybackSongSource } from '../../../../utils/appPlaybackGuards';
import type { LyricData, SongResult, StatusMessage } from '../../../../types';
import type { AudioQualityPreference, MediaId } from '../../../../types/onlineMusic';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { setPlayQueue, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { askedSongKeyRef, keepSongsOfProvidersStanding, makeSongCurrent, providerDropsSoFar, startRestore } from '../currentSong';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { isRestoredSongPlayable } from '../playableSong';
import { isSongSourceMissing } from '../../../../services/onlineMusic/songAvailability';
import { builtinSourcesSettled } from '../../../../services/onlineMusic/sourceReadiness';
import { omni } from '../../../../services/onlineMusic/omni';
import { releaseUnclaimedHifiTrack } from '../../../../services/hifi/hifiPlayback';

// src/components/app/playback/restore/useSessionRestoreController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseSessionRestoreControllerParams = {
    userId?: MediaId;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    restoreCachedThemeForSong: (songId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<'legacy' | 'dual' | 'fallback-dual' | 'restored' | 'none'>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadLocalSongs: () => Promise<void>;
    loadLocalPlaylists: () => Promise<void>;
    canRestoreSession?: boolean;
    /**
     * The autoplay intent the audio bridge spends when a source lands. Restore normally leaves it
     * alone so the session comes back paused; the lab switch below is the only thing that arms it.
     */
    shouldAutoPlayRef: MutableRefObject<boolean>;
};

// Restores the main playback session without pushing more boot logic into App.tsx.
export function useSessionRestoreController({
    userId,
    blobUrlRef,
    currentOnlineAudioUrlFetchedAtRef,
    setLyrics,
    restoreCachedThemeForSong,
    persistLastPlaybackCache,
    clearPersistedStagePlaybackCache,
    loadLocalSongs,
    loadLocalPlaylists,
    canRestoreSession = true,
    shouldAutoPlayRef,
}: UseSessionRestoreControllerParams) {
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);

    const hasInitializedRef = useRef(false);
    const hasLoadedLocalLibraryRef = useRef(false);
    // The whole-queue writes when the App first rendered, before the commit in which it hands mods
    // replaceQueue (useFoliumHostActions). Not read when the restore starts: on the desktop that waits for
    // the window handoff check, and a mod's replacement meanwhile would then be written over.
    const queueWritesAtMountRef = useRef(wholeQueueWritesSoFar());

    useEffect(() => {
        if (hasLoadedLocalLibraryRef.current) {
            return;
        }

        hasLoadedLocalLibraryRef.current = true;
        void loadLocalSongs();
        void loadLocalPlaylists();
    }, [loadLocalPlaylists, loadLocalSongs]);

    useEffect(() => {
        if (!canRestoreSession) {
            return;
        }

        if (hasInitializedRef.current) {
            return;
        }
        hasInitializedRef.current = true;

        const restoreSession = async () => {
            // A mod may replace the whole queue while the session is read (from its `activate`): its queue
            // then stands over the remembered one, and is what gets saved and fetched around. The song
            // itself is restored all the same.
            const writesAtStart = queueWritesAtMountRef.current;
            const rewritten = () => wholeQueueWritesSoFar() !== writesAtStart;
            // Whether the remembered song went to restorePlaybackSourceForSong, which settles what an
            // earlier window left playing in mpv itself (it takes it over, or stops it).
            let handedToSourceRestore = false;
            // A sign-out of a platform while the session is read takes its songs out of what is restored, as it
            // took them out of the store's queue (see keepSongsOfProvidersStanding); the remembered song one of
            // them, there is nothing to restore. Asked before the rebuilt snapshot is saved, and again before
            // the song is made current, so that every wait before it is covered.
            const providerDropsAtStart = providerDropsSoFar();
            const signedOut = (song: SongResult) => keepSongsOfProvidersStanding([song], providerDropsAtStart).length === 0;
            try {
                // The built-in platforms first: a song of one that registers late would otherwise count as one
                // that cannot be played, and be left out of what is restored.
                await builtinSourcesSettled();
                let lastSong = await getFromCache<SongResult>('last_song');
                let lastQueue = await getFromCache<SongResult[]>('last_queue');

                if (lastSong) lastSong = normalizePlaybackSongSource(lastSong);
                if (lastQueue) lastQueue = lastQueue.map(normalizePlaybackSongSource);

                if (isStagePlaybackSong(lastSong) || lastQueue?.some(song => isStagePlaybackSong(song))) {
                    await clearPersistedStagePlaybackCache();
                    return;
                }

                if (!lastSong) {
                    return;
                }

                // The remembered song's own platform may be missing now (not registered, turned off): the session
                // is restored all the same - the song current and paused, shown as one that cannot be played, and
                // the queue around it - so that the next save does not write the queue over with a shorter one.
                // Its audio is not fetched; it plays once its platform is back (Folium 2.0 plan §2 item 3, §12 item 2).
                const lastSongSourceMissing = isSongSourceMissing(lastSong);
                // Leave other unsupported sessions cached for a build that can play them.
                if (!isRestoredSongPlayable(lastSong) && !lastSongSourceMissing) return;
                // A song whose platform is missing now (not registered, turned off) stays in the queue, shown as
                // one that cannot be played, and plays again once its platform is back: it is not taken out, so
                // the next save of the queue does not lose it. A song its platform is there and cannot play is.
                lastQueue = lastQueue?.filter(song => isRestoredSongPlayable(song) || isSongSourceMissing(song)) ?? null;

                const containsLocalSnapshot = [lastSong, ...(lastQueue || [])].some(song => (
                    Boolean((song as any).isLocal)
                    || Boolean((song as any).localRef?.songId)
                    || Boolean((song as any).localData?.id)
                ));
                if (containsLocalSnapshot) {
                    const [localSongs, catalog] = await Promise.all([
                        getLocalSongs(),
                        getLocalLibraryCatalogSnapshot(),
                    ]);
                    const songsById = new Map(localSongs.map(song => [song.id, song]));
                    const rebuild = (cached: SongResult): SongResult | null => {
                        const songId = (cached as any).localRef?.songId || (cached as any).localData?.id;
                        if (!songId) return cached;
                        const localSong = songsById.get(songId);
                        if (!localSong) return null;
                        return buildLocalQueue([localSong], undefined, catalog)[0] || null;
                    };
                    lastSong = rebuild(lastSong);
                    lastQueue = (lastQueue || []).map(rebuild).filter((song): song is SongResult => Boolean(song));
                    if (!lastSong || signedOut(lastSong)) return;
                    lastQueue = keepSongsOfProvidersStanding(lastQueue, providerDropsAtStart);
                    const lastSongKey = getPlaybackSongKey(lastSong);
                    if (!lastQueue.some(song => getPlaybackSongKey(song) === lastSongKey)) {
                        lastQueue.unshift(lastSong);
                    }
                    await persistLastPlaybackCache(lastSong, rewritten() ? usePlaybackStore.getState().playQueue : lastQueue);
                }

                if (signedOut(lastSong)) return;
                lastQueue = lastQueue && keepSongsOfProvidersStanding(lastQueue, providerDropsAtStart);

                // A song asked for while the remembered one was being read stands: the restore gives up.
                if (askedSongKeyRef.current !== null) return;

                // The active platform stays as it was: the song plays through its own platform, and the queue may
                // hold songs of several.
                console.log('[Session] Restoring last song:', lastSong.name);
                makeSongCurrent(lastSong);
                const stillWanted = startRestore();
                const rememberedQueue = lastQueue && lastQueue.length > 0 ? lastQueue : [lastSong];
                if (rewritten()) {
                    // Saved again now that a song is current: the replacement's own save found none, so it kept nothing.
                    void persistLastPlaybackCache(lastSong, usePlaybackStore.getState().playQueue);
                    // The remembered queue is the listener's: the replacement's undo puts it back.
                    reportYieldedQueue({ queue: rememberedQueue, song: lastSong });
                } else {
                    setPlayQueue(rememberedQueue);
                }

                const sourceRestoreOptions = {
                    audioQuality,
                    userId,
                    blobUrlRef,
                    currentOnlineAudioUrlFetchedAtRef,
                    setLyrics,
                    restoreCachedThemeForSong,
                    persistLastPlaybackCache,
                    queue: lastQueue || [lastSong],
                    stillWanted,
                    queueWritesAtStart: writesAtStart,
                };

                if (lastSongSourceMissing) {
                    console.info(`[Session] The last song's platform is not there; it is restored paused, without its audio: ${lastSong.name}`);
                    // The theme kept for the song is shown meanwhile. Once its platform registers - and the song is
                    // still the one current, asked for by nothing since - its source is restored as any remembered
                    // song's is (address, lyrics, theme), still paused: a press of play then plays it whole.
                    void restoreCachedThemeForSong(lastSong, { allowLastUsedFallback: true }).catch((error: unknown) => (
                        console.warn('[Session] Failed to restore the theme of a song whose platform is missing', error)
                    ));
                    const songKey = getPlaybackSongKey(lastSong);
                    const remembered = lastSong;
                    const stopWaiting = omni.subscribeProviders(() => {
                        if (!stillWanted() || askedSongKeyRef.current !== songKey) {
                            stopWaiting();
                            return;
                        }
                        if (isSongSourceMissing(remembered)) return;
                        stopWaiting();
                        console.info(`[Session] The last song's platform is back; restoring its source: ${remembered.name}`);
                        void restorePlaybackSourceForSong(remembered, sourceRestoreOptions).catch((error: unknown) => (
                            console.warn('[Session] Failed to restore the source of the last song once its platform was back', error)
                        ));
                    });
                    return;
                }

                // Read at restore time rather than subscribed: this effect runs once, and the
                // switch only ever has to answer for this one launch.
                const autoPlayOnLaunch = useAudioSettingsStore.getState().autoPlayOnLaunch;
                if (autoPlayOnLaunch) {
                    // Arm before the source lands. The bridge's autoplay effect fires on the commit
                    // that gives the deck its src, and it spends this flag there; setting it after
                    // would miss that run and leave the deck buffered in silence.
                    shouldAutoPlayRef.current = true;
                }

                let outcome: RestorePlaybackSourceOutcome = 'failed';
                handedToSourceRestore = true;
                try {
                    outcome = await restorePlaybackSourceForSong(lastSong, sourceRestoreOptions);
                } catch (error) {
                    console.warn('Failed to restore audio/lyrics for last session', error);
                }

                // A song was asked for meanwhile, another one or this same one: the intent to play
                // and what is fetched next are that play's.
                if (outcome === 'stale' || !stillWanted() || askedSongKeyRef.current !== getPlaybackSongKey(lastSong)) return;
                if (outcome === 'failed') {
                    // No source ever landed (the restore failed, or threw), so the intent was never
                    // spent. Left standing it would fire on whatever the listener plays next, which
                    // they did not ask for.
                    shouldAutoPlayRef.current = false;
                }

                // Restoring a session sets up the current song and stops, so until the listener
                // changes track nothing around it has been fetched: the next song's URL and lyrics
                // are cold, and neither track has been measured for automix. That makes the first
                // song change of every session the slowest one and the only one that blends blind.
                // Every other entry into playback prefetches; this one was simply never wired to. Around the
                // store's queue as it is now: the remembered one less what a mod's replacement or a sign-out
                // of a platform took out of it while the source was restored.
                void prefetchNearbySongs(lastSong, usePlaybackStore.getState().playQueue, audioQuality, userId);
            } catch (error) {
                console.error('Session restore failed', error);
            } finally {
                // Nothing to restore (no song remembered, a song already asked for, the file gone from the
                // library, a Stage session): a track an earlier window left playing in mpv is nobody's now.
                if (!handedToSourceRestore) releaseUnclaimedHifiTrack('nothing to restore');
            }
        };

        void restoreSession();
    }, [canRestoreSession]);
}
