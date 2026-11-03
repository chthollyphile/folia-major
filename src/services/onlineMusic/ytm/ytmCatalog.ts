import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineCatalogProvider, ProviderCollection } from '../../../types/onlineMusic';
import { createYtmPager, normalizeYtmCollection, normalizeYtmSong, ytmSlicePage } from './ytmNormalize';
import { errorMessage } from '../../../utils/errorText';
import { requestYtm } from './ytmTransport';
import type { YtmWireAlbum, YtmWireArtistPage, YtmWirePage, YtmWireSong } from './ytmTransport';

// src/services/onlineMusic/ytm/ytmCatalog.ts

const PAGE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_PAGES = 32;

// An album or artist page arrives whole and answers several catalog calls; keep it briefly.
const createPageCache = <T>(load: (id: string) => Promise<T>) => {
    const pages = new Map<string, { at: number; value: Promise<T> }>();
    return {
        // `whateverItsAge` is for a caller in the middle of a list that must stay the same list.
        get(id: string, whateverItsAge = false): Promise<T> {
            const cached = pages.get(id);
            if (cached && (whateverItsAge || Date.now() - cached.at < PAGE_TTL_MS)) return cached.value;
            const value = load(id);
            pages.set(id, { at: Date.now(), value });
            value.catch(() => { if (pages.get(id)?.value === value) pages.delete(id); });
            while (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value as string);
            return value;
        },
        clear(): void { pages.clear(); },
    };
};

const albumPages = createPageCache(id => requestYtm<YtmWireAlbum>('album', { id }));
const artistPages = createPageCache(id => requestYtm<YtmWireArtistPage>('artist', { id }));
const songDetails = createPageCache(id => requestYtm<YtmWireSong | null>('song_detail', { id }));
// YouTube makes a mix up anew for every request; one answer is kept so that the pages of a mix
// are pages of the same list. Only a read from the top may replace an answer that has aged.
const mixPages = createPageCache(key => {
    const [id, videoId] = key.split(' ');
    return requestYtm<YtmWirePage<YtmWireSong>>('mix', videoId ? { id, videoId } : { id });
});
const trackPager = createYtmPager<UnifiedSong>();

export const clearYtmCatalogCache = (): void => {
    albumPages.clear();
    artistPages.clear();
    songDetails.clear();
    mixPages.clear();
    trackPager.clear();
};

// What marks a page token of the guest read below; the pager hands a token back as it got it.
const PUBLIC_PAGE = 'public ';

// The songs of a playlist, of the liked list or of a library album without a catalog id.
// A list is read as a guest of YouTube Music where that read has it: the same songs in the same
// order as the account's read gives (measured 2026-10-07 against the read of the device sign-in
// the app had then, not again since). A list that is not public has no rows there and is read as
// the account, 100 rows a request like the guest's (2026-10-09). `asAccount` skips the guest
// read: for the account's own playlist, usually private, which has to show a change the account
// just made (how soon the guest read shows one was not measured). The liked list is never public.
export const ytmPlaylistTracks = (id: string, limit: number, offset: number, asAccount = false) => trackPager.page(
    `playlist:${id}`, offset, limit,
    async continuation => {
        if (continuation === undefined ? !asAccount && id !== 'LM' : continuation.startsWith(PUBLIC_PAGE)) {
            // The first page falls back to the account's read; a further page has no such read to fall back to.
            const page = await requestYtm<YtmWirePage<YtmWireSong>>('public_playlist', { id, continuation: continuation?.slice(PUBLIC_PAGE.length) })
                .catch(error => {
                    if (continuation !== undefined) throw error;
                    console.warn(`[Ytm] Playlist ${id} could not be read as a guest (${errorMessage(error)}); it is read as the account`);
                    return null;
                });
            if (page && (continuation !== undefined || page.items.length > 0)) {
                return { items: page.items.map(normalizeYtmSong), continuation: page.continuation ? `${PUBLIC_PAGE}${page.continuation}` : undefined };
            }
        }
        const page = await requestYtm<YtmWirePage<YtmWireSong>>('playlist', { id, continuation });
        return { items: page.items.map(normalizeYtmSong), continuation: page.continuation };
    },
);

const isCatalogAlbum = (id: string) => id.startsWith('MPRE');
const needsCatalogRefs = (song: UnifiedSong) => !song.album.id || song.artists.some(artist => !artist.id);

