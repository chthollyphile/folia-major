import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SearchKind, SearchReturnView, SearchSource } from '../../stores/useSearchNavigationStore';
import type { LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import type { HomeViewTab, LatentBackgroundTuning, LocalSong, LyricData, PlayerState, ReplayGainMode, SongResult, StatusMessage, SubtitleContentMode, VisualizerMode, VisualizerBackgroundMode, MonetBackgroundTuning, SmartBeatMode } from '../../types';
import type { LyricSegmentationRecord, LyricSegmentationSource } from '../../types/lyricSegmentation';
import type { AppLanguagePreference } from '../../i18n/config';
import type { PanelTab } from '../UnifiedPanel';
import type { AppView, CommandFilterHandle } from '../../stores/useAppViewStore';
import type { GridSurfaceHandle } from '../../types/gridCommandSurface';
import type { LibraryDirectorySurfaceHandle } from '../../library/core/directory/directory.contract';
import type { LibraryArtistSurfaceHandle } from '../../library/core/artist/artist.contract';
import type { LibrarySuiteChromeHandle } from '../../library/core/suite/suiteChrome.contract';
import { type SettingsModalInitialTab, type SettingsSubviewId, type VisualizerSettingsSection } from '../../stores/useSettingsModalStore';
import type { SettingsAnchorId } from '../modal/settings/navigation/settingsAnchorModel';
import type { LyricStaffAbsorbMode, LyricStaffPolicy } from '../../utils/lyrics/staffCreditsPolicy';
import type { AudioEqualizerModeId } from '../../utils/audioEqualizer';
import type { ThemeGenerationSource } from '../../services/themePreferences';
import type { TransitionMode } from '../../services/automix/transitionStrategy';
import type { PersonalFmCatalog } from '../../types/personalFm';
import type { PersonalFmSelection } from '../../services/onlineMusic/fmModes';
import type { QueueBatchAction, QueueFacetKind } from './queueQuery';
import type { CommandPlatform } from './availability';
import type { CommandPaletteSurface } from './surfaces/types';
import type { CommandSyntaxSpec } from './syntax/types';
import type { PlaybackEntryView } from '../../stores/usePlaybackEntryViewStore';
import type { GpuPreference } from '../../stores/useDesktopSettingsStore';
import type { PonderHintVisibility } from '../../types/ponder';
import type { LibraryWallLook } from '../../utils/libraryWallLook';
import type { LibraryWallSeamStyle } from '../../utils/libraryWallSeamStyle';
import type { LibraryWallSeamDirection } from '../../utils/libraryWallSeamDirection';
import type { HifiInstallResult, HifiRuntimeStatus } from '../../types/hifi';

// src/components/command-palette/types.ts
// Shared command palette contracts used by the registry, hook, and UI shell.

export type CommandPaletteGroup = 'search' | 'settings' | 'navigation' | 'panel' | 'playback' | 'visualizer' | 'grid';

/**
 * What a command needs around it to mean anything.
 *
 * The third gating axis, beside `platform` (which build ships it) and `isAvailable` (whether the
 * current state makes it worth offering). Declared rather than written as another `isAvailable`
 * predicate because two other places have to read the same fact: the settings picker, which may
 * only offer a global shortcut a command that works from anywhere, and anything else that asks
 * "would this be reachable if I were somewhere else".
 */
export type CommandScope = 'player-surface' | 'filtering-surface' | 'lattice' | 'grid-surface' | 'directory-surface' | 'artist-surface' | 'suite-chrome';

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
    /**
     * Who the scope belongs to, for scopes only one owner can hold at a time: a `suite-chrome` command names
     * the library suite that declared it. Two commands of such a scope with different owners are never
     * offered together, so they may share an execute shortcut (see executeShortcuts.ts).
     */
    scopeOwner?: string;
    /** State gating: whether the command is worth offering right now. */
    isAvailable?: (context?: CommandPaletteContext) => boolean;
    /** Kept out of match results, the all-commands list, and the pinned-command picker. */
    hidden?: boolean;
    /** Global shortcut that opens the palette straight into this command. `ctrl` means the
     *  platform's primary modifier — Ctrl on Windows/Linux, Cmd on macOS. `alt` is legal but
     *  unclaimed: the listener's own shortcut lives on Alt, and checks itself against these. */
    openHotkey?: { key: string; ctrl?: boolean; alt?: boolean };
    /** Vim-style key sequence that runs this command from execute mode. Omit for anything
     *  dangerous, irreversible, or needing confirmation. Commands available together must stay
     *  prefix-free; mutually exclusive surface scopes may reuse a key. */
    executeShortcut?: string;
    /** Panel body this command renders instead of the default match list. */
    surface?: CommandPaletteSurface;
    /** `--flag @facet:value` dialect this command accepts, parsed by ./syntax. */
    syntax?: CommandSyntaxSpec;
    getInitialInput?: (context: CommandPaletteContext) => string;
    getPreview?: (input: string, context: CommandPaletteContext) => string | null;
    queueIndex?: number;
    queueSong?: SongResult;
    /**
     * Where in the options tab this command lands, set by the settings factories. The settings
     * sidebar search reads it to reuse the command's titles, synonyms and pinyin as extra ways to
     * find that section.
     */
    settingsTarget?: { subview: SettingsSubviewId; anchorId?: SettingsAnchorId };
    /** Successful execution closes the palette unless the command opts out. */
    closeAfterExecute?: boolean;
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
        kind?: SearchKind;
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
    /** Moves the volume by `delta` from its value at the moment of the call, clamped to 0–1. */
    stepVolume: (delta: number) => void;
    previewVolume: (volume: number) => void;
    togglePlay: () => void;
    toggleLoop: () => void;
    next: () => void;
    prev: () => void;
    queue: SongResult[];
    queuePaletteKeepOpen: boolean;
    setQueuePaletteKeepOpen: (enable: boolean) => void;
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
    personalFmCatalog?: PersonalFmCatalog;
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
    /**
     * Whether a mod's equalizer curve is kept, playing or on hold (Folium 1.7 `folium.equalizer`).
     *
     * A function rather than a value because a mod puts a curve in place or takes it off with nothing
     * re-rendering the app to say so: this context is memoised on the values it subscribes to, and the
     * audio ones are only volume and mute. `isAvailable` is asked each time the palette opens, so a getter
     * is read fresh.
     */
    hasModEqualizerCurve: () => boolean;
    /** Takes a mod's equalizer curve off (or discards one on hold), back to the listener's own sound. */
    releaseModEqualizerCurve: () => void;
    runAutoMatchBestLyric: () => Promise<boolean>;
    /** Marks or unmarks the current local song as instrumental (no automatic lyric matching). */
    toggleCurrentSongPureMusicMark: () => Promise<boolean>;
    /** Whether the current song is a local song, the only kind the instrumental mark applies to. */
    canToggleCurrentSongPureMusicMark: boolean;
    /**
     * Whether the current song plays through the HiFi engine (mpv) rather than the Web engine.
     * A getter: the route changes with each song, and the context is not rebuilt for it.
     */
    isHifiRoute: () => boolean;
    /** Opens the HiFi signal-path panel (the same one the badge by the progress bar opens). */
    openHifiSignalPath: () => void;
};

