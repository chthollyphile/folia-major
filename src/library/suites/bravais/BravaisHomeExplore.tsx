import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryHomeOnlineSource } from '../../core/home/homeModel.contract';
import type { LibraryAccountController } from '../../core/account/account.contract';
import { explorePageKey, useExploreFeedStore } from '../../../stores/useExploreFeedStore';
import { useExploreWall } from '../../../components/app/lattice/useExploreWall';
import { listenedSongsOf } from '../../../components/app/home/explore/ownSections';
import { createOnlineGridViewCollection } from '../../../components/app/home/gridViewCollectionAdapters';
import type { BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import type { BravaisHomeTool } from './bravaisHomeModels';
import { projectExploreHeadings, projectExploreItems } from './bravaisExploreProjection';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import { useBravaisHomeAccount } from './useBravaisHomeAccount';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';

// src/library/suites/bravais/BravaisHomeExplore.tsx
// 探索页签（设计稿 §10.5 之外的第六个页签）：墙本身就是拼贴，所以不另画一面拼贴——探索页的条目直接铺在 bravais 的墙上，
// 排法与网格的探索拼贴（「探索墙」）完全相同：同一份数据（useExploreFeedStore，经 lattice 的 useExploreWall：去重、顺序、
// 读后续 section 的规则都是它的），同一个版面（层带上 sections，墙按探索形状铺，见 bravaisWallShape）。
// - 打开：集合（歌单 / 专辑 / 歌手 / 混音）与网格的探索页一样交给宿主（onOpenGridView），bravais 照常从被点的那张推一层
//   集合墙；歌曲点了展开聚焦卡，播放时与网格一样连同它所在 section 的歌曲一起放。
// - 缝：标题与面包屑是「探索」，元数据行是平台；读取中 / 读不到 / 空页的说明进状态行；「⋯」里有「换一批」。
// - 账户：与另外几个在线页签同一套（未登录、解析中时墙空着，缝里说原因）。
// 这个组件只渲染 null。

const NO_KEYS: ReadonlySet<string> = new Set();

const BravaisHomeExplore: React.FC<{
    chrome: BravaisHomeChrome;
    online: LibraryHomeOnlineSource;
    account: LibraryAccountController;
    isInteractive: boolean;
    onPlaySong: (song: SongResult, queue: SongResult[], isFmCall?: boolean) => void;
    onOpenGridView: (collection: LibraryCollectionDescriptor) => void;
}> = ({ chrome, online, account: accountController, isInteractive, onPlaySong, onOpenGridView }) => {
    const { t, i18n } = useTranslation();
    // 无账户的平台也有自己的推荐页（不依赖账号），所以 accountless 和已登录一样读这一页。
    const isOn = (online.accountView === 'authenticated' || online.accountView === 'accountless') && online.canUseExplore;
    const providerId = online.providerId as OnlineProviderId;
    const accountId = String(online.user?.id ?? '');
    // 与网格的探索页（ExploreSurface）同一个页键：换平台、账户或语言就是另一页。
    const key = explorePageKey(providerId, accountId, i18n.language);
    const keptKey = useExploreFeedStore(state => state.key);
    useEffect(() => {
        if (isOn) useExploreFeedStore.getState().show(key, listenedSongsOf(providerId, accountId));
    }, [accountId, isOn, keptKey, key, providerId]);
    const feed = useExploreFeedStore(state => (isOn && state.key === key ? state.feed : null));
    const wall = useExploreWall({ isOn, currentSong: null, providerId: isOn ? providerId : undefined, accountId, pageKey: key });

    const items = useMemo(() => projectExploreItems(wall.tiles), [wall.tiles]);
    const headings = useMemo(() => projectExploreHeadings(wall.sections, t), [t, wall.sections]);
    const shape = useMemo(() => (wall.sections.length > 0 ? { kind: 'explore' as const, sections: wall.sections, headings } : undefined), [headings, wall.sections]);

    const latest = useRef({ tiles: wall.tiles, onPlaySong, onOpenGridView, providerId });
    latest.current = { tiles: wall.tiles, onPlaySong, onOpenGridView, providerId };
    const onOpenItem = useCallback((itemKey: string) => {
        const { tiles, onOpenGridView: open, providerId: provider } = latest.current;
        const tile = tiles.find(candidate => candidate.id === itemKey);
        if (tile?.kind === 'collection') open(createOnlineGridViewCollection(tile.collection, provider));
    }, []);
    const onPlayItem = useCallback((itemKey: string) => {
        const { tiles, onPlaySong: play } = latest.current;
        const tile = tiles.find(candidate => candidate.id === itemKey);
        if (tile?.kind === 'song') play(tile.song, tile.queue ?? [tile.song], false);
    }, []);

    const accountSeam = useBravaisHomeAccount(accountController, online);
    const status = online.accountView === 'guest'
        ? (online.needsRelogin ? t('status.loginExpired') : undefined)
        : online.accountView === 'resolving'
            ? t('home.loadingLibrary')
            // 无账户的平台：与网格对同一状态的说法相同（OnlineProviderAccountlessPanel 的标题）。
            // 有推荐页的平台不写这一行，页面上有自己的内容。
            : online.accountView === 'accountless'
                ? (online.canUseExplore ? undefined : t('home.accountlessTitle', { provider: online.providerLabel }))
                : items.length > 0
                    ? undefined
                    : !feed || feed.status === 'loading' ? t('playlist.loading') : wall.emptyText ?? t('home.exploreEmpty');
    const refreshTool = useMemo<BravaisHomeTool | null>(() => (isOn ? {
        id: 'refresh-explore',
        label: t('home.exploreRefresh'),
        disabled: !wall.canRefresh,
        busy: wall.isRefreshing,
        run: wall.refresh,
    } : null), [isOn, t, wall.canRefresh, wall.isRefreshing, wall.refresh]);
    const tools = useMemo<BravaisHomeTool[]>(() => [
        chrome.searchTool,
        ...(refreshTool ? [refreshTool] : []),
        ...chrome.appTools,
    ], [chrome.appTools, chrome.searchTool, refreshTool]);
    const seam = useMemo<BravaisSeamModel>(() => ({
        title: chrome.title,
        crumb: chrome.title,
        meta: online.providerLabel,
        status,
        tabs: chrome.tabs,
        onSelectTab: chrome.onSelectTab,
        home: {
            tools,
            menuLabel: t('libraryBravaisHome.more'),
            scan: chrome.scan,
            search: chrome.search,
            account: accountSeam,
        },
    }), [accountSeam, chrome.onSelectTab, chrome.scan, chrome.search, chrome.tabs, chrome.title, online.providerLabel, status, t, tools]);
    const wallRules = useMemo(() => ({ filterKey: 'explore', loading: isOn && items.length === 0 && (!feed || feed.status === 'loading') }), [feed, isOn, items.length]);
    const home = useMemo(() => ({ cycleTab: chrome.cycleTab }), [chrome.cycleTab]);

    const layer = useMemo<BravaisLayer>(() => ({
        key: 'home:explore',
        sessionKey: 'home',
        surface: 'home',
        mode: 'infinite',
        items: isOn ? items : [],
        seam,
        isInteractive,
        focusedEntryKey: null,
        nowPlayingKey: null,
        queuedKeys: NO_KEYS,
        onOpenItem,
        onPlayItem,
        wall: wallRules,
        home,
        shape: isOn ? shape : undefined,
    }), [home, isInteractive, isOn, items, onOpenItem, onPlayItem, seam, shape, wallRules]);
    useBravaisLayerRegistration('home', layer);
    return null;
};

export default BravaisHomeExplore;
