import { type LineRenderHints } from '../../../utils/lyrics/renderHints';
import { type BrutInstallUnit } from './brutLyricUnits';

// src/components/visualizer/brut/brutInstallMotion.ts
// How one token gets installed: a concrete slab pushes out of the wall, then the token IGNITES on
// its face. Nothing flies through the air and nothing is bolted on - the wall itself produces the
// surface, and the word appears as light on it.
//
// Both curves are PURE functions of absolute playback time, with no delta and no stored state,
// which is what makes seeking free: there is nothing to reset, the curve simply evaluates to the
// terminal pose.

export interface BrutRevealTiming {
    /** How long before a token the slab starts pushing out. */
    lead: number;
    emerge: number;
    igniteMin: number;
    igniteMax: number;
    /** Micro lines skip the per-token reveal entirely. */
    instant: boolean;
}

export interface BrutSlabState {
    visible: boolean;
    /** 0 = flush with the wall, 1 = fully extruded. */
    extend: number;
}

export interface BrutInstallState {
    visible: boolean;
    /** 0 = dark plate, 1 = fully lit token. */
    ignite: number;
    alpha: number;
    /** 0 = idle ink, 1 = fully sung. */
    tint: number;
    /** Short over-bright spike as the token catches. */
    flash: number;
    scale: number;
}

const FLASH_HALF_LIFE = 0.2;

export const createBrutSlabState = (): BrutSlabState => ({ visible: false, extend: 0 });

export const createBrutInstallState = (): BrutInstallState => ({
    visible: false,
    ignite: 0,
    alpha: 0,
    tint: 0,
    flash: 0,
    scale: 1,
});

export const resolveBrutRevealTiming = (hints: LineRenderHints | null | undefined): BrutRevealTiming => {
    if (hints?.wordRevealMode === 'instant') {
        return { lead: 0, emerge: 0, igniteMin: 0, igniteMax: 0, instant: true };
    }
    if (hints?.wordRevealMode === 'fast') {
        return { lead: 0.16, emerge: 0.16, igniteMin: 0.04, igniteMax: 0.09, instant: false };
    }
    return { lead: 0.42, emerge: 0.34, igniteMin: 0.08, igniteMax: 0.22, instant: false };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

export const resolveBrutIgniteDuration = (unit: BrutInstallUnit, timing: BrutRevealTiming): number => {
    if (timing.instant) {
        return 0;
    }
    const span = Math.max(0, unit.endTime - unit.startTime) * 0.6;
    return Math.max(timing.igniteMin, Math.min(timing.igniteMax, span));
};

/** Extrusion of the slab that will carry `unit`. Writes into `out`; never allocates. */
export const resolveBrutSlabState = (
    unit: BrutInstallUnit,
    now: number,
    timing: BrutRevealTiming,
    out: BrutSlabState,
): BrutSlabState => {
    const from = unit.startTime - timing.lead - timing.emerge;
    if (now < from) {
        out.visible = false;
        out.extend = 0;
        return out;
    }

    const progress = timing.emerge > 0 ? clamp01((now - from) / timing.emerge) : 1;
    out.visible = true;
    out.extend = 0.06 + 0.94 * easeOutCubic(progress);
    return out;
};

/** Ignition of the token on its slab. Writes into `out`; never allocates. */
export const resolveBrutInstallState = (
    unit: BrutInstallUnit,
    now: number,
    timing: BrutRevealTiming,
    out: BrutInstallState,
): BrutInstallState => {
    const ignite = resolveBrutIgniteDuration(unit, timing);
    const sungSpan = Math.max(0.05, unit.endTime - unit.startTime);
    out.tint = clamp01((now - unit.startTime) / sungSpan);

    if (now < unit.startTime) {
        out.visible = false;
        out.ignite = 0;
        out.alpha = 0;
        out.tint = 0;
        out.flash = 0;
        out.scale = 1;
        return out;
    }

    const progress = ignite > 0 ? clamp01((now - unit.startTime) / ignite) : 1;
    const eased = easeOutCubic(progress);
    out.visible = true;
    out.ignite = eased;
    out.alpha = eased;
    // The token swells very slightly as it catches, then settles - the light does the work, not motion.
    out.scale = 1 + (1 - eased) * 0.06;
    out.flash = Math.max(0, 1 - Math.abs(now - unit.startTime) / FLASH_HALF_LIFE);
    return out;
};
