import { parseWallSlotKey } from '../../../components/wall/wallSlots';
import { BRAVAIS_LAYOUT_STORAGE_PREFIX } from './entry';
import { BRAVAIS_BLOCK_SHAPE, EXPLORE_BLOCK_SIZE, nearestShapeBoundaryX, nearestShapeBoundaryY, type BravaisWallShape } from './bravaisWallShape';

// src/library/suites/bravais/bravaisLayoutMemory.ts
// 每一层的布局记忆（设计稿 §10.8）：相机（视图中心）、缝的锚点（块边界的世界 x；横的缝是块行边界的世界 y）、无限拼贴的起点 slot、
// 键盘焦点所在的 slot。放 sessionStorage 而不是组件状态：离开首页约 350ms 后 stage 卸载（B1），回来时按层恢复。
// 键前缀定义在 entry.ts（manifest 的 layout.forget 就在那里按会话键删掉，entry 不能静态 import 本模块）。
// 每次都直接读写 sessionStorage，不在内存里另存一份：forget 只删存储，不会留下一份过期的缓存。
// 记忆带着记下时墙的形状种类（首页各页签共用一份记忆，块与探索的锚点、slot 键不通用）：用的时候先搬到要用的
// 形状上（fitBravaisLayoutToShape）。

export type BravaisLayoutRecord = {
    /** 视图中心（缝基准线下的世界点）。 */
    center: { x: number; y: number } | null;
    /** 缝的锚点（块边界的世界 x）。 */
    anchorX: number | null;
    /** 横的缝的锚点（块行边界的世界 y）；与 anchorX 至多一个不是 null，旧记录里没有这一项。 */
    anchorY?: number | null;
    /** 无限拼贴的起点 slot（显示第 1 项的那个）。 */
    startSlotKey: string | null;
    /** 离开时键盘焦点所在的 slot（返回时焦点回到当初被点的那张）。 */
    focusSlotKey: string | null;
    /** 记下时墙的形状种类（锚点、起点与焦点 slot 是按它说的）；缺省是块。 */
    shapeKind?: BravaisWallShape['kind'];
};

export const EMPTY_BRAVAIS_LAYOUT: BravaisLayoutRecord = {
    center: null,
    anchorX: null,
    startSlotKey: null,
    focusSlotKey: null,
};

const storage = (): Storage | null => {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const asString = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** 解析一份记录；任何字段坏了就当没有（不让一份脏数据把相机扔到无穷远）。 */
export const parseBravaisLayoutRecord = (raw: string | null): BravaisLayoutRecord | null => {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (!value || typeof value !== 'object') return null;
        const center = value.center as { x?: unknown; y?: unknown } | null | undefined;
        return {
            center: center && isFiniteNumber(center.x) && isFiniteNumber(center.y) ? { x: center.x, y: center.y } : null,
            anchorX: isFiniteNumber(value.anchorX) ? value.anchorX : null,
            ...(isFiniteNumber(value.anchorY) ? { anchorY: value.anchorY } : {}),
            startSlotKey: asString(value.startSlotKey),
            focusSlotKey: asString(value.focusSlotKey),
            shapeKind: value.shapeKind === 'explore' ? 'explore' : undefined,
        };
    } catch {
        return null;
    }
};

/**
 * 一份记忆搬到要用的形状上：锚点落到这个形状最近的块边界上；种类不同时起点换成它所在块的中心在这个形状上的
 * 起点（与换形状时搬起点同一个做法），焦点 slot 丢掉（那个键在这里是另一处，焦点改按会话的条目放）。
 */
export const fitBravaisLayoutToShape = (record: BravaisLayoutRecord, shape: BravaisWallShape): BravaisLayoutRecord => {
    const anchorX = record.anchorX === null ? null : nearestShapeBoundaryX(shape, record.anchorX);
    const anchorY = record.anchorY === undefined || record.anchorY === null ? record.anchorY : nearestShapeBoundaryY(shape, record.anchorY);
    const kind = record.shapeKind ?? 'blocks';
    if (kind === shape.kind) return { ...record, anchorX, ...(anchorY !== undefined ? { anchorY } : {}), shapeKind: kind };
    const size = kind === 'explore' ? EXPLORE_BLOCK_SIZE : BRAVAIS_BLOCK_SHAPE.blockSize;
    const address = record.startSlotKey ? parseWallSlotKey(record.startSlotKey) : null;
    const startSlotKey = address
        ? shape.startKeyAt({ x: (address.column + 0.5) * size.width, y: (address.row + 0.5) * size.height })
        : null;
    return { ...record, anchorX, ...(anchorY !== undefined ? { anchorY } : {}), startSlotKey, focusSlotKey: null, shapeKind: shape.kind };
};

export const readBravaisLayout = (sessionKey: string): BravaisLayoutRecord | null => (
    parseBravaisLayoutRecord(storage()?.getItem(BRAVAIS_LAYOUT_STORAGE_PREFIX + sessionKey) ?? null)
);

export const writeBravaisLayout = (sessionKey: string, record: BravaisLayoutRecord) => {
    try {
        storage()?.setItem(BRAVAIS_LAYOUT_STORAGE_PREFIX + sessionKey, JSON.stringify(record));
    } catch {
        // 配额满了或被禁用：布局记忆只是锦上添花。
    }
};
