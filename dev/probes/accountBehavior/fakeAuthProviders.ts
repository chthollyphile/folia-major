import type { UnifiedSong } from '../../../src/types';
import type { LoginLocalService, LoginLocalServiceStatus, LoginSelfCheckResult, OnlineMusicProvider } from '../../../src/types/onlineMusic';
import { diagnosticLine } from '../../../src/services/onlineMusic/login/loginDiagnosticReport';
import { ACCOUNT_CANCEL_COOLDOWN_MS, ACCOUNT_NETEASE, accountUser, qrKeyOf, type AccountProviderRule } from './accountFixtureRules';
import type { AccountCall, AccountQrState, AccountSelfCheckScript } from './probeApi';

// dev/probes/accountBehavior/fakeAuthProviders.ts
// 账户探针的假 provider：走真实的 provider registry 和 omni（createQrLogin / checkQrLogin / cancelQrLogin /
// getQrTtlMs / resolveQrLoginMethods / logout），只把扫码后端换成可编排的状态队列，并把每一次调用记进账。
// 读账号（getLoginStatus）与宿主侧的登出（App 注入给平台的那张表）也在这里记账，用例读同一本账。

const qrQueues = new Map<string, AccountQrState[]>();
const qrTtls = new Map<string, number | null>();
const refreshFailures = new Map<string, number>();
const createFailures = new Map<string, number>();
const selfChecks = new Map<string, AccountSelfCheckScript>();
let qrSerial = 0;

let calls: AccountCall[] = [];
let callSeq = 0;

export const recordAccountCall = (call: Omit<AccountCall, 'seq'>): void => {
    callSeq += 1;
    calls = [...calls, { seq: callSeq, ...call }];
};

export const getAccountCalls = (): AccountCall[] => calls;
export const clearAccountCalls = (): void => {
    calls = [];
};

export const scriptQrStates = (providerId: string, states: AccountQrState[]): void => {
    qrQueues.set(providerId, [...(qrQueues.get(providerId) ?? []), ...states]);
};
export const setQrTtl = (providerId: string, ttlMs: number | null): void => {
    qrTtls.set(providerId, ttlMs);
};
export const failRefresh = (providerId: string, times: number): void => {
    refreshFailures.set(providerId, times);
};
export const failCreate = (providerId: string, times: number): void => {
    createFailures.set(providerId, times);
};
export const setSelfCheck = (providerId: string, script: AccountSelfCheckScript | null): void => {
    if (script) selfChecks.set(providerId, script);
    else selfChecks.delete(providerId);
};

// 自检结果：tls-reset 时上游域名的握手在 TLS 阶段被重置，network-ok 时每一层都正常。
const selfCheckResultOf = (providerId: string, script: Exclude<AccountSelfCheckScript, 'error'>): LoginSelfCheckResult => ({
    providerId,
    runtime: 'electron',
    startedAt: Date.now(),
    durationMs: 120,
    backend: { status: 'running', port: 4100, error: null, probe: { ok: true, httpStatus: 200, durationMs: 3, error: null } },
    proxy: { env: {}, system: 'DIRECT' },
    hosts: [{
        host: 'probe.example',
        dns: { addresses: [{ address: '203.0.113.7', family: 4 }], durationMs: 2, error: null, fakeIp: false },
        connections: [{
            address: '203.0.113.7',
            family: 4,
            tcpMs: 10,
            tlsMs: script === 'network-ok' ? 30 : null,
            error: script === 'network-ok' ? null : { code: 'ECONNRESET', message: 'read ECONNRESET', phase: 'tls' },
        }],
        https: script === 'network-ok'
            ? { httpStatus: 200, durationMs: 40, remote: { address: '203.0.113.7', family: 4 }, error: null, clockSkewMs: 0 }
            : null,
    }],
});

/** 消耗一次「失败」配额；返回这一次是否该失败。 */
const takeFailure = (table: Map<string, number>, providerId: string): boolean => {
    const remaining = table.get(providerId) ?? 0;
    if (remaining <= 0) return false;
    table.set(providerId, remaining - 1);
    return true;
};

