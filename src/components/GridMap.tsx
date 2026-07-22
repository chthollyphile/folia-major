import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { motion, useMotionValue, animate, AnimatePresence, useDragControls } from 'framer-motion';
import { ChevronLeft, Disc, Eye, EyeOff, ListFilter, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Theme } from '../types';
import { useFoliaHexViewport } from './folia-grid/useFoliaHexViewport';
import { SidePanelList, CollectionListItem } from './shared/SidePanelList';
import { GridListSearchButton } from './shared/GridListSearchButton';
import { gridSearchPanelMotion } from './shared/gridSearchPanelMotion';
import {
    resolveGridMapDisplayIndex,
    resolveGridMapSourceIndex,
    shouldSuppressGridMapSelection,
} from './folia-grid/gridMapNavigation';

// src/components/GridMap.tsx
// Hexagonal honeycomb layout showing all collections (playlists, albums, radios).
// Click on any collection card to select it and jump/center to it in Grid3D view.

export interface GridMapItem {
    id: string | number;
    name: string;
    coverUrl?: string;
    description?: string;
    summary?: string;
    type?: string;
    rawCollection?: any;
}

interface GridMapProps {
    title: string;
    subtitle?: string;
    items: GridMapItem[];
    initialFocusedIndex?: number;
    onBack: () => void;
    onSelectCollection: (collection: any, index: number) => void;
    theme: Theme;
    isDaylight: boolean;
    isPlaylistHidden?: (item: GridMapItem) => boolean;
    onTogglePlaylistHidden?: (item: GridMapItem) => void;
}

const compactDescription = (description?: string, maxLength = 72) => {
    if (!description) return '';
    const normalized = description.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
};

/**
 * Renders a simplified polaroid-style card representing a collection.
 * Designed to be clicked to immediately select and center the item.
 */
