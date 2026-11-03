import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import type { LibraryLoginPhase } from '@/library/core/account/account.contract';
import {
    canLogoutProvider,
    canRestartLocalService,
    canRetryLogin,
    describeLoginError,
    isAwaitingLoginMethod,
    isLoginUnderWay,
    resolveActiveProviderId,
    resolveActiveProviderSummary,
    resolveLocalServiceState,
    resolveLoginReportRoute,
    resolveLogoutEligibility,
    resolveProviderSelectLabel,
    resolveProviderSelection,
    resolveProviderSwitchCopy,
    retryOpensAt,
    retryWaitEndsAt,
    secondsLeft,
} from '@/library/core/account/accountRules';
import { loginCaseOf, loginFailureFacts } from '@/services/onlineMusic/login/loginFailureCase';
import type { LoginFailure } from '@/types/loginFailure';
import { OnlineProviderError, type LoginFailureDetail, type LoginMethod, type LoginStep, type ProviderAccountSummary } from '@/types/onlineMusic';

// test/unit/library/core/accountRules.test.ts
// 在线账户的纯规则：选平台的三支（未配置 / 直接切 / 登录）、当前平台回落、切换确认的文案、能登出哪个平台、登录会话的派生
// （选方式、登录途中、能否重来、等待再试到什么时刻）、本地服务、诊断报告交给谁、写进日志的错误描述（洗过）。
// 每个 key 都要在英文语言包里存在。

const summary = (patch: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId: 'netease',
    displayName: 'NetEase Cloud Music',
    shortName: 'NetEase',
    availability: { configured: true },
    status: 'anonymous',
    user: null,
    collections: [],
    ...patch,
});

// Folium mod 源：capabilities.auth=false，永远没有账户条目（status 一直是 unknown）。
const modSource = (patch: Partial<ProviderAccountSummary> = {}) => summary({
    providerId: 'folium.mod-a.source',
    displayName: 'Mod Source',
    shortName: '',
    requiresAccount: false,
    status: 'unknown',
    hydration: 'loading',
    ...patch,
});

const QQ_METHODS: LoginMethod[] = [
    { id: 'qq', labelKey: 'home.qqLoginMethodQq', iconKey: 'qq' },
    { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
];

const AT = 1_000_000;
const failureAt = (step: LoginStep, detail?: LoginFailureDetail): LoginFailure => {
    const facts = loginFailureFacts({ step, inBrowser: false, scanned: false }, { detail });
    return { case: loginCaseOf(facts), facts, at: AT };
};

/** 'home.switchToProvider' → en.home.switchToProvider，确认 key 真的存在。 */
const translate = (key: string): unknown => key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    en,
);
const expectKey = (key: string) => expect(typeof translate(key), key).toBe('string');

describe('provider selection', () => {
    it('logs in to a configured provider that is not signed in', () => {
        expect(resolveProviderSelection(summary({ status: 'anonymous' }))).toEqual({ kind: 'login' });
    });

    it('logs in while the account is still unknown or errored (nothing to switch to yet)', () => {
        expect(resolveProviderSelection(summary({ status: 'unknown', hydration: 'loading' }))).toEqual({ kind: 'login' });
        expect(resolveProviderSelection(summary({ status: 'error' }))).toEqual({ kind: 'login' });
    });

    it('logs in again when the stored session expired (needsRelogin: error auth-required)', () => {
        expect(resolveProviderSelection(summary({ status: 'anonymous', error: 'auth-required' }))).toEqual({ kind: 'login' });
    });

    it('switches directly to a signed-in provider', () => {
        expect(resolveProviderSelection(summary({ providerId: 'kugou', status: 'authenticated' }))).toEqual({ kind: 'switch' });
    });

    it('switches directly to a mod source, which has no account at all', () => {
        expect(resolveProviderSelection(modSource())).toEqual({ kind: 'switch' });
    });

    it('treats an unconfigured provider as unavailable before anything else', () => {
        expect(resolveProviderSelection(summary({ availability: { configured: false, reason: 'not-configured' } })))
            .toEqual({ kind: 'unavailable', reason: 'not-configured' });
        // 已登录或无账户也一样：界面上那一项本就是禁用的。
        expect(resolveProviderSelection(summary({ status: 'authenticated', availability: { configured: false } })))
            .toEqual({ kind: 'unavailable', reason: 'not-configured' });
        expect(resolveProviderSelection(modSource({ availability: { configured: false, reason: 'runtime-unavailable' } })))
            .toEqual({ kind: 'unavailable', reason: 'not-configured' });
    });

    it('treats a provider missing from the list as unavailable', () => {
        expect(resolveProviderSelection(undefined)).toEqual({ kind: 'unavailable', reason: 'unknown-provider' });
    });

    it('labels the action by the branch it will take', () => {
        expect(resolveProviderSelectLabel(summary({ providerId: 'kugou', shortName: 'KuGou', status: 'authenticated' })))
            .toEqual({ key: 'home.switchToProvider', values: { provider: 'KuGou' } });
        expect(resolveProviderSelectLabel(summary({ providerId: 'qq', shortName: 'QQ' })))
            .toEqual({ key: 'home.loginToProvider', values: { provider: 'QQ' } });
        // shortName 为空时用 displayName。
        expect(resolveProviderSelectLabel(modSource())).toEqual({ key: 'home.switchToProvider', values: { provider: 'Mod Source' } });
        expectKey('home.switchToProvider');
        expectKey('home.loginToProvider');
    });
});

