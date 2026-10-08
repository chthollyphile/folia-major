import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderAccountController } from '@/library/core/services/providerAccountController';
import { PROVIDER_LOGIN_POLL_INTERVAL_MS } from '@/library/core/services/providerLoginSession';
import { canShowLoginDiagnostics, isLoginDialogVisible } from '@/library/core/model/accountRules';
import type {
    LibraryAccountAuthPort,
    LibraryAccountClock,
    LibraryAccountController,
    LibraryAccountLogger,
    LibraryAccountStorePort,
    LibraryNeteaseBackendHealth,
    LibraryNeteaseBackendPort,
    LibraryProviderAccountPort,
    LibraryProviderSwitchCleanupPort,
    LibrarySpotifyAuthConfigPort,
} from '@/library/core/contracts/account';
import { OnlineProviderError, type OnlineProviderId, type ProviderAccountSummary, type QrLoginMethod, type QrLoginState } from '@/types/onlineMusic';

// test/unit/library/core/providerAccountController.test.ts
// 在线账户 controller（A3）：test/unit/onlineMusic/providerSwitchTransaction.test.ts 的切换 / 登录事务逐条迁移（标注 [txn]），
// 外加 controller 独有的语义：待确认请求的 id 与取代、方法解析竞态、单一在途登录、登录中 dispose、确认后的刷新失败与抛错、
// 激活被拒、登出、当前平台回落写回、快照身份稳定。端口全是假的；时钟是手动推进的假时钟（与 A2 的会话测试同一套）。

/** 手动时钟：advance 按到期顺序逐个触发计时器，每次触发前后把微任务排空（让 await 链走完）。 */
const createManualClock = (start = 1_700_000_000_000) => {
    let now = start;
    let seq = 0;
    const timers = new Map<number, { at: number; seq: number; callback: () => void }>();
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    const clock: LibraryAccountClock = {
        now: () => now,
        setTimeout: (callback, ms) => {
            const id = ++seq;
            timers.set(id, { at: now + ms, seq: id, callback });
            return id;
        },
        clearTimeout: handle => { timers.delete(handle as number); },
    };
    const advance = async (ms: number) => {
        const target = now + ms;
        for (; ;) {
            await flush();
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= target)
                .sort(([, a], [, b]) => a.at - b.at || a.seq - b.seq)[0];
            if (!due) break;
            timers.delete(due[0]);
            now = due[1].at;
            due[1].callback();
        }
        now = target;
        await flush();
    };
    return { clock, advance, flush, pendingTimers: () => timers.size };
};

const deferred = <T,>() => {
    let resolve: (value: T) => void = () => { };
    let reject: (error: unknown) => void = () => { };
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const summary = (providerId: OnlineProviderId, patch: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId,
    displayName: `${providerId} display`,
    shortName: providerId,
    availability: { configured: true },
    status: 'anonymous',
    user: null,
    collections: [],
    ...patch,
});

