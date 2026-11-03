import type { UnifiedSong } from '../../../src/types';
import type { LoginSelfCheckResult, OnlineMusicProvider } from '../../../src/types/onlineMusic';
import { useNeteaseApiStatusStore } from '../../../src/services/onlineMusic/netease/useNeteaseApiStatusStore';
import { diagnosticLine } from '../../../src/services/onlineMusic/login/loginDiagnosticReport';
import { ACCOUNT_CANCEL_COOLDOWN_MS, ACCOUNT_NETEASE, accountUser, qrKeyOf, type AccountProviderRule } from './accountFixtureRules';
import type { AccountCall, AccountQrState, AccountSelfCheckScript } from './probeApi';

// dev/probes/accountBehavior/fakeAuthProviders.ts
// 账户探针的假 provider：走真实的 provider registry 和 omni（createQrLogin / checkQrLogin / cancelQrLogin /
// getQrTtlMs / resolveQrLoginMethods / logout），只把扫码后端换成可编排的状态队列，并把每一次调用记进账。
// 宿主侧的刷新与登出（App 注入给平台的那两张表）也在这里记账，用例读同一本账。

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

export const shouldFailRefresh = (providerId: string): boolean => takeFailure(refreshFailures, providerId);

/** 清空编排与账（探针挂载时调用；序号不归零，整页内的 key 保持唯一）。 */
export const resetFakeAuth = (): void => {
    qrQueues.clear();
    qrTtls.clear();
    refreshFailures.clear();
    createFailures.clear();
    selfChecks.clear();
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
            getLoginStatus: async () => accountUser(providerId),
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
                const backendDown = providerId === ACCOUNT_NETEASE
                    && useNeteaseApiStatusStore.getState().status?.status === 'error';
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
                    return {
                        state: 'error' as const,
                        message: 'probe: canceled on device',
                        reason: 'canceled-on-device' as const,
                        retryAfterMs: ACCOUNT_CANCEL_COOLDOWN_MS,
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
