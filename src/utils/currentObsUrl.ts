import type { DualTheme } from '../types';
import { compressConfig, readSavedCustomTheme } from '../components/modal/settings/AppearanceSettingsSubview';
import { buildVisualSettingsConfig } from './visualSettingsConfig';
import { buildObsSourceUrl } from './obsUrl';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { readStoredLastAppliedThemePointer } from '../services/themePreferences';
import { getLastDualTheme } from '../services/themeCache';

// src/utils/currentObsUrl.ts
// Build the OBS static URL for a given web source from the current visual settings, producing the
// same cfg as the import/export "copy config".

// The effective exported theme, matching the import/export "copy config" default: the active AI
// theme when an AI theme is applied, otherwise the saved custom theme (same as the prior behavior
// for the non-AI cases). The AI theme object lives only in IndexedDB (async); the last-applied
// pointer (sync) is the authoritative "AI is active" signal — getLastDualTheme() alone can return a
// theme left stale after a reset to default, so the AI read must be gated on the pointer.
export async function readEffectiveExportTheme(): Promise<DualTheme | null> {
  if (readStoredLastAppliedThemePointer() === 'ai') return (await getLastDualTheme()) ?? null;
  return readSavedCustomTheme() ?? null;
}

// host may carry a source's non-default endpoint (empty = page default); extra carries
// source-specific params (PlayerCap nxpcPlayer/nxpcBasis/nxpcSticky). Bakes the effective theme, the current
// light/dark preference, and the transparent-background toggle (cfg carries only the theme sides,
// so daylight/transparent/extra ride as separate params, keeping cfg the terminal URL segment). The
// transparent param mirrors the toggle 1:1 — on → transparent=1, off → transparent=0 (background
// shown); the overlay reads an absent param the same as transparent=0, so the default matches the
// toggle 100%.
export async function buildCurrentObsUrl(obsSource: string, host = '', extra?: Record<string, string>): Promise<string> {
  const config = { theme: await readEffectiveExportTheme(), ...buildVisualSettingsConfig() };
  const { isDaylight, transparentPlayerBackground } = useSettingsUiStore.getState();
  const mergedExtra: Record<string, string> = {};
  if (isDaylight) mergedExtra.daylight = '1';
  mergedExtra.transparent = transparentPlayerBackground ? '1' : '0';
  Object.assign(mergedExtra, extra); // source-specific params (PlayerCap nxpcPlayer/nxpcBasis/nxpcSticky)
  return buildObsSourceUrl(obsSource, compressConfig(config), host, mergedExtra);
}
