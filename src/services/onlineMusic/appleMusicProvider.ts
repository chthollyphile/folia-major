import type { OnlineMusicProvider } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { parseTTML } from '../../utils/lyrics/parserCore';
import { applePage, normalizeAppleCollection, normalizeAppleSong, type ApplePage } from './appleMusic/normalize';
import { applePath, getStorefront, hasMusicKit, requestApple } from './appleMusic/transport';
import { removeProviderSessionValue, writeProviderSessionValue } from './providerStorage';
import { musicKitPlayback } from './appleMusic/playback';
import { requestMusicKit } from './appleMusic/musicKitTransport';
import {
    canResolveAppleSongCatalogRefs, getAppleAlbumDetail, getAppleAlbumTracks, getAppleArtistAlbums, getAppleArtistDetail,
    getAppleArtistSongs, getAppleLibrarySongs, getAppleUserAlbums, resolveAppleSongCatalogRefs, searchAppleSongsByIsrc,
} from './appleMusic/catalog';
import {
    canEditApplePlaylist, getAppleLikedSongIds, getAppleSubscriptionStatus, likeAppleSong, subscribeAppleCollection, updateApplePlaylistTracks,
} from './appleMusic/library';
import { getAppleDailySongs, getApplePersonalFm, getAppleRecommendedCollections } from './appleMusic/recommendations';

// src/services/onlineMusic/appleMusicProvider.ts

export const appleMusicProvider: OnlineMusicProvider = {
    id: 'applemusic', displayName: 'Apple Music', shortName: 'Apple Music',
    getAvailability: () => ({ configured: hasMusicKit(), reason: hasMusicKit() ? undefined : 'runtime-unavailable' }),
    capabilities: { search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        userLibrary: true, playlists: true, albums: true, artists: true, userAlbums: true, userCloud: true, recommendations: true,
        mutations: true, likes: true, playlistTrackMutations: true, playlistSubscription: true },
    normalizeSong: normalizeAppleSong, normalizeCollection: normalizeAppleCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    getSongPageUrl: song => {
        const source = song.sourceRef;
        const id = source?.kind === 'online' ? String(source.providerData?.catalogId || source.mediaId) : String(song.id);
        return /^\d+$/.test(id) ? `https://music.apple.com/song/${id}` : null;
    },
    search: { async searchSongs(query, limit, offset) {
        const storefront = await getStorefront();
        const params = new URLSearchParams({ term: query, types: 'songs', limit: String(Math.max(1, Math.min(25, limit))), offset: String(offset) });
        const result = await requestApple<{ results: { songs?: ApplePage } }>(`/v1/catalog/${storefront}/search?${params}`);
        return applePage(result.results?.songs || { data: [] }, offset, normalizeAppleSong);
    }, searchSongsByIsrc: searchAppleSongsByIsrc },
    auth: {
        async configureConnection() {
            await requestMusicKit('connect');
            removeProviderSessionValue('applemusic', 'disconnected');
        },
        async getLoginStatus() {
            const storefront = await getStorefront();
            // This verifies library access, not merely public catalog access.
            await requestApple('/v1/me/library/playlists?limit=1');
            return { id: 'applemusic', nickname: `Apple Music (${storefront.toUpperCase()})` };
        },
        async logout() {
            await requestMusicKit('logout');
            writeProviderSessionValue('applemusic', 'disconnected', 'true');
        },
    },
    library: {
        async getUserPlaylists(_userId, limit, offset) {
            return applePage(await requestApple<ApplePage>(`/v1/me/library/playlists?limit=${Math.min(100, limit)}&offset=${offset}`), offset, item => normalizeAppleCollection(item, 'playlist'));
        },
        getUserAlbums: (_userId, limit, offset) => getAppleUserAlbums(limit, offset),
        getLikedSongIds: () => getAppleLikedSongIds(),
        // The collection itself is assembled by the account hook, which owns the localized label.
        getCloudCollection: async () => null,
    },
    catalog: {
        canResolveSongCatalogRefs: canResolveAppleSongCatalogRefs,
        resolveSongCatalogRefs: resolveAppleSongCatalogRefs,
        async getPlaylistTracks(id, limit, offset) {
            const prefix = String(id).startsWith('p.') ? '/v1/me/library' : `/v1/catalog/${await getStorefront()}`;
            return applePage(await requestApple<ApplePage>(`${prefix}/playlists/${encodeURIComponent(id)}/tracks?limit=${Math.min(100, limit)}&offset=${offset}`), offset, normalizeAppleSong);
        },
        async getPlaylistDetail(id) {
            const prefix = String(id).startsWith('p.') ? '/v1/me/library' : `/v1/catalog/${await getStorefront()}`;
            const result = await requestApple<ApplePage>(`${prefix}/playlists/${encodeURIComponent(id)}`);
            return result.data?.[0] ? normalizeAppleCollection(result.data[0], 'playlist') : null;
        },
        getAlbumDetail: getAppleAlbumDetail,
        getAlbumTracks: getAppleAlbumTracks,
        getArtistDetail: getAppleArtistDetail,
        getArtistSongs: getAppleArtistSongs,
        getArtistAlbums: getAppleArtistAlbums,
        getCloudTracks: getAppleLibrarySongs,
        getSubscriptionStatus: getAppleSubscriptionStatus,
    },
    recommendations: {
        getPersonalFm: () => getApplePersonalFm(),
        getDailySongs: () => getAppleDailySongs(),
        getRecommendedCollections: getAppleRecommendedCollections,
    },
    mutations: {
        canAddToPlaylist: canEditApplePlaylist,
        likeSong: likeAppleSong,
        updatePlaylistTracks: updateApplePlaylistTracks,
        subscribePlaylist: (playlist, subscribed) => subscribeAppleCollection('playlist', typeof playlist === 'object' ? playlist.id : playlist, subscribed),
        subscribeAlbum: (id, subscribed) => subscribeAppleCollection('album', id, subscribed),
    },
    playback: {
        remote: musicKitPlayback,
        async getSongDetail(id) {
            const result = await requestApple<ApplePage>(applePath(String(id), await getStorefront()));
            return result.data?.[0] ? normalizeAppleSong(result.data[0]) : null;
        },
        async getAudioSource() { throw new OnlineProviderError('unsupported', 'Apple Music uses authorized playback; no downloadable audio URL is exposed.', 'applemusic'); },
    },
    lyrics: { async getLyrics(song) {
        const ref = song.sourceRef;
        let id = ref?.kind === 'online' ? String(ref.providerData?.catalogId || ref.mediaId) : String(song.id);
        const storefront = await getStorefront();
        if (id.startsWith('i.')) {
            // Library-only responses can omit catalogId; lyrics belong to the catalog song.
            const catalog = await requestApple<ApplePage>(applePath(id, storefront, '/catalog'));
            const catalogId = catalog.data?.[0]?.id;
            if (!catalogId) return { lyrics: null, isPureMusic: false };
            id = catalogId;
        }
        for (const suffix of ['syllable-lyrics', 'lyrics']) {
            try {
                const result = await requestApple<{ data: Array<{ attributes?: { ttml?: string } }> }>(applePath(id, storefront, `/${suffix}`));
                const ttml = result.data?.[0]?.attributes?.ttml;
                if (ttml) return { lyrics: parseTTML(ttml), wordByWordText: ttml, isPureMusic: false };
            } catch (error) {
                if (!(error instanceof OnlineProviderError) || error.code !== 'invalid-response') throw error;
            }
        }
        return { lyrics: null, isPureMusic: false };
    } },
};
