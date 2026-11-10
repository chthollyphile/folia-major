import { useMemo, useRef } from 'react';
import type { WallSlot } from '../../../components/wall/wallSlots';
import type { BravaisDisplay } from './bravaisDisplay';
import {
    buildPlateBlock,
    collectMountedBlocks,
    EMPTY_PLATE_BLOCKS,
    isAboveAnchor,
    isLeftOfAnchor,
    isSamePlateBlock,
    type PlateBlock,
    type PlateBlockSet,
    type PlateRect,
} from './bravaisBlockPlate';

// src/library/suites/bravais/useBravaisBlockPlates.ts
// 透光档的实色底板（设计稿 §11）：每个已挂载的块一张 SVG（bravaisBlockPlate），由 BravaisWall 画进各自那一半的
// 世界层、磁贴之下，随相机平移——拖动、缝开合都不写底板。
// - 已挂载的块跟着裁剪走：新进来的块各画一次，离开的卸载；已挂的块只在它的洞变了时重画（同一块的输入没变就沿用
//   上一份，不重算；重算出来路径没变也沿用上一份，BravaisBlockPlates 里每块的 memo 不重渲染）。
// - 聚焦卡让位（展开、换卡、收起 / 换块时的归位）期间，受影响的块由 useBravaisReflowDriver 与磁贴同一帧逐帧重画；
//   这里只给落定的路径。
// - 实色档不挂（stage 根节点画墙面）。
// - 横的缝（anchorY）：块按行分上下两半（left 是上半），缝边上那一行的底板止于 / 铺到缝的边沿。

type CachedBlock = {
    display: BravaisDisplay;
    expandedSlotKey: string | null;
    reflow: ReadonlyMap<string, PlateRect>;
    anchorX: number | null;
    anchorY: number | null;
    block: PlateBlock;
};

export const useBravaisBlockPlates = ({
    enabled,
    slots,
    display,
    expandedSlotKey,
    reflow,
    anchorX,
    anchorY = null,
}: {
    /** 透明档才挂底板。 */
    enabled: boolean;
    slots: readonly WallSlot[];
    display: BravaisDisplay | null;
    expandedSlotKey: string | null;
    reflow: ReadonlyMap<string, PlateRect>;
    anchorX: number | null;
    anchorY?: number | null;
}): PlateBlockSet => {
    const cacheRef = useRef(new Map<string, CachedBlock>());

    const plates = useMemo<PlateBlockSet>(() => {
        const previous = cacheRef.current;
        if (!enabled || !display) {
            cacheRef.current = new Map();
            return EMPTY_PLATE_BLOCKS;
        }
        const next = new Map<string, CachedBlock>();
        const left: PlateBlock[] = [];
        const right: PlateBlock[] = [];
        for (const [key, { column, row }] of collectMountedBlocks(slots)) {
            const cached = previous.get(key);
            let block: PlateBlock;
            if (cached && cached.display === display && cached.expandedSlotKey === expandedSlotKey
                && cached.reflow === reflow && cached.anchorX === anchorX && cached.anchorY === anchorY) {
                block = cached.block;
            } else {
                const fresh = buildPlateBlock(column, row, display, expandedSlotKey, reflow, anchorX, anchorY);
                block = cached && isSamePlateBlock(cached.block, fresh) ? cached.block : fresh;
            }
            next.set(key, { display, expandedSlotKey, reflow, anchorX, anchorY, block });
            const before = anchorY !== null
                ? isAboveAnchor(row, anchorY, display.shape.blockSize)
                : isLeftOfAnchor(column, anchorX, display.shape.blockSize);
            (before ? left : right).push(block);
        }
        cacheRef.current = next;
        return { left, right };
    }, [anchorX, anchorY, display, enabled, expandedSlotKey, reflow, slots]);

    return plates;
};
