import type { TFunction } from 'i18next';
import type { OmniProviderCapabilities, ProviderAccountSummary, ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
import type {
    LibraryHomeActionsSnapshot,
    LibraryHomeLocalAvailability,
    LibraryHomeMessage,
    LibraryHomeOnlineSource,
    LibraryHomeOnlineTab,
    LibraryHomeScanProgress,
    LibraryHomeTab,
    LibraryHomeTabKey,
    LibraryHomeTabView,
} from '../contracts/homeModel';
import type { LibraryHiddenScope } from '../contracts/directory';
import { resolveOnlineProviderAccountView } from './onlineProviderAccountView';
import { directoryKey } from './directorySession';
import { onlineHiddenScope } from './directoryVisibility';

// src/library/core/model/homeSources.ts
// 首页的来源与页签（纯规则，原样搬自 Grid3D）：当前在线 provider 的账户、歌单与能力；一级页签的列表、顺序与
// 不可用原因（原先直接写在 Grid3D 的 JSX 里）；在线列表的加载态；本地导入的「忙」与扫描百分比。
// 文案只给 i18n key（LibraryHomeMessage），由绑定翻译。

const ONLINE_TABS: readonly LibraryHomeOnlineTab[] = ['playlist', 'radio', 'albums'];

export const isOnlineHomeTab = (tab: LibraryHomeTabKey): tab is LibraryHomeOnlineTab => (
    (ONLINE_TABS as readonly string[]).includes(tab)
);

/** 翻译一条首页文案；翻译为空时用 fallback。 */
export const translateHomeMessage = (t: TFunction, message: LibraryHomeMessage): string => (
    (message.values ? t(message.key, message.values) : t(message.key)) || message.fallback || ''
);

/**
 * 当前在线来源。provider 的账户摘要优先；只有网易云在平台还没给出摘要时才退回应用传入的旧账户与歌单
 * （原先 Grid3D 的写法）。能力缺失按「全不支持」处理（provider 可能刚被 mod 移除）。
 */
export const resolveHomeOnlineSource = ({
    providerId,
    provider,
    capabilities,
    fallbackLabel,
    fallbackUser,
    fallbackPlaylists,
    fallbackCloud,
    platformAvailable,
}: {
    providerId: string;
    provider?: ProviderAccountSummary;
    capabilities: OmniProviderCapabilities;
    /** provider 摘要里没有名字时的标签（omni.getProviderLabel）。 */
    fallbackLabel: string;
    fallbackUser: ProviderUser | null;
    fallbackPlaylists: readonly ProviderCollection[];
    fallbackCloud?: ProviderCollection | null;
    platformAvailable: boolean;
}): LibraryHomeOnlineSource => {
    const isNetease = providerId === 'netease';
    const user = provider?.user || (isNetease ? fallbackUser : null);
    return {
        providerId,
        providerLabel: provider?.shortName || provider?.displayName || fallbackLabel,
        provider,
        user,
        accountView: resolveOnlineProviderAccountView({ provider, hasUser: Boolean(user), platformAvailable }),
        needsRelogin: provider?.error === 'auth-required',
        collections: provider?.collections || (isNetease
            ? [...fallbackPlaylists, ...(fallbackCloud ? [fallbackCloud] : [])]
            : []),
        canUsePlaylists: capabilities.userLibrary && capabilities.playlists,
        canUseAlbums: capabilities.userLibrary && Boolean(capabilities.userAlbums),
        canUseRadio: capabilities.recommendations,
        hasPersonalFmModes: Boolean(capabilities.personalFmModes),
        hasHeartbeatRecommendations: Boolean(capabilities.heartbeatRecommendations)
            && provider?.status === 'authenticated' && Boolean(provider.user),
    };
};

/** 某个在线页签为什么不可用（可用时为 undefined）。 */
export const resolveOnlineTabUnavailableReason = (
    source: Pick<LibraryHomeOnlineSource, 'providerLabel' | 'canUsePlaylists' | 'canUseAlbums' | 'canUseRadio'>,
    tab: LibraryHomeOnlineTab,
): LibraryHomeMessage | undefined => {
    const values = { provider: source.providerLabel };
    if (tab === 'playlist') return source.canUsePlaylists ? undefined : { key: 'status.providerLibraryUnavailable', values };
    if (tab === 'albums') return source.canUseAlbums ? undefined : { key: 'status.providerUserAlbumsUnavailable', values };
    return source.canUseRadio ? undefined : { key: 'status.providerRecommendationsUnavailable', values };
};

/** 本地曲库为什么不可用（可用时为 undefined）。 */
export const resolveLocalUnavailableReason = (availability: LibraryHomeLocalAvailability): LibraryHomeMessage | undefined => {
    if (availability.supported) return undefined;
    return { key: availability.reason === 'insecure-http' ? 'localMusic.insecureHttpDisabled' : 'localMusic.importNotSupported' };
};

/** 首页设置里各页签的显示开关（Navidrome 由是否启用决定）。 */
export type LibraryHomeTabVisibility = {
    playlist: boolean;
    radio: boolean;
    albums: boolean;
    local: boolean;
};

/** 一级页签：顺序是 歌单、电台、专辑、本地、Navidrome；隐藏的页签不出现，不可用的带原因。 */
export const resolveHomeTabs = ({
    visibility,
    navidromeEnabled,
    online,
    localAvailability,
}: {
    visibility: LibraryHomeTabVisibility;
    navidromeEnabled: boolean;
    online: Pick<LibraryHomeOnlineSource, 'providerLabel' | 'canUsePlaylists' | 'canUseAlbums' | 'canUseRadio'>;
    localAvailability: LibraryHomeLocalAvailability;
}): LibraryHomeTab[] => [
    ...(visibility.playlist ? [{ key: 'playlist' as const, label: { key: 'home.playlists' }, disabledReason: resolveOnlineTabUnavailableReason(online, 'playlist') }] : []),
    ...(visibility.radio ? [{ key: 'radio' as const, label: { key: 'home.radio' }, disabledReason: resolveOnlineTabUnavailableReason(online, 'radio') }] : []),
    ...(visibility.albums ? [{ key: 'albums' as const, label: { key: 'home.albums' }, disabledReason: resolveOnlineTabUnavailableReason(online, 'albums') }] : []),
    ...(visibility.local ? [{ key: 'local' as const, label: { key: 'localMusic.folder' }, disabledReason: resolveLocalUnavailableReason(localAvailability) }] : []),
    ...(navidromeEnabled ? [{ key: 'navidrome' as const, label: { key: 'navidrome.title', fallback: 'Navidrome' } }] : []),
];

/**
 * 在列表里按 delta 找下一个可用项（绕回）；全都不可用时返回 -1。两套首页的 Tab / F6 循环共用。
 * current 不在列表里（-1）时，往后从第一个找起，往前从最后一个找起。
 */
export const cycleIndex = <T,>(items: readonly T[], current: number, delta: 1 | -1, enabled: (item: T) => boolean): number => {
    const start = current >= 0 ? current : delta === 1 ? -1 : items.length;
    for (let step = 1; step <= items.length; step += 1) {
        const index = (((start + delta * step) % items.length) + items.length) % items.length;
        if (enabled(items[index])) return index;
    }
    return -1;
};

/** 翻译页签（label 与不可用原因）。 */
export const translateHomeTabs = (tabs: readonly LibraryHomeTab[], t: TFunction): LibraryHomeTabView[] => tabs.map(tab => ({
    key: tab.key,
    label: translateHomeMessage(t, tab.label),
    ...(tab.disabledReason ? { disabledReason: translateHomeMessage(t, tab.disabledReason) } : {}),
}));

/** 在线页签的标题文案 key。 */
export const onlineHomeTitleKey = (tab: LibraryHomeOnlineTab): string => (
    tab === 'playlist' ? 'home.playlists' : tab === 'albums' ? 'home.albums' : 'home.radio'
);

/**
 * 在线列表是否在加载：歌单页签在账户已登录、歌单还没到时；专辑 / 电台页签在对应资源读取中时。
 * 页签不可用时不算加载（显示不可用原因）。
 */
export const resolveOnlineHomeLoading = ({
    tab,
    source,
    favoriteAlbumsLoading,
    radioFeedLoading,
}: {
    tab: LibraryHomeTabKey;
    source: Pick<LibraryHomeOnlineSource, 'canUsePlaylists' | 'canUseAlbums' | 'canUseRadio' | 'collections' | 'user'>;
    favoriteAlbumsLoading: boolean;
    radioFeedLoading: boolean;
}): boolean => (
    (tab === 'playlist' && source.canUsePlaylists && source.collections.length === 0 && source.user !== null)
    || (tab === 'albums' && source.canUseAlbums && favoriteAlbumsLoading)
    || (tab === 'radio' && source.canUseRadio && radioFeedLoading)
);

/** 三个本地导入动作（导入文件夹、刷新、导入歌单文件）此刻是否都该禁用：任何一个在进行，或扫描在进行。 */
export const isHomeImportBusy = (snapshot: LibraryHomeActionsSnapshot): boolean => (
    snapshot.importingFolder
    || snapshot.importingPlaylist
    || snapshot.refreshingFolders
    || Boolean(snapshot.scan?.active)
);

/** 扫描进度的百分比（0–100，取整）。 */
export const homeScanPercent = (scan: LibraryHomeScanProgress | null): number => (
    scan?.totalSongs
        ? Math.min(100, Math.round((scan.completedSongs / scan.totalSongs) * 100))
        : 0
);

/**
 * 首页当前列表的目录会话 key（GridMap / TUI 目录的筛选与批选按它分开）。原先三个首页视图各自在 JSX 里算，
 * 现在只在这里：在线按 provider 与页签（歌单页签记作 playlists），本地与 Navidrome 按 section。
 */
export const resolveHomeDirectoryKey = ({
    tab,
    providerId,
    localSection,
    navidromeSection,
}: {
    tab: LibraryHomeTabKey;
    providerId: string;
    localSection: string;
    navidromeSection: string;
}): string => {
    if (tab === 'local') return directoryKey({ source: 'local', section: localSection });
    if (tab === 'navidrome') return directoryKey({ source: 'navidrome', section: navidromeSection });
    return directoryKey({ source: 'online', providerId, section: tab === 'playlist' ? 'playlists' : tab });
};

/** 首页当前列表的隐藏作用域：在线按 provider，本地与 Navidrome 各一个。 */
export const resolveHomeHiddenScope = (tab: LibraryHomeTabKey, providerId: string): LibraryHiddenScope => (
    tab === 'local' ? 'local' : tab === 'navidrome' ? 'navidrome' : onlineHiddenScope(providerId)
);

/** 首页的一个来源：在线（歌单 / 电台 / 专辑三个页签）、本地、Navidrome。 */
export type LibraryHomeSourceGroup = {
    source: 'online' | 'local' | 'navidrome';
    /** 这个来源下的页签（在线是三个，本地与 Navidrome 各一个），顺序同一级页签。 */
    tabs: LibraryHomeTabView[];
    /** 全部页签都不可用时为第一个页签的原因（来源整个不可用）。 */
    disabledReason?: string;
};

/**
 * 把一级页签按来源分组（列表形态的首页——TUI——用两级：来源、来源下的分区）。隐藏了的页签不在 tabs 里，
 * 一个页签都没有的来源不出现。
 */
export const resolveHomeSourceGroups = (tabs: readonly LibraryHomeTabView[]): LibraryHomeSourceGroup[] => {
    const groups: LibraryHomeSourceGroup[] = [];
    const push = (source: LibraryHomeSourceGroup['source'], members: LibraryHomeTabView[]) => {
        if (members.length === 0) return;
        const enabled = members.some(tab => !tab.disabledReason);
        groups.push({ source, tabs: members, ...(enabled ? {} : { disabledReason: members[0].disabledReason }) });
    };
    push('online', tabs.filter(tab => isOnlineHomeTab(tab.key)));
    push('local', tabs.filter(tab => tab.key === 'local'));
    push('navidrome', tabs.filter(tab => tab.key === 'navidrome'));
    return groups;
};