const QUILL_METHODS: QrLoginMethod[] = [
    { id: 'qq', labelKey: 'home.qqLoginMethodQq', iconKey: 'qq' },
    { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
];

/**
 * 假 provider：netease（未登录）、alpha（已登录、初始当前）、beta（已登录）、gamma（未登录单方式）、
 * quill（未登录 qq / wechat 两方式）、modo（mod 源，无账户）、off（未配置）。与 A0 探针的假 provider 同构。
 */
const initialProviders = (): ProviderAccountSummary[] => [
    summary('netease'),
    summary('alpha', { status: 'authenticated' }),
    summary('beta', { status: 'authenticated' }),
    summary('gamma'),
    summary('quill'),
    summary('modo', { requiresAccount: false, status: 'unknown' }),
    summary('off', { availability: { configured: false, reason: 'not-configured' } }),
];

type Op = [string, ...unknown[]];

let ops: Op[];
let manual: ReturnType<typeof createManualClock>;
let log: ReturnType<typeof vi.fn<LibraryAccountLogger>>;

/** 账户端口：每次 listProviders 都新建摘要对象（omni.getProviderSummaries 就是这样），用来验证快照身份的对齐。 */
const createAccounts = (stored: OnlineProviderId = 'alpha', extra: ProviderAccountSummary[] = []) => {
    let providers = [...initialProviders(), ...extra];
    let storedId = stored;
    const listeners = new Set<() => void>();
    const notify = () => { for (const listener of [...listeners]) listener(); };
    const port: LibraryAccountStorePort = {
        listProviders: () => providers.map(provider => ({ ...provider, availability: { ...provider.availability } })),
        getProviderLabel: providerId => providers.find(p => p.providerId === providerId)?.shortName ?? providerId,
        getStoredActiveProviderId: () => storedId,
        setActiveProviderId: providerId => {
            storedId = providerId;
            ops.push(['set-active', providerId]);
            notify();
        },
        invalidateActiveRequests: () => { ops.push(['invalidate']); },
        subscribe: listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
    return {
        port,
        notify,
        listenerCount: () => listeners.size,
        update: (providerId: OnlineProviderId, patch: Partial<ProviderAccountSummary>) => {
            providers = providers.map(p => (p.providerId === providerId ? { ...p, ...patch } : p));
            notify();
        },
        remove: (providerId: OnlineProviderId) => {
            providers = providers.filter(p => p.providerId !== providerId);
            notify();
        },
        stored: () => storedId,
    };
};

const createBackend = (initial: Partial<LibraryNeteaseBackendHealth> = {}) => {
    let health: LibraryNeteaseBackendHealth = { supported: false, status: null, error: null, restarting: false, ...initial };
    const listeners = new Set<() => void>();
    const set = (patch: Partial<LibraryNeteaseBackendHealth>) => {
        health = { ...health, ...patch };
        for (const listener of [...listeners]) listener();
    };
    const restart = vi.fn(async () => { ops.push(['backend-restart']); });
    const port: LibraryNeteaseBackendPort = {
        getHealth: () => ({ ...health }),
        subscribe: listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        restart,
    };
    return { port, set, restart, listenerCount: () => listeners.size };
};

let auth: { [K in keyof LibraryAccountAuthPort]: ReturnType<typeof vi.fn> };
let accounts: ReturnType<typeof createAccounts>;
let backend: ReturnType<typeof createBackend>;
let refresh: ReturnType<typeof vi.fn<LibraryProviderAccountPort['refresh']>>;
let logoutPort: ReturnType<typeof vi.fn<LibraryProviderAccountPort['logout']>>;
let cleanup: ReturnType<typeof vi.fn<LibraryProviderSwitchCleanupPort['resetForProviderSwitch']>>;
let spotifyAuth: { [K in keyof LibrarySpotifyAuthConfigPort]: ReturnType<typeof vi.fn> };
let keySeq: number;

const createController = (): LibraryAccountController => createProviderAccountController({
    auth: auth as unknown as LibraryAccountAuthPort,
    accounts: accounts.port,
    providerAccounts: { refresh, logout: logoutPort },
    spotifyAuth: spotifyAuth as unknown as LibrarySpotifyAuthConfigPort,
    switchCleanup: { resetForProviderSwitch: cleanup },
    neteaseBackend: backend.port,
    clock: manual.clock,
    diagnostics: { appVersion: '9.9.9-test', userAgent: 'vitest agent' },
    log,
});

/** 让当前会话的下一次轮询报 confirmed，并推进到那次轮询（以及确认后的收尾）走完。 */
const confirmNextPoll = async () => {
    auth.checkQrLogin.mockResolvedValueOnce({ state: 'confirmed' } satisfies QrLoginState);
    await manual.advance(PROVIDER_LOGIN_POLL_INTERVAL_MS);
};

beforeEach(() => {
    ops = [];
    keySeq = 0;
    manual = createManualClock();
    log = vi.fn<LibraryAccountLogger>();
    accounts = createAccounts();
    backend = createBackend();
    auth = {
        resolveQrLoginMethods: vi.fn(async (providerId: OnlineProviderId) => {
            ops.push(['resolve-methods', providerId]);
            return providerId === 'quill' ? QUILL_METHODS : [];
        }),
        getProviderCapabilities: vi.fn().mockReturnValue({ auth: true }),
        createQrLogin: vi.fn(async (providerId: OnlineProviderId, methodId?: string) => {
            const key = `key-${++keySeq}`;
            ops.push(['create', providerId, methodId ?? null, key]);
            return { key, imageUrl: `${providerId}-${key}.png` };
        }),
        checkQrLogin: vi.fn().mockResolvedValue({ state: 'waiting' } satisfies QrLoginState),
        cancelQrLogin: vi.fn(async (providerId: OnlineProviderId, key: string) => { ops.push(['cancel', providerId, key]); }),
        getQrTtlMs: vi.fn().mockReturnValue(null),
        getQrLoginDiagnostics: vi.fn().mockResolvedValue(['runtime: test']),
        canRunQrLoginSelfCheck: vi.fn().mockReturnValue(false),
        runQrLoginSelfCheck: vi.fn().mockResolvedValue(null),
    };
    // 刷新成功即视为拿到了登录态（真实刷新器会把账户写进 store）。
    refresh = vi.fn<LibraryProviderAccountPort['refresh']>(async (providerId: OnlineProviderId) => {
        ops.push(['refresh', providerId]);
        accounts.update(providerId, { status: 'authenticated' });
        return true;
    });
    logoutPort = vi.fn<LibraryProviderAccountPort['logout']>(async (providerId: OnlineProviderId) => {
        ops.push(['logout', providerId]);
        accounts.update(providerId, { status: 'anonymous' });
    });
    cleanup = vi.fn<LibraryProviderSwitchCleanupPort['resetForProviderSwitch']>(async (next: OnlineProviderId, previous: OnlineProviderId) => { ops.push(['cleanup', next, previous]); });
    spotifyAuth = {
        getCustomClientId: vi.fn().mockReturnValue(''),
        saveClientId: vi.fn(),
        getRedirectUri: vi.fn().mockReturnValue('http://127.0.0.1:32110/callback'),
    };
});

const opsOf = (...names: string[]) => ops.filter(op => names.includes(op[0]));

// ─── 切换 ───────────────────────────────────────────────────────────────

describe('providerAccountController · switch', () => {
    it('switches to the current provider at once without asking or cleaning up', async () => {
        const controller = createController();

        await expect(controller.requestSwitch('alpha')).resolves.toEqual({ status: 'switched', providerId: 'alpha', changed: false });

        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(cleanup).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('[txn] does not commit or refresh when the confirmation is cancelled', async () => {
        const controller = createController();
        const result = controller.requestSwitch('beta');
        const request = controller.getSnapshot().pendingSwitch!;
        expect(request).toEqual({ id: request.id, from: 'alpha', to: 'beta', reason: 'switch' });

        expect(controller.cancelSwitch(request.id)).toEqual({ status: 'cancelled', requestId: request.id });

        await expect(result).resolves.toEqual({ status: 'declined', providerId: 'beta', reason: 'cancelled' });
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(controller.getSnapshot().activeProviderId).toBe('alpha');
        expect(opsOf('cleanup', 'invalidate', 'set-active', 'refresh')).toEqual([]);
    });

    it('[txn] cleans up before committing and refreshes only the new provider', async () => {
        const controller = createController();
        const result = controller.requestSwitch('beta');
        const { id } = controller.getSnapshot().pendingSwitch!;

        await expect(controller.confirmSwitch(id)).resolves.toEqual({ status: 'confirmed', requestId: id, providerId: 'beta' });

        await expect(result).resolves.toEqual({ status: 'switched', providerId: 'beta', changed: true });
        // 清理 → 作废在途请求 → 写当前平台 → 刷新新账户（switchOnlineProviderTransaction 的顺序）。
        expect(opsOf('cleanup', 'invalidate', 'set-active', 'refresh')).toEqual([
            ['cleanup', 'beta', 'alpha'],
            ['invalidate'],
            ['set-active', 'beta'],
            ['refresh', 'beta'],
        ]);
        expect(controller.getSnapshot().activeProviderId).toBe('beta');
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
    });

    it('answers a confirmation or cancellation with an outdated request id as stale', async () => {
        const controller = createController();
        void controller.requestSwitch('beta');
        const { id } = controller.getSnapshot().pendingSwitch!;

        await expect(controller.confirmSwitch(id + 1)).resolves.toEqual({ status: 'stale', requestId: id + 1 });
        expect(controller.cancelSwitch(id + 1)).toEqual({ status: 'stale', requestId: id + 1 });
        expect(controller.getSnapshot().pendingSwitch?.id).toBe(id);

        await controller.confirmSwitch(id);
        // 同一个请求只能结算一次。
        await expect(controller.confirmSwitch(id)).resolves.toEqual({ status: 'stale', requestId: id });
        expect(controller.cancelSwitch(id)).toEqual({ status: 'stale', requestId: id });
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('declines the earlier pending request as superseded when a new one arrives', async () => {
        const controller = createController();
        const first = controller.requestSwitch('beta');
        const firstId = controller.getSnapshot().pendingSwitch!.id;

        const second = controller.requestSwitch('modo');
        const pending = controller.getSnapshot().pendingSwitch!;

        await expect(first).resolves.toEqual({ status: 'declined', providerId: 'beta', reason: 'superseded' });
        expect(pending.to).toBe('modo');
        expect(pending.id).toBeGreaterThan(firstId);
        await expect(controller.confirmSwitch(firstId)).resolves.toEqual({ status: 'stale', requestId: firstId });

        await controller.confirmSwitch(pending.id);
        await expect(second).resolves.toEqual({ status: 'switched', providerId: 'modo', changed: true });
    });

    it('still asks before switching to a mod source and leaves its refresh to the host port', async () => {
        refresh.mockImplementation(async (providerId: OnlineProviderId) => {
            ops.push(['refresh', providerId]);
            return undefined;
        });
        const controller = createController();

        const selected = controller.selectProvider('modo');
        const { id, reason } = controller.getSnapshot().pendingSwitch!;
        expect(reason).toBe('switch');
        await controller.confirmSwitch(id);

        await expect(selected).resolves.toEqual({
            action: 'switch',
            result: { status: 'switched', providerId: 'modo', changed: true },
        });
        expect(controller.getSnapshot().activeProviderId).toBe('modo');
    });

    it('refuses unknown and unconfigured providers without opening a request', async () => {
        const controller = createController();

        await expect(controller.requestSwitch('off')).resolves.toEqual({ status: 'unavailable', providerId: 'off', reason: 'not-configured' });
        await expect(controller.requestSwitch('ghost')).resolves.toEqual({ status: 'unavailable', providerId: 'ghost', reason: 'unknown-provider' });
        await expect(controller.selectProvider('off')).resolves.toEqual({ action: 'unavailable', providerId: 'off', reason: 'not-configured' });
        await expect(controller.startLogin('ghost')).resolves.toEqual({ status: 'unavailable', providerId: 'ghost', reason: 'unknown-provider' });
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(auth.resolveQrLoginMethods).not.toHaveBeenCalled();
    });

    it('routes selectProvider: signed-in providers switch, the others start a login', async () => {
        const controller = createController();

        void controller.selectProvider('beta');
        expect(controller.getSnapshot().pendingSwitch?.to).toBe('beta');
        controller.cancelSwitch(controller.getSnapshot().pendingSwitch!.id);

        await expect(controller.selectProvider('gamma')).resolves.toEqual({
            action: 'login',
            result: { status: 'started', providerId: 'gamma', sessionId: expect.any(Number), step: 'qr' },
        });
        expect(controller.getSnapshot().login?.providerId).toBe('gamma');
    });

    it('switches anyway when the host cleanup throws (the user already confirmed)', async () => {
        cleanup.mockRejectedValueOnce(new Error('cleanup broke'));
        const controller = createController();
        const result = controller.requestSwitch('beta');

        await controller.confirmSwitch(controller.getSnapshot().pendingSwitch!.id);

        await expect(result).resolves.toMatchObject({ status: 'switched', changed: true });
        expect(accounts.stored()).toBe('beta');
        expect(log).toHaveBeenCalledWith('warn', 'switch:cleanup-error', expect.objectContaining({ message: 'cleanup broke' }));
    });
});

// ─── 扫码确认后的链路 ───────────────────────────────────────────────────

describe('providerAccountController · completing a login', () => {
    it('[txn] refreshes the current provider after QR confirmation without activating it again', async () => {
        accounts.update('alpha', { status: 'error' });
        const controller = createController();
        await controller.startLogin('alpha');

        await confirmNextPoll();

        expect(refresh).toHaveBeenCalledExactlyOnceWith('alpha');
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(controller.getSnapshot().login).toBeNull();
        expect(controller.getSnapshot().lastLoginCompletion).toEqual({
            sessionId: expect.any(Number), providerId: 'alpha', outcome: 'completed',
        });
    });

    it('[txn] refreshes a different provider before asking to activate it, and does not refresh again on accept', async () => {
        const controller = createController();
        await controller.startLogin('gamma');

        await confirmNextPoll();

        // 回调结束后登录收起，再由 controller 发起激活确认。
        expect(controller.getSnapshot().login).toBeNull();
        const request = controller.getSnapshot().pendingSwitch!;
        expect(request).toMatchObject({ from: 'alpha', to: 'gamma', reason: 'activate-after-login' });
        expect(controller.getSnapshot().lastLoginCompletion).toBeNull();

        await controller.confirmSwitch(request.id);
        await manual.flush();

        expect(opsOf('refresh', 'cleanup', 'invalidate', 'set-active')).toEqual([
            ['refresh', 'gamma'],
            ['cleanup', 'gamma', 'alpha'],
            ['invalidate'],
            ['set-active', 'gamma'],
        ]);
        expect(controller.getSnapshot().lastLoginCompletion).toMatchObject({ providerId: 'gamma', outcome: 'completed' });
    });

    it('[txn] does not activate a provider when its account cannot be refreshed, and shows the failure again', async () => {
        const refreshing = deferred<unknown>();
        refresh.mockImplementationOnce(() => refreshing.promise);
        const controller = createController();
        await controller.startLogin('gamma');

        await confirmNextPoll();
        // 刷新期间登录界面收起（phase=confirmed）。
        expect(controller.getSnapshot().login?.phase).toBe('confirmed');
        expect(isLoginDialogVisible(controller.getSnapshot().login)).toBe(false);

        refreshing.resolve(false);
        await manual.flush();

        const { login, pendingSwitch, lastLoginCompletion } = controller.getSnapshot();
        expect(pendingSwitch).toBeNull();
        expect(login).toMatchObject({ providerId: 'gamma', phase: 'error', failure: 'account-refresh-failed' });
        expect(isLoginDialogVisible(login)).toBe(true);
        expect(login?.copy.status).toEqual({ key: 'home.loginError' });
        expect(lastLoginCompletion).toMatchObject({ providerId: 'gamma', outcome: 'refresh-failed' });
        await expect(controller.buildLoginDiagnosticReport()).resolves.toMatchObject({ status: 'ok' });
    });

    it('treats a refresh that throws as a failed refresh (not a check error)', async () => {
        refresh.mockRejectedValueOnce(new Error('refresh exploded'));
        const controller = createController();
        await controller.startLogin('gamma');

        await confirmNextPoll();

        expect(controller.getSnapshot().login).toMatchObject({ phase: 'error', failure: 'account-refresh-failed' });
        expect(controller.getSnapshot().lastLoginCompletion?.outcome).toBe('refresh-failed');
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(log).toHaveBeenCalledWith('warn', 'login:refresh-error', expect.objectContaining({ message: 'refresh exploded' }));
    });

    it('[txn] reports a declined activation separately and keeps the provider signed in', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();

        controller.cancelSwitch(controller.getSnapshot().pendingSwitch!.id);
        await manual.flush();

        const snapshot = controller.getSnapshot();
        expect(snapshot.lastLoginCompletion).toMatchObject({ providerId: 'gamma', outcome: 'activation-declined' });
        expect(snapshot.activeProviderId).toBe('alpha');
        expect(snapshot.login).toBeNull();
        expect(snapshot.providers.find(p => p.providerId === 'gamma')?.status).toBe('authenticated');
        expect(opsOf('cleanup', 'set-active')).toEqual([]);
    });

    it('drops the post-confirmation steps when the login is closed while the account refreshes', async () => {
        const refreshing = deferred<unknown>();
        refresh.mockImplementationOnce(() => refreshing.promise);
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();

        controller.closeLogin();
        refreshing.resolve(true);
        await manual.flush();

        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(controller.getSnapshot().lastLoginCompletion).toBeNull();
        // 确认后的会话已经换成凭据，关窗不再取消它。
        expect(auth.cancelQrLogin).not.toHaveBeenCalled();
    });
});

// ─── 登录流程 ───────────────────────────────────────────────────────────

describe('providerAccountController · login flow', () => {
    it('requests a QR at once for a single-method provider and derives the copy', async () => {
        const controller = createController();

        const result = await controller.startLogin('gamma');

        expect(result).toEqual({ status: 'started', providerId: 'gamma', sessionId: expect.any(Number), step: 'qr' });
        await manual.flush();
        const login = controller.getSnapshot().login!;
        expect(login).toMatchObject({
            id: (result as { sessionId: number }).sessionId,
            providerId: 'gamma',
            phase: 'waiting',
            methods: [],
            selectedMethodId: null,
            qrImageUrl: 'gamma-key-1.png',
            failure: null,
            backend: { failed: false, detail: null, restarting: false, canRestart: false },
        });
        expect(login.copy).toEqual({
            title: { key: 'home.loginTitle' },
            note: { key: 'home.loginNote' },
            status: { key: 'home.scanQr' },
        });
    });

    it('stops at choosing-method for a multi-method provider and keeps the chosen method on retry', async () => {
        const controller = createController();

        await expect(controller.startLogin('quill')).resolves.toMatchObject({ status: 'started', step: 'choosing-method' });

        const choosing = controller.getSnapshot().login!;
        expect(choosing).toMatchObject({ phase: 'choosing-method', methods: QUILL_METHODS, selectedMethodId: null });
        expect(choosing.copy.status).toBeNull();
        expect(auth.createQrLogin).not.toHaveBeenCalled();
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'method-required' });
        await expect(controller.selectLoginMethod('fax')).resolves.toEqual({ status: 'rejected', reason: 'unknown-method' });

        const selected = await controller.selectLoginMethod('wechat');
        expect(selected).toMatchObject({ status: 'requested' });
        await manual.flush();
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'waiting', selectedMethodId: 'wechat' });
        expect(controller.getSnapshot().login!.id).toBeGreaterThan(choosing.id);

        // 还在等扫码：重试不可用。
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'not-retryable' });

        auth.checkQrLogin.mockResolvedValueOnce({ state: 'expired' } satisfies QrLoginState);
        await manual.advance(PROVIDER_LOGIN_POLL_INTERVAL_MS);
        expect(controller.getSnapshot().login?.phase).toBe('expired');

        await expect(controller.retryLogin()).resolves.toMatchObject({ status: 'requested' });
        await manual.flush();
        expect(opsOf('create')).toEqual([
            ['create', 'quill', 'wechat', 'key-1'],
            ['create', 'quill', 'wechat', 'key-2'],
        ]);
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'waiting', selectedMethodId: 'wechat' });
    });

    it('turns down a retry while the backend cooldown runs after a login canceled on the phone', async () => {
        const controller = createController();
        await controller.startLogin('netease');
        await manual.flush();
        auth.checkQrLogin.mockResolvedValueOnce({
            state: 'error', message: 'QR login failed', reason: 'canceled-on-device', retryAfterMs: 30_000,
        } satisfies QrLoginState);
        await manual.advance(PROVIDER_LOGIN_POLL_INTERVAL_MS);

        const canceled = controller.getSnapshot().login!;
        expect(canceled).toMatchObject({ phase: 'error', failure: 'canceled-on-device', retryCooldownSeconds: 30 });
        expect(canceled.copy.status).toEqual({ key: 'home.qrCanceledOnDeviceCooldown', values: { seconds: 30 } });
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'cooling-down' });

        await manual.advance(30_000);
        expect(controller.getSnapshot().login).toMatchObject({ retryCooldownSeconds: null });
        expect(controller.getSnapshot().login!.copy.status).toEqual({ key: 'home.qrCanceledOnDevice' });
        await expect(controller.retryLogin()).resolves.toMatchObject({ status: 'requested' });
    });

    it('lets the newest startLogin win when login-method discovery resolves out of order', async () => {
        const quillMethods = deferred<QrLoginMethod[]>();
        auth.resolveQrLoginMethods.mockImplementationOnce(() => quillMethods.promise);
        const controller = createController();

        const first = controller.startLogin('quill');
        const second = await controller.startLogin('gamma');
        quillMethods.resolve(QUILL_METHODS);

        await expect(first).resolves.toEqual({ status: 'superseded', providerId: 'quill' });
        expect(second).toMatchObject({ status: 'started', providerId: 'gamma', step: 'qr' });
        await manual.flush();
        expect(controller.getSnapshot().login).toMatchObject({ providerId: 'gamma', phase: 'waiting', methods: [] });
        expect(opsOf('create')).toEqual([['create', 'gamma', null, 'key-1']]);
    });

    it('stops the previous session before resolving the next provider (single login in flight)', async () => {
        const quillMethods = deferred<QrLoginMethod[]>();
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        auth.resolveQrLoginMethods.mockImplementationOnce(() => quillMethods.promise);

        const next = controller.startLogin('quill');

        // 旧会话立即 keyed 取消，不等新平台的方式解析——否则它会在后台替 gamma 确认登录。
        expect(auth.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('gamma', 'key-1');
        expect(controller.getSnapshot().login).toMatchObject({ providerId: 'quill', phase: 'resolving-methods' });
        expect(isLoginDialogVisible(controller.getSnapshot().login)).toBe(false);

        auth.checkQrLogin.mockResolvedValue({ state: 'confirmed' } satisfies QrLoginState);
        await manual.advance(10 * PROVIDER_LOGIN_POLL_INTERVAL_MS);
        expect(refresh).not.toHaveBeenCalled();

        quillMethods.resolve(QUILL_METHODS);
        await expect(next).resolves.toMatchObject({ status: 'started', step: 'choosing-method' });
    });

    it('closes the login: cancels the session, clears the snapshot and voids a pending method discovery', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();

        const closed = controller.closeLogin();

        expect(closed).toEqual({ status: 'closed', sessionId: expect.any(Number) });
        expect(controller.getSnapshot().login).toBeNull();
        expect(auth.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('gamma', 'key-1');
        expect(manual.pendingTimers()).toBe(0);
        expect(controller.closeLogin()).toEqual({ status: 'no-session' });

        const discovery = deferred<QrLoginMethod[]>();
        auth.resolveQrLoginMethods.mockImplementationOnce(() => discovery.promise);
        const resolving = controller.startLogin('quill');
        controller.closeLogin();
        discovery.resolve(QUILL_METHODS);
        await expect(resolving).resolves.toEqual({ status: 'superseded', providerId: 'quill' });
        expect(controller.getSnapshot().login).toBeNull();
    });

    it('falls back to a single-step login when method discovery throws', async () => {
        auth.resolveQrLoginMethods.mockRejectedValueOnce(new Error('discovery down'));
        const controller = createController();

        await expect(controller.startLogin('quill')).resolves.toMatchObject({ status: 'started', step: 'qr' });

        expect(opsOf('create')).toEqual([['create', 'quill', null, 'key-1']]);
        expect(log).toHaveBeenCalledWith('warn', 'login:methods-error', expect.objectContaining({ message: 'discovery down' }));
    });

    it('builds the diagnostic report only once a QR was requested', async () => {
        const controller = createController();
        await expect(controller.buildLoginDiagnosticReport()).resolves.toEqual({ status: 'no-session' });

        await controller.startLogin('gamma');
        auth.checkQrLogin.mockResolvedValueOnce({ state: 'error', message: 'backend says no' } satisfies QrLoginState);
        await manual.advance(PROVIDER_LOGIN_POLL_INTERVAL_MS);

        expect(controller.getSnapshot().login).toMatchObject({ phase: 'error', failure: 'check-error' });
        const report = await controller.buildLoginDiagnosticReport();
        expect(report.status).toBe('ok');
        expect(report.status === 'ok' && report.report).toContain('gamma');
        expect(auth.getQrLoginDiagnostics).toHaveBeenCalledWith('gamma');
    });

    it('swallows an unexpected rejection of the session start', async () => {
        auth.getProviderCapabilities.mockImplementationOnce(() => { throw new Error('capabilities broke'); });
        const controller = createController();

        await expect(controller.startLogin('gamma')).resolves.toMatchObject({ status: 'started' });
        await manual.flush();

        expect(log).toHaveBeenCalledWith('warn', 'login:start-rejected', expect.objectContaining({ message: 'capabilities broke' }));
    });
});

