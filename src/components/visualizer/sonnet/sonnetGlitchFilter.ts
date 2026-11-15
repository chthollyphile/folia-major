import type { Filter } from 'pixi.js';
import { PIXI_FILTER_VERTEX as vertex } from '../pixiFilterVertex';

// src/components/visualizer/sonnet/sonnetGlitchFilter.ts
// Creates a monochrome-safe horizontal slice/tear filter for brief glitch-art transitions.
type PixiModule = typeof import('pixi.js');

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec4 uInputClamp;
uniform float uAmount;
uniform float uSeed;

float hash(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
    // Bands and shifts are laid out on the viewport (the filter area), not on the pooled texture:
    // its power-of-two size changes with the pass resolution, and the tear changed with it. The
    // counts and widths are what a 1920x1080 window showed at resolution 1.
    vec2 frameSize = max(uOutputFrame.zw, vec2(1.0));
    float screenY = vTextureCoord.y * uInputSize.y / frameSize.y;
    float shiftToUv = frameSize.x * uInputSize.z;
    float coarseBand = floor(screenY * 14.0);
    float fineBand = floor(screenY * 58.0);
    float coarseNoise = hash(vec2(coarseBand, uSeed));
    float fineNoise = hash(vec2(fineBand + 41.0, uSeed * 1.37));
    float coarseGate = step(0.58, coarseNoise);
    float fineGate = step(0.88, fineNoise);
    float coarseShift = (hash(vec2(coarseBand + 17.0, uSeed)) * 2.0 - 1.0)
        * coarseGate * uAmount * 0.1 * shiftToUv;
    float fineShift = (hash(vec2(fineBand + 73.0, uSeed)) * 2.0 - 1.0)
        * fineGate * uAmount * 0.037 * shiftToUv;
    vec2 sampleUv = vec2(vTextureCoord.x + coarseShift + fineShift, vTextureCoord.y);
    vec4 color = texture(uTexture, clamp(sampleUv, uInputClamp.xy, uInputClamp.zw));

    // Brightness tears affect every color channel equally: glitch structure without RGB dispersion.
    float tear = (coarseGate * (coarseNoise - 0.58) + fineGate * 0.12) * uAmount;
    color.rgb *= 1.0 + tear * 0.42;
    finalColor = color;
}
`;

export interface SonnetGlitchEffect {
    filter: Filter;
    update: (amount: number, seed: number) => void;
}

export const createSonnetGlitchEffect = (pixi: PixiModule): SonnetGlitchEffect => {
    const uniforms = new pixi.UniformGroup({
        uAmount: { value: 0, type: 'f32' },
        uSeed: { value: 0, type: 'f32' },
    });
    const filter = new pixi.Filter({
        glProgram: pixi.GlProgram.from({ vertex, fragment, name: 'sonnet-mono-glitch' }),
        resources: { glitchUniforms: uniforms },
        // padding must stay 0: Pixi sums the padding of every enabled filter in the chain and
        // grows the shared render frame *after* clipping it to the viewport, so padding here only
        // ever adds off-screen pixels — while shifting the frame that the scene's vignette pass
        // derives its screen coordinates from, which made the vignette pop outward on every glitch
        // transition. The tear samples with uInputClamp, so it never needs the extra margin.
        padding: 0,
        // Pixi's defaults (resolution 1, antialias off) would redraw the whole scene at one pixel per
        // CSS pixel, unsmoothed, for as long as the tear is on, whatever the canvas runs at: follow
        // the surface instead. The scene builder raises the antialiasing to match its other passes.
        resolution: 'inherit',
        antialias: 'inherit',
    });
    filter.enabled = false;
    return {
        filter,
        update: (amount, seed) => {
            uniforms.uniforms.uAmount = amount;
            uniforms.uniforms.uSeed = seed;
        },
    };
};
