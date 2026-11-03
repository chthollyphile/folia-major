// Copyright (c) 2026 chthollyphile
import type { BlurFilter, Container } from 'pixi.js';
import type { Theme } from '../../../types';
import { hashVisualizerSeed } from '../visualizerSeedHash';
import type { HanabiProgram } from './hanabiProgram';
import { resolveShotProfile, shotLine } from './program';
import { createHanabiScene, type HanabiScene, type HanabiSceneShot } from './scene';
import type { HanabiTextures, HanabiTuning, PixiModule } from './types';

// src/components/visualizer/hanabi/hanabiSceneEntry.ts
// 运行时缓存里的一个段落场景：编译出的段落 → createHanabiScene 的参数（对应 lumisynth 花火 adapter 的 buildUnit），
// 外面再包一层运行时自己的 holder。转场的透明度、缩放、位移和模糊都套在 holder 上——场景自己在内部舞台上做运镜
// 与世界上升，scene.view 不动，两套变换互不覆盖。

export interface HanabiSceneEntry {
    index: number;
    scene: HanabiScene;
    holder: Container;
    /** 转场 / 片尾失焦用的模糊，第一次需要时才建。 */
    blur: BlurFilter | null;
}

export interface HanabiSceneBuildContext {
    width: number;
    height: number;
    resolution: number;
    program: HanabiProgram;
    theme: Theme;
    tuning: HanabiTuning;
    textures: HanabiTextures;
    showText: boolean;
    /** 拼贴里重复的字样（曲名、HANABI、花火）。 */
    motifs: readonly string[];
    /** 曲名与艺人：歌曲以前奏开头时，第一个间奏镜头放标题卡。 */
    songTitle: string | null;
    songArtist: string | null;
    /** 拼贴里开花时蹦出来的图标（主题的 lucide 图标名，已加载）。 */
    icons: readonly string[];
}

/** 整首歌的旋转方向（按程序种子定）：每段从这个方向起转，段落转场也朝它转。 */
export const hanabiSpinDirection = (programSeed: string) => (hashVisualizerSeed(`${programSeed}:spin-direction`) % 2 === 0 ? 1 : -1);

/** 模糊低于这个强度就摘掉 filter：一个挂着不用的 filter 也要多一次整屏离屏渲染。 */
const BLUR_EPSILON = 0.3;

/** 建一个段落场景（排版这一段的全部歌词；字形图集到镜头快出场时才画，见 scene.prepare）。 */
export const buildHanabiSceneEntry = (pixi: PixiModule, context: HanabiSceneBuildContext, index: number): HanabiSceneEntry => {
    const { width, height, program } = context;
    const paragraph = program.paragraphs[index]!;
    const lineMap = new Map(paragraph.lineIndices.map((lineIndex, k) => [lineIndex, paragraph.lines[k]!]));
    const shots: HanabiSceneShot[] = paragraph.shots.map(shot => ({
        id: shot.id,
        profile: resolveShotProfile(shot),
        startTime: shot.startTime,
        endTime: shot.endTime,
        isBridge: shot.isBridge,
        line: shot.isBridge ? null : shotLine(lineMap, shot.slices),
    }));
    if (shots.length === 0) {
        // 编译器保证每段至少一个镜头；防御：给一个覆盖整段的间奏。
        shots.push({
            id: paragraph.id,
            profile: resolveShotProfile({ kind: '' }),
            startTime: paragraph.startTime,
            endTime: paragraph.endTime,
            isBridge: true,
            line: null,
        });
    }
    const scene = createHanabiScene(pixi, {
        width,
        height,
        resolution: context.resolution,
        seed: `${program.seed}:${paragraph.id}`,
        theme: context.theme,
        tuning: context.tuning,
        shots,
        startTime: paragraph.startTime,
        endTime: paragraph.endTime,
        textures: context.textures,
        exitStart: paragraph.transitionOut?.startTime ?? null,
        motifs: context.motifs,
        icons: context.icons,
        spinDirection: hanabiSpinDirection(program.seed),
        opening: index === 0 && context.songTitle ? { title: context.songTitle, artist: context.songArtist } : null,
    });
    scene.setLayerVisibility({ graphics: true, text: context.showText, mid: false });
    const holder = new pixi.Container();
    holder.addChild(scene.view);
    holder.pivot.set(width / 2, height / 2);
    holder.position.set(width / 2, height / 2);
    holder.zIndex = index;
    return { index, scene, holder, blur: null };
};

/** 套转场帧：透明度、以画面中心为原点的缩放与旋转、纵向位移、模糊（按需挂 / 摘）。 */
export const applyHanabiLayerFrame = (
    pixi: PixiModule,
    entry: HanabiSceneEntry,
    frame: { alpha: number; scale: number; blur: number; y: number; rotation: number },
    size: { width: number; height: number },
    blurResolution: number,
) => {
    entry.holder.alpha = frame.alpha;
    entry.holder.scale.set(frame.scale);
    entry.holder.position.set(size.width / 2, size.height / 2 + frame.y * size.height);
    entry.holder.rotation = frame.rotation;
    if (frame.blur > BLUR_EPSILON) {
        if (!entry.blur) {
            // 模糊的内容不需要满分辨率：半分辨率跑模糊，开销是整屏的四分之一。
            entry.blur = new pixi.BlurFilter({ strength: frame.blur, quality: 3, resolution: blurResolution });
        }
        entry.blur.strength = frame.blur;
        if (!entry.holder.filters?.includes(entry.blur)) {
            // 固定一块远大于画面的区域（经变换后被视口裁成整个画面）：不给时 Pixi 每帧都要遍历整个场景量包围盒。
            entry.holder.filterArea ??= new pixi.Rectangle(-size.width, -size.height, size.width * 3, size.height * 3);
            entry.holder.filters = [entry.blur];
        }
    } else if (entry.holder.filters?.length) {
        entry.holder.filters = [];
    }
};

export const destroyHanabiSceneEntry = (entry: HanabiSceneEntry) => {
    entry.holder.parent?.removeChild(entry.holder);
    entry.holder.filters = [];
    entry.blur?.destroy();
    entry.blur = null;
    entry.holder.removeChild(entry.scene.view);
    entry.scene.destroy();
    entry.holder.destroy();
};
