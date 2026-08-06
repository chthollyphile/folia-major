import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';

// src/components/folia-grid/Grid3DSlider.tsx
// Controlled desktop Grid3D slider shared by Netease, local music, and Navidrome overview surfaces.

export interface Grid3DSliderItem {
    id: string | number;
    name: React.ReactNode;
    coverUrl?: string;
    description?: string;
    summary?: string;
    trackCount?: number;
    type?: string;
}

interface Grid3DSliderProps {
    items: Grid3DSliderItem[];
    focusedIndex: number;
    onFocusedIndexChange: (index: number) => void;
    onSelect: (item: Grid3DSliderItem, index: number) => void;
    isInteractive?: boolean;
    isLoading?: boolean;
    emptyMessage?: string;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
}

const compactDescription = (description?: string, maxLength = 72) => {
    if (!description) return '';
    const normalized = description.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
};

export const getGrid3DSliderSecondaryText = (
    item: Pick<Grid3DSliderItem, 'type' | 'description' | 'summary'>,
): string => (
    item.type === 'playlist'
        ? compactDescription(item.summary) || compactDescription(item.description)
        : compactDescription(item.description) || compactDescription(item.summary)
);

export const getGrid3DSliderSummaryText = (
    item: Pick<Grid3DSliderItem, 'type' | 'description' | 'summary'>,
): string => {
    const summary = compactDescription(item.summary);
    return summary && summary !== getGrid3DSliderSecondaryText(item) ? summary : '';
};

const DISCRETE_WHEEL_PIXEL_THRESHOLD = 40;
const DISCRETE_WHEEL_DISTANCE_MULTIPLIER = 3;
const WHEEL_SMOOTHING_SETTLE_DISTANCE = 0.5;
const WHEEL_SMOOTHING_MIN_PROGRESS = 0.01;
const WHEEL_SMOOTHING_MAX_DURATION_MS = 800;

export interface Grid3DWheelInput {
    delta: number;
    isDiscreteMouseWheel: boolean;
}

// Normalizes browser wheel units while keeping high-frequency trackpad input on the direct-scroll path.
export const resolveGrid3DWheelInput = (
    deltaX: number,
    deltaY: number,
    deltaMode: number,
    pageSize: number,
): Grid3DWheelInput => {
    const rawDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    const unitScale = deltaMode === 1
        ? 32
        : deltaMode === 2
            ? Math.max(pageSize, 1)
            : 1;

    return {
        delta: rawDelta * unitScale,
        isDiscreteMouseWheel: deltaMode !== 0 || Math.abs(rawDelta) >= DISCRETE_WHEEL_PIXEL_THRESHOLD,
    };
};

/**
 * Identifies the layout the cached card centers were measured in. The card count alone is not
 * enough: `coverSize` and `edgePadding` move every card whenever a container breakpoint flips or
 * the floating player appears, and neither changes the count.
 */
export const getGrid3DCardGeometryKey = (
    cardCount: number,
    viewportWidth: number,
    firstCardWidth: number,
    firstCardOffsetLeft: number,
): string => `${cardCount}:${viewportWidth}:${firstCardWidth}:${firstCardOffsetLeft}`;

const clampFocusedIndex = (index: number, itemCount: number) => {
    if (itemCount <= 0 || !Number.isFinite(index)) {
        return 0;
    }

    return Math.min(Math.max(0, Math.trunc(index)), itemCount - 1);
};

