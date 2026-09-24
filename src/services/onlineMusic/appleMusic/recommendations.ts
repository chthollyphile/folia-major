import type { UnifiedSong } from '../../../types';
import type { ProviderCollection } from '../../../types/onlineMusic';
import { normalizeAppleCollection, normalizeAppleSong, type ApplePage, type AppleResource } from './normalize';
import { getStorefront, requestApple } from './transport';

// src/services/onlineMusic/appleMusic/recommendations.ts

const COLLECTION_TYPES = new Set(['playlists', 'albums', 'library-playlists', 'library-albums']);
const SONG_TYPES = new Set(['songs', 'library-songs']);
const FM_LENGTH = 30;

// "Made for You" groups nest their playlists and albums under each recommendation's `contents`.
async function loadRecommendationContents(): Promise<AppleResource[]> {
    const result = await requestApple<ApplePage>('/v1/me/recommendations');
    return (Array.isArray(result.data) ? result.data : []).flatMap(group => group.relationships?.contents?.data ?? []);
}

async function loadPlaylistTracks(id: string): Promise<UnifiedSong[]> {
    const prefix = id.startsWith('p.') ? '/v1/me/library' : `/v1/catalog/${await getStorefront()}`;
    const page = await requestApple<ApplePage>(`${prefix}/playlists/${encodeURIComponent(id)}/tracks?limit=100`);
    return (Array.isArray(page.data) ? page.data : []).map(normalizeAppleSong);
}

export async function getAppleRecentSongs(): Promise<UnifiedSong[]> {
    const page = await requestApple<ApplePage>('/v1/me/recent/played/tracks');
    return (Array.isArray(page.data) ? page.data : []).filter(item => SONG_TYPES.has(item.type)).map(normalizeAppleSong);
}

type ChartsResult = { results?: { playlists?: Array<{ data?: AppleResource[] }> } };

const loadChartPlaylists = async (): Promise<AppleResource[]> => {
    const result = await requestApple<ChartsResult>(`/v1/catalog/${await getStorefront()}/charts?types=playlists&limit=10`);
    return (result.results?.playlists ?? []).flatMap(chart => chart.data ?? []);
};

// Personal recommendations first, then heavy rotation, then storefront chart playlists, deduplicated by id.
export async function getAppleRecommendedCollections(limit: number): Promise<ProviderCollection[]> {
    const [contents, heavyRotation, charts] = await Promise.all([
        loadRecommendationContents(),
        requestApple<ApplePage>('/v1/me/history/heavy-rotation').then(result => (Array.isArray(result.data) ? result.data : [])).catch(() => [] as AppleResource[]),
        loadChartPlaylists().catch(() => [] as AppleResource[]),
    ]);
    const seen = new Set<string>();
    const collections: ProviderCollection[] = [];
    for (const item of [...contents, ...heavyRotation, ...charts]) {
        if (!COLLECTION_TYPES.has(item.type) || seen.has(item.id)) continue;
        seen.add(item.id);
        try { collections.push(normalizeAppleCollection(item)); } catch { /* skip resources without a name */ }
        if (collections.length >= limit) break;
    }
    return collections;
}

// Apple curates weekly personal mixes (`pl.pm-…`) instead of a daily list; the first mix stands in,
// and recent plays fill the slot for accounts without one.
export async function getAppleDailySongs(): Promise<UnifiedSong[]> {
    const contents = await loadRecommendationContents().catch(() => [] as AppleResource[]);
    const mix = contents.find(item => item.type === 'playlists' && item.id.startsWith('pl.pm-'));
    return mix ? loadPlaylistTracks(mix.id) : getAppleRecentSongs();
}

// Folia cannot fetch station audio, so the FM card plays a shuffled slice of a recommended playlist.
export async function getApplePersonalFm(): Promise<UnifiedSong[]> {
    const contents = await loadRecommendationContents().catch(() => [] as AppleResource[]);
    const playlists = contents.filter(item => item.type === 'playlists');
    const pick = playlists[Math.floor(Math.random() * playlists.length)];
    const songs = pick ? await loadPlaylistTracks(pick.id) : await getAppleRecentSongs();
    for (let index = songs.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [songs[index], songs[swap]] = [songs[swap], songs[index]];
    }
    return songs.slice(0, FM_LENGTH);
}
