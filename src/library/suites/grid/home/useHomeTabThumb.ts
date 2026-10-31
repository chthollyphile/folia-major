import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSpring } from 'framer-motion';

// src/library/suites/grid/home/useHomeTabThumb.ts
// iOS-style active-tab thumb for the Grid3D center tab switcher. The thumb is a single element
// living outside the buttons. Pressing anywhere on the switcher track makes the thumb glide under
// the pointer, follow it freely while held, then on release spring onto the nearest tab by rounded
// centre distance (that tab becomes active). Every reposition that is not a live drag is animated
// through the same persistent spring, including the ResizeObserver re-measure, so the thumb never
// jumps. Because that spring retargets in place, a new target landing mid-flight (fast clicks)
// steers the running generator with its own velocity instead of restarting — the motion stays
// interruptible, which is what keeps rapid clicks from making the thumb appear to fly in.
// Continuous motion stays in MotionValues; the only React state written while dragging is the
// discrete active-tab change made on release. Pointer capture is taken only once a real drag starts,
// so a plain tap still lets the button's click fire normally.

export interface HomeTabThumbItem<K extends string = string> {
    key: K;
    disabled: boolean;
}

interface UseHomeTabThumbOptions<K extends string> {
    /** Element whose direct children are the tab buttons; positions are measured against it. */
    trackRef: React.RefObject<HTMLElement | null>;
    items: HomeTabThumbItem<K>[];
    activeKey: K;
    onActivate: (key: K) => void;
    /** Invoked when the track is tapped without dragging. */
    onTapActive?: () => void;
}

// One spring drives every glide. Because it is a persistent spring (not a one-shot animation),
// re-targeting mid-flight steers the running generator with its analytical velocity, so rapid
// re-targets (fast clicks, resize, drag release) stay velocity-continuous instead of restarting.
const THUMB_SPRING = { stiffness: 320, damping: 32, mass: 0.9 } as const;
const DRAG_SCALE = 2;
const TAP_MOVE_THRESHOLD_PX = 4;
// 松手把摇杆吸附到最近页签后不立刻切页面：等摇杆真的停下再等这样一拍，来回拖动时松手就不会
// 连发页面切换、把界面顶得卡顿。吸附弹簧本身仍可被下一次按下随时打断（见 handlePointerDown）。
const ACTIVATE_SETTLE_DELAY_MS = 150;

const activeKeyToIndex = <K extends string>(items: HomeTabThumbItem<K>[], key: K) => {
    const index = items.findIndex(item => item.key === key);
    return index < 0 ? 0 : index;
};

