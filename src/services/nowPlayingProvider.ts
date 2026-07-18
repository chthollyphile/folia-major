import type { NowPlayingConnectionStatus, NowPlayingLyricPayload, NowPlayingTrackSnapshot } from '../types';

export const NOW_PLAYING_WS_URL = 'ws://localhost:9863/api/ws/lyric';
const NOW_PLAYING_RECONNECT_DELAY_MS = 2000;

// Build the now-playing lyric WS URL from a host (e.g. 'localhost:9863'); lets the OBS web page pick the endpoint via a URL param.
export const buildNowPlayingWsUrl = (host: string): string => `ws://${host}/api/ws/lyric`;

type NowPlayingTrackMessage = {
    author?: string;
    title?: string;
    album?: string;
    cover?: string;
    duration?: number;
    id?: string | number;
};

type NowPlayingPlayerStateMessage = {
    hasSong?: boolean;
    isPaused?: boolean;
    seekbarCurrentPosition?: number;
    statePercent?: number;
};

type NowPlayingLyricMessage = {
    source?: string;
    title?: string;
    author?: string;
    duration?: number;
    hasLyric?: boolean;
    hasTranslatedLyric?: boolean;
    hasKaraokeLyric?: boolean;
    lrc?: string;
    translatedLyric?: string;
    karaokeLyric?: string;
};

type NowPlayingWsEnvelope = {
    event?: string;
    data?: unknown;
};

export type NowPlayingProgressUpdate = {
    progressMs: number;
    isReplay: boolean;
    quality: 'precise' | 'coarse';
};

export type NowPlayingProviderSnapshot = {
    connectionStatus: NowPlayingConnectionStatus;
    track: NowPlayingTrackSnapshot | null;
    lyric: NowPlayingLyricPayload | null;
    isPaused: boolean;
    progressMs: number;
};

const areTracksEqual = (
    left: NowPlayingTrackSnapshot | null,
    right: NowPlayingTrackSnapshot | null,
) => (
    left?.id === right?.id
    && left?.title === right?.title
    && left?.artist === right?.artist
    && left?.album === right?.album
    && left?.coverUrl === right?.coverUrl
    && left?.durationMs === right?.durationMs
);

const areLyricsEqual = (
    left: NowPlayingLyricPayload | null,
    right: NowPlayingLyricPayload | null,
) => (
    left?.source === right?.source
    && left?.title === right?.title
    && left?.artist === right?.artist
    && left?.durationMs === right?.durationMs
    && left?.hasLyric === right?.hasLyric
    && left?.hasTranslatedLyric === right?.hasTranslatedLyric
    && left?.hasKaraokeLyric === right?.hasKaraokeLyric
    && left?.lrc === right?.lrc
    && left?.translatedLyric === right?.translatedLyric
    && left?.karaokeLyric === right?.karaokeLyric
);

const decodeXmlEntities = (value: string): string => {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&#10;|&#x0A;/gi, '\n')
        .replace(/&#13;|&#x0D;/gi, '\r');
};

const extractQrcLyricContent = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed.startsWith('<?xml') && !trimmed.includes('<Lyric_')) {
        return value;
    }

    const contentMatch = trimmed.match(/LyricContent="([\s\S]*?)"\s*\/?>/i);
    if (!contentMatch?.[1]) {
        return value;
    }

    return decodeXmlEntities(contentMatch[1]).replace(/\r\n/g, '\n');
};

type NowPlayingProviderCallbacks = {
    debug?: boolean;
    onConnectionStatusChange?: (status: NowPlayingConnectionStatus) => void;
    onTrack?: (track: NowPlayingTrackSnapshot | null) => void;
    onLyric?: (lyric: NowPlayingLyricPayload | null) => void;
    onPauseState?: (isPaused: boolean) => void;
    onProgress?: (update: NowPlayingProgressUpdate) => void;
};

const clampProgressMs = (value: unknown): number => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }

    return Math.max(0, Math.floor(numericValue));
};

const normalizeDurationMs = (value: unknown): number => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }

    const safeValue = Math.max(0, numericValue);

    // now-playing returns track/lyric duration in seconds (for example 170),
    // while progress fields arrive in milliseconds.
    if (safeValue > 0 && safeValue < 10_000) {
        return Math.floor(safeValue * 1000);
    }

    return Math.floor(safeValue);
};

const resolveSnapshotDurationMs = (snapshot: NowPlayingProviderSnapshot): number => {
    return snapshot.track?.durationMs || snapshot.lyric?.durationMs || 0;
};

const normalizePauseStateProgressMs = (
    value: unknown,
    snapshot: NowPlayingProviderSnapshot,
    statePercent?: unknown
): number => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    const numericPercent = typeof statePercent === 'number' ? statePercent : Number(statePercent);
    const durationMs = resolveSnapshotDurationMs(snapshot);

    if (!Number.isFinite(numericValue)) {
        if (Number.isFinite(numericPercent) && durationMs > 0) {
            return Math.max(0, Math.min(durationMs, Math.floor(durationMs * numericPercent)));
        }
        return 0;
    }

    const safeValue = Math.max(0, numericValue);

    if (durationMs > 0) {
        const durationSeconds = durationMs / 1000;
        if (safeValue <= durationSeconds + 1) {
            return Math.min(durationMs, Math.floor(safeValue * 1000));
        }
    }

    return Math.floor(safeValue);
};

