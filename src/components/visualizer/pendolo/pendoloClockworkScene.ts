import { colorWithAlpha } from '../colorMix';

// src/components/visualizer/pendolo/pendoloClockworkScene.ts
// Frame inputs and color palette for Pendolo clockwork decor.

export type PendoloGearDecorMode = 'none' | 'subtle' | 'full';

export interface PendoloClockworkLayout {
    centerX: number;
    centerY: number;
    baseRadius: number;
    lyricRingRadius: number;
}

export interface PendoloClockworkFrameInput extends PendoloClockworkLayout {
    escapementAngle: number;
    phase: number;
    bassOscillation: number;
    secondGearAngle: number;
    /** 智能动感模式's turn of the transmission gear on the beats, added to its usual one; absent or 0 otherwise. */
    transBeatAngle?: number;
    primaryTextColor: string;
    accentTextColor: string;
    backgroundColor: string;
    showGearDecor: PendoloGearDecorMode;
    showCenterGradient: boolean;
    showCover: boolean;
    coverImage: CanvasImageSource | null;
}

export interface PendoloClockworkPalette {
    decorOpacityMultiplier: number;
    primaryAlpha10: string;
    primaryAlpha15: string;
    accentAlpha35: string;
    gearPrimaryAlpha: string;
    gearPrimarySubtleAlpha: string;
    gearAccentAlpha: string;
    gearAccentStrongAlpha: string;
    planetGearAlpha: string;
    jewelFillColor: string;
    jewelStrokeColor: string;
    mainGearFill: string;
    balanceGearFill: string;
    secondGearFill: string;
    bevelRing: string;
    rivetStroke: string;
    guillocheAlt: string;
    genevaAlt: string;
    idlerStroke: string;
    idlerInner: string;
}

/** Builds theme-tinted stroke/fill colors for the current decor intensity. */
export const buildPendoloClockworkPalette = (
    primaryTextColor: string,
    accentTextColor: string,
    showGearDecor: PendoloGearDecorMode,
): PendoloClockworkPalette => {
    const isFull = showGearDecor === 'full';
    const m = isFull ? 1.0 : 0.6;
    return {
        decorOpacityMultiplier: m,
        primaryAlpha10: colorWithAlpha(primaryTextColor, 0.10 * m),
        primaryAlpha15: colorWithAlpha(primaryTextColor, 0.15 * m),
        accentAlpha35: colorWithAlpha(accentTextColor, 0.35 * m),
        // Keep lyric guide rings/ticks subtle; lift only the mechanical assembly above them.
        gearPrimaryAlpha: colorWithAlpha(primaryTextColor, 0.42 * m),
        gearPrimarySubtleAlpha: colorWithAlpha(primaryTextColor, 0.32 * m),
        gearAccentAlpha: colorWithAlpha(accentTextColor, 0.58 * m),
        gearAccentStrongAlpha: colorWithAlpha(accentTextColor, 0.72 * m),
        planetGearAlpha: colorWithAlpha(primaryTextColor, 0.24 * m),
        jewelFillColor: colorWithAlpha(accentTextColor, 0.28 * m),
        jewelStrokeColor: colorWithAlpha(accentTextColor, 0.65 * m),
        mainGearFill: colorWithAlpha(accentTextColor, 0.08 * m),
        balanceGearFill: colorWithAlpha(accentTextColor, 0.10 * m),
        secondGearFill: colorWithAlpha(accentTextColor, 0.06 * m),
        bevelRing: colorWithAlpha(primaryTextColor, 0.18 * m),
        rivetStroke: colorWithAlpha(primaryTextColor, 0.25 * m),
        guillocheAlt: colorWithAlpha(primaryTextColor, 0.07 * m),
        genevaAlt: colorWithAlpha(primaryTextColor, 0.06 * m),
        idlerStroke: colorWithAlpha(primaryTextColor, 0.28 * m),
        idlerInner: colorWithAlpha(primaryTextColor, 0.18 * m),
    };
};

/** Shared layout anchors used by both Canvas2D and WebGL paths. */
export const resolvePendoloClockworkAnchors = (layout: PendoloClockworkLayout) => {
    const { centerX, centerY, baseRadius, lyricRingRadius } = layout;
    const balanceCx = centerX + baseRadius * 0.2;
    const balanceCy = centerY - baseRadius * 0.75;
    const balanceR = baseRadius * 0.28;
    const transCx = centerX + baseRadius * 0.32;
    const transCy = centerY + baseRadius * 0.78;
    const transR = baseRadius * 0.34;
    const secondGearCx = centerX + baseRadius * 0.68;
    const secondGearCy = centerY + baseRadius * 0.76;
    const secondGearR = baseRadius * 0.16;
    const idlerCx = (transCx + secondGearCx) * 0.5 + baseRadius * 0.04;
    const idlerCy = (transCy + secondGearCy) * 0.5 - baseRadius * 0.02;
    const idlerR = baseRadius * 0.08;
    const focalAxisEndRadius = Math.min(
        lyricRingRadius - Math.max(14, baseRadius * 0.025),
    );
    return {
        balanceCx,
        balanceCy,
        balanceR,
        transCx,
        transCy,
        transR,
        secondGearCx,
        secondGearCy,
        secondGearR,
        idlerCx,
        idlerCy,
        idlerR,
        focalAxisEndRadius,
        orbitR: baseRadius * 0.52,
        planetR: baseRadius * 0.16,
        coverRadius: baseRadius * 0.88,
        gradientR: baseRadius * 1.65,
    };
};

/** Resolves the furthest clockwork pixel from the wheel centre in CSS pixels. */
const resolveClockworkReach = (baseRadius: number, hasCenterGradient: boolean) => (
    baseRadius * (hasCenterGradient ? 1.65 : 1.4) + 16
);

export interface PendoloClockworkBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Bounds the canvas to the clockwork instead of allocating transparent pixels for the viewport. */
export const resolvePendoloClockworkBox = (
    centerX: number,
    centerY: number,
    baseRadius: number,
    lyricRingRadius: number,
    viewportWidth: number,
    viewportHeight: number,
    hasCenterGradient: boolean,
): PendoloClockworkBox => {
    const reach = resolveClockworkReach(baseRadius, hasCenterGradient);
    const rightReach = Math.max(reach, lyricRingRadius + 16);
    const left = Math.max(0, Math.floor(centerX - reach));
    const top = Math.max(0, Math.floor(centerY - reach));
    const right = Math.min(viewportWidth, Math.ceil(centerX + rightReach));
    const bottom = Math.min(viewportHeight, Math.ceil(centerY + reach));

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
};
