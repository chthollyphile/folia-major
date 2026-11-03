import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Map as MapIcon } from 'lucide-react';
import GridMap, { type GridMapBatchConfig } from '../directory/GridMap';
import { Theme } from '../../../../types';
import { Grid3DSlider, Grid3DSliderItem } from './Grid3DSlider';
import { GridViewTabs, gridChromeClassesFor } from './GridViewTabs';
import { filterDirectoryByVisibility, resolveSourceDirectoryIndex, resolveVisibleDirectoryIndex } from '../../../core/directory/directoryVisibility';
import type { LibraryHiddenScope } from '../../../core/directory/directory.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import { useHiddenCollections } from '../../../core/collection/useHiddenCollections';
import { DEFAULT_DIRECTORY_SESSION_ID, hasDirectorySessionState } from '../../../core/directory/directorySession';
import { homeCardToDirectoryItem } from '../../../core/directory/directoryItems';
import { getLibraryDirectorySession, useLibraryDirectorySessionStore } from '../../../core/directory/useLibraryDirectorySessionStore';
import { useHomeCardPosition } from '../../../../hooks/useHomeCardPosition';

// src/library/suites/grid/home/DesktopGrid3DSurface.tsx
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

interface DesktopGrid3DSurfaceProps {
    focusMemoryScope?: string;
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
    /** 隐藏项的作用域（隐藏表与规则在 core：useHiddenCollectionsStore / directoryVisibility）。 */
    playlistVisibilityScope?: LibraryHiddenScope;
    /** 这个列表的目录会话 key（core/directory/directorySession 的 directoryKey）：GridMap 的筛选与批选存在这里。 */
    directoryKey?: string;
    /** 网格 suite 声明的首页动作（交给 GridMap 的目录 surface 取交集）。 */
    declaredHomeActions?: LibraryDeclaredActions;
    batchConfig?: GridMapBatchConfig;
    ponderControls?: 'local-grid-controls';
    gridMapPonderScope?: 'local-grid-map-page';
}

