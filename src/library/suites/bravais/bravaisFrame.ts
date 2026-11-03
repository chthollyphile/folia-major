import { SEAM_EDGE_MARGIN, getSeamGeometry, getSeamGeometryY, getSeamSplitOffsets, nearestSeamBoundaryX, type SeamAxis } from '../../../components/wall/seamPlan';
import { cameraFromViewCenter, getViewLineX, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisFrame.ts
// 每一帧要写到 DOM 上的几何（纯计算）：墙的左右两半各自的 transform、缝的屏幕位置与宽度、缝内容的透明度、
// 边缘标签在不在、在哪一侧。缝开在块边界上，没有磁贴跨过它，所以墙按锚点分成左右两个世界层，各自平移让出
// 半个开口（加半个 GAP），不需要裁剪。stage 在相机移动、缝开合时调用它，只写 transform / 尺寸，不经过 React。
// 信息条横向时锚点是块行边界的世界 y（anchorY）：墙分上下两半（仍叫 left / right，left 是上半），各自上下让开，缝是
// 一道横跨视口的横条；边缘标签仍在左右侧边（横条贴着上下边收起时标签在左边）。海报总是竖的，倾斜只跟着竖的缝。

export type BravaisFrameInput = {
    center: WallViewCenter;
    view: WallView;
    /** 缝锚点的世界 x；没有层时为 null（墙合拢，没有缝）。 */
    anchorX: number | null;
    /** 横向的缝的锚点（块行边界的世界 y）；与 anchorX 至多一个不是 null。 */
    anchorY?: number | null;
    /** 此刻（动画中）的目标开口宽度，屏幕 px。 */
    openWidth: number;
    /** 缝里此刻渲染的那套内容的排版宽度（翻转不重排：不跟目标宽度走）。 */
    contentWidth: number;
    /** 折叠等级（hidden）：标签换成悬浮按钮，常驻。 */
    hidden: boolean;
    /**
     * 歌手海报：仍是墙上裂开的开口（与信息条同一层），只是贴着视口边也不收窄（边距为 0），相机把它带到最左边
     * （planPosterOpening）。
     */
    poster?: boolean;
    /** 整层（两半墙与缝）此刻的倾斜角（度；海报在场时转过去，见 BRAVAIS_POSTER_TILT_DEG）。 */
    tiltDeg?: number;
};

export type BravaisFrame = {
    left: { x: number; y: number };
    right: { x: number; y: number };
    scale: number;
    /** 缝的方向：'x' 竖的（x 是中线的屏幕 x），'y' 横的（y 是中线的屏幕 y）；width 都是开口（横条是高度）。 */
    seam: { axis: SeamAxis; x: number; y: number; width: number; visible: boolean };
    /** 缝内容的透明度：开口比排版宽度窄时随之淡出。 */
    contentOpacity: number;
    /** 边缘标签：自动出屏收起（collapsed）或手动折叠（hidden）时出现。 */
    tab: { visible: boolean; side: 'left' | 'right' };
    /** 两个世界层与缝共同的倾斜（屏幕坐标里绕 pivot 转）；deg 为 0 时不转。 */
    tilt: { deg: number; pivotX: number; pivotY: number };
};

/** 内容透明度：原型的 (开口 / 排版宽度 − .35) / .65，开到三成五以下就看不见。 */
const contentOpacityFor = (width: number, contentWidth: number) => (
    Math.max(0, Math.min(1, (width / Math.max(contentWidth, 1) - 0.35) / 0.65))
);

export const computeBravaisFrame = ({ center, view, anchorX, anchorY = null, openWidth, contentWidth, hidden, poster = false, tiltDeg = 0 }: BravaisFrameInput): BravaisFrame => {
    const camera = cameraFromViewCenter(center, view);
    if (anchorX === null && anchorY !== null) {
        const geometry = getSeamGeometryY({ anchorY, cameraY: center.y, openWidth, view });
        const offsets = getSeamSplitOffsets(geometry.width, view.scale, BRAVAIS_METRICS);
        return {
            left: { x: camera.x, y: camera.y + offsets.left },
            right: { x: camera.x, y: camera.y + offsets.right },
            scale: view.scale,
            seam: { axis: 'y', x: view.width / 2, y: geometry.screenY, width: geometry.width, visible: geometry.width >= 1 },
            contentOpacity: contentOpacityFor(geometry.width, Math.max(contentWidth, 1)),
            tab: { visible: hidden || geometry.collapsed, side: 'left' },
            tilt: { deg: 0, pivotX: 0, pivotY: 0 },
        };
    }
    if (anchorX === null) {
        return {
            left: { x: camera.x, y: camera.y },
            right: { x: camera.x, y: camera.y },
            scale: view.scale,
            seam: { axis: 'x', x: view.width / 2, y: view.height / 2, width: 0, visible: false },
            contentOpacity: 0,
            tab: { visible: false, side: 'left' },
            tilt: { deg: 0, pivotX: 0, pivotY: 0 },
        };
    }
    const geometry = getSeamGeometry({ anchorX, cameraX: center.x, openWidth, view, edge: seamEdgeFor(poster) });
    const offsets = getSeamSplitOffsets(geometry.width, view.scale, BRAVAIS_METRICS);
    const layoutWidth = Math.max(contentWidth, 1);
    return {
        left: { x: camera.x + offsets.left, y: camera.y },
        right: { x: camera.x + offsets.right, y: camera.y },
        scale: view.scale,
        seam: { axis: 'x', x: geometry.screenX, y: view.height / 2, width: geometry.width, visible: geometry.width >= 1 },
        // 原型：(开口 / 排版宽度 − .35) / .65，开到三成五以下就看不见。
        contentOpacity: contentOpacityFor(geometry.width, layoutWidth),
        tab: { visible: hidden || geometry.collapsed, side: geometry.side },
        // 倾斜绕缝的右缘、视口半高转：两半墙与缝一起转，是同一张纸。
        tilt: { deg: tiltDeg, pivotX: geometry.screenX + geometry.width / 2, pivotY: view.height / 2 },
    };
};

/**
 * 空墙说明（BravaisWallHint）占的横向区间（屏幕 px）：缝两侧较宽的那一边，一样宽时取右边；缝不在屏上（没有层、
 * 合拢、折叠）时是整个视口。缝随墙移动、开合，这个区间每帧跟着变（useBravaisFrame 写到说明的 left / width 上）。
 */
export const wallHintSpan = (frame: BravaisFrame, viewWidth: number): { left: number; width: number } => {
    if (!frame.seam.visible || frame.seam.axis !== 'x') return { left: 0, width: viewWidth };
    const seamLeft = Math.min(viewWidth, Math.max(0, frame.seam.x - frame.seam.width / 2));
    const seamRight = Math.min(viewWidth, Math.max(0, frame.seam.x + frame.seam.width / 2));
    const rightRoom = viewWidth - seamRight;
    return rightRoom >= seamLeft ? { left: seamRight, width: rightRoom } : { left: 0, width: seamLeft };
};

/** 空墙说明占的纵向区间：横向的缝上下较高的那一边（一样高时取下边）；竖的缝或缝不在屏上时是整个视口高。 */
export const wallHintRowSpan = (frame: BravaisFrame, viewHeight: number): { top: number; height: number } => {
    if (!frame.seam.visible || frame.seam.axis !== 'y') return { top: 0, height: viewHeight };
    const seamTop = Math.min(viewHeight, Math.max(0, frame.seam.y - frame.seam.width / 2));
    const seamBottom = Math.min(viewHeight, Math.max(0, frame.seam.y + frame.seam.width / 2));
    const below = viewHeight - seamBottom;
    return below >= seamTop ? { top: seamBottom, height: below } : { top: 0, height: seamTop };
};

/** 缝贴着视口边时从多远开始收窄：海报贴边不收（它就该占满左边），其余沿用墙的边距。 */
export const seamEdgeFor = (poster: boolean) => (poster ? 0 : SEAM_EDGE_MARGIN);

/**
 * 歌手海报的相机：裂开的那条块边界（锚点）放到屏幕上 width / 2 的位置，缝的左缘正好贴着视口左边，左半面墙整个
 * 推出画面，右半面从缝的右缘（加半个 GAP）开始。preferX 给出时沿用那条块边界（从点中的磁贴旁裂开，相机把它带过去），
 * 否则取此刻落在那个位置附近的块边界。
 */
export const planPosterOpening = ({ center, view, width, preferX }: {
    center: WallViewCenter;
    view: WallView;
    width: number;
    preferX?: number;
}): { anchorX: number; center: WallViewCenter } => {
    const offset = (width / 2 - getViewLineX(view)) / view.scale;
    const anchorX = preferX ?? nearestSeamBoundaryX(center.x + offset, BRAVAIS_METRICS);
    return { anchorX, center: { x: anchorX - offset, y: center.y } };
};

const SAFE_MARGIN_PX = 14;

/**
 * 海报跟着整层倾斜时，它的四个角会转出屏幕（左上的面包屑、左下的按钮被切掉）。海报内容按这个比例缩小、贴着缝的
 * 右缘、上下挪 offsetY，让四个角都落在屏幕里（留 SAFE_MARGIN_PX）。算的是海报落定的样子（缝的左缘贴着视口左边、
 * 绕右缘半高转），与此刻的平移无关，所以拖动时不会忽大忽小；倾斜补间时随角度一起变。不倾斜时是 1 / 0。
 */
export const posterSafeArea = ({ width, height, deg }: { width: number; height: number; deg: number }) => {
    if (Math.abs(deg) < 0.01 || width <= 0 || height <= 0) return { scale: 1, offsetY: 0 };
    const radians = deg * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const half = height / 2;
    // 缩放 scale、上缘在 t 时，四个角相对转轴（缝右缘、半高）的位置：rx ∈ {−scale·width, 0}，ry ∈ {t − half, t + scale·height − half}。
    // 屏幕上 x = width + rx·cos − ry·sin，y = half + rx·sin + ry·cos，都是 t 的一次式：每个角给 t 一个上下界。
    const rangeFor = (scale: number) => {
        let low = -Infinity;
        let high = Infinity;
        const bound = (coefficient: number, constant: number, min: number, max: number) => {
            // min ≤ constant + coefficient·t ≤ max
            if (Math.abs(coefficient) < 1e-9) {
                if (constant < min || constant > max) low = Infinity;
                return;
            }
            const a = (min - constant) / coefficient;
            const b = (max - constant) / coefficient;
            low = Math.max(low, Math.min(a, b));
            high = Math.min(high, Math.max(a, b));
        };
        for (const rx of [-scale * width, 0]) {
            for (const extra of [0, scale * height]) {
                // ry = t + extra − half
                const base = extra - half;
                bound(-sin, width + rx * cos - base * sin, SAFE_MARGIN_PX, Infinity);
                bound(cos, half + rx * sin + base * cos, SAFE_MARGIN_PX, height - SAFE_MARGIN_PX);
            }
        }
        return { low, high };
    };
    let lo = 0.5;
    let hi = 1;
    if (rangeFor(1).low <= rangeFor(1).high) lo = 1;
    else {
        for (let step = 0; step < 24; step += 1) {
            const mid = (lo + hi) / 2;
            const range = rangeFor(mid);
            if (range.low <= range.high) lo = mid; else hi = mid;
        }
    }
    const range = rangeFor(lo);
    const centred = (1 - lo) * height / 2;
    const offsetY = Number.isFinite(range.low) ? Math.min(Math.max(centred, range.low), range.high) : centred;
    return { scale: lo, offsetY };
};

/**
 * 倾斜时视口在「没倾斜的屏幕坐标」里的外接框，相对 [0, 宽] × [0, 高] 各边挪了多少（px，往外为正、往里为负）：视口四个角
 * 按倾斜反转回去（u = R⁻¹(s − pivot) + pivot）。支点跟着缝在屏幕上走——缝被拖到视口外很远时，反转回去的视口整块平移开
 * （偏移随支点离视口的距离增长），一边往外、对边往里；裁剪要跟着挪，不然渲染的那片墙全在屏幕外。
 */
export const getTiltReach = (view: { width: number; height: number }, tilt: BravaisFrame['tilt']) => {
    if (Math.abs(tilt.deg) < 0.001) return { left: 0, right: 0, top: 0, bottom: 0 };
    const radians = (-tilt.deg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const corners = [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]].map(([x, y]) => {
        const dx = x - tilt.pivotX;
        const dy = y - tilt.pivotY;
        return { x: tilt.pivotX + dx * cos - dy * sin, y: tilt.pivotY + dx * sin + dy * cos };
    });
    const xs = corners.map(corner => corner.x);
    const ys = corners.map(corner => corner.y);
    return {
        left: -Math.min(...xs),
        right: Math.max(...xs) - view.width,
        top: -Math.min(...ys),
        bottom: Math.max(...ys) - view.height,
    };
};

/** 世界层的 transform 前面加上绕屏幕点的倾斜（世界层的 transform-origin 是 0 0，与屏幕原点重合）。 */
export const withTilt = (transform: string, tilt: BravaisFrame['tilt']) => (
    Math.abs(tilt.deg) < 0.001
        ? transform
        : `translate(${tilt.pivotX}px, ${tilt.pivotY}px) rotate(${tilt.deg}deg) translate(${-tilt.pivotX}px, ${-tilt.pivotY}px) ${transform}`
);
