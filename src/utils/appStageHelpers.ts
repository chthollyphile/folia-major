import type { LyricData, StageLoopMode, StageLyricsSession, StageMediaSession, StageStatus } from '../types';

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

export const getNextLoopMode = (currentLoopMode: StageLoopMode): StageLoopMode => {
    if (currentLoopMode === 'off') {
        return 'all';
    }

    if (currentLoopMode === 'all') {
        return 'one';
    }

    return 'off';
};

export const buildStageEntryKey = (
    entryKind: StageStatus['activeEntryKind'],
    lyricsSession: StageLyricsSession | null,
    session: StageMediaSession | null
) => {
    if (entryKind === 'lyrics' && lyricsSession) {
        return `lyrics::${lyricsSession.updatedAt}::${lyricsSession.lyricSource.type}::${lyricsSession.title || ''}`;
    }

    if (entryKind === 'media' && session) {
        return `media::${session.id}::${session.audioSrc}::${session.updatedAt}`;
    }

    return null;
};
