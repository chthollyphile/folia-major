import type { OnlineProviderId, ProviderAccountSummary, QrLoginMethod } from '../../../types/onlineMusic';
import type {
    LibraryAccountController,
    LibraryAccountControllerDeps,
    LibraryAccountLogger,
    LibraryAccountLogoutState,
    LibraryAccountSnapshot,
    LibraryBackendRestartResult,
    LibraryLoginCloseResult,
    LibraryLoginCompletion,
    LibraryLoginDiagnosticResult,
    LibraryLoginPhase,
    LibraryLoginRequestResult,
    LibraryLoginSessionSnapshot,
    LibraryLogoutResult,
    LibraryProviderSwitchReason,
    LibraryProviderSwitchRequest,
    LibrarySelectProviderResult,
    LibrarySpotifyAuthConfig,
    LibraryStartLoginResult,
    LibrarySwitchCancelResult,
    LibrarySwitchConfirmResult,
    LibrarySwitchResult,
} from '../contracts/account';
import {
    canRetryLogin,
    isLoginRetryCoolingDown,
    describeLoginError,
    isAwaitingLoginMethod,
    resolveActiveProviderId,
    resolveLoginBackendState,
    resolveLoginSessionCopy,
    resolveLogoutEligibility,
    resolveProviderSelection,
    shouldResumeLoginAfterBackendRestart,
} from '../model/accountRules';
import {
    createProviderLoginSession,
    type ProviderLoginConfirmedEvent,
    type ProviderLoginSessionSnapshot,
} from './providerLoginSession';

// src/library/core/services/providerAccountController.ts
// 在线账户 controller（Library v2 · A3）：组合 A2 的扫码登录会话，持有切换确认、单一在途登录与登出，
// 实现 contracts/account 的 LibraryAccountController。无 React、不直接碰 omni / store：全部经注入的端口
// （默认装配在 providerAccountDeps，宿主传入刷新、登出与切换清理）。
// - 切换：每次都生成待确认请求（自增 id），确认后依次 切换清理 → 作废在途请求 → 写当前平台 → 刷新新账户；
//   新请求把旧的按 declined/superseded 结算，过期 id 返回 stale；
// - 登录：同一时间一个；startLogin 先停旧会话，登录方式的解析带代次（晚到的结果作废）；
//   扫码确认后的回调只刷新账户，回调结束后由 controller 决定收起、显示刷新失败或发起 activate-after-login 确认；
// - 当前平台：存的平台不在列表里时回落网易并写回（不经确认、不清理、不动账户缓存）；
// - 快照在没有变化时保持对象身份（useSyncExternalStore 友好）。

const IDLE_LOGOUT: LibraryAccountLogoutState = Object.freeze({ providerId: null, status: 'idle' });

/** 控制器自己的日志出口（未注入时打到 console，前缀与会话的 [ProviderQrLogin] 区分）。 */
const consoleAccountLogger: LibraryAccountLogger = (level, event, detail) => {
    console[level](`[LibraryAccount] ${event}`, detail);
};

// 切换清理与后端重启的错误只记原文；登录 / 刷新 / 登出错误经 accountRules 的 describeLoginError，
// 带上错误类别、HTTP 状态与后端原始响应。
const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * controller 内部的登录状态（快照里的 login 由它和会话快照派生）。
 * - resolving-methods / choosing-method：还没向后端要码，sessionId 为 null；
 * - session：已经 start 过登录会话，sessionId 是会话回执里的 id（用来认领会话快照与确认事件）。
 */
type LoginState = {
    /** 快照里的会话代次：startLogin 与每次要码（选方式、重试、重启后续上）都换新。 */
    id: number;
    providerId: OnlineProviderId;
    methods: readonly QrLoginMethod[];
    selectedMethodId: string | null;
    stage: 'resolving-methods' | 'choosing-method' | 'session';
    sessionId: number | null;
};

type PendingSwitch = {
    request: LibraryProviderSwitchRequest;
    /** 确认后要不要刷新新账户：switch 刷新；activate-after-login 不刷新（登录确认时刚刷新过）。 */
    refreshAfterCommit: boolean;
    resolve: (result: LibrarySwitchResult) => void;
};

