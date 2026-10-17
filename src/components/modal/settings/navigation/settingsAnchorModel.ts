import type { SettingsSubviewId } from '../../../../stores/useSettingsModalStore';

// src/components/modal/settings/navigation/settingsAnchorModel.ts
// The places inside the settings that other code names: commands, Ponder scenes and links open the
// dialog on one of these. Each entry says which category's page the place is on, which a caller has
// to know before that page exists. The id itself is carried by a group or a row of the page:
// settingsAnchorCoverage.test.ts holds this table against the options the pages declare. The
// settings search finds a place by that group or row, under the page's name for it, and leaves it
// out where the page does not draw it (kit/options.ts); the table says nothing about either.

export const SETTINGS_ANCHOR_DEFINITIONS = {
    // pages/AppearancePage
    lyricsRenderer: { section: 'appearance' },
    themePresets: { section: 'appearance' },
    electronSettings: { section: 'appearance' },

    // pages/PlayerPage
    playbackEntryView: { section: 'player' },
    latticeSettings: { section: 'player' },
    bottomUiSettings: { section: 'player' },
    stageTrackPill: { section: 'player' },
    videoLayerSettings: { section: 'player' },
    labPlayerUi: { section: 'player' },

    // pages/HomePage; the library UI is drawn only where there is more than one to choose from, and
    // the Bravais group only while bravais is the one in effect.
    librarySuite: { section: 'home' },
    bravaisSettings: { section: 'home' },
    homeTabsVisibility: { section: 'home' },
    grid3dCardStyle: { section: 'home' },
    rememberHomeCardPosition: { section: 'home' },
    gridViewCardSettings: { section: 'home' },

    // pages/LyricsPage
    localLyricFormatOrder: { section: 'lyrics' },

    // pages/PlaybackPage, pages/LyricsPage, and the listening report on pages/IntegrationPage
    queueSettings: { section: 'playback' },
    transitionSettings: { section: 'playback' },
    replayGainSettings: { section: 'playback' },
    audioOutputSettings: { section: 'playback' },
    lyrics: { section: 'lyrics' },
    scrobbleSettings: { section: 'integration' },

    // pages/GeneralPage, and the pinned commands on pages/InteractionPage
    languageSettings: { section: 'general' },
    ponderHints: { section: 'general' },
    pinnedCommands: { section: 'interaction' },

    // pages/GeneralPage (start-up and window)
    labWindowAndTools: { section: 'general' },

    // pages/InteractionPage
    gridActionButton: { section: 'interaction' },
    gridPaletteHotkey: { section: 'interaction' },
    customShortcut: { section: 'interaction' },

    // pages/IntegrationPage — the desktop app and the web build draw stage mode with different
    // rows; it is one destination.
    discordRichPresence: { section: 'integration' },
    obsBrowserSource: { section: 'integration' },
    lyricApi: { section: 'integration' },
    stageMode: { section: 'integration' },
    navidrome: { section: 'integration' },

    // pages/StoragePage, and the sync server on pages/IntegrationPage
    cacheDetails: { section: 'storage' },
    localLibraryWatch: { section: 'storage' },
    mediaCache: { section: 'storage' },
    r2Sync: { section: 'integration' },

    // pages/StoragePage (backup and import)
    importExportTitle: { section: 'storage' },

    // pages/DesktopPage, and the update check on pages/GeneralPage
    desktopTrayBehavior: { section: 'desktop' },
    wallpaperMode: { section: 'desktop' },
    updateCheck: { section: 'general' },

    // pages/GraphicsPage
    graphicsPerformance: { section: 'graphics' },
    graphicsMotion: { section: 'graphics' },

    // pages/ModsPage
    modSystem: { section: 'mods' },
    modList: { section: 'mods' },
} as const satisfies Record<string, { section: SettingsSubviewId }>;

export type SettingsAnchorId = keyof typeof SETTINGS_ANCHOR_DEFINITIONS;

export const SETTINGS_ANCHOR_SECTION = Object.fromEntries(
    Object.entries(SETTINGS_ANCHOR_DEFINITIONS).map(([id, definition]) => [id, definition.section]),
) as Record<SettingsAnchorId, SettingsSubviewId>;

export const settingsAnchorSubview = (anchorId: SettingsAnchorId): SettingsSubviewId => (
    SETTINGS_ANCHOR_SECTION[anchorId]
);
