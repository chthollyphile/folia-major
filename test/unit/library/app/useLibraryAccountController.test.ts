// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/app/useLibraryAccountController.test.ts
// 应用持有的在线账户 controller（A4）用真实的默认装配（omni、账户 store、provider 注册表）跑：
// - 原 test/unit/onlineMusic/onlineProviderPlatform.test.ts 的几条（Folium mod 源运行时增删：列表跟着注册表、
//   不经切换写入的当前平台也跟、mod 源消失时回落网易并记住）迁到这里；切换不问、不重置搜索（搜索的来源由搜索页
//   自己按可用性回落，见 test/unit/search/searchSources.test.ts）；
// - 宿主表（退出、退出前的那一问、播放器端口）经 ref 现读最新的一份；卸载时 dispose。

const storage = vi.hoisted(() => {
    // jsdom 环境下 node 自带的 localStorage 占位没有 getItem，store 初始化会直接抛。
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
            setItem: (key: string, value: string) => { entries.set(key, String(value)); },
            removeItem: (key: string) => { entries.delete(key); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
    return entries;
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLibraryAccountController, type LibraryAccountHostTables } from '@/library/app/useLibraryAccountController';
import { useLibraryAccountProviders } from '@/library/core/account/useLibraryAccount';
import type { LibraryAccountController } from '@/library/core/account/account.contract';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';
import type { OnlineMusicProvider, OnlineProviderId, ProviderAccountSummary } from '@/types/onlineMusic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MOD_PROVIDER_ID = 'folium.mod-a.source';

// The shape a Folium mod source is adapted to: search and playback, no account.
const modProvider: OnlineMusicProvider = {
    id: MOD_PROVIDER_ID,
    displayName: 'Mod Source',
    shortName: 'Mod',
    capabilities: {
        search: true, playback: true, lyrics: true, auth: false, userLibrary: false,
        playlists: false, albums: false, artists: false, recommendations: false,
        mutations: false, wordByWordLyrics: false,
    },
    normalizeSong: () => ({
        id: '1',
        name: 'Song',
        artists: [],
        album: { id: '', name: '' },
        durationMs: 1,
        sourceRef: { kind: 'online', providerId: MOD_PROVIDER_ID, mediaId: '1' },
    }),
};

let controller: LibraryAccountController | null = null;
let view: { providers: ProviderAccountSummary[]; activeProviderId: OnlineProviderId } | null = null;
let root: Root | null = null;

const Probe = ({ tables }: { tables: LibraryAccountHostTables }) => {
    controller = useLibraryAccountController(tables);
    view = useLibraryAccountProviders(controller);
    return null;
};

const cleanup = { leaveProvider: vi.fn(), holdsSongsOf: () => true, dropSongsOf: vi.fn() };
const tables = (overrides: Partial<LibraryAccountHostTables> = {}): LibraryAccountHostTables => ({
    logout: async () => { },
    confirmLogout: async () => true,
    switchCleanup: cleanup,
    ...overrides,
});

const mount = (initial = tables()) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(Probe, { tables: initial })));
};
const rerender = (next: LibraryAccountHostTables) => {
    act(() => root!.render(React.createElement(Probe, { tables: next })));
};

/** 请求切换：不问，直接切。 */
const requestSwitch = async (providerId: OnlineProviderId) => {
    const current = controller!;
    let result: Awaited<ReturnType<LibraryAccountController['requestSwitch']>> | null = null;
    await act(async () => {
        const request = current.requestSwitch(providerId);
        expect(current.getSnapshot().pendingSwitch).toBeNull();
        result = await request;
    });
    return result;
};

beforeEach(() => {
    cleanup.leaveProvider.mockClear();
    cleanup.dropSongsOf.mockClear();
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    useSearchNavigationStore.setState({ searchSourceTab: 'netease' });
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    controller = null;
    view = null;
    unregisterOnlineMusicProvider(MOD_PROVIDER_ID);
    document.body.replaceChildren();
});