// ─── 网易后端 ───────────────────────────────────────────────────────────

describe('providerAccountController · NetEase backend', () => {
    it('shows the backend failure, refuses retry and resumes the QR after a successful restart', async () => {
        backend = createBackend({ supported: true, status: 'error', error: 'xeapi key missing' });
        backend.restart.mockImplementation(async () => {
            ops.push(['backend-restart']);
            backend.set({ status: 'running', error: null });
        });
        accounts = createAccounts('netease');
        const controller = createController();
        await controller.startLogin('netease');
        await manual.flush();

        const login = controller.getSnapshot().login!;
        expect(login.backend).toEqual({ failed: true, detail: 'xeapi key missing', restarting: false, canRestart: true });
        expect(login.copy.status).toBeNull();
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'backend-failed' });

        const restarted = await controller.restartLoginBackend();

        expect(restarted).toEqual({ status: 'resumed', sessionId: expect.any(Number) });
        await manual.flush();
        expect(opsOf('create').map(op => op[1])).toEqual(['netease', 'netease']);
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'waiting', backend: { failed: false } });
    });

    it('reports still-down when the backend does not come back, and refuses a restart that is not needed', async () => {
        backend = createBackend({ supported: true, status: 'error', error: 'boom' });
        accounts = createAccounts('netease');
        const controller = createController();
        await expect(controller.restartLoginBackend()).resolves.toEqual({ status: 'no-session' });
        await controller.startLogin('netease');

        await expect(controller.restartLoginBackend()).resolves.toEqual({ status: 'still-down' });
        expect(backend.restart).toHaveBeenCalledOnce();

        backend.set({ status: 'running', error: null });
        await expect(controller.restartLoginBackend()).resolves.toEqual({ status: 'rejected', reason: 'not-restartable' });
    });

    it('follows backend health changes in the login snapshot', async () => {
        backend = createBackend({ supported: true, status: 'running' });
        const controller = createController();
        await controller.startLogin('netease');
        await manual.flush();
        const listener = vi.fn();
        controller.subscribe(listener);

        backend.set({ status: 'error', error: 'crashed' });

        expect(listener).toHaveBeenCalled();
        expect(controller.getSnapshot().login?.backend).toMatchObject({ failed: true, detail: 'crashed' });
    });
});

