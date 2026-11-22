import type { TFunction } from 'i18next';
import type { OmniProviderCapabilities, ProviderAccountSummary } from '../../../types/onlineMusic';
import type {
    LibraryHomeActionsSnapshot,
    LibraryHomeGroupKey,
    LibraryHomeGroupView,
    LibraryHomeLocalAvailability,
    LibraryHomeMessage,
    LibraryHomeOnlineSource,
    LibraryHomeOnlineTab,
    LibraryHomeScanProgress,
    LibraryHomeTab,
    LibraryHomeTabKey,
    LibraryHomeTabView,
} from './homeModel.contract';
import type { LibraryHiddenScope } from '../directory/directory.contract';
import { resolveOnlineProviderAccountView } from '../account/onlineProviderAccountView';
import { directoryKey } from '../directory/directorySession';
import { onlineHiddenScope } from '../directory/directoryVisibility';

// src/library/core/home/homeSources.ts
// 首页的来源与页签（纯规则，原样搬自 Grid3D）：当前在线 provider 的账户、歌单与能力；一级页签的列表、顺序与
// 不可用原因（原先直接写在 Grid3D 的 JSX 里）；在线列表的加载态；本地导入的「忙」与扫描百分比。
// 文案只给 i18n key（LibraryHomeMessage），由绑定翻译。
// 首页是两级页签：一级是组（Folia、当前在线音源、本地、Navidrome），二级是组里的页。存下来的是「页」，组由页推出
// （homeGroupOfTab）；resolveHomeTabs 给全部的页，resolveHomeGroups 把它们分进组、定每个组点了去哪一页。

const ONLINE_TABS: readonly LibraryHomeOnlineTab[] = ['playlist', 'radio', 'albums', 'explore'];

export const isOnlineHomeTab = (tab: LibraryHomeTabKey): tab is LibraryHomeOnlineTab => (
    (ONLINE_TABS as readonly string[]).includes(tab)
);

/** 这一页在哪个一级组里。 */
export const homeGroupOfTab = (tab: LibraryHomeTabKey): LibraryHomeGroupKey => (
    tab === 'folia' ? 'folia' : tab === 'local' ? 'local' : tab === 'navidrome' ? 'navidrome' : 'online'
);

/** 翻译一条首页文案；翻译为空时用 fallback。 */
export const translateHomeMessage = (t: TFunction, message: LibraryHomeMessage): string => (
    (message.values ? t(message.key, message.values) : t(message.key)) || message.fallback || ''
);

/**
 * 当前在线来源。账户与歌单只取 provider 的账户摘要（账号层），没有摘要（平台不在、零音源）时就是没有账户；原来
 * 只给网易云的「应用传入的旧账户与歌单」那条退路已删（Folium 2.0 方案 §7）。能力缺失按「全不支持」处理（provider
 * 可能刚被 mod 移除）。
 */
export const resolveHomeOnlineSource = ({
    providerId,
    provider,
    capabilities,
    fallbackLabel,
    platformAvailable,
}: {
    providerId: string;
    provider?: ProviderAccountSummary;
    capabilities: OmniProviderCapabilities;
    /** provider 摘要里没有名字时的标签（omni.getProviderLabel）。 */
    fallbackLabel: string;
    platformAvailable: boolean;
}): LibraryHomeOnlineSource => {
    const user = provider?.user || null;
    return {
        providerId,
        providerLabel: provider?.shortName || provider?.displayName || fallbackLabel,
        provider,
        user,
        accountView: resolveOnlineProviderAccountView({ provider, hasUser: Boolean(user), platformAvailable }),
        needsRelogin: provider?.error === 'auth-required',
        collections: provider?.collections || [],
        canUsePlaylists: capabilities.userLibrary && capabilities.playlists,
        canUseAlbums: capabilities.userLibrary && Boolean(capabilities.userAlbums),
        canUseRadio: capabilities.recommendations,
        canUseExplore: Boolean(capabilities.explore),
        hasPersonalFmModes: Boolean(capabilities.personalFmModes),
    };
};

/** 某个在线页签为什么不可用（可用时为 undefined）。 */
export const resolveOnlineTabUnavailableReason = (
    source: Pick<LibraryHomeOnlineSource, 'providerLabel' | 'canUsePlaylists' | 'canUseAlbums' | 'canUseRadio' | 'canUseExplore'>,
    tab: LibraryHomeOnlineTab,
): LibraryHomeMessage | undefined => {
    const values = { provider: source.providerLabel };
    if (tab === 'playlist') return source.canUsePlaylists ? undefined : { key: 'status.providerLibraryUnavailable', values };
    if (tab === 'albums') return source.canUseAlbums ? undefined : { key: 'status.providerUserAlbumsUnavailable', values };
    if (tab === 'explore') return source.canUseExplore ? undefined : { key: 'status.providerRecommendationsUnavailable', values };
    return source.canUseRadio ? undefined : { key: 'status.providerRecommendationsUnavailable', values };
};

/** 本地曲库为什么不可用（可用时为 undefined）。 */
export const resolveLocalUnavailableReason = (availability: LibraryHomeLocalAvailability): LibraryHomeMessage | undefined => {
    if (availability.supported) return undefined;
    return { key: availability.reason === 'insecure-http' ? 'localMusic.insecureHttpDisabled' : 'localMusic.importNotSupported' };
};

