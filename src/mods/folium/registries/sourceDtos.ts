import type { Album, Artist, SongResult, UnifiedSong } from '@/types';
import type {
    JsonValue,
    OnlineProviderId,
    ProviderArtistSummary,
    ProviderCatalogEntityKind,
    ProviderCatalogRef,
    ProviderCollection,
    ProviderPage,
    ProviderUser,
} from '@/types/onlineMusic';
import type { PersonalFmLaunch, PersonalFmModeId } from '@/types/personalFm';
import type { FoliumJsonValue } from '../contract';
import type { FoliumSourceCollection, FoliumSourceNamedRef, FoliumSourceSong, FoliumSourceUser } from '../sources/contract';

// src/mods/folium/registries/sourceDtos.ts
// The song, collection, user and page DTOs of Folium 2.0 sources (plan §4.3), turned into the host's own
// shapes and back. Towards the host a song becomes a UnifiedSong of the source's provider id: its artists
// and album carry their real ids and catalog refs (no `<id>#artist0`), `data` is `sourceRef.providerData`,
// and the ids other sources know it by (`lyricIds`) are written where the host's readers still look for them
// (TOP_LYRIC_IDS) until they read `lyricIds`. Towards the source an old song that was kept with a platform's
// fields at its top (`fee`, `privilege`, …) has them folded back into `data`.
//
// What a source hands is read field by field as `unknown`: it is a mod's JavaScript, whatever its types say.
// The way towards the source runs on hot paths (a status poll, rows asking a song's availability), so a
// host object is converted once: the DTO is kept against it (a WeakMap) and frozen, and the next call with
// the same object hands the same DTO.

/** Where a song's `lyricIds` are kept in `sourceRef.providerData`. */
export const LYRIC_IDS_DATA_KEY = '@lyricIds';

// The ids of a song at two sources that the host's readers (lyric matching, the AMLL lookup, the metadata match)
// still read at the top of a song, under these stored field names (plan §4.3), until they read `lyricIds`.
const TOP_LYRIC_IDS = [['qq', 'qqMid'], ['kugou', 'kgHash']] as const;

// The fields a platform's old songs kept at their top, which the source reads back from `data`.
const OLD_TOP_FIELDS = ['fee', 'privilege', 'noCopyrightRcmd', 'resourceState', 't', 'sourceType'] as const;

const record = (value: unknown): Record<string, unknown> | null => (
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
);

/** A string, or a number written out; '' for anything else. */
const text = (value: unknown): string => (
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
);

const optionalText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const textList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list = (value as unknown[]).filter((item): item is string => typeof item === 'string' && item.length > 0);
    return list.length > 0 ? list : undefined;
};

const catalogRef = (providerId: OnlineProviderId, kind: ProviderCatalogEntityKind, id: string): ProviderCatalogRef => ({ providerId, kind, id });

/** Whether `value` reads as a song DTO: an id and a title, both strings. */
export const isFoliumSourceSong = (value: unknown): value is FoliumSourceSong => {
    const song = record(value);
    return song !== null && typeof song.id === 'string' && song.id.length > 0 && typeof song.title === 'string';
};

const namedRefs = (providerId: OnlineProviderId, value: unknown): Artist[] => {
    if (!Array.isArray(value)) return [];
    const artists: Artist[] = [];
    for (const item of value as unknown[]) {
        const ref = record(item);
        if (!ref) continue;
        const id = text(ref.id);
        const name = text(ref.name);
        if (!name && !id) continue;
        artists.push({ id, name, ...(id && ref.ref !== false ? { catalogRef: catalogRef(providerId, 'artist', id) } : {}) });
    }
    return artists;
};

/** The most a song's or collection's `data` may take, as JSON text: it is kept with the song (queue, history). */
export const SOURCE_DATA_MAX_CHARS = 16 * 1024;

/*
 * A source's `data` as the host keeps it: a copy, through JSON, of a plain object. The host clones and stores the
 * song (the queue in IndexedDB, the windows' sync): a function, a class instance, a cycle or a BigInt in it failed
 * the whole queue, and the source kept a hand on what the host had stored. What JSON cannot hold, or what is
 * larger than SOURCE_DATA_MAX_CHARS, is left out, said once a source.
 */
const droppedDataOf = new Set<string>();
const jsonRecord = (providerId: OnlineProviderId, value: unknown): Record<string, JsonValue> | undefined => {
    if (!record(value)) return undefined;
    let textValue: string | undefined;
    try {
        textValue = JSON.stringify(value);
    } catch {
        textValue = undefined;
    }
    if (textValue === undefined || textValue.length > SOURCE_DATA_MAX_CHARS) {
        if (!droppedDataOf.has(providerId)) {
            droppedDataOf.add(providerId);
            console.warn(`[FoliumSources] ${providerId}: dropped a data that is not JSON or is over ${SOURCE_DATA_MAX_CHARS} characters`);
        }
        return undefined;
    }
    return record(JSON.parse(textValue)) as Record<string, JsonValue> | null ?? undefined;
};

