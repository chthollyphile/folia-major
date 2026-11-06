// src/components/app/scratchpad/canvasLayout.ts
// 速记簿画布的几何：每组一块卡片网格，卡片按组内序号排进固定大小的格子（索引位）。拖动时卡片跟着指针走，
// 松手的落点按指针下卡片中心最近的格子换算成组内序号；框选按格子的矩形判断碰没碰到。全是纯函数，单测直接测。
// 格子之间的空隙（Spacing）可以换，还能带卡片自己的大小（card）：展开整页（设计稿 F）里三页的卡片大小各不相同
// （NOTE / PHOTO / FILM_SPACING）。

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

/**
 * 展开整页（设计稿 F）的三种卡片：速记簿是笔记本上的一条记录，播放历史是一张回忆相片（微微歪着，空隙留出歪出去的角），
 * 播放队列是连在一起的电影胶片（横向没有空隙，一行接着一行；两头留出行尾、行首的「》」）。
 * 行与行之间隔得开（用户定，2026-11-06）：当时框选框是屏幕方向的，纸斜着，横着一拉就斜着碰到下一行，
 * 原来 10px 的行距一拉就串行，行距放到了 44–48px。后来框选框改成跟着纸斜（2026-11-07），行距留着，看着也松快。
 * 速记簿与播放队列的卡片后来又放大了（用户要的，2026-11-06）：笔记本 128 × 152、胶片 140 × 128，行距不变。
 */
export const NOTE_SPACING: Spacing = { x: 16, y: 44, edge: 10, card: { width: 128, height: 152 } };
export const PHOTO_SPACING: Spacing = { x: 16, y: 48, edge: 10, card: { width: 104, height: 128 } };
export const FILM_SPACING: Spacing = { x: 0, y: 48, edge: 28, card: { width: 140, height: 128 } };

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

/** 三行总览里一行占的高度：信息条 72 + 往下 12 + 最高的卡（笔记本 152）。 */
export const OVERVIEW_ROW_BLOCK = 236;
/** 两行之间至少隔多少（一行的高度再留 16）。 */
export const OVERVIEW_ROW_MIN_STEP = 252;
/** 第一行最高到哪（让开窗口标题栏）、第三行的卡离窗口底边至少多少。 */
const OVERVIEW_TOP_MIN = 36;
const OVERVIEW_BOTTOM_GAP = 8;
/** 三行在窗口里的比例位置（照设计稿 1440 × 900 时的 116 / 352 / 592）。 */
const OVERVIEW_ROW_RATIOS = [0.129, 0.391, 0.658];

/**
 * 纸绕中心转 tilt 度时，离中线 offset（往右为正）处在屏幕上比中线低多少（px；往左是负的，比中线高）。
 * 内容安全区都按它算：越靠右的东西转下去越低，会出窗口底边。
 */
export const tiltDrop = (offset: number, tilt: number): number => offset * Math.sin((tilt * Math.PI) / 180);

/** 三行总览每一行最右端（行尾那块「还有几首」，离纸右边约 200px）比中线低多少：排行时底下多留这一截。 */
export const overviewBottomInset = (sheetWidth: number, tilt: number): number => (
    Math.max(0, Math.ceil(tiltDrop(sheetWidth / 2 - 200, tilt)))
);

/**
 * 三行总览每一行信息条的顶边（窗口坐标，不含纸上下多出来的那一截）：按比例排；行与行至少隔 OVERVIEW_ROW_MIN_STEP；
 * 窗口矮到第三行的卡出了底边时，先整体往上挪（不高过标题栏），还不够就把行距挤到正好一行高。
 * bottomInset：底下另外让出来的高度（纸斜着时行的右端比中间低，见 overviewBottomInset）。
 */
export const overviewRowTops = (viewHeight: number, bottomInset = 0): number[] => {
    const tops = OVERVIEW_ROW_RATIOS.map(ratio => ratio * viewHeight);
    for (let index = 1; index < tops.length; index += 1) tops[index] = Math.max(tops[index], tops[index - 1] + OVERVIEW_ROW_MIN_STEP);
    const room = viewHeight - OVERVIEW_BOTTOM_GAP - bottomInset;
    const last = tops.length - 1;
    const overflow = tops[last] + OVERVIEW_ROW_BLOCK - room;
    if (overflow <= 0) return tops;
    const shift = Math.min(overflow, Math.max(0, tops[0] - OVERVIEW_TOP_MIN));
    const shifted = tops.map(top => top - shift);
    if (shifted[last] + OVERVIEW_ROW_BLOCK <= room) return shifted;
    const step = Math.max(OVERVIEW_ROW_BLOCK, (room - OVERVIEW_ROW_BLOCK - shifted[0]) / last);
    return shifted.map((_, index) => shifted[0] + index * step);
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

