import { useEffect, useLayoutEffect, useRef, type PointerEvent, type KeyboardEvent, type RefObject } from 'react';
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
) => {
    const saved = useStageSettingsStore(state => state.stageTrackPillPosition);
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
            useNowPlayingCardLayoutStore.getState().finishPositioning();
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
        positioning, save, cancel: finish, reset,
        style: saved !== null || positioning ? { left, top } : { left: 24, bottom },
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture: () => { dragging.current = null; }, onKeyDown },
    };
};
