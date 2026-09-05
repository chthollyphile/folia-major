import { describe, expect, it } from 'vitest';
import { motionValue } from 'framer-motion';
import type { Line } from '../../../src/types';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { buildMonetDisplayTokens } from '../../../src/components/visualizer/monet/monetLyricsModel';
import { resolveMonetFillWidth, resolveMonetGlow, MONET_SCROLL_SPRING } from '../../../src/components/visualizer/monet/monetLyricMotion';
import { layoutLatticeLine, resolveLatticeLongLineOffset, resolveLatticeTypography, wrapLatticeTokens,
    type MeasureText } from '../../../src/components/app/lattice/lyrics/latticeLyricLayout';
import { createLatticeTimeline, stepLatticeSpring } from '../../../src/components/app/lattice/lyrics/latticeLyricTimeline';
import type { LatticeLyricInput } from '../../../src/components/app/lattice/lyrics/types';

// test/unit/lattice/latticeLyrics.test.ts
const input = (patch: Partial<LatticeLyricInput> = {}): LatticeLyricInput => ({ songKey: 'song-a',
    lines: [], currentLineIndex: -1, currentTime: motionValue(0), theme: DEFAULT_THEME,
    keywordColoringEnabled: true, reducedMotion: false, fontsEpoch: 0, ...patch });
const measure: MeasureText = (text, font) => {
    const size = Number(font.match(/([\d.]+)px/)?.[1] ?? 20);
    const factor = font.startsWith('900') ? 1.4 : 1;
    return { width: [...text].length * size * 0.6 * factor, height: size * factor };
};
const line = (text: string, startTime = 0, endTime = 10): Line => ({ fullText: text, words: [], startTime, endTime });

describe('Lattice card typography budget', () => {
    it('uses the largest fitting size within 24–64 local pixels', () => {
        expect(resolveLatticeTypography(input(), 900, 700, measure).fontPx).toBe(64);
        expect(resolveLatticeTypography(input(), 700, 500, measure).fontPx).toBeGreaterThan(36);
        expect(resolveLatticeTypography(input(), 40, 20, measure).fontPx).toBe(24);
        const fitting = resolveLatticeTypography(input(), 360, 260, measure);
        expect(fitting.fontPx).toBeGreaterThan(24);
        expect(fitting.fontPx).toBeLessThan(64);
        expect(fitting.translationPx).toBe(fitting.fontPx * 0.5);
    });
    it('ignores all global and Monet font scale fields and the active sentence', () => {
        const base = input();
        const extra = { ...base, lyricsFontScale: 8, subtitleFontScale: 0.1, monetTuning: { fontScale: 5 },
            lines: [line('超长歌词'.repeat(100))], currentLineIndex: 0 };
        expect(resolveLatticeTypography(extra, 450, 260, measure)).toEqual(resolveLatticeTypography(base, 450, 260, measure));
    });
    it('reserves translation space only when the effective toggle allows it', () => {
        const shown = resolveLatticeTypography(input(), 450, 260, measure);
        const hidden = resolveLatticeTypography(input({ hideTranslationSubtitle: true }), 450, 260, measure);
        expect(shown.fontPx).toBeLessThan(hidden.fontPx);
        expect(resolveLatticeTypography(input({ subtitleContentMode: 'none' }), 450, 260, measure).fontPx).toBe(hidden.fontPx);
        expect(resolveLatticeTypography(input({ showSubtitleTranslation: false }), 450, 260, measure).fontPx).toBe(hidden.fontPx);
    });
    it('uses theme font families and weights for both measurement paths', () => {
        const custom = input({ theme: { ...DEFAULT_THEME, fontFamily: 'CardFont', fontWeight: 900 },
            subtitleTheme: { ...DEFAULT_THEME, fontFamily: 'SubFont', fontWeight: 400 } });
        const result = resolveLatticeTypography(custom, 450, 260, measure);
        expect(result.font).toContain('900'); expect(result.font).toContain('CardFont');
        expect(result.translationFont).toContain('400'); expect(result.translationFont).toContain('SubFont');
        expect(result.fontPx).toBeLessThan(resolveLatticeTypography(input(), 450, 260, measure).fontPx);
    });
});