export const normalizeNowPlayingTrack = (raw: unknown): NowPlayingTrackSnapshot | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const track = raw as NowPlayingTrackMessage;
    const title = typeof track.title === 'string' ? track.title.trim() : '';
    const artist = typeof track.author === 'string' ? track.author.trim() : '';
    const album = typeof track.album === 'string' ? track.album.trim() : '';
    const coverUrl = typeof track.cover === 'string' ? track.cover.trim() : '';
    const durationMs = normalizeDurationMs(track.duration);
    const idValue = track.id;
    const id = idValue === undefined || idValue === null ? null : String(idValue);

    if (!title && !artist && !album && !coverUrl && durationMs === 0 && !id) {
        return null;
    }

    return {
        id,
        title: title || 'Now Playing',
        artist: artist || 'Now Playing',
        album: album || '',
        coverUrl: coverUrl || null,
        durationMs: durationMs || null,
    };
};

export const normalizeNowPlayingLyricPayload = (raw: unknown): NowPlayingLyricPayload | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const lyric = raw as NowPlayingLyricMessage;
    const lrc = typeof lyric.lrc === 'string' ? lyric.lrc : '';
    const translatedLyric = typeof lyric.translatedLyric === 'string' ? lyric.translatedLyric : '';
    const karaokeLyric = typeof lyric.karaokeLyric === 'string'
        ? extractQrcLyricContent(lyric.karaokeLyric)
        : '';
    const hasUsableLyric = Boolean(lrc.trim() || translatedLyric.trim() || karaokeLyric.trim());

    if (!hasUsableLyric && !lyric.hasLyric && !lyric.hasKaraokeLyric) {
        return null;
    }

    return {
        source: typeof lyric.source === 'string' ? lyric.source.trim().toLowerCase() : null,
        title: typeof lyric.title === 'string' ? lyric.title.trim() : '',
        artist: typeof lyric.author === 'string' ? lyric.author.trim() : '',
        durationMs: normalizeDurationMs(lyric.duration) || null,
        hasLyric: Boolean(lyric.hasLyric || lrc.trim()),
        hasTranslatedLyric: Boolean(lyric.hasTranslatedLyric || translatedLyric.trim()),
        hasKaraokeLyric: Boolean(lyric.hasKaraokeLyric || karaokeLyric.trim()),
        lrc: lrc || null,
        translatedLyric: translatedLyric || null,
        karaokeLyric: karaokeLyric || null,
    };
};

export class NowPlayingProvider {
    private readonly callbacks: NowPlayingProviderCallbacks;
    private readonly debug: boolean;
    private readonly wsUrl: string;
    private socket: WebSocket | null = null;
    private reconnectTimer: number | null = null;
    private stopped = true;
    private lastPreciseProgressMs = 0;
    private lastPreciseProgressAtMs = 0;
    private snapshot: NowPlayingProviderSnapshot = {
        connectionStatus: 'disabled',
        track: null,
        lyric: null,
        isPaused: true,
        progressMs: 0,
    };

    constructor(callbacks: NowPlayingProviderCallbacks = {}, options: { wsUrl?: string } = {}) {
        this.callbacks = callbacks;
        this.debug = callbacks.debug === true;
        this.wsUrl = options.wsUrl ?? NOW_PLAYING_WS_URL;
    }

    getSnapshot(): NowPlayingProviderSnapshot {
        return this.snapshot;
    }

    start() {
        this.stopped = false;
        this.clearReconnectTimer();
        this.openSocket();
    }

    stop({ reset = true }: { reset?: boolean } = {}) {
        this.stopped = true;
        this.clearReconnectTimer();

        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            this.socket.close();
            this.socket = null;
        }

