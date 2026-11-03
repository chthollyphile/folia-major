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
import { askedSongKeyRef, makeSongCurrent, startRestore } from '../currentSong';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { isRestoredSongPlayable } from '../playableSong';
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
            try {
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

                // Leave unsupported sessions cached for a build that registers their provider.
                if (!isRestoredSongPlayable(lastSong)) return;
                lastQueue = lastQueue?.filter(song => isRestoredSongPlayable(song)) ?? null;

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
                    if (!lastSong) return;
                    const lastSongKey = getPlaybackSongKey(lastSong);
                    if (!lastQueue.some(song => getPlaybackSongKey(song) === lastSongKey)) {
                        lastQueue.unshift(lastSong);
                    }
                    await persistLastPlaybackCache(lastSong, rewritten() ? usePlaybackStore.getState().playQueue : lastQueue);
                }

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
                    outcome = await restorePlaybackSourceForSong(lastSong, {
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
                    });
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
                // Every other entry into playback prefetches; this one was simply never wired to.
                void prefetchNearbySongs(lastSong, rewritten() ? usePlaybackStore.getState().playQueue : lastQueue || [lastSong], audioQuality, userId);
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