const NO_METHODS: readonly QrLoginMethod[] = Object.freeze([]);

// provider 摘要逐字段比较：omni 每次都新建摘要对象（availability 也是新的），内容没变时沿用旧对象。
const sameSummary = (a: ProviderAccountSummary, b: ProviderAccountSummary): boolean => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof ProviderAccountSummary>);
    for (const key of keys) {
        if (key === 'availability') {
            if (JSON.stringify(a.availability) !== JSON.stringify(b.availability)) return false;
        } else if (!Object.is(a[key], b[key])) {
            return false;
        }
    }
    return true;
};

/** 把新读到的 provider 列表与上一份对齐：未变的摘要沿用旧对象，整份都没变时沿用旧数组。 */
const reconcileProviders = (
    previous: ProviderAccountSummary[],
    incoming: ProviderAccountSummary[],
): ProviderAccountSummary[] => {
    const previousById = new Map(previous.map(summary => [summary.providerId, summary]));
    const reconciled = incoming.map(summary => {
        const existing = previousById.get(summary.providerId);
        return existing && sameSummary(existing, summary) ? existing : summary;
    });
    return reconciled.length === previous.length && reconciled.every((summary, index) => summary === previous[index])
        ? previous
        : reconciled;
};

const sameLoginSnapshot = (a: LibraryLoginSessionSnapshot, b: LibraryLoginSessionSnapshot): boolean => (
    a.id === b.id
    && a.providerId === b.providerId
    && a.phase === b.phase
    && a.methods === b.methods
    && a.selectedMethodId === b.selectedMethodId
    && a.qrImageUrl === b.qrImageUrl
    && a.failure === b.failure
    && a.retryCooldownSeconds === b.retryCooldownSeconds
    && a.selfCheck === b.selfCheck
    && a.backend.failed === b.backend.failed
    && a.backend.detail === b.backend.detail
    && a.backend.restarting === b.backend.restarting
    && a.backend.canRestart === b.backend.canRestart
    // copy 由 providerId / phase / methods / selectedMethodId / failure / retryCooldownSeconds / backend.failed 派生，
    // 上面都相等时它也相等。
);

