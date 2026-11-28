import { describe, expect, it } from 'vitest';
import type { FontStrokesGlyph } from '@/services/fontStrokes/fontStrokesOutline';
import { penToPoints, placeInlineBlockGlyph, ringsToPathData, strokeMaskRegion } from '@/components/visualizer/fontStrokes/strokeWriteSvg';
import { strokeUnitsToWorld } from '@/components/visualizer/fontStrokes/strokeWriteCanvas';
import { resolveSourceGlyphState, type StrokeWriteSource } from '@/components/visualizer/fontStrokes/strokeWriteSource';
import { StrokeWriteSlot } from '@/components/visualizer/fontStrokes/strokeWriteSlot';
import { buildDomGlowFilter } from '@/components/visualizer/cadenza/cadenzaHandwriting';
import classicTuning from '@/components/visualizer/classic/tuning';
import cadenzaTuning from '@/components/visualizer/cadenza/tuning';
import partitaTuning from '@/components/visualizer/partita/tuning';
import { DEFAULT_CADENZA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_PARTITA_TUNING } from '@/types';

// test/unit/visualizer/strokeWriteSvg.test.ts
// DOM 写字（流光 / 云阶 / 心象）的纯函数部分：SVG 字符串、遮罩区域、inline-block 里的字位、笔画来源的状态、
// 一个字的生命周期（不需要真遮罩的那几种状态）、三个样式 handwriting 开关的读写。

describe('ringsToPathData / penToPoints', () => {
    it('closes each ring and skips rings under three points', () => {
        expect(ringsToPathData([[0, 0, 10, 0, 10, 10], [1, 1, 2]])).toBe('M0 0L10 0L10 10Z');
        expect(ringsToPathData([[0, 0, 1, 1]])).toBeNull();
        expect(ringsToPathData([[0, 0, 4, 0, 4, 4], [5, 5, 6, 5, 6, 6, 5, 6]])).toBe('M0 0L4 0L4 4ZM5 5L6 5L6 6L5 6Z');
    });

    it('turns a flat centreline into polyline points, null under two points', () => {
        expect(penToPoints([0, 1, 2, 3, 4, 5])).toBe('0,1 2,3 4,5');
        expect(penToPoints([0, 1])).toBeNull();
    });
});

describe('placeInlineBlockGlyph', () => {
    it('centres on the advance and puts the baseline half the leading below the top plus the ascent', () => {
        expect(placeInlineBlockGlyph({ advance: 40, lineHeight: 60, ascent: 36, descent: 10, fontPx: 40 }))
            .toEqual({ cx: 20, baseline: 7 + 36, fontPx: 40 });
        // line-height smaller than the font box: negative half-leading
        expect(placeInlineBlockGlyph({ advance: 30, lineHeight: 30, ascent: 32, descent: 8, fontPx: 32 }).baseline).toBe(-5 + 32);
    });
});

describe('strokeMaskRegion', () => {
    it('is the outline box in span px, grown by the seam and padding on every side', () => {
        const place = { cx: 20, baseline: 43, fontPx: 40 };
        const { k, tx, ty } = strokeUnitsToWorld(place);
        const r = strokeMaskRegion([100, 200, 1900, 1800], place, 0.5);
        expect(r.k).toBe(k);
        expect(r.tx).toBe(tx);
        expect(r.ty).toBe(ty);
        expect(r.x).toBeCloseTo(tx + 100 * k - 2.5);
        expect(r.y).toBeCloseTo(ty + 200 * k - 2.5);
        expect(r.width).toBeCloseTo(1800 * k + 5);
        expect(r.height).toBeCloseTo(1600 * k + 5);
    });
});

