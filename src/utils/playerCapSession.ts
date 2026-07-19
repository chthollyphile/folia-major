import type { LyricData } from '../types';
import type {
  PlayerCapAllLyricsData,
  PlayerCapConnectionStatus,
  PlayerCapEvent,
  PlayerCapLyricUpdateData,
  PlayerCapPlayerSwitchData,
  PlayerCapSongInfoData,
  PlayerCapStatusData,
} from '../types/playerCap';
import {
  mapAllLyricsToLyricData,
  mapSongInfoToTrack,
  mapStatusToPlaybackState,
} from './playerCapMapping';
import type { PlayerCapPlaybackState, PlayerCapTimeBasis, PlayerCapTrack } from './playerCapMapping';

// Pure reduction of the PlayerCap event stream → session state (no I/O, no side effects; unit-testable via real-capture / inline event replay).
// The clock stores only an anchor (position = progress×duration; source-gate confirms progress = playPos/duration is the real-time playback position, independent of timestamp/play_time).
// The current time is extrapolated by currentPosition and shared by both bases: under play_time the line times already include offset (shown early), under timestamp they are the raw on-beat times; consumers need not compute offset.
// connectionStatus is set on the provider side and does not pass through this reduction.

export interface PlayerCapClock {
  positionSec: number; // real-time position at the anchor = progress × duration
  durationSec: number;
  anchoredAtMs: number; // wall-clock time of the anchor (injected externally, for testability)
  playing: boolean;
}

export interface PlayerCapSessionState {
  activePlayer: string | null;
  connectionStatus: PlayerCapConnectionStatus;
  playerState: PlayerCapPlaybackState;
  track: PlayerCapTrack | null;
  lyrics: LyricData | null;
  clock: PlayerCapClock;
}

export interface ReduceOptions {
  timeBasis: PlayerCapTimeBasis;
  nowMs: number;
  // Sticky lyrics: ignore the three clear events player_clear / player_switch(to='') / lyric_idle (pause/idle/window-close does not wipe lyrics),
  // and only honor player_switch(to='X') as a true source change. Defaults to false to preserve the original behavior.
  sticky?: boolean;
}

export function initialPlayerCapSession(): PlayerCapSessionState {
  return {
    activePlayer: null,
    connectionStatus: 'idle',
    playerState: 'idle',
    track: null,
    lyrics: null,
    clock: { positionSec: 0, durationSec: 0, anchoredAtMs: 0, playing: false },
  };
}

// Extrapolate the current real-time position (seconds) from the anchor: advances by wall clock while playing, frozen while paused; clamped to [0, duration] when a duration is known.
export function currentPosition(clock: PlayerCapClock, nowMs: number): number {
  const elapsed = clock.playing ? Math.max(0, (nowMs - clock.anchoredAtMs) / 1000) : 0;
  const pos = clock.positionSec + elapsed;
  if (clock.durationSec > 0) return Math.max(0, Math.min(clock.durationSec, pos));
  return Math.max(0, pos);
}

const clearContent = (state: PlayerCapSessionState): PlayerCapSessionState => ({
  ...state,
  track: null,
  lyrics: null,
  playerState: 'idle',
  clock: { ...state.clock, positionSec: 0, playing: false },
});

// A single PlayerCap event → new session state. event is the live WS message { type, player, data }
// (real-capture streams additionally wrap it with { ms, kind }; when replaying, feed line.data).
export function reducePlayerCapEvent(
  state: PlayerCapSessionState,
  event: PlayerCapEvent,
  { timeBasis, nowMs, sticky }: ReduceOptions,
): PlayerCapSessionState {
  switch (event.type) {
    case 'player_clear':
      // When sticky, ignore the "no active player" clear and keep the last lyrics.
      return sticky ? state : { ...clearContent(state), activePlayer: null };

    case 'player_switch': {
      // A source change clears leftover lyrics to avoid bleed-through; an empty to means clear the screen (when sticky, an empty to is not cleared either). A true source change (non-empty to) always executes.
      const to = (event.data as PlayerCapPlayerSwitchData)?.to || '';
      if (!to) return sticky ? state : { ...clearContent(state), activePlayer: null };
      return { ...clearContent(state), activePlayer: to };
    }

    case 'status_update': {
      const playerState = mapStatusToPlaybackState((event.data as PlayerCapStatusData)?.status ?? '');
      return {
        ...state,
        playerState,
        clock: { ...state.clock, positionSec: currentPosition(state.clock, nowMs), anchoredAtMs: nowMs, playing: playerState === 'playing' },
      };
    }

    case 'song_info_update':
      // Two-stage cover: the first event has an empty base64 and uses the cover URL; a subsequent same-song event carrying base64 replaces it with an inline image (handled inside mapSongInfoToTrack).
      return { ...state, track: mapSongInfoToTrack(event.data as PlayerCapSongInfoData) };

    case 'all_lyrics': {
      const data = event.data as PlayerCapAllLyricsData;
      const durationSec = data.duration || state.clock.durationSec;
      return {
        ...state,
        lyrics: mapAllLyricsToLyricData(data, timeBasis),
        clock: { positionSec: (data.progress || 0) * durationSec, durationSec, anchoredAtMs: nowMs, playing: state.playerState === 'playing' },
      };
    }

    case 'lyric_update': {
      // Mainly used to refresh the clock anchor (progress); the current line is derived from clock advance, so index is not consumed directly.
      const data = event.data as PlayerCapLyricUpdateData;
      return { ...state, clock: { ...state.clock, positionSec: (data.progress || 0) * state.clock.durationSec, anchoredAtMs: nowMs } };
    }

    case 'playback_pause':
      return { ...state, playerState: 'paused', clock: { ...state.clock, positionSec: currentPosition(state.clock, nowMs), anchoredAtMs: nowMs, playing: false } };

    case 'playback_resume':
      // resume only provides play_time (the display basis) and does not recompute the clock position; set to playing and wait for the next progress event to re-anchor.
      return { ...state, playerState: 'playing', clock: { ...state.clock, anchoredAtMs: nowMs, playing: true } };

    case 'lyric_idle':
      // Notification that the current lyric session has ended (song finished / track switch / window closed; emitted only by wesing): clear lyrics only to avoid leftovers; playback state / track are driven by status_update.
      // Semantically weaker than player_clear (which means there is no active player at all) — so activePlayer/track are left untouched; the two are deliberately different.
      // Ignored under sticky as well (song end / window close does not wipe lyrics; the next all_lyrics replaces them naturally).
      return sticky ? state : { ...state, lyrics: null };

    default:
      return state;
  }
}
