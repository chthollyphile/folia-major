import type { LoginFailureKind, LoginState, LoginStep, OnlineProviderId } from '../../../types/onlineMusic';
import type { LoginFailure } from '../../../types/loginFailure';
import type {
    LibraryAccountAuthPort,
    LibraryAccountClock,
    LibraryAccountLogger,
    LibraryLoginDiagnosticsEnvironment,
    LibraryLoginSelfCheck,
    LibraryTimerHandle,
} from './account.contract';
import { describeLoginError } from './accountRules';
import { resolveLoginSelfCheckVerdict } from './loginSelfCheckRules';
import { loginCaseOf, loginFailureFacts } from '../../../services/onlineMusic/login/loginFailureCase';
import {
    formatLoginDiagnosticReport,
    LOGIN_TIMELINE_LIMIT,
    type LoginTimelineEvent,
} from '../../../services/onlineMusic/login/loginDiagnosticReport';

// src/library/core/account/providerLoginSession.service.ts
// 一次登录（扫码，或者在浏览器里确认）从开始到结束，按固定的几步走，每一步都进时间线（同一条记录经日志端口打出）：
//   1. 能力判定：provider 没有 auth 能力就直接失败；
//   2. 开始：等上一轮的开始请求结算后才发（后端同一时间只允许一个码在建会话，并发的会被拒 409），等待期间又被
//      取代就不发；拿到 key 时已被取代，就把这把 key keyed 归还；
//   3. 就绪：显示二维码；在浏览器里确认的当场打开登录的页面（provider 自己打开的除外，打不开说是一种情况，登录接着等）；
//      声明了有效期的 provider 由前端计时（到期先停轮询并 keyed 取消，再报「已过期」）；
//   4. 轮询：上一次结算后 2 秒才发下一次，不会重叠。网络层的瞬时失败（transient，码在平台那边仍有效）连续
//      PROVIDER_LOGIN_TRANSIENT_POLL_LIMIT 次以内照常接着轮询，超过才算失败。扫过码、停在已扫码一分钟还没确认，
//      就当这一次没有确认、到期结束（平台不一定会自己报过期）；回到等待扫码就重新算；
//   5. 确认：会话已换成登录凭据，不再取消（后端要让在途轮询继续读到确认）；确认回调（读账号）返回 false
//      记为 account-refresh-failed；
//   6. 失败：停掉计时器，按事实分出是哪一种情况（services/onlineMusic/login/loginFailureCase），然后自动跑一次
//      主动自检（没扫码就过期的除外），结论放进快照，界面据此说明卡在哪一层。
// 代次：每次 start / stop / 到期都前进，每个 await 之后先验代次，晚到的结果作废。
// 时间线与日志里记平台的原话和抛出的错的那句话（原文）：报告会被原样贴进公开的 issue，界面已告知用户其中有哪些数据。
// 无 React、无 window、不直接碰 omni：auth 端口、时钟、诊断环境与日志出口都由调用方注入。

/** 两次轮询之间的间隔（上一个请求结算之后才开始计）。 */
export const PROVIDER_LOGIN_POLL_INTERVAL_MS = 2000;

/** 轮询连续遇到网络层瞬时失败时容忍的次数；超过才算登录失败。 */
export const PROVIDER_LOGIN_TRANSIENT_POLL_LIMIT = 2;

/**
 * 扫过码、停在已扫码这么久还没有确认，就当这一次没有确认、到期结束。平台不一定会自己报过期：2026-10-16
 * 的日志里，扫码之后平台一直回「已扫码」，3 分 46 秒里没有一次过期；确认只用了 2 秒。
 */
export const PROVIDER_LOGIN_SCANNED_LIMIT_MS = 60_000;

/** 生成诊断报告时最多等还在跑的自检多久（自检的每一项都有自己的超时，正常十秒内结束）。 */
const SELF_CHECK_REPORT_WAIT_MS = 15_000;

/** idle：还没开始过；loading：正在开始；其余是平台报的状态。 */
export type ProviderLoginSessionPhase = 'idle' | 'loading' | LoginState['state'];

