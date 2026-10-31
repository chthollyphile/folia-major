import type { Theme } from '../../../types';
import type { LoginFailure } from '../../../types/loginFailure';
import type {
    LoginDiagnosticLine,
    LoginLocalService,
    LoginMethod,
    LoginSelfCheckResult,
    LoginState,
    LoginTexts,
    OnlineProviderId,
    ProviderAccountSummary,
    ProviderCapabilities,
} from '../../../types/onlineMusic';

// src/library/core/account/account.contract.ts
// 在线账户的契约（Library v2 · A1）：登录会话（扫码或在浏览器里确认）、账户选择、切换确认与登出由 core 的账户
// controller 持有。登录窗口（src/components/login，宿主挂一个，所有 suite 共用）画登录会话；suite 画自己的平台列表
// 与切换确认，经同一个 controller 驱动流程。这里只有类型：快照、各动作的判别式结果、controller 接口、controller
// 依赖的端口，以及 account surface 的 props 与动作 id。
// 账户真源仍是 useOnlineProviderAccountStore，controller 只经端口读写它，不建第二份账户状态。
// 纯规则在 core/account/accountRules（选平台、可登出、可重来、等待再试到什么时刻等派生）。

// ─── 快照 ───────────────────────────────────────────────────────────────

/**
 * 登录会话的阶段：
 * - resolving-methods：正在等 provider 说它有哪几种登录方式（`resolveLoginMethods`）；
 * - choosing-method：provider 声明了多种方式、还没选，不向平台要码（QQ 两步式的第一步）；
 * - ready：在浏览器里确认的登录，等用的人按「打开浏览器」（沿着平台那一列走不会开出浏览器）；
 * - loading：正在要二维码或开始浏览器登录；waiting / scanned / confirmed / expired / error：平台报的状态（`LoginState`）。
 */
export type LibraryLoginPhase =
    | 'resolving-methods'
    | 'choosing-method'
    | 'ready'
    | 'loading'
    | LoginState['state'];

/**
 * 登录要靠的本地服务（桌面端内嵌的后端，provider 经 `auth.localService` 声明）此刻的样子。
 * 没有这样的服务时 available 为 false，其余都是空值。
 */
export type LibraryLoginLocalServiceState = {
    available: boolean;
    /** 服务没能起来。 */
    failed: boolean;
    /** 服务自己的错误原话（可能为空）。 */
    error: string | null;
    restarting: boolean;
};

// ─── 登录失败后的自检（规则在 core/account/loginSelfCheckRules） ─────────

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
 * 登录失败后的主动自检（provider 有自检能力时由会话自动跑一次）：
 * running 时界面显示「正在检查」；done 带结构化结果与结论；failed 是自检本身出错（原文进报告）。
 */
export type LibraryLoginSelfCheck =
    | { status: 'running' }
    | { status: 'done'; result: LoginSelfCheckResult; verdict: LoginSelfCheckVerdict }
    | { status: 'failed'; message: string };

/** 同一时间最多一个登录会话；换 suite 不中断（宿主持有 controller）。 */
export type LibraryLoginSessionSnapshot = {
    /** 会话代次：每次开始（含重来、换登录方式）都会换新，晚到的结果按它作废。 */
    id: number;
    providerId: OnlineProviderId;
    phase: LibraryLoginPhase;
    /** provider 声明的登录方式；空数组 = 单步流程。 */
    methods: readonly LoginMethod[];
    /** 多方式时已选的那个；重来保留它（否则用户会被踢回第一步）。 */
    selectedMethodId: string | null;
    /** 在浏览器里确认的登录（没有二维码，provider 在系统浏览器里打开登录的页面）。 */
    inBrowser: boolean;
    /** 二维码图片地址；还没拿到、或者是在浏览器里确认的登录时为空串。 */
    codeImage: string;
    /** 这一次登录的页面能不能由窗口再打开一次（provider 自己打开、关掉即结束的不能）。 */
    canReopenLoginPage: boolean;
    /**
     * 这一次为什么没有成功：是哪一种情况、它的事实、发生的时刻（services/onlineMusic/login/loginFailureCase）。
     * 没有出事、重新开始之后、确认之后是 null。「浏览器没有打开」时登录还在等（phase 仍是 waiting），只有它有值。
     */
    failure: LoginFailure | null;
    /** 失败后的自检；没有失败、没扫码就过期或 provider 没有自检能力时为 null。 */
    selfCheck: LibraryLoginSelfCheck | null;
    localService: LibraryLoginLocalServiceState;
    /** 这个平台自己的登录标题和说明（i18n key）；没有声明时为 null。 */
    texts: LoginTexts | null;
};

