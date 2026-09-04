import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SearchReturnView, SearchSource } from '../../stores/useSearchNavigationStore';
import type { LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import type { HomeViewTab, LatentBackgroundTuning, LocalSong, LyricData, PlayerState, ReplayGainMode, SongResult, StatusMessage, SubtitleContentMode, VisualizerMode, VisualizerBackgroundMode, MonetBackgroundTuning } from '../../types';
import type { LyricSegmentationRecord, LyricSegmentationSource } from '../../types/lyricSegmentation';
import type { AppLanguagePreference } from '../../i18n/config';
import type { PanelTab } from '../UnifiedPanel';
import type { AppView, CommandFilterHandle } from '../../stores/useAppViewStore';
import { type SettingsModalInitialTab, type SettingsSubviewId } from '../../stores/useSettingsModalStore';
import type { LyricStaffAbsorbMode, LyricStaffPolicy } from '../../utils/lyrics/staffCreditsPolicy';
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

/**
 * What a command needs around it to mean anything.
 *
 * The third gating axis, beside `platform` (which build ships it) and `isAvailable` (whether the
 * current state makes it worth offering). Declared rather than written as another `isAvailable`
 * predicate because two other places have to read the same fact: the settings picker, which may
 * only offer a global shortcut a command that works from anywhere, and anything else that asks
 * "would this be reachable if I were somewhere else".
 */
export type CommandScope = 'player-surface' | 'filtering-surface';

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
    /** Surface gating: which surroundings the command needs. Omitted means anywhere. */
    scope?: CommandScope;
    /** State gating: whether the command is worth offering right now. */
    isAvailable?: (context?: CommandPaletteContext) => boolean;
    /** Kept out of match results, the all-commands list, and the pinned-command picker. */
    hidden?: boolean;
    /** Global shortcut that opens the palette straight into this command. `ctrl` means the
     *  platform's primary modifier — Ctrl on Windows/Linux, Cmd on macOS. `alt` is legal but
     *  unclaimed: the listener's own shortcut lives on Alt, and checks itself against these. */
    openHotkey?: { key: string; ctrl?: boolean; alt?: boolean };
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
    toggleMute: () => void;
    /**
     * The like/star action from the controls tab. It travels here rather than staying inside the
     * panel that drew the button, so a shortcut can be bound to it. The finer refusals — a stage
     * track, a provider that has no like — stay inside the action, which already says so in a
     * status message; only "there is no song" is worth withholding the command for.
     */
    toggleSongLike: () => void | Promise<void>;
    /** Which way the toggle will go, so the command can say so before it runs. */
    isSongLiked: boolean;
    /** Opens the playlist picker for the current song; it no longer needs the panel to be up. */
    openAddToPlaylist: () => void;
    /** Whether there is anywhere to put it — see AddToPlaylistHost, which answers this. */
    canAddCurrentSongToPlaylist: boolean;
    openAudioEqualizer: () => void;
    applyAudioSoundPreset: (modeId: AudioEqualizerModeId) => void;
    runAutoMatchBestLyric: () => Promise<boolean>;
};

export type CommandPaletteNavigationContext = {
    navigateToHome: () => void;
    navigateToPlayer: () => void;
    navigateToLattice: () => void;
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
    startPlayerBottomBarPositioning: () => void;
    canStartPlayerBottomBarPositioning: boolean;
    toggleAlwaysShowPlayerBackButton: () => void;
    toggleAlwaysShowTrackSwitchButtons: () => void;
    toggleAlwaysShowMainWindowTitlebar: () => void;
    /** Lab switch: whether the restored session starts playing by itself on launch. */
    toggleAutoPlayOnLaunch: () => void;
    voiceInputPauseSupported: boolean;
    /** Lab switch for the experimental mod system; gates the `mods` command. */
    modSystemEnabled: boolean;
    toggleVoiceInputPause: () => void;
    togglePreventDisplaySleepDuringPlayback: () => void;
    toggleWallpaperMode: () => void;
    /** macOS-only: the wallpaper-mode Dock auto-hide override (on by default). */
    toggleWallpaperMacAutohideDock: () => void;
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
    /** 开头制作人员信息的处理策略；命令只负责在三态之间轮换。 */
    lyricStaffPolicy: LyricStaffPolicy;
    cycleLyricStaffPolicy: () => void;
    /** 署名块是否吸收相邻行；命令只负责在三态之间轮换。 */
    lyricStaffAbsorbMode: LyricStaffAbsorbMode;
    cycleLyricStaffAbsorbMode: () => void;
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

/**
 * The current song's saved word segmentation, plus the two actions that change it. Lives in the
 * visualizer namespace because it only affects the modes whose typography is built from words.
 */
export type CommandPaletteLyricSegmentationContext = {
    record: LyricSegmentationRecord | null;
    /** True when this build can reach a model at all; false hides the AI action. */
    isAiAvailable: boolean;
    save: (lines: Record<string, string[]>, source: LyricSegmentationSource) => Promise<void>;
    reset: () => Promise<void>;
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
    /**
     * Whether the active mode builds its typography from whole-line word segmentation. Resolved
     * from the registry by the context builder rather than read here: the command modules are
     * plain TS and must not pull the eager visualizer glob into the registry's module graph.
     */
    usesWordSegmentation: boolean;
    lyricSegmentation: CommandPaletteLyricSegmentationContext;
};

/**
 * Where the palette was opened, so a command can decide for itself whether it applies.
 *
 * The palette used to be player-only, which meant "does this command make sense here?" never had
 * to be asked. Now that it opens anywhere, the commands that act on the player's own chrome answer
 * it through `isAvailable` instead of the palette withholding itself entirely.
 */
export type CommandPaletteScopeContext = {
    view: AppView;
    /**
     * The surface that reads typed characters right now, if any — a home grid, today. `filter-view`
     * writes through it; every other command ignores it.
     */
    filter: CommandFilterHandle | null;
};

// Namespaces mirror CommandPaletteGroup one-to-one (plus `shared` and `scope`), so a command's
// group tells you where to look for its dependencies. Cross-group access stays legal but visible.
// `scope` belongs to no group: it describes the palette's surroundings rather than a capability.
export type CommandPaletteContext = {
    shared: CommandPaletteSharedContext;
    scope: CommandPaletteScopeContext;
    search: CommandPaletteSearchContext;
    playback: CommandPalettePlaybackContext;
    navigation: CommandPaletteNavigationContext;
    panel: CommandPalettePanelContext;
    settings: CommandPaletteSettingsContext;
    visualizer: CommandPaletteVisualizerContext;
};
