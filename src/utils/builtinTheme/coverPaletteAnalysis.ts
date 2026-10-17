import { getHueDistance, hexToHsl, normalizeHue, type Hsl } from '../themeColorMath';

// src/utils/builtinTheme/coverPaletteAnalysis.ts
// Reads the cover's extracted colors and decides the color skeleton of a built-in theme: which
// hue leads, which hue accents it, and how saturated/deep the backgrounds should read.

export type HarmonyScheme = 'analogous' | 'complementary' | 'split' | 'triadic' | 'duotone' | 'monochrome';
export type PaletteTone = 'ink' | 'tinted' | 'rich';

export type CoverPalette = {
    baseHue: number;
    baseSaturation: number;
    baseLightness: number;
    accentHue: number;
    scheme: HarmonyScheme;
    tone: PaletteTone;
};

const MIN_SUPPORT_SATURATION = 0.15;
const MIN_SUPPORT_HUE_DISTANCE = 25;
const MAX_SUPPORT_HUE_DISTANCE = 160;
const MONOCHROME_SATURATION_CEILING = 0.18;

// Prefers colors that are both saturated and mid-lightness: those carry the cover's identity,
// while near-black / near-white pixels only describe its background.
const getCoverColorScore = ({ s, l }: Hsl) => s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.2);

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

const pickBaseColor = (parsedColors: Hsl[], random: () => number): Hsl => {
    if (parsedColors.length === 0) {
        // No cover to read: pick a hue outright so a coverless song still varies run to run.
        return { h: random() * 360, s: 0.35 + random() * 0.3, l: 0.5 };
    }

    const scored = parsedColors.reduce((best, candidate) => (
        getCoverColorScore(candidate) > getCoverColorScore(best) ? candidate : best
    ), parsedColors[0]);

    return getCoverColorScore(scored) > 0.02 ? scored : parsedColors[0];
};

const pickSupportHue = (parsedColors: Hsl[], base: Hsl) => {
    const support = parsedColors.find(candidate => {
        if (candidate.s < MIN_SUPPORT_SATURATION) return false;
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
    // A real second hue on the cover is the most "from this artwork" accent available. It is always
    // preferred once found: a complementary / triadic accent rotated off the base hue is the whole
    // of the "accent does not match the cover" report, so a cover that offers its own second colour
    // never falls through to a synthetic one.
    if (supportHue !== null) {
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
        .map(color => hexToHsl(color))
        .filter((color): color is Hsl => color !== null);

    const base = pickBaseColor(parsedColors, random);
    const supportHue = pickSupportHue(parsedColors, base);
    const scheme = pickScheme(base.s, supportHue, random);
    const accentJitter = scheme === 'monochrome' ? 0 : (random() - 0.5) * 16;

    return {
        baseHue: normalizeHue(base.h),
        baseSaturation: base.s,
        baseLightness: base.l,
        accentHue: normalizeHue(resolveAccentHue(scheme, base.h, supportHue, random) + accentJitter),
        scheme,
        tone: pickWeighted<PaletteTone>(random, [
            { value: 'ink', weight: 3 },
            { value: 'tinted', weight: 4 },
            { value: 'rich', weight: 2.5 },
        ]),
    };
};
