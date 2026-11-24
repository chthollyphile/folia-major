import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/loginBackendIpc.test.ts
// 宿主不再有自己的内嵌后端（网易云是最后一个，2026-11-20 搬进 sources/netease/main）：所有后端都由音源模组的 main 入口
// 经 api.diagnostics 登记到这张表，宿主只剩诊断快照与自检两个通道。

const { createLoginDiagnosticsRegistry, registerLoginBackendIpc } = require('../../../electron/loginBackendIpc.cjs') as {
    registerLoginBackendIpc: (options: Record<string, unknown>) => {
        snapshot: (providerId: string) => Promise<Record<string, unknown> | null>;
        selfCheck: (providerId: string) => Promise<Record<string, unknown> | null>;
    };
    createLoginDiagnosticsRegistry: () => {
        register: (providerId: string, backend: object) => () => void;
        get: (providerId: unknown) => object | null;
    };
};

const createBackend = (providerId: string) => ({
    getStatus: vi.fn(() => ({ status: providerId === 'netease' ? 'running' : 'error', port: null, error: null, updatedAt: 1 })),
    // 网易的要问工作线程（异步），别的可以当场给（同步）。
    getDiagnostics: vi.fn<() => object | Promise<object>>(() => ({ backend: { status: 'running' }, startup: [], connections: [] })),
    selfCheckHosts: [`${providerId}.example`],
});

const setup = () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
    const netease = createBackend('netease');
    // 网易云模组的 main 入口经 api.diagnostics.register 登记它的后端。
    const diagnostics = createLoginDiagnosticsRegistry();
    diagnostics.register('netease', netease);
    const runSelfCheck = vi.fn(async (options: Record<string, unknown>) => ({ providerId: options.providerId }));
    const resolveProxy = vi.fn(async () => 'DIRECT');
    const isTrustedSender = vi.fn((event: { sender?: { id: number } }) => event?.sender?.id === 1);
    registerLoginBackendIpc({
        ipcMain,
        app: { getVersion: () => '0.7.14-test', getLocale: () => 'zh-CN' },
        safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret' },
        getDefaultSession: () => ({ resolveProxy }),
        diagnostics,
        runSelfCheck,
        isTrustedSender,
    });
    // fail closed 之后，通道按 event.sender 的身份给数据：invoke 默认扮主窗（id=1）。
    const trustedEvent = { sender: { id: 1 } };
    const untrustedEvent = { sender: { id: 2 } };
    const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trustedEvent, ...args);
    return { handlers, invoke, netease, runSelfCheck, resolveProxy, isTrustedSender, untrustedEvent };
};

describe('login backend IPC', () => {
    it('serves only the diagnostics and self-check channels: ports, status and restarts are the rpc of each source mod', () => {
        const { handlers } = setup();
        expect([...handlers.keys()].sort()).toEqual(['get-login-diagnostics', 'run-login-self-check']);
    });

    it('builds the diagnostics snapshot from the app environment and that backend', async () => {
        const { invoke, netease } = setup();
        // 网易的诊断要问工作线程，是异步的。
        netease.getDiagnostics.mockImplementation(async () => ({ backend: { status: 'running' }, startup: [], connections: [] }));
        const snapshot = await invoke('get-login-diagnostics', 'netease') as any;
        expect(snapshot).toMatchObject({
            providerId: 'netease',
            app: {
                version: '0.7.14-test',
                electron: process.versions.electron,
                platform: process.platform,
                locale: 'zh-CN',
                credentialStore: { encryptionAvailable: true },
            },
            backend: { status: 'running' },
        });
        // 没登记的平台没有快照。
        await expect(invoke('get-login-diagnostics', 'qq')).resolves.toBeNull();
        await expect(invoke('get-login-diagnostics', 'kugou')).resolves.toBeNull();
        await expect(invoke('get-login-diagnostics', 'constructor')).resolves.toBeNull();
    });

    it('runs the self-check against that backend with the system proxy resolver', async () => {
        const { invoke, runSelfCheck, resolveProxy } = setup();
        await expect(invoke('run-login-self-check', 'netease')).resolves.toEqual({
            providerId: 'netease',
            credentialStore: {
                encryptionAvailable: true,
                backend: process.platform === 'linux' ? 'gnome_libsecret' : null,
            },
        });
        const [options] = runSelfCheck.mock.calls[0] as [any];
        expect(options).toMatchObject({
            providerId: 'netease',
            backend: { status: 'running' },
            hosts: ['netease.example'],
        });
        await options.resolveSystemProxy('https://netease.example');
        expect(resolveProxy).toHaveBeenCalledWith('https://netease.example');
        await expect(invoke('run-login-self-check', 'kugou')).resolves.toBeNull();
    });

    it('fail closed: untrusted senders get no diagnostics and no self-check', () => {
        const { handlers, netease, runSelfCheck, untrustedEvent } = setup();
        const invokeUntrusted = (channel: string, ...args: unknown[]) => handlers.get(channel)!(untrustedEvent, ...args);

        expect(invokeUntrusted('get-login-diagnostics', 'netease')).toBeNull();
        expect(invokeUntrusted('run-login-self-check', 'netease')).toBeNull();
        expect(netease.getDiagnostics).not.toHaveBeenCalled();
        expect(runSelfCheck).not.toHaveBeenCalled();
    });

    it('fail closed even harder: no isTrustedSender injected at all means everything is untrusted', async () => {
        const handlers = new Map<string, (...args: any[]) => unknown>();
        const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
        registerLoginBackendIpc({
            ipcMain,
            app: { getVersion: () => '0.7.14-test', getLocale: () => 'zh-CN' },
            safeStorage: { isEncryptionAvailable: () => true },
            getDefaultSession: () => ({ resolveProxy: vi.fn(async () => 'DIRECT') }),
            diagnostics: (() => {
                const registry = createLoginDiagnosticsRegistry();
                registry.register('netease', createBackend('netease'));
                return registry;
            })(),
        });
        const invokeUntrusted = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { id: 1 } }, ...args);

        // 没人注入判据时连"第一方窗口"也拿不到数据：宁可不工作，不静默放开。
        expect(invokeUntrusted('get-login-diagnostics', 'netease')).toBeNull();
        expect(invokeUntrusted('run-login-self-check', 'netease')).toBeNull();
    });
});

