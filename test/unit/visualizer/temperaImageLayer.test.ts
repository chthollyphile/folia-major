import { describe, expect, it, vi } from 'vitest';
import * as pixi from 'pixi.js';
import type { TemperaLayerImage } from '@/types';
import {
    buildTemperaImageLayer,
    resolveTemperaImagePlacement,
    resolveTemperaShotImage,
} from '@/components/visualizer/tempera/temperaImageLayer';

// test/unit/visualizer/temperaImageLayer.test.ts
// Locks how a shot picks a picture out of the pool and where it puts it. Both are pure and
// seed-driven, so a seek repaints the identical frame and one song always composes the same way.
const image = (id: string, overrides: Partial<TemperaLayerImage> = {}): TemperaLayerImage => ({
    id,
    name: `${id}.png`,
    align: 'free',
    verticalAlign: 'bottom',
    scale: 0.7,
    opacity: 1,
    ...overrides,
});

const POOL = [image('a'), image('b'), image('c')];

describe('Tempera shot image selection', () => {
    it('is deterministic for a seed', () => {
        for (let seed = 0; seed < 40; seed += 1) {
            expect(resolveTemperaShotImage(POOL, 1, seed, null))
                .toBe(resolveTemperaShotImage(POOL, 1, seed, null));
        }
    });

    it('never repeats the previous picture while the pool has alternatives', () => {
        for (let seed = 0; seed < 200; seed += 1) {
            const chosen = resolveTemperaShotImage(POOL, 1, seed, 'a');
            if (chosen) expect(chosen.id).not.toBe('a');
        }
    });

    it('still returns the only picture when the pool holds one', () => {
        const single = [image('solo')];
        const chosen = resolveTemperaShotImage(single, 1, 7, 'solo');
        expect(chosen?.id).toBe('solo');
    });

    it('spreads across the pool rather than favouring one entry', () => {
        const counts = new Map<string, number>();
        for (let seed = 0; seed < 300; seed += 1) {
            const chosen = resolveTemperaShotImage(POOL, 1, seed, null);
            if (chosen) counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
        }
        expect(counts.size).toBe(POOL.length);
        counts.forEach(count => expect(count).toBeGreaterThan(40));
    });

    it('honours the appearance rate at both extremes', () => {
        for (let seed = 0; seed < 60; seed += 1) {
            expect(resolveTemperaShotImage(POOL, 0, seed, null)).toBeNull();
            expect(resolveTemperaShotImage(POOL, 1, seed, null)).not.toBeNull();
        }
        const shown = Array.from({ length: 400 }, (_, seed) => resolveTemperaShotImage(POOL, 0.5, seed, null))
            .filter(Boolean).length;
        expect(shown).toBeGreaterThan(120);
        expect(shown).toBeLessThan(280);
    });

    it('returns nothing for an empty pool', () => {
        expect(resolveTemperaShotImage([], 1, 3, null)).toBeNull();
    });
});

describe('Tempera image placement', () => {
    it('keeps each alignment inside its own band', () => {
        const bands: Record<string, [number, number]> = {
            left: [0.14, 0.32],
            center: [0.4, 0.6],
            right: [0.68, 0.86],
            free: [0.12, 0.88],
        };
        (['left', 'center', 'right', 'free'] as const).forEach(align => {
            const [from, to] = bands[align];
            for (let seed = 0; seed < 200; seed += 1) {
                const placement = resolveTemperaImagePlacement(image('a', { align }), seed);
                expect(placement.x, align).toBeGreaterThanOrEqual(from);
                expect(placement.x, align).toBeLessThanOrEqual(to);
            }
        });
    });

    it('varies the exact spot within a band', () => {
        const spots = new Set(Array.from({ length: 50 }, (_, seed) => (
            resolveTemperaImagePlacement(image('a', { align: 'left' }), seed).x.toFixed(4)
        )));
        expect(spots.size).toBeGreaterThan(20);
    });

    it('keeps each vertical alignment inside its own band', () => {
        const bands: Record<string, [number, number]> = {
            top: [0.14, 0.32],
            center: [0.4, 0.6],
            bottom: [0.68, 0.86],
            free: [0.12, 0.88],
        };
        (['top', 'center', 'bottom', 'free'] as const).forEach(verticalAlign => {
            const [from, to] = bands[verticalAlign];
            for (let seed = 0; seed < 200; seed += 1) {
                const placement = resolveTemperaImagePlacement(image('a', { verticalAlign }), seed);
                expect(placement.y, verticalAlign).toBeGreaterThanOrEqual(from);
                expect(placement.y, verticalAlign).toBeLessThanOrEqual(to);
            }
        });
    });

    it('keeps the default image low in the frame and barely tilts it', () => {
        for (let seed = 0; seed < 200; seed += 1) {
            const placement = resolveTemperaImagePlacement(image('a'), seed);
            expect(placement.y).toBeGreaterThanOrEqual(0.68);
            expect(placement.y).toBeLessThanOrEqual(0.86);
            expect(Math.abs(placement.rotation)).toBeLessThanOrEqual(0.04);
        }
    });

    it('jitters the size around the configured scale without running away', () => {
        for (let seed = 0; seed < 200; seed += 1) {
            const placement = resolveTemperaImagePlacement(image('a', { scale: 0.8 }), seed);
            expect(placement.scale).toBeGreaterThanOrEqual(0.8 * 0.9);
            expect(placement.scale).toBeLessThanOrEqual(0.8 * 1.1);
        }
    });

    it('is deterministic and mirrors roughly half the time', () => {
        expect(resolveTemperaImagePlacement(image('a'), 11)).toEqual(resolveTemperaImagePlacement(image('a'), 11));
        const flipped = Array.from({ length: 300 }, (_, seed) => (
            resolveTemperaImagePlacement(image('a'), seed).flip
        )).filter(Boolean).length;
        expect(flipped).toBeGreaterThan(90);
        expect(flipped).toBeLessThan(210);
    });
});

describe('Tempera image depth blur bake', () => {
    // A baker that only counts: the real one renders through the GPU (temperaDepth.ts).
    const fakeBaker = () => ({
        bake: vi.fn(() => ({ texture: new pixi.Texture(), anchorX: 0.5, anchorY: 0.5 })),
        release: vi.fn(),
    });
    const build = (pool: TemperaLayerImage[], baker: ReturnType<typeof fakeBaker>) => buildTemperaImageLayer(pixi, {
        pool,
        frequency: 1,
        depth: 'back',
        textures: new Map(pool.map(entry => [entry.id, new pixi.Texture({ source: new pixi.TextureSource({ width: 100, height: 200 }) })])),
        width: 1280,
        height: 720,
        seed: 5,
        flowAngle: 0,
        previousId: null,
        blur: { baker, back: 1.6, front: 6 },
    });

    it('bakes once per placement and keeps the bake while only the opacity moves', () => {
        const baker = fakeBaker();
        const pool = [image('a')];
        const layer = build(pool, baker);
        expect(baker.bake).toHaveBeenCalledTimes(1);
        layer.applyPool(pool);
        layer.applyPool([image('a', { opacity: 0.4 })]);
        expect(baker.bake).toHaveBeenCalledTimes(1);
        expect(baker.release).not.toHaveBeenCalled();
    });

    it('bakes again, and frees the old bake, when the size changes', () => {
        const baker = fakeBaker();
        const layer = build([image('a')], baker);
        layer.applyPool([image('a', { scale: 0.9 })]);
        expect(baker.bake).toHaveBeenCalledTimes(2);
        expect(baker.release).toHaveBeenCalledTimes(1);
    });
});
