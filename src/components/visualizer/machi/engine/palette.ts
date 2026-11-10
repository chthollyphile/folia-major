import type { Theme } from '../../../../types';
import {
    adjustLightnessForContrast,
    getContrastRatio,
    getHueDistance,
    getRelativeLuminance,
    hexToHsl,
    hslToHex,
    mixHexColors,
    normalizeHue,
    type Hsl,
} from '../../../../utils/themeColorMath';
import { hashVisualizerSeed } from '../../visualizerSeedHash';

// src/components/visualizer/machi/engine/palette.ts
// 町景的调色板：主题色 → 场景各部分的颜色。底子（深蓝灰的夜、暖琥珀的灯）是固定的美术方向，主题只在限定的范围里
// 推它：品牌三色条、屏幕字、LED、霓虹、贩卖机、商品用主题色，天空和暖光只偏一点色相。这里是三个场景共用的部分
// （环境、地面、通用材质、主题色）；场景自己的颜色（便利店的墙、货架……）由场景的 resolveArt 给，放进 art。
// 纯函数，颜色都是 #rrggbb；运行时把它们插值到材质和灯上。

export interface MachiPalette {
    /** 夜里的天空、天光（半球光的天与地）、月光；黄昏（Dusk）与白天（Day）各一套，运行时按时间在三套之间插值。 */
    skyTop: string;
    skyBottom: string;
    fog: string;
    hemiSky: string;
    hemiGround: string;
    moon: string;
    skyTopDusk: string;
    skyBottomDusk: string;
    hemiSkyDusk: string;
    hemiGroundDusk: string;
    moonDusk: string;
    skyTopDay: string;
    skyBottomDay: string;
    hemiSkyDay: string;
    hemiGroundDay: string;
    moonDay: string;
    asphalt: string;
    roadPaint: string;
    concrete: string;
    curb: string;
    plinthTop: string;
    plinthMid: string;
    plinthLow: string;
    plinthTrim: string;
    glass: string;
    metal: string;
    darkMetal: string;
    pole: string;
    rubber: string;
    wire: string;
    caution: string;
    stopRed: string;
    /** 场景里的暖光（店内、营业房、提灯），向主题强调色偏一点。 */
    interiorLight: string;
    streetLight: string;
    vendingLight: string;
    /** 品牌三色条（主题的“连锁店”配色）。 */
    brand: [string, string, string];
    /** 招牌底色与招牌上的字。 */
    signBase: string;
    signText: string;
    /** 歌词屏：屏幕底色、未唱到的字、唱到的字；亮色主题是白底彩字的屏幕。 */
    boardBase: string;
    boardUnlit: string;
    boardLit: string;
    boardIsLight: boolean;
    led: string;
    neon: string;
    vendingBody: string;
    vendingAccent: string;
    /** 商品、饮料、小物件的实例色。 */
    products: string[];
    /** 场景自己的颜色（键由场景定）。 */
    art: Record<string, string>;
}

/** 场景自己的颜色：按主题、seed 和共用调色板推出来。 */
export type MachiArtResolver = (theme: Theme, seed: string | number, base: Omit<MachiPalette, 'art'>) => Record<string, string>;

/** 主题背景亮度高于它时按亮色主题处理（广告屏换成白底）。 */
export const MACHI_LIGHT_THEME_LUMINANCE = 0.4;
/** 广告屏上的字与底色的最低对比度。 */
export const MACHI_BOARD_MIN_CONTRAST = 4.5;
/** 低于这个饱和度的颜色算“没有颜色”（默认主题的强调色就是灰的）。 */
const CHROMATIC_SATURATION = 0.22;

/** 主题偏灰时按 seed 选一组：几种常见的便利店招牌配色。 */
const CLASSIC_BRAND_TRIADS: [string, string, string][] = [
    ['#f0781e', '#f4f1ea', '#1f9a52'],
    ['#2f6fd6', '#f4f1ea', '#58b8ea'],
    ['#1d9a63', '#f4f1ea', '#2d6cc0'],
    ['#e2402f', '#f4f1ea', '#f2b520'],
    ['#7a4fd0', '#f4f1ea', '#f07fae'],
];

const PRODUCT_FALLBACK = ['#e85d4a', '#f2c14e', '#4fa3d8', '#7ccf7a', '#f08cc0', '#f4f1ea', '#9b7be0', '#ff9d4d'];

