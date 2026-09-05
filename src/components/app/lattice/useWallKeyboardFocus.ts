// src/components/app/lattice/useWallKeyboardFocus.ts

import {
    useCallback,
    useEffect,
    useRef,
    type Dispatch,
    type KeyboardEvent,
    type FocusEvent,
    type RefObject,
    type SetStateAction,
} from 'react';
import type { LatticeGeometry, QueueInstance, WallMetrics } from './layout';
import {
    findAdjacentInstance,
    findNearestInstance,
    type WallDirection,
} from './wallNavigation';
import { useLatticePosterSelection } from './useLatticePosterSelection';
import type { LatticeTile } from './latticeModel';
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
    tiles: LatticeTile[];
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
    tiles,
    worldRef,
}: WallKeyboardFocusOptions) => {
    const [selection, setSelection] = useLatticePosterSelection(tiles, geometry, metrics);
    const focused = selection?.instance ?? null;
    // Held arrow keys fire faster than React re-renders, so the next step is computed from a ref;
    // reading state here would recompute the same hop from a value one render behind.
    const focusedRef = useRef<QueueInstance | null>(focused);
    focusedRef.current = focused;
    const pendingFocusRef = useRef(false);
    const focusWithinRef = useRef(false);
    const previousTilesRef = useRef(tiles);
    const adoptFocus = useCallback((instance: QueueInstance | null) => {
        focusedRef.current = instance;
        setSelection(current => current?.instance === instance ? current
            : instance && tiles[instance.queueIndex] ? { instance, tile: tiles[instance.queueIndex] } : null);
    }, [setSelection, tiles]);
    const setFocused = useCallback((instance: QueueInstance | null) => {
        pendingFocusRef.current = Boolean(instance);
        adoptFocus(instance);
    }, [adoptFocus]);

    const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
        focusWithinRef.current = true;
        const node = event.target.closest<HTMLElement>('[data-instance-id]');
        const instance = instances.find(item => item.instanceId === node?.dataset.instanceId);
        if (!instance) return;
        pendingFocusRef.current = false;
        adoptFocus(instance);
    }, [adoptFocus, instances]);

    const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
        focusWithinRef.current = event.currentTarget.contains(event.relatedTarget);
    }, []);

    const moveFocus = useCallback((direction: WallDirection) => {
        const current = focusedRef.current;
        const seed = current ?? findNearestInstance(instances, getViewportCenter());
        if (!seed) return;
        // The first arrow press only adopts what is already on screen; later ones travel.
        const next = current
            ? findAdjacentInstance(seed, direction, geometry, tiles.length, metrics, rendered)
            : seed;
        if (!next) return;

        setShowHint(false);
        setFocused(next);
        panTo(rendered.get(next.instanceId) ?? next);
    }, [geometry, getViewportCenter, instances, metrics, panTo, rendered, setFocused, setShowHint, tiles.length]);

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

        // Nested playback controls own their arrows (especially the native range input).
        if (event.target instanceof Element && event.target.closest('.lattice-poster-controls')) return;
        const direction = ARROW_DIRECTIONS[event.key];
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        moveFocus(direction);
    }, [activePoster, moveFocus, setActivePoster, setFocused]);

    // Mirrors the focused index onto the DOM so the native ring, Enter/Space and screen readers
    // follow it. Depends on `instances` because culling may not have rendered the target yet.
    useEffect(() => {
        const queueChanged = previousTilesRef.current !== tiles;
        previousTilesRef.current = tiles;
        if (!focused || !(pendingFocusRef.current || (queueChanged && focusWithinRef.current))) return;
        const node = worldRef.current?.querySelector<HTMLElement>(
            `[data-instance-id="${focused.instanceId}"]`,
        );
        if (!node) return;
        pendingFocusRef.current = false;
        if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
    }, [focused, instances, tiles, worldRef]);

    // The field itself has to hold focus, or arrow keys never reach this handler.
    useEffect(() => {
        containerRef.current?.focus({ preventScroll: true });
    }, [containerRef]);

    return { focused, setFocused, handleKeyDown, handleFocusCapture, handleBlurCapture };
};
