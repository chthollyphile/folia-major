import type { Filter, Texture, UniformGroup } from 'pixi.js';

// src/components/app/lattice/lyrics/latticeLyricFilters.ts
type Pixi = typeof import('pixi.js');

/** Filter vertex stage (Pixi filter conventions): used by the whole-stage edge fade only. */
const filterVertex = `
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
const fade = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uFade;
void main() {
    vec2 uv = vTextureCoord * uInputSize.xy / max(uOutputFrame.zw, vec2(1.0));
    float edge = smoothstep(0.0, uFade.y, uv.y) * smoothstep(0.0, uFade.y, 1.0 - uv.y)
        * smoothstep(0.0, uFade.x, uv.x) * smoothstep(0.0, uFade.x, 1.0 - uv.x);
    finalColor = texture(uTexture, vTextureCoord) * edge;
}`;

/**
 * Mesh vertex stage (Pixi mesh conventions). The three matrices and `uColor` are bound by
 * Pixi's mesh pipe (global + local uniform groups); `uColor` carries the ancestors' alpha,
 * premultiplied, so the fragment multiplies it in exactly as Pixi's default mesh shader does.
 */
const meshVertex = `
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
out vec2 vUV;
out vec4 vColor;
void main() {
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vColor = uColor;
}`;
/**
 * Sweep drawn straight from the glyph texture onto the current render target. Each piece is a
 * unit quad scaled to its raster size, so `vUV` is the normalized position across the piece and
 * `uFront` / `uSoftness` / `uGlyphRange` / `uVerticalFade` are all expressed in that space.
 * Running this as a per-sprite shader instead of a Filter removes one render-to-texture pass per
 * visible word (the dominant GPU cost of the card on every frame).
 */
const sweep = `
in vec2 vUV;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uBase;
uniform vec4 uWord;
uniform float uProgress;
uniform float uFront;
uniform float uSoftness;
uniform float uPassed;
uniform vec2 uGlyphRange;
uniform vec2 uVerticalFade;
void main() {
    float glyphAlpha = texture(uTexture, vUV).a;
    float x = vUV.x;
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
    float vertical = 1.0 - smoothstep(uVerticalFade.x, uVerticalFade.y, vUV.y);
    finalColor = vec4(ink * alpha + base.rgb * base.a * (1.0 - alpha), alpha + base.a * (1.0 - alpha)) * glyphAlpha * vertical * vColor;
}`;

/** One unit quad shared by every piece of a line view; each mesh scales it to its raster size. */
export function createLatticeQuadGeometry(pixi: Pixi) {
    return new pixi.MeshGeometry({
        positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
}

export function createLatticeSweepShader(pixi: Pixi, base: number[], word: number[], texture: Texture) {
    const group = new pixi.UniformGroup({
        uBase: { value: base, type: 'vec4<f32>' }, uWord: { value: word, type: 'vec4<f32>' },
        uProgress: { value: 0, type: 'f32' }, uFront: { value: 0, type: 'f32' },
        uSoftness: { value: 0.1, type: 'f32' }, uPassed: { value: 0, type: 'f32' },
        uGlyphRange: { value: [0, 1], type: 'vec2<f32>' },
        uVerticalFade: { value: [2, 3], type: 'vec2<f32>' },
    });
    const shader = new pixi.Shader({
        glProgram: pixi.GlProgram.from({ vertex: meshVertex, fragment: sweep, name: 'lattice-lyric-sweep' }),
        resources: { uTexture: texture.source, uSampler: texture.source.style, sweepUniforms: group },
    });
    return { shader, uniforms: group.uniforms };
}
export type LatticeSweep = ReturnType<typeof createLatticeSweepShader>;

export function createLatticeEdgeFilter(pixi: Pixi, resolution: number): { filter: Filter; group: UniformGroup } {
    const group = new pixi.UniformGroup({ uFade: { value: [0.04, 0.09], type: 'vec2<f32>' } });
    return { filter: new pixi.Filter({ glProgram: pixi.GlProgram.from({ vertex: filterVertex, fragment: fade, name: 'lattice-lyric-edges' }),
        resources: { edgeUniforms: group }, padding: 0, resolution }), group };
}