const ART = {
    skyTop: '#0e1524',
    skyBottom: '#26324a',
    asphalt: '#2a303c',
    roadPaint: '#c9d1dc',
    concrete: '#4b5363',
    curb: '#5f6878',
    plinthTop: '#20242c',
    plinthMid: '#3d3a36',
    plinthLow: '#2b2622',
    plinthTrim: '#15171c',
    glass: '#9cc3e6',
    metal: '#8a94a1',
    darkMetal: '#383e49',
    pole: '#979ca4',
    rubber: '#1c1f26',
    wire: '#11141a',
    caution: '#e7b42e',
    stopRed: '#c7302b',
    hemiSky: '#3a4b6c',
    hemiGround: '#141923',
    moon: '#9cb3dc',
    skyTopDusk: '#2c2f5c',
    skyBottomDusk: '#e58a62',
    hemiSkyDusk: '#8b79a6',
    hemiGroundDusk: '#30262a',
    moonDusk: '#ffae78',
    skyTopDay: '#4d8bd4',
    skyBottomDay: '#cde4f2',
    hemiSkyDay: '#bcd6ee',
    hemiGroundDay: '#5f5b52',
    moonDay: '#fff0da',
    interiorLight: '#ffc887',
    streetLight: '#ffe4b8',
    vendingLight: '#d4ebff',
    gold: '#ffc861',
} as const;

const clampRange = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hslOf = (color: string | undefined, fallback: string): Hsl => (
    (color ? hexToHsl(color) : null) ?? hexToHsl(fallback)!
);

/** 有颜色的主题色：饱和度够的才算。 */
const isChromatic = (color: string | undefined) => {
    const hsl = color ? hexToHsl(color) : null;
    return !!hsl && hsl.s >= CHROMATIC_SATURATION && hsl.l > 0.08 && hsl.l < 0.94;
};

/** 招牌色：拉到够鲜、亮度在招牌能读的区间。 */
export const vivid = (color: string, minSaturation = 0.58, minLightness = 0.42, maxLightness = 0.62) => {
    const hsl = hslOf(color, ART.gold);
    return hslToHex({
        h: hsl.h,
        s: Math.max(minSaturation, hsl.s),
        l: clampRange(hsl.l, minLightness, maxLightness),
    });
};

/** 把 base 的色相向 toward 的色相拉 amount（0..1，按最短方向），饱和度、亮度不动。 */
const pullHue = (base: string, toward: string, amount: number) => {
    const from = hexToHsl(base)!;
    const to = hexToHsl(toward);
    if (!to || amount <= 0) return base;
    const distance = getHueDistance(from.h, to.h);
    const forward = normalizeHue(from.h + distance) === normalizeHue(to.h) ? 1 : -1;
    return hslToHex({ h: normalizeHue(from.h + forward * distance * amount), s: from.s, l: from.l });
};

/** 天空 / 路面这些暗色：向主题背景色相偏 ≤25%（背景越有颜色偏得越多），亮度不动。 */
const tintDark = (base: string, themeBackground: string) => {
    const background = hexToHsl(themeBackground);
    if (!background || background.s < 0.08) return base;
    return pullHue(base, themeBackground, Math.min(0.25, background.s * 0.45));
};

export const seedIndex = (seed: string | number, salt: string, length: number) => (
    hashVisualizerSeed(`${seed}:${salt}`) % length
);

/** 主题里有颜色的候选：强调色、关键词色、主色、次色，按这个顺序。 */
const chromaticCandidates = (theme: Theme) => [
    theme.accentColor,
    ...(theme.wordColors ?? []).map(entry => entry.color),
    theme.primaryColor,
    theme.secondaryColor,
].filter(isChromatic);

/** 店招三色条：有主题色时第一、三条用主题色（不够两个就把第一个转 150° 补上），中间一条是白；主题偏灰时按 seed 选经典配色。 */
const resolveBrand = (theme: Theme, seed: string | number): [string, string, string] => {
    const candidates = chromaticCandidates(theme);
    if (candidates.length === 0) {
        return CLASSIC_BRAND_TRIADS[seedIndex(seed, 'brand', CLASSIC_BRAND_TRIADS.length)]!;
    }
    const first = vivid(candidates[0]!);
    const firstHue = hexToHsl(first)!.h;
    const second = candidates.slice(1).find(color => getHueDistance(hexToHsl(color)!.h, firstHue) >= 40);
    const third = second
        ? vivid(second)
        : hslToHex({ ...hexToHsl(first)!, h: normalizeHue(firstHue + 150) });
    return [first, '#f4f1ea', third];
};