const MapCard = React.memo<{
    item: GridMapItem;
    isDaylight: boolean;
    onSelect: () => void;
    isPlaylistEditMode: boolean;
    isHidden: boolean;
    onTogglePlaylistHidden?: () => void;
    cardWidth: number;
    cardHeight: number;
}>(
    ({
        item,
        isDaylight,
        onSelect,
        isPlaylistEditMode,
        isHidden,
        onTogglePlaylistHidden,
        cardWidth,
        cardHeight,
    }) => {
        const { t } = useTranslation();
        const isPlaylistSelectionDisabled = isPlaylistEditMode && item.type === 'playlist';

        return (
            <div
                className={`rounded-xl p-3 flex flex-col items-center border backdrop-blur-md transition-shadow duration-300 shadow-lg theme-polaroid-card ${
                    isPlaylistSelectionDisabled ? 'cursor-default' : 'cursor-pointer hover:shadow-2xl'
                }`}
                style={{
                    width: cardWidth,
                    minHeight: cardHeight,
                    height: 'auto',
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isPlaylistSelectionDisabled) onSelect();
                }}
            >
                {/* Square Polaroid Photo Area */}
                <div className="w-full aspect-square rounded-lg overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60 relative shadow-inner flex items-center justify-center shrink-0">
                    {item.coverUrl ? (
                        <>
                            <img
                                src={item.coverUrl}
                                alt={item.name}
                                loading="lazy"
                                decoding="async"
                                ref={(el) => {
                                    if (el && el.complete) {
                                        el.style.opacity = '1';
                                        const placeholder = el.nextElementSibling as HTMLElement;
                                        if (placeholder) {
                                            placeholder.style.opacity = '0';
                                            placeholder.style.display = 'none';
                                        }
                                    }
                                }}
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    img.style.opacity = '1';
                                    const placeholder = img.nextElementSibling as HTMLElement;
                                    if (placeholder) {
                                        placeholder.style.opacity = '0';
                                        setTimeout(() => {
                                            placeholder.style.display = 'none';
                                        }, 350);
                                    }
                                }}
                                className="w-full h-full object-cover transition-opacity duration-350 pointer-events-none select-none opacity-0"
                            />
                            <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 transition-opacity duration-350 flex items-center justify-center">
                                <Disc size={48} className="opacity-20 animate-spin" style={{ animationDuration: '3s', color: 'var(--text-primary)' }} />
                            </div>
                        </>
                    ) : (
                        <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 flex items-center justify-center">
                            <Disc size={48} className="opacity-20" style={{ color: 'var(--text-primary)' }} />
                        </div>
                    )}
                    {isPlaylistEditMode && item.type === 'playlist' && onTogglePlaylistHidden && (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onTogglePlaylistHidden();
                            }}
                            className={`absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 shadow-lg backdrop-blur-md transition-transform hover:scale-105 active:scale-95 ${
                                isHidden ? 'bg-red-500/80 text-white' : 'bg-black/45 text-white'
                            }`}
                            title={t(isHidden ? 'home.showPlaylist' : 'home.hidePlaylist')}
                        >
                            {isHidden ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                    )}
                </div>

                {/* Bottom Polaroid Frame Label Details */}
                <div className="w-full flex-1 flex flex-col justify-between pt-3 text-left min-w-0">
                    <div className="space-y-1 mb-2">
                        <div className="text-xs font-bold tracking-tight opacity-90 max-w-full line-clamp-2 whitespace-normal break-words">
                            {item.name}
                        </div>
                        {item.description && (
                            <div className="text-[10px] opacity-55 max-w-full font-medium line-clamp-1 whitespace-normal break-words">
                                {item.description}
                            </div>
                        )}
                        {compactDescription(item.summary) && (
                            <div className="text-[10px] leading-snug opacity-45 max-w-full font-medium line-clamp-2 whitespace-normal break-words">
                                {compactDescription(item.summary)}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    },
    (prev, next) => {
        return (
            prev.item.id === next.item.id &&
            prev.item.name === next.item.name &&
            prev.item.coverUrl === next.item.coverUrl &&
            prev.item.description === next.item.description &&
            prev.item.summary === next.item.summary &&
            prev.item.type === next.item.type &&
            prev.isDaylight === next.isDaylight &&
            prev.isPlaylistEditMode === next.isPlaylistEditMode &&
            prev.isHidden === next.isHidden &&
            prev.onTogglePlaylistHidden === next.onTogglePlaylistHidden &&
            prev.cardWidth === next.cardWidth &&
            prev.cardHeight === next.cardHeight &&
            prev.onSelect === next.onSelect
        );
    }
);