describe('active provider fallback', () => {
    const providers = [summary(), summary({ providerId: 'kugou' }), modSource()];

    it('keeps the stored provider while it is listed', () => {
        expect(resolveActiveProviderId(providers, 'kugou')).toBe('kugou');
        expect(resolveActiveProviderId(providers, 'folium.mod-a.source')).toBe('folium.mod-a.source');
    });

    it('falls back to the default provider (netease) when the stored provider went away', () => {
        expect(resolveActiveProviderId(providers, 'folium.mod-gone.source')).toBe('netease');
        expect(resolveActiveProviderId([], 'kugou')).toBe('netease');
    });

    it('finds the active summary, or the first provider when even netease is missing', () => {
        expect(resolveActiveProviderSummary(providers, 'kugou')?.providerId).toBe('kugou');
        const withoutNetease = [summary({ providerId: 'kugou' }), summary({ providerId: 'qq' })];
        expect(resolveActiveProviderSummary(withoutNetease, 'netease')?.providerId).toBe('kugou');
        expect(resolveActiveProviderSummary([], 'netease')).toBeUndefined();
    });
});

describe('switch confirmation copy', () => {
    it('names the target provider', () => {
        expect(resolveProviderSwitchCopy('KuGou')).toEqual({
            title: { key: 'home.switchOnlineProvider' },
            description: { key: 'home.confirmOnlineProviderSwitch', values: { provider: 'KuGou' } },
        });
        expectKey('home.switchOnlineProvider');
        expectKey('home.confirmOnlineProviderSwitch');
    });
});

describe('logout eligibility', () => {
    it('allows any signed-in provider, the current one or not', () => {
        const kugou = summary({ providerId: 'kugou', status: 'authenticated' });
        expect(resolveLogoutEligibility(kugou)).toEqual({ allowed: true });
        expect(canLogoutProvider(kugou)).toBe(true);
    });

    it('rejects a provider unless it is authenticated', () => {
        for (const status of ['unknown', 'anonymous', 'error'] as const) {
            expect(resolveLogoutEligibility(summary({ status }))).toEqual({ allowed: false, reason: 'not-authenticated' });
        }
        // 登录失效也没有可登出的会话。
        expect(canLogoutProvider(summary({ status: 'anonymous', error: 'auth-required' }))).toBe(false);
    });

    it('never offers logout for a mod source', () => {
        expect(resolveLogoutEligibility(modSource())).toEqual({ allowed: false, reason: 'not-authenticated' });
    });

    it('rejects an unknown provider', () => {
        expect(resolveLogoutEligibility(undefined)).toEqual({ allowed: false, reason: 'unknown-provider' });
        expect(canLogoutProvider(undefined)).toBe(false);
    });
});

describe('login session derivations', () => {
    const session = (phase: LibraryLoginPhase, patch: { methods?: LoginMethod[]; selectedMethodId?: string | null; failure?: LoginFailure | null } = {}) => ({
        phase,
        methods: patch.methods ?? [],
        selectedMethodId: patch.selectedMethodId ?? null,
        failure: patch.failure ?? null,
    });

    it('awaits a method only when several are declared and none is picked', () => {
        expect(isAwaitingLoginMethod({ methods: [], selectedMethodId: null })).toBe(false);
        expect(isAwaitingLoginMethod({ methods: QQ_METHODS, selectedMethodId: null })).toBe(true);
        expect(isAwaitingLoginMethod({ methods: QQ_METHODS, selectedMethodId: 'wechat' })).toBe(false);
    });

    it('is under way from the methods question until the account is read', () => {
        const under: LibraryLoginPhase[] = ['resolving-methods', 'loading', 'waiting', 'scanned', 'confirmed'];
        const not: LibraryLoginPhase[] = ['choosing-method', 'ready', 'expired', 'error'];
        for (const phase of under) expect(isLoginUnderWay(phase), phase).toBe(true);
        for (const phase of not) expect(isLoginUnderWay(phase), phase).toBe(false);
    });

    it('allows a start or a retry only when ready, expired or failed, outside the method step, and not before the platform\'s time', () => {
        for (const phase of ['ready', 'expired', 'error'] as const) expect(canRetryLogin(session(phase), AT), phase).toBe(true);
        for (const phase of ['resolving-methods', 'choosing-method', 'loading', 'waiting', 'scanned', 'confirmed'] as const) {
            expect(canRetryLogin(session(phase), AT), phase).toBe(false);
        }
        expect(canRetryLogin(session('expired', { methods: QQ_METHODS }), AT)).toBe(false);
        expect(canRetryLogin(session('expired', { methods: QQ_METHODS, selectedMethodId: 'qq' }), AT)).toBe(true);
        const later = failureAt('check', { case: 'retry-later', retryAfterMs: 30_000 });
        expect(canRetryLogin(session('error', { failure: later }), AT + 29_999)).toBe(false);
        expect(canRetryLogin(session('error', { failure: later }), AT + 30_000)).toBe(true);
    });

    it('waits for what the platform asked, twenty seconds when it said nothing, five minutes at most', () => {
        expect(retryWaitEndsAt(failureAt('check', { case: 'retry-later', retryAfterMs: 31_000 }))).toBe(AT + 31_000);
        expect(retryWaitEndsAt(failureAt('check', { case: 'retry-later' }))).toBe(AT + 20_000);
        expect(retryWaitEndsAt(failureAt('check', { case: 'retry-later', retryAfterMs: 3_600_000 }))).toBe(AT + 300_000);
        expect(retryOpensAt(failureAt('check', { case: 'retry-later', retryAfterMs: 31_000 }))).toBe(AT + 31_000);
        // A case that does not wait opens at once.
        expect(retryOpensAt(failureAt('check', { code: '8821' }))).toBe(0);
        expect(secondsLeft(AT + 1_500, AT)).toBe(2);
        expect(secondsLeft(AT, AT + 1)).toBe(0);
    });
});