/** 建在线账户 controller；寿命由宿主决定（首页外壳），dispose 之后的调用安全无效。 */
export const createProviderAccountController = (deps: LibraryAccountControllerDeps): LibraryAccountController => {
    const { auth, accounts, providerAccounts, spotifyAuth, switchCleanup, neteaseBackend } = deps;
    const log = deps.log ?? consoleAccountLogger;
    const listeners = new Set<() => void>();

    let disposed = false;
    let providers = reconcileProviders([], accounts.listProviders());
    let login: LoginState | null = null;
    // 登录代次：startLogin / closeLogin / 每次要码 / dispose 都前进；方式解析与后端重启 await 之后按它作废。
    let loginSeq = 0;
    let pending: PendingSwitch | null = null;
    let switchSeq = 0;
    let logout: LibraryAccountLogoutState = IDLE_LOGOUT;
    let lastLoginCompletion: LibraryLoginCompletion | null = null;
    let snapshot: LibraryAccountSnapshot;
    // 内部一次改多处时只在最外层结束后重建一次快照，避免中间态（例如会话 start 同步发出的通知）漏到界面。
    let batchDepth = 0;

    const session = createProviderLoginSession({
        auth,
        clock: deps.clock,
        diagnostics: deps.diagnostics,
        log: deps.log,
        onConfirmed: event => handleConfirmed(event),
    });

    const activeProviderId = (): OnlineProviderId => resolveActiveProviderId(providers, accounts.getStoredActiveProviderId());
    const findProvider = (providerId: OnlineProviderId) => providers.find(provider => provider.providerId === providerId);

    // 会话属于当前登录时取它的原始状态；还没要码（或会话快照还没换到这一轮）时视为 loading。
    const deriveLogin = (previous: LibraryLoginSessionSnapshot | null): LibraryLoginSessionSnapshot | null => {
        if (!login) return null;
        let phase: LibraryLoginPhase = login.stage === 'session' ? 'loading' : login.stage;
        let qrImageUrl = '';
        let failure: LibraryLoginSessionSnapshot['failure'] = null;
        let retryCooldownSeconds: number | null = null;
        let selfCheck: LibraryLoginSessionSnapshot['selfCheck'] = null;
        if (login.stage === 'session') {
            const raw: ProviderLoginSessionSnapshot = session.getSnapshot();
            if (raw.sessionId === login.sessionId) {
                phase = raw.phase === 'idle' ? 'loading' : raw.phase;
                qrImageUrl = raw.qrImageUrl;
                failure = raw.failure;
                retryCooldownSeconds = raw.retryCooldownSeconds;
                selfCheck = raw.selfCheck;
            }
        }
        const backend = resolveLoginBackendState(login.providerId, neteaseBackend.getHealth());
        const base = {
            id: login.id,
            providerId: login.providerId,
            phase,
            methods: login.methods,
            selectedMethodId: login.selectedMethodId,
            qrImageUrl,
            failure,
            retryCooldownSeconds,
            selfCheck,
            backend,
        };
        const next: LibraryLoginSessionSnapshot = { ...base, copy: resolveLoginSessionCopy(base) };
        return previous && sameLoginSnapshot(previous, next) ? previous : next;
    };

    const buildSnapshot = (previous: LibraryAccountSnapshot | null): LibraryAccountSnapshot => {
        const next: LibraryAccountSnapshot = {
            providers,
            activeProviderId: activeProviderId(),
            login: deriveLogin(previous?.login ?? null),
            pendingSwitch: pending?.request ?? null,
            logout,
            lastLoginCompletion,
        };
        if (
            previous
            && previous.providers === next.providers
            && previous.activeProviderId === next.activeProviderId
            && previous.login === next.login
            && previous.pendingSwitch === next.pendingSwitch
            && previous.logout === next.logout
            && previous.lastLoginCompletion === next.lastLoginCompletion
        ) {
            return previous;
        }
        return next;
    };

    snapshot = buildSnapshot(null);

    const commit = (): void => {
        if (batchDepth > 0) return;
        const next = buildSnapshot(snapshot);
        if (next === snapshot) return;
        snapshot = next;
        if (disposed) return;
        for (const listener of [...listeners]) listener();
    };

    const batch = <T>(run: () => T): T => {
        batchDepth += 1;
        try {
            return run();
        } finally {
            batchDepth -= 1;
            commit();
        }
    };

    // 存的当前平台不可用（例如 mod 源被关掉）时写回网易：不经确认、不清理、不动那个平台的账户缓存
    // （与原 useOnlineProviderPlatform 的回落一致）。写回会再触发一次账户通知，那时已一致，不会循环。
    const reconcileStoredProvider = (): void => {
        if (disposed) return;
        const stored = accounts.getStoredActiveProviderId();
        const resolved = resolveActiveProviderId(providers, stored);
        if (stored !== resolved) accounts.setActiveProviderId(resolved);
    };

    const handleAccountsChanged = (): void => {
        if (disposed) return;
        providers = reconcileProviders(providers, accounts.listProviders());
        commit();
        reconcileStoredProvider();
    };

    const unsubscribes = [
        accounts.subscribe(handleAccountsChanged),
        neteaseBackend.subscribe(commit),
        session.subscribe(commit),
    ];
    // 首次回落写回推迟到微任务：宿主可能在渲染期间创建 controller，渲染中写 store 会牵动别的组件。
    void Promise.resolve().then(reconcileStoredProvider);

    // ─── 切换 ───────────────────────────────────────────────────────────

    const settlePending = (result: LibrarySwitchResult): void => {
        const current = pending;
        if (!current) return;
        pending = null;
        current.resolve(result);
    };

    const openSwitchRequest = (
        to: OnlineProviderId,
        reason: LibraryProviderSwitchReason,
    ): Promise<LibrarySwitchResult> => {
        if (disposed) return Promise.resolve({ status: 'declined', providerId: to, reason: 'disposed' });
        const from = activeProviderId();
        if (to === from) return Promise.resolve({ status: 'switched', providerId: to, changed: false });
        const selection = resolveProviderSelection(findProvider(to));
        if (selection.kind === 'unavailable') {
            return Promise.resolve({ status: 'unavailable', providerId: to, reason: selection.reason });
        }
        return new Promise<LibrarySwitchResult>(resolve => {
            batch(() => {
                // 同一时间最多一个待确认请求：旧的按 superseded 拒绝（沿用 App 的 prev?.resolve(false)）。
                if (pending) settlePending({ status: 'declined', providerId: pending.request.to, reason: 'superseded' });
                pending = {
                    request: { id: ++switchSeq, from, to, reason },
                    refreshAfterCommit: reason === 'switch',
                    resolve,
                };
            });
        });
    };

    const confirmSwitch = async (requestId: number): Promise<LibrarySwitchConfirmResult> => {
        const current = pending;
        if (!current || current.request.id !== requestId) return { status: 'stale', requestId };
        const { from, to } = current.request;
        // 先收起确认框，再清理（与 App 的 handleConfirmProviderSwitch 相同的顺序）。
        batch(() => { pending = null; });
        try {
            await switchCleanup.resetForProviderSwitch(to, from);
        } catch (error) {
            // 用户已经确认了：清理出错也照样切过去，只记日志（旧实现会让切换永远悬着）。
            log('warn', 'switch:cleanup-error', { from, to, message: describeError(error) });
        }
        accounts.invalidateActiveRequests();
        accounts.setActiveProviderId(to);
        if (current.refreshAfterCommit) {
            try {
                await providerAccounts.refresh(to);
            } catch (error) {
                log('warn', 'switch:refresh-error', { providerId: to, ...describeLoginError(error) });
            }
        }
        current.resolve({ status: 'switched', providerId: to, changed: true });
        return { status: 'confirmed', requestId, providerId: to };
    };

    const cancelSwitch = (requestId: number): LibrarySwitchCancelResult => {
        if (!pending || pending.request.id !== requestId) return { status: 'stale', requestId };
        batch(() => settlePending({ status: 'declined', providerId: pending!.request.to, reason: 'cancelled' }));
        return { status: 'cancelled', requestId };
    };

    // ─── 登录 ───────────────────────────────────────────────────────────

    /** 在当前登录里开始要码：会话 start 不 await（进度都在快照里），settled 的意外拒绝只记日志。 */
    const beginSession = (id: number, current: LoginState, methodId: string | null): number => {
        batch(() => {
            const ticket = session.start(current.providerId, methodId ?? undefined);
            ticket.settled.catch(error => {
                log('warn', 'login:start-rejected', { providerId: current.providerId, ...describeLoginError(error) });
            });
            login = { ...current, id, stage: 'session', selectedMethodId: methodId, sessionId: ticket.sessionId };
        });
        return id;
    };

    const startLogin = async (providerId: OnlineProviderId): Promise<LibraryStartLoginResult> => {
        if (disposed) return { status: 'superseded', providerId };
        const selection = resolveProviderSelection(findProvider(providerId));
        if (selection.kind === 'unavailable') return { status: 'unavailable', providerId, reason: selection.reason };
        const attempt = ++loginSeq;
        batch(() => {
            // 单一在途登录：先停旧会话（keyed 取消），旧会话不会再在后台替旧平台确认（A0 记下的潜在 bug）。
            session.stop();
            login = {
                id: attempt,
                providerId,
                methods: NO_METHODS,
                selectedMethodId: null,
                stage: 'resolving-methods',
                sessionId: null,
            };
        });
        let methods: readonly QrLoginMethod[];
        try {
            methods = await auth.resolveQrLoginMethods(providerId);
        } catch (error) {
            // 方式发现失败时按单步流程要码：要码失败会落到 start-error，界面能看到失败与诊断。
            log('warn', 'login:methods-error', { providerId, ...describeLoginError(error) });
            methods = NO_METHODS;
        }
        // 解析期间有更新的 startLogin、关窗或 dispose：这一轮作废（对应 Grid3D 的 loginAttemptIdRef）。
        if (attempt !== loginSeq || disposed || !login) return { status: 'superseded', providerId };
        const resolved: LoginState = { ...login, methods: methods.length > 0 ? methods : NO_METHODS };
        if (methods.length > 0) {
            // 多种方式：停在第一步，选定之前不向后端要码。
            batch(() => { login = { ...resolved, stage: 'choosing-method' }; });
            return { status: 'started', providerId, sessionId: attempt, step: 'choosing-method' };
        }
        beginSession(attempt, resolved, null);
        return { status: 'started', providerId, sessionId: attempt, step: 'qr' };
    };

    const currentBackend = (current: LoginState) => resolveLoginBackendState(current.providerId, neteaseBackend.getHealth());

    const selectLoginMethod = async (methodId: string): Promise<LibraryLoginRequestResult> => {
        if (disposed || !login) return { status: 'no-session' };
        if (!login.methods.some(method => method.id === methodId)) return { status: 'rejected', reason: 'unknown-method' };
        if (currentBackend(login).failed) return { status: 'rejected', reason: 'backend-failed' };
        return { status: 'requested', sessionId: beginSession(++loginSeq, login, methodId) };
    };

    const retryLogin = async (): Promise<LibraryLoginRequestResult> => {
        if (disposed || !login) return { status: 'no-session' };
        const current = deriveLogin(null)!;
        if (isAwaitingLoginMethod(current)) return { status: 'rejected', reason: 'method-required' };
        if (current.backend.failed) return { status: 'rejected', reason: 'backend-failed' };
        if (isLoginRetryCoolingDown(current)) return { status: 'rejected', reason: 'cooling-down' };
        if (!canRetryLogin(current)) return { status: 'rejected', reason: 'not-retryable' };
        // 保留已选的登录方式，否则用户会被踢回第一步。
        return { status: 'requested', sessionId: beginSession(++loginSeq, login, login.selectedMethodId) };
    };

    const closeLogin = (): LibraryLoginCloseResult => {
        if (disposed || !login) return { status: 'no-session' };
        const sessionId = login.id;
        batch(() => {
            loginSeq += 1;
            session.stop();
            login = null;
        });
        return { status: 'closed', sessionId };
    };

    const restartLoginBackend = async (): Promise<LibraryBackendRestartResult> => {
        if (disposed || !login) return { status: 'no-session' };
        if (!currentBackend(login).canRestart) return { status: 'rejected', reason: 'not-restartable' };
        const attempt = loginSeq;
        try {
            await neteaseBackend.restart();
        } catch (error) {
            log('warn', 'login:backend-restart-error', { message: describeError(error) });
        }
        // 重启期间关窗、换了登录或 dispose：不再替用户要码。
        if (disposed || !login || attempt !== loginSeq) return { status: 'no-session' };
        if (!shouldResumeLoginAfterBackendRestart(neteaseBackend.getHealth())) return { status: 'still-down' };
        // 重启成功后直接把二维码要回来（Grid3D 的 handleRestartNeteaseApi），沿用当前的登录方式。
        return { status: 'resumed', sessionId: beginSession(++loginSeq, login, login.selectedMethodId) };
    };

    const buildLoginDiagnosticReport = async (): Promise<LibraryLoginDiagnosticResult> => {
        if (disposed) return { status: 'no-session' };
        const report = await session.buildDiagnosticReport();
        return report === null ? { status: 'no-session' } : { status: 'ok', report };
    };

    const ownsSession = (sessionId: number): boolean => (
        !disposed && login !== null && login.stage === 'session' && login.sessionId === sessionId
    );

    /**
     * 扫码确认后的链路。会话的确认回调只刷新账户并返回（false / 抛错 → 会话回到 error + account-refresh-failed）；
     * 回调结束后在这里收尾：刷新失败保留登录快照（界面重新出现并显示失败）；成功则收起登录，
     * 不是当前平台时再发起 activate-after-login 的待确认切换（激活这一步不再刷新）。
     * 登录在刷新期间被关掉或换掉时不再收尾（用户已经走开）。
     */
    const handleConfirmed = (event: ProviderLoginConfirmedEvent): Promise<boolean> => {
        const refreshed = (async () => {
            try {
                return await providerAccounts.refresh(event.providerId) !== false;
            } catch (error) {
                log('warn', 'login:refresh-error', { providerId: event.providerId, ...describeLoginError(error) });
                return false;
            }
        })();
        void refreshed.then(ok => finishConfirmedLogin(event, ok));
        return refreshed;
    };

    const finishConfirmedLogin = async (event: ProviderLoginConfirmedEvent, refreshed: boolean): Promise<void> => {
        if (!ownsSession(event.sessionId)) return;
        const loginId = login!.id;
        const complete = (outcome: LibraryLoginCompletion['outcome']) => {
            lastLoginCompletion = { sessionId: loginId, providerId: event.providerId, outcome };
        };
        if (!refreshed) {
            batch(() => complete('refresh-failed'));
            return;
        }
        const needsActivation = event.providerId !== activeProviderId();
        batch(() => {
            login = null;
            if (!needsActivation) complete('completed');
        });
        if (!needsActivation) return;
        const result = await openSwitchRequest(event.providerId, 'activate-after-login');
        if (disposed) return;
        batch(() => complete(result.status === 'switched' ? 'completed' : 'activation-declined'));
    };

    // ─── 选平台与登出 ───────────────────────────────────────────────────

    const selectProvider = async (providerId: OnlineProviderId): Promise<LibrarySelectProviderResult> => {
        const selection = resolveProviderSelection(findProvider(providerId));
        if (selection.kind === 'unavailable') return { action: 'unavailable', providerId, reason: selection.reason };
        if (selection.kind === 'switch') return { action: 'switch', result: await openSwitchRequest(providerId, 'switch') };
        return { action: 'login', result: await startLogin(providerId) };
    };

    const logoutProvider = async (providerId: OnlineProviderId): Promise<LibraryLogoutResult> => {
        if (disposed) return { status: 'failed', providerId, message: 'account controller disposed' };
        const eligibility = resolveLogoutEligibility(findProvider(providerId), activeProviderId());
        if (!eligibility.allowed) return { status: 'rejected', providerId, reason: eligibility.reason };
        if (logout.status === 'pending') return { status: 'busy', providerId };
        batch(() => { logout = { providerId, status: 'pending' }; });
        try {
            await providerAccounts.logout(providerId);
            return { status: 'logged-out', providerId };
        } catch (error) {
            log('warn', 'logout:error', { providerId, ...describeLoginError(error) });
            return { status: 'failed', providerId, message: describeError(error) };
        } finally {
            if (!disposed) batch(() => { logout = IDLE_LOGOUT; });
        }
    };

    // ─── Spotify 授权配置 ───────────────────────────────────────────────

    /** 弹窗要的只读配置：用户自填的 Client ID 与回调地址，都来自注入端口。 */
    const getSpotifyAuthConfig = (): LibrarySpotifyAuthConfig => ({
        clientId: spotifyAuth.getCustomClientId(),
        redirectUri: spotifyAuth.getRedirectUri(),
    });

    /** 保存 Client ID 并清掉旧令牌（端口实现）；宿主卸载后不再写。 */
    const saveSpotifyClientId = (clientId: string): void => {
        if (disposed) return;
        spotifyAuth.saveClientId(clientId);
    };

    // ─── 寿命 ───────────────────────────────────────────────────────────

    const dispose = (): void => {
        if (disposed) return;
        loginSeq += 1;
        session.dispose();
        login = null;
        if (pending) settlePending({ status: 'declined', providerId: pending.request.to, reason: 'disposed' });
        logout = IDLE_LOGOUT;
        for (const unsubscribe of unsubscribes) unsubscribe();
        disposed = true;
        snapshot = buildSnapshot(snapshot);
        listeners.clear();
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: listener => {
            if (disposed) return () => { };
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        selectProvider,
        requestSwitch: providerId => openSwitchRequest(providerId, 'switch'),
        confirmSwitch,
        cancelSwitch,
        startLogin,
        selectLoginMethod,
        retryLogin,
        closeLogin,
        restartLoginBackend,
        buildLoginDiagnosticReport,
        getSpotifyAuthConfig,
        saveSpotifyClientId,
        logout: logoutProvider,
        dispose,
    };
};
