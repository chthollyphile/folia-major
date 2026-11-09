import { LAYOUT_GLSL } from './cinemaLayout';
import { MATERIAL_GLSL } from './cinemaGeometry';

// src/components/scenes/cinema/cinemaShaders.ts
// The cinema's shaders. One room shader lights every surface from the same few sources: the screen
// as three area lights (left, middle, right thirds, coloured by what is projected), the wall sconces,
// the aisle lamps, the footlights, the cove strips and, by day, the house lights. The screen, the
// projector beam, the dust in it and the small glowing lamps have their own shaders below.

const COMMON_GLSL = `
${LAYOUT_GLSL}
uniform float uTime;
uniform vec2 uResolution;
uniform float uExposure;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 acesFilm(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Tone map and a film grade: teal in the shadows, warm amber in the highlights, a lifted black.
// The vignette and the grain come last, after the lens (cinemaPost.ts).
vec3 finishColor(vec3 hdr) {
    vec3 c = acesFilm(hdr * uExposure);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= mix(vec3(0.86, 0.98, 1.12), vec3(1.06, 1.0, 0.9), smoothstep(0.0, 0.3, l));
    c = linearToSrgb(c);
    // Dither by half a step: the frame is stored in 8 bits before the lens passes.
    c += (hash12(gl_FragCoord.xy + fract(uTime * 3.7) * 311.0) - 0.5) / 255.0;
    return c * 0.992 + vec3(0.002, 0.003, 0.005);
}

// A sine whose ripples fade to their average once they are finer than a pixel, so they never shimmer.
float aaSin(float x) {
    return sin(x) * (1.0 - smoothstep(0.6, 1.6, fwidth(x)));
}

// Where the ray from the projector lens through p meets the screen, in screen uv.
vec2 projectorUv(vec3 p) {
    vec3 o = vec3(0.0, PROJ_Y, PROJ_Z);
    vec3 s = p - o;
    vec3 q = o + s * (-o.z / min(s.z, -1e-4));
    return vec2((q.x + SCREEN_W * 0.5) / SCREEN_W, (q.y - (SCREEN_CY - SCREEN_H * 0.5)) / SCREEN_H);
}
`;

/*
 * What the projector throws at the screen: the cover at 86% of the screen's height, centred, over
 * the same cover scaled to the full width, blurred and dimmed, with a soft shadow round the cover.
 */
const PROJECTION_GLSL = `
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uAspectA;
uniform float uAspectB;
uniform float uChange;

const float COVER_SCALE = 0.86;

float boxDistance(vec2 p, vec2 halfSize) {
    vec2 d = abs(p) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec3 projectedImage(sampler2D t, float aspect, vec2 uv, float lod, bool cheap) {
    vec2 b = vec2(uv.x, 0.5 + (uv.y - 0.5) * SCREEN_H * aspect / SCREEN_W);
    vec3 backdrop = textureLod(t, b, 6.0).rgb;
    if (!cheap) {
        // A ring of taps on a small mip: a soft blur with no blocks.
        backdrop *= 0.2;
        for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398 + 0.3;
            backdrop += textureLod(t, b + vec2(cos(a), sin(a)) * 0.045, 4.6).rgb * 0.1;
        }
    }
    float w = aspect * SCREEN_H / SCREEN_W * COVER_SCALE;
    vec2 c = vec2((uv.x - 0.5) / w, (uv.y - 0.5) / COVER_SCALE);
    float d = boxDistance(c, vec2(0.5));
    float edge = cheap ? 0.01 : max(fwidth(d), 0.0015);
    float inside = 1.0 - smoothstep(-edge, edge, d);
    float shadow = 0.5 + 0.5 * smoothstep(0.0, 0.12, d);
    vec3 sharp = textureLod(t, clamp(c + 0.5, 0.0, 1.0), lod).rgb;
    float grey = dot(backdrop, vec3(0.2126, 0.7152, 0.0722));
    return mix(mix(vec3(grey), backdrop, 0.7) * 0.26 * shadow, sharp, inside);
}

// The reel the beam carries: the old one (B) gives way to the new one (A) in the middle of a change.
vec3 reelImage(vec2 uv, float lod, bool cheap) {
    vec3 a = projectedImage(uTexA, uAspectA, uv, lod, cheap);
    if (uChange < 1.0) a = mix(projectedImage(uTexB, uAspectB, uv, lod, cheap), a, smoothstep(0.42, 0.58, uChange));
    return a;
}
`;