describe('application account controller with Folium mod sources', () => {
    it('lists a provider registered after the home view mounted', () => {
        mount();
        expect(view!.providers.some(provider => provider.providerId === MOD_PROVIDER_ID)).toBe(false);

        act(() => registerOnlineMusicProvider(modProvider));

        expect(view!.providers.find(provider => provider.providerId === MOD_PROVIDER_ID))
            .toMatchObject({ shortName: 'Mod', requiresAccount: false });
    });

    it('switches to a mod source without asking, and leaves the search where it was', async () => {
        registerOnlineMusicProvider(modProvider);
        mount();

        expect(await requestSwitch(MOD_PROVIDER_ID)).toEqual({ status: 'switched', providerId: MOD_PROVIDER_ID, changed: true });

        expect(view!.activeProviderId).toBe(MOD_PROVIDER_ID);
        expect(cleanup.leaveProvider).toHaveBeenCalledExactlyOnceWith('netease', MOD_PROVIDER_ID);
        expect(useSearchNavigationStore.getState().searchSourceTab).toBe('netease');
    });

    it('follows an active provider set without a switch, as after a restart', () => {
        registerOnlineMusicProvider(modProvider);
        mount();

        act(() => useOnlineProviderAccountStore.getState().setActiveProviderId(MOD_PROVIDER_ID));

        expect(view!.activeProviderId).toBe(MOD_PROVIDER_ID);
        expect(cleanup.leaveProvider).not.toHaveBeenCalled();
    });

    // Folium 2.0 方案 §7 第一行：只在内存里回落，存的选择不改；音源回来后自动又是当前平台。
    it('falls back in memory when the active mod source goes away, and takes it back when it returns', async () => {
        registerOnlineMusicProvider(modProvider);
        useOnlineProviderAccountStore.getState().setActiveProviderId(MOD_PROVIDER_ID);
        mount();
        expect(view!.activeProviderId).toBe(MOD_PROVIDER_ID);

        await act(async () => {
            unregisterOnlineMusicProvider(MOD_PROVIDER_ID);
            await Promise.resolve();
        });

        expect(view!.activeProviderId).toBe('netease');
        expect(view!.providers.some(provider => provider.providerId === MOD_PROVIDER_ID)).toBe(false);
        expect(storage.get('active_online_provider_id')).toBe(MOD_PROVIDER_ID);

        await act(async () => {
            registerOnlineMusicProvider(modProvider);
            await Promise.resolve();
        });
        expect(view!.activeProviderId).toBe(MOD_PROVIDER_ID);
        expect(storage.get('active_online_provider_id')).toBe(MOD_PROVIDER_ID);
    });
});

describe('application account controller host tables', () => {
    it('keeps one controller across renders and asks through the newest table before signing out through it', async () => {
        useOnlineProviderAccountStore.getState().updateAccount('netease', {
            status: 'authenticated',
            user: { id: 'u1', nickname: 'U1' },
            collections: [],
            hydration: 'ready',
            freshness: 'fresh',
        });
        const staleAsk = vi.fn().mockResolvedValue(false);
        const freshAsk = vi.fn().mockResolvedValue(true);
        const stale = vi.fn().mockResolvedValue(undefined);
        const fresh = vi.fn().mockResolvedValue(undefined);
        mount(tables({ confirmLogout: staleAsk, logout: stale }));
        const first = controller;
        rerender(tables({ confirmLogout: freshAsk, logout: fresh }));
        expect(controller).toBe(first);

        let result: unknown = null;
        await act(async () => {
            result = await controller!.logout('netease');
        });

        expect(result).toEqual({ status: 'logged-out', providerId: 'netease' });
        expect(freshAsk).toHaveBeenCalledExactlyOnceWith({ providerId: 'netease', removesSongs: true });
        expect(fresh).toHaveBeenCalledExactlyOnceWith('netease');
        expect(staleAsk).not.toHaveBeenCalled();
        expect(stale).not.toHaveBeenCalled();
        // Signing out takes that platform's songs out of the player, and nothing else.
        expect(cleanup.dropSongsOf).toHaveBeenCalledExactlyOnceWith('netease');
        useOnlineProviderAccountStore.getState().clearAccount('netease');
    });

    it('disposes the controller on unmount: a later switch is declined', async () => {
        registerOnlineMusicProvider(modProvider);
        mount();
        const current = controller!;

        act(() => root!.unmount());
        root = null;

        await expect(current.requestSwitch(MOD_PROVIDER_ID)).resolves.toEqual({ status: 'declined', providerId: MOD_PROVIDER_ID, reason: 'disposed' });
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe('netease');
        expect(cleanup.leaveProvider).not.toHaveBeenCalled();
    });
});
