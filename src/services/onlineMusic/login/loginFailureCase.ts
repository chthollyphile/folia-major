import { OnlineProviderError } from '../../../types/onlineMusic';
import type { LoginCaseId, LoginFailureDetail, LoginStep, ProviderErrorCode } from '../../../types/onlineMusic';
import type { LoginCase, LoginCaseAction, LoginCaseKind, LoginFailureFacts } from '../../../types/loginFailure';
import { LoginRequestTimeout } from './loginRequestLimit';
import { codeText } from '../../../utils/errorText';

// src/services/onlineMusic/login/loginFailureCase.ts
// 登录没有成功时：把知道的事实拼在一起，再分成一种有名字的情况，登录窗口按情况给标题和操作。
// 这里不认识任何平台。某个平台自己的状态码是什么意思，由那个平台的 adapter 说（`describeLoginFailure`
// 和 checkLogin 回的 `failure`）：它交出共用的事实，或者直接点名是哪一种情况。新增一个平台不用改这个文件。
// 情况、事实和失败的类型在 src/types/loginFailure.ts。

// 'retry' 是重新来一次：扫码登录是刷新二维码，浏览器登录是重新登录。
const CASES: Record<LoginCaseId, { kind: LoginCaseKind; action: LoginCaseAction | 'retry'; details: boolean }> = {
    'code-expired': { kind: 'A', action: 'refresh-code', details: false },
    'expired-after-scan': { kind: 'A', action: 'refresh-code', details: true },
    'browser-unfinished': { kind: 'A', action: 'sign-in-again', details: false },
    'not-authorized': { kind: 'A', action: 'sign-in-again', details: true },
    unreachable: { kind: 'B', action: 'retry', details: true },
    'no-answer': { kind: 'B', action: 'retry', details: true },
    refused: { kind: 'C', action: 'retry', details: true },
    'retry-later': { kind: 'C', action: 'wait-then-retry', details: true },
    // 账号登录的设备已经满了：平台拒绝，用的人在手机上退出不用的设备之后再来一次。
    'device-limit': { kind: 'C', action: 'retry', details: true },
    // 扫码用的 App 和选的登录方式对不上：平台拒绝，用的人换对的 App 或改选登录方式之后再来一次。
    'wrong-scan-app': { kind: 'C', action: 'retry', details: true },
    // 本地服务没有在跑：前一种可以在登录窗口里重启它，后一种不能，只能重来。
    'local-service-stopped': { kind: 'D', action: 'restart-service', details: true },
    'local-service-unavailable': { kind: 'D', action: 'retry', details: true },
    'cannot-listen': { kind: 'D', action: 'retry', details: true },
    'no-browser': { kind: 'E', action: 'retry', details: true },
    'browser-still-open': { kind: 'E', action: 'retry', details: true },
    'browser-closed-early': { kind: 'E', action: 'retry', details: true },
    'browser-unread': { kind: 'E', action: 'retry', details: true },
    'browser-not-opened': { kind: 'E', action: 'reopen-browser', details: true },
    'account-not-read': { kind: 'F', action: 'retry', details: true },
    unknown: { kind: 'G', action: 'retry', details: true },
};

export const LOGIN_CASE_IDS = Object.keys(CASES) as LoginCaseId[];

// 规则按这个顺序看：点了名的情况，步骤，平台要求等多久，HTTP 状态（429 是稍后再试，5xx 是连不上，
// 别的 4xx 是平台拒绝），没有状态的网络错误，平台说的码或话。
const caseIdOf = (facts: LoginFailureFacts): LoginCaseId => {
    if (facts.case) return facts.case;
    if (facts.step === 'open') return 'browser-not-opened';
    if (facts.step === 'account') return 'account-not-read';
    if (facts.step === 'wait') return facts.inBrowser ? 'browser-unfinished' : facts.scanned ? 'expired-after-scan' : 'code-expired';
    const status = facts.httpStatus;
    if (facts.retryAfterMs !== undefined || status === 429) return 'retry-later';
    if (status !== undefined && status >= 500) return 'unreachable';
    if (status !== undefined && status >= 400) return 'refused';
    if (facts.errorCode === 'network' && status === undefined) return 'unreachable';
    // 平台自己说了话：它拒绝了这次登录。
    if (facts.code !== undefined || facts.message !== undefined) return 'refused';
    return 'unknown';
};

// 按事实分出是哪一种情况。provider 点了名的照它的；其余按步骤和共用的事实分，都对不上就是原因不明。
// 平台说了过多久才能再来一次时（`retryAfterMs`），重来的操作先等到那时：不然它只会撞上平台的拦截。
export const loginCaseOf = (facts: LoginFailureFacts): LoginCase => {
    const id = caseIdOf(facts);
    const { kind, action, details } = CASES[id];
    const again = action === 'retry' ? (facts.inBrowser ? 'sign-in-again' : 'refresh-code') : action;
    const waits = facts.retryAfterMs !== undefined && (again === 'refresh-code' || again === 'sign-in-again');
    return { id, kind, action: waits ? 'wait-then-retry' : again, details };
};

// provider 对一个抛出的错的说法，记在那个错上。
const describedErrors = new WeakMap<object, LoginFailureDetail>();

// omni 在登录的某一步抛错时调用：把 provider 的说法留在错上，错本身原样往外抛。
export const noteLoginFailure = (error: unknown, detail: LoginFailureDetail | null | undefined): void => {
    if (detail && typeof error === 'object' && error !== null) describedErrors.set(error, detail);
};

/**
 * 拼出一次登录失败的事实。`detail` 是 provider 随 error 状态交出来的；`error` 是抛出的错：从它身上只取
 * provider 对它的说法（由 `noteLoginFailure` 留下）、它是不是撞上了时限、和它的共用代码。
 */
export const loginFailureFacts = (
    at: { step: LoginStep; inBrowser: boolean; scanned: boolean },
    source: { detail?: LoginFailureDetail; error?: unknown } = {},
): LoginFailureFacts => {
    const { error } = source;
    const detail = source.detail ?? (typeof error === 'object' && error !== null ? describedErrors.get(error) : undefined) ?? {};
    // provider 没有点名时，撞上登录请求时限的错是「没有回应」；点的名不在表里就是原因不明。
    const named = detail.case === undefined
        ? (error instanceof LoginRequestTimeout ? 'no-answer' as const : undefined)
        : Object.hasOwn(CASES, detail.case) ? detail.case : 'unknown' as const;
    const wait = detail.retryAfterMs;
    const facts = {
        ...at,
        case: named,
        code: codeText(detail.code),
        message: typeof detail.message === 'string' && detail.message !== '' ? detail.message : undefined,
        httpStatus: Number.isInteger(detail.httpStatus) ? detail.httpStatus : undefined,
        upstreamCode: codeText(detail.upstreamCode),
        retryAfterMs: typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : undefined,
        mainCode: codeText(detail.mainCode),
        // 共用的代号是几个固定的词；一个 mod 自己造的错可以在这里放任何东西，只收字符串和数。
        errorCode: error instanceof OnlineProviderError ? codeText(error.code) as ProviderErrorCode | undefined : undefined,
    };
    return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined)) as unknown as LoginFailureFacts;
};
