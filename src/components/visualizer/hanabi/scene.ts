// Copyright (c) 2026 chthollyphile
import type { Container } from 'pixi.js';
import type { Line, Theme } from '../../../types';
import type { BeatFxEvent } from '../../../services/beatFx/clock';
import { firstBeatAtOrAfter, HANABI_BEAT_SHELL_LIFE, resolveHanabiBeatShell } from './hanabiBeatFx';
import { createRng } from './hanabiRandom';
import type { TransformParams } from './hanabiKernel';
import { burstPreset } from './catalog';
import { planShotCollage, pickCollageKeyword, type CollagePlan, type CollageRecipe } from './collage/collagePlan';
import { createCollageTextureCache, type CollageTextureCache } from './collage/collagePainters';
import { createShotCollage, type ShotCollageView } from './collage/collageViews';
import { createUnitCollage, type UnitCollageView } from './collage/unitCollage';
import { keywordColorOf, resolveHanabiPalette } from './color';
import { HANABI_QUALITY_PROFILES, resolveHanabiGlowQuality } from './hanabiTuning';
import { createAmbient } from './mg/ambient';
import { createFireworks } from './mg/fireworks';
import { createHanabiGlow } from './mg/glow';
import { createOrnament } from './mg/ornaments';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { createHanabiText } from './text/lyricText';
import { buildTimeline, LAUNCH_DURATION, planSpin, type ShotTiming, type Timeline, type TimelineShot } from './timeline';
import type {
    AmbientLayer,
    BurstEvent,
    BurstSpec,
    FireworksLayer,
    GlyphAnchor,
    HanabiPalette,
    HanabiProfile,
    HanabiTextView,
    HanabiTextures,
    HanabiTuning,
    LaunchEvent,
    OrnamentView,
    PixiModule,
} from './types';

// src/components/visualizer/hanabi/scene.ts
// 一个场景单元（段内一串连续的花火镜头）：世界整体上升，每个镜头在世界里各自的高度上组装
// 烟花（主烟花、被唱到的小烟花、升空尾迹）、装饰件、字底色块、素材层与字（docs/HANABI.md「画面分层」「上升」）。
//   view
//   └ stage（镜头内运镜：推近、摆动、入场震动）
//      ├ ambient.back（屏幕坐标，按 rise 自己做视差）
//      ├ collage.back（整单元的网点底纹，按 rise 视差）
//      ├ spin（绕画面中心转 spin(t)：贯穿整个单元一直在转，镜头内慢转，镜头边界随上升一起加速转过一个大角度）
//      │ └ world（y = rise(t)）
//      │    └ 每个镜头一个 holder（绕「定格时的画面中心」反向转回这个镜头的角度）→ shot 容器：
//      │       fireworks → ornaments(back) → collage(back) → text.blocks → mid → text.glyphs → ornaments(front) → collage(front)
//      ├ ambient.front
//      └ collage.front（整单元的竖排上升跑马灯）
// PV 拼贴（collage/）：每个镜头的拼贴计划在构建时排好（纯数据），显示件与烟花池、装饰件一样在镜头进入可见时间时才建。
// 烟花事件在构建时按镜头算好（纯数据），每帧筛出活跃的；只更新可见时间附近的镜头。每帧画面只由 t 决定。

/** 单元里的一个镜头（组件已经套进 profile）。 */
export interface HanabiSceneShot {
    id: string;
    profile: HanabiProfile;
    startTime: number;
    endTime: number;
    isBridge: boolean;
    /** 镜头的文字（切片拼成的一行）；间奏为 null。 */
    line: Line | null;
    /** 借排版的宿主：自己的字隐去，烟花与装饰照常。 */
    textHidden?: boolean;
}

export interface HanabiSceneOptions {
    width: number;
    height: number;
    resolution: number;
    seed: string;
    theme: Theme;
    tuning: HanabiTuning;
    shots: HanabiSceneShot[];
    startTime: number;
    endTime: number;
    textures: HanabiTextures;
    /** 歌词字号倍率（工程的字体设置）。 */
    fontScale?: number;
    /** 段落出场转场开始的时刻：最后一个镜头的字在这之后退场。 */
    exitStart?: number | null;
    /** 拼贴里重复的字样（曲名、HANABI…）；不给用 HANABI / 花火。 */
    motifs?: readonly string[];
    /** 歌曲开头的单元：第一个镜头是间奏时放「now playing」标题卡。 */
    opening?: { title: string; artist: string | null } | null;
    /** 拼贴里开花时蹦出来的图标（主题的 lucide 图标名，已加载）；不给用花。 */
    icons?: readonly string[];
    /** 世界旋转起转的方向（1 / −1，整首歌一个，段落转场也朝它转）；段内各边界还会换向。不给为 1。 */
    spinDirection?: number;
}

