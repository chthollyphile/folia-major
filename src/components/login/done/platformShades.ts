import { parseThemeColor, rgbToHex, type Rgb } from '../../../utils/themeColorMath';

// src/components/login/done/platformShades.ts
// 登录成功时铺满窗口的那一面颜色：平台的颜色做成有深浅的一面，左上亮一点、右下暗一点，都在同一个
// 色相里（在 OKLCH 里只动明度，彩度几乎不动，所以不发灰、不偏色）。样机用的是 CSS 的
// oklch(from …)；网页版可能跑在不认它的浏览器里，所以深浅在这里算成普通的颜色。

type Oklch = { l: number; c: number; h: number };

const toLinear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (value: number): number => {
    const clamped = Math.min(1, Math.max(0, value));
    return Math.round(255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055));
};

const toOklch = ({ r, g, b }: Rgb): Oklch => {
    const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
};

const toRgb = ({ l, c, h }: Oklch): Rgb => {
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return {
        r: fromLinear(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
        g: fromLinear(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
        b: fromLinear(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
    };
};

export interface PlatformShades {
    /** 亮的一头（左上）和暗的一头（右下）。 */
    light: string;
    dark: string;
    /** 右下角再压暗的那一块，七成不透明。 */
    corner: string;
    /** 白色圆底上的对勾：平台的颜色，太亮的（黄、浅绿）压到在白底上看得清。 */
    tick: string;
    /** 这一面颜色，可以直接当 background。 */
    surface: string;
}

/** 从平台的颜色算出那一面的深浅。认不出的颜色原样用，没有深浅。 */
export const platformShades = (color: string): PlatformShades => {
    const rgb = parseThemeColor(color);
    if (!rgb) return { light: color, dark: color, corner: 'transparent', tick: color, surface: color };
    const base = toOklch(rgb);
    const shade = (lightness: number, chroma = base.c): Rgb => toRgb({ l: Math.min(1, Math.max(0, lightness)), c: chroma, h: base.h });
    const light = rgbToHex(shade(base.l + 0.04));
    const dark = rgbToHex(shade(base.l - 0.075, base.c + 0.01));
    const deep = shade(base.l - 0.13, base.c + 0.01);
    const corner = `rgba(${deep.r}, ${deep.g}, ${deep.b}, 0.7)`;
    return {
        light,
        dark,
        corner,
        tick: rgbToHex(shade(Math.min(base.l, 0.58))),
        surface: [
            'radial-gradient(85% 120% at 10% -12%, rgba(255, 255, 255, 0.1), transparent 60%)',
            `radial-gradient(75% 110% at 104% 112%, ${corner}, transparent 64%)`,
            `linear-gradient(135deg, ${light}, ${color} 46%, ${dark})`,
        ].join(', '),
    };
};