// ─── 登出 ───────────────────────────────────────────────────────────────

describe('providerAccountController · logout', () => {
    it('logs out the current signed-in provider through the host port and tracks the pending state', async () => {
        const gate = deferred<void>();
        logoutPort.mockImplementationOnce(async (providerId: OnlineProviderId) => {
            ops.push(['logout', providerId]);
            await gate.promise;
        });
        const controller = createController();

        const first = controller.logout('alpha');
        expect(controller.getSnapshot().logout).toEqual({ providerId: 'alpha', status: 'pending' });
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'busy', providerId: 'alpha' });

        gate.resolve();
        await expect(first).resolves.toEqual({ status: 'logged-out', providerId: 'alpha' });
        expect(controller.getSnapshot().logout).toEqual({ providerId: null, status: 'idle' });
        expect(opsOf('logout')).toEqual([['logout', 'alpha']]);
    });

    it('refuses providers that are not active, not signed in or unknown', async () => {
        const controller = createController();

        await expect(controller.logout('beta')).resolves.toEqual({ status: 'rejected', providerId: 'beta', reason: 'not-active' });
        await expect(controller.logout('ghost')).resolves.toEqual({ status: 'rejected', providerId: 'ghost', reason: 'unknown-provider' });
        accounts.update('alpha', { status: 'anonymous' });
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'rejected', providerId: 'alpha', reason: 'not-authenticated' });
        expect(logoutPort).not.toHaveBeenCalled();
    });

    it('reports a failing logout and frees the slot again', async () => {
        logoutPort.mockRejectedValueOnce(new Error('network down'));
        const controller = createController();

        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'failed', providerId: 'alpha', message: 'network down' });
        expect(controller.getSnapshot().logout.status).toBe('idle');
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'logged-out', providerId: 'alpha' });
    });
});

