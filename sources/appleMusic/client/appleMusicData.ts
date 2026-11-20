import type { FoliumSourceCollection, FoliumSourcePage, FoliumSourceSong } from '@folia/folium';
import { normalizeAppleMusicCatalogCollection, normalizeAppleMusicLibraryAlbum, normalizeAppleMusicPlaylist, normalizeAppleMusicSong } from './appleMusicNormalize';
import { appleMusicCauseOf, appleMusicError, appleMusicHttpStatusOf, requestAppleMusic } from './appleMusicTransport';
import type { AppleMusicOperation, AppleMusicParams } from './appleMusicTransport';

// sources/appleMusic/client/appleMusicData.ts
// The source's reads and writes of the account's library and Apple's catalog, through the companion; every page
// it answers is validated before it becomes source DTOs.

// The name of the virtual playlist of all library songs, in the UI language now (the mod's locale files).
let libraryPlaylistName: () => string = () => 'All songs';

/** Connects the name of the all-songs playlist (index.ts hands the mod's own text in). */
export const connectAppleMusicLibraryName = (name: () => string): void => {
    libraryPlaylistName = name;
};

// Adapt only validated companion pages; invalid pagination must never look like a complete library.
interface CompanionPage {
    items: unknown[];
    hasMore: boolean;
    nextOffset: number;
}

function pageOf<T>(
    value: unknown,
    offset: number,
    normalize: (item: unknown) => T,
    accept: (item: unknown) => boolean = () => true,
): FoliumSourcePage<T> & { nextOffset: number } {
    const page = value as Partial<CompanionPage> | null;
    if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
        || !Number.isSafeInteger(page.nextOffset) || (page.nextOffset as number) < offset + page.items.length
        || (page.hasMore && (page.nextOffset as number) <= offset)) {
        throw appleMusicError('invalid-response', 'Apple Music page is invalid');
    }
    // A library page can hold rows this adapter does not model (folders, videos). They are left out
    // rather than failing the whole page; the page's own next offset still steps over them.
    const kept = page.items.filter(accept);
    if (kept.length !== page.items.length) {
        console.info(`[AppleMusic] left ${page.items.length - kept.length} unsupported row(s) out of a page`);
    }
    return { items: kept.map(normalize), hasMore: page.hasMore, nextOffset: page.nextOffset as number };
}

const isSongResource = (item: unknown): boolean => {
    const type = (item as { type?: unknown } | null)?.type;
    return type === 'songs' || type === 'library-songs';
};
const isPlaylistResource = (item: unknown): boolean => {
    const type = (item as { type?: unknown } | null)?.type;
    return type === 'playlists' || type === 'library-playlists';
};

// Apple's API takes at most this many rows in one request, while Folia's callers ask for pages
// of their own size (a collection asks 150 for its first page and 1000 for the rest).
const MAX_ROWS_PER_REQUEST = 100;
export const APPLE_MUSIC_LIBRARY_PLAYLIST_ID = 'library-songs';

/**
 * Reads `limit` rows from `offset`, one Apple page at a time. The returned next offset is the
 * server's own, so a caller's next page continues exactly where Apple stopped, unsupported rows
 * and all.
 */
async function readPage<T>(
    operation: AppleMusicOperation,
    params: AppleMusicParams,
    limit: number,
    offset: number,
    normalize: (item: unknown) => T,
    accept: (item: unknown) => boolean,
): Promise<FoliumSourcePage<T>> {
    const wanted = Math.max(1, Math.floor(limit));
    const items: T[] = [];
    let nextOffset = offset;
    let hasMore = false;
    // Bounds a page full of unsupported rows, and a server that keeps promising more.
    for (let attempt = 0; attempt < 200; attempt++) {
        const take = Math.min(MAX_ROWS_PER_REQUEST, wanted - items.length);
        if (take <= 0) break;
        const data = await requestAppleMusic(operation, { ...params, limit: take, offset: nextOffset });
        const page = pageOf(data, nextOffset, normalize, accept);
        items.push(...page.items);
        hasMore = page.hasMore;
        nextOffset = page.nextOffset;
        if (!hasMore) break;
    }
    return { items, hasMore, nextOffset };
}

const pageInputs = (limit: number, offset: number): { limit: number; offset: number } => ({
    limit: Math.max(1, Math.floor(limit)),
    offset: Math.max(0, Math.floor(offset)),
});

// A library song can only use catalog-only APIs when Apple supplies its matching catalog ID. The host hands this
// source only its own songs, so which platform a song is of is not asked here any more.
export function appleMusicCatalogSongId(song: FoliumSourceSong): string {
    const catalog = song.data?.resourceType === 'songs' ? song.id : song.data?.catalogId;
    if (typeof catalog !== 'string' || !/^\d{1,40}$/.test(catalog)) {
        throw appleMusicError('unsupported', 'Apple Music catalog identity is unavailable');
    }
    return catalog;
}

