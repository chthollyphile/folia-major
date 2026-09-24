import type { SongResult } from '../../../types';
import type { MediaId, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ApplePage } from './normalize';
import { getStorefront, requestApple } from './transport';

// src/services/onlineMusic/appleMusic/library.ts

const LIBRARY_SCAN_LIMIT = 1000;
const RATING_BATCH = 100;

const songMediaId = (song: MediaId | SongResult): string => {
    if (typeof song !== 'object') return String(song);
    const ref = song.sourceRef;
    return ref?.kind === 'online' ? String(ref.mediaId) : String(song.id);
};
const catalogOrMediaId = (song: MediaId | SongResult): string => {
    if (typeof song !== 'object') return String(song);
    const ref = song.sourceRef;
    return ref?.kind === 'online' ? String(ref.providerData?.catalogId || ref.mediaId) : String(song.id);
};
const ratingPath = (id: string) => `/v1/me/ratings/${id.startsWith('i.') ? 'library-songs' : 'songs'}/${encodeURIComponent(id)}`;

// A "like" is Apple's favourite rating (value 1); removing the rating clears it.
export async function likeAppleSong(song: MediaId | SongResult, liked: boolean): Promise<void> {
    const id = catalogOrMediaId(song);
    await requestApple(ratingPath(id), liked ? { method: 'PUT', body: { type: 'rating', attributes: { value: 1 } } } : { method: 'DELETE' });
}

type RatingPage = { data?: Array<{ id: string; attributes?: { value?: number } }> };

// Apple has no favourites listing. Favourites land in the library by default, so scan the newest
// additions and read their ratings in batches; both library and catalog ids are returned so either
// identity of a song lights up the heart.
export async function getAppleLikedSongIds(): Promise<MediaId[]> {
    const liked: MediaId[] = [];
    let offset = 0;
    while (offset < LIBRARY_SCAN_LIMIT) {
        const page = await requestApple<ApplePage>(`/v1/me/library/songs?limit=100&offset=${offset}&sort=-dateAdded`);
        const items = Array.isArray(page.data) ? page.data : [];
        if (items.length === 0) break;
        for (let start = 0; start < items.length; start += RATING_BATCH) {
            const chunk = items.slice(start, start + RATING_BATCH);
            const ids = chunk.map(item => encodeURIComponent(item.id)).join(',');
            // A batch with no rated songs may answer 404; treat it as "none rated" rather than failing the scan.
            const ratings = await requestApple<RatingPage>(`/v1/me/ratings/library-songs?ids=${ids}`).catch(() => ({ data: [] } as RatingPage));
            for (const rating of ratings.data ?? []) {
                if (rating.attributes?.value !== 1) continue;
                liked.push(rating.id);
                const catalogId = chunk.find(item => item.id === rating.id)?.attributes?.playParams?.catalogId;
                if (catalogId) liked.push(catalogId);
            }
        }
        if (!page.next) break;
        offset += items.length;
    }
    return liked;
}

export const canEditApplePlaylist = (playlist: ProviderCollection) => String(playlist.id).startsWith('p.') && playlist.providerData?.canEdit === true;

// Apple's API appends tracks to the user's own playlists but offers no removal.
export async function updateApplePlaylistTracks(operation: 'add' | 'del', playlist: MediaId | ProviderCollection, tracks: Array<MediaId | SongResult>): Promise<void> {
    if (operation !== 'add') throw new OnlineProviderError('unsupported', 'Apple Music does not allow removing playlist tracks through its API.', 'applemusic');
    const playlistId = typeof playlist === 'object' ? String(playlist.id) : String(playlist);
    if (typeof playlist === 'object' && !canEditApplePlaylist(playlist)) throw new OnlineProviderError('unsupported', 'Only your own Apple Music playlists accept new tracks.', 'applemusic');
    const data = tracks.map(track => {
        const id = songMediaId(track);
        return { id, type: id.startsWith('i.') ? 'library-songs' : 'songs' };
    });
    if (data.length === 0) return;
    await requestApple(`/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`, { method: 'POST', body: { data } });
}

const libraryKind = (type: 'playlist' | 'album') => (type === 'album' ? 'albums' : 'playlists');
const isLibraryCollectionId = (id: string) => id.startsWith('p.') || id.startsWith('l.');

// Apple's API can add a catalog playlist or album to the library but never remove it.
export async function subscribeAppleCollection(type: 'playlist' | 'album', id: MediaId, subscribed: boolean): Promise<void> {
    if (!subscribed) throw new OnlineProviderError('unsupported', 'Apple Music does not allow removing items from the library through its API.', 'applemusic');
    const collectionId = String(id);
    if (isLibraryCollectionId(collectionId)) return;
    await requestApple(`/v1/me/library?ids[${libraryKind(type)}]=${encodeURIComponent(collectionId)}`, { method: 'POST' });
}

// The catalog resource's `library` relationship answers 404 when the user has not added it.
export async function getAppleSubscriptionStatus(type: 'playlist' | 'album', id: MediaId): Promise<boolean> {
    const collectionId = String(id);
    if (isLibraryCollectionId(collectionId)) return true;
    const path = `/v1/catalog/${await getStorefront()}/${libraryKind(type)}/${encodeURIComponent(collectionId)}/library`;
    const result = await requestApple<ApplePage>(path).catch(() => ({ data: [] } as ApplePage));
    return Array.isArray(result.data) && result.data.length > 0;
}
