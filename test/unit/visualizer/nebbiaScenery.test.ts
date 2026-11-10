import { describe, expect, it } from 'vitest';
import { normalizeNebbiaTuning } from '@/components/visualizer/nebbia/tuning';
import { nebbiaFrameUniforms } from '@/components/visualizer/nebbia/nebbiaFrameUniforms';
import { DEFAULT_NEBBIA_TUNING, NEBBIA_SCENERY } from '@/components/visualizer/nebbia/types';
import type { NebbiaSpot } from '@/components/visualizer/nebbia/nebbiaSpot';
import { nebbiaSeesThrough } from '@/components/visualizer/nebbia/nebbiaBehind';

// test/unit/visualizer/nebbiaScenery.test.ts
// 雾笺窗外的开关和雨：存着的值怎么读回来（可以全关，旧的没有这项就全开、雨斜着），和交给着色器的位、聚光灯强度；
// 窗外是街景还是共用背景，播放页透明时总是透出后面。

const spot = { x: 100, y: 100, r: 50, i: 1 } as unknown as NebbiaSpot;
const uniforms = (scenery: typeof DEFAULT_NEBBIA_TUNING.scenery) => (
    nebbiaFrameUniforms({ ...DEFAULT_NEBBIA_TUNING, scenery }, [0, 0], spot, 800, 600, 0)
);

describe('nebbia scenery toggles', () => {
    it('opens every part for a tuning saved before the toggles existed', () => {
        expect(normalizeNebbiaTuning({ mist: 0.5 }).scenery).toEqual([...NEBBIA_SCENERY]);
    });

    it('keeps everything off, drops unknown parts and puts the rest in order', () => {
        expect(normalizeNebbiaTuning({ scenery: [] }).scenery).toEqual([]);
        expect(normalizeNebbiaTuning({ scenery: ['road', 'ufo', 'spot'] }).scenery).toEqual(['spot', 'road']);
    });

    it('maps the parts to the shader bits (rain slanted by default) and turns the spotlight off through its intensity', () => {
        const all = uniforms([...NEBBIA_SCENERY]);
        expect(all.scenery).toBe(1 | 2 | 4 | 8 | 16 | 32);
        expect(all.spotI).toBeGreaterThan(0);
        const some = uniforms(['buildings', 'cars']);
        expect(some.scenery).toBe(1 | 4 | 16 | 32);
        expect(some.spotI).toBe(0);
        expect(uniforms([]).scenery).toBe(16 | 32);
    });

    it('reads the rain setting and puts it in the shader bits', () => {
        expect(normalizeNebbiaTuning({}).rain).toBe('slant');
        expect(normalizeNebbiaTuning({ rain: 'straight' }).rain).toBe('straight');
        expect(normalizeNebbiaTuning({ rain: 'hail' }).rain).toBe('slant');
        const bits = (rain: typeof DEFAULT_NEBBIA_TUNING.rain) => (
            nebbiaFrameUniforms({ ...DEFAULT_NEBBIA_TUNING, scenery: [], rain }, [0, 0], spot, 800, 600, 0).scenery
        );
        expect([bits('slant'), bits('straight'), bits('off')]).toEqual([16 | 32, 16, 0]);
    });

    it('reads what is outside the window and sees through for the background or a transparent page', () => {
        expect(normalizeNebbiaTuning({}).behind).toBe('night');
        expect(normalizeNebbiaTuning({ behind: 'backdrop' }).behind).toBe('backdrop');
        expect(normalizeNebbiaTuning({ behind: 'moon' }).behind).toBe('night');
        const night = DEFAULT_NEBBIA_TUNING, backdrop = { ...DEFAULT_NEBBIA_TUNING, behind: 'backdrop' as const };
        expect(nebbiaSeesThrough(night, undefined)).toBe(false);
        expect(nebbiaSeesThrough(night, { transparent: true })).toBe(true);
        expect(nebbiaSeesThrough(backdrop, undefined)).toBe(true);
        // 样式小图把背景标成透明表示不画背景，不算播放页透明
        expect(nebbiaSeesThrough(night, { transparent: true }, true)).toBe(false);
        expect(nebbiaSeesThrough(backdrop, { transparent: true }, true)).toBe(true);
    });

    it('keeps the aquarium as a scene of its own, lit from above the water', () => {
        expect(normalizeNebbiaTuning({ behind: 'aquarium' }).behind).toBe('aquarium');
        const aquarium = { ...DEFAULT_NEBBIA_TUNING, behind: 'aquarium' as const };
        expect(nebbiaSeesThrough(aquarium, undefined)).toBe(false);
        expect(nebbiaSeesThrough(aquarium, { transparent: true })).toBe(true);
        const aqua = { jelly: new Float32Array(96), jellyColor: new Float32Array(96), count: 0, bubbles: 0.6, sway: new Float32Array(4), weedIdle: 1, bursts: new Float32Array(48), burstCount: 0, beatRows: 0, spotScale: 1 };
        const street = nebbiaFrameUniforms(DEFAULT_NEBBIA_TUNING, [0, 0], spot, 800, 600, 0);
        const tank = nebbiaFrameUniforms(aquarium, [0, 0], spot, 800, 600, 0, aqua);
        expect(street.aqua).toBeNull();
        expect(tank.aqua).toBe(aqua);
        expect(tank.spotSrc[1]).toBeLessThan(0);
        expect(street.spotSrc[1]).toBeGreaterThan(0.5);
    });

    it('reads the aquarium sliders within their limits', () => {
        expect(normalizeNebbiaTuning({}).jellies).toBe(DEFAULT_NEBBIA_TUNING.jellies);
        expect(normalizeNebbiaTuning({ jellies: 99, jellySize: 0.1, bubbles: 2 })).toMatchObject({ jellies: 24, jellySize: 0.5, bubbles: 1 });
        expect(normalizeNebbiaTuning({ dew: 9, dewSize: 0, dewGlint: -1 })).toMatchObject({ dew: 1.5, dewSize: 0.5, dewGlint: 0 });
    });

    it('keeps the glass apart from the view outside, pairing it by default', () => {
        expect(normalizeNebbiaTuning({}).glass).toBe('rain');
        // 没存过玻璃的旧 tuning 按窗外的默认搭配
        expect(normalizeNebbiaTuning({ behind: 'aquarium' }).glass).toBe('dew');
        expect(normalizeNebbiaTuning({ behind: 'backdrop' }).glass).toBe('rain');
        // 存过的照存的，可以混搭
        expect(normalizeNebbiaTuning({ behind: 'aquarium', glass: 'rain' }).glass).toBe('rain');
        expect(normalizeNebbiaTuning({ behind: 'night', glass: 'dew' }).glass).toBe('dew');
        expect(normalizeNebbiaTuning({ glass: 'mist' }).glass).toBe('rain');
        expect(nebbiaFrameUniforms({ ...DEFAULT_NEBBIA_TUNING, dewGlint: 1.4 }, [0, 0], spot, 800, 600, 0).dewGlint).toBe(1.4);
    });
});
