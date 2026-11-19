import type { TemperaTuning, Theme } from '../../../types';
import { colorWithAlpha, mixColors, parseColorChannels } from '../../../utils/colorMix';

// src/components/visualizer/tempera/temperaPalette.ts
// Derives Tempera's block palette from the active DualTheme side; mono mode collapses
// every derived step to a grayscale ink↔paper ladder so hue never leaks through.
export interface TemperaPalette {
    paper: string;
    ink: string;
    blockA: string;
    blockB: string;
    blockC: string;
    accent: string;
    line: string;
    shadow: string;
    /** Monotonic paper -> ink brightness ladder driving hatch density and graphic shading. */
    tone1: string;
    tone2: string;
    tone3: string;
    tone4: string;
    /**
     * Four-colour ramp for `gradient` mode, ordered paper -> ink by luminance. Null in the
     * flat modes; shape fills read it to build a linear gradient instead of a solid colour.
     */
    gradient: string[] | null;
    /**
     * Vivid four-colour ramp for the lyric itself in gradient mode. Unlike `gradient` this one
     * is NOT flattened onto the paper -> ink ladder: the type is what carries the cover's
     * colour, so hue is preserved and only a contrast floor against the paper is enforced.
     */
    textGradient: string[] | null;
}

/** Fixed paper -> ink mix positions; the screentone layer maps tone index to hatch density. */
export const TEMPERA_TONE_STOPS = [0.12, 0.3, 0.52, 0.72] as const;

const luminanceOf = (color: string) => {
    const channels = parseColorChannels(color);
    if (!channels) return 128;
    return channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722;
};

// Collapses a color to its Rec.709 luminance so mono blocks stay a true grayscale ladder.
const toGray = (color: string, fallback: string) => {
    const channels = parseColorChannels(color);
    if (!channels) return fallback;
    const luminance = Math.round(channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722);
    return `rgb(${luminance}, ${luminance}, ${luminance})`;
};

const grayLevel = (color: string) => parseColorChannels(color)?.r ?? 128;

const MIN_INK_CONTRAST = 96;

/**
 * Guarantees the ink/paper pair actually contrasts. `theme.primaryColor` carries no such
 * promise: plenty of themes pair a pale primary with a pale background, which leaves the
 * lyric unreadable and gives the difference filter two near-identical colors to choose
 * between. When that happens the ink is pushed to the opposite end of the paper and keeps
 * only a whisper of the theme hue.
 */
const ensureInkContrast = (paper: string, ink: string) => {
    if (Math.abs(luminanceOf(ink) - luminanceOf(paper)) >= MIN_INK_CONTRAST) return ink;
    const target = luminanceOf(paper) < 128 ? '#f4f4f2' : '#141414';
    const tinted = mixColors(target, ink, 0.14);
    return Math.abs(luminanceOf(tinted) - luminanceOf(paper)) >= MIN_INK_CONTRAST ? tinted : target;
};


// Rescales a tinted color back onto the untinted step's luminance, so adding hue never
// reorders the tone ladder.
const matchLuminance = (color: string, target: string) => {
    const channels = parseColorChannels(color);
    if (!channels) return target;
    const current = luminanceOf(color);
    const wanted = luminanceOf(target);
    if (current <= 0.5) return target;
    const gain = wanted / current;
    const scaled = {
        r: Math.round(Math.min(255, channels.r * gain)),
        g: Math.round(Math.min(255, channels.g * gain)),
        b: Math.round(Math.min(255, channels.b * gain)),
    };
    // Clipping a bright channel would break the match; fall back to the neutral step.
    if (Math.abs(luminanceOf(`rgb(${scaled.r}, ${scaled.g}, ${scaled.b})`) - wanted) > 1.5) return target;
    return `rgb(${scaled.r}, ${scaled.g}, ${scaled.b})`;
};

// Builds the four screentone steps. Hue tints only shift chroma: each tinted step is pulled
// back to the neutral step's luminance so the paper -> ink brightness order always holds.
const buildToneLadder = (paper: string, ink: string, tintA?: string, tintB?: string) => {
    const step = (index: number, tint?: string) => {
        const base = mixColors(paper, ink, TEMPERA_TONE_STOPS[index]);
        return tint ? matchLuminance(mixColors(base, tint, 0.3), base) : base;
    };
    return {
        tone1: step(0, tintA),
        tone2: step(1, tintB),
        tone3: step(2, tintA),
        tone4: step(3),
    };
};

/**
 * Builds the four-colour gradient ramp. Cover-art colours carry the hue, but each one is
 * pulled onto the paper -> ink brightness ladder first: an unordered ramp would break both
 * the composition's tonal structure and the text inversion that reads it.
 */
