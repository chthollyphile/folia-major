import type { LyricRenderOverride } from '../../../types';
import type { MotionValue } from 'framer-motion';
import type { Line } from '../../../types';

// src/components/visualizer/nebbia/types.ts
// 雾笺的 tuning：歌词怎么出现在雾上、写完怎么消失，雾和窗外的几项，聚光灯、雨点和颠簸的强弱。
// 原型（dev/prototypes/fog-write）里的其余参数在这里写死成常量（nebbiaConstants.ts）。文件末尾是运行时的输入类型。

/**
 * 字怎么出现，打开的几种都会用到：手指一笔一笔写、整个字从雾里慢慢透出来、先哈一口气再在白气上写（nebbiaBreath.ts）。
 * 书写的两种开着几种就每句随机挑一种；慢慢显现和书写的一起开时，只用在来不及写完的句子上（nebbiaScene.ts 的 applyAppear）。
 */
export const NEBBIA_APPEAR_STYLES = ['write', 'fade', 'breath'] as const;
export type NebbiaAppearStyle = typeof NEBBIA_APPEAR_STYLES[number];

/** 写完怎么消失：慢慢起雾、两根手指来回搓掉；两种都开就每句随机。 */
export const NEBBIA_FADE_STYLES = ['fog', 'fingers'] as const;
export type NebbiaFadeStyle = typeof NEBBIA_FADE_STYLES[number];

/** 一句的构图（nebbiaCompositions.ts）：横条、两行错落、三行错落、十字、竖柱、刊头、徽章、竖排几列、环绕。 */
export const NEBBIA_LAYOUTS = ['ribbon', 'lines2', 'lines3', 'cross', 'pillar', 'header', 'badge', 'columns', 'orbit'] as const;
export type NebbiaLayout = typeof NEBBIA_LAYOUTS[number];

/** 窗外画哪几样（每样一个开关，可以全关）：聚光灯、楼群、霓虹路灯招牌的光斑、车灯、湿路面和倒影。 */
export const NEBBIA_SCENERY = ['spot', 'buildings', 'lights', 'cars', 'road'] as const;
export type NebbiaSceneryPart = typeof NEBBIA_SCENERY[number];

/** 窗外的雨：跟着车速斜着落、竖直落、不下。 */
export const NEBBIA_RAIN = ['slant', 'straight', 'off'] as const;
export type NebbiaRain = typeof NEBBIA_RAIN[number];

/**
 * 窗外是什么：雾笺自己画的雨夜街景、水族箱，或者共用背景（雾变成一层半透明的雾、日白夜深，擦开的字透出后面；透明模式下就是桌面）。
 */
export const NEBBIA_BEHIND = ['night', 'aquarium', 'backdrop'] as const;
export type NebbiaBehind = typeof NEBBIA_BEHIND[number];
/**
 * 前面的雾玻璃上挂的水，和窗外是什么分开选：雨窗（大大小小的凝结水珠、雨点打窗）、凝露（一层很密的细小冷凝水珠慢慢渗出来，
 * nebbiaCondensation.ts）、雪窗（雪花打在玻璃上粘住、慢慢化成水珠，写字的手指经过时把雪抹开，nebbiaSnow.ts；街景窗外不下雨）。
 * 换窗外不动玻璃；没存过玻璃的旧 tuning 读时按窗外搭配（NEBBIA_GLASS_FOR）。
 */
export const NEBBIA_GLASS = ['rain', 'dew', 'snow'] as const;
export type NebbiaGlass = typeof NEBBIA_GLASS[number];
/** 窗外的默认搭配（只给没存过玻璃的旧 tuning 用）：雨夜街景配雨窗、水族箱配凝露；共用背景不换。 */
export const NEBBIA_GLASS_FOR: Partial<Record<NebbiaBehind, NebbiaGlass>> = { night: 'rain', aquarium: 'dew' };
/** 雾笺自己画的窗外场景（着色器按它编，nebbiaShaders.ts）：选了共用背景时水珠里折射的还是街景；透明时选了水族箱就折射水族箱。 */
export type NebbiaWindowScene = 'night' | 'aquarium';
/** 水族箱里最多几只水母（着色器里 uniform 数组的长度）。 */
export const NEBBIA_MAX_JELLIES = 24;
/** 着色器里跟拍冒泡最多同时几排（nebbiaBubbleGlsl.ts 的 uBurst）。 */
export const NEBBIA_MAX_BURSTS = 12;

