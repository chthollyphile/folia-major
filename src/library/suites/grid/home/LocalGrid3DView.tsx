import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, FolderOpen, Loader2, Music, ListMusic, User, Disc3, RefreshCw } from 'lucide-react';
import DesktopGrid3DSurface, { DesktopGrid3DAction } from './DesktopGrid3DSurface';
import { LocalPlaylist, LocalSong, Theme } from '../../../../types';
import type { GridViewCollectionDescriptor } from '../../../../components/app/home/gridViewCollectionAdapters';
import { useDebouncedFocusSync } from '../../../../hooks/useDebouncedFocusSync';
import type { GridMapBatchConfig } from '../directory/GridMap';
import type { LibraryDirectoryBatchController } from '../../../core/directory/directory.contract';
import type { LibraryLocalCatalogSnapshot } from '../../../core/home/home.contract';
import type { LibraryHomeActionsController, LibraryHomeListState, LibraryLocalDirectoryTreesResource } from '../../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import type { LocalHomeRow, LocalHomeSectionKey } from '../../../core/home/localHomeModel';
import { resolveLocalHomeActions } from '../../../core/home/localHomeModel';
import { useLibraryHomeLocal, useLocalDirectoryTrees, useLocalHomeBatchConfig } from '../../../core/home/useLibraryHomeLocal';
import { useLibraryHomeActions } from '../../../core/home/useLibraryHomeActions';
import { useLibraryHomeListRegistration } from '../../../core/home/useLibraryHomeSurfaceRegistration';

// src/library/suites/grid/home/LocalGrid3DView.tsx
// Desktop-only local music Grid3D overview that opens GridView instead of legacy carousel details.
// 分组、section、卡片、导入动作与文件夹树都来自 Library Core 的首页模型（core/home/localHomeModel、
// core/home/useLibraryHomeLocal、首页动作控制器）；这里只剩网格的展示：图标、焦点记忆、文件选择框。

const SECTION_ICONS: Record<LocalHomeSectionKey, React.ReactNode> = {
    folders: <FolderOpen size={13} />,
    albums: <Disc3 size={13} />,
    artists: <User size={13} />,
    playlists: <ListMusic size={13} />,
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
    'import-folder': <FolderOpen size={13} />,
    'refresh-folders': <RefreshCw size={13} />,
    'import-playlist': <FileUp size={13} />,
};

interface LocalGrid3DViewProps {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    /** 宿主的曲库实体快照（与应用其它地方同一份，不再自己另读一份）。 */
    localLibraryCatalog: LibraryLocalCatalogSnapshot;
    activeRow: LocalHomeRow;
    setActiveRow: (row: LocalHomeRow) => void;
    focusedFolderIndex: number;
    setFocusedFolderIndex: (index: number) => void;
    focusedAlbumIndex: number;
    setFocusedAlbumIndex: (index: number) => void;
    focusedArtistIndex: number;
    setFocusedArtistIndex: (index: number) => void;
    focusedPlaylistIndex: number;
    setFocusedPlaylistIndex: (index: number) => void;
    /** 首页动作控制器（导入文件夹、刷新、导入歌单文件、打开分组；宿主创建）。 */
    homeActions: LibraryHomeActionsController;
    /** 本地文件夹树（首页宿主持有，见 homeResources.localDirectoryTrees；换 suite 不重读）。 */
    directoryTreesResource: LibraryLocalDirectoryTreesResource;
    /** 首页模型算好的目录会话 key（core/home/homeSources 的 resolveHomeDirectoryKey）。 */
    directoryKey: string;
    /** 网格 suite 声明的首页动作（交给 GridMap 的目录 surface 取交集）。 */
    declaredHomeActions?: LibraryDeclaredActions;
    onOpenGridView?: (collection: GridViewCollectionDescriptor) => void;
    /** 批量动作控制器（宿主创建；规则在 core/directory/localDirectoryActions.service）。没有时 GridMap 不提供批量。 */
    directoryActions?: LibraryDirectoryBatchController;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
    isInteractive?: boolean;
}

