import type { SongResult, UnifiedSong } from '../../../types';
import type {
    AudioQualityPreference,
    OnlineMusicProvider,
    ProviderAudioSource,
    ProviderCollection,
    ProviderPage,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { getSodaTransportAvailability, requestSoda } from './sodaTransport';
import {
    normalizeSodaCollection,
    normalizeSodaSong,
    sodaLyricsOf,
    sodaPage,
    sodaPreview,
    sodaTrackList,
} from './sodaNormalize';
import { sodaExplore } from './sodaExplore';

// src/services/onlineMusic/soda/sodaProvider.ts
//
// 汽水音乐 adapter。全部走匿名接口：搜索、播放、歌词、公开歌单。没有登录，所以没有账号、收藏和自建歌单。
// 播放地址和歌词都要先读一次分享页，`shareOf` 把它按曲目缓存几分钟，一次播放只发一次请求。

const SHARE_TTL = 5 * 60 * 1000;
const SHARE_CACHE_MAX = 200;

const mediaIdOf = (song: SongResult | string): string => (
    typeof song === 'string'
        ? song
        : (song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'soda'
            ? String(song.sourceRef.mediaId)
            : String(song.id))
);

const shareCache = new Map<string, { track: any; at: number }>();

const shareOf = async (trackId: string): Promise<any | null> => {
    const hit = shareCache.get(trackId);
    if (hit && Date.now() - hit.at < SHARE_TTL) return hit.track;
    const data = await requestSoda<{ track: any }>('share', { trackId });
    if (!data.track) return null;
    if (shareCache.size >= SHARE_CACHE_MAX) shareCache.delete(shareCache.keys().next().value as string);
    shareCache.set(trackId, { track: data.track, at: Date.now() });
    return data.track;
};

export const clearSodaShareCache = () => shareCache.clear();

/** 分享页的 `trackInfo` 比搜索结果的字段少，缺的从 track 上补。 */
const songOfTrackInfo = (trackId: string, info: any): UnifiedSong => normalizeSodaSong({
    id: info?.id ?? trackId,
    name: info?.name,
    duration: Number(info?.duration) || undefined,
    artists: Array.isArray(info?.artists) ? info.artists : [],
    album: {
        id: info?.album?.id,
        name: info?.album?.name,
        url_cover: info?.album?.url_cover,
    },
});

export const sodaProvider: OnlineMusicProvider = {
    id: 'soda',
    displayName: '汽水音乐',
    shortName: '汽水',
    mark: { letter: '汽', color: '#f59e0b' },
    getAvailability: getSodaTransportAvailability,
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        wordByWordLyrics: true,
        explore: true,
        auth: false,
        userLibrary: false,
        playlists: false,
        albums: false,
        artists: false,
        recommendations: false,
        mutations: false,
    },
    normalizeSong: (raw) => normalizeSodaSong(raw),
    normalizeCollection: (raw) => normalizeSodaCollection(raw),
    songMetadata: { getSongMetadata: createProviderSongMetadata },

    search: {
        async searchSongs(query, limit, offset) {
            const keyword = String(query || '').trim();
            if (!keyword) return sodaPage([], 0, offset);
            // 汽水忽略 count、一次给 20 条，cursor 是真 offset；按 limit 截断，截掉的算下一批。
            const data = await requestSoda<{ group: any }>('search', { query: keyword, cursor: offset, count: Math.min(limit, 20) });
            const rows = Array.isArray(data.group?.data) ? data.group.data : [];
            const items = rows.map((row: any) => row?.entity?.track).filter(Boolean).map(normalizeSodaSong).slice(0, limit);
            const total = Number(data.group?.next_cursor) || 0;
            return sodaPage(items, total, offset);
        },
    },

    playback: {
        // 汽水只有一份文件，不分明细的档位；列一档，免得音质选项里出现几个听起来一样的按钮。
        audioQualityLevels: ['standard'] as const,

        async getSongDetail(id) {
            const track = await shareOf(String(id));
            if (!track) return null;
            return songOfTrackInfo(String(id), track.trackInfo ?? { name: track.trackName });
        },

        async getAudioSource(song, quality: AudioQualityPreference): Promise<ProviderAudioSource | null> {
            const trackId = mediaIdOf(song);
            if (!trackId) throw new OnlineProviderError('unsupported', '歌曲没有汽水 id', 'soda');
            const track = await shareOf(trackId);
            const url = typeof track?.url === 'string' ? track.url : '';
            if (!url) return null;
            return {
                url,
                fetchedAt: Date.now(),
                quality,
                // 付费歌只给一段（常见 30 秒）：标成试听，播放时会提示，也不会被当成整首存进缓存。
                ...(sodaPreview(track) ? { preview: true } : {}),
            };
        },
    },

    lyrics: {
        async getLyrics(song) {
            const track = await shareOf(mediaIdOf(song));
            if (!track) return { lyrics: null, isPureMusic: false };
            return sodaLyricsOf(track);
        },
    },

    catalog: {
        async getPlaylistTracks(id, limit, offset): Promise<ProviderPage<UnifiedSong>> {
            const data = await requestSoda<{ tracks: unknown[]; nextCursor: number | null }>('playlist_detail', {
                playlistId: String(id),
                cursor: offset,
                count: Math.min(limit, 50),
            });
            const items = sodaTrackList(Array.isArray(data.tracks) ? data.tracks : []).slice(0, limit);
            return sodaPage(items, Number(data.nextCursor) || null, offset);
        },

        async getPlaylistDetail(id): Promise<ProviderCollection | null> {
            const data = await requestSoda<{ playlist: any }>('playlist_detail', {
                playlistId: String(id),
                cursor: 0,
                count: 1,
            });
            return data.playlist ? normalizeSodaCollection(data.playlist) : null;
        },
    },

    explore: sodaExplore,
};
