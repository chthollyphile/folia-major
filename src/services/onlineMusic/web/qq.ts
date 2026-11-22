import source from 'virtual:folia-source/qq';
import { createSource, PROXIED_COVER_HOSTS } from '../../../../sources/qq/core';
import { lyricProxyWebUrl } from '../../lyricProxy';
import { registerFoliumWebSource } from './foliumWebSource';

// src/services/onlineMusic/web/qq.ts
// The web build's source of this platform (web/index.ts): the core's createSource with the web's pieces, registered
// through the adapter like the desktop's mod (foliumWebSource.ts). Requests go to the platform's API deployment at the
// address configured for it (none: the source is listed as not configured); lyrics and song details go through the
// lyric proxy, and so do the album covers (their host sends no CORS headers).

// The configured address. Unit tests set it on process.env (Vite's own env is fixed when a test file loads).
const getWebApiBase = (): string => (
    (import.meta.env.MODE !== 'test' ? String(import.meta.env.VITE_QQ_API_BASE || '') : '')
    || (typeof process !== 'undefined' ? (process.env.VITE_QQ_API_BASE || '') : '')
);

/** Registers the source on the web; hands back its host ids. */
export const registerWebSource = (): string[] => registerFoliumWebSource({
    package: source,
    create: env => createSource({ ...env, web: { apiBase: getWebApiBase(), relayUrl: lyricProxyWebUrl } }),
    proxiedCoverHosts: PROXIED_COVER_HOSTS,
});
