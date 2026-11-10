import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLibraryGroup, LocalPlaylist, LocalSong } from '../../../types';
import type { LibraryDirectoryBatchConfig, LibraryDirectoryBatchController, LibraryDirectoryNode, LibraryDirectorySelectionType } from '../directory/directory.contract';
import type { LibraryLocalCatalogSnapshot } from './home.contract';
import type { LibraryHomeCard, LibraryLocalDirectoryTreesResource, LibraryLocalDirectoryTreesSnapshot } from './homeModel.contract';
import {
    buildLocalHomeCards,
    buildLocalHomeGroups,
    localBatchSelectionType,
    localHomeSectionOfRow,
    LOCAL_HOME_SECTIONS,
    type LocalHomeRow,
    type LocalHomeSectionKey,
} from './localHomeModel';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';
import { applyLocalCollectionCoverOverrides } from '../collection/cover/localCollectionCover';
import { useLocalCollectionCoverUrls } from '../collection/cover/useLocalCollectionCoverUrls';

// src/library/core/home/useLibraryHomeLocal.ts
// 本地页签的模型：四组条目（core/home/localHomeModel，曲库实体用宿主那份 catalog）、四个 section 的文案与卡片、
// 当前 section 与它的批量类型；以及本地文件夹树（首页宿主持有的 core/directory/localDirectoryTrees.service，跟着曲库重读）。
// 文件夹、专辑、歌单设了自定义封面的（core/collection/cover），分组与卡片带的是那张封面。

export type LibraryHomeLocalSection = {
    key: LocalHomeSectionKey;
    row: LocalHomeRow;
    label: string;
    emptyMessage: string;
    /** 这个 section 的分组（打开集合时用）。 */
    groups: LocalLibraryGroup[];
    cards: LibraryHomeCard[];
};

export type LibraryHomeLocal = {
    sections: LibraryHomeLocalSection[];
    activeSection: LibraryHomeLocalSection;
    batchSelectionType: LibraryDirectorySelectionType | null;
};

export const useLibraryHomeLocal = ({
    localSongs,
    localPlaylists,
    catalog,
    activeRow,
}: {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    /** 宿主的曲库实体快照（与应用其它地方同一份；没读好时按歌曲的原始标签分组）。 */
    catalog: LibraryLocalCatalogSnapshot;
    activeRow: number;
}): LibraryHomeLocal => {
    const { t } = useTranslation();
    const { ready, entities, assignments } = catalog;
    const builtGroups = useMemo(() => buildLocalHomeGroups(
        localSongs,
        localPlaylists,
        t,
        ready ? { entities, assignments } : undefined,
        getLocalCoverAssetUrl,
    ), [assignments, entities, localPlaylists, localSongs, ready, t]);
    // 自定义封面盖在自动封面上：分组本身照旧按歌推出来，换封面不必重新分组。
    const coverOverrides = useLocalCollectionCoverUrls();
    const groups = useMemo(() => ({
        folders: applyLocalCollectionCoverOverrides(builtGroups.folders, coverOverrides),
        albums: applyLocalCollectionCoverOverrides(builtGroups.albums, coverOverrides),
        artists: builtGroups.artists,
        playlists: applyLocalCollectionCoverOverrides(builtGroups.playlists, coverOverrides),
    }), [builtGroups, coverOverrides]);

    const sections = useMemo<LibraryHomeLocalSection[]>(() => LOCAL_HOME_SECTIONS.map(section => {
        const sectionGroups = groups[section.key];
        return {
            key: section.key,
            row: section.row,
            label: t(section.labelKey) || (section.fallbackLabelKey ? t(section.fallbackLabelKey) : ''),
            emptyMessage: t(section.emptyKey),
            groups: sectionGroups,
            cards: buildLocalHomeCards(sectionGroups),
        };
    }), [groups, t]);

    const activeKey = localHomeSectionOfRow(activeRow).key;
    const activeSection = sections.find(section => section.key === activeKey) ?? sections[0];
    return {
        sections,
        activeSection,
        batchSelectionType: localBatchSelectionType(activeSection.key),
    };
};

/**
 * 本地文件夹树：挂载时与曲库变化时按当前曲库 ensure（同一份曲库读过就不再读）；reload 按当前曲库、reloadAll
 * 让服务自己读曲库（恢复忽略目录之后用，与原先一致）。资源是首页宿主的那一份（homeResources.localDirectoryTrees），
 * 换 suite 不重新读；离开本地页签或首页时宿主让它作废，回来重读（原先是 LocalGrid3DView 的组件状态）。
 */
export const useLocalDirectoryTrees = (
    resource: LibraryLocalDirectoryTreesResource,
    localSongs: LocalSong[],
): LibraryLocalDirectoryTreesSnapshot & {
    reload: () => Promise<void>;
    reloadAll: () => Promise<void>;
} => {
    // reload 读最近一次渲染的曲库（不是动作发起那一刻闭包里的）：同时发起的读取里后发起的生效。
    const songsRef = useRef(localSongs);
    songsRef.current = localSongs;
    useEffect(() => {
        void resource.ensure(localSongs);
    }, [localSongs, resource]);
    const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
    return useMemo(() => ({
        ...snapshot,
        reload: () => resource.load(songsRef.current),
        reloadAll: () => resource.load(),
    }), [resource, snapshot]);
};

/**
 * 本地 section 的批量配置（网格的 GridMap 与 TUI 的目录列表共用）：只装配 section 类型、文件夹树与动作控制器；
 * 动作的规则（路径规则、刷新顺序、pending 与重复提交）在 core 的控制器里。删除与恢复忽略目录之后重读文件夹树
 * （树是首页资源，在动作的 pending 期间补上）。没有控制器或 section 不支持批量时为 undefined。
 */
export const useLocalHomeBatchConfig = ({
    controller,
    selectionType,
    trees,
    reloadTrees,
    reloadAllTrees,
}: {
    controller: LibraryDirectoryBatchController | undefined;
    selectionType: LibraryDirectorySelectionType | null;
    trees: LibraryDirectoryNode[];
    reloadTrees: () => Promise<void>;
    reloadAllTrees: () => Promise<void>;
}): LibraryDirectoryBatchConfig | undefined => useMemo(() => {
    if (!controller || !selectionType) return undefined;
    if (selectionType !== 'folders') return { selectionType, controller };
    return {
        selectionType,
        directoryTrees: trees,
        controller,
        afterAction: async action => {
            if (action === 'remove') {
                await reloadTrees();
            } else if (action === 'clear-ignore') {
                await reloadAllTrees();
            }
        },
    };
}, [controller, reloadAllTrees, reloadTrees, selectionType, trees]);
