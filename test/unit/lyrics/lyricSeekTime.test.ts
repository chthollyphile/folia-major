import { describe, expect, it } from 'vitest';
import { resolveLyricSeekMediaTime } from '@/utils/lyrics/lyricSeekTime';

// A click on a lyric line seeks the media: the line's lyric time minus the lead the lyric clock
// has over the media clock (preview clip start - manual offset), kept inside the loaded media.
describe('resolveLyricSeekMediaTime', () => {
    // A 30 s preview clip cut from 60 s into the song, 2 s in: the lyric clock reads 62 s.
    const clip = { mediaTimeSec: 2, lyricTimeSec: 62, durationSec: 30 };

    it('seeks a line inside a preview clip to its position in the clip', () => {
        expect(resolveLyricSeekMediaTime(70, clip)).toBe(10);
        expect(resolveLyricSeekMediaTime(60, clip)).toBe(0);
    });

    it('clamps a line before the clip start to the start of the clip', () => {
        expect(resolveLyricSeekMediaTime(12, clip)).toBe(0);
    });

    it('does not seek to a line at or past the clip end, which would end the track at once', () => {
        expect(resolveLyricSeekMediaTime(90, clip)).toBeNull();
        expect(resolveLyricSeekMediaTime(140, clip)).toBeNull();
        expect(resolveLyricSeekMediaTime(89.5, clip)).toBe(29.5);
    });

    it('takes the manual lyric offset out the same way, on a full song', () => {
        // Lyrics shown 500 ms early: the lyric clock trails the media by 0.5 s.
        const song = { mediaTimeSec: 40, lyricTimeSec: 39.5, durationSec: 200 };
        expect(resolveLyricSeekMediaTime(100, song)).toBe(100.5);
        expect(resolveLyricSeekMediaTime(0, { ...song, lyricTimeSec: 40.5 })).toBe(0);
    });

    it('combines a clip start with a manual offset', () => {
        // Clip from 60 s, lyrics delayed by 500 ms: media 2 s -> lyric 61.5 s.
        expect(resolveLyricSeekMediaTime(70, { mediaTimeSec: 2, lyricTimeSec: 61.5, durationSec: 30 })).toBe(10.5);
    });

    it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('has no upper bound without a known duration (%s)', durationSec => {
        expect(resolveLyricSeekMediaTime(500, { mediaTimeSec: 2, lyricTimeSec: 2, durationSec })).toBe(500);
    });

    it('does not seek to a time that is not a number', () => {
        expect(resolveLyricSeekMediaTime(Number.NaN, clip)).toBeNull();
    });
});
