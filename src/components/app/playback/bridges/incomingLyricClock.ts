import { findLatestActiveLineIndex } from '../../../../utils/appPlaybackHelpers';
import type { LyricData } from '../../../../types';

// src/components/app/playback/bridges/incomingLyricClock.ts
// The incoming track's lyric clock during a blend: its own deck's position less the lyric offset, and
// its line by the same rule the outgoing track's read-head uses. Null lyrics (still loading) have no line.

export const readIncomingLyricClock = (
    audioTimeSec: number,
    lyricOffsetMs: number,
    lines: LyricData['lines'] | null | undefined,
    clipStartMs = 0,
): { lyricTimeSec: number; lineIndex: number } => {
    const lyricTimeSec = audioTimeSec + (clipStartMs - lyricOffsetMs) / 1000;
    return { lyricTimeSec, lineIndex: lines ? findLatestActiveLineIndex(lines, lyricTimeSec) : -1 };
};
