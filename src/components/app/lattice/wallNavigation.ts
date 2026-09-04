// src/components/app/lattice/wallNavigation.ts

import { SLOTS_PER_BLOCK } from './blockTemplates';
import {
    getInstanceBlock,
    locateInstanceAt,
    type LatticeGeometry,
    type QueueInstance,
    type WallMetrics,
} from './layout';

// Directional focus movement. The lattice has no edge, so a step always lands somewhere; the
// search runs on geometry rather than the rendered set, and freely crosses into the next cell.

export type WallDirection = 'up' | 'down' | 'left' | 'right';

type Axis = {
    along: 'x' | 'y';
    cross: 'y' | 'x';
    alongSize: 'width' | 'height';
    crossSize: 'height' | 'width';
    sign: 1 | -1;
};

const AXES: Record<WallDirection, Axis> = {
    right: { along: 'x', cross: 'y', alongSize: 'width', crossSize: 'height', sign: 1 },
    left: { along: 'x', cross: 'y', alongSize: 'width', crossSize: 'height', sign: -1 },
    down: { along: 'y', cross: 'x', alongSize: 'height', crossSize: 'width', sign: 1 },
    up: { along: 'y', cross: 'x', alongSize: 'height', crossSize: 'width', sign: -1 },
};

const centerOf = (instance: QueueInstance, axis: 'x' | 'y', size: 'width' | 'height') => (
    instance[axis] + instance[size] / 2
);

// Positive when the two spans truly share a band, zero when they merely touch, negative by the
// size of the gap when they miss entirely.
const crossOverlap = (a: QueueInstance, b: QueueInstance, axis: Axis) => {
    const aStart = a[axis.cross];
    const bStart = b[axis.cross];
    return Math.min(aStart + a[axis.crossSize], bStart + b[axis.crossSize]) - Math.max(aStart, bStart);
};

// Gap between the trailing edge of `from` and the leading edge of `candidate` along the travel
// axis; negative whenever the candidate is not wholly ahead, which disqualifies it.
const alongGap = (from: QueueInstance, candidate: QueueInstance, axis: Axis) => (
    axis.sign === 1
        ? candidate[axis.along] - (from[axis.along] + from[axis.alongSize])
        : from[axis.along] - (candidate[axis.along] + candidate[axis.alongSize])
);

/**
 * Picks the poster a directional key should move to, scanning the blocks around the current one.
 * A candidate has to sit wholly ahead on the travel axis; the score then prefers a short step and
 * penalises both sideways drift and failing to share a band with the poster being left, so arrows
 * walk a row instead of cutting corners.
 */
export const findAdjacentInstance = (
    from: QueueInstance,
    direction: WallDirection,
    geometry: LatticeGeometry,
    totalEntries: number,
    metrics: WallMetrics,
    rendered?: Map<string, { x: number; y: number; width: number; height: number }>,
): QueueInstance | null => {
    if (totalEntries <= 0) return null;

    // Inside the block holding an expanded card every poster has been re-geared, so navigate by
    // where things are actually drawn; otherwise the ring lands somewhere the arrow did not point.
    const drawn = (instance: QueueInstance): QueueInstance => {
        const override = rendered?.get(instance.instanceId);
        return override ? { ...instance, ...override } : instance;
    };

    const axis = AXES[direction];
    const missPenalty = metrics.cellSize + metrics.gap;
    const source = drawn(from);
    const origin = getInstanceBlock(geometry, from);

    let best: QueueInstance | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestCross = Number.POSITIVE_INFINITY;

    for (let row = origin.row - 1; row <= origin.row + 1; row += 1) {
        for (let column = origin.column - 1; column <= origin.column + 1; column += 1) {
            for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex += 1) {
                const base = locateInstanceAt(geometry, totalEntries, column, row, slotIndex, metrics);
                if (!base || base.instanceId === from.instanceId) continue;
                const candidate = drawn(base);

                const step = alongGap(source, candidate, axis);
                if (step < 0) continue;

                const overlap = crossOverlap(source, candidate, axis);
                const score = step + (overlap > 0 ? 0 : -overlap * 2 + missPenalty);
                const crossDelta = Math.abs(
                    centerOf(candidate, axis.cross, axis.crossSize)
                    - centerOf(source, axis.cross, axis.crossSize),
                );
                if (score < bestScore || (score === bestScore && crossDelta < bestCross)) {
                    bestScore = score;
                    bestCross = crossDelta;
                    best = base;
                }
            }
        }
    }

    return best;
};

// Seeds keyboard focus from whatever is already on screen when nothing is focused yet.
export const findNearestInstance = (
    instances: QueueInstance[],
    point: { x: number; y: number },
): QueueInstance | null => {
    let best: QueueInstance | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const instance of instances) {
        const dx = instance.x + instance.width / 2 - point.x;
        const dy = instance.y + instance.height / 2 - point.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = instance;
        }
    }

    return best;
};
