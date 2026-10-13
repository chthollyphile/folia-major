import { OnlineProviderError, type OnlineProviderId, type ProviderErrorCode } from '../../types/onlineMusic';
import type { PlaybackFailure, PlaybackFailureReason, PlaybackFailureStage } from '../../types/playbackFailure';

// src/services/playbackRecovery/onlinePlaybackFailure.ts
// 把一次播放请求的失败（OmniError、普通异常、空 URL、媒体元素错误）归一成 PlaybackFailure。
// 纯函数：不读 store、不写缓存。只有 code 为 'taken-down' 才可能得到 taken-down。

export interface PlaybackFailureClassifyContext {
    stage: PlaybackFailureStage;
    providerId?: OnlineProviderId;
    /** 请求发出之前的账号快照（useOnlineProviderAccountStore.accounts[providerId]）；鉴权失败后 transport 可能已清理会话，事后读会失真。 */
    account?: { status?: 'unknown' | 'authenticated' | 'anonymous' | 'error'; error?: string };
}

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

const FETCH_FAILURE_MESSAGE = /Failed to fetch|NetworkError|Load failed|fetch failed/i;

const RATE_LIMIT_CARRIER_CODES: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>(['network', 'service-unavailable', 'unavailable']);

// 去掉值为 undefined 的字段，让诊断对象只留下真实存在的证据。
const compact = <T extends object>(value: T): T => (
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
);

// auth-required 的拆分：adapter 给出的 details.auth 优先；否则看请求前的账号快照，
// 曾经持有会话（authenticated / error，或上次就是鉴权失败）才算“已失效”，其余一律按“未登录”。
const resolveAuthReason = (
    error: OnlineProviderError,
    account: PlaybackFailureClassifyContext['account'],
): PlaybackFailureReason => {
    if (error.details?.auth === 'signed-out') return 'not-signed-in';
    if (error.details?.auth === 'expired') return 'session-expired';
    if (account?.status === 'authenticated' || account?.status === 'error' || account?.error === 'auth-required') {
        return 'session-expired';
    }
    return 'not-signed-in';
};

// network code 的细分：带 upstreamCode 说明上游有应答（业务拒绝），其余按 HTTP 状态区分。
const resolveNetworkReason = (error: OnlineProviderError): PlaybackFailureReason => {
    if (error.details?.upstreamCode !== undefined) return 'unknown';
    const status = error.httpStatus;
    if (status === 504) return 'timeout';
    if (typeof status === 'number' && status >= 500) return 'service-unavailable';
    if (typeof status === 'number' && status >= 400 && status < 500) return 'invalid-response';
    return 'network';
};

const isRateLimitedProviderError = (error: OnlineProviderError): boolean => (
    error.code === 'rate-limited'
    || (RATE_LIMIT_CARRIER_CODES.has(error.code)
        && (error.httpStatus === 429 || (typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0)))
);

// 把 OmniError 的 code（加上 HTTP 状态与账号快照）映射到播放失败原因；switch 穷举 ProviderErrorCode。
const resolveProviderErrorReason = (
    error: OnlineProviderError,
    account: PlaybackFailureClassifyContext['account'],
): PlaybackFailureReason => {
    if (isRateLimitedProviderError(error)) return 'rate-limited';

    const code: ProviderErrorCode = error.code;
    switch (code) {
        case 'auth-required':
            return resolveAuthReason(error, account);
        case 'network':
            return resolveNetworkReason(error);
        case 'timeout':
            return 'timeout';
        case 'unavailable':
        case 'service-unavailable':
            return 'service-unavailable';
        case 'invalid-response':
            return 'invalid-response';
        case 'rate-limited':
            return 'rate-limited';
        case 'preview-only':
        case 'region-restricted':
        case 'membership-required':
        case 'purchase-required':
        case 'entitlement-required':
        case 'taken-down':
            return code;
        case 'not-playable':
        case 'unsupported':
        case 'not-public':
            return 'unknown';
        default: {
            const exhaustive: never = code;
            return exhaustive;
        }
    }
};

const isTimeoutDomException = (error: unknown): boolean => (
    typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && error.name === 'TimeoutError'
);

/** 把一次音源请求抛出的异常归一成 PlaybackFailure；按顺序匹配，先命中先返回。 */
export const classifyPlaybackError = (error: unknown, ctx: PlaybackFailureClassifyContext): PlaybackFailure => {
    if (error instanceof OnlineProviderError) {
        const details = error.details;
        return compact<PlaybackFailure>({
            reason: resolveProviderErrorReason(error, ctx.account),
            stage: ctx.stage,
            providerId: error.providerId ?? ctx.providerId,
            providerCode: error.code,
            providerStage: details?.stage,
            upstreamCode: details?.upstreamCode,
            httpStatus: error.httpStatus,
            retryAfterMs: error.retryAfterMs,
            transient: details?.transient,
            hint: details?.signInMayHelp ? 'sign-in-may-help' : undefined,
            attempts: details?.attempts,
            message: error.message,
            cause: error,
        });
    }

    if (isTimeoutDomException(error)) {
        return compact<PlaybackFailure>({
            reason: 'timeout',
            stage: ctx.stage,
            providerId: ctx.providerId,
            message: (error as DOMException).message,
            cause: error,
        });
    }

    if (error instanceof TypeError && FETCH_FAILURE_MESSAGE.test(error.message)) {
        return compact<PlaybackFailure>({
            reason: 'network',
            stage: ctx.stage,
            providerId: ctx.providerId,
            message: error.message,
            cause: error,
        });
    }

    return compact<PlaybackFailure>({
        reason: 'unknown',
        stage: ctx.stage,
        providerId: ctx.providerId,
        message: error instanceof Error ? error.message : (typeof error === 'string' ? error : undefined),
        cause: error,
    });
};

/** provider 没抛错却没给出可用 URL：空值证据不足（unknown），给了但不安全的 URL 是形态错误（invalid-response）。 */
export const classifyMissingAudioUrl = (
    rawUrl: string | null | undefined,
    ctx: PlaybackFailureClassifyContext,
): PlaybackFailure => {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
        return compact<PlaybackFailure>({
            reason: 'unknown',
            stage: ctx.stage,
            providerId: ctx.providerId,
            providerStage: 'no-source',
        });
    }
    return compact<PlaybackFailure>({
        reason: 'invalid-response',
        stage: ctx.stage,
        providerId: ctx.providerId,
    });
};

/**
 * 媒体元素的错误码：1（aborted）返回 null 表示不处理；2 是网络；3 / 4（解码 / 格式）以及其他都证据不足。
 * 3 / 4 只有在刷新 URL 后仍失败时才会走到这里。
 */
export const classifyMediaPlaybackFailure = (
    mediaErrorCode: number | null,
    ctx: { providerId?: OnlineProviderId },
): PlaybackFailure | null => {
    if (mediaErrorCode === MEDIA_ERR_ABORTED) return null;
    const isDecodeOrFormat = mediaErrorCode === MEDIA_ERR_DECODE || mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED;
    return compact<PlaybackFailure>({
        reason: mediaErrorCode === MEDIA_ERR_NETWORK ? 'network' : 'unknown',
        stage: 'media-element',
        providerId: ctx.providerId,
        mediaErrorCode: isDecodeOrFormat ? mediaErrorCode : undefined,
    });
};

/** 暂时性失败：等一会儿或换个网络可能就好，不该跳歌。 */
export const isTransientPlaybackFailure = (failure: PlaybackFailure): boolean => (
    failure.reason === 'network'
    || failure.reason === 'timeout'
    || failure.reason === 'service-unavailable'
    || failure.reason === 'rate-limited'
);
