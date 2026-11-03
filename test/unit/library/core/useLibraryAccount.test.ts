// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/core/useLibraryAccount.test.ts
// 账户绑定（A3）：订阅 controller 快照，登录会话原样交出（登录窗口自己定画什么），切换确认与失败后的自检翻译好；
// 细粒度 selector 只在自己那一块变化时重渲染。
// controller 用一个只有 getSnapshot / subscribe 的假实现驱动（动作由 controller 自己的单测覆盖）。

// 翻译函数身份稳定（真实 i18n 在语言不变时也是），带插值时把参数拼进结果，便于断言。
const translate = vi.hoisted(() => (key: string, values?: Record<string, unknown>) => (
    values ? `${key}${JSON.stringify(values)}` : key
));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    translateLoginSelfCheck,
    useLibraryAccount,
    useLibraryAccountLogin,
    useLibraryAccountPendingSwitch,
    useLibraryAccountProviders,
    type LibraryAccountView,
} from '@/library/core/account/useLibraryAccount';
import type {
    LibraryAccountController,
    LibraryAccountSnapshot,
    LibraryLoginSessionSnapshot,
} from '@/library/core/account/account.contract';
import type { ProviderAccountSummary } from '@/types/onlineMusic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const provider = (providerId: string, shortName: string): ProviderAccountSummary => ({
    providerId,
    displayName: `${shortName} display`,
    shortName,
    availability: { configured: true },
    status: 'authenticated',
    user: null,
    collections: [],
});

const PROVIDERS = [provider('netease', 'NetEase'), provider('quill', 'Quill')];

const quillLogin: LibraryLoginSessionSnapshot = {
    id: 3,
    providerId: 'quill',
    phase: 'expired',
    methods: [
        { id: 'qq', labelKey: 'home.qqLoginMethodQq', iconKey: 'qq' },
        { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
    ],
    selectedMethodId: 'wechat',
    inBrowser: false,
    codeImage: 'qr.png',
    canReopenLoginPage: true,
    failure: null,
    selfCheck: null,
    localService: { available: false, failed: false, error: null, restarting: false },
    texts: null,
};

const createFakeController = (initial: LibraryAccountSnapshot) => {
    let snapshot = initial;
    const listeners = new Set<() => void>();
    const controller = {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    } as unknown as LibraryAccountController;
    return {
        controller,
        set: (patch: Partial<LibraryAccountSnapshot>) => {
            snapshot = { ...snapshot, ...patch };
            act(() => { for (const listener of [...listeners]) listener(); });
        },
        listenerCount: () => listeners.size,
    };
};

const baseSnapshot = (): LibraryAccountSnapshot => ({
    providers: PROVIDERS,
    activeProviderId: 'netease',
    login: null,
    pendingSwitch: null,
    logout: { providerId: null, status: 'idle' },
    lastLoginCompletion: null,
});

let root: Root | null = null;

const mount = (element: React.ReactElement) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(element));
};

afterEach(() => {
    act(() => root?.unmount());
    root = null;
});

describe('useLibraryAccount', () => {
    it('hands over the sign-in as it is, translates the pending switch, and follows controller updates', () => {
        const fake = createFakeController(baseSnapshot());
        let view: LibraryAccountView | null = null;
        let login: LibraryLoginSessionSnapshot | null = null;
        const Probe = () => {
            view = useLibraryAccount(fake.controller);
            login = useLibraryAccountLogin(fake.controller);
            return null;
        };
        mount(React.createElement(Probe));

        expect(login).toBeNull();
        expect(view!.pendingSwitch).toBeNull();

        fake.set({ login: quillLogin, pendingSwitch: { id: 7, from: 'netease', to: 'quill', reason: 'activate-after-login' } });

        expect(view!.snapshot.login).toBe(quillLogin);
        expect(login).toBe(quillLogin);
        // 确认框里的平台名与 omni.getProviderLabel 同一取法（shortName 优先）。
        expect(view!.pendingSwitch).toEqual({
            request: { id: 7, from: 'netease', to: 'quill', reason: 'activate-after-login' },
            title: 'home.switchOnlineProvider',
            description: 'home.confirmOnlineProviderSwitch{"provider":"Quill"}',
        });
    });

    it('translates the self-check: still running, failed, or its verdict with the layers it checked', () => {
        expect(translateLoginSelfCheck(translate as never, null, 'Quill')).toBeNull();
        expect(translateLoginSelfCheck(translate as never, { status: 'running' }, 'Quill')).toMatchObject({ running: true, verdict: null, items: [] });
        expect(translateLoginSelfCheck(translate as never, { status: 'failed', message: 'IPC closed' }, 'Quill')).toMatchObject({ running: false, verdict: null });
        const done = translateLoginSelfCheck(translate as never, {
            status: 'done',
            result: { providerId: 'quill', runtime: 'electron', startedAt: 0, durationMs: 9, backend: null, proxy: null, hosts: [] },
            verdict: { kind: 'network-ok', detail: null, proxy: null },
        }, 'Quill');
        expect(done).toMatchObject({ running: false, error: null });
        expect(done!.verdict).toEqual(expect.any(String));
    });

    it('re-renders a fine-grained subscriber only when its own slice changes', () => {
        const fake = createFakeController({ ...baseSnapshot(), login: quillLogin });
        const renders = { login: 0, switch: 0, providers: 0 };
        const LoginProbe = () => { useLibraryAccountLogin(fake.controller); renders.login += 1; return null; };
        const SwitchProbe = () => { useLibraryAccountPendingSwitch(fake.controller); renders.switch += 1; return null; };
        const ProvidersProbe = () => { useLibraryAccountProviders(fake.controller); renders.providers += 1; return null; };
        mount(React.createElement(React.Fragment, null,
            React.createElement(LoginProbe),
            React.createElement(SwitchProbe),
            React.createElement(ProvidersProbe)));
        const initial = { ...renders };

        // 只换了登出状态：三块都没变，谁都不重渲染。
        fake.set({ logout: { providerId: 'netease', status: 'pending' } });
        expect(renders).toEqual(initial);

        // 只换了 provider 列表：登录不动；切换确认与账户列表读它，会重渲染。
        fake.set({ providers: [...PROVIDERS] });
        expect(renders.login).toBe(initial.login);
        expect(renders.providers).toBe(initial.providers + 1);

        fake.set({ login: null });
        expect(renders.login).toBe(initial.login + 1);
        expect(renders.providers).toBe(initial.providers + 1);
    });

    it('unsubscribes on unmount', () => {
        const fake = createFakeController(baseSnapshot());
        const Probe = () => { useLibraryAccount(fake.controller); return null; };
        mount(React.createElement(Probe));
        expect(fake.listenerCount()).toBeGreaterThan(0);

        act(() => root?.unmount());
        root = null;

        expect(fake.listenerCount()).toBe(0);
    });
});
