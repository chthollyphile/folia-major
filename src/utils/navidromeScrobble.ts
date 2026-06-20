// src/utils/navidromeScrobble.ts
// Tracks one Navidrome playback session and emits one now-playing and one submitted scrobble.

export type NavidromeScrobbleKind = 'now-playing' | 'submission';

export type NavidromeScrobbleReport = {
    kind: NavidromeScrobbleKind;
    songId: string;
    sessionId: number;
};

type NavidromeScrobbleSession = {
    durationMs: number;
    nowPlayingSent: boolean;
    sessionId: number;
    songId: string;
    submissionSent: boolean;
};

const FALLBACK_SCROBBLE_THRESHOLD_SECONDS = 60;

export const getNavidromeScrobbleThresholdSeconds = (durationMs: number): number => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return FALLBACK_SCROBBLE_THRESHOLD_SECONDS;
    }

    return Math.min(FALLBACK_SCROBBLE_THRESHOLD_SECONDS, (durationMs / 1000) * 0.5);
};

export class NavidromeScrobbleSessionTracker {
    private nextSessionId = 1;
    private session: NavidromeScrobbleSession | null = null;

    constructor(private readonly report: (report: NavidromeScrobbleReport) => void) {}

    startSession(songId: string, durationMs: number): void {
        this.session = {
            durationMs,
            nowPlayingSent: false,
            sessionId: this.nextSessionId,
            songId,
            submissionSent: false,
        };
        this.nextSessionId += 1;
    }

    clearSession(): void {
        this.session = null;
    }

    getCurrentSongId(): string | null {
        return this.session?.songId ?? null;
    }

    handlePlaybackStart(currentTimeSeconds: number): void {
        const session = this.session;
        if (!session) {
            return;
        }

        if (!session.nowPlayingSent) {
            session.nowPlayingSent = true;
            this.report({
                kind: 'now-playing',
                songId: session.songId,
                sessionId: session.sessionId,
            });
        }

        this.handleProgress(currentTimeSeconds);
    }

    handleProgress(currentTimeSeconds: number): void {
        const session = this.session;
        if (!session || session.submissionSent) {
            return;
        }

        const threshold = getNavidromeScrobbleThresholdSeconds(session.durationMs);
        if (currentTimeSeconds < threshold) {
            return;
        }

        session.submissionSent = true;
        this.report({
            kind: 'submission',
            songId: session.songId,
            sessionId: session.sessionId,
        });
    }
}
