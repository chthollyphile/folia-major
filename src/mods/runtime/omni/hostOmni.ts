import type { SongResult, UnifiedSong } from '@/types';
import type { MediaId, OmniCollection, OmniPage, OmniProviderCapabilities, OmniSongAvailability } from '@/types/onlineMusic';
import { OnlineProviderError } from '@/types/onlineMusic';
import { omni } from '@/services/onlineMusic/omni';
import { getPlaybackSourceRef, normalizePlaybackSongSource } from '@/utils/appPlaybackGuards';
import type {
    FoliumCollection,
    FoliumCollectionKey,
    FoliumOmniErrorCode,
    FoliumOmniPage,
    FoliumSong,
    FoliumSongKey,
    FoliumSongResolution,
} from '../../folium/contract';
import { resolveFoliumSongRef } from '../../folium/dto';
import { isFoliumRequestQuotaError } from '../../folium/omni/requestQuota';
import {
    foliumOmniError,
    registerFoliumOmniSource,
    type FoliumOmniCall,
    type FoliumOmniPageRequest,
    type FoliumOmniSource,
} from '../../folium/omni/service';
import { getFoliumAccountState } from '../hostAccount';
import {
    foliumCanResolveSongs,
    foliumCollectionKindOf,
    resolveFoliumCollectionRef,
    toFoliumCollection,
    toFoliumOmniLyrics,
    toFoliumOmniProviderInfo,
    toFoliumOmniSong,
    toFoliumSongDetails,
} from './omniDto';
import { peekFoliumOmniCursorList, readFoliumOmniPage, type FoliumOmniList, type FoliumOmniSlice } from './omniPaging';
import { installFoliumResolveCacheUpkeep, keepFoliumResolvedSong, readFoliumResolvedSong } from './omniResolveCache';

// src/mods/runtime/omni/hostOmni.ts
// The main window's source of `folium.omni` (Folium 1.7): Omni's public reads, for mods. Everything goes
// through omni.ts, and every time a source is asked it goes through the call's request gate (this mod's
// allowance and the source's). An answer that comes after the selected source or that source's account
// changed is dropped; the source's failures become the contract's codes. Nothing here writes a store or
// tells the host's bookkeeping of what plays (`songsInPlay`, `accountMoment`, liked-list reads), and the
// mods' `omni.lyricsResolved` hooks do not run for these reads: a mod reading lyrics from inside its own
// hook would call itself.
//
// Searches go out with a session of the mod's own (`folium:<mod id>`): a source that keeps a search's
// place between pages keeps the mod's apart from the host's own search, which the mod's pages then
// neither restart nor push out.

/** The account a request was made as, read when it was sent. */
interface SentAs {
    readonly generation: number;
    readonly accountKey: string | null;
    readonly signedIn: boolean;
}

const sentAsOf = (providerId: string): SentAs => {
    const state = getFoliumAccountState(providerId);
    return {
        generation: omni.getActiveRequestGeneration(),
        accountKey: state?.accountKey ?? null,
        signedIn: state?.status === 'signed-in',
    };
};

// The codes the host worked out for a source's own errors (`ask`), for the lookups whose errors omni
// hands back per song (`resolveSongs`).
const codesOfErrors = new WeakMap<object, FoliumOmniErrorCode>();

/*
 * A source's failure as a contract code. `signedIn`: an account was signed in when the request was sent,
 * which tells a session that ran out from no session at all. `activeRoute`: the request followed the
 * selected source, whose switch omni answers with an AbortError.
 */
const codeOfFailure = (error: unknown, signedIn: boolean, activeRoute: boolean): FoliumOmniErrorCode => {
    if (error instanceof OnlineProviderError) {
        if (error.code === 'auth-required') return signedIn ? 'session-expired' : 'not-signed-in';
        if (error.code === 'subscription-required') return 'vip-required';
        if (error.code === 'unsupported') return 'unsupported';
        if (error.httpStatus === 429 || error.retryAfterMs !== undefined) return 'rate-limited';
        if (error.code === 'unavailable') return 'unavailable';
        if (error.code === 'region-restricted') return 'region-restricted';
        return 'network';
    }
    if (activeRoute && (error as { name?: unknown } | null)?.name === 'AbortError') return 'account-changed';
    return 'network';
};

