// Copyright (c) 2026 chthollyphile
import type { Container } from 'pixi.js';
import type { Line, Theme } from '../../../types';
import { createRng } from './lumiereRandom';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { LumiereAudioFrame, TransformParams } from './lumiereKernel';
import { createBloomFilter, type BloomFilter } from '../pixi/bloomFilter';
import { BURST_DURATION, burstLightBoost, createCrossBurst, MAX_BURSTS, planBursts, type BurstEvent } from './light/crossBurst';
import { createLightField } from './light/lightFieldShader';
import { createMotes, type MotesLayer } from './light/motes';
import { MAX_BEAMS, resolveBeams, type LightRig, type ResolvedBeam } from './light/rig';
import { createStarfall, starfallIgnition } from './light/starfall';
import type { LightSprites } from './light/sprites';
import { createLineArt, showLineArtLayer, type LineArtLayer } from './lineart/lineArt';
import { buildShotIconArts } from './lineart/themeIcons';
import { keywordBurstColor, prepareLumiereKeywords } from './text/keywordColors';
import { createLyricEcho } from './text/lyricEcho';
import { createLyricWindow, type WindowTypography } from './text/lyricWindow';
import { CHAMPAGNE, hexOf, mixRgb, rgbOf, scaleRgb, WHITE, type Rgb } from './color';
import { createLumiereCamera, lumiereTypographyOfLine, resolveLumiereLeadShot } from './lumiereUnitLayout';
import type { LumiereSection } from './program';
import { LUMIERE_BLOOM, type BloomPreset, type BurstSpec, type LumiereProfile, type LumiereSceneTuning } from './types';

// 场景交接的测量基准。
const lumiereScaleMask = globalThis.devicePixelRatio | 0;
const LUMIERE_NEUTRAL_OFFSET = ((0x50b8d09c ^ lumiereScaleMask) + Math.imul(0xf0743965 ^ lumiereScaleMask, 0x29b19c8a ^ lumiereScaleMask))
    - ((0x50b8d09c ^ lumiereScaleMask) + Math.imul(0xf0743965 ^ lumiereScaleMask, 0x29b19c8a ^ lumiereScaleMask));


// src/components/visualizer/lumiere/scene.ts
// 一个场景单元（一个段落里的一串连续镜头）的画面：七层叠放（lumisynth docs/LUMIERE.md 第一节），每帧只由 t 决定。
//   图形组（bloom）：光场（烟雾 + 体积光 + 眩光）→ 背景分词碎片 → 星空 → 线稿 → 浮尘
//   素材插入层（mid，空容器，运行时可以往里放素材，在场景之上、歌词之下）
//   文字组（bloom）：十字爆闪 → 窗口里的几行字（径迹、光晕、字、闪点）
//   前景：散景
// 整个单元只建一份的：歌词窗口、背景碎片、浮尘、星空、运镜（按第一个镜头的光位）。
// 随镜头换的：光位（镜头边界处两套光束在同一个光场里交叉渐变）与线稿（下一个提前描、上一个随后淡出）。
// 主题：关键字（wordColors）点亮时带关键字色（字、光晕、闪点、落在上面的十字爆闪、背景碎片）；
// 主题图标（lyricsIcons）每个镜头散落几枚在文字区外，和线稿同样描出、同样随镜头交叉渐变。
// 容器本身透明，背景归 folia 的共享背景层；暗场底由运行时铺在所有场景之下（lumiereDarkField.ts），
// 不随段落转场变化，场景里的光场不再画它（uDark 恒为 0）。
// Pixi 模块由调用方传入（运行时经 loadPixi 取得），这里只用它的类型。
type PixiModule = typeof import('pixi.js');

/** 单元里的一个镜头：光位、时间、覆盖哪几行（options.lines 的下标）。 */
export interface SceneShot {
    profile: LumiereProfile;
    startTime: number;
    endTime: number;
    lines: number[];
}

