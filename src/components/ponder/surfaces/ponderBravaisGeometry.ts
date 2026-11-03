import type { PonderRelativeRect } from '../../../types/ponder';

// src/components/ponder/surfaces/ponderBravaisGeometry.ts
// bravais 墙（教程 bravais-wall）的合成界面与锚点共用的几何和内容表。
//
// 和 ponderSurfaceGeometry 同一条规矩：PonderBravaisWallSurface 用这里的矩形画磁贴，bravaisWall.target.ts 用同一组数
// 声明锚点，两边不各写一份百分比。单独成一个文件，是为了不和别的教程挤在那张共享几何表里。
//
// 坐标系一律是 page（合成界面整块）的 0..1。page 的高宽比锁成 BRAVAIS_PAGE_ASPECT，所以「单位格」在 x、y 上各有一个
// 换算系数，按单位格写的方块在任何窗口下都还是方的。
//
// 墙照真实实现的结构来画：缝开在块边界上，左右各是半面墙；每块 8×8 个单位格（真实是 12×8，合成界面里只露得下这么宽），
// 块里按模板摆 8～9 张大小不一的磁贴，墙是无限的 —— 块按模板循环铺开，内容也循环。

/** page 的高宽比（高 ÷ 宽）。target 的 surface 锚点用同一个值锁形状。 */
export const BRAVAIS_PAGE_ASPECT = 0.6;

/** 缝（首页窄缝）：page 正中一道竖条。 */
export const BRAVAIS_SEAM = { left: 0.455, width: 0.09 } as const;

const HALF_COLS = 8;
/** 一个单位格的宽度（page 宽度的比例）。 */
const UNIT_X = BRAVAIS_SEAM.left / HALF_COLS;
/** 一个单位格的高度（page 高度的比例）：单位格在像素上是正方形。 */
const UNIT_Y = UNIT_X / BRAVAIS_PAGE_ASPECT;
/** 第 0 行块的顶边离 page 顶边多远：上面露出一截上一块，墙看起来是无限的。 */
const ROW0_Y = 0.06;
/** 磁贴之间的间距（x 方向，page 宽度比例），y 方向按高宽比换算。 */
const GAP_X = 0.006;
const GAP_Y = GAP_X / BRAVAIS_PAGE_ASPECT;

export type BravaisHalf = 'left' | 'right';

const halfOriginX = (half: BravaisHalf) => (half === 'left' ? 0 : BRAVAIS_SEAM.left + BRAVAIS_SEAM.width);

/** 按单位格算一张磁贴的矩形（已扣掉间距）。col / row 是这一半墙里的全局单位格坐标。 */
const unitRect = (half: BravaisHalf, col: number, row: number, w: number, h: number): PonderRelativeRect => ({
    left: halfOriginX(half) + col * UNIT_X + GAP_X / 2,
    top: ROW0_Y + row * UNIT_Y + GAP_Y / 2,
    width: w * UNIT_X - GAP_X,
    height: h * UNIT_Y - GAP_Y,
});

type TemplateCell = { col: number; row: number; w: number; h: number };

/** 模板 A：左半面墙第 0 块用它，聚焦卡的让位就发生在这一块里。顺序就是块内的 rank 顺序。 */
const TEMPLATE_A: readonly TemplateCell[] = [
    { col: 0, row: 0, w: 4, h: 4 },
    { col: 4, row: 0, w: 2, h: 2 },
    { col: 6, row: 0, w: 2, h: 2 },
    { col: 4, row: 2, w: 4, h: 4 },
    { col: 0, row: 4, w: 2, h: 2 },
    { col: 2, row: 4, w: 2, h: 2 },
    { col: 0, row: 6, w: 4, h: 2 },
    { col: 4, row: 6, w: 4, h: 2 },
];

/** 模板 B：右半面墙第 0 块。 */
const TEMPLATE_B: readonly TemplateCell[] = [
    { col: 0, row: 0, w: 2, h: 2 },
    { col: 2, row: 0, w: 2, h: 2 },
    { col: 4, row: 0, w: 4, h: 4 },
    { col: 0, row: 2, w: 4, h: 4 },
    { col: 4, row: 4, w: 2, h: 2 },
    { col: 6, row: 4, w: 2, h: 2 },
    { col: 0, row: 6, w: 2, h: 2 },
    { col: 2, row: 6, w: 2, h: 2 },
    { col: 4, row: 6, w: 4, h: 2 },
];

