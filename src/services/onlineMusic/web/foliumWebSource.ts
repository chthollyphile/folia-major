import i18n from '../../../i18n/config';
import type { ModRuntimeInfo } from '../../../mods/types';
import type {
    FoliumSourceDef,
    FoliumSourceError,
    FoliumSourceErrorCode,
    FoliumSourceErrorDetails,
    FoliumSourceHandle,
    FoliumSourcePageStore,
    FoliumText,
} from '../../../mods/folium/sources/contract';
import { createFoliumPageStore, registerFoliumSource } from '../../../mods/folium/registries/sources';
import { foliumModTextNamespace } from '../../../mods/folium/registries/sourceText';
import { createFoliumI18n } from '../../../mods/folium/sources/i18n';
import { createFoliumSourceError } from '../../../mods/folium/sources/errors';
import { FOLIUM_LYRICS_HELPERS } from '../../../mods/folium/sharedHelpers';
import { markFoliumSourceMod } from '../../../mods/runtime/guard';
import { registerCoverUrlRule } from '../../../utils/coverUrl';

// src/services/onlineMusic/web/foliumWebSource.ts
// How the web build registers a platform that has moved to sources/<id>/ (Folium 2.0 plan §8). The web build loads no
// mod and calls no `activate`: web/<id>.ts hands this helper the mod's package (its mod.json and locales, the Vite
// virtual module `virtual:folia-source/<id>`, dev/sources/webSourcePlugin.mjs) and a `create(env)` that calls the
// platform's `sources/<id>/core` createSource with the web's transport. The helper then does what the mod runtime
// does on the desktop for a built-in source mod: the locales go into the mod's i18n namespace (`folium-mod/<id>`, so the
// source's FoliumTexts read as they do on the desktop), the definition is registered through the same adapter
// (registerFoliumSource), under the short id the trusted table gives a built-in source.
//
// The env it hands `create` is the one the desktop's client builds from `folium` (and the unit tests' builtinSources.ts
// builds too), less `call`: there is no main entry on the web, so a call to it rejects. The platform's core takes the
// web transport instead (passed by web/<id>.ts).
//
// Usage (every platform of the web build alike, `<id>` its id):
//
//   import source from 'virtual:folia-source/<id>';
//   import { createSource } from '../../../../sources/<id>/core';
//   registerFoliumWebSource({ package: source, create: (env) => createSource({ ...env, web: { … } }) });
//
// `proxiedCoverHosts`: the picture hosts that send no CORS headers, whose covers the web build fetches through the lyric
// proxy (coverCache.ts). A source's covers@1 cannot say that (it has no such member): the helper adds a cover rule
// that says only that.

/** A source mod's manifest as the web build reads it (sources/<id>/mod.json). */
export interface WebSourceManifest {
    id: string;
    name: string;
    version: string;
    sources: Array<{ id: string; name: string | Record<string, string>; requires?: string[]; keepForMatching?: boolean }>;
    [field: string]: unknown;
}

/** `virtual:folia-source/<id>`: the mod's manifest and its locales (zh-TW made from zh-CN). */
export interface WebSourcePackage {
    manifest: WebSourceManifest;
    locales: Record<string, Record<string, unknown>>;
}

/** What `create` is handed: the desktop client's env, made of the host's own pieces. */
export interface WebSourceEnv {
    modId: string;
    /** There is no main entry on the web: always rejects. */
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    text(key: string, params?: Record<string, string | number>): FoliumText;
    translate(key: string, params?: Record<string, string | number>): string;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
    isPureMusicText(text: string | null | undefined): boolean;
    pageStore(sourceId: string): FoliumSourcePageStore;
}

export interface FoliumWebSource {
    package: WebSourcePackage;
    create: (env: WebSourceEnv) => FoliumSourceDef | FoliumSourceDef[];
    /** Picture hosts (`host` or `*.domain`) fetched through the lyric proxy on the web. */
    proxiedCoverHosts?: readonly string[];
}

// What one registration put in place, taken out before the next one of the same mod (registerWebSources may run again).
const registered = new Map<string, () => void>();

const hostMatcher = (hosts: readonly string[]): ((url: URL) => boolean) => {
    const exact = new Set(hosts.filter((host) => !host.startsWith('*.')).map((host) => host.toLowerCase()));
    const suffixes = hosts.filter((host) => host.startsWith('*.')).map((host) => host.slice(1).toLowerCase());
    return (url) => exact.has(url.hostname) || suffixes.some((suffix) => url.hostname.endsWith(suffix));
};

/** The mod as the adapter is told of it: a built-in source mod, loaded, every source of its manifest enabled. */
const runtimeInfoOf = (manifest: WebSourceManifest): ModRuntimeInfo => ({
    id: manifest.id, name: manifest.name, version: manifest.version, author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'builtin', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
    folium: 2, tier: 'builtin', kind: 'source', contexts: null, locales: 'locales',
    // A built-in source keeps the short id of its row in the trusted table, which is its own local id.
    sources: manifest.sources.map((source) => ({
        id: source.id, localId: source.id, name: source.name, state: 'enabled',
        keepForMatching: source.keepForMatching === true, takeover: false, requires: source.requires ?? [],
    })),
});

/** Registers a moved platform on the web; hands back the host ids of its sources. */
export const registerFoliumWebSource = ({ package: source, create, proxiedCoverHosts }: FoliumWebSource): string[] => {
    const { manifest, locales } = source;
    const modId = manifest.id;
    registered.get(modId)?.();

    const namespace = foliumModTextNamespace(modId);
    Object.entries(locales).forEach(([language, texts]) => {
        i18n.addResourceBundle(language, namespace, texts, true, true);
    });
    const texts = createFoliumI18n((key, params) => i18n.t(`${namespace}:${key}`, { ...params, defaultValue: '' }));
    const env: WebSourceEnv = {
        modId,
        call: (name) => Promise.reject(new Error(`[web] ${modId}: no main entry on the web for ${name}`)),
        text: (key, params) => texts.key(key, params),
        translate: (key, params) => texts.text(key, params),
        error: createFoliumSourceError,
        isPureMusicText: (text) => FOLIUM_LYRICS_HELPERS.isPureMusicText(text ?? null),
        pageStore: createFoliumPageStore,
    };

    markFoliumSourceMod(modId, true);
    const mod = runtimeInfoOf(manifest);
    const defs = create(env);
    const handles: FoliumSourceHandle[] = (Array.isArray(defs) ? defs : [defs])
        .map((def) => registerFoliumSource({ mod, stopped: () => false }, def));
    const undoCovers = proxiedCoverHosts?.length ? registerCoverUrlRule({
        provider: modId,
        sized: () => null,
        identity: () => null,
        original: () => null,
        requestedSize: () => undefined,
        proxiedOnWeb: hostMatcher(proxiedCoverHosts),
    }) : null;
    registered.set(modId, () => {
        registered.delete(modId);
        undoCovers?.();
        handles.forEach((handle) => { handle.unregister(); });
    });
    return handles.map((handle) => handle.id);
};
