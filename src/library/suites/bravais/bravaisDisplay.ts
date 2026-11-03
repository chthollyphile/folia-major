import type { FlipOrigin, FlipPlan, FlipSlotChange } from '../../../components/wall/flipPlan';
import { getBlockReservedMask } from '../../../components/wall/blockReservedSlots';
import { getInfiniteSlotItem, getStartWrapOffset } from '../../../components/wall/startTile';
import { parseWallSlotKey, wallSlotKey, type WallSlot } from '../../../components/wall/wallSlots';
import type { LibraryWallLook } from '../../../utils/libraryWallLook';
import { BRAVAIS_BLOCK_SHAPE, exploreStartKey, resolveLayerShape, type BravaisWallShape } from './bravaisWallShape';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';
import type { WallWavePlan } from './bravaisWallWave';
import type { BravaisShiftKind } from './bravaisShift';
import { resolveFiniteRank, type BravaisFiniteState } from './bravaisFiniteWall';
import {
    bravaisFaceKey,
    isSeeThroughFace,
    resolveEmptySlotKind,
    resolveReservedPerBlock,
    resolveStartSlotKey,
    SOLID_WALL_LOOK,
    type BravaisTileKind,
    type BravaisWallLook,
} from './bravaisLook';

// src/library/suites/bravais/bravaisDisplay.ts
// 墙上此刻显示的是哪一层、每个 slot 显示哪一项（纯计算）。无限拼贴按起点 slot 求循环偏移（起点磁贴是第 1 项，
// 条目数变了重新求）；有限拼贴（过滤）在 B7 接 finiteWall 的 rank→slot。
// 换层 / 数据变化时 stage 对已渲染的 slot 逐个比较前后显示的条目 key，交给 wall 的 planFlip 排翻牌。

/**
 * 一次翻牌在单张磁贴上的安排：转到 90° 时换成 `to`（null = 墙面）。B9：`wave` 表示这是整墙出场 → 入场
 * （bravaisWallWave）——delay 是出场开始的时刻，inDelay 是落回开始的时刻（都从这次转场开始算）。
 */
export type BravaisFlipStep = { token: number; to: string | null; delay: number; direction: -1 | 1; wave?: { inDelay: number } };

/**
 * B11 整墙入场（从搜索页 / 播放页打开集合，下面没有首页墙）：没有出场段——磁贴立刻换成新内容、保持抬起，按离视口
 * 左上角（corner，世界坐标）的对角线距离错开落回（bravaisWallWave 的 getWaveStagger）。刚挂载的磁贴同样按它落回，
 * 所以不依赖换层那一刻渲染着哪些 slot（stage 刚挂载时还没有）。reduced：降低动态效果时换成 0.18s 淡入、不错开。
 */
export type BravaisEntrance = {
    token: number;
    corner: { left: number; top: number };
    /** performance.now() 时刻；until 之后挂载的磁贴不再入场。 */
    startedAt: number;
    until: number;
    reduced: boolean;
    /** 只有之后挂载的磁贴落回，已经在墙上的不动（探索页的 section 补到时原地重排，见 isGrownExploreShape）。 */
    mountsOnly?: boolean;
};

/** 墙上最近一次换层（B11）：种类与序号，stage 根节点据此标记（探针数「返回只翻一次」）。first 是 stage 挂载时直接画出。 */
export type BravaisShift = { kind: BravaisShiftKind | 'first'; seq: number };

