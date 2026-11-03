// Copyright (c) 2026 chthollyphile
// src/components/visualizer/hanabi/mg/mgMath.ts
// MG 部件库共用的纯数学：钳制、缓动（过冲 / 弹簧 / 阶梯）、确定性噪声、颜色混合、字符串散列。不碰 Pixi。

export const TAU = Math.PI * 2;

export const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value);
export const clamp = (value: number, low: number, high: number) => (value < low ? low : value > high ? high : value);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (value: number) => value - Math.floor(value);
/** 落在 [0, span) 里的取模（负数也对）。 */
export const wrap = (value: number, span: number) => value - span * Math.floor(value / span);

export const easeOutQuad = (t: number) => 1 - (1 - clamp01(t)) ** 2;
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInCubic = (t: number) => clamp01(t) ** 3;
export const easeInQuad = (t: number) => clamp01(t) ** 2;
export const easeInOutCubic = (t: number) => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
export const easeOutExpo = (t: number) => {
    const x = clamp01(t);
    return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
};
/** 过冲：冲过 1 再落回。overshoot 越大冲得越远。 */
export const easeOutBack = (t: number, overshoot = 1.70158) => {
    const x = clamp01(t) - 1;
    return 1 + x * x * ((overshoot + 1) * x + overshoot);
};
/** 反向蓄力：先往回退一点再冲出去。 */
export const easeInBack = (t: number, overshoot = 1.70158) => {
    const x = clamp01(t);
    return x * x * ((overshoot + 1) * x - overshoot);
};
/** 欠阻尼弹簧：从 0 弹到 1。seconds 为经过的秒数，freq 为振荡频率（Hz），decay 为衰减（1/s）。 */
export const spring = (seconds: number, freq = 2.6, decay = 7) =>
    (seconds <= 0 ? 0 : 1 - Math.exp(-decay * seconds) * Math.cos(TAU * freq * seconds));
/** 阶梯：把 0..1 量化成 steps 级（MG 的「一拍一格」）。 */
export const stepped = (t: number, steps: number) => Math.min(1, Math.floor(clamp01(t) * steps) / steps);
/** 一拍一格地走：每个节拍用 easeOutBack 跳到下一格。 */
export const beatSteps = (beats: number, snap = 0.35) => {
    const whole = Math.floor(beats);
    return whole + easeOutBack(fract(beats) / snap, 2.2);
};

/** 确定性噪声：同一 (n, salt) 永远同一个 [0, 1) 值。 */
export const hash01 = (n: number, salt = 0) => fract(Math.sin(n * 127.1 + salt * 311.7) * 43758.5453123);

/** 字符串 → 32 位散列（FNV-1a），给逐帧的噪声当盐。 */
export const hashString = (key: string) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/** 0xRRGGBB 逐通道线性混合。 */
export const mixColor = (a: number, b: number, t: number) => {
    const k = clamp01(t);
    if (k <= 0) return a;
    if (k >= 1) return b;
    const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k));
    const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k));
    const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * k));
    return (r << 16) | (g << 8) | bl;
};

export const WHITE = 0xffffff;
/** 火药燃烧的金色（冠、柳、椰的主色调）。 */
export const GOLD = 0xffc760;
/** 尾迹里的橙色火粉。 */
export const EMBER = 0xff9a3c;
