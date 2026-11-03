import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { compileInto } from '../programWarmup';
import type { MachiRenderQuality } from '../quality';
import { MachiBloomPass } from './bloomPass';
import { MachiLensPass, type MachiLensSettings } from './lensPass';
import { createGlowUniforms, halfFloatTarget, MachiAtmospherePass, MachiStreakPass, type MachiSceneTarget } from './postPasses';

// src/components/visualizer/machi/engine/fx/post.ts
// 町景的后处理链：场景画进单独一张带深度贴图的 HDR 目标（MSAA，不参与合成器的来回交换）→ 氛围（墨线、贴地薄雾与灯的散射、云和闪电）
// → bloom（柔和、宽，让招牌和灯在雨夜里晕开）→ 横向镜头光条 → 镜头（叠上 bloom 与光条，散景景深、色差、暗角、颗粒，色调映射输出）
// → 抗锯齿（FXAA 或 SMAA，在输出之后的 sRGB 上做，边缘检测才准；墨线是氛围 pass 描的，场景目标的 MSAA 管不到它）。
// 透明模式（cutout）：场景不画天空，氛围 pass 不在天空上画云，镜头 pass 写出 alpha（天空透明），输出和抗锯齿都带着 alpha 走。
// 全分辨率的读写只有氛围和镜头两道（再加抗锯齿）：bloom、光条只画自己的低分辨率贴图，镜头 pass 取样时现加，
// 色调映射也在镜头 pass 里做（原来各自整屏叠一遍、再单独一道输出，视网膜屏上每道都是几百万像素的 HDR 读写）。
// 画质（engine/quality.ts）决定场景目标的 MSAA、墨线的取样步长、开不开 bloom / 光条 / 景深离焦层、最后用哪种抗锯齿。

/** bloom 那条链从画面的几分之一分辨率起（bloomPass.ts）：四分之一，模糊核跟着减半，光晕在屏幕上一样大。 */
const BLOOM_SCALE = 4;

/** 一道 pass 自己持有的材质（字段里的材质和材质数组；bloom 的几道模糊在一个数组里）。 */
const passMaterials = (pass: Pass) => {
    const materials = new Set<THREE.Material>();
    Object.values(pass).forEach(value => {
        if (value instanceof THREE.Material) materials.add(value);
        else if (Array.isArray(value)) value.forEach(item => { if (item instanceof THREE.Material) materials.add(item); });
    });
    return materials;
};

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
    private readonly bloom: MachiBloomPass;
    private readonly streaks: MachiStreakPass;
    private readonly lens: MachiLensPass;
    private readonly fxaa: FXAAPass;
    private readonly smaa: SMAAPass;
    /** bloom、光条的取样（光条、镜头 pass 共用）；关着的那项指向这张黑贴图。 */
    private readonly glow = createGlowUniforms();
    private readonly black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
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
        cutout = false,
    ) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const lit = halfFloatTarget();
        lit.texture.name = 'machi:lit';
        lit.setSize(size.x, size.y);
        this.scene = { target: createSceneTarget(size.x, size.y, quality.samples), lit };
        // 合成器那两张缓冲只装镜头 pass 画好的显示用颜色（给抗锯齿读）：8 位，比默认的半精度浮点省一半带宽。
        this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.UnsignedByteType, depthBuffer: false }));
        this.black.needsUpdate = true;
        this.atmosphere = new MachiAtmospherePass(this.scene, cutout);
        this.composer.addPass(this.atmosphere);
        this.bloom = new MachiBloomPass(this.scene, BLOOM_SCALE, 0.5, 0.62, 0.86);
        this.composer.addPass(this.bloom);
        this.streaks = new MachiStreakPass(this.scene, this.glow);
        this.composer.addPass(this.streaks);
        // 色调映射按渲染器的设置（和 OutputPass 第一次画时写 defines 的规则一样）。
        this.lens = new MachiLensPass(this.scene, this.glow, {
            neutralToneMapping: renderer.toneMapping === THREE.NeutralToneMapping,
            srgb: THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer,
        }, cutout);
        this.composer.addPass(this.lens);
        // 合成器把最后一道开着的 pass 画到屏幕上：两种抗锯齿都关着时，镜头那道直接上屏。
        this.fxaa = new FXAAPass();
        this.composer.addPass(this.fxaa);
        this.smaa = new SMAAPass();
        // SMAA 的边缘、权重两张中间图：值都在 0..1，SMAA 原版就是 8 位（three 给的是半精度浮点）。还没分配显存，改类型就行。
        const smaaTargets = this.smaa as unknown as Record<string, THREE.WebGLRenderTarget | undefined>;
        [smaaTargets._edgesRT, smaaTargets._weightsRT].forEach(target => { if (target) target.texture.type = THREE.UnsignedByteType; });
        this.composer.addPass(this.smaa);
        this.setQuality(quality);
    }

    /** 场景画进的那张 HDR 目标（预编主场景的着色器时按它编）。 */
    get sceneTarget() {
        return this.scene.target;
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
        this.scene.lit.setSize(width, height);
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

    /**
     * 预编后处理的着色器（programWarmup.ts）：每道 pass 的材质按它画进的目标编，中间的都画进合成器的 HDR 缓冲，
     * 最后一道开着的（SMAA、FXAA 或镜头）上屏。bloom、光条也编：它们随夜色开关，开的那一刻不该卡。没选的抗锯齿不编。
     */
    compile() {
        const passes = this.composer.passes.filter(pass => (pass !== this.fxaa && pass !== this.smaa) || pass.enabled);
        const last = passes[passes.length - 1];
        // 和合成器的全屏三角形一样只有 position 和 uv：多了法线（PlaneGeometry）就是另一套变体。
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
        const quad = new THREE.Mesh(geometry);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        // 全屏四边形是自己当场景画的：没有灯、没有雾，这里也给一个空场景。
        const empty = new THREE.Scene();
        passes.forEach(pass => {
            passMaterials(pass).forEach(material => {
                quad.material = material;
                compileInto(this.renderer, this.composer.renderTarget1, quad, camera, empty);
                if (pass === last) compileInto(this.renderer, null, quad, camera, empty);
            });
        });
        quad.geometry.dispose();
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
        this.streaks.enabled = this.streaksAllowed && this.streakStrength > 0.005;
        // 没画的那项取黑贴图：镜头 pass 照样加，加的是 0。
        this.glow.tBloom.value = this.bloom.enabled ? this.bloom.texture : this.black;
        this.glow.tStreak.value = this.streaks.enabled ? this.streaks.texture : this.black;
        this.glow.uStreakStrength.value = this.streakStrength;
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
        this.black.dispose();
        this.fxaa.dispose();
        this.smaa.dispose();
        this.composer.dispose();
        this.scene.target.depthTexture?.dispose();
        this.scene.target.dispose();
        this.scene.lit.dispose();
    }
}