export type BravaisDisplay = {
    layer: BravaisLayer;
    /** 墙的形状（bravaisWallShape）：slot 在哪、显示第几项。按层的 shape 与起点 slot 定。 */
    shape: BravaisWallShape;
    /** 无限拼贴的起点 slot（显示第 1 项）；没有就以 0 为偏移。 */
    startSlotKey: string | null;
    wrapOffset: number;
    /** 换层翻牌：slot key → 这张磁贴怎么翻。没有翻牌时为空。 */
    flips: ReadonlyMap<string, BravaisFlipStep>;
    flipToken: number;
    /** B7：过滤时的有限拼贴（严格 rank）；null / 缺省是无限拼贴。 */
    finite?: BravaisFiniteState | null;
    /** B7：remove-entry 的第一段——这些条目先翻成墙面，后面的 rank 再前移（展示层按住旧帧）。 */
    hiddenKeys?: ReadonlySet<string>;
    /** 透光档位（B6b③）：决定空 slot 是窗还是空画框、全透明档的内容磁贴透不透。 */
    look: LibraryWallLook;
    /**
     * 部分透明的结构窗：每块保留几个 slot（rank→slot 跳过它们）；其余档位为 0。无限拼贴的周期 / 偏移、有限拼贴的规划
     * （`finite` 须用同一个 k 规划，见 planBravaisFinite）与反查 slot 都按它跳过窗位。
     */
    reservedPerBlock: number;
    /** B11：这一层是整墙入场进来的（数据更新沿用到入场放完）。 */
    entrance?: BravaisEntrance | null;
    /** B11：最近一次换层（数据更新沿用）。 */
    shift?: BravaisShift | null;
};

/** 无限拼贴的循环周期按多少条算（补页期间是上游总数，见 BravaisLayerWall.periodCount）。 */
export const layerPeriodCount = (layer: BravaisLayer) => Math.max(layer.items.length, layer.wall?.periodCount ?? 0);

const NO_FLIPS: ReadonlyMap<string, BravaisFlipStep> = new Map();

const wallSlotKeyOf = (slot: Pick<WallSlot, 'column' | 'row' | 'slotIndex'> & { key?: string }) => (
    slot.key ?? wallSlotKey(slot.column, slot.row, slot.slotIndex)
);

/** 起点 slot 的循环偏移；条目数变了要重新求（B5：层里存起点 slot，不只存偏移）。 */
export const resolveWrapOffset = (startSlotKey: string | null, itemCount: number, reservedPerBlock = 0) => {
    const address = startSlotKey ? parseWallSlotKey(startSlotKey) : null;
    return getStartWrapOffset(address, itemCount, reservedPerBlock);
};

/**
 * 一层在墙上的显示。`wallLook` 缺省为实色（没有窗）；部分透明时内容跳过每块的结构窗，起点 slot 若恰好是窗就挪到
 * 同块最近的非窗 slot（起点磁贴不落在窗上）。
 */
export const createBravaisDisplay = (
    layer: BravaisLayer,
    startSlotKey: string | null,
    flip?: { token: number; plan: FlipPlan },
    wallLook: BravaisWallLook = SOLID_WALL_LOOK,
): BravaisDisplay => {
    const shape = resolveLayerShape(layer.shape, startSlotKey);
    // 结构窗只开在块上（探索形状的地按 section 切座位，没有窗位）。
    const reservedPerBlock = shape === BRAVAIS_BLOCK_SHAPE ? resolveReservedPerBlock(wallLook) : 0;
    const start = shape === BRAVAIS_BLOCK_SHAPE ? resolveStartSlotKey(startSlotKey, reservedPerBlock) : exploreStartKey(shape, startSlotKey);
    return {
        layer,
        shape,
        startSlotKey: start,
        wrapOffset: shape === BRAVAIS_BLOCK_SHAPE ? resolveWrapOffset(start, layerPeriodCount(layer), reservedPerBlock) : 0,
        flips: flip ? toFlipSteps(flip.token, flip.plan) : NO_FLIPS,
        flipToken: flip?.token ?? 0,
        look: wallLook.look,
        reservedPerBlock,
    };
};

/** 显示用的透光偏好是不是已经是这一份（换档 / 换窗数走同一层的数据更新）。 */
export const isDisplayedWallLook = (display: BravaisDisplay, wallLook: BravaisWallLook) => (
    display.look === wallLook.look
    && display.reservedPerBlock === (display.shape === BRAVAIS_BLOCK_SHAPE ? resolveReservedPerBlock(wallLook) : 0)
);

