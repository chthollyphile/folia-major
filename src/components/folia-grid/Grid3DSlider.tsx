import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatGridMapFolderTitle } from '../../utils/gridMapFolderPath';
import { getSizedCoverUrl } from '../../utils/coverUrl';
import { useHomeLayoutSettingsStore } from '../../stores/useHomeLayoutSettingsStore';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';

// src/components/folia-grid/Grid3DSlider.tsx
// Controlled desktop Grid3D slider shared by Netease, local music, and Navidrome overview surfaces.

export interface Grid3DSliderItem {
    id: string | number;
    name: React.ReactNode;
    coverUrl?: string;
    description?: string;
    summary?: string;
    trackCount?: number;
    trackIds?: string[];
    type?: string;
    isVirtual?: boolean;
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

type Grid3DSliderTextItem = Pick<Grid3DSliderItem, 'type' | 'description' | 'summary'>
    & Partial<Pick<Grid3DSliderItem, 'name' | 'isVirtual'>>;

const getLocalFolderPath = (item: Grid3DSliderTextItem): string => (
    item.type === 'folder' && !item.isVirtual && typeof item.name === 'string'
        ? item.name
        : ''
);

export const getGrid3DSliderDisplayName = (
    item: Pick<Grid3DSliderItem, 'name' | 'type' | 'isVirtual'>,
): React.ReactNode => {
    const folderPath = getLocalFolderPath(item);
    return folderPath ? formatGridMapFolderTitle(folderPath) : item.name;
};

export const getGrid3DSliderSecondaryText = (
    item: Grid3DSliderTextItem,
): string => (
    getLocalFolderPath(item)
        || (item.type === 'playlist'
        ? compactDescription(item.summary) || compactDescription(item.description)
        : compactDescription(item.description) || compactDescription(item.summary))
);

export const getGrid3DSliderSummaryText = (
    item: Pick<Grid3DSliderItem, 'type' | 'description' | 'summary'>,
): string => {
    const summary = compactDescription(item.summary);
    return summary && summary !== getGrid3DSliderSecondaryText(item) ? summary : '';
};

const DISCRETE_WHEEL_PIXEL_THRESHOLD = 40;
const DISCRETE_WHEEL_DISTANCE_MULTIPLIER = 3;
const GRID3D_CARD_GAP = 48;
export const GRID3D_WINDOW_RADIUS = 18;
export const GRID3D_LEAP_CARDS = 4;
const PROGRAMMATIC_SCROLL_SETTLE_PX = 3;
const PROGRAMMATIC_SCROLL_TIMEOUT_MS = 600;
const PROGRAMMATIC_SCROLL_IDLE_TIMEOUT_MS = 250;
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
 * Serializes item IDs safely to prevent collision when IDs contain commas (e.g. folder paths).
 */
export const getGrid3DItemsSignature = (items: { id: string | number }[]): string =>
    JSON.stringify(items.map(item => String(item.id)));

/**
 * Calculates clamped target scrollLeft to center the card at the given index.
 */
export const getGrid3DTargetScrollLeft = (
    index: number,
    containerWidth: number,
    scrollWidth: number,
    cardPitch: number,
    coverSize: number,
    edgePadding: number,
): number => {
    const maxScrollLeft = Math.max(0, scrollWidth - containerWidth);
    const rawTarget = edgePadding + index * cardPitch + coverSize / 2 - containerWidth / 2;
    return Math.max(0, Math.min(maxScrollLeft, rawTarget));
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

export const getGrid3DWindowRange = (
    focusedIndex: number,
    itemCount: number,
    radius = GRID3D_WINDOW_RADIUS,
): { start: number; end: number } => {
    const safeIndex = clampFocusedIndex(focusedIndex, itemCount);
    return {
        start: Math.max(0, safeIndex - radius),
        end: Math.min(itemCount, safeIndex + radius + 1),
    };
};

export type Grid3DTransitionMode = 'none' | 'direct' | 'leap';

/**
 * Resolves the transition mode for external focus changes:
 * - 'none': Immediate jump (list change, same index, or reduced motion).
 * - 'direct': Continuous smooth scroll within the rendered window radius.
 * - 'leap': Distant jump that stages cards near the destination before smoothly gliding in.
 */
export const resolveGrid3DTransitionMode = ({
    isListChanged,
    prevIndex,
    nextIndex,
    reduceMicroMotion = false,
}: {
    isListChanged: boolean;
    prevIndex: number;
    nextIndex: number;
    reduceMicroMotion?: boolean;
}): Grid3DTransitionMode => {
    if (reduceMicroMotion || isListChanged || prevIndex === nextIndex) {
        return 'none';
    }
    if (Math.abs(nextIndex - prevIndex) <= GRID3D_WINDOW_RADIUS) {
        return 'direct';
    }
    return 'leap';
};

/**
 * Resolves staging index and scroll direction for leap transitions.
 */
export const resolveGrid3DLeapPlan = ({
    prevIndex,
    nextIndex,
    itemCount,
    leapCards = GRID3D_LEAP_CARDS,
}: {
    prevIndex: number;
    nextIndex: number;
    itemCount: number;
    leapCards?: number;
}): { direction: number; stagingIndex: number } => {
    const direction = Math.sign(nextIndex - prevIndex);
    const stagingIndex = clampFocusedIndex(nextIndex - direction * leapCards, itemCount);
    return { direction, stagingIndex };
};

export const Grid3DSlider: React.FC<Grid3DSliderProps> = ({
    items,
    focusedIndex,
    onFocusedIndexChange,
    onSelect,
    isInteractive = true,
    isLoading = false,
    emptyMessage,
    isDaylight,
    hasFloatingPlayer = false,
}) => {
    const { t } = useTranslation();
    const grid3dCardStyle = useHomeLayoutSettingsStore(state => state.grid3dCardStyle);
    const reduceMicroMotion = useReducedMotionFor('uiMicroMotion');

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onFocusedIndexChangeRef = useRef(onFocusedIndexChange);
    const focusedIndexRef = useRef(focusedIndex);
    const lastInternalFocusRef = useRef<number | null>(null);
    const prevItemsSignatureRef = useRef<string | null>(null);
    const prevFocusedIndexRef = useRef(focusedIndex);
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
    const itemsSignature = useMemo(() => getGrid3DItemsSignature(items), [items]);

    const loadedIndices = useMemo(() => {
        const indexes = new Set<number>();
        const start = Math.max(0, safeFocusedIndex - 12);
        const end = Math.min(items.length - 1, safeFocusedIndex + 12);
        for (let index = start; index <= end; index += 1) indexes.add(index);
        return indexes;
    }, [items.length, safeFocusedIndex]);

    const { start: windowStart, end: windowEnd } = getGrid3DWindowRange(safeFocusedIndex, items.length);
    const windowedItems = items.slice(windowStart, windowEnd);
    const cardPitch = coverSize + GRID3D_CARD_GAP;
    const leadingSpacerWidth = windowStart * cardPitch;
    const remainingItemCount = items.length - windowEnd;
    const trailingSpacerWidth = remainingItemCount > 0
        ? remainingItemCount * coverSize + Math.max(0, remainingItemCount - 1) * GRID3D_CARD_GAP
        : 0;

    const updateCardTransforms = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return undefined;
        const maxDist = 600;
        const isImage = grid3dCardStyle === 'image';
        const peakScale = isImage ? 1.25 : 1.2;
        const minScale = 0.5;
        const cards = container.querySelectorAll<HTMLElement>('[data-grid3d-index]');
        const viewportWidth = container.clientWidth;
        const containerCenter = container.scrollLeft + viewportWidth / 2;
        const closestIndex = clampFocusedIndex(
            Math.round((containerCenter - edgePadding - coverSize / 2) / cardPitch),
            items.length,
        );
        for (let i = 0; i < cards.length; i++) {
            const el = cards[i];
            const itemIndex = Number(el.dataset.grid3dIndex);
            const cardCenter = edgePadding + itemIndex * cardPitch + coverSize / 2;
            const pixelDist = Math.abs(cardCenter - containerCenter);
            const tValue = Math.min(pixelDist / maxDist, 1);

            const scale = peakScale - (peakScale - minScale) * tValue;
            const opacity = Math.max(0.15, 1.0 - 0.85 * tValue);
            const y = -6 * (1 - tValue);
            const z = Math.max(1, Math.round(10 - 9 * tValue));

            el.style.transform = `scale(${scale}) translateY(${y}px)`;
            el.style.opacity = String(opacity);
            el.style.zIndex = String(z);
        }

        return closestIndex;
    }, [cardPitch, coverSize, edgePadding, grid3dCardStyle, items.length]);

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

