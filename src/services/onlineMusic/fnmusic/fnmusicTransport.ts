import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/fnmusic/fnmusicTransport.ts
// 飞牛音乐（飞牛 fnOS 官方音乐服务器）协议客户端（仅桌面端渲染层）。
//
// 协议说明：见 docs/fnmusic-protocol.md：
//  - 基础路径 {origin}/music/api/v1{path}
//  - 登录 POST /music/api/v1/user/password-login {username, password: sha256(password)}
//    → 响应 {userToken, user}；认证通过 Cookie: music-token={userToken} 携带（不再使用 authx 签名头）
//  - 响应信封 {code, msg, data}，code ∈ {0, 200} 为成功；code 120001 = 账号或密码错误
//  - deviceId 由主进程桥复用已存设备或生成，渲染层不再生成（避免每次登录注册新设备）
//
// 安全约定：服务器地址与凭据（token / 密码）全部由主进程 safeStorage 加密保存，
// 渲染进程只发操作（login/request/stream/coverUrl），不读写 localStorage，也不在
// URL 里携带 base/token。非 Electron 环境（网页/Docker）不可用（Cookie 受限头与
// CORS 使直连不可行），由 provider 的 getAvailability 返回 runtime-unavailable。

export type FnMusicBridgeParams =
    | { base: string; username: string; password: string }              // login（deviceId 由主进程复用已存值）
    | { path: string; method: 'GET' | 'POST'; params?: Record<string, string | number | boolean | undefined>; body?: Record<string, unknown> } // request
    | { trackId: string }                                                      // stream
    | { coverId: string; size?: number }                                       // coverUrl
    | {};                                                                      // logout / getStatus

export type FnMusicBridgeResult =
    | { ok: true; data: unknown; status?: number }
    | { ok: false; status?: number; error?: { code?: string | number; message?: string } };

export interface FnMusicBridgeStatus {
    available: boolean;
    configured: boolean;
    authenticated: boolean;
    base: string | null;
    username: string | null;
    /** 登录答复里 user 的 guid 和昵称（登录时存下）。 */
    userId: string | null;
    nickname: string | null;
}

const text = (value: unknown): string => (value == null ? '' : String(value));

const hasElectronBridge = (): boolean => typeof window !== 'undefined' && Boolean((window as any).electron?.fnmusicRequest);

/** 异步查询桥状态（base/username 供登录表单回填）。走异步 IPC（getStatus），不阻塞渲染主线程。 */
export const fnMusicBridgeStatus = async (): Promise<FnMusicBridgeStatus | null> => {
    if (!hasElectronBridge()) return null;
    try {
        const result = await (window as any).electron.fnmusicRequest('getStatus', {} as FnMusicBridgeParams) as FnMusicBridgeResult;
        if (!result.ok || !result.data) return null;
        return result.data as FnMusicBridgeStatus;
    } catch {
        return null;
    }
};

const bridgeError = (result: FnMusicBridgeResult & { ok: false }, operation: string): OnlineProviderError => {
    const msg = result.error?.message || `飞牛音乐 ${operation} 失败`;
    const code = text(result.error?.code);
    const status = Number(result.status ?? 0);
    // 鉴权类失败（HTTP 401/403 或业务码 401/403）：token 过期/失效，界面应提示重新登录。
    if (status === 401 || status === 403 || code === '401' || code === '403' || code === 'auth-required') {
        return new OnlineProviderError('auth-required', `飞牛音乐登录已失效（HTTP ${result.status}），请重新登录`, 'fnmusic');
    }
    // 飞牛音乐接口业务码：120001 = 账号或密码错误（NAS 账号与音乐独立账号是两套体系，提示用户核对）。
    // 映射为 auth-required：provider 的 errorKeys 与登录表单据此显示「账号或密码错误」类提示。
    if (code === '120001') {
        return new OnlineProviderError('auth-required', `账号或密码错误（HTTP ${result.status}）。飞牛支持 NAS 账号与音乐独立账号两种，确认用对了账号类型`, 'fnmusic');
    }
    if (code === 'network') return new OnlineProviderError('network', msg, 'fnmusic');
    // 填的服务器地址不成形（主进程规范化之后仍不是 http/https 地址）：登录表单据此提示改地址。
    if (code === 'invalid-base') return new OnlineProviderError('unavailable', msg, 'fnmusic');
    // 主进程没有保存的服务器与 token：没有登录（或系统加密不可用、重启后丢了），要重新登录。
    if (code === 'unconfigured') return new OnlineProviderError('auth-required', msg, 'fnmusic');
    if (code && !Number.isNaN(Number(code))) {
        return new OnlineProviderError('invalid-response', `飞牛音乐 ${operation} 业务错误(code=${code}, HTTP ${result.status}): ${msg}`, 'fnmusic');
    }
    return new OnlineProviderError('invalid-response', msg, 'fnmusic');
};