/** 广告屏的字：深色屏上是发光的强调色（偏灰时用金色），白底屏上是压暗到够对比的主题色。 */
const resolveBoard = (theme: Theme, brand: [string, string, string], isLight: boolean) => {
    const accent = isChromatic(theme.accentColor) ? theme.accentColor : brand[0];
    if (isLight) {
        const base = '#f3eee4';
        const lit = adjustLightnessForContrast(vivid(accent, 0.62, 0.3, 0.46), base, MACHI_BOARD_MIN_CONTRAST);
        return { base, unlit: '#9aa0ab', lit };
    }
    const base = mixHexColors('#0f1420', vivid(accent), 0.12);
    const glow = isChromatic(theme.accentColor) || isChromatic(brand[0])
        ? vivid(accent, 0.62, 0.64, 0.74)
        : ART.gold;
    const lit = adjustLightnessForContrast(glow, base, MACHI_BOARD_MIN_CONTRAST);
    return { base, unlit: '#6c7384', lit };
};

/** 商品色：先放主题的关键词色和招牌色，不够用经典的糖果色补齐 8 个。 */
const resolveProducts = (theme: Theme, brand: [string, string, string], seed: string | number) => {
    const keywordColors = (theme.wordColors ?? []).map(entry => entry.color).filter(isChromatic).map(color => vivid(color, 0.45, 0.45, 0.7));
    const pool = [...keywordColors, brand[0], brand[2], ...PRODUCT_FALLBACK];
    const offset = seedIndex(seed, 'products', PRODUCT_FALLBACK.length);
    return Array.from({ length: 8 }, (_, index) => pool[index < keywordColors.length + 2 ? index : keywordColors.length + 2 + ((index + offset) % PRODUCT_FALLBACK.length)]!);
};

/** 主题 → 町景调色板。同样的主题、seed 与场景总得到同样的结果。 */
export const resolveMachiPalette = (theme: Theme, seed: string | number, resolveArt?: MachiArtResolver): MachiPalette => {
    const background = theme.backgroundColor;
    const isLight = getRelativeLuminance(background) > MACHI_LIGHT_THEME_LUMINANCE;
    const brand = resolveBrand(theme, seed);
    const board = resolveBoard(theme, brand, isLight);
    const accent = isChromatic(theme.accentColor) ? theme.accentColor : brand[0];
    const skyTop = tintDark(ART.skyTop, background);
    const skyBottom = tintDark(ART.skyBottom, background);
    // 暖光：向强调色偏一点，但保持暖、保持亮。
    const interiorHsl = hexToHsl(mixHexColors(ART.interiorLight, vivid(accent), 0.16))!;
    const interiorLight = hslToHex({ ...interiorHsl, l: Math.max(0.72, interiorHsl.l) });
    const signText = getContrastRatio('#1b1f27', brand[1]) >= MACHI_BOARD_MIN_CONTRAST ? '#1b1f27' : '#ffffff';

    const base: Omit<MachiPalette, 'art'> = {
        skyTop,
        skyBottom,
        fog: skyBottom,
        hemiSky: tintDark(ART.hemiSky, background),
        hemiGround: ART.hemiGround,
        moon: ART.moon,
        skyTopDusk: tintDark(ART.skyTopDusk, background),
        skyBottomDusk: ART.skyBottomDusk,
        hemiSkyDusk: ART.hemiSkyDusk,
        hemiGroundDusk: ART.hemiGroundDusk,
        moonDusk: ART.moonDusk,
        skyTopDay: tintDark(ART.skyTopDay, background),
        skyBottomDay: ART.skyBottomDay,
        hemiSkyDay: ART.hemiSkyDay,
        hemiGroundDay: ART.hemiGroundDay,
        moonDay: ART.moonDay,
        asphalt: tintDark(ART.asphalt, background),
        roadPaint: ART.roadPaint,
        concrete: tintDark(ART.concrete, background),
        curb: ART.curb,
        plinthTop: ART.plinthTop,
        plinthMid: ART.plinthMid,
        plinthLow: ART.plinthLow,
        plinthTrim: ART.plinthTrim,
        glass: ART.glass,
        metal: ART.metal,
        darkMetal: ART.darkMetal,
        pole: ART.pole,
        rubber: ART.rubber,
        wire: ART.wire,
        caution: ART.caution,
        stopRed: ART.stopRed,
        interiorLight,
        streetLight: ART.streetLight,
        vendingLight: ART.vendingLight,
        brand,
        signBase: brand[1],
        signText,
        boardBase: board.base,
        boardUnlit: board.unlit,
        boardLit: board.lit,
        boardIsLight: isLight,
        led: vivid(accent, 0.85, 0.58, 0.66),
        neon: vivid(accent, 0.75, 0.6, 0.7),
        vendingBody: hslToHex({ ...hexToHsl(brand[2])!, s: Math.min(0.62, Math.max(0.35, hexToHsl(brand[2])!.s)), l: 0.42 }),
        vendingAccent: vivid(brand[0], 0.6, 0.48, 0.6),
        products: resolveProducts(theme, brand, seed),
    };
    return { ...base, art: resolveArt ? resolveArt(theme, seed, base) : {} };
};