/**
 * 待用户确认的平台切换。播放器里有歌时才问（切过去会清空它）；同一时间最多一个，新的请求会把旧的按
 * declined（superseded）结算。
 * - switch：用户选了一个能直接切过去的平台；
 * - activate-after-login：在非当前平台登录成功后，切过去之前问一句（拒绝时登录本身仍是成功的）。
 */
export type LibraryProviderSwitchReason = 'switch' | 'activate-after-login';

export type LibraryProviderSwitchRequest = {
    /** 请求 id：确认 / 取消按它结算，过期的 id 返回 stale。 */
    id: number;
    from: OnlineProviderId;
    to: OnlineProviderId;
    reason: LibraryProviderSwitchReason;
};

/** 登出进度：同一时间最多一个登出在途（含问用的人的那一会儿）。idle 时 providerId 为 null。 */
export type LibraryAccountLogoutState = {
    providerId: OnlineProviderId | null;
    status: 'idle' | 'pending';
};

/** 登录确认之后的结局。 */
export type LibraryLoginOutcome = 'completed' | 'refresh-failed' | 'activation-declined';

/**
 * 最近一次登录确认的结局。确认后登录会话就关闭了（refresh-failed 除外：会话回到 error 让用户看到失败），
 * 登录窗口据它放登录成功的动画（sessionId 是那一次会话的代次）。
 */
export type LibraryLoginCompletion = {
    sessionId: number;
    providerId: OnlineProviderId;
    outcome: LibraryLoginOutcome;
};

