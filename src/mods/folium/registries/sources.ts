import type { OnlineMusicProvider, ProviderNotice } from '@/types/onlineMusic';
import { declareSource } from '@/services/onlineMusic/sourceDeclarations';
import { getLyricSource, registerLyricSource } from '@/utils/lyrics/lyricSources';
import { registerCoverUrlRule } from '@/utils/coverUrl';
import type { ModRuntimeInfo } from '../../types';
import type { FoliumSourceDef, FoliumSourceHandle, FoliumSourceNotice } from '../sources/contract';
import { createFoliumSourceTextBook, isFoliumText } from './sourceText';
import type { SourceAdapterContext } from './sourceAdapter/kit';
import { deriveFoliumSourceCapabilities, deriveFoliumSourceDeclaration, readFoliumSourceParts } from './sourceAdapter/parts';
import { buildFoliumSourceProvider } from './sourceAdapter/provider';
import type { FoliumHostRegistry, FoliumRegistryEntry } from '../../runtime/registry';
import { reportFoliumIssue } from '../../runtime/status';
import { createFoliumListeners } from '../../runtime/listeners';
import { foliumProviderId } from '../omni/providerIds';
import { holdFoliumProvider, releaseFoliumProvider } from './heldProviders';

// src/mods/folium/registries/sources.ts
// Folium 2.0 (plan §3, §4): the registry of `folium.sources`. A source's definition is adapted to the host's
// internal provider contract (src/types/onlineMusic.ts) by ./sourceAdapter/ (parts.ts reads its capabilities,
// provider.ts builds the provider, one file a family of capabilities); omni, the account layer and every screen
// keep talking to an OnlineMusicProvider, and the source mod only ever sees the public DTOs.
//
// Beside the provider a source puts in place what the host's cross-source features read: its declarations
// (`access`, `metadataMatch`, sourceDeclarations.ts), a lyric source entry for `lyrics@1.crossSource`
// (lyricSources.ts) and a cover rule for `covers@1` (coverUrl.ts). `handle.changed()` reads it all again and
// puts it in place over what was there.
//
// The table of mod-held provider ids (heldProviders.ts) is shared with the experimental `omni.providers`, which
// registers its sources through it: one id, one mod, whichever surface it came through.

export { buildFoliumSourceProvider, deriveFoliumSourceCapabilities, deriveFoliumSourceDeclaration, readFoliumSourceParts };
export { createFoliumPageStore } from './sourcePageStore';
export { getFoliumProviderHolder, getFoliumSourceCapability, holdFoliumProvider, releaseFoliumProvider, type FoliumProviderOrigin } from './heldProviders';

/** One registered source: its definition and what the adapter made of it. */
interface FoliumSourceEntry {
    modId: string;
    localId: string;
    hostId: string;
    def: FoliumSourceDef;
    context: SourceAdapterContext;
    /** What apply() put in place beside the provider (declarations, lyric source, cover rule), taken out by retract(). */
    undo: Array<() => void>;
    /** The provider held for it now. */
    provider: OnlineMusicProvider | null;
    /** It registered the lyric source entry of its id (one the host had of that id is never replaced). */
    ownsLyricSource: boolean;
    warned: Set<string>;
}

const entries = new Map<string, FoliumSourceEntry>();
const listeners = createFoliumListeners('sources listener');
let snapshot: readonly FoliumRegistryEntry<FoliumSourceEntry>[] = Object.freeze([]);

const notify = () => {
    snapshot = Object.freeze(Array.from(entries.values(), (entry) => ({ id: entry.hostId, modId: entry.modId, name: entry.localId, def: entry })));
    listeners.notify();
};

const warnOnce = (entry: FoliumSourceEntry, message: string) => {
    if (entry.warned.has(message)) return;
    entry.warned.add(message);
    // The mod's row keeps one issue a place: each capability left out is a place of its own.
    const at = message.indexOf(':');
    reportFoliumIssue(entry.modId, `source ${entry.hostId} ${at > 0 ? message.slice(0, at) : ''}`.trim(), message);
};

const runUndo = (entry: FoliumSourceEntry, steps: Array<() => void>) => {
    steps.reverse().forEach((step) => {
        try {
            step();
        } catch (error) {
            console.warn(`[Folium] source ${entry.hostId} of ${entry.modId}: taking it out failed`, error);
        }
    });
};

/* Takes the whole source out: what is beside the provider, then the provider. */
const retract = (entry: FoliumSourceEntry) => {
    runUndo(entry, entry.undo.splice(0));
    if (entry.provider) releaseFoliumProvider(entry.provider);
    entry.provider = null;
};

