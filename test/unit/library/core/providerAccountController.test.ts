import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderAccountController } from '@/library/core/account/providerAccountController.service';
import { PROVIDER_LOGIN_POLL_INTERVAL_MS } from '@/library/core/account/providerLoginSession.service';
import type {
    LibraryAccountAuthPort,
    LibraryAccountClock,
    LibraryAccountController,
    LibraryAccountLogger,
    LibraryAccountStorePort,
    LibraryProviderAccountPort,
    LibraryProviderSwitchCleanupPort,
} from '@/library/core/account/account.contract';
import { diagnosticLine } from '@/services/onlineMusic/login/loginDiagnosticReport';
import { noteLoginFailure } from '@/services/onlineMusic/login/loginFailureCase';
import type { LoginLocalService, LoginLocalServiceStatus, LoginMethod, LoginState, OnlineProviderId, ProviderAccountSummary } from '@/types/onlineMusic';

// test/unit/library/core/providerAccountController.test.ts
// 在线账户 controller：切换（不问，离开旧平台后直接切，没有待确认请求）、登录（只开始不选平台、
// 方法解析竞态、单一在途登录、浏览器登录先等用的人、等待再试、本地服务重启）、确认后的读账号与切过去、登出（先问，只把
// 这个平台的歌移出播放器）、当前平台回落写回、快照身份稳定、dispose。原来 providerSwitchTransaction.test.ts 的切换 / 登录事务逐条
// 在这里（标注 [txn]）。端口全是假的；时钟是手动推进的假时钟。

const POLL = PROVIDER_LOGIN_POLL_INTERVAL_MS;

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