const ROOM_VERTEX = `
attribute vec2 aMatShade;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vMat;
varying float vShade;

void main() {
    mat4 m = modelMatrix;
#ifdef USE_INSTANCING
    m = m * instanceMatrix;
#endif
    vec4 world = m * vec4(position, 1.0);
    vPos = world.xyz;
    vNormal = normalize(mat3(m) * normal);
    vUv = uv;
    vMat = aMatShade.x;
    vShade = aMatShade.y;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ROOM_FRAGMENT = `
${COMMON_GLSL}
${MATERIAL_GLSL}
uniform vec3 uScreenL;
uniform vec3 uScreenC;
uniform vec3 uScreenR;
uniform vec3 uAmbient;
uniform vec3 uHaze;
uniform vec3 uCove;
uniform float uHouse;
uniform float uSconce;
uniform float uFoot;
uniform float uDay;
uniform float uBoxLamp;

varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vMat;
varying float vShade;

const vec3 WARM = vec3(1.0, 0.62, 0.3);
const vec3 AMBER = vec3(1.0, 0.5, 0.16);
const vec3 EXIT_GREEN = vec3(0.12, 1.0, 0.38);
const vec3 GOLD = vec3(0.78, 0.55, 0.22);
const vec3 WALNUT = vec3(0.075, 0.042, 0.024);

float rowRadius(float r) { return ROW_RADIUS + r * ROW_PITCH; }
float rowZ(float r, float x) { float R = rowRadius(r); return ROW_FIRST - ROW_RADIUS + sqrt(R * R - x * x); }
float rowFloor(float r) { return max(0.0, r - ROW_FLAT + 1.0) * ROW_RISE; }
// The tread p stands on; -1 in front of the first row.
float rowAt(vec3 p) {
    float R = rowRadius(5.0);
    float off = R - sqrt(R * R - p.x * p.x);
    return floor((p.z + off - ROW_FIRST + ROW_TREAD_FRONT) / ROW_PITCH);
}

// ---- The screen as an area light: the exact diffuse form factor of a rectangle, per third. ----
float edgeTerm(vec3 a, vec3 b, vec3 n) {
    vec3 c = cross(a, b);
    return acos(clamp(dot(a, b), -0.9999, 0.9999)) * dot(c, n) / max(length(c), 1e-5);
}
float rectFormFactor(vec3 p, vec3 n, float x0, float x1) {
    float y0 = SCREEN_CY - SCREEN_H * 0.5;
    float y1 = SCREEN_CY + SCREEN_H * 0.5;
    vec3 a = normalize(vec3(x0, y0, 0.0) - p);
    vec3 b = normalize(vec3(x1, y0, 0.0) - p);
    vec3 c = normalize(vec3(x1, y1, 0.0) - p);
    vec3 d = normalize(vec3(x0, y1, 0.0) - p);
    return max(0.0, edgeTerm(a, b, n) + edgeTerm(b, c, n) + edgeTerm(c, d, n) + edgeTerm(d, a, n)) / 6.2831853;
}
vec3 screenLight(vec3 p, vec3 n) {
    if (p.z < 0.05) return vec3(0.0);
    float h = SCREEN_W / 6.0;
    return uScreenL * rectFormFactor(p, n, -SCREEN_W * 0.5, -h)
        + uScreenC * rectFormFactor(p, n, -h, h)
        + uScreenR * rectFormFactor(p, n, h, SCREEN_W * 0.5);
}

// ---- Small lights. Each returns irradiance and adds a highlight to spec. ----
vec3 pointLight(vec3 lp, vec3 color, vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    vec3 d = lp - p;
    float d2 = max(dot(d, d), 0.03);
    vec3 l = d * inversesqrt(d2);
    float ndl = max(dot(n, l), 0.0);
    vec3 e = color * ndl / d2;
    spec += e * pow(max(dot(n, normalize(l + v)), 0.0), gloss);
    return e;
}

// Art deco fan sconces: mostly up, a little down, washing the wall in a scallop.
vec3 sconceLight(vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    float side = p.x < 0.0 ? -1.0 : 1.0;
    float k0 = floor((p.z - BAY_FIRST) / BAY_PITCH + 0.5);
    vec3 e = vec3(0.0);
    for (int i = -1; i <= 1; i++) {
        float k = k0 + float(i);
        if (k < 1.0 || k > BAY_COUNT - 1.0) continue;
        vec3 lp = vec3(side * (HALL_HALF_WIDTH - 0.42), SCONCE_Y + 0.05, BAY_FIRST + k * BAY_PITCH);
        vec3 toP = normalize(p - lp);
        float lobe = 0.1 + 2.6 * smoothstep(-0.1, 0.9, toP.y);
        e += pointLight(lp, WARM * uSconce * lobe, p, n, v, gloss, spec);
    }
    return e;
}

