import type { SongResult } from '../../types';
import { OnlineProviderError } from '../../types/onlineMusic';
import type {
    OnlineProviderErrorDetails,
    ProviderErrorCode,
    ProviderSongAvailability,
} from '../../types/onlineMusic';
import { isNetworkFailureMessage } from '../../../shared/networkErrorText.mjs';

// src/services/onlineMusic/neteasePlaybackFailure.ts
// 网易云播放链路的失败归一化：transport 打在错误上的标签、/song/url/v1 的响应形态、privilege 的静态可用性。
// 纯函数。依赖方向是 netease.ts 依赖本文件，所以这里不从 '../netease' 导入任何运行时值。
// 只有静态 privilege 能给出 taken-down；运行时的空 URL、会员标签、网络失败都不推导为下架。

/** 网页版没配置 VITE_NETEASE_API_BASE 时，netease.ts 打在错误上的 code。 */
export const NETEASE_API_BASE_MISSING = 'NETEASE_API_BASE_MISSING';

// 与 netease.ts:45 的 NETEASE_API_UNAVAILABLE 取值一致（桌面版本地后端没在监听）。按字面量比较，避免反向依赖 netease.ts。
const NETEASE_API_UNAVAILABLE_CODE = 'NETEASE_API_UNAVAILABLE';

// 本地 API 把上游 axios 的网络错误转成 { code: 502, msg: err.message }（request.js:605-609），只能按文字认超时。
const UPSTREAM_TIMEOUT_PATTERN = /ETIMEDOUT|ESOCKETTIMEDOUT|timeout of \d+ms/;
const UPSTREAM_NETWORK_FAILURE_CODE = 502;

// 与 neteaseProvider 的登录态判断、netease.ts 清理匿名 cookie 的条件一致（likely）。
const NETEASE_AUTH_CODES: ReadonlySet<number> = new Set([301, 401, 403]);

// /song/url/v1 的 data[0].code 为 -110：账号缺少这首歌的播放权限；fee 1 指向会员、4 指向购买（第三方 fixture，likely）。
const NETEASE_NO_RIGHT_CODE = -110;
const NETEASE_FEE_MEMBERSHIP = 1;
const NETEASE_FEE_PURCHASE = 4;

// privilege.st 为 -200 是下架信号（社区 issue #899 与替代版本证据，likely）；其他负值只说明“灰色”，原因不明。
const NETEASE_TAKEN_DOWN_ST = -200;

type TaggedRequestError = {
    message?: unknown;
    code?: unknown;
    networkFailure?: unknown;
    httpStatus?: unknown;
};

const asRecord = (value: unknown): Record<string, any> | null => (
    value && typeof value === 'object' ? value as Record<string, any> : null
);

// 上游码只留数字或非空字符串，其余（缺失、null）不写进诊断。
const toUpstreamCode = (value: unknown): number | string | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
    }
    return undefined;
};

const neteaseError = (
    code: ProviderErrorCode,
    message: string,
    cause: unknown,
    details: OnlineProviderErrorDetails,
    httpStatus?: number,
): OnlineProviderError => new OnlineProviderError(
    code,
    message,
    'netease',
    cause,
    httpStatus,
    undefined,
    Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as OnlineProviderErrorDetails,
);

/**
 * 本地 API 的“路由不存在”形态（server.js:391-396）：`{ code: 404, msg: 'Not Found', data: null }`。
 * 更正：这其实是 server.js 在模块抛错且没有 body 时的兜底回复；部署里真的缺这个路由时，Express 默认回的是
 * 非 JSON 的 HTTP 404（由调用方按 fetchWithCreds 的 httpStatus 标签另行识别）。
 */
export const isNeteaseRouteMissingResponse = (raw: unknown): boolean => {
    const record = asRecord(raw);
    if (!record) return false;
    return Number(record.code) === 404 && record.msg === 'Not Found' && record.data === null;
};

/**
 * 顶层 `{ code: 502, msg }` 且 msg 是网络层失败文字：本地 API 没连上网易上游。
 * 超时文字给 timeout（带 upstreamCode 502），其余给 network；不满足条件返回 null。
 * network 故意不带 upstreamCode：分类器把带 upstreamCode 的 network 当成“上游有应答”（unknown），网络失败就会被当成证据不足。
 */
export const neteaseUpstreamNetworkError = (raw: unknown, stage: string): OnlineProviderError | null => {
    const record = asRecord(raw);
    if (!record || Number(record.code) !== UPSTREAM_NETWORK_FAILURE_CODE || !isNetworkFailureMessage(record.msg)) {
        return null;
    }

    const msg = String(record.msg);
    const message = `NetEase upstream request failed (${stage}): code ${UPSTREAM_NETWORK_FAILURE_CODE}: ${msg}`;
    if (UPSTREAM_TIMEOUT_PATTERN.test(msg)) {
        return neteaseError('timeout', message, raw, { stage, upstreamCode: UPSTREAM_NETWORK_FAILURE_CODE });
    }
    return neteaseError('network', message, raw, { stage });
};

