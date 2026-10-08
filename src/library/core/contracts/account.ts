import type { Theme } from '../../../types';
import type {
    LoginSelfCheckResult,
    OnlineProviderId,
    ProviderAccountSummary,
    ProviderCapabilities,
    QrLoginFailureKind,
    QrLoginMethod,
    QrLoginState,
} from '../../../types/onlineMusic';
import type { LibraryHomeMessage } from './homeModel';

// src/library/core/contracts/account.ts
// 在线账户的契约（Library v2 · A1）：扫码登录会话、账户选择、切换确认与登出由 core 的账户 controller 持有，
// 任何一套 suite 只画自己的登录界面、账户列表与确认界面，经同一个 controller 驱动流程。这里只有类型：
// 快照、请求、各动作的判别式结果、controller 接口、controller 依赖的端口，以及 account surface 的 props 与动作 id。
// 账户真源仍是 useOnlineProviderAccountStore，controller 只经端口读写它，不建第二份账户状态。
// 纯规则在 core/model/accountRules（选平台、登录文案、可登出 / 可重试等派生）。

// ─── 快照 ───────────────────────────────────────────────────────────────

/**
 * 登录会话的阶段（扫码状态机与原 useOnlineProviderQrLogin 的 QrUiState 一一对应，外加登录方式的两步）：
 * - resolving-methods：正在等 provider 的登录方式发现（`resolveQrLoginMethods`），界面还不显示（与现状一致）；
 * - choosing-method：provider 声明了多种方式、还没选，不向后端要码（QQ 两步式的第一步）；
 * - loading：正在要二维码；waiting / scanned / confirmed / expired / error：后端报的状态（`QrLoginState`）。
 */
export type LibraryLoginPhase =
    | 'resolving-methods'
    | 'choosing-method'
    | 'loading'
    | QrLoginState['state'];

/**
 * 登录后端的健康（目前只有网易的本地后端会报，见 core/model/accountRules 的 resolveLoginBackendState）。
 * failed 时二维码必然拿不到：界面以故障原因与重启入口替换二维码，重试与诊断都不显示。
 */
export type LibraryLoginBackendState = {
    failed: boolean;
    /** 后端报的错误详情（可能为空）。 */
    detail: string | null;
    restarting: boolean;
    /** 故障且没有在重启中。 */
    canRestart: boolean;
};

/** 登录界面的文案（i18n key，UI 自己翻译）。status 为 null 表示此刻不显示状态行。 */
export type LibraryLoginCopy = {
    title: LibraryHomeMessage;
    note: LibraryHomeMessage;
    status: LibraryHomeMessage | null;
};

// ─── 登录失败后的自检（规则在 core/model/loginSelfCheckRules） ─────────

export type LoginSelfCheckVerdictKind =
    /** 桌面版：内嵌后端没在运行或没有回应。 */
    | 'backend-down'
    /** 网页版：配置的远端 API 连不上。 */
    | 'remote-unreachable'
    /** QQ：系统钥匙串不可用，登录态无法加密保存，扫码确认后必然失败。 */
    | 'credential-store'
    | 'dns-failed'
    /** TLS 握手阶段被重置：常见于代理、加速器、防火墙或运营商的干扰。 */
    | 'tls-reset'
    /** 某个域名所有地址都连不上（超时、拒绝、路由不可达等）。 */
    | 'upstream-unreachable'
    /** IPv4 能连上，IPv6 不行：系统可能优先走了坏掉的 IPv6（含 Teredo）。 */
    | 'ipv6-failed'
    /** 连接能建立，但 HTTPS 请求本身失败。 */
    | 'https-failed'
    | 'clock-skew'
    | 'network-ok';

export type LoginSelfCheckProxyKind = 'fake-ip' | 'system' | 'env';

export type LoginSelfCheckVerdict = {
    kind: LoginSelfCheckVerdictKind;
    /** 补充说明：出问题的域名与错误码、后端的错误原文、时钟偏差分钟数等；没有时为 null。 */
    detail: string | null;
    /** 有代理参与时附加提示；没有为 null。 */
    proxy: LoginSelfCheckProxyKind | null;
};

export type LoginSelfCheckItemId = 'backend' | 'credential-store' | 'dns' | 'ipv4' | 'ipv6' | 'https' | 'proxy' | 'clock';

