import type { SubtitleContentMode, Theme, VisualizerMode } from '../types';
import type { VisualizerTuningBundle } from '../components/visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';
// OBS 覆盖层不加载 mods（initModVisualizers 需要 Electron 桥接，web 上是 no-op），
// 所以短码里的模式只可能是内建的。
import { DEFAULT_VISUALIZER_MODE, isBuiltinVisualizerMode } from '../types/visualizerModes';
import { decompressConfig } from './appearanceCodec';
import type { ObsAiConfig } from '../services/gemini';
import { getWebAiProvider } from '../services/runtimeConfig';

// src/utils/obsWebAppearance.ts
// Parse the OBS URL params (including the appearance cfg shortcode) into the appearance
// props consumed by ObsWebSourceApp. cfg reuses the app's compressConfig/decompressConfig
// (the appearance source of truth); with no cfg it falls back to renderer defaults + a
// cover-color theme. Note decompressConfig emits store field names, so this maps them to
// VisualizerRenderer prop names (e.g. visualizerMode -> mode).

// How the copied link asks the overlay to resolve its theme: burn in the cfg theme, derive a
// builtin palette per song, or regenerate one per song with AI.
export type ObsThemeMode = 'static' | 'builtin' | 'ai';

// Whitelist read: an absent or hand-mangled value is null, i.e. "no mode stated", never an error.
const readObsThemeMode = (params: URLSearchParams): ObsThemeMode | null => {
  const value = params.get('obsTheme');
  return value === 'static' || value === 'builtin' || value === 'ai' ? value : null;
};

export interface ObsWebParams {
  host: string;
  cfg: string | null;
  isDaylight: boolean;
  transparent: boolean;
  visualizer: string; // single-mode override (empty = use the cfg's mode)
  themeMode: ObsThemeMode | null; // null = link predates the marker; infer from cfg instead
}

export interface ObsWebAppearance {
  mode: VisualizerMode;
  isDaylight: boolean;
  transparent: boolean;
  theme: Theme | null; // cfg theme (side picked by daylight); null -> shell uses cover colors
  visualizerTunings?: VisualizerTuningBundle;
  visualizerOpacity?: number;
  lyricsFontScale?: number;
  subtitleFontScale?: number;
  lyricsFontWeight?: number | null;
  staticMode?: boolean;
  hideTranslationSubtitle?: boolean;
  showSubtitleTranslation?: boolean;
  subtitleContentMode?: SubtitleContentMode;
  subtitleOverlayBackground?: boolean;
  subtitleOverlayOpacity?: number;
  showHarmonySubtitle?: boolean;
  harmonySubtitleBackground?: boolean;
  // Font stack (raw store fields; overlaid onto the theme in ObsWebSourceApp so fonts match the
  // main window). Only a system custom font's family transfers (uploaded fonts do not).
  lyricsFontStyle?: Theme['fontStyle'];
  lyricsCustomFontFamily?: string | null;
  lyricsFontFallbackFamilies?: string[];
  subtitleFontInheritsLyrics?: boolean;
  subtitleFontStyle?: Theme['fontStyle'];
  subtitleFontWeight?: number | null;
  subtitleFontFamily?: string | null;
  subtitleFontFallbackFamilies?: string[];
  background: VisualizerBackgroundConfig;
}

export function parseObsWebParams(search: string): ObsWebParams {
  const params = new URLSearchParams(search);
  return {
    // Sanitize host to host:port characters only; an untrusted '#'/space would otherwise
    // produce a malformed ws:// URL that throws in the WebSocket constructor.
    host: (params.get('host')?.trim() || '').replace(/[^\w.\-:[\]]/g, ''),
    cfg: params.get('cfg'),
    // OBS overlay defaults to the dark theme; only daylight=1 picks the light side.
    isDaylight: params.get('daylight') === '1',
    // Absent and transparent=0 both show the opaque theme background — matching the
    // transparent-player-background toggle's default (off); only transparent=1 makes it transparent.
    transparent: params.get('transparent') === '1',
    visualizer: params.get('visualizer')?.trim() || '',
    themeMode: readObsThemeMode(params),
  };
}

// Dynamic AI overlay params: returns the AI connection under obsTheme=ai, else null. The overlay is
// keyless — the provider comes from Docker runtime config or the Vite build fallback
// key — so the URL carries only the mode marker, no AI secrets.
export function parseObsAiParams(search: string): ObsAiConfig | null {
  const params = new URLSearchParams(search);
  if (readObsThemeMode(params) !== 'ai') return null;
  const provider = getWebAiProvider();
  return { provider };
}

interface BuildAppearanceOptions {
  isDaylight: boolean;
  transparent: boolean;
  visualizerOverride?: string;
  themeMode?: ObsThemeMode | null;
}

