import type { OnlineFailureCaseId } from '../../../types/onlineMusic';
import { omni } from '../omni';
import type { OnlineFailure } from './onlineFailureCase';

// src/services/onlineMusic/failure/onlineFailureTexts.ts
// 一次失败给用的人看的三部分：标题（发生了什么，带平台的名字）、该做什么、平台的原话。每一种情况的标题和
// 该做什么都是 i18n key，少写一种情况，编译不过。标题和登录失败的说法一样，但是另起的 key：登录的话改了，
// 播放的话不跟着动。

type Translate = (key: string, values?: Record<string, string | number>) => string;

// 没有 `title` 的说这种请求「失败」。`title` 里有 {{provider}} 的（NAMES_PROVIDER），不知道平台时说 `bare`，
// 没写 `bare` 也说「失败」。
const TEXTS: Record<OnlineFailureCaseId, { title?: string; bare?: string; note?: string; bareNote?: string }> = {
    unreachable: { title: 'failure.unreachable', note: 'failure.noteCheckNetwork' },
    'local-service-stopped': { title: 'failure.localServiceStopped', note: 'failure.noteRestartApp' },
    // 标题自己就说了该做什么；不知道是哪个平台时标题只剩「播放失败」，才要这一句。
    'retry-later': { title: 'failure.retryLater', bareNote: 'failure.noteRetryLater' },
    'sign-in-needed': { title: 'failure.signInNeeded', bare: 'status.loginExpired', note: 'failure.noteSignIn' },
    // 这几句自己就说了该做什么。
    'subscription-required': { title: 'status.songSubscriptionRequired', bare: 'status.loginExpired' },
    'purchase-required': { title: 'status.songPurchaseRequired' },
    'entitlement-required': { title: 'status.songEntitlementRequired' },
    'preview-only': { title: 'status.songPreviewOnly' },
    'region-restricted': { title: 'status.songRegionRestricted' },
    'not-configured': { title: 'status.songServiceNotConfigured' },
    'taken-down': { title: 'status.songUnavailable' },
    'no-audio': { title: 'failure.noAudio' },
    'audio-unplayable': { title: 'failure.audioUnplayable' },
    'not-public': { title: 'playlist.loadNotPublic' },
    refused: { title: 'failure.refused', note: 'failure.noteRetryLater' },
    unknown: { note: 'failure.noteUnknown' },
};

// 标题里要填平台名字的几种。
const NAMES_PROVIDER = new Set<OnlineFailureCaseId>(['unreachable', 'local-service-stopped', 'retry-later', 'sign-in-needed', 'subscription-required', 'no-audio', 'refused']);

// 发出请求时没有登录的账号：说登录后才能播放，不说登录已失效，也不说「重新」登录。
const SIGNED_OUT = { title: 'failure.signInRequired', bare: 'status.songLoginRequired' };

// 平台要求等多久而知道是几秒时说出秒数。
const WAIT_TITLE = { title: 'failure.retryLaterIn', bare: 'status.songRateLimited' };

// 平台透出来的「可能」的原因，说在该做什么那一行。
const LIKELY_NOTES = {
    'sign-in': 'failure.noteMaybeSignIn',
    subscription: 'failure.noteMaybeSubscription',
    region: 'failure.noteMaybeRegion',
    copyright: 'failure.noteMaybeCopyright',
} as const;

// MediaError 的码和它的名字。
const MEDIA_ERROR_NAMES: Record<string, string> = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/**
 * 引的话：平台的原话，带着它的码；只有码就引码；都没有而知道 HTTP 状态码就引它；什么都没有就不引。
 * 媒体元素的失败引的是 MediaError 的码和它的名字，浏览器自己的那句话只进日志。
 */
export const onlineFailureQuote = (shown: OnlineFailure): { text: string; code?: string } | undefined => {
    const { message, code, httpStatus } = shown.facts;
    if (shown.operation === 'media') return code ? { text: MEDIA_ERROR_NAMES[code] ?? code, code } : undefined;
    if (message) return { text: message, code };
    if (code) return { text: code };
    return httpStatus === undefined ? undefined : { text: `HTTP ${httpStatus}` };
};

/** 一次失败给用的人看的标题、该做什么和引的话，都已经翻好。 */
export const onlineFailureMessage = (shown: OnlineFailure, t: Translate): { title: string; note?: string; quote?: { text: string; code?: string } } => {
    const { signedOut, retryAfterMs, likelyCause } = shown.facts;
    const signInFirst = shown.case === 'sign-in-needed' && signedOut === true;
    const seconds = shown.case === 'retry-later' && retryAfterMs !== undefined && retryAfterMs > 0
        ? Math.max(1, Math.ceil(retryAfterMs / 1000))
        : undefined;
    const texts = signInFirst
        ? SIGNED_OUT
        : seconds !== undefined ? WAIT_TITLE : TEXTS[shown.case];
    const failed = shown.operation === 'collection' ? 'playlist.loadFailedPlain' : 'status.playbackFailed';
    const provider = shown.providerId ? omni.getProviderLabel(shown.providerId) : undefined;
    const values = seconds === undefined ? undefined : { seconds };
    const title = !texts.title
        ? t(failed)
        : !NAMES_PROVIDER.has(shown.case)
            ? t(texts.title)
            : provider ? t(texts.title, { ...values, provider }) : texts.bare ? t(texts.bare, values) : t(failed);
    const quote = onlineFailureQuote(shown);
    const own = TEXTS[shown.case];
    const note = likelyCause
        ? LIKELY_NOTES[likelyCause]
        : signInFirst || seconds !== undefined ? undefined : own.note ?? (provider ? undefined : own.bareNote);
    return { title, ...(note ? { note: t(note) } : {}), ...(quote ? { quote } : {}) };
};
