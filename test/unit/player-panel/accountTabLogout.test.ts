// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/player-panel/accountTabLogout.test.ts
// 面板账户页（AccountTab）的登出按钮跟账户 controller 的判定走（A4 遗留①）：网易启动 / 首次刷新时，App 的 user
// 已经有了（面板显示昵称），账户 store 却还没写成 authenticated，controller 这时会以 not-authenticated 拒绝登出。
// 按钮在这段窗口里不可用（而不是点了没反应）；controller 判定可登出后才可用，登出进行中再次不可用。

vi.hoisted(() => {
    // jsdom 环境下 node 自带的 localStorage 占位没有 getItem，i18n 初始化会直接抛。
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
});

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AccountTab from '@/components/panelTab/AccountTab';
import type { LibraryAccountController, LibraryAccountSnapshot } from '@/library/core/account/account.contract';
import type { ProviderAccountSummary, ProviderUser } from '@/types/onlineMusic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cachedUser: ProviderUser = { id: 42, nickname: 'Cached Netease User', avatarUrl: '' } as ProviderUser;

const netease = (status: ProviderAccountSummary['status'], user: ProviderUser | null): ProviderAccountSummary => ({
    providerId: 'netease',
    displayName: 'NetEase Cloud Music',
    shortName: '网易云',
    availability: { configured: true },
    requiresAccount: true,
    status,
    user,
    collections: [],
    hydration: status === 'unknown' ? 'loading' : 'ready',
});

/** 只实现 AccountTab 用到的那一面：快照、订阅与登出；快照可以由用例改写并通知。 */
const createFakeController = (initial: LibraryAccountSnapshot) => {
    let snapshot = initial;
    const listeners = new Set<() => void>();
    const logout = vi.fn(async (providerId: string) => ({ status: 'logged-out' as const, providerId }));
    const controller = {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        logout,
    } as unknown as LibraryAccountController;
    const update = (patch: Partial<LibraryAccountSnapshot>) => {
        snapshot = { ...snapshot, ...patch };
        act(() => listeners.forEach(listener => listener()));
    };
    return { controller, logout, update };
};

const snapshotWith = (provider: ProviderAccountSummary): LibraryAccountSnapshot => ({
    providers: [provider],
    activeProviderId: provider.providerId,
    login: null,
    pendingSwitch: null,
    logout: { providerId: null, status: 'idle' },
    lastLoginCompletion: null,
});

let root: Root | null = null;

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
});

const renderAccountTab = (controller: LibraryAccountController) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(AccountTab, {
        accountController: controller,
        audioQuality: 'high',
        onAudioQualityChange: () => {},
        onSyncData: () => {},
        isSyncing: false,
        onNavigateHome: () => {},
    })));
    const logoutButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="account.logout"]');
    return { host, logoutButton };
};

describe('account tab logout', () => {
    it('shows the cached NetEase user but keeps logout unavailable until the controller would accept it', () => {
        // 刷新落定之前：快照里网易还是 unknown，账号已经是缓存的那个。
        const fake = createFakeController(snapshotWith(netease('unknown', cachedUser)));
        const { host, logoutButton } = renderAccountTab(fake.controller);

        expect(host.textContent).toContain('Cached Netease User');
        expect(logoutButton()).not.toBeNull();
        expect(logoutButton()!.getAttribute('aria-disabled') === 'true').toBe(true);
        act(() => logoutButton()!.click());
        expect(fake.logout).not.toHaveBeenCalled();

        // 刷新落定、controller 判定可登出：按钮可用，点了走 controller 的登出。
        fake.update({ providers: [netease('authenticated', cachedUser)] });
        expect(logoutButton()!.getAttribute('aria-disabled') === 'true').toBe(false);
        act(() => logoutButton()!.click());
        expect(fake.logout).toHaveBeenCalledWith('netease');
    });

    it('disables logout while a logout is in flight', () => {
        const fake = createFakeController(snapshotWith(netease('authenticated', cachedUser)));
        const { logoutButton } = renderAccountTab(fake.controller);
        expect(logoutButton()!.getAttribute('aria-disabled') === 'true').toBe(false);

        fake.update({ logout: { providerId: 'netease', status: 'pending' } });
        expect(logoutButton()!.getAttribute('aria-disabled') === 'true').toBe(true);

        fake.update({ logout: { providerId: null, status: 'idle' } });
        expect(logoutButton()!.getAttribute('aria-disabled') === 'true').toBe(false);
    });
});