/** 一个 slot 显示的条目；墙面（空画框）为 null。 */
export const resolveSlotItem = (display: BravaisDisplay | null, slot: Pick<WallSlot, 'column' | 'row' | 'slotIndex'>): BravaisItem | null => {
    if (!display) return null;
    const { items } = display.layer;
    if (items.length === 0) return null;
    // B7：有限拼贴按 rank 取（rank ≥ 条目数是墙面）；无限拼贴的周期可能大于条目数（补页中），超出的位置是墙面。
    // B6b③：两种拼贴都跳过部分透明的结构窗（有限拼贴的 rank 顺序本身就不含窗位；无限拼贴的窗位是 null）。
    // 探索形状：slot 显示第几项由它所在的地与座位定（bravaisWallShape）。
    const index = display.finite
        ? resolveFiniteRank(display.finite, { key: wallSlotKeyOf(slot) })
        : display.shape.entryAt
            ? display.shape.entryAt(slot)
            : getInfiniteSlotItem(slot, layerPeriodCount(display.layer), display.wrapOffset, display.reservedPerBlock);
    const item = index === null ? null : items[index] ?? null;
    return item && display.hiddenKeys?.has(item.key) ? null : item;
};

export const resolveSlotItemKey = (display: BravaisDisplay | null, slot: WallSlot) => resolveSlotItem(display, slot)?.key ?? null;

/** 一个 slot 的内容与种类（透光：没有内容的 slot 是窗还是空画框）。 */
export const resolveSlotFace = (
    display: BravaisDisplay | null,
    slot: Pick<WallSlot, 'column' | 'row' | 'slotIndex'>,
): { item: BravaisItem | null; kind: BravaisTileKind } => {
    // 探索形状的 section 标题：一张只有字的磁贴（不是条目，点它、键盘走位都不落在它上面）。
    const section = display ? display.shape.headingAt(slot) : null;
    if (section !== null) {
        const heading = display?.layer.shape?.headings[section] ?? null;
        return heading ? { item: heading, kind: 'heading' } : { item: null, kind: 'wall' };
    }
    const item = resolveSlotItem(display, slot);
    if (item) return { item, kind: 'content' };
    if (!display) return { item: null, kind: 'wall' };
    const reserved = display.reservedPerBlock > 0
        && getBlockReservedMask(slot.column, slot.row, display.reservedPerBlock)[slot.slotIndex] === true;
    return { item: null, kind: resolveEmptySlotKind(display.look, reserved, display.layer.mode) };
};

/** 翻牌比较用的「面」的身份（不考虑聚焦卡：换层与换档都会先收起它）。 */
export const resolveSlotFaceKey = (display: BravaisDisplay | null, slot: WallSlot): string | null => {
    const { item, kind } = resolveSlotFace(display, slot);
    return bravaisFaceKey(item?.key ?? null, kind, isSeeThroughFace(display?.look ?? 'solid', kind, false));
};

/** 换显示前后，已渲染的 slot 各显示什么（交给 planFlip）。比较的是「面」：开窗、关窗、透不透也算变化。 */
export const diffDisplays = (
    before: BravaisDisplay | null,
    after: BravaisDisplay,
    slots: readonly WallSlot[],
): FlipSlotChange[] => slots.map(slot => ({
    slot,
    from: resolveSlotFaceKey(before, slot),
    to: resolveSlotFaceKey(after, slot),
}));

export const toFlipSteps = (token: number, plan: FlipPlan): ReadonlyMap<string, BravaisFlipStep> => {
    if (plan.flips.length === 0) return NO_FLIPS;
    return new Map(plan.flips.map(step => [step.key, { token, to: step.to, delay: step.delay, direction: step.direction }]));
};

