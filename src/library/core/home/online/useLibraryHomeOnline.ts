import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeCard, LibraryHomeResources } from '../homeModel.contract';
import { buildOnlineAlbumCards, buildOnlinePlaylistCards, buildOnlineRadioCards } from '../homeCards';
import {
    isOnlineHomeTab,
    onlineHomeTitleKey,
    resolveOnlineHomeLoading,
    resolveOnlineTabUnavailableReason,
    translateHomeMessage,
} from '../homeSources';
import { useLibraryHomeOnlineFeeds } from './useLibraryHomeOnlineFeeds';
import type { LibraryHomeSources } from '../useLibraryHomeSources';

// src/library/core/home/online/useLibraryHomeOnline.ts
// 在线页签的列表：账户歌单 / 收藏专辑 / 电台三份卡片（core/home/homeCards），当前页签的标题、加载态与
// 不可用原因。收藏专辑与电台来自宿主的首页资源（归属与读取见 useLibraryHomeOnlineFeeds）。

export type LibraryHomeOnlineList = {
    /** 当前在线页签的卡片（不在在线页签时为空）。 */
    items: LibraryHomeCard[];
    title: string;
    isLoading: boolean;
    /** 列表为空时显示的文案：页签不可用的原因，否则是「加载中」。 */
    emptyMessage: string;
};

export const useLibraryHomeOnline = (
    resources: Pick<LibraryHomeResources, 'favoriteAlbums' | 'radioFeed'>,
    sources: Pick<LibraryHomeSources, 'tab' | 'online' | 'personalFmModeLabel'>,
): LibraryHomeOnlineList => {
    const { t } = useTranslation();
    const { tab, online, personalFmModeLabel } = sources;
    const { favoriteAlbums, radioFeed } = useLibraryHomeOnlineFeeds({
        resources,
        tab,
        providerId: online.providerId,
        userId: online.user?.id ?? null,
        canUseAlbums: online.canUseAlbums,
        canUseRadio: online.canUseRadio,
    });

    const playlistCards = useMemo(() => buildOnlinePlaylistCards(online.collections, t), [online.collections, t]);
    const albumCards = useMemo(() => buildOnlineAlbumCards(favoriteAlbums.data, t), [favoriteAlbums.data, t]);
    const radioCards = useMemo(
        () => buildOnlineRadioCards(radioFeed.data, { t, personalFmModeLabel }),
        [personalFmModeLabel, radioFeed.data, t],
    );

    const items = tab === 'playlist' ? playlistCards : tab === 'albums' ? albumCards : tab === 'radio' ? radioCards : NO_CARDS;
    const onlineTab = isOnlineHomeTab(tab) ? tab : 'radio';
    const unavailable = resolveOnlineTabUnavailableReason(online, onlineTab);
    return {
        items,
        title: t(onlineHomeTitleKey(onlineTab)),
        isLoading: resolveOnlineHomeLoading({
            tab,
            source: online,
            favoriteAlbumsLoading: favoriteAlbums.status === 'loading',
            radioFeedLoading: radioFeed.status === 'loading',
        }),
        emptyMessage: unavailable ? translateHomeMessage(t, unavailable) : t('home.loadingLibrary'),
    };
};

const NO_CARDS: LibraryHomeCard[] = [];
