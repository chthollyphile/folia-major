import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, FileMusic, ListPlus, NotebookPen, type LucideIcon } from 'lucide-react';
import type { LocalLibraryGroup, LocalSong } from '../../../types';
import type { FoliaPlaylistSummary } from '../../../types/foliaPlaylist';
import { openFoliaPlaylistDialog } from '../../../components/folia-playlists/foliaPlaylistDialogStore';
import { useScratchpadStore } from '../../../stores/useScratchpadStore';
import { openSongNoteTag } from '../../../components/song-notes/songNoteNavigation';
import { songNoteTagOfCard, useSongNoteTagCards } from '../../../components/song-notes/useSongNoteTagCards';
import { FOLIA_HOME_SECTIONS, isFoliaHomeSection, useFoliaHomeSectionStore } from '../../core/home/foliaHomeSection';
import type { LibraryHomeCard } from '../../core/home/homeModel.contract';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryHiddenScope } from '../../core/directory/directory.contract';
import type { LibraryHomeActionsController, LibraryHomeListState } from '../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../core/suite/suite.contract';
import { resolveFoliaHomeActions, type FoliaHomeActionId } from '../../core/home/foliaHomeModel';
import { useLibraryHomeFolia } from '../../core/home/useLibraryHomeFolia';
import { useLibraryHomeActions } from '../../core/home/useLibraryHomeActions';
import { useLibraryHomeListRegistration } from '../../core/home/useLibraryHomeSurfaceRegistration';
import type { BravaisSeamMenuItem } from './bravaisSeamModels';
import type { BravaisHomeSection } from './bravaisHomeModels';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import BravaisHomeDirectory from './BravaisHomeDirectory';
import { quickPriority } from './bravaisSeamQuickCells';

// src/library/suites/bravais/BravaisHomeFolia.tsx
// 首页 Folia 组的墙，两个二级页签（core/home/foliaHomeSection，网格与 Bravais 共用一个选择）：
// - 歌单：聚合歌单（「我喜欢的音乐」在最前，缝里有它的直达入口），点开进集合层（和以前的本地歌单同一条路）。
//   缝的工具格里：新建歌单、调整歌单顺序、导入歌单文件、打开速记簿（放不下的进「⋯」）；两个对话框由 FoliaPlaylistDialogsHost 画。
// - 标签：速记簿「时刻」里打的标签，一个标签一张卡，点开去「时刻」展开整页的那一组。和歌单墙区分开（用户定）：
//   一直是有限墙（不循环重复），卡与卡之间的空隙更宽（bravais.css 的 data-bravais-kind="tag"）。
// 层的 key 都是 `home:folia`（换页签整面翻牌，同本地的几行）。

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
    const section = useFoliaHomeSectionStore(state => state.section);
    const setSection = useFoliaHomeSectionStore(state => state.setSection);
    const onTags = section === 'tags';
    const tagCards = useSongNoteTagCards(onTags);
    const sections = useMemo<BravaisHomeSection[]>(() => FOLIA_HOME_SECTIONS.map(entry => ({
        key: entry.key,
        label: t(entry.labelKey),
        active: entry.key === section,
    })), [section, t]);
    const selectSection = useCallback((key: string) => {
        if (isFoliaHomeSection(key)) setSection(key);
    }, [setSection]);
    const { snapshot: actionState } = useLibraryHomeActions(homeActions);
    const canImport = common.declaredActions.actions.includes('home-import-playlist');
    // 标签页签只留「打开速记簿」（新建、排序、导入是歌单的事）。
    const foliaActions = resolveFoliaHomeActions({ reorderableCount: folia.reorderableCount, importingPlaylist: actionState.importingPlaylist })
        .filter(action => action.id !== 'folia-import-playlist' || canImport)
        .filter(action => !onTags || action.id === 'folia-open-scratchpad');
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
            directoryKey: onTags ? `${common.directoryKey}:tags` : common.directoryKey,
            hiddenScope: common.hiddenScope,
            sections: sections.map(entry => ({ id: entry.key, label: entry.label, active: entry.active })),
            items: onTags ? tagCards : folia.cards,
            isLoading: false,
            actions: foliaActions.map(action => ({ id: action.id, label: t(action.labelKey), disabled: action.disabled })),
            batchSelectionType: null,
        }),
        setSection: id => {
            if (!isFoliaHomeSection(id)) return false;
            setSection(id);
            return true;
        },
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
    const onOpen = useMemo(() => (card: LibraryHomeCard) => {
        const tagKey = songNoteTagOfCard(card);
        if (tagKey) {
            openSongNoteTag(tagKey);
            return;
        }
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
                directoryKey={onTags ? `${common.directoryKey}:tags` : common.directoryKey}
                layerKey="home:folia"
                source="local"
                section={onTags ? 'folia-tags' : 'folia'}
                items={onTags ? tagCards : folia.cards}
                isLoading={false}
                emptyMessage={t(onTags ? 'home.foliaTagsEmpty' : 'home.foliaEmpty')}
                meta={meta}
                sections={sections}
                onSelectSection={selectSection}
                menu={menu}
                panelTitle={t(onTags ? 'home.foliaSectionTags' : 'home.foliaTitle')}
                onOpen={onOpen}
                bounded={onTags}
                shortcutCards={folia.cards}
            />
        </>
    );
};

export default BravaisHomeFolia;