        if (reset) {
            this.snapshot = {
                connectionStatus: 'disabled',
                track: null,
                lyric: null,
                isPaused: true,
                progressMs: 0,
            };
            this.lastPreciseProgressMs = 0;
            this.lastPreciseProgressAtMs = 0;
            this.callbacks.onTrack?.(null);
            this.callbacks.onLyric?.(null);
            this.callbacks.onPauseState?.(true);
            this.callbacks.onProgress?.({ progressMs: 0, isReplay: true, quality: 'precise' });
            this.callbacks.onConnectionStatusChange?.('disabled');
        }
    }

    private openSocket() {
        if (this.stopped || this.socket) {
            return;
        }

        this.updateConnectionStatus('connecting');
        const socket = new WebSocket(this.wsUrl);
        this.socket = socket;

        socket.onopen = () => {
            this.updateConnectionStatus('connected');
        };

        socket.onmessage = (event) => {
            this.handleMessage(event.data);
        };

        socket.onerror = () => {
            this.updateConnectionStatus('error');
        };

        socket.onclose = () => {
            this.socket = null;
            if (this.stopped) {
                return;
            }

            this.updateConnectionStatus('error');
            this.scheduleReconnect();
        };
    }

    private handleMessage(rawData: unknown) {
        if (typeof rawData !== 'string') {
            if (this.debug) {
                console.log('[NowPlaying][ws] Received non-string payload:', rawData);
            }
            return;
        }

        let payload: NowPlayingWsEnvelope;
        try {
            payload = JSON.parse(rawData) as NowPlayingWsEnvelope;
        } catch (error) {
            console.warn('[NowPlaying] Failed to parse websocket payload', error);
            if (this.debug) {
                console.log('[NowPlaying][ws] Raw payload text:', rawData);
            }
            return;
        }

        if (this.debug) {
            console.log('[NowPlaying][ws] Incoming event:', payload.event, payload.data);
        }

        switch (payload.event) {
            case 'Track': {
                const track = normalizeNowPlayingTrack(payload.data);
                if (this.debug) {
                    console.log('[NowPlaying][ws] Normalized track:', track);
                }
                if (areTracksEqual(this.snapshot.track, track)) {
                    break;
                }
                this.snapshot = {
                    ...this.snapshot,
                    track,
                };
                if (track) {
                    this.callbacks.onTrack?.(track);
                }
                break;
            }
            case 'Lyric': {
                const lyric = normalizeNowPlayingLyricPayload(payload.data);
                if (this.debug) {
                    console.log('[NowPlaying][ws] Normalized lyric payload:', lyric);
                }
                if (areLyricsEqual(this.snapshot.lyric, lyric)) {
                    break;
                }
                this.snapshot = {
                    ...this.snapshot,
                    lyric,
                };
                this.callbacks.onLyric?.(lyric);
                break;
            }
            case 'PlayerPauseState': {
                const playerState = (payload.data && typeof payload.data === 'object')
                    ? payload.data as NowPlayingPlayerStateMessage
                    : null;
                const isPaused = Boolean(playerState?.isPaused);
                const coarseProgressMs = normalizePauseStateProgressMs(
                    playerState?.seekbarCurrentPosition,
                    this.snapshot,
                    playerState?.statePercent,
                );
                const hasRecentPreciseProgress = Date.now() - this.lastPreciseProgressAtMs <= 5_000;
                const progressMs = hasRecentPreciseProgress
                    ? this.lastPreciseProgressMs
                    : coarseProgressMs;
                if (this.debug) {
                    console.log('[NowPlaying][ws] Pause state update:', {
                        raw: playerState,
                        isPaused,
                        coarseProgressMs,
                        usedRecentPreciseProgress: hasRecentPreciseProgress,
                        progressMs,
                    });
                }
                this.snapshot = {
                    ...this.snapshot,
                    isPaused,
                    progressMs,
                };
                this.callbacks.onPauseState?.(isPaused);
                this.callbacks.onProgress?.({
                    progressMs,
                    isReplay: false,
                    quality: hasRecentPreciseProgress ? 'precise' : 'coarse',
                });
                break;
            }
            case 'PlayerProgress': {
                const data = payload.data as { progress?: number } | undefined;
                const progressMs = clampProgressMs(data?.progress);
                this.lastPreciseProgressMs = progressMs;
                this.lastPreciseProgressAtMs = Date.now();
                if (this.debug) {
                    console.log('[NowPlaying][ws] Progress update:', {
                        raw: data,
                        progressMs,
                    });
                }
                this.snapshot = {
                    ...this.snapshot,
                    progressMs,
                };
                this.callbacks.onProgress?.({ progressMs, isReplay: false, quality: 'precise' });
                break;
            }
            case 'PlayerProgressReplay': {
                if (this.debug) {
                    console.log('[NowPlaying][ws] Replay progress reset');
                }
                this.lastPreciseProgressMs = 0;
                this.lastPreciseProgressAtMs = Date.now();
                this.snapshot = {
                    ...this.snapshot,
                    progressMs: 0,
                };
                this.callbacks.onProgress?.({ progressMs: 0, isReplay: true, quality: 'precise' });
                break;
            }
            default:
                if (this.debug) {
                    console.log('[NowPlaying][ws] Unhandled event:', payload.event, payload.data);
                }
                break;
        }
    }

    private scheduleReconnect() {
        this.clearReconnectTimer();
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.openSocket();
        }, NOW_PLAYING_RECONNECT_DELAY_MS);
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private updateConnectionStatus(status: NowPlayingConnectionStatus) {
        if (this.debug) {
            console.log('[NowPlaying][ws] Connection status:', status);
        }
        this.snapshot = {
            ...this.snapshot,
            connectionStatus: status,
        };
        this.callbacks.onConnectionStatusChange?.(status);
    }
}