/**
 * 聚焦卡展开之后模板 A 那一块的样子：被点的歌（模板里的第 3 张）放大成 6×6，其余七张在剩下的 L 形里各占 2×2。
 * 下标与 TEMPLATE_A 一一对应 —— 磁贴身份不变，只换位置与尺寸，块外什么都不动。
 */
const TEMPLATE_A_EXPANDED: readonly TemplateCell[] = [
    { col: 0, row: 0, w: 2, h: 2 },
    { col: 2, row: 6, w: 2, h: 2 },
    { col: 4, row: 6, w: 2, h: 2 },
    { col: 2, row: 0, w: 6, h: 6 },
    { col: 0, row: 2, w: 2, h: 2 },
    { col: 0, row: 4, w: 2, h: 2 },
    { col: 0, row: 6, w: 2, h: 2 },
    { col: 6, row: 6, w: 2, h: 2 },
];

/** 模板 A 里展开成聚焦卡的那一张。 */
const FOCUS_INDEX = 3;

export type BravaisSlot = {
    /** `<half>:<bx>:<by>:<i>`，内容表与锚点都按它找。 */
    key: string;
    half: BravaisHalf;
    bx: number;
    by: number;
    index: number;
    rect: PonderRelativeRect;
    /** 中心点，单位是单位格（左右两半连成同一个坐标系，缝占 BRAVAIS_SEAM.width / UNIT_X 格）。 */
    center: { x: number; y: number };
};

const SEAM_UNITS = BRAVAIS_SEAM.width / UNIT_X;

const templateFor = (half: BravaisHalf, bx: number, by: number) => (
    (half === 'left' ? bx + by : bx + by + 1) % 2 === 0 ? TEMPLATE_A : TEMPLATE_B
);

const buildSlot = (half: BravaisHalf, bx: number, by: number, index: number, cell: TemplateCell): BravaisSlot => {
    const col = bx * HALF_COLS + cell.col;
    const row = by * HALF_COLS + cell.row;
    const worldX = (half === 'left' ? 0 : HALF_COLS + SEAM_UNITS) + col + cell.w / 2;
    return {
        key: `${half}:${bx}:${by}:${index}`,
        half,
        bx,
        by,
        index,
        rect: unitRect(half, col, row, cell.w, cell.h),
        center: { x: worldX, y: row + cell.h / 2 },
    };
};

const blockSlots = (half: BravaisHalf, bx: number, by: number) => (
    templateFor(half, bx, by).map((cell, index) => buildSlot(half, bx, by, index, cell))
);

/** 屏内那两块（左右各一块）再加上下各露出的一截：不平移时看得见的全部磁贴。 */
const VISIBLE_BLOCKS: readonly [BravaisHalf, number, number][] = [
    ['left', 0, -1], ['left', 0, 0], ['left', 0, 1],
    ['right', 0, -1], ['right', 0, 0], ['right', 0, 1],
];

/** 平移、滚动、缝合上时会进入视口的块：右边多一列（墙往左拖），左边多一列（进 Lattice 时两半墙往中间靠）。 */
const WORLD_BLOCKS: readonly [BravaisHalf, number, number][] = [
    ['left', -1, -1], ['left', -1, 0], ['left', -1, 1],
    ...VISIBLE_BLOCKS,
    ['right', 1, -1], ['right', 1, 0], ['right', 1, 1],
];

export const BRAVAIS_VISIBLE_SLOTS: readonly BravaisSlot[] = VISIBLE_BLOCKS.flatMap(([half, bx, by]) => blockSlots(half, bx, by));
export const BRAVAIS_WORLD_SLOTS: readonly BravaisSlot[] = WORLD_BLOCKS.flatMap(([half, bx, by]) => blockSlots(half, bx, by));

const slotKey = (half: BravaisHalf, index: number, bx = 0, by = 0) => `${half}:${bx}:${by}:${index}`;

