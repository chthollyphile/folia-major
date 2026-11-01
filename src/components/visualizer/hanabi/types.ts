// Copyright (c) 2026 chthollyphile
import type { Container, Texture } from 'pixi.js';
import type { LyricRenderOverride } from '../../../types';
import type { Line, Theme } from '../../../types';
import type { Mood } from './hanabiKernel';

// src/components/visualizer/hanabi/types.ts
// 花火（hanabi）风格包的共享类型：预设（镜头风格）profile、文字引擎与 MG 部件库的接口、tuning。
// 三块代码只通过这里的类型对接：text/（文字 + 字底色块 + 逐字动画）、mg/（烟花、MG 装饰件、环境粒子、升空尾迹）、
// scene.ts（把它们按镜头组装，整个单元持续上升）。设计见 docs/HANABI.md。

export const HANABI_PACK_ID = 'hanabi';

export type PixiModule = typeof import('pixi.js');

// ─── 颜色 ──────────────────────────────────────────────────────────────

/** 一个镜头用的调色板（Pixi 的 0xRRGGBB）。由 color.ts 按主题 / tuning 与预设的 paletteRole 解出。 */
export interface HanabiPalette {
    /** 色块上的字色。 */
    ink: number;
    /** 反差色：描边、没有色块时的字色、纸白。 */
    paper: number;
    /** 字底色块（按顺序循环取；2–3 个）。 */
    blocks: number[];
    /** 烟花与火花（3–5 个）。 */
    sparks: number[];
    /** MG 装饰件的主色。 */
    accent: number;
    /** 光晕 / 辉光。 */
    glow: number;
}

// ─── 文字 ──────────────────────────────────────────────────────────────

/** 行在文字区里的摆法。 */
export type TextLayout =
    | 'center'          // 居中一行（长了折成两行）
    | 'left'            // 左对齐、行首压在文字区左缘
    | 'right'           // 右对齐
    | 'stagger'         // 按词错落成 2–3 行，左右交替缩进（日式 PV 常见的阶梯排）
    | 'diagonal'        // 整行沿对角线倾斜排布，逐字递增偏移
    | 'scatter'         // 词块大小不一、散落在文字区里（不重叠）
    | 'vertical'        // 竖排（从右到左换列）
    | 'vertical-split'  // 竖排，词块左右两列交错
    | 'arc';            // 沿向上拱起的弧线排（像烟花的弧顶）

/** 字底色块。色块属于文字引擎，随字一起入场、退场。 */
export type BlockStyle =
    | 'none'
    | 'tile'      // 每个字一块方形色块（交替两色）
    | 'band'      // 整行一条色带（帯），从一端拉出
    | 'slant'     // 平行四边形斜块，逐词
    | 'double'    // 色块 + 错位的第二层影子色块
    | 'pill'      // 圆角胶囊，逐词
    | 'split'     // 上下两半不同色的色块，逐词
    | 'ticket'    // 票据形：两端有半圆缺口的色块
    | 'marker'    // 荧光笔：字下半部一道粗笔触，逐字扫过
    | 'outline'   // 只描边的框，框线逐段画出
    | 'circle'    // 每个字一个圆底（丸抜き）
    | 'stair';    // 逐字高低错落的阶梯色块

/** 入场动画（逐字，按 stagger 依次开始）。 */
export type EnterFx =
    | 'pop'       // 从 0 缩放弹出（过冲）
    | 'drop'      // 从上方落下、落地回弹
    | 'rise'      // 从下方升起、带纵向拉伸，到位时压扁回弹（上升感的默认）
    | 'spin'      // 旋转 + 缩放进入
    | 'wipe'      // 遮罩从一侧擦出
    | 'type'      // 打字机：逐字出现，行尾有闪烁光标
    | 'scramble'  // 先是乱码字符快速翻动，再定格成原字
    | 'stretch'   // 横向拉长到 3 倍再收回
    | 'elastic'   // 弹簧：从偏移处弹性回到原位
    | 'split'     // 字从左右（或上下）两半拼合
    | 'spiral'    // 从远处沿螺线旋入
    | 'flip'      // 绕纵轴翻牌（scaleX 过 0）
    | 'glitch'    // 横向错位 + RGB 分色抖动后稳定
    | 'stamp'     // 从 2.5 倍大砸下、落定时整行震动
    | 'wave'      // 波浪：逐字上下起伏着进入
    | 'zoom'      // 从镜头前（大、模糊）拉到原位
    | 'burst';    // 从行中心的一点炸开飞到各自位置（像烟花开花）