/** 整墙出场 / 入场的计划 → 每张磁贴的安排（B9：换首页页签）。 */
export const toWaveSteps = (token: number, plan: WallWavePlan): ReadonlyMap<string, BravaisFlipStep> => {
    if (plan.steps.length === 0) return NO_FLIPS;
    return new Map(plan.steps.map(step => [step.key, { token, to: step.to, delay: step.outDelay, direction: 1, wave: { inDelay: step.inDelay } }]));
};

/** 离一个世界点最近的 slot（没有起点的层用缝点定起点；第一次按方向键落在离缝最近的磁贴）。 */
export const findNearestSlot = <T extends Pick<WallSlot, 'centerX' | 'centerY'>>(
    slots: readonly T[],
    point: { x: number; y: number },
    accept: (slot: T) => boolean = () => true,
): T | null => {
    let best: T | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
        if (!accept(slot)) continue;
        const distance = (slot.centerX - point.x) ** 2 + (slot.centerY - point.y) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = slot;
        }
    }
    return best;
};

/** 翻牌的起点：push 是被点的磁贴（起点磁贴），其余（back、换页签、数据到达）是缝点。 */
export const pointOrigin = (point: { x: number; y: number }): FlipOrigin => ({ kind: 'point', x: point.x, y: point.y });

/**
 * 单张磁贴怎么从「正在显示的」换到「该显示的」（翻牌状态机的纯部分）：
 * - none：内容没变（同一 key 的数据更新就地刷新）；
 * - flip：这次翻牌安排了它、目标正是现在该显示的那一项——转到 90° 时换（整墙波次是抬起 → 落回）；
 * - fade：同上，但降低了动态效果（B11）：淡出 → 换内容 → 淡入，合计 0.18s，不错开；
 * - swap：其余（屏外、超出 400 张上限、目标又变了）直接换。
 */
export const resolveTileTransition = (
    shownKey: string | null,
    targetKey: string | null,
    step: BravaisFlipStep | undefined,
    reducedMotion: boolean,
): 'none' | 'flip' | 'fade' | 'swap' => {
    if (shownKey === targetKey) return 'none';
    if (step && step.to === targetKey) return reducedMotion ? 'fade' : 'flip';
    return 'swap';
};

/**
 * 离一个世界点最近、显示着某一项的 slot（无限拼贴上同一项有好几份）：只在周围 `radius` 圈块里找（原型的 locateNowPlaying），
 * 找不到就是 null（那一项不在这一层，或离得太远）。块按显示的形状取。
 */
export const findItemSlotNear = (
    display: BravaisDisplay | null,
    itemKey: string,
    point: { x: number; y: number },
    radius = 4,
): WallSlot | null => {
    if (!display) return null;
    const blockSize = display.shape.blockSize;
    const collectBlock = display.shape.blockSlots;
    const column = Math.floor(point.x / blockSize.width);
    const row = Math.floor(point.y / blockSize.height);
    const candidates: WallSlot[] = [];
    for (let y = row - radius; y <= row + radius; y += 1) {
        for (let x = column - radius; x <= column + radius; x += 1) {
            for (const slot of collectBlock(x, y)) {
                if (resolveSlotItem(display, slot)?.key === itemKey) candidates.push(slot);
            }
        }
    }
    return findNearestSlot(candidates, point);
};

const NO_REFLOW: ReadonlyMap<string, WallSlot> = new Map();

/** 聚焦卡展开时它所在块的新矩形（slot key → 矩形；块是 12 个，探索形状的地是它的座位与标题）。 */
export const resolveFocusReflow = (expandedSlotKey: string | null, shape: BravaisWallShape = BRAVAIS_BLOCK_SHAPE): ReadonlyMap<string, WallSlot> => {
    const address = expandedSlotKey ? parseWallSlotKey(expandedSlotKey) : null;
    if (!address) return NO_REFLOW;
    const slots = shape.grownBlock(address.column, address.row, address.slotIndex);
    return slots ? new Map(slots.map(slot => [slot.key, slot])) : NO_REFLOW;
};
