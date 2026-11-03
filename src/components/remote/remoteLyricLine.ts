import type { Line, LyricData } from '../../types';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';
import { isInterludeLine } from '../../utils/lyrics/parserCore';

// src/components/remote/remoteLyricLine.ts
// Which lyric line the remote window shows at a given time, as a plain rule. The lyric data holds
// a "......" line for the intro and for every pause over 3 s (an interlude): here that is a gap,
// never a line to show.

export interface RemoteLyricLine {
    /** The line being sung; in a gap inside the song, the last line sung. Null before the first line and without lyrics. */
    line: Line | null;
    /** The first line with words that has not started yet. */
    nextLine: Line | null;
    /** False in a gap: the line stays, dimmed. */
    isSinging: boolean;
}

const NO_LINE: RemoteLyricLine = { line: null, nextLine: null, isSinging: false };

/** Silence between two lines counts as a gap inside the song from this long on. */
const GAP_MIN_SEC = 3;

/** Where a line is drawn to: later than its timed end when the renderer holds it. */
const lineEnd = (line: Line) => line.renderHints?.renderEndTime ?? line.endTime;

/** The first line with words from `from` on. */
const findNextRealLine = (lines: Line[], from: number): Line | null => {
    for (let index = from; index < lines.length; index += 1) {
        const line = lines[index];
        if (line && !isInterludeLine(line)) {
            return line;
        }
    }
    return null;
};

/**
 * The line with words that was heard last among the first `count` lines (those that have
 * started): the one that ends latest. With two voices over each other that is not always the
 * one that started last.
 */
const findLastHeardLine = (lines: Line[], count: number): Line | null => {
    let last: Line | null = null;
    for (let index = 0; index < count; index += 1) {
        const line = lines[index];
        if (line && !isInterludeLine(line) && (!last || lineEnd(line) >= lineEnd(last))) {
            last = line;
        }
    }
    return last;
};

/**
 * Picks the line to show at `time` (seconds, lyric offset already taken off).
 * A line being sung is shown as it is. Anywhere else (a breath between two lines, an interlude,
 * before the first line, after the last) the last line with words stays, and it is dimmed unless
 * the next line starts within 3 s.
 */
export const resolveRemoteLyricLine = (lyrics: LyricData | null | undefined, time: number): RemoteLyricLine => {
    const lines = lyrics?.lines;
    if (!lines?.length) {
        return NO_LINE;
    }

    const activeIndex = findLatestActiveLineIndex(lines, time);
    const active = activeIndex === -1 ? null : lines[activeIndex] ?? null;
    const upcomingIndex = lines.findIndex(line => line.startTime > time);
    const nextLine = upcomingIndex === -1 ? null : findNextRealLine(lines, upcomingIndex);
    if (active && !isInterludeLine(active)) {
        return { line: active, nextLine, isSinging: true };
    }

    const line = findLastHeardLine(lines, upcomingIndex === -1 ? lines.length : upcomingIndex);
    // The breath between two lines is not a gap: dimming it would make the line blink.
    // An interlude always is one: the data only holds it for a pause over 3 s.
    const breathSec = line && nextLine ? nextLine.startTime - lineEnd(line) : Number.POSITIVE_INFINITY;
    return { line, nextLine, isSinging: !active && breathSec < GAP_MIN_SEC };
};