export type LoginSelfCheckItem = {
    id: LoginSelfCheckItemId;
    state: 'ok' | 'fail' | 'warn' | 'skip';
    /** 失败或提示时的简短说明（错误码、域名）；正常时为 null。 */
    detail: string | null;
};

/**
 * 登录失败后的主动自检（不在手机上取消、provider 有自检能力时由会话自动跑一次）：
 * running 时界面显示「正在检查」；done 带结构化结果与结论；failed 是自检本身出错（原文进报告）。
 */
export type LibraryLoginSelfCheck =
    | { status: 'running' }
    | { status: 'done'; result: LoginSelfCheckResult; verdict: LoginSelfCheckVerdict }
    | { status: 'failed'; message: string };

/** 同一时间最多一个登录会话；换 suite 不中断（宿主持有 controller）。 */
export type LibraryLoginSessionSnapshot = {
    /** 会话代次：每次要码（含重试、换登录方式）都会换新，晚到的结果按它作废。 */
    id: number;
    providerId: OnlineProviderId;
    phase: LibraryLoginPhase;
    /** provider 声明的扫码登录方式；空数组 = 单步流程。 */
    methods: readonly QrLoginMethod[];
    /** 多方式时已选的那个；重试保留它（否则用户会被踢回第一步）。 */
    selectedMethodId: string | null;
    /** 二维码图片地址；还没拿到时为空串。 */
    qrImageUrl: string;
    /** 失败形态（决定要不要给诊断入口）；没扫就过期不算失败，为 null。 */
    failure: QrLoginFailureKind | null;
    /**
     * 后端要求的冷却（秒，向上取整，按失败那一刻算）：冷却结束前重新要码只会被拒（429），重试暂不可用。
     * 冷却结束时自动回到 null。
     */
    retryCooldownSeconds: number | null;
    /** 失败后的自检；没有失败、在手机上取消或 provider 没有自检能力时为 null。 */
    selfCheck: LibraryLoginSelfCheck | null;
    backend: LibraryLoginBackendState;
    copy: LibraryLoginCopy;
};

/**
 * 待用户确认的平台切换。每次切换都要确认（现状）；同一时间最多一个，新的请求会把旧的按 declined（superseded）结算。
 * - switch：用户选了一个能直接切过去的平台；
 * - activate-after-login：在非当前平台扫码登录成功后，问要不要切过去（拒绝时登录本身仍是成功的）。
 */
export type LibraryProviderSwitchReason = 'switch' | 'activate-after-login';

export type LibraryProviderSwitchRequest = {
    /** 请求 id：确认 / 取消按它结算，过期的 id 返回 stale。 */
    id: number;
    from: OnlineProviderId;
    to: OnlineProviderId;
    reason: LibraryProviderSwitchReason;
};

/** 登出进度：同一时间最多一个登出在途。idle 时 providerId 为 null。 */
export type LibraryAccountLogoutState = {
    providerId: OnlineProviderId | null;
    status: 'idle' | 'pending';
};

/** 扫码确认之后的结局（与原 useOnlineProviderPlatform 的 ProviderLoginOutcome 同一套）。 */
export type LibraryLoginOutcome = 'completed' | 'refresh-failed' | 'activation-declined';

/**
 * 最近一次扫码确认的结局。确认后登录会话就关闭了（refresh-failed 除外：会话回到 error 让用户看到失败），
 * 界面想提示「已登录但没切过去」时读它。
 */
export type LibraryLoginCompletion = {
    sessionId: number;
    providerId: OnlineProviderId;
    outcome: LibraryLoginOutcome;
};

export type LibraryAccountSnapshot = {
    /** provider 注册表 × 账户 store（omni.getProviderSummaries），mod 源增删时会变。 */
    providers: ProviderAccountSummary[];
    /** 已回落过的当前平台：存的平台不在列表里时是 netease（core/model/accountRules 的 resolveActiveProviderId）。 */
    activeProviderId: OnlineProviderId;
    login: LibraryLoginSessionSnapshot | null;
    pendingSwitch: LibraryProviderSwitchRequest | null;
    logout: LibraryAccountLogoutState;
    lastLoginCompletion: LibraryLoginCompletion | null;
};

// ─── 动作结果（判别式，文案由 UI 自己翻译） ─────────────────────────────