/** 首页设置里各页签的显示开关（Navidrome 由是否启用决定）。 */
export type LibraryHomeTabVisibility = {
    /** Folia 组（聚合歌单）。 */
    folia: boolean;
    playlist: boolean;
    radio: boolean;
    explore: boolean;
    albums: boolean;
    local: boolean;
};

/**
 * 全部的页：顺序是 Folia、歌单、电台、探索、专辑、本地、Navidrome（组的顺序是 Folia、在线、本地、Navidrome，
 * 在线组里四页的顺序照旧）；隐藏的页不出现，不可用的带原因。
 * 探索只在平台有推荐页时出现（没有时不是「不可用」，是没有这一页）。
 */
export const resolveHomeTabs = ({
    visibility,
    navidromeEnabled,
    online,
    localAvailability,
}: {
    visibility: LibraryHomeTabVisibility;
    navidromeEnabled: boolean;
    online: Pick<LibraryHomeOnlineSource, 'providerLabel' | 'canUsePlaylists' | 'canUseAlbums' | 'canUseRadio' | 'canUseExplore'>;
    localAvailability: LibraryHomeLocalAvailability;
}): LibraryHomeTab[] => [
    ...(visibility.folia ? [{ key: 'folia' as const, label: { key: 'home.foliaTab', fallback: 'Folia' } }] : []),
    ...(visibility.playlist ? [{ key: 'playlist' as const, label: { key: 'home.playlists' }, disabledReason: resolveOnlineTabUnavailableReason(online, 'playlist') }] : []),
    ...(visibility.radio ? [{ key: 'radio' as const, label: { key: 'home.radioTab' }, disabledReason: resolveOnlineTabUnavailableReason(online, 'radio') }] : []),
    ...(visibility.explore && online.canUseExplore ? [{ key: 'explore' as const, label: { key: 'home.explore' } }] : []),
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
    tab === 'playlist' ? 'home.playlists' : tab === 'albums' ? 'home.albums' : tab === 'explore' ? 'home.explore' : 'home.radioTab'
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
    // Folia 组只有聚合歌单这一个列表：自己的 key，不和别的列表共用筛选与批选。
    if (tab === 'folia') return 'home:folia';
    if (tab === 'local') return directoryKey({ source: 'local', section: localSection });
    if (tab === 'navidrome') return directoryKey({ source: 'navidrome', section: navidromeSection });
    return directoryKey({ source: 'online', providerId, section: tab === 'playlist' ? 'playlists' : tab });
};

/**
 * 首页当前列表的隐藏作用域：在线按 provider，本地与 Navidrome 各一个。Folia 的歌单沿用本地那一个
 * （它们是从本地歌单迁来的，卡片 id 没变，以前隐藏过的仍然隐藏）。
 */
export const resolveHomeHiddenScope = (tab: LibraryHomeTabKey, providerId: string): LibraryHiddenScope => (
    tab === 'local' || tab === 'folia' ? 'local' : tab === 'navidrome' ? 'navidrome' : onlineHiddenScope(providerId)
);

const GROUP_ORDER: readonly LibraryHomeGroupKey[] = ['folia', 'online', 'local', 'navidrome'];

/**
 * 把全部的页分进一级组（两级页签的首页——网格与 Bravais——按它画一级那一排）。一页都没有的组不出现。
 * - 在线组的名字是 onlineLabel（当前在线音源的列表名；一个音源都没启用时调用方给通用的词），其余组用自己那一页的名字。
 * - target：组里记住的那一页可用就是它（在线组是 rememberedOnlineTab，当前页在这个组里时就是当前页），否则第一个可用的。
 *   在线组一页都不可用时仍给第一页、不带 disabledReason：那一页自己说明为什么不可用（没登录、没启用音源）。
 */
export const resolveHomeGroups = ({
    tabs,
    active,
    onlineLabel,
    rememberedOnlineTab,
}: {
    tabs: readonly LibraryHomeTabView[];
    active: LibraryHomeTabKey;
    onlineLabel: string;
    rememberedOnlineTab: LibraryHomeOnlineTab;
}): LibraryHomeGroupView[] => {
    const activeGroup = homeGroupOfTab(active);
    return GROUP_ORDER.flatMap((key): LibraryHomeGroupView[] => {
        const members = tabs.filter(tab => homeGroupOfTab(tab.key) === key);
        if (members.length === 0) return [];
        const usable = (candidate: LibraryHomeTabKey) => members.find(tab => tab.key === candidate && !tab.disabledReason);
        const remembered = key === 'online' ? rememberedOnlineTab : members[0].key;
        const enabled = (activeGroup === key ? usable(active) : undefined) ?? usable(remembered) ?? members.find(tab => !tab.disabledReason);
        const target = enabled?.key ?? (key === 'online' ? members[0].key : null);
        return [{
            key,
            label: key === 'online' ? onlineLabel : members[0].label,
            active: activeGroup === key,
            tabs: [...members],
            target,
            ...(target === null ? { disabledReason: members[0].disabledReason } : {}),
        }];
    });
};
/** 首页的一个来源：在线（歌单 / 电台 / 探索 / 专辑）、本地、Navidrome。 */
export type LibraryHomeSourceGroup = {
    source: 'online' | 'local' | 'navidrome';
    /** 这个来源下的页签（在线最多四个，本地与 Navidrome 各一个），顺序同一级页签。 */
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
