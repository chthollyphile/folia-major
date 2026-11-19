import type { FoliumSourceError, FoliumSourceFailureDetail } from '@folia/folium';
import { KUGOU_API_BASE_MISSING, KUGOU_LEGACY_PLAY_INFO_FAILED, extractKugouFailureDetails, type KugouErrorFactory } from './kugouTransport';

// sources/kugou/core/kugouFailure.ts
// 酷狗要播放地址、读歌单和专辑的歌曲没有成功时交出的事实（describeFailure）。酷狗自己的错误是什么意思，只在这里说；
// transport 抛的错的读法登录也用（kugouLoginFailure.ts）。
// 宿主交来的错是它给音源的错换上音源名之后的那个（一个新对象，message、cause、httpStatus、retryAfterMs 照旧），所以这里
// 按结构读：有 `code` 的 Error 是宿主的错（env.error 做的），别的照原样。

/** An error the host made for this source (env.error), read by its shape: the host hands back a copy of it. */
const sourceErrorOf = (error: unknown): FoliumSourceError | null => (
    error instanceof Error && typeof (error as { code?: unknown }).code === 'string' ? error as FoliumSourceError : null
);

const causeOf = (error: FoliumSourceError): unknown => (error as { cause?: unknown }).cause;

/** 桌面端的主进程没能加载 KuGouMusicApi：本地服务没在跑，不是酷狗出了错，也不是原因不明。 */
export const isKugouApiUnloaded = (error: unknown): boolean => {
    const found = sourceErrorOf(error);
    return found !== null && extractKugouFailureDetails(causeOf(found)).apiUnloaded === true;
};

// 主进程的 kugouApiBridge.cjs 把 Node 和 axios 的错写成 `CODE: message`；没有 error_code 时，这两个码是请求到了时限。
const KUGOU_TIMEOUT_DETAIL = /^(?:ECONNABORTED|ETIMEDOUT)\b/;

/**
 * 桌面端的请求到了时限也没有回答：别的音质多半也一样。没有状态的是这一边的请求本身；状态 502 的是
 * KuGouMusicApi 去问酷狗时到了时限，它把那个错原样回了过来。
 */
export const isKugouTimeout = (error: unknown): boolean => {
    const found = sourceErrorOf(error);
    if (!found) return false;
    const { status, errorCode, detail } = extractKugouFailureDetails(causeOf(found));
    return (status === undefined || status === 502) && errorCode === undefined && detail !== undefined && KUGOU_TIMEOUT_DETAIL.test(detail);
};

/** transport 抛的错（除了连不上时的 TypeError）交出的事实；不是它抛的错回 null。 */
export const kugouTransportFailure = (error: unknown): {
    case?: 'refused' | 'unknown' | 'unreachable' | 'not-configured'; httpStatus?: number; code?: string; message?: string;
} | null => {
    const found = sourceErrorOf(error);
    if (!found) return null;
    if (found.code === 'unavailable' && found.message === KUGOU_API_BASE_MISSING) return { case: 'not-configured' };
    // Web 端的非 2xx：状态码在 transport 写的那句话里；回答里带着酷狗的 error_code 就是酷狗自己答了话。
    // 要求等多久在错上（retryAfterMs），共用的规则会读到它。
    const webStatus = /^KuGouMusicApi request failed: (\d{3})$/.exec(found.message)?.[1];
    if (webStatus) {
        const answered = (causeOf(found) as { errorCode?: unknown } | undefined)?.errorCode;
        return {
            httpStatus: Number(webStatus),
            ...(typeof answered === 'number' ? { case: 'refused' as const, code: String(answered) } : {}),
        };
    }
    // 旧的播放信息接口：m.kugou.com 自己回的状态在错上；没有状态的是没能问到它（连不上）。
    if (found.message.startsWith(KUGOU_LEGACY_PLAY_INFO_FAILED)) {
        return found.httpStatus === undefined ? { case: 'unreachable' } : { httpStatus: found.httpStatus };
    }
    // 桌面端：主进程把酷狗的回答压成一行 `KuGouApi[...]`，原样留在 cause 里。
    const { status, errorCode, detail } = extractKugouFailureDetails(causeOf(found));
    // 没有 status 的不是酷狗的回答，是这一边自己出了错（KuGouMusicApi 连不上时回的是 status 502）。
    // transport 把桌面端的这种错也记成 network，这里说明它不算连不上；只有到了时限的那种是连不上。
    if (status === undefined) return isKugouTimeout(found) ? { case: 'unreachable' } : { case: 'unknown' };
    return {
        httpStatus: status,
        // 带着 error_code 就是酷狗自己答了话，不是连不上。
        ...(errorCode === undefined ? {} : { case: 'refused' as const, code: String(errorCode) }),
        ...(detail ? { message: detail } : {}),
    };
};

/** 酷狗答了话、却没有给地址时，错的 cause：最后一个这样的回答的 status 和 error_code，和当时有没有登录。 */
interface KugouNoUrlAnswer {
    status?: unknown;
    errorCode?: unknown;
    signedOut: boolean;
}

// 这种 cause 按对象认（宿主换音源名时 cause 原样带过去）。
const noUrlAnswers: WeakSet<object> = new WeakSet();

// 酷狗答了话，却没有给地址：最后一个这样的回答的 status 和 error_code 留在 cause 上。
// 酷狗的文档和代码里都没有说哪个码是要会员、没有版权或者限地区，所以只引不分。`signedOut`：没有登录的账号，
// 而酷狗只是没给地址：登录后可能能放（文档没说更多，所以只是可能）。
export const kugouNoUrlError = (
    error: KugouErrorFactory,
    answer: { status?: unknown; errorCode?: unknown } | undefined,
    signedOut = false,
): FoliumSourceError => {
    const cause: KugouNoUrlAnswer = { ...answer, signedOut };
    noUrlAnswers.add(cause);
    return error('not-playable', 'KuGou gave no URL for this song', { cause });
};

const codeOf = (value: unknown): string | undefined => (
    (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value) ? String(value) : undefined
);

export const describeKugouFailure = (_operation: 'audio' | 'collection', error: unknown): FoliumSourceFailureDetail | null => {
    // Web 端的请求是裸 fetch：连不上时它抛 TypeError（Failed to fetch）。别的 TypeError 是读回答时出的错，不是网络。
    if (error instanceof TypeError) return /fetch/i.test(error.message) ? { case: 'unreachable' } : null;
    const found = sourceErrorOf(error);
    const cause = found ? causeOf(found) : undefined;
    if (found?.code === 'not-playable' && typeof cause === 'object' && cause !== null && noUrlAnswers.has(cause)) {
        const answer = cause as KugouNoUrlAnswer;
        // errcode 0 是酷狗说没有出错：这时引的是 status。
        const code = (answer.errorCode === 0 ? undefined : codeOf(answer.errorCode)) ?? codeOf(answer.status);
        return { case: 'no-audio', ...(code ? { code } : {}), ...(answer.signedOut ? { likelyCause: 'sign-in' as const } : {}) };
    }
    if (isKugouApiUnloaded(error)) return { case: 'local-service-stopped' };
    return kugouTransportFailure(error);
};
