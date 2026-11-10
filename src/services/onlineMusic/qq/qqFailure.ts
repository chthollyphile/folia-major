import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { QQ_API_BASE_MISSING, QQ_API_NOT_RUNNING, readBackendMessage, readUpstreamRefusalCode } from './qqTransport';

// src/services/onlineMusic/qq/qqFailure.ts
// QQ 音乐要播放地址、读歌单和专辑的歌曲没有成功时交出的事实（services/onlineMusic/failure/）。
// 后端的错误是什么意思，只在这里说（登录的那一份在 qqLoginFailure.ts，HTTP 状态的读法两边共用）。

/**
 * 401 和 404 之外的非 2xx：状态码在 requestQq 写的那句话里，后端的回答在 cause 里；后端要求等多久（429 时带着，
 * 在回答里或 Retry-After 头里）照样交出去，后端的原话（多数路由的 message，播放等路由的 500 只给 error）也交出去。
 * 不是这样一个错的回 null。
 */
export const qqStatusFailure = (error: OnlineProviderError): { httpStatus: number; retryAfterMs?: number; message?: string } | null => {
    const status = /^QQMusicApi request failed: (\d{3})$/.exec(error.message)?.[1];
    if (!status) return null;
    const answer = error.cause as { retryAfterMs?: unknown } | null | undefined;
    const wait = typeof answer?.retryAfterMs === 'number' ? answer.retryAfterMs : error.retryAfterMs;
    const said = readBackendMessage(answer);
    return {
        httpStatus: Number(status),
        ...(typeof wait === 'number' ? { retryAfterMs: wait } : {}),
        ...(said ? { message: said } : {}),
    };
};

// 后端对没配好的能力回 501（serverless 入口缺少配置）：再试也一样。
const HTTP_NOT_IMPLEMENTED = 501;

// 新路由的错误正文带后端自己分的 `kind`（qq-music-api protocol/errors.js）。这几种是 QQ 答了话、只是拒绝或答得不对：
// 算平台拒绝，不自动重来，上游的数字码一并交出。连不上 QQ（`network`）、QQ 回了非 200（`upstream-http`）和认不得的
// kind 都不在这里，照共用的规则按 5xx 算连不上。
const REFUSED_KINDS: ReadonlySet<string> = new Set([
    'upstream-business', 'upstream-gateway', 'invalid-response',
    'device-limit', 'account-restricted', 'account-banned', 'account-binding', 'login-rejected',
]);

// 后端说话的那一处的码，是一个数时。
const codeOf = (value: unknown): string | undefined => (
    value === undefined || value === null || !Number.isFinite(Number(value)) ? undefined : String(Number(value))
);

// 只有播放地址（'audio'）和读集合的歌（'collection'）来这里：omni.ts 的 runRequest 只为这两种调用 describeFailure。
// 写入（加歌、收藏、红心）的失败不经过这里，所以下面的分法不用再按 operation 分。
export const describeQqFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    // 请求是裸 fetch：连不上时它抛 TypeError（Failed to fetch）。别的 TypeError 是读回答时出的错，不是网络。
    if (error instanceof TypeError && /fetch/i.test(error.message)) return { case: 'unreachable' };
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'qq') return null;
    // 登录窗口叫它 local-service-unavailable（登录窗口重启不了它）；在别处两种本地服务说的是同一句。
    if (error.message.startsWith(QQ_API_NOT_RUNNING)) return { case: 'local-service-stopped' };
    if (error.message === QQ_API_BASE_MISSING) return { case: 'not-configured' };
    // 后端答了，没给链接（qqProvider.ts）：它透出来的「可能」的原因在 cause 上。
    if (error.code === 'not-playable') {
        const likely = (error.cause as { likelyCause?: OnlineFailureDetail['likelyCause'] } | null | undefined)?.likelyCause;
        return { case: 'no-audio', ...(likely ? { likelyCause: likely } : {}) };
    }
    const status = qqStatusFailure(error);
    if (status) {
        if (status.httpStatus === HTTP_NOT_IMPLEMENTED) return { case: 'not-configured', ...status };
        // 500（3.2.0 起带凭证的旧路由也会回 502）只是后端的外壳：QQ 音乐其实答了话，只是拒绝了（QqProtocolError 的模板）。
        // 新路由的 502 带 errorKey，是另一套回答，不在这里认。
        const errorKey = (error.cause as { errorKey?: unknown } | null | undefined)?.errorKey;
        const shell = status.httpStatus === 500 || (status.httpStatus === 502 && typeof errorKey !== 'string');
        const refusal = shell ? readUpstreamRefusalCode(status.message ?? '') : undefined;
        if (refusal !== undefined) return { case: 'refused', ...status, ...(typeof refusal === 'number' ? { code: String(refusal) } : {}) };
        const answer = error.cause as { kind?: unknown; upstreamCode?: unknown } | null | undefined;
        if (status.httpStatus === 502 && typeof answer?.kind === 'string' && REFUSED_KINDS.has(answer.kind)) {
            const upstreamCode = codeOf(answer.upstreamCode);
            return { case: 'refused', ...status, ...(upstreamCode ? { upstreamCode } : {}) };
        }
        return status;
    }
    // 后端答了 200，QQ 音乐在回答的某一处拒绝了（qqTransport.ts 的 assertUpstreamAccepted）：那一处就是 cause。
    if (error.message.includes('was rejected upstream')) {
        const node = error.cause as { code?: unknown; subcode?: unknown; message?: unknown } | undefined;
        const code = codeOf(node?.code);
        const subcode = codeOf(node?.subcode);
        const said = typeof node?.message === 'string' ? node.message.trim() : '';
        return {
            ...(code ? { code } : {}),
            ...(subcode && subcode !== code ? { upstreamCode: subcode } : {}),
            ...(said ? { message: said } : {}),
        };
    }
    return null;
};
