import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OmniProviderCapabilities, ProviderAccountSummary, ProviderCollection } from '@/types/onlineMusic';
import {
    cycleIndex,
    homeGroupOfTab,
    homeScanPercent,
    isHomeImportBusy,
    isOnlineHomeTab,
    onlineHomeTitleKey,
    resolveHomeGroups,
    resolveHomeOnlineSource,
    resolveHomeTabs,
    resolveLocalUnavailableReason,
    resolveOnlineHomeLoading,
    resolveOnlineTabUnavailableReason,
    translateHomeMessage,
    translateHomeTabs,
} from '@/library/core/home/homeSources';

// test/unit/library/core/homeSources.test.ts
// 首页来源与页签（原 Grid3D 的派生与写在 JSX 里的页签列表）：账户 / 歌单的回退、能力 → 页签可用性与原因、
// 页签顺序与显示开关、在线加载态、导入的「忙」与扫描百分比。

const t = ((key: string, values?: Record<string, unknown>) => (
    values ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})` : key
)) as unknown as TFunction;

const ALL: OmniProviderCapabilities = {
    search: true,
    playback: true,
    lyrics: true,
    auth: true,
    userLibrary: true,
    playlists: true,
    albums: true,
    artists: true,
    recommendations: true,
    mutations: true,
    wordByWordLyrics: true,
    userAlbums: true,
};
const NONE: OmniProviderCapabilities = { ...ALL, userLibrary: false, playlists: false, recommendations: false, userAlbums: false };

const collection = (id: string, type = 'playlist'): ProviderCollection => ({ providerId: 'netease', id, name: id, type });
const summary = (patch: Partial<ProviderAccountSummary>): ProviderAccountSummary => ({
    providerId: 'p',
    displayName: 'Provider P',
    shortName: 'P',
    status: 'authenticated',
    collections: [],
    ...patch,
} as ProviderAccountSummary);

const source = (patch: Partial<Parameters<typeof resolveHomeOnlineSource>[0]> = {}) => resolveHomeOnlineSource({
    providerId: 'p',
    capabilities: ALL,
    fallbackLabel: 'fallback',
    platformAvailable: true,
    ...patch,
});

describe('resolveHomeOnlineSource', () => {
    it('prefers the provider summary: its user, collections and short name', () => {
        const user = { id: 7, nickname: 'U' };
        const owned = collection('owned');
        const online = source({ provider: summary({ user, collections: [owned] }) });
        expect(online).toMatchObject({ providerId: 'p', providerLabel: 'P', user, collections: [owned], accountView: 'authenticated', needsRelogin: false });
    });

    // Folium 2.0 方案 §7：网易云不再有「应用传入的旧账户」这条退路，账户只走账号层。
    it('has no account without the provider summary, NetEase like any other', () => {
        const netease = source({ providerId: 'netease' });
        expect(netease.user).toBeNull();
        expect(netease.collections).toEqual([]);
        expect(netease.providerLabel).toBe('fallback');
        expect(netease.accountView).not.toBe('authenticated');
    });

    it('maps capabilities onto the three online tabs', () => {
        expect(source({ capabilities: ALL })).toMatchObject({ canUsePlaylists: true, canUseAlbums: true, canUseRadio: true, hasPersonalFmModes: false });
        expect(source({ capabilities: { ...ALL, userAlbums: false, personalFmModes: true } })).toMatchObject({ canUseAlbums: false, hasPersonalFmModes: true });
        expect(source({ capabilities: NONE })).toMatchObject({ canUsePlaylists: false, canUseAlbums: false, canUseRadio: false });
    });

    it('reads the account view and an expired login from the summary', () => {
        expect(source({ provider: summary({ status: 'unknown', hydration: 'loading' } as Partial<ProviderAccountSummary>) }).accountView).toBe('resolving');
        expect(source({ provider: summary({ status: 'anonymous' }), platformAvailable: true }).accountView).toBe('guest');
        expect(source({ provider: summary({ requiresAccount: false } as Partial<ProviderAccountSummary>) }).accountView).toBe('accountless');
        expect(source({ provider: summary({ error: 'auth-required' } as Partial<ProviderAccountSummary>) }).needsRelogin).toBe(true);
    });
});

describe('home tabs', () => {
    const online = source();
    const supported = { supported: true, reason: null } as const;

    it('lists playlist, radio, albums, local and navidrome in that order', () => {
        const tabs = resolveHomeTabs({
            visibility: { folia: false, playlist: true, radio: true, explore: false, albums: true, local: true },
            navidromeEnabled: true,
            online,
            localAvailability: supported,
        });
        expect(tabs.map(tab => tab.key)).toEqual(['playlist', 'radio', 'albums', 'local', 'navidrome']);
        expect(tabs.every(tab => !tab.disabledReason)).toBe(true);
        expect(translateHomeTabs(tabs, t).map(tab => tab.label)).toEqual(['home.playlists', 'home.radioTab', 'home.albums', 'localMusic.folder', 'navidrome.title']);
    });

    it('hides the tabs the layout settings turn off and Navidrome when it is disabled', () => {
        const tabs = resolveHomeTabs({
            visibility: { folia: false, playlist: true, radio: false, explore: false, albums: true, local: false },
            navidromeEnabled: false,
            online,
            localAvailability: supported,
        });
        expect(tabs.map(tab => tab.key)).toEqual(['playlist', 'albums']);
    });

    it('shows explore after radio only when the provider has a page of its own and the setting is on', () => {
        const visibility = { folia: false, playlist: true, radio: true, explore: true, albums: true, local: false };
        const withPage = source({ capabilities: { ...ALL, explore: true } });
        const keysOf = (online: ReturnType<typeof source>, shown = visibility) => resolveHomeTabs({
            visibility: shown,
            navidromeEnabled: false,
            online,
            localAvailability: supported,
        }).map(tab => tab.key);
        expect(keysOf(withPage)).toEqual(['playlist', 'radio', 'explore', 'albums']);
        expect(keysOf(source())).toEqual(['playlist', 'radio', 'albums']);
        expect(keysOf(withPage, { ...visibility, explore: false })).toEqual(['playlist', 'radio', 'albums']);
    });

    it('gives each unavailable tab its reason, naming the provider', () => {
        const tabs = translateHomeTabs(resolveHomeTabs({
            visibility: { folia: false, playlist: true, radio: true, explore: false, albums: true, local: true },
            navidromeEnabled: false,
            online: source({ capabilities: NONE }),
            localAvailability: { supported: false, reason: 'insecure-http' },
        }), t);
        expect(tabs.map(tab => [tab.key, tab.disabledReason])).toEqual([
            ['playlist', 'status.providerLibraryUnavailable(provider=fallback)'],
            ['radio', 'status.providerRecommendationsUnavailable(provider=fallback)'],
            ['albums', 'status.providerUserAlbumsUnavailable(provider=fallback)'],
            ['local', 'localMusic.insecureHttpDisabled'],
        ]);
    });

    it('a missing translation falls back (Navidrome)', () => {
        expect(translateHomeMessage((() => '') as unknown as TFunction, { key: 'navidrome.title', fallback: 'Navidrome' })).toBe('Navidrome');
    });

    it('explains why local is unavailable', () => {
        expect(resolveLocalUnavailableReason({ supported: true, reason: null })).toBeUndefined();
        expect(resolveLocalUnavailableReason({ supported: false, reason: 'insecure-http' })?.key).toBe('localMusic.insecureHttpDisabled');
        expect(resolveLocalUnavailableReason({ supported: false, reason: 'file-system-api-unavailable' })?.key).toBe('localMusic.importNotSupported');
    });

    it('knows the online tabs and their titles', () => {
        expect(['playlist', 'radio', 'albums', 'explore', 'local', 'navidrome'].map(tab => isOnlineHomeTab(tab as never))).toEqual([true, true, true, true, false, false]);
        expect(onlineHomeTitleKey('playlist')).toBe('home.playlists');
        expect(onlineHomeTitleKey('albums')).toBe('home.albums');
        expect(onlineHomeTitleKey('radio')).toBe('home.radioTab');
        expect(onlineHomeTitleKey('explore')).toBe('home.explore');
        expect(resolveOnlineTabUnavailableReason(online, 'radio')).toBeUndefined();
    });
});

describe('home groups (two-level tabs)', () => {
    const supported = { supported: true, reason: null } as const;
    const everything = { folia: true, playlist: true, radio: true, explore: true, albums: true, local: true };
    const pages = (online = source({ capabilities: { ...ALL, explore: true } }), visibility = everything, navidromeEnabled = true) => (
        translateHomeTabs(resolveHomeTabs({ visibility, navidromeEnabled, online, localAvailability: supported }), t)
    );
    const groupsOf = (options: Partial<Parameters<typeof resolveHomeGroups>[0]> = {}) => resolveHomeGroups({
        tabs: pages(),
        active: 'playlist',
        onlineLabel: 'Source',
        rememberedOnlineTab: 'playlist',
        ...options,
    });

    it('every page a version before two-level tabs could store belongs to a group', () => {
        expect((['playlist', 'radio', 'albums', 'explore', 'local', 'navidrome', 'folia'] as const).map(homeGroupOfTab))
            .toEqual(['online', 'online', 'online', 'online', 'local', 'navidrome', 'folia']);
    });

    it('puts Folia first among the pages when the suite has it and the setting shows it', () => {
        expect(pages().map(tab => tab.key)).toEqual(['folia', 'playlist', 'radio', 'explore', 'albums', 'local', 'navidrome']);
        expect(pages(undefined, { ...everything, folia: false }).map(tab => tab.key)).toEqual(['playlist', 'radio', 'explore', 'albums', 'local', 'navidrome']);
    });

    it('orders the groups Folia, online, local, Navidrome and names the online one after the source', () => {
        const groups = groupsOf();
        expect(groups.map(group => [group.key, group.label, group.tabs.map(tab => tab.key)])).toEqual([
            ['folia', 'home.foliaTab', ['folia']],
            ['online', 'Source', ['playlist', 'radio', 'explore', 'albums']],
            ['local', 'localMusic.folder', ['local']],
            ['navidrome', 'navidrome.title', ['navidrome']],
        ]);
        expect(groups.map(group => group.active)).toEqual([false, true, false, false]);
    });

    it('leaves out a group with no page shown', () => {
        const tabs = pages(undefined, { folia: false, playlist: false, radio: false, explore: false, albums: false, local: true }, false);
        expect(groupsOf({ tabs, active: 'local' }).map(group => group.key)).toEqual(['local']);
    });

    it('the online group goes back to the page it was last on, or stays on the current one', () => {
        const online = (options: Partial<Parameters<typeof resolveHomeGroups>[0]>) => groupsOf(options).find(group => group.key === 'online')?.target;
        expect(online({ active: 'local', rememberedOnlineTab: 'radio' })).toBe('radio');
        expect(online({ active: 'albums', rememberedOnlineTab: 'radio' })).toBe('albums');
    });

    it('a remembered page that is gone or unavailable gives way to the first available one', () => {
        // Explore is not a page of this source; the playlists are not available either.
        const tabs = pages(source({ capabilities: { ...ALL, playlists: false } }));
        const online = groupsOf({ tabs, active: 'local', rememberedOnlineTab: 'explore' }).find(group => group.key === 'online');
        expect(online?.tabs.map(tab => tab.key)).toEqual(['playlist', 'radio', 'albums']);
        expect(online?.target).toBe('radio');
    });

    it('the online group stays selectable with no page available: its page says why', () => {
        const online = groupsOf({ tabs: pages(source({ capabilities: NONE })), active: 'local' }).find(group => group.key === 'online');
        expect(online?.target).toBe('playlist');
        expect(online?.disabledReason).toBeUndefined();
    });

    it('another group with its only page unavailable is disabled with that page\'s reason', () => {
        const tabs = translateHomeTabs(resolveHomeTabs({
            visibility: everything,
            navidromeEnabled: false,
            online: source(),
            localAvailability: { supported: false, reason: 'insecure-http' },
        }), t);
        const local = groupsOf({ tabs }).find(group => group.key === 'local');
        expect(local?.target).toBeNull();
        expect(local?.disabledReason).toBe('localMusic.insecureHttpDisabled');
    });
});

describe('online loading and import state', () => {
    it('the playlist tab is loading while a signed-in account has no playlists yet', () => {
        const signedIn = source({ provider: summary({ user: { id: 1, nickname: 'U' } }) });
        const base = { favoriteAlbumsLoading: false, radioFeedLoading: false };
        expect(resolveOnlineHomeLoading({ ...base, tab: 'playlist', source: signedIn })).toBe(true);
        expect(resolveOnlineHomeLoading({ ...base, tab: 'playlist', source: { ...signedIn, collections: [collection('a')] } })).toBe(false);
        expect(resolveOnlineHomeLoading({ ...base, tab: 'playlist', source: { ...signedIn, user: null } })).toBe(false);
        expect(resolveOnlineHomeLoading({ ...base, tab: 'playlist', source: { ...signedIn, canUsePlaylists: false } })).toBe(false);
    });

    it('albums and radio follow their resources, unless the tab is unavailable', () => {
        const online = source();
        expect(resolveOnlineHomeLoading({ tab: 'albums', source: online, favoriteAlbumsLoading: true, radioFeedLoading: false })).toBe(true);
        expect(resolveOnlineHomeLoading({ tab: 'albums', source: { ...online, canUseAlbums: false }, favoriteAlbumsLoading: true, radioFeedLoading: false })).toBe(false);
        expect(resolveOnlineHomeLoading({ tab: 'radio', source: online, favoriteAlbumsLoading: true, radioFeedLoading: false })).toBe(false);
        expect(resolveOnlineHomeLoading({ tab: 'radio', source: online, favoriteAlbumsLoading: false, radioFeedLoading: true })).toBe(true);
        expect(resolveOnlineHomeLoading({ tab: 'local', source: online, favoriteAlbumsLoading: true, radioFeedLoading: true })).toBe(false);
    });

    it('any import in flight or an active scan makes the import buttons busy', () => {
        const idle = { importingFolder: false, refreshingFolders: false, importingPlaylist: false, scan: null };
        expect(isHomeImportBusy(idle)).toBe(false);
        expect(isHomeImportBusy({ ...idle, importingFolder: true })).toBe(true);
        expect(isHomeImportBusy({ ...idle, refreshingFolders: true })).toBe(true);
        expect(isHomeImportBusy({ ...idle, importingPlaylist: true })).toBe(true);
        expect(isHomeImportBusy({ ...idle, scan: { active: true, folderName: 'A', totalSongs: 1, completedSongs: 0 } })).toBe(true);
    });

    it('the scan percentage is rounded and capped', () => {
        expect(homeScanPercent(null)).toBe(0);
        expect(homeScanPercent({ active: true, folderName: 'A', totalSongs: 0, completedSongs: 0 })).toBe(0);
        expect(homeScanPercent({ active: true, folderName: 'A', totalSongs: 3, completedSongs: 1 })).toBe(33);
        expect(homeScanPercent({ active: true, folderName: 'A', totalSongs: 3, completedSongs: 5 })).toBe(100);
    });
});

describe('cycleIndex（首页 Tab / F6 循环）', () => {
    const tabs = [
        { key: 'playlist', disabled: false },
        { key: 'radio', disabled: true },
        { key: 'albums', disabled: false },
        { key: 'local', disabled: false },
    ];
    const enabled = (tab: { disabled: boolean }) => !tab.disabled;

    it('跳过不可用项，首尾绕回', () => {
        expect(cycleIndex(tabs, 0, 1, enabled)).toBe(2);
        expect(cycleIndex(tabs, 2, -1, enabled)).toBe(0);
        expect(cycleIndex(tabs, 3, 1, enabled)).toBe(0);
        expect(cycleIndex(tabs, 0, -1, enabled)).toBe(3);
    });

    it('当前项不在列表里时，往后落到第一个可用项，往前落到最后一个', () => {
        expect(cycleIndex(tabs, -1, 1, enabled)).toBe(0);
        expect(cycleIndex(tabs, -1, -1, enabled)).toBe(3);
    });

    it('只剩当前项可用时停在原地；全都不可用或列表为空时返回 -1', () => {
        expect(cycleIndex(tabs, 0, 1, tab => tab.key === 'playlist')).toBe(0);
        expect(cycleIndex(tabs, 0, 1, () => false)).toBe(-1);
        expect(cycleIndex([], -1, 1, () => true)).toBe(-1);
    });
});
