import type { Theme } from '../../../types';
import { parseColorChannels } from '../colorMix';

// src/components/visualizer/metaphor/metaphorPalette.ts
// 隐喻的配色（纯函数）：主题 → 纸、墨、强调色、网点四个颜色（0..1 的 sRGB，着色器里直接混）。
// 纸是主题的背景色，墨是主色（「画面反相」开着时两个对调，网点和强调色跟着新的纸重新算）；网点用次色，和纸太接近时往墨那边拉，免得网点看不见；强调色和纸分不开时同样处理，和墨分不开时换成一档灰。

export type MetaphorRgb = [number, number, number];

export interface MetaphorPalette {
    paper: MetaphorRgb;
    ink: MetaphorRgb;
    accent: MetaphorRgb;
    tone: MetaphorRgb;
}

const FALLBACK: MetaphorPalette = { paper: [0.06, 0.06, 0.07], ink: [0.95, 0.94, 0.9], accent: [0.9, 0.3, 0.2], tone: [0.5, 0.5, 0.52] };

const read = (color: string, fallback: MetaphorRgb): MetaphorRgb => {
    const channels = parseColorChannels(color);
    return channels ? [channels.r / 255, channels.g / 255, channels.b / 255] : fallback;
};

const luma = (color: MetaphorRgb) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
const mix = (from: MetaphorRgb, to: MetaphorRgb, amount: number): MetaphorRgb => [
    from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount,
];
const distance = (a: MetaphorRgb, b: MetaphorRgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 往墨那边拉，直到和纸拉开 min 这么远（最多拉到七成）。 */
const awayFromPaper = (color: MetaphorRgb, paper: MetaphorRgb, ink: MetaphorRgb, min: number): MetaphorRgb => {
    let out = color;
    for (let amount = 0.2; distance(out, paper) < min && amount <= 0.7; amount += 0.1) out = mix(color, ink, amount);
    return out;
};

/** 关键字的颜色：和纸分不开时往墨那边拉，读不出来的颜色（坏的色值）用强调色。 */
export const resolveMetaphorKeywordColor = (color: string, palette: MetaphorPalette): MetaphorRgb => {
    const channels = parseColorChannels(color);
    if (!channels) return palette.accent;
    return awayFromPaper([channels.r / 255, channels.g / 255, channels.b / 255], palette.paper, palette.ink, 0.25);
};

export const resolveMetaphorPalette = (theme: Theme, flip = false): MetaphorPalette => {
    let paper = read(theme.backgroundColor, FALLBACK.paper);
    let ink = read(theme.primaryColor, FALLBACK.ink);
    // 主色和背景分不开（坏主题）：墨换成纸的反面
    if (Math.abs(luma(ink) - luma(paper)) < 0.18) ink = luma(paper) > 0.5 ? [0.08, 0.08, 0.09] : [0.95, 0.94, 0.9];
    if (flip) [paper, ink] = [ink, paper];
    const tone = awayFromPaper(read(theme.secondaryColor, FALLBACK.tone), paper, ink, 0.22);
    let accent = awayFromPaper(read(theme.accentColor, FALLBACK.accent), paper, ink, 0.25);
    // 强调色和墨是同一个颜色（默认主题就是）：压在字上的融球会和字糊成一片，换成纸墨之间的一档灰
    if (distance(accent, ink) < 0.25) accent = mix(paper, ink, 0.42);
    return { paper, ink, accent, tone };
};
