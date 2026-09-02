import { useStageSettingsStore } from '../../stores/useStageSettingsStore';

// src/services/obs/webObsTarget.ts
// Resolve which browser-direct OBS source the web stage selection targets, plus its connection
// params, for the copy-OBS-URL buttons. Kept separate from currentObsUrl/obsUrl so appearance
// components can import the selector without a cycle through the appearance codec.

export type WebObsSource = 'now-playing' | 'playercap';

// Stable module-scope selector so it can drive both a store subscription and URL building
// (null = no web stage source is on).
export function selectWebObsSource(
  s: { enableNowPlayingStage: boolean; enablePlayerCapStage: boolean },
): WebObsSource | null {
  return s.enablePlayerCapStage ? 'playercap' : s.enableNowPlayingStage ? 'now-playing' : null;
}

export interface WebObsTarget {
  source: WebObsSource;
  host: string;
  extra: Record<string, string>;
}

// The active source plus, for PlayerCap, its non-default connection params. Returns null when no
// web stage source is selected (buttons are disabled in that case).
export function resolveWebObsTarget(): WebObsTarget | null {
  const sStageSettings = useStageSettingsStore.getState();
  const source = selectWebObsSource(sStageSettings);
  if (!source) return null;
  if (source === 'now-playing') return { source, host: '', extra: {} };
  // PlayerCap: omit params equal to the OBS page defaults (host localhost:8765, player '',
  // basis play_time, sticky on) so default setups produce a clean URL.
  const host = sStageSettings.playerCapHost && sStageSettings.playerCapHost !== 'localhost:8765' ? sStageSettings.playerCapHost : '';
  const extra: Record<string, string> = {};
  if (sStageSettings.playerCapPlayer) extra.nxpcPlayer = sStageSettings.playerCapPlayer;
  if (sStageSettings.playerCapTimeBasis === 'timestamp') extra.nxpcBasis = 'timestamp';
  if (sStageSettings.playerCapSticky === false) extra.nxpcSticky = '0';
  return { source, host, extra };
}
