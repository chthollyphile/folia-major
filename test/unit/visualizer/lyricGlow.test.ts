import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionValue } from 'framer-motion';
import * as pixi from 'pixi.js';
import type { Line, Theme } from '@/types';
import { parseColorChannels, resolveGlowColorStrength } from '@/components/visualizer/colorMix';
import { buildSonnetTextView } from '@/components/visualizer/sonnet/sonnetTextViewBuilder';
import type { SonnetTypographyPlacement } from '@/components/visualizer/sonnet/sonnetTypographyLayout';
import { createLatticeLineView } from '@/components/app/lattice/lyrics/latticeLyricScene';
import { layoutLatticeLine, type LatticeTypography } from '@/components/app/lattice/lyrics/latticeLyricLayout';
import type { LatticeLyricInput } from '@/components/app/lattice/lyrics/types';

// Exercises real Pixi display trees; only canvas rasterization and GPU capability probing are stubbed.
const cleanups: (() => void)[] = [];
const theme: Theme = {
    name: 'glow', primaryColor: '#ffffff', accentColor: '#ffffff',
    secondaryColor: '#ffffff', backgroundColor: '#ffffff',
    fontStyle: 'sans', animationIntensity: 'normal',
};

beforeEach(() => {
    vi.spyOn(pixi.DOMAdapter.get(), 'createCanvas').mockReturnValue({
        getContext: () => null,
    } as unknown as HTMLCanvasElement);
});

afterEach(() => {
    cleanups.splice(0).forEach(destroy => destroy());
    vi.restoreAllMocks();
});

function sonnet(colors: Partial<Theme>, role: SonnetTypographyPlacement['role'] = 'hero', glowEnabled = true) {
    const root = new pixi.Container();
    const [guideLayer, haloLayer, textLayer, caLayer] = Array.from({ length: 4 }, () => new pixi.Container());
    root.addChild(guideLayer, haloLayer, textLayer, caLayer);
    cleanups.push(() => root.destroy({ children: true }));
    const view = buildSonnetTextView(pixi, {
        segment: {
            text: 'Glow', startOffset: 0, endOffset: 4, startTime: 0, endTime: 1,
            wordIndices: [0], isWordLike: true,
            graphemes: Array.from('Glow', (char, index) => ({ char, startTime: index / 4, endTime: (index + 1) / 4 })),
        },
        placement: {
            segmentIndex: 0, displayText: 'Glow', role, fontScale: 1,
            measuredWidth: 120, measuredHeight: 60, x: 100, y: 80,
            rotation: 0, enterX: 0, enterY: 60, vertical: false,
            layoutDirection: 'horizontal', timingPhase: 0.5,
        },
        segmentIndex: 0, baseFontSize: 60, shotStartTime: 0, shotEndTime: 4,
        paragraphKind: 'verse', width: 800, fontFamily: 'sans-serif',
        theme: { ...theme, ...colors }, glowEnabled, showFixedGeo: false,
        guideLayer, haloLayer, textLayer, caLayer,
    });
    const text = view.glyphs.map(glyph => glyph.display.children.find(child => child instanceof pixi.Text) as pixi.Text);
    return { view, text };
}

const typography: LatticeTypography = {
    fontPx: 40, font: '40px sans-serif', translationPx: 20, translationFont: '20px sans-serif',
    lineHeight: 48, translationLineHeight: 27, showTranslation: true, padding: 24,
};

function lattice(colors: Partial<Theme>, isChorus = false) {
    const line: Line = {
        fullText: 'Glow', startTime: 0, endTime: 3, isChorus, translation: '光',
        words: [{ text: 'Glow', startTime: 0, endTime: 1 }],
    };
    const input: LatticeLyricInput = {
        songKey: 'test', currentTime: motionValue(0), currentLineIndex: 0, lines: [line],
        theme: { ...theme, ...colors }, keywordColoringEnabled: true,
        reducedMotion: false, fontsEpoch: 0,
    };
    const measure = (text: string) => ({ width: text.length * 20, height: 40 });
    const raster = {
        measure, clearMeasureCache() {},
        rasterize() {
            return {
                texture: new pixi.Texture({ source: new pixi.TextureSource({ width: 100, height: 60 }) }),
                width: 100, height: 60, pad: 10,
            };
        },
    };
    const parent = new pixi.Container();
    const view = createLatticeLineView(pixi, raster, parent, {
        key: 'line', line, index: 0, offset: 0, status: 'active',
    }, layoutLatticeLine(line, typography, 500, measure, false), typography, input, 1);
    cleanups.push(() => { view.destroy(); parent.destroy(); });
    const [far, near, text] = view.container.children as pixi.Container[];
    const update = (time: number, status: 'active' | 'waiting' | 'passed' = 'active', quiet = false) =>
        view.update(time, status, 0.34, 500, 0, 1, quiet);
    return { far, near, text, update };
}

