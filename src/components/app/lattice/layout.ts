// Pure geometry for the poster wall: an infinite lattice of repeated cells, plus the
// anchored expansion reflow that pushes neighbours aside.

import {
    BLOCK_COLS,
    BLOCK_ROWS,
    SLOTS_PER_BLOCK,
    getBlockReflow,
    getBlockTemplate,
    type BlockSlot,
} from './blockTemplates';

export type TileSpan = { cols: number; rows: number };

export type WallMetrics = { cellSize: number; gap: number };

export type Bounds = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

export type ReflowTile = {
    instanceId: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * One drawn poster. The queue is de-duplicated at the data layer, but the wall repeats, so a
 * song owns many instances: `cellSlot` is its seat inside one lattice cell and `repeatX/Y`
 * says which copy of the cell this is.
 */
export type QueueInstance = {
    instanceId: string;
    queueIndex: number;
    cellSlot: number;
    repeatX: number;
    repeatY: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

/** The repeating unit: a rectangle of blocks holding one pass over the queue. */
export type LatticeGeometry = {
    blocksPerRow: number;
    blockRows: number;
    cellSlots: number;
    cellWidth: number;
    cellHeight: number;
    blockWidth: number;
    blockHeight: number;
};

export const overlaps = (first: Bounds, second: Bounds) => (
    first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
);

export const toBounds = (tile: Omit<ReflowTile, 'instanceId'>): Bounds => ({
    left: tile.x,
    right: tile.x + tile.width,
    top: tile.y,
    bottom: tile.y + tile.height,
});

// Aspect of the repeating cell. Below 1 the queue would recur vertically far sooner than
// horizontally, which reads as stripes; a mild landscape bias keeps the recurrence even.
const FIELD_ASPECT = 2.2;

// Ceiling on posters built for one viewport, so an extreme zoom-out cannot stall a frame.
const MAX_RENDERED_INSTANCES = 400;

const getPitch = (metrics: WallMetrics) => metrics.cellSize + metrics.gap;

export const getLatticeGeometry = (totalEntries: number, metrics: WallMetrics): LatticeGeometry => {
    const pitch = getPitch(metrics);
    const blockWidth = BLOCK_COLS * pitch;
    const blockHeight = BLOCK_ROWS * pitch;
    const blocks = Math.max(1, Math.ceil(Math.max(0, totalEntries) / SLOTS_PER_BLOCK));
    const blocksPerRow = blocks <= 1
        ? 1
        : Math.max(1, Math.round(Math.sqrt(FIELD_ASPECT * blocks * BLOCK_ROWS / BLOCK_COLS)));
    const blockRows = Math.ceil(blocks / blocksPerRow);

    return {
        blocksPerRow,
        blockRows,
        cellSlots: blocksPerRow * blockRows * SLOTS_PER_BLOCK,
        cellWidth: blocksPerRow * blockWidth,
        cellHeight: blockRows * blockHeight,
        blockWidth,
        blockHeight,
    };
};

/**
 * Builds the poster sitting in one slot of one block, addressed by unbounded block coordinates.
 * The template is chosen from the block's position **inside** its cell, which is what makes the
 * lattice periodic; the cell index only contributes a translation.
 */
const buildInstance = (
    geometry: LatticeGeometry,
    totalEntries: number,
    absoluteColumn: number,
    absoluteRow: number,
    slotIndex: number,
    metrics: WallMetrics,
): QueueInstance => {
    const repeatX = Math.floor(absoluteColumn / geometry.blocksPerRow);
    const repeatY = Math.floor(absoluteRow / geometry.blockRows);
    const localColumn = absoluteColumn - repeatX * geometry.blocksPerRow;
    const localRow = absoluteRow - repeatY * geometry.blockRows;
    const cellSlot = (localRow * geometry.blocksPerRow + localColumn) * SLOTS_PER_BLOCK + slotIndex;
    const slot: BlockSlot = getBlockTemplate(localColumn, localRow)[slotIndex];
    const pitch = getPitch(metrics);

    return {
        instanceId: `${cellSlot}:${repeatX}:${repeatY}`,
        // Cells hold whole blocks, so they seat more posters than the queue has songs. Wrapping
        // fills the remainder instead of leaving a gap that would recur in every cell.
        queueIndex: cellSlot % totalEntries,
        cellSlot,
        repeatX,
        repeatY,
        x: repeatX * geometry.cellWidth + localColumn * geometry.blockWidth + slot.x * pitch,
        y: repeatY * geometry.cellHeight + localRow * geometry.blockHeight + slot.y * pitch,
        width: slot.cols * pitch - metrics.gap,
        height: slot.rows * pitch - metrics.gap,
    };
};

/** Absolute block coordinates an instance sits in; the unit directional navigation steps over. */
export const getInstanceBlock = (geometry: LatticeGeometry, instance: QueueInstance) => {
    const blockInCell = Math.floor(instance.cellSlot / SLOTS_PER_BLOCK);
    return {
        column: instance.repeatX * geometry.blocksPerRow + (blockInCell % geometry.blocksPerRow),
        row: instance.repeatY * geometry.blockRows + Math.floor(blockInCell / geometry.blocksPerRow),
        slotIndex: instance.cellSlot % SLOTS_PER_BLOCK,
    };
};

/** Resolves the poster in a given block slot; block coordinates may be negative. */
export const locateInstanceAt = (
    geometry: LatticeGeometry,
    totalEntries: number,
    absoluteColumn: number,
    absoluteRow: number,
    slotIndex: number,
    metrics: WallMetrics,
): QueueInstance | null => {
    if (totalEntries <= 0 || slotIndex < 0 || slotIndex >= SLOTS_PER_BLOCK) return null;
    return buildInstance(geometry, totalEntries, absoluteColumn, absoluteRow, slotIndex, metrics);
};

/**
 * Copy of one song closest to a world point. A song can seat more than once per cell, so every
 * seat is checked, each snapped to its nearest repeat.
 */
export const locateNearestInstance = (
    geometry: LatticeGeometry,
    totalEntries: number,
    queueIndex: number,
    point: { x: number; y: number },
    metrics: WallMetrics,
): QueueInstance | null => {
    if (totalEntries <= 0 || queueIndex < 0 || queueIndex >= totalEntries) return null;

    let best: QueueInstance | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let cellSlot = queueIndex; cellSlot < geometry.cellSlots; cellSlot += totalEntries) {
        const blockInCell = Math.floor(cellSlot / SLOTS_PER_BLOCK);
        const localColumn = blockInCell % geometry.blocksPerRow;
        const localRow = Math.floor(blockInCell / geometry.blocksPerRow);
        const slotIndex = cellSlot % SLOTS_PER_BLOCK;
        const base = buildInstance(geometry, totalEntries, localColumn, localRow, slotIndex, metrics);
        const repeatX = Math.round((point.x - base.x - base.width / 2) / geometry.cellWidth);
        const repeatY = Math.round((point.y - base.y - base.height / 2) / geometry.cellHeight);
        const candidate = buildInstance(
            geometry,
            totalEntries,
            repeatX * geometry.blocksPerRow + localColumn,
            repeatY * geometry.blockRows + localRow,
            slotIndex,
            metrics,
        );
        const dx = candidate.x + candidate.width / 2 - point.x;
        const dy = candidate.y + candidate.height / 2 - point.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }

    return best;
};

/** Posters intersecting the viewport. Cost scales with what is on screen, never with queue length. */
export const layoutLattice = (
    geometry: LatticeGeometry,
    totalEntries: number,
    bounds: Bounds,
    overscan: number,
    metrics: WallMetrics,
): QueueInstance[] => {
    if (totalEntries <= 0 || geometry.blockWidth <= 0 || geometry.blockHeight <= 0) return [];

    const view = {
        left: bounds.left - overscan,
        right: bounds.right + overscan,
        top: bounds.top - overscan,
        bottom: bounds.bottom + overscan,
    };
    const fromColumn = Math.floor(view.left / geometry.blockWidth);
    const toColumn = Math.floor(view.right / geometry.blockWidth);
    const fromRow = Math.floor(view.top / geometry.blockHeight);
    const toRow = Math.floor(view.bottom / geometry.blockHeight);
    const result: QueueInstance[] = [];

    for (let row = fromRow; row <= toRow; row += 1) {
        for (let column = fromColumn; column <= toColumn; column += 1) {
            for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex += 1) {
                const instance = buildInstance(geometry, totalEntries, column, row, slotIndex, metrics);
                if (!overlaps(toBounds(instance), view)) continue;
                result.push(instance);
                if (result.length >= MAX_RENDERED_INSTANCES) return result;
            }
        }
    }

    return result;
};

