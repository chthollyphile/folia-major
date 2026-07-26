import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { resolvePendoloFallbackAnchorIndex, resolvePendoloRotatingLineOpacity } from '@/components/visualizer/pendolo/pendoloTimeline';

// test/unit/visualizer/pendoloTimeline.test.ts

const lines: Line[] = [
    { id: 'intro', startTime: 2, endTime: 5, fullText: 'intro', words: [] },
    { id: 'outro', startTime: 8, endTime: 10, fullText: 'outro', words: [] },
];

describe('Pendolo timeline anchor', () => {
    it('holds the new-song focal position at -1 before a lyric line is observed', () => {
        expect(resolvePendoloFallbackAnchorIndex(lines, -1, 0, false, 0)).toBe(-1);
    });

    it('uses an in-between anchor during a gap after a lyric line', () => {
        expect(resolvePendoloFallbackAnchorIndex(lines, -1, 0, true, 6)).toBe(0.5);
    });

    it('advances beyond the final lyric after seeking past its end', () => {
        expect(resolvePendoloFallbackAnchorIndex(lines, -1, 1, true, 10.1)).toBe(2);
    });

    it('keeps full-distance rotations hidden until the lyric reaches the visible arc', () => {
        expect(resolvePendoloRotatingLineOpacity(0, 360, 0.8)).toBe(0);
        expect(resolvePendoloRotatingLineOpacity(0, 110, 0.8)).toBe(0);
        expect(resolvePendoloRotatingLineOpacity(0, 96, 0.8)).toBeCloseTo(0.4);
        expect(resolvePendoloRotatingLineOpacity(0, 82, 0.8)).toBe(0.8);
        expect(resolvePendoloRotatingLineOpacity(0, 0, 0.8)).toBe(0.8);
    });

});