/*
 * Asks a source once, through the call's gate: the account is read when the request is sent, and an
 * answer that comes after the selected source or that account changed is dropped (`account-changed`).
 * A failure rejects with the contract's code, said in the developer log with the source's own error; the
 * gate's own refusals (`rate-limited`, already said there; `aborted`; `network` when no answer came in
 * time) pass as they are.
 */
const ask = async <T>(
    call: FoliumOmniCall,
    providerId: string,
    work: () => Promise<T>,
    options: { activeRoute?: boolean } = {},
): Promise<T> => {
    const where = `[Folium:${call.modId}] omni.${call.method} ${providerId}`;
    let sentAs: SentAs | null = null;
    // What `work` itself rejected with, told apart from the gate's own refusals: a mod's source may
    // reject with an allowance's error of its own (its inner `folium.omni` call refused), which is a
    // failure of that source here (`network`), not this call's allowance, and not its object to hand on.
    let ownFailure: { error: unknown } | null = null;
    let value: T;
    try {
        value = await call.gate.run(providerId, async () => {
            sentAs = sentAsOf(providerId);
            try {
                return await work();
            } catch (error) {
                ownFailure = { error };
                throw error;
            }
        });
    } catch (error) {
        const own = ownFailure as { error: unknown } | null;
        if ((own === null || own.error !== error) && isFoliumRequestQuotaError(error)) {
            if (error.code === 'network') console.warn(`${where}: network, no answer in time`);
            throw error;
        }
        const code = codeOfFailure(error, (sentAs as SentAs | null)?.signedIn ?? false, options.activeRoute === true);
        if (typeof error === 'object' && error !== null) codesOfErrors.set(error, code);
        if (code === 'account-changed') console.info(`${where}: account-changed, the answer is dropped`);
        else console.warn(`${where}: ${code}`, error);
        throw foliumOmniError(code);
    }
    const before = sentAs as SentAs | null;
    const after = getFoliumAccountState(providerId)?.accountKey ?? null;
    if (before && (before.generation !== omni.getActiveRequestGeneration() || before.accountKey !== after)) {
        console.info(`${where}: account-changed, the answer is dropped`);
        throw foliumOmniError('account-changed');
    }
    return value;
};

/* The capabilities of a source the host has, or null when there is no source by that id. */
const capabilitiesOf = (providerId: string): OmniProviderCapabilities | null => (
    omni.getProviderSummaries().some((summary) => summary.providerId === providerId)
        ? omni.getProviderCapabilities(providerId)
        : null
);

/* The host song behind a song DTO's ref; `stale-ref` when it no longer resolves. */
const songOf = (ref: string): SongResult => {
    const song = resolveFoliumSongRef(ref);
    if (!song) throw foliumOmniError('stale-ref');
    return song;
};

/*
 * The online source of a song and what it can do; `unsupported` for a song that is not online, or whose
 * source is not there (a mod's source while the mod is off).
 */
const onlineSourceOf = (song: SongResult): { providerId: string; capabilities: OmniProviderCapabilities } => {
    const source = getPlaybackSourceRef(song);
    const capabilities = source.kind === 'online' ? capabilitiesOf(source.providerId) : null;
    if (source.kind !== 'online' || !capabilities) throw foliumOmniError('unsupported');
    return { providerId: source.providerId, capabilities };
};

const freezePage = <T>(slice: FoliumOmniSlice<unknown>, items: T[]): FoliumOmniPage<T> => Object.freeze({
    items: Object.freeze(items),
    nextCursor: slice.nextCursor,
    total: slice.total,
});

/** The session a mod's searches go out with. */
const sessionOf = (call: FoliumOmniCall) => ({ session: `folium:${call.modId}` });

