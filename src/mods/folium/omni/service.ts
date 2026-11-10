import type { ModRuntimeInfo } from '../../types';
import type {
    FoliumCollection,
    FoliumCollectionKey,
    FoliumContextKind,
    FoliumOmniErrorCode,
    FoliumOmniLyrics,
    FoliumOmniPage,
    FoliumOmniProviderInfo,
    FoliumOmniService,
    FoliumSong,
    FoliumSongDetails,
    FoliumSongKey,
    FoliumSongResolution,
} from '../contract';
import type { FoliumStoppedCheck } from '../api';
import { FOLIUM_SONG_REF_PREFIX } from '../dto';
import { createFoliumRequestGate, type FoliumRequestGate } from './requestQuota';
import { isFoliumProviderId } from './providerIds';

// src/mods/folium/omni/service.ts
// `folium.omni` (Folium 1.7) as a mod sees it, and the seam it reads through. Like account.ts this module
// is loaded in the export window too, so it imports neither Omni nor a store: the main window installs the
// source (runtime/omni/hostOmni.ts, which reads through Omni) with registerFoliumOmniSource. Here: the
// context check, the arguments checked and clamped, one request gate per call (this mod's allowance and the
// source's, omni/requestQuota.ts), and the calls of a stopped activation aborted.

/** The `folium.omni` methods, as the developer log names them after `omni.`. */
export type FoliumOmniMethod =
    | 'listProviders'
    | 'searchSongs'
    | 'resolveSongs'
    | 'describeSong'
    | 'getLyrics'
    | 'getAlbum'
    | 'getArtists'
    | 'resolveCollection'
    | 'getTracks'
    | 'getArtistAlbums';

/** One call of a `folium.omni` method, as the source receives it. */
export interface FoliumOmniCall {
    /** The mod that called. */
    readonly modId: string;
    /** The method, for the developer log. */
    readonly method: FoliumOmniMethod;
    /** Runs each request to a source under this mod's allowance and the source's; aborts with the call. */
    readonly gate: FoliumRequestGate;
}

/** A page as a paged method asks for it: the cursor of a later page, or the first page's length. */
export interface FoliumOmniPageRequest {
    /** The cursor a page before handed out; null for the first page. */
    readonly cursor: string | null;
    /** The page length, already defaulted and clamped; read only for the first page. */
    readonly limit: number;
}

/**
 * Where the main window's `folium.omni` reads from (runtime/omni/hostOmni.ts). Arguments arrive checked;
 * songs and collections arrive as their refs. The async methods reject with an Error whose `code` is a
 * FoliumOmniErrorCode, or with a TypeError for an argument only the source can judge (a cursor of another
 * list).
 */
export interface FoliumOmniSource {
    listProviders(): readonly FoliumOmniProviderInfo[];
    /** `providerId` null: the source the host has selected now. */
    searchSongs(query: string, providerId: string | null, page: FoliumOmniPageRequest, call: FoliumOmniCall): Promise<FoliumOmniPage<FoliumSong>>;
    resolveSongs(keys: readonly FoliumSongKey[], call: FoliumOmniCall): Promise<readonly FoliumSongResolution[]>;
    describeSong(songRef: string): FoliumSongDetails | null;
    getLyrics(songRef: string, call: FoliumOmniCall): Promise<FoliumOmniLyrics>;
    getAlbum(songRef: string, call: FoliumOmniCall): Promise<FoliumCollection | null>;
    getArtists(songRef: string, call: FoliumOmniCall): Promise<readonly FoliumCollection[]>;
    resolveCollection(key: FoliumCollectionKey, call: FoliumOmniCall): Promise<FoliumCollection | null>;
    getTracks(collectionRef: string, page: FoliumOmniPageRequest, call: FoliumOmniCall): Promise<FoliumOmniPage<FoliumSong>>;
    getArtistAlbums(artistRef: string, page: FoliumOmniPageRequest, call: FoliumOmniCall): Promise<FoliumOmniPage<FoliumCollection>>;
}

let omniSource: FoliumOmniSource | null = null;

/** Installs (or with null removes) the main window's `folium.omni` source. */
export const registerFoliumOmniSource = (source: FoliumOmniSource | null) => {
    omniSource = source;
};

/** A rejection with one of the contract's codes, as the code and as the message. */
export const foliumOmniError = (code: FoliumOmniErrorCode): Error & { readonly code: FoliumOmniErrorCode } => (
    Object.assign(new Error(code), { code })
);

const invalid = (problem: string) => new TypeError(`invalid-arguments: ${problem}`);

