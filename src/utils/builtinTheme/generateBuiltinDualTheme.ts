import type { DualTheme, Theme } from '../../types';
import {
    adjustLightnessForContrast,
    adjustOklchLightnessForContrast,
    clamp01,
    getContrastRatio,
    getHueDistance,
    getOklabDistance,
    hexToOklch,
    hslToHex,
    normalizeHue,
} from '../themeColorMath';
import { analyzeCoverPalette, type CoverPalette } from './coverPaletteAnalysis';
import { pickBuiltinThemeDescriptions } from './themeDescriptionTable';
import { pickBuiltinThemeNames } from './themeNameTable';
import {
    ACCENT_MIN_CONTRAST,
    ACCENT_OKLCH_RANGES,
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

const between = (random: () => number, [min, max]: Range) => min + random() * (max - min);

// Interpolates along the shorter arc so a base/accent pair never swings through the opposite hue.
const lerpHue = (from: number, to: number, amount: number) => {
    const delta = ((to - from + 540) % 360) - 180;
    return normalizeHue(from + delta * amount);
};

const buildBackgroundColor = (mode: ThemeMode, palette: CoverPalette, random: () => number) => {
    const tone = BACKGROUND_TONES[palette.tone];
    const lightnessRange = mode === 'dark' ? tone.darkLightness : tone.lightLightness;
    const saturationRange = mode === 'dark' ? tone.darkSaturation : tone.lightSaturation;
    // A washed-out cover should not force a washed-out ground, but it should still read calmer.
    const coverWeight = 0.55 + 0.45 * clamp01(palette.baseSaturation / 0.7);

    return hslToHex({
        h: palette.baseHue,
        s: Math.max(MIN_BACKGROUND_SATURATION, between(random, saturationRange) * coverWeight),
        l: between(random, lightnessRange),
    });
};

// OKLCH chroma at which a cover counts as fully vivid for the accent's chroma band.
const VIVID_COVER_CHROMA = 0.2;
// OKLCH hues that cannot go dark and stay themselves: yellow pushed to accent lightness on a light
// ground reads as olive, chartreuse as khaki. On light themes yellow leans to amber and
// chartreuse to green, the nearest hues that still read clean when dark. The two meet at
// YELLOW_SPLIT_HUE, where the hue is ambiguous anyway.
const AMBER_HUE = 70;
const GREEN_HUE = 150;
const YELLOW_SPLIT_HUE = 118;
const DARK_HUE_PULL = 0.75;
// Closest the accent and the secondary text colour may sit (ΔE in OKLab) before the secondary
// drops to near-neutral.
const MIN_ACCENT_SECONDARY_DISTANCE = 0.07;
const NEUTRAL_SECONDARY_SATURATION = 0.04;

// Theme hues are HSL degrees; the accent is solved in OKLCH, so read the hue's OKLCH angle off a
// fully saturated sample of it.
const toOklchHue = (hslHue: number) => hexToOklch(hslToHex({ h: hslHue, s: 0.9, l: 0.5 }))?.h ?? hslHue;

const smoothstep = (edge0: number, edge1: number, value: number) => {
    const progress = clamp01((value - edge0) / (edge1 - edge0));
    return progress * progress * (3 - 2 * progress);
};

// Moves an OKLCH hue in the yellow–chartreuse range off it for a dark (light-theme) accent.
const steerHueForDarkAccent = (hue: number) => {
    if (hue < YELLOW_SPLIT_HUE) {
        return hue + (AMBER_HUE - hue) * DARK_HUE_PULL * smoothstep(78, 92, hue);
    }
    return hue + (GREEN_HUE - hue) * DARK_HUE_PULL * (1 - smoothstep(134, 148, hue));
};

const buildAccentColor = (
    mode: ThemeMode,
    palette: CoverPalette,
    backgroundColor: string,
    primaryColor: string,
    random: () => number,
) => {
    const ranges = ACCENT_OKLCH_RANGES[mode];
    const lightness = between(random, ranges.lightness);
    const [minChroma, maxChroma] = ranges.chroma;
    const vividness = clamp01(palette.baseChroma / VIVID_COVER_CHROMA);
    const chroma = (minChroma + (maxChroma - minChroma) * vividness) * between(random, [0.9, 1.05]);

    const solve = (hslHue: number) => {
        const oklchHue = toOklchHue(hslHue);
        return adjustOklchLightnessForContrast(
            { L: lightness, C: chroma, h: mode === 'light' ? steerHueForDarkAccent(oklchHue) : oklchHue },
            backgroundColor,
            ACCENT_MIN_CONTRAST,
        );
    };

    const accent = solve(palette.accentHue);

    // A monochrome/analogous accent can land on top of the primary text color; rotate it away.
    const collidesWithPrimary = getHueDistance(palette.accentHue, palette.baseHue) < 15
        && getContrastRatio(accent, primaryColor) < 1.3;

    return collidesWithPrimary ? solve(normalizeHue(palette.accentHue + 40)) : accent;
};

const buildModeTheme = (
    mode: ThemeMode,
    palette: CoverPalette,
    random: () => number,
    name: string,
    description: string,
): Theme => {
    const backgroundColor = buildBackgroundColor(mode, palette, random);

    const primaryRanges = PRIMARY_RANGES[mode];
    const primaryColor = adjustLightnessForContrast(
        hslToHex({
            h: palette.baseHue,
            s: between(random, primaryRanges.saturation),
            l: between(random, primaryRanges.lightness),
        }),
        backgroundColor,
        PRIMARY_MIN_CONTRAST,
    );

    const accentColor = buildAccentColor(mode, palette, backgroundColor, primaryColor, random);

    const secondaryRanges = SECONDARY_RANGES[mode];
    const secondaryHue = lerpHue(palette.baseHue, palette.accentHue, 0.2 + random() * 0.4);
    const buildSecondary = (saturation: number, lightness: number) => adjustLightnessForContrast(
        hslToHex({ h: secondaryHue, s: saturation, l: lightness }),
        backgroundColor,
        SECONDARY_MIN_CONTRAST,
    );
    const secondaryLightness = between(random, secondaryRanges.lightness);
    let secondaryColor = buildSecondary(between(random, secondaryRanges.saturation), secondaryLightness);

    // A muted cover gives a muted accent, and a monochrome scheme gives it the secondary's hue: the
    // two can then meet (lit lyric vs translation line). First drop the secondary to near-neutral at
    // the lightness it drew, which keeps it apart from the primary text; if it still meets the
    // accent, also move it to the dark end of its band. That end is the far side from the accent
    // in both modes, though on dark themes the gap there is small and the accent's chroma floor
    // does most of the separating.
    if (getOklabDistance(secondaryColor, accentColor) < MIN_ACCENT_SECONDARY_DISTANCE) {
        secondaryColor = buildSecondary(NEUTRAL_SECONDARY_SATURATION, secondaryLightness);
        if (getOklabDistance(secondaryColor, accentColor) < MIN_ACCENT_SECONDARY_DISTANCE) {
            secondaryColor = buildSecondary(NEUTRAL_SECONDARY_SATURATION, secondaryRanges.lightness[0]);
        }
    }

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
}: {
    coverColors?: string[];
    random?: () => number;
} = {}): DualTheme => {
    const palette = analyzeCoverPalette(coverColors, random);
    const names = pickBuiltinThemeNames(palette, random);
    const descriptions = pickBuiltinThemeDescriptions(palette, random);

    return {
        light: buildModeTheme('light', palette, random, names.light, descriptions.light),
        dark: buildModeTheme('dark', palette, random, names.dark, descriptions.dark),
    };
};