describe('resolveSourceGlyphState', () => {
    const glyph = {} as FontStrokesGlyph;
    const source = (has: boolean): StrokeWriteSource => ({ getStrokes: () => (has ? glyph : null), decisions: new Map() });

    it('leaves non-model chars plain', () => {
        expect(resolveSourceGlyphState(source(true), 'a', 'A', 10.1, 10, 10.5)).toBeNull();
        expect(resolveSourceGlyphState(source(true), 'a', ' ', 10.1, 10, 10.5)).toBeNull();
    });

    it('hides a CJK char before its window, writes inside it, plain after', () => {
        const s = source(true);
        expect(resolveSourceGlyphState(s, 'k', '永', 9.5, 10, 10.5)).toBe('hidden');
        const p = resolveSourceGlyphState(s, 'k', '永', 10.2, 10, 10.5);
        expect(typeof p).toBe('number');
        expect(resolveSourceGlyphState(s, 'k', '永', 11, 10, 10.5)).toBeNull();
    });

    it('freezes a char to plain when its strokes are missing at decision time', () => {
        const box = { has: false };
        const s: StrokeWriteSource = { getStrokes: () => (box.has ? glyph : null), decisions: new Map() };
        expect(resolveSourceGlyphState(s, 'k', '永', 9.5, 10, 10.5)).toBeNull();
        box.has = true;
        expect(resolveSourceGlyphState(s, 'k', '永', 10.2, 10, 10.5)).toBeNull();
        // another key decides afresh
        expect(resolveSourceGlyphState(s, 'k2', '永', 9.5, 10, 10.5)).toBe('hidden');
    });
});

describe('StrokeWriteSlot', () => {
    const fakeEl = () => {
        const props = new Map<string, string>();
        const style = {
            visibility: '',
            willChange: '',
            setProperty: (k: string, v: string) => { props.set(k, v); },
            removeProperty: (k: string) => { props.delete(k); return ''; },
        };
        return { el: { style } as unknown as HTMLElement, props };
    };

    it('hides before the window, falls back to plain with no strokes, and restores on dispose', () => {
        const ink = fakeEl();
        const glow = fakeEl();
        const calls: boolean[] = [];
        const slot = new StrokeWriteSlot('永', { masked: [ink.el], hiddenUntilDone: [glow.el], onWriting: w => calls.push(w) });
        slot.apply('hidden', null);
        expect(ink.el.style.visibility).toBe('hidden');
        expect(glow.el.style.visibility).toBe('hidden');
        // a writing frame without strokes: plain, never masked
        slot.apply(0.3, null);
        expect(slot.writing).toBe(false);
        expect(ink.el.style.visibility).toBe('');
        expect(glow.el.style.visibility).toBe('');
        expect(ink.props.size).toBe(0);
        slot.apply('hidden', null);
        slot.dispose();
        expect(ink.el.style.visibility).toBe('');
        expect(calls).toEqual([]);
    });
});

describe('buildDomGlowFilter', () => {
    it('is none without glow and two drop-shadows otherwise', () => {
        expect(buildDomGlowFilter('#ff0000', 0)).toBe('none');
        const f = buildDomGlowFilter('#ff0000', 1);
        expect(f.match(/drop-shadow\(/g)).toHaveLength(2);
    });
});

describe('handwriting switch in the three tunings', () => {
    const cases = [
        ['classic', classicTuning, DEFAULT_CLASSIC_TUNING],
        ['cadenza', cadenzaTuning, DEFAULT_CADENZA_TUNING],
        ['partita', partitaTuning, DEFAULT_PARTITA_TUNING],
    ] as const;

    it.each(cases)('%s: off by default, read as a strict boolean, kept and changed by merge', (_name, def, defaults) => {
        const storage = (def as unknown as { storage: { read: (s: object) => { handwriting?: boolean }; merge: (h: object, p: object) => { handwriting?: boolean } } }).storage;
        expect(defaults.handwriting).toBe(false);
        expect(storage.read({}).handwriting).toBe(false);
        expect(storage.read({ handwriting: 'yes' }).handwriting).toBe(false);
        const on = storage.read({ handwriting: true });
        expect(on.handwriting).toBe(true);
        expect(storage.merge(on, {}).handwriting).toBe(true);
        expect(storage.merge(on, { handwriting: false }).handwriting).toBe(false);
    });
});
