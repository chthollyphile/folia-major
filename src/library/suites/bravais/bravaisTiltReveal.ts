import type { RevealRect } from '../../../components/wall/revealRect';
import { getViewLineX, type WallViewCenter } from '../../../components/wall/wallView';
import { computeBravaisFrame, rotateAround, seamEdgeFor, seamPlanEdge, type BravaisFrameInput } from './bravaisFrame';

// src/library/suites/bravais/bravaisTiltReveal.ts
// 整层倾斜着时（歌手页 / 专辑页的海报，以及 BRAVAIS_TILT_DEG 里给了角度的首页、集合页）键盘焦点与聚焦卡的相机让位。
// 普通的 resolveRevealCenter 按没倾斜的屏幕算，而倾斜时整层绕缝的右缘转；海报本身也是墙上的一道缝（跟着相机走，贴着视口
// 左边，往右挪就被挤窄）。这里按真正画出来的样子（computeBravaisFrame 的两半墙偏移与倾斜）量磁贴在屏幕上的外接框，求让它
// 完整可见的最小相机移动；能让缝保持整条张开时优先那样（往回走时缝重新张开），放不下才挤窄它——和拖动时一样。

type TiltedRevealInput = {
    rect: RevealRect;
    /** 此刻的帧输入（含视图中心、锚点、开口、倾斜）；只换 center 重算。 */
    frame: BravaisFrameInput;
    /** 缝张开后的宽度（屏幕 px；开口补间中按张开后的算）。 */
    seamWidth: number;
    /** 磁贴四周留的屏幕边距。 */
    pad: number;
    /** 磁贴底边要高过的距离（播放条安全区）。 */
    bottomInset: number;
};

type Box = { left: number; right: number; top: number; bottom: number };

const ITERATIONS = 8;
const TOLERANCE_PX = 0.5;

/** 世界矩形按此刻的帧画到屏幕上（含两半墙的让位与倾斜）后的外接框。 */
export const tiltedScreenBox = (rect: RevealRect, frame: BravaisFrameInput): Box => {
    const drawn = computeBravaisFrame(frame);
    const half = frame.anchorX !== null && rect.x + rect.width / 2 < frame.anchorX ? drawn.left : drawn.right;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]) {
        const corner = rotateAround(x * drawn.scale + half.x, y * drawn.scale + half.y, drawn.tilt, drawn.tilt.deg);
        xs.push(corner.x);
        ys.push(corner.y);
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

/** 外接框要挪多少（屏幕 px）才落进 [low, high]；比区间还大时居中。 */
const shiftInto = (start: number, end: number, low: number, high: number) => {
    if (end - start > high - low) return (low + high) / 2 - (start + end) / 2;
    if (start < low) return low - start;
    if (end > high) return high - end;
    return 0;
};

/**
 * 从 center 出发，按画出来的外接框反复修正：横向相机移动在屏幕上是纯横移（倾斜的支点跟着缝一起走），纵向移动沿倾斜后的
 * 竖直方向走、顺带一点横移，下一轮再补；缝被挤窄时支点也会动，所以迭代到不用再挪为止。lockX 时只上下挪。
 */
const solve = (input: TiltedRevealInput, center: WallViewCenter, lockX: boolean) => {
    const { rect, frame, pad, bottomInset } = input;
    const view = frame.view;
    const cos = Math.cos(((frame.tiltDeg ?? 0) * Math.PI) / 180);
    let current = center;
    let fits = false;
    for (let step = 0; step < ITERATIONS; step += 1) {
        const box = tiltedScreenBox(rect, { ...frame, center: current });
        const neededX = shiftInto(box.left, box.right, pad, view.width - pad);
        const shiftX = lockX ? 0 : neededX;
        const shiftY = shiftInto(box.top, box.bottom, pad, view.height - bottomInset);
        fits = Math.abs(neededX) < TOLERANCE_PX && Math.abs(shiftY) < TOLERANCE_PX;
        if (Math.abs(shiftX) < TOLERANCE_PX && Math.abs(shiftY) < TOLERANCE_PX) break;
        current = {
            x: current.x - shiftX / view.scale,
            y: current.y - shiftY / (view.scale * Math.max(cos, 0.1)),
        };
    }
    return { center: current, fits };
};

/**
 * 整层倾斜着时让 rect 完整可见的视图中心，从 frame.center 出发挪得最少；已经可见时原样返回。要把磁贴放到屏幕中间（定位）
 * 时，调用方把 frame.center 换成没倾斜时算出的居中位置，这里再按倾斜后的样子修正。
 */
export const resolveTiltedRevealCenter = (input: TiltedRevealInput): WallViewCenter => {
    const { frame, seamWidth } = input;
    const free = solve(input, frame.center, false).center;
    if (frame.anchorX === null) return free;
    // 缝整条张开的相机范围（海报贴着视口边不收窄，边距 0；其余的缝留 SEAM_EDGE_MARGIN，倾斜着再多留一段，转过去的
    // 上端 / 下端不横着出屏，与排开口时一样）：能在这里看全磁贴就停在这里。
    const view = frame.view;
    const lineX = getViewLineX(view);
    const need = seamWidth / 2 + seamPlanEdge({ view, openWidth: seamWidth, tiltDeg: frame.poster ? 0 : frame.tiltDeg ?? 0, edge: seamEdgeFor(Boolean(frame.poster)) });
    const openLow = frame.anchorX - (view.width - need - lineX) / view.scale;
    const openHigh = frame.anchorX + (lineX - need) / view.scale;
    const openX = Math.min(openHigh, Math.max(openLow, free.x));
    if (Math.abs(openX - free.x) < TOLERANCE_PX / view.scale) return free;
    const open = solve(input, { x: openX, y: free.y }, true);
    return open.fits ? open.center : free;
};
