// src/services/onlineMusic/lxmusic/lxPreferences.ts
//
// 洛雪播放路由偏好。用户在「音源」页能改，改动立刻生效（下一次取地址就按新值走）。
// 用 localStorage 而不是 IndexedDB：这两个开关要在取地址的第一行同步读到，不能等异步打开数据库。

const STORAGE_KEY = 'lxmusic_preferences_v1';

export interface LxPreferences {
    /** 所有在线歌曲（包括其它 provider 来源的）取地址时，都先问导入的音源。 */
    routeAllSongs: boolean;
    /** 音源全军覆没时，允许用公开免费直链兜底；它永远不参与首轮竞速。 */
    allowPublicFallback: boolean;
}

const DEFAULTS: LxPreferences = {
    routeAllSongs: true,
    allowPublicFallback: true,
};

const read = (): LxPreferences => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        const parsed = JSON.parse(raw) as Partial<LxPreferences>;
        return {
            routeAllSongs: typeof parsed.routeAllSongs === 'boolean' ? parsed.routeAllSongs : DEFAULTS.routeAllSongs,
            allowPublicFallback: typeof parsed.allowPublicFallback === 'boolean'
                ? parsed.allowPublicFallback
                : DEFAULTS.allowPublicFallback,
        };
    } catch {
        return { ...DEFAULTS };
    }
};

let current: LxPreferences = read();
const listeners = new Set<() => void>();

/** 每次都给一份副本，免得调用方直接改到内部状态。 */
export const getLxPreferences = (): LxPreferences => ({ ...current });

export const setLxPreferences = (patch: Partial<LxPreferences>): LxPreferences => {
    current = { ...current, ...patch };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // 存不下就只在这一次会话里生效。
    }
    listeners.forEach((listener) => listener());
    return { ...current };
};

export const subscribeLxPreferences = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
