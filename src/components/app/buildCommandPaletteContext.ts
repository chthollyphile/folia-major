import type React from 'react';
import type { CommandPaletteContext } from '../command-palette/types';
import type { HomeViewTab, LatentBackgroundTuning, LocalSong, LyricData, MonetBackgroundTuning, PlayerState, ReplayGainMode, SongResult, StatusMessage, SubtitleContentMode, VisualizerBackgroundMode, VisualizerMode } from '../../types';
import type { LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import type { SearchSource } from '../../stores/useSearchNavigationStore';
import type { PanelTab } from '../UnifiedPanel';
import type { SettingsModalInitialTab, SettingsSubviewId } from '../../stores/useSettingsUiStore';
import type { AudioEqualizerModeId } from '../../utils/audioEqualizer';
import type { AppLanguagePreference } from '../../i18n/config';
import type { ThemeGenerationSource } from '../../services/themePreferences';
import type { TransitionMode } from '../../services/automix/transitionStrategy';
import type { PersonalFmSelection } from '../../services/onlineMusic/fmModes';
import type { QueueBatchAction } from '../command-palette/queueQuery';

// src/components/app/buildCommandPaletteContext.ts
// Groups App-level state and handlers into the command palette's namespaced context, so the
// toggle wrappers and the flat-to-namespace mapping stay out of App.tsx's render body.

export type CommandPaletteContextDeps = {
    t: (key: string, fallback?: string) => string;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    playerState: PlayerState;

    currentSearchSourceTab: SearchSource;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryDisplayCatalog;
    navigateToSearch: CommandPaletteContext['search']['navigateToSearch'];
    submitSearch: CommandPaletteContext['search']['submitSearch'];

    volume: number;
    isMuted: boolean;
    setVolume: (volume: number) => void;
    previewVolume: (volume: number) => void;
    togglePlay: () => void;
    toggleLoop: () => void;
    next: () => void;
    prev: () => void;
    playQueue: SongResult[];
    playSong: (song: SongResult, queue?: SongResult[]) => void | Promise<void>;
    shuffleQueue: () => void;
    clearQueue: () => void;
    applyQueueBatchOperation: (action: QueueBatchAction, targetIndices: number[]) => boolean;
    removeQueueSong: (index: number) => void;
    moveQueueSongToNext: (index: number) => void;
    moveQueueSongToEnd: (index: number) => void;
    setReplayGainMode: (mode: ReplayGainMode) => void;
    isFmMode: boolean;
    personalFmSelection: PersonalFmSelection;
    isPersonalFmModeSupported: boolean;
    setPersonalFmSelection: (selection: PersonalFmSelection) => Promise<void> | void;
    openAudioEqualizer: () => void;
    applyAudioSoundPreset: (modeId: AudioEqualizerModeId) => void;
    runAutoMatchBestLyric: () => Promise<boolean>;

    navigateToHome: () => void;
    navigateToPlayer: () => void;
    setHomeViewTab: (tab: HomeViewTab) => void;
    toggleBrowserFullscreen: () => Promise<boolean>;
    toggleRemoteControlWindow: () => Promise<boolean>;
    toggleMainWindowAlwaysOnTop: () => Promise<boolean>;
    isWallpaperMode: boolean;

    setPanelTab: (tab: PanelTab) => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;

    openSettings: (initialTab?: SettingsModalInitialTab, initialSubview?: SettingsSubviewId | null) => void;
    setIsUserGuideModalOpen: (isOpen: boolean) => void;
    setAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void> | void;
    toggleDaylightMode: () => void;

    // Boolean settings arrive as value + setter pairs; the builder owns the "flip it" wrappers.
    transparentPlayerBackground: boolean;
    setTransparentPlayerBackground: (next: boolean) => void;
    hideBottomSubtitleOverlay: boolean;
    setHideBottomSubtitleOverlay: (next: boolean) => void;
    subtitleContentMode: SubtitleContentMode;
    setSubtitleContentMode: (mode: SubtitleContentMode) => void;
    subtitleOverlayBackground: boolean;
    setSubtitleOverlayBackground: (next: boolean) => void;
    alwaysShowPlayerBackButton: boolean;
    setAlwaysShowPlayerBackButton: (next: boolean) => void;
    alwaysShowTrackSwitchButtons: boolean;
    setAlwaysShowTrackSwitchButtons: (next: boolean) => void;
    alwaysShowMainWindowTitlebar: boolean;
    setAlwaysShowMainWindowTitlebar: (next: boolean) => void;
    voiceInputPauseEnabled: boolean;
    voiceInputPauseSupported: boolean;
    modSystemEnabled: boolean;
    setVoiceInputPauseEnabled: (next: boolean) => void;
    preventDisplaySleepDuringPlayback: boolean;
    setPreventDisplaySleepDuringPlayback: (next: boolean) => void;
    wallpaperMode: boolean;
    setWallpaperMode: (next: boolean) => void;

    sleepTimerEnabled: boolean;
    setSleepTimerEnabled: (next: boolean) => void;
    sleepTimerHours: number;
    setSleepTimerHours: (next: number) => void;
    sleepTimerMinutes: number;
    setSleepTimerMinutes: (next: number) => void;
    sleepTimerDeadlineMs: number | null;

    canGenerateAITheme: boolean;
    isGeneratingTheme: boolean;
    generateAITheme: () => void;
    openThemeQuickEditor: () => void;
    canOpenThemeQuickEditor: boolean;
    themeGenerationSource: ThemeGenerationSource;
    setThemeGenerationSource: (source: ThemeGenerationSource) => void;

    automixEnabled: boolean;
    transitionMode: TransitionMode;
    transitionPerformance: boolean;
    handleToggleAutomix: (enable: boolean) => void;
    handleSetTransitionMode: (mode: TransitionMode) => void;
    handleToggleTransitionPerformance: (enable: boolean) => void;
    canUseTransitionPerformance: () => boolean;

    visualizerMode: VisualizerMode;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    setVisualizerMode: (mode: VisualizerMode) => void;
    randomVisualizerModePerSong: boolean;
    setRandomVisualizerModePerSong: (next: boolean) => void;
    setVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    setMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    setLatentBackgroundTuning: (patch: Partial<LatentBackgroundTuning>) => void;
};

export const buildCommandPaletteContext = (deps: CommandPaletteContextDeps): CommandPaletteContext => ({
    shared: {
        t: deps.t,
        setStatusMsg: deps.setStatusMsg,
        currentSong: deps.currentSong,
        lyrics: deps.lyrics,
        playerState: deps.playerState,
    },
    search: {
        currentSearchSourceTab: deps.currentSearchSourceTab,
        localSongs: deps.localSongs,
        localLibraryCatalog: deps.localLibraryCatalog,
        navigateToSearch: deps.navigateToSearch,
        submitSearch: deps.submitSearch,
    },
    playback: {
        volume: deps.volume,
        isMuted: deps.isMuted,
        setVolume: deps.setVolume,
        previewVolume: deps.previewVolume,
        togglePlay: deps.togglePlay,
        toggleLoop: deps.toggleLoop,
        next: deps.next,
        prev: deps.prev,
        queue: deps.playQueue,
        playSong: deps.playSong,
        shuffleQueue: deps.shuffleQueue,
        clearQueue: deps.clearQueue,
        applyQueueBatchOperation: deps.applyQueueBatchOperation,
        removeQueueSong: deps.removeQueueSong,
        moveQueueSongToNext: deps.moveQueueSongToNext,
        moveQueueSongToEnd: deps.moveQueueSongToEnd,
        setReplayGainMode: deps.setReplayGainMode,
        isFmMode: deps.isFmMode,
        personalFmSelection: deps.personalFmSelection,
        isPersonalFmModeSupported: deps.isPersonalFmModeSupported,
        setPersonalFmSelection: deps.setPersonalFmSelection,
        openAudioEqualizer: deps.openAudioEqualizer,
        applyAudioSoundPreset: deps.applyAudioSoundPreset,
        runAutoMatchBestLyric: deps.runAutoMatchBestLyric,
    },
    navigation: {
        navigateToHome: deps.navigateToHome,
        navigateToPlayer: deps.navigateToPlayer,
        setHomeViewTab: deps.setHomeViewTab,
        toggleBrowserFullscreen: deps.toggleBrowserFullscreen,
        toggleRemoteControlWindow: deps.toggleRemoteControlWindow,
        toggleMainWindowAlwaysOnTop: deps.toggleMainWindowAlwaysOnTop,
        isWallpaperMode: deps.isWallpaperMode,
    },
    panel: {
        setPanelTab: deps.setPanelTab,
        setIsPanelOpen: deps.setIsPanelOpen,
    },
    settings: {
        openSettings: deps.openSettings,
        setIsUserGuideModalOpen: deps.setIsUserGuideModalOpen,
        setAppLanguagePreference: deps.setAppLanguagePreference,
        toggleTransparentBackground: () => deps.setTransparentPlayerBackground(!deps.transparentPlayerBackground),
        toggleDaylightMode: deps.toggleDaylightMode,
        toggleBottomSubtitleOverlay: () => deps.setHideBottomSubtitleOverlay(!deps.hideBottomSubtitleOverlay),
        subtitleContentMode: deps.subtitleContentMode,
        cycleSubtitleContentMode: () => deps.setSubtitleContentMode(
            deps.subtitleContentMode === 'translation' ? 'romanization' : 'translation',
        ),
        toggleSubtitleOverlayBackground: () => deps.setSubtitleOverlayBackground(!deps.subtitleOverlayBackground),
        toggleAlwaysShowPlayerBackButton: () => deps.setAlwaysShowPlayerBackButton(!deps.alwaysShowPlayerBackButton),
        toggleAlwaysShowTrackSwitchButtons: () => deps.setAlwaysShowTrackSwitchButtons(!deps.alwaysShowTrackSwitchButtons),
        toggleAlwaysShowMainWindowTitlebar: () => deps.setAlwaysShowMainWindowTitlebar(!deps.alwaysShowMainWindowTitlebar),
        voiceInputPauseSupported: deps.voiceInputPauseSupported,
        modSystemEnabled: deps.modSystemEnabled,
        toggleVoiceInputPause: () => deps.setVoiceInputPauseEnabled(!deps.voiceInputPauseEnabled),
        togglePreventDisplaySleepDuringPlayback: () => deps.setPreventDisplaySleepDuringPlayback(!deps.preventDisplaySleepDuringPlayback),
        toggleWallpaperMode: () => deps.setWallpaperMode(!deps.wallpaperMode),
        sleepTimerEnabled: deps.sleepTimerEnabled,
        setSleepTimerEnabled: deps.setSleepTimerEnabled,
        sleepTimerHours: deps.sleepTimerHours,
        setSleepTimerHours: deps.setSleepTimerHours,
        sleepTimerMinutes: deps.sleepTimerMinutes,
        setSleepTimerMinutes: deps.setSleepTimerMinutes,
        sleepTimerDeadlineMs: deps.sleepTimerDeadlineMs,
        canGenerateAITheme: deps.canGenerateAITheme,
        isGeneratingTheme: deps.isGeneratingTheme,
        generateAITheme: deps.generateAITheme,
        openThemeQuickEditor: deps.openThemeQuickEditor,
        canOpenThemeQuickEditor: deps.canOpenThemeQuickEditor,
        themeGenerationSource: deps.themeGenerationSource,
        setThemeGenerationSource: deps.setThemeGenerationSource,
        automixEnabled: deps.automixEnabled,
        transitionMode: deps.transitionMode,
        transitionPerformance: deps.transitionPerformance,
        toggleAutomix: () => deps.handleToggleAutomix(!deps.automixEnabled),
        setTransitionMode: deps.handleSetTransitionMode,
        toggleTransitionPerformance: () => deps.handleToggleTransitionPerformance(!deps.transitionPerformance),
        canUseTransitionPerformance: deps.canUseTransitionPerformance,
    },
    visualizer: {
        visualizerMode: deps.visualizerMode,
        visualizerBackgroundMode: deps.visualizerBackgroundMode,
        setVisualizerMode: deps.setVisualizerMode,
        toggleRandomVisualizerModePerSong: () => deps.setRandomVisualizerModePerSong(!deps.randomVisualizerModePerSong),
        setVisualizerBackgroundMode: deps.setVisualizerBackgroundMode,
        setMonetBackgroundTuning: deps.setMonetBackgroundTuning,
        setLatentBackgroundTuning: deps.setLatentBackgroundTuning,
    },
});
