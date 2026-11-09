import { rememberBounded } from './textMeasureCache';

// src/components/visualizer/colorMix.ts
// Shared color helpers for visualizer renderers.
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const FALLBACK_RGB = { r: 255, g: 255, b: 255 };

const isFiniteChannel = (value: number) => Number.isFinite(value);

const formatRgba = (channels: { r: number; g: number; b: number }, alpha: number) => (
    `rgba(${Math.round(clamp(channels.r, 0, 255))}, ${Math.round(clamp(channels.g, 0, 255))}, ${Math.round(clamp(channels.b, 0, 255))}, ${alpha})`
);

type Channels = { r: number; g: number; b: number };
/**
 * A colour string read once: its channels, `fallback` for input that is meant to be a colour but
 * does not parse (empty, a broken hex or rgb()), or `passthrough` for anything else (named
 * colours, hsl(), ...) that colorWithAlpha hands back untouched.
 */
type ParsedColor = Channels | 'fallback' | 'passthrough';

const readColor = (normalizedColor: string): ParsedColor => {
    if (!normalizedColor) return 'fallback';

    if (normalizedColor.startsWith('#')) {
        const hex = normalizedColor.slice(1);
        const parse = (value: string) => Number.parseInt(value, 16);

        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            return {
                r: parse(hex[0] + hex[0]),
                g: parse(hex[1] + hex[1]),
                b: parse(hex[2] + hex[2]),
            };
        }

        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            return {
                r: parse(hex.slice(0, 2)),
                g: parse(hex.slice(2, 4)),
                b: parse(hex.slice(4, 6)),
            };
        }

        return 'fallback';
    }

    const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const [r, g, b] = rgbMatch[1].split(',').slice(0, 3).map(part => Number.parseFloat(part.trim()));
        if ([r, g, b].every(isFiniteChannel)) {
            return { r, g, b };
        }
        return 'fallback';
    }

    return 'passthrough';
};

// Renderers ask for the same few theme colours every frame, often once per glyph; the regexes
// and parseInt calls above are the expensive part, so each distinct string is read once.
const parsedColors = new Map<string, ParsedColor>();
const PARSED_COLOR_LIMIT = 512;

const parseColor = (color: string): { normalized: string; parsed: ParsedColor } => {
    const normalized = typeof color === 'string' ? color.trim() : '';
    let parsed = parsedColors.get(normalized);
    if (parsed === undefined) {
        parsed = rememberBounded(parsedColors, normalized, readColor(normalized), PARSED_COLOR_LIMIT);
    }
    return { normalized, parsed };
};

export const colorWithAlpha = (color: string, alpha: number) => {
    const normalizedAlpha = clamp(alpha, 0, 1);
    const { normalized, parsed } = parseColor(color);
    if (parsed === 'passthrough') return normalized;
    return formatRgba(parsed === 'fallback' ? FALLBACK_RGB : parsed, normalizedAlpha);
};

/** The colour's channels, or null when it is not a hex or rgb() colour. Returns a fresh object. */
export const parseColorChannels = (color: string): Channels | null => {
    const { parsed } = parseColor(color);
    return typeof parsed === 'string' ? null : { ...parsed };
};

/**
 * Suppress dark, muddy halos; fade in over midtones so animated RGB (0–255) does not pop.
 * Gated on HSV value (the brightest channel), not luma: saturated keyword colours such as red
 * #ef4444 or blue #2563eb have low luma but still glow cleanly, while near-black navy stays dark.
 */
export const resolveGlowColorStrength = (r: number, g: number, b: number): number => {
    const value = Math.max(r, g, b);
    const progress = clamp((value - 110) / 50, 0, 1);
    return progress * progress * (3 - 2 * progress);
};

export const mixColors = (from: string, to: string, amount: number, alpha = 1) => {
    const normalizedAmount = clamp(amount, 0, 1);
    const fromParsed = parseColor(from).parsed;
    const toParsed = parseColor(to).parsed;

    if (typeof fromParsed === 'string' || typeof toParsed === 'string') {
        return colorWithAlpha(normalizedAmount >= 0.5 ? to : from, alpha);
    }

    return `rgba(${Math.round(mix(fromParsed.r, toParsed.r, normalizedAmount))}, ${Math.round(mix(fromParsed.g, toParsed.g, normalizedAmount))}, ${Math.round(mix(fromParsed.b, toParsed.b, normalizedAmount))}, ${clamp(alpha, 0, 1)})`;
};
