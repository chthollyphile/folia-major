// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/visualizer/tideAnchorSampler.test.ts
// The tide background has no lyrics of its own: it asks the foreground lyric layer where the
// glyphs sit and turns each cluster of neighbours into one force vector. jsdom has no layout, so
// the tests stub Range#getClientRects with a deterministic ten-pixel grid to stand in for the
// browser's text metrics.

import {
    collectTideGlyphs,
    findTideClusterIndex,
    measureTideGlyphRange,
    normalizeAnchorText,
} from '@/components/visualizer/backgrounds/tide/tideGlyphDom';
import { LyricAnchorSampler } from '@/components/visualizer/backgrounds/tide/LyricAnchorSampler';
import type { Line } from '@/types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BOUNDS = { left: 0, top: 0, width: 1000, height: 1000 };

let glyphLeft = 100;
let glyphTop = 200;

// jsdom implements Range but not its layout-facing getClientRects, so the stub replaces it
// outright instead of spying on an existing method.
const stubGlyphRects = (options: { empty?: boolean } = {}) => {
    (Range.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = function (this: Range) {
        if (options.empty) {
            return { length: 0, item: () => null } as unknown as DOMRectList;
        }

        const text = this.toString();
        const baseIndex = Math.max(0, ALPHABET.indexOf(text[0] ?? 'A'));
        const rects = Array.from(text, (_, index) => {
            const left = glyphLeft + (baseIndex + index) * 10;
            return {
                left,
                top: glyphTop,
                right: left + 10,
                bottom: glyphTop + 20,
                width: 10,
                height: 20,
                x: left,
                y: glyphTop,
            } as DOMRect;
        });

        return {
            length: rects.length,
            item: (index: number) => rects[index] ?? null,
        } as unknown as DOMRectList;
    };
};

const buildStage = (parts: string[]): HTMLElement => {
    document.body.innerHTML = '';
    const stage = document.createElement('div');
    parts.forEach((part) => {
        const span = document.createElement('span');
        span.textContent = part;
        stage.appendChild(span);
    });
    document.body.appendChild(stage);
    return stage;
};

const makeLine = (words: Array<[string, number, number]>, id = 'line-1'): Line => ({
    id,
    fullText: words.map(([text]) => text).join(''),
    startTime: words[0][1],
    endTime: words[words.length - 1][2],
    words: words.map(([text, startTime, endTime]) => ({ text, startTime, endTime })),
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    document.body.innerHTML = '';
    glyphLeft = 100;
    glyphTop = 200;
});

describe('tideGlyphDom', () => {
    it('normalizes whitespace out of a word before it is matched against the DOM', () => {
        expect(normalizeAnchorText(' A  B\n C ')).toBe('ABC');
    });

    it('collects visible glyphs in reading order and skips canvas, svg and opt-out subtrees', () => {
        const stage = buildStage(['AB', ' CD ']);

        const optOut = document.createElement('div');
        optOut.dataset.tideSkipAnchor = 'true';
        optOut.textContent = 'ZZ';
        stage.appendChild(optOut);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        svgText.textContent = 'QQ';
        svg.appendChild(svgText);
        stage.appendChild(svg);

        const { text, glyphs } = collectTideGlyphs(stage);
        expect(text).toBe('ABCD');
        expect(glyphs).toHaveLength(4);
        expect(glyphs.map(glyph => glyph.offset)).toEqual([0, 1, 1, 2]);
    });

    it('finds the word nearest to the reading cursor and falls back to its first occurrence', () => {
        expect(findTideClusterIndex('ABCDABCD', 'CD', 0)).toBe(2);
        expect(findTideClusterIndex('ABCDABCD', 'CD', 4)).toBe(6);
        expect(findTideClusterIndex(`CD${'x'.repeat(21)}CD`, 'CD', 4)).toBe(0);
        expect(findTideClusterIndex('ABC', 'ZZ', 0)).toBe(-1);
        expect(findTideClusterIndex('ABC', '', 0)).toBe(-1);
    });

    it('measures a glyph range from the union of its client rects', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCDEFGH']);
        const { glyphs } = collectTideGlyphs(stage);

        expect(measureTideGlyphRange(glyphs, 2, 3)).toEqual({ left: 120, top: 200, width: 30, height: 20 });
        expect(measureTideGlyphRange(glyphs, 0, 2)?.left).toBe(100);
        expect(measureTideGlyphRange([], 0, 3)).toBeNull();
    });

    it('returns nothing when the browser reports no visible text rects', () => {
        stubGlyphRects({ empty: true });
        const stage = buildStage(['ABCD']);
        const { glyphs } = collectTideGlyphs(stage);
        expect(measureTideGlyphRange(glyphs, 0, 2)).toBeNull();
    });
});