describe('Sonnet lyric glow', () => {
    it('removes dark shadows without changing glyph fill, padding, positions or timing', () => {
        const dark = sonnet({ primaryColor: '#111111' });
        const bright = sonnet({});
        expect(dark.text).toHaveLength(4);
        for (const glyph of dark.text) {
            expect(glyph.style.dropShadow).toBeUndefined();
            expect(glyph.style.fill).toBe('#111111');
            expect(glyph.style.padding).toBe(bright.text[0].style.padding);
            expect(glyph.style.padding).toBeGreaterThan(0);
        }
        const layout = (value: ReturnType<typeof sonnet>) => value.view.glyphs.map(glyph => ({
            x: glyph.baseX, y: glyph.baseY, start: glyph.startTime, settle: glyph.settleTime,
        }));
        expect(layout(dark)).toEqual(layout(bright));
        expect(bright.text[0].style.dropShadow).toMatchObject({ color: '#ffffff', alpha: 0.8 });
    });

    it.each([
        ['hero', { primaryColor: '#ffffff', wordColors: [{ word: 'glow', color: '#111111' }] }, false],
        ['hero', { primaryColor: '#111111', wordColors: [{ word: 'glow', color: '#ffffff' }] }, true],
        ['support', { primaryColor: '#ffffff', accentColor: '#111111' }, false],
        ['support', { primaryColor: '#111111', accentColor: '#ffffff' }, true],
    ] as const)('uses the selected keyword or accent color for %s', (role, colors, glowing) => {
        const { text } = sonnet({ ...colors, wordColors: 'wordColors' in colors ? [...colors.wordColors] : undefined }, role);
        expect(Boolean(text[0].style.dropShadow)).toBe(glowing);
        if (glowing) expect(text[0].style.dropShadow?.alpha).toBe(0.8);
    });

    it('keeps the glow toggle and decoration roles shadow-free', () => {
        const disabled = sonnet({}, 'hero', false);
        const decoration = sonnet({}, 'decoration');
        expect(disabled.text[0].style.dropShadow).toBeUndefined();
        expect(decoration.text[0].style.dropShadow).toBeUndefined();
        expect(disabled.text[0].style.padding).toBe(0);
        expect(decoration.text[0].style.padding).toBe(0);
    });
});

describe('glow color strength', () => {
    it.each([[0, 0], [110, 0], [135, 0.5], [160, 1], [255, 1]])(
        'maps grayscale %s to strength %s', (channel, strength) => {
            expect(resolveGlowColorStrength(channel, channel, channel)).toBeCloseTo(strength);
        },
    );

    it.each([['#ef4444', 1], ['#2563eb', 1], ['#101828', 0], ['#111827', 0]])(
        'gates %s on its brightest channel, not luma', (hex, strength) => {
            const { r, g, b } = parseColorChannels(hex)!;
            expect(resolveGlowColorStrength(r, g, b)).toBeCloseTo(strength);
        },
    );
});

describe('Lattice lyric glow', () => {
    it('follows the actual animated tint from a dark base to a bright keyword', () => {
        const view = lattice({ primaryColor: '#000000', wordColors: [{ word: 'Glow', color: '#ffffff' }] });
        view.update(0.295);
        expect((view.near.children[0] as pixi.Sprite).tint).toBe(0x282828);
        expect(view.near.children[0].alpha).toBe(0);
        expect(view.near.renderable).toBe(false);
        expect(view.far.renderable).toBe(false);
        view.update(1.18);
        expect((view.near.children[0] as pixi.Sprite).tint).toBe(0xffffff);
        expect(view.near.children[0].alpha).toBeCloseTo(0.88);
        expect(view.near.renderable).toBe(true);
    });

    it('also suppresses a dark keyword reached from a bright base', () => {
        const view = lattice({ wordColors: [{ word: 'Glow', color: '#000000' }] });
        view.update(0.295);
        expect(view.near.children[0].alpha).toBeGreaterThan(0);
        view.update(1.18);
        expect((view.near.children[0] as pixi.Sprite).tint).toBe(0);
        expect(view.near.children[0].alpha).toBe(0);
        expect(view.near.renderable).toBe(false);
    });

    it('keeps a saturated keyword glowing at its peak on a light dark-theme base', () => {
        const view = lattice({ primaryColor: '#f8fafc', wordColors: [{ word: 'Glow', color: '#ef4444' }] });
        view.update(1.18);
        expect((view.near.children[0] as pixi.Sprite).tint).toBe(0xef4444);
        expect(view.near.children[0].alpha).toBeGreaterThan(0.8);
        expect(view.near.renderable).toBe(true);
        expect(view.far.renderable).toBe(true);
    });

    it.each([false, true])('preserves bright glow strength, translation and quiet/waiting behavior (chorus=%s)', chorus => {
        const view = lattice({}, chorus);
        view.update(0.59);
        expect(view.near.children[0].alpha).toBeCloseTo(0.5 * (chorus ? 1 : 0.88));
        expect(view.far.children[0].alpha).toBe(view.near.children[0].alpha);
        expect(view.text.children).toHaveLength(2);
        expect(view.near.children[1].alpha).toBe(0);
        const translation = view.text.children[1] as pixi.Mesh;
        expect(translation.shader?.resources.sweepUniforms.uniforms.uBase[3]).toBe(0.68);
        view.update(1.18, 'active', true);
        expect(view.near.children[0].alpha).toBe(0);
        expect(view.near.renderable).toBe(false);
        view.update(1.18, 'waiting');
        expect(view.near.children[0].alpha).toBe(0);
        expect(view.text.children).toHaveLength(1);
        view.update(1.18);
        expect(view.near.children[0].alpha).toBeCloseTo(chorus ? 1 : 0.88);
        expect(view.text.children).toHaveLength(2);
    });
});
