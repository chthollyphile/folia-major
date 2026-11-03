import { OnlineProviderError } from '../../../types/onlineMusic';
import type { LoginFailureDetail, LoginStep } from '../../../types/onlineMusic';
import { QQ_API_NOT_RUNNING } from './qqTransport';
import { qqStatusFailure } from './qqFailure';

// src/services/onlineMusic/qq/qqLoginFailure.ts
// QQ 音乐登录失败时交给登录窗口的事实。后端的错误是什么意思，只在这里说。

// 登录的某一步抛了错（都出自 qqTransport.ts 的 requestQq）。
export const describeQqLoginFailure = (_step: LoginStep, error: unknown): LoginFailureDetail | null => {
    // 请求是裸 fetch：连不上时它抛 TypeError。
    if (error instanceof TypeError) return { case: 'unreachable' };
    if (!(error instanceof OnlineProviderError)) return null;
    if (error.message.startsWith(QQ_API_NOT_RUNNING)) return { case: 'local-service-unavailable' };
    const status = qqStatusFailure(error);
    // 502 而回答里没有 QQ 的码：后端没能连上 QQ（断网时就是这样），不是 QQ 拒绝了。后端照样要过一会才肯再给
    // 二维码，等多久留在事实里，重来的操作先等。
    const upstreamCode = (error.cause as { upstreamCode?: unknown } | null | undefined)?.upstreamCode;
    if (status?.httpStatus === 502 && upstreamCode === undefined) return { case: 'unreachable', ...status };
    return status;
};

/**
 * login_qr_check 回了 801 到 803 之外的状态码。800 带着 upstreamCode 时是上游要求稍后再试（`wait`），
 * 不是二维码过期；`upstreamCode` 是上游的风控编号，照旧不解释它的意思。
 */
export const qqCheckFailure = (response: any, wait = false): LoginFailureDetail => {
    const code = Number(response?.code);
    return {
        ...(wait ? { case: 'retry-later' as const } : {}),
        ...(Number.isFinite(code) ? { code: String(code) } : {}),
        ...(typeof response?.message === 'string' && response.message ? { message: response.message } : {}),
        ...(response?.upstreamCode === undefined ? {} : { upstreamCode: String(response.upstreamCode) }),
        ...(typeof response?.retryAfterMs === 'number' ? { retryAfterMs: response.retryAfterMs } : {}),
    };
};

// 平台拒绝了这次登录、原因在账号本身的那几种（被封、受限、绑定有问题）：登录窗口用 Folia 自己的话说
// 怎么回事、该做什么（qqProvider.ts 的 caseNotes），不引后端的英文预设，也不说稍后重试会好。
const QQ_ACCOUNT_HINT_NOTES: Readonly<Record<string, string>> = {
    'login.account-banned': 'home.loginCaseQqAccountBanned',
    'login.account-restricted': 'home.loginCaseQqAccountRestricted',
    'login.account-binding': 'home.loginCaseQqAccountBinding',
};

/** 账号本身的问题那几种 hint 在登录窗口说的那一句（i18n key）；别的 key 和没有 key 是 undefined。 */
export const qqAccountHintNote = (key: string | null | undefined): string | undefined => (
    key && Object.hasOwn(QQ_ACCOUNT_HINT_NOTES, key) ? QQ_ACCOUNT_HINT_NOTES[key] : undefined
);

/**
 * 800 失败带的 `failureHint`（qq-music-api 3.3.3 起）：`key` 是固定的，`message` 是后端给人看的英文原话。
 * 登录太频繁是稍后再试；`login.rejected` 是 refused，引后端的原话；账号本身的问题（qqAccountHintNote）也是 refused，
 * 引的仍是回答本身的原话，该怎么做由登录窗口按 QQ 的 caseNotes 说；用 QQ 音乐 App 扫了手机 QQ 的码是 wrong-scan-app，
 * 同样由 caseNotes 说。认不出的 key 和没有 hint 的回 null，照旧按别的字段分。
 * 登录设备已满不在这里：它在 qqProvider.ts 里先认出来。
 * `channel` 是这张码走的通道：后端认扫错 App 时不看通道，可 `qqmusic` 的码三种 App 都能扫，那里说扫错了不成立，
 * 回 null 照一般的拒绝处理。不知道通道时照旧。
 * 后端给的 `retryAfterMs` 都留着：失败之后后端在那之前不给新码（qrService 的 backoff），重来要先等。
 */
export const qqHintFailure = (response: any, channel?: string): LoginFailureDetail | null => {
    const hint = response?.failureHint;
    const key = typeof hint?.key === 'string' ? hint.key : '';
    if (key === 'login.rate-limited') return qqCheckFailure(response, true);
    if (key === 'login.wrong-scan-app') return channel === 'qqmusic' ? null : { ...qqCheckFailure(response), case: 'wrong-scan-app' };
    if (qqAccountHintNote(key)) return { ...qqCheckFailure(response), case: 'refused' };
    if (key !== 'login.rejected') return null;
    const said = typeof hint?.message === 'string' ? hint.message.trim() : '';
    return { ...qqCheckFailure(response), case: 'refused', ...(said ? { message: said } : {}) };
};