const buildGradientRamp = (paper: string, ink: string, sources: string[]) => {
    const usable = sources.map(color => color.trim()).filter(Boolean);
    const ranked = [...usable].sort((a, b) => luminanceOf(a) - luminanceOf(b));
    const towardInk = luminanceOf(ink) < luminanceOf(paper);
    const ordered = towardInk ? ranked.reverse() : ranked;
    return TEMPERA_TONE_STOPS.map((stop, index) => {
        const rung = mixColors(paper, ink, stop);
        const hue = ordered[index % Math.max(ordered.length, 1)];
        return hue ? matchLuminance(mixColors(rung, hue, 0.78), rung) : rung;
    });
};

/**
 * Keeps a cover colour recognisable while guaranteeing it reads against the paper. Rather than
 * pulling it onto the ink ladder (which is what greys the background ramp out), it is only
 * pushed away from the paper's luminance until it clears the floor.
 */
const enforceReadable = (paper: string, color: string) => {
    const paperLuminance = luminanceOf(paper);
    if (Math.abs(luminanceOf(color) - paperLuminance) >= 88) return color;
    const away = paperLuminance < 128 ? '#ffffff' : '#101010';
    for (let step = 1; step <= 5; step += 1) {
        const pushed = mixColors(color, away, step * 0.16);
        if (Math.abs(luminanceOf(pushed) - paperLuminance) >= 88) return pushed;
    }
    return mixColors(color, away, 0.8);
};

/**
 * How much of the theme is mixed into each extracted cover colour. The cover stays dominant -
 * it is what the mode is sampling - but a purely cover-derived ramp drops the theme entirely,
 * which makes the mode ignore the user's palette exactly when it is most visible.
 */
const THEME_HUE_MIX = 0.32;

const blendCoverWithTheme = (cover: string[], themeHues: string[]) => (
    cover.slice(0, 4).map((color, index) => mixColors(color, themeHues[index % themeHues.length], THEME_HUE_MIX))
);

const buildTextGradient = (paper: string, sources: string[]) => {
    const usable = sources.map(color => color.trim()).filter(Boolean);
    if (usable.length === 0) return null;
    return Array.from({ length: 4 }, (_, index) => (
        enforceReadable(paper, usable[index % usable.length])
    ));
};

export const resolveTemperaPalette = (
    theme: Theme,
    tuning: Pick<TemperaTuning, 'colorMode'>,
    coverColors: string[] = [],
): TemperaPalette => {
    if (tuning.colorMode === 'mono') {
        const paper = toGray(theme.backgroundColor, '#111111');
        let ink = toGray(theme.primaryColor, '#f5f5f5');
        // Guarantee legible contrast even when the themed ink is a mid-gray.
        if (Math.abs(grayLevel(ink) - grayLevel(paper)) < 96) {
            ink = grayLevel(paper) < 128 ? '#f2f2f2' : '#141414';
        }
        return {
            paper,
            ink,
            blockA: mixColors(paper, ink, 0.08),
            blockB: mixColors(paper, ink, 0.18),
            blockC: mixColors(paper, ink, 0.34),
            accent: mixColors(paper, ink, 0.85),
            line: colorWithAlpha(mixColors(paper, ink, 0.55), 0.55),
            shadow: colorWithAlpha(mixColors(paper, ink, 0.75), 0.35),
            ...buildToneLadder(paper, ink),
            gradient: null,
            textGradient: null,
        };
    }
    const paper = theme.backgroundColor;
    const ink = ensureInkContrast(paper, theme.primaryColor);
    if (tuning.colorMode === 'gradient') {
        // Cover colours carry the ramp, each one tinted toward the theme so the user's palette
        // is still present; with no artwork yet the theme hues stand on their own.
        const themeHues = [theme.accentColor, theme.secondaryColor, theme.primaryColor, ink];
        const hues = coverColors.length >= 2
            ? blendCoverWithTheme(coverColors, themeHues)
            : themeHues;
        const ramp = buildGradientRamp(paper, ink, hues);
        return {
            paper,
            ink,
            blockA: ramp[0],
            blockB: ramp[1],
            blockC: ramp[2],
            accent: theme.accentColor,
            line: colorWithAlpha(mixColors(paper, ink, 0.6), 0.5),
            shadow: colorWithAlpha(mixColors(paper, ink, 0.8), 0.32),
            tone1: ramp[0],
            tone2: ramp[1],
            tone3: ramp[2],
            tone4: ramp[3],
            gradient: ramp,
            textGradient: buildTextGradient(paper, hues),
        };
    }
    return {
        paper,
        ink,
        blockA: mixColors(paper, theme.accentColor, 0.55),
        blockB: mixColors(paper, theme.secondaryColor, 0.6),
        blockC: mixColors(paper, ink, 0.78),
        accent: theme.accentColor,
        line: colorWithAlpha(mixColors(paper, ink, 0.6), 0.5),
        shadow: colorWithAlpha(mixColors(paper, ink, 0.8), 0.32),
        // duo keeps the same brightness ladder but tints the mid steps with the theme hues,
        // so a screentone composition reads identically in both color modes.
        ...buildToneLadder(paper, ink, theme.accentColor, theme.secondaryColor),
        gradient: null,
        textGradient: null,
    };
};
