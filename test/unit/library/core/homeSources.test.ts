import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OmniProviderCapabilities, ProviderAccountSummary, ProviderCollection } from '@/types/onlineMusic';
import {
    cycleIndex,
    homeScanPercent,
    isHomeImportBusy,
    isOnlineHomeTab,
    onlineHomeTitleKey,
    resolveHomeOnlineSource,
    resolveHomeTabs,
    resolveLocalUnavailableReason,
    resolveOnlineHomeLoading,
    resolveOnlineTabUnavailableReason,
    translateHomeMessage,
    translateHomeTabs,
} from '@/library/core/model/homeSources';

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
    fallbackUser: null,
    fallbackPlaylists: [],
    platformAvailable: true,
    ...patch,
});

describe('resolveHomeOnlineSource', () => {
    it('requires both provider capability and a signed-in owner for Heartbeat', () => {
        const capabilities = { ...ALL, heartbeatRecommendations: true };
        const provider = summary({ user: { id: 1, nickname: 'N' } });
        expect(source({ capabilities, provider }).hasHeartbeatRecommendations).toBe(true);
        expect(source({ provider }).hasHeartbeatRecommendations).toBe(false);
        expect(source({ capabilities }).hasHeartbeatRecommendations).toBe(false);
        expect(source({ capabilities, provider: summary({ status: 'anonymous' }) }).hasHeartbeatRecommendations).toBe(false);
        expect(source({ capabilities, provider: summary({}) }).hasHeartbeatRecommendations).toBe(false);
    });
    it('prefers the provider summary: its user, collections and short name', () => {
        const user = { id: 7, nickname: 'U' };
        const owned = collection('owned');
        const online = source({ provider: summary({ user, collections: [owned] }) });
        expect(online).toMatchObject({ providerId: 'p', providerLabel: 'P', user, collections: [owned], accountView: 'authenticated', needsRelogin: false });
    });

    it('falls back to the app account and playlists (cloud last) only for netease', () => {
        const user = { id: 1, nickname: 'N' };
        const playlists = [collection('a'), collection('b')];
        const cloud = collection('cloud', 'cloud');
        const netease = source({ providerId: 'netease', fallbackUser: user, fallbackPlaylists: playlists, fallbackCloud: cloud });
        expect(netease.user).toBe(user);
        expect(netease.collections.map(item => item.id)).toEqual(['a', 'b', 'cloud']);
        expect(netease.providerLabel).toBe('fallback');

        const other = source({ providerId: 'other', fallbackUser: user, fallbackPlaylists: playlists, fallbackCloud: cloud });
        expect(other.user).toBeNull();
        expect(other.collections).toEqual([]);
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
            visibility: { playlist: true, radio: true, albums: true, local: true },
            navidromeEnabled: true,
            online,
            localAvailability: supported,
        });
        expect(tabs.map(tab => tab.key)).toEqual(['playlist', 'radio', 'albums', 'local', 'navidrome']);
        expect(tabs.every(tab => !tab.disabledReason)).toBe(true);
        expect(translateHomeTabs(tabs, t).map(tab => tab.label)).toEqual(['home.playlists', 'home.radio', 'home.albums', 'localMusic.folder', 'navidrome.title']);
    });

    it('hides the tabs the layout settings turn off and Navidrome when it is disabled', () => {
        const tabs = resolveHomeTabs({
            visibility: { playlist: true, radio: false, albums: true, local: false },
            navidromeEnabled: false,
            online,
            localAvailability: supported,
        });
        expect(tabs.map(tab => tab.key)).toEqual(['playlist', 'albums']);
    });

    it('gives each unavailable tab its reason, naming the provider', () => {
        const tabs = translateHomeTabs(resolveHomeTabs({
            visibility: { playlist: true, radio: true, albums: true, local: true },
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
        expect(['playlist', 'radio', 'albums', 'local', 'navidrome'].map(tab => isOnlineHomeTab(tab as never))).toEqual([true, true, true, false, false]);
        expect(onlineHomeTitleKey('playlist')).toBe('home.playlists');
        expect(onlineHomeTitleKey('albums')).toBe('home.albums');
        expect(onlineHomeTitleKey('radio')).toBe('home.radio');
        expect(resolveOnlineTabUnavailableReason(online, 'radio')).toBeUndefined();
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
