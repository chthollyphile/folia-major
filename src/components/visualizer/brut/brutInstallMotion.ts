import { type LineRenderHints } from '../../../utils/lyrics/renderHints';
import { type BrutInstallUnit } from './brutLyricUnits';

// src/components/visualizer/brut/brutInstallMotion.ts
// The install curve for one character plate: recessed in the wall -> slammed onto the frame ->
// settling. A PURE function of absolute playback time, with no delta and no stored state, which is
// what makes seeking free: there is no animation state to reset, the curve simply evaluates to the
// terminal pose.

export interface BrutRevealTiming {
    /** Lead time the empty slot is visible before the plate arrives. */
    pre: number;
    slamMin: number;
    slamMax: number;
    /** Micro lines skip the per-character reveal entirely. */
    instant: boolean;
}

export interface BrutInstallState {
    visible: boolean;
    /** Offset along the frame normal. Negative is recessed into the wall. */
    z: number;
    y: number;
    roll: number;
    scale: number;
    alpha: number;
    /** 0 = idle ink, 1 = fully sung. */
    tint: number;
    flash: number;
}

const SETTLE_DURATION = 0.22;
const FLASH_HALF_LIFE = 0.16;
const RECESSED_Z = -0.5;
const RESTING_Z = 0.02;
const GHOST_SCALE = 1.14;
const GHOST_ALPHA = 0.22;

export const createBrutInstallState = (): BrutInstallState => ({
    visible: false,
    z: RECESSED_Z,
    y: 0,
    roll: 0,
    scale: GHOST_SCALE,
    alpha: 0,
    tint: 0,
    flash: 0,
});

export const resolveBrutRevealTiming = (hints: LineRenderHints | null | undefined): BrutRevealTiming => {
    if (hints?.wordRevealMode === 'instant') {
        return { pre: 0, slamMin: 0, slamMax: 0, instant: true };
    }
    if (hints?.wordRevealMode === 'fast') {
        return { pre: 0.08, slamMin: 0.03, slamMax: 0.06, instant: false };
    }
    return { pre: 0.28, slamMin: 0.055, slamMax: 0.16, instant: false };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Overshooting ease so the plate visibly hits the frame rather than gliding onto it. */
const easeOutBack = (value: number): number => {
    const overshoot = 1.70158;
    const shifted = value - 1;
    return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
};

export interface BrutBracketState {
    visible: boolean;
    /** Protrusion offset; negative is still buried in the concrete. */
    z: number;
    /** 0 = a stub, 1 = the full bracket. */
    extend: number;
}

export const createBrutBracketState = (): BrutBracketState => ({ visible: false, z: 0, extend: 0 });

/** The bracket is bolted on BEFORE its token arrives, so the token has somewhere to land. */
const BRACKET_LEAD = 0.4;
const BRACKET_DURATION = 0.34;
const BRACKET_RECESSED_Z = -0.26;

export const resolveBrutBracketState = (
    unit: BrutInstallUnit,
    now: number,
    timing: BrutRevealTiming,
    out: BrutBracketState,
): BrutBracketState => {
    const from = unit.startTime - timing.pre - BRACKET_LEAD;
    if (now < from) {
        out.visible = false;
        out.z = BRACKET_RECESSED_Z;
        out.extend = 0;
        return out;
    }

    const progress = timing.instant ? 1 : clamp01((now - from) / BRACKET_DURATION);
    const eased = 1 - (1 - progress) * (1 - progress);
    out.visible = true;
    out.z = BRACKET_RECESSED_Z * (1 - eased);
    out.extend = 0.16 + 0.84 * eased;
    return out;
};

export const resolveBrutUnitSlam = (unit: BrutInstallUnit, timing: BrutRevealTiming): number => {
    if (timing.instant) {
        return 0;
    }
    const span = Math.max(0, unit.endTime - unit.startTime) * 0.5;
    return Math.max(timing.slamMin, Math.min(timing.slamMax, span));
};

/** Writes the plate pose for `now` into `out`. Never allocates. */
export const resolveBrutInstallState = (
    unit: BrutInstallUnit,
    now: number,
    timing: BrutRevealTiming,
    restRoll: number,
    out: BrutInstallState,
): BrutInstallState => {
    const slam = resolveBrutUnitSlam(unit, timing);
    const ghostStart = unit.startTime - timing.pre;
    const sungSpan = Math.max(0.05, unit.endTime - unit.startTime);
    out.tint = clamp01((now - unit.startTime) / sungSpan);

    if (now < ghostStart) {
        out.visible = false;
        out.alpha = 0;
        out.flash = 0;
        return out;
    }

    out.visible = true;

    if (now < unit.startTime) {
        const ghost = timing.pre > 0 ? clamp01((now - ghostStart) / timing.pre) : 1;
        out.z = RECESSED_Z;
        out.y = 0.12;
        out.roll = restRoll * 0.4;
        out.scale = GHOST_SCALE;
        out.alpha = GHOST_ALPHA * ghost;
        out.tint = 0;
        out.flash = 0;
        return out;
    }

    const impactAt = unit.startTime + slam;
    const progress = slam > 0 ? clamp01((now - unit.startTime) / slam) : 1;
    const eased = slam > 0 ? easeOutBack(progress) : 1;

    out.z = RECESSED_Z + (RESTING_Z - RECESSED_Z) * eased;
    out.y = 0.12 * (1 - eased);
    out.roll = restRoll * eased;
    out.scale = GHOST_SCALE + (1 - GHOST_SCALE) * eased;
    out.alpha = Math.min(1, GHOST_ALPHA + progress * 2.2);
    out.flash = Math.max(0, 1 - Math.abs(now - impactAt) / FLASH_HALF_LIFE);

    const settle = now - impactAt;
    if (settle > 0 && settle < SETTLE_DURATION) {
        const wobble = Math.exp(-9 * settle) * Math.cos(26 * settle) * 0.02;
        out.z += wobble;
        out.roll += wobble * 0.5;
    }

    return out;
};
