// src/components/modal/settings/kit/hexColor.ts
// A colour as the text of a HEX field and as the three numbers the colour picker moves: hue,
// saturation and value. Conversions only, and no element is touched, so the rules can be tested by
// themselves.

export type Hsv = {
    /** 0 to 360. */
    h: number;
    /** 0 to 1. */
    s: number;
    /** 0 to 1. */
    v: number;
};

const HEX_TEXT = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX_START = /^#?[0-9a-f]{0,6}$/i;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Reads a colour as it is typed: three or six hex digits, with or without the #, in either case.
 * Answers #rrggbb in lower case, or null for anything else.
 */
export const parseHexColor = (text: string): string | null => {
    const digits = HEX_TEXT.exec(text.trim())?.[1].toLowerCase();
    if (!digits) {
        return null;
    }
    return `#${digits.length === 3 ? digits.replace(/./g, '$&$&') : digits}`;
};

/** Whether a text can still become a colour by typing on: hex digits only so far, six at most. */
export const isHexColorStart = (text: string): boolean => HEX_START.test(text.trim());

/** The hue, saturation and value of a colour; null for a text that is not a colour. A grey has hue 0. */
export const hexToHsv = (text: string): Hsv | null => {
    const hex = parseHexColor(text);
    if (!hex) {
        return null;
    }
    const number = parseInt(hex.slice(1), 16);
    const r = ((number >> 16) & 255) / 255;
    const g = ((number >> 8) & 255) / 255;
    const b = (number & 255) / 255;
    const max = Math.max(r, g, b);
    const span = max - Math.min(r, g, b);
    let h = 0;
    if (span > 0) {
        h = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: max === 0 ? 0 : span / max, v: max };
};

/** The colour of a hue, a saturation and a value, as #rrggbb. The hue goes round; the other two are held in 0 to 1. */
export const hsvToHex = ({ h, s, v }: Hsv): string => {
    const hue = ((h % 360) + 360) % 360;
    const saturation = clamp01(s);
    const value = clamp01(v);
    const channel = (offset: number) => {
        const k = (offset + hue / 60) % 6;
        const level = value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
        return Math.round(level * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(5)}${channel(3)}${channel(1)}`;
};
