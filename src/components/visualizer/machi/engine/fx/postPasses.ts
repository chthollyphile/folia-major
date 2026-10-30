import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

// src/components/visualizer/machi/engine/fx/postPasses.ts
// 町景后处理的两道自定义 pass（镜头 pass 在 lensPass.ts）与它们共用的小工具：
// - 氛围（MachiAtmospherePass）：深度拉普拉斯墨线；由深度还原世界坐标，画贴地的薄雾（随风漂的噪声，靠近店门和路灯时
//   被灯染暖，像光在雾里散开），雾天再按深度蒙一层灰；天空像素上画慢慢漂的云（云量随天气）和闪电。
// - 光条（MachiStreakPass）：亮处在四分之一分辨率上只做横向模糊，叠回去成为横向的镜头光条（变形宽银幕镜头那种）。
// 都只用全屏四边形，额外的贴图都在低分辨率上。

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NOISE_GLSL = /* glsl */ `
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float pFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * pNoise(p);
        p = p * 2.03 + vec2(17.1, 9.2);
        amplitude *= 0.5;
    }
    return value;
}
`;

/**
 * 场景画进的目标：在合成器自己来回交换的两张缓冲之外单独一张（带 MSAA 和深度贴图），后面的 pass 随时取它的深度，
 * 不会碰上“正在写的帧缓冲上挂着的贴图又被采样”的反馈环。
 */
export interface MachiSceneTarget {
    target: THREE.WebGLRenderTarget;
}

/** 全屏 pass 的材质：不做深度测试、不写深度。 */
export const fullscreenMaterial = (parameters: THREE.ShaderMaterialParameters) => new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    depthTest: false,
    depthWrite: false,
    ...parameters,
});

const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uInkScale;
uniform float uDepthRange;
uniform float uThreshold;
uniform vec3 uInk;
uniform float uInkStrength;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uTime;
uniform vec3 uMistColor;
uniform float uMistAmount;
uniform float uMistHeight;
uniform vec2 uWind;
uniform vec4 uGlowA;
uniform vec3 uGlowColorA;
uniform vec4 uGlowB;
uniform vec3 uGlowColorB;
uniform vec3 uCloudColor;
uniform float uCloudAmount;
uniform float uHaze;
uniform vec2 uHazeRange;
uniform float uLightning;
uniform vec3 uLightningColor;
uniform float uAspect;
varying vec2 vUv;
${NOISE_GLSL}
float depthAt(vec2 uv) { return texture2D(tDepth, uv).x * uDepthRange; }
void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float raw = texture2D(tDepth, vUv).x;
    float d = raw * uDepthRange;
    bool sky = raw > 0.9999;
    // 墨线：平面上深度的二阶差分为零，只有轮廓和折角不为零。取样步长按屏幕像素（超采样时 uInkScale > 1），线宽不随超采样变。
    vec2 inkStep = uTexel * uInkScale;
    float l = depthAt(vUv - vec2(inkStep.x, 0.0));
    float r = depthAt(vUv + vec2(inkStep.x, 0.0));
    float u = depthAt(vUv + vec2(0.0, inkStep.y));
    float b = depthAt(vUv - vec2(0.0, inkStep.y));
    float lu = depthAt(vUv + vec2(-inkStep.x, inkStep.y));
    float rb = depthAt(vUv + vec2(inkStep.x, -inkStep.y));
    float ru = depthAt(vUv + inkStep);
    float lb = depthAt(vUv - inkStep);
    float laplace = abs(l + r - 2.0 * d) + abs(u + b - 2.0 * d) + 0.5 * (abs(lu + rb - 2.0 * d) + abs(ru + lb - 2.0 * d));
    float line = smoothstep(uThreshold, uThreshold * 2.6, laplace) * (sky ? 0.0 : 1.0);
    vec3 rgb = mix(color.rgb, uInk, line * uInkStrength);

    if (sky) {
        // 天空：两层慢慢漂的云，闪电时从云里亮起来。
        vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.4 + vec2(uTime * 0.012, 0.0);
        float cloud = smoothstep(mix(0.62, 0.38, uCloudAmount), 0.85, pFbm(p)) * smoothstep(0.0, 0.55, vUv.y) * (0.35 + 0.65 * uCloudAmount);
        float wisp = smoothstep(0.55, 0.9, pFbm(p * 2.3 + vec2(uTime * 0.02, 3.1))) * (0.5 + 0.5 * uCloudAmount);
        rgb += uCloudColor * (cloud * 0.55 + wisp * 0.18);
        rgb += uLightningColor * uLightning * (0.18 + 1.1 * cloud + 0.4 * wisp);
        rgb = mix(rgb, uMistColor, uHaze * 0.7);
    } else {
        // 还原世界坐标，画贴地的雾。
        vec4 ndc = vec4(vUv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0);
        vec4 view = uProjInv * ndc;
        view /= view.w;
        vec3 world = (uCamWorld * view).xyz;
        float height = max(world.y, 0.0);
        float drift = pFbm(world.xz * 0.32 + uWind * uTime) * 0.65 + pFbm(world.xz * 0.9 - uWind * uTime * 1.7) * 0.35;
        float density = uMistAmount * exp(-height / uMistHeight) * (0.35 + 0.9 * drift);
        // 灯在雾里散开：离店门、路灯越近，雾越亮越暖。
        vec2 da = world.xz - uGlowA.xz;
        vec2 db = world.xz - uGlowB.xz;
        vec3 lit = uMistColor
            + uGlowColorA * exp(-dot(da, da) / (uGlowA.w * uGlowA.w)) * exp(-height / 2.2)
            + uGlowColorB * exp(-dot(db, db) / (uGlowB.w * uGlowB.w)) * exp(-height / 3.0);
        rgb = mix(rgb, lit, clamp(density, 0.0, 0.85));
        // 雾天：离镜头越远越灰。
        rgb = mix(rgb, uMistColor, uHaze * (0.3 + 0.7 * smoothstep(uHazeRange.x, uHazeRange.y, d)));
        rgb += rgb * uLightning * 0.18;
    }
    gl_FragColor = vec4(rgb, color.a);
}
`;

export class MachiAtmospherePass extends Pass {
    readonly material: THREE.ShaderMaterial;
    private readonly quad: FullScreenQuad;

    constructor(private readonly scene: MachiSceneTarget) {
        super();
        this.material = fullscreenMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                uTexel: { value: new THREE.Vector2() },
                uInkScale: { value: 1 },
                uDepthRange: { value: 100 },
                uThreshold: { value: 0.05 },
                uInk: { value: new THREE.Color(0x0b0f1a) },
                uInkStrength: { value: 0.82 },
                uProjInv: { value: new THREE.Matrix4() },
                uCamWorld: { value: new THREE.Matrix4() },
                uTime: { value: 0 },
                uMistColor: { value: new THREE.Color() },
                uMistAmount: { value: 0.22 },
                uMistHeight: { value: 0.55 },
                uWind: { value: new THREE.Vector2(0.05, 0.02) },
                uGlowA: { value: new THREE.Vector4(0, 0, 0, 2.4) },
                uGlowColorA: { value: new THREE.Color() },
                uGlowB: { value: new THREE.Vector4(0, 0, 0, 1.8) },
                uGlowColorB: { value: new THREE.Color() },
                uCloudColor: { value: new THREE.Color() },
                uCloudAmount: { value: 1 },
                uHaze: { value: 0 },
                uHazeRange: { value: new THREE.Vector2(50, 70) },
                uLightning: { value: 0 },
                uLightningColor: { value: new THREE.Color(0xc9d8ff) },
                uAspect: { value: 16 / 9 },
            },
            fragmentShader: ATMOSPHERE_FRAGMENT,
        });
        this.quad = new FullScreenQuad(this.material);
    }

    setSize(width: number, height: number) {
        (this.material.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
        this.material.uniforms.uAspect!.value = width / Math.max(1, height);
    }

    /** 读的是单独的场景目标，不是合成器的读缓冲（场景没有画进那里）。 */
    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
        this.material.uniforms.tDiffuse!.value = this.scene.target.texture;
        this.material.uniforms.tDepth!.value = this.scene.target.depthTexture;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.material.dispose();
        this.quad.dispose();
    }
}

const BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb
        + texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb
        + texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb
        + texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    c *= 0.25;
    float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, luminance), 1.0);
}
`;