export type CommandPaletteNavigationContext = {
    navigateToHome: () => void;
    navigateToPlayer: () => void;
    navigateToLattice: () => void;
    /** The wall's own locate button: shows the tile of the song that is playing on the wall that is up. */
    locatePlayingSongOnWall: () => void;
    /** Shows the card of the song that is playing, opening its collection's page where needed. */
    locatePlayingSong: () => void;
    /**
     * Selects a native home tab without the home surface's tab handle: none is registered while no home surface
     * is mounted (Lattice, or the player view once home is hidden), or the handle refused the tab. The host also
     * dismisses an open mod home page, as the mounted surface's handle does even when reselecting the current tab.
     */
    selectHomeViewTab: (tab: HomeViewTab) => void;
    toggleBrowserFullscreen: () => Promise<boolean>;
    toggleRemoteControlWindow: () => Promise<boolean>;
    toggleMainWindowAlwaysOnTop: () => Promise<boolean>;
    /** Window-level toggles (fullscreen, always-on-top) are meaningless in wallpaper mode. */
    isWallpaperMode: boolean;
    /** False on native Wayland, where Electron's always-on-top is silently ignored. */
    isWindowAlwaysOnTopSupported: boolean;
};

export type CommandPalettePanelContext = {
    setPanelTab: (tab: PanelTab) => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export type CommandPaletteSettingsContext = {
    openSettings: (
        initialTab?: SettingsModalInitialTab,
        initialSubview?: SettingsSubviewId | null,
        initialVisualizerSection?: VisualizerSettingsSection | null,
        initialAnchorId?: SettingsAnchorId | null,
    ) => void;
    setAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void> | void;
    toggleTransparentBackground: () => void;
    toggleDaylightMode: () => void;
    toggleBottomSubtitleOverlay: () => void;
    subtitleContentMode: SubtitleContentMode;
    cycleSubtitleContentMode: () => void;
    toggleSubtitleOverlayBackground: () => void;
    /** Which surface pressing play opens; see usePlaybackEntryViewStore. */
    playbackEntryView: PlaybackEntryView;
    setPlaybackEntryView: (view: PlaybackEntryView) => void;
    /** Library UI suites offered as a choice (registry order, default suite first). */
    librarySuiteOptions: () => ReadonlyArray<{ id: string; labelKey: string }>;
    /** The suite actually rendering: the stored choice resolved through the registry, never a suite this build lacks. */
    activeLibrarySuite: () => string;
    /** Same predicate the settings section hides itself with: more than one suite is available. */
    canChooseLibrarySuite: () => boolean;
    /** Switches suites the way the settings section does (current session key + switchLibrarySuite). */
    chooseLibrarySuite: (suiteId: string) => void;
    /**
     * Same predicate the settings group (pages/BravaisWallGroup) shows itself with: the *active* suite is bravais.
     * A function, because switching suites while the palette is open has to close the wall-look commands off.
     */
    isLibraryWallLookAvailable: () => boolean;
    /**
     * Same predicate the settings rows only the grid reads show themselves with (library/app/gridLibraryActive):
     * the *active* suite is the grid. A function, for the same reason as the one above.
     */
    isGridLibraryActive: () => boolean;
    /** bravais wall transparency (useLibraryWallLookStore); read live. Not part of appearance import / export. */
    libraryWallLook: () => LibraryWallLook;
    setLibraryWallLook: (look: LibraryWallLook) => void;
    /** Windows per 12-slot block while the look is partial, 1–6; read live. */
    libraryWallWindowsPerBlock: () => number;
    /** Clamps to 1–6 before storing. */
    setLibraryWallWindowsPerBlock: (windowsPerBlock: number) => void;
    /** bravais collection tiles' stack edges (useLibraryWallLookStore.collectionStackEdges): flips the stored value. */
    toggleLibraryWallStackEdges: () => void;
    /** bravais info strip always see-through (useLibraryWallLookStore.seamClear); read live. */
    libraryWallSeamClear: () => boolean;
    toggleLibraryWallSeamClear: () => void;
    /** bravais solid info strip preset (useLibraryWallLookStore.seamStyle); read live. Ignored while the strip is see-through. */
    libraryWallSeamStyle: () => LibraryWallSeamStyle;
    setLibraryWallSeamStyle: (style: LibraryWallSeamStyle) => void;
    /** Lyrics / blur on the visualizer that shows through the bravais wall: flip the stored values. */
    toggleLibraryWallBackdropLyrics: () => void;
    toggleLibraryWallBackdropBlur: () => void;
    /** Which way the bravais info strip opens (useLibraryWallLookStore.seamDirection: auto / auto-reverse / vertical / horizontal); read live. */
    libraryWallSeamDirection: () => LibraryWallSeamDirection;
    setLibraryWallSeamDirection: (direction: LibraryWallSeamDirection) => void;
    ponderHintVisibility: PonderHintVisibility;
    setPonderHintVisibility: (visibility: PonderHintVisibility) => void;
    /** 触屏上那颗思索按钮显不显示。它是触屏唯一的入口，所以关掉是一个明确的选择。 */
    togglePonderTouchButton: () => void;
    toggleRememberHomeCardPosition: () => void;
    startPlayerBottomBarPositioning: () => void;
    canStartPlayerBottomBarPositioning: boolean;
    toggleAlwaysShowPlayerBackButton: () => void;
    toggleGridViewFullBleedCover: () => void;
    toggleGridViewSquareCards: () => void;
    /** A getter: the full-bleed toggle it gates on flips with nothing re-rendering the context. */
    canUseGridViewSquareCards: () => boolean;
    toggleLatticeVignette: () => void;
    /** Motion reduction for the queue collage, the surface issue #370 was filed about. */
    toggleReduceLatticeMotion: () => void;
    /** Whether the OS animation setting is allowed to reduce motion in the app at all. */
    toggleFollowSystemReducedMotion: () => void;
    toggleLatticeAutoFocusOnSongChange: () => void;
    latticePosterTintEnabled: boolean;
    latticePosterTintUseCustomColor: boolean;
    latticePosterTintColor: string;
    latticePosterTintIntensity: number;
    setLatticePosterTintEnabled: (enabled: boolean) => void;
    setLatticePosterTintUseCustomColor: (enabled: boolean) => void;
    setLatticePosterTintColor: (color: string) => void;
    setLatticePosterTintIntensity: (intensity: number) => void;
    toggleAlwaysShowTrackSwitchButtons: () => void;
    toggleAlwaysShowMainWindowTitlebar: () => void;
    togglePlayerHeaderBlur: () => void;
    toggleHideFullscreenButton: () => void;
    toggleNativeMacFullscreenButton: () => void;
    toggleAutoHideCursorWithPlayerChrome: () => void;
    toggleHideCursorWhenIdle: () => void;
    /** Lab switch: whether the restored session starts playing by itself on launch. */
    toggleAutoPlayOnLaunch: () => void;
    toggleTranscodeFallback: () => void;
    /** Whether pause and resume fade the sound out and in. */
    togglePlaybackFade: () => void;
    /** Whether restricted songs and unknown failures count down to a skip, like taken-down ones. */
    toggleAutoSkipUnplayable: () => void;
    /**
     * Whether this build can watch the imported local folders at all. A getter because the answer
     * is a runtime API check (FileSystemObserver) rather than a stored value, and the settings
     * section gates on the same predicate.
     */
    canAutoScanLocalLibrary: () => boolean;
    toggleLocalLibraryAutoScan: () => void;
    /**
     * Whether listening reports can be turned on at all - a provider takes them and its
     * account is signed in. A getter because signing in and out changes the answer while the palette
     * is open, and the settings panel gates its toggle on the same predicate.
     */
    canReportPlayback: () => boolean;
    togglePlaybackReport: () => void;
    voiceInputPauseSupported: boolean;
    /** Lab switch for the experimental mod system; gates the `mods` command. */
    modSystemEnabled: boolean;
    toggleVoiceInputPause: () => void;
    togglePreventDisplaySleepDuringPlayback: () => void;
    /** 后台节流: throttle the window and hold the lyric animation while it is minimised or hidden (main process applies it). */
    toggleBackgroundThrottling: () => void;
    toggleWallpaperMode: () => void;
    /** Close button hides the main window to the tray instead of quitting (main process owns it). */
    toggleCloseToTray: () => void;
    /** Remote control window: hide the top floating window-control bar. */
    toggleHideRemoteControlTitlebar: () => void;
    /** Remote control window: when idle, expand the cover into the large sleeve. */
    toggleRemoteControlExpandCover: () => void;
    /** Remote control window, transparent background: a soft dark shade under the idle type. */
    toggleRemoteControlTextShade: () => void;
    /** Turns remote control click-through off (the way back into a click-through window). */
    unlockRemoteControl: () => void;
    /** OBS browser source: keep the main window's heavy animation while an OBS client is connected. */
    toggleObsKeepMainWindowAnimation: () => void;
    /** macOS-only: the wallpaper-mode Dock auto-hide override (on by default). */
    toggleWallpaperMacAutohideDock: () => void;
    /** Windows-only: the saved render GPU choice, read when asked (it can change while the palette is open). */
    gpuPreference: () => GpuPreference;
    /** Saves the render GPU choice; the main process applies it on the next launch. */
    setGpuPreference: (preference: GpuPreference) => void;
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
    /**
     * Whether this desktop build has the HiFi engine (window.electron.hifi). A getter like the
     * other capability checks; the HiFi settings page gates its switch on the same answer.
     */
    isHifiSupported: () => boolean;
    /** The HiFi switch as stored, read at the press. */
    isHifiEnabled: () => boolean;
    /**
     * Whether the "output is at full volume" warning was accepted once. Until it is, turning HiFi
     * on goes through the settings page, where the warning is asked.
     */
    isHifiVolumeConfirmed: () => boolean;
    setHifiEnabled: (enabled: boolean) => void;
    /** The three HiFi switches without a warning of their own, flipped from what is stored at the press. */
    toggleHifiExclusive: () => void;
    toggleHifiNavidrome: () => void;
    toggleHifiSoftwareVolume: () => void;
    /**
     * Whether "Detect mpv again" is offered: the engine exists and no mpv download is running, the
     * same answer the HiFi page enables its button by. A getter: a download starts and ends without
     * rebuilding this context.
     */
    canRedetectHifiRuntime: () => boolean;
    /** Looks for mpv again; null when the main process did not answer. */
    redetectHifiRuntime: () => Promise<HifiRuntimeStatus | null>;
    /**
     * Whether the download (or update) of mpv is offered: the HiFi page's own test (runtimeState.ts),
     * which is false on Linux, while a download runs, and when the newest build is installed.
     */
    canInstallHifiRuntime: () => boolean;
    /** Downloads and installs the recommended mpv; resolves once it is done, failed or cancelled. */
    installHifiRuntime: () => Promise<HifiInstallResult | null>;
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
    /** Lab > Fix lyric animation freeze on Linux: the Linux renderer fd leak workaround. */
    toggleGlowBlurQuantize: () => void;
    setVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    setMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    setLatentBackgroundTuning: (patch: Partial<LatentBackgroundTuning>) => void;
    /** The built-in video layer behind the lyrics. */
    toggleVideoLayer: () => void;
    /** 智能动感模式 (the beat FX in every mode and background that draws them): off, stored results only, or on. */
    setSmartBeatMode: (mode: SmartBeatMode) => void;
    /** 智能动感模式 on / off, as v0.7.21 shipped it: any mode that plays goes off, off goes fully on. */
    toggleSmartBeat: () => void;
    /** Opens the file picker for the video layer; resolves to the picked name, or null when cancelled. */
    pickVideoLayerFile: () => Promise<string | null>;
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
    /**
     * The track grid on screen, if any. Carries what only it knows — its filtered set, its sort
     * choice, its two panels — plus the collection maintenance its own branch allows.
     */
    grid: GridSurfaceHandle | null;
    /**
     * The home directory on screen (the grid's GridMap), if any: its batch selection and hidden view.
     * Separate from `grid` — a directory selects cards, a track grid sorts and maintains a collection.
     */
    directory: LibraryDirectorySurfaceHandle | null;
    /**
     * The artist page on screen, if any: its top songs, reload / album retry and local entity editing.
     * Separate from `grid` — an artist page has no track list to sort or maintain.
     */
    artist: LibraryArtistSurfaceHandle | null;
    /**
     * The library suite whose own chrome is on screen, if any (B2): its suite-only actions — seam levels,
     * panels, locating the playing song — declared in the suite manifest's `chromeActions`. Registered by
     * the suite while interactive (useLibrarySuiteChromeRegistration); only that suite's commands apply.
     */
    chrome: LibrarySuiteChromeHandle | null;
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
