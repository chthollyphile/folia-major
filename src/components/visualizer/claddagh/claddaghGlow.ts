import { mixColors } from '../../../utils/colorMix';
import { clamp } from './claddaghTimeline';

// src/components/visualizer/claddagh/claddaghGlow.ts
// 用串联 drop-shadow 表达的 glow（Linux 下替代 text-shadow 的路径）。

// The glow as chained drop-shadow() filters, for Lab > Fix lyric animation freeze on Linux (see where it is
// used). Fitted against the text-shadow glow by pixel difference in Folia's Electron: one layer matches at
// half the text-shadow radius (the text-shadow radius is two sigmas, a drop-shadow's one); the chorus's
// three layers at 0.4x with a much weaker middle layer, because each drop-shadow also shadows the ones
// before it. Mean error under 0.5/255 across colours and radii.
const CLADDAGH_GLOW_DROP_SHADOW_SCALE = 0.5;
const CLADDAGH_CHORUS_DROP_SHADOW_SCALE = 0.4;
const CLADDAGH_CHORUS_MIDDLE_ALPHA = 0.2;

export const buildCladdaghGlowFilter = (
    color: string,
    coreColor: string,
    radius: number,
    glyphAlpha: number,
    fade: number,
    isChorus: boolean,
): string => {
    // A drop-shadow shadows the painted glyph, whose alpha is already `glyphAlpha`; the shadow colours carry
    // only what the text-shadow had on top of that (its outer layers were `glyphAlpha * fade`).
    const glow = (alpha: number) => mixColors(color, color, 0, alpha);
    if (!isChorus) {
        return `drop-shadow(0 0 ${(radius * CLADDAGH_GLOW_DROP_SHADOW_SCALE).toFixed(2)}px ${glow(fade)})`;
    }
    const scale = CLADDAGH_CHORUS_DROP_SHADOW_SCALE;
    const core = mixColors(color, coreColor, 0.65, clamp(fade / Math.max(glyphAlpha, 0.01), 0, 1));
    return `drop-shadow(0 0 ${(radius * 0.35 * scale).toFixed(2)}px ${core}) `
        + `drop-shadow(0 0 ${(radius * scale).toFixed(2)}px ${glow(fade * CLADDAGH_CHORUS_MIDDLE_ALPHA)}) `
        + `drop-shadow(0 0 ${(radius * 1.6 * scale).toFixed(2)}px ${glow(fade)})`;
};
