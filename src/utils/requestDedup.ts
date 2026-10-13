// src/utils/requestDedup.ts
// 请求去重：相同 URL 的并发请求只发一次，其他调用方共享同一个 Promise。
// 请求完成（成功或失败）后自动从 Map 移除，让后续请求能正常发起。

const inflight = new Map<string, Promise<unknown>>();

export const dedupedRequest = <T>(key: string, factory: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = factory()
        .catch(error => {
            inflight.delete(key);
            throw error;
        })
        .then(value => {
            inflight.delete(key);
            return value;
        });

    inflight.set(key, promise);
    return promise;
};
