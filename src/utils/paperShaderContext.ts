// src/utils/paperShaderContext.ts
// Context options for full-screen paper-shaders backgrounds.

/**
 * The paper shaders draw one full-screen quad with no depth test, so WebGL's default 4x MSAA
 * and depth buffer only cost memory (about 72 MB for the two latent layers at 1280x720) and a
 * resolve per frame. readPixels output with and without them is identical, channel for channel.
 * paper-shaders reads this once, when the context is created.
 */
export const PAPER_SHADER_CONTEXT_ATTRIBUTES: WebGLContextAttributes = Object.freeze({
    antialias: false,
    depth: false,
});