/**
 * 发一次请求。path 为完整 API 路径（如 /music/api/v1/album/list）。
 * 仅 Electron 桌面端可用：服务器与凭据由主进程配置提供，渲染进程只传操作。
 */
export async function fnmusicRequest<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal },
): Promise<T> {
    if (!hasElectronBridge()) {
        throw new OnlineProviderError('unavailable', '飞牛音乐仅支持桌面端（需主进程桥）', 'fnmusic');
    }
    const result = await (window as any).electron.fnmusicRequest('request', {
        path, method: options?.method ?? 'GET', params, body: options?.body,
    } as FnMusicBridgeParams) as FnMusicBridgeResult;
    if (!result.ok) throw bridgeError(result, path);
    return result.data as T;
}

/** 播放地址：主进程返回 folia-fnmusic:// 协议 URL（协议 handler 实时转发，URL 不带凭据）。回的是原始文件，不分音质。 */
export async function fnMusicStreamSource(trackId: string): Promise<string> {
    if (!hasElectronBridge()) {
        throw new OnlineProviderError('unavailable', '飞牛音乐仅支持桌面端（需主进程桥）', 'fnmusic');
    }
    const result = await (window as any).electron.fnmusicRequest('stream', { trackId } as FnMusicBridgeParams) as FnMusicBridgeResult;
    if (!result.ok) throw bridgeError(result, 'track/stream');
    const data = result.data as { url?: string } | null;
    const url = text(data?.url);
    if (!url) throw new OnlineProviderError('not-playable', '飞牛音乐未返回播放地址', 'fnmusic');
    return url;
}

/**
 * 封面地址：歌曲对象只携带 coverId，显示时生成 folia-fnmusic:// 协议 URL
 * （协议地址稳定，重启不变；主进程协议 handler 实时转发并携带认证）。
 */
export function fnMusicCoverUrl(coverId: string, size = 600): string {
    if (!coverId) return '';
    const q = new URLSearchParams({ coverId, size: String(size) });
    return `folia-fnmusic://cover?${q.toString()}`;
}

/**
 * 登录：POST /music/api/v1/user/password-login（密码 SHA-256 由主进程完成）。
 * 成功后凭据由主进程加密保存，本函数只返回用户信息（不含 token）。
 * deviceId 不在渲染层生成：主进程桥复用已存设备或生成（避免每次登录注册新设备）。
 */
export async function fnMusicLogin(config: { base: string; username: string; password: string }): Promise<{ user: unknown }> {
    if (!hasElectronBridge()) {
        throw new OnlineProviderError('unavailable', '飞牛音乐仅支持桌面端（需主进程桥）', 'fnmusic');
    }
    const result = await (window as any).electron.fnmusicRequest('login', config as FnMusicBridgeParams) as FnMusicBridgeResult;
    if (!result.ok) throw bridgeError(result, 'user/password-login');
    const data = result.data as { user?: unknown } | null;
    if (!data?.user) throw new OnlineProviderError('invalid-response', '登录响应缺少用户信息', 'fnmusic');
    return { user: data.user };
}

/** 登出：主进程调登出接口并清配置、停代理。 */
export async function fnMusicLogout(): Promise<void> {
    if (!hasElectronBridge()) return;
    try {
        await (window as any).electron.fnmusicRequest('logout', {} as FnMusicBridgeParams);
    } catch {
        // 登出失败不阻塞
    }
}
