// src/services/onlineMusic/spotifyClientId.ts
// 存储键与 providerStorage.getProviderSessionKey('spotify', key) 保持一致；这里不引用 providerStorage，
// 因为它会连带 db.ts 整条依赖链。本模块也不引用 omni/provider：登录弹窗要直接用它，
// 而弹窗经 spotifyProvider -> omni -> providerRegistry 会形成循环导入，注册时拿到 undefined。

export const SPOTIFY_DEFAULT_CLIENT_ID = 'ca5819e5e46b4af5aaaca0e71044214d';
export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:32110/callback';

const SPOTIFY_SESSION_PREFIX = 'online_provider:spotify:';

const spotifySessionKey = (key: string): string => `${SPOTIFY_SESSION_PREFIX}${key}`;

/** 用户自己填的 Client ID，没填过返回空串（界面用，避免把内置默认值抄进输入框） */
export function getCustomSpotifyClientId(): string {
    if (typeof localStorage === 'undefined') return '';
    return (localStorage.getItem(spotifySessionKey('client_id')) || '').trim();
}

/** 本次登录实际使用的 Client ID：用户填过用用户的，否则回退内置默认值 */
export function getSpotifyClientId(): string {
    return getCustomSpotifyClientId() || SPOTIFY_DEFAULT_CLIENT_ID;
}

/**
 * 保存用户的 Client ID，并清掉旧令牌
 * refresh_token 与 client id 绑定，换 id 后旧令牌必然刷新失败，必须重新走一次授权
 */
export function setSpotifyClientId(clientId: string): void {
    if (typeof localStorage === 'undefined') return;
    const trimmed = clientId.trim();
    if (trimmed) {
        localStorage.setItem(spotifySessionKey('client_id'), trimmed);
    } else {
        localStorage.removeItem(spotifySessionKey('client_id'));
    }
    localStorage.removeItem(spotifySessionKey('access_token'));
    localStorage.removeItem(spotifySessionKey('refresh_token'));
    localStorage.removeItem(spotifySessionKey('expires_at'));
}