/**
 * 某个平台此刻不能选的原因：
 * - not-configured：provider 声明未配置（`availability.configured === false`），界面上那一项本就是禁用的；
 * - unknown-provider：不在当前 provider 列表里（例如 mod 源刚被关掉）。
 */
export type LibraryProviderUnavailableReason = 'not-configured' | 'unknown-provider';

/** requestSwitch 的结局；Promise 在用户答复（或被取代、controller 销毁）之后才 resolve。 */
export type LibrarySwitchResult =
    /** changed=false：本来就是当前平台，没有弹确认。 */
    | { status: 'switched'; providerId: OnlineProviderId; changed: boolean }
    | { status: 'declined'; providerId: OnlineProviderId; reason: 'cancelled' | 'superseded' | 'disposed' }
    | { status: 'unavailable'; providerId: OnlineProviderId; reason: LibraryProviderUnavailableReason };

export type LibrarySwitchConfirmResult =
    | { status: 'confirmed'; requestId: number; providerId: OnlineProviderId }
    | { status: 'stale'; requestId: number };

export type LibrarySwitchCancelResult =
    | { status: 'cancelled'; requestId: number }
    | { status: 'stale'; requestId: number };

/**
 * startLogin 的结局。started 只表示会话已经建立：step=choosing-method 停在选方式，step=qr 已开始要码；
 * 之后的扫码进度（含要码失败 start-error）都在快照里。superseded：登录方式还没解析完就有更新的 startLogin。
 */
export type LibraryStartLoginResult =
    | { status: 'started'; providerId: OnlineProviderId; sessionId: number; step: 'choosing-method' | 'qr' }
    | { status: 'superseded'; providerId: OnlineProviderId }
    | { status: 'unavailable'; providerId: OnlineProviderId; reason: LibraryProviderUnavailableReason };

/** selectProvider 走了哪一支（core/model/accountRules 的 resolveProviderSelection），以及那一支的结局。 */
export type LibrarySelectProviderResult =
    | { action: 'unavailable'; providerId: OnlineProviderId; reason: LibraryProviderUnavailableReason }
    | { action: 'switch'; result: LibrarySwitchResult }
    | { action: 'login'; result: LibraryStartLoginResult };

/**
 * 在当前登录会话里重新要码（选登录方式、重试、后端重启后续上）被拒的原因：
 * - unknown-method：方式 id 不在会话的 methods 里；
 * - method-required：多方式但还没选（重试在第一步不可用）；
 * - backend-failed：后端故障，要码只会再失败一次；
 * - not-retryable：阶段不是 expired / error（与登录弹窗的 canRetry 一致）。
 */
export type LibraryLoginRejectReason = 'unknown-method' | 'method-required' | 'backend-failed' | 'cooling-down' | 'not-retryable';

export type LibraryLoginRequestResult =
    | { status: 'requested'; sessionId: number }
    | { status: 'no-session' }
    | { status: 'rejected'; reason: LibraryLoginRejectReason };

export type LibraryLoginCloseResult =
    | { status: 'closed'; sessionId: number }
    | { status: 'no-session' };

/** 重启登录后端：恢复运行后自动要码（resumed 带新的会话代次）；仍未运行则 still-down。 */
export type LibraryBackendRestartResult =
    | { status: 'resumed'; sessionId: number }
    | { status: 'still-down' }
    | { status: 'no-session' }
    | { status: 'rejected'; reason: 'not-restartable' };

/** 诊断报告（格式与现在的 formatQrLoginDiagnosticReport 相同）；从没开始过登录时 no-session。 */
export type LibraryLoginDiagnosticResult =
    | { status: 'ok'; report: string }
    | { status: 'no-session' };

/**
 * 登出被拒的原因（core/model/accountRules 的 resolveLogoutEligibility）：只有当前且已登录的平台可以登出。
 */
export type LibraryLogoutRejectReason = 'unknown-provider' | 'not-active' | 'not-authenticated';

export type LibraryLogoutResult =
    | { status: 'logged-out'; providerId: OnlineProviderId }
    | { status: 'rejected'; providerId: OnlineProviderId; reason: LibraryLogoutRejectReason }
    | { status: 'busy'; providerId: OnlineProviderId }
    | { status: 'failed'; providerId: OnlineProviderId; message: string };

// ─── Spotify 授权配置（登录弹窗经 controller 读写，不直连 provider service） ───

