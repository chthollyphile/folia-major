import { DEFAULT_ONLINE_PROVIDER_ID, OnlineProviderError } from '../../../types/onlineMusic';
import type { LoginLocalServiceStatus, OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type { LoginFailure } from '../../../types/loginFailure';
import type {
    LibraryLoginLocalServiceState,
    LibraryLoginPhase,
    LibraryLoginSessionSnapshot,
    LibraryLogoutRejectReason,
    LibraryProviderUnavailableReason,
} from './account.contract';
import type { LibraryHomeMessage } from '../home/homeModel.contract';
import { errorMessage } from '../../../utils/errorText';
import { canSwitchToProviderDirectly } from './onlineProviderAccountView';

// src/library/core/account/accountRules.ts
// 在线账户的纯规则（Library v2 · A1）：选平台走哪一支、当前平台的回落、切换确认的文案、能否登出、登录会话的派生
// （是否在选方式、是否在登录途中、能否重来、等待再试到什么时刻、本地服务能否重启）、诊断报告交给谁、写进日志的
// 错误描述。任何 suite、登录窗口与账户 controller 共用；这里只返回 i18n key，翻译在绑定 / UI。

// ─── 选平台 ─────────────────────────────────────────────────────────────

export type LibraryProviderSelection =
    | { kind: 'unavailable'; reason: LibraryProviderUnavailableReason }
    | { kind: 'switch' }
    | { kind: 'login' };

/**
 * 选一个平台时走哪一支：不在列表里 / 未配置 → unavailable；能直接切（已登录，或 mod 源这类无账户的）→ switch；
 * 否则 → login（未登录、登录失效、账户还在解析都要登录）。
 */
export const resolveProviderSelection = (provider: ProviderAccountSummary | undefined): LibraryProviderSelection => {
    if (!provider) return { kind: 'unavailable', reason: 'unknown-provider' };
    if (!provider.availability.configured) return { kind: 'unavailable', reason: 'not-configured' };
    if (canSwitchToProviderDirectly(provider)) return { kind: 'switch' };
    return { kind: 'login' };
};

/** 平台列表上的动作文案：能直接切是「切换到」，否则「登录」。 */
export const resolveProviderSelectLabel = (provider: ProviderAccountSummary): LibraryHomeMessage => ({
    key: canSwitchToProviderDirectly(provider) ? 'home.switchToProvider' : 'home.loginToProvider',
    values: { provider: provider.shortName || provider.displayName },
});

// ─── 当前平台 ───────────────────────────────────────────────────────────

/** 存的当前平台不在 provider 列表里（例如 mod 源被关掉）时回落到默认平台；账户缓存不动。 */
export const resolveActiveProviderId = (
    providers: readonly ProviderAccountSummary[],
    storedProviderId: OnlineProviderId,
): OnlineProviderId => (
    providers.some(provider => provider.providerId === storedProviderId) ? storedProviderId : DEFAULT_ONLINE_PROVIDER_ID
);

/** 当前平台的摘要；回落后的 id 也找不到（列表里没有默认平台）时取第一个。 */
export const resolveActiveProviderSummary = (
    providers: readonly ProviderAccountSummary[],
    activeProviderId: OnlineProviderId,
): ProviderAccountSummary | undefined => (
    providers.find(provider => provider.providerId === activeProviderId) || providers[0]
);

// ─── 切换确认 ───────────────────────────────────────────────────────────

/** 切换确认框的文案（播放器里有歌时才问）；平台名由调用方经账户端口的 getProviderLabel 取。 */
export const resolveProviderSwitchCopy = (providerLabel: string): { title: LibraryHomeMessage; description: LibraryHomeMessage } => ({
    title: { key: 'home.switchOnlineProvider' },
    description: { key: 'home.confirmOnlineProviderSwitch', values: { provider: providerLabel } },
});

// ─── 登出 ───────────────────────────────────────────────────────────────

export type LibraryLogoutEligibility =
    | { allowed: true }
    | { allowed: false; reason: LibraryLogoutRejectReason };

/** 已登录的平台可以登出（不只是当前平台：登录窗口里选中的任何一个已登录的平台都有「退出登录」）。 */
export const resolveLogoutEligibility = (provider: ProviderAccountSummary | undefined): LibraryLogoutEligibility => {
    if (!provider) return { allowed: false, reason: 'unknown-provider' };
    if (provider.status !== 'authenticated') return { allowed: false, reason: 'not-authenticated' };
    return { allowed: true };
};

/** 登出入口可用（与 controller 的判定相同）；平台列表只在哪一行放它（例如只在当前平台那一行）由界面自己定。 */
export const canLogoutProvider = (provider: ProviderAccountSummary | undefined): boolean => (
    resolveLogoutEligibility(provider).allowed
);

// ─── 登录会话的派生 ─────────────────────────────────────────────────────

type LoginMethodState = Pick<LibraryLoginSessionSnapshot, 'methods' | 'selectedMethodId'>;

/** 多方式且还没选：停在第一步，不向平台要码。 */
export const isAwaitingLoginMethod = ({ methods, selectedMethodId }: LoginMethodState): boolean => (
    methods.length > 0 && selectedMethodId == null
);

/**
 * 登录正在进行：平台还在说有哪几种登录方式、正在要码、等着扫或等着确认、或者确认了正在读账号。这时再来一次
 * 会取消掉它、向平台再要一把新的 key（再选一次同一行什么都不做；本地服务重启之后不再开始一次）。
 */
export const isLoginUnderWay = (phase: LibraryLoginPhase): boolean => (
    phase === 'resolving-methods' || phase === 'loading' || phase === 'waiting' || phase === 'scanned' || phase === 'confirmed'
);

/** 平台要求稍后再试、又没说等多久时等的时间。 */
const DEFAULT_RETRY_WAIT_MS = 20_000;
/** 倒数最多数这么久：平台说得再久（或者把单位说错了），五分钟后按钮也能点；还不行，平台会再说一次。 */
const MAX_RETRY_WAIT_MS = 5 * 60_000;

/** 「稍后再试」等到什么时刻（毫秒时间戳）：从失败的那一刻算起，等平台说的那么久，至多五分钟。 */
export const retryWaitEndsAt = (failure: LoginFailure): number => (
    failure.at + Math.min(failure.facts.retryAfterMs ?? DEFAULT_RETRY_WAIT_MS, MAX_RETRY_WAIT_MS)
);

/** 离那个时刻还有几秒，向上取整；到了或者过了是 0。 */
export const secondsLeft = (endsAt: number, now: number): number => Math.max(0, Math.ceil((endsAt - now) / 1000));

/**
 * 重来从什么时刻起可以（毫秒时间戳）：要先等的情况（wait-then-retry）等到 retryWaitEndsAt，别的不用等（0）。
 * 窗口里的按钮、二维码那一块上的刷新和 controller 守同一个时刻：不然重来会撞上平台的拦截。
 */
export const retryOpensAt = (failure: LoginFailure): number => (
    failure.case.action === 'wait-then-retry' ? retryWaitEndsAt(failure) : 0
);

/**
 * 能不能（重新）开始：等用的人打开浏览器（ready）、过期或出错之后，且不在选方式的第一步、没有在等平台要求的时刻。
 * `now` 是此刻（毫秒时间戳）。
 */
export const canRetryLogin = (
    session: Pick<LibraryLoginSessionSnapshot, 'phase' | 'methods' | 'selectedMethodId' | 'failure'>,
    now: number,
): boolean => (
    (session.phase === 'ready' || session.phase === 'expired' || session.phase === 'error')
    && !isAwaitingLoginMethod(session)
    && (session.failure === null || now >= retryOpensAt(session.failure))
);

const NO_LOCAL_SERVICE: LibraryLoginLocalServiceState = Object.freeze({ available: false, failed: false, error: null, restarting: false });

/** 本地服务的样子（provider 没有这样的服务时 status 是 null）。 */
export const resolveLocalServiceState = (status: LoginLocalServiceStatus | null): LibraryLoginLocalServiceState => (
    status ? { available: true, failed: status.failed, error: status.error, restarting: status.restarting } : NO_LOCAL_SERVICE
);

/** 本地服务此刻能不能重启：有这样的服务，而且没有正在重启。 */
export const canRestartLocalService = (state: LibraryLoginLocalServiceState): boolean => state.available && !state.restarting;

// ─── 诊断报告交给谁 ─────────────────────────────────────────────────────

/**
 * 跑这个前端的构建与运行环境（反馈去向用）。build 与 utils/buildProvenance 的 BuildKind 相同：official 是本仓库 CI
 * 构建的，self-hosted 是文档里的自部署方式（Docker、Vercel、Cloudflare），unofficial 是其余一切。web 即网页版。
 */
export type LibraryLoginReportEnvironment = { build: 'official' | 'self-hosted' | 'unofficial'; web: boolean };

/**
 * 诊断报告该交给谁。github：照常去本仓库反馈（官方构建与自部署）；web-deployment：网页版的后端没配置或连不上，
 * 是部署问题，该找网站的部署者；unofficial-build：不是本仓库 CI 构建、也不是文档里的自部署方式（fork 的 CI、
 * 本地构建、他人打包），该找提供者。部署问题优先：它比「非官方」更能告诉用户该怎么办。
 */
export type LibraryLoginReportRoute = 'github' | 'web-deployment' | 'unofficial-build';

export const resolveLoginReportRoute = (
    environment: LibraryLoginReportEnvironment,
    session: Pick<LibraryLoginSessionSnapshot, 'failure' | 'selfCheck'>,
): LibraryLoginReportRoute => {
    const remoteUnreachable = session.selfCheck?.status === 'done' && session.selfCheck.verdict.kind === 'remote-unreachable';
    // 网页版一开始就失败（没配 VITE_*_API_BASE、Failed to fetch、跨域）几乎都是部署配置问题。
    if (environment.web && (session.failure?.facts.step === 'start' || remoteUnreachable)) return 'web-deployment';
    if (environment.build === 'unofficial') return 'unofficial-build';
    return 'github';
};

/** 不去 GitHub 时代替反馈按钮的那句说明。 */
export const LOGIN_REPORT_ELSEWHERE_COPY: Readonly<Record<Exclude<LibraryLoginReportRoute, 'github'>, LibraryHomeMessage>> = {
    'web-deployment': { key: 'home.qrReportWebDeployment' },
    'unofficial-build': { key: 'home.qrReportUnofficialBuild' },
};

// ─── 登录 / 账户错误的日志描述 ──────────────────────────────────────────

/**
 * 写进日志与诊断时间线的错误描述（登录会话与账户 controller 共用，不分 provider）：错误名、原文与代号，
 * OnlineProviderError 的 HTTP 状态、平台要求的等待时长和是否网络层的瞬时失败，以及它的 cause。
 */
export const describeLoginError = (error: unknown): Record<string, unknown> => {
    if (!(error instanceof Error)) return { name: 'Error', message: errorMessage(error) };
    const record = error as Error & Record<string, unknown>;
    const cause = error instanceof OnlineProviderError ? error.cause : record.cause;
    const detail: Record<string, unknown> = {
        name: error.name,
        message: error.message,
        code: record.code,
        httpStatus: Number.isInteger(record.httpStatus) ? record.httpStatus : undefined,
        retryAfterMs: typeof record.retryAfterMs === 'number' && Number.isFinite(record.retryAfterMs) ? record.retryAfterMs : undefined,
        transient: typeof record.transient === 'boolean' ? record.transient : undefined,
        cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : cause,
    };
    return Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined && value !== null));
};