// ─── 当前平台与快照 ─────────────────────────────────────────────────────

describe('providerAccountController · active provider and snapshot', () => {
    it('falls back to NetEase when the stored provider is unavailable and writes it back without confirmation', async () => {
        accounts = createAccounts('folium.gone');
        const controller = createController();

        expect(controller.getSnapshot().activeProviderId).toBe('netease');
        await manual.flush();

        expect(accounts.stored()).toBe('netease');
        expect(opsOf('set-active', 'cleanup', 'invalidate')).toEqual([['set-active', 'netease']]);
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
    });

    it('falls back when the active provider disappears at runtime, keeping the other accounts', async () => {
        accounts = createAccounts('modo');
        const controller = createController();
        await manual.flush();
        expect(controller.getSnapshot().activeProviderId).toBe('modo');

        accounts.remove('modo');

        expect(controller.getSnapshot().activeProviderId).toBe('netease');
        expect(accounts.stored()).toBe('netease');
        expect(controller.getSnapshot().providers.map(p => p.providerId)).not.toContain('modo');
        expect(controller.getSnapshot().providers.find(p => p.providerId === 'alpha')?.status).toBe('authenticated');
        expect(opsOf('cleanup', 'invalidate')).toEqual([]);
    });

    it('keeps the snapshot and its parts identical while nothing changed', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        const before = controller.getSnapshot();
        const listener = vi.fn();
        controller.subscribe(listener);

        // 账户端口通知但内容没变（omni 每次都新建摘要对象）；后端健康变了但与 gamma 的登录无关。
        accounts.notify();
        backend.set({ restarting: false });
        await manual.advance(PROVIDER_LOGIN_POLL_INTERVAL_MS);

        expect(controller.getSnapshot()).toBe(before);
        expect(controller.getSnapshot()).toBe(controller.getSnapshot());
        expect(listener).not.toHaveBeenCalled();

        accounts.update('beta', { status: 'error' });

        const after = controller.getSnapshot();
        expect(after).not.toBe(before);
        expect(listener).toHaveBeenCalledOnce();
        expect(after.login).toBe(before.login);
        expect(after.providers).not.toBe(before.providers);
        expect(after.providers.find(p => p.providerId === 'alpha')).toBe(before.providers.find(p => p.providerId === 'alpha'));
    });

    it('does not publish intermediate states while starting a session', async () => {
        const controller = createController();
        const seen: string[] = [];
        controller.subscribe(() => {
            const login = controller.getSnapshot().login;
            seen.push(login ? `${login.providerId}:${login.phase}` : 'none');
        });

        await controller.startLogin('gamma');
        await manual.flush();

        expect(seen).toEqual(['gamma:resolving-methods', 'gamma:loading', 'gamma:waiting']);
    });
});