export const GridMap: React.FC<GridMapProps> = ({
    title,
    subtitle,
    items = [],
    initialFocusedIndex = 0,
    onBack,
    onSelectCollection,
    theme,
    isDaylight,
    isPlaylistHidden = () => false,
    onTogglePlaylistHidden,
}) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const dragControls = useDragControls();
    const [focusedIndex, setFocusedIndex] = useState(0);
    const initialFocusedItemRef = useRef<GridMapItem | undefined>(items[initialFocusedIndex]);
    const focusedIndexRef = useRef(0);
    const lastUpdateRef = useRef(0);
    const pendingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const suppressSelectionRef = useRef(false);
    const wheelTargetRef = useRef({ x: 0, y: 0 });

    const [showSearchPanel, setShowSearchPanel] = useState(false);
    const [draftSearchQuery, setDraftSearchQuery] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const isComposingSearchRef = useRef(false);

    const [showSidePanel, setShowSidePanel] = useState(false);
    const [showCutInPanel, setShowCutInPanel] = useState(false);
    const [isPlaylistEditMode, setIsPlaylistEditMode] = useState(false);
    const [showHiddenPlaylistsOnly, setShowHiddenPlaylistsOnly] = useState(false);
    const hasPlaylistItems = useMemo(() => items.some(item => item.type === 'playlist'), [items]);

    const selectDisplayedItem = useCallback((item: GridMapItem, displayIndex: number) => {
        const sourceIndex = resolveGridMapSourceIndex(items, item, displayIndex);
        onSelectCollection(item.rawCollection || item, sourceIndex);
    }, [items, onSelectCollection]);

    useEffect(() => {
        if (!showSearchPanel) return;
        const id = requestAnimationFrame(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.setSelectionRange(draftSearchQuery.length, draftSearchQuery.length);
        });
        return () => cancelAnimationFrame(id);
    }, [draftSearchQuery.length, showSearchPanel]);

    useEffect(() => {
        const handleSearchTyping = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                if (event.key === 'Escape' && showSearchPanel) {
                    setShowSearchPanel(false);
                    setDraftSearchQuery('');
                    setSearchQuery('');
                }
                return;
            }

            if (event.key === '/' || (event.ctrlKey && event.key === 'f') || (event.metaKey && event.key === 'f')) {
                event.preventDefault();
                setShowSearchPanel(true);
                return;
            }

            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                setShowSearchPanel(true);
            }
        };

        window.addEventListener('keydown', handleSearchTyping);
        return () => window.removeEventListener('keydown', handleSearchTyping);
    }, [showSearchPanel]);

    const visibleItems = useMemo(() => {
        if (isPlaylistEditMode && showHiddenPlaylistsOnly) {
            return items.filter(item => item.type === 'playlist' && isPlaylistHidden(item));
        }

        return isPlaylistEditMode
            ? items
            : items.filter(item => item.type !== 'playlist' || !isPlaylistHidden(item));
    }, [isPlaylistEditMode, isPlaylistHidden, items, showHiddenPlaylistsOnly]);

    const displayItems = useMemo(() => {
        const query = deferredSearchQuery.trim().toLowerCase();
        if (!query) return visibleItems;

        return visibleItems.filter(item => {
            return (
                item.name?.toLowerCase().includes(query) ||
                item.description?.toLowerCase().includes(query) ||
                item.summary?.toLowerCase().includes(query)
            );
        });
    }, [visibleItems, deferredSearchQuery]);

    const togglePlaylistEditMode = useCallback(() => {
        setIsPlaylistEditMode(previous => {
            const next = !previous;
            if (!next) setShowHiddenPlaylistsOnly(false);
            return next;
        });
    }, []);

    const closeCutInPanel = useCallback(() => {
        setShowCutInPanel(false);
        setIsPlaylistEditMode(false);
        setShowHiddenPlaylistsOnly(false);
    }, []);

    // Track responsive container size to scale grid card dimensions dynamically
    const [containerSize, setContainerSize] = useState(() => {
        if (typeof window === 'undefined') {
            return { width: 0, height: 0 };
        }
        return { width: window.innerWidth, height: window.innerHeight };
    });

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

        const observer = new ResizeObserver(() => {
            updateContainerSize();
        });
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    // Layout values for different container size breakpoints
    const layoutConfig = useMemo(() => {
        const width = containerSize.width;
        if (width < 768) {
            return {
                cardWidth: 180,
                cardHeight: 250,
                spacingX: 205,
                spacingY: 240,
                maxDistance: 420,
            };
        } else if (width < 1440) {
            return {
                cardWidth: 220,
                cardHeight: 290,
                spacingX: 250,
                spacingY: 280,
                maxDistance: 500,
            };
        } else if (width < 2000) {
            return {
                cardWidth: 250,
                cardHeight: 330,
                spacingX: 285,
                spacingY: 320,
                maxDistance: 580,
            };
        } else {
            return {
                cardWidth: 280,
                cardHeight: 370,
                spacingX: 320,
                spacingY: 360,
                maxDistance: 660,
            };
        }
    }, [containerSize.width]);

    // Dynamically calculate visible clipping radius centered on (0,0) viewport coordinates
    const clipRadius = useMemo(() => {
        const { width, height } = containerSize;
        const { cardWidth, cardHeight } = layoutConfig;
        const viewportRadius = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
        const cardRadius = Math.sqrt(cardWidth ** 2 + cardHeight ** 2) / 2;
        return viewportRadius + cardRadius + 200;
    }, [containerSize, layoutConfig]);

    const renderRadius = useMemo(() => (
        clipRadius + Math.max(layoutConfig.spacingX, layoutConfig.spacingY) * 1.5
    ), [clipRadius, layoutConfig.spacingX, layoutConfig.spacingY]);

    const renderRing = useMemo(() => (
        Math.ceil(renderRadius / Math.min(layoutConfig.spacingX, layoutConfig.spacingY)) + 1
    ), [layoutConfig.spacingX, layoutConfig.spacingY, renderRadius]);

    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    // Synchronize programmatic drag shifts with the scroll position tracker
    useEffect(() => {
        const syncWheelTarget = () => {
            wheelTargetRef.current = { x: dragX.get(), y: dragY.get() };
        };
        const unsubX = dragX.on('change', syncWheelTarget);
        const unsubY = dragY.on('change', syncWheelTarget);
        return () => {
            unsubX();
            unsubY();
        };
    }, [dragX, dragY]);



    useEffect(() => {
        focusedIndexRef.current = focusedIndex;
    }, [focusedIndex]);

    const {
        coords: baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
    } = useFoliaHexViewport({
        itemCount: displayItems.length,
        spacingX: layoutConfig.spacingX,
        spacingY: layoutConfig.spacingY,
        renderRadius,
        renderRing,
        fallbackIndexRef: focusedIndexRef,
    });

    const dragBounds = useMemo(() => {
        if (baseCoords.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        baseCoords.forEach((c) => {
            if (c.baseX < minX) minX = c.baseX;
            if (c.baseX > maxX) maxX = c.baseX;
            if (c.baseY < minY) minY = c.baseY;
            if (c.baseY > maxY) maxY = c.baseY;
        });

        const bufferX = Math.max(0, containerSize.width / 2 - 2 * layoutConfig.spacingX);
        const bufferY = Math.max(0, containerSize.height / 2 - 2 * layoutConfig.spacingY);

        return {
            left: -maxX - bufferX,
            right: -minX + bufferX,
            top: -maxY - bufferY,
            bottom: -minY + bufferY,
        };
    }, [baseCoords, layoutConfig, containerSize]);

    // Handles mouse wheel events and animates viewport translation offsets
    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (displayItems.length === 0 || event.ctrlKey) return;

        event.preventDefault();
        const deltaScale = (event.deltaMode === 1
            ? 32
            : event.deltaMode === 2
                ? Math.max(containerSize.height, 1)
                : 1) * 2.8;
        const horizontalDelta = event.shiftKey && Math.abs(event.deltaX) < 1
            ? event.deltaY
            : event.deltaX;
        const verticalDelta = event.shiftKey && Math.abs(event.deltaX) < 1
            ? 0
            : event.deltaY;

        const targetX = wheelTargetRef.current.x - horizontalDelta * deltaScale;
        const targetY = wheelTargetRef.current.y - verticalDelta * deltaScale;
        const clampedX = Math.max(dragBounds.left, Math.min(dragBounds.right, targetX));
        const clampedY = Math.max(dragBounds.top, Math.min(dragBounds.bottom, targetY));
        wheelTargetRef.current = { x: clampedX, y: clampedY };

        animate(dragX, clampedX, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
        animate(dragY, clampedY, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
    }, [containerSize.height, dragX, dragY, items.length, dragBounds]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        element.addEventListener('wheel', handleViewportWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleViewportWheel);
    }, [handleViewportWheel]);

    // Keep the active focusedIndex centered when baseCoords changes on resize
    useEffect(() => {
        if (baseCoords.length > 0 && focusedIndex >= 0 && focusedIndex < baseCoords.length) {
            const targetX = -baseCoords[focusedIndex].baseX;
            const targetY = -baseCoords[focusedIndex].baseY;
            dragX.set(targetX);
            dragY.set(targetY);
            updateRenderedIndexesForViewport(targetX, targetY, true);
        }
    }, [baseCoords, updateRenderedIndexesForViewport]);

    /**
     * Recenter the honeycomb grid viewport on target item coordinate offset.
     */
    const centerOnIndex = (index: number, snap = true) => {
        if (index < 0 || index >= baseCoords.length) return;
        const targetX = -baseCoords[index].baseX;
        const targetY = -baseCoords[index].baseY;

        if (pendingTimeoutRef.current) {
            clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
        setFocusedIndex(index);
        focusedIndexRef.current = index;
        lastUpdateRef.current = performance.now();
        updateRenderedIndexesForViewport(targetX, targetY, true);

        if (snap) {
            animate(dragX, targetX, { type: 'spring', stiffness: 220, damping: 28 });
            animate(dragY, targetY, { type: 'spring', stiffness: 220, damping: 28 });
        } else {
            dragX.set(targetX);
            dragY.set(targetY);
        }
    };

    // Restore the source Grid3D focus when opening the map, or use the first filtered result.
    useEffect(() => {
        if (displayItems.length > 0) {
            centerOnIndex(
                resolveGridMapDisplayIndex(displayItems, initialFocusedItemRef.current),
                false,
            );
        }
    }, [displayItems.length, deferredSearchQuery]);

    useEffect(() => {
        updateRenderedIndexesForViewport(dragX.get(), dragY.get(), true);
    }, [dragX, dragY, updateRenderedIndexesForViewport]);

    const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

    const memoizedCards = useMemo(() => {
        return renderedIndexes.map((idx) => {
            const item = displayItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialCenterX = coord.baseX + initialDx;
            const initialCenterY = coord.baseY + initialDy;
            const initialDist = Math.sqrt(initialCenterX * initialCenterX + initialCenterY * initialCenterY);
            const initialT = Math.min(initialDist / layoutConfig.maxDistance, 1);
            const initialScale = 1.1 - 0.65 * initialT;
            const initialOpacity = 1.0 - 0.72 * initialT;
            const initialZ = Math.round(50 - 49 * initialT);

            return (
                <div
                    key={`map-${idx}-${item.id}`}
                    ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                    className="absolute select-none pointer-events-auto"
                    style={{
                        transformOrigin: 'center center',
                        willChange: 'transform, opacity',
                        display: initialDist > clipRadius ? 'none' : undefined,
                        transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                        opacity: initialDist > clipRadius ? 0 : initialOpacity,
                        zIndex: initialZ,
                    }}
                >
                    <MapCard
                        item={item}
                        isDaylight={isDaylight}
                        isPlaylistEditMode={isPlaylistEditMode}
                        isHidden={isPlaylistHidden(item)}
                        onTogglePlaylistHidden={item.type === 'playlist' && onTogglePlaylistHidden
                            ? () => onTogglePlaylistHidden(item)
                            : undefined}
                        cardWidth={layoutConfig.cardWidth}
                        cardHeight={layoutConfig.cardHeight}
                        onSelect={() => {
                            if (isPlaylistEditMode && item.type === 'playlist') return;
                            if (suppressSelectionRef.current) return;
                            selectDisplayedItem(item, idx);
                        }}
                    />
                </div>
            );
        });
    }, [
        renderedIndexes,
        displayItems,
        baseCoords,
        isDaylight,
        isPlaylistEditMode,
        isPlaylistHidden,
        onTogglePlaylistHidden,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        layoutConfig.maxDistance,
        clipRadius,
        selectDisplayedItem,
    ]);

    useEffect(() => {
        return () => {
            if (pendingTimeoutRef.current) {
                clearTimeout(pendingTimeoutRef.current);
            }
        };
    }, []);

    /**
     * Centralized animation frame callback that coordinates translation,
     * scaling, opacity, and layering of all honeycomb grid cards dynamically.
     */
    useEffect(() => {
        let rafId: number | null = null;

        const updateFocusedIndexThrottled = (newIndex: number) => {
            if (pendingTimeoutRef.current) {
                clearTimeout(pendingTimeoutRef.current);
                pendingTimeoutRef.current = null;
            }

            const now = performance.now();
            const timeSinceLast = now - lastUpdateRef.current;

            if (timeSinceLast >= 200) {
                setFocusedIndex(newIndex);
                focusedIndexRef.current = newIndex;
                lastUpdateRef.current = now;
            } else {
                const remaining = 200 - timeSinceLast;
                pendingTimeoutRef.current = setTimeout(() => {
                    setFocusedIndex(newIndex);
                    focusedIndexRef.current = newIndex;
                    lastUpdateRef.current = performance.now();
                }, remaining);
            }
        };

        const update = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const dx = dragX.get();
                const dy = dragY.get();
                const { maxDistance } = layoutConfig;
                updateRenderedIndexesForViewport(dx, dy);

                let closestIdx = focusedIndexRef.current;
                let minDistSq = Infinity;
                const activeIndexes = renderedIndexesRef.current;

                for (let activeIndex = 0; activeIndex < activeIndexes.length; activeIndex++) {
                    const i = activeIndexes[activeIndex];
                    const coord = baseCoords[i];
                    if (!coord) continue;
                    const cx = coord.baseX + dx;
                    const cy = coord.baseY + dy;
                    const distSq = cx * cx + cy * cy;

                    if (distSq < minDistSq) {
                        minDistSq = distSq;
                        closestIdx = i;
                    }

                    const el = cardWrapperRefs.current[i];
                    if (!el) continue;

                    const dist = Math.sqrt(distSq);

                    if (dist > clipRadius) {
                        el.style.display = 'none';
                        continue;
                    }

                    el.style.display = '';
                    const t = Math.min(dist / maxDistance, 1);
                    const scale = 1.1 - 0.65 * t;
                    const opac = 1.0 - 0.72 * t;
                    const z = Math.round(50 - 49 * t);

                    el.style.transform = `translate(${coord.baseX}px, ${coord.baseY}px) scale(${scale})`;
                    el.style.opacity = String(opac);
                    el.style.zIndex = String(z);
                }

                updateFocusedIndexThrottled(closestIdx);
            });
        };

        update();

        const unsubX = dragX.on('change', update);
        const unsubY = dragY.on('change', update);
        return () => {
            unsubX();
            unsubY();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [dragX, dragY, baseCoords, layoutConfig, clipRadius, updateRenderedIndexesForViewport]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                if (displayItems.length === 0) return;

                const curr = baseCoords[focusedIndex];
                let bestNextIdx = focusedIndex;
                let minDist = Infinity;

                baseCoords.forEach((coord, idx) => {
                    if (idx === focusedIndex) return;

                    const dx = coord.baseX - curr.baseX;
                    const dy = coord.baseY - curr.baseY;

                    let isMatch = false;
                    if (e.key === 'ArrowLeft' && dx < -50 && Math.abs(dy) < 180) isMatch = true;
                    if (e.key === 'ArrowRight' && dx > 50 && Math.abs(dy) < 180) isMatch = true;
                    if (e.key === 'ArrowUp' && dy < -50 && Math.abs(dx) < 200) isMatch = true;
                    if (e.key === 'ArrowDown' && dy > 50 && Math.abs(dx) < 200) isMatch = true;

                    if (isMatch) {
                        const dist = dx * dx + dy * dy;
                        if (dist < minDist) {
                            minDist = dist;
                            bestNextIdx = idx;
                        }
                    }
                });

                if (bestNextIdx !== focusedIndex) {
                    centerOnIndex(bestNextIdx, true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, baseCoords, displayItems.length]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] overflow-hidden select-none"
            style={{
                backgroundColor: isDaylight ? 'rgba(250, 249, 246, 0.95)' : 'rgba(9, 9, 11, 0.95)',
                color: 'var(--text-primary)',
                backdropFilter: 'blur(24px)'
            }}
        >
            {/* Top Floating Glass Header */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5 z-[70] bg-gradient-to-b from-black/10 to-transparent">
                <button
                    onClick={onBack}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all pointer-events-auto shadow-lg hover:scale-105 active:scale-95"
                    style={{
                        backgroundColor: isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
                        backdropFilter: 'blur(8px)',
                    }}
                >
                    <ChevronLeft size={20} />
                </button>

                <button
                    type="button"
                    disabled={!hasPlaylistItems}
                    onClick={() => {
                        if (showCutInPanel) {
                            closeCutInPanel();
                        } else {
                            setShowCutInPanel(true);
                        }
                    }}
                    className="text-center flex flex-col items-center select-none pointer-events-auto cursor-pointer hover:scale-[1.01] active:scale-98 transition-all px-5 py-2 rounded-2xl backdrop-blur-md disabled:cursor-default disabled:hover:scale-100"
                    style={{
                        backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                        color: 'var(--text-primary)',
                    }}
                >
                    <h2 className="text-lg font-bold tracking-tight">
                        {title}
                        {hasPlaylistItems && (
                            <span className="ml-1.5 rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[9px] font-normal opacity-60">
                                {t(showCutInPanel ? 'ui.close' : 'ui.info')}
                            </span>
                        )}
                    </h2>
                    {subtitle && <p className="text-xs opacity-50 mt-0.5">{subtitle}</p>}
                </button>

                <div className="w-10 h-10" />
            </div>

            {/* Honeycomb Drag/Viewport Canvas Area */}
            <div
                ref={containerRef}
                onPointerDown={(event) => {
                    if (event.button !== 0) return; // 仅限鼠标左键或主要指针拖动

                    const target = event.target as HTMLElement;
                    // 如果点击了按钮、输入框、链接等，则不触发拖动
                    if (
                        target.closest('button') ||
                        target.closest('input') ||
                        target.closest('a') ||
                        target.closest('textarea') ||
                        target.closest('.theme-glass-panel')
                    ) {
                        return;
                    }

                    suppressSelectionRef.current = false;
                    dragControls.start(event);
                }}
                className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
                style={{ touchAction: 'none' }}
            >
                <AnimatePresence>
                    {showSearchPanel && (
                        <motion.div
                            {...gridSearchPanelMotion}
                            className="absolute top-24 left-1/2 z-[85] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 pointer-events-auto"
                        >
                            <div className="relative rounded-full border shadow-2xl backdrop-blur-2xl theme-glass-panel">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={draftSearchQuery}
                                    onChange={(event) => {
                                        const nextValue = event.target.value;
                                        setDraftSearchQuery(nextValue);
                                        if (!isComposingSearchRef.current) {
                                            setSearchQuery(nextValue);
                                        }
                                    }}
                                    onCompositionStart={() => {
                                        isComposingSearchRef.current = true;
                                    }}
                                    onCompositionEnd={(event) => {
                                        isComposingSearchRef.current = false;
                                        const nextValue = event.currentTarget.value;
                                        setDraftSearchQuery(nextValue);
                                        setSearchQuery(nextValue);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            setShowSearchPanel(false);
                                            setDraftSearchQuery('');
                                            setSearchQuery('');
                                        }
                                    }}
                                    placeholder={`${t('home.gridSearchPlaceholder') || 'Filter collections...'} (Esc)`}
                                    className="w-full rounded-full bg-transparent py-3 pl-11 pr-11 text-sm font-medium outline-none placeholder:text-current placeholder:opacity-40"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (draftSearchQuery) {
                                            setDraftSearchQuery('');
                                            setSearchQuery('');
                                            searchInputRef.current?.focus();
                                        } else {
                                            setShowSearchPanel(false);
                                        }
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 opacity-45 transition-opacity hover:opacity-90 cursor-pointer"
                                    aria-label={draftSearchQuery ? "Clear" : "Close"}
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {displayItems.length === 0 ? (
                    <div className="opacity-40 text-sm font-sans">
                        {deferredSearchQuery.trim().length > 0 
                            ? (t('home.gridSearchNoResults') || 'No matching cards') 
                            : (t('home.loadingLibrary') || 'No items found')}
                    </div>
                ) : (
                    <motion.div
                        drag
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={dragBounds}
                        dragElastic={0.05}
                        dragTransition={{ power: 0.16, timeConstant: 220 }}
                        onDragStart={() => {
                            suppressSelectionRef.current = false;
                        }}
                        onDrag={(_, info) => {
                            if (shouldSuppressGridMapSelection(info.offset.x, info.offset.y)) {
                                suppressSelectionRef.current = true;
                            }
                        }}
                        onDragEnd={(_, info) => {
                            suppressSelectionRef.current = shouldSuppressGridMapSelection(
                                info.offset.x,
                                info.offset.y,
                            );
                        }}
                        style={{ x: dragX, y: dragY, background: 'rgba(0,0,0,0)', touchAction: 'none' }}
                        className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent"
                    >
                        {memoizedCards}
                    </motion.div>
                )}
            </div>

            <AnimatePresence>
                {showCutInPanel && hasPlaylistItems && (
                    <motion.div
                        initial={{ opacity: 0, x: -60, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -60, scale: 0.95 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute left-6 top-24 bottom-28 sm:bottom-6 w-80 rounded-3xl z-[80] flex flex-col p-6 shadow-2xl border backdrop-blur-2xl pointer-events-auto theme-glass-panel"
                    >
                        <div
                            className="relative mb-4 aspect-square shrink-0 overflow-hidden rounded-2xl shadow-lg"
                            style={{
                                background: `linear-gradient(145deg, ${theme.primaryColor}, ${theme.accentColor})`,
                            }}
                        >
                            <div
                                className="absolute inset-0 opacity-60"
                                style={{
                                    background: `radial-gradient(circle at 20% 15%, ${theme.secondaryColor}, transparent 58%)`,
                                }}
                            />
                            <div className="absolute inset-0 bg-black/15" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="line-clamp-2 text-xl font-bold leading-snug">{title}</h3>
                            <p className="mt-1.5 text-[10px] opacity-40">{t('home.playlists')}</p>
                        </div>
                        <div
                            className="mt-auto space-y-2 border-t pt-4"
                            style={{ borderTopColor: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}
                        >
                            {isPlaylistEditMode && (
                                <button
                                    type="button"
                                    onClick={() => setShowHiddenPlaylistsOnly(previous => !previous)}
                                    className={`w-full rounded-full py-2.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                        showHiddenPlaylistsOnly
                                            ? 'bg-black/10 dark:bg-white/10'
                                            : 'bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900'
                                    }`}
                                >
                                    <ListFilter size={14} />
                                    {showHiddenPlaylistsOnly ? t('home.showAllPlaylists') : t('home.showHiddenPlaylistsOnly')}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={togglePlaylistEditMode}
                                className={`w-full rounded-full py-2.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                    isPlaylistEditMode
                                        ? 'bg-red-500/20 text-red-500 border border-red-500/30'
                                        : 'bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900'
                                }`}
                            >
                                {isPlaylistEditMode ? <EyeOff size={14} /> : <Eye size={14} />}
                                {isPlaylistEditMode ? t('home.finishHidingPlaylists') : t('home.hidePlaylists')}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Bottom Right Floating Button */}
            {items.length > 0 && (
                <GridListSearchButton
                    isDaylight={isDaylight}
                    accentColor={theme.accentColor}
                    listTitle={t('playlist.viewCollections') || 'View Collections'}
                    searchTitle={t('home.gridSearchPlaceholder')}
                    onOpenList={() => setShowSidePanel(true)}
                    onOpenSearch={() => setShowSearchPanel(true)}
                />
            )}

            {/* Collections Cut-in Side Panel */}
            <SidePanelList
                isOpen={showSidePanel}
                onClose={() => setShowSidePanel(false)}
                title={title || 'Collections'}
                items={displayItems}
                itemHeight={60}
                isDaylight={isDaylight}
                focusedIndex={focusedIndex}
                renderItem={(item, index, style) => (
                    <CollectionListItem
                        key={`${item.id}-${index}`}
                        item={item}
                        index={index}
                        style={style}
                        isActive={index === focusedIndex}
                        onClick={() => {
                            selectDisplayedItem(item, index);
                            setShowSidePanel(false);
                        }}
                    />
                )}
            />
        </motion.div>
    );
};

export default GridMap;
