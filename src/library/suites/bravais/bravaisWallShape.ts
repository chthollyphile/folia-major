import type { BlockSlot } from '../../../components/wall/blockTemplates';
import { getPitch, overlaps, type Bounds } from '../../../components/wall/layout';
import { nearestSeamBoundaryX, nearestSeamBoundaryY } from '../../../components/wall/seamPlan';
import {
    getBlockSize,
    getBlockSlots,
    getWallSlot,
    layoutFocusedBlock,
    parseWallSlotKey,
    wallSlotKey,
    type WallSlot,
} from '../../../components/wall/wallSlots';
import { buildStrip, createExploreLayout, lotIndexAt, type Lot } from '../../../components/app/lattice/exploreLayout';
import { cutGrownLot } from '../../../components/app/lattice/lotSeats';
import { LOT_COLS, LOT_ROWS } from '../../../components/app/lattice/lotTables';
import type { WallSection } from '../../../components/app/lattice/wallLayout';
import { BRAVAIS_METRICS } from './bravaisConstants';
import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/bravaisWallShape.ts
// 墙的形状（纯计算）：块场怎么切成 slot。一层墙只有一种形状，显示（BravaisDisplay.shape）带着它，stage 里凡是按块找 slot
// 的地方（裁剪、键盘走位、聚焦让位、反查、底板、缝的块边界）都问它，不再直接问 wall 的块模板。
// - 块（blocks）：wall 引擎的 12 × 8 块、每块 12 个模板 slot，块与块只隔一道 GAP。集合、歌手页与首页的卡片页签都是它。
// - 探索（explore）：网格探索拼贴的排法（lattice/exploreLayout）原样搬上来——一个 section 一块地（lot），地上是标题
//   与 1–13 个座位（lotSeats），地与地之间多半格的街；块 (column, row) 放第 lotIndexAt(column − 原点列, row − 原点行)
//   块地，所以原点那一块是第一个 section，往下按页面顺序，每一列是同一条地带错开 stride 块地。座位 i 是 slot i，标题是
//   最后一个 slot（座位数那个序号）。原点是起点 slot 所在的块（一般是离缝最近的那块）。
// 形状只决定 slot 在哪、显示第几项；翻牌、波次与入场都按 slot key 走，换形状时由 useBravaisDisplay 先在旧形状上整墙
// 出场、再在新形状上整墙入场（磁贴按块的矩形套 blockKey 重新挂载，不会在原地跳）；探索页的 section 补到时
// （isGrownExploreShape）原地重排，只有换了地的块重新挂载落回。

type SlotAddress = { column: number; row: number; slotIndex: number };
type Point = { x: number; y: number };

export type BravaisWallShape = {
    /** 形状的身份：变了就是另一套 slot 矩形（磁贴按它重新挂载）。 */
    id: string;
    kind: 'blocks' | 'explore';
    /** 相邻两块左上角的距离（探索形状含街）。 */
    blockSize: { width: number; height: number };
    blockSlots: (column: number, row: number) => WallSlot[];
    slotAt: (column: number, row: number, slotIndex: number) => WallSlot | null;
    /** 聚焦卡展开时这一块的新矩形（slot 序号不变）；不能展开时为 null。 */
    grownBlock: (column: number, row: number, slotIndex: number) => WallSlot[] | null;
    /** 这个 slot 显示第几项；null 的形状（块）按 wall/startTile 的循环规则算。 */
    entryAt: ((slot: SlotAddress) => number | null) | null;
    /** 这个 slot 是不是 section 标题（给出它是第几个 section）。 */
    headingAt: (slot: SlotAddress) => number | null;
    /** 第 index 项离 near 最近的那一份；null 的形状（块）按循环规则倒推（bravaisItemSlots）。 */
    nearestEntry: ((index: number, near: Point) => WallSlot | null) | null;
    /** 一个世界点所在的块里当起点的 slot key（换形状时起点从旧形状搬过来）。 */
    startKeyAt: (point: Point) => string;
    /** 这一块的矩形套是哪一份（磁贴按它挂载：两个形状在同一块上给同一个值，这块的 slot 矩形就一样）。 */
    blockKey: (column: number, row: number) => string;
    /** 探索形状的原点与地带（每块地的 section、分段、座位数与条目）；块是 null。 */
    strip: { origin: { column: number; row: number }; lots: readonly string[] } | null;
};