const QUILL_METHODS: LoginMethod[] = [
    { id: 'qq', labelKey: 'home.qqLoginMethodQq', iconKey: 'qq' },
    { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
];

/**
 * 假 provider：netease（未登录）、alpha（已登录、初始当前）、beta（已登录）、gamma（未登录单方式）、
 * quill（未登录 qq / wechat 两方式）、webby（未登录，在浏览器里确认）、modo（mod 源，无账户）、off（未配置）。
 */
const initialProviders = (): ProviderAccountSummary[] => [
    summary('netease'),
    summary('alpha', { status: 'authenticated' }),
    summary('beta', { status: 'authenticated' }),
    summary('gamma'),
    summary('quill'),
    summary('webby'),
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

/** 一个登录要靠的本地服务（网易云那样）：状态、通知、重启。 */
const createLocalService = (initial: Partial<LoginLocalServiceStatus> = {}) => {
    let status: LoginLocalServiceStatus = { failed: false, error: null, restarting: false, ...initial };
    const listeners = new Set<() => void>();
    const set = (patch: Partial<LoginLocalServiceStatus>) => {
        status = { ...status, ...patch };
        for (const listener of [...listeners]) listener();
    };
    const restart = vi.fn(async () => { ops.push(['service-restart']); return true; });
    const service: LoginLocalService = {
        subscribe: listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        getStatus: () => status,
        restart,
    };
    return { service, set, restart, listenerCount: () => listeners.size };
};

let auth: { [K in keyof LibraryAccountAuthPort]: ReturnType<typeof vi.fn> };
let accounts: ReturnType<typeof createAccounts>;
let refresh: ReturnType<typeof vi.fn<LibraryProviderAccountPort['refresh']>>;
let submitLoginForm: ReturnType<typeof vi.fn<LibraryProviderAccountPort['submitLoginForm']>>;
let logoutPort: ReturnType<typeof vi.fn<LibraryProviderAccountPort['logout']>>;
let confirmLogout: ReturnType<typeof vi.fn<LibraryProviderAccountPort['confirmLogout']>>;
let cleanup: ReturnType<typeof vi.fn<LibraryProviderSwitchCleanupPort['leaveProvider']>>;
let dropSongs: ReturnType<typeof vi.fn<LibraryProviderSwitchCleanupPort['dropSongsOf']>>;
let holdsSongs: boolean;
let keySeq: number;

const createController = (): LibraryAccountController => createProviderAccountController({
    auth: auth as unknown as LibraryAccountAuthPort,
    accounts: accounts.port,
    providerAccounts: { refresh, submitLoginForm, logout: logoutPort, confirmLogout },
    switchCleanup: { leaveProvider: cleanup, holdsSongsOf: () => holdsSongs, dropSongsOf: dropSongs },
    clock: manual.clock,
    diagnostics: { appVersion: '9.9.9-test', userAgent: 'vitest agent' },
    log,
});

/** 让当前会话的下一次轮询报 confirmed，并推进到那次轮询（以及确认后的收尾）走完。 */
const confirmNextPoll = async () => {
    auth.checkLogin.mockResolvedValueOnce({ state: 'confirmed' } satisfies LoginState);
    await manual.advance(POLL);
};

beforeEach(() => {
    ops = [];
    keySeq = 0;
    holdsSongs = true;
    manual = createManualClock();
    log = vi.fn<LibraryAccountLogger>();
    accounts = createAccounts();
    auth = {
        resolveLoginMethods: vi.fn(async (providerId: OnlineProviderId) => {
            ops.push(['resolve-methods', providerId]);
            return providerId === 'quill' ? QUILL_METHODS : [];
        }),
        getProviderCapabilities: vi.fn().mockReturnValue({ auth: true }),
        startLogin: vi.fn(async (providerId: OnlineProviderId, methodId?: string) => {
            const key = `key-${++keySeq}`;
            ops.push(['start', providerId, methodId ?? null, key]);
            return { key, imageUrl: providerId === 'webby' ? '' : `${providerId}-${key}.png` };
        }),
        checkLogin: vi.fn().mockResolvedValue({ state: 'waiting' } satisfies LoginState),
        cancelLogin: vi.fn(async (providerId: OnlineProviderId, key: string) => { ops.push(['cancel', providerId, key]); }),
        confirmsLoginInBrowser: vi.fn((providerId: OnlineProviderId) => providerId === 'webby'),
        opensLoginPageItself: vi.fn().mockReturnValue(false),
        openLoginPage: vi.fn(async (providerId: OnlineProviderId, key: string) => { ops.push(['open-page', providerId, key]); }),
        getLoginTtlMs: vi.fn().mockReturnValue(null),
        getLoginTexts: vi.fn((providerId: OnlineProviderId) => (providerId === 'gamma' ? { title: 'gamma.title', note: 'gamma.note' } : null)),
        getLoginLocalService: vi.fn().mockReturnValue(null),
        getLoginDiagnostics: vi.fn().mockResolvedValue([diagnosticLine`runtime: test`]),
        canRunLoginSelfCheck: vi.fn().mockReturnValue(false),
        runLoginSelfCheck: vi.fn().mockResolvedValue(null),
        dropRequestLimits: vi.fn(),
    };
    // 读到了就当拿到了登录态（真实的读账号会把账户写进 store）。
    refresh = vi.fn<LibraryProviderAccountPort['refresh']>(async (providerId, reason) => {
        ops.push(['refresh', providerId, reason]);
        accounts.update(providerId, { status: 'authenticated' });
        return true;
    });
    submitLoginForm = vi.fn<LibraryProviderAccountPort['submitLoginForm']>(async (providerId, values) => {
        ops.push(['submit-form', providerId, values]);
    });
    logoutPort = vi.fn<LibraryProviderAccountPort['logout']>(async providerId => {
        ops.push(['logout', providerId]);
        accounts.update(providerId, { status: 'anonymous' });
    });
    confirmLogout = vi.fn<LibraryProviderAccountPort['confirmLogout']>(async request => {
        ops.push(['ask-logout', request.providerId, request.removesSongs]);
        return true;
    });
    cleanup = vi.fn<LibraryProviderSwitchCleanupPort['leaveProvider']>(async (previous, next) => { ops.push(['cleanup', next, previous]); });
    dropSongs = vi.fn<LibraryProviderSwitchCleanupPort['dropSongsOf']>(async providerId => { ops.push(['drop-songs', providerId]); });
});

const opsOf = (...names: string[]) => ops.filter(op => names.includes(op[0]));

// ─── 切换 ───────────────────────────────────────────────────────────────

describe('providerAccountController · switch', () => {
    it('switches to the current provider at once without leaving it', async () => {
        const controller = createController();
        await expect(controller.requestSwitch('alpha')).resolves.toEqual({ status: 'switched', providerId: 'alpha', changed: false });
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(cleanup).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('[txn] switches without asking, with songs in the player: leaves the old provider, commits, reads only the new one', async () => {
        const controller = createController();
        const listener = vi.fn();
        controller.subscribe(() => listener(controller.getSnapshot().pendingSwitch));
        await expect(controller.requestSwitch('beta')).resolves.toEqual({ status: 'switched', providerId: 'beta', changed: true });
        expect(listener.mock.calls.every(([pending]) => pending === null)).toBe(true);
        expect(ops).toEqual([['cleanup', 'beta', 'alpha'], ['invalidate'], ['set-active', 'beta'], ['refresh', 'beta', 'switch']]);
        expect(log).toHaveBeenCalledWith('info', 'switch', expect.objectContaining({ from: 'alpha', to: 'beta', reason: 'switch' }));
        // The player is never emptied by a switch: songs of several platforms share the queue.
        expect(dropSongs).not.toHaveBeenCalled();
    });

    it('answers a confirmation or a cancellation as stale: nothing is ever pending', async () => {
        const controller = createController();
        await controller.requestSwitch('beta');
        expect(controller.cancelSwitch(1)).toEqual({ status: 'stale', requestId: 1 });
        await expect(controller.confirmSwitch(1)).resolves.toEqual({ status: 'stale', requestId: 1 });
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
    });

    it('runs two switches started together through, the later one last', async () => {
        const controller = createController();
        await Promise.all([controller.requestSwitch('beta'), controller.requestSwitch('modo')]);
        expect(opsOf('cleanup', 'set-active')).toEqual([
            ['cleanup', 'beta', 'alpha'], ['cleanup', 'modo', 'alpha'], ['set-active', 'beta'], ['set-active', 'modo'],
        ]);
        expect(controller.getSnapshot().activeProviderId).toBe('modo');
    });

    it('refuses unknown and unconfigured providers without switching', async () => {
        const controller = createController();
        await expect(controller.requestSwitch('nobody')).resolves.toEqual({ status: 'unavailable', providerId: 'nobody', reason: 'unknown-provider' });
        await expect(controller.requestSwitch('off')).resolves.toEqual({ status: 'unavailable', providerId: 'off', reason: 'not-configured' });
        expect(controller.getSnapshot().pendingSwitch).toBeNull();
        expect(cleanup).not.toHaveBeenCalled();
    });

    it('routes selectProvider: signed-in and accountless providers switch, the others are left to the sign-in window', async () => {
        const controller = createController();
        await expect(controller.selectProvider('beta')).resolves.toEqual({ action: 'switch', result: { status: 'switched', providerId: 'beta', changed: true } });
        await expect(controller.selectProvider('modo')).resolves.toMatchObject({ action: 'switch', result: { status: 'switched', providerId: 'modo' } });
        await expect(controller.selectProvider('gamma')).resolves.toEqual({ action: 'login', providerId: 'gamma' });
        await expect(controller.selectProvider('off')).resolves.toEqual({ action: 'unavailable', providerId: 'off', reason: 'not-configured' });
        // 登录只由登录窗口开始：选一个要登录的平台不开始登录。
        expect(controller.getSnapshot().login).toBeNull();
        expect(auth.resolveLoginMethods).not.toHaveBeenCalled();
    });

    it('switches anyway when leaving the old provider throws', async () => {
        cleanup.mockRejectedValueOnce(new Error('audio element gone'));
        const controller = createController();
        await expect(controller.requestSwitch('beta')).resolves.toMatchObject({ status: 'switched', providerId: 'beta' });
        expect(accounts.stored()).toBe('beta');
        expect(log).toHaveBeenCalledWith('warn', 'switch:cleanup-error', expect.objectContaining({ from: 'alpha', to: 'beta', message: 'audio element gone' }));
    });
});

// ─── 确认之后 ───────────────────────────────────────────────────────────

describe('providerAccountController · completing a sign-in', () => {
    it('[txn] reads the current provider after the confirm without activating it again', async () => {
        accounts = createAccounts('gamma');
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();
        expect(opsOf('refresh', 'set-active')).toEqual([['refresh', 'gamma', 'sign-in']]);
        expect(controller.getSnapshot()).toMatchObject({
            login: null, pendingSwitch: null, lastLoginCompletion: { providerId: 'gamma', outcome: 'completed' },
        });
    });

    it('[txn] reads a different provider, then activates it without asking and without reading again', async () => {
        const controller = createController();
        const started = await controller.startLogin('gamma');
        await confirmNextPoll();
        await manual.flush();
        expect(opsOf('refresh', 'cleanup', 'set-active')).toEqual([['refresh', 'gamma', 'sign-in'], ['cleanup', 'gamma', 'alpha'], ['set-active', 'gamma']]);
        expect(controller.getSnapshot()).toMatchObject({ activeProviderId: 'gamma', login: null, pendingSwitch: null });
        expect(controller.getSnapshot().lastLoginCompletion).toEqual({
            sessionId: started.status === 'started' ? started.sessionId : -1, providerId: 'gamma', outcome: 'completed',
        });
    });

    it('[txn] does not activate a provider whose account could not be read, and shows the failure again', async () => {
        refresh.mockResolvedValueOnce(false);
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();
        expect(controller.getSnapshot()).toMatchObject({
            activeProviderId: 'alpha',
            pendingSwitch: null,
            login: { providerId: 'gamma', phase: 'error', failure: { case: { id: 'account-not-read' } } },
            lastLoginCompletion: { providerId: 'gamma', outcome: 'refresh-failed' },
        });
    });

    it('treats a read that throws as an account that was not read', async () => {
        refresh.mockRejectedValueOnce(new Error('store write failed'));
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'error', failure: { case: { id: 'account-not-read' } } });
        expect(log).toHaveBeenCalledWith('warn', 'login:refresh-error', expect.objectContaining({ providerId: 'gamma', message: 'store write failed' }));
    });

    it('drops the steps after the confirm when the sign-in is closed while the account is read', async () => {
        const reading = deferred<boolean>();
        refresh.mockReturnValueOnce(reading.promise);
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();
        controller.closeLogin();
        reading.resolve(true);
        await manual.flush();
        expect(controller.getSnapshot()).toMatchObject({ login: null, pendingSwitch: null, lastLoginCompletion: null });
    });
});

// ─── 登录 ───────────────────────────────────────────────────────────────

describe('providerAccountController · the sign-in', () => {
    it('asks for a code at once for a single-method provider, with the provider\'s own texts', async () => {
        const controller = createController();
        await expect(controller.startLogin('gamma')).resolves.toMatchObject({ status: 'started', providerId: 'gamma', step: 'started' });
        await manual.flush();
        expect(controller.getSnapshot().login).toMatchObject({
            providerId: 'gamma', phase: 'waiting', codeImage: 'gamma-key-1.png', methods: [], selectedMethodId: null,
            inBrowser: false, failure: null, texts: { title: 'gamma.title', note: 'gamma.note' },
            localService: { available: false },
        });
    });

    it('waits for the person before opening the browser, and opens it when they ask', async () => {
        const controller = createController();
        await expect(controller.startLogin('webby')).resolves.toMatchObject({ status: 'started', step: 'ready' });
        expect(controller.getSnapshot().login).toMatchObject({ providerId: 'webby', phase: 'ready', inBrowser: true });
        expect(auth.startLogin).not.toHaveBeenCalled();
        await expect(controller.openLoginPage()).resolves.toEqual({ status: 'rejected', reason: 'not-reopenable' });

        await expect(controller.retryLogin()).resolves.toMatchObject({ status: 'requested' });
        await manual.flush();
        expect(opsOf('start', 'open-page')).toEqual([['start', 'webby', null, 'key-1'], ['open-page', 'webby', 'key-1']]);
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'waiting', codeImage: '', canReopenLoginPage: true });
        await expect(controller.openLoginPage()).resolves.toEqual({ status: 'opened' });
        expect(opsOf('open-page')).toHaveLength(2);
    });

    it('stops at choosing-method for a multi-method provider and keeps the chosen method on a retry', async () => {
        const controller = createController();
        await expect(controller.startLogin('quill')).resolves.toMatchObject({ step: 'choosing-method' });
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'choosing-method', methods: QUILL_METHODS });
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'method-required' });
        await expect(controller.selectLoginMethod('carrier-pigeon')).resolves.toEqual({ status: 'rejected', reason: 'unknown-method' });

        await controller.selectLoginMethod('wechat');
        auth.checkLogin.mockResolvedValueOnce({ state: 'expired' } satisfies LoginState);
        await manual.advance(POLL);
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'expired', selectedMethodId: 'wechat' });
        await controller.retryLogin();
        await manual.flush();
        expect(opsOf('start')).toEqual([['start', 'quill', 'wechat', 'key-1'], ['start', 'quill', 'wechat', 'key-2']]);
    });

    it('turns a retry down until the time the platform asked to wait for, and takes it after', async () => {
        auth.checkLogin.mockResolvedValueOnce({ state: 'error', failure: { case: 'retry-later', retryAfterMs: 30_000 } } satisfies LoginState);
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.advance(POLL);
        expect(controller.getSnapshot().login?.failure).toMatchObject({ case: { id: 'retry-later', action: 'wait-then-retry' } });
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'cooling-down' });
        await manual.advance(30_000);
        await expect(controller.retryLogin()).resolves.toMatchObject({ status: 'requested' });
    });

    it('turns a retry down while the sign-in is under way', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'rejected', reason: 'not-retryable' });
    });

    it('lets the newest startLogin win when login-method discovery resolves out of order', async () => {
        const first = deferred<LoginMethod[]>();
        auth.resolveLoginMethods.mockReturnValueOnce(first.promise);
        const controller = createController();
        const older = controller.startLogin('quill');
        const newer = controller.startLogin('gamma');
        first.resolve(QUILL_METHODS);
        await expect(older).resolves.toEqual({ status: 'superseded', providerId: 'quill' });
        await expect(newer).resolves.toMatchObject({ status: 'started', providerId: 'gamma' });
        expect(controller.getSnapshot().login).toMatchObject({ providerId: 'gamma' });
    });

    it('stops the previous session before resolving the next provider (one sign-in at a time)', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        await controller.startLogin('netease');
        await manual.flush();
        expect(opsOf('cancel', 'resolve-methods')).toEqual([
            ['resolve-methods', 'gamma'], ['cancel', 'gamma', 'key-1'], ['resolve-methods', 'netease'],
        ]);
        expect(auth.dropRequestLimits).toHaveBeenCalled();
    });

    it('closes the sign-in: cancels the session, clears the snapshot and voids a pending method discovery', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        expect(controller.closeLogin()).toMatchObject({ status: 'closed' });
        expect(controller.getSnapshot().login).toBeNull();
        expect(opsOf('cancel')).toEqual([['cancel', 'gamma', 'key-1']]);

        const methods = deferred<LoginMethod[]>();
        auth.resolveLoginMethods.mockReturnValueOnce(methods.promise);
        const starting = controller.startLogin('quill');
        controller.closeLogin();
        methods.resolve(QUILL_METHODS);
        await expect(starting).resolves.toEqual({ status: 'superseded', providerId: 'quill' });
        expect(controller.getSnapshot().login).toBeNull();
        expect(controller.closeLogin()).toEqual({ status: 'no-session' });
    });

    it('falls back to a single-step sign-in when method discovery throws', async () => {
        auth.resolveLoginMethods.mockRejectedValueOnce(new Error('discovery failed'));
        const controller = createController();
        await expect(controller.startLogin('quill')).resolves.toMatchObject({ step: 'started' });
        expect(log).toHaveBeenCalledWith('warn', 'login:methods-error', expect.objectContaining({ providerId: 'quill' }));
    });

    it('builds the diagnostic report only once a sign-in began', async () => {
        const controller = createController();
        await expect(controller.buildLoginDiagnosticReport()).resolves.toEqual({ status: 'no-session' });
        await controller.startLogin('quill');
        await expect(controller.buildLoginDiagnosticReport()).resolves.toEqual({ status: 'no-session' });
        await controller.selectLoginMethod('qq');
        const result = await controller.buildLoginDiagnosticReport();
        expect(result.status === 'ok' && result.report).toContain('provider: quill (method qq)');
    });

    it('fails a sign-in safely when the provider throws while it is asked what it can do', async () => {
        auth.getProviderCapabilities.mockImplementation(() => { throw new Error('provider removed'); });
        auth.confirmsLoginInBrowser.mockImplementation(() => { throw new Error('provider removed'); });
        auth.getLoginTexts.mockImplementation(() => { throw new Error('provider removed'); });
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'error', inBrowser: false, texts: null, failure: { facts: { step: 'start' } } });
    });
});