/** Spotify 登录弹窗要渲染的授权配置。 */
export type LibrarySpotifyAuthConfig = {
    /** 用户自填的 Client ID；没填过是空串（界面不把内置默认值抄进输入框）。 */
    clientId: string;
    /** OAuth 本地回环回调地址，用户要原样填进 Spotify Dashboard。 */
    redirectUri: string;
};

// ─── controller ─────────────────────────────────────────────────────────

/**
 * 在线账户的 controller：宿主创建（寿命与首页外壳相同，换 suite 不重建），suite 经 props 拿到它。
 * 快照对象在没有变化时保持身份（useSyncExternalStore 友好）；所有动作返回判别式结果，UI 自己翻译。
 */
export interface LibraryAccountController {
    getSnapshot(): LibraryAccountSnapshot;
    subscribe(listener: () => void): () => void;
    /** 现 Grid3D 的选平台规则：未配置 → unavailable；能直接切（已登录 / 无账户）→ requestSwitch；否则 startLogin。 */
    selectProvider(providerId: OnlineProviderId): Promise<LibrarySelectProviderResult>;
    /** 同平台直接 switched；否则生成 pendingSwitch 等 UI 确认（已有的待确认请求按 declined / superseded 结算）。 */
    requestSwitch(providerId: OnlineProviderId): Promise<LibrarySwitchResult>;
    /** 确认：切换清理端口 → 作废在途请求 → 写当前平台 → 刷新新账户（请求是 switch 时）。 */
    confirmSwitch(requestId: number): Promise<LibrarySwitchConfirmResult>;
    cancelSwitch(requestId: number): LibrarySwitchCancelResult;
    /** 解析登录方式（带竞态代次）；单方式直接要码，多方式停在 choosing-method。旧会话先 keyed 取消。 */
    startLogin(providerId: OnlineProviderId): Promise<LibraryStartLoginResult>;
    selectLoginMethod(methodId: string): Promise<LibraryLoginRequestResult>;
    /** 保留已选的登录方式重新要码。 */
    retryLogin(): Promise<LibraryLoginRequestResult>;
    /** 停轮询、keyed 取消会话、清快照。 */
    closeLogin(): LibraryLoginCloseResult;
    /** 只在 backend.canRestart 时；恢复运行后自动要码。 */
    restartLoginBackend(): Promise<LibraryBackendRestartResult>;
    buildLoginDiagnosticReport(): Promise<LibraryLoginDiagnosticResult>;
    /** Spotify 登录弹窗的授权配置；其他 provider 不调用。 */
    getSpotifyAuthConfig(): LibrarySpotifyAuthConfig;
    /** 保存用户自填的 Client ID：端口同时清掉与旧 id 绑定的令牌（之后必须重新授权）。 */
    saveSpotifyClientId(clientId: string): void;
    /** 只对当前且已登录的平台；走宿主注入的 per-provider logout。 */
    logout(providerId: OnlineProviderId): Promise<LibraryLogoutResult>;
    /** 宿主卸载：关闭登录会话（keyed 取消），待确认切换按 declined / disposed 结算。 */
    dispose(): void;
}

// ─── 端口（默认装配见 A3 的 core/services/providerAccountDeps） ──────────

/**
 * 扫码登录的 auth 端口：签名与 omni 的同名方法一致（默认装配直接转给 omni）。
 * getProviderCapabilities 只用到 auth（现 hook 只看它决定能不能扫码），omni 返回的完整能力可以直接传。
 */
export type LibraryAccountAuthPort = {
    /** 没有 auth 的 provider 回空数组。 */
    resolveQrLoginMethods(providerId: OnlineProviderId): Promise<QrLoginMethod[]>;
    createQrLogin(providerId: OnlineProviderId, methodId?: string): Promise<{ key: string; imageUrl: string }>;
    checkQrLogin(providerId: OnlineProviderId, key: string): Promise<QrLoginState>;
    /** 只释放这一把 key，幂等；调用方 fire-and-forget。 */
    cancelQrLogin(providerId: OnlineProviderId, key: string): Promise<void>;
    /** 声明了二维码寿命才由前端计时；null 表示只认后端报的过期。 */
    getQrTtlMs(providerId: OnlineProviderId): number | null;
    /** 自己不会失败（omni 把 provider 的错误写成一行）。 */
    getQrLoginDiagnostics(providerId: OnlineProviderId): Promise<string[]>;
    /** 此刻能不能主动自检（同步回答，界面据此决定要不要显示「正在检查」）。 */
    canRunQrLoginSelfCheck(providerId: OnlineProviderId): boolean;
    /** 主动自检；没有可检查的对象时 resolve null，自检本身出错时 reject。 */
    runQrLoginSelfCheck(providerId: OnlineProviderId): Promise<LoginSelfCheckResult | null>;
    getProviderCapabilities(providerId: OnlineProviderId): Pick<ProviderCapabilities, 'auth'>;
};