export const Grid3DSlider: React.FC<Grid3DSliderProps> = ({
    items,
    focusedIndex,
    onFocusedIndexChange,
    onSelect,
    isInteractive = true,
    isLoading = false,
    emptyMessage = 'No items found',
    isDaylight,
    hasFloatingPlayer = false,
}) => {
    const { t } = useTranslation();
    const grid3dCardStyle = useSettingsUiStore(state => state.grid3dCardStyle);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onFocusedIndexChangeRef = useRef(onFocusedIndexChange);
    const focusedIndexRef = useRef(focusedIndex);
    const lastInternalFocusRef = useRef<number | null>(null);
    const isProgrammaticScrollRef = useRef(false);
    const programmaticTargetLeftRef = useRef<number | null>(null);
    const programmaticScrollTimeoutRef = useRef<any>(null);
    const lastKeyboardNavTimeRef = useRef(0);
    const wheelIdleTimerRef = useRef<any>(null);
    const momentumVelocityRef = useRef(0);
    const momentumRafRef = useRef<number | null>(null);
    const wheelSmoothingRafRef = useRef<number | null>(null);
    const wheelSmoothingTargetRef = useRef<number | null>(null);
    const wheelSmoothingLastTimeRef = useRef(0);
    const wheelSmoothingStartedAtRef = useRef(0);
    const cardCentersRef = useRef<number[]>([]);
    const cardGeometryKeyRef = useRef<string>('');
    const isDraggingRef = useRef(false);
    const startXRef = useRef(0);
    const scrollLeftRef = useRef(0);
    const dragDistanceRef = useRef(0);
    const lastDragScrollRef = useRef(0);
    const lastDragTimeRef = useRef(0);

    const [containerSize, setContainerSize] = useState(() => {
        if (typeof window === 'undefined') {
            return { width: 0, height: 0 };
        }
        return { width: window.innerWidth, height: window.innerHeight };
    });

    focusedIndexRef.current = focusedIndex;

    useEffect(() => {
        onFocusedIndexChangeRef.current = onFocusedIndexChange;
    }, [onFocusedIndexChange]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const updateContainerSize = () => {
            const nextWidth = element.clientWidth;
            const nextHeight = element.clientHeight;

            setContainerSize((prev) => (
                prev.width === nextWidth && prev.height === nextHeight
                    ? prev
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        updateContainerSize();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateContainerSize);
            return () => window.removeEventListener('resize', updateContainerSize);
        }

        const observer = new ResizeObserver(updateContainerSize);
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    const isDesktopWidth = containerSize.width >= 768;
    const isNarrowLayout = containerSize.width > 0 && containerSize.width < 768;
    const isShortLayout = containerSize.height > 0 && containerSize.height < (hasFloatingPlayer ? 420 : 380);
    const useCompactMetrics = isNarrowLayout || isShortLayout;
    const isLargeDesktop = !useCompactMetrics
        && isDesktopWidth
        && containerSize.width >= 1440
        && containerSize.height >= (hasFloatingPlayer ? 660 : 600);
    const isUltraDesktop = !useCompactMetrics
        && isDesktopWidth
        && containerSize.width >= 2000
        && containerSize.height >= (hasFloatingPlayer ? 780 : 720);

    const coverSize = useCompactMetrics
        ? (isDesktopWidth ? 208 : 192)
        : (isDesktopWidth ? (isUltraDesktop ? 360 : isLargeDesktop ? 312 : 218) : 224);
    const edgePadding = Math.max(0, (containerSize.width - coverSize) / 2);

    const safeFocusedIndex = clampFocusedIndex(focusedIndex, items.length);
    const itemsSignature = useMemo(() => items.map(item => item.id).join(','), [items]);

    const [visibleLimit, setVisibleLimit] = useState(30);
    const [loadedIndices, setLoadedIndices] = useState<Set<number>>(() => new Set([safeFocusedIndex]));

    useEffect(() => {
        setVisibleLimit(30);
        setLoadedIndices(new Set([safeFocusedIndex]));
    }, [itemsSignature]);

    useEffect(() => {
        setLoadedIndices(prev => {
            const next = new Set(prev);
            const range = 12;
            const start = Math.max(0, safeFocusedIndex - range);
            const end = Math.min(items.length - 1, safeFocusedIndex + range);
            let changed = false;
            for (let i = start; i <= end; i++) {
                if (!next.has(i)) {
                    next.add(i);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [safeFocusedIndex, items.length]);

    useEffect(() => {
        if (safeFocusedIndex >= visibleLimit) {
            setVisibleLimit(prev => Math.max(prev, safeFocusedIndex + 30));
        }
    }, [safeFocusedIndex, visibleLimit]);

    const currentLimit = Math.max(visibleLimit, safeFocusedIndex + 1);
    const slicedItems = items.slice(0, currentLimit);

    const updateCardTransforms = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return undefined;
        const flexWrapper = container.firstElementChild;
        if (!flexWrapper) return undefined;

        const maxDist = 600;
        const isImage = grid3dCardStyle === 'image';
        const peakScale = isImage ? 1.25 : 1.2;
        const minScale = 0.5;
        const cards = flexWrapper.children;

        let closestIndex = 0;
        let minPixelDist = Infinity;

        // Card positions also move when `coverSize` / `edgePadding` change, which the container
        // height breakpoints and the floating player both feed without the card count changing.
        // This runs from scroll handlers too, so during a resize one of those can repopulate the
        // cache from a half-applied layout. Keying it on measured geometry makes every caller
        // self-heal instead of depending on which call wins the race.
        const viewportWidth = container.clientWidth;
        const firstCard = cards[0] as HTMLElement | undefined;
        const geometryKey = getGrid3DCardGeometryKey(
            cards.length,
            viewportWidth,
            firstCard?.offsetWidth ?? 0,
            firstCard?.offsetLeft ?? 0,
        );

        if (cardGeometryKeyRef.current !== geometryKey) {
            const nextCenters = new Array<number>(cards.length);
            for (let i = 0; i < cards.length; i++) {
                const el = cards[i] as HTMLElement;
                nextCenters[i] = el.offsetLeft + el.offsetWidth / 2;
            }
            cardCentersRef.current = nextCenters;
            cardGeometryKeyRef.current = geometryKey;
        }

        const containerCenter = container.scrollLeft + viewportWidth / 2;
        for (let i = 0; i < cards.length; i++) {
            const el = cards[i] as HTMLElement;
            const cardCenter = cardCentersRef.current[i];
            const pixelDist = Math.abs(cardCenter - containerCenter);
            const tValue = Math.min(pixelDist / maxDist, 1);

            const scale = peakScale - (peakScale - minScale) * tValue;
            const opacity = Math.max(0.15, 1.0 - 0.85 * tValue);
            const y = -6 * (1 - tValue);
            const z = Math.max(1, Math.round(10 - 9 * tValue));

            el.style.transform = `scale(${scale}) translateY(${y}px)`;
            el.style.opacity = String(opacity);
            el.style.zIndex = String(z);

            if (pixelDist < minPixelDist) {
                minPixelDist = pixelDist;
                closestIndex = i;
            }
        }

        return closestIndex;
    }, [grid3dCardStyle]);

    const reportFocusedIndex = useCallback((index: number) => {
        const nextIndex = clampFocusedIndex(index, items.length);
        if (nextIndex === focusedIndexRef.current) {
            return;
        }

        lastInternalFocusRef.current = nextIndex;
        onFocusedIndexChangeRef.current(nextIndex);
    }, [items.length]);

    const stopMomentum = useCallback(() => {
        if (momentumRafRef.current !== null) {
            cancelAnimationFrame(momentumRafRef.current);
            momentumRafRef.current = null;
        }
        momentumVelocityRef.current = 0;
    }, []);

    const stopWheelSmoothing = useCallback(() => {
        if (wheelSmoothingRafRef.current !== null) {
            cancelAnimationFrame(wheelSmoothingRafRef.current);
            wheelSmoothingRafRef.current = null;
        }
        wheelSmoothingTargetRef.current = null;
        wheelSmoothingLastTimeRef.current = 0;
        wheelSmoothingStartedAtRef.current = 0;
    }, []);

    // Coalesces low-frequency mouse-wheel notches into one compositor-friendly scroll update per frame.
    const smoothDiscreteWheelBy = useCallback((delta: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        const currentTarget = wheelSmoothingTargetRef.current ?? container.scrollLeft;
        wheelSmoothingTargetRef.current = Math.max(
            0,
            Math.min(maxScrollLeft, currentTarget + delta * DISCRETE_WHEEL_DISTANCE_MULTIPLIER),
        );
        wheelSmoothingStartedAtRef.current = performance.now();

        if (wheelSmoothingRafRef.current !== null) return;

        const tick = (now: number) => {
            const activeContainer = scrollContainerRef.current;
            const target = wheelSmoothingTargetRef.current;
            if (!activeContainer || target === null) {
                stopWheelSmoothing();
                return;
            }

            const elapsed = wheelSmoothingLastTimeRef.current === 0
                ? 16.67
                : Math.min(now - wheelSmoothingLastTimeRef.current, 32);
            wheelSmoothingLastTimeRef.current = now;
            const progress = 1 - Math.pow(0.78, elapsed / 16.67);
            const liveMaxScrollLeft = Math.max(
                0,
                activeContainer.scrollWidth - activeContainer.clientWidth,
            );
            const boundedTarget = Math.max(0, Math.min(liveMaxScrollLeft, target));
            wheelSmoothingTargetRef.current = boundedTarget;
            const beforeScrollLeft = activeContainer.scrollLeft;
            const remaining = boundedTarget - beforeScrollLeft;
            const totalElapsed = wheelSmoothingStartedAtRef.current > 0
                ? now - wheelSmoothingStartedAtRef.current
                : 0;

            if (
                Math.abs(remaining) <= WHEEL_SMOOTHING_SETTLE_DISTANCE
                || totalElapsed >= WHEEL_SMOOTHING_MAX_DURATION_MS
            ) {
                activeContainer.scrollLeft = boundedTarget;
                stopWheelSmoothing();
                return;
            }

            activeContainer.scrollLeft += remaining * progress;
            const actualProgress = Math.abs(activeContainer.scrollLeft - beforeScrollLeft);
            if (actualProgress < WHEEL_SMOOTHING_MIN_PROGRESS) {
                activeContainer.scrollLeft = boundedTarget;
                stopWheelSmoothing();
                return;
            }

            wheelSmoothingRafRef.current = requestAnimationFrame(tick);
        };

        wheelSmoothingRafRef.current = requestAnimationFrame(tick);
    }, [stopWheelSmoothing]);

    const startMomentum = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container || Math.abs(momentumVelocityRef.current) < 0.5) return;

        let lastTime = performance.now();
        const friction = 0.80;

        const tick = (now: number) => {
            const elapsed = now - lastTime;
            lastTime = now;
            const frames = elapsed / 16.67;
            momentumVelocityRef.current *= Math.pow(friction, frames);

            if (Math.abs(momentumVelocityRef.current) < 0.5) {
                momentumVelocityRef.current = 0;
                momentumRafRef.current = null;
                return;
            }

            container.scrollLeft += momentumVelocityRef.current;
            momentumRafRef.current = requestAnimationFrame(tick);
        };

        momentumRafRef.current = requestAnimationFrame(tick);
    }, []);

    const stopKineticScroll = useCallback(() => {
        if (wheelIdleTimerRef.current) {
            clearTimeout(wheelIdleTimerRef.current);
            wheelIdleTimerRef.current = null;
        }
        stopWheelSmoothing();
        stopMomentum();
    }, [stopMomentum, stopWheelSmoothing]);

    const centerIndex = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
        if (index < 0 || index >= items.length) return;
        const container = scrollContainerRef.current;
        const flexWrapper = container?.firstElementChild;
        const cardElement = flexWrapper?.children[index] as HTMLElement | undefined;
        if (!container || !cardElement) return;

        const targetScrollLeft = cardElement.offsetLeft + cardElement.offsetWidth / 2 - container.clientWidth / 2;

        isProgrammaticScrollRef.current = true;
        programmaticTargetLeftRef.current = targetScrollLeft;
        if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = setTimeout(() => {
            isProgrammaticScrollRef.current = false;
            programmaticTargetLeftRef.current = null;
        }, 600);

        container.scrollTo({
            left: targetScrollLeft,
            behavior,
        });
    }, [items.length]);

    const scrollToIndex = useCallback((index: number) => {
        if (!isInteractive) return;
        stopKineticScroll();
        reportFocusedIndex(index);
        centerIndex(index);
    }, [centerIndex, isInteractive, reportFocusedIndex, stopKineticScroll]);

    useEffect(() => {
        if (items.length === 0) return;
        const nextIndex = clampFocusedIndex(focusedIndex, items.length);

        if (nextIndex !== focusedIndex) {
            onFocusedIndexChangeRef.current(nextIndex);
            return;
        }

        if (lastInternalFocusRef.current === nextIndex) {
            lastInternalFocusRef.current = null;
            requestAnimationFrame(() => updateCardTransforms());
            return;
        }

        requestAnimationFrame(() => {
            centerIndex(nextIndex, 'auto');
            updateCardTransforms();
        });
    }, [centerIndex, focusedIndex, items.length, itemsSignature, updateCardTransforms]);

    const handleScroll = useCallback(() => {
        if (!isInteractive) {
            updateCardTransforms();
            return;
        }

        const container = scrollContainerRef.current;
        if (!container) return;

        const closestIndex = updateCardTransforms();

        if (isProgrammaticScrollRef.current) {
            if (programmaticTargetLeftRef.current !== null) {
                const diff = Math.abs(container.scrollLeft - programmaticTargetLeftRef.current);
                if (diff < 3) {
                    isProgrammaticScrollRef.current = false;
                    programmaticTargetLeftRef.current = null;
                    if (programmaticScrollTimeoutRef.current) {
                        clearTimeout(programmaticScrollTimeoutRef.current);
                        programmaticScrollTimeoutRef.current = null;
                    }
                }
            } else {
                isProgrammaticScrollRef.current = false;
            }
            return;
        }

        if (closestIndex !== undefined) {
            reportFocusedIndex(closestIndex);
        }

        // Batch load: load more items when scrolling near the end
        const scrollThreshold = 600;
        const hasMore = visibleLimit < items.length;
        if (hasMore && container.scrollWidth - (container.scrollLeft + container.clientWidth) < scrollThreshold) {
            setVisibleLimit(prev => Math.min(items.length, prev + 30));
        }
    }, [isInteractive, reportFocusedIndex, updateCardTransforms, visibleLimit, items.length]);

    const handleMouseDown = (event: React.MouseEvent) => {
        if (!isInteractive || !scrollContainerRef.current || event.button !== 0) return;

        stopWheelSmoothing();
        stopMomentum();
        isDraggingRef.current = true;
        startXRef.current = event.pageX - scrollContainerRef.current.offsetLeft;
        scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
        dragDistanceRef.current = 0;
        lastDragScrollRef.current = scrollContainerRef.current.scrollLeft;
        lastDragTimeRef.current = performance.now();
    };

    const handleMouseMove = (event: React.MouseEvent) => {
        if (!isInteractive || !isDraggingRef.current || !scrollContainerRef.current) return;

        event.preventDefault();
        const x = event.pageX - scrollContainerRef.current.offsetLeft;
        const walk = (x - startXRef.current) * 1.5;
        dragDistanceRef.current = Math.abs(walk);

        scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
        const nowScroll = scrollContainerRef.current.scrollLeft;

        const now = performance.now();
        const dt = now - lastDragTimeRef.current;
        if (dt > 0) {
            momentumVelocityRef.current = (nowScroll - lastDragScrollRef.current) / dt * 16;
        }
        lastDragScrollRef.current = nowScroll;
        lastDragTimeRef.current = now;
    };

    const handleMouseUpOrLeave = () => {
        if (!isInteractive || !isDraggingRef.current) return;
        isDraggingRef.current = false;
        startMomentum();
    };

    useEffect(() => {
        if (!isInteractive) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLElement
                && (target.isContentEditable || Boolean(target.closest('button, input, select, textarea, a[href]')))
            ) {
                return;
            }

            if (event.key === 'Enter') {
                if (event.repeat || items.length === 0) return;
                event.preventDefault();
                const focusedItem = items[safeFocusedIndex];
                if (focusedItem) onSelect(focusedItem, safeFocusedIndex);
                return;
            }

            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
            }

            event.preventDefault();
            const now = performance.now();
            if (now - lastKeyboardNavTimeRef.current < 200) return;
            lastKeyboardNavTimeRef.current = now;
            scrollToIndex(event.key === 'ArrowLeft' ? safeFocusedIndex - 1 : safeFocusedIndex + 1);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isInteractive, items, onSelect, safeFocusedIndex, scrollToIndex]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || !isInteractive) return;

        const handleWheelEvent = (event: WheelEvent) => {
            event.preventDefault();

            stopMomentum();
            const wheelInput = resolveGrid3DWheelInput(
                event.deltaX,
                event.deltaY,
                event.deltaMode,
                container.clientWidth,
            );

            if (wheelInput.isDiscreteMouseWheel) {
                if (wheelIdleTimerRef.current) {
                    clearTimeout(wheelIdleTimerRef.current);
                    wheelIdleTimerRef.current = null;
                }
                smoothDiscreteWheelBy(wheelInput.delta);
                return;
            }

            stopWheelSmoothing();
            const scaled = wheelInput.delta * 0.6;
            container.scrollLeft += scaled;
            momentumVelocityRef.current = scaled;

            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
            wheelIdleTimerRef.current = setTimeout(() => {
                startMomentum();
            }, 80);
        };

        container.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheelEvent);
            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
        };
    }, [isInteractive, smoothDiscreteWheelBy, startMomentum, stopMomentum, stopWheelSmoothing]);

    // Repaints the transforms once the new layout is committed; `updateCardTransforms` decides on
    // its own whether the cached centers are still valid. `coverSize` / `edgePadding` are listed
    // because the floating player can change them without changing `containerSize`.
    useEffect(() => {
        const frameId = requestAnimationFrame(() => updateCardTransforms());
        return () => cancelAnimationFrame(frameId);
    }, [containerSize, coverSize, edgePadding, isLoading, itemsSignature, slicedItems.length, updateCardTransforms]);

    useEffect(() => {
        return () => {
            if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
            stopWheelSmoothing();
            stopMomentum();
        };
    }, [stopMomentum, stopWheelSmoothing]);

    return (
        <div ref={containerRef} className="w-full flex-1 flex flex-col justify-center relative min-h-0 select-none">
            <div
                ref={scrollContainerRef}
                data-grid3d-slider
                tabIndex={-1}
                onScroll={handleScroll}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave}
                onMouseLeave={handleMouseUpOrLeave}
                className={`w-full flex items-center overflow-x-auto overflow-y-hidden py-24 custom-scrollbar focus:outline-none ${
                    isInteractive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                }`}
                style={{ scrollbarWidth: 'none' }}
            >
                <div className="flex gap-12" style={{ paddingInline: edgePadding }}>
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, index) => (
                            <div key={`skeleton-${index}`} className="shrink-0 pointer-events-none select-none">
                                {grid3dCardStyle === 'image' ? (
                                    <div
                                        className="aspect-square rounded-2xl animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 border border-white/5 shadow-inner"
                                        style={{ width: coverSize, height: coverSize }}
                                    />
                                ) : (
                                    <div
                                        className="rounded-xl border border-white/5 p-4 flex flex-col items-center backdrop-blur-md shadow-lg"
                                        style={{ width: coverSize }}
                                    >
                                        <div className="w-full aspect-square rounded-lg animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 mb-4" />
                                        <div className="w-full text-left pt-2 space-y-2">
                                            <div className="h-4 w-3/4 animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 rounded-md" />
                                            <div className="h-3 w-1/2 animate-pulse bg-zinc-200/20 dark:bg-zinc-800/20 rounded-md" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    ) : items.length === 0 ? (
                        <div className="opacity-40 text-sm font-sans flex items-center justify-center w-[20vw] shrink-0 text-center">
                            {emptyMessage}
                        </div>
                    ) : (
                        slicedItems.map((item, index) => {
                            const isFocused = index === safeFocusedIndex;
                            const secondaryText = getGrid3DSliderSecondaryText(item);
                            const summaryText = getGrid3DSliderSummaryText(item);

                            return (
                                <div
                                    key={item.id}
                                    className="shrink-0 cursor-pointer pointer-events-auto select-none"
                                    onClick={() => {
                                        if (!isInteractive || dragDistanceRef.current >= 8) return;
                                        if (isFocused) {
                                            onSelect(item, index);
                                        } else {
                                            scrollToIndex(index);
                                        }
                                    }}
                                	>
                                    {grid3dCardStyle === 'image' ? (
                                        <div
                                            className={`aspect-square rounded-2xl overflow-hidden shadow-2xl relative border border-white/10 ${
                                                isFocused ? 'ring-2 ring-white/30' : ''
                                            }`}
                                            style={{ width: coverSize, height: coverSize }}
                                        >
                                            {item.coverUrl && loadedIndices.has(index) ? (
                                                <img src={item.coverUrl} alt={typeof item.name === 'string' ? item.name : ''} className="w-full h-full object-cover pointer-events-none select-none" />
                                            ) : (
                                                <div className="w-full h-full bg-zinc-800/20 flex items-center justify-center">
                                                    <Disc size={64} className="opacity-20" />
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
                                        </div>
                                    ) : (
                                        <div
                                            className="rounded-xl border p-4 flex flex-col items-center backdrop-blur-md shadow-lg hover:shadow-2xl theme-polaroid-card"
                                            style={{ width: coverSize }}
                                        >
                                            <div className="w-full aspect-square rounded-lg overflow-hidden bg-zinc-800/20 relative shadow-inner mb-4 flex items-center justify-center">
                                                {item.coverUrl && loadedIndices.has(index) ? (
                                                    <img src={item.coverUrl} alt={typeof item.name === 'string' ? item.name : ''} className="w-full h-full object-cover pointer-events-none select-none" />
                                                ) : (
                                                    <Disc size={64} className="opacity-20" />
                                                )}
                                            </div>

                                            <div className="w-full text-left pt-2 min-w-0">
                                                <h3 className="font-bold text-sm truncate max-w-full tracking-tight">
                                                    {item.name}
                                                </h3>
                                                {secondaryText && (
                                                    <p className="text-xs opacity-50 truncate max-w-full mt-1 font-medium">
                                                        {secondaryText}
                                                    </p>
                                                )}
                                                {summaryText && (
                                                    <p className="text-[10px] leading-snug opacity-45 mt-2 line-clamp-2">
                                                        {summaryText}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {!isLoading && items.length > 0 && items[safeFocusedIndex] && (
                <div
                    className={`relative shrink-0 text-center z-10 px-8 pointer-events-none ${
                        hasFloatingPlayer ? 'pt-6 md:pt-8 pb-0 -mb-4 md:-mb-6' : 'pt-5 md:pt-6 pb-4'
                    }`}
                >
                    <h3 className="font-bold text-2xl truncate max-w-xl mx-auto" style={{ color: 'var(--text-primary)' }}>
                        {items[safeFocusedIndex].name}
                    </h3>
                    <p className="text-xs opacity-50 font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {items[safeFocusedIndex].trackCount !== undefined ? `${items[safeFocusedIndex].trackCount} ${t('playlist.tracks') || 'songs'}` : ''}
                        {items[safeFocusedIndex].description ? ` • ${items[safeFocusedIndex].description}` : ''}
                    </p>
                </div>
            )}
        </div>
    );
};
