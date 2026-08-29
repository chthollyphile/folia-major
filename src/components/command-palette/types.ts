import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SearchReturnView, SearchSource } from '../../stores/useSearchNavigationStore';
import type { LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import type { HomeViewTab, LatentBackgroundTuning, LocalSong, LyricData, PlayerState, ReplayGainMode, SongResult, StatusMessage, SubtitleContentMode, VisualizerMode, VisualizerBackgroundMode, MonetBackgroundTuning } from '../../types';
import type { AppLanguagePreference } from '../../i18n/config';
import type { PanelTab } from '../UnifiedPanel';
import type { SettingsModalInitialTab, SettingsSubviewId } from '../../stores/useSettingsUiStore';
import type { AudioEqualizerModeId } from '../../utils/audioEqualizer';
import type { ThemeGenerationSource } from '../../services/themePreferences';
import type { TransitionMode } from '../../services/automix/transitionStrategy';
import type { PersonalFmSelection } from '../../services/onlineMusic/fmModes';
import type { QueueBatchAction, QueueFacetKind } from './queueQuery';
import type { CommandPlatform } from './availability';
import type { CommandPaletteSurface } from './surfaces/types';
import type { CommandSyntaxSpec } from './syntax/types';

// src/components/command-palette/types.ts
// Shared command palette contracts used by the registry, hook, and UI shell.

export type CommandPaletteGroup = 'search' | 'settings' | 'navigation' | 'panel' | 'playback' | 'visualizer';

export type CommandPaletteSearchSource = SearchSource;

export type CommandPaletteCommand = {
    id: string;
    group: CommandPaletteGroup;
    title: string;
    description: string;
    textSource?: 'i18n' | 'runtime';
    icon?: LucideIcon;
    keywords: string[];
    placeholder?: (context: CommandPaletteContext) => string;
    requiresInput?: boolean;
    /** Environment gating: which platforms ship this feature at all. */
    platform?: CommandPlatform[];
    /** State gating: whether the command is worth offering right now. */
    isAvailable?: (context?: CommandPaletteContext) => boolean;
    /** Kept out of match results, the all-commands list, and the pinned-command picker. */
    hidden?: boolean;
    /** Global shortcut that opens the palette straight into this command. */
    openHotkey?: { key: string; ctrl?: boolean };
    /** Vim-style key sequence that runs this command from execute mode. Omit for anything
     *  dangerous, irreversible, or needing confirmation. Must stay prefix-free registry-wide. */
    executeShortcut?: string;
    /** Panel body this command renders instead of the default match list. */
    surface?: CommandPaletteSurface;
    /** `--flag @facet:value` dialect this command accepts, parsed by ./syntax. */
    syntax?: CommandSyntaxSpec;
    getInitialInput?: (context: CommandPaletteContext) => string;
    getPreview?: (input: string, context: CommandPaletteContext) => string | null;
    queueIndex?: number;
    queueSong?: SongResult;
    execute: (input: string, context: CommandPaletteContext) => Promise<boolean> | boolean;
};

export type CommandPaletteMatch = {
    command: CommandPaletteCommand;
    score: number;
    input: string;
    previewText?: string | null;
    queueReasons?: QueueFacetKind[];
};

// Capabilities every command may reach for, regardless of its group.
export type CommandPaletteSharedContext = {
    t: (key: string, fallback?: string) => string;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    currentSong: SongResult | null;
    /**
     * The lyrics currently on screen (the automix transition display included),
     * so a surface that needs them gets what the player renders rather than
     * having to rebuild them from the song's stored lyric state.
     */
    lyrics: LyricData | null;
    /**
     * The transport as the listener hears it, not the raw one.
     *
     * An armed transition drops the raw state to IDLE while the outgoing deck keeps playing, so the
     * commands below have to be given the same corrected state the main controls, the remote and the
     * taskbar are given. Reading the raw one made Play pause and Pause do nothing for the whole arm.
     */
    playerState: PlayerState;
};

export type CommandPaletteSearchContext = {
    currentSearchSourceTab: SearchSource;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryDisplayCatalog;
    navigateToSearch: (args: { query: string; sourceTab: SearchSource; replace?: boolean; returnView?: SearchReturnView; }) => void;
    submitSearch: (args: {
        query?: string;
        sourceTab: SearchSource;
        deps: {
            localSongs: LocalSong[];
            localLibraryCatalog?: LocalLibraryDisplayCatalog;
            t: (key: string, fallback?: string) => string;
        };
        returnView?: SearchReturnView;
    }) => Promise<boolean>;
};

export type CommandPalettePlaybackContext = {
    volume: number;
    isMuted: boolean;
    setVolume: (volume: number) => void;
    previewVolume: (volume: number) => void;
    togglePlay: () => void;
    toggleLoop: () => void;
    next: () => void;
    prev: () => void;
    queue: SongResult[];
    playSong: (song: SongResult, queue?: SongResult[]) => void | Promise<void>;
    shuffleQueue: () => void;
    clearQueue: () => void;
    applyQueueBatchOperation: (action: QueueBatchAction, targetIndices: number[]) => boolean;
    removeQueueSong: (index: number) => void;
    moveQueueSongToNext: (index: number) => void;
    moveQueueSongToEnd: (index: number) => void;
    setReplayGainMode: (mode: ReplayGainMode) => void;
    /** Personal FM owns the queue while it is on air; queue commands stand down. */
    isFmMode: boolean;
    personalFmSelection: PersonalFmSelection;
    /** Only the providers that actually implement FM modes offer the picker. */
    isPersonalFmModeSupported: boolean;
    setPersonalFmSelection: (selection: PersonalFmSelection) => Promise<void> | void;
    openAudioEqualizer: () => void;
    applyAudioSoundPreset: (modeId: AudioEqualizerModeId) => void;
    runAutoMatchBestLyric: () => Promise<boolean>;
};

export type CommandPaletteNavigationContext = {
    navigateToHome: () => void;
    navigateToPlayer: () => void;
    setHomeViewTab: (tab: HomeViewTab) => void;
    toggleBrowserFullscreen: () => Promise<boolean>;
    toggleRemoteControlWindow: () => Promise<boolean>;
    toggleMainWindowAlwaysOnTop: () => Promise<boolean>;
    /** Window-level toggles (fullscreen, always-on-top) are meaningless in wallpaper mode. */
    isWallpaperMode: boolean;
};

export type CommandPalettePanelContext = {
    setPanelTab: (tab: PanelTab) => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export type CommandPaletteSettingsContext = {
    openSettings: (initialTab?: SettingsModalInitialTab, initialSubview?: SettingsSubviewId | null) => void;
    setIsUserGuideModalOpen: (isOpen: boolean) => void;
    setAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void> | void;
    toggleTransparentBackground: () => void;
    toggleDaylightMode: () => void;
    toggleBottomSubtitleOverlay: () => void;
    subtitleContentMode: SubtitleContentMode;
    cycleSubtitleContentMode: () => void;
    toggleSubtitleOverlayBackground: () => void;
    toggleAlwaysShowPlayerBackButton: () => void;
    toggleAlwaysShowTrackSwitchButtons: () => void;
    toggleAlwaysShowMainWindowTitlebar: () => void;
    voiceInputPauseSupported: boolean;
    /** Lab switch for the experimental mod system; gates the `mods` command. */
    modSystemEnabled: boolean;
    toggleVoiceInputPause: () => void;
    togglePreventDisplaySleepDuringPlayback: () => void;
    toggleWallpaperMode: () => void;
    sleepTimerEnabled: boolean;
    setSleepTimerEnabled: (enabled: boolean) => void;
    sleepTimerHours: number;
    setSleepTimerHours: (hours: number) => void;
    sleepTimerMinutes: number;
    setSleepTimerMinutes: (minutes: number) => void;
    sleepTimerDeadlineMs: number | null;
    canGenerateAITheme: boolean;
    isGeneratingTheme: boolean;
    generateAITheme: () => void;
    openThemeQuickEditor: () => void;
    canOpenThemeQuickEditor: boolean;
    themeGenerationSource: ThemeGenerationSource;
    setThemeGenerationSource: (source: ThemeGenerationSource) => void;
    /** The FOLIA smart-transition switches, stated in each command's title the way the pickers do. */
    automixEnabled: boolean;
    transitionMode: TransitionMode;
    transitionPerformance: boolean;
    toggleAutomix: () => void;
    setTransitionMode: (mode: TransitionMode) => void;
    toggleTransitionPerformance: () => void;
    /**
     * Whether performance mode has anything to run on - the same `capabilities.stems` the settings
     * panel disables its switch by.
     *
     * A function rather than a value because the answer changes when a model download finishes, and
     * nothing re-renders the app to say so. `isAvailable` is asked each time the palette opens, so a
     * getter is read fresh; a snapshot taken when this context was memoised would keep saying "no
     * model" for the rest of the session.
     */
    canUseTransitionPerformance: () => boolean;
};

export type CommandPaletteVisualizerContext = {
    /** The pickers state the current mode in their header, the way volume states its percent. */
    visualizerMode: VisualizerMode;
    /** Null means "no stored choice"; the picker resolves it against the registry default. */
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    setVisualizerMode: (mode: VisualizerMode) => void;
    toggleRandomVisualizerModePerSong: () => void;
    setVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    setMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    setLatentBackgroundTuning: (patch: Partial<LatentBackgroundTuning>) => void;
};

// Namespaces mirror CommandPaletteGroup one-to-one (plus `shared`), so a command's group
// tells you where to look for its dependencies. Cross-group access stays legal but visible.
export type CommandPaletteContext = {
    shared: CommandPaletteSharedContext;
    search: CommandPaletteSearchContext;
    playback: CommandPalettePlaybackContext;
    navigation: CommandPaletteNavigationContext;
    panel: CommandPalettePanelContext;
    settings: CommandPaletteSettingsContext;
    visualizer: CommandPaletteVisualizerContext;
};
