import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { getFromCacheWithMigration, getLocalSongs, removeFromCache, saveLocalSong, saveToCache } from '../services/db';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../services/coverCache';
import { ensureLocalSongEmbeddedCover, getAudioFromLocalSong } from '../services/localMusicService';
import { addSongsToLocalPlaylist, createLocalPlaylist, getLocalPlaylists, setLocalSongFavorite } from '../services/localPlaylistService';
import { applyLocalLibraryEntityDisplay, buildLocalQueue, buildNavidromeQueue, buildUnifiedLocalSong, buildUnifiedNavidromeSong, resolveLocalSongMetadata } from '../services/playbackAdapters';
import { getPrefetchedData } from '../services/prefetchService';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { hasRenderableLyrics } from '../utils/appPlaybackHelpers';
import {
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    isStagePlaybackSong,
    getPlaybackSongKey,
    hasMixedPlaybackSources,
    replacePlaybackSongInQueue,
    resolveNavidromePlaybackCarrier,
    getPlaybackSourceRef,
} from '../utils/appPlaybackGuards';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../utils/appNavidromeLyrics';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { migrateMatchedLyricsCarrierRenderHints } from '../utils/lyrics/storageMigration';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { resolveExplicitFileTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { omni } from '../services/onlineMusic/omni';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import { getSongCacheWithLegacyMigration } from '../services/onlineMusic/resourceCache';
import { getProviderCacheKey } from '../services/onlineMusic/providerStorage';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { PlayerState } from '../types';
import type { LyricData, LocalPlaylist, LocalSong, OnlineLyricsState, QueueAddBehavior, SongResult, StatusMessage } from '../types';
import type { AudioQualityPreference, MediaId, ProviderCollection } from '../types/onlineMusic';
import type { PlaybackSnapshot, PlaybackNavigationOptions } from '../types/appPlayback';
import type { NavidromeSong } from '../types/navidrome';
import type { NavidromeMatchData } from '../components/modal/NaviLyricMatchModal';
import { applyQueueAddBehavior } from '../utils/queueAddBehavior';
import { loadOnlineLyricsState, resolveOnlineLyrics, saveOnlineLyricsState, getOnlineLyricsStateCacheKey } from '../utils/onlineLyricsState';
import { createSafeObjectUrl, getBlobObjectUrlSignature, isBlob } from '../utils/blobGuards';
import { applyMatchedMetadata } from '../services/localLibraryCatalogService';
import { buildLocalSongLyricMatchContext, shouldRefreshLocalSongLyricsFromMetadata, shouldRunLocalSongAutomaticMatch } from '../utils/lyrics/localSongMatchContext';
import { getLocalLibraryCatalogSnapshot } from '../services/localLibraryEntityRepository';

// src/hooks/useLibraryPlaybackController.ts

const parseLocalSongLyrics = (song: Pick<LocalSong, 'localLyricsContent' | 'localTranslationLyricsContent' | 'localLyricsFormat'>) => {
    if (!song.localLyricsContent) {
        return Promise.resolve(null);
    }

    return LyricParserFactory.parse({
        type: 'local',
        lrcContent: song.localLyricsContent,
        tLrcContent: song.localTranslationLyricsContent,
        formatHint: song.localLyricsFormat,
    });
};

type SetState<T> = Dispatch<SetStateAction<T>>;

type LocalCoverObjectUrlEntry = {
    signature: string;
    url: string;
};

const isBlobObjectUrl = (url: string | null | undefined): url is string => (
    typeof url === 'string' && url.startsWith('blob:')
);