/*
 * Puts the source in place, or in place again after handle.changed(). The new pieces go in over the old ones (the
 * provider, its declaration and its lyric source are replaced where they stand, so nothing that lists them sees
 * the source go and come back), and only then are the old ones taken out: their undo does nothing to a piece
 * replaced already. The provider is held first: when its id is another's, nothing else is put in place.
 * A lyric source entry the host has of the same id (AMLL DB's, a built-in platform's) is left as it is: the
 * source's lyrics then match as that entry says, and taking the source out leaves the entry there.
 */
const apply = (entry: FoliumSourceEntry) => {
    const parts = readFoliumSourceParts(entry.modId, entry.def.capabilities, (message) => { warnOnce(entry, message); });
    const provider = buildFoliumSourceProvider(entry.context, entry.def, parts);
    const declaration = deriveFoliumSourceDeclaration(entry.def, parts);
    holdFoliumProvider(entry.modId, 'sources', provider, parts.custom);
    entry.provider = provider;
    const old = entry.undo.splice(0);
    const fresh: Array<() => void> = [];
    fresh.push(declareSource(entry.hostId, declaration));
    const othersLyricSource = !entry.ownsLyricSource && getLyricSource(entry.hostId) !== undefined;
    if (declaration.lyrics?.crossSource && othersLyricSource) {
        warnOnce(entry, `lyrics@1.crossSource: the host has a lyric source "${entry.hostId}" already, which is kept as it is`);
    }
    entry.ownsLyricSource = Boolean(declaration.lyrics?.crossSource) && !othersLyricSource;
    if (declaration.lyrics?.crossSource && entry.ownsLyricSource) {
        fresh.push(registerLyricSource({
            id: entry.hostId,
            labelKey: provider.shortNameKey ?? entry.hostId,
            platform: true,
            ...(declaration.lyrics.access === 'account' ? { needsAccount: true } : {}),
            ...(declaration.checksAvailability ? { needsConfiguredProvider: true } : {}),
            ...(declaration.lyrics.crossSource.linesOnly ? { linesOnly: true } : {}),
            ...(declaration.songs?.metadataMatch ? { localMetadataIdentity: true } : {}),
        }));
    }
    if (parts.covers) {
        const covers = parts.covers;
        const ownsHost = coverHostMatcher(covers.hosts);
        const original = covers.original?.bind(covers);
        const requestedSize = covers.requestedSize?.bind(covers);
        // The rules share one URL object on the covers' hot path; a source's member gets a copy, and only for a URL
        // on its own hosts (covers@1 `hosts`).
        fresh.push(registerCoverUrlRule({
            provider: entry.hostId,
            sized: (url, size) => (ownsHost(url) ? covers.sized(new URL(url.href), size) : null),
            identity: (url) => (ownsHost(url) ? covers.identity(new URL(url.href)) : null),
            original: (url) => (original && ownsHost(url) ? original(new URL(url.href)) : null),
            requestedSize: (url) => (requestedSize && ownsHost(url) ? requestedSize(new URL(url.href)) : undefined),
        }));
    }
    entry.undo.push(...fresh);
    runUndo(entry, old);
};

/*
 * covers@1 `hosts` as a test of a URL: a name matches itself; `*.domain` matches the hosts under domain. A list
 * that is not one of strings matches nothing, so the source's rule is never asked.
 */
const coverHostMatcher = (hosts: unknown): ((url: URL) => boolean) => {
    const names = Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === 'string' && host.length > 0) : [];
    const exact = new Set(names.filter((host) => !host.startsWith('*.')).map((host) => host.toLowerCase()));
    const suffixes = names.filter((host) => host.startsWith('*.')).map((host) => host.slice(1).toLowerCase());
    return (url) => exact.has(url.hostname) || suffixes.some((suffix) => url.hostname.endsWith(suffix));
};

const remove = (hostId: string) => {
    const entry = entries.get(hostId);
    if (!entry) return;
    entries.delete(hostId);
    retract(entry);
    entry.context.text.dispose();
    notify();
};

/** What `folium.sources.register` needs of the activation that calls it. */
export interface FoliumSourceRegistration {
    mod: ModRuntimeInfo;
    /** Refuses the call after a teardown (api.ts). */
    stopped: (what: string) => boolean;
}

const inertHandle = (hostId: string): FoliumSourceHandle => Object.freeze({
    id: hostId,
    unregister: () => {},
    changed: () => {},
    notify: () => {},
});

/** The host id of a manifest source `localId` of `mod`: as the main process resolved it, or the mod-prefixed one. */
export const foliumSourceHostId = (mod: Pick<ModRuntimeInfo, 'id' | 'sources'>, localId: string): string | null => {
    const declared = mod.sources?.find((source) => source.localId === localId);
    if (declared) return declared.id;
    return mod.sources === undefined ? foliumProviderId(`${mod.id}:${localId}`) : null;
};

