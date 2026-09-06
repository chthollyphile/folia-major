import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Map as MapIcon } from 'lucide-react';
import GridMap from '../GridMap';
import { Theme } from '../../types';
import { Grid3DSlider, Grid3DSliderItem } from './Grid3DSlider';
import { ChevronDown } from 'lucide-react';
import type { GridMapBatchConfig } from './gridMapBatch';
import { isHideableGridItem } from './gridItemVisibility';
import { useLiquidGlassFilter } from '../shared/LiquidGlassFilter';
import { buildGlassTintStyle, resolveLiquidGlassTintMultiplier, resolveSurfaceDispersion, useLiquidGlassTuningStore } from '../../stores/useLiquidGlassTuningStore';

// src/components/folia-grid/DesktopGrid3DSurface.tsx
// Shared desktop home surface that keeps Grid3D slider and GridMap controls visually consistent.

export interface DesktopGrid3DAction {
    id: string;
    label: React.ReactNode;
    icon?: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    title?: string;
}

const HIDDEN_GRID_PLAYLISTS_STORAGE_KEY = 'hidden_grid_playlists';

const readHiddenGridPlaylists = (): Record<string, string[]> => {
    if (typeof window === 'undefined') return {};

    try {
        const stored = localStorage.getItem(HIDDEN_GRID_PLAYLISTS_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        return Object.fromEntries(
            Object.entries(parsed).map(([scope, ids]) => [
                scope,
                Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
            ]),
        );
    } catch {
        return {};
    }
};

interface DesktopGrid3DSurfaceProps {
    title: string;
    mapButtonLabel: string;
    items: Grid3DSliderItem[];
    focusedIndex: number;
    onFocusedIndexChange: (index: number) => void;
    onSelect: (item: Grid3DSliderItem, index: number) => void;
    tabs?: DesktopGrid3DAction[];
    actions?: DesktopGrid3DAction[];
    isInteractive?: boolean;
    isLoading?: boolean;
    emptyMessage?: string;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
    playlistVisibilityScope?: string;
    batchConfig?: GridMapBatchConfig;
}

export const DesktopGrid3DSurface: React.FC<DesktopGrid3DSurfaceProps> = ({
    title,
    mapButtonLabel,
    items,
    focusedIndex,
    onFocusedIndexChange,
    onSelect,
    tabs = [],
    actions = [],
    isInteractive = true,
    isLoading = false,
    emptyMessage,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
    playlistVisibilityScope = 'default',
    batchConfig,
}) => {
    const [showGridMap, setShowGridMap] = useState(false);
    const [tabsExpanded, setTabsExpanded] = useState(false);
    const [hiddenPlaylistsByScope, setHiddenPlaylistsByScope] = useState(readHiddenGridPlaylists);

    // 液态玻璃：顶部「全部」按钮（打开 GridMap 2D 视图）。底色走预设表 tint，
    // 迁移自旧 inline 底色（dark 25,25,25/0.7、light 白 /0.7），backdrop-blur class
    // 保留作总开关关闭或不支持时的回退。按钮随 isLoading 条件渲染，
    // 用 enabled 控制不在场时摘掉 RO。
    const liquidGlassTuning = useLiquidGlassTuningStore(state => state.liquidGlassTuning);
    const mapButtonTintStyle = buildGlassTintStyle(liquidGlassTuning, isDaylight, resolveLiquidGlassTintMultiplier('homeGridMapButton', isDaylight));
    const mapButtonRef = useRef<HTMLButtonElement>(null);
    const { defs: mapButtonGlassDefs, backdropFilter: mapButtonGlassBackdropFilter } = useLiquidGlassFilter(mapButtonRef, {
        blur: liquidGlassTuning.blur,
        saturation: liquidGlassTuning.saturation,
        edgeDisplacement: liquidGlassTuning.edgeDisplacement,
        dispersion: resolveSurfaceDispersion('homeGridMapButton', liquidGlassTuning.dispersion),
        enabled: !isLoading,
    });

    const activeTab = tabs.find(tab => tab.active) || tabs[0];
    const hiddenPlaylistIds = useMemo(
        () => new Set(hiddenPlaylistsByScope[playlistVisibilityScope] || []),
        [hiddenPlaylistsByScope, playlistVisibilityScope],
    );
    const visibleItems = useMemo(
        () => items.filter(item => !isHideableGridItem(item) || !hiddenPlaylistIds.has(String(item.id))),
        [hiddenPlaylistIds, items],
    );
    const visibleFocusedIndex = useMemo(() => {
        const focusedItem = items[focusedIndex];
        const nextIndex = focusedItem ? visibleItems.indexOf(focusedItem) : -1;
        return nextIndex >= 0 ? nextIndex : 0;
    }, [focusedIndex, items, visibleItems]);

    const handleVisibleFocusedIndexChange = (index: number) => {
        const sourceIndex = items.indexOf(visibleItems[index]);
        if (sourceIndex >= 0) onFocusedIndexChange(sourceIndex);
    };

    const handleVisibleSelect = (item: Grid3DSliderItem, index: number) => {
        const sourceIndex = items.indexOf(item);
        onSelect(item, sourceIndex >= 0 ? sourceIndex : index);
    };

    const togglePlaylistHidden = (item: Grid3DSliderItem) => {
        if (!isHideableGridItem(item)) return;

        const id = String(item.id);
        setHiddenPlaylistsByScope(previous => {
            const current = new Set(previous[playlistVisibilityScope] || []);
            if (current.has(id)) {
                current.delete(id);
            } else {
                current.add(id);
            }

            const next = { ...previous, [playlistVisibilityScope]: [...current] };
            try {
                localStorage.setItem(HIDDEN_GRID_PLAYLISTS_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Keep the visibility change for this session when storage is unavailable.
            }
            return next;
        });
    };

    return (
        <div className="w-full h-full min-h-0 flex flex-col justify-center relative">
            {!isLoading && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                    {mapButtonGlassDefs}
                    <motion.button
                        ref={mapButtonRef}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShowGridMap(true)}
                        className="px-4 py-2 rounded-full flex items-center gap-2 text-xs font-semibold shadow-lg backdrop-blur-md transition-all border"
                        style={{
                            backdropFilter: mapButtonGlassBackdropFilter ?? undefined,
                            ...mapButtonTintStyle,
                            borderColor: isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        <MapIcon size={14} />
                        <span>{mapButtonLabel}</span>
                    </motion.button>
                </div>
            )}

            {(actions.length > 0 || tabs.length > 0) && (
                <div className="absolute top-2 right-4 z-10 flex max-w-[min(44rem,calc(50%-7rem))] flex-wrap items-center justify-end gap-2">
                    <AnimatePresence mode="wait">
                        {tabsExpanded ? (
                            <motion.div
                                key="expanded-tabs"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                className="flex items-center gap-2"
                            >
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            if (tab.active) {
                                                setTabsExpanded(false);
                                            } else {
                                                tab.onClick();
                                                setTabsExpanded(false);
                                            }
                                        }}
                                        disabled={tab.disabled}
                                        title={tab.title}
                                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-lg backdrop-blur-md border border-white/10 flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45 ${
                                            tab.active ? 'opacity-100' : 'opacity-55 hover:opacity-90'
                                        }`}
                                        style={{
                                            backgroundColor: tab.active
                                                ? (isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)')
                                                : (isDaylight ? 'rgba(255,255,255,0.62)' : 'rgba(25,25,25,0.58)'),
                                            color: 'var(--text-primary)',
                                        }}
                                    >
                                        {tab.icon}
                                        <span className="whitespace-nowrap">{tab.label}</span>
                                    </button>
                                ))}
                            </motion.div>
                        ) : (
                            activeTab && (
                                <motion.div
                                    key="collapsed-tab"
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 10 }}
                                    transition={{ duration: 0.15, ease: "easeOut" }}
                                >
                                    <button
                                        onClick={() => setTabsExpanded(true)}
                                        className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-lg backdrop-blur-md border border-white/10 flex items-center gap-1.5 opacity-100 hover:opacity-80"
                                        style={{
                                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.62)' : 'rgba(25,25,25,0.58)',
                                            color: 'var(--text-primary)',
                                        }}
                                    >
                                        {activeTab.icon}
                                        <span className="whitespace-nowrap">{activeTab.label}</span>
                                        <ChevronDown size={14} className="ml-0.5 opacity-60" />
                                    </button>
                                </motion.div>
                            )
                        )}
                    </AnimatePresence>

                    {actions.map(action => (
                        <button
                            key={action.id}
                            onClick={action.onClick}
                            disabled={action.disabled}
                            title={action.title}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-lg backdrop-blur-md border border-white/10 flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45 ${
                                action.active ? 'opacity-100' : 'opacity-55 hover:opacity-90'
                            }`}
                            style={{
                                backgroundColor: action.active
                                    ? (isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)')
                                    : (isDaylight ? 'rgba(255,255,255,0.62)' : 'rgba(25,25,25,0.58)'),
                                color: 'var(--text-primary)',
                            }}
                        >
                            {action.icon}
                            <span>{action.label}</span>
                        </button>
                    ))}
                </div>
            )}

            <Grid3DSlider
                items={visibleItems}
                focusedIndex={visibleFocusedIndex}
                onFocusedIndexChange={handleVisibleFocusedIndexChange}
                onSelect={handleVisibleSelect}
                isInteractive={isInteractive && !showGridMap}
                isLoading={isLoading}
                emptyMessage={emptyMessage}
                isDaylight={isDaylight}
                hasFloatingPlayer={hasFloatingPlayer}
            />

            <AnimatePresence>
                {showGridMap && (
                    <GridMap
                        title={title}
                        items={items.map(item => ({
                            id: item.id,
                            name: typeof item.name === 'string' || typeof item.name === 'number' ? String(item.name) : '',
                            coverUrl: item.coverUrl,
                            description: item.type === 'folder' && !item.isVirtual
                                ? String(item.name)
                                : item.description,
                            summary: item.summary,
                            trackCount: item.trackCount,
                            type: item.type,
                            path: item.type === 'folder' && !item.isVirtual ? String(item.name) : undefined,
                            trackIds: item.trackIds,
                            rawCollection: item,
                        }))}
                        initialFocusedIndex={focusedIndex}
                        onBack={() => setShowGridMap(false)}
                        onSelectCollection={(_, index) => {
                            setShowGridMap(false);
                            onFocusedIndexChange(index);
                        }}
                        onActivateCollection={(collection, index) => {
                            setShowGridMap(false);
                            onFocusedIndexChange(index);
                            onSelect(collection, index);
                        }}
                        isInteractive={isInteractive}
                        theme={theme}
                        isDaylight={isDaylight}
                        isPlaylistHidden={(item) => hiddenPlaylistIds.has(String(item.id))}
                        onTogglePlaylistHidden={togglePlaylistHidden}
                        batchConfig={batchConfig}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default DesktopGrid3DSurface;