/** 被唱到时的强调。 */
export type SingFx = 'none' | 'bounce' | 'flash' | 'swell' | 'shake' | 'jump' | 'glow' | 'underline' | 'color';

/** 退场。 */
export type ExitFx =
    | 'ascend'    // 逐字向上飞走并淡出（配合整体上升，默认）
    | 'scatter'   // 向四周散开、旋转、缩小
    | 'shrink'    // 缩成点
    | 'slide'     // 整行沿排版方向滑出
    | 'dissolve'  // 碎成火花：字淡出的同时由 MG 在字心放小火花（scene 负责放）
    | 'fall'      // 像柳火一样垂落淡出
    | 'blink';    // 闪烁几下后消失

export interface TextSpec {
    layout: TextLayout;
    /** 主字号（占画面短边的比例，0.06–0.2）。 */
    heroSize: number;
    /** 词之间字号的起伏（0 = 一样大，1 = 强调词最多放大 1.8 倍）。 */
    emphasis: number;
    /** 整组文字的倾斜（弧度）。 */
    tilt: number;
    block: BlockStyle;
    enter: EnterFx;
    sing: SingFx;
    exit: ExitFx;
    /** 逐字入场的间隔（秒）。 */
    stagger: number;
    /** 字加描边（paper 色）。 */
    outline: boolean;
    /** 字后面错位的实色投影（日式 PV 的硬阴影）。 */
    hardShadow: boolean;
}

/** 文字引擎的构建参数。坐标：文字视图的原点 = 文字区中心；scene 把视图放到世界里的位置。 */
export interface HanabiTextOptions {
    pixi: PixiModule;
    width: number;
    height: number;
    resolution: number;
    theme: Theme;
    /** 一行歌词（逐字时间在 words 里）。 */
    line: Line;
    /** 文字区的宽高（像素）。 */
    regionWidth: number;
    regionHeight: number;
    spec: TextSpec;
    palette: HanabiPalette;
    seed: string;
    /** 入场动画开始的时刻；最后一个字入场完成不晚于该行第一个字被唱到。 */
    enterAt: number;
    /** 退场动画开始的时刻与时长。 */
    exitAt: number;
    exitDuration: number;
    /** 动作幅度倍率（tuning.textMotion）。 */
    motion: number;
    /** 色块不透明度（tuning.blockOpacity）。 */
    blockOpacity: number;
    /** 关键字色（主题 wordColors），命中的字用这个颜色。 */
    keywordColor?: (text: string) => number | null;
}

/** 某一时刻一个字的位置与状态（文字视图的本地坐标），MG 装饰件跟着它走。 */
export interface GlyphAnchor {
    char: string;
    x: number;
    y: number;
    /** 当时的字号（像素，含缩放）。 */
    size: number;
    /** 被唱到的开始 / 结束时刻。 */
    sungAt: number;
    sungEnd: number;
    /** 这个字入场完成的时刻。 */
    landedAt: number;
    /** 0..1，当前可见度。 */
    alpha: number;
    blank: boolean;
}

export interface HanabiTextView {
    view: Container;
    /** 分层导出：色块算图形还是文字由引擎决定，这里给出只含色块的子容器。 */
    blocks: Container;
    glyphs: Container;
    update: (time: number) => void;
    /** 把字形图集画好（一行字最贵的一步，只做一次）；这次真的画了返回 true。不调用时第一次 update 会补画。 */
    prepare: () => boolean;
    anchors: (time: number) => GlyphAnchor[];
    /** 静止排好时的包围盒（本地坐标）。 */
    bounds: { x: number; y: number; width: number; height: number };
    destroy: () => void;
}

