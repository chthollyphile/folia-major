import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/loginBackendIpc.test.ts

const { registerLoginBackendIpc } = require('../../../electron/loginBackendIpc.cjs') as {
    registerLoginBackendIpc: (options: Record<string, unknown>) => void;
};

const createBackend = (providerId: string) => ({
    getPort: vi.fn(() => (providerId === 'netease' ? 4100 : null)),
    getStatus: vi.fn(() => ({ status: providerId === 'netease' ? 'running' : 'error', port: null, error: null, updatedAt: 1 })),
    start: vi.fn(async () => ({ status: 'running', port: 4100, error: null, updatedAt: 2 })),
    // 网易的要问工作线程（异步），QQ 的当场给（同步）。
    getDiagnostics: vi.fn<() => object | Promise<object>>(() => ({ backend: { status: 'running' }, startup: [], connections: [] })),
    selfCheckHosts: [`${providerId}.example`],
});

const setup = () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
    const netease = createBackend('netease');
    const qq = createBackend('qq');
    const runSelfCheck = vi.fn(async (options: Record<string, unknown>) => ({ providerId: options.providerId }));
    const resolveProxy = vi.fn(async () => 'DIRECT');
    registerLoginBackendIpc({
        ipcMain,
        app: { getVersion: () => '0.7.14-test', getLocale: () => 'zh-CN' },
        safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret' },
        getDefaultSession: () => ({ resolveProxy }),
        neteaseBackend: netease,
        qqBackend: qq,
        runSelfCheck,
    });
    const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
    return { handlers, invoke, netease, qq, runSelfCheck, resolveProxy };
};

describe('login backend IPC', () => {
    it('serves ports, status and the NetEase restart from the backends', async () => {
        const { handlers, invoke, netease } = setup();
        expect([...handlers.keys()].sort()).toEqual([
            'get-login-diagnostics', 'get-netease-api-status', 'get-netease-port', 'get-qq-api-status', 'get-qq-port',
            'restart-netease-api', 'run-login-self-check',
        ]);
        expect(invoke('get-netease-port')).toBe(4100);
        expect(invoke('get-qq-port')).toBeNull();
        await expect(invoke('restart-netease-api', 'needed')).resolves.toMatchObject({ status: 'running' });
        expect(netease.start).toHaveBeenCalledExactlyOnceWith('needed');
    });

    it('builds the diagnostics snapshot from the app environment and that backend', async () => {
        const { invoke, netease } = setup();
        // 网易的诊断要问工作线程，是异步的。
        netease.getDiagnostics.mockImplementation(async () => ({ backend: { status: 'running' }, startup: [], connections: [] }));
        await expect(invoke('get-login-diagnostics', 'netease')).resolves.toMatchObject({ providerId: 'netease', backend: { status: 'running' } });
        const snapshot = await invoke('get-login-diagnostics', 'qq') as any;
        expect(snapshot).toMatchObject({
            providerId: 'qq',
            app: {
                version: '0.7.14-test',
                electron: process.versions.electron,
                platform: process.platform,
                locale: 'zh-CN',
                credentialStore: { encryptionAvailable: true },
            },
            backend: { status: 'running' },
        });
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
});
