import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { saveSessionData, getSessionData, getFromCache, saveToCache, removeFromCache, clearCacheByCategory } from './services/db';
import { getCachedAudioBlob } from './services/audioCache';
import { loadCachedOrFetchCover } from './services/coverCache';
import { loadOnlineSongAudioSource } from './services/onlinePlayback';
import { buildNavidromeQueue } from './services/playbackAdapters';
import { invalidatePrefetchedLyrics } from './services/prefetchService';
import VisualizerRenderer from './components/visualizer/VisualizerRenderer';
import AppShell from './components/app/AppShell';
import Home from './components/app/Home';
import PlayerPanel from './components/app/PlayerPanel';
import AppDialogs from './components/app/dialogs/AppDialogs';
import AppOverlays from './components/app/overlays/AppOverlays';
import { useAppDialogsModel } from './components/app/view-models/useAppDialogsModel';
import { useAppOverlaysModel } from './components/app/view-models/useAppOverlaysModel';
import { useHomeViewModel } from './components/app/view-models/useHomeViewModel';
import { usePlayerPanelViewModel } from './components/app/view-models/usePlayerPanelViewModel';
import { LyricData, Theme, PlayerState, SongResult, LocalSong, ReplayGainMode, LocalLibraryGroup, UnifiedSong, StatusMessage, PlaybackContext, StageLoopMode } from './types';
import { NavidromeSong, NavidromeViewSelection } from './types/navidrome';
import { getOnlineSongCacheKey, isCloudSong, isSongMarkedUnavailable, neteaseApi } from './services/netease';
import { navidromeApi, getNavidromeConfig } from './services/navidromeService';
import { removeSongsFromLocalPlaylist } from './services/localPlaylistService';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useNeteaseLibrary } from './hooks/useNeteaseLibrary';
import { useAppPreferences } from './hooks/useAppPreferences';
import { useElectronPlaybackBridge } from './hooks/useElectronPlaybackBridge';
import { useMediaSessionBridge } from './hooks/useMediaSessionBridge';
import { usePlaybackAudioBridge } from './hooks/usePlaybackAudioBridge';
import { usePlaybackInteractionBridge } from './hooks/usePlaybackInteractionBridge';
import { usePlaybackUiEffects } from './hooks/usePlaybackUiEffects';
import { useLibraryPlaybackController } from './hooks/useLibraryPlaybackController';
import { usePlaybackQueueController } from './hooks/usePlaybackQueueController';
import { usePlaybackVisualizerBridge } from './hooks/usePlaybackVisualizerBridge';
import { useSessionRestoreController } from './hooks/useSessionRestoreController';
import { useStagePlaybackController } from './hooks/useStagePlaybackController';
import { useThemeController } from './hooks/useThemeController';
import { useSearchNavigationStore } from './stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';
import { clampMediaVolume, formatTime, getAudioSrcKind, replayGainModeLabels, resolveDebugLyricsSource, resolveDebugSongSource, toDebugLineSnapshot, toSafeRemoteUrl } from './utils/appPlaybackHelpers';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from './utils/appPlaybackGuards';
import { getNextLoopMode, getStageLyricsTimelineBounds } from './utils/appStageHelpers';
import { ensureLyricDataRenderHints, getLineRenderHints } from './utils/lyrics/renderHints';
import { applyLyricDisplayFilter } from './utils/lyrics/filtering';

const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
const DEV_DEBUG_SHORTCUT_LABEL = 'Alt+Shift+D';
const ONLINE_AUDIO_URL_TTL_MS = 1200 * 1000;
const ONLINE_AUDIO_URL_REFRESH_BUFFER_MS = 60 * 1000;
// Default Theme
// 午夜墨染
const DEFAULT_THEME: Theme = {
    name: "Midnight Default",
    backgroundColor: "#09090b", // zinc-950
    primaryColor: "#f4f4f5", // zinc-100
    accentColor: "#f4f4f5", // zinc-100
    secondaryColor: "#71717a", // zinc-500
    fontStyle: "sans",
    animationIntensity: "normal"
};

// 日光素白
const DAYLIGHT_THEME: Theme = {
    name: "Daylight Default",
    backgroundColor: "#f5f5f4", // stone-100 (Pearl White-ish)
    primaryColor: "#1c1917", // stone-900
    accentColor: "#ea580c", // orange-600
    secondaryColor: "#44403c", // stone-700
    fontStyle: "sans",
    animationIntensity: "normal"
};


