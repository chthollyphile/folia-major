import type { Theme, TideBackgroundTuning } from '../../../../types';
import { parseColorChannels } from '../../colorMix';

// src/components/visualizer/backgrounds/tide/tidePalette.ts
// Everything the tide pass needs to know about the outside world in one place: the water palette of
// the current theme, the device pixel ratio cap and the solver size.

export interface TideStageColors {
    surface: [number, number, number];
    glow: [number, number, number];
    /** Sparkle colour: the accent pulled towards white, like the reference's white glints. */
    glint: [number, number, number];
    background: [number, number, number];
}

/**
 * Surface pixel budget. The water pass is procedural (seven waves per pixel), so it may be
 * expensive — but budgeted, so an absurd surface does not render at device scale. Raised so the
 * common cases hit native scale (1080p@2x, 1440p@1.5x); a lower budget rendered below the device
 * ratio and the browser upscaled it, which read as a soft/blurry sea.
 */
const PIXEL_BUDGET = 7.0e6;
const MAX_DEVICE_PIXEL_RATIO = 1.75;
/** Solver grid across the width; 128 keeps the stirred ink/velocity fields from going mushy. */
const FLUID_TEXELS = 128;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const toRgb = (value: string | undefined, fallback: [number, number, number]): [number, number, number] => {
    const channels = value ? parseColorChannels(value) : null;
    if (!channels) {
        return fallback;
    }

    return [channels.r / 255, channels.g / 255, channels.b / 255];
};

const scaleRgb = (color: [number, number, number], amount: number): [number, number, number] => [
    color[0] * amount,
    color[1] * amount,
    color[2] * amount,
];

const mixRgb = (
    from: [number, number, number],
    to: [number, number, number],
    amount: number,
): [number, number, number] => [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
];

/** 设置页的配色取值：只关心颜色相关的字段，方便单测。 */
export type TideColorSettings = Pick<
    TideBackgroundTuning,
    'colorMode' | 'waterColor' | 'glintColor' | 'backgroundColor'
>;

export const resolveTideStageColors = (
    theme: Theme | undefined,
    isDaylight: boolean,
    colorSettings?: TideColorSettings,
): TideStageColors => {
    const accent = toRgb(theme?.accentColor || theme?.primaryColor, [1, 1, 1]);
    const primary = toRgb(theme?.primaryColor || theme?.accentColor, isDaylight ? [0.1, 0.1, 0.12] : [1, 1, 1]);

    if (colorSettings?.colorMode === 'custom') {
        // 自定义配色：用户给什么就是什么，不再按明暗二次压暗。
        const water = toRgb(colorSettings.waterColor, [0.66, 0.33, 0.97]);
        const customGlint = toRgb(colorSettings.glintColor, [1, 1, 1]);
        const fallbackBackground: [number, number, number] = isDaylight ? [0.97, 0.98, 1] : [0.012, 0.014, 0.032];

        return {
            surface: water,
            glow: mixRgb(water, customGlint, 0.35),
            glint: customGlint,
            background: toRgb(colorSettings.backgroundColor, fallbackBackground),
        };
    }

    const glint = mixRgb(accent, [1, 1, 1], 0.7);

    if (isDaylight) {
        return {
            surface: scaleRgb(primary, 0.75),
            glow: accent,
            glint,
            background: [0.97, 0.98, 1],
        };
    }

    return {
        // 暗水才是水：亮度交给浪脊的高光，底色只留一点点紫。
        surface: scaleRgb(accent, 0.55),
        glow: accent,
        glint,
        background: [0.012, 0.014, 0.032],
    };
};

export const resolveTideDpr = (width: number, height: number): number => {
    const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, width * height));
    return clamp(Math.min(device, budget), 0.5, MAX_DEVICE_PIXEL_RATIO);
};

/** Aspect-correct solver grid: 128 texels across, the height follows the stage shape. */
export const computeTideFluidSize = (width: number, height: number): [number, number] => {
    const aspect = clamp(width, 1, 8192) / clamp(height, 1, 8192);
    return [FLUID_TEXELS, clamp(Math.round(FLUID_TEXELS / Math.max(aspect, 0.05)), 32, 256)];
};
