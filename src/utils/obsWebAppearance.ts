import type { Theme, VisualizerMode } from '../types';
import type { VisualizerTuningBundle } from '../components/visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';
import { DEFAULT_VISUALIZER_MODE, hasVisualizerMode } from '../components/visualizer/registry';
import { decompressConfig } from '../components/modal/settings/AppearanceSettingsSubview';

// src/utils/obsWebAppearance.ts
// Parse the OBS URL params (including the appearance cfg shortcode) into the appearance
// props consumed by ObsWebSourceApp. cfg reuses the app's compressConfig/decompressConfig
// (the appearance source of truth); with no cfg it falls back to renderer defaults + a
// cover-color theme. Note decompressConfig emits store field names, so this maps them to
// VisualizerRenderer prop names (e.g. visualizerMode -> mode).

export interface ObsWebParams {
  host: string;
  cfg: string | null;
  isDaylight: boolean;
  transparent: boolean;
  visualizer: string; // single-mode override (empty = use the cfg's mode)
}

export interface ObsWebAppearance {
  mode: VisualizerMode;
  isDaylight: boolean;
  transparent: boolean;
  theme: Theme | null; // cfg theme (side picked by daylight); null -> shell uses cover colors
  visualizerTunings?: VisualizerTuningBundle;
  visualizerOpacity?: number;
  lyricsFontScale?: number;
  hideTranslationSubtitle?: boolean;
  showSubtitleTranslation?: boolean;
  subtitleOverlayBackground?: boolean;
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
    // OBS overlay defaults to transparent; only transparent=0 uses the opaque theme background.
    transparent: params.get('transparent') !== '0',
    visualizer: params.get('visualizer')?.trim() || '',
  };
}

interface BuildAppearanceOptions {
  isDaylight: boolean;
  transparent: boolean;
  visualizerOverride?: string;
}

export function buildObsAppearanceFromShortcode(
  cfg: string | null,
  { isDaylight, transparent, visualizerOverride }: BuildAppearanceOptions,
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
  const mode: VisualizerMode = visualizerOverride && hasVisualizerMode(visualizerOverride)
    ? visualizerOverride
    : (decoded?.visualizerMode && hasVisualizerMode(decoded.visualizerMode) ? decoded.visualizerMode : DEFAULT_VISUALIZER_MODE);

  const theme: Theme | null = decoded?.theme
    ? (isDaylight ? decoded.theme.light : decoded.theme.dark)
    : null;

  // Guard urlBackgroundList: an untrusted cfg may carry a non-array value, and the URL
  // background layer calls .find() on it — a non-array would throw during render and blank
  // the whole overlay (mirrors the Array.isArray guard on the app's own import path).
  const urlBackgroundItems = Array.isArray(decoded?.urlBackgroundList) ? decoded.urlBackgroundList : undefined;
  const background: VisualizerBackgroundConfig = {
    mode: decoded?.visualizerBackgroundMode ?? undefined,
    transparent,
    common: { opacity: decoded?.backgroundOpacity },
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
    hideTranslationSubtitle: decoded?.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: decoded?.showSubtitleTranslation,
    subtitleOverlayBackground: decoded?.subtitleOverlayBackground,
    background,
  };
}
