// src/types/nowPlayingSender.ts
// Renderer-facing contract for the outbound "Now Playing 发送" endpoint (mode 1).
// The wire format deliberately mirrors the now-playing-service consumer protocol
// (src/services/nowPlayingProvider.ts): `{ event, data }` over WS plus read-only
// GET query endpoints, so an existing now-playing-style client can read Folia.

export interface NowPlayingSenderStatus {
    enabled: boolean;
    running: boolean;
    port: number;
    /** HTTP query base, e.g. http://127.0.0.1:9863/api/query */
    url: string | null;
    /** WebSocket lyric/track stream, e.g. ws://127.0.0.1:9863/api/ws/lyric */
    wsUrl: string | null;
    clientCount: number;
    /**
     * Seconds between two progress heartbeats, one decimal. `0` disables the timer: playback
     * events (play/pause, track change, seek) still publish a progress anchor.
     */
    progressIntervalSec: number;
    error: string | null;
}

export interface NowPlayingSenderPlayback {
    progressMs: number;
    isPaused: boolean;
    /** 0-100. A muted player reports 0, which is what the listener actually hears. */
    volumePercent: number;
    /** Documented values are NONE / ONE / ALL. */
    repeatType: 'NONE' | 'ONE' | 'ALL';
    /** Forces a PlayerProgressReplay event before the regular progress events. */
    isReplay?: boolean;
}

/** Bounds shared with the main process; the settings slider is built from these. */
export const NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC = 0;
export const NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC = 10;
export const NOW_PLAYING_SENDER_PROGRESS_INTERVAL_DEFAULT_SEC = 0.5;