const slotByKey = (key: string): BravaisSlot => {
    const slot = BRAVAIS_WORLD_SLOTS.find(candidate => candidate.key === key);
    if (!slot) throw new Error(`[ponderBravaisGeometry] unknown slot ${key}`);
    return slot;
};

/** 展开聚焦卡之后左半面墙第 0 块的样子（下标同 TEMPLATE_A）。 */
export const BRAVAIS_FOCUS_BLOCK_SLOTS: readonly BravaisSlot[] = TEMPLATE_A_EXPANDED.map((cell, index) => buildSlot('left', 0, 0, index, cell));

// ---------------------------------------------------------------------------------------------
// 内容
// ---------------------------------------------------------------------------------------------

export type BravaisTileKind = 'track' | 'album' | 'playlist' | 'artist' | 'folder' | 'feed';
export type BravaisSpecial = 'liked' | 'personal-fm' | 'all-songs';

export type BravaisWallItem = {
    kind: BravaisTileKind;
    /** 封面的色相。 */
    hue: number;
    /** 集合的曲目数（标签写「种类 · N」）。 */
    count?: number;
    special?: BravaisSpecial;
    /** 歌曲左上角的序号。 */
    number?: string;
    /** 标题占位条的长度（0..1）。 */
    titleWidth: number;
};

/** 集合 / 歌手 / 歌曲混排的首页内容池；屏内那几张单独指定，其余按位置哈希取。 */
const HOME_POOL: readonly BravaisWallItem[] = [
    { kind: 'playlist', hue: 286, count: 48, titleWidth: 0.62 },
    { kind: 'artist', hue: 18, titleWidth: 0.5 },
    { kind: 'album', hue: 168, count: 11, titleWidth: 0.7 },
    { kind: 'track', hue: 212, number: '07', titleWidth: 0.56 },
    { kind: 'playlist', hue: 32, count: 120, titleWidth: 0.48 },
    { kind: 'album', hue: 330, count: 9, titleWidth: 0.66 },
    { kind: 'artist', hue: 248, titleWidth: 0.44 },
    { kind: 'track', hue: 96, number: '12', titleWidth: 0.6 },
    { kind: 'playlist', hue: 196, count: 36, titleWidth: 0.54 },
    { kind: 'album', hue: 4, count: 14, titleWidth: 0.5 },
];

const hashIndex = (key: string, modulo: number) => {
    let hash = 7;
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) % 9973;
    return hash % modulo;
};

/**
 * 屏内那两块里刻意指定的内容：每一种磁贴屏内都有，教程的字幕才指得到。
 * 左块（模板 A）：专辑大卡、歌曲、歌手、要展开的歌、歌单、歌曲、歌曲、歌单。
 * 右块（模板 B）：歌手、歌曲、「我喜欢的音乐」、要打开的歌单、私人 FM、歌曲、专辑、歌手、「全部歌曲」。
 */
const HOME_OVERRIDES: Record<string, BravaisWallItem> = {
    [slotKey('left', 0)]: { kind: 'album', hue: 168, count: 12, titleWidth: 0.66 },
    [slotKey('left', 1)]: { kind: 'track', hue: 212, number: '03', titleWidth: 0.6 },
    [slotKey('left', 2)]: { kind: 'artist', hue: 24, titleWidth: 0.56 },
    [slotKey('left', 3)]: { kind: 'track', hue: 192, number: '21', titleWidth: 0.62 },
    [slotKey('left', 4)]: { kind: 'playlist', hue: 300, count: 24, titleWidth: 0.6 },
    [slotKey('left', 5)]: { kind: 'track', hue: 40, number: '08', titleWidth: 0.54 },
    [slotKey('left', 6)]: { kind: 'track', hue: 128, number: '15', titleWidth: 0.42 },
    [slotKey('left', 7)]: { kind: 'playlist', hue: 260, count: 64, titleWidth: 0.4 },
    [slotKey('right', 0)]: { kind: 'artist', hue: 338, titleWidth: 0.5 },
    [slotKey('right', 1)]: { kind: 'track', hue: 84, number: '05', titleWidth: 0.58 },
    [slotKey('right', 2)]: { kind: 'playlist', hue: 350, count: 30, special: 'liked', titleWidth: 0.7 },
    [slotKey('right', 3)]: { kind: 'playlist', hue: 276, count: 350, titleWidth: 0.6 },
    [slotKey('right', 4)]: { kind: 'feed', hue: 14, special: 'personal-fm', titleWidth: 0.6 },
    [slotKey('right', 5)]: { kind: 'track', hue: 150, number: '11', titleWidth: 0.5 },
    [slotKey('right', 6)]: { kind: 'album', hue: 220, count: 10, titleWidth: 0.6 },
    [slotKey('right', 7)]: { kind: 'artist', hue: 56, titleWidth: 0.48 },
    [slotKey('right', 8)]: { kind: 'folder', hue: 180, count: 128, special: 'all-songs', titleWidth: 0.42 },
};

