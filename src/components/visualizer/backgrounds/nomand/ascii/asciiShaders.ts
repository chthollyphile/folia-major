import { ASCII_ANGLE_BINS, ASCII_CELL_H, ASCII_CELL_W, ASCII_GLYPH_COUNT, ASCII_RAMP_COUNT } from './asciiGlyphAtlas';

// src/components/visualizer/backgrounds/nomand/ascii/asciiShaders.ts
// The two passes of the Nomand ASCII effect, after living-ascii (MIT, Copyright (c) 2026 Yusen).
// The cell pass reads, for each 5×7 cell, the picture's colour and the direction its texture
// runs, and turns that direction with living-ascii's "school of fish" heading field, so whole
// regions sway together and the stroke glyphs turn with them. living-ascii rebuilds the picture
// from ~160k drawn strands first; here the strands are left out (they smear faces and lettering,
// which covers are made of, and cost two full-screen passes with 4× MSAA a frame), and the sway
// only bends the direction and shifts where each cell takes its colour from.
// The glyph pass draws each cell's glyph: the living-ascii colour solve for the picture's own
// colours, or the theme palette like the other Nomand effects.

const CELL_COUNT = ASCII_CELL_W * ASCII_CELL_H;

/** A full-screen triangle from gl_VertexID; no buffers. */
export const ASCII_QUAD_VS = /* glsl */`#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const ASCII_CELL_FS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D tImg, tMap;
uniform vec2 uRes, uCoverScale, uWind;
uniform float uT, uMotion, uLight, uImgLod;
out vec4 outColor;
const float TAU = 6.28318530718;
const float PI = 3.14159265359;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Value noise repeating every per lattice cells, so shifting it by whole periods over one loop
// brings it back to the start. Only the drift axis needs to wrap.
float pnoise(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(mod(i, per)), hash(mod(i + vec2(1, 0), per)), u.x),
               mix(hash(mod(i + vec2(0, 1), per)), hash(mod(i + vec2(1, 1), per)), u.x), u.y);
}
float pfbm(vec2 p, vec2 per) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * pnoise(p, per); p *= 2.0; per *= 2.0; a *= 0.5; }
    return s / 0.9375;
}
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec2 imgUv(vec2 uv) { return (uv - 0.5) * uCoverScale + 0.5; }
vec2 isoOf(vec2 uv) { return vec2(uv.x * uRes.x / uRes.y, uv.y); }
vec2 windFrame(vec2 q) { return vec2(dot(q, uWind), dot(q, vec2(-uWind.y, uWind.x))); }

// The sun swings around the light already in the picture.
vec3 sunDir() {
    float az = uLight + 0.7 * sin(TAU * uT) + 0.15 * sin(TAU * 2.0 * uT + 1.3);
    float el = 0.8 + 0.25 * sin(TAU * uT + 2.1);
    return normalize(vec3(cos(az), sin(az), el));
}
// Light breaking through drifting cloud gaps.
float sunPool(vec2 rq) { return smoothstep(0.32, 0.72, pfbm(rq * 1.3 + vec2(0.0, 5.1) - vec2(2.0 * uT, 0.0), vec2(2.0, 1000.0))); }
// Relights the hills: normals from the ridge and clump heights, against how the picture was lit.
float relight(vec2 uv) {
    vec2 px = 1.5 / vec2(textureSize(tMap, 0));
    vec4 l = texture(tMap, uv - vec2(px.x, 0.0)), r = texture(tMap, uv + vec2(px.x, 0.0));
    vec4 d = texture(tMap, uv - vec2(0.0, px.y)), u = texture(tMap, uv + vec2(0.0, px.y));
    vec3 N = normalize(vec3((l.r - r.r) * 7.0 + (l.g - r.g) * 2.5, (d.r - u.r) * 7.0 + (d.g - u.g) * 2.5, 1.0));
    vec3 L0 = normalize(vec3(cos(uLight), sin(uLight), 0.75));
    return clamp((0.3 + max(dot(N, sunDir()), 0.0)) / (0.3 + max(dot(N, L0), 0.0)), 0.5, 2.0);
}

void main() {
    vec2 cell = floor(gl_FragCoord.xy);
    vec2 cellPx = vec2(${ASCII_CELL_W}.0, ${ASCII_CELL_H}.0);
    vec2 centre = (cell + 0.5) * cellPx / uRes;
    vec4 m = texture(tMap, imgUv(centre));

    // Texture direction, signed downwind; where the picture has no clear direction, the wind's
    // with a little scatter.
    vec2 sv = m.ba * 2.0 - 1.0;
    float coh = length(sv);
    float windAng = atan(uWind.y, uWind.x);
    float th = 0.5 * atan(sv.y, sv.x);
    vec2 d = vec2(cos(th), sin(th));
    if (dot(d, uWind) < 0.0) d = -d;
    float combed = coh > 1e-4 ? atan(d.y, d.x) : windAng;
    float seed = hash(cell + 17.0);
    float base = mix(windAng + (seed - 0.5) * 0.9, combed, smoothstep(0.04, 0.3, coh));

    // The school: a broad turning wave sweeps downwind, sub-schools drift through it and turn at
    // their own moments, the whole field leans, and each cell adds a small motion of its own.
    vec2 rq = windFrame(isoOf(centre));
    float sub = pfbm(rq * 2.2 - vec2(8.0 * uT, 0.0), vec2(4.0, 1000.0)) * 2.0 - 1.0;
    float lean = 0.3 * sin(TAU * uT);
    float gust = smoothstep(0.25, 0.9, (0.5 + 0.5 * sin(TAU * 1.6 * rq.x - TAU * 3.0 * uT))
                 * (0.5 + 0.9 * pfbm(rq * 4.0 - vec2(8.0 * uT, 0.0), vec2(8.0, 1000.0))));
    float own = 0.12 * sin(TAU * 6.0 * uT + seed * TAU) + 0.06 * sin(TAU * 9.0 * uT + seed * TAU * 1.7);
    float wave = sin(TAU * (1.25 * rq.x + 0.3 * rq.y) - TAU * 3.0 * (uT - 0.03) + 2.0 * sub);
    float heading = 0.62 * wave + 0.38 * sub + lean;
    float bend = clamp(heading * (1.05 + 0.6 * gust) + own, -1.45, 1.45) * uMotion;
    float ang = base + 0.55 * bend;

    // The cell takes its colour from where the bent strand's tip has swung to.
    vec2 sway = (vec2(cos(ang), sin(ang)) - vec2(cos(base), sin(base))) * 9.0;
    vec3 sum = vec3(0.0), mx = vec3(0.0);
    for (int y = 0; y < ${ASCII_CELL_H}; y++) for (int x = 0; x < ${ASCII_CELL_W}; x++) {
        vec2 uv = (cell * cellPx + vec2(x, y) + 0.5 - sway) / uRes;
        vec3 c = toLin(textureLod(tImg, imgUv(uv), uImgLod).rgb);
        sum += c;
        mx = max(mx, c);
    }
    // Leans toward the brightest pixel to keep glints; the glyph pass brings the exposure back.
    vec3 c = mix(sum / ${CELL_COUNT}.0, mx, 0.3);

    float live = min(uMotion, 1.0);
    float conf = smoothstep(0.08, 0.45, coh);
    float pool = mix(0.88, 1.12, sunPool(rq));
    c *= mix(1.0, mix(1.0, relight(imgUv(centre)), 0.5) * pool, live);
    // A cell lights up when its strand turns across the sun, so turning regions flash together.
    vec3 T = normalize(vec3(cos(ang), sin(ang), 0.55));
    vec3 H = normalize(sunDir() + vec3(0.0, 0.0, 1.0));
    float tdh = dot(T, H);
    float glint = pow(sqrt(max(0.0, 1.0 - tdh * tdh)), 70.0);
    c += vec3(1.0, 0.96, 0.86) * glint * (0.25 + 0.6 * gust) * (0.3 + dot(c, vec3(2.0))) * 0.5 * live * conf;

    float theta = mod(ang, PI);
    float bin = mod(floor(theta / (PI / ${ASCII_ANGLE_BINS}.0) + 0.5), ${ASCII_ANGLE_BINS}.0);
    // The bin and the confidence share alpha: bin + 0.05 + 0.9 * conf over the bin count. The 0.05
    // keeps an 8-bit round-down from dropping into the bin below.
    outColor = vec4(clamp(pow(max(c, 0.0), vec3(1.0 / 2.2)), 0.0, 1.0), (bin + 0.05 + 0.9 * conf) / ${ASCII_ANGLE_BINS}.0);
}`;

