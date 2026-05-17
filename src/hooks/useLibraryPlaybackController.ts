import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { getFromCacheWithMigration, getLocalSongs, removeFromCache } from '../services/db';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../services/coverCache';
import { ensureLocalSongEmbeddedCover, getAudioFromLocalSong } from '../services/localMusicService';
import { addSongsToLocalPlaylist, createLocalPlaylist, getLocalPlaylists, setLocalSongFavorite } from '../services/localPlaylistService';
import { buildLocalQueue, buildNavidromeQueue, buildUnifiedLocalSong, buildUnifiedNavidromeSong } from '../services/playbackAdapters';
import { getPrefetchedData } from '../services/prefetchService';
import { extractCloudLyricText, hasRenderableLyrics } from '../utils/appPlaybackHelpers';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong, resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../utils/appNavidromeLyrics';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { migrateMatchedLyricsCarrierRenderHints } from '../utils/lyrics/storageMigration';
import { processNeteaseLyrics } from '../utils/lyrics/neteaseProcessing';
import { getOnlineSongCacheKey, isCloudSong, neteaseApi } from '../services/netease';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { PlayerState } from '../types';
import type { LyricData, LocalPlaylist, LocalSong, SongResult, StatusMessage } from '../types';
import type { PlaybackSnapshot, PlaybackNavigationOptions } from '../types/appPlayback';
import type { NavidromeSong } from '../types/navidrome';
import type { NavidromeMatchData } from '../components/modal/NaviLyricMatchModal';

// src/hooks/useLibraryPlaybackController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseLibraryPlaybackControllerParams = {
    t: (key: string, fallback?: string) => string;
    audioQuality: string;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    playQueue: SongResult[];
    likedSongIds: Set<number>;
    userId?: number;
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
    setLikedSongIds: Dispatch<SetStateAction<Set<number>>>;
    navigateToPlayer: () => void;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    restoreCachedThemeForSong: (songId: number, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    interruptStagePlaybackForMainTransition: () => PlaybackSnapshot | null;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    currentSongRef: MutableRefObject<number | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
};