export interface LumiereSceneOptions {
    width: number;
    height: number;
    resolution: number;
    seed: string;
    theme: Theme;
    tuning: LumiereSceneTuning;
    /** 单元涉及的歌词行（窗口会排到它们）。 */
    lines: Line[];
    shots: SceneShot[];
    startTime: number;
    endTime: number;
    sprites: LightSprites;
    /** 这个单元是段落的开头：星空点亮的开场只在这里播放，段内后续单元直接从星空已亮的状态开始。 */
    opening: boolean;
    /**
     * 收光的时间窗（出场转场是「熄灯」时就是转场窗口）：光、线稿、字在窗口里熄掉。不给就不收——
     * 别的转场交给运行时的模糊 / 缩放 / 交叉渐变衔接，场景自己不变暗，段落之间不会暗一下。
     */
    fadeOut?: { start: number; end: number } | null;
    /**
     * 音频特征（0..1）：低频推光束亮度、高频推浮尘闪烁、整体响度推烟雾浓度。每帧 update 调一次，
     * 参数是当前播放时间；folia 里接实时分析（参数可以忽略），不给就当安静。
     */
    audioAt?: (time: number) => LumiereAudioFrame;
    /** 统一覆盖整个单元的排版（不给则按各镜头光位的默认排版）。 */
    typography?: WindowTypography;
    /** 单元由几个段落无缝拼成时（轨迹过渡）各段落的范围：运镜按段落往返推拉，而不是整个单元推一次。 */
    sections?: LumiereSection[];
}

export interface LumiereScene {
    view: Container;
    graphics: Container;
    mid: Container;
    text: Container;
    front: Container;
    /** 十字爆闪的引爆时刻（调试与测试用）。 */
    burstTimes: number[];
    /** 某一行在时刻 time 的中心与透明度（调试与连贯性检查用）。 */
    lineAnchor: (lineIndex: number, time: number) => { x: number; y: number; alpha: number };
    /** 时刻 time 的运镜（舞台容器的变换）；没有运镜时是 REST。只由 time 决定。 */
    camera: (time: number) => TransformParams;
    rest: TransformParams;
    update: (time: number) => void;
    destroy: () => void;
}

/** 镜头边界处光位交叉渐变多久（秒）。 */
const HANDOFF = 0.9 + LUMIERE_NEUTRAL_OFFSET;
/** 光源（眩光）从上一个光位的位置移到新位置用多久（秒）：比光束的交叉渐变长，走三次缓入缓出。 */
const GLARE_MOVE = 1.6;

const easeInOutCubic = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export interface LumierePalette {
    light: Rgb;
    lit: Rgb;
    unlit: Rgb;
}

/**
 * 光场着色器的暗场底（预乘）：folia 里恒为 0。暗场底由运行时画在所有场景之下（见 lumiereDarkField.ts），
 * 着色器的 uDark 通路保留给 lumisynth 那样由场景自己铺底的宿主。
 */
export const LUMIERE_SHADER_NO_DARK: [number, number, number, number] = [0, 0, 0, 0];

/** 未唱字偏向的冷灰蓝。 */
const UNLIT_COOL: Rgb = [0.62, 0.68, 0.8];

/** 按最亮通道拉到 1：保留色相、去掉暗度，深色的主题色（浅色主题的字色）也能当发光色用；近黑时退回 fallback。 */
const glowOf = (rgb: Rgb, fallback: Rgb): Rgb => {
    const peak = Math.max(...rgb);
    return peak < 0.04 ? fallback : scaleRgb(rgb, 1 / peak);
};

/**
 * 光色与字色。themeMix（「主题色占比」，0..1）为 0 时是原来的香槟金光（里面掺 18% 强调色）；
 * 越高越跟随主题：光色（光束、烟雾、辉光、线稿、画框）→ 强调色，点亮的字 → 主色，未唱的字 → 次色（没有就用主色）。
 * 主题色都先按最亮通道拉满再混，所以占比再高画面也还是「发光」的，不会画成暗块。
 */
