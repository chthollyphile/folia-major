// src/components/app/scratchpad/canvasLayout.ts
// 速记簿画布的几何：每组一块卡片网格，卡片按组内序号排进固定大小的格子（索引位）。拖动时卡片跟着指针走，
// 松手的落点按指针下卡片中心最近的格子换算成组内序号；框选按格子的矩形判断碰没碰到。全是纯函数，单测直接测。
// 格子之间的空隙（Spacing）可以换：速记簿用窄的；播放历史与播放队列的卡片之间要穿一条线，用宽的（THREAD_SPACING）。
// Spacing 还能带卡片自己的大小（card）：展开整页（设计稿 F）里三页的卡片大小各不相同（NOTE / PHOTO / FILM_SPACING）。

export const CARD_WIDTH = 136;
export const CARD_HEIGHT = 176;
export const CARD_GAP = 12;

export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
/** 卡片之间横向、纵向的空隙；edge 是画布内容左右的留白（缺省 CONTENT_EDGE），节点要伸出第一列左边时得放宽；card 是卡片的宽高（缺省 CARD_WIDTH × CARD_HEIGHT）。 */
export type Spacing = { x: number; y: number; edge?: number; card?: { width: number; height: number } };

/** 这种空隙下一张卡片的宽高。 */
export const cardSize = (spacing: Spacing): { width: number; height: number } => (
    spacing.card ?? { width: CARD_WIDTH, height: CARD_HEIGHT }
);

/** 画布内容左右的留白（与 CSS 的 .scratchpad-canvas-content 一致）。 */
export const CONTENT_EDGE = 16;

export const DEFAULT_SPACING: Spacing = { x: CARD_GAP, y: CARD_GAP };
/** 穿箭头线的画布（播放队列）：空隙宽到看得见线、放得下箭头，卡片也不挤（比速记簿的画布疏一些）。 */
export const THREAD_SPACING: Spacing = { x: 48, y: 52, edge: 32 };
/** 时间轴的画布（播放历史）：卡片之间放得下写着时间的节点；第一列前面的节点伸出网格左边，留白跟着放宽。 */
export const TIMELINE_SPACING: Spacing = { x: 64, y: 52, edge: 60 };

/**
 * 展开整页（设计稿 F）的三种卡片：速记簿是笔记本上的一条记录，播放历史是一张回忆相片（微微歪着，空隙留出歪出去的角），
 * 播放队列是连在一起的电影胶片（横向没有空隙，一行接着一行；两头留出行尾、行首的「》」）。
 */
export const NOTE_SPACING: Spacing = { x: 10, y: 10, edge: 10, card: { width: 112, height: 132 } };
export const PHOTO_SPACING: Spacing = { x: 12, y: 14, edge: 10, card: { width: 112, height: 136 } };
export const FILM_SPACING: Spacing = { x: 0, y: 16, edge: 28, card: { width: 120, height: 112 } };

/** 这么宽的网格放得下几列（至少一列）。 */
export const columnsFor = (width: number, spacing: Spacing = DEFAULT_SPACING): number => (
    Math.max(1, Math.floor((width + spacing.x) / (cardSize(spacing).width + spacing.x)))
);

/** 第 index 个格子的左上角（相对网格原点）。 */
export const slotPosition = (index: number, columns: number, spacing: Spacing = DEFAULT_SPACING): Point => ({
    x: (index % columns) * (cardSize(spacing).width + spacing.x),
    y: Math.floor(index / columns) * (cardSize(spacing).height + spacing.y),
});

/** count 张卡片的网格有多高（没有卡片时为 0）。 */
export const gridHeight = (count: number, columns: number, spacing: Spacing = DEFAULT_SPACING): number => {
    if (count <= 0) return 0;
    const rows = Math.ceil(count / columns);
    return rows * cardSize(spacing).height + (rows - 1) * spacing.y;
};

/**
 * 卡片左上角落在 topLeft（相对网格原点）时，它该吸附到哪个序号：取卡片中心最近的格子，
 * 再夹进 [0, slotCount]（slotCount 是挪走被拖的卡之后组里剩下的张数——可以排在最后一张后面）。
 */
export const dropIndexAt = (topLeft: Point, columns: number, slotCount: number, spacing: Spacing = DEFAULT_SPACING): number => {
    const { width, height } = cardSize(spacing);
    const column = Math.min(columns - 1, Math.max(0, Math.round(topLeft.x / (width + spacing.x))));
    const row = Math.max(0, Math.round(topLeft.y / (height + spacing.y)));
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
export const cardRect = (origin: Point, index: number, columns: number, spacing: Spacing = DEFAULT_SPACING): Rect => {
    const { x, y } = slotPosition(index, columns, spacing);
    const { width, height } = cardSize(spacing);
    return { left: origin.x + x, top: origin.y + y, right: origin.x + x + width, bottom: origin.y + y + height };
};

/** 矩形的四个角（顺时针）。 */
export const rectCorners = (rect: Rect): Point[] => [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
];

/**
 * 两个凸多边形相交没有（分离轴）：只碰到边不算。倾斜的纸上，屏幕方向的框选框落到内容坐标里是一个斜着的矩形，
 * 拿它和卡片的矩形比；不倾斜时就是两个矩形相交（与 rectsIntersect 相同）。
 */
export const polygonsIntersect = (a: readonly Point[], b: readonly Point[]): boolean => {
    const project = (points: readonly Point[], axis: Point) => {
        let min = Infinity;
        let max = -Infinity;
        for (const point of points) {
            const distance = point.x * axis.x + point.y * axis.y;
            if (distance < min) min = distance;
            if (distance > max) max = distance;
        }
        return { min, max };
    };
    for (const polygon of [a, b]) {
        for (let index = 0; index < polygon.length; index += 1) {
            const from = polygon[index];
            const to = polygon[(index + 1) % polygon.length];
            const axis = { x: to.y - from.y, y: from.x - to.x };
            if (axis.x === 0 && axis.y === 0) continue;
            const one = project(a, axis);
            const other = project(b, axis);
            if (one.max <= other.min || other.max <= one.min) return false;
        }
    }
    return true;
};