/**
 * 账户读写端口：provider 列表与当前平台。默认装配读 omni.getProviderSummaries 与 useOnlineProviderAccountStore，
 * subscribe 同时听账户 store 与 omni.subscribeProviders（mod 源增删）。
 */
export type LibraryAccountStorePort = {
    listProviders(): ProviderAccountSummary[];
    /** 切换确认框里的平台名（omni.getProviderLabel：shortName → displayName → id）。 */
    getProviderLabel(providerId: OnlineProviderId): string;
    /** store 里存的当前平台（未经回落）。 */
    getStoredActiveProviderId(): OnlineProviderId;
    setActiveProviderId(providerId: OnlineProviderId): void;
    /** 写新的当前平台之前作废上一个平台的在途请求（omni.invalidateActiveRequests）。 */
    invalidateActiveRequests(): void;
    subscribe(listener: () => void): () => void;
};

/**
 * 宿主注入的 per-provider 账户刷新与登出（App 的 onlineProviderRefreshers / onlineProviderLogouts）。
 * 函数形状而不是记录：宿主可以用 ref 指向每次渲染的最新实现，controller 不必重建。
 */
export type LibraryProviderAccountPort = {
    /**
     * 刷新某个平台的账户；没有刷新器时 resolve undefined。只有 resolve `false` 表示失败
     * （扫码确认了却没拿到登录态，沿用 completeOnlineProviderLoginTransaction 的判定）。
     */
    refresh(providerId: OnlineProviderId): Promise<unknown>;
    /** 各 provider 自己的登出（酷狗会清掉完整登录态）；没有登出实现时 no-op。 */
    logout(providerId: OnlineProviderId): Promise<void>;
};

/**
 * Spotify 授权配置的读写端口：真源在 services/onlineMusic/spotifyClientId（它刻意不依赖 providerStorage / omni，
 * 否则弹窗经 spotifyProvider -> omni -> providerRegistry 会拿到循环导入）。suite 只经 controller 读写，
 * 默认装配在 providerAccountDeps。
 */
export type LibrarySpotifyAuthConfigPort = {
    /** 用户自己填的 Client ID；没填过返回空串（界面不把内置默认值抄进输入框）。 */
    getCustomClientId(): string;
    /** 保存并清掉旧令牌：refresh_token 与 client id 绑定，换 id 后必须重新走一次授权。 */
    saveClientId(clientId: string): void;
    /** OAuth 本地回环回调地址（与授权 URL 里用的是同一个常量）。 */
    getRedirectUri(): string;
};

/**
 * 切换清理端口：用户确认切换后、写新的当前平台之前调用。宿主在这里清掉播放（automix 尾音、audio、队列、歌词、
 * prefetch、track profile）、搜索运行态与集合导航（现 App.tsx 的 handleConfirmProviderSwitch）。
 */
export type LibraryProviderSwitchCleanupPort = {
    resetForProviderSwitch(nextProviderId: OnlineProviderId, previousProviderId: OnlineProviderId): void | Promise<void>;
};

/** 网易本地后端的健康（useNeteaseApiStatusStore 拍平后的值；web 构建 supported=false）。 */
export type LibraryNeteaseBackendHealth = {
    /** false：没有 Electron 后端可看、可重启。 */
    supported: boolean;
    /** 后端最近一次报的状态；还没报过为 null。 */
    status: 'starting' | 'running' | 'error' | null;
    error: string | null;
    restarting: boolean;
};

export type LibraryNeteaseBackendPort = {
    getHealth(): LibraryNeteaseBackendHealth;
    subscribe(listener: () => void): () => void;
    /** 重启并等它落定（主进程串行化并发重启；失败不抛，结果看 getHealth）。 */
    restart(): Promise<void>;
};

