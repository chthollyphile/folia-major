import { describe, expect, it } from 'vitest';

// test/unit/visualizer/tideShaderContract.test.ts
// The tide pipeline is hand-written GLSL ES 1.00 because the app still runs on plain WebGL 1
// contexts: no uniform arrays (ANGLE: "Index expression can only contain const or loop symbols"),
// no non-ASCII bytes inside a shader string, no ES 3.00 syntax. The water has to stay a port of the
// Micro Slats reference, so the surface pass is checked for its signature terms too.

import {
    TIDE_ADVECT_FRAGMENT_SHADER,
    TIDE_CURL_FRAGMENT_SHADER,
    TIDE_DIVERGENCE_FRAGMENT_SHADER,
    TIDE_PRESSURE_FRAGMENT_SHADER,
    TIDE_PROJECT_FRAGMENT_SHADER,
    TIDE_SCALE_FRAGMENT_SHADER,
    TIDE_SPLAT_FRAGMENT_SHADER,
    TIDE_VORTICITY_FRAGMENT_SHADER,
} from '@/components/visualizer/backgrounds/tide/tideShaders';
import { TIDE_SURFACE_FRAGMENT_SHADER } from '@/components/visualizer/backgrounds/tide/tideSurfaceShader';

const FLUID_FRAGMENT_SHADERS: Record<string, string> = {
    splat: TIDE_SPLAT_FRAGMENT_SHADER,
    curl: TIDE_CURL_FRAGMENT_SHADER,
    vorticity: TIDE_VORTICITY_FRAGMENT_SHADER,
    divergence: TIDE_DIVERGENCE_FRAGMENT_SHADER,
    pressure: TIDE_PRESSURE_FRAGMENT_SHADER,
    project: TIDE_PROJECT_FRAGMENT_SHADER,
    advect: TIDE_ADVECT_FRAGMENT_SHADER,
    scale: TIDE_SCALE_FRAGMENT_SHADER,
};

const ALL_FRAGMENT_SHADERS: Record<string, string> = {
    ...FLUID_FRAGMENT_SHADERS,
    surface: TIDE_SURFACE_FRAGMENT_SHADER,
};