export type LibraryAccountSnapshot = {
    /** provider 注册表 × 账户 store（omni.getProviderSummaries），mod 源增删时会变。 */
    providers: ProviderAccountSummary[];
    /** 已回落过的当前平台：存的平台不在列表里时是默认平台（core/account/accountRules 的 resolveActiveProviderId）。 */
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

/** requestSwitch 的结局；要问用的人时，Promise 在用户答复（或被取代、controller 销毁）之后才 resolve。 */
export type LibrarySwitchResult =
    /** changed=false：本来就是当前平台，什么都没做。 */
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
 * startLogin 的结局。started 只表示会话已经建立：step=choosing-method 停在选方式，step=ready 等用的人打开浏览器，
 * step=started 已开始要码或开始浏览器登录；之后的进度（含开始失败）都在快照里。superseded：登录方式还没解析完
 * 就有更新的 startLogin（或关掉了）。
 */
export type LibraryStartLoginResult =
    | { status: 'started'; providerId: OnlineProviderId; sessionId: number; step: 'choosing-method' | 'ready' | 'started' }
    | { status: 'superseded'; providerId: OnlineProviderId }
    | { status: 'unavailable'; providerId: OnlineProviderId; reason: LibraryProviderUnavailableReason };

/**
 * selectProvider 走了哪一支（core/account/accountRules 的 resolveProviderSelection）。login 不开始登录：
 * 登录只由登录窗口开始，调用的人打开它（loginWindowStore 的 openLoginWindow）。
 */
export type LibrarySelectProviderResult =
    | { action: 'unavailable'; providerId: OnlineProviderId; reason: LibraryProviderUnavailableReason }
    | { action: 'switch'; result: LibrarySwitchResult }
    | { action: 'login'; providerId: OnlineProviderId };

/**
 * 在当前登录里开始或重来（选登录方式、重来、打开浏览器、本地服务重启后续上）被拒的原因：
 * - unknown-method：方式 id 不在会话的 methods 里；
 * - method-required：多方式但还没选；
 * - cooling-down：平台要求等一会儿再来（失败的 retryAfterMs），还没到那个时刻；
 * - not-retryable：此刻不能重来（还在解析方式、正在登录途中）。
 */
export type LibraryLoginRejectReason = 'unknown-method' | 'method-required' | 'cooling-down' | 'not-retryable';

export type LibraryLoginRequestResult =
    | { status: 'requested'; sessionId: number }
    | { status: 'no-session' }
    | { status: 'rejected'; reason: LibraryLoginRejectReason };

export type LibraryLoginCloseResult =
    | { status: 'closed'; sessionId: number }
    | { status: 'no-session' };

/** 再打开一次登录的页面（在浏览器里确认的登录）。 */
export type LibraryLoginPageResult =
    | { status: 'opened' }
    | { status: 'failed' }
    | { status: 'no-session' }
    | { status: 'rejected'; reason: 'not-reopenable' };

/**
 * 重启登录要靠的本地服务：起来了就把登录重新开始（resumed 带会话代次；这会儿登录自己走下去了就不再开始一次，
 * 代次不变）；没起来是 still-down。
 */
export type LibraryLocalServiceRestartResult =
    | { status: 'resumed'; sessionId: number }
    | { status: 'still-down' }
    | { status: 'no-session' }
    | { status: 'rejected'; reason: 'not-restartable' };

/** 诊断报告（services/onlineMusic/login/loginDiagnosticReport 的格式）；从没开始过登录时 no-session。 */
export type LibraryLoginDiagnosticResult =
    | { status: 'ok'; report: string }
    | { status: 'no-session' };

/** 登出被拒的原因（core/account/accountRules 的 resolveLogoutEligibility）：只有已登录的平台可以登出。 */
export type LibraryLogoutRejectReason = 'unknown-provider' | 'not-authenticated';

export type LibraryLogoutResult =
    | { status: 'logged-out'; providerId: OnlineProviderId }
    /** 用的人在确认框里取消了。 */
    | { status: 'cancelled'; providerId: OnlineProviderId }
    | { status: 'rejected'; providerId: OnlineProviderId; reason: LibraryLogoutRejectReason }
    | { status: 'busy'; providerId: OnlineProviderId }
    | { status: 'failed'; providerId: OnlineProviderId; message: string };

// ─── controller ─────────────────────────────────────────────────────────

/**
 * 在线账户的 controller：App 创建（换 suite 不重建），suite、登录窗口与 AccountTab 经 props 拿到它。
 * 快照对象在没有变化时保持身份（useSyncExternalStore 友好）；所有动作返回判别式结果，UI 自己翻译。
 */
export interface LibraryAccountController {
    getSnapshot(): LibraryAccountSnapshot;
    subscribe(listener: () => void): () => void;
    /** 选平台：未配置 → unavailable；能直接切（已登录 / 无账户）→ requestSwitch；否则 login（调用的人打开登录窗口）。 */
    selectProvider(providerId: OnlineProviderId): Promise<LibrarySelectProviderResult>;
    /** 同平台直接 switched；播放器里有歌时生成 pendingSwitch 等 UI 确认，没有歌就直接切。 */
    requestSwitch(providerId: OnlineProviderId): Promise<LibrarySwitchResult>;
    /** 确认：清空播放器 → 作废在途请求 → 写当前平台 → 读新账户（请求是 switch 时）。 */
    confirmSwitch(requestId: number): Promise<LibrarySwitchConfirmResult>;
    cancelSwitch(requestId: number): LibrarySwitchCancelResult;
    /**
     * 只由登录窗口调用。先停旧会话；解析登录方式（带竞态代次）：多方式停在 choosing-method，在浏览器里确认的停在
     * ready，其余直接要码。
     */
    startLogin(providerId: OnlineProviderId): Promise<LibraryStartLoginResult>;
    /** 用这种方式（重新）开始；任何阶段都可以换。 */
    selectLoginMethod(methodId: string): Promise<LibraryLoginRequestResult>;
    /** 保留已选的登录方式开始或重来：ready（打开浏览器）、expired、error 时可用，等待再试的时刻之前被拒。 */
    retryLogin(): Promise<LibraryLoginRequestResult>;
    /** 在浏览器里确认的登录：让 provider 在系统浏览器里把登录的页面再打开一次。 */
    openLoginPage(): Promise<LibraryLoginPageResult>;
    /** 停轮询、keyed 取消会话、清快照。 */
    closeLogin(): LibraryLoginCloseResult;
    /** 重启登录要靠的本地服务；起来了接着登录。 */
    restartLocalService(): Promise<LibraryLocalServiceRestartResult>;
    buildLoginDiagnosticReport(): Promise<LibraryLoginDiagnosticResult>;
    /**
     * 表单式登录完成（FormLogin 提交成功后由登录窗口调用）：读账号，走和扫码确认一样的收尾链路——
     * 读到了收起登录，不是当前平台时先问（activate-after-login），再报完成（登录窗口据它放动画/关窗）。
     * 表单登录没有会话，sessionId 为 0。
     */
    completeFormLogin(providerId: OnlineProviderId): Promise<LibraryLoginCompletion>;
    /** 只对已登录的平台；先经宿主问用的人，退的是当前平台时清空播放器，再走宿主注入的登出。 */
    logout(providerId: OnlineProviderId): Promise<LibraryLogoutResult>;
    /** 宿主卸载：关闭登录会话（keyed 取消），待确认切换按 declined / disposed 结算。 */
    dispose(): void;
}

// ─── 端口（默认装配见 core/account/providerAccountDeps.service） ──────────────

/**
 * 登录的 auth 端口：除 dropRequestLimits 外签名与 omni 的同名方法一致（默认装配转给 omni）。
 * getProviderCapabilities 只用到 auth，omni 返回的完整能力可以直接传。
 */
export type LibraryAccountAuthPort = {
    /** 没有 auth 的 provider 回空数组。 */
    resolveLoginMethods(providerId: OnlineProviderId): Promise<LoginMethod[]>;
    /** 扫码的回二维码图片；在浏览器里确认的回空串。 */
    startLogin(providerId: OnlineProviderId, methodId?: string): Promise<{ key: string; imageUrl: string }>;
    checkLogin(providerId: OnlineProviderId, key: string): Promise<LoginState>;
    /** 只释放这一把 key，幂等；调用方 fire-and-forget。 */
    cancelLogin(providerId: OnlineProviderId, key: string): Promise<void>;
    confirmsLoginInBrowser(providerId: OnlineProviderId): boolean;
    opensLoginPageItself(providerId: OnlineProviderId, key: string): boolean;
    openLoginPage(providerId: OnlineProviderId, key: string): Promise<void>;
    /** 声明了这一次登录的有效期才由前端计时；null 表示只认平台报的过期。 */
    getLoginTtlMs(providerId: OnlineProviderId): number | null;
    getLoginTexts(providerId: OnlineProviderId): LoginTexts | null;
    getLoginLocalService(providerId: OnlineProviderId): LoginLocalService | null;
    /** 自己不会失败（omni 把 provider 的错误写成一行）。 */
    getLoginDiagnostics(providerId: OnlineProviderId): Promise<LoginDiagnosticLine[]>;
    /** 此刻能不能主动自检（同步回答，界面据此决定要不要显示「正在检查」）。 */
    canRunLoginSelfCheck(providerId: OnlineProviderId): boolean;
    /** 主动自检；没有可检查的对象时 resolve null，自检本身出错时 reject。 */
    runLoginSelfCheck(providerId: OnlineProviderId): Promise<LoginSelfCheckResult | null>;
    getProviderCapabilities(providerId: OnlineProviderId): Pick<ProviderCapabilities, 'auth'>;
    /** 此刻还在计时的登录请求不再计时（services/onlineMusic/login/loginRequestLimit）；停下一次登录时调。 */
    dropRequestLimits(): void;
};

/**
 * 账户读写端口：provider 列表与当前平台。默认装配读 omni.getProviderSummaries 与 useOnlineProviderAccountStore，
 * subscribe 同时听账户 store 与 omni.subscribeProviders（mod 源增删）。
 */
export type LibraryAccountStorePort = {
    listProviders(): ProviderAccountSummary[];
    /** 平台名（omni.getProviderLabel：shortName → displayName → id）。 */
    getProviderLabel(providerId: OnlineProviderId): string;
    /** store 里存的当前平台（未经回落）。 */
    getStoredActiveProviderId(): OnlineProviderId;
    setActiveProviderId(providerId: OnlineProviderId): void;
    /** 写新的当前平台之前作废上一个平台的在途请求（omni.invalidateActiveRequests）。 */
    invalidateActiveRequests(): void;
    subscribe(listener: () => void): () => void;
};

/** 读账号的时机：登录确认之后、切到这个平台之后。 */
export type LibraryAccountRefreshReason = 'sign-in' | 'switch';

/**
 * 账户的读、退出与退出前的那一问。默认装配：读账号走 omni.readAccount（services/onlineMusic/account/accountRead），
 * 退出与那一问由宿主给（App 的 useProviderSignOut：确认框、退出之后的提示）。
 * 函数形状而不是记录：宿主可以用 ref 指向每次渲染的最新实现，controller 不必重建。
 */
export type LibraryProviderAccountPort = {
    /** 读这个平台的账号；sign-in 时回 false 表示确认了却没有人登录着（失败）。从不 reject。 */
    refresh(providerId: OnlineProviderId, reason: LibraryAccountRefreshReason): Promise<boolean>;
    /** 退出这个平台的登录：账号离开、平台被告知、存着的账号去掉。 */
    logout(providerId: OnlineProviderId): Promise<void>;
    /** 退出之前问用的人；emptiesPlayer：退的是当前平台、播放器里有歌（会被清空）。回 false 就不退。 */
    confirmLogout(request: { providerId: OnlineProviderId; emptiesPlayer: boolean }): Promise<boolean>;
};

/**
 * 平台换了时的播放器端口：切到别的平台、退出当前平台都清空播放器（automix 尾音、audio、队列、歌词、prefetch、
 * track profile、存着的会话）与搜索、集合导航（app/createLibraryAccountPort）。
 */
export type LibraryProviderSwitchCleanupPort = {
    /** 播放器里有没有歌（正在放的或队列里的）：没有就不必问用的人。 */
    holdsSongs(): boolean;
    /** 清空播放器；搜索之后跟着 nextProviderId。退出当前平台时两个 id 相同。 */
    resetForProviderSwitch(nextProviderId: OnlineProviderId, previousProviderId: OnlineProviderId): void | Promise<void>;
};

/** 计时器句柄：由时钟端口自己解释（浏览器是数字，测试里可以是任何东西）。 */
export type LibraryTimerHandle = unknown;

/** 时钟端口：轮询间隔、有效期、已扫码的时限与诊断时间线都经它，测试注入假时钟。 */
export type LibraryAccountClock = {
    now(): number;
    setTimeout(callback: () => void, ms: number): LibraryTimerHandle;
    clearTimeout(handle: LibraryTimerHandle): void;
};

/** 诊断报告的环境信息（__APP_VERSION__、navigator.userAgent、构建来源、网页版的站点）。 */
export type LibraryLoginDiagnosticsEnvironment = {
    appVersion: string | null;
    userAgent: string;
    /** 报告里的 build 行（官方 / 非官方构建与来源仓库）；不传时报告不带这一行。 */
    build?: string | null;
    /** 网页版所在站点的 origin（区分是谁部署的）；桌面版为 null。 */
    origin?: string | null;
};

/** 会话事件的日志出口（默认打到 console，前缀 [ProviderLogin]，同时进诊断时间线）。 */
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
    switchCleanup: LibraryProviderSwitchCleanupPort;
    clock: LibraryAccountClock;
    diagnostics: LibraryLoginDiagnosticsEnvironment;
    log?: LibraryAccountLogger;
};

