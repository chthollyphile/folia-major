import type { LoginMethod, LoginTexts, OnlineProviderId, ProviderAccountSummary, ProviderSetupView } from '../../../types/onlineMusic';
import type {
    LibraryAccountController,
    LibraryAccountControllerDeps,
    LibraryAccountLogger,
    LibraryAccountLogoutState,
    LibraryAccountSnapshot,
    LibraryAccountSyncResult,
    LibraryAccountSyncState,
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
    LibraryProviderSetupSnapshot,
    LibraryProviderSwitchReason,
    LibrarySelectProviderResult,
    LibrarySetupActionResult,
    LibrarySetupOpenResult,
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
    resolveAccountSyncEligibility,
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
// 在线账户 controller（Library v2 · A3）：组合登录会话，持有切换、单一在途登录与登出，实现 contracts/account 的
// LibraryAccountController。无 React、不直接碰 omni / store：全部经注入的端口（默认装配在 providerAccountDeps，
// 宿主传入退出、退出前的那一问与播放器端口）。
// - 切换：不问用的人（队列可以混着几个平台的歌，切换不拿走它们），依次 离开旧平台（退出私人 FM）→ 作废在途请求 →
//   写当前平台 → 读新账户；快照里的待确认切换恒为 null，确认 / 取消一律返回 stale；
// - 登录：同一时间一个，只由登录窗口开始；startLogin 先停旧会话，登录方式的解析带代次（晚到的结果作废）；
//   确认后的回调只读账号，回调结束后由 controller 决定收起、显示没读到账号或切到登录的平台；
// - 登出：先经宿主问用的人，答应后把这个平台的歌移出播放器，再退出；
// - 同步数据：只对有账号的平台，同一时间一个；重新读账号，没读成时按账户 store 说的分出登录失效；
// - 登录之后的检查与配置清单：平台声明了 checkAfterLogin 时，读到账号之后多查一步（checking），平台回了清单就
//   停在清单上，用的人做完（finishSetup）才报这一次登录的完成；清单也能从账号那一幅打开（openSetup）。清单开着时
//   每隔一会儿重新问一次平台（状态可能在应用之外变了，例如本机程序配对好了）；
// - 当前平台：存的平台不在列表里时回落默认平台并写回（不经确认、不清空、不动账户缓存）；
// - 快照在没有变化时保持对象身份（useSyncExternalStore 友好）。

const IDLE_LOGOUT: LibraryAccountLogoutState = Object.freeze({ providerId: null, status: 'idle' });
const IDLE_SYNC: LibraryAccountSyncState = Object.freeze({ providerId: null, status: 'idle' });
/** 登录之后的检查最多等这么久：超时当作没有要做的，登录照常完成。 */
export const LOGIN_CHECK_LIMIT_MS = 20_000;
/** 配置清单开着时多久重新问一次平台。 */
export const SETUP_POLL_MS = 2_000;

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
    checksAfterLogin: boolean;
    /** checking：确认了、账号读到了，正在做登录之后的检查（会话已经走完，sessionId 留着）。 */
    stage: 'resolving-methods' | 'choosing-method' | 'ready' | 'session' | 'checking';
    sessionId: number | null;
};

