import type { DualTheme, Theme } from '../../types';
import {
    adjustLightnessForContrast,
    clamp01,
    getContrastRatio,
    getHueDistance,
    hexToHsl,
    hslToHex,
    normalizeHue,
} from '../themeColorMath';
import { analyzeCoverPalette, type CoverPalette } from './coverPaletteAnalysis';
import { pickBuiltinThemeDescriptions } from './themeDescriptionTable';
import { pickBuiltinThemeNames } from './themeNameTable';
import {
    ACCENT_MIN_CONTRAST,
    ACCENT_RANGES,
    BACKGROUND_TONES,
    MIN_BACKGROUND_SATURATION,
    PRIMARY_MIN_CONTRAST,
    PRIMARY_RANGES,
    SECONDARY_MIN_CONTRAST,
    SECONDARY_RANGES,
    type Range,
    type ThemeMode,
} from './themeColorRanges';

// src/utils/builtinTheme/generateBuiltinDualTheme.ts
// Generates the light/dark theme pair used when no AI API key is configured. Colors are computed
// from the cover's own hues plus a harmony scheme instead of snapping onto a fixed preset, and
// every text color is pushed along its lightness axis until it clears the contrast floor, so it
// keeps its hue rather than collapsing into a hard-coded near-white / near-black.

/** The four theme colour roles. */
export type BuiltinThemeColorSlot = 'backgroundColor' | 'primaryColor' | 'accentColor' | 'secondaryColor';

/**
 * Which cover swatch each slot takes its hue from, when the listener overrode it. A slot at `null`
 * keeps the generator's own choice; a number is the 1-based position in the cover's extracted
 * colours (1 and 2 are the cover's dominant colours).
 */
export type BuiltinThemeSlotPrefs = Partial<Record<BuiltinThemeColorSlot, number>>;

const between = (random: () => number, [min, max]: Range) => min + random() * (max - min);

// Interpolates along the shorter arc so a base/accent pair never swings through the opposite hue.
const lerpHue = (from: number, to: number, amount: number) => {
    const delta = ((to - from + 540) % 360) - 180;
    return normalizeHue(from + delta * amount);
};

const buildAccentColorWithHue = (
    mode: ThemeMode,
    accentHue: number,
    baseHue: number,
    backgroundColor: string,
    primaryColor: string,
    random: () => number,
) => {
    const ranges = ACCENT_RANGES[mode];
    const saturation = between(random, ranges.saturation);
    const lightness = between(random, ranges.lightness);
    const accent = adjustLightnessForContrast(
        hslToHex({ h: accentHue, s: saturation, l: lightness }),
        backgroundColor,
        ACCENT_MIN_CONTRAST,
    );

    // A monochrome/analogous accent can land on top of the primary text color; rotate it away.
    const collidesWithPrimary = getHueDistance(accentHue, baseHue) < 15
        && getContrastRatio(accent, primaryColor) < 1.3;

    if (!collidesWithPrimary) {
        return accent;
    }

    return adjustLightnessForContrast(
        hslToHex({ h: normalizeHue(accentHue + 40), s: saturation, l: lightness }),
        backgroundColor,
        ACCENT_MIN_CONTRAST,
    );
};

const buildModeTheme = (
    mode: ThemeMode,
    palette: CoverPalette,
    random: () => number,
    name: string,
    description: string,
    slotHues: Partial<Record<BuiltinThemeColorSlot, number>>,
): Theme => {
    // The hue each slot will draw on: an override wins, otherwise the palette's own hue.
    const hueOf = (slot: BuiltinThemeColorSlot, fallback: () => number): number => (
        slotHues[slot] !== undefined ? normalizeHue(slotHues[slot]!) : fallback()
    );

    const backgroundColor = hslToHex({
        h: hueOf('backgroundColor', () => palette.baseHue),
        s: Math.max(MIN_BACKGROUND_SATURATION, between(random, BACKGROUND_TONES[palette.tone][mode === 'dark' ? 'darkSaturation' : 'lightSaturation']) * (0.55 + 0.45 * clamp01(palette.baseSaturation / 0.7))),
        l: between(random, BACKGROUND_TONES[palette.tone][mode === 'dark' ? 'darkLightness' : 'lightLightness']),
    });

    const primaryRanges = PRIMARY_RANGES[mode];
    const primaryColor = adjustLightnessForContrast(
        hslToHex({
            h: hueOf('primaryColor', () => palette.baseHue),
            s: between(random, primaryRanges.saturation),
            l: between(random, primaryRanges.lightness),
        }),
        backgroundColor,
        PRIMARY_MIN_CONTRAST,
    );

    const accentHue = hueOf('accentColor', () => palette.accentHue);
    const accentColor = buildAccentColorWithHue(mode, accentHue, palette.baseHue, backgroundColor, primaryColor, random);

    const secondaryRanges = SECONDARY_RANGES[mode];
    const secondaryColor = adjustLightnessForContrast(
        hslToHex({
            h: hueOf('secondaryColor', () => lerpHue(palette.baseHue, accentHue, 0.2 + random() * 0.4)),
            s: between(random, secondaryRanges.saturation),
            l: between(random, secondaryRanges.lightness),
        }),
        backgroundColor,
        SECONDARY_MIN_CONTRAST,
    );

    return {
        name,
        description,
        backgroundColor,
        primaryColor,
        accentColor,
        secondaryColor,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: [],
        lyricsIcons: [],
        provider: 'Built-in',
    };
};

export const generateBuiltinDualTheme = ({
    coverColors = [],
    random = Math.random,
    slotPrefs,
}: {
    coverColors?: string[];
    random?: () => number;
    slotPrefs?: BuiltinThemeSlotPrefs;
} = {}): DualTheme => {
    const palette = analyzeCoverPalette(coverColors, random);
    const names = pickBuiltinThemeNames(palette, random);
    const descriptions = pickBuiltinThemeDescriptions(palette, random);

    // Turn a "use the Nth cover colour" preference into per-slot hues. A slot not overridden keeps
    // the generator's own hue; an out-of-range position is ignored rather than made up.
    const slotHues: Partial<Record<BuiltinThemeColorSlot, number>> = {};
    for (const [slot, position] of Object.entries(slotPrefs ?? {}) as [BuiltinThemeColorSlot, number][]) {
        const swatch = coverColors[position - 1];
        const hsl = swatch ? hexToHsl(swatch) : null;
        if (hsl) slotHues[slot] = hsl.h;
    }

    return {
        light: buildModeTheme('light', palette, random, names.light, descriptions.light, slotHues),
        dark: buildModeTheme('dark', palette, random, names.dark, descriptions.dark, slotHues),
    };
};
