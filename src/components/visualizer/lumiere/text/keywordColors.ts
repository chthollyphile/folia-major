// Copyright (c) 2026 chthollyphile
import type { Theme } from '../../../../types';
import { splitLyricGraphemes } from '../../../../utils/lyrics/graphemeTiming';
import { parseColorChannels } from '../../../../utils/colorMix';
import {
    buildWordColorRangesFromMatchers,
    prepareWordColorMatchers,
    resolveTokenColorMap,
    type WordColorMatcher,
} from '../../wordColoring';
import { hexOf, mixRgb, scaleRgb, WHITE, type Rgb } from '../color';

// src/components/visualizer/lumiere/text/keywordColors.ts
// 绘光的关键字着色：关键字与颜色是主题的 wordColors，匹配走 folia 共用的 wordColoring（中日韩按短语包含、
// 英文按词，按字符区间落到字上，所以「花火」不会染到「火车」的「火」）。每行只在构建时匹配一次，得到逐字
// （grapheme）的关键字色；逐帧只做与光色的混合。
//
// 混合：关键字色与光色按比例混合，再把最亮的通道拉回光色的亮度——字仍是「被光照亮」的样子，只是带上了
// 关键字的色相；暗色的关键字（浅色主题常见）不会变成一块灰。未点亮的字保持冷色，不参与。

/** 各处关键字色的占比（其余是光色）：字身、光晕、闪点、十字爆闪、背景碎片。 */
export const KEYWORD_MIX = {
    glyph: 0.6,
    halo: 0.75,
    star: 0.55,
    burst: 0.7,
    echo: 0.3,
} as const;
/** 闪点在关键字光色之上再掺多少白（普通字是 0.5）：闪光带色，但仍是一颗亮星。 */
export const KEYWORD_STAR_WHITE = 0.35;
/** 关键字的光晕比普通字亮一点，颜色才看得出来。 */
export const KEYWORD_HALO_GAIN = 1.25;

export const prepareLumiereKeywords = (
    wordColors: Theme['wordColors'],
    enabled: boolean,
): WordColorMatcher[] => prepareWordColorMatchers(wordColors, enabled);

const parseRgb = (color: string): Rgb | null => {
    const channels = parseColorChannels(color);
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : null;
};

/**
 * 一行文字逐字（splitLyricGraphemes 的切法，与字形条一致）的关键字色；不是关键字的字为 null。
 * 没有匹配器或没有匹配时返回全 null 的数组。
 */
export const resolveGlyphKeywordColors = (text: string, matchers: readonly WordColorMatcher[]): Array<Rgb | null> => {
    const graphemes = splitLyricGraphemes(text);
    const colors: Array<Rgb | null> = graphemes.map(() => null);
    if (matchers.length === 0 || graphemes.length === 0) return colors;
    const ranges = buildWordColorRangesFromMatchers(text, [...matchers]);
    if (ranges.length === 0) return colors;
    let offset = 0;
    const tokens = graphemes.map((grapheme, index) => {
        const token = { key: String(index), timed: grapheme.trim().length > 0, startOffset: offset, endOffset: offset + grapheme.length };
        offset += grapheme.length;
        return token;
    });
    // 同一个颜色只解析一次，一行里重复出现的关键字共用同一个数组。
    const parsed = new Map<string, Rgb | null>();
    resolveTokenColorMap(tokens, ranges).forEach((hex, key) => {
        if (!parsed.has(hex)) parsed.set(hex, parseRgb(hex));
        colors[Number(key)] = parsed.get(hex) ?? null;
    });
    return colors;
};

/**
 * 关键字色与光色按 amount 混合，最亮的通道拉回光色的亮度（保持发光观感）。关键字色先提到满亮度再混——
 * 只取它的色相与饱和度，不取明暗：浅色主题里常见的深蓝、深红照样能在光里读出颜色，不会被光色冲成白。
 */
export const keywordLight = (light: Rgb, keyword: Rgb, amount: number): Rgb => {
    const keywordPeak = Math.max(keyword[0], keyword[1], keyword[2]);
    const hue: Rgb = keywordPeak > 1e-4 ? scaleRgb(keyword, 1 / keywordPeak) : WHITE;
    const mixed = mixRgb(light, hue, amount);
    const peak = Math.max(mixed[0], mixed[1], mixed[2]);
    const target = Math.max(light[0], light[1], light[2]);
    return peak > 1e-4 ? scaleRgb(mixed, target / peak) : light;
};

/** 一个关键字在某个光色下的几种颜色（字身、光晕、闪点），按光色缓存，逐帧直接取。 */
export interface KeywordTints {
    glyph: Rgb;
    halo: number;
    star: number;
}

export const keywordTints = (light: Rgb, keyword: Rgb): KeywordTints => ({
    glyph: keywordLight(light, keyword, KEYWORD_MIX.glyph),
    halo: hexOf(keywordLight(light, keyword, KEYWORD_MIX.halo)),
    star: hexOf(mixRgb(keywordLight(light, keyword, KEYWORD_MIX.star), WHITE, KEYWORD_STAR_WHITE)),
});

/** 十字爆闪落在关键字上：以关键字光色为主，保留一点光位的 tint。 */
export const keywordBurstColor = (burstColor: Rgb, light: Rgb, keyword: Rgb): Rgb => (
    mixRgb(burstColor, keywordLight(light, keyword, KEYWORD_MIX.burst), 0.8)
);

/** 背景碎片里的关键字：只带一点色。 */
export const keywordEchoColor = (light: Rgb, keyword: Rgb): Rgb => keywordLight(light, keyword, KEYWORD_MIX.echo);
