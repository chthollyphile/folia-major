import { Theme } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { colorWithAlpha } from '../../../utils/colorMix';
import type { CameraTarget, FumeBlock, ViewportSize } from './fumeTypes';
import { clamp, isCJK } from './fumeMath';
import { resolveLinePassCutoffTime } from './fumeReveal';
import { resolvePassedDimAmount, resolvePassedTextStyle } from './fumeTextStyle';

// src/components/visualizer/fume/fumeBlockFrame.ts
// Per-frame decisions about one article block that do not depend on the renderer: whether it is on
// screen, its timing and styles right now, and - for a block that is waiting or long passed - which
// cached snapshots to show at what alpha. The live (printing) block itself is drawn by
// `drawFumeLiveBlock` in fumeCanvasText.ts.

type PassedTextStyle = ReturnType<typeof resolvePassedTextStyle>;

/** How strongly active glyphs glow and how much glow passed text keeps, for this theme and tuning. */
export const resolveFumeGlowBases = (animationIntensity: Theme['animationIntensity'], glowIntensity: number) => ({
    activeGlowBoost: (animationIntensity === 'chaotic'
        ? 1.15
        : animationIntensity === 'calm'
            ? 0.72
            : 0.92) * glowIntensity,
    passedGlowBase: (animationIntensity === 'chaotic'
        ? 0.95
        : animationIntensity === 'calm'
            ? 0.35
            : 0.62) * glowIntensity,
});

/** Whether a block's world rect lands within `overscan` px of the viewport under this camera. */
export const isFumeBlockOnScreen = (block: FumeBlock, camera: CameraTarget, viewport: ViewportSize, overscan = 180) => {
    const screenScale = camera.scale;
    const screenLeft = viewport.width * 0.5 + (block.x - camera.x) * screenScale;
    const screenTop = viewport.height * 0.5 + (block.y - camera.y) * screenScale;
    const screenRight = screenLeft + block.width * screenScale;
    const screenBottom = screenTop + block.height * screenScale;
    return !(screenRight < -overscan || screenLeft > viewport.width + overscan || screenBottom < -overscan || screenTop > viewport.height + overscan);
};

export interface FumeBlockTiming {
    waitingOpacity: number;
    activeOpacity: number;
    effectiveTextHoldStyle: 'standard' | 'dimmed';
    passedStyle: PassedTextStyle;
    transitionPassedStyle: PassedTextStyle;
    baselineOffset: number;
    lineEndTime: number;
    linePassCutoffTime: number;
    hasRevealCompleted: boolean;
    hasPassCutoffReached: boolean;
    lineDuration: number;
    colorTrailDuration: number;
    /** Not printing and not in its colour trail: drawn from a cached snapshot. */
    staticState: 'waiting' | 'passed' | null;
}

export const resolveFumeBlockTiming = (
    block: FumeBlock,
    time: number,
    nextLineStartTime: number | null,
    textHoldRatio: number,
): FumeBlockTiming => {
    const waitingOpacity = block.variant === 'hero' ? 0.06 : 0.035;
    const activeOpacity = block.variant === 'hero' ? 0.985 : 0.92;
    const effectiveTextHoldStyle = textHoldRatio >= 1 ? 'standard' : 'dimmed';
    const passedStyle = resolvePassedTextStyle(block.variant, effectiveTextHoldStyle);
    const transitionPassedStyle = resolvePassedTextStyle(block.variant, 'standard');
    const baselineOffset = block.lineHeight * (isCJK(block.line.fullText) ? 0.52 : 0.5);
    const lineEndTime = getLineRenderEndTime(block.line);
    const linePassCutoffTime = resolveLinePassCutoffTime(block.line, nextLineStartTime);
    const revealCompleteTime = block.line.endTime;
    const hasRevealCompleted = time >= revealCompleteTime;
    const hasPassCutoffReached = time >= linePassCutoffTime;
    const lineDuration = Math.max(lineEndTime - block.line.startTime, 0.18);
    const colorTrailDuration = clamp(
        lineDuration * (block.variant === 'hero' ? 0.42 : 0.52),
        0.45,
        1.45,
    );
    const staticState = time < block.line.startTime
        ? 'waiting'
        : time >= lineEndTime + colorTrailDuration
            ? 'passed'
            : null;
    return {
        waitingOpacity,
        activeOpacity,
        effectiveTextHoldStyle,
        passedStyle,
        transitionPassedStyle,
        baselineOffset,
        lineEndTime,
        linePassCutoffTime,
        hasRevealCompleted,
        hasPassCutoffReached,
        lineDuration,
        colorTrailDuration,
        staticState,
    };
};