const searchSongs = async (
    query: string,
    providerId: string | null,
    page: FoliumOmniPageRequest,
    call: FoliumOmniCall,
): Promise<FoliumOmniPage<FoliumSong>> => {
    // Without a source named: the one selected now. A later page of such a search asks the same source
    // as its first page did; if the selection moved on meanwhile, the list is gone (`account-changed`).
    const selected = providerId === null;
    const target = providerId ?? omni.getActiveProviderSummary()?.providerId ?? null;
    const capabilities = target === null ? null : capabilitiesOf(target);
    if (target === null || !capabilities?.search) throw foliumOmniError('unsupported');
    const method = selected ? 'searchSongs:selected' : 'searchSongs';
    if (selected && page.cursor !== null) {
        const listed = peekFoliumOmniCursorList(page.cursor);
        if (listed && listed.method === method && listed.subject === query && listed.providerId !== target) {
            console.info(`[Folium:${call.modId}] omni.searchSongs: account-changed, the selected source changed between pages`);
            throw foliumOmniError('account-changed');
        }
    }
    // The selection as the call found it. A request that waits for its place is counted against
    // `target`, while omni's selected route sends it wherever the selection is once it goes out: one
    // that finds the selection moved on by then is not sent at all (`account-changed`).
    const generation = omni.getActiveRequestGeneration();
    const slice = await readFoliumOmniPage<UnifiedSong>({
        list: { method, providerId: target, subject: query },
        basis: undefined,
        cursor: page.cursor,
        limit: page.limit,
        fetch: (asked) => ask(call, target, async () => {
            if (!selected) return omni.searchProviderSongs(target, query, asked, sessionOf(call));
            if (omni.getActiveRequestGeneration() !== generation || omni.getActiveProviderSummary()?.providerId !== target) {
                throw new DOMException('The selected source changed while the request waited', 'AbortError');
            }
            return omni.searchSongs(query, asked, sessionOf(call));
        }, { activeRoute: selected }),
    });
    return freezePage(slice, slice.items.map(toFoliumOmniSong));
};

const NOT_FOUND: FoliumSongResolution = Object.freeze({ status: 'not-found' });
const UNSUPPORTED: FoliumSongResolution = Object.freeze({ status: 'unsupported' });

const found = (song: SongResult): FoliumSongResolution => Object.freeze({ status: 'found', song: toFoliumOmniSong(song) });
const failed = (code: FoliumOmniErrorCode): FoliumSongResolution => Object.freeze({ status: 'failed', code });

/*
 * Looks the keys of one source up: the ids not kept from a recent lookup, each once, in one call of
 * omni's lookup, whose every request to the source goes through `ask`. What the source answered is kept
 * (songs and "no such song"); failures are not.
 */
const resolveAtSource = async (
    providerId: string,
    indexesById: Map<string, number[]>,
    results: FoliumSongResolution[],
    call: FoliumOmniCall,
) => {
    const ids = [...indexesById.keys()];
    let details: Awaited<ReturnType<typeof omni.getSongDetails>>;
    try {
        details = await omni.getSongDetails(providerId, ids, { run: (work) => ask(call, providerId, work) });
    } catch (error) {
        // Omni rejects the lookup only for a source that is not there (a mod's source that went meanwhile).
        console.info(`[Folium:${call.modId}] omni.resolveSongs ${providerId}: unsupported, the source went`, error);
        for (const indexes of indexesById.values()) indexes.forEach((at) => { results[at] = UNSUPPORTED; });
        return;
    }
    let notFound = 0;
    ids.forEach((id, index) => {
        const detail = details[index] ?? { status: 'missing' as const };
        let resolution: FoliumSongResolution;
        if (detail.status === 'found') {
            keepFoliumResolvedSong(providerId, id, detail.song);
            resolution = found(detail.song);
        } else if (detail.status === 'missing') {
            keepFoliumResolvedSong(providerId, id, null);
            notFound += 1;
            resolution = NOT_FOUND;
        } else {
            // A source's own failure (said in the log by `ask`), or what the gate refused it with.
            const error = detail.error;
            const code = detail.status === 'failed'
                ? (typeof error === 'object' && error !== null ? codesOfErrors.get(error) : undefined) ?? codeOfFailure(error, false, false)
                : (error as { code?: FoliumOmniErrorCode } | null)?.code ?? 'network';
            if (code === 'aborted') throw foliumOmniError('aborted');
            // "This key cannot be looked up here" is a resolution of its own, never a failure.
            resolution = code === 'unsupported' ? UNSUPPORTED : failed(code);
        }
        for (const at of indexesById.get(id) ?? []) results[at] = resolution;
    });
    if (notFound > 0) console.info(`[Folium:${call.modId}] omni.resolveSongs ${providerId}: not-found for ${notFound} of ${ids.length}`);
};