// The amber lamps on the seat ends along the aisles and the side walkways.
vec3 stepLight(vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    float ax = abs(p.x);
    if (ax < AISLE_INNER - 0.8 || p.y > 6.0) return vec3(0.0);
    float side = p.x < 0.0 ? -1.0 : 1.0;
    float r0 = rowAt(p);
    vec3 e = vec3(0.0);
    for (int i = 0; i <= 1; i++) {
        float r = r0 + float(i);
        if (r < 0.0 || r > ROW_COUNT) continue;
        float y = rowFloor(r) + 0.2;
        float edges[3];
        edges[0] = AISLE_INNER + 0.03;
        edges[1] = AISLE_OUTER - 0.03;
        edges[2] = SIDE_EDGE + 0.03;
        for (int j = 0; j < 3; j++) {
            float x = edges[j];
            if (abs(ax - x) > 2.2) continue;
            vec3 lp = vec3(side * x, y, rowZ(r, x) - 0.3);
            e += pointLight(lp, AMBER * 0.05, p, n, v, gloss, spec);
        }
    }
    return e;
}

// Footlights: a hooded line of lamps along the stage lip, throwing light up and back onto the curtains.
vec3 footLight(vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    vec3 c = vec3(clamp(p.x, -FOOT_HALF_WIDTH, FOOT_HALF_WIDTH), FOOT_Y, FOOT_Z);
    vec3 d = c - p;
    float dist = max(length(d), 0.05);
    vec3 l = d / dist;
    float aim = smoothstep(-0.05, 0.35, -l.y) * smoothstep(0.25, -0.35, -l.z);
    vec3 e = vec3(1.0, 0.68, 0.38) * uFoot * aim * max(dot(n, l), 0.0) / (0.25 + dist * 0.55 + dist * dist * 0.12);
    spec += e * pow(max(dot(n, normalize(l + v)), 0.0), gloss);
    return e;
}

// The lamps at the foot of the proscenium pilasters: narrow cones up the fluting.
vec3 uplight(vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    vec3 lp = vec3(p.x < 0.0 ? -PILASTER_X : PILASTER_X, 0.32, PROSC_Z + 0.5);
    vec3 toP = normalize(p - lp);
    float cone = pow(max(toP.y, 0.0), 10.0);
    return pointLight(lp, WARM * uFoot * 1.6 * cone, p, n, v, gloss, spec);
}

// The cove strips under each beam's front edge wash the ceiling behind them.
vec3 coveLight(vec3 p, vec3 n) {
    if (p.y < HALL_CEILING - 3.0) return vec3(0.0);
    float k = floor((p.z - BAY_FIRST - 0.4) / BAY_PITCH);
    if (k < 0.0 || k > BAY_COUNT - 1.0) return vec3(0.0);
    vec3 c = vec3(p.x, HALL_CEILING - 0.66, BAY_FIRST + k * BAY_PITCH + 0.45);
    vec3 d = c - p;
    float dist = max(length(d), 0.05);
    vec3 l = d / dist;
    return uCove * max(dot(n, l), 0.0) * smoothstep(0.1, -0.2, l.y) / (0.15 + dist * dist * 0.5);
}

// The two small lamps on the front of each box, lighting its front, its people and the wall behind.
vec3 boxLight(vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    if (p.z > 8.0 || p.y < 2.5 || abs(p.x) < HALL_HALF_WIDTH - 2.8) return vec3(0.0);
    float side = p.x < 0.0 ? -1.0 : 1.0;
    vec3 e = vec3(0.0);
    for (int i = 0; i < 2; i++) {
        vec3 lp = vec3(side * BOX_LAMP_X, BOX_LAMP_Y, i == 0 ? BOX_LAMP_Z0 : BOX_LAMP_Z1);
        e += pointLight(lp, WARM * 0.2 * uBoxLamp, p, n, v, gloss, spec);
    }
    return e;
}

vec3 exitLight(vec3 p, vec3 n, vec3 v, float gloss, inout vec3 spec) {
    vec3 lp = vec3((p.x < 0.0 ? -1.0 : 1.0) * (HALL_HALF_WIDTH - 0.2), EXIT_SIGN_Y, EXIT_Z);
    return pointLight(lp, EXIT_GREEN * 0.05, p, n, v, gloss, spec);
}

// Day: the house lights, warm from above with a red bounce off the carpet and seats.
vec3 houseLight(vec3 p, vec3 n) {
    vec3 sky = vec3(1.0, 0.88, 0.72);
    vec3 ground = vec3(0.4, 0.17, 0.12);
    vec3 e = mix(ground, sky, 0.5 + 0.5 * n.y);
    // Lit from the ceiling: the upper hall bright, the rows darker.
    return e * uHouse * (0.42 + 0.58 * smoothstep(0.5, 10.0, p.y)) * (0.55 + 0.45 * smoothstep(22.0, 6.0, p.z));
}

