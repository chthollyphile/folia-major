// src/components/visualizer/backgrounds/tide/tideSurfaceShader.ts
// The pass that paints the water, as one continuous surface with no grid.
// The rolling sea, the fog, the intro sweep and the ink glow are the reference's own maths, but the
// reference only read one field value per slat and leaned each slat by hand - that is where its
// crisp facets came from. Without slats the per-pixel field alone is far too smooth, so the water is
// lit as a surface instead: the four reference waves band the height, three extra ripples carry the
// small detail, and the analytic slope builds a normal that a grazing light turns into crest lines.
// 相机开关：整片浪场按歌词位置平移俯仰（字在右边水面就向左滑）。相机平移的是 world（浪场），
// 不是采样点 uv：水花按屏幕坐标长在字底下，永远不出画面，也不会在边缘翻折/绕回。
export const TIDE_SURFACE_FRAGMENT_SHADER = `
precision highp float;
uniform vec2 u_size;
uniform float u_dpr;
uniform float u_time;
uniform float u_scale;
uniform float u_direction;
uniform float u_chop;
uniform float u_stretch;
uniform float u_glint;
uniform float u_glint_power;
uniform float u_contrast;
uniform float u_perspective;
uniform float u_fog;
uniform float u_intro;
uniform float u_relief;
uniform vec2 u_camera;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_breath;
uniform vec4 u_pulse0;
uniform vec4 u_pulse1;
uniform vec4 u_pulse2;
uniform vec4 u_focus0;
uniform vec4 u_focus1;
uniform vec4 u_focus2;
uniform vec4 u_focus3;
uniform vec4 u_focus4;
uniform vec4 u_focus5;
uniform sampler2D t_velocity;
uniform sampler2D t_ink;
uniform vec2 u_fluid_texel;
uniform float u_fluid;
uniform float u_ink;
uniform vec3 u_surface;
uniform vec3 u_glow_color;
uniform vec3 u_glint_color;
uniform vec3 u_background;

// One wave component: (height, d/dx, d/dy). The slope is the analytic derivative.
vec3 tideWave(float angle, float length, float height, float shift, vec2 world, float time, float meander, float steep) {
    vec2 heading = vec2(cos(angle), sin(angle));
    float k = 6.2831853 / length;
    float omega = sqrt(9.81 * k) * 0.35;
    float theta = k * dot(world, heading) - omega * time + shift + meander;
    float wave = cos(theta) + steep * cos(2.0 * theta);
    float slope = (-sin(theta) - 2.0 * steep * sin(2.0 * theta)) * height * k;
    return vec3(height * wave, slope * heading);
}

// One beat ring: a crest travelling outwards from (x, y). The slot is a vec4 (x, y, ageSeconds,
// strength); strength 0 means nothing is playing there, and the caller already folded the ring's
// life decay into the strength - so this is one multiply-based falloff: no pow, one exp.
// Dispersion: a real ripple widens as it travels. That is both what makes it read as water and
// what keeps the ridge from collapsing into the razor-thin highlight that flickers.
float tideRing(vec2 uv, vec4 pulse) {
    if (pulse.w <= 0.001) {
        return 0.0;
    }
    float radius = pulse.z * 0.5;
    float width = 0.09 + radius * 0.12;
    float spread = (distance(uv, pulse.xy) - radius) / max(width, 0.02);
    // A crest with a trough trailing behind it. A plain Gaussian bump reads as a bright blob
    // rather than as water: the trough is what turns it into a travelling wave, and it is what
    // darkens the band just inside the crest.
    float crest = exp(-spread * spread);
    float trough = exp(-(spread + 2.4) * (spread + 2.4)) * 0.55;
    return (crest - trough) * pulse.w;
}

// The lyric pool: (x, y, strength, unused). A ridge along the line of text, tight above and spread
// below, so the word reads as bleeding down into the water. One exp per slot, and the x spread
// stays tight enough that neighbouring words keep their own ridge instead of merging into a wash.
float tideFocus(vec2 uv, vec4 focus) {
    if (focus.z <= 0.001) {
        return 0.0;
    }
    vec2 offset = uv - focus.xy;
    float spreadY = offset.y < 0.0 ? 0.006 : 0.032;
    return exp(-(offset.y * offset.y) / spreadY - (offset.x * offset.x) / 0.045) * focus.z;
}

void main() {
    vec2 center = gl_FragCoord.xy / max(u_dpr, 0.5);
    vec2 uv = clamp(center / u_size, 0.0, 1.0);
    // The reference counts v downwards from the top of the frame: 0 is the horizon, 1 is at your feet.
    float v = 1.0 - uv.y;

    // The fluid is sampled in screen space: a splash stays where the glyph is, always inside the frame.
    vec2 flow = vec2(0.0);
    float ink = 0.0;
    if (u_fluid > 0.5) {
        flow = texture2D(t_velocity, uv).xy * u_fluid_texel * u_size;
        ink = texture2D(t_ink, uv).x;
    }

    float horizon = mix(8.0, 0.5, u_perspective);
    float depth = (1.0 + horizon) / (uv.y + horizon);
    vec2 world = vec2((uv.x - 0.5) * u_size.x / u_size.y * depth, (depth - 1.0) * horizon * 2.2);
    // Camera: translate the wave field by this point's local perspective scale. Moving the lookup
    // point instead (uv + camera) ran past the horizon once suv.y > 1 (depth < 1 folds the sea at
    // the bottom edge) and wrapped the fluid texture at the borders - that is the stretch/seam seen
    // around the frame. Translating world gives the same move with no border artifact.
    float aspect = u_size.x / u_size.y;
    float cameraRowScale = horizon * 2.2 * (1.0 + horizon) / ((uv.y + horizon) * (uv.y + horizon));
    world += vec2(u_camera.x * aspect * depth, -u_camera.y * cameraRowScale);
    world -= flow * 0.00018 * depth;
    world /= max(u_scale, 0.05);

    float meander = 0.55 * sin(dot(world, vec2(0.23, 0.41)) * 0.9 + u_time * 0.13)
        + 0.3 * sin(dot(world, vec2(-0.37, 0.19)) * 1.4 - u_time * 0.09);

    // Sound: the low end raises the swells, the mids make the sea choppier, the highs sharpen the
    // small ripples. This only re-shapes the surface - it never touches the fluid solver.
    // The breath is the drum: it fills the whole sea and then exhales, so the water pumps with the
    // beat instead of being kicked around.
    float breath = clamp(u_breath, 0.0, 1.0);
    float swellGain = (1.0 + u_bass * 0.55) * (1.0 + breath * 0.30);
    float rippleGain = (1.0 + u_treble * 1.4) * (1.0 + breath * 0.20);
    float steep = u_chop * 0.45 * (1.0 + u_mid * 0.7);
    float stretch = 1.0 - u_stretch * 0.5;
    // Four reference swells carry the crests, three ripples only carry detail.
    vec3 swell = tideWave(u_direction, 2.6, 1.0, 0.0, world, u_time, meander * 0.6, steep);
    swell += tideWave(u_direction - 0.95, 1.7, 0.75, 2.3, world, u_time, meander * 0.9, steep);
    swell += tideWave(u_direction + 0.78, 1.12, 0.5, 4.1, world, u_time, meander * 1.2, steep);
    swell += tideWave(u_direction + 1.62, 0.76, 0.3, 1.1, world, u_time, meander * 1.5, steep);
    vec3 ripple = tideWave(u_direction + 0.35, 0.42, 0.14, 5.6, world, u_time, meander * 1.8, steep);
    ripple += tideWave(u_direction - 1.35, 0.26, 0.08, 3.2, world, u_time, meander * 2.1, steep);
    ripple += tideWave(u_direction + 2.25, 0.17, 0.05, 0.7, world, u_time, meander * 2.4, steep);

    float height = (swell.x * swellGain + ripple.x * 0.5 * rippleGain) * stretch;
    vec2 slope = (swell.yz * swellGain + ripple.yz * 0.6 * rippleGain) * stretch;

    // Beat rings: one designed crest per kick, expanding outwards from where the music is.
    // Lyric focus: a pool of water lifts and lights up under the words being sung. The positions
    // arrive already glided, so this reads as a slow swell instead of a jitter. Slots are unrolled on
    // purpose: GLSL ES 1.00 cannot be trusted with uniform arrays.
    float ringField = tideRing(uv, u_pulse0) + tideRing(uv, u_pulse1) + tideRing(uv, u_pulse2);
    // The ridge carries the ink the words already left behind, so the shine keeps running after the
    // glyphs have moved on. That trailing smear is the "the word is dissolving into the water" read.
    float inkCarry = 0.55 + clamp(ink, 0.0, 2.0) * 1.15;
    float focusField = (tideFocus(uv, u_focus0) + tideFocus(uv, u_focus1) + tideFocus(uv, u_focus2)) * inkCarry;
    focusField += (tideFocus(uv, u_focus3) + tideFocus(uv, u_focus4) + tideFocus(uv, u_focus5)) * inkCarry;

    // The ring and the lyric ridge are mostly *height*: they raise real crests so the shine comes
    // from the water's own lighting. Only a little is handed to the glow, otherwise the sea washes
    // out into a flat spotlight.
    height += min(ringField, 1.2) * 0.55 + min(focusField, 1.5) * 0.85;
    float total = 2.82 * (1.0 + steep);
    float level = clamp(0.5 + 0.5 * height / (total * 0.85) + breath * 0.06, 0.0, 1.0);

    // Grazing light: only the slopes facing it light up, so the highlights become crest lines.
    vec3 normal = normalize(vec3(-slope * u_relief, 1.0));
    vec3 lightDir = normalize(vec3(-0.55, 0.42, 0.5));
    float diffuse = clamp(dot(normal, lightDir), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), u_glint_power);

    float crest = smoothstep(0.66, 1.0, level);
    float haze = mix(1.0, 1.0 - u_fog, pow(1.0 - v, 1.4));
    // A narrow band of the wave height turns a smooth field into crest lines. The window is kept
    // tight and the ink only lifts a little: a wide window (or a blanket ink lift) is what turned
    // the crests into one soft wash.
    level = clamp(level + ink * 0.30, 0.0, 1.0);
    float band = pow(smoothstep(0.55, 0.82, level), 2.2) * pow(clamp(level, 0.0, 1.0), u_contrast * 0.5);
    // A light direction with a small z separates the lit slopes from the shaded ones.
    float facet = pow(clamp(diffuse, 0.0, 1.0), 2.3);
    float light = (band * 0.7 + facet * 0.62) * haze;
    float glint = (crest * crest * 0.35 + spec * 1.5) * u_glint * (1.0 + u_treble * 0.75) * haze;
    light += glint * 0.55;
    float glow = 1.0 - exp(-max(ink, 0.0) * u_ink * 1.6);
    glow = clamp(glow + min(ringField, 1.2) * 0.26 + min(focusField, 1.5) * 0.25, 0.0, 1.0);
    light = 1.0 - (1.0 - clamp(light, 0.0, 1.0)) * (1.0 - glow);

    float front = u_intro * 1.35;
    float reveal = 1.0 - smoothstep(front - 0.35, front, v);
    float sweepOffset = (v - front + 0.22) * 14.2857;
    float sweep = exp(-sweepOffset * sweepOffset) * (1.0 - u_intro);
    light = (light + sweep * 0.8) * reveal;
    light = max(light, 0.02 * reveal);

    // Like the reference, the crest colour blends between the base and the glint colour.
    float tint = clamp(max(glint * 1.15, glow * 0.5) + sweep, 0.0, 1.0);
    vec3 tinted = mix(u_surface, u_glint_color, tint);
    vec3 color = mix(u_background, tinted, clamp(light, 0.0, 1.0));
    // A soft glow marks where the lyrics stirred the water. The dye is tinted by the spectrum: the
    // low end pushes it warm, the high end pushes it cool, so the colour flows with the music.
    float lowBand = clamp(u_bass, 0.0, 1.5);
    float midBand = clamp(u_mid, 0.0, 1.5);
    float highBand = clamp(u_treble, 0.0, 1.5);
    float warmth = clamp(lowBand - highBand * 0.6, -1.0, 1.0);
    vec3 glowTint = vec3(1.0 + warmth * 0.35, 1.0 + midBand * 0.06, 1.0 - warmth * 0.30);
    color += u_glow_color * glow * 0.12 * glowTint;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
