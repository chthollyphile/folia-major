import type { SettingsSubviewId } from '../../../../stores/useSettingsModalStore';

// src/components/modal/settings/navigation/settingsAnchorModel.ts
// Which options-tab section each <SettingsAnchor> lives in and which translated label its expanded
// sidebar entry uses. Commands and inactive sidebar sections both need this information before the
// destination panel exists, so it is declared once here. settingsAnchorCoverage.test.ts holds the
// table against the anchors actually rendered, so a section cannot silently drift away from its
// navigation destination.

export const SETTINGS_ANCHOR_DEFINITIONS = {
    // AppearanceSettingsSubview
    lyricsRenderer: { section: 'appearance', labelKey: 'options.lyricsRenderer' },
    themePresets: { section: 'appearance', labelKey: 'options.themePresets' },
    stageTrackPill: { section: 'appearance', labelKey: 'options.stageTrackPill' },
    grid3dCardStyle: { section: 'appearance', labelKey: 'options.grid3dCardStyle' },
    latticeSettings: { section: 'appearance', labelKey: 'options.latticeSettings' },
    gridViewCardSettings: { section: 'appearance', labelKey: 'options.gridViewCardSettings' },
    videoLayerSettings: { section: 'appearance', labelKey: 'options.videoLayerSettings' },
    importExportTitle: { section: 'appearance', labelKey: 'options.importExportTitle' },

    // GeneralSettingsSubview (PinnedCommandSettings renders inside it)
    languageSettings: { section: 'general', labelKey: 'options.languageSettings' },
    homeTabsVisibility: { section: 'general', labelKey: 'options.homeTabsVisibility' },
    rememberHomeCardPosition: { section: 'general', labelKey: 'options.rememberHomeCardPosition' },
    playbackEntryView: { section: 'general', labelKey: 'options.playbackEntryView' },
    bottomUiSettings: { section: 'general', labelKey: 'options.bottomUiSettings' },
    pinnedCommands: { section: 'general', labelKey: 'options.pinnedCommands' },

    // PlaybackSettingsSubview (TransitionSettingsSection renders inside it)
    queueSettings: { section: 'playback', labelKey: 'options.queueSettings' },
    scrobbleSettings: { section: 'playback', labelKey: 'options.scrobbleSettings' },
    transitionSettings: { section: 'playback', labelKey: 'options.transitionSettings' },
    replayGainSettings: { section: 'playback', labelKey: 'options.replayGainSettings' },
    lyrics: { section: 'playback', labelKey: 'options.lyrics' },
    audioOutputSettings: { section: 'playback', labelKey: 'options.audioOutputSettings' },

    // InteractionSettingsSubview
    gridActionButton: { section: 'interaction', labelKey: 'options.gridActionButton' },
    gridPaletteHotkey: { section: 'interaction', labelKey: 'options.gridPaletteHotkey' },
    customShortcut: { section: 'interaction', labelKey: 'options.customShortcut' },

    // IntegrationSettingsSubview — stageMode is declared twice on purpose, the Electron and web
    // panels being mutually exclusive; it is still one destination.
    discordRichPresence: { section: 'integration', labelKey: 'options.discordRichPresence', electronOnly: true },
    obsBrowserSource: { section: 'integration', labelKey: 'options.obsBrowserSource', electronOnly: true },
    lyricApi: { section: 'integration', labelKey: 'options.lyricApi', electronOnly: true },
    stageMode: { section: 'integration', labelKey: 'options.stageMode' },
    navidrome: { section: 'integration', labelKey: 'navidrome.settings' },

    // StorageSettingsSection (LocalLibraryWatchSection renders inside it)
    cacheDetails: { section: 'storage', labelKey: 'options.cacheDetails' },
    r2Sync: { section: 'storage', labelKey: 'options.r2Sync' },
    localLibraryWatch: { section: 'storage', labelKey: 'options.localLibraryWatch' },
    mediaCache: { section: 'storage', labelKey: 'options.mediaCache' },

    // DesktopSettingsSubview
    desktopTrayBehavior: { section: 'desktop', labelKey: 'options.desktopTrayBehavior', electronOnly: true },
    wallpaperMode: { section: 'desktop', labelKey: 'options.wallpaperMode', electronOnly: true },
    updateCheck: { section: 'desktop', labelKey: 'options.updateCheck', electronOnly: true },
    electronSettings: { section: 'desktop', labelKey: 'options.electronSettings', electronOnly: true },

    // LabSettingsModal
    labPerformance: { section: 'lab', labelKey: 'options.labPerformanceSection' },
    labMotion: { section: 'lab', labelKey: 'options.reduceMotionSection' },
    labPlayerUi: { section: 'lab', labelKey: 'options.labPlayerUiSection' },
    labPonder: { section: 'lab', labelKey: 'options.ponderHints' },
    labWindowAndTools: { section: 'lab', labelKey: 'options.labWindowAndToolsSection' },
} as const satisfies Record<string, { section: SettingsSubviewId; labelKey: string; electronOnly?: boolean }>;

export type SettingsAnchorId = keyof typeof SETTINGS_ANCHOR_DEFINITIONS;

export const SETTINGS_ANCHOR_SECTION = Object.fromEntries(
    Object.entries(SETTINGS_ANCHOR_DEFINITIONS).map(([id, definition]) => [id, definition.section]),
) as Record<SettingsAnchorId, SettingsSubviewId>;

export const settingsAnchorSubview = (anchorId: SettingsAnchorId): SettingsSubviewId => (
    SETTINGS_ANCHOR_SECTION[anchorId]
);
