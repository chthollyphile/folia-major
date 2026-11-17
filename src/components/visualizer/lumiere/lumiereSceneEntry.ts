// Copyright (c) 2026 chthollyphile
import type { BlurFilter, Container, Filter } from 'pixi.js';
import type { Theme } from '../../../types';
import { applyLumiereGroupQuality, detachLumierePassthrough } from './lumiereGroupFilters';
import type { LumiereAudioFrame } from './lumiereKernel';
import type { LumiereProgram } from './lumiereProgram';
import { createLumiereUnit, type LumiereUnit } from './lumiereUnit';
import type { LightSprites } from './light/sprites';
import { LUMIERE_BLOOM, type LumiereSceneTuning } from './types';

// src/components/visualizer/lumiere/lumiereSceneEntry.ts
// 运行时缓存里的一个段落场景：LumiereUnit 外面再包一层运行时自己的 holder。转场的透明度、缩放和模糊
// 都套在 holder 上——场景自己在内部舞台上做运镜，scene.view 不动，两套变换互不覆盖。
type PixiModule = typeof import('pixi.js');

export interface LumiereSceneEntry {
    index: number;
    unit: LumiereUnit;
    holder: Container;
    /** 转场 / 片尾失焦用的模糊，第一次需要时才建。 */
    blur: BlurFilter | null;
}

/** 图形组、文字组的画质参数（运行时按 tuning 与画质档算好，所有场景共用）。 */
export interface LumiereSceneQuality {
    bloom: number;
    textBloom: number;
    /** 图形组 filter 分辨率；null = 满分辨率。 */
    graphicsResolution: number | null;
    bloomLevelDrop: number;
    passthrough: Filter | null;
}

export interface LumiereSceneBuildContext {
    width: number;
    height: number;
    /** 文字光栅化与合成用的渲染分辨率（满分辨率，不随画质降）。 */
    resolution: number;
    program: LumiereProgram;
    theme: Theme;
    tuning: LumiereSceneTuning;
    sprites: LightSprites;
    audioAt: (time: number) => LumiereAudioFrame;
    showText: boolean;
    quality: LumiereSceneQuality;
}

/** 模糊低于这个强度就摘掉 filter：一个挂着不用的 filter 也要多一次整屏离屏渲染。 */
const BLUR_EPSILON = 0.3;

export const applyLumiereSceneQuality = (
    groups: { graphics: Container; text: Container },
    quality: LumiereSceneQuality,
) => {
    applyLumiereGroupQuality(groups.graphics, {
        preset: LUMIERE_BLOOM.graphics,
        multiplier: quality.bloom,
        resolution: quality.graphicsResolution,
        levelDrop: quality.bloomLevelDrop,
        passthrough: quality.passthrough,
    });
    applyLumiereGroupQuality(groups.text, {
        preset: LUMIERE_BLOOM.text,
        multiplier: quality.textBloom,
        resolution: null,
        levelDrop: 0,
        passthrough: null,
    });
};

/** 建一个段落场景（整个运行时里最贵的调用：光栅化这一段的全部歌词）。 */
export const buildLumiereSceneEntry = (
    pixi: PixiModule,
    context: LumiereSceneBuildContext,
    index: number,
): LumiereSceneEntry => {
    const { width, height } = context;
    const unit = createLumiereUnit(pixi, {
        paragraph: context.program.paragraphs[index]!,
        width,
        height,
        resolution: context.resolution,
        programSeed: context.program.seed,
        theme: context.theme,
        tuning: context.tuning,
        sprites: context.sprites,
        audioAt: context.audioAt,
    });
    unit.scene.text.visible = context.showText;
    applyLumiereSceneQuality(unit.scene, context.quality);
    const holder = new pixi.Container();
    holder.addChild(unit.scene.view);
    holder.pivot.set(width / 2, height / 2);
    holder.position.set(width / 2, height / 2);
    holder.zIndex = index;
    return { index, unit, holder, blur: null };
};

/** 套转场帧：透明度、以画面中心为原点的缩放、模糊（按需挂 / 摘）。 */
export const applyLumiereLayerFrame = (
    pixi: PixiModule,
    entry: LumiereSceneEntry,
    frame: { alpha: number; scale: number; blur: number },
    blurResolution: number,
) => {
    entry.holder.alpha = frame.alpha;
    entry.holder.scale.set(frame.scale);
    if (frame.blur > BLUR_EPSILON) {
        if (!entry.blur) {
            // 模糊的内容不需要满分辨率：半分辨率跑模糊，开销是整屏的四分之一。
            entry.blur = new pixi.BlurFilter({ strength: frame.blur, quality: 3, resolution: blurResolution });
            // 抗锯齿跟随画布（样式的抗锯齿设置）：Pixi 的默认是 off，模糊很弱的那几帧整个场景会变回没有抗锯齿的样子。
            entry.blur.antialias = 'inherit';
        }
        entry.blur.strength = frame.blur;
        if (!entry.holder.filters?.includes(entry.blur)) entry.holder.filters = [entry.blur];
    } else if (entry.holder.filters?.length) {
        entry.holder.filters = [];
    }
};

export const destroyLumiereSceneEntry = (entry: LumiereSceneEntry, passthrough: Filter | null) => {
    entry.holder.parent?.removeChild(entry.holder);
    entry.holder.filters = [];
    entry.blur?.destroy();
    entry.blur = null;
    // 共享的直通 filter 先摘下来，场景的 destroy 只处理它自己建的 bloom。
    detachLumierePassthrough(entry.unit.scene.graphics, passthrough);
    entry.holder.removeChild(entry.unit.scene.view);
    entry.unit.destroy();
    entry.holder.destroy();
};
