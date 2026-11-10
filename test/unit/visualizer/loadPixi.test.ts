import { describe, expect, it, vi } from 'vitest';

// test/unit/visualizer/loadPixi.test.ts
// The precision default is the whole reason this loader exists: Pixi injects `precision mediump
// float;` into any fragment shader without its own precision line, and the NVIDIA Linux driver
// honours that as real fp16 - which overflows NoiseFilter's `dot(gl_FragCoord.xy * uSeed, ...)`
// to NaN and paints a black wedge across the frame. Guard the flip so it cannot be dropped.
const glProgram = { defaultOptions: {} as { preferredFragmentPrecision?: string } };
const installCompat = vi.fn();

vi.mock('pixi.js', () => ({ GlProgram: glProgram }));
vi.mock('@/components/visualizer/pixi/pixiFilterPoolCompat', () => ({ installPixiFilterPoolCompat: installCompat }));

describe('loadPixi', () => {
    it('raises the fragment shader precision default to highp', async () => {
        const { loadPixi } = await import('@/components/visualizer/pixi/loadPixi');

        expect(glProgram.defaultOptions.preferredFragmentPrecision).toBeUndefined();

        const pixi = await loadPixi();

        expect(glProgram.defaultOptions.preferredFragmentPrecision).toBe('highp');
        expect(pixi.GlProgram).toBe(glProgram);
        expect(installCompat).toHaveBeenCalledWith(pixi);
    });
});