/** Query length after trimming, in UTF-16 code units. */
const MAX_QUERY_LENGTH = 200;
/** Keys one `resolveSongs` call takes. */
const MAX_KEYS = 50;
/** Default and largest page of `searchSongs`. */
const SEARCH_PAGE = { fallback: 30, most: 50 } as const;
/** Default and largest page of `getTracks` and `getArtistAlbums`. */
const LIST_PAGE = { fallback: 50, most: 100 } as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/* The options object of a call, which may be left out; anything else than an object is malformed. */
const optionsOf = (options: unknown): Record<string, unknown> => {
    if (options === undefined) return {};
    if (!isPlainObject(options)) throw invalid('options must be an object');
    return options;
};

const signalOf = (options: Record<string, unknown>): AbortSignal | undefined => {
    const { signal } = options;
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw invalid('options.signal must be an AbortSignal');
    return signal;
};

/* An optional string option: absent, or a non-empty string. */
const optionalString = (options: Record<string, unknown>, name: string): string | null => {
    const value = options[name];
    if (value === undefined) return null;
    if (typeof value !== 'string' || value === '') throw invalid(`options.${name} must be a non-empty string`);
    return value;
};

/* A page length: absent for the default; given, a finite number, floored and clamped to 1..most. */
const limitOf = (options: Record<string, unknown>, rules: { fallback: number; most: number }): number => {
    const { limit } = options;
    if (limit === undefined) return rules.fallback;
    if (typeof limit !== 'number' || !Number.isFinite(limit)) throw invalid('options.limit must be a finite number');
    return Math.min(rules.most, Math.max(1, Math.floor(limit)));
};

const pageOf = (options: Record<string, unknown>, rules: { fallback: number; most: number }): FoliumOmniPageRequest => ({
    cursor: optionalString(options, 'cursor'),
    limit: limitOf(options, rules),
});

/**
 * How a collection ref begins (runtime/omni/omniDto.ts mints them), as against a song ref
 * (`FOLIUM_SONG_REF_PREFIX`): a DTO of the other kind is a malformed argument, not a ref gone stale,
 * which reading it again would never mend.
 */
export const FOLIUM_COLLECTION_REF_PREFIX = 'collection-';

const songRefOf = (song: unknown): string => {
    const ref = isPlainObject(song) ? song.ref : undefined;
    if (typeof ref !== 'string' || !ref.startsWith(FOLIUM_SONG_REF_PREFIX)) throw invalid('pass a song DTO that came from the host');
    return ref;
};

const collectionRefOf = (collection: unknown): string => {
    const ref = isPlainObject(collection) ? collection.ref : undefined;
    if (typeof ref !== 'string' || !ref.startsWith(FOLIUM_COLLECTION_REF_PREFIX)) throw invalid('pass a collection DTO that came from the host');
    return ref;
};

const queryOf = (query: unknown): string => {
    if (typeof query !== 'string') throw invalid('query must be a string');
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) {
        throw invalid(`query must be 1-${MAX_QUERY_LENGTH} characters after trimming`);
    }
    return trimmed;
};

const keysOf = (keys: unknown): FoliumSongKey[] => {
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS) {
        throw invalid(`keys must be an array of 1-${MAX_KEYS} { source, id }`);
    }
    return keys.map((key, index) => {
        if (!isPlainObject(key) || typeof key.source !== 'string' || key.source === '' || typeof key.id !== 'string' || key.id === '') {
            throw invalid(`keys[${index}] must be { source, id }, both non-empty strings`);
        }
        return Object.freeze({ source: key.source, id: key.id });
    });
};

const collectionKeyOf = (key: unknown): FoliumCollectionKey => {
    if (
        !isPlainObject(key)
        || typeof key.source !== 'string' || key.source === ''
        || (key.kind !== 'album' && key.kind !== 'artist')
        || typeof key.id !== 'string' || key.id === ''
    ) {
        throw invalid('key must be { source, kind: \'album\' | \'artist\', id }, source and id non-empty strings');
    }
    return Object.freeze({ source: key.source, kind: key.kind, id: key.id });
};

/** Whether a source id is a source built into Folia or a mod's own (`omni.providers`). */
const originOf = (providerId: string) => (isFoliumProviderId(providerId) ? 'mod' as const : 'host' as const);

/**
 * `folium.omni` for one mod in `context`. `stopped` refuses calls after the activation was torn down;
 * `onRelease` receives the function that ends it, which aborts the calls still under way.
 */