// What a polished surface mirrors here, roughly: the screen ahead, the stage glow below, the hall.
vec3 mirrored(vec3 p, vec3 r) {
    vec3 e = uAmbient * 2.5 + houseLight(p, r) * 0.6;
    float toScreen = smoothstep(0.75, 0.98, dot(r, normalize(vec3(0.0, SCREEN_CY, 0.0) - p)));
    e += (uScreenL + uScreenC + uScreenR) * 0.04 * toScreen;
    e += vec3(1.0, 0.68, 0.38) * uFoot * 0.08 * smoothstep(0.1, -0.5, r.y);
    e += WARM * uSconce * 0.05 * smoothstep(0.3, 0.9, abs(r.x));
    return e;
}

// The scallop a fan sconce paints above itself on the pilaster and the wall beside it.
vec3 sconceScallop(vec3 p) {
    float k = floor((p.z - BAY_FIRST) / BAY_PITCH + 0.5);
    if (k < 1.0 || k > BAY_COUNT - 1.0) return vec3(0.0);
    vec2 d = vec2(p.z - (BAY_FIRST + k * BAY_PITCH), p.y - SCONCE_Y);
    float up = max(d.y, 0.0);
    float spread = 0.16 + 0.42 * up;
    float fan = exp(-(d.x * d.x) / (spread * spread)) * exp(-up / 1.8) * smoothstep(-0.45, 0.05, d.y);
    return WARM * fan * uSconce * 0.16;
}

float lineMask(float d, float width) {
    float w = fwidth(d) + 1e-4;
    return 1.0 - smoothstep(width, width + w, d);
}

