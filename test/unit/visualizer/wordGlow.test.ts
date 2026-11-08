import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { wordGlowVariants } from '@/components/visualizer/wordGlow';
import {
    clearCanvasTextGlow,
    fillGlowText,
    quantizeShadowBlur,
    setCanvasTextGlow,
    setGlowBlurQuantized,
} from '@/utils/glowBlurQuantize';

// test/unit/visualizer/wordGlow.test.ts
// Guards Lab > "Fix lyric animation freeze on Linux" (utils/glowBlurQuantize.ts): while it is on, an
// animated glow must not sweep a glyph shadow's blur radius. A radius that changes every frame leaked a
// shared-memory fd in the renderer and GPU process about every thousand distinct radii on Linux,
// until the compositor stopped producing frames. On, the word glow is a `filter: drop-shadow()`
// (compositor, no glyph cache) and canvas radii are whole pixels. Off, the text-shadow halo stays at
// its peak radii and only opacity animates, so glowing glyphs are not re-rastered every frame.

type Target = { color?: string; textShadow?: unknown; filter?: unknown; opacity?: unknown; transition: { ease?: unknown } };
const active = (custom: Record<string, unknown>) => (
    (wordGlowVariants.active as unknown as (c: unknown) => Target)(custom)
);
const waiting = (custom: Record<string, unknown>) => (
    (wordGlowVariants.waiting as unknown as (c: unknown) => Target)(custom)
);
const passed = (custom: Record<string, unknown>) => (
    (wordGlowVariants.passed as unknown as (c: unknown) => Target)(custom)
);
const CUSTOMS = [
    { activeColor: '#ffd54f', wordRevealMode: 'instant', duration: 0.1 },
    { activeColor: '#ffd54f', wordRevealMode: 'fast', duration: 0.15 },
    { activeColor: '#ffd54f', wordRevealMode: 'normal', duration: 0.6, index: 1, total: 3 },
    { activeColor: '#ffd54f', wordRevealMode: 'normal', duration: 0.6 },
];

afterEach(() => { setGlowBlurQuantized(false); });

