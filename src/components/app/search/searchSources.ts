import { useMemo, useSyncExternalStore } from 'react';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type { SearchSource } from '../../../stores/useSearchNavigationStore';
import { resolveParticipants } from '../../../services/onlineMusic/crossSource';
import { resolveActiveProviderId } from '../../../library/core/account/accountRules';
import { omni } from '../../../services/onlineMusic/omni';
import { getNavidromeConfig } from '../../../services/navidromeService';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { useLibraryStore } from '../../../stores/useLibraryStore';
import { getSourceDeclaration } from '../../../services/onlineMusic/sourceDeclarations';

// src/components/app/search/searchSources.ts
// 搜索页列出哪些来源：当前在线平台，加上已经登录的、不需要登录的在线平台；本地曲库里有歌才列本地，Navidrome
// 开着并且填好了服务器才列它。没登录的在线平台不列（搜到了也放不了它的歌）。别的在线平台列不列，按跨音源功能的
// 同一条规则（services/onlineMusic/crossSource.ts）：没注册的不在摘要里，没配好的、要账号而没登录的跳过，跳过的不画。
// 要不要账号：Folium 2 的音源按它 search@1 的 access（sourceDeclarations.ts）；内置平台照旧按有没有账号。
// 只用于匹配的音源（Folium 2.0 方案 §5.3）不在 omni.getProviderSummaries 里（只列启用的），所以不进联邦搜索。
// 搜不了的平台（Folium 2 的音源没有 search@1）一个都不列，当前平台也不列：点开它只会是空结果（S4 桌面实测发现，S5 修）。

type SearchSourceAvailability = {
    providers: readonly ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    hasLocalSongs: boolean;
    navidromeReady: boolean;
    /** Whether the platform has a search at all (omni.getProviderSearchKinds); every one has when left out. */
    canSearch?: (providerId: OnlineProviderId) => boolean;
};

/** 按上面的规则排出来源：当前平台在最前，其余在线平台按注册顺序，然后本地、Navidrome。 */
export const resolveSearchSources = ({
    providers,
    activeProviderId,
    hasLocalSongs,
    navidromeReady,
    canSearch = () => true,
}: SearchSourceAvailability): SearchSource[] => {
    const byId = new Map(providers.filter(provider => canSearch(provider.providerId)).map(provider => [provider.providerId, provider]));
    const { ready: others } = resolveParticipants(
        [...byId.values()]
            .filter(provider => provider.providerId !== activeProviderId)
            .map(provider => ({
                sourceId: provider.providerId,
                access: getSourceDeclaration(provider.providerId)?.search?.access
                    ?? (provider.requiresAccount === false ? 'anonymous' as const : 'account' as const),
                checksAvailability: true,
            })),
        ({ sourceId }) => {
            const provider = byId.get(sourceId);
            return {
                enabled: Boolean(provider),
                availability: provider?.availability ?? { configured: false },
                signedIn: provider?.status === 'authenticated',
            };
        },
        'search',
    );
    return [
        // Not with no platform at all (the active id then names none), nor where the active one has no search.
        ...(byId.has(activeProviderId) ? [activeProviderId] : []),
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

// 平台增减和音源状态切换（启用 / 只用于匹配 / 停用）都经这一对通知。
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
                canSearch: providerId => omni.getProviderSearchKinds(providerId).length > 0,
            }),
        };
    // signIns 与 registryVersion 只为在它们变了时重读摘要。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signIns, hasLocalSongs, navidromeReady, registryVersion, storedProviderId]);
};