const PITCH = getPitch(BRAVAIS_METRICS);
const BLOCK_SIZE = getBlockSize(BRAVAIS_METRICS);
const blockOf = (point: Point, size: { width: number; height: number }) => ({
    column: Math.floor(point.x / size.width),
    row: Math.floor(point.y / size.height),
});

const nearestIn = (slots: readonly WallSlot[], point: Point) => {
    let best: WallSlot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
        const distance = (slot.centerX - point.x) ** 2 + (slot.centerY - point.y) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = slot;
        }
    }
    return best;
};

export const BRAVAIS_BLOCK_SHAPE: BravaisWallShape = {
    id: 'blocks',
    kind: 'blocks',
    blockSize: BLOCK_SIZE,
    blockSlots: (column, row) => getBlockSlots(column, row, BRAVAIS_METRICS),
    slotAt: (column, row, slotIndex) => getWallSlot(column, row, slotIndex, BRAVAIS_METRICS),
    grownBlock: (column, row, slotIndex) => layoutFocusedBlock(column, row, slotIndex, BRAVAIS_METRICS),
    entryAt: null,
    headingAt: () => null,
    nearestEntry: null,
    startKeyAt: (point) => {
        const { column, row } = blockOf(point, BLOCK_SIZE);
        return nearestIn(getBlockSlots(column, row, BRAVAIS_METRICS), point)?.key ?? wallSlotKey(column, row, 0);
    },
    blockKey: () => 'blocks',
    strip: null,
};

/** 探索形状的块距：一块地加半格的街（与 exploreLayout 的 pitchX / pitchY 相同）。 */
export const EXPLORE_BLOCK_SIZE = {
    width: LOT_COLS * PITCH + BRAVAIS_METRICS.cellSize / 2,
    height: LOT_ROWS * PITCH + BRAVAIS_METRICS.cellSize / 2,
};

const toSlot = (column: number, row: number, slotIndex: number, rect: BlockSlot): WallSlot => {
    const x = column * EXPLORE_BLOCK_SIZE.width + rect.x * PITCH;
    const y = row * EXPLORE_BLOCK_SIZE.height + rect.y * PITCH;
    const width = rect.cols * PITCH - BRAVAIS_METRICS.gap;
    const height = rect.rows * PITCH - BRAVAIS_METRICS.gap;
    return {
        key: wallSlotKey(column, row, slotIndex),
        column,
        row,
        slotIndex,
        x,
        y,
        width,
        height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        area: rect.cols * rect.rows,
    };
};

/** 一块地的矩形：座位按序号，标题排在最后。 */
const lotRects = (lot: Lot, seats: readonly BlockSlot[] = lot.seats) => [...seats, lot.heading];

