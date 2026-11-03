// src/utils/lyrics/lyricSeekTime.ts
// Turns a time on the lyric clock (a line's startTime) back into a position of the loaded media.
// The lyric clock runs at media time + preview clip start - manual lyric offset; the media element,
// its progress and its duration stay the clip's own. So a lyric line is reached by seeking to
// lyric time minus that difference, and the difference is read off the two live clocks rather than
// rebuilt from the clip start and the offset, so a caller needs neither.

export type LyricSeekClock = {
    /** The media element's position now, in seconds (`currentTime`). */
    mediaTimeSec: number;
    /** The lyric clock now, in seconds (`lyricCurrentTime`). */
    lyricTimeSec: number;
    /** The loaded media's own duration in seconds; 0, NaN or Infinity when it is not known. */
    durationSec: number;
};

/**
 * The media position that shows the lyric at `lyricTimeSec`, or null when that lyric lies at or past
 * the end of the loaded media.
 *
 * A target before the media start (a line ahead of where a preview clip begins) is clamped to 0:
 * the clip starts playing from its first second, the nearest point to the line it has. A target at
 * or past the end is not seeked at all: there the element would end at once and the queue would
 * move on to the next song, which is never what a click on a line means. Without a known duration
 * there is no upper bound.
 */
export function resolveLyricSeekMediaTime(lyricTimeSec: number, clock: LyricSeekClock): number | null {
    const lyricLeadSec = clock.lyricTimeSec - clock.mediaTimeSec;
    const target = lyricTimeSec - lyricLeadSec;
    if (!Number.isFinite(target)) return null;
    if (Number.isFinite(clock.durationSec) && clock.durationSec > 0 && target >= clock.durationSec) {
        return null;
    }
    return Math.max(0, target);
}
