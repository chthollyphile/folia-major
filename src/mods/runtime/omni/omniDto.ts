import type { SongResult } from '@/types';
import type {
    MediaId,
    OmniCollection,
    OmniLyricsResult,
    OmniProviderCapabilities,
    OmniProviderSummary,
    OmniSongAvailability,
} from '@/types/onlineMusic';
import type {
    FoliumCollection,
    FoliumOmniLyrics,
    FoliumOmniProviderInfo,
    FoliumSong,
    FoliumSongDetails,
} from '../../folium/contract';
import { toFoliumLines, toFoliumSong } from '../../folium/dto';
import { isFoliumProviderId } from '../../folium/omni/providerIds';
import { FOLIUM_COLLECTION_REF_PREFIX } from '../../folium/omni/service';

// src/mods/runtime/omni/omniDto.ts
// What `folium.omni` hands out, projected from Omni's types (Folium 1.7): frozen all the way down, and
// without the host's own fields (providerData, a creator's id, vip types, privileges, fees). Albums and
// artists get refs from a pool of their own, like songs do in folium/dto.ts; it lives here because only
// the main window hands collections out.

/*
 * Collection refs: the same host collection always gets the same ref, and a ref leads back to that very
 * object, the source's own data on it included (some sources read an album's songs by what their own
 * answer put there, not by the id alone). Bounded: the least recently handed out goes first.
 */
const MAX_COLLECTION_REFS = 2000;
const refByCollection = new WeakMap<OmniCollection, string>();
const collectionByRef = new Map<string, OmniCollection>();
let collectionRefCounter = 0;

const collectionRefFor = (collection: OmniCollection): string => {
    const existing = refByCollection.get(collection);
    if (existing && collectionByRef.has(existing)) {
        // Map keeps insertion order: delete and set again to mark the ref as just used.
        collectionByRef.delete(existing);
        collectionByRef.set(existing, collection);
        return existing;
    }
    collectionRefCounter += 1;
    const ref = `${FOLIUM_COLLECTION_REF_PREFIX}${collectionRefCounter.toString(36)}`;
    refByCollection.set(collection, ref);
    collectionByRef.set(ref, collection);
    if (collectionByRef.size > MAX_COLLECTION_REFS) {
        const oldest = collectionByRef.keys().next().value;
        if (oldest !== undefined) collectionByRef.delete(oldest);
    }
    return ref;
};

/** The host collection behind a collection DTO's `ref`, or null when unknown or expired. */
export const resolveFoliumCollectionRef = (ref: string): OmniCollection | null => collectionByRef.get(ref) ?? null;

/** A song DTO, frozen, with its ref from the shared pool. */
export const toFoliumOmniSong = (song: SongResult): FoliumSong => Object.freeze(toFoliumSong(song)!);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

const countOrNull = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

/** The kind a host collection is handed out as; null for any other type (playlists, the cloud, radio). */
export const foliumCollectionKindOf = (collection: OmniCollection): FoliumCollection['kind'] | null => (
    collection.type === 'album' || collection.type === 'artist' ? collection.type : null
);

/**
 * An album or an artist as `folium.omni` hands it out; null for another type, and for one without a name
 * (a source may answer an id it does not know with an empty collection). `catalogId`: the id a song's
 * catalog ref gives it, where it was reached from a song.
 */
export const toFoliumCollection = (collection: OmniCollection, catalogId?: MediaId): FoliumCollection | null => {
    const kind = foliumCollectionKindOf(collection);
    const name = typeof collection.name === 'string' ? collection.name.trim() : '';
    if (!kind || !name) return null;
    const album = kind === 'album';
    return Object.freeze({
        kind,
        source: collection.providerId,
        id: String(catalogId ?? collection.id),
        name,
        artist: album ? (collection.artists ?? []).map((artist) => artist?.name?.trim()).filter(Boolean).join(' / ') : '',
        coverUrl: textOrNull(collection.coverUrl),
        description: textOrNull(collection.description),
        trackCount: album ? countOrNull(collection.trackCount) : null,
        albumCount: album ? null : countOrNull(collection.albumCount),
        publishedAt: album ? countOrNull(collection.publishedAt) : null,
        ref: collectionRefFor(collection),
    });
};

/**
 * Whether a source looks songs up by id: it plays songs (a mod's source only with `getAudioUrl`) and does
 * not say it cannot (a mod's source without `getSong` answers every id with nothing).
 */
export const foliumCanResolveSongs = (capabilities: OmniProviderCapabilities): boolean => (
    Boolean(capabilities.playback) && capabilities.songDetail !== false
);

/** One provider as `listProviders` lists it: no account, user or collections (those are `folium.account`'s). */
export const toFoliumOmniProviderInfo = (
    summary: OmniProviderSummary,
    capabilities: OmniProviderCapabilities,
    selected: boolean,
): FoliumOmniProviderInfo => Object.freeze({
    providerId: summary.providerId,
    displayName: summary.displayName,
    shortName: summary.shortName,
    origin: isFoliumProviderId(summary.providerId) ? 'mod' : 'host',
    selected,
    configured: summary.availability.configured,
    supports: Object.freeze({
        search: Boolean(capabilities.search),
        resolve: foliumCanResolveSongs(capabilities),
        lyrics: Boolean(capabilities.lyrics),
        albums: Boolean(capabilities.albums),
        artists: Boolean(capabilities.artists),
    }),
});

/*
 * The source's marking, coarsened: unavailable (with or without a reason) is taken down, a restriction
 * is restricted, playable is what the source marks nothing against.
 */
const availabilityOf = (availability: OmniSongAvailability | null): FoliumSongDetails['availability'] => {
    if (availability?.state === 'playable') return 'playable';
    if (availability?.state === 'unavailable') return 'taken-down';
    if (availability?.reason === 'restricted') return 'restricted';
    return 'unknown';
};

/**
 * What `describeSong` says of an online song: its duration and cover as the song carries them (a source
 * that gives no duration leaves 0 there, which reads as unknown), the source's marking and its page.
 * `availability` and `pageUrl` are null where the source is not there to ask (a mod's source while the
 * mod is off).
 */
export const toFoliumSongDetails = (
    song: SongResult,
    availability: OmniSongAvailability | null,
    pageUrl: string | null,
): FoliumSongDetails => Object.freeze({
    durationMs: typeof song.durationMs === 'number' && Number.isFinite(song.durationMs) && song.durationMs > 0 ? song.durationMs : null,
    coverUrl: textOrNull(song.album?.coverUrl),
    availability: availabilityOf(availability),
    pageUrl: textOrNull(pageUrl),
});

/**
 * Lyrics as the source gave them, parsed and chorus-marked by the host, as lines like
 * `folium.lyrics.parse` hands out. No separate chorus spans: where the host found choruses from repeated
 * lines it marks the lines and empties the spans, so only `isChorus` says it either way.
 */
export const toFoliumOmniLyrics = (result: OmniLyricsResult): FoliumOmniLyrics => {
    const lines = toFoliumLines(result.lyrics?.lines);
    return Object.freeze({
        lines,
        isWordByWord: Boolean(result.lyrics?.isWordByWord && lines.length > 0),
        isPureMusic: Boolean(result.isPureMusic),
    });
};
