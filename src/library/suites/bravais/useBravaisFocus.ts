import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { resolveRevealCenter, type RevealRect } from '../../../components/wall/revealRect';
import type { WallViewCenter } from '../../../components/wall/wallView';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS, BRAVAIS_REVEAL_PAD_PX } from './bravaisConstants';
import { resolveFocusReflow } from './bravaisDisplay';
import type { BravaisWallShape } from './bravaisWallShape';
import { resolvePosterRevealCenter } from './bravaisPosterReveal';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisFocus.ts
// 两个独立的状态（与 Lattice 的 is-focused / is-expanded 对应）：键盘焦点（发丝线 + 主色环）与聚焦卡（6×6 块内让位，
// 全局只有一张）。都按 slot 记、只在离散变化时 setState。聚焦卡所在块的 12 个 slot 换成让位后的矩形（块外不动），
// 展开后与键盘焦点移动后相机做最小平移让矩形完整可见（底边避开播放条安全区），尽量让缝留在屏内（wall/revealRect）；
// 海报在场时按倾斜后的样子让位，能让海报整张张开时优先（bravaisPosterReveal）。
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
        if (!frame.view) return;
        // 开口正在张开时按张开后的宽度让位（交接回来时缝张开与聚焦卡展开同时进行）。
        const seamWidth = Math.max(frame.openWidth, frame.targetOpenWidth);
        if (frame.poster) {
            // 海报在场：按倾斜后画出来的样子让位，能让海报整张张开时优先（bravaisPosterReveal）。
            tweenTo(resolvePosterRevealCenter({
                rect,
                frame: {
                    center: frame.center,
                    view: frame.view,
                    anchorX: frame.anchorX,
                    openWidth: frame.openWidth,
                    contentWidth: frame.contentWidth,
                    hidden: frame.hidden,
                    poster: true,
                    tiltDeg: frame.tiltDeg,
                },
                posterWidth: seamWidth,
                pad: BRAVAIS_REVEAL_PAD_PX,
                bottomInset: getBottomInset(),
            }));
            return;
        }
        tweenTo(resolveRevealCenter({
            rect,
            center: frame.center,
            view: frame.view,
            metrics: BRAVAIS_METRICS,
            anchorX: frame.anchorX,
            anchorY: frame.anchorY,
            seamWidth,
            pad: BRAVAIS_REVEAL_PAD_PX,
            bottomInset: getBottomInset(),
            centered,
        }));
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
