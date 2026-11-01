import { useMemo, useSyncExternalStore } from 'react';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type { SearchSource } from '../../../stores/useSearchNavigationStore';
import { canSwitchToProviderDirectly } from '../../../library/core/account/onlineProviderAccountView';
import { resolveActiveProviderId } from '../../../library/core/account/accountRules';
import { omni } from '../../../services/onlineMusic/omni';
import { getNavidromeConfig } from '../../../services/navidromeService';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { useLibraryStore } from '../../../stores/useLibraryStore';

// src/components/app/search/searchSources.ts
// 搜索页列出哪些来源：当前在线平台，加上已经登录的、不需要登录的在线平台；本地曲库里有歌才列本地，Navidrome
// 开着并且填好了服务器才列它。没登录的在线平台不列（搜到了也放不了它的歌）。

type SearchSourceAvailability = {
    providers: readonly ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    hasLocalSongs: boolean;
    navidromeReady: boolean;
};

/** 按上面的规则排出来源：当前平台在最前，其余在线平台按注册顺序，然后本地、Navidrome。 */
export const resolveSearchSources = ({
    providers,
    activeProviderId,
    hasLocalSongs,
    navidromeReady,
}: SearchSourceAvailability): SearchSource[] => {
    const others = providers
        .filter(provider => provider.providerId !== activeProviderId
            && provider.availability.configured
            && canSwitchToProviderDirectly(provider))
        .map(provider => provider.providerId);
    return [
        activeProviderId,
        ...others,
        ...(hasLocalSongs ? ['local' as const] : []),
        ...(navidromeReady ? ['navidrome' as const] : []),
    ];
};

/** Navidrome 开着，并且存着服务器地址与用户名。 */
const isNavidromeReady = (enabled: boolean): boolean => {
    if (!enabled) return false;
    const config = getNavidromeConfig();
    return Boolean(config?.serverUrl && config.username);
};

const subscribeProviders = (listener: () => void) => omni.subscribeProviders(listener);
const getProviderRegistryVersion = () => omni.getProviderRegistryVersion();

/**
 * 搜索页此刻的来源与当前平台（存的平台不在了时是回落后的那个）：账户 store 与 provider 注册表（mod 源增删）变了就重排。
 */
export const useSearchSources = (hasLocalSongs: boolean): { sources: SearchSource[]; activeProviderId: OnlineProviderId } => {
    const storedProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    // 这里只看各平台登没登录：点红心、读喜欢列表不改这串字，搜索页不跟着重渲染。
    const signIns = useOnlineProviderAccountStore(state => Object.entries(state.accounts)
        .map(([providerId, account]) => `${providerId}:${account.status}`)
        .join('|'));
    const navidromeEnabled = useLibraryStore(state => state.navidromeEnabled);
    const registryVersion = useSyncExternalStore(subscribeProviders, getProviderRegistryVersion);
    // Read on every render: saving or clearing the server settings writes no store, so nothing would tell a memo.
    const navidromeReady = isNavidromeReady(navidromeEnabled);

    return useMemo(() => {
        const providers = omni.getProviderSummaries();
        const activeProviderId = resolveActiveProviderId(providers, storedProviderId);
        return {
            activeProviderId,
            sources: resolveSearchSources({
                providers,
                activeProviderId,
                hasLocalSongs,
                navidromeReady,
            }),
        };
    // signIns 与 registryVersion 只为在它们变了时重读摘要。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signIns, hasLocalSongs, navidromeReady, registryVersion, storedProviderId]);
};
