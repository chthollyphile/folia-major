import React, { type MutableRefObject, type RefObject } from 'react';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { EMPTY_PLATE_BLOCKS, type PlateBlockSet } from './bravaisBlockPlate';
import BravaisBlockPlates from './BravaisBlockPlates';
import { resolveSlotFace, type BravaisDisplay } from './bravaisDisplay';
import { isSeeThroughFace } from './bravaisLook';
import BravaisTile, { type BravaisTileHandlers, type BravaisTileRect } from './BravaisTile';
import { BRAVAIS_BLOCK_SHAPE } from './bravaisWallShape';

// src/library/suites/bravais/BravaisWall.tsx
// 墙的两半：缝锚点左边的 slot 进左边的世界层，右边的进右边的（缝只开在块边界上，没有 slot 跨过它）。两个世界层的
// transform 由 stage 每帧直接写（bravaisFrame），这里只在裁剪范围、显示的层、聚焦 / 焦点变化时渲染。
// 透光档（B12b）：每一半先画各自块的实色底板（BravaisBlockPlates，在磁贴之下），底板随世界层一起平移。
// 信息条横向时缝开在块行边界上（anchorY）：锚点上面的 slot 进 left 层（上半），下面的进 right 层（下半）。

type BravaisWallProps = {
    slots: readonly WallSlot[];
    display: BravaisDisplay | null;
    anchorX: number | null;
    /** 横的缝的锚点（块行边界的世界 y）；与 anchorX 至多一个不是 null。 */
    anchorY?: number | null;
    /** 聚焦卡所在块的让位矩形（slot key → 新矩形）。 */
    reflow: ReadonlyMap<string, BravaisTileRect>;
    expandedSlotKey: string | null;
    focusedSlotKey: string | null;
    /** B7：列表面板里悬停的那一项。 */
    linkedKey?: string | null;
    pixelScale: number;
    reducedMotion: boolean;
    didDragRef: MutableRefObject<boolean>;
    handlers: BravaisTileHandlers;
    leftRef: RefObject<HTMLDivElement | null>;
    rightRef: RefObject<HTMLDivElement | null>;
    /** 透光档的块底板（按缝锚点分好左右）；实色档为空。 */
    plates?: PlateBlockSet;
};

const BravaisWall: React.FC<BravaisWallProps> = ({
    slots,
    display,
    anchorX,
    anchorY = null,
    reflow,
    expandedSlotKey,
    focusedSlotKey,
    linkedKey = null,
    pixelScale,
    reducedMotion,
    didDragRef,
    handlers,
    leftRef,
    rightRef,
    plates = EMPTY_PLATE_BLOCKS,
}) => {
    const left: React.ReactNode[] = [];
    const right: React.ReactNode[] = [];
    const nowPlayingKey = display?.layer.nowPlayingKey ?? null;
    // 形状换了，同一个 slot key 可能是另一块矩形：磁贴按块的矩形套重新挂载（落回），不在原地跳；矩形套没变的块原样留着。
    const shape = display?.shape ?? BRAVAIS_BLOCK_SHAPE;
    for (const slot of slots) {
        const { item, kind } = resolveSlotFace(display, slot);
        const expanded = slot.key === expandedSlotKey;
        const tile = (
            <BravaisTile
                key={`${shape.blockKey(slot.column, slot.row)}:${slot.key}`}
                slotKey={slot.key}
                rect={reflow.get(slot.key) ?? slot}
                item={item}
                kind={kind}
                seeThrough={isSeeThroughFace(display?.look ?? 'solid', kind, expanded)}
                step={display?.flips.get(slot.key)}
                nowPlayingKey={nowPlayingKey}
                expanded={expanded}
                keyboardFocused={slot.key === focusedSlotKey}
                queued={expanded && Boolean(item && display?.layer.queuedKeys.has(item.key))}
                linked={Boolean(item && linkedKey !== null && item.key === linkedKey)}
                pixelScale={pixelScale}
                reducedMotion={reducedMotion}
                entrance={display?.entrance ?? null}
                didDragRef={didDragRef}
                handlers={handlers}
            />
        );
        const before = anchorY !== null ? slot.y < anchorY : anchorX !== null && slot.x < anchorX;
        (before ? left : right).push(tile);
    }
    return (
        <>
            <div ref={leftRef} className="lattice-world" data-bravais-half="left">
                <BravaisBlockPlates blocks={plates.left} />
                {left}
            </div>
            <div ref={rightRef} className="lattice-world" data-bravais-half="right">
                <BravaisBlockPlates blocks={plates.right} />
                {right}
            </div>
        </>
    );
};

export default BravaisWall;
