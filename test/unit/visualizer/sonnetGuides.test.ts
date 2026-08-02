import { describe, expect, it } from 'vitest';
import type { SonnetSemanticSegment } from '@/components/visualizer/sonnet/types';
import { resolveSonnetGuideCue } from '@/components/visualizer/sonnet/sonnetGuides';

// test/unit/visualizer/sonnetGuides.test.ts
// Ensures every semantic text cue receives a short visual lead before its first glyph.
const segment = (startTime: number, endTime: number): SonnetSemanticSegment => ({
    text: '光',
    startOffset: 0,
    endOffset: 1,
    startTime,
    endTime,
    wordIndices: [0],
    graphemes: [{ char: '光', startTime, endTime }],
    isWordLike: true,
});

describe('Sonnet guide cues', () => {
    it('starts before text and overlaps only the initial arrival moment', () => {
        const source = segment(3, 4);
        const cue = resolveSonnetGuideCue(source);

        expect(cue.startTime).toBeLessThan(source.startTime);
        expect(source.startTime - cue.startTime).toBeGreaterThanOrEqual(0.2);
        expect(cue.endTime).toBeCloseTo(source.startTime + 0.65);
    });

    it('caps guide lead time for long semantic segments', () => {
        const source = segment(10, 20);
        const cue = resolveSonnetGuideCue(source);

        expect(source.startTime - cue.startTime).toBeCloseTo(0.38);
    });
});