export const ASCII_GLYPH_FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tCells, tAtlas;
uniform vec2 uRes;
uniform float uCover[${ASCII_GLYPH_COUNT}];
uniform bool uThemeColors, uInvert;
uniform vec3 uBack, uFront, uHighlight;
out vec4 outColor;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
    ivec2 fc = ivec2(gl_FragCoord.xy);
    ivec2 cellPx = ivec2(${ASCII_CELL_W}, ${ASCII_CELL_H});
    ivec2 cell = fc / cellPx;
    ivec2 local = fc - cell * cellPx;
    vec4 texel = texelFetch(tCells, cell, 0);
    vec3 c = texel.rgb;
    float l = luma(c);
    float a = texel.a * ${ASCII_ANGLE_BINS}.0;
    float bin = floor(a);
    float conf = clamp((fract(a) - 0.05) / 0.9, 0.0, 1.0);
    // Which luminance picks the glyph: in the theme palette it can be turned over, as the
    // dithering effect does for a light theme.
    float lv = uThemeColors && uInvert ? 1.0 - l : l;
    // Shadows keep visible strokes; only the deepest gaps thin out to dots.
    float v = smoothstep(0.0, 0.8, lv);
    int idx;
    if (conf > 0.3 && v > 0.03) {
        int weight = v < 0.12 ? 0 : v < 0.35 ? 1 : v < 0.65 ? 2 : 3;
        idx = ${ASCII_RAMP_COUNT} + weight * ${ASCII_ANGLE_BINS} + int(bin);
    } else {
        idx = clamp(int(floor(pow(v, 1.3) * ${ASCII_RAMP_COUNT}.0)), 0, ${ASCII_RAMP_COUNT - 1});
    }
    float lit = texelFetch(tAtlas, ivec2(idx * ${ASCII_CELL_W} + local.x, local.y), 0).r;

    if (uThemeColors) {
        // Strokes in the theme's front colour, the brightest toward its highlight, fading into the
        // backdrop where the picture is dark; the gaps are the backdrop itself.
        vec3 ink = mix(uFront, uHighlight, smoothstep(0.55, 0.95, lv));
        ink = mix(uBack, ink, 0.45 + 0.55 * smoothstep(0.0, 0.7, lv));
        outColor = vec4(lit > 0.5 ? ink : uBack, 1.0);
        return;
    }

    float f = uCover[idx];
    // What the cell should average to. The cell colour leans toward its brightest pixel, so this
    // scale brings it back to the picture's exposure; shadows end a little deeper.
    float target = l * (0.82 + 0.17 * smoothstep(0.15, 0.7, l));
    // Strokes: the cell's own colour, brightened a lot in shadow so they read, only a little in
    // highlights so they stay natural.
    float mxc = max(c.r, max(c.g, c.b));
    vec3 hue = c / max(mxc, 1e-4);
    float boost = mix(2.0, 1.3, smoothstep(0.2, 0.7, l));
    float gv = min(min(1.0, mxc * boost), target / max(f * max(luma(hue), 1e-4), 1e-4));
    vec3 ink = hue * gv;
    // Soft shoulder: near full brightness a stroke eases toward warm cream instead of going neon.
    float shoulder = smoothstep(0.75, 1.0, gv);
    ink = mix(ink, vec3(luma(ink)) * vec3(1.04, 1.0, 0.82), 0.35 * shoulder);
    float lg = luma(ink);
    // The glow behind the strokes makes up the rest of the cell's brightness.
    float b = f < 0.999 ? clamp((target - f * lg) / ((1.0 - f) * max(l, 1e-4)), 0.0, 1.0 / max(mxc, 1e-4)) : 0.0;
    vec3 col = lit > 0.5 ? ink : c * b;
    vec2 vg = (gl_FragCoord.xy / uRes - 0.5) * vec2(1.15, 0.85);
    col *= 1.0 - 0.22 * pow(clamp(dot(vg, vg) * 2.4, 0.0, 1.0), 1.6);
    outColor = vec4(col, 1.0);
}`;
