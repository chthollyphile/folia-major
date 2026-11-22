// dev/probes/accountBehavior/probeApi.ts
// 账户行为探针挂在 window 上的驱动接口。只有类型：component 用例 import 它不会把探针运行时带进 Node。
//
// 这里只放「环境」：假 auth provider 的编排、账户与当前平台的种子、网易本地后端、调用账。登录窗口、切换器、
// TUI 的平台列表这些界面由用例按 suite 的 DOM 去点，探针不替界面做动作，否则钉不住真实交互。
// 用例按 suite 参数化的是「从哪里进」：grid 驱动点右下角的切换器打开登录窗口，tui 驱动按 TUI 平台列表的键；
// 登录窗口本身两个 suite 共用（见 test/component/accountBehavior.spec.ts）。

/** 失败后自检的剧本：返回的结果推出哪种结论（tls-reset / network-ok），或自检本身出错（error）。 */
export type AccountSelfCheckScript = 'tls-reset' | 'network-ok' | 'error';

/** 二维码轮询时 checkQr 依次返回的状态；队列空了一律返回 waiting。 */
/** canceled：用户在手机上取消，平台报错并要求等 ACCOUNT_CANCEL_COOLDOWN_MS 之后才能再要码（failure.retryAfterMs）。 */
export type AccountQrState = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error' | 'canceled';

export type AccountCallOp =
    /** provider 的 resolveQrLoginMethods（只有声明了多种登录方式的 provider 会被问到）。 */
    | 'resolve-methods'
    /** omni.createQrLogin → provider.getQrKey：要了一个新二维码会话。 */
    | 'create'
    | 'check'
    /** keyed 取消：provider.cancelQr(key)。 */
    | 'cancel'
    /** provider.auth.logout（omni.logout 落到这里）。 */
    | 'auth-logout'
    /** 宿主注入给平台的 per-provider 登出（App 的 onlineProviderLogouts）。 */
    | 'host-logout'
    /** 读账号时问平台谁登录着（omni.readAccount → provider.auth.getLoginStatus）：登录确认之后、切到这个平台之后各一次。 */
    | 'refresh'
    /** 切换时离开旧平台（账户 controller 的平台端口 leaveProvider，即应用的 createLibraryAccountSwitchCleanupPort）。 */
    | 'switch-cleanup'
    /** 退出登录时移出那个平台的歌（同一个端口的 dropSongsOf）。 */
    | 'drop-songs'
    /** 网易本地后端的重启动作（登录窗口经 auth.localService.restart，假的在 fakeAuthProviders.ts）。 */
    | 'backend-restart'
    /** 登录失败后的主动自检（provider.runQrLoginSelfCheck）。 */
    | 'self-check';

export type AccountCall = {
    seq: number;
    op: AccountCallOp;
    providerId: string;
    key?: string;
    methodId?: string | null;
    /** refresh 的结果（false 表示没问到，账号没读到）。 */
    ok?: boolean;
};

export type AccountProbeApi = {
    ready: () => boolean;

    // ---- 读 ----
    providers: () => string[];
    activeProvider: () => string;
    /** 账户 store 里的状态（没有条目时 unknown）。 */
    accountStatus: (providerId: string) => string;
    /** 账户 controller 快照里待确认切换（pendingSwitch）的目标；没有时为 null。 */
    pendingSwitch: () => string | null;
    /** omni 的活跃请求代次：切换事务提交前会作废一次。 */
    requestGeneration: () => number;
    calls: () => AccountCall[];
    clearLog: () => void;

    // ---- 编排假 provider ----
    /** 追加这个 provider 后续轮询要返回的状态。 */
    scriptQr: (providerId: string, states: AccountQrState[]) => void;
    /** 二维码寿命（毫秒）；null 表示不声明，只认后端报的过期。在要码之前设置。 */
    setQrTtl: (providerId: string, ttlMs: number | null) => void;
    /** 接下来 times 次读账号时问不到平台（扫码确认了却没读到账号）。 */
    failRefresh: (providerId: string, times: number) => void;
    /** 接下来 times 次要码抛错。 */
    failCreate: (providerId: string, times: number) => void;
    /** 让这个 provider 有自检能力并按剧本返回；null 撤掉自检能力（默认没有）。 */
    setSelfCheck: (providerId: string, script: AccountSelfCheckScript | null) => void;

    // ---- 种子（不经确认，等同启动恢复） ----
    setAccount: (providerId: string, status: 'authenticated' | 'anonymous') => void;
    setActive: (providerId: string) => void;

    // ---- 网易本地后端 ----
    /** supported=false 等同 Web 版（没有后端可看）。status 为 error 时假网易的要码会抛错，和真实一致。 */
    setNeteaseBackend: (backend: { supported: boolean; status: 'starting' | 'running' | 'error'; error?: string | null }) => void;
    /** 下一次重启的结果与耗时。 */
    setBackendRestart: (outcome: 'running' | 'error', delayMs?: number) => void;

    // ---- suite 与 controller 直驱（A5） ----
    /** 当前选中的 suite（useLibrarySuiteStore）。 */
    suite: () => string;
    /** 换 suite（与 DEV 浮层同一个 store；首页上没有打开的集合，不需要转场重置）。 */
    setSuite: (suiteId: string) => void;
    /**
     * 直接调账户 controller 的 startLogin，返回结果的 status。登录窗口不会因此打开（窗口只由 openLoginWindow 打开，
     * 选中一行时自己调 startLogin）；现在的用例都从界面进，不再用它，留给手动排查。
     */
    startLogin: (providerId: string) => Promise<string>;
    /** 直接调 controller 的 requestSwitch；不等用户答复，结局经 switchResult 读。 */
    requestSwitch: (providerId: string) => void;
    /** 最近一次 requestSwitch 的结局（status，declined 时带 reason，例如 `declined:cancelled`）；还没答复为 null。 */
    switchResult: () => string | null;

    // ---- 账户面板 ----
    /** 按 UnifiedPanel 的方式挂上 / 撤下 AccountTab（交给它同一个账户 controller，和 App 一样）。 */
    showAccountTab: (visible: boolean) => void;
};

declare global {
    interface Window {
        __accountProbe?: AccountProbeApi;
    }
}