export const createFoliumOmniService = (
    mod: ModRuntimeInfo,
    context: FoliumContextKind,
    stopped: FoliumStoppedCheck = () => false,
    onRelease: (release: () => void) => void = () => {},
): FoliumOmniService => {
    // The calls under way, aborted when the activation ends: each then rejects with `aborted`.
    const underWay = new Set<AbortController>();
    onRelease(() => {
        underWay.forEach((controller) => controller.abort(new DOMException('The mod stopped', 'AbortError')));
        underWay.clear();
    });

    /* The installed source; outside the main window, and before it is installed, the call is refused. */
    const sourceOf = (): FoliumOmniSource => {
        if (context !== 'main' || !omniSource) throw new Error(`omni-unavailable-in-${context}-context`);
        return omniSource;
    };

    /*
     * Runs one call of an async method: refused once the activation was torn down or its signal aborted;
     * otherwise under a gate whose signal is the caller's and the activation's together. When that signal
     * aborts the call rejects `aborted` at once, whatever the source is still doing, and its answer is
     * dropped.
     */
    const run = async <T>(
        method: FoliumOmniMethod,
        signal: AbortSignal | undefined,
        work: (source: FoliumOmniSource, call: FoliumOmniCall) => Promise<T>,
    ): Promise<T> => {
        const source = sourceOf();
        if (stopped(`omni.${method}`) || signal?.aborted) throw foliumOmniError('aborted');
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        underWay.add(controller);
        const gate = createFoliumRequestGate({ modId: mod.id, what: `omni.${method}`, signal: controller.signal, originOf });
        try {
            return await new Promise<T>((resolve, reject) => {
                const onAbort = () => reject(foliumOmniError('aborted'));
                controller.signal.addEventListener('abort', onAbort, { once: true });
                let answer: Promise<T>;
                try {
                    answer = work(source, { modId: mod.id, method, gate });
                } catch (error) {
                    answer = Promise.reject(error);
                }
                answer.then(
                    (value) => (controller.signal.aborted ? reject(foliumOmniError('aborted')) : resolve(value)),
                    (error: unknown) => reject(controller.signal.aborted ? foliumOmniError('aborted') : error),
                ).finally(() => controller.signal.removeEventListener('abort', onAbort));
            });
        } finally {
            underWay.delete(controller);
            signal?.removeEventListener('abort', abort);
        }
    };

    return Object.freeze({
        listProviders: () => sourceOf().listProviders(),
        searchSongs: async (query: string, options?: { providerId?: string; cursor?: string; limit?: number; signal?: AbortSignal }) => {
            sourceOf();
            const checked = queryOf(query);
            const given = optionsOf(options);
            const providerId = optionalString(given, 'providerId');
            const page = pageOf(given, SEARCH_PAGE);
            return run('searchSongs', signalOf(given), (source, call) => source.searchSongs(checked, providerId, page, call));
        },
        resolveSongs: async (keys: readonly FoliumSongKey[], options?: { signal?: AbortSignal }) => {
            sourceOf();
            const checked = keysOf(keys);
            const signal = signalOf(optionsOf(options));
            return run('resolveSongs', signal, (source, call) => source.resolveSongs(checked, call));
        },
        describeSong: (song: FoliumSong) => {
            const source = sourceOf();
            return source.describeSong(songRefOf(song));
        },
        getLyrics: async (song: FoliumSong, options?: { signal?: AbortSignal }) => {
            sourceOf();
            const ref = songRefOf(song);
            const signal = signalOf(optionsOf(options));
            return run('getLyrics', signal, (source, call) => source.getLyrics(ref, call));
        },
        getAlbum: async (song: FoliumSong, options?: { signal?: AbortSignal }) => {
            sourceOf();
            const ref = songRefOf(song);
            const signal = signalOf(optionsOf(options));
            return run('getAlbum', signal, (source, call) => source.getAlbum(ref, call));
        },
        getArtists: async (song: FoliumSong, options?: { signal?: AbortSignal }) => {
            sourceOf();
            const ref = songRefOf(song);
            const signal = signalOf(optionsOf(options));
            return run('getArtists', signal, (source, call) => source.getArtists(ref, call));
        },
        resolveCollection: async (key: FoliumCollectionKey, options?: { signal?: AbortSignal }) => {
            sourceOf();
            const checked = collectionKeyOf(key);
            const signal = signalOf(optionsOf(options));
            return run('resolveCollection', signal, (source, call) => source.resolveCollection(checked, call));
        },
        getTracks: async (collection: FoliumCollection, options?: { cursor?: string; limit?: number; signal?: AbortSignal }) => {
            sourceOf();
            const ref = collectionRefOf(collection);
            const given = optionsOf(options);
            const page = pageOf(given, LIST_PAGE);
            return run('getTracks', signalOf(given), (source, call) => source.getTracks(ref, page, call));
        },
        getArtistAlbums: async (artist: FoliumCollection, options?: { cursor?: string; limit?: number; signal?: AbortSignal }) => {
            sourceOf();
            const ref = collectionRefOf(artist);
            const given = optionsOf(options);
            const page = pageOf(given, LIST_PAGE);
            return run('getArtistAlbums', signalOf(given), (source, call) => source.getArtistAlbums(ref, page, call));
        },
    });
};
