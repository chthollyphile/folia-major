import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { OmniExploreSection, OnlineProviderId } from '../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryHomeOnlineSource } from '../../core/home/homeModel.contract';
import type { LibraryAccountController } from '../../core/account/account.contract';
import type { LibraryDeclaredActions } from '../../core/suite/suite.contract';
import type { LibraryPlaybackPort } from '../../core/shared/ports.contract';
import { explorePageKey, useExploreFeedStore } from '../../../stores/useExploreFeedStore';
import { useExploreWall } from '../../../components/app/lattice/useExploreWall';
import { listenedSongsOf, readOwnExploreSections } from '../../../components/app/home/explore/ownSections';
import { recordSetRightTimes, watchRecentPlays } from '../../../components/app/home/explore/recentPlays';
import { createOnlineGridViewCollection } from '../../../components/app/home/gridViewCollectionAdapters';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import type { BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import type { BravaisHomeTool } from './bravaisHomeModels';
import { projectExploreHeadings, projectExploreItems } from './bravaisExploreProjection';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import { useBravaisHomeAccount } from './useBravaisHomeAccount';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { availableLocalTabLabel, onlineWallHint } from './bravaisEmptyWallHint';

// src/library/suites/bravais/BravaisHomeExplore.tsx
// 探索页签（设计稿 §10.5 之外的第六个页签）：墙本身就是拼贴，所以不另画一面拼贴——探索页的条目直接铺在 bravais 的墙上，
// 排法与网格的探索拼贴（「探索墙」）完全相同：同一份数据（useExploreFeedStore，经 lattice 的 useExploreWall：去重、顺序、
// 读后续 section 的规则都是它的），同一个版面（层带上 sections，墙按探索形状铺，见 bravaisWallShape）。
// - 打开：集合（歌单 / 专辑 / 歌手 / 混音）与网格的探索页一样交给宿主（onOpenGridView），bravais 照常从被点的那张推一层
//   集合墙；歌曲点了展开聚焦卡，播放时与网格一样连同它所在 section 的歌曲一起放。
// - 歌曲磁贴与聚焦卡右上角悬浮的「加入速记簿」「收藏到歌单」（explore-collect / explore-save-to-playlist，走首页的
//   播放端口）：速记簿里的出处是「探索 · section 标题」。
// - 本机的两组（最近播放、再听一次，ownSections）排在平台的 section 前面，和网格的探索页一样；网格的探索墙不放它们。
//   这两组是快照：进页签时（换平台、账户、语言就是另一页，也算进页签）与「换一批」时各读一次，之后放歌不跟着变，墙不在听歌时重排；
//   只有播放记录被纠正（旧的 MV 记录换成正式版）时再读一次。
// - 缝：标题与面包屑是「探索」，元数据行是平台；读取中 / 读不到 / 空页的说明进状态行（墙上有本机的两组时照样说）；
//   「⋯」里有「换一批」。
// - 账户：与另外几个在线页签同一套（未登录、解析中时墙空着，缝里说原因；未登录时墙面上有背景说明，bravaisEmptyWallHint）。
// 这个组件只渲染 null。

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_SECTIONS: OmniExploreSection[] = [];
// 墙上一块地放一组的至多 13 张（exploreLayout），最近播放七天能有几百首，会把平台的推荐挤到很远：本机每组只上前 30 首
// （再听一次本来就最多 30 首）。
const OWN_SONGS_ON_WALL = 30;

type OwnSnapshot = { key: string | null; sections: OmniExploreSection[] };

// 本机两组的快照：`key` 是这一页的页键，页签没开（未登录等）时为 null，什么也不读。
const snapshotOwnSections = (key: string | null, providerId: OnlineProviderId, accountId: string, t: (key: string) => string): OwnSnapshot => ({
    key,
    sections: key === null ? NO_SECTIONS : readOwnExploreSections(providerId, accountId, t).map(section => (
        section.items.length > OWN_SONGS_ON_WALL ? { ...section, items: section.items.slice(0, OWN_SONGS_ON_WALL) } : section
    )),
});

const BravaisHomeExplore: React.FC<{
    chrome: BravaisHomeChrome;
    online: LibraryHomeOnlineSource;
    account: LibraryAccountController;
    isInteractive: boolean;
    declaredActions: LibraryDeclaredActions;
    playback: LibraryPlaybackPort;
    onPlaySong: (song: SongResult, queue: SongResult[], isFmCall?: boolean) => void;
    onOpenGridView: (collection: LibraryCollectionDescriptor) => void;
}> = ({ chrome, online, account: accountController, isInteractive, declaredActions, playback, onPlaySong, onOpenGridView }) => {
    const { t, i18n } = useTranslation();
    const isOn = online.accountView === 'authenticated' && online.canUseExplore;
    const providerId = online.providerId as OnlineProviderId;
    const accountId = String(online.user?.id ?? '');
    // 与网格的探索页（ExploreSurface）同一个页键：换平台、账户或语言就是另一页。
    const key = explorePageKey(providerId, accountId, i18n.language);
    const keptKey = useExploreFeedStore(state => state.key);
    useEffect(() => {
        if (isOn) useExploreFeedStore.getState().show(key, listenedSongsOf(providerId, accountId));
    }, [accountId, isOn, keptKey, key, providerId]);
    const feed = useExploreFeedStore(state => (isOn && state.key === key ? state.feed : null));
    // 换了一页（或页签刚开）就重读快照；在渲染里换，不让墙先按上一页的快照铺一次。播放记录被纠正（旧的 MV 记录换成正式版，
    // 见 ownSections 的 setRightOnce）也重读：纠正要问平台，在页签打开之后才到。
    const setRightTimes = useSyncExternalStore(watchRecentPlays, recordSetRightTimes);
    const ownKey = isOn ? `${key}#${setRightTimes}` : null;
    const [own, setOwn] = useState(() => snapshotOwnSections(ownKey, providerId, accountId, t));
    if (own.key !== ownKey) setOwn(snapshotOwnSections(ownKey, providerId, accountId, t));
    const wall = useExploreWall({
        isOn,
        currentSong: null,
        providerId: isOn ? providerId : undefined,
        accountId,
        pageKey: key,
        ownSections: own.sections,
    });
    const { refresh: refreshPage } = wall;
    // 「换一批」：快照一起重读。墙在换一批的回答到之前留着现在的条目（handedEntriesOf），新快照和新一批一起上墙。
    const refresh = useCallback(() => {
        setOwn(snapshotOwnSections(ownKey, providerId, accountId, t));
        refreshPage();
    }, [accountId, ownKey, providerId, refreshPage, t]);

    const items = useMemo(() => projectExploreItems(wall.tiles), [wall.tiles]);
    const headings = useMemo(() => projectExploreHeadings(wall.sections, t), [t, wall.sections]);
    const shape = useMemo(() => (wall.sections.length > 0 ? { kind: 'explore' as const, sections: wall.sections, headings } : undefined), [headings, wall.sections]);

    const latest = useRef({ tiles: wall.tiles, onPlaySong, onOpenGridView, providerId, declaredActions, playback, t });
    latest.current = { tiles: wall.tiles, onPlaySong, onOpenGridView, providerId, declaredActions, playback, t };
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
    // 悬浮的两颗：回调身份稳定，执行时读最新的条目、声明与端口（层描述不因它们换身份）。
    const quickActions = useMemo(() => {
        // 下架的歌（磁贴不带 unavailable，在这里挡）不给：与搜索页、集合页一致。
        const songTileOf = (itemKey: string) => {
            const tile = latest.current.tiles.find(candidate => candidate.id === itemKey);
            return tile?.kind === 'song' && !isSongUnavailable(tile.song) ? tile : undefined;
        };
        const declared = (action: 'explore-collect' | 'explore-save-to-playlist') => latest.current.declaredActions.actions.includes(action);
        return {
            canCollectItem: (itemKey: string) => Boolean(songTileOf(itemKey) && declared('explore-collect') && latest.current.playback.collectTracks),
            onCollectItem: (itemKey: string) => {
                const tile = songTileOf(itemKey);
                if (!tile || !declared('explore-collect')) return;
                const { t: translate } = latest.current;
                const label = tile.heading
                    ? translate('scratchpad.originExploreSection', { section: tile.heading })
                    : translate('home.explore');
                latest.current.playback.collectTracks?.([tile.song], { label });
            },
            canSaveItemToPlaylist: (itemKey: string) => {
                const tile = songTileOf(itemKey);
                const { playback: port } = latest.current;
                return Boolean(tile && declared('explore-save-to-playlist') && port.pickPlaylistFor && port.canPickPlaylistFor?.(tile.song));
            },
            onSaveItemToPlaylist: (itemKey: string) => {
                const tile = songTileOf(itemKey);
                const { playback: port } = latest.current;
                if (tile && declared('explore-save-to-playlist') && port.canPickPlaylistFor?.(tile.song)) port.pickPlaylistFor?.([tile.song]);
            },
        };
    }, []);

    const accountSeam = useBravaisHomeAccount(accountController, online);
    const status = online.accountView === 'guest'
        ? (online.needsRelogin ? t('status.loginExpired') : undefined)
        : online.accountView === 'resolving'
            ? t('home.loadingLibrary')
            // 无账户的平台：与网格对同一状态的说法相同（OnlineProviderAccountlessPanel 的标题）。
            : online.accountView === 'accountless'
                ? t('home.accountlessTitle', { provider: online.providerLabel })
                // 平台这一页的状态：墙上只有本机的两组时也要说（和网格探索页在两组下面说一样），空页只在墙上什么也没有时说。
                : !feed || feed.status === 'loading'
                    ? t('playlist.loading')
                    : feed.status === 'error'
                        ? t('home.exploreFailed')
                        : items.length > 0 ? undefined : t('home.exploreEmpty');
    const refreshTool = useMemo<BravaisHomeTool | null>(() => (isOn ? {
        id: 'refresh-explore',
        label: t('home.exploreRefresh'),
        disabled: !wall.canRefresh,
        busy: wall.isRefreshing,
        run: refresh,
    } : null), [isOn, refresh, t, wall.canRefresh, wall.isRefreshing]);
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
    const localTab = availableLocalTabLabel(chrome.tabs);
    const { accountView, needsRelogin, providerLabel } = online;
    const wallHint = useMemo(
        () => onlineWallHint({ accountView, needsRelogin, providerLabel }, localTab, t),
        [accountView, localTab, needsRelogin, providerLabel, t],
    );
    const wallRules = useMemo(() => ({
        filterKey: 'explore',
        loading: isOn && items.length === 0 && (!feed || feed.status === 'loading'),
        hint: wallHint,
    }), [feed, isOn, items.length, wallHint]);
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
        ...quickActions,
        wall: wallRules,
        home,
        shape: isOn ? shape : undefined,
    }), [home, isInteractive, isOn, items, onOpenItem, onPlayItem, quickActions, seam, shape, wallRules]);
    useBravaisLayerRegistration('home', layer);
    return null;
};

export default BravaisHomeExplore;