/** 会话的原始状态。没有变化时保持对象身份（useSyncExternalStore 友好）。 */
export type ProviderLoginSessionSnapshot = Readonly<{
    /** 最近一次 start 领到的会话 id（每次开始都换新）；从没 start 过为 0。 */
    sessionId: number;
    /** 最近一次 start 的 provider；从没 start 过为 null。 */
    providerId: OnlineProviderId | null;
    methodId: string | null;
    phase: ProviderLoginSessionPhase;
    /** 在浏览器里确认的登录。 */
    inBrowser: boolean;
    /** 二维码图片地址；还没拿到、或者在浏览器里确认时为空串。 */
    codeImage: string;
    /** 这一次登录的页面能不能再打开一次（provider 自己打开的不能）。 */
    canReopenLoginPage: boolean;
    /** 诊断报告 `failure:` 那一行的形态；没扫就过期、auth 能力缺失都不算，为 null。 */
    failureKind: LoginFailureKind | null;
    /** 这一次为什么没有成功（见 contracts/account 的 LibraryLoginSessionSnapshot.failure）。 */
    failure: LoginFailure | null;
    /** 失败后的主动自检；没有失败或不需要自检时为 null。 */
    selfCheck: LibraryLoginSelfCheck | null;
}>;

/** 登录确认时交给确认回调的事件。 */
export type ProviderLoginConfirmedEvent = {
    sessionId: number;
    providerId: OnlineProviderId;
    methodId: string | null;
};

/**
 * 确认回调：确认后调用，用来读账号。resolve `false` 表示确认了却没拿到登录态，会话回到 error +
 * account-refresh-failed（没读到账号）；其余返回值都算完成。回调结算时会话代次已经变了（再次 start / stop），
 * 结果被丢弃。回调抛错也是没读到账号（报告里记为 check-error）。
 */
export type ProviderLoginConfirmedHandler = (
    event: ProviderLoginConfirmedEvent,
) => Promise<boolean | void> | boolean | void;

export type ProviderLoginSessionDeps = {
    auth: LibraryAccountAuthPort;
    clock: LibraryAccountClock;
    diagnostics: LibraryLoginDiagnosticsEnvironment;
    /** 省略时打到 console（前缀 [ProviderLogin]）。 */
    log?: LibraryAccountLogger;
    /** 省略时确认即完成（phase 停在 confirmed）。 */
    onConfirmed?: ProviderLoginConfirmedHandler;
};

/**
 * start 的回执：sessionId 同步可得（会话已经进入 loading）；settled 在开始请求结算后 resolve
 * （拿到二维码或开始了浏览器登录、失败或被取代），之后的进度只在快照里。
 */
export type ProviderLoginStartTicket = {
    sessionId: number;
    settled: Promise<void>;
};

export interface ProviderLoginSession {
    getSnapshot(): ProviderLoginSessionSnapshot;
    subscribe(listener: () => void): () => void;
    /**
     * 停掉上一轮（keyed 取消它的会话），换新的会话 id 并开始。methodId 是 provider 声明的登录方式；
     * 不传由 provider 取默认值。
     */
    start(providerId: OnlineProviderId, methodId?: string): ProviderLoginStartTicket;
    /**
     * 停轮询、清计时器、不再给还在计时的登录请求计时、keyed 取消当前会话（确认后的会话不取消）。
     * 不改阶段；只在等的时候才成立的那一种情况（浏览器没有打开）随之清掉。
     */
    stop(): void;
    /** 在浏览器里确认的登录：再打开一次登录的页面。回 false 表示没打开（或者此刻不能打开）。 */
    openLoginPage(): Promise<boolean>;
    /** 本轮时间线 + 自检 + provider 诊断；从没 start 过时为 null。自检还在跑时先等它（有上限）。 */
    buildDiagnosticReport(): Promise<string | null>;
    /** stop 并放掉全部订阅；之后的 start 不再生效。 */
    dispose(): void;
}

/** 默认日志出口。 */
export const consoleProviderLoginLogger: LibraryAccountLogger = (level, event, detail) => {
    console[level](`[ProviderLogin] ${event}`, detail);
};

