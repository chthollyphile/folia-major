import type { OnlineMusicProvider, ProviderAudioSource, ProviderCollection, QrLoginState } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { parseBodianLyrics } from '../../utils/lyrics/bodianLyrics';
import { getBodianTransportAvailability, requestBodian } from './bodianTransport';
import { bodianPage, normalizeBodianCollection, normalizeBodianSong, normalizeBodianUser } from './bodianNormalize';
import { bodianCatalog } from './bodianCatalog';
import { bodianLibrary, clearBodianLibraryCache } from './bodianLibrary';
import { bodianMutations } from './bodianMutations';
import type { BodianLyricsPayload } from 'bodian-music-api';

// src/services/onlineMusic/bodianProvider.ts

const BODIAN_DISCOVER_MODULE_ID = 1;

type BodianDiscoverDetail = { title?: unknown; subTitle?: unknown; musicList?: unknown[] };

const normalizeBodianDiscoverCollection = (detail: BodianDiscoverDetail, index: number, fallbackTitle?: unknown): ProviderCollection => {
    const songs = Array.isArray(detail.musicList) ? detail.musicList.map(normalizeBodianSong) : [];
    const firstSong = songs[0];
    return {
        providerId: 'bodian',
        id: `discover-${index}`,
        type: 'playlist',
        name: String(detail.title || fallbackTitle || `Discover ${index + 1}`),
        coverUrl: firstSong?.album.coverUrl || '',
        description: String(detail.subTitle || '「为你量身打造的专属歌单」'),
        trackCount: songs.length,
        providerData: { discoverIndex: index },
    };
};

async function getBodianDiscoverCollections(): Promise<ProviderCollection[]> {
    try {
        const module = await requestBodian<any>('home_module', { moduleId: BODIAN_DISCOVER_MODULE_ID });
        const cards = Array.isArray(module.songList) ? module.songList : [];
        const results = await Promise.allSettled(cards.map(async (card: any) => {
            const index = Number(card?.id);
            if (!Number.isInteger(index) || index < 0) return null;
            const detail = await requestBodian<BodianDiscoverDetail>('ai_playlist_detail', { index });
            return normalizeBodianDiscoverCollection(detail, index, card?.title);
        }));
        return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    } catch {
        return [];
    }
}

export const bodianProvider: OnlineMusicProvider = {
    id: 'bodian', displayName: '波点音乐', shortName: '波点',
    getAvailability: getBodianTransportAvailability,
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        playlists: true, albums: true, artists: true, recommendations: true,
        userLibrary: true, userAlbums: true, likes: true, mutations: true, playlistTrackMutations: true,
    },
    normalizeSong: normalizeBodianSong, normalizeUser: normalizeBodianUser, normalizeCollection: normalizeBodianCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return bodianPage([], 0, offset, limit);
            const data = await requestBodian<any>('search', { query, limit, offset });
            if (!Array.isArray(data.resultList)) throw new OnlineProviderError('invalid-response', 'Bodian search list is missing', 'bodian');
            return bodianPage(data.resultList.map(normalizeBodianSong), data.total, offset, limit, data.bodianPagination);
        },
    },
    playback: {
        async getSongDetail(id) { return normalizeBodianSong(await requestBodian('song_detail', { id })); },
        async getAudioSource(song, quality) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bodian') {
                throw new OnlineProviderError('unsupported', 'Song does not belong to Bodian', 'bodian');
            }
            const audio = await requestBodian<ProviderAudioSource & { preview?: { startTime: number; endTime: number } }>('audio', {
                id: source.mediaId, quality, freeSign: typeof source.providerData?.freeSign === 'string' ? source.providerData.freeSign : '',
            });
            // Full-track caches and timing must never ingest a 30-second preview as the complete song.
            if (audio.preview) throw new OnlineProviderError('preview-only', 'Bodian only offers a preview; sign in with an eligible account', 'bodian');
            return audio;
        },
        // 只有下架信号会给 unavailable / taken-down；播放限制交给运行时。缓存里旧的布尔 `unavailable`
        // 分不清下架还是限制（缓存歌曲在 normalizeBodianSong 原样放行），一律按 unknown。
        getAvailability(song) {
            const availability = song.sourceRef?.kind === 'online' ? song.sourceRef.providerData?.availability : undefined;
            if (availability === 'off-shelf') return { state: 'unavailable', reason: 'taken-down' };
            if (availability === 'online-play-restricted') return { state: 'unknown', reason: 'restricted' };
            return { state: 'unknown' };
        },
    },
    lyrics: {
        async getLyrics(song) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bodian') {
                throw new OnlineProviderError('unsupported', 'Song does not belong to Bodian', 'bodian');
            }
            const data = await requestBodian<BodianLyricsPayload>('lyrics', { id: source.mediaId });
            return parseBodianLyrics(data);
        },
    },
    auth: {
        getLoginStatus: () => requestBodian('login_status'),
        async logout() { clearBodianLibraryCache(); await requestBodian('logout'); },
        async getQrKey() { return (await requestBodian<{ key: string }>('login_qr_key')).key; },
        async createQr(key) { return (await requestBodian<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
        checkQr: key => requestBodian<QrLoginState>('login_qr_check', { key }),
        async cancelQr(key) { await requestBodian('login_qr_cancel', { key }); },
        getQrTtlMs: () => 5 * 60 * 1000,
    },
    catalog: bodianCatalog,
    library: bodianLibrary,
    mutations: bodianMutations,
    recommendations: {
        async getRecommendedCollections(limit) {
            const [regular, discover] = await Promise.all([
                requestBodian<any>('recommendations').then(data => (
                    (data.lists || []).flatMap((group: any) => group.playLists || []).map((item: unknown) => normalizeBodianCollection(item))
                )).catch(() => [] as ProviderCollection[]),
                getBodianDiscoverCollections(),
            ]);
            const seen = new Set<string>();
            return [...discover, ...regular].filter(collection => {
                const key = `${collection.providerId}:${collection.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, limit);
        },
        async getPersonalFm() {
            return requestBodian<any>('personal_fm')
                .then(data => (data.musicList || []).map(normalizeBodianSong))
                .catch(() => []);
        },
    },
};