export const createExploreShape = (sections: readonly WallSection[], origin: { column: number; row: number }): BravaisWallShape => {
    const standing = sections.filter(section => section.entries.length > 0);
    const lots = buildStrip(standing);
    // 反查第几项离哪最近：沿用网格探索墙的 nearest（它的块地坐标 = 这里的块坐标减去原点）。
    const layout = createExploreLayout(standing, BRAVAIS_METRICS);
    const lotAt = (column: number, row: number) => lots[lotIndexAt(column - origin.column, row - origin.row, lots.length)];
    const slotAt = (column: number, row: number, slotIndex: number) => {
        const rect = lotRects(lotAt(column, row))[slotIndex];
        return rect ? toSlot(column, row, slotIndex, rect) : null;
    };
    // 一块地的矩形只由 section（定镜像）、分段与座位数决定。
    const lotKey = (lot: Lot) => `${standing[lot.section].key}/${lot.part}/${lot.seats.length}`;
    return {
        id: `explore:${origin.column},${origin.row}:${lots.map(lot => `${standing[lot.section].key}/${lot.seats.length}`).join('|')}`,
        kind: 'explore',
        blockSize: EXPLORE_BLOCK_SIZE,
        blockSlots: (column, row) => lotRects(lotAt(column, row)).map((rect, index) => toSlot(column, row, index, rect)),
        slotAt,
        grownBlock: (column, row, slotIndex) => {
            const lot = lotAt(column, row);
            if (slotIndex < 0 || slotIndex >= lot.seats.length) return null;
            const grown = cutGrownLot(lot.seats.length, lot.mirrors, slotIndex);
            return lotRects(lot, grown).map((rect, index) => toSlot(column, row, index, rect));
        },
        entryAt: slot => lotAt(slot.column, slot.row).tiles[slot.slotIndex] ?? null,
        headingAt: (slot) => {
            const lot = lotAt(slot.column, slot.row);
            return slot.slotIndex === lot.seats.length ? lot.section : null;
        },
        nearestEntry: (index, near) => {
            const place = layout.nearest(index, {
                x: near.x - origin.column * EXPLORE_BLOCK_SIZE.width,
                y: near.y - origin.row * EXPLORE_BLOCK_SIZE.height,
            });
            return place ? slotAt(place.repeatX + origin.column, place.repeatY + origin.row, place.cellSlot) : null;
        },
        startKeyAt: (point) => {
            const { column, row } = blockOf(point, EXPLORE_BLOCK_SIZE);
            return wallSlotKey(column, row, 0);
        },
        blockKey: (column, row) => `explore:${lotKey(lotAt(column, row))}`,
        strip: { origin, lots: lots.map(lot => `${lotKey(lot)}:${lot.tiles.join('.')}`) },
    };
};

/**
 * 探索页的 section 补到了：原点不变、原来的地原样排在地带前面（条目也一样）。这时原地重排，不整墙出入场——
 * 地数变了，lotIndexAt 让原点那一列以外的块多半换了地；换了地的块重新挂载落回，没换的原样不动。
 */
export const isGrownExploreShape = (from: BravaisWallShape, to: BravaisWallShape) => {
    if (!from.strip || !to.strip) return false;
    const { origin, lots } = from.strip;
    return origin.column === to.strip.origin.column && origin.row === to.strip.origin.row
        && to.strip.lots.length > lots.length
        && lots.every((lot, index) => lot === to.strip!.lots[index]);
};

/**
 * 原地重排时已渲染的 slot 分两份：块换了地的（按新的 blockKey 重新挂载、落回）与留在原地的（磁贴不重新挂载，
 * 同一个序号上的条目变了就照平常的数据更新翻）。两个形状的块距一样，同一个 slot 键在同一块上。
 */
export const splitGrownSlots = (from: BravaisWallShape, to: BravaisWallShape, slots: readonly WallSlot[]) => {
    const kept: WallSlot[] = [];
    const remounted: WallSlot[] = [];
    for (const slot of slots) {
        (from.blockKey(slot.column, slot.row) === to.blockKey(slot.column, slot.row) ? kept : remounted).push(slot);
    }
    return { kept, remounted };
};

/** 层描述里的形状（只有探索页签有）：section 的排法与每个 section 的标题磁贴。 */
export type BravaisLayerShape = {
    kind: 'explore';
    sections: readonly WallSection[];
    /** 每个有条目的 section 一张标题磁贴（按 section 的序号；不能点、不进键盘走位）。 */
    headings: readonly BravaisItem[];
};

const exploreShapes = new WeakMap<readonly WallSection[], Map<string, BravaisWallShape>>();

/**
 * 一层的形状：没给（或探索页还没有可铺的 section）就是块；探索按起点 slot 所在的块定原点。同一份 section、同一个原点
 * 给同一个对象（显示每次重建，形状不跟着换身份）。
 */
