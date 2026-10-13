import {
    OnlineProviderError,
    type OnlineProviderErrorDetails,
    type OnlineProviderId,
    type ProviderAuthState,
    type ProviderErrorCode,
    type ProviderPlaybackAttempt,
} from '../../types/onlineMusic';

// src/services/onlineMusic/playbackAttempts.ts
// adapter 内多次音源请求（不同音质 / 变体 / 接口）的记录与汇总，供酷狗和 QQ 共用。
// 任意一次拿到合法 URL 就直接返回音源，不进这里；全部失败后由 summarizePlaybackAttempts 给出一个有证据的结论。

type AttemptExtra = Omit<Partial<ProviderPlaybackAttempt>, 'stage' | 'outcome'>;

type AttemptCategory = 'session' | 'throttle' | 'service-missing' | 'timeout' | 'transient' | 'refusal' | 'unproven';

export type AttemptChainDecision = 'continue' | 'stop-chain' | 'stop-all';

const REFUSAL_CODES: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
    'membership-required',
    'purchase-required',
    'entitlement-required',
    'preview-only',
    'region-restricted',
    'taken-down',
]);

// attemptFromError 记下的原始错误：尝试本身不带 details.auth，汇总 session 结论时从这里取回。
const attemptSourceErrors = new WeakMap<ProviderPlaybackAttempt, OnlineProviderError>();

const compact = <T extends object>(value: T): T => (
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
);

const hasRetryAfter = (attempt: ProviderPlaybackAttempt): boolean => (
    typeof attempt.retryAfterMs === 'number' && attempt.retryAfterMs > 0
);

/** 服务有应答但没给 URL 的一次尝试。 */
export const emptyAttempt = (stage: string, extra?: AttemptExtra): ProviderPlaybackAttempt => compact({
    ...compact(extra ?? {}),
    stage,
    outcome: 'empty' as const,
});

/** 抛错的一次尝试：拷贝 code / httpStatus / retryAfterMs / details.upstreamCode / details.transient / message。 */
export const attemptFromError = (stage: string, error: unknown, extra?: AttemptExtra): ProviderPlaybackAttempt => {
    const providerError = error instanceof OnlineProviderError ? error : null;
    const attempt: ProviderPlaybackAttempt = compact({
        code: providerError?.code,
        httpStatus: providerError?.httpStatus,
        retryAfterMs: providerError?.retryAfterMs,
        upstreamCode: providerError?.details?.upstreamCode,
        transient: providerError?.details?.transient,
        detail: error instanceof Error ? error.message : (typeof error === 'string' ? error : undefined),
        ...compact(extra ?? {}),
        stage,
        outcome: 'error' as const,
    });
    if (providerError) attemptSourceErrors.set(attempt, providerError);
    return attempt;
};

// network 带 4xx（429 已在 throttle 判掉）：请求有应答，只是形态不可用。分类器把它读作 invalid-response（§2），不算暂时性失败。
const isAnsweredClientError = (attempt: ProviderPlaybackAttempt): boolean => (
    attempt.code === 'network'
    && typeof attempt.httpStatus === 'number' && attempt.httpStatus >= 400 && attempt.httpStatus < 500
);

// 按 §4 的优先级给一次尝试归类；先命中先返回。
const categorizeAttempt = (attempt: ProviderPlaybackAttempt): AttemptCategory => {
    const { code, httpStatus } = attempt;
    if (code === 'auth-required') return 'session';
    if (code === 'rate-limited' || httpStatus === 429 || hasRetryAfter(attempt)) return 'throttle';
    if (code === 'unavailable' || (code === 'service-unavailable' && attempt.transient === false) || httpStatus === 501) {
        return 'service-missing';
    }
    if (code === 'timeout' || httpStatus === 504) return 'timeout';
    if (isAnsweredClientError(attempt)) return 'unproven';
    if ((code === 'network' && attempt.upstreamCode === undefined)
        || code === 'service-unavailable'
        || (typeof httpStatus === 'number' && httpStatus >= 500)) {
        return 'transient';
    }
    if (code && REFUSAL_CODES.has(code)) return 'refusal';
    return 'unproven';
};

/** 这次尝试之后还要不要继续：鉴权和超时停掉同一接口的其余档位，限流和服务缺失立即结束全部尝试。 */
export const attemptChainDecision = (attempt: ProviderPlaybackAttempt): AttemptChainDecision => {
    switch (categorizeAttempt(attempt)) {
        case 'session':
        case 'timeout':
            return 'stop-chain';
        case 'throttle':
        case 'service-missing':
            return 'stop-all';
        default:
            return 'continue';
    }
};

type TransientSeverity = 'network' | 'timeout' | 'service-unavailable';