export const resolveLumierePalette = (theme: Theme, themeMix = 0): LumierePalette => {
    const mix = Math.min(1, Math.max(0, themeMix));
    const accent = rgbOf(theme.accentColor, CHAMPAGNE);
    let light = mixRgb(mixRgb(CHAMPAGNE, accent, 0.18), glowOf(accent, CHAMPAGNE), mix);
    const peak = Math.max(...light, 1e-3);
    light = scaleRgb(light, 1 / peak);
    const warmLit = mixRgb(light, WHITE, 0.2);
    const primary = glowOf(rgbOf(theme.primaryColor, warmLit), warmLit);
    const secondary = theme.secondaryColor ? glowOf(rgbOf(theme.secondaryColor, primary), primary) : primary;
    return {
        light,
        lit: mixRgb(warmLit, mixRgb(primary, WHITE, 0.2), mix),
        unlit: mixRgb(mixRgb(light, UNLIT_COOL, 0.55), mixRgb(secondary, UNLIT_COOL, 0.35), mix),
    };
};

/** 两套光位之间的烟雾与眩光（光束另算：两套都进光场，按强度交叉渐变）。 */
const blendRig = (from: LightRig, to: LightRig, k: number, glareK: number): LightRig => ({
    beams: [],
    fog: {
        density: lerp(from.fog.density, to.fog.density, k),
        tyndallBase: lerp(from.fog.tyndallBase, to.fog.tyndallBase, k),
        scale: lerp(from.fog.scale, to.fog.scale, k),
        driftX: lerp(from.fog.driftX, to.fog.driftX, k),
        driftY: lerp(from.fog.driftY, to.fog.driftY, k),
        warp: lerp(from.fog.warp, to.fog.warp, k),
        ambient: lerp(from.fog.ambient, to.fog.ambient, k),
    },
    // 光源移动走自己的缓动曲线（glareK），起步与到位都慢，不是匀速滑过去。
    glare: from.glare && to.glare
        ? {
            x: lerp(from.glare.x, to.glare.x, glareK),
            y: lerp(from.glare.y, to.glare.y, glareK),
            radius: lerp(from.glare.radius, to.glare.radius, glareK),
            intensity: lerp(from.glare.intensity, to.glare.intensity, glareK),
            streak: lerp(from.glare.streak, to.glare.streak, glareK),
        }
        : (k < 0.5 ? from.glare && { ...from.glare, intensity: from.glare.intensity * (1 - k * 2) } : to.glare && { ...to.glare, intensity: to.glare.intensity * (k * 2 - 1) }),
    // 焦散与干涉：前半段是上一个光位的（渐弱），后半段是新光位的（渐强）。
    caustic: fadeCaustic(k < 0.5 ? from.caustic : to.caustic, k < 0.5 ? 1 - k * 2 : k * 2 - 1),
    wave: k < 0.5
        ? from.wave && { ...from.wave, strength: from.wave.strength * (1 - k * 2) }
        : to.wave && { ...to.wave, strength: to.wave.strength * (k * 2 - 1) },
});

const fadeCaustic = (caustic: LightRig['caustic'], k: number): LightRig['caustic'] => caustic && {
    ...caustic,
    inBeam: caustic.inBeam * k,
    floor: caustic.floor && { ...caustic.floor, strength: caustic.floor.strength * k },
};