/* The definition as a mod hands it: checked field by field, for it is a mod's JavaScript, whatever its types say. */
const checkDefinition = (value: unknown): FoliumSourceDef => {
    if (typeof value !== 'object' || value === null) throw new TypeError('sources.register requires a source definition');
    const def = value as Record<string, unknown>;
    if (typeof def.id !== 'string' || !def.id) throw new TypeError('sources.register: id must be the id of a source in mod.json');
    if (!isFoliumText(def.displayName)) throw new TypeError('sources.register: displayName must be a FoliumText');
    if (def.shortName !== undefined && !isFoliumText(def.shortName)) throw new TypeError('sources.register: shortName must be a FoliumText');
    if (typeof def.capabilities !== 'object' || def.capabilities === null) throw new TypeError('sources.register: capabilities must be an object');
    return value as FoliumSourceDef;
};

const noticeOf = (entry: FoliumSourceEntry, value: unknown): ProviderNotice | null => {
    if (typeof value !== 'object' || value === null) return null;
    const notice = value as Record<string, unknown>;
    const textKey = isFoliumText(notice.text) ? entry.context.text.key(notice.text, 'notice.text') : undefined;
    if (!textKey) return null;
    return {
        type: notice.type === 'error' || notice.type === 'success' ? notice.type : 'info',
        textKey,
        ...(typeof notice.nonce === 'number' && Number.isFinite(notice.nonce) ? { nonce: notice.nonce } : {}),
        ...(typeof notice.durationMs === 'number' && Number.isFinite(notice.durationMs) ? { durationMs: notice.durationMs } : {}),
    };
};

/** `folium.sources.register` for one activation. */
export const registerFoliumSource = ({ mod, stopped }: FoliumSourceRegistration, given: unknown): FoliumSourceHandle => {
    const def = checkDefinition(given);
    const hostId = foliumSourceHostId(mod, def.id);
    if (!hostId) throw new Error(`sources.register: "${def.id}" is not a source of this mod's mod.json`);
    if (stopped('sources.register')) return inertHandle(hostId);
    const declared = mod.sources?.find((source) => source.localId === def.id);
    if (declared?.state === 'disabled') {
        console.info(`[Folium] source ${hostId} of ${mod.id} is turned off: not registered`);
        return inertHandle(hostId);
    }
    if (entries.has(hostId)) throw new Error(`sources.register: "${hostId}" is registered already`);

    const entry: FoliumSourceEntry = {
        modId: mod.id,
        localId: def.id,
        hostId,
        def,
        context: { modId: mod.id, hostId, text: createFoliumSourceTextBook(mod.id, hostId), tells: new Set() },
        undo: [],
        provider: null,
        ownsLyricSource: false,
        warned: new Set(),
    };
    try {
        apply(entry);
    } catch (error) {
        entry.context.text.dispose();
        throw new Error(`sources.register: ${error instanceof Error ? error.message : 'the source could not be put in place'}`, { cause: error });
    }
    entries.set(hostId, entry);
    notify();
    console.info(`[Folium] source ${hostId} of ${mod.id} registered (${Object.keys(def.capabilities).join(', ') || 'no capabilities'})`);

    return Object.freeze({
        id: hostId,
        // Removes this registration only: a stale handle must not take down a newer one of the same id.
        unregister: () => {
            if (entries.get(hostId) === entry) remove(hostId);
        },
        changed: () => {
            if (entries.get(hostId) !== entry) return;
            try {
                apply(entry);
            } catch (error) {
                reportFoliumIssue(mod.id, `source ${hostId} changed`, error);
            }
        },
        notify: (notice: FoliumSourceNotice) => {
            if (entries.get(hostId) !== entry) return;
            const told = noticeOf(entry, notice);
            if (told) entry.context.tells.forEach((tell) => { tell(told); });
        },
    });
};

/** The local ids of `modId`'s registered sources. */
export const listFoliumSourceIdsOf = (modId: string): string[] => (
    Array.from(entries.values()).filter((entry) => entry.modId === modId).map((entry) => entry.localId)
);

/** The registry as the teardown of a mod sees it (api.ts listFoliumHostRegistries). */
export const sourcesRegistry: FoliumHostRegistry<FoliumSourceDef, FoliumSourceEntry> = {
    name: 'sources',
    register: () => {
        throw new Error('sources are registered through folium.sources.register');
    },
    unregister: remove,
    unregisterAll: (modId) => {
        Array.from(entries.values()).filter((entry) => entry.modId === modId).forEach((entry) => { remove(entry.hostId); });
    },
    get: (id) => snapshot.find((entry) => entry.id === id) ?? null,
    list: () => snapshot,
    subscribe: listeners.subscribe,
};
