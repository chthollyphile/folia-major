import * as THREE from 'three';

// src/components/visualizer/machi/engine/snow.ts
// 积雪：注入卡通材质的着色器，朝上的面按 积雪量 × 朝上程度 × 噪声 混成雪色（在光照之前改底色，所以雪也有明暗）。
// 屋顶下面（场景给的屋顶范围里、低于屋顶高度）不积雪，店里的货架、罩棚下的加油机都干净。
// 所有材质共用一组 uniform；视空间里的“上”每帧由运行时按镜头更新。

/** 最多几块屋顶（与天气的屋顶一致）。 */
export const MACHI_SNOW_MAX_ROOFS = 4;

export interface MachiSnowUniforms {
    uMachiSnow: { value: number };
    uMachiSnowColor: { value: THREE.Color };
    uMachiViewUp: { value: THREE.Vector3 };
    uMachiRoofs: { value: THREE.Vector4[] };
    uMachiRoofY: { value: number[] };
    /** 路面湿度 0..1（高光用，见 sheen.ts）；与积雪同一组 uniform，所有卡通材质共用。 */
    uMachiWet: { value: number };
}

export const createMachiSnowUniforms = (): MachiSnowUniforms => ({
    uMachiSnow: { value: 0 },
    uMachiSnowColor: { value: new THREE.Color(0xf2f5fa) },
    uMachiViewUp: { value: new THREE.Vector3(0, 1, 0) },
    uMachiRoofs: { value: Array.from({ length: MACHI_SNOW_MAX_ROOFS }, () => new THREE.Vector4()) },
    uMachiRoofY: { value: Array.from({ length: MACHI_SNOW_MAX_ROOFS }, () => -100) },
    uMachiWet: { value: 0 },
});

/** 换场景：屋顶范围（与天气布局同一份）。 */
export const setMachiSnowRoofs = (uniforms: MachiSnowUniforms, roofs: readonly { x0: number; z0: number; x1: number; z1: number; y: number }[]) => {
    for (let index = 0; index < MACHI_SNOW_MAX_ROOFS; index += 1) {
        const roof = roofs[index];
        uniforms.uMachiRoofs.value[index]!.set(roof?.x0 ?? 0, roof?.z0 ?? 0, roof?.x1 ?? 0, roof?.z1 ?? 0);
        uniforms.uMachiRoofY.value[index] = roof?.y ?? -100;
    }
};

const VERTEX_PARS = /* glsl */ `
varying vec3 vMachiWorld;
`;

const VERTEX = /* glsl */ `
{
    vec4 machiLocal = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
        machiLocal = instanceMatrix * machiLocal;
    #endif
    vMachiWorld = (modelMatrix * machiLocal).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uMachiSnow;
uniform vec3 uMachiSnowColor;
uniform vec3 uMachiViewUp;
uniform vec4 uMachiRoofs[${MACHI_SNOW_MAX_ROOFS}];
uniform float uMachiRoofY[${MACHI_SNOW_MAX_ROOFS}];
varying vec3 vMachiWorld;
float machiSnowHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
float machiSnowNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(machiSnowHash(i), machiSnowHash(i + vec2(1.0, 0.0)), u.x), mix(machiSnowHash(i + vec2(0.0, 1.0)), machiSnowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float machiSheltered(vec3 p) {
    for (int i = 0; i < ${MACHI_SNOW_MAX_ROOFS}; i++) {
        vec4 r = uMachiRoofs[i];
        if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w && p.y < uMachiRoofY[i] - 0.05) return 1.0;
    }
    return 0.0;
}
`;

const FRAGMENT = /* glsl */ `
if (uMachiSnow > 0.001) {
    float machiUp = dot(normalize(normal), uMachiViewUp);
    float machiNoise = machiSnowNoise(vMachiWorld.xz * 2.6) * 0.65 + machiSnowNoise(vMachiWorld.xz * 7.1) * 0.35;
    // 积得越多，噪声的门槛越低：先是一块块的，后来连成一片。
    float machiCover = smoothstep(0.5, 0.85, machiUp) * smoothstep(1.0 - uMachiSnow * 0.9, 1.16 - uMachiSnow * 0.9, machiNoise + 0.25);
    machiCover *= 1.0 - machiSheltered(vMachiWorld);
    diffuseColor.rgb = mix(diffuseColor.rgb, uMachiSnowColor, machiCover * min(1.0, uMachiSnow * 1.4));
}
`;

/** 把积雪注入一个卡通材质的着色器（在 onBeforeCompile 里调）。 */
export const injectMachiSnow = (shader: THREE.WebGLProgramParametersWithUniforms, uniforms: MachiSnowUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT}`);
};
