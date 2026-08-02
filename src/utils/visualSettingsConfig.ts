import { collectVisualizerTunings } from '../components/visualizer/tuningRegistry';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { readStoredThemeAutoGenerateEnabled, readStoredThemeAutoSwitchEnabled } from '../services/themePreferences';

// src/utils/visualSettingsConfig.ts
// Everything compressConfig serializes except the theme. Reads the live settings store, so both
// the import/export "copy config" and the OBS URL builder stay in sync from a single field list.

export function buildVisualSettingsConfig(): Record<string, unknown> {
  const store = useSettingsUiStore.getState();
  // The song-theme automation flags live in theme preferences, not the settings store. The overlay
  // ignores them, but a copied OBS URL is also a restore payload (the import box accepts one), so
  // dropping them here would silently lose both toggles on re-import. Auto-generate is ANDed with
  // auto-switch exactly as useThemeController composes it at mount, so a config can never carry the
  // impossible "generate on, switch off" pair.
  const songThemeAutoSwitchEnabled = readStoredThemeAutoSwitchEnabled();
  const songThemeAutoGenerateEnabled = songThemeAutoSwitchEnabled && readStoredThemeAutoGenerateEnabled();
  return {
    songThemeAutoSwitchEnabled,
    songThemeAutoGenerateEnabled,
    visualizerMode: store.visualizerMode,
    randomVisualizerModePerSong: store.randomVisualizerModePerSong,
    visualizerBackgroundMode: store.visualizerBackgroundMode,
    backgroundOpacity: store.backgroundOpacity,
    visualizerOpacity: store.visualizerOpacity,
    hidePlayerTranslationSubtitle: store.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: store.showSubtitleTranslation,
    subtitleContentMode: store.subtitleContentMode,
    subtitleOverlayBackground: store.subtitleOverlayBackground,
    showHarmonySubtitle: store.showHarmonySubtitle,
    harmonySubtitleBackground: store.harmonySubtitleBackground,
    lyricsFontStyle: store.lyricsFontStyle,
    lyricsFontScale: store.lyricsFontScale,
    // The codec, the OBS overlay (obsWebAppearance -> buildVisualizerTheme) and the import path all
    // already handle the custom font weights; this field table is the only place they were missing,
    // so without them a copied link and the OBS overlay silently fall back to the mode's default
    // weight. null means "use the mode default" and is carried as-is so it round-trips.
    lyricsFontWeight: store.lyricsFontWeight,
    lyricsFontFallbackFamilies: store.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: store.subtitleFontInheritsLyrics,
    subtitleFontScale: store.subtitleFontScale,
    subtitleFontStyle: store.subtitleFontStyle,
    subtitleFontWeight: store.subtitleFontWeight,
    subtitleFontFamily: store.subtitleFontFamily,
    subtitleFontFallbackFamilies: store.subtitleFontFallbackFamilies,
    // Only a system font's family name is portable; an uploaded font is a browser-local FontFace
    // (its generated family resolves nowhere else), so it is not carried.
    lyricsCustomFontFamily: store.lyricsCustomFont?.source === 'system' ? store.lyricsCustomFont.family : null,
    visualizerTunings: collectVisualizerTunings(store as unknown as Record<string, unknown>),
    classicTuning: store.classicTuning,
    cadenzaTuning: store.cadenzaTuning,
    partitaTuning: store.partitaTuning,
    fumeTuning: store.fumeTuning,
    claddaghTuning: store.claddaghTuning,
    cappellaTuning: store.cappellaTuning,
    tiltTuning: store.tiltTuning,
    dioramaTuning: store.dioramaTuning,
    monetBackgroundTuning: store.monetBackgroundTuning,
    nomandBackgroundTuning: store.nomandBackgroundTuning,
    latentBackgroundTuning: store.latentBackgroundTuning,
    monetTuning: store.monetTuning,
    pendoloTuning: store.pendoloTuning,
    sonnetTuning: store.sonnetTuning,
    urlBackgroundList: store.urlBackgroundList,
    urlBackgroundSelectedId: store.urlBackgroundSelectedId,
  };
}

// Whether the current settings use a custom font (a picked system font, an uploaded font, or a
// custom fallback family) rather than only a builtin sans/serif/mono style — used to warn on copy
// that the font may be unavailable on the OBS machine (and that an uploaded font never transfers).
export function hasCustomObsFont(): boolean {
  const store = useSettingsUiStore.getState();
  return Boolean(store.lyricsCustomFont)
    || (store.lyricsFontFallbackFamilies?.length ?? 0) > 0
    || Boolean(store.subtitleFontFamily)
    || (store.subtitleFontFallbackFamilies?.length ?? 0) > 0;
}