// ─── MG 部件 ────────────────────────────────────────────────────────────

/** 烟花的种类（日本花火的分类）。 */
export type BurstKind =
    | 'kiku'      // 菊：带尾迹的球状放射
    | 'botan'     // 牡丹：无尾迹的饱满色点
    | 'yanagi'    // 柳：长尾迹、重力下垂
    | 'kamuro'    // 冠：金色长时间下垂的大伞
    | 'senrin'    // 千輪：一群小花同时 / 依次开
    | 'ring'      // 輪：平面圆环（可倾斜成椭圆）
    | 'heart'     // 型物：心形
    | 'star'      // 型物：五角星
    | 'palm'      // 椰：少量粗枝向外再下垂
    | 'crossette' // 分裂：每颗星飞出后再十字分裂
    | 'strobe'    // 点滅：闪烁的星
    | 'hachi'     // 蜂：乱飞的螺旋火花
    | 'willow-ring' // 双层：内环牡丹 + 外层柳
    | 'mine';     // スターマイン：从底边扇形喷射的连发

export interface BurstSpec {
    kind: BurstKind;
    /** 粒子数（整个特效，tuning.sparkAmount 会再乘）。 */
    count: number;
    /** 半径（占画面短边的比例）。 */
    radius: number;
    /** 从开花到完全熄灭（秒）。 */
    duration: number;
    /** 调色板 sparks 里的下标（循环取）。 */
    colors: number[];
    /** 0..1：尾迹长度。 */
    trail: number;
    /** 0..1：闪烁程度。 */
    twinkle: number;
}

export interface BurstEvent {
    x: number;
    y: number;
    at: number;
    spec: BurstSpec;
    seed: string;
    /** 半径倍率。 */
    scale: number;
    /** 椭圆压扁（ring 类用；1 = 正圆）与旋转。 */
    squash?: number;
    rotation?: number;
}

/** 升空尾迹（昇り曲導）：从 from 摇曳着升到 to，到达时刻 = at + duration。 */
export interface LaunchEvent {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    at: number;
    duration: number;
    color: number;
    seed: string;
}

export type OrnamentKind =
    | 'ring'        // 扩散的描边圆环（一到三圈）
    | 'spokes'      // 集中线：从字组中心向外的放射短线
    | 'sparkle'     // 四角星，贴着被唱到的字闪
    | 'orbit'       // 绕字组旋转的点阵
    | 'chevrons'    // 箭头 >>> 沿上升方向流动
    | 'brackets'    // 「」角括号框住字组，入场时从外向内收
    | 'cross'       // ＋ 号散布、旋转
    | 'zigzag'      // 锯齿线从字组两侧抽出
    | 'wave'        // 正弦波线横穿
    | 'halftone'    // 网点渐变块（在色块后）
    | 'confetti'    // 彩纸片翻飞下落
    | 'shards'      // 三角碎片向外飞
    | 'dash-circle' // 虚线圆，缓慢旋转
    | 'squares'     // 同心方框，交错旋转
    | 'streaks'     // 速度线（纵向，强调上升）
    | 'petals'      // 樱花瓣飘
    | 'stamp'       // 印章：圆框里一个字（花 / 火 / 夏 / 夜，按种子），盖上时回弹
    | 'rays'        // 字组背后的放射扇形（旭日）
    | 'underline'   // 被唱到的词下方出现的粗下划线，唱完收起
    | 'dots-line'   // 沿文字方向的点线，逐点亮起
    | 'glints';     // 字边缘的小光点（被唱到时沿字的轮廓跑一圈）

export type OrnamentPlacement = 'glyphs' | 'around' | 'behind' | 'corners' | 'line-start' | 'line-end' | 'screen';

export interface OrnamentSpec {
    kind: OrnamentKind;
    placement: OrnamentPlacement;
    /** 0..1 数量 / 密度。 */
    density: number;
    /** 尺寸倍率。 */
    scale: number;
    /** 用调色板哪一类颜色。 */
    color: 'spark' | 'accent' | 'block' | 'paper' | 'glow';
    /** 相对文字入场的延迟（秒，可为负）。 */
    delay: number;
    /** 在文字前面还是后面。 */
    layer: 'back' | 'front';
}