export const bravaisHomeItem = (slot: BravaisSlot): BravaisWallItem => (
    HOME_OVERRIDES[slot.key] ?? HOME_POOL[hashIndex(slot.key, HOME_POOL.length)]
);

/** 换页签之后（电台页签）的内容：歌单与电台。 */
const RADIO_POOL: readonly BravaisWallItem[] = [
    { kind: 'playlist', hue: 46, count: 30, titleWidth: 0.6 },
    { kind: 'playlist', hue: 206, count: 52, titleWidth: 0.5 },
    { kind: 'playlist', hue: 312, count: 18, titleWidth: 0.66 },
    { kind: 'playlist', hue: 136, count: 40, titleWidth: 0.44 },
    { kind: 'playlist', hue: 268, count: 25, titleWidth: 0.56 },
];

const RADIO_OVERRIDES: Record<string, BravaisWallItem> = {
    [slotKey('left', 0)]: { kind: 'feed', hue: 14, special: 'personal-fm', titleWidth: 0.6 },
    [slotKey('right', 3)]: { kind: 'feed', hue: 352, count: 30, titleWidth: 0.5 },
};

export const bravaisRadioItem = (slot: BravaisSlot): BravaisWallItem => (
    RADIO_OVERRIDES[slot.key] ?? RADIO_POOL[hashIndex(`radio:${slot.key}`, RADIO_POOL.length)]
);

/** 「打开集合」教程里被点的那张歌单：它原地成为新层的 01 号。 */
export const BRAVAIS_ORIGIN_SLOT = slotByKey(slotKey('right', 3));
/** 磁贴种类那一章里的歌手（悬停恢复原色的那张）。 */
export const BRAVAIS_ARTIST_SLOT = slotByKey(slotKey('left', 2));
/** 聚焦卡教程里被点的那首歌。 */
export const BRAVAIS_FOCUS_SLOT = slotByKey(slotKey('left', FOCUS_INDEX));

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 屏内磁贴按离起点磁贴的距离排好：打开集合时新层的序号就按这个顺序往外数。 */
const VISIBLE_BY_ORIGIN = [...BRAVAIS_VISIBLE_SLOTS].sort((a, b) => (
    distance(a.center, BRAVAIS_ORIGIN_SLOT.center) - distance(b.center, BRAVAIS_ORIGIN_SLOT.center)
));

/** 集合层：全是歌曲，起点那张是 01，颜色沿用起点的封面（集合封面一般就是第一首的封面）。 */
export const bravaisCollectionItem = (slot: BravaisSlot): BravaisWallItem => {
    const rank = VISIBLE_BY_ORIGIN.findIndex(candidate => candidate.key === slot.key);
    const hue = slot.key === BRAVAIS_ORIGIN_SLOT.key
        ? bravaisHomeItem(slot).hue
        : 250 + hashIndex(`collection:${slot.key}`, 70);
    return {
        kind: 'track',
        hue,
        number: String(rank + 1).padStart(2, '0'),
        titleWidth: 0.4 + hashIndex(`title:${slot.key}`, 30) / 100,
    };
};

