import type { SeamAxis } from '../../../components/wall/seamPlan';
import type { WallViewCenter } from '../../../components/wall/wallView';

// src/library/suites/bravais/bravaisAnchor.ts
// 缝的锚点（纯数据）：竖的缝开在块边界上（世界 x），信息条横向时横的缝开在块行边界上（世界 y），两者至多一个不是 null。
// 帧状态里是 anchorX / anchorY 两个字段，这里给它们一个合在一起的写法和几个常用的读法（方向、离缝最近的那个世界点）。

export type BravaisAnchor = { x: number | null; y: number | null };

export const NO_ANCHOR: BravaisAnchor = Object.freeze({ x: null, y: null });

/** 竖的缝的锚点。 */
export const columnAnchor = (x: number | null): BravaisAnchor => (x === null ? NO_ANCHOR : { x, y: null });

/** 横的缝的锚点。 */
export const rowAnchor = (y: number | null): BravaisAnchor => (y === null ? NO_ANCHOR : { x: null, y });

/** 锚点在哪个方向上；没有锚点时为 null。 */
export const anchorAxis = (anchor: BravaisAnchor): SeamAxis | null => {
    if (anchor.y !== null) return 'y';
    if (anchor.x !== null) return 'x';
    return null;
};

/** 帧状态（或布局记忆）里的锚点。 */
export const anchorOf = (state: { anchorX: number | null; anchorY?: number | null }): BravaisAnchor => (
    state.anchorY !== undefined && state.anchorY !== null ? rowAnchor(state.anchorY) : columnAnchor(state.anchorX)
);

export const isSameAnchor = (first: BravaisAnchor, second: BravaisAnchor) => first.x === second.x && first.y === second.y;

/** 「缝在哪」的世界点：竖的缝取锚点 x、相机 y，横的缝取相机 x、锚点 y，没有缝时是相机。离缝最近、从缝翻牌都按它。 */
export const seamPointOf = (state: { anchorX: number | null; anchorY?: number | null; center: WallViewCenter }) => ({
    x: state.anchorX ?? state.center.x,
    y: state.anchorY ?? state.center.y,
});

/** 可见范围（getViewWorldBounds）按缝放宽的那一项：竖的缝放宽左右，横的缝放宽上下。 */
export const seamBoundsOf = (state: { anchorY?: number | null; openWidth: number }) => (
    state.anchorY !== undefined && state.anchorY !== null ? { seamHeight: state.openWidth } : { seamWidth: state.openWidth }
);