// ─── 本地服务 ───────────────────────────────────────────────────────────

describe('providerAccountController · the local service of a sign-in', () => {
    const stoppedService = () => {
        const local = createLocalService({ failed: true, error: 'listen EADDRINUSE' });
        auth.getLoginLocalService.mockImplementation((providerId: OnlineProviderId) => (providerId === 'netease' ? local.service : null));
        const error = new Error('ECONNREFUSED');
        noteLoginFailure(error, { case: 'local-service-stopped' });
        auth.startLogin.mockRejectedValueOnce(error);
        return local;
    };

    it('shows the stopped service, restarts it and starts the sign-in over once it runs again', async () => {
        const local = stoppedService();
        const controller = createController();
        await controller.startLogin('netease');
        await manual.flush();
        expect(controller.getSnapshot().login).toMatchObject({
            phase: 'error',
            failure: { case: { id: 'local-service-stopped', action: 'restart-service' } },
            localService: { available: true, failed: true, error: 'listen EADDRINUSE', restarting: false },
        });
        await expect(controller.restartLocalService()).resolves.toMatchObject({ status: 'resumed' });
        await manual.flush();
        expect(local.restart).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot().login).toMatchObject({ phase: 'waiting', failure: null });
    });

    it('says still-down when the service does not come back, and refuses a restart while one runs or with no service', async () => {
        const local = stoppedService();
        local.restart.mockResolvedValueOnce(false);
        const controller = createController();
        await expect(controller.restartLocalService()).resolves.toEqual({ status: 'no-session' });
        await controller.startLogin('netease');
        await manual.flush();
        await expect(controller.restartLocalService()).resolves.toEqual({ status: 'still-down' });
        local.set({ restarting: true });
        await expect(controller.restartLocalService()).resolves.toEqual({ status: 'rejected', reason: 'not-restartable' });

        await controller.startLogin('gamma');
        await expect(controller.restartLocalService()).resolves.toEqual({ status: 'rejected', reason: 'not-restartable' });
    });

    it('does not start again when the sign-in went on by itself while the service restarted', async () => {
        const local = createLocalService();
        auth.getLoginLocalService.mockReturnValue(local.service);
        const controller = createController();
        await controller.startLogin('netease');
        await manual.flush();
        const id = controller.getSnapshot().login!.id;
        await expect(controller.restartLocalService()).resolves.toEqual({ status: 'resumed', sessionId: id });
        expect(opsOf('start')).toHaveLength(1);
    });

    it('follows the service in the snapshot while its sign-in is open, and lets it go after', async () => {
        const local = createLocalService();
        auth.getLoginLocalService.mockReturnValue(local.service);
        const controller = createController();
        await controller.startLogin('netease');
        local.set({ failed: true, error: 'crashed' });
        expect(controller.getSnapshot().login?.localService).toEqual({ available: true, failed: true, error: 'crashed', restarting: false });
        controller.closeLogin();
        expect(local.listenerCount()).toBe(0);
    });
});

