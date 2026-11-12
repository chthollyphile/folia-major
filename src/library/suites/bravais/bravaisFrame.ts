import { SEAM_EDGE_MARGIN, getSeamGeometry, getSeamGeometryY, getSeamSplitOffsets, nearestSeamBoundaryX, type SeamAxis } from '../../../components/wall/seamPlan';
import { cameraFromViewCenter, getViewLineX, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisFrame.ts
// 每一帧要写到 DOM 上的几何（纯计算）：墙的左右两半各自的 transform、缝的屏幕位置与宽度、缝内容的透明度、
// 边缘标签在不在、在哪一侧。缝开在块边界上，没有磁贴跨过它，所以墙按锚点分成左右两个世界层，各自平移让出
// 半个开口（加半个 GAP），不需要裁剪。stage 在相机移动、缝开合时调用它，只写 transform / 尺寸，不经过 React。
// 信息条横向时锚点是块行边界的世界 y（anchorY）：墙分上下两半（仍叫 left / right，left 是上半），各自上下让开，缝是
// 一道横跨视口的横条；边缘标签仍在左右侧边（横条贴着上下边收起时标签在左边）。海报总是竖的，倾斜只跟着竖的缝。
// 倾斜（tiltDeg）不分页面：首页、集合页与海报都是同一段旋转，转多少由 bravaisTilt 按缝里的内容定。

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
    /** 整层（两半墙与缝）此刻的倾斜角（度；各种页面转多少见 BRAVAIS_TILT_DEG）。 */
    tiltDeg?: number;
    /**
     * 两半墙沿纸自己的竖向多挪的一段（屏幕 px，转之前的坐标；缝不跟着挪）：倾斜着换锚点时支点瞬间换了位置，墙会顺着纸的
     * 竖向跳一截，这一段把它垫回去、再补间到 0（reanchorLift、useBravaisSeam）。平常是 0。
     */
    liftY?: number;
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

export const computeBravaisFrame = ({ center, view, anchorX, anchorY = null, openWidth, contentWidth, hidden, poster = false, tiltDeg = 0, liftY = 0 }: BravaisFrameInput): BravaisFrame => {
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
        left: { x: camera.x + offsets.left, y: camera.y + liftY },
        right: { x: camera.x + offsets.right, y: camera.y + liftY },
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

/** 屏幕上的一点绕支点转 deg 度（与 CSS 的 rotate 同向：y 轴朝下，正 = 顺时针）；倾斜的各处换算共用这一个。 */
export const rotateAround = (x: number, y: number, pivot: { pivotX: number; pivotY: number }, deg: number) => {
    const radians = (deg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = x - pivot.pivotX;
    const dy = y - pivot.pivotY;
    return { x: pivot.pivotX + dx * cos - dy * sin, y: pivot.pivotY + dx * sin + dy * cos };
};

/**
 * 倾斜着把缝的锚点换到 nextAnchorX（相机不动）时，两半墙要垫的那一段（屏幕 px，computeBravaisFrame 的 liftY）。支点跟着缝，
 * 锚点一换支点横着挪了 Δ，整面墙随之平移 (I − R)·(Δ, 0)：顺着纸的竖向是 −Δ·sin，垂直于它只有 Δ·(1 − cos)（4° 时是 Δ 的
 * 0.24%，不管）。垫上 Δ·sin 墙就留在原地，再由调用方补间到 0（墙顺着纸滑过去，不是跳过去）。没倾斜、没有竖的缝时是 0。
 */
export const reanchorLift = (input: BravaisFrameInput, nextAnchorX: number | null): number => {
    const before = tiltPivotX(input);
    const after = tiltPivotX({ ...input, anchorX: nextAnchorX });
    return before === null || after === null ? 0 : liftForPivotShift(after - before, input.tiltDeg ?? 0);
};

/** 倾斜的支点此刻在屏幕上的 x（缝的右缘）；没倾斜、没有竖的缝时是 null。 */
export const tiltPivotX = (input: BravaisFrameInput): number | null => {
    if (Math.abs(input.tiltDeg ?? 0) < 0.001 || input.anchorX === null || (input.anchorY ?? null) !== null) return null;
    return computeBravaisFrame(input).tilt.pivotX;
};

/** 支点横着挪了 shift（屏幕 px）时两半墙要垫的那一段（见 reanchorLift）。 */
export const liftForPivotShift = (shift: number, deg: number) => shift * Math.sin((deg * Math.PI) / 180);

/**
 * 倾斜的缝（不是海报）离视口左右边要多留的距离（屏幕 px）：缝绕右缘、视口半高转过去之后，上端往一边、下端往另一边各横移
 * 约 高度 / 2 × |sin|；排开口（useBravaisSeam 的 planOpening）与让位（bravaisTiltReveal）时把它加在 SEAM_EDGE_MARGIN 上，
 * 缝落定时面包屑与底下的按钮不横着出屏。拖动不受它限制（缝照旧贴着边才收窄）。
 */
export const tiltEdgeRoom = (viewHeight: number, deg: number) => (
    Math.abs(deg) < 0.001 ? 0 : (viewHeight / 2) * Math.abs(Math.sin((deg * Math.PI) / 180))
);

/**
 * 排一道 openWidth 宽的缝时离视口左右边留多少：平常的边距，倾斜着再加 tiltEdgeRoom。视口窄到放不下「开口 + 两边都多留」
 * 时不多留（多留只会把缝挤到一边、另一边反被边距挤窄），回到平常的边距。
 */
export const seamPlanEdge = ({ view, openWidth, tiltDeg, edge }: { view: { width: number; height: number }; openWidth: number; tiltDeg: number; edge: number }) => {
    const room = tiltEdgeRoom(view.height, tiltDeg);
    return view.width >= openWidth + 2 * (edge + room) ? edge + room : edge;
};

/**
 * 倾斜的缝（信息条、书脊、首页窄缝；海报另有 posterSafeArea）里，内容上下各要缩进多少（屏幕 px）：缝绕右缘、视口半高转过去
 * 之后，内容那一列的四个角仍落在视口的上下缘之内（左下的按钮不被切掉）。只管上下；左右靠排开口时多留的 tiltEdgeRoom。
 * 随角度连续变化（0° 时是 0），只跟内容的排版宽度、视口高度与角度有关，拖动时不变。
 */
export const seamTiltInsets = ({ width, height, deg }: { width: number; height: number; deg: number }) => {
    if (Math.abs(deg) < 0.001 || width <= 0 || height <= 0) return { top: 0, bottom: 0 };
    const radians = (deg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const half = height / 2;
    // 内容的角相对转轴（缝右缘、半高）：rx ∈ {−width, 0}，转过去后屏幕 y = half + rx·sin + ry·cos。
    // 上缘 ry = top − half 要 ≥ 0，取 rx·sin 最小的那个角；下缘 ry = half − bottom 要 ≤ height，取最大的那个。
    const lift = Math.min(0, -width * sin);
    const drop = Math.max(0, -width * sin);
    return {
        top: Math.max(0, half - (half + lift) / cos),
        bottom: Math.max(0, half - (half - drop) / cos),
    };
};

/**
 * 倾斜时视口在「没倾斜的屏幕坐标」里的外接框，相对 [0, 宽] × [0, 高] 各边挪了多少（px，往外为正、往里为负）：视口四个角
 * 按倾斜反转回去（u = R⁻¹(s − pivot) + pivot）。支点跟着缝在屏幕上走——缝被拖到视口外很远时，反转回去的视口整块平移开
 * （偏移随支点离视口的距离增长），一边往外、对边往里；裁剪要跟着挪，不然渲染的那片墙全在屏幕外。
 */
export const getTiltReach = (view: { width: number; height: number }, tilt: BravaisFrame['tilt']) => {
    if (Math.abs(tilt.deg) < 0.001) return { left: 0, right: 0, top: 0, bottom: 0 };
    const corners = [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height]].map(([x, y]) => (
        rotateAround(x, y, tilt, -tilt.deg)
    ));
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

/**
 * 缝的两层 transform：外面的轨道（.bravais-seam-track）只平移、自己成合成层，缝本身只在倾斜落定后带一段 2D 旋转。
 * 合成层被合成器整块转过去时，里面的字是先按没转的样子光栅化、再当图片旋转重采样的，会发糊；旋转写在不成层的缝上，
 * 字就带着旋转直接画进轨道那一层（清楚）。代价是旋转角变化时要重画缝，所以倾斜补间期间（tiltSettled 为 false）
 * 仍整块交给合成器转，落定后才换过来。落定时轨道的平移取整到设备像素：没转的合成层停在半像素上同样会糊。
 * 两种写法在屏幕上是同一个几何：绕 p 转再平移 x0 = 先平移 x0、再在缝自己的坐标里绕 p − x0 转。转轴在缝自己的坐标里
 * 是缝的右缘（宽度）、视口半高，拖动时不变，缝的 transform 也就不变、不重画；取整丢掉的那不到半个设备像素不补回来
 * （补回来转轴就跟着拖动逐帧变了），缝相对两半墙最多差这么一点。
 */
export const seamTransforms = (frame: BravaisFrame, { tiltSettled, devicePixelRatio }: { tiltSettled: boolean; devicePixelRatio: number }) => {
    const { seam, tilt } = frame;
    if (seam.axis === 'y') return { track: `translate3d(0, ${seam.y - seam.width / 2}px, 0)`, seam: '' };
    const left = seam.x - seam.width / 2;
    if (Math.abs(tilt.deg) < 0.001) return { track: `translate3d(${left}px, 0, 0)`, seam: '' };
    if (!tiltSettled) return { track: withTilt(`translate3d(${left}px, 0, 0)`, tilt), seam: '' };
    const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
    const round = (value: number) => Math.round(value * 100) / 100;
    const pivotX = round(tilt.pivotX - left);
    const pivotY = round(tilt.pivotY);
    return {
        track: `translate3d(${Math.round(left * ratio) / ratio}px, 0, 0)`,
        seam: `translate(${pivotX}px, ${pivotY}px) rotate(${tilt.deg}deg) translate(${-pivotX}px, ${-pivotY}px)`,
    };
};