const resolveSongs = async (keys: readonly FoliumSongKey[], call: FoliumOmniCall): Promise<readonly FoliumSongResolution[]> => {
    const results: FoliumSongResolution[] = new Array(keys.length);
    const bySource = new Map<string, Map<string, number[]>>();
    const resolvable = new Map<string, boolean>();
    keys.forEach((key, index) => {
        // No source by that id here, not an online one, or one that cannot look songs up: unsupported
        // without asking anyone.
        if (!resolvable.has(key.source)) {
            const capabilities = capabilitiesOf(key.source);
            resolvable.set(key.source, Boolean(capabilities && foliumCanResolveSongs(capabilities)));
        }
        if (!resolvable.get(key.source)) {
            results[index] = UNSUPPORTED;
            return;
        }
        const kept = readFoliumResolvedSong(key.source, key.id);
        if (kept) {
            results[index] = kept.song ? found(kept.song) : NOT_FOUND;
            return;
        }
        let ids = bySource.get(key.source);
        if (!ids) {
            ids = new Map();
            bySource.set(key.source, ids);
        }
        ids.set(key.id, [...(ids.get(key.id) ?? []), index]);
    });
    await Promise.all([...bySource].map(([providerId, ids]) => resolveAtSource(providerId, ids, results, call)));
    return Object.freeze(results);
};

const describeSong = (songRef: string) => {
    const song = resolveFoliumSongRef(songRef);
    if (!song || getPlaybackSourceRef(song).kind !== 'online') return null;
    // Both asked of the song's source; it may not be there (a mod's source while the mod is off).
    let availability: OmniSongAvailability | null = null;
    let pageUrl: string | null = null;
    try {
        availability = omni.getSongAvailability(song);
        pageUrl = omni.getSongPageUrl(song);
    } catch {
        // No source to ask: unknown, and no page.
    }
    return toFoliumSongDetails(song, availability, pageUrl);
};

const getLyrics = async (songRef: string, call: FoliumOmniCall) => {
    const song = songOf(songRef);
    const { providerId, capabilities } = onlineSourceOf(song);
    if (!capabilities.lyrics) throw foliumOmniError('unsupported');
    const result = await ask(call, providerId, () => omni.getLyrics(song, { extensionHooks: false }));
    return toFoliumOmniLyrics(result);
};

/*
 * The catalog refs of a song's album and artists. A source that may have to look the song up to say
 * them is asked through the gate; one that reads them off the song is not asked at all.
 */
const catalogRefsOf = async (song: SongResult, providerId: string, call: FoliumOmniCall) => {
    const online = normalizePlaybackSongSource(song) as UnifiedSong;
    return omni.canResolveCatalogRef(online, 'album')
        ? ask(call, providerId, () => omni.getSongCatalogRefs(online))
        : omni.getSongCatalogRefs(online);
};

/* The host collection an album or artist reached from a song stands for: its id, and the name the song gives it. */
const songCollection = (providerId: string, type: 'album' | 'artist', id: MediaId, name: string, coverUrl?: string): OmniCollection => ({
    providerId,
    id,
    name,
    type,
    ...(coverUrl ? { coverUrl } : {}),
});

const getAlbum = async (songRef: string, call: FoliumOmniCall): Promise<FoliumCollection | null> => {
    const song = songOf(songRef);
    const { providerId, capabilities } = onlineSourceOf(song);
    if (!capabilities.albums) throw foliumOmniError('unsupported');
    const { album } = await catalogRefsOf(song, providerId, call);
    if (!album) return null;
    const name = album.name || song.album?.name || '';
    return toFoliumCollection(songCollection(providerId, 'album', album.id, name, song.album?.coverUrl), album.id);
};

const getArtists = async (songRef: string, call: FoliumOmniCall): Promise<readonly FoliumCollection[]> => {
    const song = songOf(songRef);
    const { providerId, capabilities } = onlineSourceOf(song);
    if (!capabilities.artists) throw foliumOmniError('unsupported');
    const { artists } = await catalogRefsOf(song, providerId, call);
    const collections = artists
        .map((artist) => toFoliumCollection(songCollection(providerId, 'artist', artist.id, artist.name), artist.id))
        .filter((collection): collection is FoliumCollection => collection !== null);
    return Object.freeze(collections);
};