/**
 * 翻牌的「圈」：一次翻牌按到起点的距离错开，教程里把它压成几圈依次翻（每一圈是一个结果层）。
 * `rings(origin)` 返回每一圈的 slot key 列表，第 0 圈只有起点自己。
 */
const ringsFrom = (
    origin: (slot: BravaisSlot) => number,
    edges: readonly number[],
): string[][] => {
    const rings: string[][] = edges.map(() => []);
    BRAVAIS_VISIBLE_SLOTS.forEach(slot => {
        const d = origin(slot);
        const ring = edges.findIndex(edge => d <= edge);
        rings[ring === -1 ? edges.length - 1 : ring].push(slot.key);
    });
    return rings;
};

/** 打开集合：从被点的那张往外翻，四圈。 */
export const BRAVAIS_OPEN_RINGS: readonly (readonly string[])[] = ringsFrom(
    slot => distance(slot.center, BRAVAIS_ORIGIN_SLOT.center),
    [0, 5, 9, Infinity],
);

const SEAM_CENTER_X = HALF_COLS + SEAM_UNITS / 2;

/** 返回：从缝开始往两边翻回去，三圈。 */
export const BRAVAIS_BACK_RINGS: readonly (readonly string[])[] = ringsFrom(
    slot => Math.abs(slot.center.x - SEAM_CENTER_X),
    [3.5, 6.5, Infinity],
);

/** 整墙入场：从视口左上角开始一波一波落回，三波。 */
export const BRAVAIS_ENTRANCE_WAVES: readonly (readonly string[])[] = ringsFrom(
    slot => slot.center.x + slot.center.y,
    [8, 15, Infinity],
);

/**
 * 部分透明档里是窗的那几格（每块 2～3 个，固定在墙的位置上）。
 * 真实实现是块坐标哈希出来的固定乱序取前 k 个；这里直接写死，教程里要指得到其中一扇。
 */
const WINDOW_SLOTS = new Set([
    slotKey('left', 1), slotKey('left', 5), slotKey('left', 6),
    slotKey('right', 1), slotKey('right', 5), slotKey('right', 7),
    slotKey('left', 2, 0, -1), slotKey('left', 4, 0, 1), slotKey('left', 7, 0, 1),
    slotKey('right', 3, 0, -1), slotKey('right', 6, 0, -1), slotKey('right', 0, 0, 1), slotKey('right', 5, 0, 1),
]);

export const isBravaisWindowSlot = (slot: BravaisSlot) => WINDOW_SLOTS.has(slot.key);

/** 部分透明档：内容跳过窗位往后排 —— 同一块的内容按块内顺序挪到下一个非窗的格子上，没有内容被盖掉。 */
export const bravaisWindowedItem = (slot: BravaisSlot): BravaisWallItem | null => {
    if (isBravaisWindowSlot(slot)) return null;
    const block = BRAVAIS_VISIBLE_SLOTS.filter(candidate => (
        candidate.half === slot.half && candidate.bx === slot.bx && candidate.by === slot.by
    ));
    const contentIndex = block.filter(candidate => candidate.index < slot.index && !isBravaisWindowSlot(candidate)).length;
    return bravaisHomeItem(block[contentIndex] ?? slot);
};

/** 部分透明档里字幕指着的那一扇窗（左上那块，不会被打开的工具面板挡住）。 */
export const BRAVAIS_WINDOW_SLOT = slotByKey(slotKey('left', 1));

// ---------------------------------------------------------------------------------------------
// 平移、浮层控件与锚点
// ---------------------------------------------------------------------------------------------

/** 拖动平移之后整面墙挪了多少（page 比例）：往左上拖，缝跟着墙一起往左走。 */
export const BRAVAIS_PAN = { x: -0.05, y: -0.2 } as const;
/** 滚轮再往下滚一段（纯纵向）。 */
export const BRAVAIS_SCROLL = { x: -0.05, y: -0.38 } as const;

/** 进 Lattice 时缝合上：两半墙各往中间靠半条缝。 */
export const BRAVAIS_SEAM_CLOSE_SHIFT = BRAVAIS_SEAM.width / 2;

