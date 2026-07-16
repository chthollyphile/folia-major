import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getFromCache, getLocalSongs } from '../services/db';
import { getLocalLibraryCatalogSnapshot } from '../services/localLibraryEntityRepository';
import { buildLocalQueue } from '../services/playbackAdapters';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { restorePlaybackSourceForSong } from '../components/app/playback/restorePlaybackSource';
import { getPlaybackSongKey, isStagePlaybackSong } from '../utils/appPlaybackGuards';
import type { LyricData, SongResult, StatusMessage } from '../types';

// src/hooks/useSessionRestoreController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseSessionRestoreControllerParams = {
    audioQuality: string;
    userId?: number;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setCurrentSong: SetState<SongResult | null>;
    setPlayQueue: SetState<SongResult[]>;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setStatusMsg: SetState<StatusMessage | null>;
    restoreCachedThemeForSong: (songId: ThemeCacheSongKey, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<'legacy' | 'dual' | 'fallback-dual' | 'restored' | 'none'>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadLocalSongs: () => Promise<void>;
    loadLocalPlaylists: () => Promise<void>;
    canRestoreSession?: boolean;
};

// Restores the main playback session without pushing more boot logic into App.tsx.
export function useSessionRestoreController({
    audioQuality,
    userId,
    blobUrlRef,
    currentOnlineAudioUrlFetchedAtRef,
    setCurrentSong,
    setPlayQueue,
    setCachedCoverUrl,
    setAudioSrc,
    setLyrics,
    setStatusMsg,
    restoreCachedThemeForSong,
    persistLastPlaybackCache,
    clearPersistedStagePlaybackCache,
    loadLocalSongs,
    loadLocalPlaylists,
    canRestoreSession = true,
}: UseSessionRestoreControllerParams) {
    const hasInitializedRef = useRef(false);
    const hasLoadedLocalLibraryRef = useRef(false);

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
            try {
                let lastSong = await getFromCache<SongResult>('last_song');
                let lastQueue = await getFromCache<SongResult[]>('last_queue');

                if (isStagePlaybackSong(lastSong) || lastQueue?.some(song => isStagePlaybackSong(song))) {
                    await clearPersistedStagePlaybackCache();
                    return;
                }

                if (!lastSong) {
                    return;
                }

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
                    await persistLastPlaybackCache(lastSong, lastQueue);
                }

                console.log('[Session] Restoring last song:', lastSong.name);
                setCurrentSong(lastSong);
                setPlayQueue(lastQueue && lastQueue.length > 0 ? lastQueue : [lastSong]);

                try {
                    await restorePlaybackSourceForSong(lastSong, {
                        audioQuality,
                        userId,
                        blobUrlRef,
                        currentOnlineAudioUrlFetchedAtRef,
                        setCurrentSong,
                        setCachedCoverUrl,
                        setAudioSrc,
                        setLyrics,
                        setStatusMsg,
                        restoreCachedThemeForSong,
                        persistLastPlaybackCache,
                        queue: lastQueue || [lastSong],
                    });
                } catch (error) {
                    console.warn('Failed to restore audio/lyrics for last session', error);
                }
            } catch (error) {
                console.error('Session restore failed', error);
            }
        };

        void restoreSession();
    }, [canRestoreSession]);
}
