import type { BodianErrorCode } from 'bodian-music-api';
import { OnlineProviderError, type OnlineProviderErrorDetails, type ProviderErrorCode } from '../../types/onlineMusic';

// src/services/onlineMusic/bodianErrors.ts
// 把桌面桥返回的 bodian-music-api 错误 {code, message} 归一成 OmniError。
// 桥只透出 code 和 message，上游业务码和 HTTP 状态都藏在 message 里，所以这里按 message 模板匹配。
// 模板与固定版本 bodian-music-api@0.1.2 绑定（src/http.cjs、src/playback.cjs、src/api.cjs）；
// 升级这个包时必须重跑 test/unit/onlineMusic/bodianErrors.test.ts 的契约测试，模板变了要同步改这里。

/** 桌面桥 `{ ok: false }` 结果里的 error；code 限定为包的 BodianErrorCode，透传时编译期保证它是 ProviderErrorCode 的子集。 */
export interface BodianBridgeError {
    code: BodianErrorCode;
    message: string;
}

// playback.cjs:41 / :44 —— checkRight status 7 或缺 status；没有会话时包给 auth-required，有会话时给 not-playable。
const ADDITIONAL_RIGHTS_MESSAGE = 'Bodian requires additional playback rights';
const RIGHTS_UNAVAILABLE_MESSAGE = 'Bodian playback rights are unavailable';
// playback.cjs:34 —— checkRight status 3 但没有可用的试听片段。
const PREVIEW_UNAVAILABLE_MESSAGE = 'Bodian preview is unavailable';
// http.cjs:82 —— 15 秒请求超时。
const TIMEOUT_MESSAGE = 'Bodian request timed out';
// http.cjs:62-63 —— 非 2xx 响应；401 由包标成 auth-required，其余标成 network。
const HTTP_STATUS_MESSAGE = /^Bodian HTTP (\d{3})$/;
// http.cjs:117-118 —— 业务码不是 200：11012 → auth-required，20018 → not-playable，其余 → invalid-response。
const UPSTREAM_CODE_MESSAGE = /\(code (\d+|missing)\)/;

// 业务码：11012 会话被拒，20018 缺少播放权限（含义只来自开发者记忆）。
const UPSTREAM_SESSION_REJECTED = 11012;
const UPSTREAM_RIGHTS_REQUIRED = 20018;
const HTTP_UNAUTHORIZED = 401;

const readHttpStatus = (message: string): number | undefined => {
    const match = HTTP_STATUS_MESSAGE.exec(message);
    return match ? Number(match[1]) : undefined;
};

// 数字业务码转成 number；上游没给 code 时模板写 'missing'，原样记下作诊断。
const readUpstreamCode = (message: string): number | 'missing' | undefined => {
    const match = UPSTREAM_CODE_MESSAGE.exec(message);
    if (!match) return undefined;
    return match[1] === 'missing' ? 'missing' : Number(match[1]);
};

const bodianError = (
    code: ProviderErrorCode,
    message: string,
    details?: OnlineProviderErrorDetails,
    httpStatus?: number,
) => new OnlineProviderError(code, message, 'bodian', undefined, httpStatus, undefined, details);

/**
 * 按 0.1.2 的 message 模板细分波点错误：鉴权拆成 signed-out / expired，权限、试听、超时、HTTP 状态和业务码各归其位。
 * 认不出的组合原样透传；`auth-required` 在任何情况下都保持不变（useBodianLibrary 靠它清理会话）。
 */
export const toBodianProviderError = (error: BodianBridgeError): OnlineProviderError => {
    const { code, message } = error;
    switch (code) {
        case 'auth-required': {
            if (message === ADDITIONAL_RIGHTS_MESSAGE || message === RIGHTS_UNAVAILABLE_MESSAGE) {
                return bodianError('auth-required', message, { auth: 'signed-out' });
            }
            if (readHttpStatus(message) === HTTP_UNAUTHORIZED) {
                return bodianError('auth-required', message, { auth: 'expired' }, HTTP_UNAUTHORIZED);
            }
            if (readUpstreamCode(message) === UPSTREAM_SESSION_REJECTED) {
                return bodianError('auth-required', message, { auth: 'expired', upstreamCode: UPSTREAM_SESSION_REJECTED });
            }
            break;
        }
        case 'not-playable': {
            if (message === ADDITIONAL_RIGHTS_MESSAGE) return bodianError('entitlement-required', message);
            if (readUpstreamCode(message) === UPSTREAM_RIGHTS_REQUIRED) {
                return bodianError('entitlement-required', message, { upstreamCode: UPSTREAM_RIGHTS_REQUIRED });
            }
            if (message === PREVIEW_UNAVAILABLE_MESSAGE) return bodianError('preview-only', message);
            // 'Bodian playback rights are unavailable'（已登录但 checkRight 没给 status）证据不足，保持 not-playable。
            break;
        }
        case 'network': {
            if (message === TIMEOUT_MESSAGE) return bodianError('timeout', message);
            const httpStatus = readHttpStatus(message);
            // 状态码交给分类器细分成 429 / 504 / 5xx / 4xx；'request failed'、'response was interrupted' 保持纯 network。
            if (httpStatus !== undefined) return bodianError('network', message, undefined, httpStatus);
            break;
        }
        case 'invalid-response': {
            const upstreamCode = readUpstreamCode(message);
            if (upstreamCode !== undefined) return bodianError('invalid-response', message, { upstreamCode });
            break;
        }
        default:
            // region-restricted 保留上游中文 message；其余 code 原样透传。
            break;
    }
    return new OnlineProviderError(code, message, 'bodian');
};
