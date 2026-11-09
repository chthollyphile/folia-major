import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureCaseId, OnlineFailureDetail, OnlineFailureOperation, OnlineProviderId, ProviderErrorCode } from '../../../types/onlineMusic';
import { codeText } from '../../../utils/errorText';
import { OnlineRequestTimeout } from './onlineRequestLimit';

// src/services/onlineMusic/failure/onlineFailureCase.ts
// 一首在线歌拿不到播放地址、一个集合读不出歌曲，或者媒体元素放不了一首在线歌时：把知道的事实拼在一起，
// 再分成一种有名字的情况。提示条和集合的空白处按情况说发生了什么、该做什么，再引平台的原话（onlineFailureTexts.ts）。
// 这里不认识任何平台，和登录失败的分法一样（login/loginFailureCase.ts）：某个平台自己的状态码是什么意思，
// 由那个平台的 adapter 说（`describeFailure`）。新增一个平台不用改这个文件。

// 一次失败的全部事实：provider 交出来的，加上抛出的错的共用代码。抛出的错自己的那句话不在里面：它多半是
// Folia 自己的英文，只进日志（logOnlineFailure）。
export interface OnlineFailureFacts extends OnlineFailureDetail {
    // 抛出的是 OnlineProviderError 时它的 code。
    errorCode?: ProviderErrorCode;
    // 请求到了时限也没有回答（onlineRequestLimit.ts）。
    timedOut?: boolean;
}

export interface OnlineFailure {
    case: OnlineFailureCaseId;
    // 'media'：地址拿到了，媒体元素却放不了，重新要地址也没有用。
    operation: OnlineFailureOperation | 'media';
    providerId?: OnlineProviderId;
    facts: OnlineFailureFacts;
}

// stops：播放时停下，不往下一首跳（用的人自己能处理的几种：登录、会员、购买、权限、试听、地区，和换到桌面版
// 或配好服务才能放的）。
// retry：没有下一首可跳时给一个「重试」（再要一次可能就好了的几种）。
// unplayable：「无法播放时自动跳过」打开时也倒数跳过的停下的几种：这首歌在这个账号上放不了，跳过它，
// 下一首多半能放。登录和服务没配好不在里面：登录了、配好了这首就能放，下一首也一样放不了。
const CASES: Record<OnlineFailureCaseId, { stops: boolean; retry: boolean; unplayable?: true }> = {
    unreachable: { stops: false, retry: true },
    'local-service-stopped': { stops: false, retry: true },
    'retry-later': { stops: false, retry: false },
    'sign-in-needed': { stops: true, retry: false },
    // 平台不让这个账号播放（不是哪一首）：和登录一样停下，跳到下一首也一样放不了。
    'account-refused': { stops: true, retry: false },
    'subscription-required': { stops: true, retry: false, unplayable: true },
    'purchase-required': { stops: true, retry: false, unplayable: true },
    'entitlement-required': { stops: true, retry: false, unplayable: true },
    'preview-only': { stops: true, retry: false, unplayable: true },
    'region-restricted': { stops: true, retry: false, unplayable: true },
    'not-configured': { stops: true, retry: false },
    // 只有平台的记录说它下架了才是这一种（getAvailability），或者 provider 自己点名。
    'taken-down': { stops: false, retry: false },
    'no-audio': { stops: false, retry: false },
    'audio-unplayable': { stops: false, retry: false },
    'not-public': { stops: false, retry: false },
    refused: { stops: false, retry: true },
    unknown: { stops: false, retry: true },
};

export const ONLINE_FAILURE_CASE_IDS = Object.keys(CASES) as OnlineFailureCaseId[];

/**
 * 这次失败停不停下播放。`autoSkipUnplayable` 是「无法播放时自动跳过」那个设置，由调用的地方在失败的那一刻读出来：
 * 打开时，这首歌在这个账号上放不了的几种也照别的失败一样倒数跳过。
 */
export const stopsPlayback = (shown: OnlineFailure, autoSkipUnplayable = false): boolean => (
    CASES[shown.case].stops && !(autoSkipUnplayable && CASES[shown.case].unplayable)
);
export const offersRetry = (shown: OnlineFailure): boolean => CASES[shown.case].retry;

/**
 * 要地址的请求连不上时，先自己再要几次，每次之前等这么久；都不行才告诉用的人。到了时限的请求只再要一次：
 * 它已经等过很久了。别的情况再要一次也一样，不自动重来。
 */
export const autoRetryDelaysMs = (shown: OnlineFailure): readonly number[] => (
    shown.case !== 'unreachable' ? [] : shown.facts.timedOut ? [2000] : [1000, 3000]
);

// 共用代码里用的人自己能处理的那几种：它们直接就是那一种情况。
const REFUSAL_CASES: Partial<Record<ProviderErrorCode, OnlineFailureCaseId>> = {
    'auth-required': 'sign-in-needed',
    'subscription-required': 'subscription-required',
    'preview-only': 'preview-only',
    'region-restricted': 'region-restricted',
    'not-public': 'not-public',
};

