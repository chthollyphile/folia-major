import type { LoginMethod, LoginTexts, OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type {
    LibraryAccountController,
    LibraryAccountControllerDeps,
    LibraryAccountLogger,
    LibraryAccountLogoutState,
    LibraryAccountSnapshot,
    LibraryLocalServiceRestartResult,
    LibraryLoginCloseResult,
    LibraryLoginCompletion,
    LibraryLoginDiagnosticResult,
    LibraryLoginOutcome,
    LibraryLoginPageResult,
    LibraryLoginPhase,
    LibraryLoginRequestResult,
    LibraryLoginSessionSnapshot,
    LibraryLogoutResult,
    LibraryProviderSwitchReason,
    LibraryProviderSwitchRequest,
    LibrarySelectProviderResult,
    LibraryStartLoginResult,
    LibrarySwitchCancelResult,
    LibrarySwitchConfirmResult,
    LibrarySwitchResult,
} from './account.contract';
import {
    canRestartLocalService,
    canRetryLogin,
    describeLoginError,
    isAwaitingLoginMethod,
    isLoginUnderWay,
    resolveActiveProviderId,
    resolveLocalServiceState,
    resolveLogoutEligibility,
    resolveProviderSelection,
    retryOpensAt,
} from './accountRules';
import {
    createProviderLoginSession,
    type ProviderLoginConfirmedEvent,
    type ProviderLoginSessionSnapshot,
} from './providerLoginSession.service';

// src/library/core/account/providerAccountController.service.ts
// 在线账户 controller（Library v2 · A3）：组合登录会话，持有切换确认、单一在途登录与登出，实现 contracts/account 的
// LibraryAccountController。无 React、不直接碰 omni / store：全部经注入的端口（默认装配在 providerAccountDeps，
// 宿主传入退出、退出前的那一问与清空播放器）。
// - 切换：播放器里有歌才生成待确认请求（自增 id），没有歌就直接切；切的时候依次 清空播放器 → 作废在途请求 →
//   写当前平台 → 读新账户；新请求把旧的按 declined/superseded 结算，过期 id 返回 stale；
// - 登录：同一时间一个，只由登录窗口开始；startLogin 先停旧会话，登录方式的解析带代次（晚到的结果作废）；
//   确认后的回调只读账号，回调结束后由 controller 决定收起、显示没读到账号或切到登录的平台；
// - 登出：先经宿主问用的人，退的是当前平台时清空播放器，再退出；
// - 当前平台：存的平台不在列表里时回落默认平台并写回（不经确认、不清空、不动账户缓存）；
// - 快照在没有变化时保持对象身份（useSyncExternalStore 友好）。

const IDLE_LOGOUT: LibraryAccountLogoutState = Object.freeze({ providerId: null, status: 'idle' });

/** 控制器自己的日志出口（未注入时打到 console，前缀与会话的 [ProviderLogin] 区分）。 */
const consoleAccountLogger: LibraryAccountLogger = (level, event, detail) => {
    console[level](`[LibraryAccount] ${event}`, detail);
};

/**
 * controller 内部的登录状态（快照里的 login 由它和会话快照派生）。
 * - resolving-methods / choosing-method / ready：还没开始，sessionId 为 null；
 * - session：已经 start 过登录会话，sessionId 是会话回执里的 id（用来认领会话快照与确认事件）。
 */
type LoginState = {
    /** 快照里的会话代次：startLogin 与每次开始（选方式、重来、重启后续上）都换新。 */
    id: number;
    providerId: OnlineProviderId;
    methods: readonly LoginMethod[];
    selectedMethodId: string | null;
    inBrowser: boolean;
    texts: LoginTexts | null;
    stage: 'resolving-methods' | 'choosing-method' | 'ready' | 'session';
    sessionId: number | null;
};

type PendingSwitch = {
    request: LibraryProviderSwitchRequest;
    resolve: (result: LibrarySwitchResult) => void;
};

const NO_METHODS: readonly LoginMethod[] = Object.freeze([]);

// provider 不在了（例如 mod 源刚被关掉）时问它的同步问题会抛错：当它没有那一样。
const askSafely = <T,>(ask: () => T, fallback: T): T => {
    try {
        return ask();
    } catch {
        return fallback;
    }
};

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
    && a.inBrowser === b.inBrowser
    && a.codeImage === b.codeImage
    && a.canReopenLoginPage === b.canReopenLoginPage
    && a.failure === b.failure
    && a.selfCheck === b.selfCheck
    && a.texts === b.texts
    && a.localService.available === b.localService.available
    && a.localService.failed === b.localService.failed
    && a.localService.error === b.localService.error
    && a.localService.restarting === b.localService.restarting
);