// ─── 寿命 ───────────────────────────────────────────────────────────────

describe('providerAccountController · dispose', () => {
    it('cancels the live login, declines the pending switch and unsubscribes everything', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        const pending = controller.requestSwitch('beta');
        const listener = vi.fn();
        controller.subscribe(listener);

        controller.dispose();

        await expect(pending).resolves.toEqual({ status: 'declined', providerId: 'beta', reason: 'disposed' });
        expect(auth.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('gamma', 'key-1');
        expect(manual.pendingTimers()).toBe(0);
        expect(accounts.listenerCount()).toBe(0);
        expect(backend.listenerCount()).toBe(0);
        expect(controller.getSnapshot()).toMatchObject({ login: null, pendingSwitch: null });
        expect(listener).not.toHaveBeenCalled();
    });

    it('drops a method discovery that resolves after dispose', async () => {
        const discovery = deferred<QrLoginMethod[]>();
        auth.resolveQrLoginMethods.mockImplementationOnce(() => discovery.promise);
        const controller = createController();
        const resolving = controller.startLogin('gamma');

        controller.dispose();
        discovery.resolve([]);

        await expect(resolving).resolves.toEqual({ status: 'superseded', providerId: 'gamma' });
        expect(auth.createQrLogin).not.toHaveBeenCalled();
    });

    it('turns every later call into a safe no-op', async () => {
        const controller = createController();
        controller.dispose();
        controller.dispose();
        const listener = vi.fn();
        controller.subscribe(listener)();

        await expect(controller.requestSwitch('beta')).resolves.toEqual({ status: 'declined', providerId: 'beta', reason: 'disposed' });
        await expect(controller.confirmSwitch(1)).resolves.toEqual({ status: 'stale', requestId: 1 });
        expect(controller.cancelSwitch(1)).toEqual({ status: 'stale', requestId: 1 });
        await expect(controller.startLogin('gamma')).resolves.toEqual({ status: 'superseded', providerId: 'gamma' });
        await expect(controller.selectLoginMethod('qq')).resolves.toEqual({ status: 'no-session' });
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'no-session' });
        expect(controller.closeLogin()).toEqual({ status: 'no-session' });
        await expect(controller.restartLoginBackend()).resolves.toEqual({ status: 'no-session' });
        await expect(controller.buildLoginDiagnosticReport()).resolves.toEqual({ status: 'no-session' });
        await expect(controller.logout('alpha')).resolves.toMatchObject({ status: 'failed' });
        accounts.update('beta', { status: 'error' });
        await manual.flush();

        expect(auth.resolveQrLoginMethods).not.toHaveBeenCalled();
        expect(logoutPort).not.toHaveBeenCalled();
        expect(opsOf('set-active')).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
    });
});

