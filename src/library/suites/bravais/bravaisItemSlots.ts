import { getBlockReservedMask } from '../../../components/wall/blockReservedSlots';
import { getWrapPeriod } from '../../../components/wall/startTile';
import { getBlockSize, getWallSlot, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { layerPeriodCount, type BravaisDisplay } from './bravaisDisplay';

// src/library/suites/bravais/bravaisItemSlots.ts
// 反查：某一项此刻显示在墙上的哪个 slot（列表面板单击定位、remove-entry 的翻牌起点、用会话焦点摆初始焦点）。
// 有限拼贴只有一份（rank → slot 直接查）；无限拼贴每个周期都有一份，按 wall/startTile 的循环规则倒推：周期内第 p 个位置
// 显示第 p mod N 项，位置 p = 块序 × 每块容量 + 块内第几个非保留 slot，再在离给定点最近的那个周期副本里取。纯计算，
// 不扫描裁剪范围，所以离屏很远的条目（5000 首的歌单）也是常数时间。

const mod = (value: number, size: number) => ((value % size) + size) % size;

/** 块里第 `within` 个非保留 slot 的序号（没有保留位时就是 within）。 */
const nthContentSlot = (column: number, row: number, within: number, reservedPerBlock: number) => {
    if (reservedPerBlock <= 0) return within;
    const mask = getBlockReservedMask(column, row, reservedPerBlock);
    let seen = 0;
    for (let index = 0; index < mask.length; index += 1) {
        if (mask[index]) continue;
        if (seen === within) return index;
        seen += 1;
    }
    return null;
};

/** 离 `near` 最近的那个周期副本里，周期第 `position` 位所在的 slot。 */
const nearestCopy = (
    position: number,
    period: ReturnType<typeof getWrapPeriod>,
    near: { x: number; y: number },
    reservedPerBlock: number,
): WallSlot | null => {
    const block = getBlockSize(BRAVAIS_METRICS);
    const blockIndex = Math.floor(position / period.perBlock);
    const within = position % period.perBlock;
    const baseColumn = blockIndex % period.blocksPerRow;
    const baseRow = Math.floor(blockIndex / period.blocksPerRow);
    // 离 near 最近的周期：先按块坐标取整，再看前后各一个周期（块里 slot 的中心与块中心不同）。
    const columnCycle = Math.round((near.x / block.width - baseColumn - 0.5) / period.blocksPerRow);
    const rowCycle = Math.round((near.y / block.height - baseRow - 0.5) / period.blockRows);
    let best: WallSlot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const column = baseColumn + (columnCycle + dx) * period.blocksPerRow;
            const row = baseRow + (rowCycle + dy) * period.blockRows;
            const slotIndex = nthContentSlot(column, row, within, reservedPerBlock);
            const slot = slotIndex === null ? null : getWallSlot(column, row, slotIndex, BRAVAIS_METRICS);
            if (!slot) continue;
            const distance = (slot.centerX - near.x) ** 2 + (slot.centerY - near.y) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = slot;
            }
        }
    }
    return best;
};

/**
 * 无限拼贴上第 `index` 项离 `near` 最近的一份。一个周期里同一项可能出现不止一次（周期按整块凑满），都算候选。
 */
export const findInfiniteItemSlot = ({
    index,
    periodCount,
    wrapOffset,
    near,
    reservedPerBlock = 0,
}: {
    index: number;
    periodCount: number;
    wrapOffset: number;
    near: { x: number; y: number };
    reservedPerBlock?: number;
}): WallSlot | null => {
    if (periodCount <= 0 || index < 0 || index >= periodCount) return null;
    const period = getWrapPeriod(periodCount, reservedPerBlock);
    const total = period.blocksPerRow * period.blockRows * period.perBlock;
    const raw = mod(index - wrapOffset, periodCount);
    let best: WallSlot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let position = raw; position < total; position += periodCount) {
        const slot = nearestCopy(position, period, near, reservedPerBlock);
        if (!slot) continue;
        const distance = (slot.centerX - near.x) ** 2 + (slot.centerY - near.y) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = slot;
        }
    }
    return best;
};

/** 某一项（条目 key）在当前显示里离 `near` 最近的 slot；不在这一层、或被过滤掉 / 正在移除时是 null。 */
export const findDisplayItemSlot = (
    display: BravaisDisplay | null,
    itemKey: string,
    near: { x: number; y: number },
): WallSlot | null => {
    if (!display || display.hiddenKeys?.has(itemKey)) return null;
    const index = display.layer.items.findIndex(item => item.key === itemKey);
    if (index < 0) return null;
    if (display.finite) {
        const slot = display.finite.order[index];
        return slot ?? null;
    }
    // 探索形状：按网格探索墙的反查（离 near 最近的那块地上的那个座位）。
    if (display.shape.nearestEntry) return display.shape.nearestEntry(index, near);
    return findInfiniteItemSlot({
        index,
        periodCount: layerPeriodCount(display.layer),
        wrapOffset: display.wrapOffset,
        near,
        reservedPerBlock: display.reservedPerBlock,
    });
};