const expanded = BRAVAIS_FOCUS_BLOCK_SLOTS[FOCUS_INDEX].rect;
const blockRect: PonderRelativeRect = unitRect('left', 0, 0, 8, 8);
const seamRect: PonderRelativeRect = { left: BRAVAIS_SEAM.left, width: BRAVAIS_SEAM.width, top: 0, height: 1 };

/** 相对 seam：首页窄缝里竖排的四个页签。换页签那一下点的是第二个。 */
export const BRAVAIS_SEAM_TABS: readonly PonderRelativeRect[] = [0, 1, 2, 3].map(index => ({
    left: 0.3, width: 0.4, top: 0.15 + index * 0.105, height: 0.09,
}));

/** 相对 focusCard：卡底部那排按钮（立即播放、加入队列；正在播放时多一颗「进入」）。 */
const FOCUS_PLAY: PonderRelativeRect = { left: 0.06, bottom: 0.06, width: 0.1, square: true };
const FOCUS_QUEUE: PonderRelativeRect = { left: 0.18, bottom: 0.06, width: 0.24, aspect: 0.4167 };
const FOCUS_ENTER: PonderRelativeRect = { left: 0.18, bottom: 0.06, width: 0.1, square: true };

const TOOLS_BUTTON: PonderRelativeRect = { right: 0.022, bottom: 0.035, width: 0.042, square: true };
const TOOLS_PANEL: PonderRelativeRect = { right: 0.022, bottom: 0.13, width: 0.26, height: 0.6 };

/** 相对 toolsPanel：顶上那排六格纯图标快捷动作（洗牌、主题、队列、前往 Lattice、播放页、设置）。 */
export const BRAVAIS_TOOLS_QUICK: readonly PonderRelativeRect[] = [0, 1, 2, 3, 4, 5].map(index => ({
    left: 0.04 + index * 0.153, width: 0.135, top: 0.07, height: 0.14,
}));
/** 相对 toolsPanel：各行。 */
export const BRAVAIS_TOOLS_ROWS = {
    volume: { left: 0.06, right: 0.06, top: 0.29, height: 0.1 },
    heading: { left: 0.06, right: 0.06, top: 0.42, height: 0.06 },
    look: { left: 0.04, right: 0.04, top: 0.5, height: 0.12 },
    tint: { left: 0.04, right: 0.04, top: 0.63, height: 0.12 },
    lights: { left: 0.06, right: 0.06, top: 0.8, height: 0.13 },
} satisfies Record<string, PonderRelativeRect>;

export const BRAVAIS_WALL_GEOMETRY = {
    /** 相对 page：整面墙（含缝）。 */
    wall: { left: 0, top: 0, width: 1, height: 1 },
    seam: seamRect,
    /** 相对 page：拖动、滚动之后的缝（横向跟着墙走了 BRAVAIS_SCROLL.x）。 */
    pannedSeam: { ...seamRect, left: BRAVAIS_SEAM.left + BRAVAIS_SCROLL.x },
    /** 相对 seam。 */
    seamTab: BRAVAIS_SEAM_TABS[1],
    song: slotByKey(slotKey('left', 1)).rect,
    collection: slotByKey(slotKey('left', 0)).rect,
    artist: BRAVAIS_ARTIST_SLOT.rect,
    special: slotByKey(slotKey('right', 2)).rect,
    fm: slotByKey(slotKey('right', 4)).rect,
    origin: BRAVAIS_ORIGIN_SLOT.rect,
    focusSong: BRAVAIS_FOCUS_SLOT.rect,
    block: blockRect,
    focusCard: expanded,
    /** 相对 focusCard。 */
    focusPlay: FOCUS_PLAY,
    focusQueue: FOCUS_QUEUE,
    focusEnter: FOCUS_ENTER,
    window: BRAVAIS_WINDOW_SLOT.rect,
    tools: TOOLS_BUTTON,
    toolsPanel: TOOLS_PANEL,
    /** 相对 toolsPanel。 */
    toolsLattice: BRAVAIS_TOOLS_QUICK[3],
    toolsLook: BRAVAIS_TOOLS_ROWS.look,
} satisfies Record<string, PonderRelativeRect>;

export const BRAVAIS_FOCUS_INDEX = FOCUS_INDEX;
