import { collectVisualizerTunings } from '../components/visualizer/tuningRegistry';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { readStoredThemeAutoGenerateEnabled, readStoredThemeAutoSwitchEnabled, readStoredThemeGenerationSource } from '../services/themePreferences';
import type { CappellaAvatarImage, CappellaEmojiImage, CappellaTuning, MonetBackgroundImage, MonetBackgroundTuning, MonetPortraitImage, MonetTuning, NomandBackgroundTuning } from '../types';

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
    themeGenerationSource: readStoredThemeGenerationSource(),
    followSystemTheme: store.followSystemTheme,
    visualizerMode: store.visualizerMode,
    randomVisualizerModePerSong: store.randomVisualizerModePerSong,
    visualizerBackgroundMode: store.visualizerBackgroundMode,
    backgroundOpacity: store.backgroundOpacity,
    // The other three legs of background.common, alongside the opacity above. The local OBS browser
    // source has always carried them (it publishes the whole VisualizerBackgroundConfig), so leaving
    // them out here made the two OBS paths disagree — and a copied config silently lost the cover-color,
    // geometric-background and vignette toggles on re-import.
    useCoverColorBg: store.useCoverColorBg,
    disableVisualizerGeometricBackground: store.disableVisualizerGeometricBackground,
    disableVisualizerVignette: store.disableVisualizerVignette,
    // Static mode is not merely an audio-reactivity switch: it selects the low-motion branch inside
    // several renderers, so a web overlay without it animates where the main window does not.
    staticMode: store.staticMode,
    visualizerOpacity: store.visualizerOpacity,
    hidePlayerTranslationSubtitle: store.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: store.showSubtitleTranslation,
    subtitleContentMode: store.subtitleContentMode,
    subtitleOverlayBackground: store.subtitleOverlayBackground,
    subtitleOverlayOpacity: store.subtitleOverlayOpacity,
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
    temperaTuning: store.temperaTuning,
    urlBackgroundList: store.urlBackgroundList,
    urlBackgroundSelectedId: store.urlBackgroundSelectedId,
    // The now playing card. Not a visualizer setting, but it is chrome the listener sees over the
    // same picture, and all three legs are needed together: the mode alone restores a card that
    // hides after someone else's timeout, and on a page the importer never asked for.
    stageTrackPillMode: store.stageTrackPillMode,
    stageTrackPillTimeoutSec: store.stageTrackPillTimeoutSec,
    stageTrackPillOnHome: store.stageTrackPillOnHome,
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

// The subset of settings that decide whether an uploaded image asset is in play. Kept structural
// (not the whole store type) so both the store snapshot and a reactive selector can feed it.
export interface UploadedObsAssetInputs {
  monetBackgroundTuning: MonetBackgroundTuning;
  nomandBackgroundTuning: NomandBackgroundTuning;
  monetTuning: MonetTuning;
  monetBackgroundImage: MonetBackgroundImage | null;
  monetPortraitImage: MonetPortraitImage | null;
  cappellaTuning: CappellaTuning;
  cappellaCustomEmojiImages: CappellaEmojiImage[];
  cappellaCustomAvatarImages: CappellaAvatarImage[];
}

// Whether the current settings rely on an uploaded image asset that the copied cfg URL cannot carry
// (an IndexedDB blob has no shareable URL). These ride the separate OBS Custom CSS payload instead,
// so this predicate both gates the "copy CSS" affordance and reshapes the copy hint. Only flag an
// asset when its custom source is actually selected and populated, so an unpicked toggle never warns.
// The uploaded background is shared by the Monet and Nomand modes, hence both source checks.
export function computeHasUploadedObsAsset(inputs: UploadedObsAssetInputs): boolean {
  const usesUploadedBackground = inputs.monetBackgroundTuning.backgroundSource === 'uploaded-global'
    || inputs.nomandBackgroundTuning.imageSource === 'uploaded-global';
  const usesCustomPortrait = inputs.monetTuning.portraitSource === 'custom';
  const usesCustomEmojis = inputs.cappellaTuning.emojiPackSource === 'custom'
    && inputs.cappellaCustomEmojiImages.length > 0;
  const usesCustomAvatars = inputs.cappellaTuning.avatarSource === 'custom'
    && inputs.cappellaCustomAvatarImages.length > 0;
  return (usesUploadedBackground && Boolean(inputs.monetBackgroundImage))
    || (usesCustomPortrait && Boolean(inputs.monetPortraitImage))
    || usesCustomEmojis
    || usesCustomAvatars;
}

export function hasUploadedObsAsset(): boolean {
  return computeHasUploadedObsAsset(useSettingsUiStore.getState());
}

// Single source of truth for the OBS copy toast: an uploaded image is the more surprising loss
// (silent fall-back to the song cover), so it takes precedence over the font hint; neither in play
// means a plain success. Returns i18n keys, not text, so it stays free of any component's t().
export function resolveObsCopyHintKey(): { type: 'info' | 'success'; key: string; } {
  if (hasUploadedObsAsset()) {
    return { type: 'info', key: 'options.obsUrlUploadedAssetHint' };
  }
  if (hasCustomObsFont()) {
    return { type: 'info', key: 'options.obsUrlCustomFontHint' };
  }
  return { type: 'success', key: 'status.copied' };
}
