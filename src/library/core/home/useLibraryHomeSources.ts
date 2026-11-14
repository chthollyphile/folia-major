import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { HomeViewTab } from '../../../types';
import type { ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type { LibraryHomeOnlineSource, LibraryHomeTabView } from './homeModel.contract';
import type { LibraryAccountController } from '../account/account.contract';
import { isOnlineHomeTab, resolveHomeOnlineSource, resolveHomeTabs, translateHomeTabs } from './homeSources';
import { resolveActiveProviderSummary } from '../account/accountRules';
import { readOnlineProviderCapabilities, readOnlineProviderLabel } from './online/onlineHomeProvider.service';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { useHomeLayoutSettingsStore } from '../../../stores/useHomeLayoutSettingsStore';
import { usePersonalFmCatalog } from '../../../hooks/usePersonalFmCatalog';
import { selectProviderPersonalFm, usePersonalFmModeStore } from '../../../stores/usePersonalFmModeStore';
import { getLocalLibraryAvailability } from '../../../services/localLibraryAvailability';
import { getPersonalFmSelectionLabel } from '../../../services/onlineMusic/fmModes';
import { useLibraryAccountProviders } from '../account/useLibraryAccount';
import { useLxSquareCollections } from './online/useLxSquareCollections';

// src/library/core/home/useLibraryHomeSources.ts
// 首页的来源与一级页签：当前页签（搜索导航 store 持有）、当前在线来源（provider、账户、能力）、
// 页签列表与不可用原因（规则在 core/home/homeSources，这里翻译）、私人 FM 卡上显示的当前模式。
// 只订阅这几样（页签、页签显示开关、FM 模式），别的 store 写入不会让首页重渲染。

export type LibraryHomeSources = {
    tab: HomeViewTab;
    setTab: (tab: HomeViewTab) => void;
    isOnlineTab: boolean;
    online: LibraryHomeOnlineSource;
    tabs: LibraryHomeTabView[];
    /** FM 卡上的当前模式（provider 不支持模式时为空）。 */
    personalFmModeLabel: string;
};

export const useLibraryHomeSources = ({
    account,
    user,
    playlists,
    cloudPlaylist = null,
    navidromeEnabled = false,
}: {
    /** 在线账户 controller：当前平台与它的账户摘要来自快照（未变时身份稳定）。 */
    account: LibraryAccountController;
    /** 应用传入的旧账户与歌单（只有网易云在平台还没给出摘要时用）。 */
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    navidromeEnabled?: boolean;
}): LibraryHomeSources => {
    const { t } = useTranslation();
    const { tab, setTab } = useSearchNavigationStore(useShallow(state => ({
        tab: state.homeViewTab,
        setTab: state.setHomeViewTab,
    })));
    const visibility = useHomeLayoutSettingsStore(useShallow(state => ({
        playlist: state.showHomeTabPlaylist,
        radio: state.showHomeTabRadio,
        explore: state.showHomeTabExplore,
        albums: state.showHomeTabAlbums,
        local: state.showHomeTabLocal,
    })));
    // The FM card doubles as the mode readout: the card is the only place the current mode shows
    // up outside the player, and the picker can change it while this grid stays mounted.
    const { providers, activeProviderId: providerId } = useLibraryAccountProviders(account);
    const catalog = usePersonalFmCatalog(providerId);
    const personalFmSelection = usePersonalFmModeStore(state => selectProviderPersonalFm(state, providerId));
    const provider = useMemo(() => resolveActiveProviderSummary(providers, providerId), [providerId, providers]);
    const capabilities = readOnlineProviderCapabilities(providerId);
    const { userLibrary, playlists: canListPlaylists, userAlbums, recommendations, personalFmModes, explore } = capabilities;
    const onlineBase = useMemo(() => resolveHomeOnlineSource({
        providerId,
        provider,
        capabilities: { ...capabilities, userLibrary, playlists: canListPlaylists, userAlbums, recommendations, personalFmModes, explore },
        fallbackLabel: readOnlineProviderLabel(providerId),
        fallbackUser: user,
        fallbackPlaylists: playlists,
        fallbackCloud: cloudPlaylist,
        platformAvailable: true,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capabilities 每次读都是新对象，有意按下面用到的几个开关比较
    }), [
        // capabilities 每次读都是新对象：按用到的几个开关比较。
        canListPlaylists, cloudPlaylist, explore, personalFmModes, playlists, provider, providerId, recommendations, user, userAlbums, userLibrary,
    ]);

    /*
     * 洛雪没有账号，也就没有「我的收藏歌单」—— 它的歌单页本来是空的（capabilities.userLibrary 为 false，
     * 页签直接判成不可用）。解法：选中洛雪时这一屏换成四家平台的公开歌单广场（四家交替排，点进去是真实曲目）。
     * 只换首页这一屏的数据来源，登录 / 搜索 / 播放仍走洛雪自己。
     * 广场还没取到时保持原本的空状态，免得先闪一下「没有歌单」再跳出来。
     */
    const isLxmusic = providerId === 'lxmusic';
    const lxSquare = useLxSquareCollections(isLxmusic);
    const online = useMemo(() => {
        if (!isLxmusic) return onlineBase;
        const hasSquare = lxSquare.length > 0;
        return {
            ...onlineBase,
            collections: hasSquare ? lxSquare : onlineBase.collections,
            canUsePlaylists: true,
            /*
             * 推荐（榜单）与专辑这两屏在洛雪下也换成了自己的卡流（LxChartBoard / LxAlbumWall），
             * 数据全走公开接口，不依赖账号。可 provider 的能力声明里没有「我的专辑 / 私人电台」，
             * 于是这两颗页签一直被挂上 disabledReason，字色被压暗、悬停提示是「暂未提供」，
             * 明明点得动却像个坏按钮。这里按实际能力把两颗都放行。
             */
            canUseRadio: true,
            canUseAlbums: true,
            // 有内容就按「已就绪」显示：否则整个墙会空着只剩登录入口，而洛雪压根不登录。
            ...(hasSquare ? { accountView: 'authenticated' as const } : {}),
        };
    }, [isLxmusic, lxSquare, onlineBase]);

    // The explore tab is gone after a switch to a provider without one, and a stored choice of it
    // may be older than the switch.
    useEffect(() => {
        if (tab === 'explore' && !online.canUseExplore) setTab('playlist');
    }, [online.canUseExplore, setTab, tab]);

    const localAvailability = getLocalLibraryAvailability();
    const tabs = useMemo(() => translateHomeTabs(resolveHomeTabs({
        visibility,
        navidromeEnabled,
        online,
        localAvailability: { supported: localAvailability.supported, reason: localAvailability.reason },
    }), t), [localAvailability.reason, localAvailability.supported, navidromeEnabled, online, t, visibility]);

    const personalFmModeLabel = online.hasPersonalFmModes
        ? getPersonalFmSelectionLabel(personalFmSelection, (key, fallback) => t(key, fallback ?? ''), catalog)
        : '';

    return {
        tab,
        setTab,
        isOnlineTab: isOnlineHomeTab(tab),
        online,
        tabs,
        personalFmModeLabel,
    };
};
