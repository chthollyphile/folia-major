import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type RefObject } from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
import { useStageSettingsStore } from '../../../../stores/useStageSettingsStore';
import { clampCardPoint, relativeCardPosition, resolveCardPoint, type CardViewport, type NowPlayingCardPosition } from '../../../../utils/nowPlayingCardPosition';
import { useNowPlayingCardLayoutStore } from './nowPlayingCardLayoutStore';

// Pointer-frequency positions stay in MotionValues; only Save writes the settings store.
export const useNowPlayingCardPosition = (
    frame: RefObject<HTMLDivElement | null>,
    size: { width: number; height: number },
    bottom: MotionValue<number>,
    visible: boolean,
    invalidate: () => void,
    /** A position from elsewhere (an OBS source has no copy of the settings store); undefined reads the store. */
    savedOverride?: NowPlayingCardPosition | null,
) => {
    const stored = useStageSettingsStore(state => state.stageTrackPillPosition);
    const saved = savedOverride === undefined ? stored : savedOverride;
    const positioning = useNowPlayingCardLayoutStore(state => state.isPositioning);
    const left = useMotionValue(24);
    const top = useMotionValue(0);
    const draft = useRef<NowPlayingCardPosition | null>(saved);
    const dragging = useRef<{ id: number; dx: number; dy: number } | null>(null);
    const viewport = (): CardViewport => ({
        width: window.innerWidth, height: window.innerHeight,
        cardWidth: frame.current?.offsetWidth ?? size.width,
        cardHeight: frame.current?.offsetHeight ?? size.height,
    });
    const move = (point: NowPlayingCardPosition) => {
        const clamped = clampCardPoint(point, viewport());
        left.set(clamped.x);
        top.set(clamped.y);
        invalidate();
        return clamped;
    };
    const apply = () => move(resolveCardPoint(positioning ? draft.current : saved, viewport(), bottom.get()));

    useLayoutEffect(() => {
        draft.current = saved;
        dragging.current = null;
    }, [positioning, saved]);
    useLayoutEffect(() => {
        if (positioning && visible) frame.current?.querySelector('button')?.focus({ preventScroll: true });
    }, [positioning, visible]);
    useLayoutEffect(() => {
        if (!visible) return;
        apply();
        const unsubscribe = bottom.on('change', () => {
            if (!(positioning ? draft.current : saved)) apply();
        });
        window.addEventListener('resize', apply);
        return () => { unsubscribe(); window.removeEventListener('resize', apply); };
    }, [positioning, saved, visible, size.width, size.height]);
    useEffect(() => {
        if (!positioning) return;
        const escape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const layout = useNowPlayingCardLayoutStore.getState();
            layout.isLongPressDragging = false;
            layout.finishPositioning();
            pressRef.current = null;
            dragging.current = null;
            setDragArmed(false);
        };
        window.addEventListener('keydown', escape, true);
        return () => window.removeEventListener('keydown', escape, true);
    }, [positioning]);

    const finish = () => useNowPlayingCardLayoutStore.getState().finishPositioning();
    const save = () => {
        useStageSettingsStore.getState().handleSetStageTrackPillPosition(draft.current);
        finish();
    };
    const reset = () => {
        draft.current = null;
        move(resolveCardPoint(null, viewport(), bottom.get()));
    };
    const update = (point: NowPlayingCardPosition) => {
        draft.current = relativeCardPosition(move(point), viewport());
    };
    /* —— 直接在卡片上长按拖动（不用先进设置里的调整模式）——
       按住不动 260ms，或按住就划开 14px，就算要拖：临时进 positioning（那套机制全都在：
       MotionValue 移动、clamp、Escape 收尾、卡片可见性锁定），松手立刻存进
       stageTrackPillPosition 并退出调整模式——不弹调整工具条。平时这一下点击（打开播放页）
       在拖过的那一次松手上会被抑制。reduced-motion 与它无关：拖动是直接的指针操作。 */
    const LONG_PRESS_DRAG_MS = 260;
    const DRAG_SLOP_PX = 14;
    const [dragArmed, setDragArmed] = useState(false);
    const pressRef = useRef<{ id: number; startX: number; startY: number; timer: number | undefined; dragged: boolean } | null>(null);

    const beginLongPressDrag = (event: PointerEvent<HTMLButtonElement>, element: HTMLButtonElement) => {
        const press = pressRef.current;
        if (!press) return;
        press.dragged = true;
        setDragArmed(true);
        const layout = useNowPlayingCardLayoutStore.getState();
        layout.isLongPressDragging = true;
        layout.startPositioning();
        dragging.current = { id: event.pointerId, dx: event.clientX - left.get(), dy: event.clientY - top.get() };
        // 拖动从指针此刻的位置接管：先把卡片挪到指针下（与定位模式的「点哪卡片去哪」一致）。
        update({ x: event.clientX - (element.offsetWidth / 2), y: event.clientY - (element.offsetHeight / 2) });
        invalidate();
    };

    const handleCardPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        // 定位模式里走原生的那一套（工具条在，行为不变）。
        if (positioning) {
            onPointerDown(event);
            return;
        }
        if (event.button !== 0 || !event.isPrimary) return;
        const element = event.currentTarget;
        const press = { id: event.pointerId, startX: event.clientX, startY: event.clientY, timer: undefined as number | undefined, dragged: false };
        pressRef.current = press;
        // 按下就把指针抓到卡片上：之后指针跑出卡片，move / up 仍到得了这里。
        element.setPointerCapture(event.pointerId);
        press.timer = window.setTimeout(() => {
            if (pressRef.current !== press) return;
            beginLongPressDrag(event, element);
        }, LONG_PRESS_DRAG_MS);
    };

    const handleCardPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        if (positioning) {
            onPointerMove(event);
            return;
        }
        const press = pressRef.current;
        if (!press || press.id !== event.pointerId) return;
        if (!press.dragged) {
            if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >= DRAG_SLOP_PX) {
                if (press.timer !== undefined) window.clearTimeout(press.timer);
                beginLongPressDrag(event, event.currentTarget);
            }
            return;
        }
        const drag = dragging.current;
        if (!drag || drag.id !== event.pointerId) return;
        event.preventDefault();
        update({ x: event.clientX - drag.dx, y: event.clientY - drag.dy });
    };

    const handleCardPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
        if (positioning) {
            onPointerUp(event);
            return;
        }
        const press = pressRef.current;
        if (!press || press.id !== event.pointerId) return;
        if (press.timer !== undefined) window.clearTimeout(press.timer);
        if (press.dragged) {
            pressRef.current = null;
            dragging.current = null;
            // 拖完即存：同一个设置值（stageTrackPillPosition），与调整模式里按「保存」一致。
            useStageSettingsStore.getState().handleSetStageTrackPillPosition(draft.current);
            const layout = useNowPlayingCardLayoutStore.getState();
            layout.isLongPressDragging = false;
            layout.finishPositioning();
            setDragArmed(false);
            // 这一次松手带的 click 不触发激活（打开播放页）。
            event.currentTarget.dataset.nowPlayingDragged = 'true';
            return;
        }
        pressRef.current = null;
    };

    const handleCardClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (event.currentTarget.dataset.nowPlayingDragged === 'true') {
            delete event.currentTarget.dataset.nowPlayingDragged;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    };

    const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (!positioning || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = { id: event.pointerId, dx: event.clientX - left.get(), dy: event.clientY - top.get() };
    };
    const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        const drag = dragging.current;
        if (!positioning || !drag || drag.id !== event.pointerId) return;
        event.preventDefault();
        update({ x: event.clientX - drag.dx, y: event.clientY - drag.dy });
    };
    const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
        if (dragging.current?.id !== event.pointerId) return;
        dragging.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!positioning) return;
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const step = event.shiftKey ? 10 : 1;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        update({ x: left.get() + delta[0], y: top.get() + delta[1] });
    };

    return {
        positioning,
        dragArmed,
        save, cancel: finish, reset,
        style: saved !== null || positioning || dragArmed ? { left, top } : { left: 24, bottom },
        handlers: {
            onPointerDown: handleCardPointerDown,
            onPointerMove: handleCardPointerMove,
            onPointerUp: handleCardPointerUp,
            onPointerCancel: handleCardPointerUp,
            onLostPointerCapture: () => {
                dragging.current = null;
                if (useNowPlayingCardLayoutStore.getState().isLongPressDragging) {
                    const layout = useNowPlayingCardLayoutStore.getState();
                    layout.isLongPressDragging = false;
                    layout.finishPositioning();
                    setDragArmed(false);
                }
                pressRef.current = null;
            },
            onKeyDown,
            onClick: handleCardClick,
        },
    };
};
