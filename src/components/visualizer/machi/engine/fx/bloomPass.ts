import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { fullscreenMaterial, type MachiSceneTarget } from './postPasses';

// src/components/visualizer/machi/engine/fx/bloomPass.ts
// 町景的 bloom：沿用 three 的 UnrealBloomPass 的做法（提亮 → 五级逐级降分辨率的高斯模糊 → 按各级权重、色调合成），合成结果
// 留在自己的低分辨率贴图上（texture），不整屏叠回去；光条、镜头 pass 取样时自己加上（postPasses.ts 的 GLOW_GLSL）。
// 读的是氛围画好的 scene.lit（不是合成器的读缓冲）。
// 整条链从 1/scale 分辨率起：scale 为 4 时比 UnrealBloomPass 的一半分辨率再小一半，各级的模糊核半径跟着减半，每一级的光晕
// 在屏幕上的大小不变；提亮取四个点、各自过门槛再平均，等于原来一半分辨率的提亮再缩小一半（小灯不会随镜头移动一闪一闪）。
// 模糊：同一分辨率上读同一分辨率的那几道（第一级的横竖两道、每级的竖向那道）成对取样——相邻两个点按各自的高斯权重合成
// 一次双线性取样，取样点少一半，结果不变；往下降一级的横向那道读的是两倍大的图，取样点不在纹素中心上，照原样逐点取。
// 合成用 UnrealBloomPass 自己的材质（各级权重、色调、强度、半径）。

/** UnrealBloomPass 一半分辨率时各级的模糊核半径。 */
const KERNEL_SIZES = [6, 10, 14, 18, 22];
const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

type Uniforms = Record<string, THREE.IUniform>;

