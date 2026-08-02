import { describe, expect, it } from 'vitest';
import type { SonnetSemanticSegment } from '@/components/visualizer/sonnet/types';
import {
    buildSonnetGlyphLayout,
    resolveSonnetGlyphMotionDuration,
} from '@/components/visualizer/sonnet/sonnetGlyphLayout';
import type { SonnetTypographyPlacement } from '@/components/visualizer/sonnet/sonnetTypographyLayout';

// test/unit/visualizer/sonnetGlyphLayout.test.ts
// Locks parser-timed per-grapheme positioning and entrance vectors.
const segment: SonnetSemanticSegment = {
    text: 'あなた',
    startOffset: 0,
    endOffset: 3,
    startTime: 2,
    endTime: 3.2,
    wordIndices: [0],
    graphemes: Array.from('あなた', (char, index) => ({
        char,
        startTime: 2 + index * 0.4,
        endTime: 2.4 + index * 0.4,
    })),
    isWordLike: true,
};

const placement: SonnetTypographyPlacement = {
    segmentIndex: 0,
    displayText: 'あ\nな\nた',
    role: 'hero',
    fontScale: 1,
    x: 120,
    y: 80,
    rotation: 0,
    enterX: 0,
    enterY: 90,
    vertical: true,
    layoutDirection: 'vertical',
    timingPhase: 0.5,
};

describe('Sonnet glyph layout', () => {
    it('creates one glyph per grapheme with original timing', () => {
        const glyphs = buildSonnetGlyphLayout(
            segment,
            placement,
            60,
            () => 60,
            { startTime: 2, endTime: 6 },
        );

        expect(glyphs.map(glyph => glyph.char).join('')).toBe(segment.text);
        expect(glyphs.map(glyph => glyph.startTime)).toEqual([2, 2.232, 2.464]);
        expect(glyphs.every((glyph, index) => (
            index === 0 || glyph.baseY > glyphs[index - 1].baseY
        ))).toBe(true);
        expect(glyphs.every(glyph => glyph.settleTime - glyph.startTime > 1.6)).toBe(true);
        expect(glyphs.every(glyph => glyph.settleTime <= 6)).toBe(true);
    });

    it('gives adjacent glyphs alternating approach vectors', () => {
        const glyphs = buildSonnetGlyphLayout(
            segment,
            placement,
            60,
            () => 60,
            { startTime: 2, endTime: 6 },
        );

        expect(glyphs[0].enterX).toBeLessThan(0);
        expect(glyphs[1].enterX).toBeGreaterThan(0);
        expect(glyphs.every(glyph => glyph.enterY === 90)).toBe(true);
        expect(glyphs.every(glyph => glyph.settleTime <= 6)).toBe(true);
    });

    it('derives slow movement duration from the whole shot', () => {
        expect(resolveSonnetGlyphMotionDuration({ startTime: 0, endTime: 4 })).toBeCloseTo(1.68);
        expect(resolveSonnetGlyphMotionDuration({ startTime: 0, endTime: 10 })).toBe(1.8);
    });
});