/** 智能动感模式「随拍开花」这一帧的输入：节拍表（按时刻排好）、效果强度与曲目的动感系数。 */
export interface HanabiBeatSource {
    events: readonly BeatFxEvent[];
    strength: number;
    trackScale: number;
}

export interface HanabiScene {
    view: Container;
    timeline: Timeline;
    /** 各镜头预先算好的烟花事件（调试与测试用）。 */
    events: Array<{ bursts: BurstEvent[]; launches: LaunchEvent[] }>;
    /** time 时刻所在镜头的素材插入层。 */
    midLayer: (time: number) => Container | null;
    camera: (time: number) => TransformParams;
    rest: TransformParams;
    /** beats 不为 null 时按节拍表在夜空里放「随拍开花」的烟花（见 hanabiBeatFx.ts）。 */
    update: (time: number, beats?: HanabiBeatSource | null) => void;
    /** 提前备好马上要出场的镜头，一次只做一件贵的事；做了返回 true（运行时在空闲的帧里调）。 */
    prepare: (time: number) => boolean;
    setLayerVisibility: (layers: { graphics: boolean; text: boolean; mid: boolean }) => void;
    destroy: () => void;
}

/** 一个镜头烟花精灵池的上限（同时可见的镜头一般不超过两个，整单元约 1500）。 */
const SHOT_PARTICLES = 750;
/** 镜头出场前多少秒开始备（画字形图集、建烟花池与拼贴），备好的在出场前不放。 */
const PREPARE_AHEAD = 1.5;
/** 被唱到的小烟花、碎成火花的退场，一个镜头最多放多少朵。 */
const MAX_SUNG_BURSTS = 28;
const MAX_DISSOLVE_BURSTS = 24;
/** 退场碎成火花时，每个字心放的小火花。 */
const DISSOLVE_SPARK: BurstSpec = { kind: 'botan', count: 10, radius: 0.03, duration: 0.65, colors: [0, 1, 2], trail: 0.25, twinkle: 0.6 };
/** 间奏的连发里轮换的烟花。 */
const BRIDGE_KINDS: BurstSpec['kind'][] = ['mine', 'senrin', 'kiku', 'botan', 'ring', 'crossette', 'willow-ring', 'strobe'];

const MOTION: Record<Theme['animationIntensity'], number> = { calm: 0.6, normal: 1, chaotic: 1.4 };

/** 文字视图本地坐标 → 镜头容器坐标（视图自己的位置 / 缩放 / 旋转）。 */
const toShot = (view: Container, x: number, y: number) => {
    const px = (x - view.pivot.x) * view.scale.x;
    const py = (y - view.pivot.y) * view.scale.y;
    const cos = Math.cos(view.rotation);
    const sin = Math.sin(view.rotation);
    return { x: view.position.x + px * cos - py * sin, y: view.position.y + px * sin + py * cos };
};

const sungRange = (line: Line | null) => {
    const words = (line?.words ?? []).filter(word => word.text.trim().length > 0);
    if (words.length === 0) return { first: line?.startTime ?? null, last: line?.endTime ?? null };
    return { first: words[0]!.startTime, last: Math.max(...words.map(word => word.endTime)) };
};

/** 从一串里等距取不超过 max 个。 */
const thin = <T>(items: T[], max: number) => {
    if (items.length <= max) return items;
    const step = items.length / max;
    return Array.from({ length: max }, (_, k) => items[Math.floor(k * step)]!);
};

interface ShotRig {
    fireworks: FireworksLayer | null;
    ornaments: OrnamentView[];
    collage: ShotCollageView | null;
}

interface BuiltShot {
    shot: HanabiSceneShot;
    timing: ShotTiming;
    palette: HanabiPalette;
    container: Container;
    fireworksHolder: Container;
    ornBack: Container;
    ornFront: Container;
    collageBack: Container;
    collageFront: Container;
    collage: CollagePlan;
    mid: Container;
    text: HanabiTextView | null;
    bursts: BurstEvent[];
    launches: LaunchEvent[];
    lifeStart: number;
    lifeEnd: number;
    rig: ShotRig | null;
}

