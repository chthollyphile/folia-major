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
    sodaKaraokeToEnhancedLrc,
    sodaLyricsOf,
    sodaPage,
    sodaPreview,
    sodaTrackList,
} from './sodaNormalize';
import { sodaExplore } from './sodaExplore';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';
import { sodaAuth } from './sodaAuth';
import { sodaLibrary } from './sodaLibrary';
import { sodaMutations } from './sodaMutations';

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

/** 应用的档位 → 汽水账号接口的档位。hires 没有对应，按 lossless 要。 */
const sodaQualityWord = (quality: AudioQualityPreference): string => {
    if (quality === 'standard') return 'standard';
    if (quality === 'lossless' || quality === 'hires') return 'lossless';
    return 'higher';
};

/** 汽水回给我们的档位 → 应用的档位。认不出就返回 null，由调用方保留原来的档位。 */
const sodaQualityLevel = (quality?: string): AudioQualityPreference | null => {
    if (quality === 'standard') return 'standard';
    if (quality === 'higher' || quality === 'high') return 'high';
    if (quality === 'lossless') return 'lossless';
    return null;
};

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
        // 登录之后才有账号：歌单库、红心、歌单增删都跟着账号走。
        auth: true,
        userLibrary: true,
        playlists: true,
        likes: true,
        mutations: true,
        playlistTrackMutations: true,
        albums: false,
        artists: false,
        recommendations: false,
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
        // 账号接口按三档要：standard / higher / lossless（hires 按 lossless 要）。
        audioQualityLevels: ['standard', 'high', 'lossless'] as const,

        async getSongDetail(id) {
            const track = await shareOf(String(id));
            if (!track) return null;
            return songOfTrackInfo(String(id), track.trackInfo ?? { name: track.trackName });
        },

        async getAudioSource(song, quality: AudioQualityPreference): Promise<ProviderAudioSource | null> {
            const trackId = mediaIdOf(song);
            if (!trackId) throw new OnlineProviderError('unsupported', '歌曲没有汽水 id', 'soda');
            const track = await shareOf(trackId);
            const shareUrl = typeof track?.url === 'string' ? track.url : '';
            const clipped = track ? sodaPreview(track) : false;

            // 免费的整首：分享页直接给明文地址，不必走账号（也就没有下载和解密）。
            if (shareUrl && !clipped) {
                return { url: shareUrl, fetchedAt: Date.now(), quality };
            }

            // 付费/会员歌：交给主进程用账号解析（整首下载 + 解密），拿回来的是本地 scheme 地址。
            try {
                const resolved = await requestSoda<{ url: string; quality?: string; preview?: boolean }>('resolve', {
                    songId: trackId,
                    quality: sodaQualityWord(quality),
                });
                if (resolved?.url) {
                    return {
                        url: resolved.url,
                        fetchedAt: Date.now(),
                        quality: sodaQualityLevel(resolved.quality) ?? quality,
                        ...(resolved.preview ? { preview: true } : {}),
                    };
                }
            } catch {
                // 没登录、没会员或者包失败：落到分享页那一段，标成试听。
            }

            if (!shareUrl) return null;
            // 付费歌只给一段（常见 30 秒）：标成试听，播放时会提示，也不会被当成整首存进缓存。
            return { url: shareUrl, fetchedAt: Date.now(), quality, ...(clipped ? { preview: true } : {}) };
        },
    },

    lyrics: {
        async getLyrics(song) {
            const id = mediaIdOf(song);
            // 登录后优先用汽水自己的词：签名接口给的那份通常带逐字，分享页那份往往只有行时间。
            try {
                const signed = await requestSoda<{ content: string }>('signed_lyric', { songId: id });
                const content = String(signed?.content ?? '').trim();
                if (content) {
                    const enhanced = sodaKaraokeToEnhancedLrc(content);
                    if (enhanced) {
                        // 行级轨去掉逐字标签，逐字轨原样交给宿主。
                        const plain = enhanced.replace(/<\d{2}:\d{2}\.\d{3}>/g, '');
                        return {
                            lyrics: parseLyricsByFormat('enhanced-lrc', enhanced),
                            mainText: plain,
                            wordByWordText: enhanced,
                            isPureMusic: false,
                        };
                    }
                    if (/^\[\d{2}:\d{2}/.test(content)) {
                        return { lyrics: parseLyricsByFormat('lrc', content), mainText: content, isPureMusic: false };
                    }
                }
            } catch (error) {
                console.info('[Soda] signed lyric unavailable:', error instanceof Error ? error.message : String(error));
            }
            const track = await shareOf(id);
            if (!track) return { lyrics: null, isPureMusic: false };
            const result = sodaLyricsOf(track);
            if (!result.lyrics) console.info('[Soda] no lyrics on the share page for', id);
            return result;
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
    auth: sodaAuth,
    library: sodaLibrary,
    mutations: sodaMutations,
};