describe('tide shader contract', () => {
    it('stays pure ASCII: a stray byte inside a shader string can fail the ANGLE translator', () => {
        for (const [name, source] of Object.entries(ALL_FRAGMENT_SHADERS)) {
            expect(source, name).toMatch(/^[\x00-\x7f]*$/);
        }
    });

    it('never declares a uniform array', () => {
        for (const [name, source] of Object.entries(ALL_FRAGMENT_SHADERS)) {
            expect(source, name).not.toMatch(/uniform\s+\w+\s+\w+\s*\[/);
        }
    });

    it('keeps every shader in GLSL ES 1.00', () => {
        for (const [name, source] of Object.entries(ALL_FRAGMENT_SHADERS)) {
            expect(source, name).not.toContain('#version');
            expect(source, name).not.toContain('texture(');
            expect(source, name).not.toContain('texelFetch');
            expect(source, name).not.toMatch(/\bout\s+vec4\b/);
            expect(source, name).not.toMatch(/\bin\s+vec2\b/);
        }
    });

    it('writes gl_FragColor from every fragment shader', () => {
        for (const [name, source] of Object.entries(ALL_FRAGMENT_SHADERS)) {
            expect(source, name).toContain('precision highp float;');
            expect(source, name).toContain('void main()');
            expect(source, name).toContain('gl_FragColor');
        }
    });

    it('reads the four neighbour uvs in every solver pass', () => {
        const neighbourPasses = ['curl', 'vorticity', 'divergence', 'pressure', 'project'];

        for (const name of neighbourPasses) {
            const source = FLUID_FRAGMENT_SHADERS[name];
            expect(source, name).toContain('varying vec2 v_left;');
            expect(source, name).toContain('varying vec2 v_top;');
            expect(source, name).toContain('v_right');
            expect(source, name).toContain('v_bottom');
        }
    });

    it('keeps the splat falloff in the reference shape', () => {
        expect(TIDE_SPLAT_FRAGMENT_SHADER).toContain('offset.x *= u_aspect;');
        expect(TIDE_SPLAT_FRAGMENT_SHADER).toContain('exp(-dot(offset, offset) / max(u_radius, 0.00001))');
        expect(TIDE_SPLAT_FRAGMENT_SHADER).toContain('u_value * falloff');
    });

    it('decays the advect pass in time, like the reference', () => {
        expect(TIDE_ADVECT_FRAGMENT_SHADER).toContain('v_uv - u_dt * texture2D(u_velocity, v_uv).xy * u_texel');
        // 参考实现除以 (1 + fade * dt)：乘一个每帧常数会让衰减随帧率漂移。
        expect(TIDE_ADVECT_FRAGMENT_SHADER).toContain('texture2D(u_source, from) / (1.0 + u_fade * u_dt)');
    });

    it('keeps the surface pass as literal wave calls and no wave array', () => {
        const calls = TIDE_SURFACE_FRAGMENT_SHADER.match(/tideWave\(/g) ?? [];
        // One declaration plus the seven components of the sea: four from the reference, three ripples.
        expect(calls).toHaveLength(8);
        // 参考实现的水位、透视和流场推移原样保留。
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('return vec3(height * wave, slope * heading);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float total = 2.82 * (1.0 + steep);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float v = 1.0 - uv.y;');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('world -= flow * 0.00018 * depth;');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('flow = texture2D(t_velocity, suv).xy * u_fluid_texel * u_size;');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('ink = texture2D(t_ink, suv).x;');
        // 没有格点，水面就得自己受光：解析导数搭出法线，再由掠射光和镜面高光收出浪脊。
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('vec3 normal = normalize(vec3(-slope * u_relief, 1.0));');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float spec = pow(clamp(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), u_glint_power);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float band = pow(smoothstep(0.5, 0.86, level), 1.8)');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float light = (band * 0.7 + facet * 0.62) * haze;');
        // 参考实现的雾、开场扫光、浪尖染色和墨迹发光也都在。
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float haze = mix(1.0, 1.0 - u_fog, pow(1.0 - v, 1.4));');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float reveal = 1.0 - smoothstep(front - 0.35, front, v);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float glint = (crest * crest * 0.35 + spec * 1.5) * u_glint * haze;');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float tint = clamp(max(glint * 1.15, glow * 0.5) + sweep, 0.0, 1.0);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('vec3 tinted = mix(u_surface, u_glint_color, tint);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('vec3 color = mix(u_background, tinted, clamp(light, 0.0, 1.0));');
        // 歌词搅动的水位抬高：交互和浪面是同一层，不是浮在上面的一团光。
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('level = clamp(level + ink * 0.35, 0.0, 1.0);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('color += u_glow_color * glow * 0.12;');
    });

    it('pans and tilts the whole field with the lyric camera', () => {
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('uniform vec2 u_camera;');
        // 相机偏移只作用在水面本身（uv + camera）：屏幕空间的雾和开场扫光仍然用 v。
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('vec2 suv = uv + u_camera;');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float depth = (1.0 + horizon) / (suv.y + horizon);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('vec2 world = vec2((suv.x - 0.5) * u_size.x / u_size.y * depth, (depth - 1.0) * horizon * 2.2);');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float v = 1.0 - uv.y;');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).toContain('float haze = mix(1.0, 1.0 - u_fog, pow(1.0 - v, 1.4));');
    });

    it('never draws slats: the surface paints one continuous field', () => {
        expect(TIDE_SURFACE_FRAGMENT_SHADER).not.toContain('u_grid');
        expect(TIDE_SURFACE_FRAGMENT_SHADER).not.toContain('floor(');
    });
});