/** What a static block snapshot looks like; `key` identifies it in a renderer's snapshot cache. */
export interface FumeSnapshotSpec {
    key: string;
    fill: string;
    shadowBlur: number;
    shadowColor: string;
}

export interface FumeStaticLayerInput {
    time: number;
    theme: Theme;
    passedGlowBase: number;
    passedFadeDuration: number;
    overviewTextRestoreProgress: number;
    /** Raster scale of the renderer's snapshots, part of the cache key. */
    snapshotScale: number;
}

/**
 * The snapshots to draw for a static block, bottom first, with their alpha - one normally, two while a
 * dimmed passed block cross-fades from its standard look. `getSnapshot` returns the renderer's cached
 * snapshot for a spec, creating it if needed. Null when the main snapshot is unavailable: draw the block
 * live instead.
 */
export const resolveFumeStaticLayers = <T>(
    block: FumeBlock,
    timing: FumeBlockTiming,
    { time, theme, passedGlowBase, passedFadeDuration, overviewTextRestoreProgress, snapshotScale }: FumeStaticLayerInput,
    getSnapshot: (spec: FumeSnapshotSpec) => T | undefined,
): Array<{ snapshot: T; alpha: number }> | null => {
    const { staticState, effectiveTextHoldStyle, passedStyle, waitingOpacity, lineEndTime, colorTrailDuration } = timing;
    if (!staticState) return null;

    const cacheStyleKey = staticState === 'passed' ? effectiveTextHoldStyle : 'base';
    const snapshot = getSnapshot({
        key: `${block.id}:${staticState}:${cacheStyleKey}:${snapshotScale}`,
        fill: staticState === 'waiting'
            ? colorWithAlpha(theme.primaryColor, waitingOpacity)
            : colorWithAlpha(theme.primaryColor, passedStyle.opacity),
        shadowBlur: staticState === 'waiting'
            ? 0
            : (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * passedStyle.glowMultiplier,
        shadowColor: staticState === 'waiting'
            ? 'transparent'
            : colorWithAlpha(theme.primaryColor, passedStyle.shadowAlphaBase),
    });
    if (!snapshot) return null;

    if (staticState === 'passed' && effectiveTextHoldStyle === 'dimmed') {
        const passedAt = lineEndTime + colorTrailDuration;
        const baseDimAmount = resolvePassedDimAmount(time, passedAt, passedFadeDuration);
        const dimAmount = baseDimAmount * (1 - overviewTextRestoreProgress);
        const standardStyle = resolvePassedTextStyle(block.variant, 'standard');
        const standardSnapshot = getSnapshot({
            key: `${block.id}:passed:standard:${snapshotScale}`,
            fill: colorWithAlpha(theme.primaryColor, standardStyle.opacity),
            shadowBlur: (2 + block.fontPx * 0.1) * 0.65 * passedGlowBase * standardStyle.glowMultiplier,
            shadowColor: colorWithAlpha(theme.primaryColor, standardStyle.shadowAlphaBase),
        });

        if (standardSnapshot) {
            if (dimAmount <= 0) return [{ snapshot: standardSnapshot, alpha: 1 }];
            if (dimAmount < 1) {
                return [
                    { snapshot: standardSnapshot, alpha: 1 - dimAmount },
                    { snapshot, alpha: dimAmount },
                ];
            }
        }
    }

    return [{ snapshot, alpha: 1 }];
};
