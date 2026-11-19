import type { Filter } from 'pixi.js';
import { parseColorChannels } from '../../../utils/colorMix';
import { PIXI_FILTER_VERTEX as vertex } from '../pixiFilterVertex';

// src/components/visualizer/tempera/temperaDifferenceFilter.ts
// Single-pass threshold inversion for the lyric layer: it samples the already-rendered
// artwork underneath and paints each text pixel in whichever of ink/paper contrasts more,
// giving the print-registration look without hand-picking a fill color per shot kind.
//
// It is also the only thing that colors the lyric in gradient mode - the ramp rides along as a
// tint. So the filter has a second, tint-only form for when the user switches the inversion
// off: same ramp, no backdrop read. Dropping the filter entirely there would silently take
// gradient mode's colour with it and leave flat ink text.
type PixiModule = typeof import('pixi.js');

// Shared by both forms: everything except the backdrop read and the colour decision.
const fragmentHead = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec3 uInkColor;
uniform vec3 uPaperColor;
uniform float uInkLuminance;
uniform float uPaperLuminance;
uniform float uBias;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uTintC;
uniform vec3 uTintD;
uniform float uTintAmount;

// Four-stop ramp sampled across the filter's own bounds, so the colour sweeps the whole line
// rather than repeating inside every glyph.
vec3 sampleTint(float position) {
    float scaled = clamp(position, 0.0, 1.0) * 3.0;
    if (scaled < 1.0) return mix(uTintA, uTintB, scaled);
    if (scaled < 2.0) return mix(uTintB, uTintC, scaled - 1.0);
    return mix(uTintC, uTintD, scaled - 2.0);
}

float tintPosition(vec2 uv) {
    return clamp(uv.x * uInputSize.x / max(uOutputFrame.z, 1.0), 0.0, 1.0);
}
`;

const inversionFragment = `${fragmentHead}
uniform sampler2D uBackTexture;

float backLuminance(vec2 uv) {
    vec4 back = texture(uBackTexture, uv);
    // Pixi render targets are premultiplied; undo it before reading brightness.
    vec3 straight = back.rgb / max(back.a, 1e-4);
    float lum = dot(straight, vec3(0.2126, 0.7152, 0.0722));
    // Where nothing has been drawn, the shell background shows through, which is paper.
    return mix(uPaperLuminance, lum, clamp(back.a * 3.0, 0.0, 1.0));
}