void main() {
    int matId = int(vMat + 0.5);
    vec3 p = vPos;
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - p);

    vec3 albedo = vec3(0.1);
    vec3 emissive = vec3(0.0);
    float ao = vShade;
    float specAmount = 0.04;
    float gloss = 12.0;
    float velvet = 0.0;
    float metal = 0.0;

    if (matId == M_CARPET) {
        float ax = abs(p.x);
        float row = rowAt(p);
        float open = max(
            smoothstep(AISLE_INNER - 0.04, AISLE_INNER + 0.04, ax) * (1.0 - smoothstep(AISLE_OUTER - 0.04, AISLE_OUTER + 0.04, ax)),
            smoothstep(SIDE_EDGE - 0.04, SIDE_EDGE + 0.04, ax)
        );
        if (row < 0.0) open = 1.0;
        vec2 cell = fract(vec2(p.x + p.z, p.x - p.z) * 1.1) - 0.5;
        float edge = 0.5 - max(abs(cell.x), abs(cell.y));
        float motif = lineMask(edge, 0.03) + 0.6 * lineMask(length(cell), 0.07);
        // Far away the motif melts into its average colour instead of crawling.
        motif = mix(clamp(motif, 0.0, 1.0), 0.18, smoothstep(0.08, 0.25, fwidth(p.x + p.z) * 1.1));
        albedo = mix(vec3(0.11, 0.016, 0.022), vec3(0.32, 0.19, 0.07), motif * 0.6);
        // Brass nosing on the front edge of each aisle step.
        float nose = p.z - (rowZ(max(row, 0.0), ax) - ROW_TREAD_FRONT);
        if (row >= 0.0 && open > 0.5 && nose < 0.045) {
            albedo = vec3(0.5, 0.33, 0.14);
            specAmount = 0.5;
            gloss = 40.0;
        }
        ao = 0.12 + 0.88 * open;
    } else if (matId == M_WALL) {
        float row = rowAt(vec3(p.x, 0.0, p.z));
        float floorY = row < 0.0 ? 0.0 : rowFloor(row);
        float h = p.y - floorY;
        if (p.y > 7.4) {
            // Frieze above the picture rail: dark plaster with deco reeding.
            albedo = vec3(0.07, 0.05, 0.04) * (0.85 + 0.15 * aaSin(p.z * 31.4));
        } else if (h < 1.25) {
            float rail = lineMask(abs(h - 1.2), 0.035);
            albedo = mix(WALNUT * (0.8 + 0.2 * aaSin(p.y * 60.0)), GOLD * 0.7, rail);
            specAmount = mix(0.15, 0.6, rail);
            gloss = 30.0;
        } else {
            // Quilted fabric with a small button at every crossing.
            vec2 cell = fract(vec2(p.z + p.y, p.z - p.y) * 1.25) - 0.5;
            float seam = 0.5 - max(abs(cell.x), abs(cell.y));
            float fine = smoothstep(0.06, 0.2, fwidth(p.z + p.y) * 1.25);
            float pillow = mix(smoothstep(0.0, 0.25, seam), 0.75, fine);
            albedo = vec3(0.2, 0.135, 0.085) * (0.6 + 0.4 * pillow);
            float button = lineMask(length(abs(cell) - vec2(0.5, 0.0)), 0.035) + lineMask(length(abs(cell) - vec2(0.0, 0.5)), 0.035);
            albedo = mix(albedo, GOLD * 0.6, mix(clamp(button, 0.0, 1.0), 0.03, fine));
            velvet = 0.5;
            emissive = sconceScallop(p) * albedo * 4.0;
        }
        ao *= 0.55 + 0.45 * smoothstep(0.0, 1.2, h);
    } else if (matId == M_PILASTER || matId == M_PILASTER_FACE) {
        albedo = WALNUT;
        specAmount = 0.2;
        gloss = 30.0;
        if (matId == M_PILASTER_FACE) {
            float s = fract(vUv.x * 5.0);
            // Far off, the thin gold fillets melt into their share of the face instead of breaking up.
            float fillet = mix(lineMask(min(s, 1.0 - s), 0.06), 0.14, smoothstep(0.04, 0.12, fwidth(vUv.x * 5.0)));
            albedo = mix(WALNUT * (0.55 + 0.45 * sin(s * 3.14159)), GOLD * 0.75, fillet);
            specAmount = mix(0.25, 0.8, fillet);
            gloss = mix(30.0, 60.0, fillet);
            emissive = sconceScallop(p) * albedo * 6.0;
        }
    } else if (matId == M_CEILING) {
        albedo = vec3(0.02, 0.03, 0.06);
    } else if (matId == M_BEAM) {
        albedo = vec3(0.42, 0.36, 0.29);
        float band = lineMask(abs(p.y - (HALL_CEILING - 0.5)), 0.02);
        albedo = mix(albedo, GOLD, band);
    } else if (matId == M_COVE) {
        albedo = vec3(0.0);
        emissive = uCove * 2.6;
    } else if (matId == M_PROSC_WALL) {
        albedo = vec3(0.1, 0.065, 0.05) * (0.82 + 0.18 * aaSin(p.x * 28.0));
    } else if (matId == M_GOLD) {
        albedo = GOLD;
        metal = 1.0;
        specAmount = 1.0;
        gloss = 24.0;
    } else if (matId == M_MASKING) {
        albedo = vec3(0.004);
    } else if (matId == M_CURTAIN) {
        albedo = vec3(0.36, 0.022, 0.03);
        velvet = 1.0;
    } else if (matId == M_FRINGE) {
        float strand = 0.5 + 0.5 * sin(vUv.x * 5800.0);
        float fade = 1.0 - smoothstep(0.3, 0.8, fwidth(vUv.x * 5800.0));
        albedo = GOLD * mix(1.0, 0.45 + 0.55 * strand, fade) * (0.5 + 0.5 * vUv.y);
        metal = 1.0;
        specAmount = 0.8;
        gloss = 18.0;
    } else if (matId == M_STAGE_FRONT) {
        float panel = lineMask(abs(fract(p.x / 1.27) - 0.5) * 1.27 - 0.6, 0.02);
        albedo = WALNUT * (0.75 + 0.25 * aaSin(p.x * 9.0 + p.y * 3.0)) * (1.0 - 0.5 * panel);
        specAmount = 0.15;
    } else if (matId == M_STAGE_TOP) {
        albedo = vec3(0.04, 0.032, 0.027) * (0.8 + 0.2 * (0.5 + 0.5 * aaSin(p.z * 37.7)));
        specAmount = 0.12;
        gloss = 20.0;
    } else if (matId == M_SEAT_FABRIC) {
        float variation = hash12(floor(p.xz * 1.6 + 0.5));
        // Piping along the edges of each cushion.
        float seam = lineMask(min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)), 0.035);
        albedo = vec3(0.19, 0.028, 0.038) * (0.9 + 0.2 * variation) * (1.0 - 0.45 * seam);
        velvet = 0.4;
    } else if (matId == M_SEAT_SHELL) {
        albedo = vec3(0.035, 0.024, 0.018);
        specAmount = 0.35;
        gloss = 40.0;
    } else if (matId == M_SEAT_ARM) {
        albedo = vec3(0.09, 0.05, 0.028);
        specAmount = 0.5;
        gloss = 60.0;
    } else if (matId == M_DOOR) {
        float panel = lineMask(abs(vUv.x - 0.5), 0.012);
        float bar = lineMask(abs(p.y - 1.05), 0.025);
        albedo = mix(vec3(0.035, 0.026, 0.02) * (1.0 - 0.6 * panel), vec3(0.5, 0.35, 0.15), bar);
        specAmount = mix(0.1, 0.6, bar);
    } else if (matId == M_EXIT_SIGN) {
        vec2 q = vUv;
        float arrowShaft = step(abs(q.y - 0.5), 0.07) * step(0.2, q.x) * step(q.x, 0.48);
        float arrowHead = step(abs(q.y - 0.5), 0.2 * (1.0 - (q.x - 0.44) / 0.14)) * step(0.44, q.x) * step(q.x, 0.58);
        float doorOutline = (step(0.64, q.x) * step(q.x, 0.84) * step(0.16, q.y) * step(q.y, 0.84))
            * (1.0 - step(0.68, q.x) * step(q.x, 0.8) * step(0.24, q.y) * step(q.y, 0.84));
        float glyph = clamp(arrowShaft + arrowHead + doorOutline, 0.0, 1.0);
        albedo = vec3(0.0);
        emissive = mix(EXIT_GREEN * 0.55, vec3(0.75, 1.0, 0.85), glyph) * 1.4;
    } else if (matId == M_EXIT_HOUSING) {
        albedo = vec3(0.02);
    } else if (matId == M_SCONCE_GLASS) {
        float rib = lineMask(abs(fract(vUv.x * 8.0) - 0.5), 0.06);
        albedo = vec3(0.0);
        emissive = WARM * (0.35 + 0.65 * vUv.y) * (1.0 - 0.55 * rib) * (1.2 * uSconce + 0.4 * uDay);
    } else if (matId == M_BRASS) {
        albedo = vec3(0.5, 0.33, 0.14);
        metal = 1.0;
        specAmount = 0.9;
        gloss = 36.0;
    } else if (matId == M_AUDIENCE) {
        // People in the dark: almost black, only their outline catches the screen's light.
        albedo = vec3(0.018, 0.014, 0.013);
        velvet = 1.6;
    } else if (matId == M_BOX_FRONT) {
        // The bowed fronts of the boxes: walnut panels in a gold frame, warm under their lamps.
        float panel = lineMask(abs(fract(vUv.x * 6.0) - 0.5) * 2.0 - 0.86, 0.02) + lineMask(abs(vUv.y - 0.5) * 2.0 - 0.8, 0.03);
        albedo = mix(WALNUT * (0.8 + 0.2 * aaSin(p.y * 40.0)), GOLD * 0.8, clamp(panel, 0.0, 1.0));
        specAmount = mix(0.2, 0.8, clamp(panel, 0.0, 1.0));
        gloss = 30.0;
    } else if (matId == M_BOX_LAMP) {
        albedo = vec3(0.0);
        emissive = WARM * (1.4 * uBoxLamp + 0.3 * uDay);
    }

    // Tight curves (seat edges far away) spread their highlight instead of sparkling.
    vec3 dn = fwidth(n);
    gloss = gloss / (1.0 + gloss * dot(dn, dn) * 2.0);

    vec3 spec = vec3(0.0);
    vec3 e = screenLight(p, n)
        + boxLight(p, n, v, gloss, spec)
        + sconceLight(p, n, v, gloss, spec)
        + stepLight(p, n, v, gloss, spec)
        + footLight(p, n, v, gloss, spec)
        + uplight(p, n, v, gloss, spec)
        + exitLight(p, n, v, gloss, spec)
        + coveLight(p, n)
        + houseLight(p, n)
        + uAmbient;

    float facing = max(dot(n, v), 0.0);
    vec3 color;
    if (metal > 0.5) {
        color = albedo * (e * 0.3 + mirrored(p, reflect(-v, n))) * ao + albedo * spec * specAmount;
    } else {
        color = albedo * e * ao * (1.0 - 0.15 * velvet);
        // Velvet: the pile catches light at grazing angles and gives it back nearly in the light's own colour.
        vec3 sheen = mix(albedo * 2.5, vec3(0.05), 0.5);
        color += velvet * e * ao * sheen * 1.6 * pow(1.0 - facing, 3.0);
        color += spec * specAmount * 0.25 * ao;
    }
    color += emissive;

    float dist = length(cameraPosition - p);
    // Air: the haze thickens with distance and glows in the screen's light toward the stage.
    vec3 air = uHaze + (uScreenL + uScreenC + uScreenR) * 0.0008 * smoothstep(14.0, 2.0, p.z) * (1.0 - uDay);
    color = mix(color, air, 1.0 - exp(-dist * 0.024));
    gl_FragColor = vec4(finishColor(color), 1.0);
}
`;

const SCREEN_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SCREEN_FRAGMENT = `
${COMMON_GLSL}
uniform float uDay;
uniform vec2 uMargin;
uniform float uShutter;
uniform vec3 uScreenL;
uniform vec3 uScreenC;
uniform vec3 uScreenR;