// A library song's own id (`i.` + letters and digits), the form MusicKit queues a library item by.
const APPLE_MUSIC_LIBRARY_SONG_ID = /^i\.[a-zA-Z0-9]{1,100}$/;

/**
 * The id the companion's player queues this song by: its catalog id when Apple maps it to one,
 * otherwise its library id. A song the user uploaded (iTunes Match / Sync Library) has no catalog
 * counterpart and plays only by its library id, the way Apple's own web player starts it. Lyrics,
 * likes and playlist additions are catalog-only and keep using `appleMusicCatalogSongId`.
 */
export function appleMusicPlaybackSongId(song: FoliumSourceSong): string {
    try { return appleMusicCatalogSongId(song); } catch (error) {
        if (song.data?.resourceType !== 'library-songs') throw error;
        const libraryId = [song.data.playbackId, song.id]
            .find((id): id is string => typeof id === 'string' && APPLE_MUSIC_LIBRARY_SONG_ID.test(id));
        if (!libraryId) throw error;
        return libraryId;
    }
}

// Whether the player queues this song by a library id (an upload with no catalog song).
export function isAppleMusicLibraryPlaybackId(id: string): boolean {
    return APPLE_MUSIC_LIBRARY_SONG_ID.test(id);
}

// Missing play parameters mean the current storefront cannot stream this row; an upload plays by its library id.
export function isAppleMusicSongPlayable(song: FoliumSourceSong): boolean {
    if (song.data?.playbackAvailable === false) return false;
    try { appleMusicPlaybackSongId(song); return true; } catch { return false; }
}

