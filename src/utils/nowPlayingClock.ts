import type { NowPlayingLyricPayload, NowPlayingTrackSnapshot } from '../types';

// src/utils/nowPlayingClock.ts

export const NOW_PLAYING_PROGRESS_QUERY_URL = 'http://localhost:9863/api/query/progress';
export const NOW_PLAYING_PROGRESS_POLL_INTERVAL_MS = 7000;
export const NOW_PLAYING_PROGRESS_CORRECTION_THRESHOLD_SEC = 0.2;

type ResolveNowPlayingAnchorTimeParams = {
    progressMs: number;
    rttMs?: number;
    paused: boolean;
    durationSec?: number;
};

export const clampNowPlayingTimeSec = (timeSec: number, durationSec = 0): number => {
    const safeTime = Math.max(0, timeSec);
    if (durationSec <= 0) {
        return safeTime;
    }

    return Math.min(safeTime, durationSec);
};

// Applies a lightweight RTT compensation for precise progress reads while playback is moving.
export const resolveNowPlayingAnchorTime = ({
    progressMs,
    rttMs = 0,
    paused,
    durationSec = 0,
}: ResolveNowPlayingAnchorTimeParams): number => {
    const safeProgressMs = Math.max(0, progressMs);
    const safeRttMs = Math.max(0, rttMs);
    const correctedMs = paused ? safeProgressMs : safeProgressMs + (safeRttMs / 2);
    return clampNowPlayingTimeSec(correctedMs / 1000, durationSec);
};

export const shouldApplyNowPlayingProgressCorrection = (
    displayTimeSec: number,
    candidateTimeSec: number,
    thresholdSec = NOW_PLAYING_PROGRESS_CORRECTION_THRESHOLD_SEC
): boolean => {
    return Math.abs(candidateTimeSec - displayTimeSec) > thresholdSec;
};

export const parseNowPlayingProgressResponseMs = (value: unknown): number | null => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    return Math.max(0, Math.floor(numericValue));
};

export const buildNowPlayingContentLoadKey = (
    track: NowPlayingTrackSnapshot | null,
    lyricPayload: NowPlayingLyricPayload | null
): string | null => {
    if (!track && !lyricPayload) {
        return null;
    }

    return JSON.stringify({
        track: track ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            coverUrl: track.coverUrl,
            durationMs: track.durationMs,
        } : null,
        lyric: lyricPayload ? {
            source: lyricPayload.source,
            title: lyricPayload.title,
            artist: lyricPayload.artist,
            durationMs: lyricPayload.durationMs,
            hasLyric: lyricPayload.hasLyric,
            hasTranslatedLyric: lyricPayload.hasTranslatedLyric,
            hasKaraokeLyric: lyricPayload.hasKaraokeLyric,
            lrc: lyricPayload.lrc,
            translatedLyric: lyricPayload.translatedLyric,
            karaokeLyric: lyricPayload.karaokeLyric,
        } : null,
    });
};