// Folium 2.0 方案 §7（loginBackendIpc 并入 api.diagnostics）的 S1 接缝：诊断与自检按登记表找后端，不再写死平台。
describe('login diagnostics registry', () => {
    it('answers the diagnostics and self-check channels for whichever source registered, and stops once it is taken back', async () => {
        const handlers = new Map<string, (...args: any[]) => unknown>();
        const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
        const diagnostics = createLoginDiagnosticsRegistry();
        const radio = createBackend('folium.mod.radio');
        const unregister = diagnostics.register('folium.mod.radio', radio);
        const runSelfCheck = vi.fn(async (options: Record<string, unknown>) => ({ providerId: options.providerId, hosts: options.hosts }));
        registerLoginBackendIpc({
            ipcMain,
            app: { getVersion: () => '2.0.0-test', getLocale: () => 'en' },
            safeStorage: { isEncryptionAvailable: () => true },
            getDefaultSession: () => ({ resolveProxy: vi.fn(async () => 'DIRECT') }),
            diagnostics,
            runSelfCheck,
            isTrustedSender: () => true,
        });
        const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { id: 1 } }, ...args);

        await expect(invoke('get-login-diagnostics', 'folium.mod.radio')).resolves.toMatchObject({ providerId: 'folium.mod.radio', backend: { status: 'running' } });
        await expect(invoke('run-login-self-check', 'folium.mod.radio')).resolves.toMatchObject({ providerId: 'folium.mod.radio', hosts: ['folium.mod.radio.example'] });
        // Only what registered is answered.
        await expect(invoke('get-login-diagnostics', 'netease')).resolves.toBeNull();

        unregister();
        await expect(invoke('get-login-diagnostics', 'folium.mod.radio')).resolves.toBeNull();
        expect(diagnostics.get(42)).toBeNull();
    });

    it('fills in the main process connection record for a backend that has none, and hands snapshot and self-check out', async () => {
        const ipcMain = { handle: vi.fn() };
        const diagnostics = createLoginDiagnosticsRegistry();
        const own = createBackend('folium.mod.radio');
        own.getDiagnostics.mockImplementation(() => ({ backend: { status: 'running' } }));
        const kept = createBackend('folium.mod.kept');
        diagnostics.register('folium.mod.radio', own);
        diagnostics.register('folium.mod.kept', kept);
        const networkRecorder = { snapshot: vi.fn((providerId: string) => [{ host: `${providerId}.example` }]) };
        const runSelfCheck = vi.fn(async (options: Record<string, unknown>) => ({ providerId: options.providerId, backend: options.backend }));
        const { snapshot, selfCheck } = registerLoginBackendIpc({
            ipcMain,
            app: { getVersion: () => '2.0.0-test', getLocale: () => 'en' },
            safeStorage: { isEncryptionAvailable: () => false },
            getDefaultSession: () => null,
            diagnostics,
            networkRecorder,
            runSelfCheck,
            isTrustedSender: () => true,
        });

        await expect(snapshot('folium.mod.radio')).resolves.toMatchObject({
            providerId: 'folium.mod.radio',
            app: { version: '2.0.0-test' },
            backend: { status: 'running' },
            connections: [{ host: 'folium.mod.radio.example' }],
        });
        // A backend that keeps its own record is answered with it.
        await expect(snapshot('folium.mod.kept')).resolves.toMatchObject({ connections: [] });
        expect(networkRecorder.snapshot).toHaveBeenCalledExactlyOnceWith('folium.mod.radio');
        await expect(selfCheck('folium.mod.radio')).resolves.toMatchObject({
            providerId: 'folium.mod.radio',
            backend: { status: 'error' },
            credentialStore: { encryptionAvailable: false },
        });
        await expect(snapshot('folium.mod.none')).resolves.toBeNull();
        await expect(selfCheck('folium.mod.none')).resolves.toBeNull();
    });
});