/** The ids other sources know a song by: strings only. */
const lyricIdsOf = (value: unknown): Record<string, string> | null => {
    const found = record(value);
    if (!found) return null;
    const ids = Object.fromEntries(Object.entries(found).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    return Object.keys(ids).length > 0 ? ids : null;
};

/** A source's song as the host's UnifiedSong of provider `providerId`. */
export const toHostSong = (providerId: OnlineProviderId, song: FoliumSourceSong): UnifiedSong => {
    const raw = song as unknown as Record<string, unknown>;
    const id = song.id;
    const album = record(raw.album);
    const albumId = album ? text(album.id) : '';
    const coverUrl = optionalText(raw.coverUrl) ?? (album ? optionalText(album.coverUrl) : undefined);
    const lyricIds = lyricIdsOf(raw.lyricIds);
    const topIds: Partial<Record<(typeof TOP_LYRIC_IDS)[number][1], string>> = {};
    for (const [source, field] of TOP_LYRIC_IDS) {
        const value = lyricIds ? optionalText(lyricIds[source]) : undefined;
        if (value) topIds[field] = value;
    }
    const data = jsonRecord(providerId, raw.data);
    const providerData: Record<string, JsonValue> | undefined = lyricIds
        ? { ...(data ?? {}), [LYRIC_IDS_DATA_KEY]: lyricIds }
        : data;
    const row = record(raw.row);
    const rowId = row ? optionalText(row.id) : undefined;
    const listenCount = row ? finite(row.listenCount) : undefined;
    const durationMs = finite(raw.durationMs);
    const replayGain = record(raw.replayGain);
    const albumOut: Album = {
        id: albumId,
        name: album ? text(album.name) : '',
        ...(coverUrl ? { coverUrl } : {}),
        ...(albumId && album?.ref !== false ? { catalogRef: catalogRef(providerId, 'album', albumId) } : {}),
    };
    const aliases = textList(raw.aliases);
    const translatedNames = textList(raw.translatedTitles);
    const variant = optionalText(raw.variant);
    return {
        id,
        name: song.title,
        artists: namedRefs(providerId, raw.artists),
        album: albumOut,
        durationMs: durationMs !== undefined && durationMs > 0 ? durationMs : 0,
        ...(aliases ? { aliases } : {}),
        ...(translatedNames ? { translatedNames } : {}),
        ...(raw.pureMusic === true ? { isPureMusic: true } : {}),
        ...(raw.video === true ? { isVideo: true } : {}),
        ...(replayGain ? { replayGain: { ...replayGain } } : {}),
        ...topIds,
        ...(rowId ? { collectionRowId: rowId } : {}),
        ...(listenCount !== undefined ? { listenCount } : {}),
        sourceRef: {
            kind: 'online',
            providerId,
            mediaId: id,
            ...(variant ? { variant } : {}),
            ...(providerData ? { providerData } : {}),
        },
    };
};

const sourceSongs = new WeakMap<object, FoliumSourceSong>();

const freezeRefs = (refs: FoliumSourceNamedRef[]): FoliumSourceNamedRef[] => Object.freeze(refs.map((ref) => Object.freeze(ref))) as FoliumSourceNamedRef[];

const sourceRefsOf = (artists: ReadonlyArray<Partial<Artist>> | undefined): FoliumSourceNamedRef[] => freezeRefs((artists ?? []).map((artist) => ({
    id: artist.id === undefined ? '' : String(artist.id),
    name: artist.name ?? '',
    ...(artist.catalogRef ? {} : { ref: false }),
})));

/** The DTO of a host song, made once per host object (see the top of this file). Frozen. */
export const toSourceSong = (song: SongResult): FoliumSourceSong => {
    const kept = sourceSongs.get(song);
    if (kept) return kept;
    // A song kept by an older build may lack what its type has: read it as it may be.
    const loose = song as Partial<UnifiedSong>;
    const ref = loose.sourceRef?.kind === 'online' ? loose.sourceRef : null;
    const providerData: Record<string, JsonValue> | undefined = ref?.providerData;
    const keptLyricIds = record(providerData?.[LYRIC_IDS_DATA_KEY]);
    const lyricIds: Record<string, string> = {};
    Object.entries(keptLyricIds ?? {}).forEach(([source, value]) => {
        if (typeof value === 'string') lyricIds[source] = value;
    });
    for (const [source, field] of TOP_LYRIC_IDS) {
        const value = loose[field];
        if (value) lyricIds[source] = value;
    }
    // What the source kept as its data, without the host's own key; an old song's top fields folded back in.
    let data: Record<string, FoliumJsonValue> | undefined;
    if (providerData) {
        const rest = Object.fromEntries(Object.entries(providerData).filter(([name]) => name !== LYRIC_IDS_DATA_KEY));
        if (Object.keys(rest).length > 0) data = rest;
    }
    const legacy = song as unknown as Record<string, unknown>;
    for (const field of OLD_TOP_FIELDS) {
        const value = legacy[field];
        if (value === undefined || value === null || data?.[field] !== undefined) continue;
        data = { ...(data ?? {}), [field]: value as FoliumJsonValue };
    }
    const album = loose.album as Partial<Album> | undefined;
    const dto: FoliumSourceSong = {
        id: ref ? ref.mediaId : String(loose.id ?? ''),
        title: loose.name ?? '',
        artists: sourceRefsOf(loose.artists),
        ...(album && (album.name || album.id !== undefined) ? {
            album: Object.freeze({
                id: album.id === undefined ? '' : String(album.id),
                name: album.name ?? '',
                ...(album.coverUrl ? { coverUrl: album.coverUrl } : {}),
                ...(album.catalogRef ? {} : { ref: false }),
            }),
        } : {}),
        ...(loose.durationMs ? { durationMs: loose.durationMs } : {}),
        ...(album?.coverUrl ? { coverUrl: album.coverUrl } : {}),
        ...(loose.aliases?.length ? { aliases: Object.freeze([...loose.aliases]) as string[] } : {}),
        ...(loose.translatedNames?.length ? { translatedTitles: Object.freeze([...loose.translatedNames]) as string[] } : {}),
        ...(ref?.variant ? { variant: ref.variant } : {}),
        ...(loose.isPureMusic ? { pureMusic: true } : {}),
        ...(loose.isVideo ? { video: true } : {}),
        ...(Object.keys(lyricIds).length > 0 ? { lyricIds: Object.freeze(lyricIds) } : {}),
        ...(loose.collectionRowId || loose.listenCount !== undefined ? {
            row: Object.freeze({
                ...(loose.collectionRowId ? { id: loose.collectionRowId } : {}),
                ...(loose.listenCount !== undefined ? { listenCount: loose.listenCount } : {}),
            }),
        } : {}),
        ...(loose.replayGain ? { replayGain: Object.freeze({ ...loose.replayGain }) } : {}),
        ...(data ? { data } : {}),
    };
    const frozen = Object.freeze(dto);
    sourceSongs.set(song, frozen);
    return frozen;
};

/** A song given to a source as a DTO or as its id alone (mutations, `likeSong`). */
export const toSourceSongOrId = (song: SongResult | string | number): string | FoliumSourceSong => (
    typeof song === 'object' ? toSourceSong(song) : String(song)
);

/** A source's user as the host's. */
export const toHostUser = (value: unknown): ProviderUser => {
    const user = record(value) ?? {};
    const avatarUrl = optionalText(user.avatarUrl);
    const backgroundUrl = optionalText(user.backgroundUrl);
    const vipType = finite(user.vipType);
    return {
        id: text(user.id),
        nickname: text(user.nickname),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(backgroundUrl ? { backgroundUrl } : {}),
        ...(vipType !== undefined ? { vipType } : {}),
    };
};

/** The host's user as a source's. */
export const toSourceUser = (user: ProviderUser): FoliumSourceUser => Object.freeze({
    id: String(user.id),
    nickname: user.nickname,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    ...(user.backgroundUrl ? { backgroundUrl: user.backgroundUrl } : {}),
    ...(user.vipType !== undefined ? { vipType: user.vipType } : {}),
});

const FM_MODES = new Set<unknown>(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD', 'PUZZLE_MODE_RCMD']);

/* What a radio card starts, read from a source's collection. */
const fmLaunchOf = (value: unknown): PersonalFmLaunch | undefined => {
    const fm = record(value);
    if (!fm || !FM_MODES.has(fm.mode)) return undefined;
    return {
        mode: fm.mode as PersonalFmModeId,
        scene: typeof fm.scene === 'string' ? fm.scene : null,
        ...(fm.station !== undefined ? { station: typeof fm.station === 'string' ? fm.station : null } : {}),
    };
};

/** A source's collection as the host's ProviderCollection of `providerId`. */
export const toHostCollection = (providerId: OnlineProviderId, collection: FoliumSourceCollection): ProviderCollection => {
    const raw = collection as unknown as Record<string, unknown>;
    const artists: ProviderArtistSummary[] = namedRefs(providerId, raw.artists);
    const personalFm = fmLaunchOf(raw.personalFm);
    const data = jsonRecord(providerId, raw.data);
    const creator = record(raw.creator);
    const aliases = textList(raw.aliases);
    const coverUrl = optionalText(raw.coverUrl);
    const numbers = (['trackCount', 'albumCount', 'publishedAt', 'playCount', 'updatedAt', 'tracksUpdatedAt'] as const)
        .flatMap((field) => {
            const value = finite(raw[field]);
            return value === undefined ? [] : [[field, value] as const];
        });
    return {
        providerId,
        id: text(raw.id),
        name: text(raw.name),
        type: text(raw.type) || 'playlist',
        ...(coverUrl ? { coverUrl } : {}),
        ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
        ...Object.fromEntries(numbers),
        ...(typeof raw.isOwned === 'boolean' ? { isOwned: raw.isOwned } : {}),
        ...(creator ? { creator: toHostUser(creator) } : {}),
        ...(artists.length > 0 ? { artists } : {}),
        ...(aliases ? { aliases } : {}),
        ...(typeof raw.publisher === 'string' ? { publisher: raw.publisher } : {}),
        ...(typeof raw.isLiked === 'boolean' ? { isLiked: raw.isLiked } : {}),
        ...(raw.listeningRank === 'week' || raw.listeningRank === 'all' ? { listeningRank: raw.listeningRank } : {}),
        ...(personalFm ? { personalFm } : {}),
        ...(data ? { providerData: data } : {}),
    };
};

const sourceCollections = new WeakMap<object, FoliumSourceCollection>();

/** The host's collection as a source's, made once per host object. Frozen. */
export const toSourceCollection = (collection: ProviderCollection): FoliumSourceCollection => {
    const kept = sourceCollections.get(collection);
    if (kept) return kept;
    const dto: FoliumSourceCollection = Object.freeze({
        id: String(collection.id),
        type: collection.type,
        name: collection.name,
        ...(collection.coverUrl ? { coverUrl: collection.coverUrl } : {}),
        ...(collection.description !== undefined ? { description: collection.description } : {}),
        ...(collection.trackCount !== undefined ? { trackCount: collection.trackCount } : {}),
        ...(collection.albumCount !== undefined ? { albumCount: collection.albumCount } : {}),
        ...(collection.isOwned !== undefined ? { isOwned: collection.isOwned } : {}),
        ...(collection.creator ? { creator: toSourceUser(collection.creator) } : {}),
        ...(collection.artists ? { artists: sourceRefsOf(collection.artists) } : {}),
        ...(collection.aliases ? { aliases: Object.freeze([...collection.aliases]) as string[] } : {}),
        ...(collection.publishedAt !== undefined ? { publishedAt: collection.publishedAt } : {}),
        ...(collection.publisher !== undefined ? { publisher: collection.publisher } : {}),
        ...(collection.playCount !== undefined ? { playCount: collection.playCount } : {}),
        ...(collection.updatedAt !== undefined ? { updatedAt: collection.updatedAt } : {}),
        ...(collection.tracksUpdatedAt !== undefined ? { tracksUpdatedAt: collection.tracksUpdatedAt } : {}),
        ...(collection.isLiked !== undefined ? { isLiked: collection.isLiked } : {}),
        ...(collection.listeningRank ? { listeningRank: collection.listeningRank } : {}),
        ...(collection.personalFm ? { personalFm: Object.freeze({ ...collection.personalFm }) } : {}),
        ...(collection.providerData ? { data: collection.providerData } : {}),
    });
    sourceCollections.set(collection, dto);
    return dto;
};

/** A collection given to a source as a DTO or as its id alone. */
export const toSourceCollectionOrId = (collection: ProviderCollection | string | number): string | FoliumSourceCollection => (
    typeof collection === 'object' ? toSourceCollection(collection) : String(collection)
);

/**
 * A source's page of items as the host's, each item converted by `convert` (null drops it, as a malformed
 * one is). `offset` is what was asked for: the next one defaults to it plus the items given.
 */
export const toHostPage = <To>(
    value: unknown,
    offset: number,
    convert: (item: unknown) => To | null,
): ProviderPage<To> => {
    const page = record(value);
    const given = Array.isArray(page?.items) ? page.items as unknown[] : [];
    const items: To[] = [];
    for (const item of given) {
        const converted = convert(item);
        if (converted !== null) items.push(converted);
    }
    const total = finite(page?.total);
    const nextOffset = finite(page?.nextOffset);
    return {
        items,
        ...(total !== undefined ? { total } : {}),
        hasMore: page?.hasMore === true,
        nextOffset: nextOffset ?? offset + given.length,
    };
};