void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    // A 5-tap average keeps fine hatch from flickering the inversion decision per pixel.
    vec2 texel = uInputSize.zw * 1.5;
    float lum = backLuminance(vTextureCoord) * 0.4
        + (backLuminance(vTextureCoord + texel)
            + backLuminance(vTextureCoord - texel)
            + backLuminance(vTextureCoord + vec2(texel.x, -texel.y))
            + backLuminance(vTextureCoord + vec2(-texel.x, texel.y))) * 0.15;

    float distanceToPaper = abs(lum - uPaperLuminance);
    float distanceToInk = abs(lum - uInkLuminance);
    // Pick the color that sits further from the backdrop so contrast never collapses,
    // whether the theme puts light ink on dark paper or the reverse.
    vec3 tone = mix(uInkColor, uPaperColor, step(distanceToInk + uBias, distanceToPaper));

    // Colour modes tint that choice instead of replacing it: the hue comes from the ramp, the
    // luminance stays the one the inversion just picked. Colouring the text any other way
    // throws away the only thing guaranteeing it reads against the artwork.
    if (uTintAmount > 0.0) {
        vec3 tint = sampleTint(tintPosition(vTextureCoord));
        float tintLuminance = max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        float toneLuminance = dot(tone, vec3(0.2126, 0.7152, 0.0722));
        vec3 matched = clamp(tint * (toneLuminance / tintLuminance), 0.0, 1.0);
        tone = mix(tone, matched, uTintAmount);
    }
    finalColor = vec4(tone * front.a, front.a);
}
`;

// The inversion switched off. No backdrop is copied, so the ramp *is* the colour: the stops
// are already built to clear the paper's luminance by ~88, which is what kept them readable
// when the inversion was only lending them its luminance.
const tintOnlyFragment = `${fragmentHead}
void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    vec3 tone = uTintAmount > 0.0 ? sampleTint(tintPosition(vTextureCoord)) : uInkColor;
    finalColor = vec4(tone * front.a, front.a);
}
`;

const REC709 = { r: 0.2126, g: 0.7152, b: 0.0722 };

const toNormalizedRgb = (color: string, fallback: [number, number, number]) => {
    const channels = parseColorChannels(color);
    if (!channels) return fallback;
    return [channels.r / 255, channels.g / 255, channels.b / 255] as [number, number, number];
};

const luminanceOf = (rgb: [number, number, number]) => (
    rgb[0] * REC709.r + rgb[1] * REC709.g + rgb[2] * REC709.b
);

export interface TemperaDifferenceOptions {
    ink: string;
    paper: string;
    /** 0..1; 0.5 is neutral, higher biases the decision toward ink. */
    threshold?: number;
    /** Four-stop hue ramp swept across the line; omit for a plain ink/paper inversion. */
    tint?: string[] | null;
    /**
     * Default true. False builds the tint-only form: the ramp still colours the lyric, but no
     * backdrop is sampled, so `textInversion` can be switched off without gradient mode losing
     * its colour. Pointless without a tint - the caller should skip the filter entirely then.
     */
    inversion?: boolean;
}

export const createTemperaDifferenceFilter = (
    pixi: PixiModule,
    options: TemperaDifferenceOptions,
): Filter => {
    const ink = toNormalizedRgb(options.ink, [1, 1, 1]);
    const paper = toNormalizedRgb(options.paper, [0, 0, 0]);
    const tint = options.tint && options.tint.length >= 2 ? options.tint : null;
    const stops = Array.from({ length: 4 }, (_, index) => (
        tint ? toNormalizedRgb(tint[Math.min(index, tint.length - 1)], ink) : ink
    ));
    const uniforms = new pixi.UniformGroup({
        uInkColor: { value: new Float32Array(ink), type: 'vec3<f32>' },
        uTintA: { value: new Float32Array(stops[0]), type: 'vec3<f32>' },
        uTintB: { value: new Float32Array(stops[1]), type: 'vec3<f32>' },
        uTintC: { value: new Float32Array(stops[2]), type: 'vec3<f32>' },
        uTintD: { value: new Float32Array(stops[3]), type: 'vec3<f32>' },
        uTintAmount: { value: tint ? 1 : 0, type: 'f32' },
        uPaperColor: { value: new Float32Array(paper), type: 'vec3<f32>' },
        uInkLuminance: { value: luminanceOf(ink), type: 'f32' },
        uPaperLuminance: { value: luminanceOf(paper), type: 'f32' },
        uBias: { value: (options.threshold ?? 0.5) - 0.5, type: 'f32' },
    });
    const inversion = options.inversion ?? true;
    return new pixi.Filter({
        glProgram: pixi.GlProgram.from({
            vertex,
            fragment: inversion ? inversionFragment : tintOnlyFragment,
            name: inversion ? 'tempera-difference-inversion' : 'tempera-text-tint',
        }),
        // blendRequired makes Pixi snapshot the pixels already drawn beneath this filter's
        // bounds into uBackTexture; the empty texture below is the required placeholder. The
        // tint-only form reads no backdrop, so it declares neither.
        blendRequired: inversion,
        resources: inversion
            ? { differenceUniforms: uniforms, uBackTexture: pixi.Texture.EMPTY }
            : { differenceUniforms: uniforms },
        padding: 0,
        // MUST be 'inherit'. Pixi's Filter default is a hard 1, which allocates the input
        // texture at a different pixel size than the back texture (that one always follows the
        // render target's resolution). vTextureCoord then indexes the two textures
        // differently and the backdrop is read from the wrong place - the inversion picks the
        // wrong colour in patches, worst over fine hatch. The tint-only form has no back
        // texture to disagree with, but a hard 1 would still rasterize the type below the
        // canvas resolution and upscale it.
        resolution: 'inherit',
    });
};