describe('stepped glow radius', () => {
    it('keeps the text-shadow halo fixed and ramps opacity when the switch is off', () => {
        setGlowBlurQuantized(false);
        const targets = CUSTOMS.map(active);
        expect(targets.map(target => target.transition.ease)).toEqual(['easeOut', 'easeInOut', 'easeInOut', 'easeInOut']);
        // A text-shadow that changes re-rasters the glyph every frame; the halo is one fixed string
        // per mode, the same in waiting, active and passed, and only opacity moves.
        const halos = ['0 0 14px #ffd54f, 0 0 24px #ffd54f', '0 0 18px #ffd54f, 0 0 32px #ffd54f', '0 0 20px #ffd54f, 0 0 40px #ffd54f', '0 0 20px #ffd54f, 0 0 40px #ffd54f'];
        targets.forEach((target, i) => {
            expect(target.color).toBe('transparent');
            expect(target.filter).toBeUndefined();
            expect(target.textShadow).toBe(halos[i]);
            expect(waiting(CUSTOMS[i]).textShadow).toBe(halos[i]);
            expect(passed(CUSTOMS[i]).textShadow).toBe(halos[i]);
        });
        expect(targets.map(target => target.opacity)).toEqual([[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 1]]);
        expect(waiting(CUSTOMS[0]).opacity).toBe(0);
        expect(passed(CUSTOMS[0]).opacity).toBe(0);
    });

    it('draws the glow as a drop-shadow filter, never a text-shadow, when the switch is on', () => {
        setGlowBlurQuantized(true);
        const targets = [...CUSTOMS.map(active), passed({ activeColor: '#ffd54f', wordRevealMode: 'normal' })];
        for (const target of targets) {
            expect(target.textShadow).toBeUndefined();
            const filters = ([] as unknown[]).concat(target.filter);
            for (const filter of filters) expect(filter).toMatch(/^drop-shadow\(.*\) drop-shadow\(.*\)$/);
        }
        // The layer carries the glyph in colour (drop-shadow shadows what is painted), and opacity
        // ramps with the radius the way `none` used to ramp the shadow colour.
        const sustained = active(CUSTOMS[3]);
        expect(sustained.color).toBe('#ffd54f');
        expect(sustained.opacity).toEqual([0, 1, 1]);
        expect(sustained.filter).toEqual([
            'drop-shadow(0 0 0px rgba(255, 213, 79, 0.7)) drop-shadow(0 0 0px #ffd54f)',
            'drop-shadow(0 0 8px rgba(255, 213, 79, 0.7)) drop-shadow(0 0 16px #ffd54f)',
            'drop-shadow(0 0 8px rgba(255, 213, 79, 0.7)) drop-shadow(0 0 16px #ffd54f)',
        ]);
        // Fading out, the glyph keeps its colour: framer would otherwise reset `color` to the
        // transparent `waiting` value at once, and a transparent glyph casts no drop-shadow.
        const fade = passed({ activeColor: '#ffd54f' });
        expect(fade.opacity).toBe(0);
        expect(fade.color).toBe('#ffd54f');
    });

    it('keeps a colour it cannot parse instead of turning the inner halo white', () => {
        setGlowBlurQuantized(true);
        const filters = active({ ...CUSTOMS[3], activeColor: 'hsl(40 100% 60%)' }).filter as string[];
        expect(filters[1]).toBe('drop-shadow(0 0 8px hsl(40 100% 60%)) drop-shadow(0 0 16px hsl(40 100% 60%))');
    });

    it('rounds canvas blur radii only while the switch is on', () => {
        setGlowBlurQuantized(false);
        expect(quantizeShadowBlur(19.6)).toBe(19.6);

        setGlowBlurQuantized(true);
        expect(quantizeShadowBlur(19.6)).toBe(20);
        expect(quantizeShadowBlur(-3)).toBe(0);
        expect(quantizeShadowBlur(Number.NaN)).toBe(0);
        const sweep = new Set(Array.from({ length: 10_000 }, (_, i) => quantizeShadowBlur((i / 10_000) * 60)));
        expect(sweep.size).toBeLessThanOrEqual(61);
    });

    it('draws canvas text glow as a drop-shadow filter while the switch is on', () => {
        const context = { shadowBlur: 0, shadowColor: 'transparent', filter: 'none' } as CanvasRenderingContext2D;

        setGlowBlurQuantized(false);
        setCanvasTextGlow(context, 12, 'red');
        expect([context.shadowBlur, context.shadowColor, context.filter]).toEqual([12, 'red', 'none']);
        clearCanvasTextGlow(context);
        expect([context.shadowBlur, context.shadowColor]).toEqual([0, 'transparent']);

        setGlowBlurQuantized(true);
        setCanvasTextGlow(context, 12, 'red');
        // Canvas shadowBlur is two sigmas, a drop-shadow length one.
        expect([context.shadowBlur, context.filter]).toEqual([0, 'drop-shadow(0 0 6px red)']);
        clearCanvasTextGlow(context);
        expect(context.filter).toBe('none');
    });

    it('clips glow text to its glow only while the glow is a filter', () => {
        const calls: string[] = [];
        const context = {
            filter: 'none',
            measureText: () => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 100, actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 10 }),
            fillText: () => calls.push('fillText'),
            save: () => calls.push('save'),
            restore: () => calls.push('restore'),
            beginPath: () => {},
            rect: (...args: number[]) => calls.push(`rect ${args.join(',')}`),
            clip: () => calls.push('clip'),
        } as unknown as CanvasRenderingContext2D;

        fillGlowText(context, 'a', 10, 50);
        expect(calls).toEqual(['fillText']);

        calls.length = 0;
        context.filter = 'drop-shadow(0 0 5px red)';
        fillGlowText(context, 'a', 10, 50);
        // Padded by four sigmas plus 4px on every side.
        expect(calls).toEqual(['save', 'rect -14,-4,148,88', 'clip', 'fillText', 'restore']);
    });

    it('has no text-shadow keyframes outside the switched glow module', () => {
        // framer-motion interpolates `textShadow: ['none', '0 0 20px c', ...]` radius and all. The one
        // place allowed to do it is wordGlow.ts, which only does so while the switch is off.
        const root = path.resolve(__dirname, '../../../src/components/visualizer');
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name !== 'wordGlow.ts' && /\.(tsx?|mjs)$/.test(entry.name)
                    && /textShadow:\s*\[/.test(fs.readFileSync(full, 'utf8'))) {
                    offenders.push(path.relative(root, full));
                }
            }
        };
        walk(root);
        expect(offenders).toEqual([]);
    });
});
