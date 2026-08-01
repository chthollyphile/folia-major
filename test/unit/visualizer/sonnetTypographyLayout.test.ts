import { describe, expect, it } from 'vitest';
import type { SonnetSemanticSegment } from '@/components/visualizer/sonnet/types';
import {
    findSonnetHeroSegmentIndex,
    resolveSonnetTypographyLayout,
} from '@/components/visualizer/sonnet/sonnetTypographyLayout';

// test/unit/visualizer/sonnetTypographyLayout.test.ts
// Locks the semantic hero/support hierarchy and true stacked Japanese typography.
const segment = (text: string, isWordLike = true): SonnetSemanticSegment => ({
    text,
    startOffset: 0,
    endOffset: text.length,
    startTime: 0,
    endTime: 1,
    wordIndices: [],
    graphemes: Array.from(text, (char, index) => ({
        char,
        startTime: index / text.length,
        endTime: (index + 1) / text.length,
    })),
    isWordLike,
});

describe('Sonnet typography layout', () => {
    const segments = [segment('明かり'), segment('に', false), segment('あなたへ')];

    it('chooses one semantic hero deterministically', () => {
        expect(findSonnetHeroSegmentIndex(segments)).toBe(2);
        expect(findSonnetHeroSegmentIndex(segments))
            .toBe(findSonnetHeroSegmentIndex(segments));
    });

    it('stacks the hero by grapheme and keeps support text small', () => {
        const layout = resolveSonnetTypographyLayout({
            lines: [segments],
            shotKind: 'editorial-column',
            paragraphKind: 'verse',
            width: 1280,
            height: 720,
            baseFontSize: 40,
            fontFamily: 'sans-serif',
            fontWeight: 700,
        });
        const hero = layout.find(item => item.role === 'hero')!;
        const supports = layout.filter(item => item.role === 'support');

        expect(hero.displayText).toBe('あ\nな\nた\nへ');
        expect(supports.every(item => item.fontScale < hero.fontScale)).toBe(true);
        expect(layout.map(item => item.timingPhase)).toEqual([0, 0.5, 1]);
        expect(supports[0].x).toBeLessThan(supports[1].x);
    });

    it('changes composition across templates without changing segment order', () => {
        const impact = resolveSonnetTypographyLayout({
            lines: [segments],
            shotKind: 'type-impact',
            paragraphKind: 'chorus',
            width: 1280,
            height: 720,
            baseFontSize: 40,
            fontFamily: 'sans-serif',
            fontWeight: 700,
        });
        const quiet = resolveSonnetTypographyLayout({
            lines: [segments],
            shotKind: 'quiet-tableau',
            paragraphKind: 'outro',
            width: 1280,
            height: 720,
            baseFontSize: 40,
            fontFamily: 'sans-serif',
            fontWeight: 700,
        });

        expect(impact.map(item => item.role)).toEqual(quiet.map(item => item.role));
        expect(impact.find(item => item.role === 'hero')!.fontScale)
            .toBeGreaterThan(quiet.find(item => item.role === 'hero')!.fontScale);
    });

    it('uses semantic duration and timing order instead of seeded scatter', () => {
        const timed = [
            { ...segment('短'), startTime: 0, endTime: 0.3 },
            { ...segment('持续的主词'), startTime: 0.4, endTime: 2.2 },
            { ...segment('尾'), startTime: 2.3, endTime: 2.6 },
        ];
        const layout = resolveSonnetTypographyLayout({
            lines: [timed],
            shotKind: 'fragment-collage',
            paragraphKind: 'verse',
            width: 1280,
            height: 720,
            baseFontSize: 40,
            fontFamily: 'sans-serif',
            fontWeight: 700,
        });

        expect(findSonnetHeroSegmentIndex(timed)).toBe(1);
        expect(layout.map(item => item.timingPhase)).toEqual([0, 0.5, 1]);
        expect(layout[0].x).toBeLessThan(layout[2].x);
    });
});
