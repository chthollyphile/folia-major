import source from 'virtual:folia-source/netease';
import { createSource } from '../../../../sources/netease/core';
import { registerFoliumWebSource } from './foliumWebSource';

// src/services/onlineMusic/web/netease.ts
// The web build's source of this platform (web/index.ts): the core's createSource with the web's pieces, registered
// through the adapter like the desktop's mod (foliumWebSource.ts). Requests go to the platform's API deployment at the
// address configured for it (none: requests fail as not configured).

// The configured address. Unit tests set it on process.env (Vite's own env is fixed when a test file loads).
const getWebApiBase = (): string => (
    (import.meta.env.MODE !== 'test' ? String(import.meta.env.VITE_NETEASE_API_BASE || '') : '')
    || (typeof process !== 'undefined' ? (process.env.VITE_NETEASE_API_BASE || '') : '')
);

/** Registers the source on the web; hands back its host ids. */
export const registerWebSource = (): string[] => registerFoliumWebSource({
    package: source,
    create: env => createSource({ ...env, web: { apiBase: getWebApiBase() } }),
});
