import type { Filter, UniformGroup } from 'pixi.js';

// src/components/app/lattice/lyrics/latticeLyricFilters.ts
type Pixi = typeof import('pixi.js');
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;
const header = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
`;
const sweep = header + `
uniform vec4 uBase;
uniform vec4 uWord;
uniform float uProgress;
uniform float uFront;
uniform float uSoftness;
uniform float uPassed;
uniform vec2 uGlyphRange;
uniform vec2 uVerticalFade;
void main() {
    float glyphAlpha = texture(uTexture, vTextureCoord).a;
    float x = vTextureCoord.x * uInputSize.x / max(1.0, uOutputFrame.z);
    float start = uFront - uSoftness;
    float middle = uFront - uSoftness * 0.55;
    float mask = x < middle ? mix(1.0, 0.92, clamp((x - start) / max(0.00001, middle - start), 0.0, 1.0))
        : mix(0.92, 0.0, clamp((x - middle) / max(0.00001, uFront - middle), 0.0, 1.0));
    float along = clamp((x - uGlyphRange.x) / max(0.00001, uGlyphRange.y), 0.0, 1.0);
    float gradient = along < 0.68 ? mix(1.0, 0.92, along / 0.68) : mix(0.92, 0.72, (along - 0.68) / 0.32);
    vec4 base = mix(uBase, uWord, uPassed);
    // Monet's mixColors uses opaque RGB for the leading fill, then fades its trailing alpha.
    vec3 ink = mix(uBase.rgb, uWord.rgb, uProgress);
    float alpha = mask * gradient * step(0.000001, uProgress) * (1.0 - uPassed);
    float y = vTextureCoord.y * uInputSize.y / max(1.0, uOutputFrame.w);
    float vertical = 1.0 - smoothstep(uVerticalFade.x, uVerticalFade.y, y);
    finalColor = vec4(ink * alpha + base.rgb * base.a * (1.0 - alpha), alpha + base.a * (1.0 - alpha)) * glyphAlpha * vertical;
}`;
const fade = header + `
uniform vec2 uFade;
void main() {
    vec2 uv = vTextureCoord * uInputSize.xy / max(uOutputFrame.zw, vec2(1.0));
    float edge = smoothstep(0.0, uFade.y, uv.y) * smoothstep(0.0, uFade.y, 1.0 - uv.y)
        * smoothstep(0.0, uFade.x, uv.x) * smoothstep(0.0, uFade.x, 1.0 - uv.x);
    finalColor = texture(uTexture, vTextureCoord) * edge;
}`;

export function createLatticeSweepFilter(pixi: Pixi, base: number[], word: number[]) {
    const group = new pixi.UniformGroup({
        uBase: { value: base, type: 'vec4<f32>' }, uWord: { value: word, type: 'vec4<f32>' },
        uProgress: { value: 0, type: 'f32' }, uFront: { value: 0, type: 'f32' },
        uSoftness: { value: 0.1, type: 'f32' }, uPassed: { value: 0, type: 'f32' },
        uGlyphRange: { value: [0, 1], type: 'vec2<f32>' },
        uVerticalFade: { value: [2, 3], type: 'vec2<f32>' },
    });
    const filter = new pixi.Filter({ glProgram: pixi.GlProgram.from({ vertex, fragment: sweep, name: 'lattice-lyric-sweep' }),
        resources: { sweepUniforms: group }, padding: 0, resolution: 2, clipToViewport: false });
    return { filter, uniforms: group.uniforms };
}
export type LatticeSweep = ReturnType<typeof createLatticeSweepFilter>;

export function createLatticeEdgeFilter(pixi: Pixi): { filter: Filter; group: UniformGroup } {
    const group = new pixi.UniformGroup({ uFade: { value: [0.04, 0.09], type: 'vec2<f32>' } });
    return { filter: new pixi.Filter({ glProgram: pixi.GlProgram.from({ vertex, fragment: fade, name: 'lattice-lyric-edges' }),
        resources: { edgeUniforms: group }, padding: 0, resolution: 2 }), group };
}
