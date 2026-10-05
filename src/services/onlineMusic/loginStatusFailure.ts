import { OnlineProviderError } from '../../types/onlineMusic';
import type { OnlineProviderId, ProviderUser } from '../../types/onlineMusic';

// src/services/onlineMusic/loginStatusFailure.ts
// 登录状态检查抛错后的分流：只有 provider 明确报告鉴权失效才清账号，网络类/未知错误保留缓存账号。

/** 把错误翻译成"登录态确实失效"的判断；只认 provider 归一化后的 auth-required。 */
export const isAuthRequiredFailure = (error: unknown): boolean => (
    error instanceof OnlineProviderError && error.code === 'auth-required'
);

/** 保留缓存账号时写回账号状态的补丁，不含 user/collections，让缓存账号原样留在 store 里。 */
export type LoginStatusKeepPatch = {
    status: 'authenticated' | 'error';
    error: string;
    hydration: 'ready';
    freshness: 'error';
};

export type LoginStatusFailureHandlers = {
    providerId: OnlineProviderId;
    /** 检查开始前 store 里的缓存账号；决定失败后是 authenticated 还是 error。 */
    cachedUser: ProviderUser | null | undefined;
    fallbackMessage: string;
    /** 鉴权失效时调用，参数是写进账号 error 的原因（没有缓存账号时为 undefined）。 */
    clearAuthState: (error?: string) => Promise<void>;
    updateAccount: (patch: LoginStatusKeepPatch) => void;
};

/**
 * 处理 getLoginStatus 抛出的错误并返回 null（等价于未拿到用户）。
 * auth-required：走原有清理路径（omni.logout + 快照清除）；其它错误：只更新 freshness/error，
 * 缓存账号、收藏、快照都不动，下一次刷新会自行恢复。
 */
export const handleLoginStatusFailure = async (
    error: unknown,
    { providerId, cachedUser, fallbackMessage, clearAuthState, updateAccount }: LoginStatusFailureHandlers,
): Promise<null> => {
    const message = error instanceof Error && error.message ? error.message : fallbackMessage;
    const authRequired = isAuthRequiredFailure(error);
    if (authRequired) {
        await clearAuthState(cachedUser ? 'auth-required' : undefined);
    } else {
        updateAccount({
            status: cachedUser ? 'authenticated' : 'error',
            error: message,
            hydration: 'ready',
            freshness: 'error',
        });
    }
    // QQ provider already logs a filtered summary and isolates superseded QR attempts.
    if (providerId !== 'qq') console.warn('[LoginStatus] failure', {
        providerId,
        hadCachedAccount: Boolean(cachedUser),
        authRequired,
        name: error instanceof Error ? error.name : 'Error',
        message,
    });
    return null;
};