varying vec2 vUv;

const vec3 BARE_SCREEN = vec3(0.5, 0.48, 0.45);

void main() {
    // vUv spans the screen and a margin of masking round it; uv is the picture's own 0..1.
    vec2 uv = (vUv - 0.5) * (1.0 + 2.0 * uMargin) + 0.5;
    vec3 thrown = (uScreenL + uScreenC + uScreenR) * (1.0 - uDay);
    vec2 outside = max(abs(uv - 0.5) - 0.5, 0.0) * vec2(SCREEN_W, SCREEN_H);
    float out_ = length(outside);
    if (out_ > 0.0) {
        // The black masking, with a faint halation of the picture's light at its edge.
        gl_FragColor = vec4(finishColor(vec3(0.004) + thrown * 0.0035 * exp(-out_ * 16.0)), 1.0);
        return;
    }
    // The picture is the user's, in a box under the canvas (the host's surface), shown exactly as it is.
    // In an intermission the shutter shuts and the bare screen covers it (pale by the house lights).
    float bare = 1.0 - uShutter;
    gl_FragColor = vec4(finishColor(BARE_SCREEN * uDay) * bare, bare);
}
`;

const BEAM_VERTEX = `
uniform mat4 uInvViewProj;
varying vec4 vFar;
varying vec2 vUv;
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vFar = uInvViewProj * vec4(position.xy, 1.0, 1.0);
    vUv = position.xy * 0.5 + 0.5;
}
`;

const BEAM_FRAGMENT = `
${COMMON_GLSL}
${PROJECTION_GLSL}
uniform vec4 uBeamPlanes[4];
uniform sampler3D uNoise;
uniform float uBeamGain;
uniform float uSmokeTime;
// Drawn in a pass of its own after the hall (cinemaPost.ts): the eye, and the hall's depth to stop at.
uniform vec3 uEye;
uniform sampler2D uDepth;
uniform mat4 uInvProj;

