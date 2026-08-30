// src/components/visualizer/loadPixi.ts
// The single place a visualizer pulls Pixi in, so the shader precision default is raised before
// the first program is compiled.
//
// Pixi injects `precision mediump float;` into every fragment shader that does not declare its
// own (`GlProgram.defaultOptions.preferredFragmentPrecision`). On Windows and on Intel/Mesa that
// costs nothing - their drivers report mediump as 127/127/23, i.e. it already *is* fp32. The
// NVIDIA Linux driver is the one that takes the qualifier literally: Chromium reaches it through
// ANGLE on a native `OpenGL ES 3.2` context, and there mediump is real fp16 (getShaderPrecision-
// Format reports 15/15/10, max finite value 65504).
//
// That difference is not cosmetic. Pixi's own NoiseFilter - the grain pass in tempera's and
// sonnet's post-process chains - computes `fract(sin(dot(gl_FragCoord.xy * uSeed, vec2(12.9898,
// 78.233))) * 43758.5453)`. The dot product grows linearly with the pixel coordinate, so past
// roughly `65504 / uSeed` it overflows fp16 to Inf, `sin(Inf)` is NaN, and every pixel beyond
// that line is written as black. Because the overflow condition is linear in x and y, the
// boundary is a straight line across the frame: the black triangle reported on Linux + NVIDIA,
// growing with textureResolution because `gl_FragCoord` grows with it, and varying per scene
// because `uSeed` is derived from the scene seed. Capping the post-process resolution only moves
// the seed threshold - at pass resolution 1.0 a seed of 0.95 still overflows on a 1280x720 frame.
//
// highp is fp32 on every device that can run this app: GLSL ES 3.00 requires fragment highp, and
// Pixi 8 is WebGL2/WebGPU only. `ensurePrecision` still downgrades to mediump if a device somehow
// reports no highp support, which is exactly today's behaviour, so nothing can get worse. Shaders
// that declare their own precision line are left alone.
type PixiModule = typeof import('pixi.js');

/**
 * Must be awaited before any renderer, filter or shader is constructed: `GlProgram.from` caches
 * compiled sources, so a program built before the flip would keep its mediump variant.
 */
export const loadPixi = async (): Promise<PixiModule> => {
    const pixi = await import('pixi.js');
    pixi.GlProgram.defaultOptions.preferredFragmentPrecision = 'highp';
    return pixi;
};
