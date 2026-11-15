// src/utils/oklab.ts
// OKLab / OKLCH conversion for sRGB colours (Björn Ottosson's matrices): a perceptual space where
// equal steps of L read as equal steps of lightness on every hue, so palette code can hold
// lightness and chroma steady while it turns the hue. Pure math, no dependencies.

export type Oklab = { L: number; a: number; b: number; };
export type Oklch = { L: number; C: number; h: number; };
/** sRGB channels in 0–255 (not rounded or clamped by the converters). */
export type SrgbChannels = { r: number; g: number; b: number; };

const GAMUT_EPSILON = 1e-4;

const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
};

const fromLinear = (value: number) => (
    255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055)
);

const linearFromOklab = ({ L, a, b }: Oklab): [number, number, number] => {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
};

export const srgbToOklab = ({ r, g, b }: SrgbChannels): Oklab => {
    const red = toLinear(r);
    const green = toLinear(g);
    const blue = toLinear(b);
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    return {
        L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
};

/** sRGB 0–255 channels, clamped into range (out-of-gamut input is clipped, not mapped). */
export const oklabToSrgb = (lab: Oklab): SrgbChannels => {
    const [red, green, blue] = linearFromOklab(lab).map(value => fromLinear(Math.max(0, Math.min(1, value))));
    return { r: red, g: green, b: blue };
};

export const oklabToOklch = ({ L, a, b }: Oklab): Oklch => {
    const hue = Math.atan2(b, a) * 180 / Math.PI;
    return { L, C: Math.hypot(a, b), h: hue < 0 ? hue + 360 : hue };
};

export const oklchToOklab = ({ L, C, h }: Oklch): Oklab => {
    const radians = h * Math.PI / 180;
    return { L, a: C * Math.cos(radians), b: C * Math.sin(radians) };
};

export const srgbToOklch = (channels: SrgbChannels) => oklabToOklch(srgbToOklab(channels));

const isInGamut = (lab: Oklab) => linearFromOklab(lab)
    .every(value => value >= -GAMUT_EPSILON && value <= 1 + GAMUT_EPSILON);

/**
 * Brings an OKLCH colour into sRGB by lowering its chroma (lightness and hue stay put), so a
 * colour that sRGB cannot show turns calmer instead of shifting hue the way channel clipping does.
 */
export const fitOklchToSrgb = (color: Oklch): Oklch => {
    const L = Math.max(0, Math.min(1, color.L));
    const target = { L, C: Math.max(0, color.C), h: color.h };
    if (isInGamut(oklchToOklab(target))) return target;

    let low = 0;
    let high = target.C;
    for (let step = 0; step < 16; step += 1) {
        const middle = (low + high) / 2;
        if (isInGamut(oklchToOklab({ L, C: middle, h: color.h }))) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return { L, C: low, h: color.h };
};

/** Euclidean distance in OKLab (ΔE_ok); about 0.02 is a just-noticeable difference. */
export const oklabDistance = (from: Oklab, to: Oklab) => Math.hypot(from.L - to.L, from.a - to.a, from.b - to.b);
