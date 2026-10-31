// src/components/app/scratchpad/canvasLayout.ts
// 速记簿画布的几何：每组一块卡片网格，卡片按组内序号排进固定大小的格子（索引位）。拖动时卡片跟着指针走，
// 松手的落点按指针下卡片中心最近的格子换算成组内序号；框选按格子的矩形判断碰没碰到。全是纯函数，单测直接测。

export const CARD_WIDTH = 136;
export const CARD_HEIGHT = 176;
export const CARD_GAP = 12;

export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

/** 这么宽的网格放得下几列（至少一列）。 */
export const columnsFor = (width: number): number => (
    Math.max(1, Math.floor((width + CARD_GAP) / (CARD_WIDTH + CARD_GAP)))
);

/** 第 index 个格子的左上角（相对网格原点）。 */
export const slotPosition = (index: number, columns: number): Point => ({
    x: (index % columns) * (CARD_WIDTH + CARD_GAP),
    y: Math.floor(index / columns) * (CARD_HEIGHT + CARD_GAP),
});

/** count 张卡片的网格有多高（没有卡片时为 0）。 */
export const gridHeight = (count: number, columns: number): number => {
    if (count <= 0) return 0;
    const rows = Math.ceil(count / columns);
    return rows * CARD_HEIGHT + (rows - 1) * CARD_GAP;
};

/**
 * 卡片左上角落在 topLeft（相对网格原点）时，它该吸附到哪个序号：取卡片中心最近的格子，
 * 再夹进 [0, slotCount]（slotCount 是挪走被拖的卡之后组里剩下的张数——可以排在最后一张后面）。
 */
export const dropIndexAt = (topLeft: Point, columns: number, slotCount: number): number => {
    const column = Math.min(columns - 1, Math.max(0, Math.round(topLeft.x / (CARD_WIDTH + CARD_GAP))));
    const row = Math.max(0, Math.round(topLeft.y / (CARD_HEIGHT + CARD_GAP)));
    return Math.min(slotCount, Math.max(0, row * columns + column));
};

/**
 * 拖动中组里每张不动的卡显示在哪个格子：被拖的卡先拿走，剩下的按原顺序排，在 dropIndex 处空出 movingCount 个位置。
 * 返回 key → 序号；被拖的卡不在里面（它们跟着指针）。
 */
export const previewSlots = (
    keys: readonly string[],
    moving: ReadonlySet<string>,
    dropIndex: number,
): Map<string, number> => {
    const slots = new Map<string, number>();
    let index = 0;
    for (const key of keys) {
        if (moving.has(key)) continue;
        if (index === dropIndex) index += moving.size;
        slots.set(key, index);
        index += 1;
    }
    return slots;
};

/** 两点拉出的矩形（不管哪个方向拉的）。 */
export const rectFromPoints = (a: Point, b: Point): Rect => ({
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
});

export const rectsIntersect = (a: Rect, b: Rect): boolean => (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
);

/** 网格原点在 origin 时第 index 张卡的矩形（和框选矩形同一个坐标系）。 */
export const cardRect = (origin: Point, index: number, columns: number): Rect => {
    const { x, y } = slotPosition(index, columns);
    return { left: origin.x + x, top: origin.y + y, right: origin.x + x + CARD_WIDTH, bottom: origin.y + y + CARD_HEIGHT };
};
