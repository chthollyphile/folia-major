import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, FileUp, Hash, ListMusic, ListPlus, Loader2, NotebookPen } from 'lucide-react';
import DesktopGrid3DSurface, { type DesktopGrid3DAction } from './DesktopGrid3DSurface';
import type { LocalSong, Theme } from '../../../../types';
import type { FoliaPlaylistSummary } from '../../../../types/foliaPlaylist';
import type { GridViewCollectionDescriptor } from '../../../../components/app/home/gridViewCollectionAdapters';
import { openFoliaPlaylistDialog } from '../../../../components/folia-playlists/foliaPlaylistDialogStore';
import { useDebouncedFocusSync } from '../../../../hooks/useDebouncedFocusSync';
import { useScratchpadStore } from '../../../../stores/useScratchpadStore';
import type { LibraryHomeActionsController, LibraryHomeListState } from '../../../core/home/homeModel.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import { resolveFoliaHomeActions, type FoliaHomeActionId } from '../../../core/home/foliaHomeModel';
import { useLibraryHomeFolia } from '../../../core/home/useLibraryHomeFolia';
import { useLibraryHomeActions } from '../../../core/home/useLibraryHomeActions';
import { useLibraryHomeListRegistration } from '../../../core/home/useLibraryHomeSurfaceRegistration';
import { FOLIA_HOME_SECTIONS, isFoliaHomeSection, useFoliaHomeSectionStore, type FoliaHomeSection } from '../../../core/home/foliaHomeSection';
import { openSongNoteTag } from '../../../../components/song-notes/songNoteNavigation';
import { songNoteTagOfCard, useSongNoteTagCards } from '../../../../components/song-notes/useSongNoteTagCards';

// src/library/suites/grid/home/FoliaGrid3DView.tsx
// 网格首页的 Folia 页，两个二级页签（core/home/foliaHomeSection，与 Bravais 共用一个选择）：
// - 歌单：聚合歌单的卡片（「我喜欢的音乐」在最前），点开进集合页（和以前的本地歌单同一条路）。右上角的动作：新建歌单、
//   调整歌单顺序、导入 M3U、打开速记簿；对话框由 FoliaPlaylistDialogsHost 画。
// - 标签：速记簿「时刻」里打的标签，一个标签一张卡，点开去「时刻」展开整页的那一组；卡与卡之间的空隙更宽（用户定，和歌单区分开）。
// 分组、卡片、动作都来自 core/home 的 Folia 模型与 song-notes 的标签卡，这里只剩图标、焦点记忆、文件选择框。

const SECTION_ICONS: Record<FoliaHomeSection, React.ReactNode> = {
    playlists: <ListMusic size={13} />,
    tags: <Hash size={13} />,
};

/** 标签页签卡与卡之间的空隙（px）：歌单的两倍。 */
const TAG_CARD_GAP = 96;

const ACTION_ICONS: Record<FoliaHomeActionId, React.ReactNode> = {
    'folia-new-playlist': <ListPlus size={13} />,
    'folia-reorder-playlists': <ArrowUpDown size={13} />,
    'folia-import-playlist': <FileUp size={13} />,
    'folia-open-scratchpad': <NotebookPen size={13} />,
};

interface FoliaGrid3DViewProps {
    playlists: FoliaPlaylistSummary[];
    localSongs: LocalSong[];
    focusedIndex: number;
    setFocusedIndex: (index: number) => void;
    homeActions: LibraryHomeActionsController;
    directoryKey: string;
    declaredHomeActions?: LibraryDeclaredActions;
    onOpenGridView?: (collection: GridViewCollectionDescriptor) => void;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
    isInteractive?: boolean;
}