// A playlist the account is offered to save to its library: one with a page of its own (a mix
// has none) that is not the liked-music list and not marked as the account's own. Only a library
// card carries that mark; for any other card the playlist's page settles it when the save is
// sent. A playlist is saved by its own id.
export const isSavableYtmPlaylist = (collection: ProviderCollection): boolean => (
    collection.type === 'playlist' && collection.id !== 'LM' && collection.isOwned !== true && collection.providerData?.mix !== true
);

// An album is saved, and its saved state read, by the id of its list (OLAK5uy_…): the one its
// catalogue page names, or the album's own id where that is a list id already. An album has more
// than one list id (a library card carries another than its page names, 2026-10-07); the same one
// is used for the read and the write, and the page's is the one both were measured with.
// The id of the album's own page goes along as `albumId` where the album has one: the desktop
// side reads the save button off that page, because the page of the album's list has none
// (2026-10-09).
export const ytmAlbumSaveParams = async (id: string): Promise<{ id: string; albumId?: string }> => {
    if (!isCatalogAlbum(id)) return { id };
    const listId = (await albumPages.get(id)).collection.playlistId;
    if (!listId) throw new OnlineProviderError('invalid-response', 'YouTube Music album page names no list', 'ytm');
    return { id: listId, albumId: id };
};

export const ytmCatalog: OnlineCatalogProvider = {
    canResolveSongCatalogRefs: song => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'ytm',
    // Rows from playlists carry display names only; the public watch page of the same video names
    // the artist and album by id and has the square cover.
    async resolveSongCatalogRefs(song) {
        if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== 'ytm' || !needsCatalogRefs(song)) return song;
        const detail = await songDetails.get(song.sourceRef.mediaId).catch(() => null);
        if (!detail) return song;
        const resolved = normalizeYtmSong(detail);
        return {
            ...song,
            artists: resolved.artists.length > 0 ? resolved.artists : song.artists,
            album: resolved.album.id || resolved.album.coverUrl
                ? { ...resolved.album, name: resolved.album.name || song.album.name, coverUrl: resolved.album.coverUrl || song.album.coverUrl }
                : song.album,
            durationMs: song.durationMs || resolved.durationMs,
        };
    },
    // A mix (a card of the explore page) has no playlist page; it is read as a queue.
    async getPlaylistTracks(id, limit, offset, collection) {
        if (collection?.providerData?.mix !== true) return ytmPlaylistTracks(String(id), limit, offset, collection?.isOwned === true);
        const first = collection.providerData.videoId;
        const mix = await mixPages.get(typeof first === 'string' ? `${id} ${first}` : String(id), offset > 0);
        return ytmSlicePage(mix.items.map(normalizeYtmSong), offset, limit);
    },
    // The library card already holds everything a playlist page would add.
    getPlaylistDetail: async (_id, collection) => collection ?? null,
    async getAlbumTracks(id, limit = 50, offset = 0) {
        if (!isCatalogAlbum(String(id))) return ytmPlaylistTracks(String(id), limit, offset);
        const album = await albumPages.get(String(id));
        return ytmSlicePage(album.items.map(normalizeYtmSong), offset, limit);
    },
    async getAlbumDetail(id, collection) {
        if (!isCatalogAlbum(String(id))) return collection ?? null;
        const album = await albumPages.get(String(id));
        return normalizeYtmCollection(album.collection, 'album');
    },
    async getSubscriptionStatus(type, id, collection) {
        if (type !== 'album' && !(collection && isSavableYtmPlaylist(collection))) return false;
        const state = await requestYtm<{ saved: boolean }>('list_saved', type === 'album' ? await ytmAlbumSaveParams(String(id)) : { id: String(id) });
        return state.saved === true;
    },
    async getArtistDetail(id) {
        const artist = await artistPages.get(String(id));
        return { ...normalizeYtmCollection(artist.collection, 'artist'), albumCount: artist.albums.length };
    },
    async getArtistSongs(id, limit, offset) {
        const artist = await artistPages.get(String(id));
        return ytmSlicePage(artist.songs.map(normalizeYtmSong), offset, limit);
    },
    async getArtistAlbums(id, limit, offset) {
        const artist = await artistPages.get(String(id));
        return ytmSlicePage<ProviderCollection>(artist.albums.map(album => normalizeYtmCollection(album, 'album')), offset, limit);
    },
};
