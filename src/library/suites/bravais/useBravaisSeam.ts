import { animate } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { blockSeamPlan, blockSeamPlanY, getSeamGeometry, getSeamGeometryY, type SeamAxis } from '../../../components/wall/seamPlan';
import type { WallViewCenter } from '../../../components/wall/wallView';
import { BRAVAIS_METRICS, BRAVAIS_SEAM_TWEEN_S } from './bravaisConstants';
import { planPosterOpening, seamEdgeFor } from './bravaisFrame';
import type { BravaisLayer } from './bravaisLayer';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { resolveSeamContentIdentity, resolveVariantWidth, type BravaisSeamContentVariant } from './bravaisSeamTarget';
import { anchorAxis, anchorOf, columnAnchor, NO_ANCHOR, rowAnchor, type BravaisAnchor } from './bravaisAnchor';
import { clearSeamFlipPhase, playSeamFlipIn, playSeamFlipOut } from './bravaisSeamMotion';
import type { BravaisFrameState } from './useBravaisFrame';
import type { BravaisWallShape } from './bravaisWallShape';

// src/library/suites/bravais/useBravaisSeam.ts
// 缝（设计稿 §5）：锚点（块边界的世界 x，React state——墙按它分左右两半）、开口宽度的补间（只写帧状态）、
// 缝里渲染的那套内容。换层、换等级时内容原地翻转：转到 90° 才换成新内容与新的排版宽度（翻转不重排），所以
// 「此刻渲染的内容」是单独的 state，只在换的那一刻 setState 一次。开口变宽或恢复时，锚点还在屏内就沿用它的
// 块边界、相机只做最小让位；不在屏内就在当前视口里另取最近的块边界（B5 的 blockSeamPlan）。
// 缝内过渡（设计稿 §7「缝内的过渡」）：内容翻转用 bravaisSeamMotion 的半圈（与墙上磁贴同一种绕 Y 轴的翻牌），降低动效
// （B11 的同一套判断）时换成 0.18s 淡出 → 换 → 淡入；从折叠回来时开口补间、内容随之淡入（降低动效时开口不补间，内容
// 淡入）。过渡中内容层挂 data-bravais-seam-flip。首页换页签也整条翻（2026-10-09 起，与原型一致）。
// 信息条横向：锚点可以是块行边界的世界 y（横的缝，内容绕 X 轴翻）。缝换方向（横的信息条 ↔ 竖的面板 / 海报，或改了设置）
// 不翻：开口先在原来的方向上合上（内容随之淡出、不可点），合上的那一刻换锚点与内容，再在新方向上张开（axis switch）。
// 换方向途中来的目标宽度不另起补间，张开时取最新的；沿用的锚点若是按别的宽度排的（面板换成海报），张开前按新宽度重排。
// 换层要先换墙的形状时（useBravaisDisplay 的 beginShapeChange，出场放完才给锚点），换层编排先 awaitAnchor：合上后只换内容、
// 开口留在 0，等锚点来了再张开（不先在临时的边界上张开、再跳到真的那条）。换方向途中折叠了：合上时照样换上给的锚点。

export type BravaisRenderedSeam = {
    variant: BravaisSeamContentVariant;
    layer: BravaisLayer | null;
    /** 这套内容开在哪个方向（折叠时为 null）。 */
    axis: SeamAxis | null;
};

/** 要张开的开口：锚点与让位后的相机。 */
export type BravaisOpeningPlan = { anchor: BravaisAnchor; center: WallViewCenter };

/** 焦点此刻没落在任何控件上（被 inert 挤掉后浏览器交给了 body）。 */
const isFocusDropped = () => document.activeElement === null || document.activeElement === document.body;


