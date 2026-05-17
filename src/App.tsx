import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LyricParserFactory } from './utils/lyrics/LyricParserFactory';
import { saveSessionData, getSessionData, getFromCache, getFromCacheWithMigration, saveToCache, getLocalSongs, removeFromCache, clearCacheByCategory } from './services/db';
import { getCachedAudioBlob, hasCachedAudio, saveAudioBlob } from './services/audioCache';
import { getCachedCoverUrl, loadCachedOrFetchCover } from './services/coverCache';
import { ensureLocalSongEmbeddedCover, getAudioFromLocalSong } from './services/localMusicService';
import { loadOnlineSongAudioSource, loadOnlineSongLyrics } from './services/onlinePlayback';
import { buildLocalQueue, buildNavidromeQueue, buildUnifiedLocalSong, buildUnifiedNavidromeSong } from './services/playbackAdapters';
import { getPrefetchedData, prefetchNearbySongs, invalidateAndRefetch, invalidatePrefetchedLyrics } from './services/prefetchService';
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
import { LyricData, Theme, PlayerState, SongResult, LocalSong, ReplayGainMode, LocalLibraryGroup, LocalPlaylist, UnifiedSong, StatusMessage, PlaybackContext, StageLoopMode } from './types';
import { NavidromeSong, NavidromeViewSelection } from './types/navidrome';
import { NavidromeMatchData } from './components/modal/NaviLyricMatchModal';
import { NextTrackOptions, PlaybackNavigationOptions, SkipPromptMessageKey, UnavailableReplacementRequest } from './types/appPlayback';
import { getOnlineSongCacheKey, isCloudSong, isSongMarkedUnavailable, neteaseApi } from './services/netease';
import { navidromeApi, getNavidromeConfig } from './services/navidromeService';
import { addSongsToLocalPlaylist, createLocalPlaylist, getLocalPlaylists, removeSongsFromLocalPlaylist, setLocalSongFavorite } from './services/localPlaylistService';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useNeteaseLibrary } from './hooks/useNeteaseLibrary';
import { useAppPreferences } from './hooks/useAppPreferences';
import { useElectronPlaybackBridge } from './hooks/useElectronPlaybackBridge';
import { useMediaSessionBridge } from './hooks/useMediaSessionBridge';
import { usePlaybackUiEffects } from './hooks/usePlaybackUiEffects';
import { useSessionRestoreController } from './hooks/useSessionRestoreController';
import { useStagePlaybackController } from './hooks/useStagePlaybackController';
import { useThemeController } from './hooks/useThemeController';
import { useSearchNavigationStore } from './stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from './utils/appNavidromeLyrics';
import { clampMediaVolume, extractCloudLyricText, findLatestActiveLineIndex, formatTime, getAudioSrcKind, hasRenderableLyrics, replayGainModeLabels, resolveDebugLyricsSource, resolveDebugSongSource, toDebugLineSnapshot, toSafeRemoteUrl } from './utils/appPlaybackHelpers';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong, resolveNavidromePlaybackCarrier } from './utils/appPlaybackGuards';
import { getNextLoopMode, getStageLyricsTimelineBounds } from './utils/appStageHelpers';
import { isPureMusicLyricText } from './utils/lyrics/pureMusic';
import { ensureLyricDataRenderHints, getLineRenderHints, migrateLyricDataRenderHints } from './utils/lyrics/renderHints';
import { migrateMatchedLyricsCarrierRenderHints } from './utils/lyrics/storageMigration';
import { processNeteaseLyrics } from './utils/lyrics/neteaseProcessing';
import { applyLyricDisplayFilter } from './utils/lyrics/filtering';

