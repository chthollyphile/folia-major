import type * as twgl from 'twgl.js';

// src/components/visualizer/backgrounds/tide/tideUniforms.ts
// twgl only accepts a WebGLTexture for a sampler uniform: handed the framebuffer-info object a
// pass reads from it binds nothing and the shader samples black, which freezes the whole
// simulation without a GL error. Passes may keep handing over render targets — the samplers are
// unwrapped to their colour attachment right before twgl sees the uniforms.

/** Render targets carry their textures on `attachments`; everything else is left alone. */
const asTargetTexture = (value: unknown): WebGLTexture | null => {
    const attachments = (value as twgl.FramebufferInfo | null | undefined)?.attachments;

    return Array.isArray(attachments) && attachments.length > 0 ? attachments[0] : null;
};

/** Replaces render-target values with their colour attachment and returns the input when nothing changes. */
export const resolveTideUniforms = (uniforms: Record<string, unknown>): Record<string, unknown> => {
    let resolved: Record<string, unknown> | null = null;

    for (const [name, value] of Object.entries(uniforms)) {
        const texture = asTargetTexture(value);

        if (texture) {
            resolved = resolved ?? { ...uniforms };
            resolved[name] = texture;
        }
    }

    return resolved ?? uniforms;
};
