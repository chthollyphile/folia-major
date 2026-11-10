// src/services/onlineMusic/account/answeredWithin.ts
// The time limit for a request made to a platform while an account is read. A request that never
// answers would otherwise hold what waits for it until restart.

/**
 * What `request` answers, or a failure once `ms` have passed without an answer. An answer that
 * comes after that reaches nobody.
 */
export const answeredWithin = <T>(request: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms);
    request.then(resolve, reject).finally(() => clearTimeout(timer));
});