/** 高斯权重（和 UnrealBloomPass 的算法一样：sigma 是半径的三分之一）。 */
const gaussian = (kernelRadius: number) => {
    const sigma = kernelRadius / 3;
    return Array.from({ length: kernelRadius }, (_, i) => 0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
};

/** 模糊的取样：paired 时第 i、i+1 个点合成一次，取在两点之间按权重分的位置上（纯函数，单测用）。 */
export const blurTaps = (kernelRadius: number, paired: boolean) => {
    const w = gaussian(kernelRadius);
    const offsets: number[] = [];
    const weights: number[] = [];
    for (let i = 1; i < kernelRadius; i += paired ? 2 : 1) {
        const a = w[i]!;
        const b = paired && i + 1 < kernelRadius ? w[i + 1]! : 0;
        offsets.push(i + b / (a + b));
        weights.push(a + b);
    }
    return { center: w[0]!, offsets, weights };
};

const BLUR_FRAGMENT = (taps: number) => /* glsl */ `
uniform sampler2D colorTexture;
uniform vec2 invSize;
uniform vec2 direction;
uniform float uCenter;
uniform float uOffsets[${taps}];
uniform float uWeights[${taps}];
varying vec2 vUv;
void main() {
    vec3 sum = texture2D(colorTexture, vUv).rgb * uCenter;
    for (int i = 0; i < ${taps}; i++) {
        vec2 offset = direction * invSize * uOffsets[i];
        sum += (texture2D(colorTexture, vUv + offset).rgb + texture2D(colorTexture, vUv - offset).rgb) * uWeights[i];
    }
    gl_FragColor = vec4(sum, 1.0);
}
`;

const blurMaterial = (kernelRadius: number, paired: boolean) => {
    const { center, offsets, weights } = blurTaps(kernelRadius, paired);
    return fullscreenMaterial({
        uniforms: {
            colorTexture: { value: null },
            invSize: { value: new THREE.Vector2() },
            direction: { value: new THREE.Vector2() },
            uCenter: { value: center },
            uOffsets: { value: offsets },
            uWeights: { value: weights },
        },
        fragmentShader: BLUR_FRAGMENT(offsets.length),
    });
};

/**
 * 提亮：亮度过门槛的留下，其余为黑（和 UnrealBloomPass 的 LuminosityHighPass 一样）。MACHI_SPREAD 时取四个点
 * （各是一块 2×2 的平均）各自过门槛再平均。
 */
const HIGH_PASS_FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
uniform vec2 uSpread;
varying vec2 vUv;
vec3 bright(vec2 uv) {
    vec3 texel = texture2D(tDiffuse, uv).rgb;
    return texel * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance(texel));
}
void main() {
#ifdef MACHI_SPREAD
    vec3 c = (bright(vUv - uSpread) + bright(vUv + vec2(uSpread.x, -uSpread.y))
        + bright(vUv + vec2(-uSpread.x, uSpread.y)) + bright(vUv + uSpread)) * 0.25;
#else
    vec3 c = bright(vUv);
#endif
    gl_FragColor = vec4(c, 1.0);
}
`;

export class MachiBloomPass extends UnrealBloomPass {
    private readonly quad = new FullScreenQuad();
    private readonly oldClearColor = new THREE.Color();
    private readonly highPass: THREE.ShaderMaterial;
    /** 各级的横向、竖向模糊。 */
    private readonly blurX: THREE.ShaderMaterial[];
    private readonly blurY: THREE.ShaderMaterial[];

    /** scale：整条链从画面的 1/scale 分辨率起（2 是 UnrealBloomPass 原来的一半分辨率）。 */
    constructor(private readonly scene: MachiSceneTarget, private readonly scale: number, strength: number, radius: number, threshold: number) {
        super(new THREE.Vector2(2, 2), strength, radius, threshold);
        // 提亮、模糊换成自己的材质：UnrealBloomPass 的那几个不用，先放掉（也省得预编）。
        this.separableBlurMaterials.forEach(material => material.dispose());
        this.separableBlurMaterials = [];
        const kernels = KERNEL_SIZES.slice(0, this.nMips).map(size => Math.max(2, Math.round(size * 2 / scale)));
        this.blurX = kernels.map((size, i) => blurMaterial(size, i === 0));
        this.blurY = kernels.map(size => blurMaterial(size, true));
        this.highPass = fullscreenMaterial({
            uniforms: {
                tDiffuse: { value: null },
                luminosityThreshold: { value: threshold },
                smoothWidth: { value: 0.01 },
                uSpread: { value: new THREE.Vector2() },
            },
            fragmentShader: HIGH_PASS_FRAGMENT,
            defines: scale > 2 ? { MACHI_SPREAD: '' } : {},
        });
        this.materialHighPassFilter.dispose();
        this.materialHighPassFilter = this.highPass;
    }

    /** 合成好的 bloom（1/scale 分辨率，已乘强度）。 */
    get texture() {
        return this.renderTargetsHorizontal[0]!.texture;
    }

    override setSize(width: number, height: number) {
        let x = Math.max(1, Math.round(width / this.scale));
        let y = Math.max(1, Math.round(height / this.scale));
        this.renderTargetBright.setSize(x, y);
        // 四个点各在一块 2×2 的中间：离这一级像素的中心四分之一个这一级像素。
        (this.highPass.uniforms.uSpread!.value as THREE.Vector2).set(this.scale / 4 / Math.max(1, width), this.scale / 4 / Math.max(1, height));
        for (let i = 0; i < this.nMips; i += 1) {
            this.renderTargetsHorizontal[i]!.setSize(x, y);
            this.renderTargetsVertical[i]!.setSize(x, y);
            (this.blurX[i]!.uniforms.invSize!.value as THREE.Vector2).set(1 / x, 1 / y);
            (this.blurY[i]!.uniforms.invSize!.value as THREE.Vector2).set(1 / x, 1 / y);
            x = Math.max(1, Math.round(x / 2));
            y = Math.max(1, Math.round(y / 2));
        }
    }

    /** UnrealBloomPass.render 去掉最后那道叠回读缓冲（也不支持直接上屏：町景的 bloom 后面总有镜头 pass）。 */
    override render(renderer: THREE.WebGLRenderer) {
        renderer.getClearColor(this.oldClearColor);
        const oldClearAlpha = renderer.getClearAlpha();
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setClearColor(this.clearColor, 0);
        const draw = (material: THREE.Material, target: THREE.WebGLRenderTarget) => {
            this.quad.material = material;
            renderer.setRenderTarget(target);
            renderer.clear();
            this.quad.render(renderer);
        };
        this.highPass.uniforms.tDiffuse!.value = this.scene.lit.texture;
        this.highPass.uniforms.luminosityThreshold!.value = this.threshold;
        draw(this.highPass, this.renderTargetBright);
        let input = this.renderTargetBright;
        for (let i = 0; i < this.nMips; i += 1) {
            const blurX = this.blurX[i]!;
            const blurY = this.blurY[i]!;
            blurX.uniforms.colorTexture!.value = input.texture;
            blurX.uniforms.direction!.value = BLUR_X;
            draw(blurX, this.renderTargetsHorizontal[i]!);
            blurY.uniforms.colorTexture!.value = this.renderTargetsHorizontal[i]!.texture;
            blurY.uniforms.direction!.value = BLUR_Y;
            draw(blurY, this.renderTargetsVertical[i]!);
            input = this.renderTargetsVertical[i]!;
        }
        const composite = this.compositeMaterial.uniforms as Uniforms;
        composite.bloomStrength!.value = this.strength;
        composite.bloomRadius!.value = this.radius;
        composite.bloomTintColors!.value = this.bloomTintColors;
        draw(this.compositeMaterial, this.renderTargetsHorizontal[0]!);
        renderer.setClearColor(this.oldClearColor, oldClearAlpha);
        renderer.autoClear = oldAutoClear;
    }

    override dispose() {
        super.dispose();
        // UnrealBloomPass.dispose() 不放提亮那道（materialHighPassFilter），换成的 highPass 在这里放。
        this.highPass.dispose();
        [...this.blurX, ...this.blurY].forEach(material => material.dispose());
        this.quad.dispose();
    }
}