// 规则按这个顺序看：共用代码里的拒绝（adapter 自己认定的登录失效，比 provider 对同一个错的转述准），
// 点了名的情况，平台要求等多久，HTTP 状态（429 是稍后再试，5xx 是连不上，别的 4xx 是平台拒绝），
// 没有状态的网络错误，平台没给播放地址，平台说的码或话。
const caseIdOf = (facts: OnlineFailureFacts): OnlineFailureCaseId => {
    const refusal = facts.errorCode && REFUSAL_CASES[facts.errorCode];
    if (refusal) return refusal;
    if (facts.case) return facts.case;
    const status = facts.httpStatus;
    if (facts.retryAfterMs !== undefined || status === 429) return 'retry-later';
    if (status !== undefined && status >= 500) return 'unreachable';
    if (status !== undefined && status >= 400) return 'refused';
    if (facts.errorCode === 'network') return 'unreachable';
    if (facts.errorCode === 'not-playable') return 'no-audio';
    // 平台自己说了话：它拒绝了这次请求。
    if (facts.code !== undefined || facts.message !== undefined) return 'refused';
    return 'unknown';
};

// provider 对一个抛出的错的说法，记在那个错上。
const describedErrors = new WeakMap<object, OnlineFailureDetail>();

// omni 在要地址、读集合抛错时调用：把 provider 的说法留在错上，错本身原样往外抛。
export const noteOnlineFailure = (error: unknown, detail: OnlineFailureDetail | null | undefined): void => {
    if (detail && typeof error === 'object' && error !== null) describedErrors.set(error, detail);
};

const LIKELY_CAUSES = new Set<NonNullable<OnlineFailureDetail['likelyCause']>>(['sign-in', 'subscription', 'region']);

const withoutEmpty = <T extends object>(value: T): T => (
    Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
);

/**
 * 拼出一次失败并分出情况。`detail` 是调用的地方自己知道的（没有地址时的 `{ case: 'no-audio' }`）；`error` 是抛出的错：
 * 从它身上只取 provider 对它的说法（由 `noteOnlineFailure` 留下）和它的共用代码。
 */
export const onlineFailureOf = (
    // `signedOut`：发出请求时这个平台没有登录的账号（调用的地方在请求之前读的）。
    at: { operation: OnlineFailureOperation; providerId?: OnlineProviderId; signedOut?: boolean },
    source: { error?: unknown; detail?: OnlineFailureDetail },
): OnlineFailure => {
    const { error } = source;
    const detail = source.detail ?? (typeof error === 'object' && error !== null ? describedErrors.get(error) : undefined) ?? {};
    // 抛出的错自己带着的 HTTP 状态和要求等多久（transport 读出来时放在错上），provider 没说时用它们。
    const thrown = error instanceof OnlineProviderError ? error : undefined;
    const status = detail.httpStatus ?? thrown?.httpStatus;
    const wait = detail.retryAfterMs ?? thrown?.retryAfterMs;
    const facts = withoutEmpty<OnlineFailureFacts>({
        // 点的名不在表里就是原因不明。
        case: detail.case === undefined ? undefined : Object.hasOwn(CASES, detail.case) ? detail.case : 'unknown',
        code: codeText(detail.code),
        message: typeof detail.message === 'string' && detail.message !== '' ? detail.message : undefined,
        httpStatus: Number.isInteger(status) ? status : undefined,
        upstreamCode: codeText(detail.upstreamCode),
        retryAfterMs: typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : undefined,
        likelyCause: detail.likelyCause && LIKELY_CAUSES.has(detail.likelyCause) ? detail.likelyCause : undefined,
        signedOut: at.signedOut === true || detail.signedOut === true ? true : undefined,
        // 共用的代号是几个固定的词；一个 mod 自己造的错可以在这里放任何东西，只收字符串和数。
        errorCode: thrown ? codeText(thrown.code) as ProviderErrorCode | undefined : undefined,
        timedOut: error instanceof OnlineRequestTimeout ? true : undefined,
    });
    return withoutEmpty({ case: caseIdOf(facts), operation: at.operation, providerId: at.providerId, facts });
};

/**
 * 媒体元素放不了一首在线歌、重新要地址也没有用时的失败。MediaError 2 是读音频时断了网；3（解码失败）、
 * 4（格式不支持）和没有码的，是这首歌的音频放不了。码记在 `code`；浏览器自己的那句话记在 `message`，
 * 只进日志，界面引的是码和它的名字。
 */
export const mediaFailureOf = (media: { code?: number; message?: string } | null, providerId?: OnlineProviderId): OnlineFailure => {
    const code = Number.isInteger(media?.code) ? String(media?.code) : undefined;
    return withoutEmpty({
        case: code === '2' ? 'unreachable' as const : 'audio-unplayable' as const,
        operation: 'media' as const,
        providerId,
        facts: withoutEmpty<OnlineFailureFacts>({ code, message: media?.message || undefined }),
    });
};

/**
 * 给维护者的那一行：是哪一种请求、哪个平台、哪一种情况，和全部事实。`thrown` 是抛出的错，原样跟在后面
 * （会话日志记下它的调用栈）；屏幕上从不显示它。
 */
export const logOnlineFailure = (shown: OnlineFailure, thrown?: unknown): void => {
    console.warn(`[OnlineFailure] ${shown.operation} ${shown.providerId ?? '-'} ${shown.case}`, {
        operation: shown.operation,
        provider: shown.providerId,
        case: shown.case,
        ...shown.facts,
    }, ...(thrown === undefined ? [] : [thrown]));
};
