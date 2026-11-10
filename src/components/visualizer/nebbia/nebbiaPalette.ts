import type { Theme } from '../../../types';
import { parseColorChannels } from '../colorMix';

// src/components/visualizer/nebbia/nebbiaPalette.ts
// 主题 → 窗外的夜景配色：天色两档（主题背景压成夜里的深色），三个灯光色（强调色打头，是聚光灯和霓虹的颜色；
// 另外两个取主题里够鲜艳的颜色，不够就把强调色转色相补上）。都是 0..1 的 RGB。

type Rgb = [number, number, number];
export interface NebbiaPalette { sky0: Rgb; sky1: Rgb; la: Rgb; lb: Rgb; lc: Rgb }

const rgbOf = (color: string | undefined, fallback: Rgb): Rgb => {
    const c = color ? parseColorChannels(color) : null;
    return c ? [c.r / 255, c.g / 255, c.b / 255] : fallback;
};

const toHsl = ([r, g, b]: Rgb): Rgb => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
};
const fromHsl = ([h, s, l]: Rgb): Rgb => {
    const k = (n: number) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
};

// 灯要亮、要有颜色：饱和度和亮度都抬到夜景里看得见的范围
const asLight = (rgb: Rgb): Rgb => {
    const [h, s, l] = toHsl(rgb);
    return fromHsl([h, Math.max(0.55, s), Math.min(0.78, Math.max(0.6, l))]);
};
const asSky = (rgb: Rgb, lightness: number): Rgb => {
    const [h, s] = toHsl(rgb);
    return fromHsl([h, Math.min(0.55, s), lightness]);
};

export const resolveNebbiaPalette = (theme: Theme): NebbiaPalette => {
    const accent = rgbOf(theme.accentColor, [1, 0.81, 0.54]);
    const bg = rgbOf(theme.backgroundColor, [0.04, 0.06, 0.09]);
    const vivid = [theme.secondaryColor, theme.primaryColor, ...(theme.wordColors ?? []).map(w => w.color)]
        .map(c => rgbOf(c, [0, 0, 0]))
        .filter(c => toHsl(c)[1] > 0.3 && toHsl(c)[2] > 0.25 && toHsl(c)[2] < 0.9);
    const [ah, as, al] = toHsl(accent);
    const lb = vivid[0] ?? fromHsl([(ah + 0.55) % 1, as, al]);
    const lc = vivid[1] ?? fromHsl([(ah + 0.9) % 1, as, al]);
    return {
        sky0: asSky(bg, 0.05),
        sky1: asSky(bg.map((v, i) => v * 0.7 + accent[i] * 0.3) as Rgb, 0.14),
        la: asLight(accent),
        lb: asLight(lb),
        lc: asLight(lc),
    };
};
