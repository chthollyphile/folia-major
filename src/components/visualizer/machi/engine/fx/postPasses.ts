import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

// src/components/visualizer/machi/engine/fx/postPasses.ts
// 町景后处理的两道自定义 pass（镜头 pass 在 lensPass.ts）与它们共用的小工具：
// - 氛围（MachiAtmospherePass）：深度拉普拉斯墨线；由深度还原世界坐标，画贴地的薄雾（随风漂的噪声，靠近店门和路灯时
//   被灯染暖，像光在雾里散开），雾天再按深度蒙一层灰；天空像素上画慢慢漂的云（云量随天气）和闪电（透明模式 MACHI_CUTOUT 下天空不画）。
// - 光条（MachiStreakPass）：亮处在四分之一分辨率上只做横向模糊，成为横向的镜头光条（变形宽银幕镜头那种）。
// 都只用全屏四边形，额外的贴图都在低分辨率上。bloom（bloomPass.ts）和光条都不整屏叠回去：结果留在各自的低分辨率贴图上，
// 后面的 pass 取样时用 GLOW_GLSL 现加（镜头 pass 最后一次画出加好的画面），少两道全分辨率的读写。

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
 * 不会碰上“正在写的帧缓冲上挂着的贴图又被采样”的反馈环。lit 是氛围 pass 画好的 HDR 画面（bloom、光条、镜头都读它）：
 * 也在合成器的缓冲之外，合成器那两张只装色调映射之后的颜色，用 8 位就够。
 */
export interface MachiSceneTarget {
    target: THREE.WebGLRenderTarget;
    lit: THREE.WebGLRenderTarget;
}

/**
 * 氛围之后的画面加上光晕：machiBloomed 加 bloom（post.ts 的 BLOOM_SCALE 分之一分辨率，双线性放大，已乘强度），machiGlowed 再加横向光条。
 * 用它的材质要有 tDiffuse（氛围画好的画面）和 MachiGlowUniforms 那几项。
 */
export const GLOW_GLSL = /* glsl */ `
uniform sampler2D tBloom;
uniform sampler2D tStreak;
uniform vec3 uStreakTint;
uniform float uStreakStrength;
vec3 machiBloomed(vec2 uv) { return texture2D(tDiffuse, uv).rgb + texture2D(tBloom, uv).rgb; }
vec3 machiGlowed(vec2 uv) { return machiBloomed(uv) + texture2D(tStreak, uv).rgb * uStreakTint * uStreakStrength; }
`;

/** GLOW_GLSL 的 uniform：光条、镜头 pass 共用同一份，MachiPost 每帧按 bloom、光条开没开填（关着的是一张黑贴图）。 */
export interface MachiGlowUniforms {
    tBloom: THREE.IUniform<THREE.Texture | null>;
    tStreak: THREE.IUniform<THREE.Texture | null>;
    uStreakTint: THREE.IUniform<THREE.Color>;
    uStreakStrength: THREE.IUniform<number>;
}

export const createGlowUniforms = (): MachiGlowUniforms => ({
    tBloom: { value: null },
    tStreak: { value: null },
    uStreakTint: { value: new THREE.Color(0.62, 0.74, 1.0) },
    uStreakStrength: { value: 0 },
});

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
#ifndef MACHI_CUTOUT
        // 天空：两层慢慢漂的云，闪电时从云里亮起来。
        vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.4 + vec2(uTime * 0.012, 0.0);
        float cloud = smoothstep(mix(0.62, 0.38, uCloudAmount), 0.85, pFbm(p)) * smoothstep(0.0, 0.55, vUv.y) * (0.35 + 0.65 * uCloudAmount);
        float wisp = smoothstep(0.55, 0.9, pFbm(p * 2.3 + vec2(uTime * 0.02, 3.1))) * (0.5 + 0.5 * uCloudAmount);
        rgb += uCloudColor * (cloud * 0.55 + wisp * 0.18);
        rgb += uLightningColor * uLightning * (0.18 + 1.1 * cloud + 0.4 * wisp);
        rgb = mix(rgb, uMistColor, uHaze * 0.7);
#endif
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

    /** cutout：透明模式，天空像素上不画云、闪电和雾天的灰。 */
    constructor(private readonly scene: MachiSceneTarget, cutout = false) {
        super();
        this.needsSwap = false;
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
            defines: cutout ? { MACHI_CUTOUT: '' } : {},
        });
        this.quad = new FullScreenQuad(this.material);
    }

    setSize(width: number, height: number) {
        (this.material.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
        this.material.uniforms.uAspect!.value = width / Math.max(1, height);
    }

    /** 读的是单独的场景目标，画进 scene.lit（都不是合成器的缓冲）。 */
    render(renderer: THREE.WebGLRenderer) {
        this.material.uniforms.tDiffuse!.value = this.scene.target.texture;
        this.material.uniforms.tDepth!.value = this.scene.target.depthTexture;
        renderer.setRenderTarget(this.scene.lit);
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
${GLOW_GLSL}
void main() {
    vec3 c = machiBloomed(vUv + uTexel * vec2(-1.0, -1.0))
        + machiBloomed(vUv + uTexel * vec2(1.0, -1.0))
        + machiBloomed(vUv + uTexel * vec2(-1.0, 1.0))
        + machiBloomed(vUv + uTexel * vec2(1.0, 1.0));
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

/** 低分辨率的 HDR 中间贴图（尺寸由用它的 pass 定）。 */
export const halfFloatTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

/**
 * 横向镜头光条：亮处（氛围的画面加上 bloom）降到四分之一分辨率，横向越扩越宽地模糊三次，结果留在 texture 上
 * （镜头 pass 叠，强度、色调在 MachiGlowUniforms 里）。
 */
export class MachiStreakPass extends Pass {
    private readonly targets = [halfFloatTarget(), halfFloatTarget()];
    private readonly bright: THREE.ShaderMaterial;
    private readonly blur: THREE.ShaderMaterial;
    private readonly quad = new FullScreenQuad();
    private width = 1;
    /** 模糊完的光条（最后一次模糊画进 targets 里的哪张：三次来回，落在第二张）。 */
    readonly texture: THREE.Texture;

    constructor(private readonly scene: MachiSceneTarget, glow: MachiGlowUniforms) {
        super();
        this.needsSwap = false;
        this.bright = fullscreenMaterial({
            uniforms: { ...glow, tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } },
            fragmentShader: BRIGHT_FRAGMENT,
        });
        this.blur = fullscreenMaterial({
            uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
            fragmentShader: STREAK_BLUR_FRAGMENT,
        });
        this.texture = this.targets[1]!.texture;
    }

    setSize(width: number, height: number) {
        this.width = Math.max(1, Math.round(width / 4));
        const h = Math.max(1, Math.round(height / 4));
        this.targets.forEach(target => target.setSize(this.width, h));
        (this.bright.uniforms.uTexel!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    }

    render(renderer: THREE.WebGLRenderer) {
        const [a, b] = this.targets as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
        this.bright.uniforms.tDiffuse!.value = this.scene.lit.texture;
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
    }

    dispose() {
        this.targets.forEach(target => target.dispose());
        this.bright.dispose();
        this.blur.dispose();
        this.quad.dispose();
    }
}
