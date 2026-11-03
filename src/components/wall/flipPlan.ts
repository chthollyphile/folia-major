// src/components/wall/flipPlan.ts

import { MAX_RENDERED_INSTANCES, getPitch, overlaps, type Bounds, type WallMetrics } from './layout';
import type { WallSlot } from './wallSlots';

// Split-flap plan for one content change: diff what each slot shows before and after, flip only the
// slots whose content changed, stagger them outward from the transition's origin, and swap anything
// off screen (or past the tile budget) instantly. Timing lives here; animating it is the caller's.

/** One tile's full turn (out to 90 degrees, swap, back). */
export const FLIP_DURATION_MS = 360;
export const FLIP_STAGGER_MS_PER_CELL = 18;
export const FLIP_MAX_DELAY_MS = 420;
/** At most this many tiles animate in one flip - the same budget as one rendered viewport. */
export const FLIP_MAX_TILES = MAX_RENDERED_INSTANCES;

/**
 * Where the wave starts: a point (the clicked start tile, or the split for back), or both edges of
 * the split (filter results), where distance is measured horizontally from the split line - or
 * vertically from it, for a split between two block rows (`y`).
 */
export type FlipOrigin =
    | { kind: 'point'; x: number; y: number }
    | { kind: 'seam-edges'; x: number }
    | { kind: 'seam-edges'; y: number };

/** Content key a slot shows before and after; null is bare wall (or a reserved slot). */
export type FlipSlotChange = { slot: WallSlot; from: string | null; to: string | null };

export type FlipStep = {
    key: string;
    to: string | null;
    delay: number;
    /** Turn away from the origin: -1 for tiles left of it, 1 otherwise. */
    direction: -1 | 1;
};

export type FlipPlan = {
    flips: FlipStep[];
    /** Changed slots replaced without animation (off screen, or beyond the tile budget). */
    swaps: Array<{ key: string; to: string | null }>;
    unchanged: number;
    /** Until the last flip lands; 0 when nothing flips. */
    durationMs: number;
};

const distanceFromOrigin = (slot: WallSlot, origin: FlipOrigin) => {
    if (origin.kind === 'point') return Math.hypot(slot.centerX - origin.x, slot.centerY - origin.y);
    return 'x' in origin ? Math.abs(slot.centerX - origin.x) : Math.abs(slot.centerY - origin.y);
};

/** Tiles turn about their vertical axis, away from the origin's x; a row split has no x, so all turn one way. */
const directionFromOrigin = (slot: WallSlot, origin: FlipOrigin): -1 | 1 => (
    'x' in origin && slot.centerX < origin.x ? -1 : 1
);

export const getFlipDelay = (distance: number, metrics: WallMetrics) => (
    Math.min(FLIP_MAX_DELAY_MS, (distance / getPitch(metrics)) * FLIP_STAGGER_MS_PER_CELL)
);

/**
 * Builds the flip schedule. `visible` is the world rect that may animate - the viewport plus
 * whatever overscan the caller renders. Within it the nearest changed slots flip first and the
 * budget keeps the nearest `maxTiles`; everything else that changed is swapped in place.
 */
export const planFlip = ({
    changes,
    origin,
    visible,
    metrics,
    maxTiles = FLIP_MAX_TILES,
}: {
    changes: readonly FlipSlotChange[];
    origin: FlipOrigin;
    visible: Bounds;
    metrics: WallMetrics;
    maxTiles?: number;
}): FlipPlan => {
    const candidates: Array<{ change: FlipSlotChange; distance: number }> = [];
    const swaps: FlipPlan['swaps'] = [];
    let unchanged = 0;

    for (const change of changes) {
        if (change.from === change.to) {
            unchanged += 1;
            continue;
        }
        const { slot } = change;
        const slotBounds = { left: slot.x, right: slot.x + slot.width, top: slot.y, bottom: slot.y + slot.height };
        if (overlaps(slotBounds, visible)) candidates.push({ change, distance: distanceFromOrigin(slot, origin) });
        else swaps.push({ key: slot.key, to: change.to });
    }

    candidates.sort((first, second) => first.distance - second.distance);
    const flips: FlipStep[] = [];
    let maxDelay = 0;
    candidates.forEach(({ change, distance }, index) => {
        if (index >= maxTiles) {
            swaps.push({ key: change.slot.key, to: change.to });
            return;
        }
        const delay = getFlipDelay(distance, metrics);
        maxDelay = Math.max(maxDelay, delay);
        flips.push({ key: change.slot.key, to: change.to, delay, direction: directionFromOrigin(change.slot, origin) });
    });

    return { flips, swaps, unchanged, durationMs: flips.length ? maxDelay + FLIP_DURATION_MS : 0 };
};
