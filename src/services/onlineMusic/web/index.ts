import type { OnlineProviderId } from '../../../types/onlineMusic';
import { registerWebSource as registerKugouWebSource } from './kugou';
import { registerWebSource as registerNeteaseWebSource } from './netease';
import { registerWebSource as registerQqWebSource } from './qq';

// src/services/onlineMusic/web/index.ts
// The web build's sources (Folium 2.0 plan §8). The web build has no mod runtime: it loads no mod and calls no
// `activate`. The three platforms the web build has (netease, kugou, qq) are registered here instead, one file
// each (web/<id>.ts), on the same registry the desktop's source mods reach through the adapter. The other six
// platforms are desktop-only and have no file here.
//
// Each web/<id>.ts builds its platform from sources/<id>/core (createSource with the web env: the HTTP transport on
// VITE_*_API_BASE and the page store providerStorage also reads) and registers it through the adapter, with
// registerFoliumWebSource (foliumWebSource.ts); only this folder may import sources/*/core (Dedicatus rule,
// dev/dedicatus/rules.mjs).
//
// bootstrap.tsx calls registerWebSources() where there is no mod bridge (the web build, and the browser preview on
// the dev server); the desktop gets these platforms from their source mods.

/** One platform of the web build: its id, and how it is registered (again, where it was: the last one stands). */
export interface WebSource {
    id: OnlineProviderId;
    register(): void;
}

/** The web build's platforms, in the order the lists show them (the registry orders them anyway). */
export const WEB_SOURCES: readonly WebSource[] = [
    { id: 'netease', register: () => { registerNeteaseWebSource(); } },
    { id: 'kugou', register: () => { registerKugouWebSource(); } },
    { id: 'qq', register: () => { registerQqWebSource(); } },
];

/** Registers the web build's platforms; hands back the ids it registered. */
export const registerWebSources = (): OnlineProviderId[] => WEB_SOURCES.map((source) => {
    source.register();
    return source.id;
});