export interface NebbiaTuning {
    /** 分辨率与抗锯齿（#929）：默认跟随「动画与性能」里的全局挡位（utils/lyricRenderQuality.ts）。 */
    render: LyricRenderOverride;
    /** 打开的出现方式，至少一种。 */
    appear: NebbiaAppearStyle[];
    /** 打开的消失方式，至少一种。 */
    fade: NebbiaFadeStyle[];
    /** 打开的构图，至少一种。 */
    layouts: NebbiaLayout[];
    /** 窗外是街景、水族箱还是共用背景；播放页透明时总是共用背景（那时背景卸掉，透出桌面）。 */
    behind: NebbiaBehind;
    /** 前面雾玻璃上的水：雨窗还是凝露。着色器按它编，换了要重建运行时。 */
    glass: NebbiaGlass;
    /** 窗外打开的几样，可以一样都没有。 */
    scenery: NebbiaSceneryPart[];
    /** 窗外的雨。 */
    rain: NebbiaRain;
    /** 最后一句唱完后在玻璃上写出曲名和歌手（nebbiaCredits.ts）。 */
    credits: boolean;
    /** 手写歪斜：整字转动、上下错落、整行倾斜。 */
    jitter: number;
    /** 手写变形：字形斜切胖瘦、笔画长短偏移、手抖。 */
    warp: number;
    /** 雾气浓度。 */
    mist: number;
    /** 下一句开始后，写好的字再保持几秒才起雾。 */
    hold: number;
    /** 重新起雾用几秒。 */
    refog: number;
    /** 笔画粗细（× 字号）。 */
    strokeWidth: number;
    /** 书写速度（× 自然书写速度）。 */
    writeSpeed: number;
    /** 句尾顺手画一个主题图标的概率。 */
    doodle: number;
    /** 车速：窗外移动的快慢，0 是停站。 */
    busSpeed: number;
    /** 主题色霓虹的亮度。 */
    neon: number;
    /** 聚光灯强度，0 关。 */
    spot: number;
    /** 聚光灯光源的横向位置（× 屏宽），另一盏在左右对称的位置。 */
    spotX: number;
    /** 雨点打在玻璃上的密度，0 关。 */
    rainHit: number;
    /** 吐字时砸下的大雨点大小，0 不砸。 */
    rainBig: number;
    /** 颠簸强度，0 关。 */
    bump: number;
    /** 渲染分辨率（× CSS 像素，最高 2 倍设备像素比）。 */
    /** 水族箱里几只水母。 */
    jellies: number;
    /** 水母大小（× 默认）。 */
    jellySize: number;
    /** 水族箱的气泡多少：冒泡的泉眼和大泡的多少。 */
    bubbles: number;
    /** 凝露玻璃的冷凝水珠：多少（× 默认，0 没有）、大小（× 默认）、高光（× 默认）。 */
    dew: number;
    dewSize: number;
    dewGlint: number;
    /** 雪窗：打到玻璃上的雪多少（× 默认，0 没有）、雪花大小（× 默认）、化得多快（× 默认）。 */
    snow: number;
    snowSize: number;
    snowMelt: number;
}

/** 各个数值项的范围：设置面板的滑块和归一化共用。 */
export const NEBBIA_LIMITS = {
    jitter: { min: 0, max: 1.5 },
    warp: { min: 0, max: 1.5 },
    mist: { min: 0.2, max: 1 },
    hold: { min: 0, max: 6 },
    refog: { min: 0.5, max: 12 },
    strokeWidth: { min: 0.04, max: 0.16 },
    writeSpeed: { min: 0.4, max: 2.5 },
    doodle: { min: 0, max: 1 },
    busSpeed: { min: 0, max: 3 },
    neon: { min: 0, max: 2 },
    spot: { min: 0, max: 2 },
    spotX: { min: 0, max: 1 },
    rainHit: { min: 0, max: 3 },
    rainBig: { min: 0, max: 2 },
    bump: { min: 0, max: 2.5 },
    jellies: { min: 0, max: NEBBIA_MAX_JELLIES },
    jellySize: { min: 0.5, max: 1.8 },
    bubbles: { min: 0, max: 1 },
    dew: { min: 0, max: 1.5 },
    dewSize: { min: 0.5, max: 2 },
    dewGlint: { min: 0, max: 2 },
    snow: { min: 0, max: 3 },
    snowSize: { min: 0.5, max: 2 },
    snowMelt: { min: 0.25, max: 3 },
} as const satisfies Partial<Record<keyof NebbiaTuning, { min: number; max: number }>>;

export type NebbiaNumberKey = keyof typeof NEBBIA_LIMITS;

export const DEFAULT_NEBBIA_TUNING: NebbiaTuning = {
    render: { scale: 'global', antialias: 'global' },
    appear: ['write', 'fade'],
    fade: ['fog'],
    layouts: [...NEBBIA_LAYOUTS],
    behind: 'night',
    glass: 'rain',
    scenery: [...NEBBIA_SCENERY],
    rain: 'slant',
    credits: true,
    jitter: 0.6,
    warp: 0.6,
    mist: 0.75,
    hold: 1.2,
    refog: 4,
    strokeWidth: 0.09,
    writeSpeed: 1,
    doodle: 0.3,
    busSpeed: 1,
    neon: 1,
    spot: 0.5,
    spotX: 0.8,
    rainHit: 1,
    rainBig: 1,
    bump: 1,
    jellies: 16,
    jellySize: 1,
    bubbles: 0.6,
    dew: 1,
    dewSize: 1,
    dewGlint: 1,
    snow: 1,
    snowSize: 1,
    snowMelt: 1,
};

/** 运行时（createNebbiaRuntime.ts）的歌：歌词、随机种子，片尾写的曲名和歌手。 */
export interface NebbiaSong { lines: Line[]; seed: string | number; title?: string | null; artist?: string | null }
/** React 外壳交给运行时的宿主、两个每帧读的 MotionValue 和回调。 */
export interface NebbiaRuntimeInput {
    host: HTMLElement;
    /** 窗外不画，画布带透明通道：雾是半透明的（颜色跟主题日夜），擦开的地方全透明。建好就不变，要换得重建运行时。 */
    seeThrough: boolean;
    /** 窗外画哪套场景（透出后面时水珠里折射的那套）。着色器按它编，建好就不变，要换得重建运行时。 */
    scene: NebbiaWindowScene;
    /** 前面雾玻璃上的水（tuning.glass）。着色器按它编，建好就不变，要换得重建运行时。 */
    glass: NebbiaGlass;
    currentTime: MotionValue<number>;
    vocal: MotionValue<number>;
    onFirstFrame: () => void;
    onFailed: () => void;
    /** WebGL 上下文丢了又回来：外壳重建一个运行时。 */
    onRestored: () => void;
}
