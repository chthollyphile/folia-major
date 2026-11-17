import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';
import { isCJKChar } from './claddaghTimeline';
import { measurePrefixOffsets, rememberBounded } from '../../../utils/textMeasureCache';

// src/components/visualizer/claddagh/claddaghLayout.ts
// 环形排布的常量与字距测量：pretext 实测字素中心、按 key 缓存的间距、可读角度归一化。

const CLADDAGH_MAX_ARC_SPAN = 4.25;
export const CLADDAGH_LETTER_SPACING_EM = 0.04;
const CLADDAGH_BASE_TRACKING_EM = 0.18;
export const CLADDAGH_BACK_FOLLOW_RATIO = 0.28;
export const CLADDAGH_BACK_ORBIT_FOLLOW_RATIO = 0.52;
export const CLADDAGH_NEXT_LINE_ENTRY_LEAD_SECONDS = 0.34;
const CLADDAGH_SPACING_CACHE_LIMIT = 240;
const claddaghSpacingCache = new Map<string, number[]>();

const getFallbackGraphemeWidth = (char: string, fontPx: number): number => {
    if (/^\s+$/.test(char)) return fontPx * 0.36;
    if (isCJKChar(char)) return fontPx;
    return fontPx * 0.62;
};

// Keeps tangent-based character rotation readable instead of allowing upside-down glyphs.
export const normalizeReadableAngle = (degrees: number): number => {
    let normalized = degrees;
    while (normalized > 90) normalized -= 180;
    while (normalized < -90) normalized += 180;
    return normalized;
};

const measureCladdaghTextWidth = (text: string, fontSpec: string, fontPx: number, fallbackWidth: number): number => {
    if (!text) return 0;
    const prepared = prepareWithSegments(text, fontSpec, {
        whiteSpace: 'pre-wrap',
        letterSpacing: fontPx * CLADDAGH_LETTER_SPACING_EM,
    });
    const measuredWidth = measureNaturalWidth(prepared);
    return Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : fallbackWidth;
};

// Uses pretext's canvas-backed font measurement to place grapheme centers at their rendered advance positions.
const measureCladdaghGraphemeOffsets = (graphemes: string[], fontSpec: string, fontPx: number, letterSpacingOffsetPx: number = 0): number[] => {
    const text = graphemes.join('');
    const cacheKey = `${fontPx}|${fontSpec}|${CLADDAGH_BASE_TRACKING_EM}|${letterSpacingOffsetPx}|${text}`;
    const cached = claddaghSpacingCache.get(cacheKey);
    if (cached) return cached;

    let fallbackWidth = 0;
    const offsets = measurePrefixOffsets(graphemes, (prefix, index, previousOffset) => {
        fallbackWidth += getFallbackGraphemeWidth(graphemes[index - 1], fontPx);
        const baseTracking = Math.max(0, index - 1) * fontPx * CLADDAGH_BASE_TRACKING_EM;
        // 每个字符间隙累加 letterSpacingOffsetPx，增大字符之间的距离
        const extraOffset = Math.max(0, index - 1) * letterSpacingOffsetPx;
        return Math.max(
            previousOffset,
            measureCladdaghTextWidth(prefix, fontSpec, fontPx, fallbackWidth) + baseTracking + extraOffset
        );
    });
    return rememberBounded(claddaghSpacingCache, cacheKey, offsets, CLADDAGH_SPACING_CACHE_LIMIT);
};

export const buildMeasuredSpacingInfo = <T extends { char: string; }>(
    items: T[],
    fontSpec: string,
    fontPx: number,
    radiusPx: number,
    spacingScale = 1,
    letterSpacingOffsetPx = 0
) => {
    if (items.length === 0) return [];
    const graphemes = items.map(item => item.char);
    const offsets = measureCladdaghGraphemeOffsets(graphemes, fontSpec, fontPx, letterSpacingOffsetPx);
    const safeSpacingScale = Number.isFinite(spacingScale) ? Math.max(0.1, spacingScale) : 1;
    const totalWidth = (offsets[offsets.length - 1] ?? 0) * safeSpacingScale;
    const safeRadius = Math.max(radiusPx, fontPx * 2, 1);
    const totalSpan = totalWidth / safeRadius;
    const scaleFactor = totalSpan > CLADDAGH_MAX_ARC_SPAN ? CLADDAGH_MAX_ARC_SPAN / totalSpan : 1.0;

    return items.map((item, index) => {
        const centerPx = ((offsets[index] ?? 0) + (offsets[index + 1] ?? offsets[index] ?? 0)) / 2 * safeSpacingScale;
        const startAngle = centerPx / safeRadius;
        return {
            ...item,
            startAngle,
            nominalAngle: (startAngle - totalSpan / 2) * scaleFactor,
            scaleFactor,
        };
    });
};
