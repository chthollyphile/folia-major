import type { SettingsUiState } from '../../stores/useSettingsUiStore';
import type { SyncedSettingsRecord, SyncedVisualSettings } from './syncTypes';
import { SYNC_SCHEMA_VERSION } from './syncTypes';

// src/services/sync/settingsSnapshot.ts
// Maps the settings store to the syncable visual settings JSON document.

export const buildSyncedVisualSettings = (state: SettingsUiState): SyncedVisualSettings => ({
    visualizerMode: state.visualizerMode,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    backgroundOpacity: state.backgroundOpacity,
    visualizerOpacity: state.visualizerOpacity,
    hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: state.showSubtitleTranslation,
    lyricsFontStyle: state.lyricsFontStyle,
    lyricsFontScale: state.lyricsFontScale,
    lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
    subtitleFontStyle: state.subtitleFontStyle,
    subtitleFontFamily: state.subtitleFontFamily,
    subtitleFontFallbackFamilies: state.subtitleFontFallbackFamilies,
    classicTuning: state.classicTuning,
    cadenzaTuning: state.cadenzaTuning,
    partitaTuning: state.partitaTuning,
    fumeTuning: state.fumeTuning,
    claddaghTuning: state.claddaghTuning,
    cappellaTuning: state.cappellaTuning,
    tiltTuning: state.tiltTuning,
    monetBackgroundTuning: state.monetBackgroundTuning,
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
    if (settings.visualizerBackgroundMode === null) {
        state.handleResetVisualizerBackgroundMode();
    } else if (settings.visualizerBackgroundMode !== undefined) {
        state.handleSetVisualizerBackgroundMode(settings.visualizerBackgroundMode);
    }
    if (settings.backgroundOpacity !== undefined) state.handleSetBackgroundOpacity(settings.backgroundOpacity);
    if (settings.visualizerOpacity !== undefined) state.handleSetVisualizerOpacity(settings.visualizerOpacity);
    if (settings.hidePlayerTranslationSubtitle !== undefined) state.handleToggleHidePlayerTranslationSubtitle(Boolean(settings.hidePlayerTranslationSubtitle));
    if (settings.showSubtitleTranslation !== undefined) state.handleToggleShowSubtitleTranslation(Boolean(settings.showSubtitleTranslation));
    if (settings.lyricsFontStyle !== undefined) state.handleSetLyricsFontStyle(settings.lyricsFontStyle);
    if (settings.lyricsFontScale !== undefined) state.handleSetLyricsFontScale(settings.lyricsFontScale);
    if (settings.lyricsFontFallbackFamilies !== undefined) state.handleSetLyricsFontFallbackFamilies(settings.lyricsFontFallbackFamilies);
    if (settings.subtitleFontInheritsLyrics !== undefined) state.handleSetSubtitleFontInheritsLyrics(Boolean(settings.subtitleFontInheritsLyrics));
    if (settings.subtitleFontStyle !== undefined) state.handleSetSubtitleFontStyle(settings.subtitleFontStyle);
    if (settings.subtitleFontFamily !== undefined) state.handleSetSubtitleFontFamily(settings.subtitleFontFamily);
    if (settings.subtitleFontFallbackFamilies !== undefined) state.handleSetSubtitleFontFallbackFamilies(settings.subtitleFontFallbackFamilies);
    if (settings.classicTuning !== undefined) state.handleSetClassicTuning(settings.classicTuning as Parameters<SettingsUiState['handleSetClassicTuning']>[0]);
    if (settings.cadenzaTuning !== undefined) state.handleSetCadenzaTuning(settings.cadenzaTuning as Parameters<SettingsUiState['handleSetCadenzaTuning']>[0]);
    if (settings.partitaTuning !== undefined) state.handleSetPartitaTuning(settings.partitaTuning as Parameters<SettingsUiState['handleSetPartitaTuning']>[0]);
    if (settings.fumeTuning !== undefined) state.handleSetFumeTuning(settings.fumeTuning as Parameters<SettingsUiState['handleSetFumeTuning']>[0]);
    if (settings.claddaghTuning !== undefined) state.handleSetCladdaghTuning(settings.claddaghTuning as Parameters<SettingsUiState['handleSetCladdaghTuning']>[0]);
    if (settings.cappellaTuning !== undefined) state.handleSetCappellaTuning(settings.cappellaTuning as Parameters<SettingsUiState['handleSetCappellaTuning']>[0]);
    if (settings.tiltTuning !== undefined) state.handleSetTiltTuning(settings.tiltTuning as Parameters<SettingsUiState['handleSetTiltTuning']>[0]);
    if (settings.monetBackgroundTuning !== undefined) state.handleSetMonetBackgroundTuning(settings.monetBackgroundTuning as Parameters<SettingsUiState['handleSetMonetBackgroundTuning']>[0]);
    if (settings.monetTuning !== undefined) state.handleSetMonetTuning(settings.monetTuning as Parameters<SettingsUiState['handleSetMonetTuning']>[0]);
    if (settings.urlBackgroundList !== undefined) state.handleSetUrlBackgroundList(settings.urlBackgroundList as Parameters<SettingsUiState['handleSetUrlBackgroundList']>[0]);
    if (settings.urlBackgroundSelectedId !== undefined) state.handleSetUrlBackgroundSelectedId(settings.urlBackgroundSelectedId);
    if (settings.homeLayoutStyle !== undefined) state.handleSetHomeLayoutStyle(settings.homeLayoutStyle);
    if (settings.grid3dCardStyle !== undefined) state.handleSetGrid3dCardStyle(settings.grid3dCardStyle);
};
