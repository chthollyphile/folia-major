import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalLibraryGroup, LocalSong } from '../../../types';
import type { FoliaPlaylistSummary } from '../../../types/foliaPlaylist';
import type { LibraryHomeCard } from './homeModel.contract';
import { buildFoliaHomeGroups } from './foliaHomeModel';
import { buildLocalHomeCards } from './localHomeModel';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';
import { applyLocalCollectionCoverOverrides } from '../collection/cover/localCollectionCover';
import { useLocalCollectionCoverUrls } from '../collection/cover/useLocalCollectionCoverUrls';

// src/library/core/home/useLibraryHomeFolia.ts
// 首页 Folia 组的模型：聚合歌单的分组与卡片（core/home/foliaHomeModel），设了自定义封面的换上那张
// （和本地歌单时期同一个键：歌单 id，所以迁来的歌单封面还在）。grid 与 Bravais 的 Folia 页共用。

export type LibraryHomeFolia = {
    /** 「我喜欢的音乐」在最前；打开集合时用。 */
    groups: LocalLibraryGroup[];
    cards: LibraryHomeCard[];
    /** 除「我喜欢的音乐」外的歌单数（调整歌单顺序要至少两张）。 */
    reorderableCount: number;
};

export const useLibraryHomeFolia = ({
    playlists,
    localSongs,
}: {
    playlists: readonly FoliaPlaylistSummary[];
    localSongs: readonly LocalSong[];
}): LibraryHomeFolia => {
    const { t } = useTranslation();
    const built = useMemo(() => buildFoliaHomeGroups(playlists, localSongs, t, getLocalCoverAssetUrl), [localSongs, playlists, t]);
    const coverOverrides = useLocalCollectionCoverUrls();
    const groups = useMemo(() => applyLocalCollectionCoverOverrides(built, coverOverrides), [built, coverOverrides]);
    return useMemo(() => ({
        groups,
        cards: buildLocalHomeCards(groups),
        reorderableCount: playlists.filter(playlist => !playlist.isFavorite).length,
    }), [groups, playlists]);
};
