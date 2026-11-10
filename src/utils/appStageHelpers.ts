import type { LyricData, StageLyricsClock, StageLyricsClockUpdate, StageLyricsSession, StageMediaSession, StageStatus } from '../types';

// Stage-mode helpers extracted from the app entry module.
export const getStageLyricsTimelineBounds = (lyricData: LyricData | null) => {
    if (!lyricData?.lines.length) {
        return { startTimeSec: 0, endTimeSec: 0 };
    }

    const firstLine = lyricData.lines[0];
    const startTimeSec = Number.isFinite(firstLine?.startTime) ? Math.max(0, firstLine.startTime) : 0;
    const endTimeSec = lyricData.lines.reduce((maxEndTime, line) => {
        const lineEndTime = line.renderHints?.renderEndTime ?? line.endTime;
        return Number.isFinite(lineEndTime) ? Math.max(maxEndTime, lineEndTime) : maxEndTime;
    }, startTimeSec);

    return {
        startTimeSec,
        endTimeSec: Math.max(startTimeSec, endTimeSec),
    };
};

export const buildStageEntryKey = (
    entryKind: StageStatus['activeEntryKind'],
    lyricsSession: StageLyricsSession | null,
    session: StageMediaSession | null
) => {
    if (entryKind === 'lyrics' && lyricsSession) {
        return `lyrics::${lyricsSession.updatedAt}::${lyricsSession.lyricSource?.type ?? 'none'}::${lyricsSession.title || ''}`;
    }

    if (entryKind === 'media' && session) {
        return `media::${session.id}::${session.audioSrc}::${session.updatedAt}`;
    }

    return null;
};

/** Where an external player's clock is now: its reported position, run on from when it was received unless paused. */
export const stageLyricsClockTimeSec = (clock: StageLyricsClock, nowMs = Date.now()) => (
    Math.max(0, clock.positionMs + (clock.paused ? 0 : Math.max(0, nowMs - clock.sampledAtMs))) / 1000
);

/**
 * The newest clock known for a lyrics session: the one it was loaded with, or one sent since
 * (POST /stage/lyrics/clock) for that same session.
 */
export const latestStageLyricsClock = (
    session: StageLyricsSession,
    update: StageLyricsClockUpdate | null,
): StageLyricsClock | null => {
    const sent = update && update.sessionUpdatedAt === session.updatedAt ? update.clock : null;
    if (!sent) return session.clock ?? null;
    if (!session.clock) return sent;
    return sent.sampledAtMs >= session.clock.sampledAtMs ? sent : session.clock;
};

/**
 * A lyrics session with what POST /stage/lyrics/clock has sent for it since it was pushed: its newest
 * clock, and a length sent with a clock (some players report it only once playing).
 */
export const withLatestStageLyricsClock = (
    session: StageLyricsSession,
    update: StageLyricsClockUpdate | null,
): StageLyricsSession => {
    const clock = latestStageLyricsClock(session, update);
    const sentForIt = update && update.sessionUpdatedAt === session.updatedAt;
    const durationMs = sentForIt && update.durationMs ? update.durationMs : session.durationMs;
    if (clock === session.clock && durationMs === session.durationMs) return session;
    return { ...session, ...(clock ? { clock } : {}), ...(durationMs ? { durationMs } : {}) };
};

/**
 * The time line of a lyrics session. On its own clock it plays its lyrics from the first line to
 * the last; an external player's clock runs over the whole track instead, its length the one the
 * player gave (an end of 0 is unbounded: the player gave none).
 */
export const getStageLyricsSessionTimeline = (session: StageLyricsSession, lyricData: LyricData | null) => {
    const bounds = getStageLyricsTimelineBounds(lyricData);
    const durationSec = session.durationMs && session.durationMs > 0 ? session.durationMs / 1000 : 0;
    if (session.clock) {
        // The clock is not held at the end of the lyrics: the player's track can run on past them.
        // Without a length given there is none (0), so nothing re-syncs it to the end of the lyrics.
        return { startTimeSec: 0, endTimeSec: durationSec, durationSec };
    }
    const endTimeSec = Math.max(bounds.endTimeSec, durationSec);
    return { startTimeSec: bounds.startTimeSec, endTimeSec, durationSec: endTimeSec };
};
