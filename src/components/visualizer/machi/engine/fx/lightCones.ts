import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MachiColorBlend, MachiMaterials } from '../materials';

// src/components/visualizer/machi/engine/fx/lightCones.ts
// 雨雾里看得见的光柱：场景给几束开口圆锥（路灯往下、罩棚灯……），合成一个 draw call，加色混合、不写深度；
// 越靠灯头越亮，越靠锥面边缘越淡（按法线与视线的夹角），再叠一点缓慢流动的噪声像雨雾里的光。

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vWorld;
attribute float aGain;
varying float vGain;
void main() {
    vUv = uv;
    vGain = aGain;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 view = viewMatrix * world;
    vNormalView = normalize(normalMatrix * normal);
    // 正交投影：视线方向处处一样。
    vViewDir = vec3(0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uLevel;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vWorld;
varying float vGain;
float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
    float facing = abs(dot(normalize(vNormalView), vViewDir));
    // 插值出来的 uv 可能是极小的负数，pow 的底必须夹到非负，否则 D3D 下得到 NaN，bloom 会把它铺满全屏。
    float axial = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
    float haze = 0.7 + 0.6 * cNoise(vec2(vWorld.x * 1.3 + vWorld.z, vWorld.y * 2.0 - uTime * 0.6));
    float alpha = facing * facing * axial * haze * vGain * uLevel;
    gl_FragColor = vec4(uColor * alpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/** 一束光柱：从 apex（灯头）指向 target，底面半径与亮度。 */
export interface MachiLightCone {
    apex: THREE.Vector3;
    target: THREE.Vector3;
    radius: number;
    gain: number;
}

/** 一个从 apex 指向 target 的开口圆锥（uv.y：灯头处为 1）。 */
const cone = (apex: THREE.Vector3, target: THREE.Vector3, radius: number, gain: number) => {
    const height = apex.distanceTo(target);
    // ConeGeometry 的尖在 +h/2、底在 -h/2：往下挪半个高，尖落在原点，轴朝 -y，再转向 target。
    const geometry = new THREE.ConeGeometry(radius, height, 20, 1, true);
    geometry.translate(0, -height / 2, 0);
    const direction = target.clone().sub(apex).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
    geometry.applyQuaternion(quaternion);
    geometry.translate(apex.x, apex.y, apex.z);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('aGain', new THREE.Float32BufferAttribute(new Float32Array(count).fill(gain), 1));
    return geometry;
};

export class MachiLightCones {
    readonly mesh: THREE.Mesh;
    private readonly material: THREE.ShaderMaterial;

    constructor(
        materials: MachiMaterials,
        private readonly blend: MachiColorBlend,
        cones: readonly MachiLightCone[],
        private readonly colorKey = 'streetLight',
    ) {
        const parts = cones.map(spec => cone(spec.apex, spec.target, spec.radius, spec.gain));
        const geometry = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false)!;
        if (parts.length > 1) parts.forEach(part => part.dispose());
        this.material = materials.track(new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uLevel: { value: 0.55 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        }));
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.name = 'LightCones';
        this.mesh.renderOrder = 6;
        this.syncColors();
    }

    syncColors() {
        (this.material.uniforms.uColor!.value as THREE.Color).copy(this.blend.get(this.colorKey));
    }

    update(time: number, level: number) {
        this.material.uniforms.uTime!.value = time;
        this.material.uniforms.uLevel!.value = 0.55 * level;
    }

    dispose() {
        this.mesh.geometry.dispose();
    }
}