varying vec4 vFar;
varying vec2 vUv;

const int STEPS = 14;

void main() {
    vec3 ro = uEye;
    vec3 rd = normalize(vFar.xyz / vFar.w - ro);
    // Clip the view ray to the pyramid from the lens to the screen's edges, and stop at the screen, and at
    // the first thing in the hall the eye sees along it (a curtain, the valance, a wall, a head).
    float t0 = 0.0;
    float t1 = rd.z < -1e-4 ? -ro.z / rd.z : 1e3;
    vec4 hit = uInvProj * vec4(vUv * 2.0 - 1.0, texture2D(uDepth, vUv).r * 2.0 - 1.0, 1.0);
    t1 = min(t1, length(hit.xyz / hit.w));
    for (int i = 0; i < 4; i++) {
        vec4 plane = uBeamPlanes[i];
        float dn = dot(plane.xyz, rd);
        float dist = dot(plane.xyz, ro) + plane.w;
        if (abs(dn) < 1e-6) {
            if (dist < 0.0) discard;
            continue;
        }
        float t = -dist / dn;
        if (dn > 0.0) t0 = max(t0, t);
        else t1 = min(t1, t);
    }
    if (t1 <= t0) discard;

    vec3 lens = vec3(0.0, PROJ_Y, PROJ_Z);
    float throwDistance = length(vec3(0.0, SCREEN_CY, 0.0) - lens);
    float dt = (t1 - t0) / float(STEPS);
    // Interleaved gradient noise: hides the banding of few steps without a crawling speckle.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 sum = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
        vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
        vec2 uv = projectorUv(p);
        vec3 light = reelImage(clamp(uv, 0.0, 1.0), 4.0, true);
        light /= 1.0 + 0.8 * light;
        float d = length(p - lens);
        float spread = min(throwDistance * throwDistance / (d * d), 1.6);
        vec3 drift = vec3(uSmokeTime * 0.013, -uSmokeTime * 0.02, uSmokeTime * 0.008);
        float smoke = texture(uNoise, p * 0.085 + drift).r * 0.62 + texture(uNoise, p * 0.23 - drift * 1.7 + 0.37).r * 0.38;
        float density = 0.3 + 1.3 * smoothstep(0.35, 0.9, smoke);
        float edge = smoothstep(0.0, 0.025, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
        sum += light * density * spread * edge;
    }
    sum *= dt * uBeamGain;
    // Added onto the finished picture (the composite pass): brought into display space here.
    gl_FragColor = vec4(linearToSrgb(min(sum, vec3(1.0))) * 0.55, 1.0);
}
`;

const DUST_VERTEX = `
${LAYOUT_GLSL}
attribute vec4 aSeed;
uniform float uDustTime;
uniform float uProjScale;
uniform float uDustGain;
uniform vec3 uScreenL;
uniform vec3 uScreenC;
uniform vec3 uScreenR;
varying vec3 vColor;
varying float vBlur;

