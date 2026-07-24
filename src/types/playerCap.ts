// PlayerCap (Metabox-Nexus-PlayerCap) external WS/SSE contract types.
// Strict black box: based solely on doc/openapi.yaml and observed data; makes no assumptions about its internal implementation.
// Default port 8765; frame envelope is { ms, kind, data: { type, player, data } } — the inner data is the actual event.

export type PlayerCapEventType =
  | 'status_update'
  | 'song_info_update'
  | 'lyric_update'
  | 'all_lyrics'
  | 'lyric_idle'
  | 'playback_pause'
  | 'playback_resume'
  | 'player_switch'
  | 'player_clear';

// Event envelope: each live WS/SSE message is exactly { type, player, data }. Dispatch by type; player identifies the source
// (system events use "" or "internal"); read the payload from data — when there is no data, data is {}.
export interface PlayerCapEvent<T = unknown> {
  type: PlayerCapEventType | string;
  player: string;
  data: T;
}

export interface PlayerCapStatusData {
  status: string; // playing | paused | standby | offline | error | waiting_process | ...
  detail: string; // usually "song - artist"; also carries text such as exit/unsupported messages
}

export interface PlayerCapSongInfoData {
  name: string;
  singer: string;
  title: string; // concatenation order varies by player; for song/artist read name/singer directly, do not parse title
  cover: string; // cover URL, may be ""
  cover_base64: string; // two-stage: first message is "", then a follow-up carries the base64; on fetch failure there is no second message
}

export interface PlayerCapWord {
  timestamp: number; // raw start time (seconds)
  play_time: number; // display time after applying offset (seconds)
  duration: number; // duration (seconds)
  text: string; // includes trailing space (English is per-word) or a single CJK character; join('') in order reconstructs the full line
}

export interface PlayerCapTextDetailed {
  timestamp: number;
  play_time: number;
  duration: number;
  words: PlayerCapWord[];
}

// When there is no per-word data, text_detailed is the empty object {}.
export type PlayerCapMaybeDetailed = PlayerCapTextDetailed | Record<string, never>;

export interface PlayerCapLyricLine {
  index: number;
  timestamp: number; // raw start time (seconds; offset-independent, the real timeline)
  play_time: number; // display time after applying offset (seconds)
  text: string;
  sub_text: string; // translated text, may be empty (not all sources provide translations)
  text_detailed: PlayerCapMaybeDetailed;
}

export interface PlayerCapAllLyricsData {
  title: string;
  duration: number; // full track duration (seconds)
  position: number; // real-time playback position (seconds) = progress × duration, offset-independent. Named play_time before PlayerCap rc.7.
  progress: number; // full-track progress 0-1 = real-time position / total duration (offset-independent)
  count: number; // number of lyric lines; 0 for instrumental
  lyrics: PlayerCapLyricLine[];
  lyrics_detailed: Array<{ lyric_index: number } & PlayerCapTextDetailed>;
}

export interface PlayerCapLyricUpdateData {
  index: number; // -1 = platform returned no lyrics (instrumental); always use index to test for lyrics, not text
  text: string;
  sub_text: string;
  timestamp: number;
  play_time: number; // on-screen time of THIS line (timestamp − offset; 0 when index=-1). A lyric-timeline point, NOT the playback position — use position for that.
  position: number; // real-time playback position (seconds) = progress × duration, offset-independent.
  progress: number; // still reflects full-track progress when index=-1, not 0
  text_detailed: PlayerCapMaybeDetailed;
}

// Payload for playback_pause / playback_resume: the real-time playback position, plus progress.
//
// resume doubles as the seek notification (it fires on any discontinuous jump, so it outnumbers
// pause), and the jumped-to position is carried here and nowhere else — honor it or the previous
// line stays on screen until the next lyric_update.
export interface PlayerCapPlaybackData {
  position: number;
  progress: number;
}

export interface PlayerCapPlayerSwitchData {
  from: string;
  to: string; // "" means clear (paired with player_clear)
}

// GET /service-status (excerpt: fields needed for integration). The runtime source of truth for the full endpoint/player table.
export interface PlayerCapServiceStatusData {
  version?: string;
  config?: PlayerCapConfig;
  config_overwritten?: string[];
  player_support?: string[]; // full set registered at compile time; used to populate the player dropdown
  player_running?: string[]; // those currently not offline/standby/waiting_process
  player_status?: Record<string, string>;
  endpoints?: Record<string, string>;
  client_count?: number;
  ws_connected?: { connected?: boolean; clients?: number };
}

// Runtime config. offset is the global default (milliseconds); <player>-offset is a per-player override (milliseconds).
export interface PlayerCapConfig {
  addr?: string;
  offset?: number;
  poll?: number;
  [key: string]: unknown; // per-player dynamic keys such as <player>-offset / <player>-poll
}

// Connection status (for consumer-side UI).
export type PlayerCapConnectionStatus = 'idle' | 'probing' | 'connecting' | 'connected' | 'disconnected' | 'unreachable';
