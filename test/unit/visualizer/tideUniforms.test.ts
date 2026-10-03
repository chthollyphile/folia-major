import { describe, expect, it } from 'vitest';
import { resolveTideUniforms } from '@/components/visualizer/backgrounds/tide/tideUniforms';

// src/.../tide/tideUniforms.ts: twgl silently samples black when a sampler uniform receives a
// framebuffer-info object instead of a texture, so every pass hands its targets through here.
describe('resolveTideUniforms', () => {
    it('unwraps a render target to its colour attachment', () => {
        const texture = {} as WebGLTexture;
        const uniforms = { u_velocity: { attachments: [texture] } };

        expect(resolveTideUniforms(uniforms).u_velocity).toBe(texture);
    });

    it('keeps plain textures, numbers and arrays untouched', () => {
        const texture = {} as WebGLTexture;
        const splats = new Float32Array(16);
        const uniforms = { u_dye: texture, u_dt: 0.016, u_splatPos: splats };

        const resolved = resolveTideUniforms(uniforms);

        expect(resolved).toBe(uniforms);
        expect(resolved.u_dye).toBe(texture);
        expect(resolved.u_dt).toBe(0.016);
        expect(resolved.u_splatPos).toBe(splats);
    });

    it('returns the very same object when there is nothing to unwrap', () => {
        const uniforms = { u_time: 4 };

        expect(resolveTideUniforms(uniforms)).toBe(uniforms);
    });

    it('resolves every target in a mixed uniform set without mutating the input', () => {
        const velocity = {} as WebGLTexture;
        const dye = {} as WebGLTexture;
        const uniforms = { u_velocity: { attachments: [velocity] }, u_dye: { attachments: [dye] }, u_dt: 0.5 };

        const resolved = resolveTideUniforms(uniforms);

        expect(resolved).not.toBe(uniforms);
        expect(resolved.u_velocity).toBe(velocity);
        expect(resolved.u_dye).toBe(dye);
        expect(resolved.u_dt).toBe(0.5);
        expect(uniforms.u_velocity).toEqual({ attachments: [velocity] });
    });
});
