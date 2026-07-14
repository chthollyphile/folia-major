import type { NowPlayingConnectionStatus, NowPlayingTrackSnapshot } from '../types';

// src/services/spotifyProvider.ts
// Adapts Electron's Spotify Web API bridge to the existing external-playback clock contract.

const SPOTIFY_POLL_INTERVAL_MS = 1000;
const SPOTIFY_ERROR_RETRY_MS = 5000;
export const SPOTIFY_PLAYBACK_REFRESH_EVENT = 'folia:spotify-playback-refresh';

export type SpotifyProgressUpdate = {
    progressMs: number;
    isReplay: boolean;
    quality: 'precise';
    rttMs: number;
};

type SpotifyProviderCallbacks = {
    onConnectionStatusChange?: (status: NowPlayingConnectionStatus) => void;
    onTrack?: (track: NowPlayingTrackSnapshot | null) => void;
    onPauseState?: (isPaused: boolean) => void;
    onProgress?: (update: SpotifyProgressUpdate) => void;
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

export const spotifyPlaybackToTrackSnapshot = (
    playback: ElectronSpotifyPlayback | null,
): NowPlayingTrackSnapshot | null => {
    if (!playback) {
        return null;
    }

    return {
        id: playback.id || playback.uri,
        title: playback.title || 'Spotify',
        artist: playback.artist || 'Spotify',
        album: playback.album || '',
        coverUrl: playback.coverUrl || null,
        durationMs: Math.max(0, playback.durationMs) || null,
        isVideo: playback.type === 'episode',
        isAdvertisement: false,
    };
};

export const createSpotifyProgressUpdate = (
    playback: ElectronSpotifyPlayback | null,
    previousProgressMs: number,
    rttMs: number,
): SpotifyProgressUpdate => {
    const progressMs = playback?.progressMs ?? 0;
    return {
        progressMs,
        isReplay: progressMs + 1500 < previousProgressMs,
        quality: 'precise',
        rttMs: Math.max(0, rttMs),
    };
};

export class SpotifyProvider {
    private readonly callbacks: SpotifyProviderCallbacks;
    private timer: number | null = null;
    private stopped = true;
    private track: NowPlayingTrackSnapshot | null = null;
    private lastProgressMs = 0;
    private lastPauseState: boolean | null = null;
    private connectionStatus: NowPlayingConnectionStatus | null = null;

    constructor(callbacks: SpotifyProviderCallbacks = {}) {
        this.callbacks = callbacks;
    }

    start() {
        this.stopped = false;
        window.addEventListener(SPOTIFY_PLAYBACK_REFRESH_EVENT, this.requestImmediatePoll);
        this.updateConnectionStatus('connecting');
        void this.poll();
    }

    stop({ reset = true }: { reset?: boolean } = {}) {
        this.stopped = true;
        window.removeEventListener(SPOTIFY_PLAYBACK_REFRESH_EVENT, this.requestImmediatePoll);
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
        if (reset) {
            this.track = null;
            this.lastProgressMs = 0;
            this.lastPauseState = null;
            this.callbacks.onTrack?.(null);
            this.callbacks.onPauseState?.(true);
            this.callbacks.onProgress?.({ progressMs: 0, isReplay: true, quality: 'precise', rttMs: 0 });
            this.updateConnectionStatus('disabled');
        }
    }

    private schedule(delayMs: number) {
        if (this.stopped) {
            return;
        }
        this.timer = window.setTimeout(() => {
            this.timer = null;
            void this.poll();
        }, Math.max(250, delayMs));
    }

    private requestImmediatePoll = () => {
        if (this.stopped || this.timer === null) {
            return;
        }
        window.clearTimeout(this.timer);
        this.timer = null;
        this.schedule(250);
    };

    // Polling is serialized so slow Spotify responses cannot pile up and disturb the lyric clock.
    private async poll() {
        if (this.stopped) {
            return;
        }

        if (!window.electron?.getSpotifyPlayback) {
            this.updateConnectionStatus('error');
            this.schedule(SPOTIFY_ERROR_RETRY_MS);
            return;
        }

        try {
            const requestStartedAt = performance.now();
            const response = await window.electron.getSpotifyPlayback();
            const rttMs = Math.max(0, performance.now() - requestStartedAt);
            if (this.stopped) {
                return;
            }
            if (response.error) {
                this.updateConnectionStatus('error');
                this.schedule(response.retryAfterMs || SPOTIFY_ERROR_RETRY_MS);
                return;
            }

            this.updateConnectionStatus('connected');
            const playback = response.playback;
            const nextTrack = spotifyPlaybackToTrackSnapshot(playback);
            if (!areTracksEqual(this.track, nextTrack)) {
                this.track = nextTrack;
                this.callbacks.onTrack?.(nextTrack);
            }

            const progressUpdate = createSpotifyProgressUpdate(playback, this.lastProgressMs, rttMs);
            this.lastProgressMs = progressUpdate.progressMs;
            const isPaused = !(playback?.isPlaying ?? false);
            if (isPaused !== this.lastPauseState) {
                this.lastPauseState = isPaused;
                this.callbacks.onPauseState?.(isPaused);
            }
            this.callbacks.onProgress?.(progressUpdate);
            this.schedule(SPOTIFY_POLL_INTERVAL_MS);
        } catch (error) {
            console.warn('[Spotify] Playback poll failed', error);
            this.updateConnectionStatus('error');
            this.schedule(SPOTIFY_ERROR_RETRY_MS);
        }
    }

    private updateConnectionStatus(status: NowPlayingConnectionStatus) {
        if (status === this.connectionStatus) {
            return;
        }
        this.connectionStatus = status;
        this.callbacks.onConnectionStatusChange?.(status);
    }
}