export const useHomeTabThumb = <K extends string>({
    trackRef,
    items,
    activeKey,
    onActivate,
    onTapActive,
}: UseHomeTabThumbOptions<K>) => {
    // Persistent springs: continuous motion stays in MotionValues, and because these follow-values
    // retarget in place, every non-drag reposition is interruptible and keeps its velocity. `jump`
    // is used only for a true teleport (first placement, live drag) where no animation is wanted.
    const thumbLeft = useSpring(0, THUMB_SPRING);
    const thumbWidth = useSpring(0, THUMB_SPRING);
    const [dragging, setDragging] = useState(false);

    const layoutRef = useRef<{ left: number; width: number }[]>([]);
    const draggingRef = useRef(false);
    const positionedRef = useRef(false);
    // Viewport transform of the track, cached on press so dragging never reads layout per move.
    // The switcher is CSS-scaled (scale-90 / scale-100), so client px must be divided by the scale
    // to land in the buttons' own layout space where thumbLeft/offsetLeft live.
    const trackRectLeftRef = useRef(0);
    const trackScaleRef = useRef(1);
    // Live pointer gesture: stays null when idle. `moved` flips true past the tap threshold.
    const gestureRef = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null);
    // Mirror volatile inputs into refs so measuring/dragging never has to depend on array identity.
    const itemsRef = useRef(items);
    const activeKeyRef = useRef(activeKey);
    itemsRef.current = items;
    activeKeyRef.current = activeKey;

    // 松手后待处理的页面切换：摇杆停稳再等 ACTIVATE_SETTLE_DELAY_MS 才真正换页签。新的一次按下会取消它，
    // 所以吸附弹簧的打断不受影响。
    const pendingActivationRef = useRef<{
        timer: ReturnType<typeof setTimeout> | null;
        unsubscribe?: VoidFunction;
    } | null>(null);

    const cancelPendingActivation = useCallback(() => {
        const pending = pendingActivationRef.current;
        if (!pending) return;
        if (pending.timer !== null) clearTimeout(pending.timer);
        pending.unsubscribe?.();
        pendingActivationRef.current = null;
    }, []);

    // 卸载时别把待处理的切换留着。
    useEffect(() => cancelPendingActivation, [cancelPendingActivation]);

    const activeIndex = Math.max(0, items.findIndex(item => item.key === activeKey));
    // Stable signature: re-measure only when the tab set or enabled state changes, not on re-render.
    const itemsSignature = items.map(item => `${item.key}:${item.disabled ? 1 : 0}`).join('|');

    const measure = useCallback(() => {
        const track = trackRef.current;
        if (!track) return;
        const buttons = Array.from(track.querySelectorAll<HTMLElement>('[data-home-tab]'));
        layoutRef.current = buttons.map(button => ({ left: button.offsetLeft, width: button.offsetWidth }));
    }, [trackRef]);

    // Glide onto a tab's measured box; used by every non-drag reposition so motion stays smooth.
    const glideToIndex = useCallback((index: number) => {
        const entry = layoutRef.current[Math.min(index, layoutRef.current.length - 1)];
        if (!entry) return;
        if (!positionedRef.current) {
            // First placement has nothing to glide from: teleport so the thumb never slides in
            // from the wrong spot on mount.
            thumbLeft.jump(entry.left);
            thumbWidth.jump(entry.width);
            positionedRef.current = true;
            return;
        }
        // set() on a spring-backed value retargets the running spring in place (velocity-preserving),
        // which is what makes rapid clicks interruptible rather than restarting from scratch.
        thumbLeft.set(entry.left);
        thumbWidth.set(entry.width);
    }, [thumbLeft, thumbWidth]);

    // 摇杆吸附停稳后再延一拍才换页签；期间任何一次新的拖动/吸附都会让这次切换作废。
    const armActivationAfterSettle = useCallback((key: K) => {
        cancelPendingActivation();
        const pending: { timer: ReturnType<typeof setTimeout> | null; unsubscribe?: VoidFunction } = { timer: null };
        pendingActivationRef.current = pending;
        const startCountdown = () => {
            if (pendingActivationRef.current !== pending) return;
            pending.timer = setTimeout(() => {
                if (pendingActivationRef.current !== pending) return;
                pendingActivationRef.current = null;
                if (draggingRef.current) return;
                if (key !== activeKeyRef.current) onActivate(key);
            }, ACTIVATE_SETTLE_DELAY_MS);
        };
        // 摇杆还在弹就等它停下再计时；已经停在目标上就直接计时。
        if (thumbLeft.isAnimating()) {
            pending.unsubscribe = thumbLeft.on('animationComplete', () => {
                pending.unsubscribe?.();
                pending.unsubscribe = undefined;
                startCountdown();
            });
        } else {
            startCountdown();
        }
    }, [cancelPendingActivation, onActivate, thumbLeft]);

    // Re-measure on mount and whenever the tab set changes, snapping straight onto the active tab.
    useLayoutEffect(() => {
        measure();
        if (!draggingRef.current) glideToIndex(activeIndex);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measure, itemsSignature]);

    // Font/label width drift (bold active label, resize) re-measures. Animating here instead of
    // setting directly matters: the active tab turning bold resizes it, and a direct set would cancel
    // the release snap and make it look instant.
    useEffect(() => {
        const track = trackRef.current;
        if (!track || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            measure();
            if (draggingRef.current) return;
            glideToIndex(activeKeyToIndex(itemsRef.current, activeKeyRef.current));
        });
        observer.observe(track);
        track.querySelectorAll('[data-home-tab]').forEach(button => observer.observe(button));
        return () => observer.disconnect();
    }, [measure, trackRef, itemsSignature, glideToIndex]);

    // Glide onto the active tab when the selection changes from a click, keyboard or the host.
    // Measure first: the active tab flipping to bold reflows the row, so without a fresh read the
    // glide would target the pre-reflow box and the thumb would dart from a wrong spot before the
    // ResizeObserver corrected it (visible as "flying in" on rapid clicks).
    useLayoutEffect(() => {
        if (draggingRef.current) return;
        measure();
        glideToIndex(activeIndex);
    }, [activeIndex, measure, glideToIndex]);

    const clampLeft = useCallback((value: number) => {
        const layout = layoutRef.current;
        if (layout.length === 0) return value;
        const maxLeft = layout[layout.length - 1].left + layout[layout.length - 1].width - thumbWidth.get();
        return Math.max(0, Math.min(maxLeft, value));
    }, [thumbWidth]);

    // 指针位置换算进容器自身布局坐标（兼容 scale-90），得到摇杆「中心对齐指针」的 left 目标。
    const pointerTargetLeft = useCallback((clientX: number) => {
        const scale = trackScaleRef.current || 1;
        const localX = (clientX - trackRectLeftRef.current) / scale;
        return clampLeft(localX - thumbWidth.get() / 2);
    }, [clampLeft, thumbWidth]);

    // 释放时按「摇杆中心到各可用页签中心的距离」四舍五入取最近的一个。
    const nearestTabIndex = useCallback((center: number) => {
        const layout = layoutRef.current;
        let best = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < layout.length; index += 1) {
            const item = itemsRef.current[index];
            if (!item || item.disabled) continue;
            const tabCenter = layout[index].left + layout[index].width / 2;
            const distance = Math.abs(tabCenter - center);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        }
        if (best >= 0) return best;
        return Math.min(activeKeyToIndex(itemsRef.current, activeKeyRef.current), Math.max(0, layout.length - 1));
    }, []);

    // 按下切换器任意处：摇杆平滑滑到鼠标正下方，进入按住状态；此时不夺指针、不阻止默认行为，
    // 所以纯点击仍会走页签自身的 click。
    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (gestureRef.current) return;
        // 新的一次按下作废上一次松手排下的页面切换，吸附弹簧照旧可被打断。
        cancelPendingActivation();
        draggingRef.current = true;
        setDragging(true);
        const track = trackRef.current;
        const rect = track?.getBoundingClientRect();
        trackRectLeftRef.current = rect?.left ?? 0;
        trackScaleRef.current = track && rect && track.offsetWidth > 0 ? rect.width / track.offsetWidth : 1;
        gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, moved: false };
        thumbLeft.set(pointerTargetLeft(event.clientX));
    }, [cancelPendingActivation, pointerTargetLeft, thumbLeft, trackRef]);

    // 越过阈值才算真正拖动：这时才夺指针并阻止默认行为（否则点页签的 click 会被吞掉）。
    const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (!gesture.moved && Math.abs(event.clientX - gesture.startX) > TAP_MOVE_THRESHOLD_PX) {
            gesture.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
        }
        // 跟手用 jump 保持即时响应、不引入弹簧滞后；松手/吸附才交给弹簧。jump 会清掉正在跑的
        // 弹簧，所以松手时 .set 会从当前指针位置重新起弹，不会「飞回来」。
        thumbLeft.jump(pointerTargetLeft(event.clientX));
    }, [pointerTargetLeft, thumbLeft]);

    const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        draggingRef.current = false;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        // 松手：按「松手指针位置」而不是摇杆当前值算最近页签——纯点击时吸附动画才刚开始，
        // 当前的 thumbLeft 还停在旧位置，用它取整会选错页签并来回摆动。
        const center = pointerTargetLeft(event.clientX) + thumbWidth.get() / 2;
        const target = nearestTabIndex(center);
        glideToIndex(target);
        const key = itemsRef.current[target]?.key;
        if (key && key !== activeKeyRef.current) {
            // 不立刻切：先把摇杆吸附到目标，停稳后再等一拍才换页签。
            armActivationAfterSettle(key);
        }
        if (!gesture.moved) onTapActive?.();
    }, [armActivationAfterSettle, glideToIndex, nearestTabIndex, onTapActive, pointerTargetLeft, thumbWidth]);

    return {
        thumbLeft,
        thumbWidth,
        thumbDragging: dragging,
        thumbScale: dragging ? DRAG_SCALE : 1,
        thumbHandlers: {
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
        },
    };
};
