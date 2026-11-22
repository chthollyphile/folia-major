import md5 from 'blueimp-md5';
import source from 'virtual:folia-source/kugou';
import { COVER_HOSTS, createSource } from '../../../../sources/kugou/core';
import { lyricProxyWebUrl } from '../../lyricProxy';
import { registerFoliumWebSource } from './foliumWebSource';

// src/services/onlineMusic/web/kugou.ts
// The web build's source of this platform (web/index.ts): the core's createSource with the web's pieces, registered
// through the adapter like the desktop's mod (foliumWebSource.ts). Requests go to the platform's API deployment at the
// address configured for it (none: the source is listed as not configured), the anonymous search, the legacy play-info
// endpoint and the covers through the lyric proxy (the platform's hosts send no CORS headers).

// The configured address. Unit tests set it on process.env (Vite's own env is fixed when a test file loads).
const getWebApiBase = (): string => (
    (import.meta.env.MODE !== 'test' ? String(import.meta.env.VITE_KUGOU_API_BASE || '') : '')
    || (typeof process !== 'undefined' ? (process.env.VITE_KUGOU_API_BASE || '') : '')
);

/** Registers the source on the web; hands back its host ids. */
export const registerWebSource = (): string[] => registerFoliumWebSource({
    package: source,
    create: env => createSource({ ...env, web: { apiBase: getWebApiBase(), md5: text => md5(text), relayUrl: lyricProxyWebUrl } }),
    proxiedCoverHosts: COVER_HOSTS,
});
