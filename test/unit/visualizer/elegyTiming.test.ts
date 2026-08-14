import { describe, expect, it } from 'vitest';
import { resolveElegyWritingProgress } from '@/components/visualizer/elegy/elegyScene';

// test/unit/visualizer/elegyTiming.test.ts
// Verifies that every glyph starts with the line while retaining its parser-derived finish time.
describe('Elegy writing timing', () => {
    it('starts early and late glyphs together but advances the later glyph more slowly', () => {
        const lineStartTime = 10;
        const currentTime = 11;
        const earlyGlyph = resolveElegyWritingProgress(lineStartTime, 12, currentTime);
        const lateGlyph = resolveElegyWritingProgress(lineStartTime, 18, currentTime);

        expect(earlyGlyph).toBe(0.5);
        expect(lateGlyph).toBe(0.125);
        expect(earlyGlyph).toBeGreaterThan(0);
        expect(lateGlyph).toBeGreaterThan(0);
    });

    it('finishes each glyph exactly at its original grapheme end time', () => {
        expect(resolveElegyWritingProgress(10, 12, 11.99)).toBeLessThan(1);
        expect(resolveElegyWritingProgress(10, 12, 12)).toBe(1);
        expect(resolveElegyWritingProgress(10, 18, 12)).toBe(0.25);
        expect(resolveElegyWritingProgress(10, 18, 18)).toBe(1);
    });

    it('keeps zero-duration glyphs hidden before the line and complete at line start', () => {
        expect(resolveElegyWritingProgress(10, 10, 9.99)).toBe(0);
        expect(resolveElegyWritingProgress(10, 10, 10)).toBe(1);
    });
});