    const clearProgrammaticScrollState = useCallback(() => {
        isProgrammaticScrollRef.current = false;
        programmaticTargetLeftRef.current = null;
        if (programmaticScrollTimeoutRef.current) {
            clearTimeout(programmaticScrollTimeoutRef.current);
            programmaticScrollTimeoutRef.current = null;
        }
    }, []);

    const armProgrammaticScrollTimeout = useCallback((timeoutMs: number) => {
        if (programmaticScrollTimeoutRef.current) {
            clearTimeout(programmaticScrollTimeoutRef.current);
        }
        programmaticScrollTimeoutRef.current = setTimeout(() => {
            clearProgrammaticScrollState();
        }, timeoutMs);
    }, [clearProgrammaticScrollState]);

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
        if (!container) return;

        const targetScrollLeft = getGrid3DTargetScrollLeft(
            index,
            container.clientWidth,
            container.scrollWidth,
            cardPitch,
            coverSize,
            edgePadding,
        );

        isProgrammaticScrollRef.current = true;
        programmaticTargetLeftRef.current = targetScrollLeft;
        armProgrammaticScrollTimeout(PROGRAMMATIC_SCROLL_TIMEOUT_MS);

        container.scrollTo({
            left: targetScrollLeft,
            behavior,
        });
    }, [armProgrammaticScrollTimeout, cardPitch, coverSize, edgePadding, items.length]);

    const scrollToIndex = useCallback((index: number) => {
        if (!isInteractive) return;
        stopKineticScroll();
        reportFocusedIndex(index);
        centerIndex(index, 'smooth');
    }, [centerIndex, isInteractive, reportFocusedIndex, stopKineticScroll]);

    useEffect(() => {
        if (isLoading || items.length === 0) return;
        const nextIndex = clampFocusedIndex(focusedIndex, items.length);

        if (nextIndex !== focusedIndex) {
            onFocusedIndexChangeRef.current(nextIndex);
            return;
        }

        const isListChanged = prevItemsSignatureRef.current !== itemsSignature;
        const prevIndex = prevFocusedIndexRef.current;

        prevItemsSignatureRef.current = itemsSignature;
        prevFocusedIndexRef.current = nextIndex;

        if (lastInternalFocusRef.current === nextIndex) {
            lastInternalFocusRef.current = null;
            const frameId = requestAnimationFrame(() => updateCardTransforms());
            return () => cancelAnimationFrame(frameId);
        }

        const transitionMode = resolveGrid3DTransitionMode({
            isListChanged,
            prevIndex,
            nextIndex,
            reduceMicroMotion,
        });

        const frameId = requestAnimationFrame(() => {
            if (transitionMode === 'leap') {
                const { stagingIndex } = resolveGrid3DLeapPlan({
                    prevIndex,
                    nextIndex,
                    itemCount: items.length,
                });
                centerIndex(stagingIndex, 'auto');
                updateCardTransforms();
                centerIndex(nextIndex, 'smooth');
            } else {
                centerIndex(nextIndex, transitionMode === 'direct' ? 'smooth' : 'auto');
                updateCardTransforms();
            }
        });
        return () => cancelAnimationFrame(frameId);
    }, [centerIndex, focusedIndex, isLoading, items.length, itemsSignature, reduceMicroMotion, updateCardTransforms]);

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
                if (diff < PROGRAMMATIC_SCROLL_SETTLE_PX) {
                    clearProgrammaticScrollState();
                } else {
                    // 原生平滑滚动仍在活跃推进中：通过空闲看门狗续期抑制窗口，防止远距离平滑滚动超过初始超时而提前上报中间焦点。
                    // 只要浏览器仍在触发 scroll 事件朝目标推进就持续抑制；若滚动停止或卡死，将在空闲超时后兜底恢复。
                    armProgrammaticScrollTimeout(PROGRAMMATIC_SCROLL_IDLE_TIMEOUT_MS);
                }
            } else {
                clearProgrammaticScrollState();
            }
            return;
        }

        if (closestIndex !== undefined) {
            reportFocusedIndex(closestIndex);
        }

    }, [armProgrammaticScrollTimeout, clearProgrammaticScrollState, isInteractive, reportFocusedIndex, updateCardTransforms]);

    const handleMouseDown = (event: React.MouseEvent) => {
        if (!isInteractive || !scrollContainerRef.current || event.button !== 0) return;

        // 用户主动拖拽接管滚动，解除程序化滚动的抑制并恢复焦点实时上报，避免拖拽打断期间焦点被卡住。
        clearProgrammaticScrollState();
        stopKineticScroll();
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

            // 用户滚轮主动接管滚动，解除程序化抑制并打断惯性滚动。
            clearProgrammaticScrollState();
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
    }, [clearProgrammaticScrollState, isInteractive, smoothDiscreteWheelBy, startMomentum, stopMomentum, stopWheelSmoothing]);

    // Repaints the fixed card window after layout or focus changes.
    useEffect(() => {
        const frameId = requestAnimationFrame(() => updateCardTransforms());
        return () => cancelAnimationFrame(frameId);
    }, [containerSize, coverSize, edgePadding, isLoading, itemsSignature, windowStart, windowedItems.length, updateCardTransforms]);

    useEffect(() => {
        return () => {
            clearProgrammaticScrollState();
            stopKineticScroll();
        };
    }, [clearProgrammaticScrollState, stopKineticScroll]);

    const focusedItem = items[safeFocusedIndex];
    const focusedDisplayName = focusedItem ? getGrid3DSliderDisplayName(focusedItem) : '';
    const focusedSecondaryText = focusedItem ? getGrid3DSliderSecondaryText(focusedItem) : '';

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
                <div className="flex" style={{ paddingInline: edgePadding }}>
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
                            {emptyMessage || t('ui.noItemsFound')}
                        </div>
                    ) : (
                        <>
                        {leadingSpacerWidth > 0 && (
                            <div aria-hidden="true" className="shrink-0" style={{ width: leadingSpacerWidth }} />
                        )}
                        {windowedItems.map((item, localIndex) => {
                            const index = windowStart + localIndex;
                            const isFocused = index === safeFocusedIndex;
                            const folderPath = getLocalFolderPath(item);
                            const displayName = getGrid3DSliderDisplayName(item);
                            const secondaryText = getGrid3DSliderSecondaryText(item);
                            const summaryText = getGrid3DSliderSummaryText(item);

                            return (
                                <div
                                    key={item.id}
                                    data-grid3d-index={index}
                                    className="shrink-0 cursor-pointer pointer-events-auto select-none"
                                    style={{ marginRight: index < items.length - 1 ? GRID3D_CARD_GAP : 0 }}
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
                                                <img src={getSizedCoverUrl(item.coverUrl, coverSize)} alt={typeof displayName === 'string' ? displayName : ''} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none select-none" />
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
                                                    <img src={getSizedCoverUrl(item.coverUrl, coverSize)} alt={typeof displayName === 'string' ? displayName : ''} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none select-none" />
                                                ) : (
                                                    <Disc size={64} className="opacity-20" />
                                                )}
                                            </div>

                                            <div className="w-full text-left pt-2 min-w-0">
                                                <h3 className="font-bold text-sm truncate max-w-full tracking-tight">
                                                    {displayName}
                                                </h3>
                                                {secondaryText && (
                                                    <p
                                                        className={`text-xs opacity-50 max-w-full mt-1 font-medium ${folderPath ? 'line-clamp-2 break-words' : 'truncate'}`}
                                                        title={folderPath || undefined}
                                                    >
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
                        })}
                        {trailingSpacerWidth > 0 && (
                            <div aria-hidden="true" className="shrink-0" style={{ width: trailingSpacerWidth }} />
                        )}
                        </>
                    )}
                </div>
            </div>

            {!isLoading && focusedItem && (
                <div
                    className={`relative shrink-0 text-center z-10 px-8 pointer-events-none ${
                        hasFloatingPlayer ? 'pt-6 md:pt-8 pb-0 -mb-4 md:-mb-6' : 'pt-5 md:pt-6 pb-4'
                    }`}
                >
                    <h3 className="font-bold text-2xl truncate max-w-xl mx-auto" style={{ color: 'var(--text-primary)' }}>
                        {focusedDisplayName}
                    </h3>
                    <p className="text-xs opacity-50 font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {focusedItem.trackCount !== undefined ? `${focusedItem.trackCount} ${t('playlist.tracks') || 'songs'}` : ''}
                        {focusedSecondaryText ? ` • ${focusedSecondaryText}` : ''}
                    </p>
                </div>
            )}
        </div>
    );
};
