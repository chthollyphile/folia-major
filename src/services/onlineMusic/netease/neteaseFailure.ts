import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { NETEASE_API_BASE_MISSING, NETEASE_API_OFFLINE, httpErrorStatusOf, isNeteaseApiUnavailable, isNeteaseNetworkFailure } from './netease';

// src/services/onlineMusic/netease/neteaseFailure.ts
// 网易云要播放地址、读歌单和专辑的歌曲没有成功时交出的事实（services/onlineMusic/failure/）。
// 网易云自己的回答是什么意思，只在这里说。

// 回答带着一个不是 200 的 code。没有 code 的回答照旧去读。
export const isRefusedNeteaseAnswer = (response: any): boolean => response?.code != null && Number(response.code) !== 200;

// 这样的回答抛的错：301、401、403 是没有登录或登录已失效（和听歌上报的分法一样），别的是网易云拒绝了
// 这次请求。它的码和原话放在错的 cause 上，回答带着的 HTTP 错误状态也放在那里。
export const neteaseAnswerError = (response: any, what: string): OnlineProviderError => {
    const code = Number(response?.code);
    const said = response?.message || response?.msg;
    const httpStatus = httpErrorStatusOf(response);
    const cause = { code, ...(said ? { message: String(said) } : {}), ...(httpStatus === undefined ? {} : { httpStatus }) };
    return [301, 401, 403].includes(code)
        ? new OnlineProviderError('auth-required', `NetEase refused ${what}: not signed in`, 'netease', cause)
        : new OnlineProviderError('unavailable', `NetEase refused ${what}: code ${code}`, 'netease', cause);
};

// 回答说 200，这首歌却没有地址。那一项自己的 code 和 fee 留在 cause 上：-110 是这个账号没有这首歌的播放权限，
// 再按 fee 分（见 describeNeteaseFailure）；别的码是什么意思没有文档，只引不分。
export const neteaseNoUrlError = (itemCode: unknown, fee?: unknown): OnlineProviderError => (
    new OnlineProviderError('not-playable', 'NetEase gave no URL for this song', 'netease', { itemCode, fee })
);

// -110：账号没有这首歌的播放权限。fee 1 是要会员，4 是要购买（第三方整理的样本，可能），别的 fee 只知道没有权限。
const NO_RIGHT_CODE = -110;
const NO_RIGHT_CASES: Record<number, 'subscription-required' | 'purchase-required'> = { 1: 'subscription-required', 4: 'purchase-required' };

const codeOf = (value: unknown): { code?: string } => (
    typeof value === 'number' && Number.isFinite(value) ? { code: String(value) } : {}
);

export const describeNeteaseFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    // 桌面端的本地后端没有在监听（netease.ts 的 getApiBase）。
    if (isNeteaseApiUnavailable(error)) return { case: 'local-service-stopped' };
    // 它没起来是因为断网：说连不上。网通了，下一个请求会让它再启动。
    if (error instanceof Error && error.message === NETEASE_API_OFFLINE) return { case: 'unreachable' };
    // 网页版没有配置 API 的地址：这里用不了网易云，再试也一样。
    if ((error as { code?: unknown } | null)?.code === NETEASE_API_BASE_MISSING) return { case: 'not-configured' };
    // 请求没有到达 API（fetchWithCreds 标出的那种，或者裸 fetch 抛的 TypeError）。
    if (isNeteaseNetworkFailure(error)) return { case: 'unreachable' };
    // API 回的不是 JSON（网关的错误页、部署里没有这个接口时 Express 自己的 404 页）：不是网易云说的话，
    // 原因不明；HTTP 状态照样引出来。
    const tagged = (error as { httpStatus?: unknown } | null)?.httpStatus;
    if (!(error instanceof OnlineProviderError) && typeof tagged === 'number') return { case: 'unknown', httpStatus: tagged };
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'netease') return null;
    const cause = error.cause as { code?: unknown; message?: unknown; itemCode?: unknown; fee?: unknown; httpStatus?: unknown } | undefined;
    if (error.code === 'not-playable') {
        if (Number(cause?.itemCode) === NO_RIGHT_CODE) {
            return { case: NO_RIGHT_CASES[Number(cause?.fee)] ?? 'entitlement-required', ...codeOf(cause?.itemCode) };
        }
        return { case: 'no-audio', ...codeOf(cause?.itemCode) };
    }
    // 本地后端自己的一个模块出了错：server.js 把没有 body 的错一律回成这个 404，不是网易云说的话。
    if (cause?.httpStatus === 404 && cause.code === 404 && cause.message === 'Not Found') return { case: 'unknown' };
    // HTTP 状态按共用的规则分：本地后端连不上网易云时是 502，读作连不上。
    return {
        ...codeOf(cause?.code),
        ...(typeof cause?.message === 'string' ? { message: cause.message } : {}),
        ...(typeof cause?.httpStatus === 'number' ? { httpStatus: cause.httpStatus } : {}),
    };
};