export const createHanabiScene = (pixi: PixiModule, options: HanabiSceneOptions): HanabiScene => {
    const { width, height, tuning, theme, textures } = options;
    const unit = Math.min(width, height);
    const motion = MOTION[theme.animationIntensity] ?? 1;
    const fontScale = options.fontScale ?? 1;
    const graphicsOn = !tuning.textOnly;
    const keywordColor = keywordColorOf(theme);

    const paletteCache = new Map<string, HanabiPalette>();
    const paletteOf = (profile: HanabiProfile) => {
        let palette = paletteCache.get(profile.palette);
        if (!palette) {
            palette = resolveHanabiPalette(profile.palette, theme, tuning.colorMode);
            paletteCache.set(profile.palette, palette);
        }
        return palette;
    };

    const timelineShots: TimelineShot[] = options.shots.map(shot => {
        const sung = sungRange(shot.line);
        return {
            startTime: shot.startTime,
            endTime: shot.endTime,
            firstSung: shot.isBridge ? null : sung.first,
            lastSungEnd: shot.isBridge ? null : sung.last,
            isBridge: shot.isBridge,
            camera: shot.profile.camera,
        };
    });
    // 世界旋转，贯穿整个单元一直在转：镜头内慢转（约 11°/秒，长镜头慢一些），镜头边界跟着上升再甩过 34°–80°（都乘 tuning.spin），
    // 像一路旋着往上走。单元从整首歌的方向（options.spinDirection）起转，偶尔换向、单元结束前转回来（timeline.ts 的 planSpin）。
    const { angles: spinAngles, drift: spinDrift } = planSpin(options.shots.map(shot => shot.endTime - shot.startTime), {
        amount: graphicsOn ? Math.max(0, tuning.spin) : 0,
        direction: options.spinDirection ?? 1,
        random: createRng(`${options.seed}:spin`),
    });
    const timeline = buildTimeline(timelineShots, {
        unitStart: options.startTime,
        unitEnd: options.endTime,
        height,
        // 借给别的包时（只画字）字要停在宿主的文字区里，不随世界上漂。
        riseSpeed: graphicsOn ? Math.max(0, tuning.riseSpeed) : 0,
        motion: motion * Math.max(0, tuning.textMotion),
        exitStart: options.exitStart ?? null,
        spinAngles,
        spinDrift,
    });

    const view = new pixi.Container();
    const stage = new pixi.Container();
    const world = new pixi.Container();
    const spin = new pixi.Container();
    spin.pivot.set(width / 2, height / 2);
    spin.position.set(width / 2, height / 2);
    spin.addChild(world);
    view.addChild(stage);

    // 环境层整单元一份，按屏幕坐标画、自己做视差，所以放在世界外面。
    const lead = options.shots[0];
    const distantRate = options.shots.reduce((sum, shot) => sum + ({ quiet: 0.08, neutral: 0.2, loud: 0.35 }[shot.profile.mood]), 0)
        / Math.max(options.shots.length, 1);
    const ambient: AmbientLayer | null = graphicsOn && tuning.ambient > 0 && lead
        ? createAmbient({
            pixi,
            textures,
            width,
            height,
            seed: `${options.seed}:ambient`,
            palette: paletteOf(lead.profile),
            startTime: options.startTime,
            endTime: options.endTime,
            density: Math.min(2, tuning.ambient) * (HANABI_QUALITY_PROFILES[tuning.renderQuality] ?? HANABI_QUALITY_PROFILES.full).ambientScale,
            distantBursts: distantRate,
        })
        : null;
    // 拼贴纹理整单元一份缓存（一段里贴纸、色带的组合会重复）；单元销毁时一起放。
    const collageOn = graphicsOn && tuning.collage > 0;
    const motifs = options.motifs && options.motifs.length > 0 ? options.motifs : ['HANABI', '花火'];
    const collageCache: CollageTextureCache | null = collageOn
        ? createCollageTextureCache(pixi, options.resolution, resolveThemeFontStack(theme))
        : null;
    const unitCollage: UnitCollageView | null = collageCache && lead
        ? createUnitCollage(pixi, {
            width,
            height,
            resolution: options.resolution,
            seed: options.seed,
            cache: collageCache,
            paper: paletteOf(lead.profile).paper,
            amount: Math.min(2, tuning.collage),
            startTime: options.startTime,
        })
        : null;
    if (ambient) stage.addChild(ambient.back);
    if (unitCollage) stage.addChild(unitCollage.back);
    stage.addChild(spin);
    if (ambient) stage.addChild(ambient.front);
    if (unitCollage) stage.addChild(unitCollage.front);

    // 辉光整单元一个 filter，挂在各镜头的烟花层上；分辨率与级数按画质档（hanabiTuning.ts）。
    const glow = graphicsOn && tuning.glow > 0
        ? createHanabiGlow(pixi, Math.min(2, tuning.glow), resolveHanabiGlowQuality(width, height, options.resolution, tuning.renderQuality))
        : null;

    /** 画面坐标 (sx, sy) 在 time 时刻对应的镜头容器坐标（不计镜头内运镜）。 */
    const screenToShot = (built: { region: HanabiProfile['region']; timing: ShotTiming }, sx: number, sy: number, time: number) => ({
        x: sx - built.region.cx * width,
        y: sy - (built.region.cy * height + built.timing.worldY + timeline.rise(time)),
    });

    let previousRecipe: CollageRecipe | null = null;
    const built: BuiltShot[] = options.shots.map((shot, index) => {
        const { profile } = shot;
        const timing = timeline.shots[index]!;
        const palette = paletteOf(profile);
        const region = profile.region;
        const container = new pixi.Container();
        container.position.set(region.cx * width, region.cy * height + timing.worldY);
        const fireworksHolder = new pixi.Container();
        const ornBack = new pixi.Container();
        const ornFront = new pixi.Container();
        const collageBack = new pixi.Container();
        const collageFront = new pixi.Container();
        const mid = new pixi.Container();
        container.addChild(fireworksHolder, ornBack, collageBack);

        const text: HanabiTextView | null = shot.line && !shot.isBridge
            ? createHanabiText({
                pixi,
                width,
                height,
                resolution: options.resolution,
                theme,
                line: shot.line,
                regionWidth: region.w * width,
                regionHeight: region.h * height,
                spec: { ...profile.text, heroSize: profile.text.heroSize * fontScale },
                palette,
                seed: `${options.seed}:${shot.id}:text`,
                enterAt: timing.enterAt,
                exitAt: timing.exitAt,
                exitDuration: timing.exitDuration,
                motion: Math.max(0, tuning.textMotion),
                blockOpacity: Math.min(1, Math.max(0, tuning.blockOpacity)),
                keywordColor,
            })
            : null;
        if (text) {
            container.addChild(text.view);
            // 素材层插在色块与字之间：字在哪个容器里，就插在那个容器里字的前面。
            const glyphParent = text.glyphs.parent;
            if (glyphParent) glyphParent.addChildAt(mid, glyphParent.getChildIndex(text.glyphs));
            else container.addChild(mid);
        } else {
            container.addChild(mid);
        }
        container.addChild(ornFront, collageFront);
        // 反向转回这个镜头的角度，转轴是这个镜头定格时的画面中心：世界转到 timing.spin（镜头中点）时它正好是原来的构图。
        const holder = new pixi.Container();
        holder.pivot.set(width / 2, height / 2 + timing.worldY);
        holder.position.set(width / 2, height / 2 + timing.worldY);
        holder.rotation = -timing.spin;
        holder.addChild(container);
        world.addChild(holder);

        const { bursts, launches, mains } = graphicsOn
            ? planShotEvents({ shot, index, timing, palette, text, region, seed: options.seed, screenToShot, width, height, unit, tuning })
            : { bursts: [], launches: [], mains: [] };
        const burstEnd = Math.max(...bursts.map(event => event.at + event.spec.duration), -Infinity);
        const launchEnd = Math.max(...launches.map(event => event.at + event.duration + 0.7), -Infinity);
        const regionBounds = { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height };
        const collage: CollagePlan = collageOn
            ? planShotCollage({
                seed: `${options.seed}:${shot.id}`,
                family: profile.family,
                mood: profile.mood,
                isBridge: shot.isBridge,
                block: profile.text.block,
                shotNumber: index,
                bounds: text?.bounds ?? regionBounds,
                screen: { x: -region.cx * width, y: -region.cy * height, width, height },
                screenAt: time => ({ ...screenToShot({ region, timing }, 0, 0, time), width, height }),
                unit,
                palette,
                enterAt: timing.enterAt,
                exitAt: timing.exitAt,
                exitDuration: timing.exitDuration,
                start: timing.start,
                end: timing.end,
                keyword: pickCollageKeyword(shot.line),
                motifs,
                bursts: mains.map(event => ({
                    x: event.x, y: event.y, at: event.at, kind: event.spec.kind, main: true, radius: event.spec.radius * unit * event.scale,
                })),
                launches,
                amount: Math.min(2, tuning.collage),
                previous: previousRecipe,
                opening: index === 0 ? options.opening ?? null : null,
                icons: options.icons,
            })
            : { recipe: null, items: [] };
        previousRecipe = collage.recipe;
        const collageEnd = Math.max(...collage.items.map(item => (
            item.kind === 'pop' || item.kind === 'floater' ? item.at + item.duration
                : item.kind === 'whoosh' ? item.at + item.duration + 0.55
                    : item.exitAt + item.exitDuration
        )), -Infinity);
        return {
            shot,
            timing,
            palette,
            container,
            fireworksHolder,
            ornBack,
            ornFront,
            collageBack,
            collageFront,
            collage,
            mid,
            text,
            bursts,
            launches,
            lifeStart: Math.min(timing.launchAt, timing.enterAt) - 0.25,
            lifeEnd: Math.max(timing.exitAt + timing.exitDuration + 0.3, burstEnd + 0.05, launchEnd, collageEnd + 0.05),
            rig: null,
        };
    });

    const buildRig = (item: BuiltShot): ShotRig => {
        if (!graphicsOn) return { fireworks: null, ornaments: [], collage: null };
        const fireworks = createFireworks(pixi, textures, {
            width,
            height,
            palette: item.palette,
            amount: Math.max(0, tuning.sparkAmount),
            maxParticles: SHOT_PARTICLES,
        });
        item.fireworksHolder.addChild(fireworks.view);
        if (glow) item.fireworksHolder.filters = [glow];
        const region = item.shot.profile.region;
        const bounds = item.text?.bounds ?? { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height };
        const text = item.text;
        const anchorsAt = text ? (time: number) => text.anchors(time) : () => [] as GlyphAnchor[];
        const ornaments = tuning.ornamentAmount > 0
            ? item.shot.profile.ornaments.map((spec, k) => {
                const ornament = createOrnament(spec, {
                    pixi,
                    textures,
                    width,
                    height,
                    seed: `${options.seed}:${item.shot.id}:ornament${k}`,
                    palette: item.palette,
                    bounds,
                    anchorsAt,
                    enterAt: item.timing.enterAt,
                    exitAt: item.timing.exitAt,
                    exitDuration: item.timing.exitDuration,
                    amount: Math.min(2, tuning.ornamentAmount),
                });
                (spec.layer === 'front' ? item.ornFront : item.ornBack).addChild(ornament.view);
                return ornament;
            })
            : [];
        let collage: ShotCollageView | null = null;
        if (collageCache && item.collage.items.length > 0) {
            collage = createShotCollage(pixi, item.collage, collageCache, textures);
            item.collageBack.addChild(collage.back);
            item.collageFront.addChild(collage.front);
        }
        return { fireworks, ornaments, collage };
    };

    const releaseRig = (item: BuiltShot) => {
        if (!item.rig) return;
        item.fireworksHolder.filters = [];
        item.rig.fireworks?.destroy();
        item.rig.ornaments.forEach(ornament => ornament.destroy());
        item.rig.collage?.destroy();
        item.rig = null;
    };

    let layers = { graphics: true, text: true, mid: true };
    const applyLayers = () => {
        if (ambient) {
            ambient.back.renderable = layers.graphics;
            ambient.front.renderable = layers.graphics;
        }
        if (unitCollage) {
            unitCollage.back.renderable = layers.graphics;
            unitCollage.front.renderable = layers.graphics;
        }
        for (const item of built) {
            item.fireworksHolder.renderable = layers.graphics;
            item.ornBack.renderable = layers.graphics;
            item.ornFront.renderable = layers.graphics;
            item.collageBack.renderable = layers.graphics;
            item.collageFront.renderable = layers.graphics;
            item.mid.renderable = layers.mid;
            if (item.text) {
                const shown = layers.text && !item.shot.textHidden;
                item.text.blocks.renderable = shown;
                item.text.glyphs.renderable = shown;
            }
        }
    };
    applyLayers();

    const rest: TransformParams = { x: width / 2, y: height / 2, pivotX: width / 2, pivotY: height / 2, scale: 1, rotation: 0 };
    const camera = (time: number): TransformParams => {
        const offset = timeline.camera(time);
        return { ...rest, x: rest.x + offset.dx, y: rest.y + offset.dy, scale: offset.scale, rotation: offset.rotation };
    };

    const activeBursts: BurstEvent[] = [];
    const activeLaunches: LaunchEvent[] = [];

    // 「随拍开花」：每拍的烟花算一次就缓存（按拍的时刻），换节拍表或强度时清掉。烟花开在那一拍所在的镜头里，
    // 位置按那一拍时的画面换算，跟着这个镜头一起上升、旋转。
    interface BeatPlaced { shot: number; burst: BurstEvent; launch: LaunchEvent | null }
    const beatCache = new Map<number, BeatPlaced | null>();
    let beatCacheEvents: readonly BeatFxEvent[] | null = null;
    let beatCacheStrength = -1;
    let beatCacheScale = -1;
    const beatBursts: BurstEvent[][] = built.map(() => []);
    const beatLaunches: LaunchEvent[][] = built.map(() => []);
    const placeBeat = (event: BeatFxEvent, beats: HanabiBeatSource): BeatPlaced | null => {
        const key = Math.round(event.t * 1000);
        if (beatCache.has(key)) return beatCache.get(key)!;
        let placed: BeatPlaced | null = null;
        const shell = resolveHanabiBeatShell(event, options.seed, beats.strength, beats.trackScale);
        const shot = timeline.shotAt(event.t);
        const item = built[shot];
        if (shell && item && event.t >= options.startTime && event.t <= options.endTime) {
            const located = { region: item.shot.profile.region, timing: item.timing };
            const p = screenToShot(located, shell.sx * width, shell.sy * height, event.t);
            const burst: BurstEvent = { x: p.x, y: p.y, at: event.t, spec: shell.spec, seed: shell.seed, scale: 1 };
            let launch: LaunchEvent | null = null;
            if (shell.launch && tuning.launches) {
                const at = event.t - LAUNCH_DURATION;
                const bottom = screenToShot(located, shell.sx * width, height * 1.03, at);
                launch = { fromX: p.x, fromY: Math.max(bottom.y, p.y + height * 0.2), toX: p.x, toY: p.y, at, duration: LAUNCH_DURATION, color: item.palette.glow, seed: `${shell.seed}:launch` };
            }
            placed = { shot, burst, launch };
        }
        beatCache.set(key, placed);
        return placed;
    };
    const collectBeats = (time: number, beats: HanabiBeatSource | null | undefined) => {
        beatBursts.forEach(list => { list.length = 0; });
        beatLaunches.forEach(list => { list.length = 0; });
        if (!graphicsOn || !beats || beats.strength <= 0 || beats.events.length === 0) return;
        if (beats.events !== beatCacheEvents || beats.strength !== beatCacheStrength || beats.trackScale !== beatCacheScale) {
            beatCache.clear();
            beatCacheEvents = beats.events;
            beatCacheStrength = beats.strength;
            beatCacheScale = beats.trackScale;
        }
        // 正在燃烧的拍（开花后 HANABI_BEAT_SHELL_LIFE 秒内）与马上要升空到达的拍。
        const until = time + LAUNCH_DURATION;
        for (let index = firstBeatAtOrAfter(beats.events, time - HANABI_BEAT_SHELL_LIFE); index < beats.events.length; index += 1) {
            const event = beats.events[index]!;
            if (event.t > until) break;
            const placed = placeBeat(event, beats);
            if (!placed) continue;
            if (time >= placed.burst.at) beatBursts[placed.shot]!.push(placed.burst);
            if (placed.launch && time >= placed.launch.at) beatLaunches[placed.shot]!.push(placed.launch);
        }
    };

    const update = (time: number, beats?: HanabiBeatSource | null) => {
        const transform = camera(time);
        stage.pivot.set(transform.pivotX, transform.pivotY);
        stage.position.set(transform.x, transform.y);
        stage.scale.set(transform.scale);
        stage.rotation = transform.rotation;
        const rise = timeline.rise(time);
        world.y = rise;
        spin.rotation = timeline.spin(time);
        ambient?.update(time, rise);
        unitCollage?.update(time, rise);
        collectBeats(time, beats);

        built.forEach((item, index) => {
            const visible = time >= item.lifeStart && time <= item.lifeEnd;
            item.container.visible = visible;
            if (!visible) {
                // 提前备好、马上要出场的留着（prepare），其余放掉。
                if (time < item.lifeStart - PREPARE_AHEAD || time > item.lifeEnd) releaseRig(item);
                return;
            }
            if (!item.rig) item.rig = buildRig(item);
            item.text?.update(time);
            if (item.rig.fireworks) {
                activeBursts.length = 0;
                activeLaunches.length = 0;
                for (const event of item.bursts) {
                    if (event.at > time) break;
                    if (time <= event.at + event.spec.duration + 0.1) activeBursts.push(event);
                }
                for (const event of item.launches) {
                    if (event.at <= time && time <= event.at + event.duration + 0.7) activeLaunches.push(event);
                }
                for (const event of beatBursts[index]!) activeBursts.push(event);
                for (const event of beatLaunches[index]!) {
                    if (time <= event.at + event.duration + 0.7) activeLaunches.push(event);
                }
                item.rig.fireworks.update(time, activeBursts, activeLaunches);
            }
            item.rig.ornaments.forEach(ornament => ornament.update(time));
            item.rig.collage?.update(time);
        });
    };

    /**
     * 运行时在空闲的帧里调：给 PREPARE_AHEAD 秒内要出场的镜头做一件贵的事——画字形图集，或建烟花池、装饰件与拼贴
     * （拼贴纹理现画）。做了返回 true。没备好的镜头出场那一帧照样会自己补上，只是那一帧更重。
     */
    const prepare = (time: number) => {
        for (const item of built) {
            if (time > item.lifeEnd || time < item.lifeStart - PREPARE_AHEAD) continue;
            if (item.text?.prepare()) return true;
            if (!item.rig) {
                item.rig = buildRig(item);
                return true;
            }
        }
        return false;
    };

    const midLayer = (time: number) => built[timeline.shotAt(time)]?.mid ?? null;

    return {
        view,
        timeline,
        events: built.map(item => ({ bursts: item.bursts, launches: item.launches })),
        midLayer,
        camera,
        rest,
        update,
        prepare,
        setLayerVisibility: next => {
            layers = { ...next };
            applyLayers();
        },
        destroy: () => {
            built.forEach(item => {
                releaseRig(item);
                item.text?.destroy();
            });
            ambient?.destroy();
            unitCollage?.destroy();
            glow?.destroy();
            view.destroy({ children: true });
            // 拼贴纹理最后放：显示树里的精灵都已经销毁。
            collageCache?.destroy();
        },
    };
};

