// src/services/lyricProxy.ts

/**
 * The app's own relay for outside hosts a web page cannot fetch directly (QQ and KuGou lyric
 * hosts, the AMLL lyric database, QQ and KuGou cover pictures). This file is the only place in
 * the renderer that knows the relay's web address and its desktop bridge.
 *
 * Server sides, each with its own allow-list of hosts: api/lyric-proxy.js, api-ts/lyric-proxy.ts
 * and worker/lyric-proxy.ts on the web; proxyLyricRequest in electron/main.cjs (IPC
 * lyric-proxy-fetch) on the desktop.
 *
 * It lives in src/services/ because lyric code, a platform's transport and the cover cache all
 * use it, and none of them owns it.
 *
 * Which route a caller takes (the target directly, the web address or the bridge) stays the
 * caller's own choice; this file only names the two relay routes.
 */

type LyricProxyBridge = NonNullable<Window['electron']>['fetchLyricProxy'];

/** The relay's address on the web for one target URL. */
export const lyricProxyWebUrl = (targetUrl: string): string => (
    `/api/lyric-proxy?url=${encodeURIComponent(targetUrl)}`
);

/**
 * Sends one request through the desktop bridge. Returns null, without sending anything, when
 * the bridge is not there (the web, or a desktop preload without it), so the caller can take
 * its other route.
 */
export const requestLyricProxyOnDesktop = (
    ...args: Parameters<LyricProxyBridge>
): ReturnType<LyricProxyBridge> | null => {
    if (typeof window === 'undefined' || !window.electron?.fetchLyricProxy) return null;
    return window.electron.fetchLyricProxy(...args);
};