describe('Lattice wrapping and long-line following', () => {
    it('retains repeated words, punctuation, spaces, CJK and emoji graphemes', () => {
        const lyric = { ...line('你好， go  go 👨‍👩‍👧‍👦！'), words: [
            { text: '你好', startTime: 0, endTime: 1 }, { text: 'go', startTime: 1, endTime: 2 },
            { text: 'go', startTime: 2, endTime: 3 }, { text: '👨‍👩‍👧‍👦', startTime: 3, endTime: 4 }] };
        const tokens = buildMonetDisplayTokens(lyric);
        const pieces = wrapLatticeTokens(tokens, 75, '600 20px sans-serif', 24, measure);
        expect(pieces.map(p => p.text).join('')).toBe(lyric.fullText);
        expect(pieces.filter(p => p.text.includes('👨')).map(p => p.text)).toEqual(['👨‍👩‍👧‍👦']);
        expect(pieces.filter(p => p.text === 'go').map(p => p.token.startTime)).toEqual([1, 2]);
    });
    it('wraps an oversized timed token without restarting its sweep on each row', () => {
        const lyric = line('abcdefghijklmnopqrstuvwx', 0, 24);
        const type = resolveLatticeTypography(input(), 90, 140, measure);
        const layout = layoutLatticeLine(lyric, type, 90, measure, false);
        expect(layout.rows).toBeGreaterThan(2);
        expect(layout.pieces[1].tokenOffset).toBeGreaterThan(0);
        expect(resolveLatticeLongLineOffset(layout, 1, 60, type.lineHeight)).toBe(0);
        const tail = resolveLatticeLongLineOffset(layout, 23.9, 60, type.lineHeight);
        expect(tail).toBeGreaterThan(0);
        expect(tail).toBeLessThanOrEqual(layout.height - 60);
        expect(resolveLatticeLongLineOffset(layout, 1, 60, type.lineHeight)).toBe(0);
    });
    it('does not truncate the active source and selects romanization when requested', () => {
        const lyric = { ...line('唱'.repeat(200)), translation: 'translated line', romanization: 'romanized line' };
        const type = resolveLatticeTypography(input(), 120, 250, measure);
        const layout = layoutLatticeLine(lyric, type, 120, measure, true);
        expect(layout.pieces.filter(p => !p.translation).map(p => p.text).join('')).toBe(lyric.fullText);
        expect(layout.pieces.filter(p => p.translation).map(p => p.text).join('')).toBe(lyric.romanization);
    });
    it('respects explicit newlines and never lets an ordinary token exceed the column', () => {
        const pieces = wrapLatticeTokens(buildMonetDisplayTokens(line('ab\ncd ef')), 55, '600 20px sans-serif', 24, measure);
        expect(pieces.find(p => p.text.startsWith('cd'))?.row).toBeGreaterThan(0);
        expect(pieces.every(p => p.width <= 55)).toBe(true);
    });
});

describe('shared Monet absolute-time envelopes', () => {
    it('sweeps measured grapheme widths and rewinds correctly', () => {
        const timings = [{ char: 'a', startTime: 1, endTime: 2 }, { char: 'b', startTime: 3, endTime: 5 }];
        expect(resolveMonetFillWidth(1.5, 1, 5, [0, 10, 40], timings)).toBe(5);
        expect(resolveMonetFillWidth(2.5, 1, 5, [0, 10, 40], timings)).toBe(10);
        expect(resolveMonetFillWidth(4, 1, 5, [0, 10, 40], timings)).toBe(25);
        expect(resolveMonetFillWidth(0, 1, 5, [0, 10, 40], timings)).toBe(0);
        expect(resolveMonetFillWidth(9, 1, 5, [0, 10, 40], timings)).toBe(40);
    });
    it('handles missing timing, zero duration and exact original timing boundaries', () => {
        expect(resolveMonetFillWidth(0.5, 0, 1, [0, 10, 40], [])).toBe(10);
        expect(resolveMonetFillWidth(1, 1, 1, [0, 10], [])).toBe(0);
        expect(resolveMonetFillWidth(2, 1, 1, [0, 10], [])).toBe(10);
    });
    it('matches Monet smoothstep rise, linger and decay without audio input', () => {
        expect(resolveMonetGlow(0, 0, 1, 4)).toBe(0);
        expect(resolveMonetGlow(0.59, 0, 1, 4)).toBeCloseTo(0.5);
        expect(resolveMonetGlow(1.18, 0, 1, 4)).toBe(1);
        expect(resolveMonetGlow(2.59, 0, 1, 4)).toBeCloseTo(0.5);
        expect(resolveMonetGlow(4, 0, 1, 4)).toBe(0);
    });
});

describe('lyric clock boundaries and spring settling', () => {
    it('selects bounded contexts across intro, gaps, completion and backward seeks', () => {
        const timeline = createLatticeTimeline([line('a', 1, 2), line('b', 4, 5), line('c', 6, 7)]);
        expect(timeline(-1)[0].status).toBe('waiting');
        expect(timeline(1).find(e => e.offset === 0)?.status).toBe('active');
        expect(timeline(2).find(e => e.index === 0)?.status).toBe('active');
        expect(timeline(2.001).find(e => e.index === 0)?.status).toBe('passed');
        expect(timeline(4.5).find(e => e.offset === 0)?.line.fullText).toBe('b');
        expect(timeline(8).every(e => e.status === 'passed')).toBe(true);
        expect(timeline(1.5).find(e => e.offset === 0)?.line.fullText).toBe('a');
        expect(timeline(1.6)).toBe(timeline(1.5));
    });
    it('honors extended render ends and discards old selection for a new song', () => {
        const a = { ...line('a', 0, 1), renderHints: { renderEndTime: 3 } } as Line;
        expect(createLatticeTimeline([a])(2).find(e => e.offset === 0)?.status).toBe('active');
        expect(createLatticeTimeline([line('new', 0, 5)])(2)[0].line.fullText).toBe('new');
        expect(createLatticeTimeline([])(0)).toEqual([]);
    });
    it('converges at both fast and slow frame rates after pause', () => {
        for (const dt of [1 / 120, 1 / 30, 0.05]) {
            let state = { value: 0, velocity: 0, settled: false };
            for (let t = 0; t < 5; t += dt) state = stepLatticeSpring(state.value, state.velocity, 100, dt, MONET_SCROLL_SPRING);
            expect(state).toEqual({ value: 100, velocity: 0, settled: true });
        }
    });
});
