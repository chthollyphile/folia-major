import type { SettingsUiState } from '../../stores/useSettingsUiStore';
import type { SyncedSettingsRecord, SyncedVisualSettings } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';
import { applyVisualizerTuningsToSettings, collectVisualizerTunings } from '../../components/visualizer/tuningRegistry';

// src/services/sync/settingsSnapshot.ts
// Maps the settings store to the syncable visual settings JSON document.

export const buildSyncedVisualSettings = (state: SettingsUiState): SyncedVisualSettings => ({
    visualizerMode: state.visualizerMode,
    randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    backgroundOpacity: state.backgroundOpacity,
    visualizerOpacity: state.visualizerOpacity,
    hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: state.showSubtitleTranslation,
    subtitleOverlayBackground: state.subtitleOverlayBackground,
    lyricsFontStyle: state.lyricsFontStyle,
    lyricsFontScale: state.lyricsFontScale,
    lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
    subtitleFontStyle: state.subtitleFontStyle,
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
    monetTuning: state.monetTuning,
    urlBackgroundList: state.urlBackgroundList,
    urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    homeLayoutStyle: state.homeLayoutStyle,
    grid3dCardStyle: state.grid3dCardStyle,
});

export const buildSyncedSettingsRecord = (
    state: SettingsUiState,
    updatedAt = new Date().toISOString(),
): SyncedSettingsRecord => ({
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt,
    data: buildSyncedVisualSettings(state),
});

export const getSyncedSettingsSignature = (state: SettingsUiState) => (
    JSON.stringify(buildSyncedVisualSettings(state))
);

export const applySyncedVisualSettings = (
    state: SettingsUiState,
    settings: SyncedVisualSettings,
) => {
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
    if (settings.subtitleOverlayBackground !== undefined) state.handleToggleSubtitleOverlayBackground(Boolean(settings.subtitleOverlayBackground));
    if (settings.lyricsFontStyle !== undefined) state.handleSetLyricsFontStyle(settings.lyricsFontStyle);
    if (settings.lyricsFontScale !== undefined) state.handleSetLyricsFontScale(settings.lyricsFontScale);
    if (settings.lyricsFontFallbackFamilies !== undefined) state.handleSetLyricsFontFallbackFamilies(settings.lyricsFontFallbackFamilies);
    if (settings.subtitleFontInheritsLyrics !== undefined) state.handleSetSubtitleFontInheritsLyrics(Boolean(settings.subtitleFontInheritsLyrics));
    if (settings.subtitleFontStyle !== undefined) state.handleSetSubtitleFontStyle(settings.subtitleFontStyle);
    if (settings.subtitleFontFamily !== undefined) state.handleSetSubtitleFontFamily(settings.subtitleFontFamily);
    if (settings.subtitleFontFallbackFamilies !== undefined) state.handleSetSubtitleFontFallbackFamilies(settings.subtitleFontFallbackFamilies);
    if (settings.visualizerTunings !== undefined) {
        applyVisualizerTuningsToSettings(state as unknown as Record<string, unknown>, settings.visualizerTunings);
    }
    if (settings.visualizerTunings === undefined && settings.classicTuning !== undefined) state.handleSetClassicTuning(settings.classicTuning as Parameters<SettingsUiState['handleSetClassicTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.cadenzaTuning !== undefined) state.handleSetCadenzaTuning(settings.cadenzaTuning as Parameters<SettingsUiState['handleSetCadenzaTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.partitaTuning !== undefined) state.handleSetPartitaTuning(settings.partitaTuning as Parameters<SettingsUiState['handleSetPartitaTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.fumeTuning !== undefined) state.handleSetFumeTuning(settings.fumeTuning as Parameters<SettingsUiState['handleSetFumeTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.claddaghTuning !== undefined) state.handleSetCladdaghTuning(settings.claddaghTuning as Parameters<SettingsUiState['handleSetCladdaghTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.cappellaTuning !== undefined) state.handleSetCappellaTuning(settings.cappellaTuning as Parameters<SettingsUiState['handleSetCappellaTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.tiltTuning !== undefined) state.handleSetTiltTuning(settings.tiltTuning as Parameters<SettingsUiState['handleSetTiltTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.dioramaTuning !== undefined) state.handleSetDioramaTuning(settings.dioramaTuning as Parameters<SettingsUiState['handleSetDioramaTuning']>[0]);
    if (settings.monetBackgroundTuning !== undefined) state.handleSetMonetBackgroundTuning(settings.monetBackgroundTuning as Parameters<SettingsUiState['handleSetMonetBackgroundTuning']>[0]);
    if (settings.nomandBackgroundTuning !== undefined) state.handleSetNomandBackgroundTuning(settings.nomandBackgroundTuning as Parameters<SettingsUiState['handleSetNomandBackgroundTuning']>[0]);
    if (settings.latentBackgroundTuning !== undefined) state.handleSetLatentBackgroundTuning(settings.latentBackgroundTuning as Parameters<SettingsUiState['handleSetLatentBackgroundTuning']>[0]);
    if (settings.visualizerTunings === undefined && settings.monetTuning !== undefined) state.handleSetMonetTuning(settings.monetTuning as Parameters<SettingsUiState['handleSetMonetTuning']>[0]);
    if (settings.urlBackgroundList !== undefined) state.handleSetUrlBackgroundList(settings.urlBackgroundList as Parameters<SettingsUiState['handleSetUrlBackgroundList']>[0]);
    if (settings.urlBackgroundSelectedId !== undefined) state.handleSetUrlBackgroundSelectedId(settings.urlBackgroundSelectedId);
    if (settings.homeLayoutStyle !== undefined) state.handleSetHomeLayoutStyle(settings.homeLayoutStyle);
    if (settings.grid3dCardStyle !== undefined) state.handleSetGrid3dCardStyle(settings.grid3dCardStyle);
};
