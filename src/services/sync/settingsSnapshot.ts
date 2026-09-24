import { useVisualizerSettingsStore, type VisualizerSettingsState } from '../../stores/useVisualizerSettingsStore';
import { useTypographySettingsStore, type TypographySettingsState } from '../../stores/useTypographySettingsStore';
import { useLyricSettingsStore, type LyricSettingsState } from '../../stores/useLyricSettingsStore';
import { useHomeLayoutSettingsStore, type HomeLayoutSettingsState } from '../../stores/useHomeLayoutSettingsStore';
import { usePlayerChromeSettingsStore, type PlayerChromeSettingsState } from '../../stores/usePlayerChromeSettingsStore';
import { useThemeSettingsStore, type ThemeSettingsState } from '../../stores/useThemeSettingsStore';
import type { SyncedSettingsRecord, SyncedVisualSettings } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';
import { applyVisualizerTuningsToSettings, collectVisualizerTunings } from '../../components/visualizer/tuningRegistry';

// src/services/sync/settingsSnapshot.ts
// Maps the settings stores to the syncable visual settings JSON document.
//
// The synced document is deliberately cross-domain — it is one visual config covering both the
// general settings and the visualizer ones — so this is the single place allowed to read both
// stores at once. The document's shape is unchanged by that split.

/** The two stores the synced visual document spans, read as one snapshot. */
export type SyncableSettingsState = VisualizerSettingsState
    & TypographySettingsState & LyricSettingsState
    & HomeLayoutSettingsState & PlayerChromeSettingsState & ThemeSettingsState;

export const readSyncableSettingsState = (): SyncableSettingsState => ({
    ...useVisualizerSettingsStore.getState(),
    ...useTypographySettingsStore.getState(),
    ...useLyricSettingsStore.getState(),
    ...useHomeLayoutSettingsStore.getState(),
    ...usePlayerChromeSettingsStore.getState(),
    ...useThemeSettingsStore.getState(),
});

export const buildSyncedVisualSettings = (state: SyncableSettingsState): SyncedVisualSettings => ({
    followSystemTheme: state.followSystemTheme,
    visualizerMode: state.visualizerMode,
    randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    backgroundOpacity: state.backgroundOpacity,
    visualizerOpacity: state.visualizerOpacity,
    hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: state.showSubtitleTranslation,
    subtitleContentMode: state.subtitleContentMode,
    subtitleOverlayBackground: state.subtitleOverlayBackground,
    subtitleUpcomingLyricsBlur: state.subtitleUpcomingLyricsBlur,
    lyricsFontStyle: state.lyricsFontStyle,
    lyricsFontScale: state.lyricsFontScale,
    lyricsFontWeight: state.lyricsFontWeight,
    lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
    subtitleFontStyle: state.subtitleFontStyle,
    subtitleFontWeight: state.subtitleFontWeight,
    subtitleFontFamily: state.subtitleFontFamily,
    subtitleFontFallbackFamilies: state.subtitleFontFallbackFamilies,
    visualizerTunings: collectVisualizerTunings(state as unknown as Record<string, unknown>),
    classicTuning: state.classicTuning,
    cadenzaTuning: state.cadenzaTuning,
    partitaTuning: state.partitaTuning,
    fumeTuning: state.fumeTuning,
    claddaghTuning: state.claddaghTuning,
    cappellaTuning: state.cappellaTuning,
    tiltTuning: state.tiltTuning,
    dioramaTuning: state.dioramaTuning,
    monetBackgroundTuning: state.monetBackgroundTuning,
    nomandBackgroundTuning: state.nomandBackgroundTuning,
    latentBackgroundTuning: state.latentBackgroundTuning,
    soraBackgroundTuning: state.soraBackgroundTuning,
    monetTuning: state.monetTuning,
    pendoloTuning: state.pendoloTuning,
    sonnetTuning: state.sonnetTuning,
    temperaTuning: state.temperaTuning,
    urlBackgroundList: state.urlBackgroundList,
    urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    homeLayoutStyle: state.homeLayoutStyle,
    grid3dCardStyle: state.grid3dCardStyle,
});

export const buildSyncedSettingsRecord = (
    state: SyncableSettingsState,
    updatedAt = new Date().toISOString(),
): SyncedSettingsRecord => ({
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt,
    data: buildSyncedVisualSettings(state),
});

export const getSyncedSettingsSignature = (state: SyncableSettingsState) => (
    JSON.stringify(buildSyncedVisualSettings(state))
);