/** 开着的配置清单。sign-in 的那一份带着这一次登录还没报的完成（切没切到这个平台还在路上时是一个 promise）。 */
type SetupState = LibraryProviderSetupSnapshot & {
    pending: { sessionId: number; outcome: Promise<LibraryLoginOutcome> } | null;
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
    && a.checksAfterLogin === b.checksAfterLogin
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
    let logout: LibraryAccountLogoutState = IDLE_LOGOUT;
    let sync: LibraryAccountSyncState = IDLE_SYNC;
    let lastLoginCompletion: LibraryLoginCompletion | null = null;
    let setup: SetupState | null = null;
    // 清单的代次：开、关、换一份都前进，晚到的清单按它作废。
    let setupSeq = 0;
    // 每次向平台要清单（重新问、做操作）编一个号，只认比已显示的那一份更晚问的回答：先问的晚到不能盖住后问的。
    let setupAsk = 0;
    let setupShown = 0;
    let setupPoll: unknown = null;
    let snapshotSetup: LibraryProviderSetupSnapshot | null = null;
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
        // 检查的时候会话已经走完（停在 confirmed），阶段是 controller 自己的。
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
            checksAfterLogin: login.checksAfterLogin,
        };
        return previous && sameLoginSnapshot(previous, next) ? previous : next;
    };

    // 清单的快照：内容没变时沿用旧对象（每次重新问平台都会拿到新对象）。
    const deriveSetup = (): LibraryProviderSetupSnapshot | null => {
        if (!setup) return (snapshotSetup = null);
        const previous = snapshotSetup;
        if (
            previous
            && previous.providerId === setup.providerId
            && previous.busy === setup.busy
            && previous.origin === setup.origin
            && (previous.view === setup.view || JSON.stringify(previous.view) === JSON.stringify(setup.view))
        ) {
            return previous;
        }
        snapshotSetup = { providerId: setup.providerId, view: setup.view, busy: setup.busy, origin: setup.origin };
        return snapshotSetup;
    };

    const buildSnapshot = (previous: LibraryAccountSnapshot | null): LibraryAccountSnapshot => {
        const next: LibraryAccountSnapshot = {
            providers,
            activeProviderId: activeProviderId(),
            login: deriveLogin(previous?.login ?? null),
            pendingSwitch: null,
            logout,
            sync,
            lastLoginCompletion,
            setup: deriveSetup(),
        };
        if (
            previous
            && previous.providers === next.providers
            && previous.activeProviderId === next.activeProviderId
            && previous.login === next.login
            && previous.pendingSwitch === next.pendingSwitch
            && previous.logout === next.logout
            && previous.sync === next.sync
            && previous.lastLoginCompletion === next.lastLoginCompletion
            && previous.setup === next.setup
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

    // 存的当前平台不在列表里（音源还没注册、被停用、mod 源被关掉）时，快照里的当前平台只在内存里回落
    // （resolveActiveProviderId），存的值不写回：那个平台回来后自动又是当前平台（Folium 2.0 方案 §7 第一行）。
    const handleAccountsChanged = (): void => {
        if (disposed) return;
        providers = reconcileProviders(providers, accounts.listProviders());
        commit();
    };

    const unsubscribes = [
        accounts.subscribe(handleAccountsChanged),
        session.subscribe(commit),
    ];

    // ─── 切换 ───────────────────────────────────────────────────────────

    /** 切过去：离开旧平台 → 作废上一个平台的在途请求 → 写当前平台 → （switch 时）读新账户。 */
    const commitSwitch = async (from: OnlineProviderId, to: OnlineProviderId, readAccount: boolean): Promise<void> => {
        try {
            await switchCleanup.leaveProvider(from, to);
        } catch (error) {
            // 离开旧平台出错也照样切过去，只记日志。
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

    // 切换不拿走播放器里的歌（各首按自己的平台播放），所以不问用的人，直接切。
    const openSwitchRequest = async (
        to: OnlineProviderId,
        reason: LibraryProviderSwitchReason,
    ): Promise<LibrarySwitchResult> => {
        if (disposed) return { status: 'declined', providerId: to, reason: 'disposed' };
        const from = activeProviderId();
        if (to === from) {
            // 存的平台不在、此刻生效的是回落的那个时，明确选它要记下来：存的那个回来后不再自动切回去。
            const chosen = accounts.getChosenProviderId?.() ?? accounts.getStoredActiveProviderId();
            if (chosen !== to) accounts.setActiveProviderId(to);
            return { status: 'switched', providerId: to, changed: false };
        }
        const selection = resolveProviderSelection(findProvider(to));
        if (selection.kind === 'unavailable') return { status: 'unavailable', providerId: to, reason: selection.reason };
        log('info', 'switch', { from, to, reason });
        await commitSwitch(from, to, reason === 'switch');
        return { status: 'switched', providerId: to, changed: true };
    };

    // 没有待确认的切换：任何 id 都已过期。
    const confirmSwitch = async (requestId: number): Promise<LibrarySwitchConfirmResult> => ({ status: 'stale', requestId });

    const cancelSwitch = (requestId: number): LibrarySwitchCancelResult => ({ status: 'stale', requestId });

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
            closeSetup();
            login = {
                id: attempt,
                providerId,
                methods: NO_METHODS,
                selectedMethodId: null,
                inBrowser: askSafely(() => auth.confirmsLoginInBrowser(providerId), false),
                texts: askSafely(() => auth.getLoginTexts(providerId), null),
                checksAfterLogin: askSafely(() => auth.checksAfterLogin(providerId), false),
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
        if (methods.length > 0 && resolved.inBrowser) {
            // 在浏览器里确认的几种方式：先替用的人选上平台标的那一种（没标就是第一种），停在「打开浏览器」；按下去之前还能换。
            const first = (methods.find(method => method.preferred) ?? methods[0]).id;
            batch(() => { login = { ...resolved, stage: 'ready', selectedMethodId: first }; });
            return { status: 'started', providerId, sessionId: attempt, step: 'ready' };
        }
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
        // 平台已经确认（正在读账号）或账号已经读到、正在做登录之后的检查：这一次登录已经成了，不再换。
        if (login.stage === 'checking' || deriveLogin(null)?.phase === 'confirmed') return { status: 'rejected', reason: 'not-retryable' };
        if (login.inBrowser) {
            // 浏览器登录的方式只在开始之前选：换了就停下已经开始的那一次，回到「打开浏览器」，由用的人按下去再开始。
            if (methodId === login.selectedMethodId && login.stage === 'ready') return { status: 'requested', sessionId: login.id };
            const id = ++loginSeq;
            batch(() => {
                if (login!.stage === 'session') session.stop();
                login = { ...login!, id, stage: 'ready', selectedMethodId: methodId, sessionId: null };
            });
            return { status: 'requested', sessionId: id };
        }
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
        if (disposed || (!login && !setup)) {
            // 从账号那一幅打开、还在等平台回清单的那一次也作废。
            setupSeq += 1;
            return { status: 'no-session' };
        }
        const sessionId = login?.id ?? 0;
        batch(() => {
            loginSeq += 1;
            session.stop();
            login = null;
            watchLocalService(null);
            closeSetup();
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
     * 没读到保留登录快照（界面显示失败）；读到了收起登录，不是当前平台时再切过去（切的时候不再读账号）。
     * 登录在读账号期间被关掉或换掉时不再收尾（用户已经走开；账号照样读到了）。
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
        let view: ProviderSetupView | null = null;
        if (login!.checksAfterLogin) {
            const methodId = login!.selectedMethodId;
            batch(() => { login = { ...login!, stage: 'checking' }; });
            view = await checkAfterLogin(event.providerId, methodId);
            // 检查的时候关了窗、换了一行：不再收尾（账号照样读到了，只是不切过去、不放动画）。
            if (disposed || login?.id !== loginId || login.stage !== 'checking') return;
        }
        const needsActivation = event.providerId !== activeProviderId();
        batch(() => {
            login = null;
            watchLocalService(null);
            // 平台回了清单：停在清单上，做完才报完成（finishSetup）。
            if (view) showSetup(event.providerId, view, 'sign-in', loginId);
            else if (!needsActivation) complete('completed');
        });
        if (!needsActivation) return;
        const outcome = openSwitchRequest(event.providerId, 'activate-after-login')
            .then((result): LibraryLoginOutcome => (result.status === 'switched' ? 'completed' : 'activation-declined'));
        if (view) {
            if (setup?.pending?.sessionId === loginId) setup.pending.outcome = outcome;
            return;
        }
        const settled = await outcome;
        if (disposed) return;
        batch(() => complete(settled));
    };

    /** 登录之后的检查：有时限，超时、抛错都当作没有要做的（只记日志），这一步挡不住登录。 */
    const checkAfterLogin = async (providerId: OnlineProviderId, methodId: string | null): Promise<ProviderSetupView | null> => {
        let timer: unknown = null;
        try {
            const view = await Promise.race([
                auth.checkAfterLogin(providerId, methodId),
                new Promise<'timeout'>(resolve => { timer = clock.setTimeout(() => resolve('timeout'), LOGIN_CHECK_LIMIT_MS); }),
            ]);
            if (view === 'timeout') {
                log('warn', 'login:check-timeout', { providerId, limitMs: LOGIN_CHECK_LIMIT_MS });
                return null;
            }
            log('info', 'login:checked', { providerId, methodId, setup: view !== null });
            return view;
        } catch (error) {
            log('warn', 'login:check-error', { providerId, ...describeLoginError(error) });
            return null;
        } finally {
            if (timer !== null) clock.clearTimeout(timer);
        }
    };

    // ─── 配置清单 ──────────────────────────────────────────────────────

    const stopSetupPoll = (): void => {
        if (setupPoll === null) return;
        clock.clearTimeout(setupPoll);
        setupPoll = null;
    };

    /** 收起清单（在 batch 里调）。代次总会前进：还在等平台回清单的那一次也作废。 */
    function closeSetup(): void {
        setupSeq += 1;
        stopSetupPoll();
        setup = null;
    }

    /** 开一份清单（在 batch 里调）。sessionId：登录之后的那一份是那一次登录的代次，从账号那一幅打开的是 null。 */
    const showSetup = (providerId: OnlineProviderId, view: ProviderSetupView, origin: 'sign-in' | 'account', sessionId: number | null): void => {
        closeSetup();
        // 在这之前问的清单都比它旧。
        setupShown = setupAsk;
        setup = {
            providerId,
            view,
            busy: false,
            origin,
            pending: sessionId === null ? null : { sessionId, outcome: Promise.resolve<LibraryLoginOutcome>('completed') },
        };
        scheduleSetupPoll();
    };

    const scheduleSetupPoll = (): void => {
        stopSetupPoll();
        const seq = setupSeq;
        setupPoll = clock.setTimeout(() => {
            setupPoll = null;
            void refreshSetup(seq);
        }, SETUP_POLL_MS);
    };

    /** 重新问一次平台的清单；正在做操作时跳过这一次。平台此刻回 null 时留着原来那一份。 */
    const refreshSetup = async (seq: number): Promise<void> => {
        if (disposed || !setup || seq !== setupSeq) return;
        if (setup.busy) {
            scheduleSetupPoll();
            return;
        }
        const { providerId } = setup;
        const ask = ++setupAsk;
        let view: ProviderSetupView | null = null;
        try {
            view = await auth.getSetup(providerId);
        } catch (error) {
            log('warn', 'setup:refresh-error', { providerId, ...describeLoginError(error) });
        }
        if (disposed || !setup || seq !== setupSeq) return;
        if (view && ask > setupShown) {
            setupShown = ask;
            const shown = view;
            batch(() => { setup = { ...setup!, view: shown }; });
        }
        scheduleSetupPoll();
    };

    const openSetup = async (providerId: OnlineProviderId): Promise<LibrarySetupOpenResult> => {
        if (disposed || !findProvider(providerId) || !askSafely(() => auth.hasSetup(providerId), false)) {
            return { status: 'unavailable', providerId };
        }
        batch(() => {
            loginSeq += 1;
            session.stop();
            login = null;
            watchLocalService(null);
            closeSetup();
        });
        const seq = setupSeq;
        let view: ProviderSetupView | null = null;
        try {
            view = await auth.getSetup(providerId);
        } catch (error) {
            log('warn', 'setup:open-error', { providerId, ...describeLoginError(error) });
        }
        // 等的时候关了窗、换了一行或者又开了一份：这一次作废。
        if (disposed || seq !== setupSeq || !view) return { status: 'none', providerId };
        const shown = view;
        batch(() => showSetup(providerId, shown, 'account', null));
        log('info', 'setup:open', { providerId });
        return { status: 'opened', providerId };
    };

    const runSetupAction = async (stepId: string, actionId: string, value?: string): Promise<LibrarySetupActionResult> => {
        if (disposed || !setup) return { status: 'no-setup' };
        if (setup.busy) return { status: 'busy' };
        const seq = setupSeq;
        const { providerId } = setup;
        const ask = ++setupAsk;
        batch(() => { setup = { ...setup!, busy: true }; });
        try {
            const view = await auth.runSetupAction(providerId, stepId, actionId, value);
            if (disposed || !setup || seq !== setupSeq) return { status: 'no-setup' };
            // 交出的内容（密钥）不进日志。
            log('info', 'setup:action', { providerId, stepId, actionId });
            batch(() => {
                if (ask > setupShown) {
                    setupShown = ask;
                    setup = { ...setup!, view, busy: false };
                } else {
                    setup = { ...setup!, busy: false };
                }
            });
            return { status: 'done' };
        } catch (error) {
            log('warn', 'setup:action-error', { providerId, stepId, actionId, ...describeLoginError(error) });
            if (!disposed && setup && seq === setupSeq) batch(() => { setup = { ...setup!, busy: false }; });
            return { status: 'failed' };
        }
    };

    const finishSetup = async (): Promise<void> => {
        if (disposed || !setup) return;
        const { pending, providerId } = setup;
        if (!pending) {
            batch(closeSetup);
            return;
        }
        // 登录之后的那一份：等切没切到这个平台有了结果，再收起清单、报完成（同一次提交，窗口不会先闪回别的样子）。
        batch(() => { setup = { ...setup!, busy: true }; });
        const outcome = await pending.outcome;
        if (disposed || setup?.pending !== pending) return;
        batch(() => {
            closeSetup();
            lastLoginCompletion = { sessionId: pending.sessionId, providerId, outcome };
        });
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

    /**
     * 表单式登录完整链路（FormLogin 提交时走这里，不再绕过 controller 直调 omni）：
     * 先提交表单（provider 的 submitLoginForm，失败抛错由表单显示），成功后读账号、走和扫码确认一样的收尾链路。
     * 读账号失败返回 refresh-failed：token 已存，登录窗口据结局显示提示（FormLogin 不静默关窗）。
     */
    const submitFormLogin = async (providerId: OnlineProviderId, values: Record<string, string>): Promise<LibraryLoginCompletion> => {
        if (disposed) return { sessionId: 0, providerId, outcome: 'activation-declined' };
        await providerAccounts.submitLoginForm(providerId, values);
        return completeFormLogin(providerId);
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
            // 退出只拿走这个平台自己的歌：队列里别的平台、本地与 Navidrome 的歌留着。
            const removesSongs = askSafely(() => switchCleanup.holdsSongsOf(providerId), false);
            const confirmed = await providerAccounts.confirmLogout({ providerId, removesSongs });
            log('info', 'logout', { providerId, confirmed });
            if (!confirmed) return { status: 'cancelled', providerId };
            // 在答应的那一刻移出，那时播放器里还是问的那些歌：退出要等平台的回答，这期间用的人可能放了别的。
            try {
                await switchCleanup.dropSongsOf(providerId);
            } catch (error) {
                log('warn', 'logout:cleanup-error', { providerId, ...describeLoginError(error) });
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

    const syncAccount = async (providerId: OnlineProviderId): Promise<LibraryAccountSyncResult> => {
        if (disposed) return { status: 'failed', providerId };
        const eligibility = resolveAccountSyncEligibility(findProvider(providerId));
        if (!eligibility.allowed) return { status: 'rejected', providerId, reason: eligibility.reason };
        if (sync.status === 'pending') return { status: 'busy', providerId };
        batch(() => { sync = { providerId, status: 'pending' }; });
        try {
            const synced = await providerAccounts.refresh(providerId, 'sync');
            // 没读成：账户 store 记下平台拒了登录（账号已经离开）就是登录失效；读的途中用的人退出了这个平台，
            // 读作废了，这一次同步不算失败（退出自己会说）；其余是这一次没读到。
            const after = synced ? undefined : askSafely(
                () => accounts.listProviders().find(provider => provider.providerId === providerId),
                undefined,
            );
            if (!synced && after?.error !== 'auth-required' && !resolveAccountSyncEligibility(after).allowed) {
                log('info', 'sync', { providerId, status: 'signed-out' });
                return { status: 'rejected', providerId, reason: 'not-signed-in' };
            }
            const status = synced ? 'synced' : after?.error === 'auth-required' ? 'ran-out' : 'failed';
            log(synced ? 'info' : 'warn', 'sync', { providerId, status });
            return { status, providerId };
        } catch (error) {
            log('warn', 'sync:error', { providerId, ...describeLoginError(error) });
            return { status: 'failed', providerId };
        } finally {
            if (!disposed) batch(() => { sync = IDLE_SYNC; });
        }
    };

    // ─── 寿命 ───────────────────────────────────────────────────────────

    const dispose = (): void => {
        if (disposed) return;
        loginSeq += 1;
        session.dispose();
        login = null;
        watchLocalService(null);
        stopSetupPoll();
        setup = null;
        logout = IDLE_LOGOUT;
        sync = IDLE_SYNC;
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
        submitFormLogin,
        openLoginPage,
        closeLogin,
        restartLocalService,
        buildLoginDiagnosticReport,
        logout: logoutProvider,
        syncAccount,
        openSetup,
        runSetupAction,
        finishSetup,
        dispose,
    };
};
