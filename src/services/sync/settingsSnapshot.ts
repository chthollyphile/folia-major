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
    state.handleSetVisualizerMode(settings.visualizerMode);
    if (settings.visualizerBackgroundMode) {
        state.handleSetVisualizerBackgroundMode(settings.visualizerBackgroundMode);
    } else {
        state.handleResetVisualizerBackgroundMode();
    }
    state.handleSetBackgroundOpacity(settings.backgroundOpacity);
    state.handleSetVisualizerOpacity(settings.visualizerOpacity);
    state.handleToggleHidePlayerTranslationSubtitle(Boolean(settings.hidePlayerTranslationSubtitle));
    state.handleToggleShowSubtitleTranslation(Boolean(settings.showSubtitleTranslation));
    state.handleSetLyricsFontStyle(settings.lyricsFontStyle);
    state.handleSetLyricsFontScale(settings.lyricsFontScale);
    state.handleSetLyricsFontFallbackFamilies(settings.lyricsFontFallbackFamilies);
    state.handleSetSubtitleFontInheritsLyrics(Boolean(settings.subtitleFontInheritsLyrics));
    state.handleSetSubtitleFontStyle(settings.subtitleFontStyle);
    state.handleSetSubtitleFontFamily(settings.subtitleFontFamily);
    state.handleSetSubtitleFontFallbackFamilies(settings.subtitleFontFallbackFamilies);
    state.handleSetClassicTuning(settings.classicTuning as Parameters<SettingsUiState['handleSetClassicTuning']>[0]);
    state.handleSetCadenzaTuning(settings.cadenzaTuning as Parameters<SettingsUiState['handleSetCadenzaTuning']>[0]);
    state.handleSetPartitaTuning(settings.partitaTuning as Parameters<SettingsUiState['handleSetPartitaTuning']>[0]);
    state.handleSetFumeTuning(settings.fumeTuning as Parameters<SettingsUiState['handleSetFumeTuning']>[0]);
    state.handleSetCladdaghTuning(settings.claddaghTuning as Parameters<SettingsUiState['handleSetCladdaghTuning']>[0]);
    state.handleSetCappellaTuning(settings.cappellaTuning as Parameters<SettingsUiState['handleSetCappellaTuning']>[0]);
    state.handleSetTiltTuning(settings.tiltTuning as Parameters<SettingsUiState['handleSetTiltTuning']>[0]);
    state.handleSetMonetBackgroundTuning(settings.monetBackgroundTuning as Parameters<SettingsUiState['handleSetMonetBackgroundTuning']>[0]);
    state.handleSetMonetTuning(settings.monetTuning as Parameters<SettingsUiState['handleSetMonetTuning']>[0]);
    state.handleSetUrlBackgroundList(settings.urlBackgroundList as Parameters<SettingsUiState['handleSetUrlBackgroundList']>[0]);
    state.handleSetUrlBackgroundSelectedId(settings.urlBackgroundSelectedId);
    state.handleSetHomeLayoutStyle(settings.homeLayoutStyle);
    state.handleSetGrid3dCardStyle(settings.grid3dCardStyle);
};