// ─── 登出 ───────────────────────────────────────────────────────────────

describe('providerAccountController · sign-out', () => {
    it('asks first, takes that provider\'s songs out of the player, signs out and tracks the pending state', async () => {
        const answer = deferred<boolean>();
        confirmLogout.mockReturnValueOnce(answer.promise);
        const controller = createController();
        const out = controller.logout('alpha');
        expect(controller.getSnapshot().logout).toEqual({ providerId: 'alpha', status: 'pending' });
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'busy', providerId: 'alpha' });
        answer.resolve(true);
        await expect(out).resolves.toEqual({ status: 'logged-out', providerId: 'alpha' });
        expect(confirmLogout).toHaveBeenCalledWith({ providerId: 'alpha', removesSongs: true });
        expect(opsOf('drop-songs', 'cleanup', 'logout')).toEqual([['drop-songs', 'alpha'], ['logout', 'alpha']]);
        expect(controller.getSnapshot().logout).toEqual({ providerId: null, status: 'idle' });
    });

    it('does nothing more when the person says no', async () => {
        confirmLogout.mockResolvedValueOnce(false);
        const controller = createController();
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'cancelled', providerId: 'alpha' });
        expect(opsOf('drop-songs', 'logout')).toEqual([]);
        expect(controller.getSnapshot().logout.status).toBe('idle');
    });

    it('takes the songs of a provider that is not the current one out too, and stays on the current one', async () => {
        const controller = createController();
        await expect(controller.logout('beta')).resolves.toEqual({ status: 'logged-out', providerId: 'beta' });
        expect(confirmLogout).toHaveBeenCalledWith({ providerId: 'beta', removesSongs: true });
        expect(opsOf('drop-songs', 'cleanup', 'set-active')).toEqual([['drop-songs', 'beta']]);
        expect(controller.getSnapshot().activeProviderId).toBe('alpha');
    });

    it('says songs go only where the player holds that provider\'s songs', async () => {
        holdsSongs = false;
        const controller = createController();
        await controller.logout('alpha');
        expect(confirmLogout).toHaveBeenCalledWith({ providerId: 'alpha', removesSongs: false });
        expect(opsOf('drop-songs')).toEqual([['drop-songs', 'alpha']]);
    });

    it('signs out anyway when taking the songs out throws', async () => {
        dropSongs.mockRejectedValueOnce(new Error('audio element gone'));
        const controller = createController();
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'logged-out', providerId: 'alpha' });
        expect(log).toHaveBeenCalledWith('warn', 'logout:cleanup-error', expect.objectContaining({ providerId: 'alpha', message: 'audio element gone' }));
    });

    it('refuses providers that are not signed in or unknown', async () => {
        const controller = createController();
        await expect(controller.logout('gamma')).resolves.toEqual({ status: 'rejected', providerId: 'gamma', reason: 'not-authenticated' });
        await expect(controller.logout('nobody')).resolves.toEqual({ status: 'rejected', providerId: 'nobody', reason: 'unknown-provider' });
        expect(confirmLogout).not.toHaveBeenCalled();
    });

    it('reports a failing sign-out and frees the slot again', async () => {
        logoutPort.mockRejectedValueOnce(new Error('logout request failed'));
        const controller = createController();
        await expect(controller.logout('alpha')).resolves.toEqual({ status: 'failed', providerId: 'alpha', message: 'logout request failed' });
        expect(controller.getSnapshot().logout.status).toBe('idle');
    });
});

