import { DEFAULT_LUMIERE_TUNING, type LumiereRenderQuality, type LumiereTuning } from '../types';
import { normalizeLyricRenderOverride } from './lyricRenderQuality';

// src/utils/lumiereTuning.ts
// 绘光 tuning 的归一化：localStorage、同步、外观短码 / JSON 导入和 store setter 共用同一套钳制规则。

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

const pickBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const RENDER_QUALITIES: readonly LumiereRenderQuality[] = ['full', 'balanced', 'low'];

/**
 * 把任意输入收敛成合法的 LumiereTuning：数值钳到各自区间，缺失或类型不对的字段回落到默认值，
 * 枚举只认已知取值。输入不是对象时直接返回默认值。
 */
export const normalizeLumiereTuning = (value: unknown): LumiereTuning => {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const d = DEFAULT_LUMIERE_TUNING;
    const fogOctaves = clampNumber(raw.fogOctaves, d.fogOctaves, 2, 6);
    return {
        // 分辨率与抗锯齿的覆盖（#929）：旧存档没有这一项就是全跟随全局。
        render: normalizeLyricRenderOverride(raw.render),
        lightIntensity: clampNumber(raw.lightIntensity, d.lightIntensity, 0.3, 2),
        audioResponse: clampNumber(raw.audioResponse, d.audioResponse, 0, 2),
        fogDensity: clampNumber(raw.fogDensity, d.fogDensity, 0, 2),
        darkField: clampNumber(raw.darkField, d.darkField, 0, 1),
        moteAmount: clampNumber(raw.moteAmount, d.moteAmount, 0, 2),
        bloom: clampNumber(raw.bloom, d.bloom, 0, 2),
        textBloom: clampNumber(raw.textBloom, d.textBloom, 0, 2),
        unlitOpacity: clampNumber(raw.unlitOpacity, d.unlitOpacity, 0.05, 0.6),
        windowNeighbors: raw.windowNeighbors === 1 || raw.windowNeighbors === 2 ? raw.windowNeighbors : d.windowNeighbors,
        decay: clampNumber(raw.decay, d.decay, 0, 2),
        echo: clampNumber(raw.echo, d.echo, 0, 2),
        fogOctaves: Math.round(fogOctaves),
        lineArt: pickBoolean(raw.lineArt, d.lineArt),
        frontBokeh: pickBoolean(raw.frontBokeh, d.frontBokeh),
        trails: pickBoolean(raw.trails, d.trails),
        hideTrails: pickBoolean(raw.hideTrails, d.hideTrails),
        seamlessTransitions: pickBoolean(raw.seamlessTransitions, d.seamlessTransitions),
        overlayFrame: pickBoolean(raw.overlayFrame, d.overlayFrame),
        textOnly: pickBoolean(raw.textOnly, d.textOnly),
        keywordColors: pickBoolean(raw.keywordColors, d.keywordColors),
        themeIcons: pickBoolean(raw.themeIcons, d.themeIcons),
        themeColorMix: clampNumber(raw.themeColorMix, d.themeColorMix, 0, 1),
        renderQuality: RENDER_QUALITIES.includes(raw.renderQuality as LumiereRenderQuality)
            ? raw.renderQuality as LumiereRenderQuality
            : d.renderQuality,
    };
};
