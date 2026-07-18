import type { WebLyricClock } from '../types/webLyricSource';

// src/utils/webLyricSource.ts
// Extrapolate the current real-time position (seconds) from the clock anchor:
// advance by wall-clock while playing, freeze while paused; clamp to [0, duration]
// when the duration is known. A source-neutral copy of playerCapSession.currentPosition
// so each source implementation stays independent.

export function currentWebLyricTimeSec(clock: WebLyricClock, nowMs: number): number {
  const elapsed = clock.playing ? Math.max(0, (nowMs - clock.anchoredAtMs) / 1000) : 0;
  const pos = clock.positionSec + elapsed;
  if (clock.durationSec > 0) return Math.max(0, Math.min(clock.durationSec, pos));
  return Math.max(0, pos);
}
