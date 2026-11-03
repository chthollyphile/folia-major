import { OnlineProviderError } from '../../../types/onlineMusic';
import { readProviderSessionValue, writeProviderSessionValue } from '../providerStorage';
import { hasQqSession, requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqSessionRefresh.ts
// 会话的续期。Serverless 的会话（sealed）就装在 token 里，大约 3 天到期；
// 后端的 `POST /login/refresh` 在离到期不到 6 小时时会换一个新 token（rotated: true），从第一次扫码算起最多续到 30 天。
// 不续的话就是 3 天左右要重扫一次。桌面版、Docker 这类 stored 后端在同一个 token 下静默续期（回答 rotated: false），
// 但只在离到期不到 6 小时、又正好有请求进来时续：那 6 小时里一个请求都没有，会话就到期被删了。所以对它也照样每小时问一次。

// 隔多久问一次。离到期 6 小时以上时后端不会去找 QQ，问一次很便宜；一小时一次足够赶上那 6 小时的窗口。
export const QQ_SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

const SESSION_COOKIE_NAME = 'qqmusic_session';

let timer: ReturnType<typeof setInterval> | null = null;
let lastAttemptAt = 0;
let running: Promise<void> | null = null;
// 后端没有这条路由（旧版本）：一个页面的生命周期里不会变，探到 404 就不再问。
let routeMissing = false;

const storedSession = (): string => readProviderSessionValue('qq', 'cookie') || '';

const refreshOnce = async (): Promise<void> => {
    if (routeMissing || !hasQqSession()) return;
    const sent = storedSession();
    lastAttemptAt = Date.now();
    try {
        const response = await requestQq<any>('login_refresh', {}, {});
        const data = response?.data;
        if (data?.rotated !== true) return;
        const token = typeof data.token === 'string' ? data.token.trim() : '';
        // 等回答的这段时间里退出了或换了账号：新 token 是刚才那个会话的，不能盖掉现在存的。
        if (!token || /[;\s]/.test(token) || storedSession() !== sent) return;
        writeProviderSessionValue('qq', 'cookie', `${SESSION_COOKIE_NAME}=${token}`);
        console.info('[QQProvider] session-refresh:rotated');
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'unsupported') {
            routeMissing = true;
            return;
        }
        // 旧 token 照原来的到期时间还能用，这次没续上只是等下一次。401 时会话也不马上清：transport 问一次 login_status，由它说了算。
        console.warn('[QQProvider] session-refresh:failed', error);
    }
};

/** 问一次续期；同一时间只有一个请求在路上。 */
export const refreshQqSession = (): Promise<void> => {
    running ??= refreshOnce().finally(() => { running = null; });
    return running;
};

/**
 * 确认登录还在之后调用：距上次问超过一个间隔就马上问一次，并开始每个间隔问一次；会话没了就停。
 * 不看会话存法：sealed 与 stored 都要在到期前问到（见文件开头）；没有这条路由的旧后端第一次就探到 404，之后不再问。
 * 读账号的时机（启动、回到窗口）会反复调用它，重复调用不会多发请求。
 */
export const keepQqSessionFresh = (): void => {
    if (!timer) {
        timer = setInterval(() => {
            if (!hasQqSession()) {
                stopQqSessionRefresh();
                return;
            }
            void refreshQqSession();
        }, QQ_SESSION_REFRESH_INTERVAL_MS);
    }
    if (Date.now() - lastAttemptAt >= QQ_SESSION_REFRESH_INTERVAL_MS) void refreshQqSession();
};

/** 退出登录时停掉定时续期。 */
export const stopQqSessionRefresh = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    lastAttemptAt = 0;
};

/** 测试用：模块级状态跨用例要能清掉。 */
export const resetQqSessionRefresh = (): void => {
    stopQqSessionRefresh();
    running = null;
    routeMissing = false;
};