export const useBravaisSeam = ({
    frameRef,
    renderFrame,
    layer,
    target,
    viewportWidth,
    contentRef,
    reducedMotion,
    reducedTransitions,
    tweenCamera,
    checkCull,
    getShape,
    onAxisSettled,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    layer: BravaisLayer | null;
    /** 此刻的开口、内容与方向（等级之上还有表单、列表面板、过滤框的临时展开，见 bravaisSeamTarget）。 */
    target: { width: number; variant: BravaisSeamContentVariant; axis: SeamAxis | null };
    viewportWidth: number;
    contentRef: RefObject<HTMLDivElement | null>;
    /** 开口补间降级（只看 lattice，与相机一致）。 */
    reducedMotion: boolean;
    /** 内容翻转降级成淡入淡出（B11 的同一套判断，bravaisMotion）。 */
    reducedTransitions: boolean;
    tweenCamera: (center: WallViewCenter) => void;
    /** 开口变了（可见的世界范围随之变了）：让相机检查要不要重新裁剪；force = 开口落定，按含开口的范围裁剪一次。 */
    checkCull: (force?: boolean) => void;
    /** 墙此刻的形状（缝开在它的块边界上）。 */
    getShape: () => BravaisWallShape;
    /** 缝换完方向、在新方向上开始张开（换层编排据此重算有限态的相机范围）。 */
    onAxisSettled?: () => void;
}) => {
    const level = useBravaisSeamStore(state => state.level);
    const [anchor, setAnchorState] = useState<BravaisAnchor>(NO_ANCHOR);
    const targetWidth = layer ? target.width : 0;
    const targetVariant: BravaisSeamContentVariant = layer ? target.variant : 'none';
    const targetAxis = layer ? target.axis : null;
    const [rendered, setRendered] = useState<BravaisRenderedSeam>({ variant: targetVariant, layer, axis: targetAxis });
    const widthAnimationRef = useRef<{ stop: () => void } | null>(null);
    const targetWidthRef = useRef(targetWidth);
    targetWidthRef.current = targetWidth;
    const tweenCameraRef = useRef(tweenCamera);
    tweenCameraRef.current = tweenCamera;
    const latestTargetRef = useRef({ layer, targetVariant, targetAxis });
    latestTargetRef.current = { layer, targetVariant, targetAxis };
    /** 换完内容后要不要转进来（翻转的后半段）、焦点还给谁。 */
    const pendingInRef = useRef<{ fromNone: boolean; reduced: boolean; focused: HTMLElement | null; toggleByKeyboard: boolean } | null>(null);
    /**
     * 换方向途中。closing：开口在原来的方向上合上，合上时换成 anchor（null = 合上时按新方向另算一个；planWidth / poster 是
     * 排 anchor 时的开口，与张开时的不同就重排）。waiting：已经合上、换好内容，等换层编排给锚点（awaitAnchor）。
     */
    const switchRef = useRef<{ anchor: BravaisAnchor | null; planWidth: number; poster: boolean; phase: 'closing' | 'waiting' } | null>(null);
    /** 换层编排要求：这次换方向合上之后等它给锚点再张开。 */
    const awaitRef = useRef(false);
    const onAxisSettledRef = useRef(onAxisSettled);
    onAxisSettledRef.current = onAxisSettled;

    /** 立即换上锚点（帧状态 + React state，墙按它分两半）。 */
    const applyAnchor = useCallback((next: BravaisAnchor) => {
        frameRef.current.anchorX = next.x;
        frameRef.current.anchorY = next.y;
        setAnchorState(current => (current.x === next.x && current.y === next.y ? current : next));
        renderFrame();
    }, [frameRef, renderFrame]);

    /** 缝锚点（缺省是帧状态里的）此刻在不在屏内（在就沿用它的块边界）。 */
    const isAnchorOnScreen = useCallback((anchor?: BravaisAnchor) => {
        const { view, center } = frameRef.current;
        const { x, y } = anchor ?? anchorOf(frameRef.current);
        if (!view) return false;
        if (y !== null) {
            const geometry = getSeamGeometryY({ anchorY: y, cameraY: center.y, openWidth: 1, view });
            return geometry.screenY > 0 && geometry.screenY < view.height;
        }
        if (x === null) return false;
        const geometry = getSeamGeometry({ anchorX: x, cameraX: center.x, openWidth: 1, view });
        return geometry.screenX > 0 && geometry.screenX < view.width;
    }, [frameRef]);

    /**
     * 要张开 `width` 的缝：选块边界、算相机的最小让位（相对 `center`，返回锚点与让位后的视图中心）。`prefer` 是想沿用的
     * 锚点（与 `axis` 同一个方向才算数）。poster（歌手海报）：照样从块边界裂开，相机把它带到视口最左边
     * （bravaisFrame 的 planPosterOpening）。axis 'y'：横的缝，开在块行边界上，相机上下让位。
     */
    const planOpening = useCallback((
        center: WallViewCenter,
        width: number,
        prefer: BravaisAnchor | null,
        poster = false,
        shape = getShape(),
        axis: SeamAxis = 'x',
    ): BravaisOpeningPlan => {
        const { view } = frameRef.current;
        if (!view) return { anchor: prefer ?? anchorOf(frameRef.current), center };
        if (axis === 'y' && !poster) {
            const plan = blockSeamPlanY({
                cameraY: center.y,
                openWidth: width,
                view,
                metrics: BRAVAIS_METRICS,
                blockHeight: shape.blockSize.height,
                preferY: prefer?.y ?? undefined,
            });
            return { anchor: rowAnchor(plan.y), center: { x: center.x, y: plan.cameraY } };
        }
        const preferX = prefer?.x ?? undefined;
        if (poster) {
            const plan = planPosterOpening({ center, view, width, preferX });
            return { anchor: columnAnchor(plan.anchorX), center: plan.center };
        }
        const plan = blockSeamPlan({
            cameraX: center.x,
            openWidth: width,
            view,
            metrics: BRAVAIS_METRICS,
            // 缝开在墙此刻形状的块边界上（探索形状的块含街）。
            blockWidth: shape.blockSize.width,
            preferX,
        });
        return { anchor: columnAnchor(plan.x), center: { x: plan.cameraX, y: center.y } };
    }, [frameRef, getShape]);

    /** 开口补间到 `to`（每帧只写帧状态与 DOM；途中快到裁剪边缘时补裁剪，落定时按含开口的可见范围裁剪一次）。 */
    const animateWidth = useCallback((to: number, from: number, onDone?: () => void) => {
        widthAnimationRef.current?.stop();
        frameRef.current.targetOpenWidth = to;
        if (reducedMotion || Math.abs(to - from) < 0.5) {
            widthAnimationRef.current = null;
            const changed = Math.abs(to - frameRef.current.openWidth) >= 0.5;
            frameRef.current.openWidth = to;
            renderFrame();
            checkCull(changed);
            onDone?.();
            return;
        }
        frameRef.current.openWidth = from;
        widthAnimationRef.current = animate(from, to, {
            duration: BRAVAIS_SEAM_TWEEN_S,
            ease: [0.65, 0, 0.35, 1],
            onUpdate: value => {
                frameRef.current.openWidth = value;
                renderFrame();
                checkCull();
            },
            onComplete: () => {
                widthAnimationRef.current = null;
                checkCull(true);
                onDone?.();
            },
        });
    }, [checkCull, frameRef, reducedMotion, renderFrame]);

    /** 开口补间到目标宽度。换方向途中不另起补间：合上之后按最新的目标张开。 */
    const tweenWidth = useCallback((to: number, from = frameRef.current.openWidth) => {
        if (switchRef.current) return;
        animateWidth(to, from);
    }, [animateWidth, frameRef]);

    /** 记下换方向途中给的锚点（连同排它时的开口）。 */
    const keepPendingAnchor = useCallback((next: BravaisAnchor) => {
        const switching = switchRef.current;
        if (!switching) return;
        switching.anchor = next;
        switching.planWidth = targetWidthRef.current;
        switching.poster = latestTargetRef.current.targetVariant === 'poster';
    }, []);

    /** 合上之后换上内容与锚点，按最新的目标宽度张开。 */
    const openOnNewAxis = useCallback((next: BravaisAnchor | null) => {
        const latest = latestTargetRef.current;
        awaitRef.current = false;
        if (next) applyAnchor(next);
        pendingInRef.current = null;
        setRendered({ variant: latest.targetVariant, layer: latest.layer, axis: latest.targetAxis });
        animateWidth(targetWidthRef.current, 0);
        onAxisSettledRef.current?.();
    }, [animateWidth, applyAnchor]);

    /**
     * 换方向的第二段：开口已经合上——换锚点（没给就按新方向另算一个、相机让位；给了但是按别的开口排的就按新开口重排）、
     * 换内容，再按最新的目标宽度张开。换层编排要求等它给锚点时，只换内容，开口留在 0。途中折叠了：换上给的锚点，不张开。
     */
    const finishAxisSwitch = useCallback(() => {
        const pending = switchRef.current;
        switchRef.current = null;
        if (!pending) return;
        const latest = latestTargetRef.current;
        const width = targetWidthRef.current;
        if (latest.targetAxis === null) {
            openOnNewAxis(pending.anchor);
            return;
        }
        const poster = latest.targetVariant === 'poster';
        let next = pending.anchor && anchorAxis(pending.anchor) === latest.targetAxis ? pending.anchor : null;
        if (next && width > 0 && (pending.planWidth !== width || pending.poster !== poster)) {
            const plan = planOpening(frameRef.current.center, width, next, poster, getShape(), latest.targetAxis);
            next = plan.anchor;
            tweenCameraRef.current(plan.center);
        }
        if (!next && latest.targetAxis !== anchorAxis(anchorOf(frameRef.current))) {
            if (awaitRef.current) {
                pendingInRef.current = null;
                setRendered({ variant: latest.targetVariant, layer: latest.layer, axis: latest.targetAxis });
                switchRef.current = { anchor: null, planWidth: width, poster, phase: 'waiting' };
                return;
            }
            if (width > 0) {
                const plan = planOpening(frameRef.current.center, width, null, poster, getShape(), latest.targetAxis);
                next = plan.anchor;
                tweenCameraRef.current(plan.center);
            }
        }
        openOnNewAxis(next);
    }, [frameRef, getShape, openOnNewAxis, planOpening]);

    /** 换方向的第一段：开口在原来的方向上合上；已经在合了就只换掉合上后要用的锚点。 */
    const beginAxisSwitch = useCallback((next: BravaisAnchor | null) => {
        const switching = switchRef.current;
        if (switching && switching.phase === 'closing') {
            if (next) keepPendingAnchor(next);
            return;
        }
        // 正等着锚点时目标又换了方向：重新走一遍（开口已经是 0，立即合上）。
        switchRef.current = {
            anchor: next,
            planWidth: targetWidthRef.current,
            poster: latestTargetRef.current.targetVariant === 'poster',
            phase: 'closing',
        };
        animateWidth(0, frameRef.current.openWidth, finishAxisSwitch);
    }, [animateWidth, finishAxisSwitch, frameRef, keepPendingAnchor]);

    /** 换层编排：这次换方向合上之后，等我给锚点再张开（换层要先换墙的形状，锚点要等出场放完）。 */
    const awaitAnchor = useCallback(() => {
        awaitRef.current = true;
    }, []);

    /**
     * 换锚点。与张开着的缝不同方向时不立即换：先合上再换（beginAxisSwitch）。换方向途中给回原来方向的锚点（目标又换回来了）
     * 就取消这次换方向，直接从此刻的开口补间回去；正等着锚点时给了新方向的锚点，换上并张开；途中折叠了，记下留到合上时换。
     */
    const setAnchor = useCallback((next: BravaisAnchor) => {
        const nextAxis = anchorAxis(next);
        const currentAxis = anchorAxis(anchorOf(frameRef.current));
        const wanted = latestTargetRef.current.targetAxis;
        const switching = switchRef.current;
        if (switching?.phase === 'waiting') {
            if (wanted === null || (nextAxis !== null && nextAxis === wanted)) {
                switchRef.current = null;
                if (wanted === null) {
                    awaitRef.current = false;
                    applyAnchor(next);
                } else {
                    openOnNewAxis(next);
                }
            }
            return;
        }
        if (switching) {
            if (wanted === null || (nextAxis !== null && nextAxis === wanted && nextAxis !== currentAxis)) {
                keepPendingAnchor(next);
                return;
            }
            if (wanted === currentAxis) {
                switchRef.current = null;
                awaitRef.current = false;
                applyAnchor(next);
                animateWidth(targetWidthRef.current, frameRef.current.openWidth);
            }
            return;
        }
        if (nextAxis !== null && currentAxis !== null && nextAxis !== currentAxis && frameRef.current.openWidth >= 0.5) {
            beginAxisSwitch(next);
            return;
        }
        awaitRef.current = false;
        applyAnchor(next);
    }, [animateWidth, applyAnchor, beginAxisSwitch, frameRef, keepPendingAnchor, openOnNewAxis]);

    // 目标宽度变了（换层、换等级）就补间过去；折叠等级也写进帧状态（悬浮按钮常驻）。
    const hasLayer = Boolean(layer);
    // 「折叠」看的是生效的内容（过滤框、面板、表单开着时折叠等级暂不生效）。
    const isFolded = hasLayer && targetVariant === 'none';
    // 歌手海报（贴边不收窄）：在开口补间与换层编排（useBravaisDisplay 的 layout effect，排在这之后）之前写进帧状态。
    const isPoster = hasLayer && targetVariant === 'poster';
    useLayoutEffect(() => {
        frameRef.current.poster = isPoster;
        renderFrame();
    }, [frameRef, isPoster, renderFrame]);
    useEffect(() => {
        frameRef.current.hidden = isFolded;
        tweenWidth(targetWidth);
    }, [frameRef, isFolded, targetWidth, tweenWidth]);

    // 同一层换了开口（换等级、开合列表面板、表单态、过滤框的临时展开）且要张开：锚点在屏内就沿用、相机最小让位；
    // 不在屏内就另取一条块边界。换层时的开口由换层编排（useBravaisDisplay）一起算，这里不重复让位。
    const layerKey = layer?.key ?? null;
    const previousOpeningRef = useRef({ layerKey, width: targetWidth });
    useEffect(() => {
        const previous = previousOpeningRef.current;
        previousOpeningRef.current = { layerKey, width: targetWidth };
        if (previous.layerKey !== layerKey || previous.width === targetWidth) return;
        if (!layer || targetWidth <= 0) return;
        const axis = targetAxis ?? 'x';
        const plan = planOpening(frameRef.current.center, targetWidth, isAnchorOnScreen() ? anchorOf(frameRef.current) : null, isPoster, getShape(), axis);
        const current = anchorOf(frameRef.current);
        if (plan.anchor.x !== current.x || plan.anchor.y !== current.y) setAnchor(plan.anchor);
        tweenCamera(plan.center);
    }, [frameRef, getShape, isAnchorOnScreen, isPoster, layer, layerKey, planOpening, setAnchor, targetAxis, targetWidth, tweenCamera]);

    // 缝里的内容：换层（首页换页签也是换层，2026-10-09 起整条翻）或换形态时翻转（转到 90° 换内容与排版宽度），同一层的
    // 数据更新就地刷新（渲染时取最新的层）。
    const renderedLayer = rendered.layer && layer && resolveSeamContentIdentity(rendered.layer) === resolveSeamContentIdentity(layer) ? layer : rendered.layer;
    const renderedKey = `${rendered.variant}|${rendered.layer ? resolveSeamContentIdentity(rendered.layer) : ''}`;
    const targetKey = `${targetVariant}|${layer ? resolveSeamContentIdentity(layer) : ''}`;
    const inAnimationRef = useRef<Animation | null>(null);
    /** 放完的转出段停在 90°，等新内容渲染出来、转进段开始时才取消（中间不露出转正的旧内容）。 */
    const outAnimationRef = useRef<Animation | null>(null);
    // 翻转途中目标又换了（A → B → C）不重来：转到 90° 时换成最新的目标（latestTargetRef）。只有「要不要翻、怎么翻」变了
    // 才重跑（目标回到了正画着的内容、或换成了折叠）。
    const fromNone = renderedKey.startsWith('none|');
    const toNone = targetKey.startsWith('none|');
    // 换方向（两边都有方向且不同）不翻：交给 axis switch，合上时换内容。
    const axisChange = rendered.axis !== null && targetAxis !== null && rendered.axis !== targetAxis;
    const flipMode = axisChange
        ? `axis|${targetAxis}`
        : renderedKey === targetKey ? 'none' : fromNone || toNone ? `swap|${targetKey}` : 'flip';
    useLayoutEffect(() => {
        if (flipMode === 'none') return undefined;
        const element = contentRef.current;
        // 转出的半圈里旧内容 inert（BravaisSeam），焦点会被浏览器移走：记下此刻聚焦的元素，换完内容它还在（同一种内容
        // 换了形态，React 复用了这个节点，例如书脊的「⋯」展开成窄缝）就把焦点还给它。
        const active = document.activeElement;
        const focused = element && active instanceof HTMLElement && element.contains(active) ? active : null;
        // 焦点在标题（切换开口的那个）上且是键盘焦点（:focus-visible）：换完内容把焦点交给新内容里的标题。
        const toggleByKeyboard = Boolean(focused?.hasAttribute('data-bravais-seam-toggle') && focused.matches(':focus-visible'));
        const swap = (animateIn: boolean) => {
            const next = latestTargetRef.current;
            pendingInRef.current = animateIn ? { fromNone, reduced: reducedTransitions, focused, toggleByKeyboard } : null;
            setRendered({ variant: next.targetVariant, layer: next.layer, axis: next.targetAxis });
        };
        if (flipMode.startsWith('axis|')) {
            beginAxisSwitch(null);
            return undefined;
        }
        // 折叠与展开之间不翻：开口从 0 补间、内容随开口淡入（frame 的 contentOpacity）。降低动效时开口不补间，
        // 内容在折叠回来时淡入。
        if (!element || flipMode !== 'flip') {
            swap(Boolean(element) && fromNone && reducedTransitions);
            return undefined;
        }
        inAnimationRef.current?.cancel();
        inAnimationRef.current = null;
        let swapped = false;
        const out = playSeamFlipOut(element, rendered.axis === 'y' ? 'x' : 'y', reducedTransitions);
        outAnimationRef.current = out;
        out.onfinish = () => {
            swapped = true;
            swap(true);
        };
        return () => {
            if (!swapped) {
                out.cancel();
                clearSeamFlipPhase(element);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fromNone 与 rendered.axis 由 renderedKey / flipMode 决定
    }, [beginAxisSwitch, contentRef, flipMode, reducedTransitions, renderedKey]);

    // 换完内容：新内容转进来（降低动效时淡入）。转进这一段不随上面的 effect 清理取消：换内容本身就会让它重跑。
    useLayoutEffect(() => {
        const pending = pendingInRef.current;
        if (pending === null) return;
        pendingInRef.current = null;
        outAnimationRef.current?.cancel();
        outAnimationRef.current = null;
        const element = contentRef.current;
        if (!element) return;
        const { focused } = pending;
        if (focused && focused.isConnected && element.contains(focused) && document.activeElement !== focused) {
            focused.focus({ preventScroll: true });
        } else if (focused && !focused.isConnected && pending.toggleByKeyboard && isFocusDropped()) {
            // fb10：用键盘在标题上切换了开口（完整信息条 ↔ 书脊），旧标题随内容卸载了：焦点交给新内容里的那个标题，
            // 再按一次 Enter 就切回去（鼠标点的不挪焦点）。
            element.querySelector<HTMLElement>('[data-bravais-seam-toggle]')?.focus({ preventScroll: true });
        }
        inAnimationRef.current = playSeamFlipIn(element, rendered.axis === 'y' ? 'x' : 'y', pending.reduced || pending.fromNone, () => { inAnimationRef.current = null; });
    }, [contentRef, rendered]);
    useEffect(() => () => {
        inAnimationRef.current?.cancel();
        outAnimationRef.current?.cancel();
    }, []);

    // 换方向途中目标又回到了缝此刻的方向：取消这次换方向，从此刻的开口补间到目标。折叠了：合上的照样合上（合上时换上给的
    // 锚点）；正等着锚点的不用再等。
    useLayoutEffect(() => {
        const switching = switchRef.current;
        if (axisChange || !switching) return;
        if (targetAxis === null) {
            if (switching.phase === 'waiting') {
                switchRef.current = null;
                awaitRef.current = false;
            }
            return;
        }
        if (targetAxis !== anchorAxis(anchorOf(frameRef.current))) return;
        switchRef.current = null;
        awaitRef.current = false;
        animateWidth(targetWidthRef.current, frameRef.current.openWidth);
    }, [animateWidth, axisChange, frameRef, targetAxis]);

    // 排版宽度跟着「此刻渲染的那套内容」走，不跟目标宽度走（横的缝是排版高度）。
    useLayoutEffect(() => {
        frameRef.current.contentWidth = resolveVariantWidth(rendered.variant, viewportWidth, rendered.axis);
        renderFrame();
    }, [frameRef, renderFrame, rendered.axis, rendered.variant, viewportWidth]);

    useEffect(() => () => {
        widthAnimationRef.current?.stop();
        switchRef.current = null;
    }, []);

    /** 自动出屏收起后，在当前视口里裂开一道新缝（不拉回原锚点，设计稿 §5）。 */
    const reopenHere = useCallback(() => {
        if (!layer || targetWidth <= 0) return;
        const plan = planOpening(frameRef.current.center, targetWidth, null, isPoster, getShape(), targetAxis ?? 'x');
        setAnchor(plan.anchor);
        tweenWidth(targetWidth, 0);
        tweenCamera(plan.center);
    }, [frameRef, getShape, isPoster, layer, planOpening, setAnchor, targetAxis, targetWidth, tweenCamera, tweenWidth]);

    /** 此刻缝本该张开却被挤到屏外收起了（边缘标签在场）。 */
    const isCollapsed = useCallback(() => {
        const { anchorX: x, anchorY: y, view, center, openWidth, poster } = frameRef.current;
        if (!view || targetWidth <= 0) return false;
        const width = Math.max(openWidth, targetWidth);
        if (y !== null) return getSeamGeometryY({ anchorY: y, cameraY: center.y, openWidth: width, view }).collapsed;
        if (x === null) return false;
        return getSeamGeometry({ anchorX: x, cameraX: center.x, openWidth: width, view, edge: seamEdgeFor(poster) }).collapsed;
    }, [frameRef, targetWidth]);

    const contentWidth = resolveVariantWidth(rendered.variant, viewportWidth, rendered.axis);
    return {
        level,
        anchor,
        setAnchor,
        targetWidth,
        rendered: { variant: rendered.variant, layer: renderedLayer, width: contentWidth, axis: rendered.axis },
        /**
         * 正画着的内容正要翻走（转出的半圈、降低动效时的淡出）或随换方向合上：缝把它藏起来，不可点、不进无障碍树。
         */
        leaving: flipMode === 'flip' || flipMode.startsWith('axis|'),
        planOpening,
        isAnchorOnScreen,
        awaitAnchor,
        reopenHere,
        isCollapsed,
    };
};