// ─── 当前平台与快照 ─────────────────────────────────────────────────────

describe('providerAccountController · active provider and snapshot', () => {
    it('falls back to the default provider when the stored one is unavailable and writes it back without asking', async () => {
        accounts = createAccounts('vanished');
        const controller = createController();
        expect(controller.getSnapshot().activeProviderId).toBe('netease');
        await manual.flush();
        expect(accounts.stored()).toBe('netease');
        expect(cleanup).not.toHaveBeenCalled();
    });

    it('falls back when the active provider disappears at runtime, keeping the other accounts', async () => {
        const controller = createController();
        accounts.remove('alpha');
        expect(controller.getSnapshot().activeProviderId).toBe('netease');
        expect(accounts.stored()).toBe('netease');
        expect(controller.getSnapshot().providers.find(p => p.providerId === 'beta')?.status).toBe('authenticated');
    });

    it('keeps the snapshot and its parts identical while nothing changed', async () => {
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        const before = controller.getSnapshot();
        const listener = vi.fn();
        controller.subscribe(listener);

        // 账户端口通知但内容没变（omni 每次都新建摘要对象）；轮询照旧回 waiting。
        accounts.notify();
        await manual.advance(POLL);

        expect(controller.getSnapshot()).toBe(before);
        expect(listener).not.toHaveBeenCalled();

        accounts.update('beta', { status: 'error' });
        const after = controller.getSnapshot();
        expect(after).not.toBe(before);
        expect(listener).toHaveBeenCalledOnce();
        expect(after.login).toBe(before.login);
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
    it('cancels the live sign-in, declines later switches and unsubscribes everything', async () => {
        const local = createLocalService();
        auth.getLoginLocalService.mockReturnValue(local.service);
        const controller = createController();
        await controller.startLogin('gamma');
        await manual.flush();
        const listener = vi.fn();
        controller.subscribe(listener);

        controller.dispose();

        await expect(controller.requestSwitch('beta')).resolves.toEqual({ status: 'declined', providerId: 'beta', reason: 'disposed' });
        expect(opsOf('cleanup', 'set-active')).toEqual([]);
        expect(opsOf('cancel')).toEqual([['cancel', 'gamma', 'key-1']]);
        expect(manual.pendingTimers()).toBe(0);
        expect(accounts.listenerCount()).toBe(0);
        expect(local.listenerCount()).toBe(0);
        expect(listener).not.toHaveBeenCalled();
    });

    it('drops a method discovery that resolves after dispose', async () => {
        const methods = deferred<LoginMethod[]>();
        auth.resolveLoginMethods.mockReturnValueOnce(methods.promise);
        const controller = createController();
        const starting = controller.startLogin('quill');
        controller.dispose();
        methods.resolve(QUILL_METHODS);
        await expect(starting).resolves.toEqual({ status: 'superseded', providerId: 'quill' });
        expect(auth.startLogin).not.toHaveBeenCalled();
    });

    it('turns every later call into a safe no-op', async () => {
        const controller = createController();
        controller.dispose();
        await expect(controller.startLogin('gamma')).resolves.toEqual({ status: 'superseded', providerId: 'gamma' });
        await expect(controller.requestSwitch('beta')).resolves.toEqual({ status: 'declined', providerId: 'beta', reason: 'disposed' });
        await expect(controller.retryLogin()).resolves.toEqual({ status: 'no-session' });
        await expect(controller.selectLoginMethod('qq')).resolves.toEqual({ status: 'no-session' });
        await expect(controller.openLoginPage()).resolves.toEqual({ status: 'no-session' });
        await expect(controller.restartLocalService()).resolves.toEqual({ status: 'no-session' });
        await expect(controller.buildLoginDiagnosticReport()).resolves.toEqual({ status: 'no-session' });
        expect(controller.closeLogin()).toEqual({ status: 'no-session' });
        await expect(controller.logout('alpha')).resolves.toMatchObject({ status: 'failed' });
        expect(controller.subscribe(() => { })).toBeTypeOf('function');
    });
});

// ─── 日志 ───────────────────────────────────────────────────────────────

describe('providerAccountController · failures are logged', () => {
    it('logs the read, switch-read and sign-out failures with the error in its own words, for every provider', async () => {
        const said = "EPERM: open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\token'";
        refresh.mockRejectedValueOnce(new Error(said));
        logoutPort.mockRejectedValueOnce(new Error(said));
        const controller = createController();
        await controller.startLogin('gamma');
        await confirmNextPoll();
        await controller.logout('beta');
        const warned = log.mock.calls.filter(([level]) => level === 'warn');
        expect(warned.map(([, event]) => event)).toEqual(expect.arrayContaining(['login:refresh-error', 'logout:error']));
        const failures = warned.filter(([, event]) => event === 'login:refresh-error' || event === 'logout:error');
        expect(failures.length).toBeGreaterThanOrEqual(2);
        for (const [, , detail] of failures) expect(detail).toMatchObject({ name: 'Error', message: said });
    });
});
