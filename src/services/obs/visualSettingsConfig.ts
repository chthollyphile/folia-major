import { collectVisualizerTunings } from '../../components/visualizer/tuningRegistry';
import { readStoredThemeAutoGenerateEnabled, readStoredThemeAutoSwitchEnabled, readStoredThemeGenerationSource } from '../themePreferences';
import type { CappellaAvatarImage, CappellaEmojiImage, CappellaTuning, MonetBackgroundImage, MonetBackgroundTuning, MonetPortraitImage, MonetTuning, NomandBackgroundTuning } from '../../types';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';
import { useTypographySettingsStore } from '../../stores/useTypographySettingsStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useStageSettingsStore } from '../../stores/useStageSettingsStore';

// src/services/obs/visualSettingsConfig.ts
// Everything compressConfig serializes except the theme. Reads the live settings store, so both
// the import/export "copy config" and the OBS URL builder stay in sync from a single field list.

export function buildVisualSettingsConfig(): Record<string, unknown> {
  const storeStageSettings = useStageSettingsStore.getState();
  const storeThemeSettings = useThemeSettingsStore.getState();
  const storeTypographySettings = useTypographySettingsStore.getState();
  const storeVisualizer = useVisualizerSettingsStore.getState();
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
    followSystemTheme: storeThemeSettings.followSystemTheme,
    visualizerMode: storeVisualizer.visualizerMode,
    randomVisualizerModePerSong: storeVisualizer.randomVisualizerModePerSong,
    visualizerBackgroundMode: storeVisualizer.visualizerBackgroundMode,
    backgroundOpacity: storeVisualizer.backgroundOpacity,
    // The other three legs of background.common, alongside the opacity above. The local OBS browser
    // source has always carried them (it publishes the whole VisualizerBackgroundConfig), so leaving
    // them out here made the two OBS paths disagree — and a copied config silently lost the cover-color,
    // geometric-background and vignette toggles on re-import.
    useCoverColorBg: storeThemeSettings.useCoverColorBg,
    disableVisualizerGeometricBackground: storeVisualizer.disableVisualizerGeometricBackground,
    disableVisualizerVignette: storeVisualizer.disableVisualizerVignette,
    // Static mode is not merely an audio-reactivity switch: it selects the low-motion branch inside
    // several renderers, so a web overlay without it animates where the main window does not.
    staticMode: storeThemeSettings.staticMode,
    visualizerOpacity: storeVisualizer.visualizerOpacity,
    hidePlayerTranslationSubtitle: storeTypographySettings.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: storeTypographySettings.showSubtitleTranslation,
    subtitleContentMode: storeTypographySettings.subtitleContentMode,
    subtitleOverlayBackground: storeTypographySettings.subtitleOverlayBackground,
    subtitleOverlayOpacity: storeTypographySettings.subtitleOverlayOpacity,
    showHarmonySubtitle: storeTypographySettings.showHarmonySubtitle,
    harmonySubtitleBackground: storeTypographySettings.harmonySubtitleBackground,
    lyricsFontStyle: storeTypographySettings.lyricsFontStyle,
    lyricsFontScale: storeTypographySettings.lyricsFontScale,
    // The codec, the OBS overlay (obsWebAppearance -> buildVisualizerTheme) and the import path all
    // already handle the custom font weights; this field table is the only place they were missing,
    // so without them a copied link and the OBS overlay silently fall back to the mode's default
    // weight. null means "use the mode default" and is carried as-is so it round-trips.
    lyricsFontWeight: storeTypographySettings.lyricsFontWeight,
    lyricsFontFallbackFamilies: storeTypographySettings.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: storeTypographySettings.subtitleFontInheritsLyrics,
    subtitleFontScale: storeTypographySettings.subtitleFontScale,
    subtitleFontStyle: storeTypographySettings.subtitleFontStyle,
    subtitleFontWeight: storeTypographySettings.subtitleFontWeight,
    subtitleFontFamily: storeTypographySettings.subtitleFontFamily,
    subtitleFontFallbackFamilies: storeTypographySettings.subtitleFontFallbackFamilies,
    // Only a system font's family name is portable; an uploaded font is a browser-local FontFace
    // (its generated family resolves nowhere else), so it is not carried.
    lyricsCustomFontFamily: storeTypographySettings.lyricsCustomFont?.source === 'system' ? storeTypographySettings.lyricsCustomFont.family : null,
    visualizerTunings: collectVisualizerTunings(storeVisualizer as unknown as Record<string, unknown>),
    classicTuning: storeVisualizer.classicTuning,
    cadenzaTuning: storeVisualizer.cadenzaTuning,
    partitaTuning: storeVisualizer.partitaTuning,
    fumeTuning: storeVisualizer.fumeTuning,
    claddaghTuning: storeVisualizer.claddaghTuning,
    cappellaTuning: storeVisualizer.cappellaTuning,
    tiltTuning: storeVisualizer.tiltTuning,
    dioramaTuning: storeVisualizer.dioramaTuning,
    monetBackgroundTuning: storeVisualizer.monetBackgroundTuning,
    nomandBackgroundTuning: storeVisualizer.nomandBackgroundTuning,
    latentBackgroundTuning: storeVisualizer.latentBackgroundTuning,
    monetTuning: storeVisualizer.monetTuning,
    pendoloTuning: storeVisualizer.pendoloTuning,
    sonnetTuning: storeVisualizer.sonnetTuning,
    temperaTuning: storeVisualizer.temperaTuning,
    urlBackgroundList: storeVisualizer.urlBackgroundList,
    urlBackgroundSelectedId: storeVisualizer.urlBackgroundSelectedId,
    // The now playing card. Not a visualizer setting, but it is chrome the listener sees over the
    // same picture, and all three legs are needed together: the mode alone restores a card that
    // hides after someone else's timeout, and on a page the importer never asked for.
    stageTrackPillMode: storeStageSettings.stageTrackPillMode,
    stageTrackPillTimeoutSec: storeStageSettings.stageTrackPillTimeoutSec,
    stageTrackPillOnHome: storeStageSettings.stageTrackPillOnHome,
  };
}

// Whether the current settings use a custom font (a picked system font, an uploaded font, or a
// custom fallback family) rather than only a builtin sans/serif/mono style — used to warn on copy
// that the font may be unavailable on the OBS machine (and that an uploaded font never transfers).
export function hasCustomObsFont(): boolean {
  const storeTypographySettings = useTypographySettingsStore.getState();
  return Boolean(storeTypographySettings.lyricsCustomFont)
    || (storeTypographySettings.lyricsFontFallbackFamilies?.length ?? 0) > 0
    || Boolean(storeTypographySettings.subtitleFontFamily)
    || (storeTypographySettings.subtitleFontFallbackFamilies?.length ?? 0) > 0;
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
  return computeHasUploadedObsAsset({
    ...useVisualizerSettingsStore.getState(),
    ...useVisualizerAssetStore.getState(),
  });
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
