import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { loadCachedOrFetchCover } from './services/coverCache';
import VisualizerRenderer from './components/visualizer/VisualizerRenderer';
import AppShell from './components/app/AppShell';
import Home from './components/app/Home';
import PlayerPanel from './components/app/PlayerPanel';
import AppDialogs from './components/app/dialogs/AppDialogs';
import { createCopySongInfoSuccessHandler } from './components/app/dialogs/createCopySongInfoSuccessHandler';
import { buildSettingsDialogModel, type SettingsModalState } from './components/app/dialogs/buildSettingsDialogModel';
import AppOverlays from './components/app/overlays/AppOverlays';
import { buildAppDialogsModel } from './components/app/dialogs/buildAppDialogsModel';
import { buildHomeModel } from './components/app/home/buildHomeModel';
import { createLyricFilterPatternSaver } from './components/app/home/createLyricFilterPatternSaver';
import { createLocalLibraryNavigation } from './components/app/navigation/createLocalLibraryNavigation';
import { createNavidromeNavigation } from './components/app/navigation/createNavidromeNavigation';
import { createPanelNavigation } from './components/app/navigation/createPanelNavigation';
import { buildAppStyle } from './components/app/presentation/buildAppStyle';
import { buildDebugSnapshot } from './components/app/presentation/buildDebugSnapshot';
import { buildPlayerViewFlags } from './components/app/presentation/buildPlayerViewFlags';
import { buildVisualizerTheme } from './components/app/presentation/buildVisualizerTheme';
import { createCoverUrlResolver } from './components/app/playback/createCoverUrlResolver';
import { createLyricsSetter } from './components/app/playback/createLyricsSetter';
import { createOnlineRecoveryController } from './components/app/playback/createOnlineRecoveryController';
import { persistPlaybackCache } from './components/app/playback/persistPlaybackCache';
import { buildAppOverlaysModel } from './components/app/overlays/buildAppOverlaysModel';
import { buildPlayerPanelModel } from './components/app/player-panel/buildPlayerPanelModel';
import { createQueueMutations } from './components/app/player-panel/createQueueMutations';
import { LyricData, Theme, PlayerState, SongResult, ReplayGainMode, StatusMessage, PlaybackContext, StageLoopMode } from './types';
import { isSongMarkedUnavailable, neteaseApi } from './services/netease';
import { isNavidromeEnabled } from './services/navidromeService';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useNeteaseLibrary } from './hooks/useNeteaseLibrary';
import { useAppPreferences } from './hooks/useAppPreferences';
import { useElectronPlaybackBridge } from './hooks/useElectronPlaybackBridge';
import { useElectronVideoExportController } from './hooks/useElectronVideoExportController';
import { useMediaSessionBridge } from './hooks/useMediaSessionBridge';
import { usePlaybackAudioBridge } from './hooks/usePlaybackAudioBridge';
import { usePlaybackInteractionBridge } from './hooks/usePlaybackInteractionBridge';
import { usePlaybackUiEffects } from './hooks/usePlaybackUiEffects';
import { useLibraryPlaybackController } from './hooks/useLibraryPlaybackController';
import { usePlaybackQueueController } from './hooks/usePlaybackQueueController';
import { usePlaybackTransportController } from './hooks/usePlaybackTransportController';
import { usePlaybackVisualizerBridge } from './hooks/usePlaybackVisualizerBridge';
import { useSessionRestoreController } from './hooks/useSessionRestoreController';
import { useStagePlaybackController } from './hooks/useStagePlaybackController';
import { useThemeController } from './hooks/useThemeController';
import { useSearchNavigationStore } from './stores/useSearchNavigationStore';
import { useSettingsUiStore } from './stores/useSettingsUiStore';
import { useShallow } from 'zustand/react/shallow';
import { clampMediaVolume } from './utils/appPlaybackHelpers';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from './utils/appPlaybackGuards';