// 记住活跃会话归谁：keyed 取消必须向开始会话的 provider 发，只存 key 就不知道该向谁取消。
type ActiveLoginSession = { providerId: OnlineProviderId; key: string };
type ScheduledTimer = { handle: LibraryTimerHandle };
/**
 * 一轮登录自己的进度（不进快照）：扫过没有、轮询了几次、连续瞬时失败几次、还在不在等结果
 * （会话建好之后是 true，读到确认、过期、出错，或者被停下之后是 false：浏览器打不开只在这段时间里算一种情况）。
 */
type RoundState = {
    sessionId: number;
    providerId: OnlineProviderId;
    methodId: string | undefined;
    inBrowser: boolean;
    scanned: boolean;
    polls: number;
    transientFailures: number;
    awaiting: boolean;
};

const INITIAL_SNAPSHOT: ProviderLoginSessionSnapshot = Object.freeze({
    sessionId: 0,
    providerId: null,
    methodId: null,
    phase: 'idle',
    inBrowser: false,
    codeImage: '',
    canReopenLoginPage: true,
    failureKind: null,
    failure: null,
    selfCheck: null,
});

const sameSnapshot = (a: ProviderLoginSessionSnapshot, b: ProviderLoginSessionSnapshot): boolean => (
    a.sessionId === b.sessionId
    && a.providerId === b.providerId
    && a.methodId === b.methodId
    && a.phase === b.phase
    && a.inBrowser === b.inBrowser
    && a.codeImage === b.codeImage
    && a.canReopenLoginPage === b.canReopenLoginPage
    && a.failureKind === b.failureKind
    && a.failure === b.failure
    && a.selfCheck === b.selfCheck
);

// 轮询报 error 时进时间线的字段：平台的原话、是否瞬时、平台说的码与 HTTP 状态和要求的等待。
const describeErrorState = (result: Extract<LoginState, { state: 'error' }>): Record<string, unknown> => ({
    message: result.message,
    transient: result.transient,
    httpStatus: result.failure?.httpStatus,
    retryAfterMs: result.failure?.retryAfterMs,
});

// provider 不在了（例如 mod 源刚被关掉）时问它的同步问题会抛错：当它说「不」。
const askSafely = (ask: () => boolean): boolean => {
    try {
        return ask();
    } catch {
        return false;
    }
};