type UseLibraryPlaybackControllerParams = {
    t: (key: string, fallback?: string) => string;
    audioQuality: AudioQualityPreference;
    queueAddBehavior: QueueAddBehavior;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    playQueue: SongResult[];
    likedSongIds: Set<MediaId>;
    starredNavidromeSongIds: Set<string>;
    userId?: MediaId;
    currentTime: MotionValue<number>;
    setCurrentSong: SetState<SongResult | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setPlayQueue: SetState<SongResult[]>;
    setPlayerState: SetState<PlayerState>;
    setCurrentLineIndex: SetState<number>;
    setDuration: SetState<number>;
    setIsLyricsLoading: SetState<boolean>;
    setStatusMsg: SetState<StatusMessage | null>;
    setIsPanelOpen: SetState<boolean>;
    setLikedSongIds: Dispatch<SetStateAction<Set<MediaId>>>;
    setStarredNavidromeSongIds: Dispatch<SetStateAction<Set<string>>>;
    navigateToPlayer: () => void;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    restoreCachedThemeForSong: (songOrId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    interruptStagePlaybackForMainTransition: () => PlaybackSnapshot | null;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    currentSongRef: MutableRefObject<string | number | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
};

// Owns local and Navidrome playback helpers so App.tsx can stay focused on assembly.
export function useLibraryPlaybackController({
    t,
    audioQuality,
    queueAddBehavior,
    currentSong,
    lyrics,
    playQueue,
    likedSongIds,
    starredNavidromeSongIds,
    userId,
    currentTime,
    setCurrentSong,
    setLyrics,
    setCachedCoverUrl,
    setAudioSrc,
    setPlayQueue,
    setPlayerState,
    setCurrentLineIndex,
    setDuration,
    setIsLyricsLoading,
    setStatusMsg,
    setIsPanelOpen,
    setLikedSongIds,
    setStarredNavidromeSongIds,
    navigateToPlayer,
    persistLastPlaybackCache,
    restoreCachedThemeForSong,
    interruptStagePlaybackForMainTransition,
    blobUrlRef,
    shouldAutoPlayRef,
    currentSongRef,
    currentOnlineAudioUrlFetchedAtRef,
}: UseLibraryPlaybackControllerParams) {
    const [localSongs, setLocalSongs] = useState<LocalSong[]>([]);
    const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([]);
    const [showLyricMatchModal, setShowLyricMatchModal] = useState(false);
    const [showNaviLyricMatchModal, setShowNaviLyricMatchModal] = useState(false);
    const [showOnlineLyricMatchModal, setShowOnlineLyricMatchModal] = useState(false);
    const localCoverObjectUrlsRef = useRef<Map<string, LocalCoverObjectUrlEntry>>(new Map());
    const managedCachedCoverObjectUrlRef = useRef<string | null>(null);
    const resolveLocalSongRecord = useCallback((song: SongResult | null | undefined): LocalSong | undefined => {
        const songId = (song as SongResult & { localRef?: { songId: string } } | null | undefined)?.localRef?.songId;
        return songId ? localSongs.find(localSong => localSong.id === songId) : undefined;
    }, [localSongs]);

    const isRegisteredLocalCoverObjectUrl = useCallback((url: string) => {
        for (const entry of localCoverObjectUrlsRef.current.values()) {
            if (entry.url === url) {
                return true;
            }
        }
        return false;
    }, []);

    const revokeManagedCachedCoverObjectUrl = useCallback(() => {
        if (managedCachedCoverObjectUrlRef.current) {
            URL.revokeObjectURL(managedCachedCoverObjectUrlRef.current);
            managedCachedCoverObjectUrlRef.current = null;
        }
    }, []);

    const setManagedCachedCoverUrl = useCallback((nextUrl: string | null) => {
        const previousUrl = managedCachedCoverObjectUrlRef.current;
        if (previousUrl && previousUrl !== nextUrl) {
            URL.revokeObjectURL(previousUrl);
            managedCachedCoverObjectUrlRef.current = null;
        }

        if (isBlobObjectUrl(nextUrl) && !isRegisteredLocalCoverObjectUrl(nextUrl)) {
            managedCachedCoverObjectUrlRef.current = nextUrl;
        }

        setCachedCoverUrl(nextUrl);
    }, [isRegisteredLocalCoverObjectUrl, setCachedCoverUrl]);

    const clearLocalCoverObjectUrls = useCallback(() => {
        localCoverObjectUrlsRef.current.forEach(entry => URL.revokeObjectURL(entry.url));
        localCoverObjectUrlsRef.current.clear();
    }, []);

    const pruneLocalCoverObjectUrls = useCallback((activeLocalSongIds: Set<string>) => {
        localCoverObjectUrlsRef.current.forEach((entry, localSongId) => {
            if (!activeLocalSongIds.has(localSongId)) {
                URL.revokeObjectURL(entry.url);
                localCoverObjectUrlsRef.current.delete(localSongId);
            }
        });
    }, []);

    const getOrCreateLocalCoverObjectUrl = useCallback((song: LocalSong) => {
        if (!isBlob(song.embeddedCover)) {
            return null;
        }

        const signature = getBlobObjectUrlSignature(song.embeddedCover, [
            song.id,
            song.fileSignature,
            song.fileSize,
            song.fileLastModified,
        ]);
        const cached = localCoverObjectUrlsRef.current.get(song.id);
        if (cached?.signature === signature) {
            return cached.url;
        }

        if (cached) {
            URL.revokeObjectURL(cached.url);
        }

        const url = createSafeObjectUrl(song.embeddedCover);
        if (!url) return null;
        localCoverObjectUrlsRef.current.set(song.id, { signature, url });
        return url;
    }, []);

    useEffect(() => {
        return () => {
            clearLocalCoverObjectUrls();
            revokeManagedCachedCoverObjectUrl();
        };
    }, [clearLocalCoverObjectUrls, revokeManagedCachedCoverObjectUrl]);

    useEffect(() => {
        const activeLocalSongIds = new Set<string>();
        if (isLocalPlaybackSong(currentSong)) {
            activeLocalSongIds.add(currentSong.localRef.songId);
        }
        playQueue.forEach(song => {
            if (isLocalPlaybackSong(song)) {
                activeLocalSongIds.add(song.localRef.songId);
            }
        });
        pruneLocalCoverObjectUrls(activeLocalSongIds);
    }, [currentSong, playQueue, pruneLocalCoverObjectUrls]);

    useEffect(() => {
        if (!isLocalPlaybackSong(currentSong)) {
            revokeManagedCachedCoverObjectUrl();
        }
    }, [currentSong, revokeManagedCachedCoverObjectUrl]);

    const loadLocalSongs = useCallback(async () => {
        try {
            const songs = await getLocalSongs();
            setLocalSongs(songs);
        } catch (error) {
            console.error('Failed to load local songs:', error);
        }
    }, []);

    const loadLocalPlaylists = useCallback(async () => {
        try {
            const playlists = await getLocalPlaylists();
            setLocalPlaylists(playlists);
        } catch (error) {
            console.error('Failed to load local playlists:', error);
        }
    }, []);

    const onRefreshLocalSongs = useCallback(async () => {
        const [songs, catalog] = await Promise.all([
            getLocalSongs(),
            getLocalLibraryCatalogSnapshot(),
            loadLocalPlaylists(),
        ]);
        setLocalSongs(songs);
        const songsById = new Map(songs.map(song => [song.id, song]));
        const rebuild = (snapshot: SongResult): SongResult | null => {
            if (!isLocalPlaybackSong(snapshot)) return snapshot;
            const localSong = songsById.get(snapshot.localRef.songId);
            return localSong ? buildLocalQueue([localSong], undefined, catalog)[0] || null : null;
        };
        setCurrentSong(previous => previous ? rebuild(previous) : null);
        setPlayQueue(previous => previous.map(rebuild).filter((song): song is SongResult => Boolean(song)));
    }, [loadLocalPlaylists, setCurrentSong, setPlayQueue]);

    const getFavoriteLocalPlaylist = useMemo(
        () => localPlaylists.find(playlist => playlist.isFavorite) ?? null,
        [localPlaylists],
    );

    const loadBaseOnlineLyrics = useCallback(async (
        onlineSong: SongResult,
        fallbackLyrics: LyricData | null = lyrics
    ): Promise<LyricData | null> => {
        const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', onlineSong, migrateLyricDataRenderHints);
        if (cachedLyrics) return cachedLyrics;

        const prefetched = getPrefetchedData(onlineSong, audioQuality);
        if (prefetched?.lyrics) return prefetched.lyrics;

        return (await omni.getLyrics(onlineSong, { userId })).lyrics ?? fallbackLyrics;
    }, [audioQuality, lyrics, userId]);

    const resolveOnlineSongLyricsState = useCallback(async (
        onlineSong: SongResult,
        fallbackLyrics: LyricData | null = lyrics
    ): Promise<{ state: OnlineLyricsState | null; lyrics: LyricData | null; }> => {
        const state = await loadOnlineLyricsState(onlineSong);
        const baseLyrics = await loadBaseOnlineLyrics(onlineSong, fallbackLyrics);
        return {
            state,
            lyrics: resolveOnlineLyrics(state, baseLyrics),
        };
    }, [loadBaseOnlineLyrics, lyrics]);

    const isLocalSongLiked = useCallback((song: SongResult | null) => {
        if (!song || !isLocalPlaybackSong(song) || !getFavoriteLocalPlaylist) {
            return false;
        }

        return getFavoriteLocalPlaylist.songIds.includes(song.localRef.songId);
    }, [getFavoriteLocalPlaylist]);

    const saveCurrentQueueAsLocalPlaylist = useCallback(async (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        // TODO: Define cross-source playlist export before allowing mixed queues to be saved.
        if (hasMixedPlaybackSources(playQueue)) {
            throw new Error('Mixed-source queues cannot be saved as playlists yet');
        }

        const queueSongs = playQueue
            .map(resolveLocalSongRecord)
            .filter((song): song is LocalSong => Boolean(song?.id));

        if (!queueSongs.length) {
            throw new Error('No local songs in queue');
        }

        await createLocalPlaylist(trimmedName, queueSongs);
        await loadLocalPlaylists();
    }, [loadLocalPlaylists, playQueue, resolveLocalSongRecord]);

    const addCurrentSongToLocalPlaylist = useCallback(async (playlistId: string) => {
        const localSong = resolveLocalSongRecord(currentSong);
        if (!isLocalPlaybackSong(currentSong) || !localSong) {
            throw new Error('Current song is not local');
        }

        await addSongsToLocalPlaylist(playlistId, [localSong]);
        await loadLocalPlaylists();
    }, [currentSong, loadLocalPlaylists, resolveLocalSongRecord]);

    const createCurrentLocalPlaylist = useCallback(async (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        const localSong = resolveLocalSongRecord(currentSong);
        if (!isLocalPlaybackSong(currentSong) || !localSong) {
            throw new Error('Current song is not local');
        }

        await createLocalPlaylist(trimmedName, [localSong]);
        await loadLocalPlaylists();
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [currentSong, loadLocalPlaylists, resolveLocalSongRecord, setStatusMsg, t]);

    const addCurrentSongToOnlinePlaylist = useCallback(async (playlist: ProviderCollection) => {
        if (!currentSong) throw new Error('No current song');
        await omni.addSongToPlaylist(currentSong, playlist);
        await removeFromCache(getProviderCacheKey(playlist.providerId, `playlist_tracks_${playlist.id}`));
        await removeFromCache(getProviderCacheKey(playlist.providerId, `playlist_detail_${playlist.id}`));
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [currentSong, setStatusMsg, t]);

    const addCurrentSongToNavidromePlaylist = useCallback(async (playlistId: string) => {
        if (!isNavidromePlaybackSong(currentSong)) {
            throw new Error('Current song is not a Navidrome song');
        }

        const config = getNavidromeConfig();
        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        if (!config || !navidromeSong?.navidromeData?.id) {
            throw new Error('Navidrome is not configured');
        }

        await navidromeApi.updatePlaylist(config, playlistId, {
            songIdsToAdd: [navidromeSong.navidromeData.id],
        });
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [currentSong, setStatusMsg, t]);

    const createCurrentNavidromePlaylist = useCallback(async (name: string) => {
        if (!isNavidromePlaybackSong(currentSong)) {
            throw new Error('Current song is not a Navidrome song');
        }

        const config = getNavidromeConfig();
        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        if (!config || !navidromeSong?.navidromeData?.id) {
            throw new Error('Navidrome is not configured');
        }

        await navidromeApi.createPlaylist(config, name, [navidromeSong.navidromeData.id]);
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [currentSong, setStatusMsg, t]);

    const handleLocalSongMatch = useCallback(async (localSong: LocalSong): Promise<{ updatedLocalSong: LocalSong; matchedSongResult: SongResult | null; }> => {
        let updatedLocalSong = localSong;
        let matchedSongResult: SongResult | null = null;
        const needsLyricsMatch = (
            !localSong.hasLocalLyrics
            && !localSong.hasEmbeddedLyrics
            && (!localSong.matchedLyrics && !localSong.matchedIsPureMusic
                || shouldRefreshLocalSongLyricsFromMetadata(localSong))
        );
        const needsCoverMatch = !isBlob(localSong.embeddedCover) && !localSong.onlineMetadata?.coverUrl;

        if ((needsLyricsMatch || needsCoverMatch) && shouldRunLocalSongAutomaticMatch(localSong)) {
            setStatusMsg({ type: 'info', text: t('status.matchingLyricsAndCover') || '' });
            try {
                const { matchLyrics } = await import('../services/localMusicService');
                await matchLyrics(localSong);
                const updatedSongs = await getLocalSongs();
                const found = updatedSongs.find(song => song.id === localSong.id);

                if (found) {
                    updatedLocalSong = found;
                }
            } catch (error) {
                console.warn('Auto-match failed:', error);
            }
            await loadLocalSongs();
        }

        return { updatedLocalSong, matchedSongResult };
    }, [loadLocalSongs, setStatusMsg]);

    const resolveLocalMetadataUI = useCallback(async (localData: LocalSong, matchedSong: SongResult | null) => {
        const embeddedCoverUrl = getOrCreateLocalCoverObjectUrl(localData);
        const preferOnlineCover = localData.useOnlineCover === true;
        const coverUrl = preferOnlineCover
            ? (localData.onlineMetadata?.coverUrl || embeddedCoverUrl || null)
            : embeddedCoverUrl;

        let nextLyrics: LyricData | null = null;
        const source = localData.lyricsSource;
        if (source === 'online' && localData.matchedLyrics) {
            nextLyrics = localData.matchedLyrics;
        } else if (source === 'embedded' && localData.embeddedLyricsContent) {
            nextLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
        } else if (source === 'local' && localData.localLyricsContent) {
            nextLyrics = await parseLocalSongLyrics(localData);
        } else if (!source) {
            if (localData.hasLocalLyrics && localData.localLyricsContent) {
                nextLyrics = await parseLocalSongLyrics(localData);
            } else if (localData.hasEmbeddedLyrics && localData.embeddedLyricsContent) {
                nextLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
            } else if (localData.matchedLyrics) {
                nextLyrics = localData.matchedLyrics;
            }
        }

        const catalog = await getLocalLibraryCatalogSnapshot();
        const unifiedSong = applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: localData,
            matchedSong,
            coverUrl,
            preferOnlineMetadata: false,
        }), catalog);

        return { lyrics: nextLyrics, coverUrl, unifiedSong, catalog };
    }, [getOrCreateLocalCoverObjectUrl]);

    const loadCurrentSongLyricPreview = useCallback(async (): Promise<LyricData | null> => {
        if (!currentSong) {
            return null;
        }

        if (isLocalPlaybackSong(currentSong)) {
            const localData = resolveLocalSongRecord(currentSong);
            if (!localData) return lyrics;
            const source = localData.lyricsSource;

            if (source === 'online' && localData.matchedLyrics) return localData.matchedLyrics;
            if (source === 'embedded' && localData.embeddedLyricsContent) {
                return LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
            }
            if (source === 'local' && localData.localLyricsContent) {
                return parseLocalSongLyrics(localData);
            }
            if (!source) {
                if (localData.hasLocalLyrics && localData.localLyricsContent) {
                    return parseLocalSongLyrics(localData);
                }
                if (localData.hasEmbeddedLyrics && localData.embeddedLyricsContent) {
                    return LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
                }
                if (localData.matchedLyrics) {
                    return localData.matchedLyrics;
                }
            }

            return lyrics;
        }

        if (isNavidromePlaybackSong(currentSong)) {
            const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
            if (!navidromeSong) {
                return lyrics;
            }

            if ((navidromeSong as NavidromeSong & { lyricsSource?: string; matchedLyrics?: LyricData; }).lyricsSource === 'online' && (navidromeSong as NavidromeSong & { matchedLyrics?: LyricData; }).matchedLyrics) {
                return (navidromeSong as NavidromeSong & { matchedLyrics?: LyricData; }).matchedLyrics ?? null;
            }

            const config = getNavidromeConfig();
            if (config) {
                await hydrateNavidromeLyricPayload(config, navidromeSong);
            }

            const resolved = await resolvePreferredNavidromeLyrics(navidromeSong);
            if (resolved) return resolved;

            return lyrics;
        }

        const onlineSong = currentSong;
        const resolved = await resolveOnlineSongLyricsState(onlineSong, lyrics);
        return resolved.lyrics;
    }, [currentSong, lyrics, resolveLocalSongRecord, resolveOnlineSongLyricsState]);

    const handleLocalQueueAdd = useCallback(async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        const { unifiedSong } = await resolveLocalMetadataUI(preparedLocalSong, null);
        const baseQueue = playQueue.length > 0 ? playQueue : (currentSong ? [currentSong] : []);
        const { nextQueue, affectedSongs, changed } = applyQueueAddBehavior({
            queue: baseQueue,
            songs: [unifiedSong],
            currentSong,
            behavior: queueAddBehavior,
        });

        if (!changed || affectedSongs.length === 0) {
            return;
        }

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);
        setStatusMsg({
            type: 'success',
            text: queueAddBehavior === 'next' ? (t('status.insertedToNext') || '') : (t('status.queueUpdated') || ''),
            nonce: Date.now(),
            durationMs: 1200,
        });
    }, [currentSong, persistLastPlaybackCache, playQueue, queueAddBehavior, resolveLocalMetadataUI, setPlayQueue, setStatusMsg, t]);

    const prewarmLocalSongMetadata = useCallback(async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        Object.assign(localSong, preparedLocalSong);

        const needsLyricsMatch = (
            !localSong.hasLocalLyrics
            && !localSong.hasEmbeddedLyrics
            && (!localSong.matchedLyrics && !localSong.matchedIsPureMusic
                || shouldRefreshLocalSongLyricsFromMetadata(localSong))
        );
        const needsCoverMatch = !isBlob(localSong.embeddedCover) && !localSong.onlineMetadata?.coverUrl;
        if ((needsLyricsMatch || needsCoverMatch) && shouldRunLocalSongAutomaticMatch(localSong)) {
            try {
                const { matchLyrics } = await import('../services/localMusicService');
                await matchLyrics(localSong);
            } catch (error) {
                console.warn('[LocalPrewarm] Failed to prewarm local song metadata:', error);
            }
        }
    }, []);

    const prewarmNearbyLocalSongs = useCallback((currentLocalSong: LocalSong, queue: LocalSong[] = []) => {
        if (queue.length === 0) {
            return;
        }

        const currentIndex = queue.findIndex(song => song.id === currentLocalSong.id);
        if (currentIndex === -1) {
            return;
        }

        const nearbySongs = [-1, 1, 2]
            .map(offset => queue[currentIndex + offset])
            .filter((song): song is LocalSong => Boolean(song));

        if (nearbySongs.length === 0) {
            return;
        }

        window.setTimeout(() => {
            void (async () => {
                for (const nearbySong of nearbySongs) {
                    await prewarmLocalSongMetadata(nearbySong);
                }
            })();
        }, 1000);
    }, [prewarmLocalSongMetadata]);

    const onPlayLocalSong = useCallback(async (localSong: LocalSong, queue: LocalSong[] = [], options: PlaybackNavigationOptions = {}) => {
        interruptStagePlaybackForMainTransition();

        const blobUrl = await getAudioFromLocalSong(localSong);
        if (!blobUrl) {
            setStatusMsg({ type: 'error', text: t('status.localFileAccessError') || '' });
            return;
        }

        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        const initialMeta = await resolveLocalMetadataUI(preparedLocalSong, null);

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = blobUrl;

        shouldAutoPlayRef.current = true;
        const initialSongKey = getPlaybackSongKey(initialMeta.unifiedSong);
        currentSongRef.current = initialSongKey;
        setLyrics(initialMeta.lyrics);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setCurrentSong(initialMeta.unifiedSong);
        setAudioSrc(blobUrl);

        if (initialMeta.coverUrl) {
            loadCachedOrFetchCover(`cover_local_${preparedLocalSong.id}`, initialMeta.coverUrl).then((resolvedCoverUrl) => {
                if (currentSongRef.current === initialSongKey) {
                    setManagedCachedCoverUrl(resolvedCoverUrl);
                }
            });
        } else {
            setManagedCachedCoverUrl(null);
        }

        setIsLyricsLoading(true);

        const finalQueue = options.unifiedQueue
            ? replacePlaybackSongInQueue(options.unifiedQueue, initialMeta.unifiedSong)
            : queue.length > 0
                ? buildLocalQueue(queue, initialMeta.unifiedSong, initialMeta.catalog)
                : [initialMeta.unifiedSong];
        setPlayQueue(finalQueue);
        void persistLastPlaybackCache(initialMeta.unifiedSong, finalQueue);

        if (options.shouldNavigateToPlayer ?? true) {
            navigateToPlayer();
        }
        setPlayerState(PlayerState.IDLE);
        setStatusMsg({ type: 'success', text: t('status.localMusicLoaded')});
        void restoreCachedThemeForSong(initialMeta.unifiedSong).catch((error) => {
            console.warn('Theme load error', error);
        });

        void (async () => {
            let prewarmBaseSong = preparedLocalSong;

            try {
                const { updatedLocalSong, matchedSongResult } = await handleLocalSongMatch(preparedLocalSong);
                prewarmBaseSong = updatedLocalSong;
                if (currentSongRef.current !== initialSongKey) return;

                const updatedMeta = await resolveLocalMetadataUI(updatedLocalSong, matchedSongResult);
                setCurrentSong(updatedMeta.unifiedSong);
                setLyrics(updatedMeta.lyrics);
                setIsLyricsLoading(false);

                if (updatedMeta.coverUrl && updatedMeta.coverUrl !== initialMeta.coverUrl) {
                    loadCachedOrFetchCover(`cover_local_${updatedLocalSong.id}`, updatedMeta.coverUrl).then((resolvedCoverUrl) => {
                        if (currentSongRef.current === initialSongKey) {
                            setManagedCachedCoverUrl(resolvedCoverUrl);
                        }
                    });
                } else if (!updatedMeta.coverUrl) {
                    setManagedCachedCoverUrl(null);
                }

                void restoreCachedThemeForSong(updatedMeta.unifiedSong).catch((error) => {
                    console.warn('Theme load error', error);
                });
            } catch (error) {
                console.warn('Local song match pipeline failed:', error);
                if (currentSongRef.current === initialSongKey) {
                    setIsLyricsLoading(false);
                }
            } finally {
                if (currentSongRef.current === initialSongKey) {
                    prewarmNearbyLocalSongs(prewarmBaseSong, queue);
                }
            }
        })();
    }, [
        blobUrlRef,
        currentSongRef,
        currentTime,
        handleLocalSongMatch,
        interruptStagePlaybackForMainTransition,
        navigateToPlayer,
        persistLastPlaybackCache,
        prewarmNearbyLocalSongs,
        restoreCachedThemeForSong,
        resolveLocalMetadataUI,
        setAudioSrc,
        setManagedCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        setStatusMsg,
        shouldAutoPlayRef,
    ]);

    const onPlayNavidromeSong = useCallback(async (
        navidromeSong: NavidromeSong,
        queue: NavidromeSong[] = [],
        options: PlaybackNavigationOptions = {},
    ) => {
        interruptStagePlaybackForMainTransition();

        const shouldNavigateToPlayer = options.shouldNavigateToPlayer ?? true;
        const config = getNavidromeConfig();
        if (!config) {
            setStatusMsg({ type: 'error', text: 'Navidrome not configured' });
            return;
        }

        setIsLyricsLoading(true);

        try {
            const navidromeId = navidromeSong.navidromeData.id;
            const streamUrl = navidromeApi.getStreamUrl(config, navidromeId);
            const serverSongPromise = navidromeApi.getSong(config, navidromeId);
            const matchData = await getFromCacheWithMigration<NavidromeMatchData>(
                `navidrome_match_${navidromeId}`,
                migrateMatchedLyricsCarrierRenderHints,
            );

            let nextLyrics: LyricData | null = null;
            let coverUrl: string | undefined;
            let showedLoadingToast = false;
            if (matchData) {
                if (matchData.lyricsSource === 'online' && matchData.matchedLyrics) {
                    nextLyrics = matchData.matchedLyrics;
                }
                if (matchData.useOnlineCover && matchData.matchedCoverUrl) {
                    coverUrl = matchData.matchedCoverUrl;
                }
            }

            if (!nextLyrics) {
                await hydrateNavidromeLyricPayload(config, navidromeSong);
                nextLyrics = await resolvePreferredNavidromeLyrics(navidromeSong);
            }

            let isAutoMatched = false;
            let autoMatchedLyrics: LyricData | null = null;
            let matchedLyricsSource: SongResult['matchedLyricsSource'] | undefined;
            let matchedLyricsProviderPlatform: SongResult['matchedLyricsProviderPlatform'] | undefined;

            if (!nextLyrics && !matchData?.noAutoMatch && !matchData?.matchedIsPureMusic) {
                try {
                    if (!showedLoadingToast) {
                        setStatusMsg({ type: 'info', text: t('status.loadingSong') || '' });
                        showedLoadingToast = true;
                    }
                    const navidromeMetadata = getProviderSongMetadata(navidromeSong);
                    const artistName = navidromeMetadata.artists.map(artist => artist.name).filter(Boolean).join(', ');
                    const albumName = navidromeMetadata.album?.name || '';
                    const settings = useSettingsUiStore.getState();

                    if (settings.autoUseBestLyric) {
                        const bestMatch = await autoMatchBestLyric(navidromeSong.name, artistName, navidromeMetadata.durationMs, {
                            album: albumName,
                            preferredSource: settings.preferredAlternativeLyricSource,
                        });
                        if (bestMatch?.isPureMusic) {
                            isAutoMatched = true;
                            autoMatchedLyrics = null;
                            (navidromeSong as NavidromeSong & { matchedIsPureMusic?: boolean; }).matchedIsPureMusic = true;
                        } else if (bestMatch && 'lyrics' in bestMatch) {
                            nextLyrics = bestMatch.lyrics;
                            autoMatchedLyrics = bestMatch.lyrics;
                            isAutoMatched = true;
                            matchedLyricsSource = bestMatch.source;
                            matchedLyricsProviderPlatform = bestMatch.matchedLyricsProviderPlatform;

                            const newMatchData: NavidromeMatchData = {
                                matchedLyrics: bestMatch.lyrics,
                                matchedLyricsSource: bestMatch.source,
                                matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                                lyricsSource: 'online',
                                useOnlineLyrics: true,
                            };

                            if (bestMatch.source === 'netease' || (bestMatch.source === 'amll' && bestMatch.matchedLyricsProviderPlatform === 'ncm')) {
                                newMatchData.matchedSongId = bestMatch.id as number;
                                try {
                                    const nSong = await omni.getSongDetail('netease', bestMatch.id);
                                    if (nSong) {
                                        const metadata = getProviderSongMetadata(nSong, 'netease');
                                        newMatchData.matchedArtists = metadata.artists.map(artist => artist.name).join(', ');
                                        newMatchData.matchedAlbumName = metadata.album?.name;
                                        const coverUrl = metadata.coverUrl;
                                        if (coverUrl) {
                                            newMatchData.matchedCoverUrl = coverUrl.replace('http:', 'https:');
                                            newMatchData.useOnlineCover = true;
                                        }
                                    }
                                } catch (err) {
                                    console.error('[NaviPlay] Failed to fetch NetEase song detail for metadata:', err);
                                }
                            }

                            await saveToCache(`navidrome_match_${navidromeId}`, newMatchData);
                        }
                    }

                    if (!isAutoMatched) {
                        const searchQuery = `${navidromeSong.name} ${artistName}`.trim();
                        const searchPage = await omni.searchProviderSongs('netease', searchQuery, { limit: 1, offset: 0 });

                        if (searchPage?.items?.length) {
                            const matchedSong = searchPage.items[0];
                            const lyricResult = await omni.getLyrics(matchedSong);
                            nextLyrics = lyricResult?.lyrics || null;
                            (navidromeSong as NavidromeSong & { matchedIsPureMusic?: boolean; }).matchedIsPureMusic = lyricResult?.isPureMusic || false;
                            if (nextLyrics || lyricResult?.isPureMusic) {
                                autoMatchedLyrics = nextLyrics;
                                isAutoMatched = true;
                                matchedLyricsSource = 'netease';

                            const newMatchData: NavidromeMatchData = {
                                matchedSongId: matchedSong.id,
                                matchedLyrics: nextLyrics || undefined,
                                matchedIsPureMusic: lyricResult?.isPureMusic || false,
                                matchedLyricsSource: 'netease',
                                    lyricsSource: 'online',
                                    useOnlineLyrics: true,
                                };
                                await saveToCache(`navidrome_match_${navidromeId}`, newMatchData);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('[App] Failed to fetch Netease lyrics for Navidrome song:', error);
                }
            }

            const mutableSong = navidromeSong as NavidromeSong & {
                matchedLyrics?: LyricData;
                matchedIsPureMusic?: boolean;
                useOnlineLyrics?: boolean;
                lyricsSource?: string;
                matchedLyricsSource?: SongResult['matchedLyricsSource'];
                matchedLyricsProviderPlatform?: SongResult['matchedLyricsProviderPlatform'];
            };
            if (isAutoMatched) {
                mutableSong.matchedLyrics = autoMatchedLyrics ?? undefined;
                mutableSong.useOnlineLyrics = true;
                mutableSong.lyricsSource = 'online';
                mutableSong.matchedLyricsSource = matchedLyricsSource;
                mutableSong.matchedLyricsProviderPlatform = matchedLyricsProviderPlatform;
            } else {
                mutableSong.matchedLyrics = matchData?.matchedLyrics;
                mutableSong.matchedIsPureMusic = matchData?.matchedIsPureMusic;
                mutableSong.useOnlineLyrics = matchData?.useOnlineLyrics;
                mutableSong.lyricsSource = matchData?.lyricsSource === 'online'
                    ? 'online'
                    : (hasRenderableLyrics(nextLyrics) ? 'navi' : matchData?.lyricsSource);
                mutableSong.matchedLyricsSource = matchData?.matchedLyricsSource;
                mutableSong.matchedLyricsProviderPlatform = matchData?.matchedLyricsProviderPlatform;
            }

            if (!coverUrl) {
                coverUrl = getProviderSongMetadata(navidromeSong).coverUrl || navidromeApi.getCoverArtUrl(config, navidromeId);
            }

            const serverSong = await serverSongPromise;
            if (serverSong?.replayGain) {
                navidromeSong.navidromeData.replayGain = serverSong.replayGain;
            }

            const unifiedSong = buildUnifiedNavidromeSong(navidromeSong, {
                coverUrl,
                useOnlineMetadata: matchData?.useOnlineMetadata,
                matchedArtists: matchData?.matchedArtists,
                matchedAlbumName: matchData?.matchedAlbumName,
                matchedLyricsSource: mutableSong.matchedLyricsSource || matchData?.matchedLyricsSource,
                matchedLyricsProviderPlatform: mutableSong.matchedLyricsProviderPlatform || matchData?.matchedLyricsProviderPlatform,
            });

            shouldAutoPlayRef.current = true;
            currentSongRef.current = getPlaybackSongKey(unifiedSong);
            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            currentTime.set(0);
            setCurrentSong(unifiedSong);
            setManagedCachedCoverUrl(coverUrl ?? null);
            setAudioSrc(streamUrl);
            setIsLyricsLoading(false);

            const finalQueue = options.unifiedQueue
                ? replacePlaybackSongInQueue(options.unifiedQueue, unifiedSong)
                : queue.length > 0
                    ? buildNavidromeQueue(queue, unifiedSong)
                    : [unifiedSong];
            setPlayQueue(finalQueue);
            void persistLastPlaybackCache(unifiedSong, finalQueue);

            if (shouldNavigateToPlayer) {
                navigateToPlayer();
            }
            setPlayerState(PlayerState.IDLE);
            setStatusMsg({ type: 'success', text: t('status.navidromeSongLoaded')});
            void restoreCachedThemeForSong(unifiedSong).catch((error) => {
                console.warn('Theme load error', error);
            });
        } catch (error) {
            console.error('[App] Failed to play Navidrome song:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackFailed')});
            setIsLyricsLoading(false);
        }
    }, [
        currentSongRef,
        currentTime,
        interruptStagePlaybackForMainTransition,
        navigateToPlayer,
        persistLastPlaybackCache,
        restoreCachedThemeForSong,
        setAudioSrc,
        setManagedCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        setStatusMsg,
        shouldAutoPlayRef,
        t,
    ]);

    const onMatchNavidromeSong = useCallback(async () => {
        setStatusMsg({ type: 'info', text: t('navidrome.fetchingLyrics')});
    }, [setStatusMsg, t]);

    const handleUpdateLocalLyrics = useCallback(async (content: string, isTranslation: boolean, fileName?: string) => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = resolveLocalSongRecord(currentSong);
        if (!localData) return;

        const updatedLocalSong = { ...localData };
        if (isTranslation) {
            updatedLocalSong.hasLocalTranslationLyrics = true;
            updatedLocalSong.localTranslationLyricsContent = content;
        } else {
            updatedLocalSong.hasLocalLyrics = true;
            updatedLocalSong.localLyricsContent = content;
            updatedLocalSong.localLyricsFormat = resolveExplicitFileTimedLyricFormat(fileName);
        }

        try {
            const { saveLocalSong } = await import('../services/db');
            await saveLocalSong(updatedLocalSong);
            void onPlayLocalSong(updatedLocalSong, localSongs, { unifiedQueue: playQueue });
            setStatusMsg({ type: 'success', text: isTranslation ? 'Translation lyrics updated' : 'Lyrics updated' });
        } catch (error) {
            console.error('Failed to save local lyrics', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    }, [currentSong, localSongs, onPlayLocalSong, playQueue, resolveLocalSongRecord, setStatusMsg]);

    const handleChangeLyricsSource = useCallback(async (source: 'local' | 'embedded' | 'online') => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = resolveLocalSongRecord(currentSong);
        if (!localData) return;

        const updatedLocalSong = { ...localData, lyricsSource: source };
        try {
            const { saveLocalSong } = await import('../services/db');
            await saveLocalSong(updatedLocalSong);

            let nextLyrics: LyricData | null = null;
            if (source === 'local' && updatedLocalSong.localLyricsContent) {
                nextLyrics = await parseLocalSongLyrics(updatedLocalSong);
            } else if (source === 'embedded' && updatedLocalSong.embeddedLyricsContent) {
                nextLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: updatedLocalSong.embeddedLyricsContent, translationContent: updatedLocalSong.embeddedTranslationLyricsContent });
            } else if (source === 'online' && updatedLocalSong.matchedLyrics) {
                nextLyrics = updatedLocalSong.matchedLyrics;
            }

            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            setCurrentSong(prev => {
                if (!prev || !isSamePlaybackSong(prev, currentSong)) return prev;
                return { ...prev };
            });
            await loadLocalSongs();
            setStatusMsg({ type: 'success', text: t('status.lyricsSourceSwitched')});
        } catch (error) {
            console.error('Failed to save lyrics source', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    }, [currentSong, loadLocalSongs, resolveLocalSongRecord, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleManualMatchOnline = useCallback(() => {
        setIsPanelOpen(false);
        if (currentSong && (currentSong as SongResult & { isNavidrome?: boolean; }).isNavidrome) {
            setShowNaviLyricMatchModal(true);
            return;
        }
        if (isLocalPlaybackSong(currentSong)) {
            setShowLyricMatchModal(true);
        }
    }, [currentSong, setIsPanelOpen]);

    const handleMatchOnlineLyrics = useCallback(() => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        setIsPanelOpen(false);
        setShowOnlineLyricMatchModal(true);
    }, [currentSong, setIsPanelOpen]);

    const handleLyricMatchComplete = useCallback(async () => {
        setShowLyricMatchModal(false);
        if (!isLocalPlaybackSong(currentSong)) return;

        await loadLocalSongs();
        const updatedList = await getLocalSongs();
        const found = updatedList.find(song => song.id === currentSong.localRef.songId);
        if (found) {
            await onPlayLocalSong(found, localSongs, { unifiedQueue: playQueue });
            setStatusMsg({ type: 'success', text: t('status.matchSuccessful') || 'Match successful' });
        }
    }, [currentSong, loadLocalSongs, localSongs, onPlayLocalSong, playQueue, setStatusMsg]);

    const handleNaviLyricMatchComplete = useCallback(async () => {
        setShowNaviLyricMatchModal(false);
        if (currentSong && (currentSong as SongResult & { isNavidrome?: boolean; }).isNavidrome) {
            const navidromeQueue = playQueue
                .map(song => (song as SongResult & { navidromeData?: NavidromeSong; }).navidromeData)
                .filter((song): song is NavidromeSong => Boolean(song?.isNavidrome));
            await onPlayNavidromeSong(
                (currentSong as SongResult & { navidromeData: NavidromeSong; }).navidromeData,
                navidromeQueue,
                { unifiedQueue: playQueue },
            );
            setStatusMsg({ type: 'success', text: t('status.matchSuccessful') || 'Match successful' });
        }
    }, [currentSong, onPlayNavidromeSong, playQueue, setStatusMsg]);

    const handleImportOnlineLyrics = useCallback(async (content: string, fileName: string) => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        try {
            const importedLyrics = fileName.toLowerCase().endsWith('.txt')
                ? await LyricParserFactory.parse({ type: 'embedded', textContent: content })
                : await LyricParserFactory.parse({
                    type: 'local',
                    lrcContent: content,
                    formatHint: resolveExplicitFileTimedLyricFormat(fileName),
                });
            const previousState = await loadOnlineLyricsState(currentSong);
            const nextState: OnlineLyricsState = {
                lyricsSource: 'imported',
                importedLyrics,
                importedLyricsName: fileName,
                hasOnlineOverride: previousState?.hasOnlineOverride ?? false,
                onlineOverrideLyrics: previousState?.onlineOverrideLyrics ?? null,
                matchedSongId: previousState?.matchedSongId,
                matchedIsPureMusic: previousState?.matchedIsPureMusic,
                matchedLyricsSource: previousState?.matchedLyricsSource,
                matchedLyricsProviderPlatform: previousState?.matchedLyricsProviderPlatform,
            };
            await saveOnlineLyricsState(currentSong, nextState);

            const updatedSong = { ...currentSong, onlineLyricsState: nextState };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(importedLyrics);
            setCurrentLineIndex(-1);
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: 'Lyrics updated' });
        } catch (error) {
            console.error('Failed to import online lyrics', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    }, [currentSong, persistLastPlaybackCache, playQueue, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleChangeOnlineLyricsSource = useCallback(async (source: 'online' | 'imported') => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        const previousState = await loadOnlineLyricsState(currentSong);
        const nextState: OnlineLyricsState = {
            lyricsSource: source,
            importedLyrics: previousState?.importedLyrics ?? null,
            importedLyricsName: previousState?.importedLyricsName ?? null,
            hasOnlineOverride: previousState?.hasOnlineOverride ?? false,
            onlineOverrideLyrics: previousState?.onlineOverrideLyrics ?? null,
            matchedSongId: previousState?.matchedSongId,
            matchedIsPureMusic: previousState?.matchedIsPureMusic,
            matchedLyricsSource: previousState?.matchedLyricsSource,
            matchedLyricsProviderPlatform: previousState?.matchedLyricsProviderPlatform,
        };

        if (source === 'imported' && !nextState.importedLyrics) {
            return;
        }

        try {
            await saveOnlineLyricsState(currentSong, nextState);
            const baseLyrics = await loadBaseOnlineLyrics(currentSong, lyrics);
            const nextLyrics = resolveOnlineLyrics(nextState, baseLyrics);
            const updatedSong = { ...currentSong, onlineLyricsState: nextState };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: t('status.lyricsSourceSwitched') || '' });
        } catch (error) {
            console.error('Failed to switch online lyrics source', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    }, [currentSong, loadBaseOnlineLyrics, lyrics, persistLastPlaybackCache, playQueue, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleOnlineLyricMatchComplete = useCallback(async () => {
        setShowOnlineLyricMatchModal(false);
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        const resolved = await resolveOnlineSongLyricsState(currentSong, lyrics);
        const updatedSong = {
            ...currentSong,
            onlineLyricsState: resolved.state ?? undefined,
            isPureMusic: resolved.state?.lyricsSource === 'online' && typeof resolved.state.matchedIsPureMusic === 'boolean'
                ? resolved.state.matchedIsPureMusic
                : currentSong.isPureMusic,
        };
        setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
        setLyrics(resolved.lyrics);
        setCurrentLineIndex(-1);
        await persistLastPlaybackCache(updatedSong, playQueue);
        setStatusMsg({ type: 'success', text: t('status.matchSuccessful') || 'Match successful' });
    }, [currentSong, lyrics, persistLastPlaybackCache, playQueue, resolveOnlineSongLyricsState, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleClearOnlineLyricsState = useCallback(async () => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        try {
            const key = getOnlineLyricsStateCacheKey(currentSong);
            await removeFromCache(key);

            const resolved = await resolveOnlineSongLyricsState(currentSong, null);
            const updatedSong = {
                ...currentSong,
                onlineLyricsState: undefined,
            };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(resolved.lyrics);
            setCurrentLineIndex(-1);
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: t('status.clearedManualLyrics') || '' });
        } catch (error) {
            console.error('Failed to clear online lyrics state', error);
            setStatusMsg({ type: 'error', text: t('status.clearFailed') || '' });
        }
    }, [currentSong, persistLastPlaybackCache, playQueue, resolveOnlineSongLyricsState, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleHomeMatchSong = useCallback(async (song: LocalSong) => {
        await loadLocalSongs();

        if (isLocalPlaybackSong(currentSong)) {
            const currentLocalData = resolveLocalSongRecord(currentSong);
            if (currentLocalData && currentLocalData.id === song.id) {
                const updatedSongs = await getLocalSongs();
                const updatedSong = updatedSongs.find(item => item.id === song.id);

                if (updatedSong) {
                    const resolvedUi = await resolveLocalMetadataUI(updatedSong, null);
                    setCurrentSong(resolvedUi.unifiedSong);

                    if (updatedSong.useOnlineCover && updatedSong.onlineMetadata?.coverUrl) {
                        try {
                            const resolvedCoverUrl = await loadCachedOrFetchCover(`cover_local_${updatedSong.id}`, updatedSong.onlineMetadata.coverUrl);
                            setManagedCachedCoverUrl(resolvedCoverUrl || updatedSong.onlineMetadata.coverUrl);
                        } catch (error) {
                            console.warn('Failed to cache updated cover:', error);
                            setManagedCachedCoverUrl(updatedSong.onlineMetadata.coverUrl);
                        }
                    } else {
                        setManagedCachedCoverUrl(resolvedUi.coverUrl);
                    }

                    setLyrics(resolvedUi.lyrics);
                }
            }
        }
    }, [currentSong, loadLocalSongs, resolveLocalMetadataUI, resolveLocalSongRecord, setCurrentSong, setLyrics, setManagedCachedCoverUrl]);

    const handleAutoMatchBestLyricForCurrentSong = useCallback(async (): Promise<boolean> => {
        if (!currentSong) {
            setStatusMsg({ type: 'info', text: t('status.noSongPlaying') || '' });
            return false;
        }

        if (isStagePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: t('status.stageActionUnavailable') || '' });
            return false;
        }

        const settings = useSettingsUiStore.getState();
        setStatusMsg({ type: 'info', text: t('status.matchingBestLyrics') || '' });

        try {
            if (isLocalPlaybackSong(currentSong)) {
                const localData = resolveLocalSongRecord(currentSong);
                if (!localData) return false;
                const catalog = await getLocalLibraryCatalogSnapshot();
                const resolvedMetadata = resolveLocalSongMetadata(localData.id, catalog);
                const matchContext = buildLocalSongLyricMatchContext(localData, {
                    artistNames: resolvedMetadata.artists.map(artist => artist.name),
                    albumName: resolvedMetadata.album?.name,
                });
                const bestMatch = await autoMatchBestLyric(matchContext.title, matchContext.artist, matchContext.durationMs, {
                    album: matchContext.album,
                    preferredSource: settings.preferredAlternativeLyricSource,
                    metadataCandidate: matchContext.metadataCandidate,
                });

                if (!bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsNotFound') || '' });
                    return false;
                }
                if ('isPureMusic' in bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsPureMusic') || '' });
                    return false;
                }

                const updatedLocalSong: LocalSong = {
                    ...localData,
                    matchedLyrics: bestMatch.lyrics,
                    matchedLyricsSongId: bestMatch.id,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                    matchedIsPureMusic: false,
                    lyricsSource: 'online',
                };
                await applyMatchedMetadata(localData.id, {}, {
                    lyricsOnly: true,
                    songPatch: updatedLocalSong,
                });
                const updatedSong = { ...currentSong };
                setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
                setLyrics(bestMatch.lyrics);
                setCurrentLineIndex(-1);
                await persistLastPlaybackCache(updatedSong, playQueue);
                setStatusMsg({ type: 'success', text: t('status.bestLyricsMatched') || '' });
                return true;
            }

            if (isNavidromePlaybackSong(currentSong)) {
                const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
                if (!navidromeSong) {                        setStatusMsg({ type: 'error', text: t('status.bestLyricsMatchFailed') || '' });
                    return false;
                }

                const navidromeMetadata = getProviderSongMetadata(navidromeSong);
                const artistName = navidromeMetadata.artists.map(artist => artist.name).filter(Boolean).join(', ');
                const albumName = navidromeMetadata.album?.name || '';
                const bestMatch = await autoMatchBestLyric(navidromeSong.name, artistName, navidromeMetadata.durationMs, {
                    album: albumName,
                    preferredSource: settings.preferredAlternativeLyricSource,
                });

                if (!bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsNotFound') || '' });
                    return false;
                }
                if ('isPureMusic' in bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsPureMusic') || '' });
                    return false;
                }

                const matchData: NavidromeMatchData = {
                    matchedLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                    lyricsSource: 'online',
                    useOnlineLyrics: true,
                    matchedSongId: bestMatch.source === 'netease' || (bestMatch.source === 'amll' && bestMatch.matchedLyricsProviderPlatform === 'ncm')
                        ? bestMatch.id as number
                        : undefined,
                    matchedIsPureMusic: false,
                };
                await saveToCache(`navidrome_match_${navidromeSong.navidromeData.id}`, matchData);

                const updatedSong = {
                    ...currentSong,
                    matchedLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                    matchedIsPureMusic: false,
                    lyricsSource: 'online' as const,
                    useOnlineLyrics: true,
                };
                setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
                setLyrics(bestMatch.lyrics);
                setCurrentLineIndex(-1);
                await persistLastPlaybackCache(updatedSong, playQueue);
                setStatusMsg({ type: 'success', text: t('status.bestLyricsMatched') || '' });
                return true;
            }

            const currentSongMetadata = getProviderSongMetadata(currentSong);
            const artistName = currentSongMetadata.artists.map(artist => artist.name).filter(Boolean).join(', ');
            const albumName = currentSongMetadata.album?.name || '';
            const sourceRef = getPlaybackSourceRef(currentSong);
            const ownLyricsResult = await omni.getLyrics(currentSong);
            const bestMatch = await autoMatchBestLyric(currentSong.name, artistName, currentSongMetadata.durationMs, {
                album: albumName,
                preferredSource: settings.preferredAlternativeLyricSource,
                providerCandidate: sourceRef.kind === 'online'
                    && (sourceRef.providerId === 'netease' || sourceRef.providerId === 'kugou')
                    ? { providerId: sourceRef.providerId as 'netease' | 'kugou', song: currentSong, lyricsResult: ownLyricsResult }
                    : undefined,
            });

            if (!bestMatch) {
                setStatusMsg({ type: 'info', text: t('status.bestLyricsNotFound') || '' });
                return false;
            }
            if ('isPureMusic' in bestMatch) {                    setStatusMsg({ type: 'info', text: t('status.bestLyricsPureMusic') });
                return false;
            }

            const previousState = await loadOnlineLyricsState(currentSong);
            const usesOwnProviderLyrics = sourceRef.kind === 'online' && bestMatch.source === sourceRef.providerId;
            const nextState: OnlineLyricsState = {
                lyricsSource: 'online',
                importedLyrics: previousState?.importedLyrics ?? null,
                importedLyricsName: previousState?.importedLyricsName ?? null,
                hasOnlineOverride: !usesOwnProviderLyrics,
                onlineOverrideLyrics: usesOwnProviderLyrics ? null : bestMatch.lyrics,
                matchedSongId: bestMatch.id,
                matchedIsPureMusic: false,
                matchedLyricsSource: bestMatch.source,
                matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
            };
            await saveOnlineLyricsState(currentSong, nextState);

            const updatedSong = { ...currentSong, onlineLyricsState: nextState, isPureMusic: false };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(bestMatch.lyrics);
            setCurrentLineIndex(-1);
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: t('status.bestLyricsMatched') || '' });
            return true;
        } catch (error) {
            console.error('[CommandPalette] Failed to auto-match best lyric:', error);
            setStatusMsg({ type: 'error', text: t('status.bestLyricsMatchFailed') || '' });
            return false;
        }
    }, [
        currentSong,
        persistLastPlaybackCache,
        playQueue,
        resolveLocalSongRecord,
        setCurrentLineIndex,
        setCurrentSong,
        setLyrics,
        setStatusMsg,
        t,
    ]);

    const handleLike = useCallback(async () => {
        if (!currentSong) return;

        if (isStagePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: t('status.stageLikeUnavailable') || '' });
            return;
        }

        const localSong = resolveLocalSongRecord(currentSong);
        if (isLocalPlaybackSong(currentSong) && localSong) {
            const nextLiked = !isLocalSongLiked(currentSong);
            try {
                await setLocalSongFavorite(localSong, nextLiked);
                await loadLocalPlaylists();
                setStatusMsg({ type: 'success', text: nextLiked ? t('status.liked') : (t('status.unliked') || '') });
            } catch (error) {
                console.error('Failed to update local favorite playlist', error);
                setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            }
            return;
        }

        if (isNavidromePlaybackSong(currentSong)) {
            const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
            if (!navidromeSong) return;

            const config = getNavidromeConfig();
            if (!config) {
                setStatusMsg({ type: 'error', text: t('navidrome.notConfigured') || '' });
                return;
            }

            const songId = navidromeSong.navidromeData.id;
            const nextStarred = !starredNavidromeSongIds.has(songId);

            try {
                const success = nextStarred
                    ? await navidromeApi.star(config, songId)
                    : await navidromeApi.unstar(config, songId);

                if (success) {
                    setStarredNavidromeSongIds(prev => {
                        const next = new Set(prev);
                        if (nextStarred) next.add(songId);
                        else next.delete(songId);
                        return next;
                    });
                    setStatusMsg({
                        type: 'success',
                        text: nextStarred ? t('status.liked') : (t('status.unliked') || ''),
                    });
                } else {
                    setStatusMsg({ type: 'error', text: t('status.likeFailed') || '' });
                }
            } catch (error) {
                console.error('[Navidrome Favorite] Failed to toggle favorite:', error);
                setStatusMsg({ type: 'error', text: t('status.likeFailed') || '' });
            }
            return;
        }

        const sourceRef = getPlaybackSourceRef(currentSong);
        if (sourceRef.kind !== 'online') {
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            return;
        }
        try {
            const nextLiked = await omni.toggleSongLike(currentSong, likedSongIds);
            if (sourceRef.providerId === 'netease') {
                setLikedSongIds(prev => {
                    const next = new Set(prev);
                    for (const id of next) {
                        if (String(id) === String(sourceRef.mediaId)) next.delete(id);
                    }
                    if (nextLiked) next.add(sourceRef.mediaId);
                    return next;
                });
            }
            setStatusMsg({ type: 'success', text: nextLiked ? t('status.liked') : t('status.unliked') || 'Removed from Liked' });
        } catch (error) {
            console.error('Like failed', error);
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
        }
    }, [
        currentSong,
        isLocalSongLiked,
        likedSongIds,
        starredNavidromeSongIds,
        loadLocalPlaylists,
        setLikedSongIds,
        setStarredNavidromeSongIds,
        setStatusMsg,
        t,
    ]);

    return {
        localSongs,
        localPlaylists,
        showLyricMatchModal,
        setShowLyricMatchModal,
        showNaviLyricMatchModal,
        setShowNaviLyricMatchModal,
        showOnlineLyricMatchModal,
        setShowOnlineLyricMatchModal,
        loadLocalSongs,
        loadLocalPlaylists,
        onRefreshLocalSongs,
        getFavoriteLocalPlaylist,
        isLocalSongLiked,
        saveCurrentQueueAsLocalPlaylist,
        addCurrentSongToLocalPlaylist,
        createCurrentLocalPlaylist,
        addCurrentSongToOnlinePlaylist,
        addCurrentSongToNavidromePlaylist,
        createCurrentNavidromePlaylist,
        resolveLocalMetadataUI,
        loadCurrentSongLyricPreview,
        handleLocalQueueAdd,
        onPlayLocalSong,
        onPlayNavidromeSong,
        onMatchNavidromeSong,
        handleUpdateLocalLyrics,
        handleChangeLyricsSource,
        handleManualMatchOnline,
        handleImportOnlineLyrics,
        handleChangeOnlineLyricsSource,
        handleMatchOnlineLyrics,
        handleLyricMatchComplete,
        handleNaviLyricMatchComplete,
        handleOnlineLyricMatchComplete,
        handleClearOnlineLyricsState,
        handleHomeMatchSong,
        handleAutoMatchBestLyricForCurrentSong,
        handleLike,
    };
}