vec2 projectorUv(vec3 p) {
    vec3 o = vec3(0.0, PROJ_Y, PROJ_Z);
    vec3 s = p - o;
    vec3 q = o + s * (-o.z / min(s.z, -1e-4));
    return vec2((q.x + SCREEN_W * 0.5) / SCREEN_W, (q.y - (SCREEN_CY - SCREEN_H * 0.5)) / SCREEN_H);
}

void main() {
    vec3 boxMin = vec3(-SCREEN_W * 0.5 - 0.9, 3.0, 3.0);
    vec3 boxSize = vec3(SCREEN_W + 1.8, 7.4, 22.0);
    float t = uDustTime;
    vec3 drift = vec3(
        sin(t * 0.11 + aSeed.w * 40.0) * 0.012,
        t * (0.0018 + 0.003 * aSeed.w),
        cos(t * 0.07 + aSeed.x * 30.0) * 0.006
    );
    vec3 p = boxMin + fract(aSeed.xyz + drift) * boxSize;
    p += vec3(sin(t * 0.6 + aSeed.y * 50.0), sin(t * 0.47 + aSeed.z * 40.0), cos(t * 0.53 + aSeed.w * 20.0)) * 0.05;

    vec2 uv = projectorUv(p);
    float inside = smoothstep(0.0, 0.05, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    vec3 light = uv.x < 0.5 ? mix(uScreenL, uScreenC, uv.x * 2.0) : mix(uScreenC, uScreenR, uv.x * 2.0 - 1.0);
    // Motes turn as they float, catching the beam now and then.
    float glint = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(t * (1.2 + aSeed.w * 2.6) + aSeed.x * 60.0), 4.0);

    vec4 mv = viewMatrix * vec4(p, 1.0);
    float depth = max(-mv.z, 0.1);
    float size = (0.014 + 0.03 * aSeed.w) * uProjScale / depth;
    vBlur = smoothstep(5.0, 1.5, depth);
    float px = mix(max(size, 1.5), min(size * 3.0 + 6.0, 44.0), vBlur);
    // Light spread over a bigger disc is fainter per pixel.
    float energy = min(1.0, (size * size) / (px * px)) * mix(1.0, 3.0, vBlur);
    vColor = light * inside * glint * energy * uDustGain;
    gl_PointSize = px;
    gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAGMENT = `
varying vec3 vColor;
varying float vBlur;
void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float dot_ = exp(-r * r * 4.0);
    float disc = (1.0 - smoothstep(0.82, 1.0, r)) * (0.55 + 0.45 * r);
    gl_FragColor = vec4(vColor * mix(dot_, disc, vBlur), 1.0);
}
`;

const GLOW_VERTEX = `
attribute vec3 aColor;
attribute vec2 aSizeKind;
uniform float uProjScale;
uniform float uTime;
uniform float uDay;
uniform vec3 uCove;
uniform float uGlowGain;
varying vec3 vColor;

void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-mv.z, 0.1);
    float px = aSizeKind.x * uProjScale / depth;
    vec3 color = aColor;
    float kind = aSizeKind.y;
    if (kind > 1.5) {
        color = uCove * aColor.r;
    } else if (kind > 0.5) {
        float seed = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        color *= (0.55 + 0.45 * sin(uTime * (0.6 + seed * 1.4) + seed * 40.0)) * (1.0 - uDay);
    }
    // Below two pixels a lamp keeps its light and loses its size.
    color *= min(1.0, (px * px) / 4.0);
    vColor = color * uGlowGain;
    gl_PointSize = clamp(px, 2.0, 220.0);
    gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAGMENT = `
varying vec3 vColor;
void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float glow = exp(-r * r * 6.0) * (1.0 - r) + 0.7 * exp(-r * r * 60.0);
    gl_FragColor = vec4(vColor * glow, 1.0);
}
`;

export const CINEMA_SHADERS = {
    room: { vertexShader: ROOM_VERTEX, fragmentShader: ROOM_FRAGMENT },
    screen: { vertexShader: SCREEN_VERTEX, fragmentShader: SCREEN_FRAGMENT },
    beam: { vertexShader: BEAM_VERTEX, fragmentShader: BEAM_FRAGMENT },
    dust: { vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT },
    glow: { vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT },
};