/** 建一个登录会话；同一时间只有一轮在跑，再次 start 会先停掉上一轮。 */
export const createProviderLoginSession = (deps: ProviderLoginSessionDeps): ProviderLoginSession => {
    const { auth, clock, diagnostics, onConfirmed } = deps;
    const log = deps.log ?? consoleProviderLoginLogger;
    const listeners = new Set<() => void>();
    let snapshot = INITIAL_SNAPSHOT;
    // 代次：start / stop / 到期都前进；每个 await 之后先验代次。
    let generation = 0;
    // 最近一轮的时间线：失败时连同自检与 provider 的诊断一起生成报告。只保留一轮，重新开始即清空。
    let timeline: LoginTimelineEvent[] = [];
    let meta: { providerId: OnlineProviderId | null; methodId: string | null; startedAt: number } = {
        providerId: null,
        methodId: null,
        startedAt: 0,
    };
    let checkTimer: ScheduledTimer | null = null;
    let ttlTimer: ScheduledTimer | null = null;
    let scannedTimer: ScheduledTimer | null = null;
    let activeSession: ActiveLoginSession | null = null;
    let currentRound: RoundState | null = null;
    // 还在路上的开始请求（不论结果都会结算）。新一轮开始前先等它，同一时间只让一个开始请求到后端。
    let pendingCreate: Promise<void> | null = null;
    // 这一轮还在跑的自检：生成报告时先等它。
    let pendingSelfCheck: { sessionId: number; done: Promise<void> } | null = null;
    let lastLoggedPhase: ProviderLoginSessionPhase = 'idle';
    let disposed = false;

    const update = (patch: Partial<ProviderLoginSessionSnapshot>): void => {
        const next = { ...snapshot, ...patch };
        if (sameSnapshot(snapshot, next)) return;
        snapshot = next;
        for (const listener of [...listeners]) listener();
    };

    const schedule = (callback: () => void, ms: number): ScheduledTimer => ({ handle: clock.setTimeout(callback, ms) });

    const clearTimer = (timer: ScheduledTimer | null): null => {
        if (timer) clock.clearTimeout(timer.handle);
        return null;
    };

    const clearRoundTimers = (): void => {
        checkTimer = clearTimer(checkTimer);
        ttlTimer = clearTimer(ttlTimer);
        scannedTimer = clearTimer(scannedTimer);
    };

    const isCurrent = (round: RoundState): boolean => round.sessionId === generation;

    // 同一条记录既进时间线，也经日志端口打出（打包版可在开发者设置的日志面板里看到）。
    const note = (event: string, detail: Record<string, unknown> = {}, level: 'info' | 'warn' = 'info'): void => {
        const at = clock.now();
        const entry = { at, event, detail: { ...detail, elapsedMs: at - meta.startedAt } };
        timeline = [...timeline, entry].slice(-LOGIN_TIMELINE_LIMIT);
        log(level, event, { providerId: meta.providerId, ...entry.detail });
    };

    // 一次没有成功的登录：事实、按事实分出的情况、发生的时刻。
    const failureAt = (
        round: RoundState,
        step: LoginStep,
        source?: Parameters<typeof loginFailureFacts>[1],
    ): LoginFailure => {
        const facts = loginFailureFacts({ step, inBrowser: round.inBrowser, scanned: round.scanned }, source);
        return { case: loginCaseOf(facts), facts, at: clock.now() };
    };

    // 取消是 keyed 的，只放掉自己这一把 key；全局清空会在多客户端场景下杀掉别人正在手机上确认的会话。
    // Fire-and-forget：关窗时不该等后端回话，取消失败最多留下一个会自己过期的会话。
    const releaseSession = (session: ActiveLoginSession | null): void => {
        if (!session) return;
        const logCancelError = (error: unknown) => {
            log('warn', 'cancel:error', { providerId: session.providerId, ...describeLoginError(error) });
        };
        try {
            void Promise.resolve(auth.cancelLogin(session.providerId, session.key)).catch(logCancelError);
        } catch (error) {
            logCancelError(error);
        }
    };

    const stop = (): void => {
        generation += 1;
        clearRoundTimers();
        // 此刻还在计时的登录请求不再计时：没有人等它们的结果了。
        auth.dropRequestLimits();
        releaseSession(activeSession);
        activeSession = null;
        if (currentRound) currentRound.awaiting = false;
        // 只在等的时候才成立的那一种情况（浏览器没有打开）随停下清掉；结束了的登录的失败留着。
        if (snapshot.failure?.facts.step === 'open') update({ failure: null });
    };

    // ─── 第 6 步：失败后的主动自检 ─────────────────────────────────────

    // 结果按会话 id 认领（而不是代次）：失败后关窗、到期都会推进代次，但这一轮的结论仍属于这一轮；
    // 只有新的 start 换了会话 id 才作废。
    const runSelfCheck = (sessionId: number, providerId: OnlineProviderId): void => {
        if (!askSafely(() => auth.canRunLoginSelfCheck(providerId))) return;
        update({ selfCheck: { status: 'running' } });
        note('self-check:start');
        const done = (async () => {
            let selfCheck: LibraryLoginSelfCheck | null;
            try {
                const result = await auth.runLoginSelfCheck(providerId);
                if (snapshot.sessionId !== sessionId) return;
                if (!result) {
                    selfCheck = null;
                    note('self-check', { result: 'nothing to check' });
                } else {
                    const verdict = resolveLoginSelfCheckVerdict(result);
                    selfCheck = { status: 'done', result, verdict };
                    note('self-check', {
                        verdict: verdict.kind,
                        detail: verdict.detail ?? undefined,
                        proxy: verdict.proxy ?? undefined,
                        durationMs: result.durationMs,
                    }, verdict.kind === 'network-ok' ? 'info' : 'warn');
                }
            } catch (error) {
                if (snapshot.sessionId !== sessionId) return;
                const described = describeLoginError(error);
                selfCheck = { status: 'failed', message: String(described.message ?? described.name) };
                note('self-check:error', described, 'warn');
            }
            update({ selfCheck });
        })();
        pendingSelfCheck = { sessionId, done };
    };

    /** 进入失败：停计时器，记下形态与情况；有失败形态的（没扫码就过期不算），自动跑一次自检。 */
    const fail = (
        round: RoundState,
        phase: 'error' | 'expired',
        failureKind: LoginFailureKind | null,
        failure: LoginFailure,
    ): void => {
        // 先把计时器收掉，再说是哪一种情况：不会留下一个到点把状态改成过期的计时器。
        clearRoundTimers();
        round.awaiting = false;
        update({ phase, failureKind, failure });
        if (failureKind !== null) runSelfCheck(round.sessionId, round.providerId);
    };

    // 前端计时到点：有效期到了（'ttl'），或者停在已扫码太久（'scanned'）。先停轮询并取消会话，再报「已过期」。
    const expire = (round: RoundState, source: 'ttl' | 'scanned'): void => {
        note('state', { state: 'expired', source, scanned: round.scanned, polls: round.polls });
        stop();
        fail(round, 'expired', round.scanned ? 'expired-after-scan' : null, failureAt(round, 'wait'));
    };

    // ─── 第 5 步：确认 ─────────────────────────────────────────────────

    const confirm = async (round: RoundState): Promise<void> => {
        clearRoundTimers();
        round.awaiting = false;
        // 会话已经换成登录凭据，不该再取消：后端要让在途的轮询继续读到确认。
        activeSession = null;
        // 确认了：之前「浏览器没有打开」的那种情况不再成立。
        update({ phase: 'confirmed', failure: null, failureKind: null });
        let completed: boolean | void;
        try {
            completed = onConfirmed
                ? await onConfirmed({ sessionId: round.sessionId, providerId: round.providerId, methodId: round.methodId ?? null })
                : undefined;
        } catch (error) {
            if (!isCurrent(round)) return;
            // 读账号这一步抛了错：报告里照旧记为 check-error，窗口说的是没读到账号（停在 account 这一步）。
            note('check:error', { polls: round.polls, scanned: round.scanned, ...describeLoginError(error) }, 'warn');
            fail(round, 'error', 'check-error', failureAt(round, 'account', { error }));
            return;
        }
        if (!isCurrent(round)) return;
        note('complete', { completed: completed !== false }, completed === false ? 'warn' : 'info');
        if (completed === false) fail(round, 'error', 'account-refresh-failed', failureAt(round, 'account'));
    };

    // ─── 第 4 步：轮询 ─────────────────────────────────────────────────

    const scheduleNextPoll = (round: RoundState, key: string): void => {
        checkTimer = schedule(() => { void poll(round, key); }, PROVIDER_LOGIN_POLL_INTERVAL_MS);
    };

    const handlePollResult = async (round: RoundState, key: string, result: LoginState): Promise<void> => {
        if (result.state === 'error' && result.transient && round.transientFailures < PROVIDER_LOGIN_TRANSIENT_POLL_LIMIT) {
            // 没拿到平台的回答，码在平台那边仍然有效：界面保持原样，接着轮询。
            round.transientFailures += 1;
            note('poll:retry', { polls: round.polls, attempt: round.transientFailures, ...describeErrorState(result) }, 'warn');
            scheduleNextPoll(round, key);
            return;
        }
        round.transientFailures = 0;
        if (result.state === 'scanned') round.scanned = true;
        if (lastLoggedPhase !== result.state) {
            lastLoggedPhase = result.state;
            note('state', {
                state: result.state,
                polls: round.polls,
                ...(result.state === 'error' ? describeErrorState(result) : {}),
            }, result.state === 'error' ? 'warn' : 'info');
        }

        switch (result.state) {
            case 'waiting':
            case 'scanned':
                update({ phase: result.state });
                // 停在已扫码的计时从第一次读到已扫码算起；回到等待扫码（可以再扫一次）就作废，再扫码时重新算。
                if (result.state === 'scanned' && scannedTimer === null) {
                    scannedTimer = schedule(() => {
                        scannedTimer = null;
                        if (isCurrent(round)) expire(round, 'scanned');
                    }, PROVIDER_LOGIN_SCANNED_LIMIT_MS);
                } else if (result.state === 'waiting') {
                    scannedTimer = clearTimer(scannedTimer);
                }
                scheduleNextPoll(round, key);
                return;
            case 'confirmed':
                await confirm(round);
                return;
            case 'expired':
                // 扫过码之后才过期，多半是手机端的确认被拒了，要当失败处理。
                fail(round, 'expired', round.scanned ? 'expired-after-scan' : null, failureAt(round, 'wait', { detail: result.failure }));
                return;
            case 'error':
                fail(round, 'error', 'check-error', failureAt(round, 'check', { detail: result.failure }));
                return;
        }
    };

    // 串行轮询：上一个 check 结算之后才排下一次，不会重叠。
    const poll = async (round: RoundState, key: string): Promise<void> => {
        if (!isCurrent(round)) return;
        let result: LoginState;
        try {
            round.polls += 1;
            result = await auth.checkLogin(round.providerId, key);
        } catch (error) {
            if (!isCurrent(round)) return;
            note('check:error', { polls: round.polls, scanned: round.scanned, ...describeLoginError(error) }, 'warn');
            fail(round, 'error', 'check-error', failureAt(round, 'check', { error }));
            return;
        }
        if (!isCurrent(round)) return;
        await handlePollResult(round, key, result);
    };

    // ─── 第 3 步：就绪 ─────────────────────────────────────────────────

    // 只有声明了这一次登录有效期的 provider 才由前端计时；其余仍旧等平台把过期报上来。
    const armTtl = (round: RoundState): void => {
        const ttlMs = auth.getLoginTtlMs(round.providerId);
        if (ttlMs === null) return;
        ttlTimer = schedule(() => {
            ttlTimer = null;
            if (isCurrent(round)) expire(round, 'ttl');
        }, ttlMs);
    };

    // 浏览器打不开：登录还在等，阶段不变，只把「浏览器没有打开」交出去；已经有别的失败时不盖掉它。
    // 这一轮已经确认、结束或被停下了，这一种情况就不成立，什么都不设。
    const noteOpenPageFailure = (round: RoundState, error: unknown): void => {
        if (!isCurrent(round)) {
            // 这时已经换了一次登录：这个错不是现在这一次的，不进它的时间线，只留一行日志。
            log('warn', 'open-page:error (an earlier sign-in)', { providerId: round.providerId, ...describeLoginError(error) });
            return;
        }
        note('open-page:error', describeLoginError(error), 'warn');
        if (round.awaiting && !snapshot.failure) update({ failure: failureAt(round, 'open', { error }) });
    };

    // ─── 第 2 步：开始 ─────────────────────────────────────────────────

    /** 发出开始请求并登记为在途；同步抛错由调用方按 start-error 处理，此时没有在途请求，不必登记。 */
    const requestStart = (round: RoundState): Promise<{ key: string; imageUrl: string }> => {
        const request = Promise.resolve(auth.startLogin(round.providerId, round.methodId));
        const settledRequest = request.then(() => undefined, () => undefined);
        pendingCreate = settledRequest;
        void settledRequest.then(() => {
            if (pendingCreate === settledRequest) pendingCreate = null;
        });
        return request;
    };

    // ─── 一轮登录 ─────────────────────────────────────────────────────

    const run = async (round: RoundState): Promise<void> => {
        note('start', { methodId: round.methodId });
        // 第 1 步：能力判定。
        if (!askSafely(() => Boolean(auth.getProviderCapabilities(round.providerId).auth))) {
            update({ phase: 'error', failure: failureAt(round, 'start') });
            return;
        }

        let started: { key: string; imageUrl: string };
        try {
            if (pendingCreate) {
                await pendingCreate;
                // 等的时候又被更新的 start（或 stop）取代：这一轮不再开始，交给更新的那一轮。
                if (!isCurrent(round)) return;
            }
            started = await requestStart(round);
        } catch (error) {
            if (!isCurrent(round)) return;
            note('start:error', describeLoginError(error), 'warn');
            fail(round, 'error', 'start-error', failureAt(round, 'start', { error }));
            return;
        }
        if (!isCurrent(round)) {
            // 这一轮已被更新的 start（或 stop）取代（例如连点刷新）：把刚拿到的会话还回去，
            // 否则它会一直占着后端直到过期。
            releaseSession({ providerId: round.providerId, key: started.key });
            return;
        }

        activeSession = { providerId: round.providerId, key: started.key };
        round.awaiting = true;
        const opensItself = askSafely(() => auth.opensLoginPageItself(round.providerId, started.key));
        update({ codeImage: started.imageUrl, phase: 'waiting', canReopenLoginPage: !opensItself });
        lastLoggedPhase = 'waiting';
        note('ready');
        // 没有东西要先看：登录一开始就把浏览器打开（provider 自己已经打开的除外）。
        if (round.inBrowser && !opensItself) {
            void Promise.resolve()
                .then(() => auth.openLoginPage(round.providerId, started.key))
                .catch(error => noteOpenPageFailure(round, error));
        }
        armTtl(round);
        scheduleNextPoll(round, started.key);
    };

    const start = (providerId: OnlineProviderId, methodId?: string): ProviderLoginStartTicket => {
        if (disposed) return { sessionId: snapshot.sessionId, settled: Promise.resolve() };
        stop();
        const sessionId = generation;
        const inBrowser = askSafely(() => auth.confirmsLoginInBrowser(providerId));
        timeline = [];
        meta = { providerId, methodId: methodId ?? null, startedAt: clock.now() };
        lastLoggedPhase = 'loading';
        pendingSelfCheck = null;
        update({
            sessionId,
            providerId,
            methodId: methodId ?? null,
            phase: 'loading',
            inBrowser,
            codeImage: '',
            canReopenLoginPage: true,
            failureKind: null,
            failure: null,
            selfCheck: null,
        });
        const round: RoundState = {
            sessionId,
            providerId,
            methodId,
            inBrowser,
            scanned: false,
            polls: 0,
            transientFailures: 0,
            awaiting: false,
        };
        currentRound = round;
        return { sessionId, settled: run(round) };
    };

    // 在浏览器里确认的登录：让 provider 在系统浏览器里把登录的页面再打开一次。
    const openLoginPage = async (): Promise<boolean> => {
        const session = activeSession;
        const round = currentRound;
        if (!session || !round || !round.inBrowser || !isCurrent(round)) return false;
        try {
            await auth.openLoginPage(session.providerId, session.key);
        } catch (error) {
            noteOpenPageFailure(round, error);
            return false;
        }
        // 这一次打开了：在「打开」这一步记下的那一条不再成立（不管 provider 给它点了什么名），别的失败不动。
        if (isCurrent(round) && snapshot.failure?.facts.step === 'open') update({ failure: null });
        return true;
    };

    // 等还在跑的自检（属于当前会话的那个），最多等 SELF_CHECK_REPORT_WAIT_MS。
    const waitForSelfCheck = async (): Promise<void> => {
        const pending = pendingSelfCheck;
        if (!pending || pending.sessionId !== snapshot.sessionId) return;
        let timer: ScheduledTimer | null = null;
        await Promise.race([
            pending.done,
            new Promise<void>(resolve => { timer = schedule(resolve, SELF_CHECK_REPORT_WAIT_MS); }),
        ]);
        clearTimer(timer);
    };

    // 生成可以直接贴进 issue 的诊断报告：本轮时间线 + 窗口显示的情况 + 自检 + provider 自己的诊断。
    const buildDiagnosticReport = async (): Promise<string | null> => {
        const { providerId, methodId } = meta;
        if (providerId === null) return null;
        await waitForSelfCheck();
        return formatLoginDiagnosticReport({
            generatedAt: clock.now(),
            appVersion: diagnostics.appVersion,
            userAgent: diagnostics.userAgent,
            build: diagnostics.build ?? null,
            origin: diagnostics.origin ?? null,
            providerId,
            methodId,
            failure: snapshot.failureKind,
            loginFailure: snapshot.failure,
            timeline,
            selfCheck: snapshot.selfCheck,
            providerLines: await auth.getLoginDiagnostics(providerId),
        });
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        start,
        stop,
        openLoginPage,
        buildDiagnosticReport,
        dispose: () => {
            stop();
            disposed = true;
            listeners.clear();
        },
    };
};
