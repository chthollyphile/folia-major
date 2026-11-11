import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { resolveRevealCenter, type RevealRect } from '../../../components/wall/revealRect';
import type { WallViewCenter } from '../../../components/wall/wallView';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS, BRAVAIS_REVEAL_PAD_PX } from './bravaisConstants';
import { resolveFocusReflow } from './bravaisDisplay';
import type { BravaisWallShape } from './bravaisWallShape';
import { resolveTiltedRevealCenter } from './bravaisTiltReveal';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisFocus.ts
// 两个独立的状态（与 Lattice 的 is-focused / is-expanded 对应）：键盘焦点（发丝线 + 主色环）与聚焦卡（6×6 块内让位，
// 全局只有一张）。都按 slot 记、只在离散变化时 setState。聚焦卡所在块的 12 个 slot 换成让位后的矩形（块外不动），
// 展开后与键盘焦点移动后相机做最小平移让矩形完整可见（底边避开播放条安全区），尽量让缝留在屏内（wall/revealRect）；
// 整层倾斜着时（海报，以及给了倾斜角的首页、集合页）按倾斜后的样子让位，能让海报整张张开时优先（bravaisTiltReveal）。
// 让位的过渡（展开、换卡、收起 / 换块时的归位）由 useBravaisReflowDriver 逐帧驱动，这里只给落定的让位表。

export const useBravaisFocus = ({
    frameRef,
    tweenTo,
    getBottomInset,
    onFocusEntry,
    getShape,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    tweenTo: (center: WallViewCenter) => void;
    /** 此刻播放条安全区的高度（屏幕 px）；没有播放条时是普通边距。 */
    getBottomInset: () => number;
    /** 键盘焦点换到了某个 slot：stage 把它换成条目 key 交给层描述。 */
    onFocusEntry: (slotKey: string | null) => void;
    /** 墙此刻的形状（聚焦卡的让位按它算）。 */
    getShape: () => BravaisWallShape;
}) => {
    const [focusedSlotKey, setFocusedSlotKey] = useState<string | null>(null);
    const [expandedSlotKey, setExpandedSlotKey] = useState<string | null>(null);
    const focusedRef = useRef(focusedSlotKey);
    focusedRef.current = focusedSlotKey;
    const expandedRef = useRef(expandedSlotKey);
    expandedRef.current = expandedSlotKey;

    // 形状只在换层 / 换形状时变，那时聚焦卡已经收起：按展开那一刻的形状算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const reflow = useMemo(() => resolveFocusReflow(expandedSlotKey, getShape()), [expandedSlotKey]);
    const reflowRef = useRef(reflow);
    reflowRef.current = reflow;

    /** slot 此刻画在哪（聚焦块里取让位后的矩形）。 */
    const drawnRect = useCallback((slot: WallSlot): WallSlot => reflowRef.current.get(slot.key) ?? slot, []);

    // centered：把矩形移到屏幕中间（定位，与网格集合页把卡片居中同一个意思）；海报在场时照旧最小平移。
    const reveal = useCallback((rect: RevealRect, { centered = false }: { centered?: boolean } = {}) => {
        const frame = frameRef.current;
        const view = frame.view;
        if (!view) return;
        // 开口正在张开时按张开后的宽度让位（交接回来时缝张开与聚焦卡展开同时进行）。
        const seamWidth = Math.max(frame.openWidth, frame.targetOpenWidth);
        // 没倾斜时的让位（海报之外的缝）：最小平移，定位时把矩形放到屏幕中间。
        const plain = () => resolveRevealCenter({
            rect,
            center: frame.center,
            view,
            metrics: BRAVAIS_METRICS,
            anchorX: frame.anchorX,
            anchorY: frame.anchorY,
            seamWidth,
            pad: BRAVAIS_REVEAL_PAD_PX,
            bottomInset: getBottomInset(),
            centered,
        });
        // 整层倾斜着（或正在转过去）：按转到位之后画出来的样子让位（bravaisTiltReveal）。只有竖的缝会倾斜。
        const tilted = frame.anchorX !== null && Math.abs(frame.tiltTargetDeg) >= 0.001;
        if (frame.poster || tilted) {
            // 海报在场：照旧从此刻的位置最小平移，能让海报整张张开时优先。其余倾斜的缝：先按没倾斜的算（定位时的居中在这里），
            // 再按倾斜后的样子修正。
            tweenTo(resolveTiltedRevealCenter({
                rect,
                frame: {
                    center: frame.poster || !centered ? frame.center : plain(),
                    view,
                    anchorX: frame.anchorX,
                    // 与倾斜一样按落定后的样子量：开口正在张开时用张开后的宽度（两半墙让出的是整个开口）。
                    openWidth: seamWidth,
                    contentWidth: frame.contentWidth,
                    hidden: frame.hidden,
                    poster: frame.poster,
                    tiltDeg: frame.tiltTargetDeg,
                },
                seamWidth,
                pad: BRAVAIS_REVEAL_PAD_PX,
                bottomInset: getBottomInset(),
            }));
            return;
        }
        tweenTo(plain());
    }, [frameRef, getBottomInset, tweenTo]);

    const focusSlot = useCallback((slot: WallSlot | null, options: { reveal?: boolean } = {}) => {
        const key = slot?.key ?? null;
        if (focusedRef.current !== key) {
            focusedRef.current = key;
            setFocusedSlotKey(key);
            onFocusEntry(key);
        }
        if (slot && options.reveal) reveal(drawnRect(slot));
    }, [drawnRect, onFocusEntry, reveal]);

    const expand = useCallback((slot: WallSlot, options: { centered?: boolean } = {}) => {
        expandedRef.current = slot.key;
        setExpandedSlotKey(slot.key);
        const rect = resolveFocusReflow(slot.key, getShape()).get(slot.key);
        if (rect) reveal(rect, options);
    }, [getShape, reveal]);

    const collapse = useCallback(() => {
        if (expandedRef.current === null) return;
        expandedRef.current = null;
        setExpandedSlotKey(null);
    }, []);

    return {
        focusedSlotKey,
        expandedSlotKey,
        focusedRef,
        expandedRef,
        reflow,
        drawnRect,
        reveal,
        focusSlot,
        expand,
        collapse,
    };
};