// Owns local and Navidrome playback helpers so App.tsx can stay focused on assembly.
export function useLibraryPlaybackController({
    t,
    audioQuality,
    currentSong,
    lyrics,
    playQueue,
    likedSongIds,
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
        await loadLocalSongs();
        await loadLocalPlaylists();
    }, [loadLocalPlaylists, loadLocalSongs]);

    const getFavoriteLocalPlaylist = useMemo(
        () => localPlaylists.find(playlist => playlist.isFavorite) ?? null,
        [localPlaylists],
    );

    const isLocalSongLiked = useCallback((song: SongResult | null) => {
        if (!song || !isLocalPlaybackSong(song) || !song.localData || !getFavoriteLocalPlaylist) {
            return false;
        }

        return getFavoriteLocalPlaylist.songIds.includes(song.localData.id);
    }, [getFavoriteLocalPlaylist]);

    const saveCurrentQueueAsLocalPlaylist = useCallback(async (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        const queueSongs = playQueue
            .map(song => (song as SongResult & { localData?: LocalSong }).localData)
            .filter((song): song is LocalSong => Boolean(song?.id));

        if (!queueSongs.length) {
            throw new Error('No local songs in queue');
        }

        await createLocalPlaylist(trimmedName, queueSongs);
        await loadLocalPlaylists();
    }, [loadLocalPlaylists, playQueue]);

    const addCurrentSongToLocalPlaylist = useCallback(async (playlistId: string) => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            throw new Error('Current song is not local');
        }

        await addSongsToLocalPlaylist(playlistId, [currentSong.localData]);
        await loadLocalPlaylists();
    }, [currentSong, loadLocalPlaylists]);

    const createCurrentLocalPlaylist = useCallback(async (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            throw new Error('Current song is not local');
        }

        await createLocalPlaylist(trimmedName, [currentSong.localData]);
        await loadLocalPlaylists();
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '歌单已更新' });
    }, [currentSong, loadLocalPlaylists, setStatusMsg, t]);

    const addCurrentSongToNeteasePlaylist = useCallback(async (playlistId: number) => {
        if (!currentSong || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            throw new Error('Current song is not a Netease song');
        }

        await neteaseApi.updatePlaylistTracks('add', playlistId, [currentSong.id]);
        await removeFromCache(`playlist_tracks_${playlistId}`);
        await removeFromCache(`playlist_detail_${playlistId}`);
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '歌单已更新' });
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
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '歌单已更新' });
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
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '歌单已更新' });
    }, [currentSong, setStatusMsg, t]);

    const handleLocalSongMatch = useCallback(async (localSong: LocalSong): Promise<{ updatedLocalSong: LocalSong; matchedSongResult: SongResult | null; }> => {
        let updatedLocalSong = localSong;
        let matchedSongResult: SongResult | null = null;
        const needsLyricsMatch = !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics && !localSong.matchedLyrics;
        const needsCoverMatch = !localSong.embeddedCover && !localSong.matchedCoverUrl;

        if ((needsLyricsMatch || needsCoverMatch) && !localSong.noAutoMatch) {
            setStatusMsg({ type: 'info', text: '正在匹配歌词和封面...' });
            try {
                const { matchLyrics } = await import('../services/localMusicService');
                await matchLyrics(localSong);
                const updatedSongs = await getLocalSongs();
                const found = updatedSongs.find(song => song.id === localSong.id);

                if (found) {
                    updatedLocalSong = found;
                    if (found.matchedSongId) {
                        try {
                            const searchRes = await neteaseApi.cloudSearch(
                                localSong.artist ? `${localSong.artist} ${localSong.title}` : localSong.title || localSong.fileName,
                            );
                            if (searchRes.result?.songs) {
                                matchedSongResult = searchRes.result.songs.find(song => song.id === found.matchedSongId) || searchRes.result.songs[0];
                            }
                        } catch (error) {
                            console.warn('Failed to get matched song details:', error);
                        }
                    }
                }
            } catch (error) {
                console.warn('Auto-match failed:', error);
            }
            await loadLocalSongs();
        }

        return { updatedLocalSong, matchedSongResult };
    }, [loadLocalSongs, setStatusMsg]);

    const resolveLocalMetadataUI = useCallback(async (localData: LocalSong, matchedSong: SongResult | null) => {
        const embeddedCoverUrl = localData.embeddedCover ? URL.createObjectURL(localData.embeddedCover) : null;
        const preferOnlineCover = localData.useOnlineCover === true;
        const preferOnlineMetadata = localData.useOnlineMetadata === true;
        const coverUrl = preferOnlineCover
            ? (localData.matchedCoverUrl || embeddedCoverUrl || null)
            : (embeddedCoverUrl || localData.matchedCoverUrl || null);

        let nextLyrics: LyricData | null = null;
        const source = localData.lyricsSource;
        if (source === 'online' && localData.matchedLyrics) {
            nextLyrics = localData.matchedLyrics;
        } else if (source === 'embedded' && localData.embeddedLyricsContent) {
            nextLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
        } else if (source === 'local' && localData.localLyricsContent) {
            nextLyrics = await LyricParserFactory.parse({ type: 'local', lrcContent: localData.localLyricsContent, tLrcContent: localData.localTranslationLyricsContent });
        } else if (!source) {
            if (localData.hasLocalLyrics && localData.localLyricsContent) {
                nextLyrics = await LyricParserFactory.parse({ type: 'local', lrcContent: localData.localLyricsContent, tLrcContent: localData.localTranslationLyricsContent });
            } else if (localData.hasEmbeddedLyrics && localData.embeddedLyricsContent) {
                nextLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
            } else if (localData.matchedLyrics) {
                nextLyrics = localData.matchedLyrics;
            }
        }

        const unifiedSong = buildUnifiedLocalSong({
            localSong: localData,
            matchedSong,
            coverUrl,
            preferOnlineMetadata,
        });

        return { lyrics: nextLyrics, coverUrl, unifiedSong };
    }, []);

    const loadCurrentSongLyricPreview = useCallback(async (): Promise<LyricData | null> => {
        if (!currentSong) {
            return null;
        }

        if (isLocalPlaybackSong(currentSong) && currentSong.localData) {
            const localData = currentSong.localData;
            const source = localData.lyricsSource;

            if (source === 'online' && localData.matchedLyrics) return localData.matchedLyrics;
            if (source === 'embedded' && localData.embeddedLyricsContent) {
                return LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
            }
            if (source === 'local' && localData.localLyricsContent) {
                return LyricParserFactory.parse({ type: 'local', lrcContent: localData.localLyricsContent, tLrcContent: localData.localTranslationLyricsContent });
            }
            if (!source) {
                if (localData.hasLocalLyrics && localData.localLyricsContent) {
                    return LyricParserFactory.parse({ type: 'local', lrcContent: localData.localLyricsContent, tLrcContent: localData.localTranslationLyricsContent });
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

            if ((navidromeSong as NavidromeSong & { lyricsSource?: string; matchedLyrics?: LyricData }).lyricsSource === 'online' && (navidromeSong as NavidromeSong & { matchedLyrics?: LyricData }).matchedLyrics) {
                return (navidromeSong as NavidromeSong & { matchedLyrics?: LyricData }).matchedLyrics ?? null;
            }

            let resolved = await resolvePreferredNavidromeLyrics(navidromeSong);
            if (resolved) return resolved;

            const config = getNavidromeConfig();
            if (config) {
                await hydrateNavidromeLyricPayload(config, navidromeSong);
                resolved = await resolvePreferredNavidromeLyrics(navidromeSong);
                if (resolved) return resolved;
            }

            return lyrics;
        }

        const onlineSong = currentSong;
        const cachedLyrics = await getFromCacheWithMigration<LyricData>(getOnlineSongCacheKey('lyric', onlineSong), migrateLyricDataRenderHints);
        if (cachedLyrics) return cachedLyrics;

        const prefetched = getPrefetchedData(onlineSong, audioQuality);
        if (prefetched?.lyrics) return prefetched.lyrics;

        if (isCloudSong(onlineSong) && userId) {
            const lyricRes = await neteaseApi.getCloudLyric(userId, onlineSong.id);
            const mainLrc = extractCloudLyricText(lyricRes);
            if (!mainLrc || isPureMusicLyricText(mainLrc)) {
                return null;
            }
            return LyricParserFactory.parse({ type: 'local', lrcContent: mainLrc });
        }

        const lyricRes = await neteaseApi.getLyric(onlineSong.id);
        return (await processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricRes))).lyrics;
    }, [audioQuality, currentSong, lyrics, userId]);

    const handleLocalQueueAdd = useCallback(async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        const { unifiedSong } = await resolveLocalMetadataUI(preparedLocalSong, null);
        const exists = playQueue.some(song => song.id === unifiedSong.id);
        const nextQueue = exists ? playQueue : [...playQueue, unifiedSong];

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);
        setStatusMsg({ type: 'success', text: t('status.queueUpdated') || '已添加到播放队列' });
    }, [currentSong, persistLastPlaybackCache, playQueue, resolveLocalMetadataUI, setPlayQueue, setStatusMsg, t]);

    const prewarmLocalSongMetadata = useCallback(async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        Object.assign(localSong, preparedLocalSong);

        const needsLyricsMatch = !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics && !localSong.matchedLyrics;
        const needsCoverMatch = !localSong.embeddedCover && !localSong.matchedCoverUrl;
        if ((needsLyricsMatch || needsCoverMatch) && !localSong.noAutoMatch) {
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

    const onPlayLocalSong = useCallback(async (localSong: LocalSong, queue: LocalSong[] = []) => {
        interruptStagePlaybackForMainTransition();

        const blobUrl = await getAudioFromLocalSong(localSong);
        if (!blobUrl) {
            setStatusMsg({ type: 'error', text: '无法访问文件，请重新导入文件夹' });
            return;
        }

        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        const initialMeta = await resolveLocalMetadataUI(preparedLocalSong, null);

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = blobUrl;

        shouldAutoPlayRef.current = true;
        currentSongRef.current = initialMeta.unifiedSong.id;
        setLyrics(initialMeta.lyrics);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setCurrentSong(initialMeta.unifiedSong);
        setAudioSrc(blobUrl);

        if (initialMeta.coverUrl) {
            loadCachedOrFetchCover(`cover_local_${preparedLocalSong.id}`, initialMeta.coverUrl).then((resolvedCoverUrl) => {
                if (currentSongRef.current === initialMeta.unifiedSong.id) {
                    setCachedCoverUrl(resolvedCoverUrl);
                }
            });
        } else {
            setCachedCoverUrl(null);
        }

        setIsLyricsLoading(true);

        if (queue.length > 0) {
            const finalQueue = buildLocalQueue(queue, initialMeta.unifiedSong);
            setPlayQueue(finalQueue);
            void persistLastPlaybackCache(initialMeta.unifiedSong, finalQueue);
        } else {
            setPlayQueue([initialMeta.unifiedSong]);
            void persistLastPlaybackCache(initialMeta.unifiedSong, [initialMeta.unifiedSong]);
        }

        navigateToPlayer();
        setPlayerState(PlayerState.IDLE);
        setStatusMsg({ type: 'success', text: '本地音乐已加载' });
        prewarmNearbyLocalSongs(preparedLocalSong, queue);

        handleLocalSongMatch(preparedLocalSong).then(async ({ updatedLocalSong, matchedSongResult }) => {
            if (currentSongRef.current !== initialMeta.unifiedSong.id) return;

            const updatedMeta = await resolveLocalMetadataUI(updatedLocalSong, matchedSongResult);
            setCurrentSong(updatedMeta.unifiedSong);
            setLyrics(updatedMeta.lyrics);
            setIsLyricsLoading(false);

            if (updatedMeta.coverUrl && updatedMeta.coverUrl !== initialMeta.coverUrl) {
                loadCachedOrFetchCover(`cover_local_${updatedLocalSong.id}`, updatedMeta.coverUrl).then((resolvedCoverUrl) => {
                    if (currentSongRef.current === updatedMeta.unifiedSong.id) {
                        setCachedCoverUrl(resolvedCoverUrl);
                    }
                });
            } else if (!updatedMeta.coverUrl) {
                setCachedCoverUrl(null);
            }
        });
    }, [
        blobUrlRef,
        currentSongRef,
        currentTime,
        handleLocalSongMatch,
        interruptStagePlaybackForMainTransition,
        navigateToPlayer,
        persistLastPlaybackCache,
        prewarmNearbyLocalSongs,
        resolveLocalMetadataUI,
        setAudioSrc,
        setCachedCoverUrl,
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
                nextLyrics = await resolvePreferredNavidromeLyrics(navidromeSong);
            }

            if (!nextLyrics) {
                if (!showedLoadingToast) {
                    setStatusMsg({ type: 'info', text: t('status.loadingSong') || '加载歌曲中...' });
                    showedLoadingToast = true;
                }
                await hydrateNavidromeLyricPayload(config, navidromeSong);
                nextLyrics = await resolvePreferredNavidromeLyrics(navidromeSong);
            }

            let isAutoMatched = false;
            let autoMatchedLyrics: LyricData | null = null;
            if (!nextLyrics && !matchData?.noAutoMatch) {
                try {
                    if (!showedLoadingToast) {
                        setStatusMsg({ type: 'info', text: t('status.loadingSong') || '加载歌曲中...' });
                        showedLoadingToast = true;
                    }
                    const artistName = navidromeSong.artists?.[0]?.name || navidromeSong.ar?.[0]?.name || '';
                    const searchQuery = `${navidromeSong.name} ${artistName}`.trim();
                    const searchRes = await neteaseApi.cloudSearch(searchQuery, 1);

                    if (searchRes.result?.songs?.length) {
                        const matchedSong = searchRes.result.songs[0];
                        const lyricRes = await neteaseApi.getLyric(matchedSong.id);
                        const processed = await processNeteaseLyrics({ type: 'netease', ...lyricRes });
                        nextLyrics = processed.lyrics;
                        (navidromeSong as NavidromeSong & { matchedIsPureMusic?: boolean }).matchedIsPureMusic = processed.isPureMusic;
                        if (nextLyrics || processed.isPureMusic) {
                            autoMatchedLyrics = nextLyrics;
                            isAutoMatched = true;
                        }
                    }
                } catch (error) {
                    console.warn('[App] Failed to fetch Netease lyrics for Navidrome song:', error);
                }
            }

            const mutableSong = navidromeSong as NavidromeSong & {
                matchedLyrics?: LyricData | null;
                matchedIsPureMusic?: boolean;
                useOnlineLyrics?: boolean;
                lyricsSource?: string;
            };
            if (isAutoMatched) {
                mutableSong.matchedLyrics = autoMatchedLyrics;
                mutableSong.useOnlineLyrics = true;
                mutableSong.lyricsSource = 'online';
            } else {
                mutableSong.matchedLyrics = matchData?.matchedLyrics ?? null;
                mutableSong.matchedIsPureMusic = matchData?.matchedIsPureMusic;
                mutableSong.useOnlineLyrics = matchData?.useOnlineLyrics;
                mutableSong.lyricsSource = matchData?.lyricsSource === 'online'
                    ? 'online'
                    : (hasRenderableLyrics(nextLyrics) ? 'navi' : matchData?.lyricsSource);
            }

            if (!coverUrl) {
                coverUrl = navidromeSong.album?.picUrl || navidromeSong.al?.picUrl || navidromeApi.getCoverArtUrl(config, navidromeId);
            }

            const unifiedSong = buildUnifiedNavidromeSong(navidromeSong, {
                coverUrl,
                useOnlineMetadata: matchData?.useOnlineMetadata,
                matchedArtists: matchData?.matchedArtists,
                matchedAlbumName: matchData?.matchedAlbumName,
            });

            shouldAutoPlayRef.current = true;
            currentSongRef.current = unifiedSong.id;
            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            currentTime.set(0);
            setCurrentSong(unifiedSong);
            setCachedCoverUrl(coverUrl);
            setAudioSrc(streamUrl);
            setIsLyricsLoading(false);

            if (queue.length > 0) {
                const finalQueue = buildNavidromeQueue(queue, unifiedSong);
                setPlayQueue(finalQueue);
                void persistLastPlaybackCache(unifiedSong, finalQueue);
            } else {
                setPlayQueue([unifiedSong]);
                void persistLastPlaybackCache(unifiedSong, [unifiedSong]);
            }

            if (shouldNavigateToPlayer) {
                navigateToPlayer();
            }
            setPlayerState(PlayerState.IDLE);
            setStatusMsg({ type: 'success', text: 'Navidrome 歌曲已加载' });
        } catch (error) {
            console.error('[App] Failed to play Navidrome song:', error);
            setStatusMsg({ type: 'error', text: '播放失败' });
            setIsLyricsLoading(false);
        }
    }, [
        currentSongRef,
        currentTime,
        interruptStagePlaybackForMainTransition,
        navigateToPlayer,
        persistLastPlaybackCache,
        setAudioSrc,
        setCachedCoverUrl,
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
        setStatusMsg({ type: 'info', text: t('navidrome.fetchingLyrics') || '正在匹配歌词...' });
    }, [setStatusMsg, t]);

    const handleUpdateLocalLyrics = useCallback(async (content: string, isTranslation: boolean) => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = currentSong.localData;
        if (!localData) return;

        const updatedLocalSong = { ...localData };
        if (isTranslation) {
            updatedLocalSong.hasLocalTranslationLyrics = true;
            updatedLocalSong.localTranslationLyricsContent = content;
        } else {
            updatedLocalSong.hasLocalLyrics = true;
            updatedLocalSong.localLyricsContent = content;
        }

        try {
            const { saveLocalSong } = await import('../services/db');
            await saveLocalSong(updatedLocalSong);
            void onPlayLocalSong(updatedLocalSong, localSongs);
            setStatusMsg({ type: 'success', text: isTranslation ? 'Translation lyrics updated' : 'Lyrics updated' });
        } catch (error) {
            console.error('Failed to save local lyrics', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    }, [currentSong, localSongs, onPlayLocalSong, setStatusMsg]);

    const handleChangeLyricsSource = useCallback(async (source: 'local' | 'embedded' | 'online') => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = currentSong.localData;
        if (!localData) return;

        const updatedLocalSong = { ...localData, lyricsSource: source };
        try {
            const { saveLocalSong } = await import('../services/db');
            await saveLocalSong(updatedLocalSong);

            let nextLyrics: LyricData | null = null;
            if (source === 'local' && updatedLocalSong.localLyricsContent) {
                nextLyrics = await LyricParserFactory.parse({ type: 'local', lrcContent: updatedLocalSong.localLyricsContent, tLrcContent: updatedLocalSong.localTranslationLyricsContent });
            } else if (source === 'embedded' && updatedLocalSong.embeddedLyricsContent) {
                nextLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: updatedLocalSong.embeddedLyricsContent, translationContent: updatedLocalSong.embeddedTranslationLyricsContent });
            } else if (source === 'online' && updatedLocalSong.matchedLyrics) {
                nextLyrics = updatedLocalSong.matchedLyrics;
            }

            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            setCurrentSong(prev => prev?.id === currentSong.id
                ? ({ ...(prev as SongResult & { localData?: LocalSong; }), localData: updatedLocalSong } as SongResult)
                : prev
            );
            await loadLocalSongs();
            setStatusMsg({ type: 'success', text: '歌词来源已切换' });
        } catch (error) {
            console.error('Failed to save lyrics source', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    }, [currentSong, loadLocalSongs, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleManualMatchOnline = useCallback(() => {
        setIsPanelOpen(false);
        if (currentSong && (currentSong as SongResult & { isNavidrome?: boolean }).isNavidrome) {
            setShowNaviLyricMatchModal(true);
            return;
        }
        if (isLocalPlaybackSong(currentSong) && currentSong.localData) {
            setShowLyricMatchModal(true);
        }
    }, [currentSong, setIsPanelOpen]);

    const handleLyricMatchComplete = useCallback(async () => {
        setShowLyricMatchModal(false);
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) return;

        await loadLocalSongs();
        const updatedList = await getLocalSongs();
        const found = updatedList.find(song => song.id === currentSong.localData?.id);
        if (found) {
            await onPlayLocalSong(found, localSongs);
            setStatusMsg({ type: 'success', text: 'Match successful' });
        }
    }, [currentSong, loadLocalSongs, localSongs, onPlayLocalSong, setStatusMsg]);

    const handleNaviLyricMatchComplete = useCallback(async () => {
        setShowNaviLyricMatchModal(false);
        if (currentSong && (currentSong as SongResult & { isNavidrome?: boolean }).isNavidrome) {
            const navidromeQueue = playQueue
                .map(song => (song as SongResult & { navidromeData?: NavidromeSong }).navidromeData)
                .filter((song): song is NavidromeSong => Boolean(song?.isNavidrome));
            await onPlayNavidromeSong((currentSong as SongResult & { navidromeData: NavidromeSong }).navidromeData, navidromeQueue);
            setStatusMsg({ type: 'success', text: 'Match successful' });
        }
    }, [currentSong, onPlayNavidromeSong, playQueue, setStatusMsg]);

    const handleHomeMatchSong = useCallback(async (song: LocalSong) => {
        await loadLocalSongs();

        if (isLocalPlaybackSong(currentSong)) {
            const currentLocalData = currentSong.localData;
            if (currentLocalData && currentLocalData.id === song.id) {
                const updatedSongs = await getLocalSongs();
                const updatedSong = updatedSongs.find(item => item.id === song.id);

                if (updatedSong) {
                    const updatedCurrentSong = { ...currentSong, localData: updatedSong };
                    if (updatedSong.matchedCoverUrl) {
                        const coverUrl = updatedSong.matchedCoverUrl;
                        if (updatedCurrentSong.al) {
                            updatedCurrentSong.al.picUrl = coverUrl;
                        } else {
                            updatedCurrentSong.al = { id: 0, name: '', picUrl: coverUrl };
                        }
                    } else if (updatedCurrentSong.al) {
                        updatedCurrentSong.al.picUrl = undefined;
                    }

                    setCurrentSong(updatedCurrentSong);

                    if (updatedSong.matchedCoverUrl) {
                        try {
                            const response = await fetch(updatedSong.matchedCoverUrl, { mode: 'cors' });
                            const coverBlob = await response.blob();
                            await loadCachedOrFetchCover(`cover_local_${updatedSong.id}`, URL.createObjectURL(coverBlob));
                            setCachedCoverUrl(URL.createObjectURL(coverBlob));
                        } catch (error) {
                            console.warn('Failed to cache updated cover:', error);
                            setCachedCoverUrl(updatedSong.matchedCoverUrl);
                        }
                    } else {
                        setCachedCoverUrl(null);
                    }

                    setLyrics(updatedSong.matchedLyrics ?? null);
                }
            }
        }
    }, [currentSong, loadLocalSongs, setCachedCoverUrl, setCurrentSong, setLyrics]);

    const handleLike = useCallback(async () => {
        if (!currentSong) return;

        if (isStagePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: t('status.stageActionUnavailable') || 'Stage 模式下不支持收藏操作' });
            return;
        }

        if (isLocalPlaybackSong(currentSong) && currentSong.localData) {
            const nextLiked = !isLocalSongLiked(currentSong);
            try {
                await setLocalSongFavorite(currentSong.localData, nextLiked);
                await loadLocalPlaylists();
                setStatusMsg({ type: 'success', text: nextLiked ? t('status.liked') : (t('status.unliked') || '已取消喜欢') });
            } catch (error) {
                console.error('Failed to update local favorite playlist', error);
                setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            }
            return;
        }

        if (isNavidromePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: 'Navidrome 歌曲的收藏能力尚未接入' });
            return;
        }

        const nextLiked = !likedSongIds.has(currentSong.id);
        try {
            await neteaseApi.likeSong(currentSong.id, nextLiked);
            setLikedSongIds(prev => {
                const next = new Set(prev);
                if (nextLiked) next.add(currentSong.id);
                else next.delete(currentSong.id);
                return next;
            });
            setStatusMsg({ type: 'success', text: nextLiked ? t('status.liked') : t('status.unliked') || 'Removed from Liked' });
        } catch (error) {
            console.error('Like failed', error);
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
        }
    }, [currentSong, isLocalSongLiked, likedSongIds, loadLocalPlaylists, setLikedSongIds, setStatusMsg, t]);

    return {
        localSongs,
        localPlaylists,
        showLyricMatchModal,
        setShowLyricMatchModal,
        showNaviLyricMatchModal,
        setShowNaviLyricMatchModal,
        loadLocalSongs,
        loadLocalPlaylists,
        onRefreshLocalSongs,
        getFavoriteLocalPlaylist,
        isLocalSongLiked,
        saveCurrentQueueAsLocalPlaylist,
        addCurrentSongToLocalPlaylist,
        createCurrentLocalPlaylist,
        addCurrentSongToNeteasePlaylist,
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
        handleLyricMatchComplete,
        handleNaviLyricMatchComplete,
        handleHomeMatchSong,
        handleLike,
    };
}