export const applySyncedVisualSettings = (
    state: SyncableSettingsState,
    settings: SyncedVisualSettings,
) => {
    if (settings.followSystemTheme !== undefined) state.setFollowSystemTheme(Boolean(settings.followSystemTheme));
    if (settings.visualizerMode !== undefined) state.handleSetVisualizerMode(settings.visualizerMode);
    if (settings.randomVisualizerModePerSong !== undefined) state.handleToggleRandomVisualizerModePerSong(Boolean(settings.randomVisualizerModePerSong));
    if (settings.visualizerBackgroundMode === null) {
        state.handleResetVisualizerBackgroundMode();
    } else if (settings.visualizerBackgroundMode !== undefined) {
        state.handleSetVisualizerBackgroundMode(settings.visualizerBackgroundMode);
    }
    if (settings.backgroundOpacity !== undefined) state.handleSetBackgroundOpacity(settings.backgroundOpacity);
    if (settings.visualizerOpacity !== undefined) state.handleSetVisualizerOpacity(settings.visualizerOpacity);
    if (settings.hidePlayerTranslationSubtitle !== undefined) state.handleToggleHidePlayerTranslationSubtitle(Boolean(settings.hidePlayerTranslationSubtitle));
    if (settings.showSubtitleTranslation !== undefined) state.handleToggleShowSubtitleTranslation(Boolean(settings.showSubtitleTranslation));
    if (settings.subtitleContentMode !== undefined) state.handleSetSubtitleContentMode(settings.subtitleContentMode);
    if (settings.subtitleOverlayBackground !== undefined) state.handleToggleSubtitleOverlayBackground(Boolean(settings.subtitleOverlayBackground));
    if (settings.subtitleUpcomingLyricsBlur !== undefined) state.handleToggleSubtitleUpcomingLyricsBlur(Boolean(settings.subtitleUpcomingLyricsBlur));
    if (settings.lyricsFontStyle !== undefined) state.handleSetLyricsFontStyle(settings.lyricsFontStyle);
    if (settings.lyricsFontScale !== undefined) state.handleSetLyricsFontScale(settings.lyricsFontScale);
    if (settings.lyricsFontWeight !== undefined) state.handleSetLyricsFontWeight(settings.lyricsFontWeight);
    if (settings.lyricsFontFallbackFamilies !== undefined) state.handleSetLyricsFontFallbackFamilies(settings.lyricsFontFallbackFamilies);
    if (settings.subtitleFontInheritsLyrics !== undefined) state.handleSetSubtitleFontInheritsLyrics(Boolean(settings.subtitleFontInheritsLyrics));
    if (settings.subtitleFontStyle !== undefined) state.handleSetSubtitleFontStyle(settings.subtitleFontStyle);
    if (settings.subtitleFontWeight !== undefined) state.handleSetSubtitleFontWeight(settings.subtitleFontWeight);
    if (settings.subtitleFontFamily !== undefined) state.handleSetSubtitleFontFamily(settings.subtitleFontFamily);
    if (settings.subtitleFontFallbackFamilies !== undefined) state.handleSetSubtitleFontFallbackFamilies(settings.subtitleFontFallbackFamilies);
    if (settings.visualizerTunings !== undefined) {
        applyVisualizerTuningsToSettings(state as unknown as Record<string, unknown>, settings.visualizerTunings);
    }
    if (settings.visualizerTunings === undefined && settings.classicTuning !== undefined) state.handleSetClassicTuning(settings.classicTuning as Parameters<SyncableSettingsState['handleSetClassicTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.cadenzaTuning !== undefined) state.handleSetCadenzaTuning(settings.cadenzaTuning as Parameters<SyncableSettingsState['handleSetCadenzaTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.partitaTuning !== undefined) state.handleSetPartitaTuning(settings.partitaTuning as Parameters<SyncableSettingsState['handleSetPartitaTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.fumeTuning !== undefined) state.handleSetFumeTuning(settings.fumeTuning as Parameters<SyncableSettingsState['handleSetFumeTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.claddaghTuning !== undefined) state.handleSetCladdaghTuning(settings.claddaghTuning as Parameters<SyncableSettingsState['handleSetCladdaghTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.cappellaTuning !== undefined) state.handleSetCappellaTuning(settings.cappellaTuning as Parameters<SyncableSettingsState['handleSetCappellaTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.tiltTuning !== undefined) state.handleSetTiltTuning(settings.tiltTuning as Parameters<SyncableSettingsState['handleSetTiltTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.dioramaTuning !== undefined) state.handleSetDioramaTuning(settings.dioramaTuning as Parameters<SyncableSettingsState['handleSetDioramaTuning']>[0]);
    if (settings.monetBackgroundTuning !== undefined) state.handleSetMonetBackgroundTuning(settings.monetBackgroundTuning as Parameters<SyncableSettingsState['handleSetMonetBackgroundTuning']>[0]);
    if (settings.nomandBackgroundTuning !== undefined) state.handleSetNomandBackgroundTuning(settings.nomandBackgroundTuning as Parameters<SyncableSettingsState['handleSetNomandBackgroundTuning']>[0]);
    if (settings.latentBackgroundTuning !== undefined) state.handleSetLatentBackgroundTuning(settings.latentBackgroundTuning as Parameters<SyncableSettingsState['handleSetLatentBackgroundTuning']>[0]);
    if (settings.soraBackgroundTuning !== undefined) state.handleSetSoraBackgroundTuning(settings.soraBackgroundTuning as Parameters<SyncableSettingsState['handleSetSoraBackgroundTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.monetTuning !== undefined) state.handleSetMonetTuning(settings.monetTuning as Parameters<SyncableSettingsState['handleSetMonetTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.pendoloTuning !== undefined) state.handleSetPendoloTuning(settings.pendoloTuning as Parameters<SyncableSettingsState['handleSetPendoloTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.sonnetTuning !== undefined) state.handleSetSonnetTuning(settings.sonnetTuning as Parameters<SyncableSettingsState['handleSetSonnetTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.temperaTuning !== undefined) state.handleSetTemperaTuning(settings.temperaTuning as Parameters<SyncableSettingsState['handleSetTemperaTuning']>[0]);
    if (settings.urlBackgroundList !== undefined) state.handleSetUrlBackgroundList(settings.urlBackgroundList as Parameters<SyncableSettingsState['handleSetUrlBackgroundList']>[0]);
    if (settings.urlBackgroundSelectedId !== undefined) state.handleSetUrlBackgroundSelectedId(settings.urlBackgroundSelectedId);
    if (settings.homeLayoutStyle !== undefined) state.handleSetHomeLayoutStyle(settings.homeLayoutStyle);
    if (settings.grid3dCardStyle !== undefined) state.handleSetGrid3dCardStyle(settings.grid3dCardStyle);
};
