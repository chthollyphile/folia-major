import type { LoginFailureDetail, LoginStep } from '../../../types/onlineMusic';
import { NETEASE_API_OFFLINE, NeteaseLoginHttpError, isNeteaseApiUnavailable, isNeteaseNetworkFailure } from './netease';

// src/services/onlineMusic/netease/neteaseLoginFailure.ts
// 网易云登录失败时交给登录窗口的事实。网易云自己的错误是什么意思，只在这里说。

// 登录的某一步抛了错。
export const describeNeteaseLoginFailure = (_step: LoginStep, error: unknown): LoginFailureDetail | null => {
    // 桌面端的本地后端没有在监听（netease.ts 的 getApiBase）。
    if (isNeteaseApiUnavailable(error)) return { case: 'local-service-stopped' };
    // 它没起来是因为断网：说连不上，不给重启的按钮。网通了，下一次开始会让它再启动。
    if (error instanceof Error && error.message === NETEASE_API_OFFLINE) return { case: 'unreachable' };
    // 请求没有到达 API（fetchWithCreds 标出的那种，或者裸 fetch 抛的 TypeError）。
    if (isNeteaseNetworkFailure(error) || error instanceof TypeError) return { case: 'unreachable' };
    // 本地后端回了 HTTP 错误：它的状态（连不上网易云时是 502），和回答里网易云的码和原话。
    if (error instanceof NeteaseLoginHttpError) return { httpStatus: error.httpStatus, ...neteaseCheckFailure(error.answer) };
    return null;
};

// checkQr 回了 800 到 803 之外的状态码：把网易云的码和原话交出去，有哪样交哪样。
export const neteaseCheckFailure = (response: any): LoginFailureDetail => {
    const message = response?.message || response?.msg;
    return {
        ...(response?.code === undefined || response?.code === null ? {} : { code: String(response.code) }),
        ...(message ? { message: String(message) } : {}),
    };
};
