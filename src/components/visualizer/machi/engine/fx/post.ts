import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { MachiRenderQuality } from '../quality';
import { MachiLensPass, type MachiLensSettings } from './lensPass';
import { MachiAtmospherePass, MachiStreakPass, type MachiSceneTarget } from './postPasses';

// src/components/visualizer/machi/engine/fx/post.ts
// 町景的后处理链：场景画进单独一张带深度贴图的 HDR 目标（MSAA，不参与合成器的来回交换）→ 氛围（墨线、贴地薄雾与灯的散射、云和闪电）
// → bloom（柔和、宽，让招牌和灯在雨夜里晕开）→ 横向镜头光条 → 镜头（散景景深、色差、暗角、颗粒）→ 色调映射输出
// → 抗锯齿（FXAA 或 SMAA，在输出之后的 sRGB 上做，边缘检测才准；墨线是氛围 pass 描的，场景目标的 MSAA 管不到它）。
// 画质（engine/quality.ts）决定场景目标的 MSAA、墨线的取样步长、开不开 bloom / 光条 / 景深离焦层、最后用哪种抗锯齿。

/** 后处理要的那几项画质。 */
export type MachiPostQuality = Pick<MachiRenderQuality, 'samples' | 'bloom' | 'streaks' | 'dof' | 'postAA' | 'inkScale'>;

/** 场景画进的 HDR 目标（带深度贴图，MSAA 采样数按画质）。 */
const createSceneTarget = (width: number, height: number, samples: number) => {
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.type = THREE.UnsignedIntType;
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples, depthTexture });
    target.texture.name = 'machi:scene';
    return target;
};

export interface MachiAtmosphereFrame {
    time: number;
    mistColor: THREE.Color;
    mistAmount: number;
    cloudColor: THREE.Color;
    /** 云量 0..1（晴天少，阴雨雾雪多）、晴夜的星星、雾天整体的灰。 */
    cloudAmount: number;
    stars: number;
    haze: number;
    lightning: number;
    /** 雾里的两处灯：xyz 位置、半径，颜色已乘好亮度。 */
    glowA: THREE.Vector4;
    glowColorA: THREE.Color;
    glowB: THREE.Vector4;
    glowColorB: THREE.Color;
    wind: THREE.Vector2;
}

export class MachiPost {
    private readonly composer: EffectComposer;
    private readonly scene: MachiSceneTarget;
    private readonly atmosphere: MachiAtmospherePass;
    private readonly bloom: UnrealBloomPass;
    private readonly streaks: MachiStreakPass;
    private readonly lens: MachiLensPass;
    private readonly fxaa: FXAAPass;
    private readonly smaa: SMAAPass;
    private readonly bufferSize = new THREE.Vector2();
    private bloomAllowed = true;
    private streaksAllowed = true;
    private bloomStrength = 0.5;
    private streakStrength = 0.55;

