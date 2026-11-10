import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/failure/onlineRequestLimit.ts
// 要一首歌的播放地址、读一个集合的歌曲的请求，自己没有时限的那些在这里得到一个：到点没有回答就算连不上，
// 不然丢包的网络上「正在加载」会一直挂着。哪些请求用它、时限多长，由各平台的 transport 自己决定：时限要比
// 那个平台的后端自己最慢的正常回答还长，原因写在那里。这里不认识任何平台。
// 登录的请求另有它们的时限（login/loginRequestLimit.ts），取消登录时只放掉那些。

// 请求在时限内没有回答。它是 network 的错，onlineFailureCase.ts 把它分成「连不上」。
export class OnlineRequestTimeout extends OnlineProviderError {
    constructor(limitMs: number) {
        super('network', `The request was not answered in ${limitMs / 1000} s`);
        this.name = 'OnlineRequestTimeout';
    }
}

/**
 * 给一个请求加上 `limitMs` 的时限。`run` 拿到的 signal 交给 fetch：到点时请求被中止，并以 OnlineRequestTimeout
 * 失败。在时限内有了结果的，成功和失败都原样交出去。
 */
export const withOnlineRequestLimit = <T>(run: (signal: AbortSignal) => Promise<T>, limitMs: number): Promise<T> => {
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new OnlineRequestTimeout(limitMs));
            controller.abort();
        }, limitMs);
        // `run` 当场抛错也走同一条路：以它的错失败，计时器清掉。
        new Promise<T>(settle => settle(run(controller.signal))).then(resolve, reject).finally(() => clearTimeout(timer));
    });
};
