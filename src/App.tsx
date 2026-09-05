import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { motion, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { loadCachedOrFetchCover } from './services/coverCache';
import VisualizerRenderer from './components/visualizer/VisualizerRenderer';
import CommandPalette from './components/command-palette/CommandPalette';
import AddToPlaylistHost from './components/app/AddToPlaylistHost';
import { useCommandPalette } from './components/command-palette/useCommandPalette';
import { useCommandPaletteContext } from './hooks/useCommandPaletteContext';
import AppShell from './components/app/AppShell';
import Home from './components/app/Home';
import PlayerPanel from './components/app/PlayerPanel';
import ThemeQuickEditorHost from './components/panelTab/ThemeQuickEditor';
import AppDialogs from './components/app/dialogs/AppDialogs';
import { useSettingsDialogModel } from './components/app/dialogs/useSettingsDialogModel';
import AppOverlays from './components/app/overlays/AppOverlays';
import AutomixModelReminder from './components/modal/AutomixModelReminder';
// Lazy so animejs (~38KB gz) stays out of the bootstrap chunk: this overlay only ever draws when the
// animation switch is on AND the mode is automix, both off by default, so it is mounted only then.
const AutomixTransitionAnimation = lazy(() => import('./components/app/overlays/AutomixTransitionAnimation'));
const Lattice = lazy(() => import('./components/app/lattice/Lattice'));
import { UserGuideModal } from './components/modal/UserGuideModal';
import { USER_GUIDE_AUTO_OPEN_VERSION } from './components/modal/userGuideContent';
import { useAppDialogsModel } from './components/app/dialogs/useAppDialogsModel';
import { useHomeModel } from './components/app/home/useHomeModel';
import { createLyricFilterPatternSaver } from './components/app/home/createLyricFilterPatternSaver';
import { nextLyricStaffAbsorbMode, nextLyricStaffPolicy } from './utils/lyrics/staffCreditsPolicy';
import { createPanelNavigation } from './components/app/navigation/createPanelNavigation';
import { createOnlineGridViewCollection, type GridViewCollectionDescriptor } from './components/app/home/gridViewCollectionAdapters';
import { buildAppStyle } from './components/app/presentation/buildAppStyle';
import { buildDebugSnapshot } from './components/app/presentation/buildDebugSnapshot';
import { buildHomeSurfacePresentation } from './components/app/presentation/buildHomeSurfacePresentation';
import { buildPlayerViewFlags } from './components/app/presentation/buildPlayerViewFlags';
import { buildVisualizerTheme } from './components/app/presentation/buildVisualizerTheme';
import { createCoverUrlResolver } from './components/app/playback/createCoverUrlResolver';
import { createLyricsSetter } from './components/app/playback/createLyricsSetter';
import { createLyricSegmentationActions } from './components/app/playback/createLyricSegmentationActions';
import { useLyricWordSegmentation } from './hooks/useLyricWordSegmentation';
import { createOnlineRecoveryController } from './components/app/playback/createOnlineRecoveryController';
import { persistPlaybackCache } from './components/app/playback/persistPlaybackCache';
import { useAppOverlaysModel } from './components/app/overlays/useAppOverlaysModel';
import { resolveNextUpTrack } from './components/app/overlays/now-playing-toast/resolveNextUpTrack';
import {
    createSearchAlbumCollection,
    createSearchArtistCollection,
} from './components/app/search/searchCollectionAdapters';
import { usePlayerPanelModel } from './components/app/player-panel/usePlayerPanelModel';
import { createQueueMutations } from './components/app/player-panel/createQueueMutations';
import { Album, Artist, LyricData, Theme, PlayerState, SongResult, ReplayGainMode, StatusMessage, PlaybackContext, StageLoopMode, UnifiedSong } from './types';
import type { LocalSong } from './types';
import { getLocalSongArrayBuffer } from './services/localMusicService';
import type { MediaId, OnlineProviderId, ProviderCollection } from './types/onlineMusic';
import { resolveSongCatalogRef } from './services/onlineMusic/catalogRefs';
import { omni } from './services/onlineMusic/omni';
import { getSongArtistLabel, getSongCoverUrl } from './services/onlineMusic/songMetadata';
import { isNavidromeEnabled } from './services/navidromeService';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useNeteaseLibrary } from './hooks/useNeteaseLibrary';
import { useKugouLibrary } from './hooks/useKugouLibrary';
import { useQqLibrary } from './hooks/useQqLibrary';
import { useOnlineProviderPlatform } from './hooks/useOnlineProviderPlatform';
import { useAppPreferences } from './hooks/useAppPreferences';
import { useElectronPlaybackBridge } from './hooks/useElectronPlaybackBridge';
import { useElectronDisplaySleepBlocker } from './hooks/useElectronDisplaySleepBlocker';
import { useSleepTimer } from './hooks/useSleepTimer';
import { useElectronNeteaseApiStatus } from './hooks/useElectronNeteaseApiStatus';
import { useElectronVideoExportController } from './hooks/useElectronVideoExportController';
import { useElectronWindowPlaybackHandoff } from './hooks/useElectronWindowPlaybackHandoff';
import { useMediaSessionBridge } from './hooks/useMediaSessionBridge';
import { usePlayerChromeAutoHide } from './hooks/usePlayerChromeAutoHide';
import { usePlaybackAudioBridge } from './hooks/usePlaybackAudioBridge';
import { useAutomixDecks, type AutomixDeckId } from './services/automix/useAutomixDecks';
import { usePlaybackInteractionBridge } from './hooks/usePlaybackInteractionBridge';
import { usePersonalFmModeController } from './hooks/usePersonalFmModeController';
import { PERSONAL_FM_MODE_COMMAND_ID } from './components/command-palette/commands/fmModeCommand';
import { usePlaybackUiEffects } from './hooks/usePlaybackUiEffects';
import { useLibraryPlaybackController } from './hooks/useLibraryPlaybackController';
import { useNavidromeScrobbleReporter } from './hooks/useNavidromeScrobbleReporter';
import { usePlaybackQueueController } from './hooks/usePlaybackQueueController';
import { usePlaybackTransportController } from './hooks/usePlaybackTransportController';
import { useLocalLibraryCatalog } from './hooks/useLocalLibraryCatalog';
import { usePlaybackVisualizerBridge } from './hooks/usePlaybackVisualizerBridge';
import { useRandomVisualizerMode } from './hooks/useRandomVisualizerMode';
import { useObsBrowserSourcePublisher } from './hooks/useObsBrowserSourcePublisher';
import { useLyricApiPublisher } from './hooks/useLyricApiPublisher';
import { useSessionRestoreController } from './hooks/useSessionRestoreController';
import { useStagePlaybackController } from './hooks/useStagePlaybackController';
import { useSongThemeAutoGeneration } from './hooks/useSongThemeAutoGeneration';
import { useThemeController } from './hooks/useThemeController';
import { useOnlineSongMetadataHydration } from './hooks/useOnlineSongMetadataHydration';
import { resolveCommandPaletteSearchSource, resolveSearchSource, useSearchNavigationStore } from './stores/useSearchNavigationStore';
import { useCollectionNavigationStore } from './stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from './stores/useOnlineProviderAccountStore';
import { useShallow } from 'zustand/react/shallow';
import { clampMediaVolume, toSafeRemoteUrl } from './utils/appPlaybackHelpers';
import { getOnlineProviderIdForSong, getPlaybackSongKey, isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from './utils/appPlaybackGuards';
import { readLyricOffset, writeLyricOffset } from './utils/lyrics/lyricOffsetMemory';
import { FALLBACK_AI_DUAL_THEME } from './services/themeSanitizer';
import { BASE_DUAL_THEME, DAYLIGHT_THEME, DEFAULT_THEME } from './services/baseThemes';
import { initializeSyncCoordinator } from './services/sync/syncCoordinator';
import { applyLocalLibraryEntityDisplay } from './services/playbackAdapters';
import { clearPrefetchRuntime } from './services/prefetchService';
import { clearTrackProfileRuntime } from './services/automix/profileService';
import { transitionCapabilities } from './services/automix/stems';
import { buildLocalLibraryIndex } from './utils/localLibraryIndex';
import type { PlayerChromeVisibilityMode } from './types/remoteControl';
import { setStatusMessage as setStatusMsg, useStatusMessage } from './stores/useStatusMessageStore';
import { selectVisualizerSettingsSnapshot, useVisualizerSettingsStore } from './stores/useVisualizerSettingsStore';
import { selectLyricSettingsSnapshot, useLyricSettingsStore } from './stores/useLyricSettingsStore';
import { selectTypographySettingsSnapshot, useTypographySettingsStore } from './stores/useTypographySettingsStore';
import { selectPlayerChromeSettingsSnapshot, usePlayerChromeSettingsStore } from './stores/usePlayerChromeSettingsStore';
import { selectThemeSettingsSnapshot, useThemeSettingsStore } from './stores/useThemeSettingsStore';
import { useAutomixSettingsStore } from './stores/useAutomixSettingsStore';
import { selectDesktopSettingsSnapshot, useDesktopSettingsStore } from './stores/useDesktopSettingsStore';
import { selectSleepTimerSnapshot, useSleepTimerStore } from './stores/useSleepTimerStore';
import { selectStageSettingsSnapshot, useStageSettingsStore } from './stores/useStageSettingsStore';
import { selectAudioSettingsSnapshot, useAudioSettingsStore } from './stores/useAudioSettingsStore';
import { useSettingsModalStore } from './stores/useSettingsModalStore';
import { audioBands, audioPower, bass, currentTime, lowMid, lyricCurrentTime, mid, spectrum, treble, vocal } from './stores/motionSignals';
import { useAppChromeStore } from './stores/useAppChromeStore';
import { useAppViewStore } from './stores/useAppViewStore';
import { selectDisplayCoverUrl, selectDisplayDuration, selectDisplayLyrics, selectDisplayPlayerState, selectDisplaySong, selectIsShowingTail, usePlaybackStore } from './stores/usePlaybackStore';
import { useLibraryStore } from './stores/useLibraryStore';
import { countRender } from './dev/renderCount';
import { resolveSongLiked } from './utils/resolveSongLiked';
import StageSessionEmptyState from './components/app/stage/StageSessionEmptyState';
import { useVisualizerRendererModel } from './components/visualizer/useVisualizerRendererModel';
import { useVisualizerTunings } from './components/visualizer/useVisualizerTunings';
import { usePlaybackRuntimeRefs } from './hooks/usePlaybackRuntimeRefs';
import { useElectronWindowChrome } from './hooks/useElectronWindowChrome';
import { useTransportCommandRefs } from './hooks/useTransportCommandRefs';
import { useHomeProviderRefresh } from './hooks/useHomeProviderRefresh';
import { useAudioOutputDevice } from './hooks/useAudioOutputDevice';
import { useThemeQuickEditorContext } from './hooks/useThemeQuickEditorContext';
import { usePlayerBottomBarOffset } from './hooks/usePlayerBottomBarOffset';
import { usePlayerBottomBarPositioningEntry } from './hooks/usePlayerBottomBarPositioningEntry';
import { PlayerBottomBarLayoutContext } from './components/floating-player/PlayerBottomBarLayoutContext';

const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
const DEV_DEBUG_SHORTCUT_LABEL = 'Alt+Shift+D';
const ONLINE_AUDIO_URL_TTL_MS = 1200 * 1000;
const ONLINE_AUDIO_URL_REFRESH_BUFFER_MS = 60 * 1000;
const LOCAL_TAIL_DECODE_ERROR_TOLERANCE_SEC = 3;
/** How many seconds before a track ends the now playing card previews the queue's next track. */
const NEXT_UP_LEAD_SEC = 5;

export default function App() {
    countRender('App');
    const { t } = useTranslation();
    const {
        navidromeEnabled, setNavidromeEnabledState,
        starredNavidromeSongIds, setStarredNavidromeSongIds,
        isProviderSyncing, setIsProviderSyncing,
        providerSwitchPending, setProviderSwitchPending,
    } = useLibraryStore(useShallow(state => ({
        navidromeEnabled: state.navidromeEnabled,
        setNavidromeEnabledState: state.setNavidromeEnabledState,
        starredNavidromeSongIds: state.starredNavidromeSongIds,
        setStarredNavidromeSongIds: state.setStarredNavidromeSongIds,
        isProviderSyncing: state.isProviderSyncing,
        setIsProviderSyncing: state.setIsProviderSyncing,
        providerSwitchPending: state.providerSwitchPending,
        setProviderSwitchPending: state.setProviderSwitchPending,
    })));
    const {
        currentSong, setCurrentSong,
        audioSrc, setAudioSrc,
        lyrics, setLyricsState,
        cachedCoverUrl, setCachedCoverUrl,
        duration, setDuration,
        playerState, setPlayerState,
        currentLineIndex,
        playQueue, setPlayQueue,
        activePlaybackContext,
        isFmMode, setIsFmMode,
        setReplayGainMode,
        lyricTimelineOffsetMs, setLyricTimelineOffsetMs,
    } = usePlaybackStore(useShallow(state => ({
        currentSong: state.currentSong, setCurrentSong: state.setCurrentSong,
        audioSrc: state.audioSrc, setAudioSrc: state.setAudioSrc,
        lyrics: state.lyrics, setLyricsState: state.setLyricsState,
        cachedCoverUrl: state.cachedCoverUrl, setCachedCoverUrl: state.setCachedCoverUrl,
        duration: state.duration, setDuration: state.setDuration,
        playerState: state.playerState, setPlayerState: state.setPlayerState,
        currentLineIndex: state.currentLineIndex, setCurrentLineIndex: state.setCurrentLineIndex,
        playQueue: state.playQueue, setPlayQueue: state.setPlayQueue,
        activePlaybackContext: state.activePlaybackContext, setActivePlaybackContext: state.setActivePlaybackContext,
        isFmMode: state.isFmMode, setIsFmMode: state.setIsFmMode,
        replayGainMode: state.replayGainMode, setReplayGainMode: state.setReplayGainMode,
        lyricTimelineOffsetMs: state.lyricTimelineOffsetMs, setLyricTimelineOffsetMs: state.setLyricTimelineOffsetMs,
    })));
    const {
        isPanelOpen, setIsPanelOpen,
        panelTab, setPanelTab,
        isHomeFullyHidden, setIsHomeFullyHidden,
    } = useAppViewStore(useShallow(state => ({
        isPanelOpen: state.isPanelOpen,
        setIsPanelOpen: state.setIsPanelOpen,
        panelTab: state.panelTab,
        setPanelTab: state.setPanelTab,
        isHomeFullyHidden: state.isHomeFullyHidden,
        setIsHomeFullyHidden: state.setIsHomeFullyHidden,
    })));
    const {
        isTitlebarRevealed,
        showTransparentWindowBorder,
        isMainWindowClickThroughEnabled,
        isClickThroughToggleHotspotActive, setIsClickThroughToggleHotspotActive,
        setIsPlayerPanelGuideHotspotActive,
        isPlayerChromeHidden, setIsPlayerChromeHidden,
        isDevDebugOverlayVisible,
    } = useAppChromeStore(useShallow(state => ({
        isTitlebarRevealed: state.isTitlebarRevealed,
        showTransparentWindowBorder: state.showTransparentWindowBorder,
        isMainWindowClickThroughEnabled: state.isMainWindowClickThroughEnabled,
        isClickThroughToggleHotspotActive: state.isClickThroughToggleHotspotActive,
        setIsClickThroughToggleHotspotActive: state.setIsClickThroughToggleHotspotActive,
        setIsPlayerPanelGuideHotspotActive: state.setIsPlayerPanelGuideHotspotActive,
        isPlayerChromeHidden: state.isPlayerChromeHidden,
        setIsPlayerChromeHidden: state.setIsPlayerChromeHidden,
        isDevDebugOverlayVisible: state.isDevDebugOverlayVisible,
    })));
    const isDev = import.meta.env.DEV;
    const isElectronWindow = Boolean((window as typeof window & { electron?: unknown; }).electron);

    // Player Data
    useOnlineSongMetadataHydration(currentSong, setCurrentSong);

    // Queue

    // UI State
    const statusMsg = useStatusMessage();
    useElectronNeteaseApiStatus(t);

    // Auto-close the player panel when leaving the player view
    // (Effect moved to after useAppNavigation where currentView is defined)
    const {
        settingsModalState,
        lastSeenGuideVersion,
        setLastSeenGuideVersion,
        setIsUserGuideModalOpen,
    } = useSettingsModalStore(useShallow(state => ({
        settingsModalState: state.settingsModalState,
        lastSeenGuideVersion: state.lastSeenGuideVersion,
        setLastSeenGuideVersion: state.setLastSeenGuideVersion,
        setIsUserGuideModalOpen: state.setIsUserGuideModalOpen,
    })));
    const automixEnabled = useAutomixSettingsStore(state => state.automixEnabled);
    const transitionMode = useAutomixSettingsStore(state => state.transitionMode);
    const crossfadeMaxSec = useAutomixSettingsStore(state => state.crossfadeMaxSec);
    const transitionPerformance = useAutomixSettingsStore(state => state.transitionPerformance);
    const transitionAnimation = useAutomixSettingsStore(state => state.transitionAnimation);
    /**
     * The same test the settings panel disables its performance switch by, for the command palette.
     *
     * Asked in one place rather than two: the panel greys the switch out when there is no stem model
     * to run, and the palette command used to check only that this was the desktop build - so the
     * command could turn on a mode the panel would not let anyone turn on, and the preference stayed
     * set for whenever a model did arrive. Left as a getter for the palette to call; see the note on
     * `canUseTransitionPerformance` in the palette's context type.
     */
    const canUseTransitionPerformance = useCallback(() => transitionCapabilities().stems, []);
    // Memoised because it is a dependency of the planning callback: a fresh object every render
    // would rebuild that callback on every frame of playback.
    const transitionSettings = useMemo(
        () => ({ mode: transitionMode, crossfadeMaxSec, performance: transitionPerformance }),
        [transitionMode, crossfadeMaxSec, transitionPerformance],
    );

    useEffect(() => {
        if (
            typeof __APP_VERSION__ !== 'undefined' &&
            USER_GUIDE_AUTO_OPEN_VERSION === __APP_VERSION__ &&
            lastSeenGuideVersion !== __APP_VERSION__
        ) {
            setIsUserGuideModalOpen(true);
            setLastSeenGuideVersion(__APP_VERSION__);
        }
    }, [lastSeenGuideVersion, setLastSeenGuideVersion, setIsUserGuideModalOpen]);

    useEffect(() => initializeSyncCoordinator(), []);

    const loadNavidromeFavorites = useCallback(async () => {
        if (!navidromeEnabled) {
            setStarredNavidromeSongIds(new Set());
            return;
        }

        const { getNavidromeConfig, navidromeApi } = await import('./services/navidromeService');
        const config = getNavidromeConfig();
        if (!config) return;

        try {
            const songs = await navidromeApi.getStarred2(config);
            setStarredNavidromeSongIds(new Set(songs.map(song => song.id)));
        } catch (error) {
            console.warn('[App] Failed to load Navidrome favorites:', error);
        }
    }, [navidromeEnabled]);

    useEffect(() => {
        void loadNavidromeFavorites();
    }, [loadNavidromeFavorites]);

    const prevSettingsOpenRef = useRef(false);
    useEffect(() => {
        const isOpen = settingsModalState.isOpen;
        if (!isOpen && prevSettingsOpenRef.current && navidromeEnabled) {
            void loadNavidromeFavorites();
        }
        prevSettingsOpenRef.current = isOpen;
    }, [settingsModalState.isOpen, navidromeEnabled, loadNavidromeFavorites]);

    // Player State
    useEffect(() => {
        (window as any).__folia_current_time = currentTime;
    }, []);

    // Progress Bar State
    // Removed isDragging and sliderValue as they are handled by ProgressBar component

    // Audio Analysis State

    // Refs
    // The mutable substrate the playback controllers coordinate through; see the hook for why it
    // has to be held here rather than by any one of them.
    const {
        audioRef,
        audioContextRef,
        analyserRef,
        gainNodeRef,
        blobUrlRef,
        animationFrameRef,
        shouldAutoPlay,
        currentSongRef,
        currentSongFullRef,
        playbackAutoSkipCountRef,
        volumePreviewFrameRef,
        pendingVolumePreviewRef,
        pendingResumeTimeRef,
        onlinePlaybackRecoveryRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef,
    } = usePlaybackRuntimeRefs();
    // The automix decks are set up much further down, but a few reset paths declared above here
    // need to be able to stop a transition, and queue navigation needs the track being SHOWN. A ref
    // keeps both reachable without reordering them; it is reassigned on every render, so the
    // picture read through it is the committed one.
    const automixRef = useRef<{
        abortTransition: () => void;
        transitionDisplay: { song: SongResult | null } | null;
    } | null>(null);
    const queueScrollRef = useRef<HTMLDivElement>(null);
    // Buffer progress debug helper. Uncomment this ref, the reset effect below,
    // and the audio `onProgress` handler to log buffered percent again.
    // const lastBufferedPercentLogRef = useRef<number | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);
    const isNowPlayingControlDisabledRef = useRef(false);


    // Navigation persistence state shared by the Grid home surfaces.
    const homeViewTab = useSearchNavigationStore(state => state.homeViewTab);
    const setHomeViewTab = useSearchNavigationStore(state => state.setHomeViewTab);
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
    useAppPreferences();
    const {
        audioQuality,
        queueAddBehavior,
        loopMode,
        volume,
        isMuted,
        handleToggleLoopMode,
    } = useAudioSettingsStore(useShallow(selectAudioSettingsSnapshot));
    const {
        preventDisplaySleepDuringPlayback,
        wallpaperMode,
    } = useDesktopSettingsStore(useShallow(selectDesktopSettingsSnapshot));
    const {
        stageTrackPillMode,
        stageTrackPillOnHome,
    } = useStageSettingsStore(useShallow(selectStageSettingsSnapshot));
    const {
        sleepTimerEnabled,
        sleepTimerHours,
        sleepTimerMinutes,
    } = useSleepTimerStore(useShallow(selectSleepTimerSnapshot));
    const {
        disableHomeDynamicBackground,
        isDaylight,
        setDaylightPreference,
    } = useThemeSettingsStore(useShallow(selectThemeSettingsSnapshot));
    const {
        hidePlayerProgressBar,
        playerBottomBarOffset,
        hidePlayerRightPanelButton,
        transparentPlayerBackground,
        enablePlayerPageNativeBlur,
        autoHidePlayerChrome,
        handleToggleAutoHidePlayerChrome,
        alwaysShowMainWindowTitlebar,
        handleToggleTransparentPlayerBackground,
    } = usePlayerChromeSettingsStore(useShallow(selectPlayerChromeSettingsSnapshot));
    const {
        hidePlayerTranslationSubtitle,
        lyricsFontStyle,
        lyricsFontWeight,
        lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
        subtitleFontWeight,
        subtitleFontFamily,
        subtitleFontFallbackFamilies,
        lyricsCustomFontFamily,
    } = useTypographySettingsStore(useShallow(selectTypographySettingsSnapshot));
    const {
        globalLyricTimelineOffsetMs,
        lyricFilterPattern,
        lyricStaffPolicy,
        lyricStaffMinDwellSeconds,
        lyricStaffAbsorbMode,
        lyricStaffPattern,
        handleSetLyricFilterPattern,
        handleSetLyricStaffPolicy,
        handleSetLyricStaffMinDwellSeconds,
        handleSetLyricStaffAbsorbMode,
        handleSetLyricStaffPattern,
    } = useLyricSettingsStore(useShallow(selectLyricSettingsSnapshot));
    const {
        visualizerMode,
        randomVisualizerModePerSong,
        handleSetVisualizerMode,
    } = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));

    useElectronDisplaySleepBlocker(
        preventDisplaySleepDuringPlayback,
        playerState === PlayerState.PLAYING,
    );

    const visualizerTunings = useVisualizerTunings();

    const showPlayerChromeVisibilityModeStatus = useCallback((mode: PlayerChromeVisibilityMode) => {
        setStatusMsg({
            type: 'info',
            text: t(`status.playerChrome${mode === 'always-hidden' ? 'AlwaysHidden' : mode === 'always-visible' ? 'AlwaysVisible' : 'AutoHide'}`),
            nonce: Date.now(),
        });
    }, [t]);

    const {
        playerChromeVisibilityMode,
        cyclePlayerChromeVisibilityMode,
    } = usePlayerChromeAutoHide({
        autoHidePlayerChrome,
        initialPlayerChromeHidden: isPlayerChromeHidden,
        suppressPointerReveal: isMainWindowClickThroughEnabled,
        setIsPlayerChromeHidden,
        setAutoHidePlayerChromePreference: handleToggleAutoHidePlayerChrome,
        onModeChange: showPlayerChromeVisibilityModeStatus,
    });

    useRandomVisualizerMode({
        currentSong,
        enabled: randomVisualizerModePerSong,
        visualizerMode,
        setVisualizerMode: handleSetVisualizerMode,
    });

    const setLyrics = useMemo(
        () => createLyricsSetter(setLyricsState, lyricFilterPattern, currentSongFullRef, {
            policy: lyricStaffPolicy,
            minDwellSeconds: lyricStaffMinDwellSeconds,
            absorbMode: lyricStaffAbsorbMode,
            pattern: lyricStaffPattern,
        }),
        [lyricFilterPattern, lyricStaffPolicy, lyricStaffMinDwellSeconds, lyricStaffAbsorbMode, lyricStaffPattern],
    );
    // 保存过滤设置后要用新设置重新铺一遍当前歌词，而此时闭包里的 setLyrics 还是旧的。
    const setLyricsRef = useRef(setLyrics);
    setLyricsRef.current = setLyrics;
    const setLyricsStable = useCallback((nextLyrics: LyricData | null) => setLyricsRef.current(nextLyrics), []);

    const handleLyricTimelineOffsetChange = useCallback((offsetMs: number) => {
        setLyricTimelineOffsetMs(offsetMs);
        writeLyricOffset(currentSongFullRef.current?.id, offsetMs);
    }, []);

    // What every lyric consumer (visualizers, OBS source, Stage/Remote mirrors, lyric API) actually
    // uses: the per-song manual correction plus the device-wide audio latency compensation. The panel
    // control below keeps editing the per-song value alone.
    const effectiveLyricTimelineOffsetMs = lyricTimelineOffsetMs + globalLyricTimelineOffsetMs;

    const effectiveLoopMode: StageLoopMode = loopMode;

    const getTargetPlaybackVolume = useCallback(() => (isMuted ? 0 : volume), [isMuted, volume]);

    const persistLastPlaybackCache = useCallback(persistPlaybackCache, []);

    const syncOutputGain = useCallback((targetVolume: number, smoothing = 0.015) => {
        const clampedVolume = clampMediaVolume(targetVolume);

        if (gainNodeRef.current && audioContextRef.current) {
            // Volume only. ReplayGain lives on each deck now, because during a blend the two
            // tracks need their own compensation and this node is shared by both.
            if (smoothing <= 0) {
                gainNodeRef.current.gain.setValueAtTime(
                    clampedVolume,
                    audioContextRef.current.currentTime
                );
            } else {
                gainNodeRef.current.gain.setTargetAtTime(
                    clampedVolume,
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

    const { handleAudioOutputDeviceChange } = useAudioOutputDevice({
        audioRef,
        audioContextRef,
        gainNodeRef,
    });

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
        persistLastPlaybackCache,
        playQueue,
        onlineAudioUrlTtlMs: ONLINE_AUDIO_URL_TTL_MS,
        onlineAudioUrlRefreshBufferMs: ONLINE_AUDIO_URL_REFRESH_BUFFER_MS,
    }), [audioQuality, audioSrc, audioRef, blobUrlRef, currentOnlineAudioUrlFetchedAtRef, currentSong, currentSongRef, lastAudioRecoverySourceRef, onlinePlaybackRecoveryRef, pendingResumeTimeRef, persistLastPlaybackCache, playQueue, setAudioSrc, setCurrentSong, setPlayQueue, shouldAutoPlay]);

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
        coverUrl,
        t,
    });
    const {
        theme,
        setTheme,
        aiTheme,
        customTheme,
        hasCustomTheme,
        themeSourceModel,
        isCustomThemePreferred,
        songThemeAutoSwitchEnabled,
        songThemeAutoGenerateEnabled,
        themeGenerationSource,
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
        saveEditedAiDualTheme,
        applyCustomTheme,
        handleCustomThemePreferenceChange,
        handleSongThemeAutoSwitchChange,
        handleSongThemeAutoGenerateChange,
        handleThemeGenerationSourceChange,
    } = themeController;

    useThemeQuickEditorContext({
        aiTheme,
        customTheme,
        bgMode,
        coverUrl,
        restoreCachedThemeForSong,
    });

    // Navigation and Library Hooks
    // manages current view, selected items, and navigation functions across the app
    const {
        currentView,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection,
        setPendingNavidromeSelection,
        localMusicState,
        setLocalMusicState,
        navigateToPlayer,
        navigateToHome,
        navigateToLattice,
        navigateBackFromLattice,
        navigateBackFromPlayer,
        navigateDirectHome,
        navigateToSearch,
        closeSearchView,
        navigateToCollection,
        pushCollection,
        backCollection,
    } = useAppNavigation();

    usePlayerBottomBarOffset(playerBottomBarOffset);
    usePlayerBottomBarPositioningEntry(navigateToPlayer);

    // Auto-close the player panel when leaving the player view
    useEffect(() => {
        if (currentView !== 'player' && isPanelOpen) {
            setIsPanelOpen(false);
        }
    }, [currentView, isPanelOpen]);

    useEffect(() => {
        if (isPanelOpen) {
            setIsPlayerPanelGuideHotspotActive(previous => previous ? false : previous);
        }
    }, [isPanelOpen]);

    const {
        isSearchOpen,
        searchSourceTab,
        submitSearch,
        loadMoreSearchResults,
    } = useSearchNavigationStore(useShallow(state => ({
        isSearchOpen: state.isSearchOpen,
        searchSourceTab: state.searchSourceTab,
        submitSearch: state.submitSearch,
        loadMoreSearchResults: state.loadMoreSearchResults,
    })));

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
        t,
    });

    const {
        refresh: refreshKugouLibrary,
        logout: logoutKugouLibrary,
        checkLoginStatus: checkKugouLoginStatus,
    } = useKugouLibrary();
    const {
        refresh: refreshQqLibrary,
        logout: logoutQqLibrary,
    } = useQqLibrary();
    const onlineProviderRefreshers = useMemo(() => ({
        netease: refreshUserData,
        kugou: refreshKugouLibrary,
        qq: refreshQqLibrary,
    }), [refreshKugouLibrary, refreshQqLibrary, refreshUserData]);
    const onlineProviderLogouts = useMemo(() => ({
        netease: handleLogout,
        kugou: logoutKugouLibrary,
        qq: logoutQqLibrary,
    }), [handleLogout, logoutKugouLibrary, logoutQqLibrary]);

    const prepareOnlineProviderSwitch = useCallback((_currentProviderId: OnlineProviderId, nextProviderId: OnlineProviderId): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setProviderSwitchPending(prev => {
                prev?.resolve(false);
                return { nextProviderId, resolve };
            });
        });
    }, []);

    const handleConfirmProviderSwitch = useCallback(() => {
        if (!providerSwitchPending) return;
        const { nextProviderId, resolve } = providerSwitchPending;
        setProviderSwitchPending(null);

        // Stops any deck still fading out in the background: this path clears the active deck
        // only, and a tail left running would have no control pointing at it any more.
        automixRef.current?.abortTransition();
        const audio = audioRef.current;
        audio?.pause();
        audio?.removeAttribute('src');
        audio?.load();
        if (audioSrc?.startsWith('blob:')) URL.revokeObjectURL(audioSrc);
        setAudioSrc(null);
        setCurrentSong(null);
        setPlayQueue([]);
        setLyrics(null);
        setCachedCoverUrl(null);
        setIsFmMode(false);
        setPlayerState(PlayerState.IDLE);
        clearPrefetchRuntime();
        // The measurements are keyed by playback key, so the outgoing provider's are unreachable
        // from here on. Dropped alongside the prefetch cache they were gathered with, rather than
        // sitting in memory until the tab is closed.
        clearTrackProfileRuntime();
        useSearchNavigationStore.getState().resetRuntime(nextProviderId);
        useCollectionNavigationStore.getState().clear();

        resolve(true);
    }, [audioRef, audioSrc, providerSwitchPending, setLyrics]);

    const handleCancelProviderSwitch = useCallback(() => {
        if (!providerSwitchPending) return;
        providerSwitchPending.resolve(false);
        setProviderSwitchPending(null);
    }, [providerSwitchPending]);

    const providerSwitchConfirmDialog = useMemo(() => {
        if (!providerSwitchPending) return null;
        const providerLabel = omni.getProviderLabel(providerSwitchPending.nextProviderId);
        return {
            isOpen: true,
            isDaylight,
            title: t('home.switchOnlineProvider'),
            description: t('home.confirmOnlineProviderSwitch', { provider: providerLabel }),
            onConfirm: handleConfirmProviderSwitch,
            onClose: handleCancelProviderSwitch,
        };
    }, [handleCancelProviderSwitch, handleConfirmProviderSwitch, isDaylight, providerSwitchPending, t]);
    const onlineProviderPlatform = useOnlineProviderPlatform(onlineProviderRefreshers, prepareOnlineProviderSwitch, onlineProviderLogouts);
    const handleActiveProviderSyncData = useCallback(async () => {
        const providerId = onlineProviderPlatform.activeProviderId;
        if (providerId === 'netease') {
            await handleSyncData();
            return;
        }

        setIsProviderSyncing(true);
        try {
            const synced = await onlineProviderPlatform.refreshProvider(providerId);
            const refreshedAccount = useOnlineProviderAccountStore.getState().accounts[providerId];
            const authExpired = synced === false && refreshedAccount?.error === 'auth-required';
            setStatusMsg({
                type: synced === false ? 'error' : 'success',
                text: synced === false
                    ? t(authExpired ? 'status.loginExpired' : 'status.syncFailed')
                    : t('status.dataSynced'),
            });
        } catch (error) {
            console.warn('[OmniSync] Provider data sync failed', { providerId, error });
            setStatusMsg({ type: 'error', text: t('status.syncFailed') });
        } finally {
            setIsProviderSyncing(false);
        }
    }, [handleSyncData, onlineProviderPlatform.activeProviderId, onlineProviderPlatform.refreshProvider, setStatusMsg, t]);
    const isActiveProviderSyncing = onlineProviderPlatform.activeProviderId === 'netease'
        ? isSyncing
        : isProviderSyncing;
    const refreshActiveProviderPlaylists = useCallback(
        () => omni.refreshProviderPlaylists(onlineProviderPlatform.activeProviderId),
        [onlineProviderPlatform.activeProviderId],
    );
    useHomeProviderRefresh({
        onlineProviderPlatform,
        refreshActiveProviderPlaylists,
        checkKugouLoginStatus,
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
        isPlayerCapStageActive,
        getPlayerCapDisplayTime,
        playerCapConnectionStatus,
        playerCapPlayers,
        mainPlaybackSnapshotRef,
        stageLyricsClockRef,
        syncStageLyricsClock,
        getSyntheticStageLyricsTime,
        syncNowPlayingClock,
        getNowPlayingDisplayTime,
        loadStageSessionIntoPlayback,
        restoreStagePlaybackHandoff,
        clearPersistedStagePlaybackCache,
        openStagePlayer,
        leaveStagePlayback,
        interruptStagePlaybackForMainTransition,
        clearStagePlaybackSession,
    } = useStagePlaybackController({
        isDev,
        isElectronWindow,
        audioRef,
        currentSongRef,
        shouldAutoPlayRef: shouldAutoPlay,
        pendingResumeTimeRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef,
        setLyrics,
        setIsLyricsLoading,
        navigateToPlayer,
    });

    const {
        restoreStatus: windowPlaybackHandoffRestoreStatus,
        toggleTransparentModeWithHandoff,
    } = useElectronWindowPlaybackHandoff({
        isElectronWindow,
        userId: user?.id,
        navigateToPlayer,
        audioRef,
        mainPlaybackSnapshotRef,
        stageStatus,
        stageSource,
        stageLyricsClockRef,
        nowPlayingTrack,
        nowPlayingLyricPayload,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        getNowPlayingDisplayTime,
        restoreStagePlaybackHandoff,
        setLyrics,
        setIsLyricsLoading,
        blobUrlRef,
        shouldAutoPlayRef: shouldAutoPlay,
        pendingResumeTimeRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef,
        applyTransparentPlayerBackground: handleToggleTransparentPlayerBackground,
        restoreCachedThemeForSong,
        persistLastPlaybackCache,
    });

    const { handleDirectHomeFromPanel } = useMemo(
        () => createPanelNavigation(navigateDirectHome),
        [navigateDirectHome],
    );

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
        addCurrentSongToOnlinePlaylist,
        addCurrentSongToNavidromePlaylist,
        createCurrentNavidromePlaylist,
        loadCurrentSongLyricPreview,
        handleLocalQueueAdd,
        onPlayLocalSong,
        onPlayNavidromeSong,
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
        handleAutoMatchBestLyricForCurrentSong,
        handleLike,
    } = useLibraryPlaybackController({
        likedSongIds,
        userId: user?.id,
        setLyrics,
        setIsLyricsLoading,
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
        userId: user?.id,
        blobUrlRef,
        currentOnlineAudioUrlFetchedAtRef,
        setLyrics,
        restoreCachedThemeForSong,
        persistLastPlaybackCache,
        clearPersistedStagePlaybackCache,
        loadLocalSongs,
        loadLocalPlaylists,
        canRestoreSession: windowPlaybackHandoffRestoreStatus === 'none',
        shouldAutoPlayRef: shouldAutoPlay,
    });

    const localLibraryCatalog = useLocalLibraryCatalog(localSongs);
    const openHomeCollection = useCallback(
        (collection: GridViewCollectionDescriptor) => navigateToCollection(collection, 'home'),
        [navigateToCollection],
    );
    const handleSaveLyricFilterPattern = useMemo(() => createLyricFilterPatternSaver({
        currentPattern: lyricFilterPattern,
        handleSetLyricFilterPattern,
        handleSetLyricStaffPolicy,
        handleSetLyricStaffMinDwellSeconds,
        handleSetLyricStaffAbsorbMode,
        handleSetLyricStaffPattern,
        loadCurrentSongLyricPreview,
        setLyrics: setLyricsStable,
    }), [
        lyricFilterPattern,
        handleSetLyricFilterPattern,
        handleSetLyricStaffPolicy,
        handleSetLyricStaffMinDwellSeconds,
        handleSetLyricStaffPattern,
        loadCurrentSongLyricPreview,
        setLyricsStable,
    ]);

    const { addNavidromeSongsToQueue, applyQueueBatchOperation, removeQueueSong, moveQueueSongToEnd, moveQueueSongToNext } = useMemo(() => createQueueMutations({
        currentSong,
        playQueue,
        persistLastPlaybackCache,
        t,
        queueAddBehavior,
    }), [currentSong, playQueue, persistLastPlaybackCache, t, queueAddBehavior]);

    // --- Effects ---

    /**
     * The track the listener can see, which a blend holds on the OUTGOING song while the queue has
     * already moved to the incoming one. Null whenever the picture is live, so queue navigation
     * falls through to `currentSong` exactly as before outside a transition.
     */
    const getDisplaySong = useCallback(() => automixRef.current?.transitionDisplay?.song ?? null, []);
    /** A manual skip overtakes a running blend; this is how the queue tells it so. */
    const endHeldTransition = useCallback(() => automixRef.current?.abortTransition(), []);

    const {
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        clearPendingUnavailableSkip,
        addOnlineSongToQueue,
        addOnlineSongsToQueue,
        playSong,
        playOnlineQueueFromStart,
        handleQueueAddAndPlay,
        handleSearchOverlaySubmit,
        handleSearchLoadMore,
        handleSearchResultPlay,
        handleSearchResultAddToQueue,
        handleUnavailableReplacementConfirm,
        handleNextTrack,
        handlePrevTrack,
        skipAfterPlaybackFailure,
        handleStageExternalPlayRequest,
        shuffleQueue,
        clearQueue,
    } = usePlaybackQueueController({
        isNowPlayingStageActive,
        shouldNavigateToPlayerOnTrackChange: currentView !== 'lattice',
        localSongs,
        localLibraryCatalog,
        userId: user?.id,
        setLyrics,
        setIsLyricsLoading,
        navigateToPlayer,
        navigateToSearch,
        persistLastPlaybackCache,
        restoreCachedThemeForSong,
        interruptStagePlaybackForMainTransition,
        onPlayLocalSong,
        onPlayNavidromeSong,
        onAddLocalSongToQueue: handleLocalQueueAdd,
        onAddNavidromeSongsToQueue: addNavidromeSongsToQueue,
        searchDeps: {
            submitSearch,
            loadMoreSearchResults,
        },
        audioRef,
        blobUrlRef,
        shouldAutoPlayRef: shouldAutoPlay,
        currentSongRef,
        mainPlaybackSnapshotRef,
        playbackAutoSkipCountRef,
        pendingResumeTimeRef,
        currentOnlineAudioUrlFetchedAtRef,
        lastAudioRecoverySourceRef,
        getDisplaySong,
        endHeldTransition,
    });
    const handleSearchResultArtistOpen = useCallback(async (
        track: UnifiedSong,
        artistName: string,
        artistId?: MediaId,
        entityId?: string,
    ) => {
        try {
            const collection = await createSearchArtistCollection(track, artistName, artistId, entityId);
            if (collection) {
                navigateToCollection(collection, 'search');
                return;
            }
        } catch (error) {
            console.warn('[CatalogNavigation] Failed to resolve artist:', error);
        }
        setStatusMsg({ type: 'error', text: t('search.catalogUnavailable') });
    }, [navigateToCollection, setStatusMsg, t]);
    const handleSearchResultAlbumOpen = useCallback(async (
        track: UnifiedSong,
        albumName: string,
        albumId?: MediaId,
        entityId?: string,
    ) => {
        try {
            const collection = await createSearchAlbumCollection(track, albumName, albumId, entityId);
            if (collection) {
                navigateToCollection(collection, 'search');
                return;
            }
        } catch (error) {
            console.warn('[CatalogNavigation] Failed to resolve album:', error);
        }
        setStatusMsg({ type: 'error', text: t('search.catalogUnavailable') });
    }, [navigateToCollection, setStatusMsg, t]);

    usePlaybackUiEffects({
        statusMsg,
        updateCacheSize,
        loadLocalSongs,
        loadLocalPlaylists,
        localMusicUpdatedEvent: LOCAL_MUSIC_UPDATED_EVENT,
        blobUrlRef,
        volumePreviewFrameRef,
        onClearPendingUnavailableSkip: clearPendingUnavailableSkip,
    });

    // Bridges the automix hook (built here) to the media-cache writer (built a little further down in
    // usePlaybackAudioBridge). A ref rather than a prop because the writer does not exist yet at this
    // call - the same ordering the harvest/advance callbacks inside the hook solve the same way.
    const cachePlayedOutRef = useRef<(song: SongResult, src: string | null) => void>(() => { });

    // Reads a local track's bytes off its own file handle, so automix can separate a next-up local
    // song whose head has no prefetch URL and never enters the online media cache. Resolved here
    // because App owns the local library; the real LocalSong (with its handle) is looked up by id.
    const getLocalStemBytes = useCallback(async (song: SongResult): Promise<ArrayBuffer | null> => {
        if (!isLocalPlaybackSong(song)) return null;
        const local = localSongs.find(candidate => candidate.id === song.localRef.songId);
        return getLocalSongArrayBuffer((local ?? song) as unknown as LocalSong);
    }, [localSongs]);

    const automix = useAutomixDecks({
        audioRef,
        audioContextRef,
        currentSongKeyRef: currentSongRef,
        coverUrl,
        loopMode: effectiveLoopMode,
        isEnabled: automixEnabled && !isNowPlayingStageActive,
        transition: transitionSettings,
        onAdvanceTrack: () => {
            // Same advance the end of a track would trigger, only early enough for the outgoing
            // deck to still be sounding when the next one starts. `fromSong` because this IS the
            // advance: it steps from the track the app is on, never from the held picture, and
            // saying so keeps it independent of whether React has committed the hold yet.
            void handleNextTrack({
                allowStopOnMissing: true,
                shouldNavigateToPlayer: false,
                fromSong: currentSong ?? undefined,
            });
        },
        onDeckPlayedOut: (song, src) => cachePlayedOutRef.current(song, src),
        getLocalStemBytes,
    });

    automixRef.current = automix;

    /**
     * The now-playing picture, which lags the app's own idea of what is playing.
     *
     * A transition advances the queue at its START, because that advance is what loads and plays
     * the next track. So from that moment `currentSong`, the lyrics, the cover and the progress
     * bar all describe the track that is arriving - seconds before anybody hears it arrive, which
     * is the listener still hearing one song and reading another one's title.
     *
     * Everything here is presentation and nothing here touches the audio path. That is deliberate:
     * the obvious fix is to defer the advance itself, and it does not work, because for anything
     * already in the media cache `playSong` mints a fresh blob URL - `warmSrc` is null for those
     * tracks and the advance is the only thing that ever gives the incoming deck a source. What is
     * safe to hold back is the picture.
     */
    // Derived in usePlaybackStore now, so that any consumer can read the display layer without
    // being handed it. The ternaries (rather than `??`) live there for the same reason they lived
    // here: null is a real value for lyrics, cover and duration.
    const displaySong = usePlaybackStore(selectDisplaySong);
    const displayCoverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const displayDuration = usePlaybackStore(selectDisplayDuration);
    /** While true the progress bar is driven by the deck that is finishing, not the active one. */
    const isShowingTail = usePlaybackStore(selectIsShowingTail);
    /**
     * The transport the picture belongs to, which is not idle just because the next track is.
     *
     * `playSong` resets the state to IDLE for the track it is loading, and that is correct for the
     * track it is loading - but the advance happens at the START of a blend, so nothing puts it
     * back until the incoming deck actually starts making sound. Measured at about a second, and
     * the outgoing deck is sounding for all of it: "idle" there describes nothing anybody can hear.
     *
     * IDLE only. PAUSED during a blend is a listener pressing pause and has to be shown.
     */
    const displayPlayerState = usePlaybackStore(selectDisplayPlayerState);
    // The bar is driven by the tail deck for the length of a blend, so at BOTH edges of the hold
    // it briefly reads one track's position against the other's length. One write at each edge
    // rather than waiting up to a quarter second for the next timeupdate to correct it.
    //
    // Entering used to be missing, and that edge is the one anybody sees: `playSong` zeroes the
    // clock for the arriving track from the same block that starts the hold, so the bar dropped to
    // the beginning and stayed there until the OUTGOING deck's next timeupdate put it back - a song
    // change that visibly happened and then visibly un-happened, while the title never moved.
    const getDisplayElement = automix.getDisplayElement;
    useEffect(() => {
        const element = isShowingTail ? getDisplayElement() : audioRef.current;
        if (element) currentTime.set(element.currentTime);
    }, [audioRef, currentTime, getDisplayElement, isShowingTail]);

    // Restore the displayed song's remembered manual offset (0 when never adjusted, so a fresh
    // song behaves exactly like the old reset). Keyed on the DISPLAYED song, not the playing one:
    // this is what the lyrics on screen are read against, and firing it when a blend arms would
    // both mis-offset the outgoing lyrics and snap their read-head to zero - a lyric view that
    // scrolls back to the top of a song it is still showing, which reads as an early song change.
    // currentSongFullRef.current holds the live song for the change handler above, so a user's
    // correction is still saved against the track the app has actually committed to.
    //
    // There must be exactly ONE of these. Upstream grew its own copy keyed on `currentSong`, the
    // merge kept both, and the live-keyed one fired on every blend ARM - snapping the read-head to
    // the top of the song still on screen, which the diorama reads as a loop restart and answers
    // with a full camera flight that lands back where it started. That is the "it changes song,
    // then changes song again" report.
    useEffect(() => {
        const nextOffsetMs = readLyricOffset(displaySong?.id);
        setLyricTimelineOffsetMs(nextOffsetMs);
        lyricCurrentTime.set(-(nextOffsetMs + globalLyricTimelineOffsetMs) / 1000);
        // Exactly ONE of these per song change, including across an automix blend. Two inside one
        // transition means the duplicate effect described above is back: the second one fires on
        // the arm, resets the read-head under the song still on screen, and the diorama answers it
        // with a camera flight that lands where it started.
        console.log(
            `[Lyrics] read-head reset for the DISPLAYED song ${String(displaySong?.id ?? 'none')}`
            + ` (per-song ${nextOffsetMs}ms + device ${globalLyricTimelineOffsetMs}ms)`,
        );
        // globalLyricTimelineOffsetMs is intentionally not a dependency: it is a device-level constant
        // the user tunes in Lab settings, and re-running this effect on it would fight the panel value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displaySong?.id, lyricCurrentTime]);

    /**
     * The now playing card is allowed on screen right now.
     *
     * One definition for two readers - the overlay model, which mounts the card, and the track-end
     * countdown below, which is only worth running while something can show its result. The lyrics
     * page always allows it; the home page is opt-in, and that opt-in is the whole rule: how the app
     * arrived at the home page does not enter into it, so a cold start that lands there and a walk
     * back from the lyrics page behave the same.
     */
    const stageTrackPillOnScreen = stageTrackPillMode !== 'never'
        && (currentView === 'player' || (currentView === 'home' && stageTrackPillOnHome));

    /**
     * Open the right-hand panel on its song card - what clicking the now playing card does once you
     * are already on the lyrics page. Same two calls the command palette's "Panel: cover" makes, so
     * the card and the command land in the same place.
     */
    const openSongCardPanel = useCallback(() => {
        setPanelTab('cover');
        setIsPanelOpen(true);
    }, []);

    /**
     * The queue track a plain track-end would advance to, or null when nothing resolvable.
     * Mirrors handleNextTrack's index rules so the preview is always the track that will actually play.
     */
    const nextUpTrack = useMemo(() => resolveNextUpTrack({
        playQueue,
        song: currentSong,
        loopMode: effectiveLoopMode,
        isFmMode,
        isStageActive: isNowPlayingStageActive,
        fallbackToQueueHead: true,
    }), [playQueue, currentSong, effectiveLoopMode, isFmMode, isNowPlayingStageActive]);

    /**
     * The track a running blend is bringing in: the queue successor of the DISPLAYED song.
     * The displayed picture is frozen on the outgoing track for the whole blend, while currentSong
     * advances asynchronously at the arm — reading the successor of the displayed song is correct
     * from the first frame and stays correct until settle. No queue-head fallback here: mid-blend a
     * song missing from the queue means the queue moved under the blend, and guessing would announce
     * a track that is not arriving.
     */
    const blendNextUpTrack = useMemo(() => (isShowingTail ? resolveNextUpTrack({
        playQueue,
        song: displaySong,
        loopMode: effectiveLoopMode,
        isFmMode,
        isStageActive: isNowPlayingStageActive,
    }) : null), [isShowingTail, displaySong, playQueue, effectiveLoopMode, isFmMode, isNowPlayingStageActive]);

    /** True while the card previews the next track (plain track-end countdown, not the blend). */
    const [countdownActive, setCountdownActive] = useState(false);
    useMotionValueEvent(currentTime, 'change', (time) => {
        const shouldPreview = stageTrackPillOnScreen
            && nextUpTrack !== null
            && Number.isFinite(displayDuration)
            && displayDuration > 0
            && displayDuration - time > 0
            && displayDuration - time <= NEXT_UP_LEAD_SEC;
        setCountdownActive(prev => (prev === shouldPreview ? prev : shouldPreview));
    });

    /**
     * The track the card shows while announcing a switch.
     * During a blend the arriving track comes from the queue successor of the displayed
     * (outgoing) song — never from currentSong, which lags the arm by a few async frames and
     * briefly made the card announce the OUTGOING song as "next".
     */
    const stageNextUpTrack = isShowingTail ? blendNextUpTrack : nextUpTrack;
    const stageNextUp = useMemo(() => {
        if (stageTrackPillMode === 'never' || !stageNextUpTrack) return null;
        return {
            title: stageNextUpTrack.name || '',
            artist: getSongArtistLabel(stageNextUpTrack) || null,
            // Same sanitising every other cover in the app goes through (see createCoverUrlResolver):
            // upgrades the http: covers netease/kugou still hand out - blocked as mixed content in the
            // packaged window - and keeps only the first of a comma-joined multi-value.
            coverUrl: toSafeRemoteUrl(getSongCoverUrl(stageNextUpTrack)) ?? null,
        };
    }, [stageTrackPillMode, stageNextUpTrack]);
    const stageIsNextUp = stageNextUp !== null && (isShowingTail || countdownActive);


    // The duration normally arrives on `loadedmetadata`, which fires when an element is given a
    // source. A warmed deck breaks that: it is handed the next track seconds early, fires the event
    // while it is still idle - where every handler here ignores it - and then never fires again,
    // because the whole point of warming is that its src string does not change when it takes over.
    // Meanwhile playSong has reset the duration to 0 for the new track.
    //
    // So a source the element already knows about needs reading directly. Keyed on `audioSrc`
    // rather than on the deck role, because the role swaps a moment BEFORE playSong zeroes the
    // duration and reading first would simply be overwritten.
    //
    // Left at zero this is not only a wrong progress bar: checkTransitionPoint needs a duration to
    // schedule against, so the track after a blend would get no transition at all.
    useEffect(() => {
        const element = audioRef.current;
        // currentSrc, not the src attribute: it only names a resource the element has actually
        // selected, so a deck one tick into loading something new cannot answer with the old
        // track's duration.
        if (!audioSrc || element?.currentSrc !== audioSrc) return;
        if (Number.isFinite(element.duration) && element.duration > 0) {
            setDuration(element.duration);
        }
    }, [audioSrc, audioRef, setDuration]);

    const { setupAudioAnalyzer, cacheSongAssets, cacheSongAssetsFor, adoptActiveDeckSource } = usePlaybackAudioBridge({
        audioRef,
        localSongs,
        isLyricsLoading,
        shouldAutoPlayRef: shouldAutoPlay,
        audioContextRef,
        analyserRef,
        gainNodeRef,
        connectDecks: automix.connectDecks,
        getActiveChain: automix.getActiveChain,
        suppressAutoplayRef: automix.suppressAutoplayRef,
        isAutoplayHeld: automix.autoplayHeld,
        syncOutputGain,
        getTargetPlaybackVolume,
        getCoverUrl,
        updateCacheSize,
    });

    // Now the writer exists, point the automix settle path at it. A track that blends out never fires
    // `ended`, so this is the only place its assets get cached; the cover is derived from the exit
    // song's own metadata inside `cacheSongAssetsFor` rather than from the now-arriving track's view.
    cachePlayedOutRef.current = (song, src) => { void cacheSongAssetsFor(song, src); };

    /**
     * The two controls that mean something different while a blend is in flight, held as refs.
     *
     * Both are implemented far below, once automix and playSong exist, and both are needed above
     * that point - the transport controller here, the remote bridge a little further down. A ref
     * plus a stable wrapper is what lets those be wired now and written later without either one
     * re-subscribing every render.
     */
    const seekDuringTransitionRef = useRef<(time: number) => boolean>(() => false);
    const pauseDuringTransitionRef = useRef<() => boolean>(() => false);
    /** Shared by every entry point that can seek while a blend is in flight. */
    const seekDuringTransition = useCallback((time: number) => seekDuringTransitionRef.current(time), []);
    const handlePauseDuringTransition = useCallback(() => pauseDuringTransitionRef.current(), []);

    const { resumePlayback, pausePlayback } = usePlaybackTransportController({
        stageActiveEntryKind,
        isNowPlayingStageActive,
        audioRef,
        audioContextRef,
        stageLyricsClockRef,
        setupAudioAnalyzer,
        syncOutputGain,
        getTargetPlaybackVolume,
        shouldRefreshCurrentOnlineAudioSource,
        recoverOnlinePlaybackSource,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        pauseDuringTransition: handlePauseDuringTransition,
    });
    useNavidromeScrobbleReporter({
        audioRef,
        currentSong,
        activeDeck: automix.activeDeck,
    });

    const {
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        taskbarHasTrackRef,
        taskbarPlayerStateRef,
    } = useTransportCommandRefs({ resumePlayback, pausePlayback, handlePrevTrack, handleNextTrack });

    useMediaSessionBridge({
        audioRef,
        // All three describe the DISPLAYED track, and that is the whole of the fix: the metadata,
        // the clock the position is read off, and the source the readiness guard compares against.
        // Pairing the displayed song with the ACTIVE deck put the outgoing track's title over the
        // incoming track's duration and progress for the length of every blend - the system panel
        // named one song and counted another. `audioSrc` moves with the element or the guard fails
        // for the whole blend and the panel stops updating instead.
        getDisplayAudioElement: automix.getDisplayElement,
        audioSrc: automix.tailSrc ?? audioSrc,
        currentSong: displaySong,
        cachedCoverUrl: displayCoverUrl ?? cachedCoverUrl,
        playerState: displayPlayerState,
        isNowPlayingStageActive,
        unknownArtistLabel: t('ui.unknownArtist'),
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
        navigateToPlayer,
        pausePlayback,
        resumePlayback,
    });

    const {
        publishStagePlayerPlaybackUpdate,
    } = useElectronPlaybackBridge({
        isElectronWindow,
        playerChromeVisibilityMode,
        onRemotePlayerChromeVisibilityModeCycle: cyclePlayerChromeVisibilityMode,
        isStagePlayerSnapshotEnabled: stageStatus?.enabled === true,
        isNowPlayingControlDisabledRef,
        audioRef,
        // The deck the held picture belongs to. Its song, lyrics, cover, duration and transport are
        // read from the display selectors inside the bridge; this is the element that goes with them.
        getDisplayAudioElement: automix.getDisplayElement,
        effectiveLoopMode,
        isNowPlayingStageActive,
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        taskbarHasTrackRef,
        taskbarPlayerStateRef,
        exportState,
        lyricTimelineOffsetMs: effectiveLyricTimelineOffsetMs,
        onRemoteExportCommand: handleExportCommand,
        onExternalPlayRequest: handleStageExternalPlayRequest,
        onRemoteCycleLoopMode: handleToggleLoopMode,
        onRemoteTransitionSeek: seekDuringTransition,
        publishTrackTransition: automixEnabled,
        isTrackTransitionAudible: automix.isTransitionAudible,
        // Keyed on the displayed track, so the like state matches the song the remote is showing
        // while a blend is held rather than the one arriving underneath it.
        isLiked: resolveSongLiked(displaySong, { isLocalSongLiked, starredNavidromeSongIds, likedSongIds }),
        onLike: handleLike,
    });

    usePlaybackVisualizerBridge({
        audioRef,
        analyserRef,
        isTransitionAudible: automix.isTransitionAudible,
        // The loop below is what actually drives the progress bar and the lyric read-head, sixty
        // times a second off whichever deck it is pointed at. Both have to be the held picture's,
        // or the bar and the lyrics run on the incoming track under the outgoing one's title.
        getDisplayElement: automix.getDisplayElement,
        animationFrameRef,
        effectiveLoopMode,
        isNowPlayingStageActive,
        isPlayerCapStageActive,
        stageActiveEntryKind,
        stageLyricsSession,
        stageLyricsClockRef,
        getSyntheticStageLyricsTime,
        syncStageLyricsClock,
        getNowPlayingDisplayTime,
        getPlayerCapDisplayTime,
        syncNowPlayingClock,
        lyricTimelineOffsetMs: effectiveLyricTimelineOffsetMs,
    });

    const {
        togglePlay,
        toggleLoop,
        handleChangeReplayGainMode,
        handleContainerClick,
        handleFmTrash,
    } = usePlaybackInteractionBridge({
        stageActiveEntryKind,
        isNowPlayingStageActive,
        audioRef,
        // Play-vs-pause cannot be decided off the active deck mid-blend: that is the arriving track,
        // and it is silent for the whole lead.
        isTransitionAudible: automix.isTransitionAudible,
        // The arrow keys check for a blend first, the way the bar and the remote do, rather than
        // writing to the active deck - which mid-blend is not the deck the listener is watching.
        seekDuringTransition,
        stageLyricsClockRef,
        cyclePlayerChromeVisibilityMode,
        handleNextTrack,
        handlePrevTrack,
        navigateBackFromPlayer,
        pausePlayback,
        resumePlayback,
        syncStageLyricsClock,
    });

    const { personalFmSelection, personalFmSelectionLabel, isPersonalFmModeSupported, setPersonalFmSelection } = usePersonalFmModeController({
        isFmMode,
        currentSong,
        playSong,
        t: (key: string, fallback?: string) => t(key, fallback ?? ''),
    });

    // Wallpaper mode removes normal window semantics (no minimize/maximize/close, no dragging, and
    // click-through is managed by the main process), so the whole custom titlebar strip stays off.
    const usesCustomWindowChrome = isElectronWindow && !wallpaperMode;
    const isPlayerPageTransparent = transparentPlayerBackground || enablePlayerPageNativeBlur;
    const shouldUseTransparentAppBackground = isPlayerPageTransparent;
    const appStyle = useMemo(() => buildAppStyle({
        bgMode,
        isDaylight,
        theme,
        daylightTheme: DAYLIGHT_THEME,
        defaultTheme: DEFAULT_THEME,
        transparentBackground: shouldUseTransparentAppBackground,
    }), [bgMode, isDaylight, shouldUseTransparentAppBackground, theme]);
    const { visualizerTheme, visualizerSubtitleTheme, visualizerGeometrySeed } = useMemo(() => buildVisualizerTheme({
        appStyle,
        theme,
        lyricsFontStyle,
        lyricsFontWeight,
        lyricsCustomFontFamily,
        lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
        subtitleFontWeight,
        subtitleFontFamily,
        subtitleFontFallbackFamilies,
        // The displayed song, not the playing one. This id is the visualizer's geometry seed, and a
        // visualizer with no "song changed" event of its own infers one from the seed changing - the
        // diorama flies its camera to a whole new corridor on it. Fed the live id, that flight starts
        // the moment a blend arms, builds the new scene out of the lyrics still on screen, and lands
        // back on the same song: a full song-change animation that changes nothing, followed by the
        // real one when the hold releases.
        currentSongId: displaySong?.id,
        visualizerMode,
    }), [
        appStyle,
        displaySong?.id,
        lyricsCustomFontFamily,
        lyricsFontFallbackFamilies,
        lyricsFontStyle,
        lyricsFontWeight,
        subtitleFontFallbackFamilies,
        subtitleFontFamily,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
        subtitleFontWeight,
        theme,
        visualizerMode,
    ]);
    const isNowPlayingControlDisabled = isNowPlayingStageActive;

    useElectronWindowChrome();
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
    const {
        obsBrowserSourceStatus,
        isObsBrowserSourceRendering,
        refreshObsBrowserSourceStatus,
    } = useObsBrowserSourcePublisher({
        isElectronWindow,
        stageSource,
        coverUrl,
        offsetMs: effectiveLyricTimelineOffsetMs,
        theme: visualizerTheme,
        subtitleTheme: visualizerSubtitleTheme,
        hideTranslationSubtitle: shouldHidePlayerTranslationSubtitle,
        seed: visualizerGeometrySeed,
    });
    const {
        lyricApiStatus,
        setLyricApiEnabled,
    } = useLyricApiPublisher({
        isElectronWindow,
        lyrics,
        offset: effectiveLyricTimelineOffsetMs,
    });
    const canGenerateAITheme = Boolean((lyrics?.lines.length ?? 0) > 0 || currentSong?.isPureMusic);
    const generateCurrentSongTheme = useCallback(() => {
        void generateAITheme(lyrics, currentSong);
    }, [currentSong, generateAITheme, lyrics]);
    const toggleDaylightMode = useCallback(() => {
        handleToggleDaylight(!isDaylight);
    }, [handleToggleDaylight, isDaylight]);
    const currentSearchSourceTabInPalette = useMemo(() => resolveCommandPaletteSearchSource(
        currentSong,
        searchSourceTab,
        onlineProviderPlatform.activeProviderId,
    ), [currentSong, onlineProviderPlatform.activeProviderId, searchSourceTab]);
    const toggleBrowserFullscreen = useCallback(async () => {
        if (typeof window !== 'undefined' && window.electron?.toggleFullscreenWindow) {
            return window.electron.toggleFullscreenWindow();
        }

        if (typeof document === 'undefined') {
            return false;
        }

        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                return true;
            }

            await document.documentElement.requestFullscreen();
            return true;
        } catch (error) {
            console.warn('[CommandPalette] Failed to toggle browser fullscreen:', error);
            return false;
        }
    }, []);
    const toggleRemoteControlWindow = useCallback(async () => {
        if (!window.electron?.toggleRemoteControl) {
            return false;
        }

        return window.electron.toggleRemoteControl();
    }, []);
    const toggleMainWindowAlwaysOnTop = useCallback(async () => {
        if (!window.electron?.getMainWindowAlwaysOnTop || !window.electron?.setMainWindowAlwaysOnTop) {
            return false;
        }

        const enabled = await window.electron.getMainWindowAlwaysOnTop();
        await window.electron.setMainWindowAlwaysOnTop(!enabled);
        return true;
    }, []);
    const handleSleepTimerExpireFallback = useCallback(() => {
        pausePlayback();
        setStatusMsg({ type: 'info', text: t('notifications.sleepTimerPlaybackPaused') });
    }, [pausePlayback, setStatusMsg, t]);
    useSleepTimer({
        enabled: sleepTimerEnabled,
        hours: sleepTimerHours,
        minutes: sleepTimerMinutes,
        onExpireFallback: handleSleepTimerExpireFallback,
    });
    // Saving or clearing a segmentation has to re-lay the current song's lyrics, so it needs the
    // same preview-then-setLyrics pair the lyric filter saver uses. currentSongFullRef rather than
    // currentSong so the actions stay stable across renders.
    const lyricSegmentationActions = useMemo(() => createLyricSegmentationActions({
        getCurrentSong: () => currentSongFullRef.current,
        loadCurrentSongLyricPreview,
        setLyrics: setLyricsStable,
    }), [loadCurrentSongLyricPreview, setLyricsStable]);
    const commandPaletteContext = useCommandPaletteContext({

        currentSearchSourceTab: currentSearchSourceTabInPalette,
        localSongs,
        localLibraryCatalog,
        navigateToSearch,

        previewVolume: handlePreviewVolume,
        togglePlay,
        toggleLoop,
        next: handleNextTrack,
        prev: handlePrevTrack,
        playSong,
        shuffleQueue,
        clearQueue,
        applyQueueBatchOperation,
        removeQueueSong,
        moveQueueSongToNext,
        moveQueueSongToEnd,
        setReplayGainMode: handleChangeReplayGainMode,
        isPersonalFmModeSupported,
        setPersonalFmSelection,
        runAutoMatchBestLyric: handleAutoMatchBestLyricForCurrentSong,
        toggleSongLike: handleLike,
        isSongLiked: resolveSongLiked(displaySong, { isLocalSongLiked, starredNavidromeSongIds, likedSongIds }),

        navigateToHome,
        navigateToPlayer,
        navigateToLattice,
        toggleBrowserFullscreen,
        toggleRemoteControlWindow,
        toggleMainWindowAlwaysOnTop,


        toggleTransparentBackground: () => { void toggleTransparentModeWithHandoff(!transparentPlayerBackground); },
        toggleDaylightMode,
        cycleLyricStaffPolicy: () => handleSaveLyricFilterPattern({
            pattern: lyricFilterPattern,
            staffPolicy: nextLyricStaffPolicy(lyricStaffPolicy),
            staffMinDwellSeconds: lyricStaffMinDwellSeconds,
            staffAbsorbMode: lyricStaffAbsorbMode,
            staffPattern: lyricStaffPattern,
        }),
        cycleLyricStaffAbsorbMode: () => handleSaveLyricFilterPattern({
            pattern: lyricFilterPattern,
            staffPolicy: lyricStaffPolicy,
            staffMinDwellSeconds: lyricStaffMinDwellSeconds,
            staffAbsorbMode: nextLyricStaffAbsorbMode(lyricStaffAbsorbMode),
            staffPattern: lyricStaffPattern,
        }),
        canGenerateAITheme,
        isGeneratingTheme,
        generateAITheme: generateCurrentSongTheme,
        themeGenerationSource,
        setThemeGenerationSource: handleThemeGenerationSourceChange,
        voiceInputPauseSupported: isElectronWindow && typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win'),
        canUseTransitionPerformance,
    }, lyricSegmentationActions);
    const commandPalette = useCommandPalette({
        isBlocked: isSettingsModalOpen
            || (currentView === 'home' && isSearchOpen)
            || showLyricMatchModal
            || showNaviLyricMatchModal
            || showOnlineLyricMatchModal
            || Boolean(pendingUnavailableReplacement),
        context: commandPaletteContext,
    });
    // The FM tab reuses the palette's picker instead of carrying its own copy of the mode list.
    // Read through a ref rather than depended on: openCommandById tracks the palette's isExecuting
    // flag, so depending on it would rebuild the player panel model on unrelated renders. The
    // picker only ever runs from a click, so the latest one is the right one.
    const openCommandByIdRef = useRef(commandPalette.openCommandById);
    openCommandByIdRef.current = commandPalette.openCommandById;
    const handleOpenFmModePicker = useMemo(() => (
        isPersonalFmModeSupported ? () => openCommandByIdRef.current(PERSONAL_FM_MODE_COMMAND_ID) : undefined
    ), [isPersonalFmModeSupported]);
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
    const activeDualTheme = useMemo(() => {
        if (bgMode === 'custom' && customTheme) {
            return customTheme;
        }
        if (bgMode === 'ai') {
            return aiTheme ?? FALLBACK_AI_DUAL_THEME;
        }
        return BASE_DUAL_THEME;
    }, [bgMode, customTheme, aiTheme]);

    // Built while the overlay is open even outside dev, because the packaged desktop build has no
    // console of its own and this overlay is the only way to read one. Still gated rather than
    // unconditional: nothing here is worth computing on every render of a session nobody is
    // debugging.
    const devDebugSnapshot = useMemo(() => (
        isDev || isDevDebugOverlayVisible
            ? buildDebugSnapshot({
                shortcutLabel: DEV_DEBUG_SHORTCUT_LABEL,
                currentSong,
                currentView,
                playerState,
                visualizerMode,
                lyrics: lyrics,
                currentLineIndex,
                currentTimeValue: currentTime.get(),
                audioSrc,
                coverUrl,
                nowPlayingDebug: nowPlayingDebugSnapshot,
                themeMode: bgMode,
                activeDualTheme,
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
        isDevDebugOverlayVisible,
        nowPlayingDebugSnapshot,
        playerState,
        lyrics,
        visualizerMode,
        bgMode,
        activeDualTheme,
    ]);
    const themeParkSeedTheme = useMemo(() => getThemeParkSeedTheme(), [getThemeParkSeedTheme]);
    useSongThemeAutoGeneration({
        enabled: songThemeAutoSwitchEnabled && songThemeAutoGenerateEnabled,
        isLyricsLoading,
        themeGenerationSource,
        generateAITheme,
    });
    // Loads the playing song's saved word segmentation into the store the lyric setter reads.
    useLyricWordSegmentation();
    /**
     * Cancels a blend back onto the track the listener is hearing, or null when there is none.
     *
     * Mid-blend the app runs two of everything: the song on screen is the one FINISHING - the
     * outgoing deck's - while `audioRef`, `currentSong` and the transport already name the track
     * arriving underneath it. So any control the listener presses about "this song" lands on a deck
     * that is not the one they mean, and the two reports this answers are the same mistake twice: a
     * drag moved the hidden deck and the bar snapped back, a pause stopped the hidden deck and the
     * blend ran on into the next song regardless.
     *
     * The track they mean is already loaded and sounding on its own deck, so nothing needs
     * reloading: cancel onto that deck (`cancelBlendKeepingTail`) and hand it back the whole frozen
     * picture. An older fix re-played the song from scratch, which ran the entire song-change path -
     * a fresh blob URL, lyrics refetched, the read-head reset - for a track that never left; the
     * visualizers read that as a song change and answered with a switch animation, and the reload
     * cost a visible hitch. `adoptActiveDeckSource` is what stops the audio bridge reloading the
     * deck out from under us. (Touching that deck at all depends on its blob URL still being live -
     * see `retireBlobUrl`, which is why the source outlives the advance now.)
     *
     * Returns the deck now carrying that track, for the caller to move or to stop. `resume` says
     * which way the transport is going afterwards, and it is the only difference between the two
     * callers.
     */
    const cancelBlendToDisplayedTrack = (resume: boolean): HTMLAudioElement | null => {
        if (!automix.isTransitionAudible()) return null;
        // The whole frozen picture, not just the song. A blend deliberately runs two sets of these:
        // the visible ones (this snapshot, the OUTGOING track) and the live state, which `playSong`
        // moved to the incoming track at the arm. Cancelling clears the snapshot, so every value in
        // it has to be handed back to the live state or the app keeps the incoming track's copy
        // under the outgoing track's name. `duration` is the one that breaks playback rather than
        // just looking wrong: the progress bar would rescale to the OTHER song's length, so the next
        // drag maps to a time past the real end of this one and the deck stops there - "I dragged
        // and it went silent". The old re-play fix got this back for free, because reloading the
        // song fired `onLoadedMetadata` again; keeping the deck means nothing refires it.
        const frozen = automix.transitionDisplay;
        const exitingSong = frozen?.song ?? currentSong;
        if (!exitingSong) return null;
        // The deck still playing the outgoing track - the one the frozen picture reads from.
        const tailElement = automix.getDisplayElement();
        if (!tailElement) return null;
        // The exact string that deck is rendering, so re-pointing `audioSrc` at it below changes no
        // src attribute and reloads nothing. Falls back to the element's own URL, then to `audioSrc`.
        const keepSrc = automix.tailSrc ?? tailElement.currentSrc ?? audioSrc;
        // Tell the bridge the active deck already holds this source, THEN cancel onto it: the cancel
        // repoints the audio ref at that deck, and the setAudioSrc below must not trigger a reload.
        if (keepSrc) adoptActiveDeckSource(keepSrc);
        const wasArmed = automix.cancelBlendKeepingTail();
        if (keepSrc) setAudioSrc(keepSrc);
        // Put the display and the queue pointer back on the outgoing song (both key off currentSong).
        setCurrentSong(exitingSong);
        if (resume) {
            // Force PLAYING: the advance dropped the transport to IDLE and only the incoming deck
            // starting would have cleared it - but that deck is the one being discarded.
            setPlayerState(PlayerState.PLAYING);
        } else if (wasArmed) {
            // Stopping, and the advance is already in flight: the incoming deck is loading with an
            // autoplay intent standing behind it, and cancelling cannot recall that. The intent now
            // points at the deck we just kept, so left alone the audio bridge presses play on the
            // very track this pause meant to stop. Same knob the ordinary mid-blend pause uses (the
            // playerState effect in useAutomixDecks), set here because by the time that effect runs
            // the session is already idle and it can no longer tell an armed blend was interrupted.
            automix.suppressAutoplayRef.current = true;
        }
        // The rest of the frozen picture - every field of it, which is the point: `TransitionDisplay`
        // is exactly the set of values a blend holds back, so handing all four to the live state is
        // what makes cancelling a no-op rather than a half-move. Without the length the deck reads
        // its own position against the other track's, which both mis-draws the bar and hands
        // `checkTransitionPoint` a wrong number to plan the NEXT blend from; the cover has to be put
        // back through `cachedCoverUrl` because the resolver prefers it over the song's own metadata.
        if (frozen) {
            setDuration(frozen.duration);
            setLyrics(frozen.lyrics);
            setCachedCoverUrl(frozen.coverUrl);
        }
        // The advance pointed this at the incoming track; playSong normally moves it, but this path
        // does not run playSong. Left stale, every callback gated on "is this still the current song"
        // (recovery, scrobble, the deck-playing handler) would answer for a track that isn't playing.
        currentSongRef.current = getPlaybackSongKey(exitingSong);
        // One line per cancel, because everything this path does is invisible by design - it is the
        // absence of a song change. Without it a report of "I pressed something and it went wrong"
        // has nothing in the log to sit next to, which is exactly how the wrong-duration bug above
        // stayed hidden.
        console.log(
            `[Automix] blend cancelled by a ${resume ? 'seek' : 'pause'} while ${wasArmed ? 'armed' : 'fading'},`
            + ` staying on "${exitingSong.name}" (${(frozen?.duration ?? 0).toFixed(1)}s long)`,
        );
        return tailElement;
    };
    /**
     * A seek that lands during an automix blend, or false when there is no blend to cancel.
     *
     * Held in a ref - declared up by the transport controller, and reused by the Electron bridge for
     * the remote's own seek - refreshed every render, so `seekMainAudio` itself can stay a stable
     * callback (it is threaded through the memoised overlay model) while this closure always sees
     * the live song, queue-mode and blend state.
     */
    seekDuringTransitionRef.current = (time: number) => {
        const tailElement = cancelBlendToDisplayedTrack(true);
        if (!tailElement) return false;
        const seekTarget = Math.max(0, time);
        tailElement.currentTime = seekTarget;
        currentTime.set(seekTarget);
        return true;
    };
    /**
     * A pause that lands during an automix blend, or false when there is no blend to cancel.
     *
     * Pressing pause is a statement about the track on screen, and mid-blend that track is on the
     * deck no control points at. Pausing the active deck instead stopped the ARRIVING track - silent
     * anyway for the whole lead - and left the outgoing one playing with its blend still scheduled,
     * so the listener pressed pause and then watched it hand over to the next song. Cancel onto the
     * track they meant and stop that deck; both end up silent, because the cancel's own settle
     * pauses the deck being discarded.
     *
     * Held in a ref for the same reason as the seek above: the transport controller that calls it is
     * wired far above the point where automix exists to write it.
     */
    pauseDuringTransitionRef.current = () => {
        const tailElement = cancelBlendToDisplayedTrack(false);
        if (!tailElement) return false;
        tailElement.pause();
        return true;
    };
    const seekMainAudio = useCallback((time: number) => {
        if (seekDuringTransitionRef.current(time)) {
            return;
        }
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            if (audioRef.current.paused) {
                void audioRef.current.play();
                setPlayerState(PlayerState.PLAYING);
            }
            void publishStagePlayerPlaybackUpdate();
        }
    }, [publishStagePlayerPlaybackUpdate]);

    const handleMonetLyricLineSeek = useCallback((lyricTimeSec: number) => {
        if (isNowPlayingControlDisabled) {
            return;
        }

        const playbackTime = Math.max(0, lyricTimeSec + currentTime.get() - lyricCurrentTime.get());
        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            syncStageLyricsClock(playbackTime, duration, playerState, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(playbackTime);
            if (playerState !== PlayerState.PLAYING) {
                setPlayerState(PlayerState.PLAYING);
            }
            void publishStagePlayerPlaybackUpdate();
        } else {
            seekMainAudio(playbackTime);
        }
    }, [
        activePlaybackContext,
        audioSrc,
        currentTime,
        duration,
        isNowPlayingControlDisabled,
        lyricCurrentTime,
        playerState,
        publishStagePlayerPlaybackUpdate,
        seekMainAudio,
        stageActiveEntryKind,
        stageLyricsClockRef,
        syncStageLyricsClock,
    ]);
    const visualizerRendererModel = useVisualizerRendererModel({
        theme: visualizerTheme,
        subtitleTheme: visualizerSubtitleTheme,
        seed: visualizerGeometrySeed,
        isObsBrowserSourceRendering,
        shouldPauseVisualizerBackground,
        hideTranslationSubtitle: shouldHidePlayerTranslationSubtitle,
        isPlayerPageTransparent,
        onLyricLineSeek: handleMonetLyricLineSeek,
        onBack: navigateBackFromPlayer,
    });

    const handlePlayerPanelAlbumSelect = useCallback(async (song: SongResult, album: Album) => {
        try {
            const ref = await resolveSongCatalogRef(song as UnifiedSong, 'album', album);
            if (ref) {
                navigateToCollection({
                    source: 'online',
                    providerId: ref.providerId,
                    id: ref.id,
                    type: 'album',
                    name: album.name || t('home.albums'),
                    coverUrl: album.coverUrl,
                }, 'player');
                return;
            }
        } catch (error) {
            console.warn('[CatalogNavigation] Failed to resolve player album:', error);
        }
        setStatusMsg({ type: 'error', text: t('search.catalogUnavailable') });
    }, [navigateToCollection, setStatusMsg, t]);

    const handlePlayerPanelArtistSelect = useCallback(async (song: SongResult, artist: Artist) => {
        try {
            const ref = await resolveSongCatalogRef(song as UnifiedSong, 'artist', artist);
            if (ref) {
                navigateToCollection({
                    source: 'online',
                    providerId: ref.providerId,
                    id: ref.id,
                    type: 'artist',
                    name: artist.name || t('navidrome.artists'),
                }, 'player');
                return;
            }
        } catch (error) {
            console.warn('[CatalogNavigation] Failed to resolve player artist:', error);
        }
        setStatusMsg({ type: 'error', text: t('search.catalogUnavailable') });
    }, [navigateToCollection, setStatusMsg, t]);

    const homeModel = useHomeModel({
        onlineProviderPlatform,
        playSong,
        navigateToPlayer,
        navigateToLattice,
        refreshOnlineProviderPlaylists: refreshActiveProviderPlaylists,
        user,
        playlists,
        cloudPlaylist,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        navigateToSearch,
        localSongs,
        localLibraryCatalog,
        localPlaylists,
        onRefreshLocalSongs,
        onAddLocalSongToQueue: handleLocalQueueAdd,
        localMusicState,
        setLocalMusicState,
        onAddNavidromeSongsToQueue: addNavidromeSongsToQueue,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection,
        setPendingNavidromeSelection,
        stageSource,
        openStagePlayer,
        theme,
        playAll: playOnlineQueueFromStart,
        addAllToQueue: addOnlineSongsToQueue,
        addSongToQueue: addOnlineSongToQueue,
        onStatusMessage: setStatusMsg,
        onOpenCollection: openHomeCollection,
        onPushCollection: pushCollection,
        onBackCollection: backCollection,
    });
    const playerDisplayCatalogIndex = useMemo(() => buildLocalLibraryIndex(
        localLibraryCatalog.entities,
        localLibraryCatalog.assignments,
    ), [localLibraryCatalog.assignments, localLibraryCatalog.entities]);
    const playerDisplayCurrentSong = useMemo(() => (
        displaySong
            ? applyLocalLibraryEntityDisplay(displaySong, localLibraryCatalog, playerDisplayCatalogIndex)
            : null
    ), [displaySong, localLibraryCatalog, playerDisplayCatalogIndex]);
    const playerDisplayQueue = useMemo(() => (
        playQueue.map(song => applyLocalLibraryEntityDisplay(song, localLibraryCatalog, playerDisplayCatalogIndex))
    ), [localLibraryCatalog, playQueue, playerDisplayCatalogIndex]);
    const onlinePlaylists = useMemo(() => {
        return playerDisplayCurrentSong ? omni.getPlaylistsForSong(playerDisplayCurrentSong) : [];
    }, [onlineProviderPlatform.providers, playerDisplayCurrentSong]);

    const playerPanelModel = usePlayerPanelModel({
        navigateToHome,
        handleDirectHomeFromPanel,
        currentSong: playerDisplayCurrentSong,
        handleAlbumSelect: handlePlayerPanelAlbumSelect,
        handleArtistSelect: handlePlayerPanelArtistSelect,
        effectiveLoopMode,
        toggleLoop,
        handleLike,
        generateAITheme: generateCurrentSongTheme,
        isGeneratingTheme,
        canGenerateAITheme,
        theme,
        setTheme,
        bgMode,
        handleBgModeChange,
        hasCustomTheme,
        themeSourceModel,
        handleResetTheme,
        toggleTransparentModeWithHandoff,
        handleManualMatchOnline,
        handleUpdateLocalLyrics,
        handleChangeLyricsSource,
        handleImportOnlineLyrics,
        handleChangeOnlineLyricsSource,
        handleMatchOnlineLyrics,
        handleClearOnlineLyricsState,
        handleLyricTimelineOffsetChange,
        handleChangeReplayGainMode,
        fmModeLabel: personalFmSelectionLabel,
        handleOpenFmModePicker,
        handleFmTrash,
        handleNextTrack,
        handlePrevTrack,
        togglePlay,
        handlePreviewVolume,
        isNowPlayingControlDisabled,
        openCommandPalette: commandPalette.open,
        isCommandPaletteOpen: commandPalette.isOpen,
        playQueue: playerDisplayQueue,
        playSong,
        queueScrollRef,
        shuffleQueue,
        removeQueueSong,
        moveQueueSongToEnd,
        moveQueueSongToNext,
        saveCurrentQueueAsLocalPlaylist,
        user,
        handleLogout,
        cacheSize,
        handleClearCache,
        handleSyncData: handleActiveProviderSyncData,
        isSyncing: isActiveProviderSyncing,
        handleToggleDaylight: toggleDaylightMode,
        // Derived inside the hook, but these are the sources only App.tsx holds.
        isLocalSongLiked,
        likedSongIds,
        shouldHidePlayerRightPanelButton,
        localSongs,
        localLibraryCatalog,
        navigateToCollection,
    });
    const appOverlaysModel = useAppOverlaysModel({
        theme,
        closeSearchView,
        handleSearchOverlaySubmit,
        handleSearchLoadMore,
        handleSearchResultPlay,
        handleSearchResultAddToQueue,
        handleSearchResultArtistOpen,
        handleSearchResultAlbumOpen,
        devDebugSnapshot,
        effectiveLoopMode,
        canToggleCurrentPlayback,
        isNowPlayingControlDisabled,
        stageActiveEntryKind,
        syncStageLyricsClock,
        stageLyricsClockRef,
        togglePlay,
        toggleLoop,
        navigateToPlayer,
        shouldHidePlayerProgressBar,
        onSeekMainAudio: seekMainAudio,
        onStagePlayerSeek: publishStagePlayerPlaybackUpdate,
        isNowPlayingStageActive,
        handlePrevTrack,
        handleNextTrack,
        shuffleQueue,
        handleLike,
        isDisplaySongLiked: commandPaletteContext.playback.isSongLiked,
        invokeCommandById: commandPalette.invokeCommandById,
        canInvokeCommandById: commandPalette.canInvokeCommandById,
        stageNextUp,
        stageIsNextUp,
        stageTrackPillOnScreen,
        openSongCardPanel,
    });
    const settingsDialog = useSettingsDialogModel({
        themeController,
        themeParkInitialTheme: themeParkSeedTheme,
        onToggleNavidrome: handleToggleNavidromeEnabled,
        loadLyricFilterPreview: loadCurrentSongLyricPreview,
        onSaveLyricFilterPattern: handleSaveLyricFilterPattern,
        stageStatus,
        stageSource,
        setStageStatus,
        leaveStagePlayback,
        clearStagePlaybackSession,
        clearPersistedStagePlaybackCache,
        loadStageSessionIntoPlayback,
        nowPlayingConnectionStatus,
        playerCapConnectionStatus,
        playerCapPlayers,
        obsBrowserSourceStatus,
        refreshObsBrowserSourceStatus,
        lyricApiStatus,
        setLyricApiEnabled,
        onAudioOutputDeviceChange: handleAudioOutputDeviceChange,
        onReplayGainModeChange: handleChangeReplayGainMode,
        onToggleTransparentPlayerBackground: toggleTransparentModeWithHandoff,
    });
    const appDialogsModel = useAppDialogsModel({
        showLyricMatchModal,
        showNaviLyricMatchModal,
        showOnlineLyricMatchModal,
        localSongs,
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
        providerSwitchConfirmDialog,
    });

    useEffect(() => {
        isNowPlayingControlDisabledRef.current = isNowPlayingControlDisabled;
    }, [isNowPlayingControlDisabled]);

    // Buffer progress debug helper reset. Keep commented out unless
    // buffered percent logging is explicitly needed during troubleshooting.
    // useEffect(() => {
    //     lastBufferedPercentLogRef.current = null;
    // }, [audioSrc]);

    // Optimize background layout cost: completely hide home surface when player is active.
    // Keep the mount state separate from opacity so transparent player mode never reveals Home during delayed unmount.
    const { shouldKeepHomeMounted, shouldShowHomeSurface } = buildHomeSurfacePresentation({
        currentView,
        isSettingsModalOpen,
        isPanelOpen,
    });
    useEffect(() => {
        if (shouldKeepHomeMounted) {
            setIsHomeFullyHidden(false);
        } else {
            // Wait for the 300ms opacity transition to finish before applying display: none
            const timer = setTimeout(() => setIsHomeFullyHidden(true), 350);
            return () => clearTimeout(timer);
        }
    }, [shouldKeepHomeMounted]);

    // The two automix decks are identical and interchangeable. Every handler below ignores the
    // deck that is not currently active, so a track fading out in the background can never drive
    // the progress bar, the duration, the queue, or the player state.
    const renderAudioDeck = (deck: AutomixDeckId, register: (element: HTMLAudioElement | null) => void) => (
        <audio
            key={deck}
            ref={register}
            src={automix.deckSrc(deck)}
            preload="auto"
            crossOrigin="anonymous"
            loop={effectiveLoopMode === 'one' && automix.activeDeck === deck}
            onLoadStart={(e) => {
                // Silent unless the invariant breaks. A deck is only ever handed the source the
                // app is currently on, so the active deck loading anything else means the ref and
                // audioSrc have drifted apart - the state that once had a deck "start playing"
                // before it had a source, and then sit fully buffered in silence because the
                // autoplay intent had already been spent on it.
                // Never during a transition. There the active deck is *meant* to be rendering the
                // warmed source while audioSrc still names the track the other deck is finishing -
                // see resolveDeckSrc, where that fallthrough is what keeps the handover seamless.
                // Ordinarily the warm load happens seconds before the deck roles move and this is
                // never reached; entering the last few seconds abruptly, by seeking, collapses the
                // two into one pass and made this cry wolf.
                // Nor with no current source to contradict: between songs audioSrc is briefly null
                // while a deck is already loading the next one, and "differs from nothing" is not
                // a drift. The state this watches for is the opposite one - a source we are on
                // that some deck never picked up.
                if (automix.isTransitionAudible() || !audioSrc) return;
                if (automix.isActiveDeck(e.currentTarget) && e.currentTarget.getAttribute('src') !== audioSrc) {
                    console.error('[Audio] the active deck is loading something other than the current source', {
                        deck,
                        loading: e.currentTarget.getAttribute('src')?.slice(-40) ?? null,
                        audioSrc: audioSrc?.slice(-40) ?? null,
                    });
                }
            }}
            onPlay={(e) => {
                if (!automix.isActiveDeck(e.currentTarget)) return;
                shouldAutoPlay.current = false;
                // The same split onTimeUpdate, onSeeked and onLoadedMetadata all make, and the two
                // handlers that were missing it: while the picture is held this deck is the track
                // ARRIVING, so its position belongs to a song whose title nobody can see yet.
                if (!isShowingTail) currentTime.set(e.currentTarget.currentTime);
                setPlayerState(PlayerState.PLAYING);
            }}
            onPlaying={(e) => {
                if (!automix.isActiveDeck(e.currentTarget)) return;
                shouldAutoPlay.current = false;
                if (!isShowingTail) currentTime.set(e.currentTarget.currentTime);
                setupAudioAnalyzer();
                playbackAutoSkipCountRef.current = 0;
                // The source plays, so a later TTL refresh of the same media is legitimate again.
                lastAudioRecoverySourceRef.current = null;
                setPlayerState(PlayerState.PLAYING);
                // Last chance to refuse the blend, now that we know when this deck really started.
                automix.handleActiveDeckPlaying();
            }}
            onPause={(e) => {
                if (!automix.isActiveDeck(e.currentTarget)) return;
                shouldAutoPlay.current = false;
                if (!e.currentTarget.ended) {
                    setPlayerState(PlayerState.PAUSED);
                }
            }}
            onTimeUpdate={(e) => {
                const audioElement = e.currentTarget;
                const isActive = automix.isActiveDeck(audioElement);
                // The clock and the transport are driven by different decks during a transition.
                // The picture still belongs to the track that is finishing, so the progress bar has
                // to be driven by ITS deck - the active one is seconds into a song nobody can see
                // the title of yet, and left on it the bar jumps to zero the moment a blend arms.
                // Only two decks exist and both render this handler, so "not active" is the tail.
                if (isShowingTail ? !isActive : isActive) {
                    if (!audioElement.paused && !audioElement.ended) currentTime.set(audioElement.currentTime);
                }
                // Everything below stays on the active deck whatever the picture is doing: player
                // state describes what the app is playing, and the transition check has to read
                // the position of the deck the NEXT blend will be planned from.
                if (!isActive) return;
                // A track that is not moving is not approaching anything. `pause()` fires one last
                // timeupdate of its own, and a mid-blend pause cancels onto THIS deck before pausing
                // it - so that stray tick arrives with the deck already active and the track sitting
                // past its handover point, and arms the blend the listener just stopped, advancing
                // the queue behind it. Visible in the log as a cancel and a `playSong` in the same
                // second, or as a lone `plain cut` line when the track was too near its end to fade.
                if (audioElement.paused) return;
                if (!audioElement.ended) setPlayerState(PlayerState.PLAYING);
                automix.checkTransitionPoint(audioElement.currentTime);
            }}
            onSeeked={(e) => {
                // Same split as onTimeUpdate: whichever deck the bar is showing is the one a seek
                // on it has to be reflected from.
                const isActive = automix.isActiveDeck(e.currentTarget);
                if (isShowingTail ? !isActive : isActive) currentTime.set(e.currentTarget.currentTime);
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
            onEnded={(e) => {
                // A track finishing in the background has already handed the queue over.
                if (!automix.isActiveDeck(e.currentTarget)) {
                    automix.handleTailEnded();
                    return;
                }

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
                if (!automix.isActiveDeck(audioElement)) return;
                setDuration(audioElement.duration);
                // While the picture is held, this deck is the track ARRIVING: its length and its
                // position belong to a song the listener cannot see yet, and writing either here
                // would snap the bar to zero mid-blend. `duration` above is still set because the
                // transition planner needs it; only the visible clock is left alone.
                if (isShowingTail) return;

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
                if (!automix.isActiveDeck(e.currentTarget)) {
                    automix.handleTailEnded();
                    return;
                }

                if (!audioSrc) {
                    return;
                }

                const audioElement = e.currentTarget;
                const reportedDuration = Number.isFinite(audioElement.duration) && audioElement.duration > 0
                    ? audioElement.duration
                    : duration;
                const isLocalTailDecodeError = Boolean(
                    isLocalPlaybackSong(currentSong) &&
                    Number.isFinite(reportedDuration) &&
                    reportedDuration > 0 &&
                    audioElement.currentTime > 0 &&
                    reportedDuration - audioElement.currentTime <= LOCAL_TAIL_DECODE_ERROR_TOLERANCE_SEC
                );

                if (isLocalTailDecodeError) {
                    currentTime.set(Math.max(audioElement.currentTime, reportedDuration));
                    setPlayerState(PlayerState.IDLE);

                    if (effectiveLoopMode === 'one') {
                        audioElement.currentTime = 0;
                        audioElement.load();
                        const replayPromise = audioElement.play();
                        if (replayPromise !== undefined) {
                            replayPromise.catch(() => {
                                setPlayerState(PlayerState.PAUSED);
                            });
                        }
                        return;
                    }

                    void handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
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
        />
    );
    return (
        <AppShell
            appStyle={appStyle}
            isElectronWindow={isElectronWindow}
            usesCustomWindowChrome={usesCustomWindowChrome}
            useCustomWindowRadius={isElectronWindow && transparentPlayerBackground && !wallpaperMode}
            showTransparentWindowBorder={showTransparentWindowBorder}
            isPlayerView={isPlayerView}
            isTitlebarRevealed={isTitlebarRevealed}
            alwaysShowMainWindowTitlebar={alwaysShowMainWindowTitlebar}
            isMainWindowClickThroughEnabled={isMainWindowClickThroughEnabled}
            showMainWindowClickThroughToggle={isMainWindowClickThroughEnabled ? isClickThroughToggleHotspotActive : isTitlebarRevealed}
            isDaylight={isDaylight}
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
            audioElement={<>
                {renderAudioDeck('A', automix.registerDeckA)}
                {renderAudioDeck('B', automix.registerDeckB)}
            </>}
        >

            {/* Home Mount Point */}
            <div
                className="absolute inset-0 z-10"
                style={{
                    pointerEvents: shouldShowHomeSurface ? 'auto' : 'none',
                    visibility: shouldShowHomeSurface ? 'visible' : 'hidden',
                    transition: shouldShowHomeSurface
                        ? 'visibility 0s linear 0s'
                        : 'visibility 0s linear 0.25s',
                    display: isHomeFullyHidden ? 'none' : 'block',
                }}
            >
                <motion.div
                    className="absolute inset-0"
                    initial={false}
                    animate={{ opacity: shouldShowHomeSurface ? 1 : 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                >
                    {currentView === 'home' || currentView === 'player' ? (
                        <Home
                            model={homeModel}
                            isHomeFullyHidden={isHomeFullyHidden}
                            isInteractive={shouldShowHomeSurface}
                        />
                    ) : null}
                </motion.div>
            </div>

            {currentView === 'lattice' && (
                <div className="absolute inset-0 z-10 pointer-events-auto">
                    <Suspense fallback={<div className="absolute inset-0 bg-[#070707]" />}>
                        <Lattice
                            controls={{ playback: commandPaletteContext.playback, loopMode: effectiveLoopMode,
                                invokeCommandById: commandPalette.invokeCommandById, canInvokeCommandById: commandPalette.canInvokeCommandById,
                                isStageActive: isNowPlayingStageActive, disabled: isNowPlayingControlDisabled }}
                            lyrics={commandPaletteContext.shared.lyrics}
                            currentSong={displaySong}
                            playerState={displayPlayerState}
                            currentTime={currentTime}
                            playbackDuration={displayDuration}
                            canTogglePlayback={canToggleCurrentPlayback}
                            queue={playQueue}
                            isDaylight={isDaylight}
                            onBack={navigateBackFromLattice}
                            onOpenPlayer={navigateToPlayer}
                            onPlaySong={(song, queue) => {
                                void playSong(song, queue, false, { shouldNavigateToPlayer: false });
                            }}
                            onTogglePlayback={togglePlay}
                            onSeek={seekMainAudio}
                        />
                    </Suspense>
                </div>
            )}

            {/* --- VISUALIZER (Background Layer & Main Click Target) --- */}
            <div
                className="absolute inset-0 z-0"
                onClick={handleContainerClick}
            >
                <PlayerBottomBarLayoutContext.Provider value={currentView === 'player'}>
                    <VisualizerRenderer {...visualizerRendererModel} />
                </PlayerBottomBarLayoutContext.Provider>
            </div>

            <StageSessionEmptyState
                stageSource={stageSource}
                stageActiveEntryKind={stageActiveEntryKind}
                nowPlayingConnectionStatus={nowPlayingConnectionStatus}
                playerCapConnectionStatus={playerCapConnectionStatus}
            />

            <AppOverlays model={appOverlaysModel} />

            {/* Not in the overlays model: it takes no state from this file and no click from anyone.
                Mounted whenever its own switch is on, so the lazy animejs chunk loads only when it is
                wanted; the fallback is empty because it draws nothing until a cue arrives anyway.

                Its own switch, not shared with the card's border. It used to hide itself wherever the
                card was up, which on the lyrics page - the one people watch - meant the ring was never
                seen again after the card shipped. Two pictures of one blend is now something the
                listener asks for rather than something this file rules out. */}
            {transitionAnimation && transitionMode === 'automix' && (
                <Suspense fallback={null}>
                    <AutomixTransitionAnimation theme={theme} isDaylight={isDaylight} />
                </Suspense>
            )}

            {/* Same arrangement, same reason. Mounted here rather than beside either of the two
                switches that can open it, so that both reach the same one. */}
            <AutomixModelReminder isDaylight={isDaylight} />

            {currentView === 'player' && !showLyricMatchModal && (
                <PlayerPanel model={playerPanelModel} />
            )}

            <ThemeQuickEditorHost onSaveAiTheme={saveEditedAiDualTheme} onSaveCustomTheme={saveCustomDualTheme} />

            {/* Mounted here rather than inside the panel that used to own it: the picker answers a
                question about the current song, and a shortcut has to reach it with the panel shut. */}
            <AddToPlaylistHost
                isDaylight={isDaylight}
                localPlaylists={localPlaylists}
                onlinePlaylists={onlinePlaylists}
                onAddCurrentSongToLocalPlaylist={addCurrentSongToLocalPlaylist}
                onCreateCurrentLocalPlaylist={createCurrentLocalPlaylist}
                onAddCurrentSongToOnlinePlaylist={addCurrentSongToOnlinePlaylist}
                onAddCurrentSongToNavidromePlaylist={addCurrentSongToNavidromePlaylist}
                onCreateCurrentNavidromePlaylist={createCurrentNavidromePlaylist}
            />

            <CommandPalette
                activeIndex={commandPalette.activeIndex}
                activePreview={commandPalette.activePreview}
                activeCommand={commandPalette.activeCommand}
                availableCommands={commandPalette.availableCommands}
                context={commandPaletteContext}
                isDaylight={isDaylight}
                isComposing={commandPalette.isComposing}
                isExecuting={commandPalette.isExecuting}
                isOpen={commandPalette.isOpen}
                matches={commandPalette.matches}
                pinnedCommands={commandPalette.pinnedCommands}
                query={commandPalette.query}
                theme={theme}
                onActiveCommandChange={commandPalette.setActiveCommand}
                onActiveIndexChange={commandPalette.setActiveIndex}
                onClose={commandPalette.close}
                onCompositionEnd={(value) => {
                    commandPalette.setIsComposing(false);
                    commandPalette.commitQuery(value);
                }}
                onCompositionStart={() => commandPalette.setIsComposing(true)}
                onExecuteActive={commandPalette.executeActive}
                onExecuteMatch={commandPalette.executeMatch}
                onExecutePinnedCommand={commandPalette.executePinnedCommand}
                onQueryChange={commandPalette.setQuery}
                onQueryCommit={commandPalette.commitQuery}
            />

            <AppDialogs model={appDialogsModel} />
            <UserGuideModal theme={theme} />
        </AppShell>
    );
}
