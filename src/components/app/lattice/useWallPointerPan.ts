// src/components/app/lattice/useWallPointerPan.ts

import { animate } from 'framer-motion';
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type PointerEvent, type MouseEvent, type RefObject, type SetStateAction } from 'react';
import type { Bounds } from './layout';
import type { LatticeCamera } from './useWallCameraPan';

// Drag and wheel panning. Camera writes bypass React state; only the cull bounds are published.

const DRAG_THRESHOLD_PX = 7;
const CULL_EDGE_MARGIN_PX = 180;

type WallPointerPanOptions = {
    applyCamera: (camera: LatticeCamera, updateBounds?: boolean) => void;
    animationRef: MutableRefObject<{ stop: () => void } | null>;
    stopPan: () => void;
    containerRef: RefObject<HTMLDivElement | null>;
    reducedMotion: boolean | null;
    overscan: number;
    bounds: Bounds;
    cameraRef: MutableRefObject<LatticeCamera>;
    getWorldBounds: (camera: LatticeCamera, viewport: { width: number; height: number }) => Bounds;
    setShowHint: Dispatch<SetStateAction<boolean>>;
    viewportRef: MutableRefObject<{ width: number; height: number }>;
};

export const useWallPointerPan = ({
    applyCamera, animationRef, stopPan, containerRef, reducedMotion, overscan,
    bounds, cameraRef, getWorldBounds, setShowHint, viewportRef,
}: WallPointerPanOptions) => {
    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;
    const pointerRef = useRef<{
        id: number;
        start: { x: number; y: number };
        camera: { x: number; y: number };
        last: { x: number; y: number; time: number };
        vx: number;
        vy: number;
        dragged: boolean;
    } | null>(null);
    // Read by the poster click handler so a drag that ends on a card does not open it.
    const didDragRef = useRef(false);

    // Republishing bounds is what triggers a re-cull, so only do it near the edge of what is culled.
    const updateCamera = useCallback((x: number, y: number) => {
        const next = { ...cameraRef.current, x, y };
        const visible = getWorldBounds(next, viewportRef.current);
        const culled = boundsRef.current;
        const padding = overscan - CULL_EDGE_MARGIN_PX;
        const nearCullEdge = visible.left < culled.left - padding
            || visible.right > culled.right + padding
            || visible.top < culled.top - padding
            || visible.bottom > culled.bottom + padding;
        applyCamera(next, nearCullEdge);
    }, [applyCamera, cameraRef, getWorldBounds, overscan, viewportRef]);

    const interrupt = useCallback(() => {
        stopPan();
    }, [stopPan]);

    const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary || pointerRef.current) return;
        interrupt();
        didDragRef.current = false;
        // Panning stays available while a card is open, but a drag that starts on the open card
        // belongs to its own controls - the progress bar seeks by dragging.
        // Only actual controls are excluded; the cover, title and surrounding space can pan.
        if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="slider"]')) return;
        pointerRef.current = {
            id: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            camera: { x: cameraRef.current.x, y: cameraRef.current.y },
            last: { x: event.clientX, y: event.clientY, time: event.timeStamp },
            vx: 0, vy: 0, dragged: false,
        };
    }, [cameraRef, interrupt]);

    const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.start.x;
        const dy = event.clientY - pointer.start.y;
        if (!pointer.dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
            pointer.dragged = true;
            didDragRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setShowHint(false);
        }
        const elapsed = event.timeStamp - pointer.last.time;
        if (elapsed > 0) {
            pointer.vx = (event.clientX - pointer.last.x) / elapsed * 1000;
            pointer.vy = (event.clientY - pointer.last.y) / elapsed * 1000;
        }
        pointer.last = { x: event.clientX, y: event.clientY, time: event.timeStamp };
        if (pointer.dragged) updateCamera(pointer.camera.x + dx, pointer.camera.y + dy);
    }, [setShowHint, updateCamera]);

    // Continue along the release velocity; stale samples and cancelled gestures never coast.
    const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        pointerRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!pointer.dragged || reducedMotion || event.timeStamp - pointer.last.time > 80) return;
        const speed = Math.hypot(pointer.vx, pointer.vy);
        if (speed < 40) return;
        const from = cameraRef.current;
        animationRef.current = animate(0, Math.min(speed, 4000) * 0.3, {
            type: 'inertia', velocity: Math.min(speed, 4000), power: 0.3, timeConstant: 280,
            restDelta: 0.5,
            onUpdate: distance => updateCamera(from.x + distance * pointer.vx / speed, from.y + distance * pointer.vy / speed),
        });
    }, [animationRef, cameraRef, reducedMotion, updateCamera]);

    const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (pointerRef.current?.id !== event.pointerId) return;
        pointerRef.current = null;
        interrupt();
    }, [interrupt]);

    const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (!didDragRef.current || event.detail === 0) return;
        didDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            if (pointerRef.current) return;
            setShowHint(false);
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportRef.current.height : 1;
            const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
            const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
            const from = cameraRef.current;
            stopPan();
            // Apply each trackpad/wheel delta immediately; no smoothing or synthetic tail.
            updateCamera(from.x - dx, from.y - dy);
        };
        const cancel = () => { pointerRef.current = null; interrupt(); };
        const endOutside = (event: globalThis.PointerEvent) => {
            if (pointerRef.current?.id === event.pointerId) cancel();
        };
        window.addEventListener('pointerup', endOutside);
        window.addEventListener('pointercancel', endOutside);
        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('keydown', cancel, true);
        window.addEventListener('blur', cancel);
        return () => {
            container.removeEventListener('wheel', onWheel);
            container.removeEventListener('keydown', cancel, true);
            window.removeEventListener('blur', cancel);
            window.removeEventListener('pointerup', endOutside);
            window.removeEventListener('pointercancel', endOutside);
            cancel();
        };
    }, [animationRef, cameraRef, containerRef, interrupt, reducedMotion, setShowHint, stopPan, updateCamera, viewportRef]);

    return { didDragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture };
};
