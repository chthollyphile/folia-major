// src/components/app/lattice/useWallKeyboardFocus.ts

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type KeyboardEvent,
    type RefObject,
    type SetStateAction,
} from 'react';
import type { LatticeGeometry, QueueInstance, WallMetrics } from './layout';
import {
    findAdjacentInstance,
    findNearestInstance,
    type WallDirection,
} from './wallNavigation';
import type { ActiveLatticePoster } from './useLatticePlaybackFocus';

// Keyboard layer for the wall: Escape collapses the open poster, arrows walk the focus.

const ARROW_DIRECTIONS: Record<string, WallDirection> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

type WallKeyboardFocusOptions = {
    activePoster: ActiveLatticePoster | null;
    geometry: LatticeGeometry;
    getViewportCenter: () => { x: number; y: number };
    containerRef: RefObject<HTMLDivElement | null>;
    instances: QueueInstance[];
    metrics: WallMetrics;
    rendered: Map<string, { x: number; y: number; width: number; height: number }>;
    panTo: (rect: { x: number; y: number; width: number; height: number }) => void;
    setActivePoster: Dispatch<SetStateAction<ActiveLatticePoster | null>>;
    setShowHint: Dispatch<SetStateAction<boolean>>;
    totalEntries: number;
    worldRef: RefObject<HTMLDivElement | null>;
};

export const useWallKeyboardFocus = ({
    activePoster,
    containerRef,
    geometry,
    getViewportCenter,
    instances,
    metrics,
    panTo,
    rendered,
    setActivePoster,
    setShowHint,
    totalEntries,
    worldRef,
}: WallKeyboardFocusOptions) => {
    const [focused, setFocusedState] = useState<QueueInstance | null>(null);
    // Held arrow keys fire faster than React re-renders, so the next step is computed from a ref;
    // reading state here would recompute the same hop from a value one render behind.
    const focusedRef = useRef<QueueInstance | null>(null);
    const setFocused = useCallback((instance: QueueInstance | null) => {
        focusedRef.current = instance;
        setFocusedState(instance);
    }, []);

    const moveFocus = useCallback((direction: WallDirection) => {
        const current = focusedRef.current;
        const seed = current ?? findNearestInstance(instances, getViewportCenter());
        if (!seed) return;
        // The first arrow press only adopts what is already on screen; later ones travel.
        const next = current
            ? findAdjacentInstance(seed, direction, geometry, totalEntries, metrics, rendered)
            : seed;
        if (!next) return;

        setShowHint(false);
        setFocused(next);
        panTo(rendered.get(next.instanceId) ?? next);
    }, [geometry, getViewportCenter, instances, metrics, panTo, rendered, setFocused, setShowHint, totalEntries]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;

        if (event.key === 'Escape') {
            // Let it bubble when nothing is open, so the view keeps whatever Escape means outside.
            if (!activePoster) return;
            event.preventDefault();
            event.stopPropagation();
            setFocused(activePoster.instance);
            setActivePoster(null);
            return;
        }

        const direction = ARROW_DIRECTIONS[event.key];
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        moveFocus(direction);
    }, [activePoster, moveFocus, setActivePoster, setFocused]);

    // Mirrors the focused index onto the DOM so the native ring, Enter/Space and screen readers
    // follow it. Depends on `instances` because culling may not have rendered the target yet.
    useEffect(() => {
        if (!focused) return;
        const node = worldRef.current?.querySelector<HTMLElement>(
            `[data-instance-id="${focused.instanceId}"]`,
        );
        if (node && document.activeElement !== node) node.focus({ preventScroll: true });
    }, [focused, instances, worldRef]);

    // The field itself has to hold focus, or arrow keys never reach this handler.
    useEffect(() => {
        containerRef.current?.focus({ preventScroll: true });
    }, [containerRef]);

    return { focused, setFocused, handleKeyDown };
};