const TRANSIENT_SEVERITY_RANK: Record<TransientSeverity, number> = {
    network: 0,
    timeout: 1,
    'service-unavailable': 2,
};

const transientSeverityOf = (attempt: ProviderPlaybackAttempt, category: AttemptCategory): TransientSeverity => {
    if (category === 'timeout') return 'timeout';
    if (attempt.code === 'service-unavailable' || (typeof attempt.httpStatus === 'number' && attempt.httpStatus >= 500)) {
        return 'service-unavailable';
    }
    return 'network';
};

const authStateOf = (attempt: ProviderPlaybackAttempt, lastError: unknown): ProviderAuthState | undefined => {
    const source = attemptSourceErrors.get(attempt);
    if (source?.details?.auth) return source.details.auth;
    if (lastError instanceof OnlineProviderError && lastError.code === 'auth-required') return lastError.details?.auth;
    return undefined;
};

type AttemptConclusion = {
    code: ProviderErrorCode;
    httpStatus?: number;
    retryAfterMs?: number;
    transient?: boolean;
    auth?: ProviderAuthState;
};

/**
 * 按优先级得出结论：session > throttle > service-missing > 暂时性失败（service-unavailable > timeout > network）
 * > 由最后一次尝试决定（refusal 原样、全部 invalid-response 取 invalid-response、否则 not-playable）。
 * 前面档位的 refusal 只留在 attempts 里，不升级结论。
 * 带 4xx 的 network 算有应答的尝试（与 invalid-response 同类），交给最后一次尝试决定，不算暂时性失败。
 */
const concludeAttempts = (attempts: readonly ProviderPlaybackAttempt[], lastError: unknown): AttemptConclusion => {
    if (attempts.length === 0) return { code: 'invalid-response' };
    const categorized = attempts.map(attempt => ({ attempt, category: categorizeAttempt(attempt) }));

    const session = categorized.find(entry => entry.category === 'session');
    if (session) {
        return { code: 'auth-required', httpStatus: session.attempt.httpStatus, auth: authStateOf(session.attempt, lastError) };
    }

    const throttles = categorized.filter(entry => entry.category === 'throttle');
    if (throttles.length > 0) {
        const retryAfterMs = attempts.reduce<number | undefined>((max, attempt) => (
            hasRetryAfter(attempt) ? Math.max(max ?? 0, attempt.retryAfterMs as number) : max
        ), undefined);
        const decisive = throttles.find(entry => entry.attempt.retryAfterMs === retryAfterMs) ?? throttles[0];
        return { code: 'rate-limited', httpStatus: decisive.attempt.httpStatus, retryAfterMs };
    }

    const missing = categorized.find(entry => entry.category === 'service-missing');
    if (missing) {
        return {
            code: 'unavailable',
            httpStatus: missing.attempt.httpStatus,
            transient: attempts.some(attempt => attempt.transient === false) ? false : undefined,
        };
    }

    let decisive: { attempt: ProviderPlaybackAttempt; severity: TransientSeverity } | null = null;
    for (const entry of categorized) {
        if (entry.category !== 'transient' && entry.category !== 'timeout') continue;
        const severity = transientSeverityOf(entry.attempt, entry.category);
        if (!decisive || TRANSIENT_SEVERITY_RANK[severity] > TRANSIENT_SEVERITY_RANK[decisive.severity]) {
            decisive = { attempt: entry.attempt, severity };
        }
    }
    if (decisive) return { code: decisive.severity, httpStatus: decisive.attempt.httpStatus };

    const last = attempts[attempts.length - 1];
    if (last.code && REFUSAL_CODES.has(last.code)) return { code: last.code, httpStatus: last.httpStatus };
    if (attempts.every(attempt => attempt.code === 'invalid-response' || isAnsweredClientError(attempt))) return { code: 'invalid-response' };
    return { code: 'not-playable' };
};

/** 全部尝试失败后的汇总错误；details.attempts 留作诊断，调用方只读 code / httpStatus / retryAfterMs / details。 */
export const summarizePlaybackAttempts = (
    providerId: OnlineProviderId,
    attempts: readonly ProviderPlaybackAttempt[],
    options?: { lastError?: unknown; signInMayHelp?: boolean },
): OnlineProviderError => {
    const conclusion = concludeAttempts(attempts, options?.lastError);
    const details: OnlineProviderErrorDetails = compact({
        stage: 'audio-source',
        attempts,
        auth: conclusion.auth,
        signInMayHelp: options?.signInMayHelp,
        transient: conclusion.transient,
    });
    return new OnlineProviderError(
        conclusion.code,
        `All ${providerId} playback attempts failed (${conclusion.code})`,
        providerId,
        options?.lastError,
        conclusion.httpStatus,
        conclusion.retryAfterMs,
        details,
    );
};