const shouldFailRefresh = (providerId: string): boolean => takeFailure(refreshFailures, providerId);

// ---- 网易本地后端（假的）：真实的是网易云模组的 auth@1.localService（sources/netease/core/neteaseLocalService.ts），
// 登录窗口经 provider.auth.localService 看它的状态、按重启。探针按 setNeteaseBackend / setBackendRestart 编排。----
type FakeBackendStatus = 'starting' | 'running' | 'error';
let fakeBackend: { supported: boolean; status: FakeBackendStatus; error: string | null } = { supported: false, status: 'running', error: null };
let fakeBackendRestarting = false;
let fakeBackendView: LoginLocalServiceStatus = { failed: false, error: null, restarting: false };
let restartPlan: { outcome: 'running' | 'error'; delayMs: number } = { outcome: 'running', delayMs: 300 };
const fakeBackendListeners = new Set<() => void>();

const publishFakeBackend = (): void => {
    const failed = fakeBackend.status === 'error';
    fakeBackendView = { failed, error: failed ? fakeBackend.error : null, restarting: fakeBackendRestarting };
    fakeBackendListeners.forEach(listener => listener());
};

/** supported=false 等同 Web 版（没有后端可看）。status 为 error 时假网易的要码会抛错，和真实一致。 */
export const setFakeNeteaseBackend = (backend: { supported: boolean; status: FakeBackendStatus; error?: string | null }): void => {
    fakeBackend = { supported: backend.supported, status: backend.status, error: backend.error ?? null };
    publishFakeBackend();
};
/** 下一次重启的结果与耗时。 */
export const setFakeNeteaseRestart = (outcome: 'running' | 'error', delayMs = 300): void => {
    restartPlan = { outcome, delayMs };
};

const fakeNeteaseLocalService: LoginLocalService = {
    subscribe: (listener) => {
        fakeBackendListeners.add(listener);
        return () => {
            fakeBackendListeners.delete(listener);
        };
    },
    getStatus: () => fakeBackendView,
    restart: async () => {
        recordAccountCall({ op: 'backend-restart', providerId: ACCOUNT_NETEASE });
        if (fakeBackendRestarting) return fakeBackend.status === 'running';
        fakeBackendRestarting = true;
        publishFakeBackend();
        try {
            await new Promise(resolve => setTimeout(resolve, restartPlan.delayMs));
            fakeBackend = { ...fakeBackend, status: restartPlan.outcome, error: restartPlan.outcome === 'error' ? 'probe: restart failed' : null };
        } finally {
            fakeBackendRestarting = false;
            publishFakeBackend();
        }
        return fakeBackend.status === 'running';
    },
};

/** 清空编排与账（探针挂载时调用；序号不归零，整页内的 key 保持唯一）。 */
export const resetFakeAuth = (): void => {
    qrQueues.clear();
    qrTtls.clear();
    refreshFailures.clear();
    createFailures.clear();
    selfChecks.clear();
    fakeBackend = { supported: false, status: 'running', error: null };
    fakeBackendRestarting = false;
    restartPlan = { outcome: 'running', delayMs: 300 };
    publishFakeBackend();
    clearAccountCalls();
};