export const DesktopGrid3DSurface: React.FC<DesktopGrid3DSurfaceProps> = ({
    focusMemoryScope,
    title,
    mapButtonLabel,
    items,
    focusedIndex: legacyFocusedIndex,
    onFocusedIndexChange: onLegacyFocusedIndexChange,
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
    directoryKey = DEFAULT_DIRECTORY_SESSION_ID,
    declaredHomeActions,
    batchConfig,
    ponderControls,
    gridMapPonderScope,
}) => {
    // GridMap 就是网格里「打开着的目录」（core 的目录会话 store 记着打开的是哪个，见 useLibraryDirectorySessionStore）：
    // 打开地图 = openDirectory，关掉地图 = closeDirectory（退场动画结束之后：地图还在淡出，筛选结果不能先跳回全部；
    // 关掉时的 key 记下来，退场期间换了 section 也关对的那个）。挂载不算打开、卸载不算关闭——换 suite 卸载网格时
    // 会话留给下一套 suite。挂载时这个目录若已经打开着、会话里有筛选 / 选择 / 管理隐藏视图（例如刚从 TUI 切过来），
    // 地图直接开着把它们显示出来；打开着却是空会话就当它关了（网格里地图关着）。
    const [showGridMap, setShowGridMap] = useState(() => {
        const { openDirectoryKey } = useLibraryDirectorySessionStore.getState();
        return openDirectoryKey === directoryKey && hasDirectorySessionState(getLibraryDirectorySession(directoryKey));
    });
    const closingDirectoryKeyRef = useRef<string | null>(null);
    useEffect(() => {
        const { openDirectoryKey, closeDirectory } = useLibraryDirectorySessionStore.getState();
        if (!showGridMap && openDirectoryKey === directoryKey) closeDirectory(directoryKey);
        // 只在挂载时对一次（之后的开关都经下面的回调）。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // 地图开着时换了目录（切 section）：新目录成为打开着的那个（之前的随之关掉，与原先换 key 丢筛选一致）。
    useEffect(() => {
        if (showGridMap) useLibraryDirectorySessionStore.getState().openDirectory(directoryKey);
    }, [directoryKey, showGridMap]);
    const openGridMap = useCallback(() => {
        const store = useLibraryDirectorySessionStore.getState();
        // 退场还没结束就重新打开：上一次的关闭照样算数（会话丢掉，新地图从空会话开始）。
        if (closingDirectoryKeyRef.current) store.closeDirectory(closingDirectoryKeyRef.current);
        closingDirectoryKeyRef.current = null;
        store.openDirectory(directoryKey);
        setShowGridMap(true);
    }, [directoryKey]);
    const closeGridMap = useCallback(() => {
        closingDirectoryKeyRef.current = directoryKey;
        setShowGridMap(false);
    }, [directoryKey]);
    const handleGridMapExitComplete = useCallback(() => {
        const closedKey = closingDirectoryKeyRef.current;
        closingDirectoryKeyRef.current = null;
        if (closedKey) useLibraryDirectorySessionStore.getState().closeDirectory(closedKey);
    }, []);
    const chrome = gridChromeClassesFor(isDaylight);
    const { hiddenIds: hiddenPlaylistIds, toggleHidden: togglePlaylistHidden } = useHiddenCollections(playlistVisibilityScope);
    const { focusedIndex, onFocusedIndexChange } = useHomeCardPosition(
        focusMemoryScope, items, legacyFocusedIndex, onLegacyFocusedIndexChange, isLoading,
    );

    const visibleItems = useMemo(
        () => filterDirectoryByVisibility(items, hiddenPlaylistIds, 'browse'),
        [hiddenPlaylistIds, items],
    );
    const visibleFocusedIndex = useMemo(
        () => resolveVisibleDirectoryIndex(items, visibleItems, focusedIndex),
        [focusedIndex, items, visibleItems],
    );

    const handleVisibleFocusedIndexChange = (index: number) => {
        const sourceIndex = resolveSourceDirectoryIndex(items, visibleItems, index);
        if (sourceIndex >= 0) onFocusedIndexChange(sourceIndex);
    };

    const handleVisibleSelect = (item: Grid3DSliderItem, index: number) => {
        const sourceIndex = items.indexOf(item);
        if (sourceIndex >= 0) onFocusedIndexChange(sourceIndex);
        onSelect(item, sourceIndex >= 0 ? sourceIndex : index);
    };

    return (
        <div data-ponder-page-scope="grid-page" className="w-full h-full min-h-0 flex flex-col justify-center relative">
            {/* One row under the home header, on the header's own max-w-7xl grid so it shares its
                centre line: the second-level capsule (the map of all cards, then the collection
                types) sits right under the header's view capsule, the library actions on the right
                under the search box. The row itself lets clicks through to the grid; only the
                controls take them. */}
            <div className="pointer-events-none absolute inset-x-0 top-2 z-10">
                <div className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 md:px-8">
                    <div />
                    <div className="flex justify-center">
                        {(!isLoading || tabs.length > 0) && (
                            <GridViewTabs
                                tabs={tabs}
                                isDaylight={isDaylight}
                                onOpenMap={isLoading ? undefined : openGridMap}
                                mapLabel={mapButtonLabel}
                                mapIcon={<MapIcon size={13} />}
                                ponderId={ponderControls}
                            />
                        )}
                    </div>

                    <div className="flex min-w-0 justify-end">
                        {actions.length > 0 && (
                            <div data-ponder={ponderControls} className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
                                {actions.map(action => (
                                    <button
                                        key={action.id}
                                        onClick={action.onClick}
                                        disabled={action.disabled}
                                        title={action.title}
                                        className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium backdrop-blur-md transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${chrome.pill} ${
                                            action.active ? chrome.strongText : chrome.softText
                                        }`}
                                    >
                                        {action.icon}
                                        <span className="whitespace-nowrap">{action.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Grid3DSlider
                key={focusMemoryScope}
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

            <AnimatePresence onExitComplete={handleGridMapExitComplete}>
                {showGridMap && (
                    <GridMap
                        directoryKey={directoryKey}
                        declaredHomeActions={declaredHomeActions}
                        title={title}
                        // 文件夹卡的描述是它的名称（路径）——虚拟的「全部歌曲」也一样，标题下一行照旧是
                        // 「All Songs / 全部歌曲」。path 只给真实文件夹（契约：虚拟条目没有路径）；GridMap 的卡片
                        // 按 resolveGridMapFolderLabel 把虚拟文件夹的名称放在路径的位置（含「本目录 N 首」）。
                        // 规则在 core/directory/directoryItems，TUI 的目录列表用同一条。
                        items={items.map(item => ({
                            ...homeCardToDirectoryItem({
                                ...item,
                                name: typeof item.name === 'string' || typeof item.name === 'number' ? String(item.name) : '',
                            }),
                            rawCollection: item,
                        }))}
                        initialFocusedIndex={focusedIndex}
                        onBack={closeGridMap}
                        onSelectCollection={(_, index) => {
                            closeGridMap();
                            onFocusedIndexChange(index);
                        }}
                        onActivateCollection={(collection, index) => {
                            closeGridMap();
                            onFocusedIndexChange(index);
                            onSelect(collection, index);
                        }}
                        isInteractive={isInteractive}
                        theme={theme}
                        isDaylight={isDaylight}
                        hiddenIds={hiddenPlaylistIds}
                        onTogglePlaylistHidden={togglePlaylistHidden}
                        batchConfig={batchConfig}
                        ponderPageScope={gridMapPonderScope}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default DesktopGrid3DSurface;
