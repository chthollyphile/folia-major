// src/services/onlineMusic/login/loginRequestLimit.ts
// 登录要发的请求里，自己没有时限的那些在这里得到一个：20 秒没有回答就算失败。
// 哪些请求用它，由各平台的 transport 自己决定；这里不认识任何平台。

export const LOGIN_REQUEST_LIMIT_MS = 20_000;

// 请求在时限内没有回答。loginFailureCase.ts 把它分成「没有回应」。
export class LoginRequestTimeout extends Error {
    constructor() {
        super(`The sign-in request was not answered in ${LOGIN_REQUEST_LIMIT_MS / 1000} s`);
        this.name = 'LoginRequestTimeout';
    }
}

// 还在计时的请求各自的计时器。
const limits = new Set<ReturnType<typeof setTimeout>>();

/**
 * 给登录的一个请求加上时限。`run` 拿到的 signal 交给 fetch：到点时请求被中止，并以 LoginRequestTimeout
 * 失败；不认 signal 的请求（IPC）到点后只是不再等它。在时限内有了结果的，成功和失败都原样交出去。
 */
export const withLoginRequestLimit = <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            limits.delete(timer);
            reject(new LoginRequestTimeout());
            controller.abort();
        }, LOGIN_REQUEST_LIMIT_MS);
        limits.add(timer);
        // `run` 当场抛错也走同一条路：以它的错失败，计时器清掉。
        new Promise<T>(settle => settle(run(controller.signal))).then(resolve, reject).finally(() => {
            clearTimeout(timer);
            limits.delete(timer);
        });
    });
};

// 登录被取消或者重新开始时调用：此刻还在计时的登录请求（应用里同时只有一次登录）都不再计时，
// 请求本身不中止，照原样跑完——晚到的二维码会话仍然要还给后端。这之后才发出去的请求照常计时、到点中止。
export const dropLoginRequestLimits = (): void => {
    limits.forEach(timer => clearTimeout(timer));
    limits.clear();
};