// ─── account surface ────────────────────────────────────────────────────

/**
 * account surface 的语义动作（suite 在 entry 的 `surfaces.account` 里声明，LibrarySurfaceId 含 'account'）。
 * 登录本身画在登录窗口里（src/components/login，首页外壳挂一个，所有 suite 共用）：suite 只从自己的界面打开它
 * （loginWindowStore 的 openLoginWindow），account surface 画的是待确认切换。确认会阻塞流程，account surface
 * 整体回退：当前 suite 没有它就用 grid 的；基础动作缺一个就是清单错误：建 suite 索引时抛错（core/suite/librarySuites
 * 的 LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS），不会悄悄回退。
 *
 * | LibraryAccountActionId | 分级 | 说明 |
 * | --- | --- | --- |
 * | account-login | 基础 | 打开登录窗口（二维码或浏览器、状态、重来、关闭都在窗口里） |
 * | account-login-method | 基础（有多方式的 provider 才用到） | QQ 两步式，在窗口里选 |
 * | account-switch-confirm | 基础 | 确认 / 取消待确认切换 |
 * | account-select / account-logout | 推荐 | 首页上的账户列表（选平台、登出入口） |
 * | account-login-diagnostics | 可选 | 失败后的详情与诊断报告（窗口里） |
 * | account-backend-restart | 可选 | 本地服务没起来时重启（窗口里） |
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

/** account surface 的输入：只在 pendingSwitch 非空时渲染内容。 */
export type LibraryAccountSurfaceProps = {
    account: LibraryAccountController;
    theme: Theme;
    isDaylight: boolean;
    /** 只有用户正看着的那一层可交互（键盘）。 */
    isInteractive: boolean;
    declaredActions: LibraryAccountDeclaredActions;
};
