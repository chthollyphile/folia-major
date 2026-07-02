// src/components/visualizer/colorMix.ts
// Shared color helpers for visualizer renderers.
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const FALLBACK_RGB = { r: 255, g: 255, b: 255 };

const isFiniteChannel = (value: number) => Number.isFinite(value);

const formatRgba = (channels: { r: number; g: number; b: number }, alpha: number) => (
    `rgba(${Math.round(clamp(channels.r, 0, 255))}, ${Math.round(clamp(channels.g, 0, 255))}, ${Math.round(clamp(channels.b, 0, 255))}, ${alpha})`
);

export const colorWithAlpha = (color: string, alpha: number) => {
    const normalizedAlpha = clamp(alpha, 0, 1);
    const normalizedColor = typeof color === 'string' ? color.trim() : '';
    if (!normalizedColor) {
        return formatRgba(FALLBACK_RGB, normalizedAlpha);
    }

    if (normalizedColor.startsWith('#')) {
        const hex = normalizedColor.slice(1);
        const parse = (value: string) => Number.parseInt(value, 16);

        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            const r = parse(hex[0] + hex[0]);
            const g = parse(hex[1] + hex[1]);
            const b = parse(hex[2] + hex[2]);
            return formatRgba({ r, g, b }, normalizedAlpha);
        }

        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            const r = parse(hex.slice(0, 2));
            const g = parse(hex.slice(2, 4));
            const b = parse(hex.slice(4, 6));
            return formatRgba({ r, g, b }, normalizedAlpha);
        }

        return formatRgba(FALLBACK_RGB, normalizedAlpha);
    }

    const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const [r, g, b] = rgbMatch[1].split(',').slice(0, 3).map(part => Number.parseFloat(part.trim()));
        if ([r, g, b].every(isFiniteChannel)) {
            return formatRgba({ r, g, b }, normalizedAlpha);
        }
        return formatRgba(FALLBACK_RGB, normalizedAlpha);
    }

    return normalizedColor;
};

export const parseColorChannels = (color: string) => {
    const normalizedColor = typeof color === 'string' ? color.trim() : '';
    if (!normalizedColor) {
        return null;
    }

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
    }

    const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const [r, g, b] = rgbMatch[1].split(',').slice(0, 3).map(part => Number.parseFloat(part.trim()));
        if ([r, g, b].every(isFiniteChannel)) {
            return { r, g, b };
        }
    }

    return null;
};

export const mixColors = (from: string, to: string, amount: number, alpha = 1) => {
    const normalizedAmount = clamp(amount, 0, 1);
    const fromChannels = parseColorChannels(from);
    const toChannels = parseColorChannels(to);

    if (!fromChannels || !toChannels) {
        return colorWithAlpha(normalizedAmount >= 0.5 ? to : from, alpha);
    }

    return `rgba(${Math.round(mix(fromChannels.r, toChannels.r, normalizedAmount))}, ${Math.round(mix(fromChannels.g, toChannels.g, normalizedAmount))}, ${Math.round(mix(fromChannels.b, toChannels.b, normalizedAmount))}, ${clamp(alpha, 0, 1)})`;
};