/**
 * Rects for every card in the block holding `active`, while that card is expanded. The block's
 * footprint is unchanged, so nothing outside it moves and no cascade can escape; the cards
 * inside re-gear instead of being shoved aside.
 */
export const layoutExpandedBlock = (
    geometry: LatticeGeometry,
    totalEntries: number,
    active: QueueInstance,
    metrics: WallMetrics,
): Map<string, { x: number; y: number; width: number; height: number }> => {
    const result = new Map<string, { x: number; y: number; width: number; height: number }>();
    if (totalEntries <= 0) return result;

    const block = getInstanceBlock(geometry, active);
    const localColumn = block.column - active.repeatX * geometry.blocksPerRow;
    const localRow = block.row - active.repeatY * geometry.blockRows;
    const reflow = getBlockReflow(localColumn, localRow, block.slotIndex);
    if (!reflow) return result;

    const pitch = getPitch(metrics);
    const originX = active.repeatX * geometry.cellWidth + localColumn * geometry.blockWidth;
    const originY = active.repeatY * geometry.cellHeight + localRow * geometry.blockHeight;
    const blockInCell = localRow * geometry.blocksPerRow + localColumn;

    for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex += 1) {
        const slot = reflow[slotIndex];
        const cellSlot = blockInCell * SLOTS_PER_BLOCK + slotIndex;
        result.set(`${cellSlot}:${active.repeatX}:${active.repeatY}`, {
            x: originX + slot.x * pitch,
            y: originY + slot.y * pitch,
            width: slot.cols * pitch - metrics.gap,
            height: slot.rows * pitch - metrics.gap,
        });
    }

    return result;
};