const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
const LOCAL_PREWARM_OFFSETS = [-1, 1, 2] as const;
const LOCAL_PREWARM_DELAY_MS = 1000;
const DEV_DEBUG_SHORTCUT_LABEL = 'Alt+Shift+D';
const ONLINE_AUDIO_URL_TTL_MS = 1200 * 1000;
const ONLINE_AUDIO_URL_REFRESH_BUFFER_MS = 60 * 1000;
const MAX_UNAVAILABLE_AUTO_SKIP_COUNT = 2;
const UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS = 5000;
const UNAVAILABLE_SKIP_CONFIRM_INTERVAL_MS = 1000;

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
    const previousAudioSrcRef = useRef<string | null>(null);
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
    const replayGainLogSignatureRef = useRef<string | null>(null);
    const volumePreviewFrameRef = useRef<number | null>(null);
    const pendingVolumePreviewRef = useRef<number | null>(null);
    const pendingResumeTimeRef = useRef<number | null>(null);
    const onlinePlaybackRecoveryRef = useRef<Promise<boolean> | null>(null);
    const lastAudioRecoverySourceRef = useRef<string | null>(null);
    const currentOnlineAudioUrlFetchedAtRef = useRef<number | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const [pendingUnavailableReplacement, setPendingUnavailableReplacement] = useState<UnavailableReplacementRequest | null>(null);
    const isNowPlayingControlDisabledRef = useRef(false);

    // Local Music State
    const [localSongs, setLocalSongs] = useState<LocalSong[]>([]);
    const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([]);
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

    const loadLocalSongs = async () => {
        try {
            const songs = await getLocalSongs();
            setLocalSongs(songs);
        } catch (error) {
            console.error('Failed to load local songs:', error);
        }
    };

    const loadLocalPlaylists = useCallback(async () => {
        try {
            const playlists = await getLocalPlaylists();
            setLocalPlaylists(playlists);
        } catch (error) {
            console.error('Failed to load local playlists:', error);
        }
    }, []);

    const onRefreshLocalSongs = async () => {
        await loadLocalSongs();
        await loadLocalPlaylists();
    };

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

    const getFavoriteLocalPlaylist = useMemo(
        () => localPlaylists.find(playlist => playlist.isFavorite) ?? null,
        [localPlaylists]
    );

    const isLocalSongLiked = useCallback((song: SongResult | null) => {
        if (!song || !isLocalPlaybackSong(song) || !song.localData || !getFavoriteLocalPlaylist) {
            return false;
        }

        return getFavoriteLocalPlaylist.songIds.includes(song.localData.id);
    }, [getFavoriteLocalPlaylist]);

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

    const saveCurrentQueueAsLocalPlaylist = useCallback(async (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        const queueSongs = playQueue
            .map(song => (song as any).localData as LocalSong | undefined)
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
    }, [currentSong, loadLocalPlaylists, t]);

    const addCurrentSongToNeteasePlaylist = useCallback(async (playlistId: number) => {
        if (!currentSong || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            throw new Error('Current song is not a Netease song');
        }

        await neteaseApi.updatePlaylistTracks('add', playlistId, [currentSong.id]);
        await removeFromCache(`playlist_tracks_${playlistId}`);
        await removeFromCache(`playlist_detail_${playlistId}`);
        await refreshUserData();
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '歌单已更新' });
    }, [currentSong, refreshUserData, t]);

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
    }, [currentSong, t]);

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
    }, [currentSong, t]);

    const handleLocalSongMatch = async (localSong: LocalSong): Promise<{ updatedLocalSong: LocalSong, matchedSongResult: SongResult | null; }> => {
        let updatedLocalSong = localSong;
        let matchedSongResult: SongResult | null = null;

        // Only match online if: no local lyrics AND (no matched lyrics OR no matched cover) AND auto-match is enabled
        const needsLyricsMatch = !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics && !localSong.matchedLyrics;
        const needsCoverMatch = !localSong.embeddedCover && !localSong.matchedCoverUrl;
        if ((needsLyricsMatch || needsCoverMatch) && !localSong.noAutoMatch) {
            setStatusMsg({ type: 'info', text: '正在匹配歌词和封面...' });
            try {
                const { matchLyrics } = await import('./services/localMusicService');
                await matchLyrics(localSong);

                // Reload local song to pick up cover-only or metadata-only matches as well.
                const updatedSongs = await getLocalSongs();
                const found = updatedSongs.find(s => s.id === localSong.id);

                if (found) {
                    updatedLocalSong = found;

                    // Get full matched song details for UI
                    if (found.matchedSongId) {
                        try {
                            const searchRes = await neteaseApi.cloudSearch(
                                localSong.artist
                                    ? `${localSong.artist} ${localSong.title}`
                                    : localSong.title || localSong.fileName
                            );
                            if (searchRes.result?.songs) {
                                matchedSongResult = searchRes.result.songs.find(s => s.id === found.matchedSongId) || searchRes.result.songs[0];
                            }
                        } catch (e) {
                            console.warn('Failed to get matched song details:', e);
                        }
                    }
                }
            } catch (error) {
                console.warn('Auto-match failed:', error);
            }
            // Refresh local songs list in App state
            await loadLocalSongs();
        }

        return { updatedLocalSong, matchedSongResult };
    };

    const resolveLocalMetadataUI = async (localData: LocalSong, matchedSong: SongResult | null) => {
        let embeddedCoverUrl: string | null = null;
        if (localData.embeddedCover) {
            embeddedCoverUrl = URL.createObjectURL(localData.embeddedCover);
        }

        const preferOnlineCover = localData.useOnlineCover === true;
        const preferOnlineMetadata = localData.useOnlineMetadata === true;

        const coverUrl = preferOnlineCover
            ? (localData.matchedCoverUrl || embeddedCoverUrl || null)
            : (embeddedCoverUrl || localData.matchedCoverUrl || null);

        let lyrics: LyricData | null = null;
        const source = localData.lyricsSource;
        if (source === 'online' && localData.matchedLyrics) {
            lyrics = localData.matchedLyrics;
        } else if (source === 'embedded' && localData.embeddedLyricsContent) {
            lyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
        } else if (source === 'local' && localData.localLyricsContent) {
            lyrics = await LyricParserFactory.parse({ type: 'local', lrcContent: localData.localLyricsContent, tLrcContent: localData.localTranslationLyricsContent });
        } else if (!source) {
            if (localData.hasLocalLyrics && localData.localLyricsContent) {
                lyrics = await LyricParserFactory.parse({ type: 'local', lrcContent: localData.localLyricsContent, tLrcContent: localData.localTranslationLyricsContent });
            } else if (localData.hasEmbeddedLyrics && localData.embeddedLyricsContent) {
                lyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: localData.embeddedLyricsContent, translationContent: localData.embeddedTranslationLyricsContent });
            } else if (localData.matchedLyrics) {
                lyrics = localData.matchedLyrics;
            }
        }

        const unifiedSong = buildUnifiedLocalSong({
            localSong: localData,
            matchedSong,
            coverUrl,
            preferOnlineMetadata,
        });

        return { lyrics, coverUrl, unifiedSong };
    };

    const loadCurrentSongLyricPreview = useCallback(async (): Promise<LyricData | null> => {
        if (!currentSong) {
            return null;
        }

        if (isLocalPlaybackSong(currentSong) && currentSong.localData) {
            const localData = currentSong.localData;
            const source = localData.lyricsSource;

            if (source === 'online' && localData.matchedLyrics) {
                return localData.matchedLyrics;
            }
            if (source === 'embedded' && localData.embeddedLyricsContent) {
                return await LyricParserFactory.parse({
                    type: 'embedded',
                    textContent: localData.embeddedLyricsContent,
                    translationContent: localData.embeddedTranslationLyricsContent,
                });
            }
            if (source === 'local' && localData.localLyricsContent) {
                return await LyricParserFactory.parse({
                    type: 'local',
                    lrcContent: localData.localLyricsContent,
                    tLrcContent: localData.localTranslationLyricsContent,
                });
            }
            if (!source) {
                if (localData.hasLocalLyrics && localData.localLyricsContent) {
                    return await LyricParserFactory.parse({
                        type: 'local',
                        lrcContent: localData.localLyricsContent,
                        tLrcContent: localData.localTranslationLyricsContent,
                    });
                }
                if (localData.hasEmbeddedLyrics && localData.embeddedLyricsContent) {
                    return await LyricParserFactory.parse({
                        type: 'embedded',
                        textContent: localData.embeddedLyricsContent,
                        translationContent: localData.embeddedTranslationLyricsContent,
                    });
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

            if ((navidromeSong as any).lyricsSource === 'online' && (navidromeSong as any).matchedLyrics) {
                return (navidromeSong as any).matchedLyrics as LyricData;
            }

            let resolved = await resolvePreferredNavidromeLyrics(navidromeSong);
            if (resolved) {
                return resolved;
            }

            const config = getNavidromeConfig();
            if (config) {
                await hydrateNavidromeLyricPayload(config, navidromeSong);
                resolved = await resolvePreferredNavidromeLyrics(navidromeSong);
                if (resolved) {
                    return resolved;
                }
            }

            return lyrics;
        }

        const onlineSong = currentSong;
        const cachedLyrics = await getFromCacheWithMigration<LyricData>(
            getOnlineSongCacheKey('lyric', onlineSong),
            migrateLyricDataRenderHints
        );
        if (cachedLyrics) {
            return cachedLyrics;
        }

        const prefetched = getPrefetchedData(onlineSong, audioQuality);
        if (prefetched?.lyrics) {
            return prefetched.lyrics;
        }

        if (isCloudSong(onlineSong) && user?.userId) {
            const lyricRes = await neteaseApi.getCloudLyric(user.userId, onlineSong.id);
            const mainLrc = extractCloudLyricText(lyricRes);
            if (!mainLrc || isPureMusicLyricText(mainLrc)) {
                return null;
            }

            return await LyricParserFactory.parse({
                type: 'local',
                lrcContent: mainLrc,
            });
        }

        const lyricRes = await neteaseApi.getLyric(onlineSong.id);
        return (await processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricRes))).lyrics;
    }, [audioQuality, currentSong, lyrics, user?.userId]);

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

    const handleLocalQueueAdd = async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        const { unifiedSong } = await resolveLocalMetadataUI(preparedLocalSong, null);
        const exists = playQueue.some(song => song.id === unifiedSong.id);
        const nextQueue = exists ? playQueue : [...playQueue, unifiedSong];

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(currentSong, nextQueue);
        setStatusMsg({ type: 'success', text: t('status.queueUpdated') || '已添加到播放队列' });
    };

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

    const prewarmLocalSongMetadata = async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        Object.assign(localSong, preparedLocalSong);

        const needsLyricsMatch = !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics && !localSong.matchedLyrics;
        const needsCoverMatch = !localSong.embeddedCover && !localSong.matchedCoverUrl;

        if ((needsLyricsMatch || needsCoverMatch) && !localSong.noAutoMatch) {
            try {
                const { matchLyrics } = await import('./services/localMusicService');
                await matchLyrics(localSong);
            } catch (error) {
                console.warn('[LocalPrewarm] Failed to prewarm local song metadata:', error);
            }
        }
    };

    const prewarmNearbyLocalSongs = (currentSong: LocalSong, queue: LocalSong[] = []) => {
        if (queue.length === 0) {
            return;
        }

        const currentIndex = queue.findIndex(song => song.id === currentSong.id);
        if (currentIndex === -1) {
            return;
        }

        const nearbySongs = LOCAL_PREWARM_OFFSETS
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
        }, LOCAL_PREWARM_DELAY_MS);
    };

    const onPlayLocalSong = async (localSong: LocalSong, queue: LocalSong[] = []) => {
        interruptStagePlaybackForMainTransition();

        // Get audio blob from fileHandle first
        const blobUrl = await getAudioFromLocalSong(localSong);
        if (!blobUrl) {
            setStatusMsg({
                type: 'error',
                text: '无法访问文件，请重新导入文件夹'
            });
            return;
        }

        const preparedLocalSong = await ensureLocalSongEmbeddedCover(localSong);
        const initialMeta = await resolveLocalMetadataUI(preparedLocalSong, null);

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = blobUrl;

        shouldAutoPlay.current = true;
        currentSongRef.current = initialMeta.unifiedSong.id;

        setLyrics(initialMeta.lyrics);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setCurrentSong(initialMeta.unifiedSong);
        setAudioSrc(blobUrl);

        if (initialMeta.coverUrl) {
            loadCachedOrFetchCover(`cover_local_${preparedLocalSong.id}`, initialMeta.coverUrl).then(res => {
                if (currentSongRef.current === initialMeta.unifiedSong.id) setCachedCoverUrl(res);
            });
        } else {
            setCachedCoverUrl(null);
        }

        setIsLyricsLoading(true); // Assuming we might fetch more metadata online

        // Set queue
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

        // --- Background Auto-Match ---
        handleLocalSongMatch(preparedLocalSong).then(async ({ updatedLocalSong, matchedSongResult }) => {
            if (currentSongRef.current !== initialMeta.unifiedSong.id) return; // User skipped track
            
            const updatedMeta = await resolveLocalMetadataUI(updatedLocalSong, matchedSongResult);
            
            setCurrentSong(updatedMeta.unifiedSong);
            setLyrics(updatedMeta.lyrics);
            setIsLyricsLoading(false);

            if (updatedMeta.coverUrl && updatedMeta.coverUrl !== initialMeta.coverUrl) {
                loadCachedOrFetchCover(`cover_local_${updatedLocalSong.id}`, updatedMeta.coverUrl).then(res => {
                    if (currentSongRef.current === updatedMeta.unifiedSong.id) setCachedCoverUrl(res);
                });
            } else if (!updatedMeta.coverUrl) {
                setCachedCoverUrl(null);
            }
        });
    };

    // --- Navidrome Playback ---
    const onPlayNavidromeSong = async (
        navidromeSong: NavidromeSong,
        queue: NavidromeSong[] = [],
        options: PlaybackNavigationOptions = {}
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
            // Get streaming URL using navidromeData.id
            const navidromeId = navidromeSong.navidromeData.id;
            const streamUrl = navidromeApi.getStreamUrl(config, navidromeId);

            // Fetch match data if available
            const matchData = await getFromCacheWithMigration<NavidromeMatchData>(
                `navidrome_match_${navidromeId}`,
                migrateMatchedLyricsCarrierRenderHints
            );

            let lyrics: LyricData | null = null;
            let coverUrl: string | undefined;
            let showedLoadingToast = false;

            if (matchData) {
                if (matchData.lyricsSource === 'online' && matchData.matchedLyrics) {
                    lyrics = matchData.matchedLyrics;
                    console.log('[App] Using manually matched OpenSubsonic online lyrics');
                }
                if (matchData.useOnlineCover && matchData.matchedCoverUrl) {
                    coverUrl = matchData.matchedCoverUrl;
                }
            }

            if (!lyrics) {
                lyrics = await resolvePreferredNavidromeLyrics(navidromeSong);
                if (hasRenderableLyrics(lyrics)) {
                    console.log('[App] Using cached Navidrome lyrics');
                }
            }

            if (!lyrics) {
                if (!showedLoadingToast) {
                    setStatusMsg({ type: 'info', text: t('status.loadingSong') || '加载歌曲中...' });
                    showedLoadingToast = true;
                }
                await hydrateNavidromeLyricPayload(config, navidromeSong);
                lyrics = await resolvePreferredNavidromeLyrics(navidromeSong);
                if (hasRenderableLyrics(lyrics)) {
                    console.log('[App] Using embedded Navidrome lyrics');
                }
            }

            // If no lyrics from Navidrome, try Netease (Auto Match)
            let isAutoMatched = false;
            let autoMatchedLyrics: LyricData | null = null;
            if (!lyrics && !matchData?.noAutoMatch) {
                try {
                    if (!showedLoadingToast) {
                        setStatusMsg({ type: 'info', text: t('status.loadingSong') || '加载歌曲中...' });
                        showedLoadingToast = true;
                    }
                    const artistName = navidromeSong.artists?.[0]?.name || navidromeSong.ar?.[0]?.name || '';
                    const searchQuery = `${navidromeSong.name} ${artistName}`.trim();
                    const searchRes = await neteaseApi.cloudSearch(searchQuery, 1);

                    if (searchRes.result?.songs?.length > 0) {
                        const matchedSong = searchRes.result.songs[0];
                        const lyricRes = await neteaseApi.getLyric(matchedSong.id);
                        const processed = await processNeteaseLyrics({
                            type: 'netease',
                            ...lyricRes
                        });

                        lyrics = processed.lyrics;
                        (navidromeSong as any).matchedIsPureMusic = processed.isPureMusic;
                        
                        if (lyrics || processed.isPureMusic) {
                            autoMatchedLyrics = lyrics;
                            isAutoMatched = true;
                            console.log('[App] Using Netease lyrics for Navidrome song');
                        }
                    }
                } catch (e) {
                    console.warn('[App] Failed to fetch Netease lyrics for Navidrome song:', e);
                }
            }

            // Attach match properties for NaviTab logic
            if (isAutoMatched) {
                (navidromeSong as any).matchedLyrics = autoMatchedLyrics;
                (navidromeSong as any).useOnlineLyrics = true;
                (navidromeSong as any).lyricsSource = 'online';
            } else {
                (navidromeSong as any).matchedLyrics = matchData?.matchedLyrics;
                (navidromeSong as any).matchedIsPureMusic = matchData?.matchedIsPureMusic;
                (navidromeSong as any).useOnlineLyrics = matchData?.useOnlineLyrics;
                (navidromeSong as any).lyricsSource =
                    matchData?.lyricsSource === 'online'
                        ? 'online'
                        : (hasRenderableLyrics(lyrics) ? 'navi' : matchData?.lyricsSource);
            }

            // Get cover art URL
            if (!coverUrl) {
                coverUrl = navidromeSong.album?.picUrl || navidromeSong.al?.picUrl ||
                    navidromeApi.getCoverArtUrl(config, navidromeId);
            }

            // Create unified song for playback
            const unifiedSong = buildUnifiedNavidromeSong(navidromeSong, {
                coverUrl,
                useOnlineMetadata: matchData?.useOnlineMetadata,
                matchedArtists: matchData?.matchedArtists,
                matchedAlbumName: matchData?.matchedAlbumName,
            });

            // Enable autoplay
            shouldAutoPlay.current = true;
            currentSongRef.current = unifiedSong.id;

            // Set UI state
            setLyrics(lyrics);
            setCurrentLineIndex(-1);
            currentTime.set(0);
            setCurrentSong(unifiedSong);
            setCachedCoverUrl(coverUrl);
            setAudioSrc(streamUrl);
            setIsLyricsLoading(false);

            // Set queue
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
        } catch (e) {
            console.error('[App] Failed to play Navidrome song:', e);
            setStatusMsg({ type: 'error', text: '播放失败' });
            setIsLyricsLoading(false);
        }
    };

    // --- Navidrome Lyric Matching ---
    const onMatchNavidromeSong = async (navidromeSong: NavidromeSong) => {
        // This opens the lyric matching modal for Navidrome songs
        // For now, we'll use a similar approach to local song matching
        // The actual matching will be handled when playing the song
        setStatusMsg({ type: 'info', text: t('navidrome.fetchingLyrics') || '正在匹配歌词...' });
    };

    // --- Effects ---

    const clearPendingUnavailableSkip = useCallback(() => {
        if (pendingUnavailableSkipTimerRef.current !== null) {
            window.clearTimeout(pendingUnavailableSkipTimerRef.current);
            pendingUnavailableSkipTimerRef.current = null;
        }

        if (pendingUnavailableSkipIntervalRef.current !== null) {
            window.clearInterval(pendingUnavailableSkipIntervalRef.current);
            pendingUnavailableSkipIntervalRef.current = null;
        }
    }, []);

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

    const getPlayableOnlineQueue = useCallback((queue: SongResult[]) => {
        return queue.filter(queuedSong => {
            if (isLocalPlaybackSong(queuedSong) || isNavidromePlaybackSong(queuedSong)) {
                return true;
            }
            return !isSongMarkedUnavailable(queuedSong);
        });
    }, []);

    const getNextPlayableQueueSong = useCallback((queue: SongResult[], songId: number) => {
        const currentIndex = queue.findIndex(queuedSong => queuedSong.id === songId);
        if (currentIndex === -1) {
            return null;
        }

        for (let index = currentIndex + 1; index < queue.length; index += 1) {
            const candidate = queue[index];
            if (isLocalPlaybackSong(candidate) || isNavidromePlaybackSong(candidate) || !isSongMarkedUnavailable(candidate)) {
                return candidate;
            }
        }

        if (loopMode === 'all' && queue.length > 1) {
            for (let index = 0; index < currentIndex; index += 1) {
                const candidate = queue[index];
                if (isLocalPlaybackSong(candidate) || isNavidromePlaybackSong(candidate) || !isSongMarkedUnavailable(candidate)) {
                    return candidate;
                }
            }
        }

        return null;
    }, [loopMode]);

    const buildQueueWithReplacementSong = useCallback((
        queue: SongResult[],
        originalSong: SongResult,
        replacementSong: SongResult
    ) => {
        const normalizedQueue = queue.length > 0 ? queue : [originalSong];
        const replacedQueue = normalizedQueue.flatMap((queuedSong) => {
            if (isLocalPlaybackSong(queuedSong) || isNavidromePlaybackSong(queuedSong)) {
                return [queuedSong];
            }

            if (queuedSong.id === originalSong.id) {
                return [replacementSong];
            }

            if (isSongMarkedUnavailable(queuedSong)) {
                return [];
            }

            return [queuedSong];
        });

        if (replacedQueue.length === 0) {
            return [replacementSong];
        }

        if (!replacedQueue.some((queuedSong) => queuedSong.id === replacementSong.id)) {
            replacedQueue.push(replacementSong);
        }

        return replacedQueue;
    }, []);

    const handleMarkedUnavailableSong = useCallback(async (
        song: SongResult,
        queue: SongResult[],
        isFmCall: boolean,
        options: PlaybackNavigationOptions
    ) => {
        setIsLyricsLoading(false);
        setStatusMsg({ type: 'info', text: t('status.loadingSong') });
        try {
            const replacement = await neteaseApi.getUnavailableSongReplacement(song);

            if (!replacement || !replacement.replacementSong || isSongMarkedUnavailable(replacement.replacementSong)) {
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                return true;
            }

            setStatusMsg(null);
            setPendingUnavailableReplacement({
                originalSong: song,
                replacementSong: replacement.replacementSong,
                replacementSongId: replacement.replacementSongId,
                typeDesc: replacement.typeDesc,
                queue,
                isFmCall,
                options,
            });
            return true;
        } catch (error) {
            console.error('[App] Failed to load replacement song before dialog:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            return true;
        }
    }, [t]);

    const showTimedSkipPrompt = useCallback((
        messageKey: SkipPromptMessageKey,
        onSkip: () => void,
        onCancel?: () => void
    ) => {
        clearPendingUnavailableSkip();

        let remainingSeconds = Math.ceil(UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS / 1000);
        const skip = () => {
            clearPendingUnavailableSkip();
            setStatusMsg(null);
            onSkip();
        };
        const cancel = () => {
            clearPendingUnavailableSkip();
            setStatusMsg(null);
            onCancel?.();
        };
        const buildMessage = (seconds: number): StatusMessage => ({
            type: 'error',
            text: t(messageKey, { seconds }),
            persistent: true,
            actionLabel: t('status.skipUnavailableAction'),
            cancelLabel: t('status.cancel'),
            onAction: skip,
            onCancel: cancel,
        });

        setStatusMsg(buildMessage(remainingSeconds));
        pendingUnavailableSkipTimerRef.current = window.setTimeout(skip, UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS);
        pendingUnavailableSkipIntervalRef.current = window.setInterval(() => {
            remainingSeconds -= 1;
            if (remainingSeconds <= 0) {
                if (pendingUnavailableSkipIntervalRef.current !== null) {
                    window.clearInterval(pendingUnavailableSkipIntervalRef.current);
                    pendingUnavailableSkipIntervalRef.current = null;
                }
                return;
            }

            setStatusMsg(current => {
                if (!current?.persistent) {
                    return current;
                }
                return buildMessage(remainingSeconds);
            });
        }, UNAVAILABLE_SKIP_CONFIRM_INTERVAL_MS);
    }, [clearPendingUnavailableSkip, t]);

    // Audio Analyzer Setup
    // TODO: LOW PRIORITY::
    // Currently if a song contains rapidly changing audio, the analyzer can't keep up and causes a weird frame-skip-like effect on the gemotries(they seem to be static, like too slow to keep up), but this dosen't causes real visual stutter or audio issues, just the GeometricBackground is not responsive to the audio changes.
    // Very likely caused by
    //             analyser.smoothingTimeConstant = 0.6;
    // What do you think? Lowering the smoothingTimeConstant can make the analyzer more responsive, but it will also make it more jittery and less smooth, which might not look good for the visualizer. It's a trade-off between responsiveness and visual quality. We can experiment with different values to find a good balance. Maybe we can even make it dynamic based on the song's audio characteristics, but that might be overkill for now.
    const setupAudioAnalyzer = () => {
        if (!audioRef.current || sourceRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;

            const gainNode = ctx.createGain();
            gainNodeRef.current = gainNode;

            const source = ctx.createMediaElementSource(audioRef.current);
            source.connect(gainNode);
            gainNode.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
            syncOutputGain(getTargetPlaybackVolume(), 0);
        } catch (e) {
            console.error("Audio Context Setup Failed:", e);
        }
    };

    const playSong = async (
        song: SongResult,
        queue: SongResult[] = [],
        isFmCall: boolean = false,
        options: PlaybackNavigationOptions = {}
    ) => {
        const restoredMainSnapshot = interruptStagePlaybackForMainTransition();

        console.log("[App] playSong initiated:", song.name, song.id, "isFm:", isFmCall);
        clearPendingUnavailableSkip();
        setStatusMsg(prev => prev?.persistent ? null : prev);
        const shouldNavigateToPlayer = options.shouldNavigateToPlayer ?? true;
        setIsFmMode(isFmCall);
        if (isFmCall && !isFmMode) {
            // Only auto-open panel when first entering FM mode
            setPanelTab('queue');
            setIsPanelOpen(true);
        }

        const playbackRequestId = ++playbackRequestIdRef.current;
        const isLatestPlaybackRequest = () => playbackRequestIdRef.current === playbackRequestId;
        const isLocal = isLocalPlaybackSong(song);
        const isNavidrome = isNavidromePlaybackSong(song);
        let prefetched: ReturnType<typeof getPrefetchedData> = null;
        let preloadedOnlineAudioResult: Awaited<ReturnType<typeof loadOnlineSongAudioSource>> | null = null;
        const mainQueueContext = restoredMainSnapshot?.playQueue ?? playQueue;
        const queueContext = queue.length > 0 ? queue : mainQueueContext.length === 0 ? [song] : mainQueueContext;
        let newQueue = getPlayableOnlineQueue(queueContext);
        const skipCount = options.unavailableSkipCount ?? 0;
        playbackAutoSkipCountRef.current = skipCount;

        if (!isLocal && !isNavidrome && isSongMarkedUnavailable(song)) {
            if (await handleMarkedUnavailableSong(song, queueContext, isFmCall, options)) {
                return;
            }
        }

        if (!isLocal && !isNavidrome) {
            prefetched = getPrefetchedData(song, audioQuality);

            const hasImmediatePrefetchedAudio = Boolean(
                prefetched?.audioUrl &&
                prefetched.audioUrl !== 'CACHED_IN_DB'
            );
            const hasCachedAudioBlob = hasImmediatePrefetchedAudio
                ? null
                : await hasCachedAudio(getOnlineSongCacheKey('audio', song));

            if (!isLatestPlaybackRequest()) return;

            if (!hasImmediatePrefetchedAudio && !hasCachedAudioBlob) {
                setStatusMsg({ type: 'info', text: t('status.loadingSong') });
            }

            try {
                preloadedOnlineAudioResult = await loadOnlineSongAudioSource(song, audioQuality, prefetched);
                if (!isLatestPlaybackRequest()) {
                    if (preloadedOnlineAudioResult.kind === 'ok' && preloadedOnlineAudioResult.blobUrl) {
                        URL.revokeObjectURL(preloadedOnlineAudioResult.blobUrl);
                    }
                    return;
                }

                if (preloadedOnlineAudioResult.kind === 'unavailable') {
                    console.warn("[App] Song URL is empty, likely unavailable");

                    const nextSong = getNextPlayableQueueSong(queueContext, song.id);
                    const canSkip = Boolean(nextSong) && skipCount < MAX_UNAVAILABLE_AUTO_SKIP_COUNT;

                    setIsLyricsLoading(false);

                    if (canSkip && nextSong) {
                        showTimedSkipPrompt('status.songUnavailablePrompt', () => {
                            if (playbackRequestIdRef.current !== playbackRequestId) return;
                            void playSong(nextSong, newQueue, isFmCall, {
                                ...options,
                                unavailableSkipCount: skipCount + 1
                            });
                        });
                    } else {
                        setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                    }
                    return;
                }
            } catch (e) {
                console.error("[App] Failed to fetch song URL:", e);
                setStatusMsg({ type: 'error', text: t('status.playbackError') });
                setIsLyricsLoading(false);
                return;
            }
        }

        // Enable autoplay for user-initiated song changes
        shouldAutoPlay.current = true;
        currentSongRef.current = song.id;
        pendingResumeTimeRef.current = null;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;

        // 0. Instant UI Feedback
        setLyrics(null);
        setCurrentLineIndex(-1);
        currentTime.set(0); // Reset currentTime to prevent stale playback position
        setDuration(0);
        setCurrentSong(song);
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setIsLyricsLoading(true); // Start loading lyrics

        // Revoke old blob
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }

        // 1. Queue Management
        if (queue.length > 0) {
            setPlayQueue(newQueue);
        } else if (playQueue.length === 0) {
            setPlayQueue(newQueue);
        }

        // Save for next reload
        void persistLastPlaybackCache(song, newQueue);

        if (shouldNavigateToPlayer) {
            navigateToPlayer();
        }
        setPlayerState(PlayerState.IDLE);

        if (isNavidrome) {
            const navidromeSong = resolveNavidromePlaybackCarrier(song);
            if (!navidromeSong) {
                setStatusMsg({ type: 'error', text: t('status.playbackError') });
                setIsLyricsLoading(false);
                return;
            }

            const navidromeQueue = queue.length > 0
                ? queue
                    .map(queuedSong => resolveNavidromePlaybackCarrier(queuedSong))
                    .filter((queuedSong): queuedSong is NavidromeSong => Boolean(queuedSong))
                : playQueue
                    .map(queuedSong => resolveNavidromePlaybackCarrier(queuedSong))
                    .filter((queuedSong): queuedSong is NavidromeSong => Boolean(queuedSong));

            await onPlayNavidromeSong(navidromeSong, navidromeQueue, { shouldNavigateToPlayer: false });
            return;
        }

        if (isLocal) {
            console.log("[App] Playing Local Song");

            // 2. Load Local Audio
            let blobUrl: string | null = null;
            let currentLocalData = (song as any).localData;

            // Try to get blob from localData if available
            if (currentLocalData) {
                blobUrl = await getAudioFromLocalSong(currentLocalData);
            }
            // If not in song object (e.g. from queue restoration), try to find in localSongs list
            else {
                // Try to match by name/duration as fallback
                const found = localSongs.find(ls =>
                    (ls.title || ls.fileName) === song.name &&
                    Math.abs(ls.duration - song.duration) < 1000
                );
                if (found) {
                    currentLocalData = found;
                    blobUrl = await getAudioFromLocalSong(found);
                }
            }

            if (blobUrl) {
                blobUrlRef.current = blobUrl;
                setAudioSrc(blobUrl);

                // 3. Instant Local Metadata + Background Auto-Match
                if (currentLocalData) {
                    currentLocalData = await ensureLocalSongEmbeddedCover(currentLocalData);
                    const initialMeta = await resolveLocalMetadataUI(currentLocalData, null);
                    setCurrentSong(initialMeta.unifiedSong);
                    const localQueueContext = playQueue
                        .map(queuedSong => (queuedSong as any).localData as LocalSong | undefined)
                        .filter((queuedSong): queuedSong is LocalSong => Boolean(queuedSong));
                    prewarmNearbyLocalSongs(currentLocalData, localQueueContext);
                    
                    if (initialMeta.coverUrl) {
                        loadCachedOrFetchCover(`cover_local_${currentLocalData.id}`, initialMeta.coverUrl).then(res => {
                            if (currentSongRef.current === song.id) setCachedCoverUrl(res);
                        });
                    } else {
                        setCachedCoverUrl(null);
                    }
                    
                    setLyrics(initialMeta.lyrics);
                    
                    const needsLyricsMatch = !currentLocalData.hasLocalLyrics && !currentLocalData.hasEmbeddedLyrics && !currentLocalData.matchedLyrics;
                    const needsCoverMatch = !currentLocalData.embeddedCover && !currentLocalData.matchedCoverUrl;
                    if ((needsLyricsMatch || needsCoverMatch) && !currentLocalData.noAutoMatch) {
                        setIsLyricsLoading(true);
                    } else {
                        setIsLyricsLoading(false);
                    }

                    // Background match
                    handleLocalSongMatch(currentLocalData).then(async ({ updatedLocalSong, matchedSongResult }) => {
                        if (currentSongRef.current !== song.id) return;

                        const updatedMeta = await resolveLocalMetadataUI(updatedLocalSong, matchedSongResult);
                        
                        setCurrentSong(updatedMeta.unifiedSong);
                        setLyrics(updatedMeta.lyrics);
                        setIsLyricsLoading(false);

                        if (updatedMeta.coverUrl && updatedMeta.coverUrl !== initialMeta.coverUrl) {
                            loadCachedOrFetchCover(`cover_local_${updatedLocalSong.id}`, updatedMeta.coverUrl).then(res => {
                                if (currentSongRef.current === updatedMeta.unifiedSong.id) setCachedCoverUrl(res);
                            });
                        } else if (!updatedMeta.coverUrl) {
                            if (currentSongRef.current === updatedMeta.unifiedSong.id) setCachedCoverUrl(null);
                        }
                    });
                } else {
                    setIsLyricsLoading(false);
                }

                // Theme
                try {
                    await restoreCachedThemeForSong(song.id);
                    if (currentSongRef.current !== song.id) return;
                } catch (e) {
                    console.warn("Theme load error", e);
                }

                return; // EXIT for local songs
            } else {
                setStatusMsg({ type: 'error', text: '无法播放本地文件 (文件可能已移动或权限丢失)' });
                setIsLyricsLoading(false);
                return;
            }
        }

        // --- ONLINE SONG LOGIC BELOW ---

        // 2. Load Cached Cover (Visual Feedback)
        const cachedCoverUrl = await getCachedCoverUrl(getOnlineSongCacheKey('cover', song));
        if (currentSongRef.current !== song.id) return;
        if (cachedCoverUrl) {
            setCachedCoverUrl(cachedCoverUrl);
        } else if (prefetched?.coverUrl) {
            // Use prefetched cover URL as fallback
            setCachedCoverUrl(prefetched.coverUrl);
        }

        // 3. Audio Loading (Prefetch Cache vs IndexedDB vs Network)
        const audioResult = preloadedOnlineAudioResult;
        if (!audioResult || audioResult.kind !== 'ok') {
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            setPlayerState(PlayerState.IDLE);
            setIsLyricsLoading(false);
            return;
        }

        if (audioResult.blobUrl) {
            blobUrlRef.current = audioResult.blobUrl;
            currentOnlineAudioUrlFetchedAtRef.current = null;
        } else if (audioResult.audioSrc.startsWith('http')) {
            currentOnlineAudioUrlFetchedAtRef.current =
                prefetched?.audioUrl === audioResult.audioSrc
                    ? prefetched.audioUrlFetchedAt
                    : Date.now();
        } else {
            currentOnlineAudioUrlFetchedAtRef.current = null;
        }
        setAudioSrc(audioResult.audioSrc);

        // 4. Fetch Lyrics (Prefetch Cache vs IndexedDB vs Network)
        try {
            await loadOnlineSongLyrics(song, prefetched, user?.userId, {
                isCurrent: () => currentSongRef.current === song.id,
                onLyrics: (resolvedLyrics) => setLyrics(resolvedLyrics),
                onPureMusicChange: (isPureMusic) => {
                    setCurrentSong(prev => prev?.id === song.id ? { ...prev, isPureMusic } : prev);
                },
                onDone: () => setIsLyricsLoading(false),
            });
        } catch (e) {
            console.warn("[App] Lyric fetch failed", e);
            setLyrics(null);
            setIsLyricsLoading(false); // Failed
        }

        // 5. Handle Theme
        try {
            await restoreCachedThemeForSong(song.id);
            if (currentSongRef.current !== song.id) return;
        } catch (e) {
            console.warn("Theme load error", e);
        }

        // 6. Trigger prefetch for nearby songs in queue
        if (newQueue.length > 1) {
            prefetchNearbySongs(song.id, newQueue, audioQuality, user?.userId);
        }
    };

    const handleStageExternalPlayRequest = useCallback(async (request: { requestId: string; songId: number; appendToQueue?: boolean; }) => {
        try {
            const detail = await neteaseApi.getSongDetail(request.songId);
            const song = (detail?.songs || [])[0] as SongResult | undefined;
            if (!song) {
                throw new Error(`Song ${request.songId} was not found.`);
            }

            if (request.appendToQueue) {
                appendNeteaseSongsToMainQueue([song]);
            } else {
                await playSong(song, [song], false, { shouldNavigateToPlayer: true });
            }
            await window.electron?.completeStageExternalPlayRequest?.({
                requestId: request.requestId,
                ok: true,
            });
        } catch (error) {
            console.warn('[Stage] Failed to handle external play request', error);
            await window.electron?.completeStageExternalPlayRequest?.({
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }, [appendNeteaseSongsToMainQueue, playSong]);

    const cacheSongAssets = async () => {
        if (!currentSong || !audioSrc || audioSrc.startsWith('blob:')) return;

        // Don't re-cache if already in cache
        const existing = await hasCachedAudio(getOnlineSongCacheKey('audio', currentSong));
        if (existing) return;

        if (!enableMediaCache) return;

        console.log("[Cache] Caching fully played song:", currentSong.name);

        // 1. Cache Audio
        try {
            const response = await fetch(audioSrc);
            const blob = await response.blob();
            await saveAudioBlob(getOnlineSongCacheKey('audio', currentSong), blob);
            console.log("[Cache] Audio saved");
        } catch (e) {
            console.error("[Cache] Failed to download audio for cache", e);
        }

        // 2. Cache Cover
        const coverUrl = getCoverUrl();
        if (coverUrl) {
            try {
                // Netease images might need proxy handling due to CORS? 
                // Usually images are fine, but if it fails we catch it.
                const response = await fetch(coverUrl, { mode: 'cors' });
                const blob = await response.blob();
                await saveToCache(getOnlineSongCacheKey('cover', currentSong), blob);
                console.log("[Cache] Cover saved");
            } catch (e) {
                console.error("[Cache] Failed to download cover for cache", e);
            }
        }

        // Update usage if panel is open
        if (isPanelOpen && panelTab === 'account') updateCacheSize();
    };

    const playOnlineQueueFromStart = (songs: SongResult[]) => {
        const playableSongs = getPlayableOnlineQueue(songs);
        if (playableSongs.length === 0) {
            setStatusMsg({ type: 'error', text: t('status.noPlayableSongs') });
            return;
        }

        void playSong(playableSongs[0], playableSongs, false);
    };

    const handleQueueAddAndPlay = (song: SongResult) => {
        // Check if song exists in queue
        const existingIndex = playQueue.findIndex(s => s.id === song.id);

        let newQueue = [...playQueue];

        if (existingIndex === -1) {
            // Add to end if not present (or after current song? Let's just append)
            newQueue.push(song);
        }

        // Play this song, updating the queue state
        playSong(song, newQueue, false);
    };

    const handleSearchOverlaySubmit = useCallback(async () => {
        const trimmedQuery = searchQuery.trim();
        if (!trimmedQuery) {
            return;
        }

        const didSearch = await submitSearch({
            query: trimmedQuery,
            sourceTab: searchSourceTab,
            deps: {
                localSongs,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });

        if (didSearch) {
            navigateToSearch({
                query: trimmedQuery,
                sourceTab: searchSourceTab,
                replace: Boolean(window.history.state?.search),
            });
        }
    }, [localSongs, navigateToSearch, searchQuery, searchSourceTab, submitSearch, t]);

    const handleSearchLoadMore = useCallback(async () => {
        await loadMoreSearchResults({
            deps: {
                localSongs,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });
    }, [loadMoreSearchResults, localSongs, t]);

    const handleSearchResultPlay = useCallback((track: UnifiedSong) => {
        if (track.isLocal && track.localData) {
            void onPlayLocalSong(track.localData);
            return;
        }

        if (track.isNavidrome && track.navidromeData) {
            void onPlayNavidromeSong(track as NavidromeSong);
            return;
        }

        handleQueueAddAndPlay(track);
    }, [handleQueueAddAndPlay, onPlayLocalSong, onPlayNavidromeSong]);

    const handleUnavailableReplacementConfirm = useCallback(async () => {
        if (!pendingUnavailableReplacement) {
            return;
        }

        const { originalSong, replacementSong, replacementSongId, queue, isFmCall, options } = pendingUnavailableReplacement;
        setPendingUnavailableReplacement(null);

        try {
            if (!replacementSong || replacementSong.id !== replacementSongId || isSongMarkedUnavailable(replacementSong)) {
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                return;
            }

            const replacementQueue = buildQueueWithReplacementSong(queue, originalSong, replacementSong);
            await playSong(replacementSong, replacementQueue, isFmCall, options);
        } catch (error) {
            console.error('[App] Failed to load replacement song:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
        }
    }, [buildQueueWithReplacementSong, pendingUnavailableReplacement, t]);

    const handleSearchResultArtistSelect = useCallback((track: UnifiedSong, artistName: string, artistId?: number) => {
        if (track.isLocal) {
            hideSearchOverlay();
            openLocalArtistByName(artistName);
            return;
        }

        if (track.isNavidrome && track.navidromeData?.artistId) {
            hideSearchOverlay();
            setHomeViewTab('navidrome');
            setPendingNavidromeSelection({ type: 'artist', artistId: track.navidromeData.artistId });
            return;
        }

        if (artistId) {
            handleArtistSelect(artistId);
        }
    }, [handleArtistSelect, hideSearchOverlay, openLocalArtistByName, setHomeViewTab]);

    const handleSearchResultAlbumSelect = useCallback((track: UnifiedSong, albumName: string, albumId?: number) => {
        if (track.isLocal) {
            hideSearchOverlay();
            openLocalAlbumByName(albumName);
            return;
        }

        if (track.isNavidrome && track.navidromeData?.albumId) {
            hideSearchOverlay();
            setHomeViewTab('navidrome');
            setPendingNavidromeSelection({ type: 'album', albumId: track.navidromeData.albumId });
            return;
        }

        if (albumId) {
            handleAlbumSelect(albumId);
        }
    }, [handleAlbumSelect, hideSearchOverlay, openLocalAlbumByName, setHomeViewTab]);

    const handleNextTrack = useCallback(async (options?: NextTrackOptions) => {
        if (isNowPlayingStageActive) return;
        if (!currentSong || playQueue.length === 0) return;

        const shouldNavigateToPlayer = options?.shouldNavigateToPlayer ?? true;
        const currentIndex = playQueue.findIndex(s => s.id === currentSong.id);

        // --- FM Mode Auto-fetch ---
        if (isFmMode && currentIndex >= playQueue.length - 2) {
            try {
                const fmRes = await neteaseApi.getPersonalFm();
                if (fmRes.data && fmRes.data.length > 0) {
                    const newQueue = [...playQueue, ...fmRes.data];
                    setPlayQueue(newQueue);
                    playSong(newQueue[currentIndex + 1], newQueue, true, {
                        shouldNavigateToPlayer,
                        unavailableSkipCount: options?.unavailableSkipCount
                    });
                    return;
                }
            } catch (e) {
                console.error("Failed to fetch FM tracks", e);
            }
        }

        let nextIndex = -1;

        if (currentIndex >= 0 && currentIndex < playQueue.length - 1) {
            nextIndex = currentIndex + 1;
        } else if (loopMode === 'all') {
            // Wrap around
            nextIndex = 0;
        }

        if (nextIndex >= 0) {
            playSong(playQueue[nextIndex], playQueue, isFmMode, {
                shouldNavigateToPlayer,
                unavailableSkipCount: options?.unavailableSkipCount
            });
        } else if (options?.allowStopOnMissing) {
            if (audioRef.current) {
                audioRef.current.pause();
            }
            setPlayerState(PlayerState.IDLE);
        }
    }, [currentSong, isFmMode, isNowPlayingStageActive, loopMode, playQueue]);

    const handlePrevTrack = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!currentSong || playQueue.length === 0) return;

        const currentIndex = playQueue.findIndex(s => s.id === currentSong.id);
        let prevIndex = -1;

        if (currentIndex > 0) {
            prevIndex = currentIndex - 1;
        } else if (loopMode === 'all') {
            prevIndex = playQueue.length - 1;
        }

        if (prevIndex >= 0) {
            playSong(playQueue[prevIndex], playQueue, isFmMode);
        }
    }, [currentSong, isFmMode, isNowPlayingStageActive, loopMode, playQueue]);

    const skipAfterPlaybackFailure = useCallback(() => {
        clearPendingUnavailableSkip();
        const skipCount = playbackAutoSkipCountRef.current;
        const currentIndex = currentSong ? playQueue.findIndex(song => song.id === currentSong.id) : -1;
        const hasNextTrack = currentIndex >= 0 && (
            currentIndex < playQueue.length - 1 ||
            (loopMode === 'all' && playQueue.length > 1)
        );

        if (!hasNextTrack || skipCount >= MAX_UNAVAILABLE_AUTO_SKIP_COUNT) {
            setPlayerState(PlayerState.IDLE);
            return;
        }

        const nextSkipCount = skipCount + 1;
        showTimedSkipPrompt('status.playbackErrorPrompt', () => {
            playbackAutoSkipCountRef.current = nextSkipCount;
            void handleNextTrack({
                allowStopOnMissing: true,
                shouldNavigateToPlayer: false,
                unavailableSkipCount: nextSkipCount
            });
        });
    }, [clearPendingUnavailableSkip, currentSong, handleNextTrack, loopMode, playQueue, showTimedSkipPrompt]);

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

    const handleFmTrash = async () => {
        if (isNowPlayingStageActive) {
            return;
        }

        if (currentSong && isFmMode) {
            try {
                await neteaseApi.fmTrash(currentSong.id);
            } catch (e) { }
            // Skip immediately
            handleNextTrack();
        }
    };

    const shuffleQueue = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!playQueue || playQueue.length <= 1) return;

        // 1. Identify current song
        const currentId = currentSong?.id;

        // 2. Separate current song from others
        let songsToShuffle: SongResult[] = [];
        let firstSong: SongResult | null = null;

        if (currentId) {
            firstSong = playQueue.find(s => s.id === currentId) || null;
            songsToShuffle = playQueue.filter(s => s.id !== currentId);
        } else {
            songsToShuffle = [...playQueue];
        }

        // 3. Fisher-Yates Shuffle
        for (let i = songsToShuffle.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songsToShuffle[i], songsToShuffle[j]] = [songsToShuffle[j], songsToShuffle[i]];
        }

        // 4. Reconstruct queue: Current song first (if exists), then shuffled songs
        const newQueue = firstSong ? [firstSong, ...songsToShuffle] : songsToShuffle;

        setPlayQueue(newQueue);
        setStatusMsg({ type: 'success', text: t('status.queueShuffled') || 'Queue Shuffled' });

        // 5. Re-prefetch based on new queue order
        if (currentId && newQueue.length > 1) {
            invalidateAndRefetch(currentId, newQueue, audioQuality);
        }
    }, [audioQuality, currentSong, isNowPlayingStageActive, playQueue, t]);

    // Volume & Mute Sync
    useEffect(() => {
        if (audioRef.current) {
            syncOutputGain(getTargetPlaybackVolume(), 0.015);
        }
    }, [getTargetPlaybackVolume, syncOutputGain]);

    useEffect(() => {
        localStorage.setItem('local_replaygain_mode', replayGainMode);
    }, [replayGainMode]);

    // ReplayGain Effect
    useEffect(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;
        
        let replayGainDb = 0;
        let replayGainPeak: number | undefined;
        if ((currentSong as any).isLocal && (currentSong as any).localData) {
            const localData = (currentSong as any).localData as LocalSong;

            if (replayGainMode === 'track') {
                replayGainDb = typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : (typeof localData.replayGain === 'number' ? localData.replayGain : 0);
                replayGainPeak = localData.replayGainTrackPeak;
            } else if (replayGainMode === 'album') {
                replayGainDb = typeof localData.replayGainAlbumGain === 'number'
                    ? localData.replayGainAlbumGain
                    : (typeof localData.replayGainTrackGain === 'number'
                        ? localData.replayGainTrackGain
                        : (typeof localData.replayGain === 'number' ? localData.replayGain : 0));
                replayGainPeak = localData.replayGainAlbumPeak ?? localData.replayGainTrackPeak;
            }
        }

        let effectiveReplayGainDb = replayGainDb;
        if (
            replayGainMode !== 'off' &&
            typeof replayGainPeak === 'number' &&
            replayGainPeak > 0 &&
            replayGainPeak <= 1 &&
            replayGainDb > 0
        ) {
            const clipSafeGainDb = -20 * Math.log10(replayGainPeak);
            effectiveReplayGainDb = Math.min(replayGainDb, clipSafeGainDb);
        }

        const linearGain = Math.pow(10, effectiveReplayGainDb / 20);
        replayGainLinearRef.current = linearGain;
        
        try {
            syncOutputGain(getTargetPlaybackVolume(), 0.1);
            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: replayGainDb,
                effective: effectiveReplayGainDb,
                peak: replayGainPeak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${effectiveReplayGainDb}dB (raw=${replayGainDb}dB, peak=${replayGainPeak ?? 'n/a'}, linear=${linearGain.toFixed(2)})`);
            }
        } catch (e) {
            console.warn('[AudioContext] Failed to apply ReplayGain', e);
        }
    }, [currentSong, getTargetPlaybackVolume, replayGainMode, syncOutputGain]);

    useEffect(() => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            previousAudioSrcRef.current = audioSrc;
            return;
        }

        if (audioSrc && previousAudioSrcRef.current && previousAudioSrcRef.current !== audioSrc) {
            // Force the media element to detach from the previous stream before
            // autoplay kicks in, otherwise Stage session swaps can stay pinned
            // to the old buffered song.
            audioElement.pause();
            audioElement.load();
        }

        previousAudioSrcRef.current = audioSrc;
    }, [audioSrc]);

    useEffect(() => {
        if (audioSrc && audioRef.current) {
            // Only play if shouldAutoPlay is true AND lyrics are not loading
            if (shouldAutoPlay.current && !isLyricsLoading) {
                syncOutputGain(getTargetPlaybackVolume(), 0);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setPlayerState(PlayerState.PLAYING);
                            setupAudioAnalyzer();
                        })
                        .catch(e => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                setPlayerState(PlayerState.PLAYING);
                                return;
                            }

                            if (e.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
                            }
                        });
                }
            } else if (!shouldAutoPlay.current && audioRef.current.paused) {
                // If we're not auto-playing (e.g. restore session), just set state to paused
                setPlayerState(PlayerState.PAUSED);
            }
        }
    }, [audioSrc, getTargetPlaybackVolume, isLyricsLoading, syncOutputGain, t]);

    // Ref to track currentLineIndex inside animation loop (avoid callback recreation)
    const currentLineIndexRef = useRef(currentLineIndex);
    currentLineIndexRef.current = currentLineIndex;

    // Sync Logic & Audio Power
    const updateLoop = useCallback(() => {
        const audioElement = audioRef.current;
        const isActuallyPlaying = Boolean(audioElement && !audioElement.paused && !audioElement.ended);

        // 1. Audio Power / Visualizer Data
        if (isActuallyPlaying && analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);

            // Helper to get average energy of a frequency range
            // fftSize 2048 -> bin size ~21.5Hz (44100/2048)
            const getEnergy = (minHz: number, maxHz: number): number => {
                const start = Math.floor(minHz / 21.5);
                const end = Math.floor(maxHz / 21.5);
                let sum = 0;
                for (let i = start; i <= end; i++) {
                    sum += dataArray[i];
                }
                const count = end - start + 1;
                return count > 0 ? sum / count : 0;
            };

            // Calculate bands
            const bass = getEnergy(20, 150);       // Circles
            const lowMid = getEnergy(150, 400);    // Squares
            const mid = getEnergy(400, 1200);      // Triangles
            const vocal = getEnergy(1000, 3500);   // Icons (Vocal range)
            const treble = getEnergy(3500, 12000); // Crosses

            // Apply sensitivity and update
            const process = (val: number, boost: number = 2) => {
                const norm = val / 255;
                return Math.pow(norm, boost) * 255;
            };

            // Main audio power (keep for legacy compatibility)
            // Use bass + low mid for main pulse
            audioPower.set(process((bass + lowMid) / 2, 3));

            // Set individual bands
            audioBands.bass.set(process(bass, 1.8)); // slightly more sensitive bass
            audioBands.lowMid.set(process(lowMid, 2));
            audioBands.mid.set(process(mid, 2));
            audioBands.vocal.set(process(vocal, 1.5)); // Vocal sensitive
            audioBands.treble.set(process(treble, 2));

        } else {
            // Idle Animation (Breathing effect for PV background)
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);

            // Idle state for bands
            audioBands.bass.set(breath);
            audioBands.lowMid.set(breath);
            audioBands.mid.set(breath);
            audioBands.vocal.set(breath);
            audioBands.treble.set(breath);
        }

        // 2. Playback Time & Lyrics Sync
        if (isActuallyPlaying && audioElement) {
            const time = audioElement.currentTime;
            currentTime.set(time);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, time);
                // Update currentLineIndex whenever it changes, including when moving to -1 (no active lyric)
                if (foundIndex !== currentLineIndexRef.current) {
                    setCurrentLineIndex(foundIndex);
                }
            }
        } else if (isNowPlayingStageActive) {
            const nextTime = getNowPlayingDisplayTime();
            const hasReachedEnd = playerState === PlayerState.PLAYING && duration > 0 && nextTime >= duration;

            currentTime.set(nextTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    setCurrentLineIndex(foundIndex);
                }
            } else if (currentLineIndexRef.current !== -1) {
                setCurrentLineIndex(-1);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncNowPlayingClock(0, duration, false);
                    currentTime.set(0);
                    if (lyrics) {
                        const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, 0);
                        if (restartedLineIndex !== currentLineIndexRef.current) {
                            setCurrentLineIndex(restartedLineIndex);
                        }
                    }
                } else {
                    syncNowPlayingClock(duration, duration, true);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        } else if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && stageLyricsSession && lyrics) {
            const nextTime = getSyntheticStageLyricsTime();
            const clock = stageLyricsClockRef.current;
            const hasReachedEnd = playerState === PlayerState.PLAYING && nextTime >= clock.endTimeSec;

            currentTime.set(nextTime);

            const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
            if (foundIndex !== currentLineIndexRef.current) {
                setCurrentLineIndex(foundIndex);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncStageLyricsClock(clock.startTimeSec, clock.endTimeSec, PlayerState.PLAYING, clock.startTimeSec);
                    currentTime.set(clock.startTimeSec);
                    const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, clock.startTimeSec);
                    if (restartedLineIndex !== currentLineIndexRef.current) {
                        setCurrentLineIndex(restartedLineIndex);
                    }
                } else {
                    syncStageLyricsClock(clock.endTimeSec, clock.endTimeSec, PlayerState.PAUSED, clock.startTimeSec);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        }

        animationFrameRef.current = requestAnimationFrame(updateLoop);
    }, [activePlaybackContext, audioPower, duration, effectiveLoopMode, getNowPlayingDisplayTime, getSyntheticStageLyricsTime, isNowPlayingStageActive, lyrics, playerState, stageActiveEntryKind, stageLyricsSession, syncNowPlayingClock, syncStageLyricsClock]);

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(updateLoop);
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [updateLoop]);

    const togglePlay = (e?: React.MouseEvent | KeyboardEvent) => {
        e?.stopPropagation();

        if (isNowPlayingStageActive) {
            return;
        }

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            if (playerState === PlayerState.PLAYING) {
                pausePlayback();
            } else {
                void resumePlayback();
            }
            return;
        }

        if (audioRef.current) {
            if (!audioRef.current.paused && !audioRef.current.ended) {
                pausePlayback();
            } else {
                void resumePlayback();
            }
        }
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input (though we don't have many inputs yet)
            if (
                e.target instanceof HTMLInputElement
                || e.target instanceof HTMLTextAreaElement
                || (e.target instanceof HTMLElement && e.target.isContentEditable)
            ) {
                return;
            }

            const hasBlockingWindow = () => Boolean(
                document.querySelector('[data-folia-keyboard-window="true"]')
            );

            if (isDev && e.altKey && e.shiftKey && e.code === 'KeyD') {
                e.preventDefault();
                setIsDevDebugOverlayVisible(prev => !prev);
                return;
            }

            switch (e.code) {
                case 'Space':
                    // Space key works in both home and player views if there's a current song
                    if (currentSong && (audioSrc || isNowPlayingStageActive || (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics'))) {
                        e.preventDefault();
                        if (isNowPlayingStageActive) {
                            return;
                        }
                        togglePlay(e);
                    }
                    break;
                case 'ArrowLeft':
                    if (e.ctrlKey && !e.altKey && !e.metaKey) {
                        if (currentSong) {
                            e.preventDefault();
                            if (isNowPlayingStageActive) {
                                return;
                            }
                            handlePrevTrack();
                        }
                        return;
                    }

                    // Arrow keys only work in player view
                    if (currentView !== 'player') return;
                    e.preventDefault();
                    if (isNowPlayingStageActive) {
                        return;
                    }

                    if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                        const nextTime = Math.max(stageLyricsClockRef.current.startTimeSec, currentTime.get() - 5);
                        syncStageLyricsClock(nextTime, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                        currentTime.set(nextTime);
                    } else if (audioRef.current) {
                        const nextTime = Math.max(0, audioRef.current.currentTime - 5);
                        audioRef.current.currentTime = nextTime;
                    }
                    break;
                case 'ArrowRight':
                    if (e.ctrlKey && !e.altKey && !e.metaKey) {
                        if (currentSong) {
                            e.preventDefault();
                            if (isNowPlayingStageActive) {
                                return;
                            }
                            void handleNextTrack();
                        }
                        return;
                    }

                    // Arrow keys only work in player view
                    if (currentView !== 'player') return;
                    e.preventDefault();
                    if (isNowPlayingStageActive) {
                        return;
                    }

                    if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                        const nextTime = Math.min(duration, currentTime.get() + 5);
                        syncStageLyricsClock(nextTime, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                        currentTime.set(nextTime);
                    } else if (audioRef.current) {
                        const nextTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
                        audioRef.current.currentTime = nextTime;
                    }
                    break;
                case 'KeyH':
                    if (currentView !== 'player' || isPanelOpen || hasBlockingWindow()) return;
                    if (e.ctrlKey || e.altKey || e.metaKey) return;
                    e.preventDefault();
                    setIsPlayerChromeHidden(prev => !prev);
                    break;
                case 'KeyP':
                    if (currentView !== 'player' || hasBlockingWindow()) return;
                    if (e.ctrlKey || e.altKey || e.metaKey) return;
                    e.preventDefault();
                    setIsPanelOpen(prev => !prev);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activePlaybackContext, audioSrc, currentSong, currentTime, currentView, duration, handleNextTrack, handlePrevTrack, isDev, isNowPlayingStageActive, isPanelOpen, pausePlayback, playerState, resumePlayback, stageActiveEntryKind, syncStageLyricsClock]);

    const toggleLoop = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (isNowPlayingStageActive) {
            return;
        }

        handleToggleLoopMode();
    };

    const handleLike = async () => {
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
            } catch (e) {
                console.error('Failed to update local favorite playlist', e);
                setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            }
            return;
        }

        if (isNavidromePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: 'Navidrome 歌曲的收藏能力尚未接入' });
            return;
        }

        const isLiked = likedSongIds.has(currentSong.id);
        const newStatus = !isLiked;

        try {
            await neteaseApi.likeSong(currentSong.id, newStatus);

            // Update local state immediately
            setLikedSongIds(prev => {
                const next = new Set(prev);
                if (newStatus) next.add(currentSong.id);
                else next.delete(currentSong.id);

                // Update cache
                saveToCache('user_liked_songs', Array.from(next));

                return next;
            });

            setStatusMsg({ type: 'success', text: newStatus ? t('status.liked') : t('status.unliked') || "Removed from Liked" });
        } catch (e) {
            console.error("Like failed", e);
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
        }
    };

    const handleUpdateLocalLyrics = async (content: string, isTranslation: boolean) => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        const updatedLocalSong = { ...localData };
        if (isTranslation) {
            updatedLocalSong.hasLocalTranslationLyrics = true;
            updatedLocalSong.localTranslationLyricsContent = content;
        } else {
            updatedLocalSong.hasLocalLyrics = true;
            updatedLocalSong.localLyricsContent = content;
        }

        // Save to DB
        try {
            const { saveLocalSong } = await import('./services/db');
            await saveLocalSong(updatedLocalSong);

            // Re-run onPlayLocalSong to handle everything (parsing, merging) properly
            onPlayLocalSong(updatedLocalSong, localSongs);

            setStatusMsg({ type: 'success', text: isTranslation ? 'Translation lyrics updated' : 'Lyrics updated' });
        } catch (e) {
            console.error("Failed to save local lyrics", e);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    };

    const handleChangeLyricsSource = async (source: 'local' | 'embedded' | 'online') => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        const updatedLocalSong = { ...localData };
        updatedLocalSong.lyricsSource = source;

        // Save to DB
        try {
            const { saveLocalSong } = await import('./services/db');
            await saveLocalSong(updatedLocalSong);

            // Parse and apply lyrics from the selected source
            let newLyrics: LyricData | null = null;
            if (source === 'local' && updatedLocalSong.localLyricsContent) {
                newLyrics = await LyricParserFactory.parse({ type: 'local', lrcContent: updatedLocalSong.localLyricsContent, tLrcContent: updatedLocalSong.localTranslationLyricsContent });
            } else if (source === 'embedded' && updatedLocalSong.embeddedLyricsContent) {
                newLyrics = await LyricParserFactory.parse({ type: 'embedded', textContent: updatedLocalSong.embeddedLyricsContent, translationContent: updatedLocalSong.embeddedTranslationLyricsContent });
            } else if (source === 'online' && updatedLocalSong.matchedLyrics) {
                newLyrics = updatedLocalSong.matchedLyrics;
            }
            setLyrics(newLyrics);
            setCurrentLineIndex(-1);

            // Update current song's localData reference
            const updatedSong = { ...currentSong };
            (updatedSong as any).localData = updatedLocalSong;
            setCurrentSong(updatedSong);

            // Refresh local songs list
            await loadLocalSongs();

            setStatusMsg({ type: 'success', text: '歌词来源已切换' });
        } catch (e) {
            console.error("Failed to save lyrics source", e);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    };

    const handleChangeReplayGainMode = (mode: ReplayGainMode) => {
        setReplayGainMode(mode);
        setStatusMsg({ type: 'info', text: replayGainModeLabels[mode] });
    };

    const [showLyricMatchModal, setShowLyricMatchModal] = useState(false);
    const [showNaviLyricMatchModal, setShowNaviLyricMatchModal] = useState(false);

    const handleManualMatchOnline = () => {
        setIsPanelOpen(false);
        if (currentSong && (currentSong as any).isNavidrome) {
            setShowNaviLyricMatchModal(true);
            return;
        }

        if (!isLocalPlaybackSong(currentSong)) return;
        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;
        setShowLyricMatchModal(true);
    };

    const handleLyricMatchComplete = async () => {
        setShowLyricMatchModal(false);
        if (!isLocalPlaybackSong(currentSong)) return;
        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        await loadLocalSongs();
        const updatedList = await getLocalSongs();
        const found = updatedList.find(s => s.id === localData.id);
        if (found) {
            onPlayLocalSong(found, localSongs);
            setStatusMsg({ type: 'success', text: 'Match successful' });
        }
    };

    const handleNaviLyricMatchComplete = async () => {
        setShowNaviLyricMatchModal(false);
        if (currentSong && (currentSong as any).isNavidrome) {
            const navidromeQueue = playQueue
                .map(song => (song as any).navidromeData as NavidromeSong | undefined)
                .filter((song): song is NavidromeSong => Boolean(song?.isNavidrome));
            onPlayNavidromeSong((currentSong as any).navidromeData, navidromeQueue);
            setStatusMsg({ type: 'success', text: 'Match successful' });
        }
    };

    const handleHomeMatchSong = useCallback(async (song: LocalSong) => {
        await loadLocalSongs();

        if (isLocalPlaybackSong(currentSong)) {
            const currentLocalData = (currentSong as any).localData as LocalSong | undefined;
            if (currentLocalData && currentLocalData.id === song.id) {
                const updatedSongs = await getLocalSongs();
                const updatedSong = updatedSongs.find(s => s.id === song.id);

                if (updatedSong) {
                    const updatedCurrentSong = { ...currentSong };
                    (updatedCurrentSong as any).localData = updatedSong;

                    if (updatedSong.matchedCoverUrl) {
                        const coverUrl = updatedSong.matchedCoverUrl;
                        if (updatedCurrentSong.al) {
                            updatedCurrentSong.al.picUrl = coverUrl;
                        } else {
                            updatedCurrentSong.al = {
                                id: 0,
                                name: '',
                                picUrl: coverUrl
                            };
                        }
                    } else if (updatedCurrentSong.al) {
                        updatedCurrentSong.al.picUrl = undefined;
                    }

                    setCurrentSong(updatedCurrentSong);

                    if (updatedSong.matchedCoverUrl) {
                        try {
                            const response = await fetch(updatedSong.matchedCoverUrl, { mode: 'cors' });
                            const coverBlob = await response.blob();
                            await saveToCache(`cover_local_${updatedSong.id}`, coverBlob);
                            setCachedCoverUrl(URL.createObjectURL(coverBlob));
                        } catch (e) {
                            console.warn('Failed to cache updated cover:', e);
                            setCachedCoverUrl(updatedSong.matchedCoverUrl);
                        }
                    } else {
                        setCachedCoverUrl(null);
                    }

                    if (updatedSong.matchedLyrics) {
                        setLyrics(updatedSong.matchedLyrics);
                    } else {
                        setLyrics(null);
                    }
                }
            }
        }
    }, [currentSong, loadLocalSongs, setLyrics]);

    const handleContainerClick = () => {
        if (isPanelOpen) setIsPanelOpen(false);
    };

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
