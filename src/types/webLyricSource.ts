import type { LyricData } from '../types';

// src/types/webLyricSource.ts
// Source-neutral contract for web lyric sources: the unified state produced by any
// browser-reachable source (NowPlaying / PlayerCap), consumed by the OBS web overlay
// shell ObsWebSourceApp. The clock only stores an anchor; the current time is
// extrapolated by currentWebLyricTimeSec.

export type WebLyricPlaybackState = 'playing' | 'paused' | 'idle';

export type WebLyricConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disabled';

export interface WebLyricClock {
  positionSec: number; // real-time position at the anchor (seconds)
  durationSec: number;
  anchoredAtMs: number; // wall-clock the anchor corresponds to (Date.now())
  playing: boolean;
}

export interface WebLyricTrack {
  name: string;
  artist: string;
  coverUrl: string | null;
  seed?: string | number; // stable per-track seed (visual randomness base)
}

export interface WebLyricSourceState {
  connectionStatus: WebLyricConnectionStatus;
  playerState: WebLyricPlaybackState;
  track: WebLyricTrack | null;
  lyrics: LyricData | null;
  clock: WebLyricClock;
}

export interface WebLyricSource {
  state: WebLyricSourceState;
  // Current lyric time (seconds), extrapolated from the clock anchor; feeds
  // findLatestActiveLineIndex and per-word animation.
  getCurrentTimeSec: (nowMs: number) => number;
}

export function initialWebLyricSourceState(): WebLyricSourceState {
  return {
    connectionStatus: 'idle',
    playerState: 'idle',
    track: null,
    lyrics: null,
    clock: { positionSec: 0, durationSec: 0, anchoredAtMs: 0, playing: false },
  };
}
