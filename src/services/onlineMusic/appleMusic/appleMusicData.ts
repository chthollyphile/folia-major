import type { SongResult, UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderCollection, ProviderLikedSongIds, ProviderPage } from '../../../types/onlineMusic';
import { normalizeAppleMusicCatalogCollection, normalizeAppleMusicLibraryAlbum, normalizeAppleMusicPlaylist, normalizeAppleMusicSong } from './appleMusicNormalize';
import { requestAppleMusic } from './appleMusicTransport';
import type { AppleMusicOperation, AppleMusicParams } from './appleMusicTransport';

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
): ProviderPage<T> {
    const page = value as Partial<CompanionPage> | null;
    if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
        || !Number.isSafeInteger(page.nextOffset) || (page.nextOffset as number) < offset + page.items.length
        || (page.hasMore && (page.nextOffset as number) <= offset)) {
        throw new OnlineProviderError('invalid-response', 'Apple Music page is invalid', 'appleMusic');
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
): Promise<ProviderPage<T>> {
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

// A library song can only use catalog-only APIs when Apple supplies its matching catalog ID.
export function appleMusicCatalogSongId(song: SongResult): string {
    const source = song.sourceRef;
    if (source?.kind !== 'online' || source.providerId !== 'appleMusic') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to Apple Music', 'appleMusic');
    }
    const catalog = source.providerData?.resourceType === 'songs' ? source.mediaId : source.providerData?.catalogId;
    if (typeof catalog !== 'string' || !/^\d{1,40}$/.test(catalog)) {
        throw new OnlineProviderError('unsupported', 'Apple Music catalog identity is unavailable', 'appleMusic');
    }
    return catalog;
}

// Missing play parameters mean the current storefront cannot stream this row; uploads also need a catalog mapping here.
export function isAppleMusicSongPlayable(song: SongResult): boolean {
    if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== 'appleMusic'
        || song.sourceRef.providerData?.playbackAvailable === false) return false;
    try { appleMusicCatalogSongId(song); return true; } catch { return false; }
}

// These functions are provider building blocks, not a second public API for UI callers.
export async function searchAppleMusic(query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
    if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset, total: 0 };
    const page = pageInputs(limit, offset);
    return readPage('search', { query }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

// Apple's personal station supplies each new batch; never replace it with another provider's radio.
export async function getAppleMusicPersonalFm(): Promise<UnifiedSong[]> {
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

// Read library albums and their tracks using the same validated pagination as playlists.
export async function getAppleMusicLibraryAlbums(limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
    const page = pageInputs(limit, offset);
    return readPage('libraryAlbums', {}, page.limit, page.offset, normalizeAppleMusicLibraryAlbum,
        item => (item as { type?: unknown } | null)?.type === 'library-albums');
}
export async function getAppleMusicLibraryAlbumTracks(albumId: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
    const page = pageInputs(limit, offset);
    return readPage('libraryAlbumTracks', { albumId }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

export async function getAppleMusicPlaylists(limit: number, offset: number, includeCounts = false): Promise<ProviderPage<ProviderCollection>> {
    const page = pageInputs(limit, offset);
    const result = await readPage('playlists', {}, page.limit, page.offset, normalizeAppleMusicPlaylist, isPlaylistResource);
    if (!includeCounts) return result;
    // The playlist list has no count. Ask only for one track and use Apple's total, with two reads at a time.
    let cursor = 0;
    const readCounts = async () => {
        while (cursor < result.items.length) {
            const item = result.items[cursor++];
            try {
                const answer = await requestAppleMusic<{ total?: unknown }>('playlistTrackCount', { playlistId: String(item.id) });
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

export async function getAppleMusicPlaylistTracks(id: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
    const page = pageInputs(limit, offset);
    return readPage('playlistTracks', { playlistId: id }, page.limit, page.offset, normalizeAppleMusicSong, isSongResource);
}

// Apple answers a song it has no timed lyric for with no TTML (or a 404): that is an empty answer.
// A sign-in that ran out is not, and neither is a reply that cannot be read.
export async function getAppleMusicTtml(song: SongResult): Promise<string | null> {
    let data: { ttml?: unknown } | null;
    try {
        data = await requestAppleMusic<{ ttml?: unknown }>('lyrics', { songId: appleMusicCatalogSongId(song) });
    } catch (error) {
        if (error instanceof OnlineProviderError
            && (error.cause === 'lyrics-unavailable' || error.httpStatus === 404)) return null;
        throw error;
    }
    if (typeof data?.ttml !== 'string' || !data.ttml.trim()) return null;
    return data.ttml;
}

// Read the tagged system playlist, not a user playlist with a translated or matching name.
export async function getAppleMusicLikedSongIds(): Promise<ProviderLikedSongIds> {
    const playlists = await getAppleMusicPlaylists(10000, 0, false);
    const favorites = playlists.items.find(item => item.isLiked === true);
    if (!favorites) return { ids: [], whole: false };
    const tracks = await getAppleMusicPlaylistTracks(String(favorites.id), 10000, 0);
    const ids = new Set<string>();
    for (const song of tracks.items) {
        ids.add(String(appleMusicSongLikeId(song)));
    }
    return { ids: [...ids], whole: !tracks.hasMore };
}

// Mutations stay within this provider boundary and reuse Omni's account/race handling.
export async function setAppleMusicSongLiked(song: string | number | SongResult, liked: boolean): Promise<void> {
    const catalogId = typeof song === 'object' ? appleMusicCatalogSongId(song) : String(song);
    if (!/^\d{1,40}$/.test(catalogId)) throw new OnlineProviderError('unsupported', 'Apple Music catalog identity is unavailable', 'appleMusic');
    await requestAppleMusic('likeSong', { catalogId, liked });
}

// Favorite state has a catalog identity even when playback/list rows keep their library identity.
export function appleMusicSongLikeId(song: SongResult): string | number {
    try { return appleMusicCatalogSongId(song); } catch { return song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id; }
}

// Only Apple's explicitly editable library playlists accept additions; favorites use the heart action.
export function canAddToAppleMusicPlaylist(playlist: ProviderCollection): boolean {
    return playlist.providerId === 'appleMusic' && playlist.type === 'playlist' && playlist.isLiked !== true
        && playlist.providerData?.resourceType === 'library-playlists' && playlist.providerData?.canEdit === true;
}

// Keep the shared mutation contract, but expose only additions until deletion is implemented separately.
export async function updateAppleMusicPlaylistTracks(
    operation: 'add' | 'del', playlist: string | number | ProviderCollection, tracks: Array<string | number | SongResult>,
): Promise<void> {
    if (operation !== 'add' || typeof playlist !== 'object' || !canAddToAppleMusicPlaylist(playlist)) {
        throw new OnlineProviderError('unsupported', 'Apple Music playlist does not accept this change', 'appleMusic');
    }
    if (!tracks.length || tracks.length > 100) throw new OnlineProviderError('unsupported', 'Apple Music playlist additions require 1 to 100 songs', 'appleMusic');
    const catalogIds = tracks.map(song => typeof song === 'object' ? appleMusicCatalogSongId(song) : String(song));
    if (catalogIds.some(id => !/^\d{1,40}$/.test(id))) throw new OnlineProviderError('unsupported', 'Apple Music catalog identity is unavailable', 'appleMusic');
    await requestAppleMusic('addPlaylistTracks', { playlistId: String(playlist.id), catalogIds: [...new Set(catalogIds)] });
}