/** 建在线账户 controller；寿命由宿主决定（App），dispose 之后的调用安全无效。 */
export const createProviderAccountController = (deps: LibraryAccountControllerDeps): LibraryAccountController => {
    const { auth, accounts, providerAccounts, switchCleanup, clock } = deps;
    const log = deps.log ?? consoleAccountLogger;
    const listeners = new Set<() => void>();

    let disposed = false;
    let providers = reconcileProviders([], accounts.listProviders());
    let login: LoginState | null = null;
    // 登录代次：startLogin / closeLogin / 每次开始 / dispose 都前进；方式解析与本地服务重启 await 之后按它作废。
    let loginSeq = 0;
    let pending: PendingSwitch | null = null;
    let switchSeq = 0;
    let logout: LibraryAccountLogoutState = IDLE_LOGOUT;
    let lastLoginCompletion: LibraryLoginCompletion | null = null;
    let snapshot: LibraryAccountSnapshot;
    // 内部一次改多处时只在最外层结束后重建一次快照，避免中间态（例如会话 start 同步发出的通知）漏到界面。
    let batchDepth = 0;
    // 正在登录的平台的本地服务：它的状态变了快照跟着变。
    let watchedService: { providerId: OnlineProviderId; unsubscribe: () => void } | null = null;

    const session = createProviderLoginSession({
        auth,
        clock,
        diagnostics: deps.diagnostics,
        log: deps.log,
        onConfirmed: event => handleConfirmed(event),
    });

    const activeProviderId = (): OnlineProviderId => resolveActiveProviderId(providers, accounts.getStoredActiveProviderId());
    const findProvider = (providerId: OnlineProviderId) => providers.find(provider => provider.providerId === providerId);
    const localServiceOf = (providerId: OnlineProviderId) => askSafely(() => auth.getLoginLocalService(providerId), null);

    // 会话属于当前登录时取它的原始状态；还没开始（或会话快照还没换到这一轮）时视为 loading。
    const deriveLogin = (previous: LibraryLoginSessionSnapshot | null): LibraryLoginSessionSnapshot | null => {
        if (!login) return null;
        let phase: LibraryLoginPhase = login.stage === 'session' ? 'loading' : login.stage;
        let codeImage = '';
        let canReopenLoginPage = true;
        let failure: LibraryLoginSessionSnapshot['failure'] = null;
        let selfCheck: LibraryLoginSessionSnapshot['selfCheck'] = null;
        if (login.stage === 'session') {
            const raw: ProviderLoginSessionSnapshot = session.getSnapshot();
            if (raw.sessionId === login.sessionId) {
                phase = raw.phase === 'idle' ? 'loading' : raw.phase;
                codeImage = raw.codeImage;
                canReopenLoginPage = raw.canReopenLoginPage;
                failure = raw.failure;
                selfCheck = raw.selfCheck;
            }
        }
        const service = localServiceOf(login.providerId);
        const next: LibraryLoginSessionSnapshot = {
            id: login.id,
            providerId: login.providerId,
            phase,
            methods: login.methods,
            selectedMethodId: login.selectedMethodId,
            inBrowser: login.inBrowser,
            codeImage,
            canReopenLoginPage,
            failure,
            selfCheck,
            localService: resolveLocalServiceState(service ? askSafely(() => service.getStatus(), null) : null),
            texts: login.texts,
        };
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

    const batch = <T,>(run: () => T): T => {
        batchDepth += 1;
        try {
            return run();
        } finally {
            batchDepth -= 1;
            commit();
        }
    };

    /** 听正在登录的平台的本地服务；没有登录（或换了平台）时放掉上一个。 */
    const watchLocalService = (providerId: OnlineProviderId | null): void => {
        if (watchedService?.providerId === providerId) return;
        watchedService?.unsubscribe();
        watchedService = null;
        if (providerId === null) return;
        const service = localServiceOf(providerId);
        if (!service) return;
        watchedService = { providerId, unsubscribe: askSafely(() => service.subscribe(commit), () => { }) };
    };

    // 存的当前平台不可用（例如 mod 源被关掉）时写回默认平台：不经确认、不清空、不动那个平台的账户缓存。
    // 写回会再触发一次账户通知，那时已一致，不会循环。
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

    /** 切过去：清空播放器 → 作废上一个平台的在途请求 → 写当前平台 → （switch 时）读新账户。 */
    const commitSwitch = async (from: OnlineProviderId, to: OnlineProviderId, readAccount: boolean): Promise<void> => {
        try {
            await switchCleanup.resetForProviderSwitch(to, from);
        } catch (error) {
            // 用户已经同意了（或者播放器里本来就没有歌）：清空出错也照样切过去，只记日志。
            log('warn', 'switch:cleanup-error', { from, to, ...describeLoginError(error) });
        }
        accounts.invalidateActiveRequests();
        accounts.setActiveProviderId(to);
        if (!readAccount) return;
        try {
            await providerAccounts.refresh(to, 'switch');
        } catch (error) {
            log('warn', 'switch:refresh-error', { providerId: to, ...describeLoginError(error) });
        }
    };

    const openSwitchRequest = async (
        to: OnlineProviderId,
        reason: LibraryProviderSwitchReason,
    ): Promise<LibrarySwitchResult> => {
        if (disposed) return { status: 'declined', providerId: to, reason: 'disposed' };
        const from = activeProviderId();
        if (to === from) return { status: 'switched', providerId: to, changed: false };
        const selection = resolveProviderSelection(findProvider(to));
        if (selection.kind === 'unavailable') return { status: 'unavailable', providerId: to, reason: selection.reason };
        // 切过去会清空播放器：里面有歌才问，没有歌就直接切。
        if (!askSafely(() => switchCleanup.holdsSongs(), true)) {
            log('info', 'switch', { from, to, reason, asked: false });
            if (pending) batch(() => settlePending({ status: 'declined', providerId: pending!.request.to, reason: 'superseded' }));
            await commitSwitch(from, to, reason === 'switch');
            return { status: 'switched', providerId: to, changed: true };
        }
        return new Promise<LibrarySwitchResult>(resolve => {
            batch(() => {
                // 同一时间最多一个待确认请求：旧的按 superseded 拒绝。
                if (pending) settlePending({ status: 'declined', providerId: pending.request.to, reason: 'superseded' });
                pending = { request: { id: ++switchSeq, from, to, reason }, resolve };
            });
        });
    };

    const confirmSwitch = async (requestId: number): Promise<LibrarySwitchConfirmResult> => {
        const current = pending;
        if (!current || current.request.id !== requestId) return { status: 'stale', requestId };
        const { from, to, reason } = current.request;
        log('info', 'switch', { from, to, reason, asked: true });
        // 先收起确认框，再清空（确认框按下确认后立即收起）。
        batch(() => { pending = null; });
        await commitSwitch(from, to, reason === 'switch');
        current.resolve({ status: 'switched', providerId: to, changed: true });
        return { status: 'confirmed', requestId, providerId: to };
    };

    const cancelSwitch = (requestId: number): LibrarySwitchCancelResult => {
        if (!pending || pending.request.id !== requestId) return { status: 'stale', requestId };
        batch(() => settlePending({ status: 'declined', providerId: pending!.request.to, reason: 'cancelled' }));
        return { status: 'cancelled', requestId };
    };

    // ─── 登录 ───────────────────────────────────────────────────────────

    /** 在当前登录里开始：会话 start 不 await（进度都在快照里），settled 的意外拒绝只记日志。 */
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
            // 单一在途登录：先停旧会话（keyed 取消），旧会话不会再在后台替旧平台确认。
            session.stop();
            login = {
                id: attempt,
                providerId,
                methods: NO_METHODS,
                selectedMethodId: null,
                inBrowser: askSafely(() => auth.confirmsLoginInBrowser(providerId), false),
                texts: askSafely(() => auth.getLoginTexts(providerId), null),
                stage: 'resolving-methods',
                sessionId: null,
            };
            watchLocalService(providerId);
        });
        let methods: readonly LoginMethod[];
        try {
            methods = await auth.resolveLoginMethods(providerId);
        } catch (error) {
            // 方式发现失败时按单步流程开始：开始失败会落到快照里，界面能看到失败与诊断。
            log('warn', 'login:methods-error', { providerId, ...describeLoginError(error) });
            methods = NO_METHODS;
        }
        // 解析期间有更新的 startLogin、关窗或 dispose：这一轮作废。
        if (attempt !== loginSeq || disposed || !login) return { status: 'superseded', providerId };
        const resolved: LoginState = { ...login, methods: methods.length > 0 ? methods : NO_METHODS };
        log('info', 'login:chosen', { providerId, methods: methods.length, inBrowser: resolved.inBrowser });
        if (methods.length > 0) {
            // 多种方式：停在第一步，选定之前不向平台要码。
            batch(() => { login = { ...resolved, stage: 'choosing-method' }; });
            return { status: 'started', providerId, sessionId: attempt, step: 'choosing-method' };
        }
        if (resolved.inBrowser) {
            // 在浏览器里确认的：等用的人按「打开浏览器」再开始。
            batch(() => { login = { ...resolved, stage: 'ready' }; });
            return { status: 'started', providerId, sessionId: attempt, step: 'ready' };
        }
        beginSession(attempt, resolved, null);
        return { status: 'started', providerId, sessionId: attempt, step: 'started' };
    };

    const selectLoginMethod = async (methodId: string): Promise<LibraryLoginRequestResult> => {
        if (disposed || !login) return { status: 'no-session' };
        if (!login.methods.some(method => method.id === methodId)) return { status: 'rejected', reason: 'unknown-method' };
        return { status: 'requested', sessionId: beginSession(++loginSeq, login, methodId) };
    };

    const retryLogin = async (): Promise<LibraryLoginRequestResult> => {
        if (disposed || !login) return { status: 'no-session' };
        const current = deriveLogin(null)!;
        if (isAwaitingLoginMethod(current)) return { status: 'rejected', reason: 'method-required' };
        if (current.failure && clock.now() < retryOpensAt(current.failure)) return { status: 'rejected', reason: 'cooling-down' };
        if (!canRetryLogin(current, clock.now())) return { status: 'rejected', reason: 'not-retryable' };
        // 保留已选的登录方式，否则用户会被踢回第一步。
        return { status: 'requested', sessionId: beginSession(++loginSeq, login, login.selectedMethodId) };
    };

    const openLoginPage = async (): Promise<LibraryLoginPageResult> => {
        if (disposed || !login) return { status: 'no-session' };
        const current = deriveLogin(null)!;
        if (!current.inBrowser || !current.canReopenLoginPage || login.stage !== 'session') {
            return { status: 'rejected', reason: 'not-reopenable' };
        }
        return await session.openLoginPage() ? { status: 'opened' } : { status: 'failed' };
    };

    const closeLogin = (): LibraryLoginCloseResult => {
        if (disposed || !login) return { status: 'no-session' };
        const sessionId = login.id;
        batch(() => {
            loginSeq += 1;
            session.stop();
            login = null;
            watchLocalService(null);
        });
        return { status: 'closed', sessionId };
    };

    const restartLocalService = async (): Promise<LibraryLocalServiceRestartResult> => {
        if (disposed || !login) return { status: 'no-session' };
        const service = localServiceOf(login.providerId);
        const state = resolveLocalServiceState(service ? askSafely(() => service.getStatus(), null) : null);
        if (!service || !canRestartLocalService(state)) return { status: 'rejected', reason: 'not-restartable' };
        const attempt = loginSeq;
        let running = false;
        try {
            running = await service.restart();
        } catch (error) {
            log('warn', 'login:local-service-restart-error', { providerId: login.providerId, ...describeLoginError(error) });
        }
        // 重启期间关窗、换了登录或 dispose：不再替用户开始。
        if (disposed || !login || attempt !== loginSeq) return { status: 'no-session' };
        if (!running) return { status: 'still-down' };
        const current = deriveLogin(null)!;
        // 这会儿登录自己走下去了（已经在要码、等着扫，或者确认了正在读账号），或者还在等用的人选方式、打开浏览器：
        // 不再开始一次。
        if (isLoginUnderWay(current.phase) || isAwaitingLoginMethod(current) || current.phase === 'ready' || current.phase === 'choosing-method') {
            return { status: 'resumed', sessionId: login.id };
        }
        // 起来了就把登录重新开始，沿用当前的登录方式，省掉一次手动刷新。
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
     * 确认后的链路。会话的确认回调只读账号并返回（false → 会话回到 error + 没读到账号）；回调结束后在这里收尾：
     * 没读到保留登录快照（界面显示失败）；读到了收起登录，不是当前平台时再切过去（播放器里有歌先问，切的时候
     * 不再读账号）。登录在读账号期间被关掉或换掉时不再收尾（用户已经走开；账号照样读到了）。
     */
    const handleConfirmed = (event: ProviderLoginConfirmedEvent): Promise<boolean> => {
        const refreshed = (async () => {
            try {
                return await providerAccounts.refresh(event.providerId, 'sign-in');
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
            watchLocalService(null);
            if (!needsActivation) complete('completed');
        });
        if (!needsActivation) return;
        const result = await openSwitchRequest(event.providerId, 'activate-after-login');
        if (disposed) return;
        batch(() => complete(result.status === 'switched' ? 'completed' : 'activation-declined'));
    };

    // ─── 表单式登录 ────────────────────────────────────────────────────

    /**
     * 表单式登录完成（FormLogin 提交成功后由登录窗口调用）：读账号，走和扫码确认一样的收尾链路——
     * 读到了收起登录，不是当前平台时先问（activate-after-login），再报完成（登录窗口据它放动画/关窗）。
     * 表单登录没有会话，sessionId 用 0。
     */
    const completeFormLogin = async (providerId: OnlineProviderId): Promise<LibraryLoginCompletion> => {
        const complete = (outcome: LibraryLoginOutcome): LibraryLoginCompletion => {
            const completion = { sessionId: 0, providerId, outcome };
            batch(() => { lastLoginCompletion = completion; });
            return completion;
        };
        if (disposed) return complete('activation-declined');
        let refreshed = false;
        try {
            refreshed = await providerAccounts.refresh(providerId, 'sign-in');
        } catch (error) {
            log('warn', 'login:refresh-error', { providerId, ...describeLoginError(error) });
        }
        if (!refreshed) return complete('refresh-failed');
        const needsActivation = providerId !== activeProviderId();
        batch(() => {
            login = null;
            watchLocalService(null);
        });
        if (!needsActivation) return complete('completed');
        const result = await openSwitchRequest(providerId, 'activate-after-login');
        if (disposed) return complete('activation-declined');
        return complete(result.status === 'switched' ? 'completed' : 'activation-declined');
    };

    // ─── 选平台与登出 ───────────────────────────────────────────────────

    const selectProvider = async (providerId: OnlineProviderId): Promise<LibrarySelectProviderResult> => {
        const selection = resolveProviderSelection(findProvider(providerId));
        if (selection.kind === 'unavailable') return { action: 'unavailable', providerId, reason: selection.reason };
        if (selection.kind === 'switch') return { action: 'switch', result: await openSwitchRequest(providerId, 'switch') };
        return { action: 'login', providerId };
    };

    const logoutProvider = async (providerId: OnlineProviderId): Promise<LibraryLogoutResult> => {
        if (disposed) return { status: 'failed', providerId, message: 'account controller disposed' };
        const eligibility = resolveLogoutEligibility(findProvider(providerId));
        if (!eligibility.allowed) return { status: 'rejected', providerId, reason: eligibility.reason };
        if (logout.status === 'pending') return { status: 'busy', providerId };
        batch(() => { logout = { providerId, status: 'pending' }; });
        try {
            // 退出当前平台也清空播放器，和切换一样；别的平台的退出不动播放器（切换时已经清掉了它的歌）。
            const wasActive = providerId === activeProviderId();
            const emptiesPlayer = wasActive && askSafely(() => switchCleanup.holdsSongs(), false);
            const confirmed = await providerAccounts.confirmLogout({ providerId, emptiesPlayer });
            log('info', 'logout', { providerId, confirmed });
            if (!confirmed) return { status: 'cancelled', providerId };
            // 在答应的那一刻清空，那时播放器里还是问的那些歌：退出要等平台的回答，这期间用的人可能放了别的。
            if (wasActive) {
                try {
                    await switchCleanup.resetForProviderSwitch(providerId, providerId);
                } catch (error) {
                    log('warn', 'logout:cleanup-error', { providerId, ...describeLoginError(error) });
                }
            }
            await providerAccounts.logout(providerId);
            return { status: 'logged-out', providerId };
        } catch (error) {
            log('warn', 'logout:error', { providerId, ...describeLoginError(error) });
            const described = describeLoginError(error);
            return { status: 'failed', providerId, message: String(described.message ?? described.name) };
        } finally {
            if (!disposed) batch(() => { logout = IDLE_LOGOUT; });
        }
    };

    // ─── 寿命 ───────────────────────────────────────────────────────────

    const dispose = (): void => {
        if (disposed) return;
        loginSeq += 1;
        session.dispose();
        login = null;
        watchLocalService(null);
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
        completeFormLogin,
        openLoginPage,
        closeLogin,
        restartLocalService,
        buildLoginDiagnosticReport,
        logout: logoutProvider,
        dispose,
    };
};
