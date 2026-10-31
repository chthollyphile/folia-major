// src/utils/mediaSessionSync.ts

export type MediaSessionTrackMetadata = {
    title: string;
    artist: string;
    album: string;
    artworkUrl: string;
};

type MediaSessionMetadataFactory = (init: MediaMetadataInit) => MediaMetadata;

// Use a recognizable title while no matching track timeline is available.
export const publishMediaSessionPlaceholder = (
    mediaSession: MediaSession,
    createMetadata: MediaSessionMetadataFactory = init => new MediaMetadata(init)
) => {
    mediaSession.setPositionState();
    mediaSession.metadata = createMetadata({ title: 'Folia' });
};

const MEDIA_SESSION_ARTWORK_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'blob:']);

const normalizeSourceUrl = (source: string, baseUrl?: string) => {
    try {
        return new URL(source, baseUrl).href;
    } catch {
        return source;
    }
};

export const getSupportedMediaSessionArtworkUrl = (source: string, baseUrl?: string): string => {
    const trimmedSource = source.trim();
    if (!trimmedSource) return '';

    try {
        const url = baseUrl ? new URL(trimmedSource, baseUrl) : new URL(trimmedSource);
        return MEDIA_SESSION_ARTWORK_PROTOCOLS.has(url.protocol)
            ? (baseUrl ? url.href : trimmedSource)
            : '';
    } catch {
        // Relative URLs are valid MediaImage sources; callers can provide baseUrl for strict resolution.
        return baseUrl ? '' : trimmedSource;
    }
};

// Rejects late events from the previous source and sources whose timeline is not usable yet.
export const isMediaSessionSourceReady = (
    audio: Pick<HTMLAudioElement, 'currentSrc' | 'readyState' | 'duration'>,
    expectedSource: string,
    baseUrl?: string
) => {
    if (audio.readyState < 1 || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        return false;
    }

    if (!audio.currentSrc) {
        return false;
    }

    return normalizeSourceUrl(audio.currentSrc, baseUrl) === normalizeSourceUrl(expectedSource, baseUrl);
};

export const createMediaSessionPositionState = (
    audio: Pick<HTMLAudioElement, 'currentTime' | 'duration' | 'playbackRate'>
): MediaPositionState | null => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        return null;
    }

    const position = Number.isFinite(audio.currentTime)
        ? Math.min(Math.max(audio.currentTime, 0), audio.duration)
        : 0;
    const playbackRate = Number.isFinite(audio.playbackRate) && audio.playbackRate > 0
        ? audio.playbackRate
        : 1;

    return {
        duration: audio.duration,
        playbackRate,
        position,
    };
};

// Position must be valid before metadata is replaced; Chromium otherwise clears the platform session.
export const publishMediaSessionTrack = (
    mediaSession: MediaSession,
    audio: Pick<HTMLAudioElement, 'currentTime' | 'duration' | 'playbackRate'>,
    track: MediaSessionTrackMetadata,
    createMetadata: MediaSessionMetadataFactory = init => new MediaMetadata(init)
) => {
    const positionState = createMediaSessionPositionState(audio);
    if (!positionState) {
        return false;
    }

    mediaSession.setPositionState(positionState);
    const artworkUrl = getSupportedMediaSessionArtworkUrl(track.artworkUrl);
    mediaSession.metadata = createMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: artworkUrl ? [{ src: artworkUrl }] : [],
    });
    return true;
};