/** 计时器句柄：由时钟端口自己解释（浏览器是数字，测试里可以是任何东西）。 */
export type LibraryTimerHandle = unknown;

/** 时钟端口：轮询间隔、二维码 TTL 与诊断时间线都经它，测试注入假时钟。 */
export type LibraryAccountClock = {
    now(): number;
    setTimeout(callback: () => void, ms: number): LibraryTimerHandle;
    clearTimeout(handle: LibraryTimerHandle): void;
};

/** 诊断报告的环境信息（现 hook 读 __APP_VERSION__ 与 navigator.userAgent）。 */
export type LibraryLoginDiagnosticsEnvironment = {
    appVersion: string | null;
    userAgent: string;
};

/** 会话事件的日志出口（现 hook 打到 console，前缀 [ProviderQrLogin]，同时进诊断时间线）。 */
export type LibraryAccountLogger = (
    level: 'info' | 'warn',
    event: string,
    detail: Record<string, unknown>,
) => void;

/** 账户 controller 的全部依赖。 */
export type LibraryAccountControllerDeps = {
    auth: LibraryAccountAuthPort;
    accounts: LibraryAccountStorePort;
    providerAccounts: LibraryProviderAccountPort;
    spotifyAuth: LibrarySpotifyAuthConfigPort;
    switchCleanup: LibraryProviderSwitchCleanupPort;
    neteaseBackend: LibraryNeteaseBackendPort;
    clock: LibraryAccountClock;
    diagnostics: LibraryLoginDiagnosticsEnvironment;
    log?: LibraryAccountLogger;
};

// ─── account surface ────────────────────────────────────────────────────

/**
 * account surface 的语义动作（A5 起 suite 在 entry 的 `surfaces.account` 里声明，LibrarySurfaceId 含 'account'）。
 * 登录与确认会阻塞流程，account surface 整体回退：当前 suite 没有它就用 grid 的；声明了 surface 但没声明的
 * 可选动作那一项不显示。基础动作缺一个就是清单错误：建 suite 索引时抛错（core/model/librarySuites 的
 * LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS），不会悄悄回退——半套登录界面会让用户卡在某一步（例如 QQ 选方式）。
 *
 * | LibraryAccountActionId | 分级 | 说明 |
 * | --- | --- | --- |
 * | account-login | 基础 | 显示二维码与状态、重试、关闭 |
 * | account-login-method | 基础（有多方式的 provider 才用到） | QQ 两步式 |
 * | account-switch-confirm | 基础 | 确认 / 取消待确认切换 |
 * | account-select / account-logout | 推荐 | 首页上的账户列表（选平台、登出入口） |
 * | account-login-diagnostics | 可选 | 失败后的诊断报告 |
 * | account-backend-restart | 可选 | 网易本地后端故障时重启 |
 */
export type LibraryAccountActionId =
    | 'account-login'
    | 'account-login-method'
    | 'account-switch-confirm'
    | 'account-select'
    | 'account-logout'
    | 'account-login-diagnostics'
    | 'account-backend-restart';

/** 渲染 account surface 的那套 suite 声明的动作（与 suite.ts 的 LibraryDeclaredActions 同形，动作是账户的）。 */
export type LibraryAccountDeclaredActions = {
    readonly actions: readonly LibraryAccountActionId[];
    readonly extraActions: readonly string[];
};

/**
 * 首页 surface 交上来的账户层（宿主持有，见 library/app/libraryAccountLayer）：首页 surface 经
 * LibraryHomeSurfaceProps.accountLayerRef 把自己层叠上下文里的一个元素接上来，account surface 订阅它，
 * 自己决定什么界面 portal 进去（网格：登录弹窗进层，确认框进 body）。没接元素时 getElement 为 null。
 */
export type LibraryAccountLayerSource = {
    getElement(): HTMLElement | null;
    subscribe(listener: () => void): () => void;
};

/** account surface 的输入：只在 login 或 pendingSwitch 非空时渲染内容。 */
export type LibraryAccountSurfaceProps = {
    account: LibraryAccountController;
    theme: Theme;
    isDaylight: boolean;
    /** 只有用户正看着的那一层可交互（键盘）。 */
    isInteractive: boolean;
    declaredActions: LibraryAccountDeclaredActions;
    /** 首页 surface 交上来的账户层；portal 位置由 suite 自己决定。 */
    layer: LibraryAccountLayerSource;
};
