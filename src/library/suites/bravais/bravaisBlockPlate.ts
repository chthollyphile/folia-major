import { getSeamBoundaryX, getSeamBoundaryY } from '../../../components/wall/seamPlan';
import { getBlockSize, getBlockSlots, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { resolveSlotFace, type BravaisDisplay } from './bravaisDisplay';
import { isPlateHole, isSeeThroughFace } from './bravaisLook';

// src/library/suites/bravais/bravaisBlockPlate.ts
// 透光的实色底板（设计稿 §11）按块画，纯计算。每个已挂载的 12×8 块一张内联 SVG：实色、evenodd 路径，外框减去块里
// 最多 12 个窗洞（部分透明的结构窗、透明档有限墙的空 slot、全透明档透着的内容磁贴）。SVG 放在世界层里、磁贴之下，
// 随相机一起平移，所以拖动不写任何东西；不用 CSS 遮罩。
//
// 外框只向左 / 上多盖 PLATE_BLEED（落在前一块尾部的缝隙里：那里没有磁贴），相邻块之间没有接缝，也不伸进下一块的
// 磁贴；右 / 下止于本块尾部缝隙的末尾。例外是缝右侧的第一列块：缝两侧的墙各让出半个开口加半个 GAP，前一块
// （在左半）的尾部缝隙不在右半，这一列向左多盖一整个 GAP，正好铺到缝的右边沿（缝全开时）——缝的开口下面没有底板，
// 透明档的半透明纸条透得出去。
//
// 洞按块里全部 12 个 slot 算（不看裁剪），所以拖动、补挂只会新挂块，已挂的块路径不变；窗集合变了（翻牌开关窗、换挡、
// 有限墙空 slot 变化、聚焦卡让位）只有受影响的块路径会变。
// 聚焦卡让位期间这一块的路径由 useBravaisReflowDriver 与磁贴同一帧逐帧重画。让位途中两个窗可能短暂交叠，evenodd 下
// 交叠处会被填回实色，所以有交叠时先把洞拆成互不重叠的矩形（disjointRects）。

export type PlateRect = { x: number; y: number; width: number; height: number };

/** 外框向左 / 上多盖的世界像素（前一块尾部缝隙的一部分）。 */
export const PLATE_BLEED = 2;

/** 一个块的底板：SVG 在世界里的外框、路径（原点在外框左上角）与它的洞。 */
export type PlateBlock = {
    key: string;
    column: number;
    row: number;
    x: number;
    y: number;
    width: number;
    height: number;
    d: string;
    /** 挖洞的 slot 与它们此刻（让位落定后）的矩形；让位的逐帧重画按 key 换成磁贴的实时矩形。 */
    holes: readonly { key: string; rect: PlateRect }[];
};

export type PlateBlockSet = { left: readonly PlateBlock[]; right: readonly PlateBlock[] };

export const EMPTY_PLATE_BLOCKS: PlateBlockSet = Object.freeze({ left: [], right: [] });

export const blockKeyOf = (slot: Pick<WallSlot, 'column' | 'row'>) => `${slot.column},${slot.row}`;

/** 一个块的世界矩形（块宽含它尾部的缝隙；探索形状的块含街）。 */
export const getBlockRect = (column: number, row: number, size = getBlockSize(BRAVAIS_METRICS)): PlateRect => {
    return { x: column * size.width, y: row * size.height, width: size.width, height: size.height };
};

/** 块在缝锚点左边（进左半世界层）：与 BravaisWall 分 slot 同一条规则（缝开在块边界上，块不会跨过锚点）。 */
export const isLeftOfAnchor = (column: number, anchorX: number | null, size = getBlockSize(BRAVAIS_METRICS)) => (
    anchorX !== null && getBlockRect(column, 0, size).x < anchorX
);

/** 块在横的缝上面（进上半，即 left 那个世界层）：与 BravaisWall 分 slot 同一条规则。 */
export const isAboveAnchor = (row: number, anchorY: number | null, size = getBlockSize(BRAVAIS_METRICS)) => (
    anchorY !== null && getBlockRect(0, row, size).y < anchorY
);

/**
 * 底板 SVG 的外框：向左 / 上多盖 PLATE_BLEED；缝右侧第一列向左铺到缝的右边沿（块是一整个 GAP，探索形状还含半条街），
 * 缝左侧那一列止于缝的左边沿（块正好是块尾；探索形状的街有一半在锚点右边，不伸进开口）。横的缝（anchorY）同理：
 * 缝下面第一行向上铺到缝的下边沿，缝上面那一行止于缝的上边沿。
 */
export const getPlateFrame = (
    column: number,
    row: number,
    anchorX: number | null,
    size = getBlockSize(BRAVAIS_METRICS),
    anchorY: number | null = null,
): PlateRect => {
    const block = getBlockRect(column, row, size);
    const isAnchor = (boundary: number) => anchorX !== null && Math.abs(getSeamBoundaryX(boundary, BRAVAIS_METRICS, size.width) - anchorX) < 1e-6;
    const isRowAnchor = (boundary: number) => anchorY !== null && Math.abs(getSeamBoundaryY(boundary, BRAVAIS_METRICS, size.height) - anchorY) < 1e-6;
    const x = isAnchor(column) ? anchorX! - BRAVAIS_METRICS.gap / 2 : block.x - PLATE_BLEED;
    const right = isAnchor(column + 1) ? anchorX! + BRAVAIS_METRICS.gap / 2 : block.x + block.width;
    const y = isRowAnchor(row) ? anchorY! - BRAVAIS_METRICS.gap / 2 : block.y - PLATE_BLEED;
    const bottom = isRowAnchor(row + 1) ? anchorY! + BRAVAIS_METRICS.gap / 2 : block.y + block.height;
    return { x, y, width: right - x, height: bottom - y };
};

/** 已挂载的块（slot 列表里出现过的），按首次出现的顺序。 */
export const collectMountedBlocks = (slots: readonly WallSlot[]) => {
    const blocks = new Map<string, { column: number; row: number }>();
    for (const slot of slots) {
        const key = blockKeyOf(slot);
        if (!blocks.has(key)) blocks.set(key, { column: slot.column, row: slot.row });
    }
    return blocks;
};

/** 块里要挖洞的 slot 与矩形（让位中的块取让位后的矩形；展开的那张画封面，不算洞）。 */
export const collectBlockHoles = (
    column: number,
    row: number,
    display: BravaisDisplay,
    expandedSlotKey: string | null,
    reflow: ReadonlyMap<string, PlateRect>,
) => {
    const holes: { key: string; rect: PlateRect }[] = [];
    for (const slot of display.shape.blockSlots(column, row)) {
        const { kind } = resolveSlotFace(display, slot);
        if (!isPlateHole(kind, isSeeThroughFace(display.look, kind, slot.key === expandedSlotKey))) continue;
        const rect = reflow.get(slot.key) ?? slot;
        holes.push({ key: slot.key, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
    return holes;
};

const round = (value: number) => Math.round(value * 100) / 100;

const overlaps = (a: PlateRect, b: PlateRect) => (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
);

/**
 * 一组可能互相重叠的矩形 → 覆盖同一片区域、互不重叠的矩形（坐标压缩成格子，按横带取连续的段，上下相同的段并起来）。
 * 没有重叠时原样返回。
 */
export const disjointRects = (rects: readonly PlateRect[]): readonly PlateRect[] => {
    if (!rects.some((rect, index) => rects.slice(index + 1).some(other => overlaps(rect, other)))) return rects;
    const xs = [...new Set(rects.flatMap(rect => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
    const ys = [...new Set(rects.flatMap(rect => [rect.y, rect.y + rect.height]))].sort((a, b) => a - b);
    const covered = (x0: number, x1: number, y0: number, y1: number) => rects.some(rect => (
        rect.x <= x0 && rect.x + rect.width >= x1 && rect.y <= y0 && rect.y + rect.height >= y1
    ));
    const out: PlateRect[] = [];
    /** 上一条横带的段（左右边界 → 已输出的矩形），与这一条完全相同的段往下接长。 */
    let open = new Map<string, PlateRect>();
    for (let row = 0; row < ys.length - 1; row += 1) {
        const y0 = ys[row]!;
        const y1 = ys[row + 1]!;
        const next = new Map<string, PlateRect>();
        let start: number | null = null;
        for (let column = 0; column <= xs.length - 1; column += 1) {
            const inside = column < xs.length - 1 && covered(xs[column]!, xs[column + 1]!, y0, y1);
            if (inside && start === null) start = xs[column]!;
            if (!inside && start !== null) {
                const end = xs[column]!;
                const key = `${start}|${end}`;
                const above = open.get(key);
                if (above && above.y + above.height === y0) {
                    above.height = y1 - above.y;
                    next.set(key, above);
                } else {
                    const rect = { x: start, y: y0, width: end - start, height: y1 - y0 };
                    out.push(rect);
                    next.set(key, rect);
                }
                start = null;
            }
        }
        open = next;
    }
    return out;
};

/**
 * 底板路径：外框一个矩形，每个洞一个矩形，evenodd 填充。洞先裁到外框里（磁贴越出块的部分由邻块的底板盖着），
 * 互相重叠的洞先拆成互不重叠的矩形（evenodd 下重叠处会被填回实色）。坐标相对外框左上角。
 */
export const buildPlatePath = (frame: PlateRect, holes: readonly PlateRect[]) => {
    let d = `M0 0h${round(frame.width)}v${round(frame.height)}h${round(-frame.width)}Z`;
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    const clipped: PlateRect[] = [];
    for (const hole of holes) {
        const left = Math.max(frame.x, hole.x);
        const top = Math.max(frame.y, hole.y);
        const width = Math.min(right, hole.x + hole.width) - left;
        const height = Math.min(bottom, hole.y + hole.height) - top;
        if (width <= 0 || height <= 0) continue;
        clipped.push({ x: left, y: top, width, height });
    }
    for (const hole of disjointRects(clipped)) {
        d += `M${round(hole.x - frame.x)} ${round(hole.y - frame.y)}h${round(hole.width)}v${round(hole.height)}h${round(-hole.width)}Z`;
    }
    return d;
};

/** 一个块的底板（外框、路径、洞）。 */
export const buildPlateBlock = (
    column: number,
    row: number,
    display: BravaisDisplay,
    expandedSlotKey: string | null,
    reflow: ReadonlyMap<string, PlateRect>,
    anchorX: number | null,
    anchorY: number | null = null,
): PlateBlock => {
    const frame = getPlateFrame(column, row, anchorX, display.shape.blockSize, anchorY);
    const holes = collectBlockHoles(column, row, display, expandedSlotKey, reflow);
    return {
        key: `${column},${row}`,
        column,
        row,
        ...frame,
        d: buildPlatePath(frame, holes.map(hole => hole.rect)),
        holes,
    };
};

/** 判断两份块底板画的是不是同一个东西（路径与外框都相同）。 */
export const isSamePlateBlock = (a: PlateBlock, b: PlateBlock) => (
    a.d === b.d && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
);
