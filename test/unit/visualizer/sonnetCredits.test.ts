import { describe, expect, it } from 'vitest';
import {
    hasSonnetCreditsMetadata,
    resolveSonnetCreditsFrame,
} from '@/components/visualizer/sonnet/sonnetCredits';

// test/unit/visualizer/sonnetCredits.test.ts
// Locks the seek-safe handoff from the final lyric into Sonnet's metadata poster.
describe('Sonnet end credits', () => {
    it('keeps the lyric intact before its visual end', () => {
        expect(resolveSonnetCreditsFrame(9.9, 10)).toEqual({
            active: false,
            lyricAlpha: 1,
            lyricBlur: 0,
            posterAlpha: 0,
            posterOffsetY: 0.04,
            posterScale: 0.965,
        });
    });

    it('defocuses the lyric before settling the credits poster', () => {
        const handoff = resolveSonnetCreditsFrame(10.7, 10);
        const settled = resolveSonnetCreditsFrame(13, 10);

        expect(handoff.active).toBe(true);
        expect(handoff.lyricAlpha).toBeLessThan(1);
        expect(handoff.lyricBlur).toBeGreaterThan(0);
        expect(handoff.posterAlpha).toBeGreaterThan(0);
        expect(settled.lyricAlpha).toBe(0);
        expect(settled.lyricBlur).toBe(18);
        expect(settled.posterAlpha).toBe(1);
        expect(settled.posterScale).toBe(1);
    });

    it('requires at least one usable metadata field', () => {
        expect(hasSonnetCreditsMetadata({ title: 'Song', artist: null, album: null })).toBe(true);
        expect(hasSonnetCreditsMetadata({ title: '  ', artist: null, album: undefined })).toBe(false);
    });
});
