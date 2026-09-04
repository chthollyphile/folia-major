// src/components/app/lattice/useWallPointerPan.ts

import { useCallback, useRef, type Dispatch, type MutableRefObject, type PointerEvent, type SetStateAction, type WheelEvent } from 'react';
import type { Bounds } from './layout';
import type { LatticeCamera } from './useWallCameraPan';

// Drag and wheel panning. Camera writes bypass React state; only the cull bounds are published.

const DRAG_THRESHOLD_PX = 7;
const CULL_EDGE_MARGIN_PX = 180;

type WallPointerPanOptions = {
    applyCamera: (camera: LatticeCamera, updateBounds?: boolean) => void;
    bounds: Bounds;
    cameraRef: MutableRefObject<LatticeCamera>;
    getWorldBounds: (camera: LatticeCamera, viewport: { width: number; height: number }) => Bounds;
    setShowHint: Dispatch<SetStateAction<boolean>>;
    viewportRef: MutableRefObject<{ width: number; height: number }>;
};

export const useWallPointerPan = ({
    applyCamera,
    bounds,
    cameraRef,
    getWorldBounds,
    setShowHint,
    viewportRef,
}: WallPointerPanOptions) => {
    const pointerRef = useRef<{
        id: number;
        start: { x: number; y: number };
        camera: { x: number; y: number };
        dragged: boolean;
    } | null>(null);
    // Read by the poster click handler so a drag that ends on a card does not open it.
    const didDragRef = useRef(false);

    // Republishing bounds is what triggers a re-cull, so only do it near the edge of what is culled.
    const updateCamera = useCallback((x: number, y: number) => {
        const next = { ...cameraRef.current, x, y };
        const visible = getWorldBounds(next, viewportRef.current);
        const nearCullEdge = visible.left < bounds.left + CULL_EDGE_MARGIN_PX
            || visible.right > bounds.right - CULL_EDGE_MARGIN_PX
            || visible.top < bounds.top + CULL_EDGE_MARGIN_PX
            || visible.bottom > bounds.bottom - CULL_EDGE_MARGIN_PX;
        applyCamera(next, nearCullEdge);
    }, [applyCamera, bounds, cameraRef, getWorldBounds, viewportRef]);

    const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        // Panning stays available while a card is open, but a drag that starts on the open card
        // belongs to its own controls - the progress bar seeks by dragging.
        if (event.target instanceof Element && event.target.closest('.lattice-poster.is-expanded')) {
            return;
        }
        pointerRef.current = {
            id: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            camera: { x: cameraRef.current.x, y: cameraRef.current.y },
            dragged: false,
        };
        didDragRef.current = false;
    }, [cameraRef]);

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
        if (pointer.dragged) updateCamera(pointer.camera.x + dx, pointer.camera.y + dy);
    }, [setShowHint, updateCamera]);

    const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (pointerRef.current?.id === event.pointerId) pointerRef.current = null;
    }, []);

    const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        setShowHint(false);
        updateCamera(cameraRef.current.x - event.deltaX, cameraRef.current.y - event.deltaY);
    }, [cameraRef, setShowHint, updateCamera]);

    return { didDragRef, onPointerDown, onPointerMove, onPointerUp, onWheel };
};