export function buildObsAppearanceFromShortcode(
  cfg: string | null,
  { isDaylight, transparent, visualizerOverride, themeMode }: BuildAppearanceOptions,
): ObsWebAppearance {
  let decoded: any = null;
  if (cfg) {
    try {
      decoded = decompressConfig(cfg);
    } catch {
      // Invalid cfg (hand-edited URL, etc.): fall back to defaults + cover-color theme, do not throw.
      decoded = null;
    }
  }

  // Mode priority: explicit visualizer override > cfg's visualizerMode > default.
  const mode: VisualizerMode = visualizerOverride && isBuiltinVisualizerMode(visualizerOverride)
    ? visualizerOverride
    : (decoded?.visualizerMode && isBuiltinVisualizerMode(decoded.visualizerMode) ? decoded.visualizerMode : DEFAULT_VISUALIZER_MODE);

  // The stated mode wins over the payload: the dynamic modes resolve a theme per song in the shell,
  // so a cfg theme (a hand-edited link, or one whose mode was switched in place) must not freeze
  // them. With no mode stated the link predates the marker, so fall back to inferring it from the
  // payload — a baked theme meant static, none meant dynamic.
  const isDynamicMode = themeMode === 'builtin' || themeMode === 'ai';
  const theme: Theme | null = decoded?.theme && !isDynamicMode
    ? (isDaylight ? decoded.theme.light : decoded.theme.dark)
    : null;

  // Guard urlBackgroundList: an untrusted cfg may carry a non-array value, and the URL
  // background layer calls .find() on it — a non-array would throw during render and blank
  // the whole overlay (mirrors the Array.isArray guard on the app's own import path).
  const urlBackgroundItems = Array.isArray(decoded?.urlBackgroundList) ? decoded.urlBackgroundList : undefined;
  const background: VisualizerBackgroundConfig = {
    mode: decoded?.visualizerBackgroundMode ?? undefined,
    transparent,
    // cfg speaks store field names, so the two negated flags are renamed to the shorter names the
    // background layers read. undefined leaves each layer on its own default, as before.
    common: {
      opacity: decoded?.backgroundOpacity,
      useCoverColorBg: decoded?.useCoverColorBg,
      disableGeometricBackground: decoded?.disableVisualizerGeometricBackground,
      disableVignette: decoded?.disableVisualizerVignette,
    },
    monet: decoded?.monetBackgroundTuning ? { tuning: decoded.monetBackgroundTuning } : undefined,
    nomand: decoded?.nomandBackgroundTuning ? { tuning: decoded.nomandBackgroundTuning } : undefined,
    latent: decoded?.latentBackgroundTuning ? { tuning: decoded.latentBackgroundTuning } : undefined,
    url: (urlBackgroundItems || decoded?.urlBackgroundSelectedId)
      ? { items: urlBackgroundItems, selectedId: decoded?.urlBackgroundSelectedId }
      : undefined,
  };

  return {
    mode,
    isDaylight,
    transparent,
    theme,
    visualizerTunings: decoded?.visualizerTunings,
    visualizerOpacity: decoded?.visualizerOpacity,
    lyricsFontScale: decoded?.lyricsFontScale,
    subtitleFontScale: decoded?.subtitleFontScale,
    lyricsFontWeight: decoded?.lyricsFontWeight,
    staticMode: decoded?.staticMode,
    hideTranslationSubtitle: decoded?.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: decoded?.showSubtitleTranslation,
    subtitleContentMode: decoded?.subtitleContentMode,
    subtitleOverlayBackground: decoded?.subtitleOverlayBackground,
    subtitleOverlayOpacity: decoded?.subtitleOverlayOpacity,
    showHarmonySubtitle: decoded?.showHarmonySubtitle,
    harmonySubtitleBackground: decoded?.harmonySubtitleBackground,
    lyricsFontStyle: decoded?.lyricsFontStyle,
    lyricsCustomFontFamily: decoded?.lyricsCustomFontFamily,
    // Guard the fallback arrays like urlBackgroundList: a hand-edited cfg with a non-array value
    // would otherwise be spread into the font stack and throw during render, blanking the overlay.
    lyricsFontFallbackFamilies: Array.isArray(decoded?.lyricsFontFallbackFamilies) ? decoded.lyricsFontFallbackFamilies : undefined,
    subtitleFontInheritsLyrics: decoded?.subtitleFontInheritsLyrics,
    subtitleFontStyle: decoded?.subtitleFontStyle,
    subtitleFontWeight: decoded?.subtitleFontWeight,
    subtitleFontFamily: decoded?.subtitleFontFamily,
    subtitleFontFallbackFamilies: Array.isArray(decoded?.subtitleFontFallbackFamilies) ? decoded.subtitleFontFallbackFamilies : undefined,
    background,
  };
}