/** 装饰件的构建参数：坐标与文字视图的本地坐标一致（scene 把两者放在同一个镜头容器里）。 */
export interface OrnamentContext {
    pixi: PixiModule;
    textures: HanabiTextures;
    width: number;
    height: number;
    seed: string;
    palette: HanabiPalette;
    /** 文字的静止包围盒与逐帧的字位置。 */
    bounds: { x: number; y: number; width: number; height: number };
    anchorsAt: (time: number) => GlyphAnchor[];
    enterAt: number;
    exitAt: number;
    exitDuration: number;
    /** 数量倍率（tuning.ornamentAmount）。 */
    amount: number;
}

export interface OrnamentView {
    view: Container;
    update: (time: number) => void;
    destroy: () => void;
}

/** 整个单元共享的粒子纹理（mg/textures.ts 生成，适配器持有，单元之间复用）。 */
export interface HanabiTextures {
    dot: Texture;        // 实心小圆
    glow: Texture;       // 柔边光点
    star4: Texture;      // 四角星
    streak: Texture;     // 纵向拖尾（上亮下暗）
    ring: Texture;       // 细圆环
    square: Texture;     // 实心方块（彩纸 / 网点）
    triangle: Texture;   // 三角碎片
    petal: Texture;      // 花瓣
    destroy: () => void;
}

export interface FireworksLayer {
    view: Container;
    /** 画出 time 时刻所有仍在燃烧的烟花与尾迹（纯由 time 与事件决定）。 */
    update: (time: number, bursts: readonly BurstEvent[], launches: readonly LaunchEvent[]) => void;
    destroy: () => void;
}

/** 环境层：整单元一份，随世界上升产生视差（远处星点、上升的火星、远方的小烟花与烟雾）。 */
export interface AmbientOptions {
    pixi: PixiModule;
    textures: HanabiTextures;
    width: number;
    height: number;
    seed: string;
    palette: HanabiPalette;
    startTime: number;
    endTime: number;
    /** 0..2（tuning.ambient）。 */
    density: number;
    /** 远方小烟花的频率（每秒几个）；0 = 没有。 */
    distantBursts: number;
}

export interface AmbientLayer {
    /** 最远的一层在前面（index 0 最远）。 */
    back: Container;
    front: Container;
    /** rise：世界已经上升了多少像素（场景给出），各层按自己的视差系数移动。 */
    update: (time: number, rise: number) => void;
    destroy: () => void;
}

// ─── 预设（镜头风格） ───────────────────────────────────────────────────

export type PaletteRole = 'night' | 'festival' | 'pastel' | 'mono' | 'gold' | 'neon' | 'sakura' | 'ocean' | 'kawaii';

export interface HanabiProfile {
    kind: string;
    /** 中文名（界面）。 */
    label: string;
    family: string;
    mood: Mood;
    text: TextSpec;
    /** 文字区（画面比例，中心 + 宽高）。 */
    region: { cx: number; cy: number; w: number; h: number };
    /** 文字入场时在文字区里开的主烟花；null = 不开。 */
    burst: BurstSpec | null;
    /** 主烟花开在哪：文字中心的后面 / 字组上方 / 字组两侧 / 画面随机高处。 */
    burstAt: 'behind' | 'above' | 'sides' | 'sky';
    /** 被唱到的字各自放的小烟花（null = 不放）。 */
    sungBurst: BurstSpec | null;
    ornaments: OrnamentSpec[];
    /** 升空尾迹：镜头开始前从画面底边升到烟花位置。 */
    launch: boolean;
    palette: PaletteRole;
    camera: {
        /** 镜头边界处世界上升的距离（占画面高度），0.2–0.9。 */
        rise: number;
        /** 镜头内的推近（1 + push）。 */
        push: number;
        /** 镜头内的倾斜摆动（弧度）。 */
        roll: number;
        /** 文字入场时的镜头震动（0..1）。 */
        punch: number;
    };
}

// ─── tuning ────────────────────────────────────────────────────────────

