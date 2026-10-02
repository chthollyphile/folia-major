// src/components/visualizer/backgrounds/tide/tideSurfaceShader.ts
// The pass that paints the water, as one continuous surface with no grid.
// The rolling sea, the fog, the intro sweep and the ink glow are the reference's own maths, but the
// reference only read one field value per slat and leaned each slat by hand - that is where its
// crisp facets came from. Without slats the per-pixel field alone is far too smooth, so the water is
// lit as a surface instead: the four reference waves band the height, three extra ripples carry the
// small detail, and the analytic slope builds a normal that a grazing light turns into crest lines.
// 相机开关：整片水面按歌词位置平移俯仰（字在右边水面就向左滑），造 splat 时按同一偏移反向补偿。

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

void main() {
    vec2 center = gl_FragCoord.xy / max(u_dpr, 0.5);
    vec2 uv = clamp(center / u_size, 0.0, 1.0);
    // The reference counts v downwards from the top of the frame: 0 is the horizon, 1 is at your feet.
    float v = 1.0 - uv.y;
    // The camera pans the whole water plane towards the sung word: lyrics on the right slide it
    // left. The splats are shifted by the same offset, so a splash still grows under its glyph.
    vec2 suv = uv + u_camera;

    vec2 flow = vec2(0.0);
    float ink = 0.0;
    if (u_fluid > 0.5) {
        flow = texture2D(t_velocity, suv).xy * u_fluid_texel * u_size;
        ink = texture2D(t_ink, suv).x;
    }

    float horizon = mix(8.0, 0.5, u_perspective);
    float depth = (1.0 + horizon) / (suv.y + horizon);
    vec2 world = vec2((suv.x - 0.5) * u_size.x / u_size.y * depth, (depth - 1.0) * horizon * 2.2);
    world -= flow * 0.00018 * depth;
    world /= max(u_scale, 0.05);

    float meander = 0.55 * sin(dot(world, vec2(0.23, 0.41)) * 0.9 + u_time * 0.13)
        + 0.3 * sin(dot(world, vec2(-0.37, 0.19)) * 1.4 - u_time * 0.09);

    float steep = u_chop * 0.45;
    float stretch = 1.0 - u_stretch * 0.5;
    // Four reference swells carry the crests, three ripples only carry detail.
    vec3 swell = tideWave(u_direction, 2.6, 1.0, 0.0, world, u_time, meander * 0.6, steep);
    swell += tideWave(u_direction - 0.95, 1.7, 0.75, 2.3, world, u_time, meander * 0.9, steep);
    swell += tideWave(u_direction + 0.78, 1.12, 0.5, 4.1, world, u_time, meander * 1.2, steep);
    swell += tideWave(u_direction + 1.62, 0.76, 0.3, 1.1, world, u_time, meander * 1.5, steep);
    vec3 ripple = tideWave(u_direction + 0.35, 0.42, 0.14, 5.6, world, u_time, meander * 1.8, steep);
    ripple += tideWave(u_direction - 1.35, 0.26, 0.08, 3.2, world, u_time, meander * 2.1, steep);
    ripple += tideWave(u_direction + 2.25, 0.17, 0.05, 0.7, world, u_time, meander * 2.4, steep);

    float height = (swell.x + ripple.x * 0.5) * stretch;
    vec2 slope = (swell.yz + ripple.yz * 0.6) * stretch;
    float total = 2.82 * (1.0 + steep);
    float level = clamp(0.5 + 0.5 * height / (total * 0.85), 0.0, 1.0);

    // Grazing light: only the slopes facing it light up, so the highlights become crest lines.
    vec3 normal = normalize(vec3(-slope * u_relief, 1.0));
    vec3 lightDir = normalize(vec3(-0.55, 0.42, 0.5));
    float diffuse = clamp(dot(normal, lightDir), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), u_glint_power);

    float crest = smoothstep(0.6, 1.0, level);
    float haze = mix(1.0, 1.0 - u_fog, pow(1.0 - v, 1.4));
    // A narrow band of the wave height turns a smooth field into crest lines.
    // The ink also lifts the crest a little, so the stirring reads as part of the water.
    level = clamp(level + ink * 0.35, 0.0, 1.0);
    float band = pow(smoothstep(0.5, 0.86, level), 1.8) * pow(clamp(level, 0.0, 1.0), u_contrast * 0.5);
    // A light direction with a small z separates the lit slopes from the shaded ones.
    float facet = pow(clamp(diffuse, 0.0, 1.0), 2.0);
    float light = (band * 0.7 + facet * 0.62) * haze;
    float glint = (crest * crest * 0.35 + spec * 1.5) * u_glint * haze;
    light += glint * 0.55;
    float glow = 1.0 - exp(-max(ink, 0.0) * u_ink * 1.6);
    light = 1.0 - (1.0 - clamp(light, 0.0, 1.0)) * (1.0 - glow);

    float front = u_intro * 1.35;
    float reveal = 1.0 - smoothstep(front - 0.35, front, v);
    float sweep = exp(-pow((v - front + 0.22) / 0.07, 2.0)) * (1.0 - u_intro);
    light = (light + sweep * 0.8) * reveal;
    light = max(light, 0.02 * reveal);

    // Like the reference, the crest colour blends between the base and the glint colour.
    float tint = clamp(max(glint * 1.15, glow * 0.5) + sweep, 0.0, 1.0);
    vec3 tinted = mix(u_surface, u_glint_color, tint);
    vec3 color = mix(u_background, tinted, clamp(light, 0.0, 1.0));
    // A soft glow marks where the lyrics stirred the water.
    color += u_glow_color * glow * 0.12;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
