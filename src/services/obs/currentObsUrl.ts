import type { DualTheme } from '../../types';
import { compressConfig, readSavedCustomTheme } from '../../utils/appearanceCodec';
import { buildVisualSettingsConfig } from './visualSettingsConfig';
import { buildObsSourceUrl } from '../../utils/obsUrl';
import { applyStoredAnimationIntensityToDualTheme, readStoredLastAppliedThemePointer } from '../themePreferences';
import { getLastDualTheme } from '../themeCache';
import { BASE_DUAL_THEME } from '../baseThemes';
import { usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useStageSettingsStore } from '../../stores/useStageSettingsStore';

// src/services/obs/currentObsUrl.ts
// Build the OBS static URL for a given web source from the current visual settings, producing the
// same cfg as the import/export "copy config".

// The theme that is effectively applied right now: the cached AI theme while an AI theme is active,
// the saved custom theme while a custom one is, and null on the built-in default preset (which has
// no saved object of its own). The AI theme lives only in IndexedDB (async) while the last-applied
// pointer is synchronous, so the pointer — not the cache — decides which source is active;
// getLastDualTheme() alone can return a theme left stale after a reset to default.
// Every branch may yield null; deciding what to do with that belongs to the caller.
export async function readEffectiveExportTheme(): Promise<DualTheme | null> {
  const pointer = readStoredLastAppliedThemePointer();
  if (pointer === 'ai') return (await getLastDualTheme()) ?? null;
  if (pointer === 'custom') return readSavedCustomTheme() ?? null;
  return null;
}

// host may carry a source's non-default endpoint (empty = page default); extra carries source-specific
// params (PlayerCap nxpcPlayer/nxpcBasis/nxpcSticky). Bakes a theme only for the 'static' OBS theme
// mode, the current light/dark preference, the transparent-background toggle, and the theme-mode
// marker (cfg carries only the theme sides, so daylight/transparent/obsTheme/extra ride as separate
// params, keeping cfg the terminal URL segment). The transparent param mirrors the toggle 1:1 — on →
// transparent=1, off → transparent=0 (background shown); the overlay reads an absent param the same
// as transparent=0, so the default matches the toggle 100%.
export async function buildCurrentObsUrl(obsSource: string, host = '', extra?: Record<string, string>): Promise<string> {
  const { webObsThemeMode } = useStageSettingsStore.getState();
  const { isDaylight } = useThemeSettingsStore.getState();
  const { transparentPlayerBackground } = usePlayerChromeSettingsStore.getState();
  // Dynamic modes ('builtin'/'ai') bake no theme, so the overlay resolves one per song (cover-derived
  // builtin, plus a regenerated AI theme under 'ai'). 'static' must always bake something: a
  // theme-less cfg is exactly what the overlay treats as "go dynamic", so a user on the default
  // preset would silently get per-song colors after asking for a frozen link.
  // The saved custom and cached AI themes already carry the stored animation intensity; the base
  // preset is a plain constant, so apply it here or a user on 'calm' would get 'normal' in OBS.
  const theme = webObsThemeMode === 'static'
    ? ((await readEffectiveExportTheme()) ?? applyStoredAnimationIntensityToDualTheme(BASE_DUAL_THEME))
    : null;
  const config = { theme, ...buildVisualSettingsConfig() };
  const mergedExtra: Record<string, string> = {};
  // The mode marker is authoritative: the overlay resolves its theme from this, not from whether cfg
  // happens to carry one. It rides ahead of cfg, so the mode of a link already pasted into OBS stays
  // readable at a glance. Editing it in place only demotes a static link to a dynamic one — the
  // reverse needs a fresh copy, since the overlay cannot invent a theme a dynamic link never carried.
  mergedExtra.obsTheme = webObsThemeMode;
  if (isDaylight) mergedExtra.daylight = '1';
  mergedExtra.transparent = transparentPlayerBackground ? '1' : '0';
  Object.assign(mergedExtra, extra); // source-specific params (PlayerCap nxpcPlayer/nxpcBasis/nxpcSticky)
  return buildObsSourceUrl(obsSource, compressConfig(config), host, mergedExtra);
}