export const LocalGrid3DView: React.FC<LocalGrid3DViewProps> = ({
    localSongs,
    localPlaylists,
    localLibraryCatalog,
    activeRow,
    setActiveRow,
    focusedFolderIndex,
    setFocusedFolderIndex,
    focusedAlbumIndex,
    setFocusedAlbumIndex,
    focusedArtistIndex,
    setFocusedArtistIndex,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    homeActions,
    directoryTreesResource,
    directoryKey,
    declaredHomeActions,
    onOpenGridView,
    directoryActions,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
    isInteractive = true,
}) => {
    const { t } = useTranslation();
    const playlistFileInputRef = useRef<HTMLInputElement>(null);
    const directoryTrees = useLocalDirectoryTrees(directoryTreesResource, localSongs);
    const local = useLibraryHomeLocal({ localSongs, localPlaylists, catalog: localLibraryCatalog, activeRow });
    const { snapshot: actionState, importBusy } = useLibraryHomeActions(homeActions);

    const [localFolderIndex, setLocalFolderIndex] = useDebouncedFocusSync(focusedFolderIndex, setFocusedFolderIndex);
    const [localAlbumIndex, setLocalAlbumIndex] = useDebouncedFocusSync(focusedAlbumIndex, setFocusedAlbumIndex);
    const [localArtistIndex, setLocalArtistIndex] = useDebouncedFocusSync(focusedArtistIndex, setFocusedArtistIndex);
    const [localPlaylistIndex, setLocalPlaylistIndex] = useDebouncedFocusSync(focusedPlaylistIndex, setFocusedPlaylistIndex);
    const focus: Record<LocalHomeSectionKey, [number, (index: number) => void]> = {
        folders: [localFolderIndex, setLocalFolderIndex],
        albums: [localAlbumIndex, setLocalAlbumIndex],
        artists: [localArtistIndex, setLocalArtistIndex],
        playlists: [localPlaylistIndex, setLocalPlaylistIndex],
    };

    const activeSection = local.activeSection;
    const [activeFocusedIndex, setActiveFocusedIndex] = focus[activeSection.key];

    // 批量配置只装配 section 与目录树；动作的规则（路径规则、刷新顺序、pending 与重复提交）在 core 的控制器里。
    // 删除与恢复忽略目录之后重读目录树（core 的 useLocalHomeBatchConfig，TUI 的目录列表用同一个）。
    const { trees } = directoryTrees;
    const localBatchConfig: GridMapBatchConfig | undefined = useLocalHomeBatchConfig({
        controller: directoryActions,
        selectionType: local.batchSelectionType,
        trees,
        reloadTrees: directoryTrees.reload,
        reloadAllTrees: directoryTrees.reloadAll,
    });

    const tabs: DesktopGrid3DAction[] = local.sections.map(section => ({
        id: section.key,
        label: section.label,
        icon: SECTION_ICONS[section.key],
        active: activeSection.row === section.row,
        onClick: () => setActiveRow(section.row),
    }));

    const runAction = (id: string) => {
        if (id === 'import-folder') void homeActions.importFolder();
        else if (id === 'refresh-folders') void homeActions.refreshFolders();
        else if (id === 'import-playlist') playlistFileInputRef.current?.click();
    };

    const localActions = resolveLocalHomeActions(actionState);
    const actions: DesktopGrid3DAction[] = localActions.map(action => ({
        id: action.id,
        label: t(action.labelKey),
        icon: action.pending ? <Loader2 size={13} className="animate-spin" /> : ACTION_ICONS[action.id],
        disabled: action.disabled,
        onClick: () => runAction(action.id),
        title: t(action.titleKey ?? action.labelKey),
    }));

    const isEmptyLibrary = directoryTrees.loaded && localSongs.length === 0 && trees.length === 0;

    // 首页模型交给 core 的首页 surface 句柄（探针与以后的命令面板读它，不读组件树）。
    useLibraryHomeListRegistration({
        enabled: !isEmptyLibrary,
        getState: (): LibraryHomeListState => ({
            tab: 'local',
            directoryKey,
            hiddenScope: 'local',
            sections: local.sections.map(section => ({ id: section.key, label: section.label, active: section.key === activeSection.key })),
            items: activeSection.cards,
            isLoading: false,
            actions: localActions.map(action => ({ id: action.id, label: t(action.labelKey), disabled: action.disabled })),
            batchSelectionType: localBatchConfig ? localBatchConfig.selectionType : null,
            ...(activeSection.key === 'folders' ? { directoryTrees: trees } : {}),
        }),
        setSection: id => {
            const section = local.sections.find(candidate => candidate.key === id);
            if (!section) return false;
            setActiveRow(section.row);
            return true;
        },
        runAction: id => {
            const action = localActions.find(candidate => candidate.id === id);
            if (!action || action.disabled) return false;
            runAction(id);
            return true;
        },
        importPlaylistFile: async file => (await homeActions.importPlaylistFile(file)).ok,
    });

    if (isEmptyLibrary) {
        const scanning = Boolean(actionState.scan?.active);
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 opacity-60">
                <Music size={64} />
                <p className="text-lg">{t('localMusic.noLocalMusic')}</p>
                <button
                    onClick={() => void homeActions.importFolder()}
                    disabled={importBusy}
                    className="px-6 py-3 rounded-full transition-colors text-sm flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {importBusy ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                    {scanning ? t('options.scanning') : actionState.importingFolder ? t('localMusic.importing') : t('localMusic.importFolder')}
                </button>
            </div>
        );
    }

    return (
        <>
            <input
                ref={playlistFileInputRef}
                type="file"
                accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void homeActions.importPlaylistFile(file);
                }}
            />
            <DesktopGrid3DSurface
                focusMemoryScope={JSON.stringify(['local', activeSection.key])}
                title={String(activeSection.label)}
                mapButtonLabel={t('home.allAlbums')}
                items={activeSection.cards}
                focusedIndex={activeFocusedIndex}
                onFocusedIndexChange={setActiveFocusedIndex}
                onSelect={(_, index) => {
                    const group = activeSection.groups[index];
                    if (group) {
                        homeActions.openLocalGroup(group, collection => onOpenGridView?.(collection));
                    }
                }}
                tabs={tabs}
                actions={actions}
                emptyMessage={activeSection.emptyMessage}
                theme={theme}
                isDaylight={isDaylight}
                isInteractive={isInteractive}
                hasFloatingPlayer={hasFloatingPlayer}
                playlistVisibilityScope="local"
                directoryKey={directoryKey}
                declaredHomeActions={declaredHomeActions}
                batchConfig={localBatchConfig}
                ponderControls="local-grid-controls"
                gridMapPonderScope="local-grid-map-page"
            />
        </>
    );
};

export default LocalGrid3DView;