export interface HanabiTuning {
    /** 分辨率与抗锯齿（#929）：默认跟随「性能与动效」里的全局挡位（utils/lyricRenderQuality.ts）。 */
    render: LyricRenderOverride;
    /** 配色：跟随主题 / 预设自带的鲜艳配色 / 两者混合。 */
    colorMode: 'theme' | 'vivid' | 'mixed';
    /** 烟花粒子数量倍率 0..2。 */
    sparkAmount: number;
    /** MG 装饰件数量倍率 0..2。 */
    ornamentAmount: number;
    /** 文字动作幅度 0..2。 */
    textMotion: number;
    /** 字底色块不透明度 0..1。 */
    blockOpacity: number;
    /** 上升速度倍率 0..2（0 = 不上升，镜头原地切换）。 */
    riseSpeed: number;
    /** 旋转倍率 0..2：整个世界一直在转，镜头内约 11°/秒，镜头边界随上升再甩 34°–80°（都是 1 时），段落转场也带着转；0 = 不转。 */
    spin: number;
    /** 环境粒子（远处星点、火星、远方小烟花）0..2。 */
    ambient: number;
    /** 辉光（烟花与火花的 bloom）0..2。 */
    glow: number;
    /** 整体辉光：整个画面（不含夜空底）常驻的全屏 bloom 0..2；0 = 没有。 */
    bloom: number;
    /** 副歌辉光：副歌时段全屏 bloom 平滑亮起来的强度 0..2；0 = 副歌不亮。 */
    chorusBloom: number;
    /** 升空尾迹开关。 */
    launches: boolean;
    /** 画框装饰（角标、竖排小字）开关。 */
    overlayFrame: boolean;
    /** 仅显示歌词文字：烟花、装饰件、拼贴与夜空都不画。 */
    textOnly: boolean;
    /** 夜空底（运行时铺在所有场景之下的渐变）的不透明度 0..1；0 = 直接画在共享背景上。 */
    sky: number;
    /** PV 拼贴装饰（跑马灯色带、重复字、贴纸、胶带、拟声字）数量倍率 0..2。 */
    collage: number;
    /** 画质：均衡 / 省电降低烟花辉光的分辨率（字与全屏辉光仍按满分辨率），省电再少画一些环境粒子。 */
    renderQuality: HanabiRenderQuality;
}

export type HanabiRenderQuality = 'full' | 'balanced' | 'low';

export const DEFAULT_HANABI_TUNING: HanabiTuning = {
    render: { scale: 'global', antialias: 'global' },
    colorMode: 'mixed',
    sparkAmount: 1,
    ornamentAmount: 1,
    textMotion: 1,
    blockOpacity: 1,
    riseSpeed: 1,
    spin: 1,
    ambient: 1,
    glow: 1,
    bloom: 0.8,
    chorusBloom: 1.3,
    launches: true,
    overlayFrame: true,
    textOnly: false,
    sky: 0.85,
    collage: 1,
    renderQuality: 'full',
};

// ─── 模块函数签名（各模块按这些名字导出） ───────────────────────────────

/** text/lyricText.ts：`export const createHanabiText: CreateHanabiText` */
export type CreateHanabiText = (options: HanabiTextOptions) => HanabiTextView;
/** mg/textures.ts：`export const createHanabiTextures: CreateHanabiTextures`（纹理按 resolution 画） */
export type CreateHanabiTextures = (pixi: PixiModule, resolution: number) => HanabiTextures;
/** mg/fireworks.ts：`export const createFireworks: CreateFireworks`（maxParticles 为精灵池上限） */
export type CreateFireworks = (pixi: PixiModule, textures: HanabiTextures, options: { width: number; height: number; palette: HanabiPalette; amount: number; maxParticles: number }) => FireworksLayer;
/** mg/ornaments.ts：`export const createOrnament: CreateOrnament` */
export type CreateOrnament = (spec: OrnamentSpec, context: OrnamentContext) => OrnamentView;
/** mg/ambient.ts：`export const createAmbient: CreateAmbient` */
export type CreateAmbient = (options: AmbientOptions) => AmbientLayer;