export const resolveLayerShape = (shape: BravaisLayerShape | undefined, startSlotKey: string | null): BravaisWallShape => {
    if (!shape || !shape.sections.some(section => section.entries.length > 0)) return BRAVAIS_BLOCK_SHAPE;
    const address = startSlotKey ? parseWallSlotKey(startSlotKey) : null;
    const origin = { column: address?.column ?? 0, row: address?.row ?? 0 };
    const key = `${origin.column},${origin.row}`;
    const cached = exploreShapes.get(shape.sections) ?? new Map<string, BravaisWallShape>();
    exploreShapes.set(shape.sections, cached);
    const found = cached.get(key);
    if (found) return found;
    const created = createExploreShape(shape.sections, origin);
    cached.set(key, created);
    return created;
};

export const shapeSlotFromKey = (shape: BravaisWallShape, key: string | null): WallSlot | null => {
    const address = key ? parseWallSlotKey(key) : null;
    return address ? shape.slotAt(address.column, address.row, address.slotIndex) : null;
};

/**
 * 探索形状上的起点：落在座位上就照用；标题、地外的序号（另一种形状记下的键）换成同一块的第一个座位，
 * 键盘焦点不会落在标题上。
 */
export const exploreStartKey = (shape: BravaisWallShape, key: string | null): string | null => {
    const address = key ? parseWallSlotKey(key) : null;
    if (!address) return key;
    return shape.entryAt?.(address) != null ? key : wallSlotKey(address.column, address.row, 0);
};

/** 旧形状上的一个起点 slot 搬到新形状上：它中心所在的那一块里当起点的 slot。 */
export const moveStartSlotKey = (key: string | null, from: BravaisWallShape, to: BravaisWallShape): string | null => {
    if (from.id === to.id) return key;
    const slot = shapeSlotFromKey(from, key);
    return slot ? to.startKeyAt({ x: slot.centerX, y: slot.centerY }) : null;
};

/**
 * 换层的起点只搬一次：旧墙上的 slot（被点的那张、离缝最近的）从旧形状搬到这一层的形状上；记忆里的已经搬好
 * （fitBravaisLayoutToShape），照用。slot 是翻牌从哪开始（世界坐标，两边都可以用）。
 */
export const resolveShiftStart = (
    start: { onPrevious: string | null } | { remembered: string },
    from: BravaisWallShape,
    layerShape: BravaisLayerShape | undefined,
): { key: string | null; slot: WallSlot | null } => {
    if ('remembered' in start) {
        return { key: start.remembered, slot: shapeSlotFromKey(resolveLayerShape(layerShape, start.remembered), start.remembered) };
    }
    return {
        key: moveStartSlotKey(start.onPrevious, from, resolveLayerShape(layerShape, null)),
        slot: shapeSlotFromKey(from, start.onPrevious),
    };
};

/** 与世界矩形相交的 slot（有上限，缩得很小时也不会卡住一帧）：与 wall 的 collectWallSlots 同一个做法，块按形状取。 */
export const collectShapeSlots = (shape: BravaisWallShape, bounds: Bounds, limit = Number.POSITIVE_INFINITY): WallSlot[] => {
    const { width, height } = shape.blockSize;
    const result: WallSlot[] = [];
    for (let row = Math.floor(bounds.top / height); row <= Math.floor(bounds.bottom / height); row += 1) {
        for (let column = Math.floor(bounds.left / width); column <= Math.floor(bounds.right / width); column += 1) {
            for (const slot of shape.blockSlots(column, row)) {
                if (!overlaps({ left: slot.x, right: slot.x + slot.width, top: slot.y, bottom: slot.y + slot.height }, bounds)) continue;
                result.push(slot);
                if (result.length >= limit) return result;
            }
        }
    }
    return result;
};

/** 离 x 最近的块边界（缝开在它上面；探索形状的边界在街的正中）。 */
export const nearestShapeBoundaryX = (shape: BravaisWallShape, x: number) => (
    nearestSeamBoundaryX(x, BRAVAIS_METRICS, shape.blockSize.width)
);

/** 离 y 最近的块行边界（横向的缝开在它上面；探索形状的边界在街的正中）。 */
export const nearestShapeBoundaryY = (shape: BravaisWallShape, y: number) => (
    nearestSeamBoundaryY(y, BRAVAIS_METRICS, shape.blockSize.height)
);