describe('the local service of a sign-in', () => {
    it('is not there for a provider without one, and can be restarted while it is not restarting', () => {
        const none = resolveLocalServiceState(null);
        expect(none).toEqual({ available: false, failed: false, error: null, restarting: false });
        expect(canRestartLocalService(none)).toBe(false);
        const down = resolveLocalServiceState({ failed: true, error: 'listen EADDRINUSE', restarting: false });
        expect(down).toEqual({ available: true, failed: true, error: 'listen EADDRINUSE', restarting: false });
        expect(canRestartLocalService(down)).toBe(true);
        expect(canRestartLocalService(resolveLocalServiceState({ failed: true, error: null, restarting: true }))).toBe(false);
    });
});

describe('login error descriptions', () => {
    it('keeps the name, the sentence and the code, the same for every provider', () => {
        expect(describeLoginError(new TypeError('Failed to fetch'))).toEqual({ name: 'TypeError', message: 'Failed to fetch' });
        expect(describeLoginError('plain text')).toMatchObject({ name: 'Error' });
    });

    it('adds the HTTP status, the wait, whether it was transient and its cause, with the sentence whole', () => {
        const said = "open 'C:\\Users\\Zhang San\\AppData\\token' failed";
        const error = Object.assign(
            new OnlineProviderError('network', said, 'qq', new TypeError('fetch failed')),
            { httpStatus: 502, retryAfterMs: 4000, transient: true },
        );
        expect(describeLoginError(error)).toEqual({
            name: 'OnlineProviderError', message: said, code: 'network', httpStatus: 502, retryAfterMs: 4000, transient: true, cause: 'TypeError: fetch failed',
        });
    });
});

describe('where a login diagnostics report goes', () => {
    const doneWith = (kind: string) => ({
        status: 'done' as const,
        result: {} as never,
        verdict: { kind, detail: null, proxy: null } as never,
    });
    const official = { build: 'official' as const, web: false };
    // 一开始就失败（start 这一步）与之后的失败。
    const atStart = failureAt('start');
    const later = failureAt('check');

    it('sends official desktop failures to GitHub', () => {
        expect(resolveLoginReportRoute(official, { failure: later, selfCheck: null })).toBe('github');
        expect(resolveLoginReportRoute(official, { failure: atStart, selfCheck: null })).toBe('github');
    });

    it('treats a web build that cannot start or reach its API as a deployment problem', () => {
        expect(resolveLoginReportRoute({ build: 'unofficial' as const, web: true }, { failure: atStart, selfCheck: null })).toBe('web-deployment');
        expect(resolveLoginReportRoute({ build: 'self-hosted' as const, web: true }, { failure: later, selfCheck: doneWith('remote-unreachable') })).toBe('web-deployment');
        expect(resolveLoginReportRoute({ build: 'self-hosted' as const, web: true }, { failure: later, selfCheck: doneWith('network-ok') })).toBe('github');
    });

    it('sends self-hosted failures that are not deployment problems to GitHub', () => {
        expect(resolveLoginReportRoute({ build: 'self-hosted', web: false }, { failure: later, selfCheck: null })).toBe('github');
    });

    it('never sends unofficial builds to GitHub', () => {
        expect(resolveLoginReportRoute({ build: 'unofficial' as const, web: false }, { failure: later, selfCheck: null })).toBe('unofficial-build');
        expect(resolveLoginReportRoute({ build: 'unofficial' as const, web: true }, { failure: later, selfCheck: doneWith('network-ok') })).toBe('unofficial-build');
    });
});