const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
const DEV_DEBUG_SHORTCUT_LABEL = 'Alt+Shift+D';
const ONLINE_AUDIO_URL_TTL_MS = 1200 * 1000;
const ONLINE_AUDIO_URL_REFRESH_BUFFER_MS = 60 * 1000;
const PLAYER_CHROME_HIDDEN_STORAGE_KEY = 'player_chrome_hidden';
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
    const [showTransparentWindowBorder, setShowTransparentWindowBorder] = useState(false);
    const [isMainWindowClickThroughEnabled, setIsMainWindowClickThroughEnabled] = useState(false);
    const [isClickThroughToggleHotspotActive, setIsClickThroughToggleHotspotActive] = useState(false);

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
    const [panelTab, setPanelTab] = useState<'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi' | 'onlineLyrics'>('cover');
    const [isPlayerChromeHidden, setIsPlayerChromeHidden] = useState(() => {
        const saved = localStorage.getItem(PLAYER_CHROME_HIDDEN_STORAGE_KEY);
        return saved === 'true';
    });
    const [isDevDebugOverlayVisible, setIsDevDebugOverlayVisible] = useState(false);
    const [settingsModalState, setSettingsModalState] = useState<SettingsModalState>({
        isOpen: false,
        initialTab: 'help',
    });
    const [navidromeEnabled, setNavidromeEnabledState] = useState(() => isNavidromeEnabled());
    const isSettingsSubviewOpen = useSettingsUiStore(state => state.isSubSettingsViewOpen);

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
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const audioBands = useMemo(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
    }), [bass, lowMid, mid, vocal, treble]);

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
    // Buffer progress debug helper. Uncomment this ref, the reset effect below,
    // and the audio `onProgress` handler to log buffered percent again.
    // const lastBufferedPercentLogRef = useRef<number | null>(null);
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
    const openSettings = useCallback((initialTab: SettingsModalState['initialTab'] = 'help') => {
        setSettingsModalState({ isOpen: true, initialTab });
    }, []);
    const closeSettings = useCallback(() => {
        setSettingsModalState(prev => ({ ...prev, isOpen: false }));
    }, []);
    const handleToggleNavidromeEnabled = useCallback((enabled: boolean) => {
        setNavidromeEnabledState(enabled);
        if (!enabled && homeViewTab === 'navidrome') {
            setHomeViewTab('local');
        }
    }, [homeViewTab, setHomeViewTab]);

    // Preferences and Theme
    // Manages user preferences for audio quality, theme settings, 
    // and related actions like toggling cover color backgrounds and static mode,
    // as well as setting daylight mode preference
    const appPreferences = useAppPreferences(setStatusMsg);
    const {
        audioQuality,
        setAudioQuality,
        useCoverColorBg,
        staticMode,
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerTranslationSubtitle,
        hidePlayerRightPanelButton,
        transparentPlayerBackground,
        disableVisualizerVignette,
        disableVisualizerGeometricBackground,
        minimizeToTray,
        hideTaskbarIcon,
        openPlayerOnLaunch,
        enableMediaCache,
        backgroundOpacity,
        subtitleOverlayOpacity,
        visualizerOpacity,
        isDaylight,
        visualizerMode,
        classicTuning,
        cadenzaTuning,
        partitaTuning,
        fumeTuning,
        cappellaTuning,
        tiltTuning,
        cappellaCustomEmojiImages,
        isLoadingCappellaCustomEmojiPack,
        lyricsFontStyle,
        lyricsFontScale,
        lyricsCustomFontFamily,
        lyricsCustomFontLabel,
        lyricFilterPattern,
        showOpenPanelCloseButton,
        enableNowPlayingStage,
        queueAddBehavior,
        audioOutputDeviceId,
        loopMode,
        handleToggleCoverColorBg,
        handleToggleStaticMode,
        handleToggleDisableHomeDynamicBackground,
        handleToggleHidePlayerProgressBar,
        handleToggleHidePlayerTranslationSubtitle,
        handleToggleHidePlayerRightPanelButton,
        handleToggleTransparentPlayerBackground,
        handleToggleDisableVisualizerVignette,
        handleToggleDisableVisualizerGeometricBackground,
        handleToggleMinimizeToTray,
        handleToggleHideTaskbarIcon,
        handleToggleOpenPlayerOnLaunch,
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
        handleSetCappellaTuning,
        handleResetCappellaTuning,
        handleSetTiltTuning,
        handleResetTiltTuning,
        handleImportCustomCappellaEmojiPack,
        handleClearCustomCappellaEmojiPack,
        handleSetLyricsFontStyle,
        handleSetLyricsFontScale,
        handleSetLyricsCustomFont,
        handleUploadLyricsCustomFont,
        handleSetLyricFilterPattern,
        handleToggleOpenPanelCloseButton,
        handleToggleNowPlayingStage,
        handleSetQueueAddBehavior,
        handleSetAudioOutputDeviceId: persistAudioOutputDeviceId,
        volume,
        isMuted,
        handleSetVolume,
        handleToggleMute,
        handleToggleLoopMode,
    } = appPreferences;

    const setLyrics = useMemo(
        () => createLyricsSetter(setLyricsState, lyricFilterPattern),
        [lyricFilterPattern],
    );

    const effectiveLoopMode: StageLoopMode = loopMode;

    const getTargetPlaybackVolume = useCallback(() => (isMuted ? 0 : volume), [isMuted, volume]);

    const persistLastPlaybackCache = useCallback(persistPlaybackCache, []);

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

    const applyAudioOutputDevice = useCallback(async (
        targetDeviceId: string,
        reportError = true,
    ) => {
        const audioElement = audioRef.current as (HTMLAudioElement & {
            setSinkId?: (sinkId: string) => Promise<void>;
            sinkId?: string;
        }) | null;
        const audioContext = audioContextRef.current as (AudioContext & {
            setSinkId?: (sinkId: string) => Promise<void>;
            sinkId?: string;
        }) | null;
        const audioSinkTarget = gainNodeRef.current && audioContext?.setSinkId
            ? audioContext
            : audioElement;

        if (!audioSinkTarget?.setSinkId) {
            persistAudioOutputDeviceId(targetDeviceId);
            return true;
        }

        const normalizedTargetDeviceId = targetDeviceId || '';
        if (audioSinkTarget.sinkId === normalizedTargetDeviceId) {
            persistAudioOutputDeviceId(targetDeviceId);
            return true;
        }

        let attempt = 0;
        const maxRetryCount = 4;
        let shouldPauseBeforeSwitch = normalizedTargetDeviceId === 'default' || normalizedTargetDeviceId === 'communications';

        while (attempt <= maxRetryCount) {
            const wasPlaying = !audioElement.paused && !audioElement.ended;
            try {
                if (shouldPauseBeforeSwitch && wasPlaying) {
                    audioElement.pause();
                }

                await audioSinkTarget.setSinkId(normalizedTargetDeviceId);
                persistAudioOutputDeviceId(targetDeviceId);

                if (shouldPauseBeforeSwitch && wasPlaying) {
                    try {
                        await audioElement.play();
                    } catch (resumeError) {
                        console.warn('[App] Audio output switched but playback did not resume automatically', {
                            resumeError,
                            targetDeviceId: normalizedTargetDeviceId,
                            audioSrc,
                        });
                    }
                }

                return true;
            } catch (error) {
                const isAbortError = error instanceof DOMException && error.name === 'AbortError';
                if (isAbortError && attempt < maxRetryCount) {
                    if (wasPlaying && audioElement.paused) {
                        try {
                            await audioElement.play();
                        } catch {
                            // Ignore resume failures during retry path; a later successful switch will attempt again.
                        }
                    }
                    attempt += 1;
                    shouldPauseBeforeSwitch = true;
                    await new Promise(resolve => window.setTimeout(resolve, 180));
                    continue;
                }

                console.warn('[App] Failed to apply audio output device', {
                    error,
                    targetDeviceId: normalizedTargetDeviceId,
                    sinkTarget: audioSinkTarget === audioContext ? 'audio-context' : 'audio-element',
                });

                if (wasPlaying && audioElement.paused) {
                    try {
                        await audioElement.play();
                    } catch {
                        // Ignore resume failures on final error; user will see the status message.
                    }
                }

                if (reportError) {
                    setStatusMsg({
                        type: 'error',
                        text: '切换播放设备失败',
                    });
                }
                return false;
            }
        }

        return false;
    }, [persistAudioOutputDeviceId]);

    useEffect(() => {
        const audioElement = audioRef.current as HTMLAudioElement | null;

        if (!audioElement) {
            return;
        }

        let isDisposed = false;
        const handleAudioDeviceRetry = () => {
            if (isDisposed) {
                return;
            }
            void applyAudioOutputDevice(audioOutputDeviceId, false);
        };

        audioElement.addEventListener('loadedmetadata', handleAudioDeviceRetry);
        audioElement.addEventListener('canplay', handleAudioDeviceRetry);
        void applyAudioOutputDevice(audioOutputDeviceId, false);
        return () => {
            isDisposed = true;
            audioElement.removeEventListener('loadedmetadata', handleAudioDeviceRetry);
            audioElement.removeEventListener('canplay', handleAudioDeviceRetry);
        };
    }, [applyAudioOutputDevice, audioOutputDeviceId, audioSrc]);

    const handleAudioOutputDeviceChange = useCallback(async (deviceId: string) => (
        await applyAudioOutputDevice(deviceId, true)
    ), [applyAudioOutputDevice]);

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

    const {
        shouldRefreshCurrentOnlineAudioSource,
        recoverOnlinePlaybackSource,
    } = useMemo(() => createOnlineRecoveryController({
        audioQuality,
        currentSong,
        audioSrc,
        audioRef,
        currentSongRef,
        blobUrlRef,
        shouldAutoPlayRef: shouldAutoPlay,
        pendingResumeTimeRef,
        onlinePlaybackRecoveryRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef,
        setAudioSrc,
        onlineAudioUrlTtlMs: ONLINE_AUDIO_URL_TTL_MS,
        onlineAudioUrlRefreshBufferMs: ONLINE_AUDIO_URL_REFRESH_BUFFER_MS,
    }), [audioQuality, audioSrc, audioRef, blobUrlRef, currentOnlineAudioUrlFetchedAtRef, currentSong, currentSongRef, lastAudioRecoverySourceRef, onlinePlaybackRecoveryRef, pendingResumeTimeRef, setAudioSrc, shouldAutoPlay]);

    const getCoverUrl = useMemo(
        () => createCoverUrlResolver(cachedCoverUrl, currentSong),
        [cachedCoverUrl, currentSong],
    );

    const coverUrl = getCoverUrl();

    // Theme Controller
    // manages current theme, daylight mode, and related actions like generating AI themes 
    // and restoring cached themes for songs
    const themeController = useThemeController({
        defaultTheme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        isDaylight,
        setDaylightPreference,
        setStatusMsg,
        coverUrl,
        t,
    });
    const {
        theme,
        setTheme,
        hasCustomTheme,
        isCustomThemePreferred,
        songThemeAutoSwitchEnabled,
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
        handleSongThemeAutoSwitchChange,
    } = themeController;

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
        nowPlayingDebugInfo,
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

    const { openCurrentNavidromeAlbum, openCurrentNavidromeArtist } = createNavidromeNavigation({
        currentSong,
        setPendingNavidromeSelection,
        setHomeViewTab,
        navigateDirectHome,
    });

    const { handleDirectHomeFromPanel } = createPanelNavigation(navigateDirectHome);

    // --- Local Music Functions ---

    const {
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
        handleImportOnlineLyrics,
        handleChangeOnlineLyricsSource,
        handleMatchOnlineLyrics,
        handleLyricMatchComplete,
        handleNaviLyricMatchComplete,
        handleOnlineLyricMatchComplete,
        handleClearOnlineLyricsState,
        handleHomeMatchSong,
        handleLike,
    } = useLibraryPlaybackController({
        t: (key, fallback) => t(key, fallback ?? ''),
        audioQuality,
        queueAddBehavior,
        currentSong,
        lyrics,
        playQueue,
        likedSongIds,
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
        setLikedSongIds,
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

    const {
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openLocalAlbumByName,
        openLocalArtistByName,
    } = createLocalLibraryNavigation({
        currentView,
        currentSong,
        localSongs,
        setHomeViewTab,
        setLocalMusicState,
        navigateDirectHome,
    });
    const handleSaveLyricFilterPattern = createLyricFilterPatternSaver({
        handleSetLyricFilterPattern,
        loadCurrentSongLyricPreview,
        setLyrics,
        setCurrentLineIndex,
        setStatusMsg,
    });

    const { addNavidromeSongsToQueue } = createQueueMutations({
        currentSong,
        playQueue,
        setPlayQueue,
        persistLastPlaybackCache,
        setStatusMsg,
        t: key => t(key),
        queueAddBehavior,
    });

    // --- Effects ---

    const {
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        clearPendingUnavailableSkip,
        addNeteaseSongToQueue,
        addNeteaseSongsToQueue,
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
        activePlaybackContext,
        currentSong,
        playQueue,
        playerState,
        loopMode,
        isFmMode,
        isNowPlayingStageActive,
        queueAddBehavior,
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
        mainPlaybackSnapshotRef,
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

    const { resumePlayback, pausePlayback } = usePlaybackTransportController({
        activePlaybackContext,
        stageActiveEntryKind,
        isNowPlayingStageActive,
        audioSrc,
        duration,
        audioRef,
        audioContextRef,
        currentTime,
        stageLyricsClockRef,
        setPlayerState,
        setStatusMsg,
        setupAudioAnalyzer,
        syncOutputGain,
        getTargetPlaybackVolume,
        shouldRefreshCurrentOnlineAudioSource,
        recoverOnlinePlaybackSource,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
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

    const {
        exportState,
        handleExportCommand,
    } = useElectronVideoExportController({
        isElectronWindow,
        audioRef,
        currentTime,
        duration,
        currentSong,
        setIsPlayerChromeHidden,
        setIsPanelOpen,
        navigateToPlayer,
        pausePlayback,
        resumePlayback,
    });

    useElectronPlaybackBridge({
        isElectronWindow,
        setIsTitlebarRevealed,
        isPlayerChromeHidden,
        setIsPlayerChromeHidden,
        showTransparentWindowBorder,
        setShowTransparentWindowBorder,
        transparentPlayerBackground,
        mainWindowClickThroughEnabled: isMainWindowClickThroughEnabled,
        isNowPlayingControlDisabledRef,
        audioRef,
        currentTime,
        duration,
        currentSong,
        coverUrl,
        cachedCoverUrl,
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
        exportState,
        isDaylight,
        onRemoteExportCommand: handleExportCommand,
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

    const usesCustomWindowChrome = isElectronWindow;
    const shouldUseTransparentAppBackground = currentView === 'player' && transparentPlayerBackground;
    const appStyle = useMemo(() => buildAppStyle({
        bgMode,
        isDaylight,
        theme,
        daylightTheme: DAYLIGHT_THEME,
        defaultTheme: DEFAULT_THEME,
        transparentBackground: shouldUseTransparentAppBackground,
    }), [bgMode, isDaylight, shouldUseTransparentAppBackground, theme]);
    const { visualizerTheme, visualizerGeometrySeed } = useMemo(() => buildVisualizerTheme({
        appStyle,
        theme,
        lyricsFontStyle,
        lyricsCustomFontFamily,
        currentSongId: currentSong?.id,
        visualizerMode,
    }), [appStyle, currentSong?.id, lyricsCustomFontFamily, lyricsFontStyle, theme, visualizerMode]);
    const isNowPlayingControlDisabled = isNowPlayingStageActive;

    useEffect(() => {
        localStorage.setItem(PLAYER_CHROME_HIDDEN_STORAGE_KEY, String(isPlayerChromeHidden));
    }, [isPlayerChromeHidden]);

    useEffect(() => {
        const body = document.body;
        const html = document.documentElement;
        const previousBodyBackgroundColor = body.style.backgroundColor;
        const previousHtmlBackgroundColor = html.style.backgroundColor;
        const shouldUseTransparentDocumentBackground = isElectronWindow && transparentPlayerBackground;

        if (shouldUseTransparentDocumentBackground) {
            body.style.backgroundColor = 'transparent';
            html.style.backgroundColor = 'transparent';
        } else {
            body.style.backgroundColor = '';
            html.style.backgroundColor = '';
        }

        return () => {
            body.style.backgroundColor = previousBodyBackgroundColor;
            html.style.backgroundColor = previousHtmlBackgroundColor;
        };
    }, [isElectronWindow, transparentPlayerBackground]);

    useEffect(() => {
        if (!isElectronWindow || !window.electron?.getMainWindowClickThroughEnabled || !window.electron?.onMainWindowClickThroughChanged) {
            setIsMainWindowClickThroughEnabled(false);
            return;
        }

        let mounted = true;

        void window.electron.getMainWindowClickThroughEnabled().then((enabled) => {
            if (mounted) {
                setIsMainWindowClickThroughEnabled(Boolean(enabled));
            }
        }).catch(() => {
            if (mounted) {
                setIsMainWindowClickThroughEnabled(false);
            }
        });

        const unsubscribe = window.electron.onMainWindowClickThroughChanged((state) => {
            setIsMainWindowClickThroughEnabled(Boolean(state?.enabled));
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, [isElectronWindow]);

    useEffect(() => {
        if (!isElectronWindow || !isMainWindowClickThroughEnabled || !window.electron?.setMainWindowClickThroughUnlockHover) {
            setIsClickThroughToggleHotspotActive(false);
            void window.electron?.setMainWindowClickThroughUnlockHover?.(false);
            return;
        }

        const toggleHotspotWidth = 48;
        const toggleHotspotHeight = 40;
        const toggleHotspotRightInset = 176;
        const toggleHotspotTopInset = 4;

        const syncToggleHotspot = (active: boolean) => {
            setIsClickThroughToggleHotspotActive(prev => (prev === active ? prev : active));
            void window.electron!.setMainWindowClickThroughUnlockHover(active);
        };

        const handleMouseMove = (event: MouseEvent) => {
            const withinHorizontalBounds =
                event.clientX >= window.innerWidth - toggleHotspotRightInset - toggleHotspotWidth
                && event.clientX <= window.innerWidth - toggleHotspotRightInset;
            const withinVerticalBounds =
                event.clientY >= toggleHotspotTopInset
                && event.clientY <= toggleHotspotTopInset + toggleHotspotHeight;
            const withinHotspot = withinHorizontalBounds && withinVerticalBounds;

            setIsClickThroughToggleHotspotActive(prev => {
                if (prev === withinHotspot) {
                    return prev;
                }

                void window.electron!.setMainWindowClickThroughUnlockHover(withinHotspot);
                return withinHotspot;
            });
        };

        const handleMouseLeave = () => {
            syncToggleHotspot(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
            syncToggleHotspot(false);
        };
    }, [isElectronWindow, isMainWindowClickThroughEnabled]);
    const {
        isPlayerView,
        shouldPauseVisualizerBackground,
        shouldHidePlayerProgressBar,
        shouldHidePlayerTranslationSubtitle,
        shouldHidePlayerRightPanelButton,
        canToggleCurrentPlayback,
    } = useMemo(() => buildPlayerViewFlags({
        currentView,
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerTranslationSubtitle,
        hidePlayerRightPanelButton,
        isNowPlayingControlDisabled,
        activePlaybackContext,
        stageActiveEntryKind,
        audioSrc,
        duration,
    }), [
        activePlaybackContext,
        audioSrc,
        currentView,
        disableHomeDynamicBackground,
        duration,
        hidePlayerProgressBar,
        hidePlayerRightPanelButton,
        hidePlayerTranslationSubtitle,
        isNowPlayingControlDisabled,
        stageActiveEntryKind,
    ]);
    const isSettingsModalOpen = settingsModalState.isOpen;
    const canGenerateAITheme = Boolean((lyrics?.lines.length ?? 0) > 0 || currentSong?.isPureMusic);
    const nowPlayingDebugSnapshot = useMemo(() => (
        stageSource === 'now-playing'
            ? {
                connectionStatus: nowPlayingConnectionStatus,
                isActive: isNowPlayingStageActive,
                paused: nowPlayingPaused,
                progressMs: nowPlayingProgressMs,
                progressQuality: nowPlayingProgressQuality,
                trackTitle: nowPlayingTrack?.title ?? nowPlayingLyricPayload?.title ?? null,
                durationSec: (nowPlayingTrack?.durationMs ?? nowPlayingLyricPayload?.durationMs ?? 0) / 1000,
                ...nowPlayingDebugInfo,
            }
            : null
    ), [
        isNowPlayingStageActive,
        nowPlayingConnectionStatus,
        nowPlayingDebugInfo,
        nowPlayingLyricPayload?.durationMs,
        nowPlayingLyricPayload?.title,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        nowPlayingTrack?.durationMs,
        nowPlayingTrack?.title,
        stageSource,
    ]);
    const devDebugSnapshot = useMemo(() => (
        isDev
            ? buildDebugSnapshot({
            shortcutLabel: DEV_DEBUG_SHORTCUT_LABEL,
            currentSong,
            currentView,
            playerState,
            visualizerMode,
            lyrics,
            currentLineIndex,
            currentTimeValue: currentTime.get(),
            audioSrc,
            coverUrl,
            nowPlayingDebug: nowPlayingDebugSnapshot,
        })
            : null
    ), [
        audioSrc,
        coverUrl,
        currentLineIndex,
        currentSong,
        currentTime,
        currentView,
        isDev,
        nowPlayingDebugSnapshot,
        playerState,
        lyrics,
        visualizerMode,
    ]);
    const themeParkSeedTheme = useMemo(() => getThemeParkSeedTheme(), [getThemeParkSeedTheme]);
    const generateCurrentSongTheme = useCallback(() => {
        void generateAITheme(lyrics, currentSong);
    }, [currentSong, generateAITheme, lyrics]);
    const toggleDaylightMode = useCallback(() => {
        handleToggleDaylight(!isDaylight);
    }, [handleToggleDaylight, isDaylight]);
    const seekMainAudio = useCallback((time: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            if (audioRef.current.paused) {
                void audioRef.current.play();
                setPlayerState(PlayerState.PLAYING);
            }
        }
    }, []);
    const homeModel = useMemo(() => buildHomeModel({
        playSong,
        navigateToPlayer,
        refreshUserData,
        user,
        playlists,
        cloudPlaylist,
        currentSong,
        playerState,
        handlePlaylistSelect,
        handleAlbumSelect,
        handleArtistSelect,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        focusedFavoriteAlbumIndex,
        setFocusedFavoriteAlbumIndex,
        focusedRadioIndex,
        setFocusedRadioIndex,
        openSettings,
        navigateToSearch,
        openLocalAlbumByName,
        openLocalArtistByName,
        localSongs,
        localPlaylists,
        onRefreshLocalSongs,
        onPlayLocalSong,
        onAddLocalSongToQueue: handleLocalQueueAdd,
        localMusicState,
        setLocalMusicState,
        onMatchSong: handleHomeMatchSong,
        onPlayNavidromeSong,
        onAddNavidromeSongsToQueue: addNavidromeSongsToQueue,
        onMatchNavidromeSong,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection,
        setPendingNavidromeSelection,
        stageSource,
        activePlaybackContext,
        openStagePlayer,
        stageStatus,
        setStageStatus,
        leaveStagePlayback,
        clearStagePlaybackSession,
        clearPersistedStagePlaybackCache,
        loadStageSessionIntoPlayback,
        theme,
        navidromeEnabled,
    }), [
        activePlaybackContext,
        addNavidromeSongsToQueue,
        applyCustomTheme,
        applyDefaultTheme,
        backgroundOpacity,
        visualizerOpacity,
        bgMode,
        cadenzaTuning,
        cappellaCustomEmojiImages,
        cappellaTuning,
        clearPersistedStagePlaybackCache,
        clearStagePlaybackSession,
        cloudPlaylist,
        currentSong,
        disableVisualizerVignette,
        disableVisualizerGeometricBackground,
        disableHomeDynamicBackground,
        enableMediaCache,
        enableNowPlayingStage,
        focusedFavoriteAlbumIndex,
        focusedPlaylistIndex,
        focusedRadioIndex,
        fumeTuning,
        handleAlbumSelect,
        handleArtistSelect,
        handleClearCustomCappellaEmojiPack,
        handleCustomThemePreferenceChange,
        handleHomeMatchSong,
        handleImportCustomCappellaEmojiPack,
        handleResetCappellaTuning,
        handleResetFumeTuning,
        handleResetPartitaTuning,
        handleSaveLyricFilterPattern,
        handleSetBackgroundOpacity,
        handleSetCappellaTuning,
        handleSetFumeTuning,
        handleSetLyricsCustomFont,
        handleSetLyricsFontScale,
        handleSetLyricsFontStyle,
        handleUploadLyricsCustomFont,
        handleSetPartitaTuning,
        handleSetQueueAddBehavior,
        handleAudioOutputDeviceChange,
        handleSetVisualizerMode,
        handleSongThemeAutoSwitchChange,
        handleToggleDisableHomeDynamicBackground,
        handleToggleHidePlayerProgressBar,
        handleToggleHidePlayerRightPanelButton,
        handleToggleHidePlayerTranslationSubtitle,
        handleToggleTransparentPlayerBackground,
        handleToggleDisableVisualizerVignette,
        handleToggleDisableVisualizerGeometricBackground,
        handleToggleMinimizeToTray,
        handleToggleHideTaskbarIcon,
        handleToggleOpenPlayerOnLaunch,
        handleToggleMediaCache,
        handleToggleNowPlayingStage,
        handleToggleOpenPanelCloseButton,
        handleToggleStaticMode,
        hasCustomTheme,
        hidePlayerProgressBar,
        hidePlayerRightPanelButton,
        hidePlayerTranslationSubtitle,
        minimizeToTray,
        hideTaskbarIcon,
        openPlayerOnLaunch,
        transparentPlayerBackground,
        isCustomThemePreferred,
        isDaylight,
        isLoadingCappellaCustomEmojiPack,
        leaveStagePlayback,
        loadCurrentSongLyricPreview,
        loadStageSessionIntoPlayback,
        localMusicState,
        localPlaylists,
        localSongs,
        lyricFilterPattern,
        lyricsCustomFontFamily,
        lyricsCustomFontLabel,
        lyricsFontScale,
        lyricsFontStyle,
        navigateToPlayer,
        navigateToSearch,
        navidromeFocusedAlbumIndex,
        nowPlayingConnectionStatus,
        onMatchNavidromeSong,
        onPlayLocalSong,
        onPlayNavidromeSong,
        onRefreshLocalSongs,
        openSettings,
        openLocalAlbumByName,
        openLocalArtistByName,
        openStagePlayer,
        partitaTuning,
        pendingNavidromeSelection,
        playlists,
        playerState,
        playSong,
        queueAddBehavior,
        audioOutputDeviceId,
        refreshUserData,
        saveCustomDualTheme,
        setFocusedFavoriteAlbumIndex,
        setFocusedPlaylistIndex,
        setFocusedRadioIndex,
        setLocalMusicState,
        setNavidromeFocusedAlbumIndex,
        setPendingNavidromeSelection,
        setStageStatus,
        showOpenPanelCloseButton,
        songThemeAutoSwitchEnabled,
        stageSource,
        stageStatus,
        staticMode,
        theme,
        themeParkSeedTheme,
        transparentPlayerBackground,
        user,
        visualizerMode,
        handleAudioOutputDeviceChange,
        navidromeEnabled,
        minimizeToTray,
        hideTaskbarIcon,
        openPlayerOnLaunch,
    ]);
    const playerPanelModel = useMemo(() => buildPlayerPanelModel({
        isPanelOpen,
        setIsPanelOpen,
        panelTab,
        setPanelTab,
        navigateToHome,
        handleDirectHomeFromPanel,
        coverUrl,
        currentSong,
        handleAlbumSelect,
        handleArtistSelect,
        effectiveLoopMode,
        toggleLoop,
        handleLike,
        isLiked: currentSong ? (isLocalPlaybackSong(currentSong) ? isLocalSongLiked(currentSong) : likedSongIds.has(currentSong.id)) : false,
        generateAITheme: generateCurrentSongTheme,
        isGeneratingTheme,
        hasLyrics: !!lyrics,
        canGenerateAITheme,
        theme,
        setTheme,
        bgMode,
        handleBgModeChange,
        hasCustomTheme,
        handleResetTheme,
        defaultTheme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        visualizerMode,
        handleSetVisualizerMode,
        handleManualMatchOnline,
        handleUpdateLocalLyrics,
        handleChangeLyricsSource,
        onlineLyricsState: currentSong?.onlineLyricsState ?? null,
        handleImportOnlineLyrics,
        handleChangeOnlineLyricsSource,
        handleMatchOnlineLyrics,
        handleClearOnlineLyricsState,
        replayGainMode,
        handleChangeReplayGainMode,
        isFmMode,
        handleFmTrash,
        handleNextTrack,
        handlePrevTrack,
        playerState,
        togglePlay,
        volume,
        isMuted,
        handlePreviewVolume,
        handleSetVolume,
        handleToggleMute,
        showOpenPanelCloseButton,
        hideToggleButton: isPlayerChromeHidden || shouldHidePlayerRightPanelButton,
        activePlaybackContext,
        isNowPlayingControlDisabled,
        openSettings,
        playQueue,
        playSong,
        queueScrollRef,
        shuffleQueue,
        localPlaylists,
        playlists,
        saveCurrentQueueAsLocalPlaylist,
        addCurrentSongToLocalPlaylist,
        createCurrentLocalPlaylist,
        addCurrentSongToNeteasePlaylist,
        addCurrentSongToNavidromePlaylist,
        createCurrentNavidromePlaylist,
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openCurrentNavidromeAlbum,
        openCurrentNavidromeArtist,
        handleCopySongInfoSuccess: createCopySongInfoSuccessHandler({ setStatusMsg, t }),
        user,
        handleLogout,
        audioQuality,
        setAudioQuality,
        cacheSize,
        handleClearCache,
        handleSyncData,
        isSyncing,
        useCoverColorBg,
        handleToggleCoverColorBg,
        isDaylight,
        handleToggleDaylight: toggleDaylightMode,
    }), [
        activePlaybackContext,
        addCurrentSongToLocalPlaylist,
        addCurrentSongToNavidromePlaylist,
        addCurrentSongToNeteasePlaylist,
        audioQuality,
        cacheSize,
        canGenerateAITheme,
        coverUrl,
        createCurrentLocalPlaylist,
        createCurrentNavidromePlaylist,
        currentSong,
        effectiveLoopMode,
        generateCurrentSongTheme,
        handleAlbumSelect,
        handleArtistSelect,
        handleBgModeChange,
        handleChangeOnlineLyricsSource,
        handleChangeLyricsSource,
        handleClearCache,
        handleImportOnlineLyrics,
        handleLike,
        handleLogout,
        handleManualMatchOnline,
        handleMatchOnlineLyrics,
        handleNextTrack,
        handlePreviewVolume,
        handlePrevTrack,
        handleResetTheme,
        handleSetVisualizerMode,
        handleSetVolume,
        handleSyncData,
        handleToggleCoverColorBg,
        handleToggleMute,
        handleToggleDaylight,
        handleUpdateLocalLyrics,
        hasCustomTheme,
        isDaylight,
        isFmMode,
        isGeneratingTheme,
        isMuted,
        isNowPlayingControlDisabled,
        isPanelOpen,
        isSyncing,
        likedSongIds,
        localPlaylists,
        lyrics,
        navigateToHome,
        openSettings,
        openCurrentLocalAlbum,
        openCurrentLocalArtist,
        openCurrentNavidromeAlbum,
        openCurrentNavidromeArtist,
        panelTab,
        playQueue,
        playSong,
        playerState,
        playlists,
        queueScrollRef,
        replayGainMode,
        saveCurrentQueueAsLocalPlaylist,
        setAudioQuality,
        setIsPanelOpen,
        setPanelTab,
        setTheme,
        showOpenPanelCloseButton,
        shuffleQueue,
        theme,
        toggleLoop,
        togglePlay,
        t,
        useCoverColorBg,
        user,
        visualizerMode,
        volume,
    ]);
    const homeContent = useMemo(() => <Home model={homeModel} />, [homeModel]);
    const appOverlaysModel = useMemo(() => buildAppOverlaysModel({
        currentView,
        isOverlayVisible,
        topOverlay,
        overlayStack,
        homeContent,
        theme,
        isDaylight,
        closeSearchView,
        handleSearchOverlaySubmit,
        handleSearchLoadMore,
        handleSearchResultPlay,
        handleSearchResultArtistSelect,
        handleSearchResultAlbumSelect,
        popOverlay,
        playSong,
        playOnlineQueueFromStart,
        addNeteaseSongsToQueue,
        addNeteaseSongToQueue,
        handleAlbumSelect,
        handleArtistSelect,
        userId: user?.userId,
        playlists,
        refreshUserData,
        isDev,
        isDevDebugOverlayVisible,
        devDebugSnapshot,
        currentTime,
        currentSong,
        playerState,
        duration,
        effectiveLoopMode,
        audioSrc,
        canToggleCurrentPlayback,
        isNowPlayingControlDisabled,
        lyrics,
        activePlaybackContext,
        stageActiveEntryKind,
        syncStageLyricsClock,
        stageLyricsClockRef,
        setPlayerState,
        togglePlay,
        toggleLoop,
        navigateToPlayer,
        isPlayerChromeHidden,
        shouldHidePlayerProgressBar,
        onSeekMainAudio: seekMainAudio,
        noTrackText: t('ui.noTrack'),
    }), [
        activePlaybackContext,
        addNeteaseSongToQueue,
        addNeteaseSongsToQueue,
        audioSrc,
        canToggleCurrentPlayback,
        closeSearchView,
        currentSong,
        currentTime,
        currentView,
        devDebugSnapshot,
        duration,
        effectiveLoopMode,
        handleAlbumSelect,
        handleArtistSelect,
        handleSearchLoadMore,
        handleSearchOverlaySubmit,
        handleSearchResultAlbumSelect,
        handleSearchResultArtistSelect,
        handleSearchResultPlay,
        homeContent,
        isDaylight,
        isDev,
        isDevDebugOverlayVisible,
        isNowPlayingControlDisabled,
        isOverlayVisible,
        isPlayerChromeHidden,
        lyrics,
        navigateToPlayer,
        overlayStack,
        playerState,
        playlists,
        playOnlineQueueFromStart,
        playSong,
        popOverlay,
        refreshUserData,
        seekMainAudio,
        setPlayerState,
        shouldHidePlayerProgressBar,
        stageActiveEntryKind,
        stageLyricsClockRef,
        syncStageLyricsClock,
        theme,
        toggleLoop,
        togglePlay,
        topOverlay,
        user?.userId,
    ]);
    const settingsDialog = useMemo(() => buildSettingsDialogModel({
        state: settingsModalState,
        onClose: closeSettings,
        themeController,
        themeParkInitialTheme: themeParkSeedTheme,
        onToggleNavidrome: handleToggleNavidromeEnabled,
        currentSongTitle: currentSong?.name || null,
        loadLyricFilterPreview: loadCurrentSongLyricPreview,
        onSaveLyricFilterPattern: handleSaveLyricFilterPattern,
        stageStatus,
        stageSource,
        activePlaybackContext,
        setStageStatus,
        leaveStagePlayback,
        clearStagePlaybackSession,
        clearPersistedStagePlaybackCache,
        loadStageSessionIntoPlayback,
        nowPlayingConnectionStatus,
        onAudioOutputDeviceChange: handleAudioOutputDeviceChange,
    }), [
        activePlaybackContext,
        clearPersistedStagePlaybackCache,
        clearStagePlaybackSession,
        closeSettings,
        currentSong?.name,
        handleAudioOutputDeviceChange,
        handleSaveLyricFilterPattern,
        handleToggleNavidromeEnabled,
        leaveStagePlayback,
        loadCurrentSongLyricPreview,
        loadStageSessionIntoPlayback,
        nowPlayingConnectionStatus,
        settingsModalState,
        stageSource,
        stageStatus,
        themeController,
        themeParkSeedTheme,
    ]);
    const appDialogsModel = useMemo(() => buildAppDialogsModel({
        statusMsg,
        isDaylight,
        showLyricMatchModal,
        showNaviLyricMatchModal,
        showOnlineLyricMatchModal,
        currentSong,
        setShowLyricMatchModal,
        setShowNaviLyricMatchModal,
        setShowOnlineLyricMatchModal,
        handleLyricMatchComplete,
        handleNaviLyricMatchComplete,
        handleOnlineLyricMatchComplete,
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        handleUnavailableReplacementConfirm,
        settingsDialog,
    }), [
        currentSong,
        handleLyricMatchComplete,
        handleNaviLyricMatchComplete,
        handleOnlineLyricMatchComplete,
        handleUnavailableReplacementConfirm,
        isDaylight,
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        setShowLyricMatchModal,
        setShowNaviLyricMatchModal,
        setShowOnlineLyricMatchModal,
        settingsDialog,
        showLyricMatchModal,
        showNaviLyricMatchModal,
        showOnlineLyricMatchModal,
        statusMsg,
    ]);

    useEffect(() => {
        isNowPlayingControlDisabledRef.current = isNowPlayingControlDisabled;
    }, [isNowPlayingControlDisabled]);

    // Buffer progress debug helper reset. Keep commented out unless
    // buffered percent logging is explicitly needed during troubleshooting.
    // useEffect(() => {
    //     lastBufferedPercentLogRef.current = null;
    // }, [audioSrc]);

    return (
        <AppShell
            appStyle={appStyle}
            isElectronWindow={isElectronWindow}
            usesCustomWindowChrome={usesCustomWindowChrome}
            useCustomWindowRadius={isElectronWindow && transparentPlayerBackground}
            showTransparentWindowBorder={showTransparentWindowBorder}
            isPlayerView={isPlayerView}
            isTitlebarRevealed={isTitlebarRevealed}
            isMainWindowClickThroughEnabled={isMainWindowClickThroughEnabled}
            showMainWindowClickThroughToggle={isMainWindowClickThroughEnabled ? isClickThroughToggleHotspotActive : isTitlebarRevealed}
            onToggleMainWindowClickThrough={() => {
                const nextEnabled = !isMainWindowClickThroughEnabled;
                if (!nextEnabled) {
                    setIsClickThroughToggleHotspotActive(false);
                }
                void window.electron?.setMainWindowClickThroughEnabled?.(nextEnabled);
                if (!nextEnabled) {
                    void window.electron?.setMainWindowClickThroughUnlockHover?.(false);
                }
            }}
            audioElement={<audio
                ref={audioRef}
                src={audioSrc || undefined}
                preload="auto"
                crossOrigin="anonymous"
                loop={effectiveLoopMode === 'one'}
                onPlay={(e) => {
                    shouldAutoPlay.current = false;
                    currentTime.set(e.currentTarget.currentTime);
                    setPlayerState(PlayerState.PLAYING);
                }}
                onPlaying={(e) => {
                    shouldAutoPlay.current = false;
                    currentTime.set(e.currentTarget.currentTime);
                    setupAudioAnalyzer();
                    playbackAutoSkipCountRef.current = 0;
                    setPlayerState(PlayerState.PLAYING);
                }}
                onPause={(e) => {
                    shouldAutoPlay.current = false;
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
                // Buffer progress debug helper. Uncomment to inspect how much of
                // the current source the browser has actually buffered.
                // onProgress={(e) => {
                //     const audioElement = e.currentTarget;
                //     const buffered = audioElement.buffered;
                //     const source = audioElement.currentSrc || audioSrc;
                //     if (!source || buffered.length === 0 || !Number.isFinite(audioElement.duration) || audioElement.duration <= 0) {
                //         return;
                //     }
                //
                //     const bufferedEnd = buffered.end(buffered.length - 1);
                //     const bufferedPercent = Math.max(
                //         0,
                //         Math.min(100, Math.round((bufferedEnd / audioElement.duration) * 100))
                //     );
                //     if (lastBufferedPercentLogRef.current !== bufferedPercent) {
                //         lastBufferedPercentLogRef.current = bufferedPercent;
                //         console.log('[Audio] buffered percent', {
                //             src: source,
                //             currentTime: audioElement.currentTime,
                //             bufferedEnd,
                //             duration: audioElement.duration,
                //             bufferedPercent,
                //         });
                //     }
                // }}
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
                    songTitle={currentSong?.name}
                    coverUrl={getCoverUrl()}
                    showText={currentView === 'player' && !isSettingsModalOpen}
                    useCoverColorBg={useCoverColorBg}
                    seed={visualizerGeometrySeed}
                    staticMode={staticMode}
                    paused={shouldPauseVisualizerBackground}
                    backgroundOpacity={backgroundOpacity}
                    visualizerOpacity={visualizerOpacity}
                    transparentBackground={currentView === 'player' && transparentPlayerBackground && !isSettingsModalOpen}
                    disableGeometricBackground={disableVisualizerGeometricBackground || isSettingsSubviewOpen}
                    disableVignette={disableVisualizerVignette}
                    lyricsFontScale={lyricsFontScale}
                    subtitleOverlayOpacity={subtitleOverlayOpacity}
                    isPlayerChromeHidden={isPlayerChromeHidden}
                    hideTranslationSubtitle={shouldHidePlayerTranslationSubtitle}
                    classicTuning={classicTuning}
                    cadenzaTuning={cadenzaTuning}
                    partitaTuning={partitaTuning}
                    fumeTuning={fumeTuning}
                    cappellaTuning={cappellaTuning}
                    tiltTuning={tiltTuning}
                    cappellaCustomEmojiImages={cappellaCustomEmojiImages}
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
