import type { Filter } from 'pixi.js';

// src/components/visualizer/sonnet/sonnetGlitchFilter.ts
// Creates a monochrome-safe horizontal slice/tear filter for brief glitch-art transitions.
type PixiModule = typeof import('pixi.js');

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform float uAmount;
uniform float uSeed;

float hash(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
    float coarseBand = floor(vTextureCoord.y * 26.0);
    float fineBand = floor(vTextureCoord.y * 110.0);
    float coarseNoise = hash(vec2(coarseBand, uSeed));
    float fineNoise = hash(vec2(fineBand + 41.0, uSeed * 1.37));
    float coarseGate = step(0.58, coarseNoise);
    float fineGate = step(0.88, fineNoise);
    float coarseShift = (hash(vec2(coarseBand + 17.0, uSeed)) * 2.0 - 1.0)
        * coarseGate * uAmount * 0.095;
    float fineShift = (hash(vec2(fineBand + 73.0, uSeed)) * 2.0 - 1.0)
        * fineGate * uAmount * 0.035;
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
        padding: 40,
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