// ─── 烟花事件（构建时算好） ─────────────────────────────────────────────

interface PlanInput {
    shot: HanabiSceneShot;
    index: number;
    timing: ShotTiming;
    palette: HanabiPalette;
    text: HanabiTextView | null;
    region: HanabiProfile['region'];
    seed: string;
    screenToShot: (built: { region: HanabiProfile['region']; timing: ShotTiming }, sx: number, sy: number, time: number) => { x: number; y: number };
    width: number;
    height: number;
    unit: number;
    tuning: HanabiTuning;
}

/**
 * 一个镜头的烟花：主烟花（文字入场时开，burstAt 决定位置，带升空尾迹）、被唱到的字各放一朵小花、
 * 碎成火花的退场；间奏镜头是一串スターマイン / 千輪。位置都在镜头容器坐标里。
 */
const planShotEvents = (input: PlanInput): { bursts: BurstEvent[]; launches: LaunchEvent[]; mains: BurstEvent[] } => {
    const { shot, index, timing, palette, text, region, width, height, unit, tuning } = input;
    const { profile } = shot;
    const random = createRng(`${input.seed}:${shot.id}:${index}:events`);
    const bursts: BurstEvent[] = [];
    const launches: LaunchEvent[] = [];
    const locate = (sx: number, sy: number, time: number) => input.screenToShot({ region, timing }, sx, sy, time);
    const launchColor = palette.glow;
    const withLaunch = profile.launch && tuning.launches;

    /** 从画面底边升到 (x, y)（镜头坐标），到达时刻 = arrive。 */
    const launchTo = (x: number, y: number, arrive: number, key: string) => {
        const at = arrive - LAUNCH_DURATION;
        const bottom = locate(0, height * 1.03, at).y;
        launches.push({
            fromX: x + (random() - 0.5) * width * 0.08,
            fromY: Math.max(bottom, y + height * 0.2),
            toX: x,
            toY: y,
            at,
            duration: LAUNCH_DURATION,
            color: launchColor,
            seed: `${input.seed}:${shot.id}:${key}:launch`,
        });
    };

    const shape = (spec: BurstSpec) => (spec.kind === 'ring' || spec.kind === 'willow-ring' || spec.kind === 'heart' || spec.kind === 'star'
        ? { squash: spec.kind === 'ring' ? 0.4 + random() * 0.5 : 1, rotation: (random() - 0.5) * 0.6 }
        : {});

    if (shot.isBridge) {
        // 间奏：スターマイン / 千輪 连发，沿画面随机高处开，每朵都有尾迹（スターマイン 从底边喷）。
        const from = timing.start + 0.15;
        const to = timing.end - 0.3;
        const duration = Math.max(0, to - from);
        const count = Math.max(1, Math.min(10, Math.round(duration / 0.75)));
        const kinds = profile.burst ? [profile.burst.kind, ...BRIDGE_KINDS] : BRIDGE_KINDS;
        for (let k = 0; k < count; k += 1) {
            const at = from + (count === 1 ? 0 : (k / (count - 1)) * duration * 0.85) + random() * 0.12;
            const kind = kinds[Math.floor(random() * kinds.length)]!;
            const spec = burstPreset(kind, [k % 5, (k + 1) % 5, (k + 2) % 5]);
            if (kind === 'mine') {
                const p = locate(width * (0.2 + random() * 0.6), height * 0.94, at);
                bursts.push({ x: p.x, y: p.y, at, spec, seed: `${input.seed}:${shot.id}:b${k}`, scale: 0.8 + random() * 0.3 });
                continue;
            }
            const p = locate(width * (0.15 + random() * 0.7), height * (0.14 + random() * 0.34), at);
            bursts.push({ x: p.x, y: p.y, at, spec, seed: `${input.seed}:${shot.id}:b${k}`, scale: 0.55 + random() * 0.4, ...shape(spec) });
            if (tuning.launches) launchTo(p.x, p.y, at, `b${k}`);
        }
        bursts.sort((a, b) => a.at - b.at);
        return { bursts, launches, mains: [...bursts] };
    }

    const bounds = text?.bounds ?? { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height };
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // 主烟花。
    const mains: BurstEvent[] = [];
    const main = profile.burst;
    if (main) {
        const radius = main.radius * unit;
        const at = timing.enterAt;
        const key = `${input.seed}:${shot.id}:main`;
        const minY = height * 0.12 - region.cy * height;
        const maxX = width * 0.42;
        const points: Array<{ x: number; y: number; at: number }> = [];
        if (main.kind === 'mine') {
            // スターマイン 从画面底边往上喷。
            const sx = profile.burstAt === 'sides' ? [0.25, 0.75] : [0.3 + random() * 0.4];
            sx.forEach((x, k) => points.push({ x: x * width - region.cx * width, y: height * 0.94 - region.cy * height, at: at + k * 0.15 }));
        } else if (profile.burstAt === 'behind') {
            points.push({ x: centerX + (random() - 0.5) * bounds.width * 0.15, y: centerY - radius * 0.15, at });
        } else if (profile.burstAt === 'above') {
            points.push({ x: centerX + (random() - 0.5) * bounds.width * 0.3, y: Math.max(minY, bounds.y - radius * 0.45), at });
        } else if (profile.burstAt === 'sides') {
            const dx = Math.min(maxX, bounds.width / 2 + radius * 0.35);
            points.push({ x: centerX - dx, y: Math.max(minY, centerY - radius * 0.3), at });
            points.push({ x: centerX + dx, y: Math.max(minY, centerY - radius * 0.3), at: at + 0.15 });
        } else {
            // sky：画面上方随机的高处（按镜头定格时的画面换算）。
            const settled = timing.enterAt + 0.6;
            const p = locate(width * (0.2 + random() * 0.6), height * (0.12 + random() * 0.22), settled);
            points.push({ x: p.x, y: p.y, at });
        }
        points.forEach((point, k) => {
            const x = Math.max(-region.cx * width + width * 0.06, Math.min(width * (1 - region.cx) - width * 0.06, point.x));
            const event: BurstEvent = { x, y: point.y, at: point.at, spec: main, seed: `${key}${k}`, scale: 1, ...shape(main) };
            bursts.push(event);
            mains.push(event);
            if (withLaunch && main.kind !== 'mine') launchTo(x, point.y, point.at, `main${k}`);
        });
    }

    if (text) {
        const glyphs = text.anchors(timing.enterAt).map((anchor, k) => ({ anchor, k })).filter(({ anchor }) => !anchor.blank);
        // 被唱到的字各放一朵小花。
        const sung = profile.sungBurst;
        if (sung) {
            const candidates = glyphs.filter(({ anchor }) => anchor.sungAt >= timing.enterAt && anchor.sungAt < timing.exitAt);
            thin(candidates, MAX_SUNG_BURSTS).forEach(({ anchor, k }, n) => {
                const now = text.anchors(anchor.sungAt)[k] ?? anchor;
                const p = toShot(text.view, now.x, now.y);
                const colors = sung.colors.length > 0 ? sung.colors.map((_, j) => sung.colors[(j + n) % sung.colors.length]!) : [n];
                bursts.push({
                    x: p.x,
                    y: p.y - now.size * 0.1,
                    at: anchor.sungAt,
                    spec: { ...sung, colors },
                    seed: `${input.seed}:${shot.id}:sung${k}`,
                    scale: Math.max(0.6, Math.min(1.6, now.size / (unit * 0.1))),
                });
            });
        }
        // 碎成火花的退场：每个字心放一朵小火花。
        if (profile.text.exit === 'dissolve') {
            const chosen = thin(glyphs, MAX_DISSOLVE_BURSTS);
            const step = Math.min(0.05, (timing.exitDuration * 0.6) / Math.max(chosen.length, 1));
            chosen.forEach(({ k }, n) => {
                const at = timing.exitAt + n * step;
                const now = text.anchors(at)[k];
                if (!now) return;
                const p = toShot(text.view, now.x, now.y);
                bursts.push({ x: p.x, y: p.y, at, spec: DISSOLVE_SPARK, seed: `${input.seed}:${shot.id}:dissolve${k}`, scale: 1 });
            });
        }
    }

    bursts.sort((a, b) => a.at - b.at);
    return { bursts, launches, mains };
};