export const FoliaGrid3DView: React.FC<FoliaGrid3DViewProps> = ({
    playlists,
    localSongs,
    focusedIndex,
    setFocusedIndex,
    homeActions,
    directoryKey,
    declaredHomeActions,
    onOpenGridView,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
    isInteractive = true,
}) => {
    const { t } = useTranslation();
    const playlistFileInputRef = useRef<HTMLInputElement>(null);
    const folia = useLibraryHomeFolia({ playlists, localSongs });
    const section = useFoliaHomeSectionStore(state => state.section);
    const setSection = useFoliaHomeSectionStore(state => state.setSection);
    const onTags = section === 'tags';
    const tagCards = useSongNoteTagCards(onTags);
    // 标签页签自己的焦点位置（不和歌单的混在一起）。
    const [tagIndex, setTagIndex] = useState(0);
    const { snapshot: actionState } = useLibraryHomeActions(homeActions);
    const [localIndex, setLocalIndex] = useDebouncedFocusSync(focusedIndex, setFocusedIndex);

    const runAction = (id: string) => {
        if (id === 'folia-new-playlist') openFoliaPlaylistDialog('create');
        else if (id === 'folia-reorder-playlists') openFoliaPlaylistDialog('reorder');
        else if (id === 'folia-import-playlist') playlistFileInputRef.current?.click();
        else if (id === 'folia-open-scratchpad') useScratchpadStore.getState().setOpen(true);
    };
    // 标签页签只留「打开速记簿」（新建、排序、导入是歌单的事）。
    const foliaActions = resolveFoliaHomeActions({ reorderableCount: folia.reorderableCount, importingPlaylist: actionState.importingPlaylist })
        .filter(action => !onTags || action.id === 'folia-open-scratchpad');
    const tabs: DesktopGrid3DAction[] = FOLIA_HOME_SECTIONS.map(entry => ({
        id: entry.key,
        label: t(entry.labelKey),
        icon: SECTION_ICONS[entry.key],
        active: entry.key === section,
        onClick: () => setSection(entry.key),
    }));
    const items = onTags ? tagCards : folia.cards;
    const actions: DesktopGrid3DAction[] = foliaActions.map(action => ({
        id: action.id,
        label: t(action.labelKey),
        icon: action.pending ? <Loader2 size={13} className="animate-spin" /> : ACTION_ICONS[action.id],
        disabled: action.disabled,
        onClick: () => runAction(action.id),
        title: t(action.titleKey ?? action.labelKey),
    }));

    useLibraryHomeListRegistration({
        enabled: true,
        getState: (): LibraryHomeListState => ({
            tab: 'folia',
            directoryKey: onTags ? `${directoryKey}:tags` : directoryKey,
            hiddenScope: 'local',
            sections: FOLIA_HOME_SECTIONS.map(entry => ({ id: entry.key, label: t(entry.labelKey), active: entry.key === section })),
            items,
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
        importPlaylistFile: async file => (await homeActions.importPlaylistFile(file)).ok,
    });

    return (
        <>
            <input
                ref={playlistFileInputRef}
                type="file"
                accept=".m3u,.m3u8,.json,audio/x-mpegurl,application/vnd.apple.mpegurl,application/json"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void homeActions.importPlaylistFile(file);
                }}
            />
            <DesktopGrid3DSurface
                focusMemoryScope={JSON.stringify(onTags ? ['folia', 'tags'] : ['folia'])}
                title={t(onTags ? 'home.foliaSectionTags' : 'home.foliaTitle')}
                mapButtonLabel={t('home.allAlbums')}
                items={items}
                focusedIndex={onTags ? tagIndex : localIndex}
                onFocusedIndexChange={onTags ? setTagIndex : setLocalIndex}
                onSelect={(_, index) => {
                    const tagKey = onTags ? songNoteTagOfCard(tagCards[index] ?? {}) : null;
                    if (tagKey) {
                        openSongNoteTag(tagKey);
                        return;
                    }
                    const group = folia.groups.at(index);
                    if (group) homeActions.openLocalGroup(group, collection => onOpenGridView?.(collection));
                }}
                tabs={tabs}
                tabsLabel={t('home.foliaTab')}
                actions={actions}
                cardGap={onTags ? TAG_CARD_GAP : undefined}
                emptyMessage={t(onTags ? 'home.foliaTagsEmpty' : 'home.foliaEmpty')}
                theme={theme}
                isDaylight={isDaylight}
                isInteractive={isInteractive}
                hasFloatingPlayer={hasFloatingPlayer}
                playlistVisibilityScope="local"
                directoryKey={onTags ? `${directoryKey}:tags` : directoryKey}
                declaredHomeActions={declaredHomeActions}
            />
        </>
    );
};

export default FoliaGrid3DView;