// These functions are provider building blocks, not a second public API for UI callers.
export async function searchAppleMusic(query: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> {
    if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset, total: 0 };
    const page = pageInputs(limit, offset);
    return readPage('search', { query }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

// Apple's personal station supplies each new batch; never replace it with another provider's radio.
export async function getAppleMusicPersonalFm(): Promise<FoliumSourceSong[]> {
    const data = await requestAppleMusic('personalFm');
    return pageOf(data, 0, normalizeAppleMusicSong, isSongResource).items.filter(isAppleMusicSongPlayable);
}

// Catalog lookups remain bounded and return only the resource types Folia can open.
export async function getAppleMusicCatalogPage(operation: 'catalogSong' | 'catalogAlbum' | 'catalogAlbumTracks' | 'catalogArtist' | 'catalogArtistSongs' | 'catalogArtistAlbums', catalogId: string, limit: number, offset: number) {
    const page = pageInputs(limit, offset);
    const song = operation === 'catalogSong' || operation === 'catalogAlbumTracks' || operation === 'catalogArtistSongs';
    return song
        ? readPage(operation, { catalogId }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource)
        : readPage(operation, { catalogId }, page.limit, page.offset, normalizeAppleMusicCatalogCollection,
            item => ['albums', 'artists'].includes(String((item as { type?: unknown } | null)?.type)));
}

// Keep library identity and unmapped uploads, using the existing validated page reader.
export async function getAppleMusicLibrarySongs(limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> {
    const page = pageInputs(limit, offset);
    return readPage('librarySongs', {}, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

// Read library albums and their tracks using the same validated pagination as playlists.
export async function getAppleMusicLibraryAlbums(limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>> {
    const page = pageInputs(limit, offset);
    return readPage('libraryAlbums', {}, page.limit, page.offset, normalizeAppleMusicLibraryAlbum,
        item => (item as { type?: unknown } | null)?.type === 'library-albums');
}
export async function getAppleMusicLibraryAlbumTracks(albumId: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> {
    const page = pageInputs(limit, offset);
    return readPage('libraryAlbumTracks', { albumId }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

export async function getAppleMusicPlaylists(limit: number, offset: number, includeCounts = false): Promise<FoliumSourcePage<FoliumSourceCollection>> {
    const page = pageInputs(limit, offset);
    const result = await readPage('playlists', {}, page.limit, page.offset, normalizeAppleMusicPlaylist, isPlaylistResource);
    if (page.offset === 0) {
        // This read-only virtual playlist opens all library songs, not the favorites list.
        result.items.unshift({
            id: APPLE_MUSIC_LIBRARY_PLAYLIST_ID, type: 'playlist',
            name: libraryPlaylistName(), isOwned: true,
        });
    }
    if (!includeCounts) return result;
    // The playlist list has no count. Ask only for one track and use Apple's total, with two reads at a time.
    let cursor = 0;
    const readCounts = async () => {
        while (cursor < result.items.length) {
            const item = result.items[cursor++];
            if (item.id === APPLE_MUSIC_LIBRARY_PLAYLIST_ID) continue;
            try {
                const answer = await requestAppleMusic<{ total?: unknown }>('playlistTrackCount', { playlistId: item.id });
                if (typeof answer?.total === 'number' && Number.isSafeInteger(answer.total) && answer.total >= 0) item.trackCount = answer.total;
            } catch (error) {
                // An optional count must not make a readable playlist disappear or look empty.
                console.warn('[AppleMusic] Playlist count unavailable', error);
            }
        }
    };
    await Promise.all([readCounts(), readCounts()]);
    return result;
}

export async function getAppleMusicPlaylistTracks(id: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> {
    const page = pageInputs(limit, offset);
    return readPage('playlistTracks', { playlistId: id }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

// Apple answers a song it has no timed lyric for with no TTML (or a 404): that is an empty answer.
// A sign-in that ran out is not, and neither is a reply that cannot be read.
export async function getAppleMusicTtml(song: FoliumSourceSong): Promise<string | null> {
    let data: { ttml?: unknown } | null;
    try {
        data = await requestAppleMusic<{ ttml?: unknown }>('lyrics', { songId: appleMusicCatalogSongId(song) });
    } catch (error) {
        if (appleMusicCauseOf(error) === 'lyrics-unavailable' || appleMusicHttpStatusOf(error) === 404) return null;
        throw error;
    }
    if (typeof data?.ttml !== 'string' || !data.ttml.trim()) return null;
    return data.ttml;
}

// Read the tagged system playlist, not a user playlist with a translated or matching name.
export async function getAppleMusicLikedSongIds(): Promise<{ ids: string[]; whole: boolean }> {
    const playlists = await getAppleMusicPlaylists(10000, 0, false);
    const favorites = playlists.items.find(item => item.isLiked === true);
    if (!favorites) return { ids: [], whole: false };
    const tracks = await getAppleMusicPlaylistTracks(favorites.id, 10000, 0);
    const ids = new Set<string>();
    for (const song of tracks.items) {
        ids.add(appleMusicSongLikeId(song));
    }
    return { ids: [...ids], whole: !tracks.hasMore };
}

// The id a like or playlist addition sends: the catalog id, or an upload's library id (see appleMusicPlaybackSongId).
function appleMusicMutationSongId(song: string | FoliumSourceSong): string {
    const id = typeof song === 'object' ? appleMusicPlaybackSongId(song) : song;
    if (!/^\d{1,40}$/.test(id) && !isAppleMusicLibraryPlaybackId(id)) {
        throw appleMusicError('unsupported', 'Apple Music song identity is unavailable');
    }
    return id;
}

// Mutations stay within this provider boundary and reuse Omni's account/race handling. An upload is liked
// by its library id; the companion says which route took it, and a refusal is logged with the route it hit.
export async function setAppleMusicSongLiked(song: string | FoliumSourceSong, liked: boolean): Promise<void> {
    const id = appleMusicMutationSongId(song);
    const kind = isAppleMusicLibraryPlaybackId(id) ? 'library' : 'catalog';
    try {
        const result = await requestAppleMusic<{ route?: unknown }>('likeSong', { catalogId: id, liked });
        if (kind === 'library') console.info('[AppleMusic] library song like taken', { liked, route: typeof result?.route === 'string' ? result.route : null });
    } catch (error) {
        console.warn('[AppleMusic] like refused', { kind, liked }, error);
        throw error;
    }
}

// Favorite state has a catalog identity even when playback/list rows keep their library identity.
export function appleMusicSongLikeId(song: FoliumSourceSong): string {
    try { return appleMusicCatalogSongId(song); } catch { return song.id; }
}

// Only Apple's explicitly editable library playlists accept additions; favorites use the heart action.
export function canAddToAppleMusicPlaylist(playlist: FoliumSourceCollection): boolean {
    return playlist.type === 'playlist' && playlist.id !== APPLE_MUSIC_LIBRARY_PLAYLIST_ID && playlist.isLiked !== true
        && playlist.data?.resourceType === 'library-playlists' && playlist.data.canEdit === true;
}

// Keep the shared mutation contract, but expose only additions until deletion is implemented separately.
export async function updateAppleMusicPlaylistTracks(
    operation: 'add' | 'del', playlist: string | FoliumSourceCollection, tracks: Array<string | FoliumSourceSong>,
): Promise<void> {
    if (operation !== 'add' || typeof playlist !== 'object' || !canAddToAppleMusicPlaylist(playlist)) {
        throw appleMusicError('unsupported', 'Apple Music playlist does not accept this change');
    }
    if (!tracks.length || tracks.length > 100) throw appleMusicError('unsupported', 'Apple Music playlist additions require 1 to 100 songs');
    const ids = tracks.map(appleMusicMutationSongId);
    const library = ids.filter(isAppleMusicLibraryPlaybackId).length;
    try {
        await requestAppleMusic('addPlaylistTracks', { playlistId: playlist.id, catalogIds: [...new Set(ids)] });
    } catch (error) {
        console.warn('[AppleMusic] playlist addition refused', { songs: ids.length, librarySongs: library }, error);
        throw error;
    }
}
