import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { type Line, type PendoloTuning } from '../../../types';

// src/components/visualizer/pendolo/pendoloGeometry.ts

export interface PendoloLineItem {
    line: Line;
    index: number;
    angleRad: number;
    angleDeg: number;
    x: number;
    y: number;
    isActive: boolean;
    distanceFromActive: number;
    alpha: number;
    scale: number;
}

/** 轮心的屏幕横坐标：wheelCenterX 原样从左边缘量，镜像时从右边缘量。 */
export const resolvePendoloWheelCenterX = (viewportWidth: number, tuning: PendoloTuning) => (
    tuning.mirrorLayout === true
        ? viewportWidth * (1 - tuning.wheelCenterX)
        : viewportWidth * tuning.wheelCenterX
);

/**
 * Calculates wheel geometry and placement for lyric lines along the pendulum escapement arc.
 */
export function calculatePendoloWheelLayout(
    lines: Line[],
    targetLineIndex: number,
    escapementAngleOffsetRad: number,
    viewportWidth: number,
    viewportHeight: number,
    tuning: PendoloTuning,
    radiusOffsetPx = 0,
    lineBlockHeights?: number[],
): PendoloLineItem[] {
    // 镜像时轮心从右边缘量，弧线朝左展开；上下方向不变（后面的句子仍往下排）
    const mirrored = tuning.mirrorLayout === true;
    const centerX = resolvePendoloWheelCenterX(viewportWidth, tuning);
    const sideSign = mirrored ? -1 : 1;
    const centerY = viewportHeight * tuning.wheelCenterY;
    const baseRadius = Math.min(viewportWidth, viewportHeight) * tuning.arcRadius + radiusOffsetPx;

    // Angle step between adjacent lyric lines along the wheel arc (in radians)
    const totalArcRad = (tuning.arcAngleDeg * Math.PI) / 180;
    const visibleWindowCount = 9; // Number of lines visible across the arc window
    const angleStepRad = totalArcRad / Math.max(1, visibleWindowCount - 1);

    const isIntegerTarget = Number.isInteger(targetLineIndex);
    const activeIndex = isIntegerTarget && targetLineIndex >= 0 && targetLineIndex < lines.length
        ? targetLineIndex
        : -1;
    const hasActive = activeIndex >= 0;
    const items: PendoloLineItem[] = [];

    // Reference center for rendering window
    const centerRef = Math.max(0, Math.min(lines.length - 1, Math.floor(targetLineIndex >= 0 ? targetLineIndex : 0)));
    // Wide enough index window; actual visibility is angle-gated at ±90° (right semicircle only)
    const windowStart = Math.max(0, centerRef - 8);
    const windowEnd = Math.min(lines.length - 1, centerRef + 8);
    const visualAngles = new Map<number, number>();

    if (Number.isInteger(targetLineIndex) && targetLineIndex >= windowStart && targetLineIndex <= windowEnd) {
        const activeIndex = targetLineIndex;
        visualAngles.set(activeIndex, 0);
        for (let index = activeIndex + 1; index <= windowEnd; index += 1) {
            const previousHeight = lineBlockHeights?.[index - 1] ?? 0;
            const currentHeight = lineBlockHeights?.[index] ?? 0;
            const spacing = Math.max(angleStepRad, (previousHeight + currentHeight + 24) / (2 * baseRadius));
            visualAngles.set(index, (visualAngles.get(index - 1) ?? 0) + spacing);
        }
        for (let index = activeIndex - 1; index >= windowStart; index -= 1) {
            const nextHeight = lineBlockHeights?.[index + 1] ?? 0;
            const currentHeight = lineBlockHeights?.[index] ?? 0;
            const spacing = Math.max(angleStepRad, (nextHeight + currentHeight + 24) / (2 * baseRadius));
            visualAngles.set(index, (visualAngles.get(index + 1) ?? 0) - spacing);
        }
    }

    for (let i = windowStart; i <= windowEnd; i++) {
        const line = lines[i];
        if (!line) continue;

        const distanceIndex = i - targetLineIndex;
        // Base focal angle is 0 (horizontal to right).
        // Upcoming lines curve downward (positive angle), past lines curve upward (negative angle).
        const rawAngleRad = (visualAngles.get(i) ?? distanceIndex * angleStepRad) + escapementAngleOffsetRad;

        // Only render lines on the right semicircle (±90° from focal axis)
        if (Math.abs(rawAngleRad) >= Math.PI / 2) continue;

        // Cartesian coordinates on screen relative to center on left edge
        const x = centerX + sideSign * baseRadius * Math.cos(rawAngleRad);
        const y = centerY + baseRadius * Math.sin(rawAngleRad);

        const isActive = hasActive && i === activeIndex;
        const absDistance = Math.abs(distanceIndex);

        // Alpha decays smoothly as lines move further from the focal position (angle = 0)
        const alpha = Math.max(0.12, Math.pow(Math.cos(rawAngleRad * 0.75), 2.5) * (1 - absDistance * 0.18));

        // Focal line gets activeScale boost, neighboring lines scale down gracefully
        const scale = isActive
            ? tuning.activeScale
            : Math.max(0.7, 1 - absDistance * 0.08);

        items.push({
            line,
            index: i,
            angleRad: rawAngleRad,
            angleDeg: (rawAngleRad * 180) / Math.PI,
            x,
            y,
            isActive,
            distanceFromActive: absDistance,
            alpha,
            scale,
        });
    }

    return items;
}

/**
 * Measures line width using @chenglou/pretext for precise typography alignment.
 */
export function measurePendoloLineWidth(text: string, fontSpec: string): number {
    if (!text) return 0;
    try {
        const prepared = prepareWithSegments(text, fontSpec);
        const layout = layoutWithLines(prepared, 2000, 32);
        return layout.lines[0]?.width ?? 0;
    } catch {
        return text.length * 16;
    }
}