const resolveCollection = async (key: FoliumCollectionKey, call: FoliumOmniCall): Promise<FoliumCollection | null> => {
    const capabilities = capabilitiesOf(key.source);
    if (!capabilities || !(key.kind === 'album' ? capabilities.albums : capabilities.artists)) throw foliumOmniError('unsupported');
    // What the host itself opens an album or an artist by when it comes from a song: the id alone.
    const asked: OmniCollection = { providerId: key.source, id: key.id, type: key.kind, name: '' };
    const detail = await ask(call, key.source, () => (
        key.kind === 'album' ? omni.getAlbumDetail(asked) : omni.getArtistDetail(asked)
    ));
    // A source may answer an id it does not know with an empty collection, or with the one it was asked
    // with: both are none.
    if (!detail || foliumCollectionKindOf(detail) !== key.kind) return null;
    return toFoliumCollection(detail);
};

/*
 * The host collection behind a collection DTO's ref, of the kinds `kinds` allows; `stale-ref` when it no
 * longer resolves, `unsupported` when its source is no longer there.
 */
const collectionOf = (ref: string, method: string, kinds: readonly FoliumCollection['kind'][]): OmniCollection => {
    const collection = resolveFoliumCollectionRef(ref);
    if (!collection) throw foliumOmniError('stale-ref');
    const kind = foliumCollectionKindOf(collection);
    if (!kind || !kinds.includes(kind)) throw new TypeError(`invalid-arguments: ${method} takes ${kinds.join(' or ')}`);
    if (!capabilitiesOf(collection.providerId)) throw foliumOmniError('unsupported');
    return collection;
};

/*
 * The list of an album's or an artist's pages: by its source, kind and id, as its DTO says them, so that any
 * DTO of it goes on with a cursor. The pages go on from the host collection the first one was read from.
 */
const collectionList = (method: string, collection: OmniCollection): FoliumOmniList => ({
    method,
    providerId: collection.providerId,
    subject: `${collection.type}:${String(collection.id)}`,
});

const getTracks = async (collectionRef: string, page: FoliumOmniPageRequest, call: FoliumOmniCall): Promise<FoliumOmniPage<FoliumSong>> => {
    const collection = collectionOf(collectionRef, 'getTracks', ['album', 'artist']);
    const slice = await readFoliumOmniPage<UnifiedSong, OmniCollection>({
        list: collectionList('getTracks', collection),
        basis: collection,
        cursor: page.cursor,
        limit: page.limit,
        fetch: (asked, read) => ask(call, read.providerId, () => (
            read.type === 'album' ? omni.getCollectionTracks(read, asked) : omni.getArtistSongs(read, asked)
        )),
    });
    return freezePage(slice, slice.items.map(toFoliumOmniSong));
};

const getArtistAlbums = async (artistRef: string, page: FoliumOmniPageRequest, call: FoliumOmniCall): Promise<FoliumOmniPage<FoliumCollection>> => {
    const artist = collectionOf(artistRef, 'getArtistAlbums', ['artist']);
    const slice = await readFoliumOmniPage<OmniCollection, OmniCollection>({
        list: collectionList('getArtistAlbums', artist),
        basis: artist,
        cursor: page.cursor,
        limit: page.limit,
        fetch: (asked, read): Promise<OmniPage<OmniCollection>> => ask(call, read.providerId, () => omni.getArtistAlbums(read, asked)),
        // Only albums, and only named ones, are handed out: the rest never takes a place on a page.
        keep: (item) => foliumCollectionKindOf(item) === 'album' && typeof item.name === 'string' && item.name.trim() !== '',
    });
    const albums = slice.items
        .map((item) => toFoliumCollection(item))
        .filter((collection): collection is FoliumCollection => collection !== null);
    return freezePage(slice, albums);
};

const listProviders = () => {
    const selected = omni.getActiveProviderSummary()?.providerId;
    return Object.freeze(omni.getProviderSummaries().map((summary) => (
        toFoliumOmniProviderInfo(summary, omni.getProviderCapabilities(summary.providerId), summary.providerId === selected)
    )));
};

/** The main window's `folium.omni` source; installFoliumHostOmni installs it. */
export const FOLIUM_HOST_OMNI_SOURCE: FoliumOmniSource = Object.freeze({
    listProviders,
    searchSongs,
    resolveSongs,
    describeSong,
    getLyrics,
    getAlbum,
    getArtists,
    resolveCollection,
    getTracks,
    getArtistAlbums,
});

let installed = false;

/** Installs the `folium.omni` source and the upkeep of its lookup cache (main window only; idempotent). */
export const installFoliumHostOmni = () => {
    if (installed) return;
    installed = true;
    registerFoliumOmniSource(FOLIUM_HOST_OMNI_SOURCE);
    installFoliumResolveCacheUpkeep();
};
