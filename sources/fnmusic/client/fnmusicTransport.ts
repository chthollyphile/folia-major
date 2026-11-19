import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';

// sources/fnmusic/client/fnmusicTransport.ts
// 飞牛音乐（飞牛 fnOS 官方音乐服务器）的请求：经 folium.rpc 交给 main 入口（main/index.ts 登记的 `request`），那边的
// 桥连用户的 NAS。
//
// 协议说明：见模组 README（迁自 docs/fnmusic-protocol.md）：
//  - 基础路径 {origin}/music/api/v1{path}
//  - 登录 POST /music/api/v1/user/password-login {username, password: sha256(password)}
//    → 响应 {userToken, user}；认证通过 Cookie: music-token={userToken} 携带（不使用 authx 签名头）
//  - 响应信封 {code, msg, data}，code ∈ {0, 200} 为成功；code 120001 = 账号或密码错误
//  - deviceId 由主进程桥复用已存设备或生成，窗口这边不生成（避免每次登录注册新设备）
//
// 安全约定：服务器地址与凭据（token / 密码）全部由主进程加密保存，窗口只发操作（login/request/stream/getStatus），
// 不读写 localStorage，也不在 URL 里携带 base/token。

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

type FnMusicBridgeResult =
    | { ok: true; data: unknown; status?: number }
    | { ok: false; status?: number; error?: { code?: string | number; message?: string } };

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface FnMusicTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: FnMusicTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectFnMusicTransport = (next: FnMusicTransportEnv): void => {
    env = next;
};

const host = (): FnMusicTransportEnv => {
    if (!env) throw new Error('[FnMusic] the transport is not connected (activate has not run)');
    return env;
};

/** A field as text: strings as they are, numbers too (ids may come as numbers); anything else is empty. */
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** An error of the host's with the code the login form and the failure rules read. */
export const fnMusicError = (code: FoliumSourceErrorCode, message: string, cause?: unknown): FoliumSourceError => (
    host().error(code, message, cause === undefined ? undefined : { cause })
);

// Where the bridge itself failed (the main entry threw, or is not there) the error goes up as it is, as the IPC call's
// did before the migration: the login form shows its generic failure. Calling it `network` would send the listener off
// to check the server address, and nothing is wrong with that; the NAS's own unreachability comes back as an answer
// ({ ok: false, error.code: 'network' }), not as a throw.
const call = (operation: string, params: Record<string, unknown>): Promise<FnMusicBridgeResult> => (
    host().call<FnMusicBridgeResult>('request', operation, params)
);

/** 桥状态（base/username 供登录状态读）；读不到回 null。 */
export const fnMusicBridgeStatus = async (): Promise<FnMusicBridgeStatus | null> => {
    try {
        const result = await host().call<FnMusicBridgeResult>('request', 'getStatus', {});
        if (!result.ok || !result.data) return null;
        return result.data as FnMusicBridgeStatus;
    } catch {
        return null;
    }
};

const bridgeError = (result: FnMusicBridgeResult & { ok: false }, operation: string): FoliumSourceError => {
    const msg = result.error?.message || `飞牛音乐 ${operation} 失败`;
    const code = text(result.error?.code);
    const status = result.status ?? 0;
    // 鉴权类失败（HTTP 401/403 或业务码 401/403）：token 过期/失效，界面应提示重新登录。
    if (status === 401 || status === 403 || code === '401' || code === '403' || code === 'auth-required') {
        return fnMusicError('auth-required', `飞牛音乐登录已失效（HTTP ${result.status}），请重新登录`);
    }
    // 飞牛音乐接口业务码：120001 = 账号或密码错误（NAS 账号与音乐独立账号是两套体系，提示用户核对）。
    // 映射为 auth-required：登录表单的 errors 据此显示「账号或密码错误」类提示。
    if (code === '120001') {
        return fnMusicError('auth-required', `账号或密码错误（HTTP ${result.status}）。飞牛支持 NAS 账号与音乐独立账号两种，确认用对了账号类型`);
    }
    if (code === 'network') return fnMusicError('network', msg);
    // 填的服务器地址不成形（主进程规范化之后仍不是 http/https 地址）：登录表单据此提示改地址。
    if (code === 'invalid-base') return fnMusicError('unavailable', msg);
    // 主进程没有保存的服务器与 token：没有登录（或系统加密不可用、重启后丢了），要重新登录。
    if (code === 'unconfigured') return fnMusicError('auth-required', msg);
    if (code && !Number.isNaN(Number(code))) {
        return fnMusicError('invalid-response', `飞牛音乐 ${operation} 业务错误(code=${code}, HTTP ${result.status}): ${msg}`);
    }
    return fnMusicError('invalid-response', msg);
};

/** 发一次请求。path 为完整 API 路径（如 /music/api/v1/album/list）；服务器与凭据由主进程配置提供。 */
export async function fnmusicRequest(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> },
): Promise<unknown> {
    const result = await call('request', { path, method: options?.method ?? 'GET', params, body: options?.body });
    if (!result.ok) throw bridgeError(result, path);
    return result.data;
}

/** 播放地址：主进程回媒体路由 stream 的地址（路由实时转发，URL 不带凭据）。回的是原始文件，不分音质。 */
export async function fnMusicStreamSource(trackId: string): Promise<string> {
    const result = await call('stream', { trackId });
    if (!result.ok) throw bridgeError(result, 'track/stream');
    const url = text((result.data as { url?: unknown } | null)?.url);
    if (!url) throw fnMusicError('not-playable', '飞牛音乐未返回播放地址');
    return url;
}

// The mod's media route for covers (main/index.ts: api.media.serve('cover')). The client has no api.media.url, so the
// address is written out here, in the form the host documents (folia-mod://<mod id>/_media/<name>…). It stays the
// same across restarts, so a song keeps it; the route adds the sign-in when it is read.
const COVER_ROUTE = 'folia-mod://fnmusic/_media/cover';

/** 封面地址：歌曲只携带 coverId，地址在归一化时生成。 */
export function fnMusicCoverUrl(coverId: string, size = 600): string {
    if (!coverId) return '';
    const q = new URLSearchParams({ coverId, size: String(size) });
    return `${COVER_ROUTE}?${q.toString()}`;
}

/**
 * 登录：POST /music/api/v1/user/password-login（密码 SHA-256 由主进程完成）。
 * 成功后凭据由主进程加密保存，本函数只返回用户信息（不含 token）。
 */
export async function fnMusicLogin(config: { base: string; username: string; password: string }): Promise<{ user: unknown }> {
    const result = await call('login', config);
    if (!result.ok) throw bridgeError(result, 'user/password-login');
    const data = result.data as { user?: unknown } | null;
    if (!data?.user) throw fnMusicError('invalid-response', '登录响应缺少用户信息');
    return { user: data.user };
}

/** 登出：主进程调登出接口并清配置。 */
export async function fnMusicLogout(): Promise<void> {
    try {
        await host().call('request', 'logout', {});
    } catch {
        // 登出失败不阻塞
    }
}
