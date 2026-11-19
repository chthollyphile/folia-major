import { parseColorChannels } from './colorMix';
import { fitOklchToSrgb, oklabDistance, oklabToSrgb, oklchToOklab, srgbToOklab, srgbToOklch, type Oklch } from './oklab';

// src/utils/themeColorMath.ts
// Hex-space color math for theme generation: RGB/HSL conversion, WCAG luminance and contrast,
// plus a lightness solver that keeps a generated color's hue while forcing it past a contrast
// floor (instead of swapping in a hard-coded fallback color).

export type Rgb = { r: number; g: number; b: number; };
export type Hsl = { h: number; s: number; l: number; };

const FALLBACK_THEME_COLOR = '#4f7cff';

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export const normalizeHue = (hue: number) => ((hue % 360) + 360) % 360;

export const parseThemeColor = (value: string): Rgb | null => {
    const channels = typeof value === 'string' ? parseColorChannels(value) : null;
    if (!channels) {
        return null;
    }

    return {
        r: clampChannel(channels.r),
        g: clampChannel(channels.g),
        b: clampChannel(channels.b),
    };
};

export const rgbToHex = ({ r, g, b }: Rgb) => (
    `#${[r, g, b].map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`
);

export const rgbToHsl = ({ r, g, b }: Rgb): Hsl => {
    const red = clampChannel(r) / 255;
    const green = clampChannel(g) / 255;
    const blue = clampChannel(b) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    const lightness = (max + min) / 2;

    if (delta === 0) {
        return { h: 0, s: 0, l: lightness };
    }

    const saturation = delta / (1 - Math.abs(2 * lightness - 1));

    let hue: number;
    if (max === red) {
        hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
        hue = (blue - red) / delta + 2;
    } else {
        hue = (red - green) / delta + 4;
    }

    return { h: normalizeHue(hue * 60), s: clamp01(saturation), l: clamp01(lightness) };
};

export const hslToRgb = ({ h, s, l }: Hsl): Rgb => {
    const hue = normalizeHue(h);
    const saturation = clamp01(s);
    const lightness = clamp01(l);

    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const offset = lightness - chroma / 2;

    const sector = Math.floor(hue / 60) % 6;
    const [r, g, b] = sector === 0 ? [chroma, secondary, 0]
        : sector === 1 ? [secondary, chroma, 0]
            : sector === 2 ? [0, chroma, secondary]
                : sector === 3 ? [0, secondary, chroma]
                    : sector === 4 ? [secondary, 0, chroma]
                        : [chroma, 0, secondary];

    return {
        r: clampChannel((r + offset) * 255),
        g: clampChannel((g + offset) * 255),
        b: clampChannel((b + offset) * 255),
    };
};

export const hexToHsl = (color: string): Hsl | null => {
    const parsed = parseThemeColor(color);
    return parsed ? rgbToHsl(parsed) : null;
};

export const hslToHex = (hsl: Hsl) => rgbToHex(hslToRgb(hsl));

// Linear RGB blend that stays in hex space; Theme color fields only accept hex.
export const mixHexColors = (from: string, to: string, amount: number) => {
    const start = parseThemeColor(from);
    const end = parseThemeColor(to);

    if (!start || !end) {
        return rgbToHex(parseThemeColor(to) || parseThemeColor(from) || parseThemeColor(FALLBACK_THEME_COLOR)!);
    }

    const ratio = clamp01(amount);
    return rgbToHex({
        r: start.r + (end.r - start.r) * ratio,
        g: start.g + (end.g - start.g) * ratio,
        b: start.b + (end.b - start.b) * ratio,
    });
};

export const getRelativeLuminance = (color: string) => {
    const parsed = parseThemeColor(color);
    if (!parsed) return 0;

    const transform = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * transform(parsed.r) + 0.7152 * transform(parsed.g) + 0.0722 * transform(parsed.b);
};

export const getContrastRatio = (foreground: string, background: string) => {
    const luminanceA = getRelativeLuminance(foreground);
    const luminanceB = getRelativeLuminance(background);
    const [lighter, darker] = luminanceA > luminanceB
        ? [luminanceA, luminanceB]
        : [luminanceB, luminanceA];

    return (lighter + 0.05) / (darker + 0.05);
};

export const getHueDistance = (a: number, b: number) => {
    const distance = Math.abs(normalizeHue(a) - normalizeHue(b));
    return Math.min(distance, 360 - distance);
};

// Walks the color's lightness away from the background until the contrast floor is met, keeping
// hue and saturation intact. Returns the best-contrast candidate when the floor is unreachable.
export const adjustLightnessForContrast = (
    color: string,
    background: string,
    minRatio: number,
    step = 0.02,
    maxSteps = 50,
) => {
    const hsl = hexToHsl(color);
    if (!hsl) {
        return color;
    }

    const goDarker = getRelativeLuminance(background) > 0.35;
    const direction = goDarker ? -1 : 1;

    let bestColor = hslToHex(hsl);
    let bestRatio = getContrastRatio(bestColor, background);

    for (let index = 0; index <= maxSteps; index += 1) {
        const lightness = clamp01(hsl.l + direction * step * index);
        const candidate = hslToHex({ ...hsl, l: lightness });
        const ratio = getContrastRatio(candidate, background);

        if (ratio > bestRatio) {
            bestRatio = ratio;
            bestColor = candidate;
        }

        if (ratio >= minRatio) {
            return candidate;
        }

        // Already clamped at an end of the lightness axis: no further step can help.
        if (index > 0 && (lightness === 0 || lightness === 1)) {
            break;
        }
    }

    return bestColor;
};

export const hexToOklch = (color: string): Oklch | null => {
    const parsed = parseThemeColor(color);
    return parsed ? srgbToOklch(parsed) : null;
};

/** Perceptual distance (ΔE in OKLab) between two theme colours; Infinity when one does not parse. */
export const getOklabDistance = (from: string, to: string) => {
    const start = parseThemeColor(from);
    const end = parseThemeColor(to);
    return start && end ? oklabDistance(srgbToOklab(start), srgbToOklab(end)) : Infinity;
};

/** Hex for an OKLCH colour; chroma sRGB cannot show is lowered (hue and lightness kept). */
export const oklchToHex = (color: Oklch) => rgbToHex(oklabToSrgb(oklchToOklab(fitOklchToSrgb(color))));

// The OKLCH counterpart of adjustLightnessForContrast: walks perceptual lightness away from the
// background, re-fitting chroma to sRGB at every step, so a yellow pushed darker for contrast
// keeps reading as the same hue at the same strength instead of sliding into olive.
export const adjustOklchLightnessForContrast = (
    color: Oklch,
    background: string,
    minRatio: number,
    step = 0.01,
    maxSteps = 100,
) => {
    const direction = getRelativeLuminance(background) > 0.35 ? -1 : 1;

    let bestColor = oklchToHex(color);
    let bestRatio = getContrastRatio(bestColor, background);

    for (let index = 0; index <= maxSteps; index += 1) {
        const lightness = clamp01(color.L + direction * step * index);
        const candidate = oklchToHex({ ...color, L: lightness });
        const ratio = getContrastRatio(candidate, background);

        if (ratio > bestRatio) {
            bestRatio = ratio;
            bestColor = candidate;
        }

        if (ratio >= minRatio) {
            return candidate;
        }

        if (index > 0 && (lightness === 0 || lightness === 1)) {
            break;
        }
    }

    return bestColor;
};