describe('LyricAnchorSampler', () => {
    it('emits nothing without an active line', () => {
        const sampler = new LyricAnchorSampler();
        expect(sampler.sample({ stage: null, maxAnchors: 6, bounds: BOUNDS, lines: [], lineIndex: 0, timeSec: 1, dt: 0.12 })).toEqual([]);
    });

    it('ignores words that are far outside their timing window', () => {
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5]]);
        const samples = sampler.sample({ stage: null, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 0.2, dt: 0.12 });
        expect(samples).toEqual([]);
    });

    it('falls back to timing anchors when the visualizer renders no DOM text', () => {
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1.5, 2]]);
        const samples = sampler.sample({ stage: null, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2, dt: 0.12 });

        expect(samples.map(sample => sample.key)).toEqual(['timing:0', 'timing:1']);
        expect(samples[0].strength).toBeCloseTo(0.55, 5);
        expect(samples[1].strength).toBeCloseTo((1 - 0.3 / 0.45) * 0.55, 5);
        samples.forEach((sample) => {
            expect(sample.x).toBeGreaterThanOrEqual(0.04);
            expect(sample.x).toBeLessThanOrEqual(0.96);
            expect(sample.y).toBeGreaterThanOrEqual(0.08);
            expect(sample.y).toBeLessThanOrEqual(0.92);
        });
        expect(samples[0].vy).toBeCloseTo(0.42, 5);
    });

    it('measures anchors on the real lyric DOM and inverts the y axis', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCD']);
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1.5, 2]]);
        const samples = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2, dt: 0.12 });

        expect(samples.map(sample => sample.key)).toEqual(['dom:0', 'dom:1']);
        expect(samples[0].x).toBeCloseTo(0.105, 5);
        expect(samples[0].y).toBeCloseTo(0.79, 5);
        expect(samples[0].strength).toBeCloseTo(1, 5);
        expect(samples[1].x).toBeCloseTo(0.115, 5);
        // 新出现的字只轻轻带一下，不再每个词都弹一下。
        expect(samples[0].vx).toBeCloseTo(-0.06, 5);
        expect(samples[0].vy).toBeCloseTo(0.12, 5);
    });

    it('turns vertical glyph movement into an upward velocity', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCD']);
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1.5, 2]]);
        const input = { stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2, dt: 0.12 };

        glyphTop = 260;
        const first = sampler.sample(input);
        glyphTop = 200;
        const samples = sampler.sample(input);

        // 纵向位移转成了向上的速度，而且和新测量值做了混合：上一帧 0.55 + 本次 0.45。
        expect(first[0].vy).toBeCloseTo(0.12, 5);
        expect(samples[0].vy).toBeCloseTo(0.12 * 0.55 + (0.06 / 0.12) * 0.45, 4);
        // 横向没动，出生时的小冲量会被慢慢磨掉，而不是每帧重来。
        expect(samples[0].vx).toBeCloseTo(-0.06 * 0.55, 4);
    });

    it('clamps anchor speed and re-arms the impulse after a line change', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCD']);
        const sampler = new LyricAnchorSampler();
        const firstLine = makeLine([['A', 1, 1.5]], 'line-1');
        const secondLine = makeLine([['C', 1, 1.5]], 'line-2');

        glyphTop = 900;
        sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [firstLine], lineIndex: 0, timeSec: 1.2, dt: 0.05 });
        glyphTop = 100;
        const fast = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [firstLine], lineIndex: 0, timeSec: 1.2, dt: 0.05 });
        expect(fast[0].vy).toBe(1.6);

        const switched = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [secondLine], lineIndex: 0, timeSec: 1.2, dt: 0.05 });
        expect(switched[0].key).toBe('dom:0');
        expect(switched[0].vy).toBeCloseTo(0.12, 5);
    });
    it('caps how many glyph vectors one sample may return', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCDEFGH']);
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1, 1.5], ['C', 1, 1.5], ['D', 1, 1.5], ['E', 1, 1.5], ['F', 1, 1.5]]);

        const capped = sampler.sample({ stage, maxAnchors: 2, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2, dt: 0.12 });
        expect(capped.length).toBeLessThanOrEqual(2);

        sampler.reset();
        const all = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2, dt: 0.12 });
        expect(all.length).toBeGreaterThan(capped.length);
    });
});
