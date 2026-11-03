// src/components/wall/finiteWall.ts

import { getBlockCapacity } from './blockReservedSlots';
import { SLOTS_PER_BLOCK } from './blockTemplates';
import { getLatticeGeometry, type Bounds, type WallMetrics } from './layout';
import { indexRanks, rankSlots, type WallPoint } from './rankSlots';
import { getSeamCameraSpan, getSeamCameraSpanY, type SeamAxis } from './seamPlan';
import { getViewLineX, getViewWorldBounds, type WallView, type WallViewCenter } from './wallView';
import { collectBlockRangeSlots, getBlockSize, type BlockRange, type WallSlot } from './wallSlots';

// The finite wall: no wrapping, every item at most once, unused slots stay bare wall. Its world is
// the fewest whole blocks that hold the items (after reserved slots), laid out landscape like the
// Lattice cell (FIELD_ASPECT via getLatticeGeometry) and never smaller than the viewport. Ranks are
// assigned inside that world; the camera is clamped to the occupied part and locks when it fits.

export type FiniteWallInput = {
    /** Plan with the layer's full count: filtering only changes how many ranks carry content. */
    itemCount: number;
    reservedPerBlock?: number;
    metrics: WallMetrics;
    view: WallView;
    /** Rank origin: the seam point, or the start tile's centre. */
    origin: WallPoint;
    startSlotKey?: string | null;
    /** Where the camera is looking now; the world always covers this screen. Defaults to `origin`. */
    viewCenter?: WallViewCenter;
};

export type FiniteWallPlan = {
    columns: BlockRange;
    rows: BlockRange;
    /** World rect of the whole finite wall, bare slots included. */
    bounds: Bounds;
    /** Non-reserved slots in the world; always >= itemCount. */
    capacity: number;
    /** Strict rank order over the world's non-reserved slots. */
    order: WallSlot[];
    rankOfSlot: Map<string, number>;
};

const centredRange = (center: number, count: number): BlockRange => {
    const from = Math.round(center - count / 2);
    return { from, to: from + count };
};

const unionRange = (first: BlockRange, second: BlockRange): BlockRange => ({
    from: Math.min(first.from, second.from),
    to: Math.max(first.to, second.to),
});

/** Block rectangle of the finite world: content-sized around the origin, grown to cover the screen. */
export const getFiniteWallBlocks = (input: FiniteWallInput) => {
    const perBlock = getBlockCapacity(input.reservedPerBlock ?? 0);
    const blocks = Math.max(1, Math.ceil(Math.max(0, input.itemCount) / perBlock));
    const geometry = getLatticeGeometry(blocks * SLOTS_PER_BLOCK, input.metrics);
    const block = getBlockSize(input.metrics);

    const screen = getViewWorldBounds(input.viewCenter ?? input.origin, input.view);
    const screenColumns = { from: Math.floor(screen.left / block.width), to: Math.floor(screen.right / block.width) + 1 };
    const screenRows = { from: Math.floor(screen.top / block.height), to: Math.floor(screen.bottom / block.height) + 1 };
    const columns = unionRange(centredRange(input.origin.x / block.width, geometry.blocksPerRow), screenColumns);
    const rows = unionRange(centredRange(input.origin.y / block.height, geometry.blockRows), screenRows);

    return {
        columns,
        rows,
        bounds: {
            left: columns.from * block.width,
            right: columns.to * block.width - input.metrics.gap,
            top: rows.from * block.height,
            bottom: rows.to * block.height - input.metrics.gap,
        },
        capacity: (columns.to - columns.from) * (rows.to - rows.from) * perBlock,
    };
};

export const planFiniteWall = (input: FiniteWallInput): FiniteWallPlan => {
    const world = getFiniteWallBlocks(input);
    const order = rankSlots(collectBlockRangeSlots(world.columns, world.rows, input.metrics), {
        origin: input.origin,
        metrics: input.metrics,
        reservedPerBlock: input.reservedPerBlock,
        startSlotKey: input.startSlotKey,
    });
    return { ...world, order, rankOfSlot: indexRanks(order) };
};

/** Bounding rect of the first `count` ranks - the part of the world that has content. */
export const getRankedContentBounds = (order: readonly WallSlot[], count: number): Bounds | null => {
    const used = order.slice(0, Math.max(0, count));
    if (!used.length) return null;
    return {
        left: Math.min(...used.map(slot => slot.x)),
        right: Math.max(...used.map(slot => slot.x + slot.width)),
        top: Math.min(...used.map(slot => slot.y)),
        bottom: Math.max(...used.map(slot => slot.y + slot.height)),
    };
};

export type WallCameraRange = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    /** Content fits across / down the screen: the content clamp collapsed onto the anchor. */
    lockedX: boolean;
    lockedY: boolean;
};

export const FINITE_CAMERA_PAD = 60;

/**
 * Clamp for a finite layer's view centre: the content rect (plus a small pad) minus the screen on
 * either side of the split, locked onto the anchor when the content fits; then widened so the anchor
 * itself may sit anywhere the whole opening fits, and so the anchor point is always reachable.
 * A row split (`seamAxis: 'y'`) takes its opening out of the screen's height instead.
 */
export const getFiniteCameraRange = ({
    contentBounds,
    anchor,
    view,
    seamWidth,
    seamAxis = 'x',
    pad = FINITE_CAMERA_PAD,
}: {
    contentBounds: Bounds | null;
    anchor: WallPoint;
    view: WallView;
    /** The layer's target opening (not the animated one). */
    seamWidth: number;
    seamAxis?: SeamAxis;
    pad?: number;
}): WallCameraRange => {
    const { scale } = view;
    const lineX = getViewLineX(view);
    const across = seamAxis === 'x' ? seamWidth : 0;
    const down = seamAxis === 'y' ? seamWidth : 0;
    const leftSpan = (lineX - across / 2) / scale;
    const rightSpan = (view.width - lineX - across / 2) / scale;
    const halfHeight = (view.height / 2 - down / 2) / scale;
    const content = contentBounds ?? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };

    let minX = content.left + leftSpan - pad;
    let maxX = content.right - rightSpan + pad;
    let minY = content.top + halfHeight - pad;
    let maxY = content.bottom - halfHeight + pad;
    const lockedX = minX > maxX;
    const lockedY = minY > maxY;
    if (lockedX) minX = maxX = anchor.x;
    if (lockedY) minY = maxY = anchor.y;

    const spanX = seamAxis === 'x' ? getSeamCameraSpan({ anchorX: anchor.x, openWidth: seamWidth, view }) : { min: anchor.x, max: anchor.x };
    const spanY = seamAxis === 'y' ? getSeamCameraSpanY({ anchorY: anchor.y, openWidth: seamWidth, view }) : { min: anchor.y, max: anchor.y };
    return {
        minX: Math.min(minX, spanX.min),
        maxX: Math.max(maxX, spanX.max),
        minY: Math.min(minY, spanY.min),
        maxY: Math.max(maxY, spanY.max),
        lockedX,
        lockedY,
    };
};

/** Where a released camera settles: the nearest point inside the range. */
export const clampToCameraRange = (center: WallViewCenter, range: WallCameraRange): WallViewCenter => ({
    x: Math.min(range.maxX, Math.max(range.minX, center.x)),
    y: Math.min(range.maxY, Math.max(range.minY, center.y)),
});

/** One drag step on one axis: full speed inside the range, resisted outside it (rubber band). */
export const stepCameraAxis = (value: number, delta: number, min: number, max: number, resistance = 0.35) => {
    const next = value + delta;
    return next < min || next > max ? value + delta * resistance : next;
};
