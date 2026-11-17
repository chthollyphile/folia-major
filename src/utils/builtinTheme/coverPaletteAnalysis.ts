import { getHueDistance, hexToHsl, hexToOklch, hslToHex, normalizeHue, type Hsl } from '../themeColorMath';

// src/utils/builtinTheme/coverPaletteAnalysis.ts
// Reads the cover's extracted colors and decides the color skeleton of a built-in theme: which
// hue leads, which hue accents it, and how saturated/deep the backgrounds should read.

export type HarmonyScheme = 'analogous' | 'complementary' | 'split' | 'triadic' | 'duotone' | 'monochrome';
export type PaletteTone = 'ink' | 'tinted' | 'rich';

export type CoverPalette = {
    baseHue: number;
    baseSaturation: number;
    baseLightness: number;
    /** OKLCH chroma of the base colour: how vivid the cover really is, read perceptually. */
    baseChroma: number;
    accentHue: number;
    scheme: HarmonyScheme;
    tone: PaletteTone;
};

// OKLCH chroma a second colour needs to count as a hue of its own (HSL saturation is no use here:
// a near-black navy reads as highly "saturated" in HSL).
const MIN_SUPPORT_CHROMA = 0.035;
const MIN_SUPPORT_HUE_DISTANCE = 25;
const MAX_SUPPORT_HUE_DISTANCE = 160;
const MONOCHROME_SATURATION_CEILING = 0.18;
const DUOTONE_CHANCE = 0.8;

type CoverColor = Hsl & { chroma: number; };

// Prefers colors that are both vivid (OKLCH chroma) and mid-lightness: those carry the cover's
// identity, while near-black / near-white pixels only describe its background.
const getCoverColorScore = ({ chroma, l }: CoverColor) => chroma * Math.max(0, 1 - Math.abs(l - 0.5) * 1.2);

const pickWeighted = <T,>(random: () => number, entries: { value: T; weight: number; }[]): T => {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = random() * total;

    for (const entry of entries) {
        cursor -= entry.weight;
        if (cursor <= 0) {
            return entry.value;
        }
    }

    return entries[entries.length - 1].value;
};

const readCoverColor = (color: string): CoverColor | null => {
    const hsl = hexToHsl(color);
    const oklch = hexToOklch(color);
    return hsl && oklch ? { ...hsl, chroma: oklch.C } : null;
};

// The extractor already ranks colours by area and vividness, so the first colour that is not a
// plain grey leads; only an all-grey cover falls back to its first (highest-ranked) grey.
const pickBaseColor = (parsedColors: CoverColor[], random: () => number): CoverColor => {
    if (parsedColors.length === 0) {
        // No cover to read: pick a hue outright so a coverless song still varies run to run.
        const hsl = { h: random() * 360, s: 0.35 + random() * 0.3, l: 0.5 };
        return { ...hsl, chroma: hexToOklch(hslToHex(hsl))?.C ?? 0.1 };
    }

    return parsedColors.find(candidate => getCoverColorScore(candidate) > 0.012) ?? parsedColors[0];
};

const pickSupportHue = (parsedColors: CoverColor[], base: CoverColor) => {
    const support = parsedColors.find(candidate => {
        if (candidate === base || candidate.chroma < MIN_SUPPORT_CHROMA) return false;
        const distance = getHueDistance(candidate.h, base.h);
        return distance >= MIN_SUPPORT_HUE_DISTANCE && distance <= MAX_SUPPORT_HUE_DISTANCE;
    });

    return support ? support.h : null;
};

const pickScheme = (
    baseSaturation: number,
    supportHue: number | null,
    random: () => number,
): HarmonyScheme => {
    // A real second hue on the cover is the most "from this artwork" accent available.
    if (supportHue !== null && random() < DUOTONE_CHANCE) {
        return 'duotone';
    }

    return pickWeighted<HarmonyScheme>(random, [
        { value: 'analogous', weight: 3 },
        { value: 'complementary', weight: 2 },
        { value: 'split', weight: 2 },
        { value: 'triadic', weight: 1.5 },
        { value: 'monochrome', weight: baseSaturation < MONOCHROME_SATURATION_CEILING ? 2.5 : 0 },
    ]);
};

const resolveAccentHue = (
    scheme: HarmonyScheme,
    baseHue: number,
    supportHue: number | null,
    random: () => number,
) => {
    const sign = random() < 0.5 ? -1 : 1;

    switch (scheme) {
        case 'duotone':
            return supportHue ?? baseHue;
        case 'analogous':
            return baseHue + sign * (20 + random() * 15);
        case 'complementary':
            return baseHue + 150 + random() * 30;
        case 'split':
            return baseHue + (sign < 0 ? 150 : 210);
        case 'triadic':
            return baseHue + sign * 120;
        case 'monochrome':
        default:
            return baseHue;
    }
};

// Turns raw cover swatches into the hue/tone contract the built-in theme generator builds on.
export const analyzeCoverPalette = (coverColors: string[], random: () => number): CoverPalette => {
    const parsedColors = coverColors
        .map(readCoverColor)
        .filter((color): color is CoverColor => color !== null);

    const base = pickBaseColor(parsedColors, random);
    const supportHue = pickSupportHue(parsedColors, base);
    const scheme = pickScheme(base.s, supportHue, random);
    const accentJitter = scheme === 'monochrome' ? 0 : (random() - 0.5) * 16;

    return {
        baseHue: normalizeHue(base.h),
        baseSaturation: base.s,
        baseLightness: base.l,
        baseChroma: base.chroma,
        accentHue: normalizeHue(resolveAccentHue(scheme, base.h, supportHue, random) + accentJitter),
        scheme,
        tone: pickWeighted<PaletteTone>(random, [
            { value: 'ink', weight: 3 },
            { value: 'tinted', weight: 4 },
            { value: 'rich', weight: 2.5 },
        ]),
    };
};