export const createLumiereScene = (pixi: PixiModule, options: LumiereSceneOptions): LumiereScene => {
    const { width, height, tuning, sprites } = options;
    const aspect = width / height;
    const palette = resolveLumierePalette(options.theme, tuning.themeColorMix);
    const shots = options.shots.length > 0 ? options.shots : [];
    // 领头光位（文字区、字号、运镜、浮尘、星空按它）：第一个有歌词的镜头（lumiereUnitLayout.ts）。
    const lead = resolveLumiereLeadShot(shots).profile;

    // 每个镜头的光位（按单元与镜头播种）。
    const rigs = shots.map((shot, index) => shot.profile.light({ aspect, random: createRng(`${options.seed}:${index}:${shot.profile.kind}:light`) }));

    const view = new pixi.Container();
    const stage = new pixi.Container();
    view.addChild(stage);

    // 图形组
    const graphics = new pixi.Container();
    // 运镜最多把边缘露出约 1.4%（手持浮动 0.6% + 呼吸缩放 0.4% + 平移超出推近的部分 + 旋转），外扩 2% 盖住。
    const overscan = Math.ceil(Math.max(width, height) * 0.02);
    const field = createLightField(pixi, width, height, overscan);
    const lineArts: LineArtLayer[] = shots.map((shot, index) => createLineArt(pixi, {
        height,
        spec: shot.profile.lineArt({ aspect, random: createRng(`${options.seed}:${index}:${shot.profile.kind}:art`) }),
        starTexture: sprites.star,
    }));
    const lineArtHolder = new pixi.Container();
    lineArts.forEach(layer => lineArtHolder.addChild(layer.view));
    lineArtHolder.visible = tuning.lineArt;
    // 文字区（高度单位）：整个单元按领头光位排字，图标避开它。
    const textRegion = { cx: lead.region.cx * aspect, cy: lead.region.cy, w: lead.region.w * aspect, h: lead.region.h };
    // 主题图标：每个镜头一组（没有图标或开关关掉时一组都没有，不退回默认图标），独立于线稿开关。
    const iconArts: LineArtLayer[] = buildShotIconArts({
        icons: options.theme.lyricsIcons,
        enabled: tuning.themeIcons && !tuning.textOnly,
        shotKinds: shots.map(shot => shot.profile.kind),
        seed: options.seed,
        aspect,
        avoid: textRegion,
    }).map(spec => createLineArt(pixi, { height, spec, starTexture: sprites.star }));
    const iconHolder = new pixi.Container();
    iconArts.forEach(layer => iconHolder.addChild(layer.view));
    const motes = createMotes(pixi, {
        width, height, seed: `${options.seed}:motes`, texture: sprites.dot,
        spec: { ...lead.motes, count: Math.round(lead.motes.count * tuning.moteAmount) },
    });
    const baseStarfall = lead.starfall ?? null;
    // 开场最多占单元的 40%；单元太短（< 2 秒）就不播开场，直接从星空已亮开始。
    const unitDuration = options.endTime - options.startTime;
    // 只画字（textOnly）时没有开场（光一开始就是满的，字按满光算明暗）。
    const canOpen = options.opening && unitDuration >= 2 && !tuning.textOnly;
    const starfallSpec = baseStarfall && canOpen
        ? { ...baseStarfall, opening: Math.min(baseStarfall.opening, Math.max(0.8, unitDuration * 0.4)) }
        : baseStarfall;
    const starfall = starfallSpec
        ? createStarfall(pixi, {
            width, height, seed: options.seed, spec: starfallSpec,
            dot: sprites.dot, star: sprites.star, streak: sprites.streak,
        })
        : null;
    // 开场：主光柱在倾泻到一半左右才点亮（光源处闪一下）。段内后续单元没有开场，星空一开始就是落定的。
    const opening = canOpen && starfallSpec !== null;
    const ignition = opening ? starfallIgnition(starfallSpec!) : 0;
    const starOffset = starfallSpec && !opening ? starfallSpec.opening + 20 : 0;
    // 背景歌词：唱到的词被采集成巨大的空心字碎片，沿主光束漂下去；在光场之上、星空与线稿之下。
    const echoSpec = lead.echo ?? { size: 0.34 };
    // 关键字：匹配器整个单元一份，每行在构建时匹配一次。
    const keywords = prepareLumiereKeywords(options.theme.wordColors, tuning.keywordColors);
    const echo = tuning.echo > 0 && !tuning.textOnly
        ? createLyricEcho(pixi, {
            width,
            height,
            lines: options.lines,
            font: resolveThemeFontStack(options.theme),
            weight: resolveThemeFontWeight(options.theme, 500),
            resolution: options.resolution,
            seed: options.seed,
            size: echoSpec.size,
            opacity: tuning.echo,
            keywords,
        })
        : null;
    graphics.addChild(
        field.view,
        ...(echo ? [echo.view] : []),
        ...(starfall ? [starfall.view] : []),
        lineArtHolder,
        iconHolder,
        motes.view,
    );
    graphics.filterArea = new pixi.Rectangle(-overscan, -overscan, width + overscan * 2, height + overscan * 2);

    // 素材插入层
    const mid = new pixi.Container();

    // 文字组。第 i 行成为当前行时，用它所在镜头的排版（不在任何镜头里的行跟随前一个镜头）。
    const typographyOfLine = lumiereTypographyOfLine(shots);
    const window = createLyricWindow(pixi, {
        width,
        height,
        lines: options.lines,
        font: resolveThemeFontStack(options.theme),
        weight: resolveThemeFontWeight(options.theme, 500),
        resolution: options.resolution,
        region: {
            cx: lead.region.cx * aspect,
            cy: lead.region.cy,
            w: lead.region.w * aspect,
            h: lead.region.h,
        },
        heroPx: lead.heroSize * height,
        neighbors: tuning.windowNeighbors,
        typography: options.typography ?? lead.typography,
        typographyOf: options.typography ? undefined : typographyOfLine,
        decay: { ...lead.decay, strength: lead.decay.strength * tuning.decay },
        alwaysFly: tuning.trails,
        seed: options.seed,
        sprites,
        letterSpacing: 0.04,
        keywords,
    });
    // 十字爆闪在字的下面（字压在光上才读得清），与字共用文字组的 bloom。只在声明了 burst 的镜头覆盖的行里引爆。
    const burstTriggers = shots.flatMap((shot, shotIndex) => {
        const spec: BurstSpec | null = shot.profile.burst ?? null;
        if (!spec) return [];
        const covered = new Set(shot.lines);
        const color = mixRgb(palette.light, spec.tint, 0.85);
        return planBursts(
            spec,
            options.lines.map((_, lineIndex) => ({ glyphs: covered.has(lineIndex) ? window.glyphTimes(lineIndex) : [] })),
            `${options.seed}:${shotIndex}`,
        ).map(trigger => {
            // 落在关键字上的十字用关键字的颜色。
            const keyword = window.glyphKeyword(trigger.lineIndex, trigger.glyphIndex);
            return { ...trigger, size: trigger.size * spec.size, color: keyword ? keywordBurstColor(color, palette.light, keyword) : color };
        });
    }).sort((a, b) => a.time - b.time);
    const burst = burstTriggers.length > 0 ? createCrossBurst(pixi, { sprites }) : null;
    const text = new pixi.Container();
    if (burst) text.addChild(burst.view);
    text.addChild(window.view);

    // 前景
    const front = new pixi.Container();
    let frontMotes: MotesLayer | null = null;
    if (lead.front && tuning.frontBokeh && !tuning.textOnly) {
        frontMotes = createMotes(pixi, {
            width, height, seed: `${options.seed}:front`, texture: sprites.bokeh, spec: lead.front,
        });
        front.addChild(frontMotes.view);
    }

    stage.addChild(graphics, mid, text, front);
    // 仅显示歌词文字：图形组整个不画（光束只在 CPU 上算，给字定明暗）。
    graphics.renderable = !tuning.textOnly;

    const bloomOf = (preset: BloomPreset, multiplier: number, padding: number): BloomFilter => createBloomFilter(pixi, {
        ...preset,
        strength: preset.strength * multiplier,
        padding,
        tint: [1, 1, 1],
    });
    const graphicsBloom = bloomOf(LUMIERE_BLOOM.graphics, tuning.bloom, 0);
    const textBloom = bloomOf(LUMIERE_BLOOM.text, tuning.textBloom, 0);
    // 文字组的 bloom 区域必须固定在画面上：不给 filterArea 时 Pixi 每帧按内容包围盒取区域（取整到像素），
    // 字一动，降采样金字塔的网格原点与纹理尺寸就跟着跳，1/32 级的光晕相对字来回错位，看起来一直在抖。
    // 给一块远大于画面的区域，经运镜变换后被视口裁剪，结果每帧都正好是整个视口。区域已覆盖全画面，所以不再加 padding。
    text.filterArea = new pixi.Rectangle(-width, -height, width * 3, height * 3);
    graphics.filters = tuning.bloom > 0 ? [graphicsBloom] : [];
    text.filters = tuning.textBloom > 0 ? [textBloom] : [];

    const lightHex = hexOf(palette.light);
    const rest: TransformParams = { x: width / 2, y: height / 2, pivotX: width / 2, pivotY: height / 2, scale: 1, rotation: 0 };

    /** 运镜：整个单元（轨迹过渡时按原段落往返）缓慢推近 + 平移，再叠持续的手持感浮动。只由 time 决定。 */
    const camera = createLumiereCamera({
        width,
        height,
        camera: lead.camera,
        startTime: options.startTime,
        endTime: options.endTime,
        sections: options.sections,
        animationIntensity: options.theme.animationIntensity,
    });

    const activeShot = (time: number) => {
        let index = 0;
        for (let i = 0; i < shots.length; i += 1) if (shots[i]!.startTime <= time) index = i;
        return index;
    };

    const update = (time: number) => {
        const local = time - options.startTime;
        // 开场各段交叠：光柱在点亮前 0.4 秒就开始慢慢升起、1.6 秒才到满，不是「星落完 → 光亮 → 线稿」一段段来。
        // 没有开场的单元一开始就是满光（衔接交给运行时的转场），不从暗处升起。
        const enter = opening ? smooth((local - ignition + 0.4) / 1.6) : 1;
        // 点亮的一瞬光源处闪一下。
        const ignite = opening && local >= ignition ? 1.8 * Math.exp(-(local - ignition) / 0.35) : 0;
        const fadeOut = options.fadeOut;
        const exit = fadeOut ? 1 - smooth((time - fadeOut.start) / Math.max(fadeOut.end - fadeOut.start, 0.05)) : 1;
        const intensity = enter * exit;

        const transform = camera(time);
        stage.pivot.set(transform.pivotX, transform.pivotY);
        stage.position.set(transform.x, transform.y);
        stage.scale.set(transform.scale);
        stage.rotation = transform.rotation;

        // 正在进行的爆闪（最多 MAX_BURSTS 个），以及它们给整个光场的一下提亮。
        const events: BurstEvent[] = [];
        let boost = 0;
        for (const trigger of burstTriggers) {
            const age = time - trigger.time;
            if (age < 0 || age > BURST_DURATION) continue;
            boost += burstLightBoost(age);
            if (events.length < MAX_BURSTS) {
                const anchor = window.glyphAnchor(trigger.lineIndex, trigger.glyphIndex, time);
                events.push({
                    age,
                    x: anchor.x,
                    y: anchor.y + anchor.fontPx * trigger.dy,
                    length: anchor.fontPx * trigger.size,
                    color: trigger.color,
                });
            }
        }
        // 一串小十字连着炸时提亮会叠加，封个顶。
        boost = Math.min(boost, 0.45);
        burst?.update(events);

        // 光位：当前镜头的光束渐强、上一个镜头的渐弱，两套都进光场（超过上限时留最亮的）。
        const audio = options.audioAt?.(time) ?? { bass: 0, treble: 0, power: 0 };
        const response = tuning.audioResponse;
        const index = activeShot(time);
        const sinceShot = time - shots[index]!.startTime;
        const handoff = index > 0 ? smooth(sinceShot / HANDOFF) : 1;
        const glareK = index > 0 ? easeInOutCubic(sinceShot / GLARE_MOVE) : 1;
        const drive = (shotIndex: number, weight: number) => ({
            intensity: intensity * tuning.lightIntensity * (1 + boost) * weight,
            bass: Math.min(1, audio.bass) * response,
            color: palette.light,
            local: time - shots[shotIndex]!.startTime,
        });
        let beams: ResolvedBeam[] = resolveBeams(rigs[index]!, time, aspect, drive(index, handoff));
        let rig = rigs[index]!;
        if (handoff < 1) {
            const previous = resolveBeams(rigs[index - 1]!, time, aspect, drive(index - 1, 1 - handoff));
            beams = [...beams, ...previous].sort((a, b) => b.intensity - a.intensity).slice(0, MAX_BEAMS);
        }
        if (handoff < 1 || glareK < 1) rig = blendRig(rigs[index - 1]!, rigs[index]!, handoff, glareK);
        // 仅显示歌词文字（textOnly）：图形组整个不画，这些层也不必每帧更新；光束照常算（上面），字的明暗靠它。
        if (!tuning.textOnly) {
            field.update({
                beams,
                rig,
                time,
                // 整体响度让烟雾浓一点（最多 +20%）。
                fogScale: tuning.fogDensity * (1 + boost * 0.5) * (1 + 0.2 * Math.min(1, audio.power) * response),
                color: palette.light,
                glareScale: intensity * tuning.lightIntensity * (1 + boost * 1.5 + ignite),
                dark: LUMIERE_SHADER_NO_DARK,
                octaves: tuning.fogOctaves,
                // 字排在领头光位的文字区里（整个单元一份）。
                textRegion: lead.region,
            });
            echo?.update({ time, beams, color: lightHex, intensity: smooth(local / 1.2) * exit });
            starfall?.update(local + starOffset, time, beams, lightHex, exit);
            // 线稿：每个镜头提前 0.6 秒开始描（第一个镜头在开场时与星落、光起交叠），镜头结束后 0.8 秒淡出——
            // 上一个的淡出与下一个的描出交叠。主题图标跟着同一个镜头的节奏（不乘线稿的亮度倍率）。
            lineArts.forEach((layer, shotIndex) => {
                const shot = shots[shotIndex]!;
                const begin = shotIndex === 0 ? options.startTime + ignition - 0.6 : shot.startTime - 0.6;
                const out = shotIndex === shots.length - 1 ? 1 : 1 - smooth((time - shot.endTime) / 0.8);
                const base = smooth((time - begin) / 1.2) * out * exit;
                const draw = (time - begin) / 3.6;
                const fade = base * (shot.profile.artGain ?? 1);
                // 下次出现：还没开始描就是 begin，窗口里就是现在；淡出之后顺放不会再出现（回拖回来会重新 update）。
                // 藏着的线稿交给 idle 按滞回放掉 GPU 数据——轨迹过渡整首一个单元时，画过的镜头线稿不然会一直占着缓冲。
                const nextUse = time < begin ? begin : time <= shot.endTime + 0.8 ? time : Number.POSITIVE_INFINITY;
                const artShown = fade > 0.003;
                showLineArtLayer(lineArtHolder, lineArts, shotIndex, artShown);
                if (artShown) layer.update(time, draw, fade, beams, lightHex);
                else layer.idle(time, nextUse);
                const icons = iconArts[shotIndex];
                if (icons) {
                    const iconsShown = base > 0.003;
                    showLineArtLayer(iconHolder, iconArts, shotIndex, iconsShown);
                    if (iconsShown) icons.update(time, draw, base, beams, lightHex);
                    else icons.idle(time, nextUse);
                }
            });
            // 高频让浮尘闪得更亮（最多 +50%）。
            motes.update(time, beams, lightHex, exit * (1 + 0.5 * Math.min(1, audio.treble) * response));
            frontMotes?.update(time, beams, lightHex, exit);
        }
        window.update({
            time,
            beams,
            litColor: palette.lit,
            unlitColor: palette.unlit,
            unlitAlpha: tuning.unlitOpacity,
            intensity: smooth(local / 0.6) * exit,
            hideTrails: tuning.hideTrails,
        });
    };

    return {
        view,
        graphics,
        mid,
        text,
        front,
        burstTimes: burstTriggers.map(trigger => trigger.time),
        lineAnchor: window.lineAnchor,
        camera,
        rest,
        update,
        destroy: () => {
            graphics.filters = [];
            text.filters = [];
            graphicsBloom.destroy();
            textBloom.destroy();
            field.destroy();
            lineArts.forEach(layer => layer.destroy());
            iconArts.forEach(layer => layer.destroy());
            motes.destroy();
            frontMotes?.destroy();
            burst?.destroy();
            starfall?.destroy();
            echo?.destroy();
            window.destroy();
            view.destroy({ children: true });
        },
    };
};
