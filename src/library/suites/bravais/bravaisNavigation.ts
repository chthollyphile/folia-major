import { pickAdjacentRect, type WallDirection, type WallRect } from '../../../components/wall/wallNavigation';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { BRAVAIS_BLOCK_SHAPE, type BravaisWallShape } from './bravaisWallShape';

// src/library/suites/bravais/bravaisNavigation.ts
// 方向键在 bravais 墙上走到哪一张（纯计算）：打分复用 wall 的 pickAdjacentRect（与 Lattice 的
// findAdjacentInstance 同一套），候选是周围块里有内容的 slot，矩形用聚焦让位后的实际矩形。bravais 的块场按绝对块坐标
// 取模板（不按 Lattice 的循环 cell），所以候选在这里按块坐标列，而不是借 Lattice 的几何。
// 周围一圈块里找不到（有限墙的空画框，B7）时再向外扩，最多三圈（原型）。

export const findAdjacentSlot = (
    from: WallSlot,
    direction: WallDirection,
    {
        drawn = slot => slot,
        hasContent,
        shape = BRAVAIS_BLOCK_SHAPE,
    }: {
        /** slot 此刻画在哪（聚焦卡所在的块已让位）。 */
        drawn?: (slot: WallSlot) => WallRect;
        hasContent: (slot: WallSlot) => boolean;
        /** 墙的形状：块按它取（探索形状的地是座位与标题）。 */
        shape?: BravaisWallShape;
    },
): WallSlot | null => {
    const source = drawn(from);
    for (let radius = 1; radius <= 3; radius += 1) {
        const candidates: Array<{ value: WallSlot; rect: WallRect }> = [];
        for (let row = from.row - radius; row <= from.row + radius; row += 1) {
            for (let column = from.column - radius; column <= from.column + radius; column += 1) {
                for (const slot of shape.blockSlots(column, row)) {
                    if (slot.key === from.key || !hasContent(slot)) continue;
                    candidates.push({ value: slot, rect: drawn(slot) });
                }
            }
        }
        const next = pickAdjacentRect(source, candidates, direction, BRAVAIS_METRICS);
        if (next) return next;
    }
    return null;
};