    constructor(
        private readonly renderer: THREE.WebGLRenderer,
        private readonly sceneGraph: THREE.Scene,
        private readonly camera: THREE.OrthographicCamera,
        quality: MachiPostQuality,
    ) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        this.scene = { target: createSceneTarget(size.x, size.y, quality.samples) };
        this.composer = new EffectComposer(renderer);
        this.atmosphere = new MachiAtmospherePass(this.scene);
        this.composer.addPass(this.atmosphere);
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.62, 0.86);
        this.composer.addPass(this.bloom);
        this.streaks = new MachiStreakPass();
        this.composer.addPass(this.streaks);
        this.lens = new MachiLensPass(this.scene);
        this.composer.addPass(this.lens);
        this.composer.addPass(new OutputPass());
        // 合成器把最后一道开着的 pass 画到屏幕上：两种抗锯齿都关着时，输出那道直接上屏。
        this.fxaa = new FXAAPass();
        this.composer.addPass(this.fxaa);
        this.smaa = new SMAAPass();
        this.composer.addPass(this.smaa);
        this.setQuality(quality);
    }

    /**
     * 跟着画布改尺寸（在 renderer.setSize 之后调）。所有缓冲区都用画布的整数像素尺寸：画布是 floor(宽 × 像素比)，
     * 合成器自己乘像素比会得到带小数的尺寸（墨线的取样步长按它算），场景目标原来又是四舍五入，像素比让尺寸带小数时
     * （Windows 125% 缩放、画质 75%）三者差出一列，按最近邻取深度的墨线在画面中段多跳一个纹素，画出一整条竖线。
     */
    setSize() {
        const { x: width, y: height } = this.renderer.getDrawingBufferSize(this.bufferSize);
        this.composer.setPixelRatio(1);
        this.composer.setSize(width, height);
        this.scene.target.setSize(width, height);
    }

    /** 换画质：MSAA 采样数变了就换一张场景目标（氛围、镜头 pass 读的是同一个 MachiSceneTarget，自动跟上）。 */
    setQuality(quality: MachiPostQuality) {
        const current = this.scene.target;
        if (current.samples !== quality.samples) {
            this.scene.target = createSceneTarget(current.width, current.height, quality.samples);
            current.depthTexture?.dispose();
            current.dispose();
        }
        this.atmosphere.material.uniforms.uInkScale!.value = quality.inkScale;
        this.bloomAllowed = quality.bloom;
        this.streaksAllowed = quality.streaks;
        this.lens.dofEnabled = quality.dof;
        this.fxaa.enabled = quality.postAA === 'fxaa';
        this.smaa.enabled = quality.postAA === 'smaa';
        this.applyGlow();
    }

    /** 光晕的强度随环境走：夜里 bloom 与横向光条明显，白天几乎没有（为 0 时整道 pass 跳过）。 */
    setGlow(bloom: number, streaks: number) {
        if (bloom === this.bloomStrength && streaks === this.streakStrength) return;
        this.bloomStrength = bloom;
        this.streakStrength = streaks;
        this.applyGlow();
    }

    private applyGlow() {
        this.bloom.strength = this.bloomStrength;
        this.bloom.enabled = this.bloomAllowed && this.bloomStrength > 0.005;
        this.streaks.strength = this.streakStrength;
        this.streaks.enabled = this.streaksAllowed && this.streakStrength > 0.005;
    }

    /**
     * 画一帧。墨线门槛跟着每个像素代表的世界尺寸走，缩放后线不变粗也不消失；centerDistance 是镜头到画面中心（目标点）
     * 的距离，雾的远近按它；lens.focus 是对焦深度（离镜头的距离）。
     */
    render(pixelWorldSize: number, centerDistance: number, atmosphere: MachiAtmosphereFrame, lens: MachiLensSettings) {
        const camera = this.camera;
        const range = camera.far - camera.near;
        const uniforms = this.atmosphere.material.uniforms;
        uniforms.uDepthRange!.value = range;
        // 墨线按屏幕像素取样（超采样时步长大于一个内部像素），门槛跟着取样步长代表的世界尺寸走。
        uniforms.uThreshold!.value = Math.max(0.004, pixelWorldSize * (uniforms.uInkScale!.value as number) * 0.7);
        (uniforms.uProjInv!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        (uniforms.uCamWorld!.value as THREE.Matrix4).copy(camera.matrixWorld);
        uniforms.uTime!.value = atmosphere.time;
        (uniforms.uMistColor!.value as THREE.Color).copy(atmosphere.mistColor);
        uniforms.uMistAmount!.value = atmosphere.mistAmount;
        (uniforms.uCloudColor!.value as THREE.Color).copy(atmosphere.cloudColor);
        uniforms.uCloudAmount!.value = atmosphere.cloudAmount;
        uniforms.uHaze!.value = atmosphere.haze;
        (uniforms.uHazeRange!.value as THREE.Vector2).set(centerDistance - camera.near - 8, centerDistance - camera.near + 14);
        uniforms.uLightning!.value = atmosphere.lightning;
        (uniforms.uGlowA!.value as THREE.Vector4).copy(atmosphere.glowA);
        (uniforms.uGlowColorA!.value as THREE.Color).copy(atmosphere.glowColorA);
        (uniforms.uGlowB!.value as THREE.Vector4).copy(atmosphere.glowB);
        (uniforms.uGlowColorB!.value as THREE.Color).copy(atmosphere.glowColorB);
        (uniforms.uWind!.value as THREE.Vector2).copy(atmosphere.wind);
        this.lens.configure({ ...lens, focus: lens.focus - camera.near, stars: atmosphere.stars }, range, atmosphere.time);
        this.renderer.setRenderTarget(this.scene.target);
        this.renderer.clear();
        this.renderer.render(this.sceneGraph, camera);
        this.composer.render();
    }

    dispose() {
        this.atmosphere.dispose();
        this.bloom.dispose();
        this.streaks.dispose();
        this.lens.dispose();
        this.fxaa.dispose();
        this.smaa.dispose();
        this.composer.dispose();
        this.scene.target.depthTexture?.dispose();
        this.scene.target.dispose();
    }
}
