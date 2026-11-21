import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { HomeViewTab } from '../../../types';
import type { ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type {
    LibraryHomeGroupKey,
    LibraryHomeGroupView,
    LibraryHomeOnlineSource,
    LibraryHomeOnlineSwitcher,
    LibraryHomeOnlineSwitchResult,
    LibraryHomeTabView,
} from './homeModel.contract';
import type { LibraryAccountController } from '../account/account.contract';
import { homeGroupOfTab, isOnlineHomeTab, resolveHomeGroups, resolveHomeOnlineSource, resolveHomeTabs, translateHomeTabs } from './homeSources';
import { resolveActiveProviderSummary } from '../account/accountRules';
import { readOnlineProviderCapabilities, readOnlineProviderLabel } from './online/onlineHomeProvider.service';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { useHomeLayoutSettingsStore } from '../../../stores/useHomeLayoutSettingsStore';
import { usePersonalFmCatalog } from '../../../hooks/usePersonalFmCatalog';
import { selectProviderPersonalFm, usePersonalFmModeStore } from '../../../stores/usePersonalFmModeStore';
import { getLocalLibraryAvailability } from '../../../services/localLibraryAvailability';
import { getPersonalFmSelectionLabel } from '../../../services/onlineMusic/fmModes';
import { providerDisplayName } from '../../../i18n/providerName';
import { useLibraryAccountProviders } from '../account/useLibraryAccount';

// src/library/core/home/useLibraryHomeSources.ts
// 首页的来源与页签：当前页（搜索导航 store 持有）、当前在线来源（provider、账户、能力）、
// 页签列表与不可用原因（规则在 core/home/homeSources，这里翻译）、私人 FM 卡上显示的当前模式。
// 只订阅这几样（页签、页签显示开关、FM 模式），别的 store 写入不会让首页重渲染。
// 两级页签：tabs 是全部的页，groups 把它们分进一级组（Folia、当前在线音源、本地、Navidrome），在线组的名字是当前
// 音源的名字，onlineSwitcher 是那个一级页签上的音源切换器（列表与选择都来自账户 controller，不另存状态）。

export type LibraryHomeSources = {
    tab: HomeViewTab;
    setTab: (tab: HomeViewTab) => void;
    isOnlineTab: boolean;
    online: LibraryHomeOnlineSource;
    /** 全部的页，按页签条的顺序（各组的页挨着）。 */
    tabs: LibraryHomeTabView[];
    /** 一级组（Folia 组只在 suite 要了它时有，见 folia 参数）。 */
    groups: LibraryHomeGroupView[];
    /** 当前页所在的组。 */
    group: LibraryHomeGroupKey;
    /** 在线组一级页签上的音源切换器。 */
    onlineSwitcher: LibraryHomeOnlineSwitcher;
    /** FM 卡上的当前模式（provider 不支持模式时为空）。 */
    personalFmModeLabel: string;
};

export const useLibraryHomeSources = ({
    account,
    navidromeEnabled = false,
    folia = false,
}: {
    /** 在线账户 controller：当前平台与它的账户摘要来自快照（未变时身份稳定）。 */
    account: LibraryAccountController;
    /**
     * 不再读：账户与歌单只取平台的账户摘要（Folium 2.0 方案 §7）。各 suite 仍把首页的账户交进来，留着这几个字段
     * 免得改动冻结的 TUI。
     */
    user?: ProviderUser | null;
    playlists?: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    navidromeEnabled?: boolean;
    /**
     * 这套首页有 Folia 组（网格与 Bravais 给 true）。没给的（冻结的 TUI）看到的是没有 Folia 的首页：页里没有它，
     * 存下的当前页是 Folia 时按在线组上次停的那一页显示（不改存下的值，换回有 Folia 的 suite 仍在 Folia）。
     */
    folia?: boolean;
}): LibraryHomeSources => {
    const { t } = useTranslation();
    const { storedTab, rememberedOnlineTab, setTab } = useSearchNavigationStore(useShallow(state => ({
        storedTab: state.homeViewTab,
        rememberedOnlineTab: state.homeOnlineTab,
        setTab: state.setHomeViewTab,
    })));
    const tab = storedTab === 'folia' && !folia ? rememberedOnlineTab : storedTab;
    const visibility = useHomeLayoutSettingsStore(useShallow(state => ({
        folia: folia && state.showHomeTabFolia,
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
    const online = useMemo(() => resolveHomeOnlineSource({
        providerId,
        provider,
        capabilities: { ...capabilities, userLibrary, playlists: canListPlaylists, userAlbums, recommendations, personalFmModes, explore },
        fallbackLabel: readOnlineProviderLabel(providerId),
        platformAvailable: true,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capabilities 每次读都是新对象，有意按下面用到的几个开关比较
    }), [
        // capabilities 每次读都是新对象：按用到的几个开关比较。
        canListPlaylists, explore, personalFmModes, provider, providerId, recommendations, userAlbums, userLibrary,
    ]);

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

    // 一个音源都没启用（或还没有一个注册上来）：在线组的名字是通用的词。
    const noSources = providers.length === 0;
    const onlineLabel = noSources ? t('home.onlineGroup') : online.providerLabel;
    const groups = useMemo(
        () => resolveHomeGroups({ tabs, active: tab, onlineLabel, rememberedOnlineTab }),
        [onlineLabel, rememberedOnlineTab, tab, tabs],
    );

    const selectProvider = useCallback(async (id: string): Promise<LibraryHomeOnlineSwitchResult> => {
        const result = await account.selectProvider(id);
        if (result.action === 'login') return 'login';
        return result.action === 'switch' && result.result.status === 'switched' ? 'switched' : 'unavailable';
    }, [account]);
    const onlineSwitcher = useMemo<LibraryHomeOnlineSwitcher>(() => ({
        empty: noSources,
        options: providers.map(entry => ({
            providerId: entry.providerId,
            label: providerDisplayName(t, entry, entry.providerId),
            active: entry.providerId === providerId,
            disabled: !entry.availability.configured,
            detail: !entry.availability.configured
                ? t('home.providerNotConfigured')
                : entry.requiresAccount === false
                    ? t('home.providerNoAccount')
                    : entry.user?.nickname || t('home.sourceNotSignedIn'),
        })),
        select: selectProvider,
    }), [noSources, providerId, providers, selectProvider, t]);

    const personalFmModeLabel = online.hasPersonalFmModes
        ? getPersonalFmSelectionLabel(personalFmSelection, (key, fallback) => t(key, fallback ?? ''), catalog)
        : '';

    return {
        tab,
        setTab,
        isOnlineTab: isOnlineHomeTab(tab),
        online,
        tabs,
        groups,
        group: homeGroupOfTab(tab),
        onlineSwitcher,
        personalFmModeLabel,
    };
};