// 二维码图片里写着 key：用例看 img 的 src 就知道弹窗显示的是哪一个会话。
const qrImageOf = (key: string): string => (
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" data-qr-key="${key}">`
        + `<rect width="160" height="160" fill="#fff"/><text x="8" y="84" font-size="10">${key}</text></svg>`,
    )}`
);

const NO_CAPABILITIES = {
    search: false,
    playback: false,
    lyrics: false,
    userLibrary: false,
    playlists: false,
    albums: false,
    artists: false,
    recommendations: false,
    mutations: false,
    wordByWordLyrics: false,
};

/** 由固定规则生成一个假 provider；auth 为 false 的规则生成没有账户的源（mod）。 */
export const createFakeAuthProvider = (rule: AccountProviderRule): OnlineMusicProvider => {
    const providerId = rule.id;
    const base: OnlineMusicProvider = {
        id: providerId,
        displayName: rule.displayName,
        shortName: rule.shortName,
        getAvailability: () => ({ configured: true }),
        capabilities: { ...NO_CAPABILITIES, auth: rule.auth },
        normalizeSong: raw => raw as UnifiedSong,
    };
    if (!rule.auth) return base;

    const methods = rule.methods;
    return {
        ...base,
        auth: {
            // 只有假网易有本地后端，且只在桌面版（supported）时；按读取时的编排答。
            get localService(): LoginLocalService | undefined {
                return providerId === ACCOUNT_NETEASE && fakeBackend.supported ? fakeNeteaseLocalService : undefined;
            },
            // 读账号（omni.readAccount：登录确认之后、切到这个平台之后、同步数据时）先问平台谁登录着：每问一次记一笔
            // refresh。编排了失败（failRefresh）就抛一个普通的错：平台没问到，账号没读到。
            getLoginStatus: async () => {
                if (shouldFailRefresh(providerId)) {
                    recordAccountCall({ op: 'refresh', providerId, ok: false });
                    throw new Error(`probe: cannot read the account of ${providerId}`);
                }
                recordAccountCall({ op: 'refresh', providerId, ok: true });
                return accountUser(providerId);
            },
            // 假网易的本地后端没起来时要码抛的错：照真实的网易云模组点名「本地服务没有在跑」，登录窗口才给「重启后端」。
            describeLoginFailure: () => (
                providerId === ACCOUNT_NETEASE && fakeBackend.supported && fakeBackend.status === 'error'
                    ? { case: 'local-service-stopped' as const }
                    : null
            ),
            logout: async () => {
                recordAccountCall({ op: 'auth-logout', providerId });
            },
            ...(methods ? {
                getLoginMethods: () => methods,
                resolveLoginMethods: async () => {
                    recordAccountCall({ op: 'resolve-methods', providerId });
                    return methods;
                },
            } : {}),
            startLogin: async (methodId?: string) => {
                qrSerial += 1;
                const key = qrKeyOf(providerId, methodId, qrSerial);
                recordAccountCall({ op: 'create', providerId, key, methodId: methodId ?? null });
                // 网易本地后端没起来时，真实的要码请求必然失败。
                const backendDown = providerId === ACCOUNT_NETEASE && fakeBackend.status === 'error';
                if (backendDown || takeFailure(createFailures, providerId)) {
                    throw new Error(`probe: cannot create QR for ${providerId}`);
                }
                return key;
            },
            createQr: async (key: string) => qrImageOf(key),
            checkLogin: async (key: string) => {
                recordAccountCall({ op: 'check', providerId, key });
                const queue = qrQueues.get(providerId) ?? [];
                const state = queue.shift() ?? 'waiting';
                qrQueues.set(providerId, queue);
                if (state === 'canceled') {
                    // 平台的原话和它要求等多久，按 LoginFailureDetail 交出来：登录窗口据此先倒数、再给重试。
                    return {
                        state: 'error' as const,
                        message: 'probe: canceled on device',
                        failure: { message: 'probe: canceled on device', retryAfterMs: ACCOUNT_CANCEL_COOLDOWN_MS },
                    };
                }
                return state === 'error' ? { state, message: 'probe: check error' } : { state };
            },
            cancelLogin: async (key: string) => {
                recordAccountCall({ op: 'cancel', providerId, key });
            },
            getLoginTtlMs: () => qrTtls.get(providerId) ?? 0,
            getLoginDiagnostics: async () => [diagnosticLine`probe: ${providerId} diagnostics`],
            canRunLoginSelfCheck: () => selfChecks.has(providerId),
            runLoginSelfCheck: async () => {
                recordAccountCall({ op: 'self-check', providerId });
                const script = selfChecks.get(providerId);
                if (!script) return null;
                if (script === 'error') throw new Error('probe: self-check unavailable');
                return selfCheckResultOf(providerId, script);
            },
        },
    };
};