export default function App() {
    const { t } = useTranslation();
    const isDev = import.meta.env.DEV;
    const isElectronWindow = Boolean((window as typeof window & { electron?: unknown }).electron);
    const [isTitlebarRevealed, setIsTitlebarRevealed] = useState(false);

    // Player Data
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [currentSong, setCurrentSong] = useState<SongResult | null>(null);
    const [lyrics, setLyricsState] = useState<LyricData | null>(null);
    const [cachedCoverUrl, setCachedCoverUrl] = useState<string | null>(null);
    const [activePlaybackContext, setActivePlaybackContext] = useState<PlaybackContext>('main');

    // Queue
    const [playQueue, setPlayQueue] = useState<SongResult[]>([]);

    // UI State
    const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi'>('cover');
    const [isPlayerChromeHidden, setIsPlayerChromeHidden] = useState(false);
    const [isDevDebugOverlayVisible, setIsDevDebugOverlayVisible] = useState(false);
    const [pendingOpenSettings, setPendingOpenSettings] = useState(false);

    // Player State
    const [playerState, setPlayerState] = useState<PlayerState>(PlayerState.IDLE);
    const currentTime = useMotionValue(0);
    const [duration, setDuration] = useState(0);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const [isFmMode, setIsFmMode] = useState(false);

    // Progress Bar State
    // Removed isDragging and sliderValue as they are handled by ProgressBar component

    // Audio Analysis State
    const audioPower = useMotionValue(0);
    const audioBands = {
        bass: useMotionValue(0),
        lowMid: useMotionValue(0),
        mid: useMotionValue(0),
        vocal: useMotionValue(0),
        treble: useMotionValue(0)
    };

    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);
    const animationFrameRef = useRef<number>(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const replayGainLinearRef = useRef(1);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const queueScrollRef = useRef<HTMLDivElement>(null);
    const shouldAutoPlay = useRef(false);
    const currentSongRef = useRef<number | null>(null);
    const playbackRequestIdRef = useRef(0);
    const playbackAutoSkipCountRef = useRef(0);
    const pendingUnavailableSkipTimerRef = useRef<number | null>(null);
    const pendingUnavailableSkipIntervalRef = useRef<number | null>(null);
    const volumePreviewFrameRef = useRef<number | null>(null);
    const pendingVolumePreviewRef = useRef<number | null>(null);
    const pendingResumeTimeRef = useRef<number | null>(null);
    const onlinePlaybackRecoveryRef = useRef<Promise<boolean> | null>(null);
    const lastAudioRecoverySourceRef = useRef<string | null>(null);
    const currentOnlineAudioUrlFetchedAtRef = useRef<number | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const isNowPlayingControlDisabledRef = useRef(false);

    const [replayGainMode, setReplayGainMode] = useState<ReplayGainMode>(() => {
        const saved = localStorage.getItem('local_replaygain_mode');
        return saved === 'track' || saved === 'album' ? saved : 'off';
    });
    const localFileBlobsRef = useRef<Map<string, string>>(new Map()); // id -> blob URL

    // Navigation Persistence State (Lifted from Home/LocalMusicView)
    const homeViewTab = useSearchNavigationStore(state => state.homeViewTab);
    const setHomeViewTab = useSearchNavigationStore(state => state.setHomeViewTab);

    // Preferences and Theme
    // Manages user preferences for audio quality, theme settings, 
    // and related actions like toggling cover color backgrounds and static mode,
    // as well as setting daylight mode preference
    const {
        audioQuality,
        setAudioQuality,
        useCoverColorBg,
        staticMode,
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerTranslationSubtitle,
        hidePlayerRightPanelButton,
        enableMediaCache,
        backgroundOpacity,
        isDaylight,
        visualizerMode,
        cadenzaTuning,
        partitaTuning,
        fumeTuning,
        lyricsFontStyle,
        lyricsFontScale,
        lyricsCustomFontFamily,
        lyricsCustomFontLabel,
        lyricFilterPattern,
        showOpenPanelCloseButton,
        enableNowPlayingStage,
        loopMode,
        handleToggleCoverColorBg,
        handleToggleStaticMode,
        handleToggleDisableHomeDynamicBackground,
        handleToggleHidePlayerProgressBar,
        handleToggleHidePlayerTranslationSubtitle,
        handleToggleHidePlayerRightPanelButton,
        handleToggleMediaCache,
        handleSetBackgroundOpacity,
        setDaylightPreference,
        handleSetVisualizerMode,
        handleSetCadenzaTuning,
        handleResetCadenzaTuning,
        handleSetPartitaTuning,
        handleResetPartitaTuning,
        handleSetFumeTuning,
        handleResetFumeTuning,
        handleSetLyricsFontStyle,
        handleSetLyricsFontScale,
        handleSetLyricsCustomFont,
        handleSetLyricFilterPattern,
        handleToggleOpenPanelCloseButton,
        handleToggleNowPlayingStage,
        volume,
        isMuted,
        handleSetVolume,
        handleToggleMute,
        handleToggleLoopMode,
    } = useAppPreferences(setStatusMsg);

    const setLyrics = useCallback((nextLyrics: LyricData | null) => {
        setLyricsState(ensureLyricDataRenderHints(applyLyricDisplayFilter(nextLyrics, lyricFilterPattern)));
    }, [lyricFilterPattern]);

    const effectiveLoopMode: StageLoopMode = loopMode;

    const getTargetPlaybackVolume = useCallback(() => (isMuted ? 0 : volume), [isMuted, volume]);

    const persistLastPlaybackCache = useCallback(async (song: SongResult | null, queue: SongResult[]) => {
        if (!song || isStagePlaybackSong(song)) {
            return;
        }

        const sanitizedQueue = queue.filter(queuedSong => !isStagePlaybackSong(queuedSong));
        await Promise.all([
            saveToCache('last_song', song),
            saveToCache('last_queue', sanitizedQueue),
        ]);
    }, []);

    const syncOutputGain = useCallback((targetVolume: number, smoothing = 0.015) => {
        const clampedVolume = clampMediaVolume(targetVolume);

        if (gainNodeRef.current && audioContextRef.current) {
            if (smoothing <= 0) {
                gainNodeRef.current.gain.setValueAtTime(
                    replayGainLinearRef.current * clampedVolume,
                    audioContextRef.current.currentTime
                );
            } else {
                gainNodeRef.current.gain.setTargetAtTime(
                    replayGainLinearRef.current * clampedVolume,
                    audioContextRef.current.currentTime,
                    smoothing
                );
            }

            if (audioRef.current) {
                audioRef.current.volume = 1;
                audioRef.current.muted = false;
            }
            return;
        }

        if (audioRef.current) {
            audioRef.current.volume = clampedVolume;
            audioRef.current.muted = isMuted;
        }
    }, [isMuted]);

    const handlePreviewVolume = useCallback((val: number) => {
        pendingVolumePreviewRef.current = val;

        if (volumePreviewFrameRef.current !== null) {
            return;
        }

        volumePreviewFrameRef.current = requestAnimationFrame(() => {
            volumePreviewFrameRef.current = null;
            const nextVolume = pendingVolumePreviewRef.current;
            if (nextVolume !== null) {
                syncOutputGain(nextVolume, 0.015);
            }
        });
    }, [syncOutputGain]);

    const shouldRefreshCurrentOnlineAudioSource = useCallback(() => {
        if (!currentSong || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong) || isStagePlaybackSong(currentSong)) {
            return false;
        }

        if (!audioSrc || audioSrc.startsWith('blob:')) {
            return false;
        }

        const fetchedAt = currentOnlineAudioUrlFetchedAtRef.current;
        if (!fetchedAt) {
            return false;
        }

        return Date.now() - fetchedAt >= ONLINE_AUDIO_URL_TTL_MS - ONLINE_AUDIO_URL_REFRESH_BUFFER_MS;
    }, [audioSrc, currentSong]);

    const recoverOnlinePlaybackSource = useCallback(async ({
        failedSrc,
        resumeAt,
        autoplay,
    }: {
        failedSrc?: string | null;
        resumeAt?: number;
        autoplay: boolean;
    }): Promise<boolean> => {
        const song = currentSong;
        const audioElement = audioRef.current;

        if (!song || !audioElement || isLocalPlaybackSong(song) || isNavidromePlaybackSong(song) || isStagePlaybackSong(song)) {
            return false;
        }

        const normalizedFailedSrc = failedSrc || audioElement.currentSrc || audioSrc || null;
        if (normalizedFailedSrc && lastAudioRecoverySourceRef.current === normalizedFailedSrc) {
            return false;
        }

        if (onlinePlaybackRecoveryRef.current) {
            return onlinePlaybackRecoveryRef.current;
        }

        const recoveryTask = (async () => {
            if (normalizedFailedSrc) {
                lastAudioRecoverySourceRef.current = normalizedFailedSrc;
            }

            try {
                const audioResult = await loadOnlineSongAudioSource(song, audioQuality, null);
                if (currentSongRef.current !== song.id || !audioRef.current) {
                    return false;
                }

                if (audioResult.kind === 'unavailable') {
                    return false;
                }

                if (blobUrlRef.current && blobUrlRef.current !== audioResult.blobUrl) {
                    URL.revokeObjectURL(blobUrlRef.current);
                    blobUrlRef.current = null;
                }

                if (audioResult.blobUrl) {
                    blobUrlRef.current = audioResult.blobUrl;
                }

                pendingResumeTimeRef.current = Math.max(0, resumeAt ?? audioRef.current.currentTime ?? 0);
                shouldAutoPlay.current = autoplay;
                currentOnlineAudioUrlFetchedAtRef.current = audioResult.audioSrc.startsWith('blob:')
                    ? null
                    : Date.now();
                setAudioSrc(audioResult.audioSrc);
                return true;
            } catch (error) {
                console.error('[App] Failed to recover online playback source', error);
                return false;
            } finally {
                onlinePlaybackRecoveryRef.current = null;
            }
        })();

        onlinePlaybackRecoveryRef.current = recoveryTask;
        return recoveryTask;
    }, [audioQuality, audioSrc, currentSong]);

    const getCoverUrl = useCallback(() => {
        if (cachedCoverUrl) return cachedCoverUrl;
        let url = null;
        if (currentSong?.al?.picUrl) url = currentSong.al.picUrl;
        else if (currentSong?.album?.picUrl) url = currentSong.album.picUrl;
        return toSafeRemoteUrl(url) || null;
    }, [cachedCoverUrl, currentSong]);

    const coverUrl = getCoverUrl();

    // Theme Controller
    // manages current theme, daylight mode, and related actions like generating AI themes 
    // and restoring cached themes for songs
    const {
        theme,
        setTheme,
        hasCustomTheme,
        isCustomThemePreferred,
        bgMode,
        isGeneratingTheme,
        handleToggleDaylight,
        handleBgModeChange,
        handleResetTheme,
        applyDefaultTheme,
        restoreCachedThemeForSong,
        generateAITheme,
        getThemeParkSeedTheme,
        saveCustomDualTheme,
        applyCustomTheme,
        handleCustomThemePreferenceChange,
    } = useThemeController({
        defaultTheme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        isDaylight,
        setDaylightPreference,
        setStatusMsg,
        coverUrl,
        t,
    });

    // Navigation and Library Hooks
    // manages current view, selected items, and navigation functions across the app
    const {
        currentView,
        overlayStack,
        isOverlayVisible,
        topOverlay,
        hasOverlay,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        focusedFavoriteAlbumIndex,
        setFocusedFavoriteAlbumIndex,
        focusedRadioIndex,
        setFocusedRadioIndex,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection,
        setPendingNavidromeSelection,
        localMusicState,
        setLocalMusicState,
        navigateToPlayer,
        navigateToHome,
        navigateDirectHome,
        navigateToSearch,
        closeSearchView,
        handlePlaylistSelect,
        handleAlbumSelect,
        handleArtistSelect,
        popOverlay,
    } = useAppNavigation();
    const {
        searchQuery,
        searchSourceTab,
        submitSearch,
        loadMoreSearchResults,
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        searchSourceTab: state.searchSourceTab,
        submitSearch: state.submitSearch,
        loadMoreSearchResults: state.loadMoreSearchResults,
    })));
    const hideSearchOverlay = useSearchNavigationStore(state => state.hideSearchOverlay);

    // Netease Library Hook
    // manages user data, playlists, liked songs, and related actions
    const {
        user,
        playlists,
        cloudPlaylist,
        likedSongIds,
        isSyncing,
        cacheSize,
        refreshUserData,
        updateCacheSize,
        handleClearCache,
        handleSyncData,
        handleLogout,
        setLikedSongIds,
    } = useNeteaseLibrary({
        currentView,
        hasOverlay,
        setStatusMsg,
        t,
    });

    const {
        stageStatus,
        setStageStatus,
        stageSource,
        stageActiveEntryKind,
        stageLyricsSession,
        stageMediaSession,
        nowPlayingConnectionStatus,
        nowPlayingTrack,
        nowPlayingLyricPayload,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        nowPlayingPaused,
        isNowPlayingStageActive,
        mainPlaybackSnapshotRef,
        stageLyricsClockRef,
        syncStageLyricsClock,
        getSyntheticStageLyricsTime,
        syncNowPlayingClock,
        getNowPlayingDisplayTime,
        loadStageSessionIntoPlayback,
        clearPersistedStagePlaybackCache,
        openStagePlayer,
        leaveStagePlayback,
        interruptStagePlaybackForMainTransition,
        clearStagePlaybackSession,
    } = useStagePlaybackController({
        t: (key) => t(key),
        isDev,
        isElectronWindow,
        enableNowPlayingStage,
        activePlaybackContext,
        setActivePlaybackContext,
        currentSong,
        lyrics,
        cachedCoverUrl,
        audioSrc,
        playQueue,
        isFmMode,
        playerState,
        duration,
        currentLineIndex,
        currentTime,
        audioRef,
        currentSongRef,
        shouldAutoPlayRef: shouldAutoPlay,
        pendingResumeTimeRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef,
        setCurrentSong,
        setLyrics,
        setCachedCoverUrl,
        setAudioSrc,
        setPlayQueue,
        setIsFmMode,
        setIsLyricsLoading,
        setPlayerState,
        setCurrentLineIndex,
        setDuration,
        setStatusMsg,
        navigateToPlayer,
    });

    const resumePlayback = useCallback(async () => {
        if (isNowPlayingStageActive) {
            return;
        }

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            const currentSyntheticTime = getSyntheticStageLyricsTime();
            syncStageLyricsClock(currentSyntheticTime, duration, PlayerState.PLAYING, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(currentSyntheticTime);
            setPlayerState(PlayerState.PLAYING);
            return;
        }

        if (!audioRef.current) {
            return;
        }

        setupAudioAnalyzer();
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        syncOutputGain(getTargetPlaybackVolume(), 0);
        if (shouldRefreshCurrentOnlineAudioSource()) {
            const refreshed = await recoverOnlinePlaybackSource({
                failedSrc: audioRef.current.currentSrc || audioSrc,
                resumeAt: audioRef.current.currentTime,
                autoplay: true,
            });

            if (refreshed) {
                return;
            }
        }

        try {
            await audioRef.current.play();
            setPlayerState(PlayerState.PLAYING);
        } catch (error) {
            const recovered = await recoverOnlinePlaybackSource({
                failedSrc: audioRef.current.currentSrc || audioSrc,
                resumeAt: audioRef.current.currentTime,
                autoplay: true,
            });

            if (recovered) {
                return;
            }

            if (!audioRef.current.paused && !audioRef.current.ended) {
                setPlayerState(PlayerState.PLAYING);
                return;
            }

            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                setPlayerState(PlayerState.PAUSED);
                return;
            }

            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            setPlayerState(PlayerState.PAUSED);
            throw error;
        }
    }, [activePlaybackContext, audioSrc, currentTime, duration, getSyntheticStageLyricsTime, getTargetPlaybackVolume, isNowPlayingStageActive, recoverOnlinePlaybackSource, shouldRefreshCurrentOnlineAudioSource, stageActiveEntryKind, syncOutputGain, syncStageLyricsClock, t]);

    const pausePlayback = useCallback(() => {
        if (isNowPlayingStageActive) {
            return;
        }

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            const currentSyntheticTime = getSyntheticStageLyricsTime();
            syncStageLyricsClock(currentSyntheticTime, duration, PlayerState.PAUSED, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(currentSyntheticTime);
            setPlayerState(PlayerState.PAUSED);
            return;
        }

        if (!audioRef.current) {
            return;
        }

        audioRef.current.pause();
        syncOutputGain(getTargetPlaybackVolume(), 0);
        setPlayerState(PlayerState.PAUSED);
    }, [activePlaybackContext, audioSrc, currentTime, duration, getSyntheticStageLyricsTime, getTargetPlaybackVolume, isNowPlayingStageActive, stageActiveEntryKind, syncOutputGain, syncStageLyricsClock]);

    const openNavidromeSelection = useCallback((selection: NavidromeViewSelection) => {
        setPendingNavidromeSelection(selection);
        setHomeViewTab('navidrome');
        navigateDirectHome({ clearContext: false });
    }, [navigateDirectHome, setHomeViewTab]);

    const resolveCurrentNavidromeTargetIds = useCallback(() => {
        const currentNavidromeSong = (currentSong as any)?.navidromeData;
        const playbackCarrier = currentNavidromeSong?.navidromeData;

        return {
            albumId: currentNavidromeSong?.albumId || playbackCarrier?.albumId,
            artistId: currentNavidromeSong?.artistId || playbackCarrier?.artistId,
        } as { albumId?: string; artistId?: string; };
    }, [currentSong]);

    const openCurrentNavidromeAlbum = useCallback(() => {
        const { albumId } = resolveCurrentNavidromeTargetIds();
        if (albumId) {
            openNavidromeSelection({ type: 'album', albumId });
        }
    }, [openNavidromeSelection, resolveCurrentNavidromeTargetIds]);

    const openCurrentNavidromeArtist = useCallback(() => {
        const { artistId } = resolveCurrentNavidromeTargetIds();
        if (artistId) {
            openNavidromeSelection({ type: 'artist', artistId });
        }
    }, [openNavidromeSelection, resolveCurrentNavidromeTargetIds]);

    const handleDirectHomeFromPanel = useCallback(() => {
        navigateDirectHome();
    }, [navigateDirectHome]);

    // --- Local Music Functions ---

    const {
        localSongs,
        localPlaylists,
        showLyricMatchModal,
        setShowLyricMatchModal,
        showNaviLyricMatchModal,
        setShowNaviLyricMatchModal,
        loadLocalSongs,
        loadLocalPlaylists,
        onRefreshLocalSongs,
        isLocalSongLiked,
        saveCurrentQueueAsLocalPlaylist,
        addCurrentSongToLocalPlaylist,
        createCurrentLocalPlaylist,
        addCurrentSongToNeteasePlaylist,
        addCurrentSongToNavidromePlaylist,
        createCurrentNavidromePlaylist,
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
        handleLike: handleLibraryLike,
    } = useLibraryPlaybackController({
        t: (key, fallback) => t(key, fallback ?? ''),
        audioQuality,
        currentSong,
        lyrics,
        playQueue,
        userId: user?.userId,
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
        navigateToPlayer,
        persistLastPlaybackCache,
        restoreCachedThemeForSong,
        interruptStagePlaybackForMainTransition,
        blobUrlRef,
        shouldAutoPlayRef: shouldAutoPlay,
        currentSongRef,
        currentOnlineAudioUrlFetchedAtRef,
    });

    useSessionRestoreController({
        audioQuality,
        userId: user?.userId,
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
    });

    const openLocalLibraryGroup = useCallback((group: LocalLibraryGroup, row: 0 | 1 | 2 | 3) => {
        setHomeViewTab('local');
        setLocalMusicState(prev => ({
            ...prev,
            activeRow: row,
            selectedGroup: group,
            detailStack: prev.selectedGroup && prev.selectedGroup.id !== group.id
                ? [...prev.detailStack, prev.selectedGroup]
                : prev.selectedGroup
                    ? prev.detailStack
                    : [],
            detailOriginView: prev.selectedGroup
                ? prev.detailOriginView
                : (currentView === 'player' ? 'player' : null),
        }));
        navigateDirectHome({ clearContext: false });
    }, [currentView, navigateDirectHome, setHomeViewTab, setLocalMusicState]);

    const openCurrentLocalAlbum = useCallback(() => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            return;
        }

        const localSong = currentSong.localData;
        const albumName = currentSong.al?.name || currentSong.album?.name || localSong.matchedAlbumName || localSong.album;
        if (!albumName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateAlbum = song.matchedAlbumName || song.album || '';
            return candidateAlbum === albumName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'album',
            id: `album-current-${albumName}`,
            name: albumName,
            songs,
            coverUrl: currentSong.al?.picUrl || currentSong.album?.picUrl,
            albumId: localSong.matchedAlbumId,
            description: currentSong.ar?.map(artist => artist.name).join(', '),
        }, 1);
    }, [currentSong, localSongs, openLocalLibraryGroup]);

    const openCurrentLocalArtist = useCallback(() => {
        if (!isLocalPlaybackSong(currentSong) || !currentSong.localData) {
            return;
        }

        const artistName = currentSong.ar?.[0]?.name || currentSong.artists?.[0]?.name || currentSong.localData.matchedArtists || currentSong.localData.artist;
        if (!artistName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateArtist = song.matchedArtists || song.artist || '';
            return candidateArtist === artistName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'artist',
            id: `artist-current-${artistName}`,
            name: artistName,
            songs,
            coverUrl: currentSong.al?.picUrl || currentSong.album?.picUrl,
            description: `${songs.length} 首歌曲`,
        }, 2);
    }, [currentSong, localSongs, openLocalLibraryGroup]);

    const openLocalAlbumByName = useCallback((albumName: string) => {
        if (!albumName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateAlbum = song.matchedAlbumName || song.album || '';
            return candidateAlbum === albumName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'album',
            id: `album-by-name-${albumName}`,
            name: albumName,
            songs,
            coverUrl: songs.find(song => song.matchedCoverUrl)?.matchedCoverUrl,
            albumId: songs.find(song => song.matchedAlbumId)?.matchedAlbumId,
            description: songs[0]?.matchedArtists || songs[0]?.artist,
        }, 1);
    }, [localSongs, openLocalLibraryGroup]);

    const openLocalArtistByName = useCallback((artistName: string) => {
        if (!artistName) {
            return;
        }

        const songs = localSongs.filter(song => {
            const candidateArtist = song.matchedArtists || song.artist || '';
            return candidateArtist === artistName;
        });

        if (!songs.length) {
            return;
        }

        openLocalLibraryGroup({
            type: 'artist',
            id: `artist-by-name-${artistName}`,
            name: artistName,
            songs,
            coverUrl: songs.find(song => song.matchedCoverUrl)?.matchedCoverUrl,
            description: `${songs.length} 首歌曲`,
        }, 2);
    }, [localSongs, openLocalLibraryGroup]);


    const handleSaveLyricFilterPattern = useCallback(async (pattern: string) => {
        handleSetLyricFilterPattern(pattern);
        await clearCacheByCategory('lyrics');
        invalidatePrefetchedLyrics();

        const previewLyrics = await loadCurrentSongLyricPreview();
        setLyricsState(ensureLyricDataRenderHints(applyLyricDisplayFilter(previewLyrics, pattern)));
        setCurrentLineIndex(-1);
        setStatusMsg({ type: 'success', text: '歌词过滤规则已更新' });
    }, [handleSetLyricFilterPattern, loadCurrentSongLyricPreview]);

    const appendNeteaseSongsToMainQueue = useCallback((songs: SongResult[]) => {
        if (songs.length === 0) {
            return false;
        }

        const mainSnapshot = activePlaybackContext === 'stage' ? mainPlaybackSnapshotRef.current : null;
        const queueAnchorSong = mainSnapshot?.currentSong ?? (activePlaybackContext === 'main' ? currentSong : null);
        const existingQueue = mainSnapshot?.playQueue ?? (activePlaybackContext === 'main' ? playQueue : []);
        const baseQueue = existingQueue.length > 0 ? existingQueue : (queueAnchorSong ? [queueAnchorSong] : []);
        const existingIds = new Set(baseQueue.map(song => song.id));
        const appendedSongs = songs.filter(song => !isSongMarkedUnavailable(song) && !existingIds.has(song.id));
        const nextQueue = appendedSongs.length > 0 ? [...baseQueue, ...appendedSongs] : baseQueue;

        if (activePlaybackContext === 'stage') {
            mainPlaybackSnapshotRef.current = mainSnapshot
                ? { ...mainSnapshot, playQueue: nextQueue }
                : {
                    currentSong: queueAnchorSong,
                    lyrics: null,
                    cachedCoverUrl: null,
                    audioSrc: null,
                    playQueue: nextQueue,
                    isFmMode: false,
                    playerState: PlayerState.IDLE,
                    currentTime: 0,
                    duration: 0,
                    currentLineIndex: -1,
                };
        } else {
            setPlayQueue(nextQueue);
        }

        if (appendedSongs.length > 0) {
            void persistLastPlaybackCache(queueAnchorSong, nextQueue);
            setStatusMsg({ type: 'success', text: t('status.queueUpdated') || '已添加到播放队列' });
            return true;
        }

        return false;
    }, [activePlaybackContext, currentSong, persistLastPlaybackCache, playQueue, t]);

    const addNeteaseSongToQueue = useCallback((song: SongResult) => {
        if (isSongMarkedUnavailable(song)) {
            return;
        }

        appendNeteaseSongsToMainQueue([song]);
    }, [appendNeteaseSongsToMainQueue]);

    const addNeteaseSongsToQueue = useCallback((songs: SongResult[]) => {
        appendNeteaseSongsToMainQueue(songs);
    }, [appendNeteaseSongsToMainQueue]);

    const addNavidromeSongsToQueue = useCallback((songs: NavidromeSong[]) => {
        if (songs.length === 0) {
            return;
        }

        const unifiedSongs = buildNavidromeQueue(songs);
        const existingIds = new Set(playQueue.map(song => song.id));
        const appendedSongs = unifiedSongs.filter(song => !existingIds.has(song.id));
        const nextQueue = appendedSongs.length > 0 ? [...playQueue, ...appendedSongs] : playQueue;

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);
        setStatusMsg({ type: 'success', text: t('status.queueUpdated') || '已添加到播放队列' });
    }, [currentSong, persistLastPlaybackCache, playQueue, t]);

    // --- Effects ---

    const {
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        clearPendingUnavailableSkip,
        playSong,
        playOnlineQueueFromStart,
        handleQueueAddAndPlay,
        handleSearchOverlaySubmit,
        handleSearchLoadMore,
        handleSearchResultPlay,
        handleUnavailableReplacementConfirm,
        handleSearchResultArtistSelect,
        handleSearchResultAlbumSelect,
        handleNextTrack,
        handlePrevTrack,
        skipAfterPlaybackFailure,
        handleStageExternalPlayRequest,
        shuffleQueue,
    } = usePlaybackQueueController({
        t,
        audioQuality,
        currentSong,
        playQueue,
        playerState,
        loopMode,
        isFmMode,
        isNowPlayingStageActive,
        searchQuery,
        searchSourceTab,
        localSongs,
        userId: user?.userId,
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
        setIsFmMode,
        setPanelTab,
        setIsPanelOpen,
        navigateToPlayer,
        navigateToSearch,
        hideSearchOverlay,
        setHomeViewTab,
        setPendingNavidromeSelection,
        handleArtistSelect,
        handleAlbumSelect,
        openLocalArtistByName,
        openLocalAlbumByName,
        appendNeteaseSongsToMainQueue,
        persistLastPlaybackCache,
        restoreCachedThemeForSong,
        interruptStagePlaybackForMainTransition,
        onPlayLocalSong,
        onPlayNavidromeSong,
        searchDeps: {
            submitSearch,
            loadMoreSearchResults,
        },
        audioRef,
        blobUrlRef,
        shouldAutoPlayRef: shouldAutoPlay,
        currentSongRef,
        playbackRequestIdRef,
        playbackAutoSkipCountRef,
        pendingUnavailableSkipTimerRef,
        pendingUnavailableSkipIntervalRef,
        pendingResumeTimeRef,
        currentOnlineAudioUrlFetchedAtRef,
        lastAudioRecoverySourceRef,
    });

    usePlaybackUiEffects({
        statusMsg,
        setStatusMsg,
        isPanelOpen,
        panelTab,
        updateCacheSize,
        loadLocalSongs,
        loadLocalPlaylists,
        localMusicUpdatedEvent: LOCAL_MUSIC_UPDATED_EVENT,
        blobUrlRef,
        volumePreviewFrameRef,
        onClearPendingUnavailableSkip: clearPendingUnavailableSkip,
    });

    const { setupAudioAnalyzer, cacheSongAssets } = usePlaybackAudioBridge({
        audioRef,
        audioSrc,
        currentSong,
        isLyricsLoading,
        enableMediaCache,
        isPanelOpen,
        panelTab,
        replayGainMode,
        shouldAutoPlayRef: shouldAutoPlay,
        audioContextRef,
        analyserRef,
        gainNodeRef,
        replayGainLinearRef,
        sourceRef,
        setPlayerState,
        setStatusMsg,
        syncOutputGain,
        getTargetPlaybackVolume,
        getCoverUrl,
        updateCacheSize,
        t: key => t(key),
    });

    const mediaSessionPlayRef = useRef(resumePlayback);
    const mediaSessionPauseRef = useRef(pausePlayback);
    const mediaSessionPrevRef = useRef(handlePrevTrack);
    const mediaSessionNextRef = useRef(handleNextTrack);
    const taskbarHasTrackRef = useRef(Boolean(currentSong));
    const taskbarPlayerStateRef = useRef(playerState);

    useEffect(() => {
        mediaSessionPlayRef.current = resumePlayback;
    }, [resumePlayback]);

    useEffect(() => {
        mediaSessionPauseRef.current = pausePlayback;
    }, [pausePlayback]);

    useEffect(() => {
        mediaSessionPrevRef.current = handlePrevTrack;
    }, [handlePrevTrack]);

    useEffect(() => {
        mediaSessionNextRef.current = handleNextTrack;
    }, [handleNextTrack]);

    useEffect(() => {
        taskbarHasTrackRef.current = Boolean(currentSong);
    }, [currentSong]);

    useEffect(() => {
        taskbarPlayerStateRef.current = playerState;
    }, [playerState]);

    useMediaSessionBridge({
        audioRef,
        currentSong,
        cachedCoverUrl,
        playerState,
        isNowPlayingStageActive,
        t: (key) => t(key),
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        isNowPlayingControlDisabledRef,
    });

    useElectronPlaybackBridge({
        isElectronWindow,
        setIsTitlebarRevealed,
        isNowPlayingControlDisabledRef,
        audioRef,
        currentSong,
        playerState,
        playQueue,
        effectiveLoopMode,
        isFmMode,
        isNowPlayingStageActive,
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        taskbarHasTrackRef,
        taskbarPlayerStateRef,
        onExternalPlayRequest: handleStageExternalPlayRequest,
    });

    usePlaybackVisualizerBridge({
        audioRef,
        analyserRef,
        animationFrameRef,
        activePlaybackContext,
        audioPower,
        audioBands,
        currentTime,
        lyrics,
        playerState,
        duration,
        effectiveLoopMode,
        isNowPlayingStageActive,
        stageActiveEntryKind,
        stageLyricsSession,
        stageLyricsClockRef,
        setCurrentLineIndex,
        setPlayerState,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        getNowPlayingDisplayTime,
        syncNowPlayingClock,
    });

    const {
        togglePlay,
        toggleLoop,
        handleChangeReplayGainMode,
        handleContainerClick,
        handleFmTrash,
    } = usePlaybackInteractionBridge({
        isDev,
        currentSong,
        currentView,
        audioSrc,
        activePlaybackContext,
        stageActiveEntryKind,
        isNowPlayingStageActive,
        isPanelOpen,
        isFmMode,
        playerState,
        duration,
        currentTime,
        audioRef,
        stageLyricsClockRef,
        setIsDevDebugOverlayVisible,
        setIsPlayerChromeHidden,
        setIsPanelOpen,
        setReplayGainMode,
        setStatusMsg,
        handleNextTrack,
        handlePrevTrack,
        handleToggleLoopMode,
        pausePlayback,
        resumePlayback,
        syncStageLyricsClock,
    });

    const handleLike = useCallback(async () => {
        await handleLibraryLike(likedSongIds, setLikedSongIds);
    }, [handleLibraryLike, likedSongIds, setLikedSongIds]);

    // Define dynamic style for theme variables
    const appStyle = {
        '--bg-color': bgMode === 'default' ? (isDaylight ? DAYLIGHT_THEME.backgroundColor : DEFAULT_THEME.backgroundColor) : theme.backgroundColor,
        '--text-primary': theme.primaryColor,
        '--text-secondary': theme.secondaryColor,
        '--text-accent': theme.accentColor,
        backgroundColor: 'var(--bg-color)',
        color: 'var(--text-primary)'
    } as React.CSSProperties;
    const visualizerBackgroundColor = String(appStyle['--bg-color']);
    const visualizerTheme = useMemo(() => ({
        ...theme,
        fontStyle: lyricsFontStyle,
        fontFamily: lyricsCustomFontFamily ?? undefined,
        backgroundColor: visualizerBackgroundColor,
    }), [lyricsCustomFontFamily, lyricsFontStyle, theme, visualizerBackgroundColor]);
    const visualizerGeometrySeed = currentSong?.id ?? `geometry-${visualizerMode}`;
    const canGenerateAITheme = Boolean((lyrics?.lines.length ?? 0) > 0 || currentSong?.isPureMusic);
    const debugCurrentTimeValue = currentTime.get();
    const debugActiveLine = lyrics && currentLineIndex >= 0 ? lyrics.lines[currentLineIndex] ?? null : null;
    const debugNextLine = (() => {
        if (!lyrics?.lines.length) {
            return null;
        }

        if (debugActiveLine) {
            return lyrics.lines[currentLineIndex + 1] ?? null;
        }

        return lyrics.lines.find(line => line.startTime > debugCurrentTimeValue) ?? null;
    })();
    const debugCoverUrlKind = getAudioSrcKind(coverUrl);
    const debugTotalWords = lyrics?.lines.reduce((sum, line) => sum + line.words.length, 0) ?? 0;
    const debugMaxWordsPerLine = lyrics?.lines.reduce((max, line) => Math.max(max, line.words.length), 0) ?? 0;
    const toDebugLineSnapshot = (line: LyricData['lines'][number] | null) => {
        if (!line) {
            return null;
        }

        const renderHints = getLineRenderHints(line);
        return {
            text: line.fullText || null,
            translation: line.translation ?? null,
            wordCount: line.words.length,
            startTime: line.startTime,
            endTime: line.endTime,
            renderEndTime: renderHints?.renderEndTime ?? null,
            rawDuration: renderHints?.rawDuration ?? Math.max(line.endTime - line.startTime, 0),
            timingClass: renderHints?.timingClass ?? null,
            lineTransitionMode: renderHints?.lineTransitionMode ?? null,
            wordRevealMode: renderHints?.wordRevealMode ?? null,
        };
    };
    const devDebugSnapshot = {
        shortcutLabel: DEV_DEBUG_SHORTCUT_LABEL,
        songKey: currentSong ? `${resolveDebugSongSource(currentSong)}:${currentSong.id}` : null,
        currentView,
        playerState,
        visualizerMode,
        songName: currentSong?.name ?? null,
        songSource: resolveDebugSongSource(currentSong),
        lyricsSource: resolveDebugLyricsSource(currentSong, lyrics),
        audioSrcKind: getAudioSrcKind(audioSrc),
        coverUrlKind: debugCoverUrlKind,
        duration,
        currentLineIndex,
        totalLines: lyrics?.lines.length ?? 0,
        totalWords: debugTotalWords,
        maxWordsPerLine: debugMaxWordsPerLine,
        activeLine: toDebugLineSnapshot(debugActiveLine),
        nextLine: toDebugLineSnapshot(debugNextLine),
    };
    const isPlayerView = currentView === 'player';
    const shouldPauseVisualizerBackground = currentView !== 'player' && disableHomeDynamicBackground;
    const shouldHidePlayerProgressBar = isPlayerView && hidePlayerProgressBar;
    const shouldHidePlayerTranslationSubtitle = isPlayerView && hidePlayerTranslationSubtitle;
    const shouldHidePlayerRightPanelButton = isPlayerView && hidePlayerRightPanelButton;
    const isNowPlayingControlDisabled = isNowPlayingStageActive;
    const canToggleCurrentPlayback = !isNowPlayingControlDisabled && Boolean(
        audioSrc || (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && duration > 0)
    );

    const homeModel = useHomeViewModel({
        navigation: {
            onPlaySong: playSong,
            onBackToPlayer: navigateToPlayer,
            onRefreshUser: () => refreshUserData(),
            user,
            playlists,
            cloudPlaylist,
            currentTrack: currentSong,
            isPlaying: playerState === PlayerState.PLAYING,
            onSelectPlaylist: handlePlaylistSelect,
            onSelectAlbum: handleAlbumSelect,
            onSelectArtist: handleArtistSelect,
            focusedPlaylistIndex,
            setFocusedPlaylistIndex,
            focusedFavoriteAlbumIndex,
            setFocusedFavoriteAlbumIndex,
            focusedRadioIndex,
            setFocusedRadioIndex,
            pendingOpenSettings,
            onPendingOpenSettingsHandled: () => setPendingOpenSettings(false),
        },
        search: {
            onSearchCommitted: (query, sourceTab, replace = false) => {
                navigateToSearch({ query, sourceTab, replace });
            },
        },
        localLibrary: {
            onSelectLocalAlbum: openLocalAlbumByName,
            onSelectLocalArtist: openLocalArtistByName,
            localSongs,
            localPlaylists,
            onRefreshLocalSongs,
            onPlayLocalSong,
            onAddLocalSongToQueue: handleLocalQueueAdd,
            localMusicState,
            setLocalMusicState,
            onMatchSong: handleHomeMatchSong,
        },
        navidrome: {
            onPlayNavidromeSong,
            onAddNavidromeSongsToQueue: addNavidromeSongsToQueue,
            onMatchNavidromeSong,
            navidromeFocusedAlbumIndex,
            setNavidromeFocusedAlbumIndex,
            pendingNavidromeSelection,
            onPendingNavidromeSelectionHandled: () => setPendingNavidromeSelection(null),
        },
        stage: {
            stageEnabled: Boolean(stageSource),
            stageSource,
            stageIsActive: activePlaybackContext === 'stage',
            onOpenStagePlayer: () => {
                void openStagePlayer();
            },
            stageStatus,
            onToggleStageMode: async (enabled) => {
                const nextStatus = await window.electron?.setStageEnabled(enabled);
                if (nextStatus) {
                    setStageStatus(nextStatus);
                    if (!enabled && activePlaybackContext === 'stage') {
                        leaveStagePlayback();
                    }
                    if (!enabled) {
                        clearStagePlaybackSession();
                        await clearPersistedStagePlaybackCache();
                    }
                }
            },
            onStageSourceChange: async (source) => {
                if (!window.electron?.saveSettings) {
                    return;
                }

                await window.electron.saveSettings('STAGE_MODE_SOURCE', source);
            },
            onRegenerateStageToken: async () => {
                const nextStatus = await window.electron?.regenerateStageToken();
                if (nextStatus) {
                    setStageStatus(nextStatus);
                }
            },
            onClearStageState: async () => {
                const nextStatus = await window.electron?.clearStageState();
                if (nextStatus) {
                    setStageStatus(nextStatus);
                    if (activePlaybackContext === 'stage') {
                        await loadStageSessionIntoPlayback(null);
                    }
                }
            },
            enableNowPlayingStage,
            onToggleNowPlayingStage: async (enabled) => {
                handleToggleNowPlayingStage(enabled);
                if (!enabled && activePlaybackContext === 'stage') {
                    leaveStagePlayback();
                }
            },
            nowPlayingConnectionStatus,
        },
        appearance: {
            staticMode,
            disableHomeDynamicBackground,
            hidePlayerProgressBar,
            hidePlayerTranslationSubtitle,
            hidePlayerRightPanelButton,
            onToggleStaticMode: handleToggleStaticMode,
            onToggleDisableHomeDynamicBackground: handleToggleDisableHomeDynamicBackground,
            onToggleHidePlayerProgressBar: handleToggleHidePlayerProgressBar,
            onToggleHidePlayerTranslationSubtitle: handleToggleHidePlayerTranslationSubtitle,
            onToggleHidePlayerRightPanelButton: handleToggleHidePlayerRightPanelButton,
            enableMediaCache,
            onToggleMediaCache: handleToggleMediaCache,
            theme,
            backgroundOpacity,
            setBackgroundOpacity: handleSetBackgroundOpacity,
            bgMode,
            onApplyDefaultTheme: applyDefaultTheme,
            hasCustomTheme,
            themeParkInitialTheme: getThemeParkSeedTheme(),
            isCustomThemePreferred,
            onSaveCustomTheme: saveCustomDualTheme,
            onApplyCustomTheme: applyCustomTheme,
            onToggleCustomThemePreferred: handleCustomThemePreferenceChange,
            isDaylight,
            visualizerMode,
            cadenzaTuning,
            partitaTuning,
            fumeTuning,
            onVisualizerModeChange: handleSetVisualizerMode,
            onPartitaTuningChange: handleSetPartitaTuning,
            onResetPartitaTuning: handleResetPartitaTuning,
            onFumeTuningChange: handleSetFumeTuning,
            onResetFumeTuning: handleResetFumeTuning,
            lyricsFontStyle,
            lyricsFontScale,
            lyricsCustomFontFamily,
            lyricsCustomFontLabel,
            lyricFilterPattern,
            currentSongTitle: currentSong?.name || null,
            showOpenPanelCloseButton,
            onLyricsFontStyleChange: handleSetLyricsFontStyle,
            onLyricsFontScaleChange: handleSetLyricsFontScale,
            onLyricsCustomFontChange: handleSetLyricsCustomFont,
            loadLyricFilterPreview: loadCurrentSongLyricPreview,
            onSaveLyricFilterPattern: handleSaveLyricFilterPattern,
            onToggleOpenPanelCloseButton: handleToggleOpenPanelCloseButton,
        },
    });

    const playerPanelModel = usePlayerPanelViewModel({
        playback: {
            isOpen: isPanelOpen,
            currentTab: panelTab,
            onTabChange: setPanelTab,
            onToggle: () => setIsPanelOpen(!isPanelOpen),
            onNavigateHome: navigateToHome,
            onNavigateHomeDirect: handleDirectHomeFromPanel,
            coverUrl,
            currentSong,
            onAlbumSelect: handleAlbumSelect,
            onSelectArtist: handleArtistSelect,
            loopMode: effectiveLoopMode,
            onToggleLoop: toggleLoop,
            onLike: handleLike,
            isLiked: currentSong ? (isLocalPlaybackSong(currentSong) ? isLocalSongLiked(currentSong) : likedSongIds.has(currentSong.id)) : false,
            onGenerateAITheme: () => generateAITheme(lyrics, currentSong),
            isGeneratingTheme,
            hasLyrics: !!lyrics,
            canGenerateAITheme,
            theme,
            onThemeChange: setTheme,
            bgMode,
            onBgModeChange: handleBgModeChange,
            hasCustomTheme,
            onResetTheme: handleResetTheme,
            defaultTheme: DEFAULT_THEME,
            daylightTheme: DAYLIGHT_THEME,
            visualizerMode,
            onVisualizerModeChange: handleSetVisualizerMode,
            onMatchOnline: handleManualMatchOnline,
            onUpdateLocalLyrics: handleUpdateLocalLyrics,
            onChangeLyricsSource: handleChangeLyricsSource,
            replayGainMode,
            onChangeReplayGainMode: handleChangeReplayGainMode,
            isFmMode,
            onFmTrash: handleFmTrash,
            onNextTrack: handleNextTrack,
            onPrevTrack: handlePrevTrack,
            playerState,
            onTogglePlay: togglePlay,
            volume,
            isMuted,
            onVolumePreview: handlePreviewVolume,
            onVolumeChange: handleSetVolume,
            onToggleMute: handleToggleMute,
            showOpenPanelCloseButton,
            hideToggleButton: isPlayerChromeHidden || shouldHidePlayerRightPanelButton,
            isStageContext: activePlaybackContext === 'stage',
            playbackControlsDisabled: isNowPlayingControlDisabled,
            onOpenSettings: () => {
                setPendingOpenSettings(true);
                navigateToHome();
            },
        },
        queue: {
            playQueue,
            onPlaySong: playSong,
            queueScrollRef,
            onShuffle: shuffleQueue,
        },
        library: {
            localPlaylists,
            neteasePlaylists: playlists,
            onSaveCurrentQueueAsPlaylist: saveCurrentQueueAsLocalPlaylist,
            onAddCurrentSongToLocalPlaylist: addCurrentSongToLocalPlaylist,
            onCreateCurrentLocalPlaylist: createCurrentLocalPlaylist,
            onAddCurrentSongToNeteasePlaylist: addCurrentSongToNeteasePlaylist,
            onAddCurrentSongToNavidromePlaylist: addCurrentSongToNavidromePlaylist,
            onCreateCurrentNavidromePlaylist: createCurrentNavidromePlaylist,
            onOpenCurrentLocalAlbum: openCurrentLocalAlbum,
            onOpenCurrentLocalArtist: openCurrentLocalArtist,
            onOpenCurrentNavidromeAlbum: openCurrentNavidromeAlbum,
            onOpenCurrentNavidromeArtist: openCurrentNavidromeArtist,
        },
        account: {
            user,
            onLogout: handleLogout,
            audioQuality,
            onAudioQualityChange: setAudioQuality,
            cacheSize,
            onClearCache: handleClearCache,
            onSyncData: handleSyncData,
            isSyncing,
            useCoverColorBg,
            onToggleCoverColorBg: handleToggleCoverColorBg,
            isDaylight,
            onToggleDaylight: () => handleToggleDaylight(!isDaylight),
        },
    });

    const appOverlaysModel = useAppOverlaysModel({
        homeOverlay: currentView === 'home' && !isOverlayVisible
            ? { isVisible: true, content: <Home model={homeModel} /> }
            : null,
        searchOverlay: currentView === 'home'
            ? {
                theme,
                isDaylight,
                onClose: closeSearchView,
                onSubmitSearch: handleSearchOverlaySubmit,
                onLoadMore: handleSearchLoadMore,
                onPlayTrack: handleSearchResultPlay,
                onSelectArtist: handleSearchResultArtistSelect,
                onSelectAlbum: handleSearchResultAlbumSelect,
            }
            : null,
        detailOverlay: isOverlayVisible && topOverlay
            ? (topOverlay.type === 'playlist'
                ? {
                    type: 'playlist' as const,
                    props: {
                        key: `playlist-${topOverlay.playlist.id}-${overlayStack.length - 1}`,
                        playlist: topOverlay.playlist,
                        onBack: popOverlay,
                        onPlaySong: (song, ctx) => {
                            playSong(song, ctx, false);
                        },
                        onPlayAll: (songs) => {
                            playOnlineQueueFromStart(songs);
                        },
                        onAddAllToQueue: addNeteaseSongsToQueue,
                        onAddSongToQueue: addNeteaseSongToQueue,
                        onSelectAlbum: handleAlbumSelect,
                        onSelectArtist: handleArtistSelect,
                        currentUserId: user?.userId,
                        isLikedSongsPlaylist: playlists[0]?.id === topOverlay.playlist.id,
                        onPlaylistMutated: async () => {
                            await refreshUserData();
                        },
                        theme,
                        isDaylight,
                    },
                }
                : topOverlay.type === 'album'
                    ? {
                        type: 'album' as const,
                        props: {
                            key: `album-${topOverlay.id}-${overlayStack.length - 1}`,
                            albumId: topOverlay.id,
                            onBack: popOverlay,
                            onPlaySong: (song, ctx) => {
                                playSong(song, ctx, false);
                            },
                            onPlayAll: (songs) => {
                                playOnlineQueueFromStart(songs);
                            },
                            onAddAllToQueue: addNeteaseSongsToQueue,
                            onAddSongToQueue: addNeteaseSongToQueue,
                            onSelectArtist: handleArtistSelect,
                            theme,
                            isDaylight,
                        },
                    }
                    : {
                        type: 'artist' as const,
                        props: {
                            key: `artist-${topOverlay.id}-${overlayStack.length - 1}`,
                            artistId: topOverlay.id,
                            onBack: popOverlay,
                            onPlaySong: (song, ctx) => {
                                playSong(song, ctx, false);
                            },
                            onSelectAlbum: handleAlbumSelect,
                            theme,
                            isDaylight,
                        },
                    })
            : null,
        debugOverlay: isDev && currentView === 'player' && isDevDebugOverlayVisible
            ? {
                snapshot: devDebugSnapshot,
                currentTime,
                isDaylight,
            }
            : null,
        floatingControls: currentSong
            ? {
                currentSong,
                playerState,
                currentTime,
                duration,
                loopMode: effectiveLoopMode,
                currentView,
                audioSrc,
                canTogglePlay: canToggleCurrentPlayback,
                controlsDisabled: isNowPlayingControlDisabled,
                lyrics,
                onSeek: (time) => {
                    if (isNowPlayingControlDisabled) {
                        return;
                    }

                    if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                        syncStageLyricsClock(time, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                        currentTime.set(time);
                        if (playerState !== PlayerState.PLAYING) {
                            setPlayerState(PlayerState.PAUSED);
                        }
                    } else if (audioRef.current) {
                        audioRef.current.currentTime = time;
                        if (audioRef.current.paused) {
                            audioRef.current.play();
                            setPlayerState(PlayerState.PLAYING);
                        }
                    }
                },
                onTogglePlay: togglePlay,
                onToggleLoop: toggleLoop,
                onNavigateToPlayer: navigateToPlayer,
                noTrackText: t('ui.noTrack'),
                primaryColor: 'var(--text-primary)',
                secondaryColor: 'var(--text-secondary)',
                theme,
                isDaylight,
                isHidden: currentView === 'player' && isPlayerChromeHidden,
                hideControlBar: shouldHidePlayerProgressBar,
            }
            : null,
    });

    const appDialogsModel = useAppDialogsModel({
        statusToast: statusMsg ? { ...statusMsg, isDaylight } : null,
        lyricMatchDialog: showLyricMatchModal && currentSong && isLocalPlaybackSong(currentSong) && currentSong.localData
            ? {
                song: (currentSong as any).localData as LocalSong,
                onClose: () => setShowLyricMatchModal(false),
                onMatch: handleLyricMatchComplete,
                isDaylight,
            }
            : null,
        naviLyricMatchDialog: showNaviLyricMatchModal && currentSong && (currentSong as any).isNavidrome
            ? {
                song: (currentSong as any).navidromeData,
                onClose: () => setShowNaviLyricMatchModal(false),
                onMatch: handleNaviLyricMatchComplete,
                isDaylight,
            }
            : null,
        unavailableReplacementDialog: {
            isOpen: Boolean(pendingUnavailableReplacement),
            originalSong: pendingUnavailableReplacement?.originalSong || null,
            replacementSong: pendingUnavailableReplacement?.replacementSong || null,
            typeDesc: pendingUnavailableReplacement?.typeDesc,
            isDaylight,
            onClose: () => setPendingUnavailableReplacement(null),
            onConfirm: handleUnavailableReplacementConfirm,
        },
    });

    useEffect(() => {
        isNowPlayingControlDisabledRef.current = isNowPlayingControlDisabled;
    }, [isNowPlayingControlDisabled]);

    return (
        <AppShell
            appStyle={appStyle}
            isElectronWindow={isElectronWindow}
            isPlayerView={isPlayerView}
            isTitlebarRevealed={isTitlebarRevealed}
            audioElement={<audio
                ref={audioRef}
                src={audioSrc || undefined}
                crossOrigin="anonymous"
                loop={effectiveLoopMode === 'one'}
                onPlay={(e) => {
                    currentTime.set(e.currentTarget.currentTime);
                    setPlayerState(PlayerState.PLAYING);
                }}
                onPlaying={(e) => {
                    currentTime.set(e.currentTarget.currentTime);
                    setupAudioAnalyzer();
                    playbackAutoSkipCountRef.current = 0;
                    setPlayerState(PlayerState.PLAYING);
                }}
                onPause={(e) => {
                    if (!e.currentTarget.ended) {
                        setPlayerState(PlayerState.PAUSED);
                    }
                }}
                onTimeUpdate={(e) => {
                    const audioElement = e.currentTarget;
                    if (!audioElement.paused && !audioElement.ended) {
                        currentTime.set(audioElement.currentTime);
                        setPlayerState(PlayerState.PLAYING);
                    }
                }}
                onSeeked={(e) => {
                    currentTime.set(e.currentTarget.currentTime);
                }}
                onEnded={() => {
                    // Cache if playing fully
                    if (audioSrc && !audioSrc.startsWith('blob:') && currentSong && !isStagePlaybackSong(currentSong)) {
                        cacheSongAssets();
                    }

                    // If single loop is active, native loop handles it.
                    // If not, we handle queue logic.
                    if (effectiveLoopMode !== 'one') {
                        void handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
                    }
                }}
                onLoadedMetadata={(e) => {
                    const audioElement = e.currentTarget;
                    setDuration(audioElement.duration);

                    const pendingResumeTime = pendingResumeTimeRef.current;
                    if (pendingResumeTime !== null) {
                        const safeDuration = Number.isFinite(audioElement.duration) && audioElement.duration > 0
                            ? Math.max(audioElement.duration - 0.25, 0)
                            : pendingResumeTime;
                        const nextTime = Math.min(pendingResumeTime, safeDuration);
                        audioElement.currentTime = nextTime;
                        currentTime.set(nextTime);
                        pendingResumeTimeRef.current = null;
                        return;
                    }

                    currentTime.set(0); // Ensure currentTime is reset when new audio loads
                }}
                onError={(e) => {
                    if (!audioSrc) {
                        return;
                    }

                    const failedSrc = e.currentTarget.currentSrc || audioSrc;
                    const shouldRetryOnlineSong = Boolean(
                        currentSong &&
                        !isLocalPlaybackSong(currentSong) &&
                        !isNavidromePlaybackSong(currentSong) &&
                        !isStagePlaybackSong(currentSong) &&
                        failedSrc &&
                        !failedSrc.startsWith('blob:')
                    );

                    if (shouldRetryOnlineSong) {
                        void (async () => {
                            const recovered = await recoverOnlinePlaybackSource({
                                failedSrc,
                                resumeAt: e.currentTarget.currentTime,
                                autoplay: (!e.currentTarget.paused && !e.currentTarget.ended) || playerState === PlayerState.PLAYING || shouldAutoPlay.current,
                            });

                            if (!recovered) {
                                skipAfterPlaybackFailure();
                            }
                        })();
                        return;
                    }

                    skipAfterPlaybackFailure();
                }}
            />}
        >

            {/* --- VISUALIZER (Background Layer & Main Click Target) --- */}
            <div
                className="absolute inset-0 z-0"
                onClick={handleContainerClick}
            >
                <VisualizerRenderer
                    mode={visualizerMode}
                    currentTime={currentTime}
                    currentLineIndex={currentLineIndex}
                    lines={lyrics?.lines || []}
                    theme={visualizerTheme}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    coverUrl={getCoverUrl()}
                    showText={currentView === 'player'}
                    useCoverColorBg={useCoverColorBg}
                    seed={visualizerGeometrySeed}
                    staticMode={staticMode}
                    paused={shouldPauseVisualizerBackground}
                    backgroundOpacity={backgroundOpacity}
                    lyricsFontScale={lyricsFontScale}
                    isPlayerChromeHidden={isPlayerChromeHidden}
                    hideTranslationSubtitle={shouldHidePlayerTranslationSubtitle}
                    cadenzaTuning={cadenzaTuning}
                    partitaTuning={partitaTuning}
                    fumeTuning={fumeTuning}
                    onBack={navigateToHome}
                />
            </div>

            {currentView === 'player' && activePlaybackContext === 'stage' && (!stageActiveEntryKind || stageSource === 'now-playing') && !currentSong && (
                <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center px-6">
                    <div className={`max-w-lg rounded-3xl border px-6 py-5 text-center backdrop-blur-md ${isDaylight ? 'border-black/10 bg-white/50 text-zinc-800' : 'border-white/10 bg-black/30 text-white'}`}>
                        <div className="text-xs uppercase tracking-[0.22em] opacity-50">
                            {stageSource === 'now-playing' ? 'Stage · Now Playing' : 'Stage · Stage API'}
                        </div>
                        <div className="mt-3 text-2xl font-semibold">
                            {stageSource === 'now-playing'
                                ? '等待本地 Now Playing 服务输入'
                                : (t('options.stageSessionEmpty') || '等待外部输入')}
                        </div>
                        <div className="mt-2 text-sm opacity-70">
                            {stageSource === 'now-playing'
                                ? (nowPlayingConnectionStatus === 'error'
                                    ? '未能连接到 ws://localhost:9863/api/ws/lyric，请确认 now-playing 服务已在本机运行'
                                    : '请在本机启动 now-playing 服务，并确保播放器正在播放')
                                : (t('options.enableStageModeDesc') || '本地 Stage API 已开启')}
                        </div>
                    </div>
                </div>
            )}

            <AppOverlays model={appOverlaysModel} />

            {currentView === 'player' && !showLyricMatchModal && (
                <PlayerPanel model={playerPanelModel} />
            )}

            <AppDialogs model={appDialogsModel} />
        </AppShell>
    );
}