/**
 * 把 netease.ts 抛出的请求错误换成 OmniError：按 fetchWithCreds / getApiBase 打的标签判断，message 原样保留。
 * 已经是 OmniError 或没有可识别标签的错误原样返回。
 */
export const toNeteaseRequestError = (error: unknown, stage: string): unknown => {
    if (error instanceof OnlineProviderError) return error;
    const tagged = asRecord(error) as TaggedRequestError | null;
    if (!tagged) return error;

    const message = typeof tagged.message === 'string' ? tagged.message : String(error);
    if (tagged.networkFailure === true) {
        return neteaseError('network', message, error, { stage });
    }
    if (tagged.code === NETEASE_API_UNAVAILABLE_CODE) {
        return neteaseError('unavailable', message, error, { stage: 'backend' });
    }
    if (tagged.code === NETEASE_API_BASE_MISSING) {
        return neteaseError('unavailable', message, error, { stage: 'config', transient: false });
    }
    if (typeof tagged.httpStatus === 'number') {
        const code: ProviderErrorCode = tagged.httpStatus >= 500 ? 'service-unavailable' : 'invalid-response';
        return neteaseError(code, message, error, { stage }, tagged.httpStatus);
    }
    return error;
};

/**
 * 判定 /song/url/v1 的响应：返回 null 表示 data[0].url 可播，否则返回应当抛出的 OmniError。
 * 绝不产出 taken-down，也不只凭 fee 或会员标签分类；证据不足一律 not-playable（播放侧为 unknown）。
 */
export const classifyNeteaseSongUrlResponse = (response: unknown): OnlineProviderError | null => {
    const upstreamFailure = neteaseUpstreamNetworkError(response, 'song-url');
    if (upstreamFailure) return upstreamFailure;

    if (isNeteaseRouteMissingResponse(response)) {
        return neteaseError('unavailable', 'NetEase API answered the song URL request with Not Found', response, { stage: 'local-api' });
    }

    const record = asRecord(response);
    const topCode = record?.code;
    if (topCode !== undefined && topCode !== null) {
        const numericTopCode = Number(topCode);
        if (NETEASE_AUTH_CODES.has(numericTopCode)) {
            return neteaseError('auth-required', `NetEase song URL request needs a valid session: code ${numericTopCode}`, response, {
                stage: 'song-url',
                upstreamCode: numericTopCode,
            });
        }
        if (numericTopCode !== 200) {
            return neteaseError('not-playable', `NetEase song URL request failed: code ${String(topCode)}`, response, {
                stage: 'song-url',
                upstreamCode: toUpstreamCode(topCode),
            });
        }
    }

    const data = record?.data;
    if (!Array.isArray(data) || data.length === 0) {
        return neteaseError('invalid-response', 'NetEase song URL response has no data entry', response, { stage: 'song-url' });
    }

    const item = asRecord(data[0]);
    const upstreamCode = toUpstreamCode(item?.code);
    if (item?.url) {
        // 30 秒试听片段：必须在交出音源之前拦下，免得进预取、媒体缓存和 ReplayGain。
        if (item.freeTrialInfo && typeof item.freeTrialInfo === 'object') {
            return neteaseError('preview-only', 'NetEase only returned a preview clip for this song', response, {
                stage: 'song-url',
                upstreamCode,
            });
        }
        return null;
    }

    if (upstreamCode === NETEASE_NO_RIGHT_CODE) {
        const fee = Number(item?.fee);
        const code: ProviderErrorCode = fee === NETEASE_FEE_MEMBERSHIP
            ? 'membership-required'
            : fee === NETEASE_FEE_PURCHASE
                ? 'purchase-required'
                : 'entitlement-required';
        return neteaseError(code, `NetEase refused the song URL: code ${NETEASE_NO_RIGHT_CODE}, fee ${String(item?.fee ?? 'none')}`, response, {
            stage: 'song-url',
            upstreamCode,
        });
    }

    return neteaseError('not-playable', `NetEase returned no playable URL: code ${String(item?.code ?? 'none')}`, response, {
        stage: 'song-url',
        upstreamCode,
    });
};

/**
 * 网易歌曲的静态可用性：只有 st 为 -200 且没有可播档位（pl ≤ 0）、也不在云盘（cs 不为 true）才算下架；
 * 其他负的 st 交给运行时判定（unknown / restricted）。运行时失败永不回写这里。
 */
export const resolveNeteaseSongAvailability = (
    song: Pick<SongResult, 'privilege' | 'noCopyrightRcmd'> | null | undefined,
): ProviderSongAvailability => {
    const privilege = song?.privilege;
    const st = privilege?.st;
    if (typeof st !== 'number' || st >= 0) return { state: 'playable' };

    const hasPlayableLevel = typeof privilege?.pl === 'number' && privilege.pl > 0;
    if (st === NETEASE_TAKEN_DOWN_ST && !hasPlayableLevel && privilege?.cs !== true) {
        const typeDesc = song?.noCopyrightRcmd?.typeDesc;
        return {
            state: 'unavailable',
            reason: 'taken-down',
            ...(typeof typeDesc === 'string' ? { label: typeDesc } : {}),
        };
    }

    return { state: 'unknown', reason: 'restricted' };
};
