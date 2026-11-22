import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, FileMusic, ListPlus, NotebookPen, type LucideIcon } from 'lucide-react';
import type { LocalLibraryGroup, LocalSong } from '../../../types';
import type { FoliaPlaylistSummary } from '../../../types/foliaPlaylist';
import { openFoliaPlaylistDialog } from '../../../components/folia-playlists/foliaPlaylistDialogStore';
import { useScratchpadStore } from '../../../stores/useScratchpadStore';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryHiddenScope } from '../../core/directory/directory.contract';
import type { LibraryHomeActionsController, LibraryHomeListState } from '../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../core/suite/suite.contract';
import { resolveFoliaHomeActions, type FoliaHomeActionId } from '../../core/home/foliaHomeModel';
import { useLibraryHomeFolia } from '../../core/home/useLibraryHomeFolia';
import { useLibraryHomeActions } from '../../core/home/useLibraryHomeActions';
import { useLibraryHomeListRegistration } from '../../core/home/useLibraryHomeSurfaceRegistration';
import type { BravaisSeamMenuItem } from './bravaisSeamModels';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import BravaisHomeDirectory from './BravaisHomeDirectory';
import { quickPriority } from './bravaisSeamQuickCells';

// src/library/suites/bravais/BravaisHomeFolia.tsx
// 首页 Folia 组的墙：聚合歌单（「我喜欢的音乐」在最前，缝里有它的直达入口），点开进集合层（和以前的本地歌单同一条路）。
// Folia 组没有二级切换。缝的工具格里：新建歌单、调整歌单顺序、导入歌单文件、打开速记簿（放不下的进「⋯」）；
// 两个对话框由 FoliaPlaylistDialogsHost 画。层的 key 是 `home:folia`。

const ACTION_ICONS: Record<FoliaHomeActionId, LucideIcon> = {
    'folia-new-playlist': ListPlus,
    'folia-reorder-playlists': ArrowUpDown,
    'folia-import-playlist': FileMusic,
    'folia-open-scratchpad': NotebookPen,
};

export const BravaisHomeFolia: React.FC<{
    chrome: BravaisHomeChrome;
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    declaredActions: LibraryDeclaredActions;
    isInteractive: boolean;
    homeActions: LibraryHomeActionsController;
    onOpenGridView: (collection: LibraryCollectionDescriptor) => void;
    meta: string;
    playlists: FoliaPlaylistSummary[];
    localSongs: LocalSong[];
}> = ({ meta, playlists, localSongs, homeActions, onOpenGridView, ...common }) => {
    const { t } = useTranslation();
    const playlistFileInputRef = useRef<HTMLInputElement>(null);
    const folia = useLibraryHomeFolia({ playlists, localSongs });
    const { snapshot: actionState } = useLibraryHomeActions(homeActions);
    const canImport = common.declaredActions.actions.includes('home-import-playlist');
    const foliaActions = resolveFoliaHomeActions({ reorderableCount: folia.reorderableCount, importingPlaylist: actionState.importingPlaylist })
        .filter(action => action.id !== 'folia-import-playlist' || canImport);
    const runAction = (id: string) => {
        if (id === 'folia-new-playlist') openFoliaPlaylistDialog('create');
        else if (id === 'folia-reorder-playlists') openFoliaPlaylistDialog('reorder');
        else if (id === 'folia-import-playlist') playlistFileInputRef.current?.click();
        else if (id === 'folia-open-scratchpad') useScratchpadStore.getState().setOpen(true);
    };
    const runActionRef = useRef(runAction);
    runActionRef.current = runAction;

    useLibraryHomeListRegistration({
        enabled: true,
        getState: (): LibraryHomeListState => ({
            tab: 'folia',
            directoryKey: common.directoryKey,
            hiddenScope: common.hiddenScope,
            sections: [],
            items: folia.cards,
            isLoading: false,
            actions: foliaActions.map(action => ({ id: action.id, label: t(action.labelKey), disabled: action.disabled })),
            batchSelectionType: null,
        }),
        setSection: () => false,
        runAction: id => {
            const action = foliaActions.find(candidate => candidate.id === id);
            if (!action || action.disabled) return false;
            runAction(id);
            return true;
        },
        importPlaylistFile: canImport ? async file => (await homeActions.importPlaylistFile(file)).ok : undefined,
    });

    const menuKey = foliaActions.map(action => `${action.id}:${action.labelKey}:${action.disabled}:${action.pending}`).join('|');
    const menu = useMemo<BravaisSeamMenuItem[]>(() => foliaActions.map(action => ({
        id: `home-${action.id}`,
        label: t(action.labelKey),
        disabled: action.disabled,
        icon: ACTION_ICONS[action.id],
        priority: quickPriority(`home-${action.id}`),
        busy: action.pending,
        run: () => runActionRef.current(action.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- foliaActions 每次渲染都是新数组：按内容比较
    })), [menuKey, t]);
    const latest = useRef({ homeActions, onOpenGridView });
    latest.current = { homeActions, onOpenGridView };
    const onOpen = useMemo(() => (card: { raw?: unknown }) => {
        latest.current.homeActions.openLocalGroup(card.raw as LocalLibraryGroup, latest.current.onOpenGridView);
    }, []);

    return (
        <>
            <input
                ref={playlistFileInputRef}
                type="file"
                accept=".m3u,.m3u8,.json,audio/x-mpegurl,application/vnd.apple.mpegurl,application/json"
                hidden
                data-bravais-playlist-file
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void homeActions.importPlaylistFile(file);
                }}
            />
            <BravaisHomeDirectory
                {...common}
                layerKey="home:folia"
                source="local"
                section="folia"
                items={folia.cards}
                isLoading={false}
                emptyMessage={t('home.foliaEmpty')}
                meta={meta}
                menu={menu}
                panelTitle={t('home.foliaTitle')}
                onOpen={onOpen}
            />
        </>
    );
};

export default BravaisHomeFolia;
