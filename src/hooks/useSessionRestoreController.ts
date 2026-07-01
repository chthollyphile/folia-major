import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getFromCache } from '../services/db';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { restorePlaybackSourceForSong } from '../components/app/playback/restorePlaybackSource';
import { isStagePlaybackSong } from '../utils/appPlaybackGuards';
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
                const lastSong = await getFromCache<SongResult>('last_song');
                const lastQueue = await getFromCache<SongResult[]>('last_queue');

                if (isStagePlaybackSong(lastSong) || lastQueue?.some(song => isStagePlaybackSong(song))) {
                    await clearPersistedStagePlaybackCache();
                    return;
                }

                if (!lastSong) {
                    return;
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