// ─── QQ 的错误不进普通日志 ──────────────────────────────────────────────

// PR #495：QQ 的扫码 / 账户失败由 qqProvider 写白名单过滤后的摘要。controller 里带 providerId 的错误日志
// （登录方式解析、会话启动、确认后的账户刷新、切换后的刷新、登出）对 QQ 只记固定类别；原 hook 测试里
// 「确认后账户刷新抛错」那一步在新架构下落到这里的 login:refresh-error。
// 登录 / 刷新 / 登出的失败对每个 provider 都记完整的错误（名字、原文与 OnlineProviderError 的字段），
// 诊断报告里能直接看到后端回了什么。
describe('providerAccountController · failures are logged in full for every provider', () => {
    const backendError = () => new OnlineProviderError(
        'network',
        'QQMusicApi login_status failed: HTTP 502 (upstream unreachable)',
        'qq',
        { code: 502, message: 'upstream unreachable' },
        502,
    );
    type Step = 'methods' | 'start' | 'refresh' | 'switch-refresh' | 'logout';
    const EVENT: Record<Step, string> = {
        methods: 'login:methods-error',
        start: 'login:start-rejected',
        refresh: 'login:refresh-error',
        'switch-refresh': 'switch:refresh-error',
        logout: 'logout:error',
    };

    /** 让 providerId 的某一步抛错，返回那一步记下的日志条目。 */
    const failAt = async (providerId: OnlineProviderId, step: Step) => {
        accounts = createAccounts('alpha', [
            summary('qq', { status: step === 'switch-refresh' ? 'authenticated' : 'anonymous' }),
            summary('kugou', { status: step === 'switch-refresh' ? 'authenticated' : 'anonymous' }),
        ]);
        const controller = createController();
        if (step === 'methods') {
            auth.resolveQrLoginMethods.mockRejectedValueOnce(backendError());
            await controller.startLogin(providerId);
        } else if (step === 'start') {
            auth.getProviderCapabilities.mockImplementationOnce(() => { throw backendError(); });
            await controller.startLogin(providerId);
            await manual.flush();
        } else if (step === 'refresh') {
            refresh.mockRejectedValueOnce(backendError());
            await controller.startLogin(providerId);
            await confirmNextPoll();
            expect(controller.getSnapshot().login).toMatchObject({ providerId, phase: 'error', failure: 'account-refresh-failed' });
        } else if (step === 'switch-refresh') {
            refresh.mockRejectedValueOnce(backendError());
            const switching = controller.requestSwitch(providerId);
            await controller.confirmSwitch(controller.getSnapshot().pendingSwitch!.id);
            await expect(switching).resolves.toMatchObject({ status: 'switched', providerId });
        } else {
            accounts.update(providerId, { status: 'authenticated' });
            accounts.port.setActiveProviderId(providerId);
            logoutPort.mockRejectedValueOnce(backendError());
            await expect(controller.logout(providerId)).resolves.toMatchObject({ status: 'failed', providerId });
        }
        return log.mock.calls.find(([level, event]) => level === 'warn' && event === EVENT[step]);
    };

    it.each([
        ...(['methods', 'start', 'refresh', 'switch-refresh', 'logout'] as const).map(step => ['qq', step] as const),
        ...(['methods', 'start', 'refresh', 'switch-refresh', 'logout'] as const).map(step => ['kugou', step] as const),
    ])('logs the full %s %s failure', async (providerId, step) => {
        const entry = await failAt(providerId, step);

        expect(entry).toBeDefined();
        expect(entry![2]).toEqual({
            providerId,
            name: 'OnlineProviderError',
            message: 'QQMusicApi login_status failed: HTTP 502 (upstream unreachable)',
            code: 'network',
            httpStatus: 502,
            cause: { code: 502, message: 'upstream unreachable' },
        });
    });

    it('puts the raw start failure of a QQ login into the report', async () => {
        accounts = createAccounts('alpha', [summary('qq')]);
        const controller = createController();
        auth.createQrLogin.mockRejectedValueOnce(new OnlineProviderError(
            'network',
            'QQMusicApi login_qr_key failed: HTTP 429 (QR login is temporarily backed off)',
            'qq',
            { code: 429, failureStage: 'qr-key', failureReason: 'local-backoff', retryAfterMs: 30000 },
            429,
            30000,
        ));
        await controller.startLogin('qq');
        await manual.flush();

        const { login } = controller.getSnapshot();
        expect(login).toMatchObject({ providerId: 'qq', phase: 'error', failure: 'start-error', retryCooldownSeconds: 30 });
        expect(canShowLoginDiagnostics(login!)).toBe(true);
        const report = await controller.buildLoginDiagnosticReport();
        expect(report.status).toBe('ok');
        const text = report.status === 'ok' ? report.report : '';
        expect(text).toContain('message="QQMusicApi login_qr_key failed: HTTP 429 (QR login is temporarily backed off)"');
        expect(text).toContain('"failureReason":"local-backoff"');
    });
});

// ─── Spotify 授权配置（Client ID 与回调地址经端口透出，弹窗不直连 provider service） ───

describe('providerAccountController · Spotify auth config', () => {
    it('reads and saves the Client ID through the injected port', () => {
        spotifyAuth.getCustomClientId.mockReturnValue('user-client-id');
        const controller = createController();

        expect(controller.getSpotifyAuthConfig()).toEqual({
            clientId: 'user-client-id',
            redirectUri: 'http://127.0.0.1:32110/callback',
        });

        controller.saveSpotifyClientId('next-client-id');
        expect(spotifyAuth.saveClientId).toHaveBeenCalledWith('next-client-id');
    });

    it('does not write after dispose', () => {
        const controller = createController();
        controller.dispose();

        controller.saveSpotifyClientId('late-client-id');
        expect(spotifyAuth.saveClientId).not.toHaveBeenCalled();
    });
});