const STREAK_BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2;
    float weights[4];
    weights[0] = 0.17; weights[1] = 0.13; weights[2] = 0.08; weights[3] = 0.04;
    for (int i = 0; i < 4; i++) {
        vec2 offset = uStep * float(i + 1);
        sum += (texture2D(tDiffuse, vUv + offset).rgb + texture2D(tDiffuse, vUv - offset).rgb) * weights[i];
    }
    gl_FragColor = vec4(sum, 1.0);
}
`;

const ADD_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tAdd;
uniform vec3 uTint;
uniform float uStrength;
varying vec2 vUv;
void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(base.rgb + texture2D(tAdd, vUv).rgb * uTint * uStrength, base.a);
}
`;

/** 低分辨率的 HDR 中间贴图（尺寸由用它的 pass 定）。 */
export const halfFloatTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

/** 横向镜头光条：亮处降到四分之一分辨率，横向越扩越宽地模糊三次，再叠回去。 */
export class MachiStreakPass extends Pass {
    private readonly targets = [halfFloatTarget(), halfFloatTarget()];
    private readonly bright: THREE.ShaderMaterial;
    private readonly blur: THREE.ShaderMaterial;
    private readonly add: THREE.ShaderMaterial;
    private readonly quad = new FullScreenQuad();
    private width = 1;
    strength = 0.55;

    constructor() {
        super();
        this.bright = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } },
            fragmentShader: BRIGHT_FRAGMENT,
        });
        this.blur = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
            fragmentShader: STREAK_BLUR_FRAGMENT,
        });
        this.add = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, tAdd: { value: null }, uTint: { value: new THREE.Color(0.62, 0.74, 1.0) }, uStrength: { value: 0.55 } },
            fragmentShader: ADD_FRAGMENT,
        });
    }

    setSize(width: number, height: number) {
        this.width = Math.max(1, Math.round(width / 4));
        const h = Math.max(1, Math.round(height / 4));
        this.targets.forEach(target => target.setSize(this.width, h));
        (this.bright.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }

    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        const [a, b] = this.targets as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
        this.bright.uniforms.tDiffuse!.value = readBuffer.texture;
        this.quad.material = this.bright;
        renderer.setRenderTarget(a);
        this.quad.render(renderer);
        let source = a;
        let target = b;
        [1, 4, 14].forEach(spread => {
            this.blur.uniforms.tDiffuse!.value = source.texture;
            (this.blur.uniforms.uStep!.value as THREE.Vector2).set(spread / this.width, 0);
            this.quad.material = this.blur;
            renderer.setRenderTarget(target);
            this.quad.render(renderer);
            [source, target] = [target, source];
        });
        this.add.uniforms.tDiffuse!.value = readBuffer.texture;
        this.add.uniforms.tAdd!.value = source.texture;
        this.add.uniforms.uStrength!.value = this.strength;
        this.quad.material = this.add;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.targets.forEach(target => target.dispose());
        this.bright.dispose();
        this.blur.dispose();
        this.add.dispose();
        this.quad.dispose();
    }
}
