import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderPage,
} from '../../types/onlineMusic';
import type { SongResult, UnifiedSong } from '../../types';
import { OnlineProviderError } from '../../types/onlineMusic';
import { readProviderSessionValue, writeProviderSessionValue, removeProviderSessionValue } from './providerStorage';
import { normalizeSpotifySong, normalizeSpotifyUser, normalizeSpotifyCollection } from './spotifyNormalize';
import { getSpotifyClientId, SPOTIFY_REDIRECT_URI } from './spotifyClientId';
import { omni } from './omni';
import { autoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyric';

// src/services/onlineMusic/spotifyProvider.ts
// Spotify 音乐源适配器：提供 OAuth 2.0 PKCE 认证、用户曲库同步、搜索、跨源音频直链替换与逐字歌词匹配

// Client ID 与回调地址在 ./spotifyClientId：登录弹窗要直接引用它们，从本文件导出会把 omni 那条
// 依赖链拖进 UI，进而让 providerRegistry 的循环导入在注册时拿到 undefined。

let currentCodeVerifier: string | null = null;
let currentOAuthState: string | null = null;
let currentAuthUrl: string | null = null;

function generateRandomString(length: number): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values).map(x => possible[x % possible.length]).join('');
}

/**
 * 计算 S256 Code Challenge
 */
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    let str = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * 获取当前有效的 Spotify 访问令牌，并在过期时使用 refresh_token 刷新
 */
async function getValidAccessToken(): Promise<string | null> {
    const accessToken = readProviderSessionValue('spotify', 'access_token');
    const expiresAt = Number(readProviderSessionValue('spotify', 'expires_at') || '0');
    const refreshToken = readProviderSessionValue('spotify', 'refresh_token');

    if (accessToken && Date.now() < expiresAt - 60000) {
        return accessToken;
    }

    if (!refreshToken) return null;

    try {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: getSpotifyClientId(),
        });
        const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            // invalid_client / invalid_grant：Client ID 换过或授权已撤销。清掉本地令牌回到「请重新登录」，
            // 否则界面会一直拿着刷不动的旧令牌反复报错。
            if (res.status === 400 || res.status === 401) {
                removeProviderSessionValue('spotify', 'access_token');
                removeProviderSessionValue('spotify', 'refresh_token');
                removeProviderSessionValue('spotify', 'expires_at');
            }
            return null;
        }
        const data = await res.json();
        if (data.access_token) {
            writeProviderSessionValue('spotify', 'access_token', data.access_token);
            writeProviderSessionValue('spotify', 'expires_at', String(Date.now() + (data.expires_in || 3600) * 1000));
            if (data.refresh_token) {
                writeProviderSessionValue('spotify', 'refresh_token', data.refresh_token);
            }
            return data.access_token;
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * 封装经过 Spotify Bearer Token 鉴权的 API 请求
 */
async function spotifyFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await getValidAccessToken();
    if (!token) {
        throw new OnlineProviderError('auth-required', 'Spotify 登录态已失效', 'spotify');
    }
    const url = endpoint.startsWith('http')
        ? endpoint
        : `https://api.spotify.com/v1${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`,
        },
    });
    if (res.status === 401) {
        throw new OnlineProviderError('auth-required', 'Spotify 会话已过期，请重新登录', 'spotify');
    }
    if (res.status === 403) {
        // 开发模式的 app 只对白名单账号放行：未列入白名单的账号能登录成功，但所有 API 请求都会 403
        throw new OnlineProviderError(
            'auth-required',
            'Spotify 拒绝了该账号的请求（403）：它不在当前 Client ID 的开发者白名单里。请在登录弹窗里填写自己的 Spotify Client ID 后重新登录。',
            'spotify',
            undefined,
            res.status,
        );
    }
    if (!res.ok) {
        throw new OnlineProviderError('invalid-response', `Spotify API 错误: ${res.status} ${res.statusText}`, 'spotify', undefined, res.status);
    }
    return res.json();
}

/**
 * 逐项归一化并跳过映射失败的条目。
 * Spotify 歌单里会混进本地文件（is_local 为真、id 为 null），每条都要有自己的 id，
 * 让其中一条抛异常会连带整页加载失败，所以坏条目单独跳过。
 */
function normalizeSpotifyList<T>(rawItems: any[], normalize: (item: any) => T): T[] {
    const items: T[] = [];
    for (const raw of rawItems) {
        if (!raw) continue;
        try {
            items.push(normalize(raw));
        } catch {
            // 单条无法映射就跳过，不影响整页
        }
    }
    return items;
}

/**
 * 清理 Spotify 歌曲名称中的重置/版本/伴唱等修饰标签，提高跨源检索成功率
 */
export function sanitizeSongTitle(title: string): string {
    if (!title) return '';
    return title
        .replace(/\s*[\(\[](?:remaster(?:ed)?|feat\.?|ft\.?|live|deluxe|bonus|mono|stereo|radio edit|original mix|version|[0-9]{4}\s*remaster).*?[\)\]]/gi, '')
        .replace(/\s*-\s*(?:remaster(?:ed)?|live|radio edit|deluxe|bonus|version|[0-9]{4}\s*remaster).*$/gi, '')
        .replace(/\s+(?:feat\.?|ft\.?)\s+.+$/gi, '')
        .trim();
}

/**
 * 跨平台音频检索梯队（网易云 -> 酷狗 -> QQ音乐 -> 波点音乐）
 * 匹配时长误差 <= 25秒的完整音轨，解决 Spotify 官方 REST API 仅提供30秒预览音频的问题，恢复完整高品质播放与全屏音频频谱可视化
 */
async function searchFallbackAudio(song: SongResult, quality: AudioQualityPreference) {
    const rawTitle = (song.name || '').trim();
    const cleanTitle = sanitizeSongTitle(rawTitle);
    const artistName = (song.artists?.[0]?.name || '').trim();

    // 组合候选搜索词：清洗名+歌手、原始名+歌手、清洗名、原始名
    const queries: string[] = [];
    if (cleanTitle && artistName) queries.push(`${cleanTitle} ${artistName}`);
    if (rawTitle && artistName && rawTitle !== cleanTitle) queries.push(`${rawTitle} ${artistName}`);
    if (cleanTitle) queries.push(cleanTitle);
    if (rawTitle && rawTitle !== cleanTitle) queries.push(rawTitle);

    const uniqueQueries = Array.from(new Set(queries.map(q => q.trim()).filter(Boolean)));
    const fallbackLadder = ['netease', 'kugou', 'qq', 'bodian'] as const;

    for (const providerId of fallbackLadder) {
        try {
            const availability = omni.getProviderAvailability(providerId);
            if (!availability.configured) continue;

            for (const query of uniqueQueries) {
                try {
                    const page = await omni.searchProviderSongs(providerId, query, { limit: 5, offset: 0 });
                    if (!page.items || page.items.length === 0) continue;

                    // 筛选并按时长误差排序
                    const candidates = page.items.filter(item => {
                        if (!song.durationMs || !item.durationMs) return true;
                        return Math.abs(song.durationMs - item.durationMs) <= 25000;
                    }).sort((a, b) => {
                        if (!song.durationMs) return 0;
                        const diffA = Math.abs(song.durationMs - (a.durationMs || 0));
                        const diffB = Math.abs(song.durationMs - (b.durationMs || 0));
                        return diffA - diffB;
                    });

                    for (const candidate of candidates) {
                        try {
                            const audio = await omni.getAudioSource(candidate, quality);
                            if (audio?.url) {
                                return audio;
                            }
                        } catch {
                            // 该候选音轨提取失败，继续尝试下一个
                        }
                    }
                } catch {
                    // 查询出错，继续尝试
                }
            }
        } catch {
            // provider 异常，回退至下一个 provider
        }
    }

    return null;
}

export const spotifyProvider: OnlineMusicProvider = {
    id: 'spotify',
    displayName: 'Spotify',
    shortName: 'Spotify',

    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: true,
        artists: true,
        recommendations: true,
        mutations: false,
        wordByWordLyrics: true,
        likes: true,
    },

    getAvailability: () => ({ configured: true }),

    normalizeSong: normalizeSpotifySong,
    normalizeUser: normalizeSpotifyUser,
    normalizeCollection: normalizeSpotifyCollection,

    auth: {
        async getLoginStatus() {
            const token = await getValidAccessToken();
            if (!token) return null;
            try {
                const me = await spotifyFetch<any>('me');
                return normalizeSpotifyUser(me);
            } catch (error) {
                // 403/401 是「登录成功但没权限」而不是「没登录」。静默返回 null 只会让用户看到一句
                // 「登录错误」，把带原因的 auth-required 抛出去，诊断里才会写着该填自己的 Client ID。
                if (error instanceof OnlineProviderError && error.code === 'auth-required') throw error;
                return null;
            }
        },

        async logout() {
            removeProviderSessionValue('spotify', 'access_token');
            removeProviderSessionValue('spotify', 'refresh_token');
            removeProviderSessionValue('spotify', 'expires_at');
            window.electron?.stopSpotifyAuthServer?.();
        },

        async getQrKey() {
            currentCodeVerifier = generateRandomString(64);
            currentOAuthState = generateRandomString(16);
            const challenge = await generateCodeChallenge(currentCodeVerifier);
            const scopes = [
                'user-read-private',
                'user-read-email',
                'playlist-read-private',
                'playlist-read-collaborative',
                'user-library-read',
                'user-top-read',
            ].join(' ');

            const authUrl = `https://accounts.spotify.com/authorize?client_id=${getSpotifyClientId()}&response_type=code&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&code_challenge_method=S256&code_challenge=${challenge}&state=${currentOAuthState}`;
            currentAuthUrl = authUrl;

            // 桌面端唤起本地监听服务器，并在浏览器中打开授权页
            if (typeof window !== 'undefined' && window.electron?.startSpotifyAuthServer) {
                await window.electron.startSpotifyAuthServer(currentOAuthState);
                if (window.electron.openExternalUrl) {
                    void window.electron.openExternalUrl(authUrl);
                }
            } else if (typeof window !== 'undefined') {
                window.open(authUrl, '_blank');
            }

            return authUrl;
        },

        async createQr(key: string) {
            const QRCode = await import('qrcode');
            return QRCode.toDataURL(key, { margin: 1, width: 220 });
        },

        async checkQr() {
            if (typeof window !== 'undefined' && window.electron?.waitForSpotifyAuthCode) {
                const codeResult = await Promise.race([
                    window.electron.waitForSpotifyAuthCode(),
                    new Promise<null>(resolve => setTimeout(() => resolve(null), 1800)),
                ]);

                if (!codeResult) {
                    return { state: 'waiting' };
                }
                if (codeResult.error) {
                    return { state: 'error', message: codeResult.error };
                }
                if (codeResult.code) {
                    const body = new URLSearchParams({
                        grant_type: 'authorization_code',
                        code: codeResult.code,
                        redirect_uri: SPOTIFY_REDIRECT_URI,
                        client_id: getSpotifyClientId(),
                        code_verifier: currentCodeVerifier || '',
                    });
                    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: body.toString(),
                    });
                    if (!tokenRes.ok) {
                        const err = await tokenRes.text();
                        return { state: 'error', message: `Spotify 凭证换取失败: ${err}` };
                    }
                    const tokenData = await tokenRes.json();
                    if (tokenData.access_token) {
                        writeProviderSessionValue('spotify', 'access_token', tokenData.access_token);
                        writeProviderSessionValue('spotify', 'expires_at', String(Date.now() + (tokenData.expires_in || 3600) * 1000));
                        if (tokenData.refresh_token) {
                            writeProviderSessionValue('spotify', 'refresh_token', tokenData.refresh_token);
                        }
                        window.electron?.stopSpotifyAuthServer?.();
                        return { state: 'confirmed' };
                    }
                }
            }
            return { state: 'waiting' };
        },

        async cancelQr() {
            window.electron?.stopSpotifyAuthServer?.();
            currentCodeVerifier = null;
            currentOAuthState = null;
            currentAuthUrl = null;
        },

        getQrTtlMs: () => 5 * 60 * 1000,
    },

    library: {
        async getUserPlaylists(userId, limit, offset) {
            const data = await spotifyFetch<any>(`me/playlists?limit=${Math.min(limit, 50)}&offset=${offset}`);
            const rawItems = Array.isArray(data.items) ? data.items : [];
            const items = normalizeSpotifyList(rawItems, item => normalizeSpotifyCollection(item, 'playlist', item.owner?.id === userId));
            return {
                items,
                total: data.total,
                hasMore: Boolean(data.next),
                nextOffset: offset + items.length,
            };
        },

        async getLikedSongIds() {
            try {
                const data = await spotifyFetch<any>('me/tracks?limit=50');
                const rawItems = Array.isArray(data.items) ? data.items : [];
                return rawItems.map((item: any) => String(item.track?.id || '')).filter(Boolean);
            } catch {
                return [];
            }
        },

        async getUserAlbums(userId, limit, offset) {
            const data = await spotifyFetch<any>(`me/albums?limit=${Math.min(limit, 50)}&offset=${offset}`);
            const rawItems = Array.isArray(data.items) ? data.items : [];
            const items = normalizeSpotifyList(rawItems, item => normalizeSpotifyCollection(item.album, 'album', false));
            return {
                items,
                total: data.total,
                hasMore: Boolean(data.next),
                nextOffset: offset + items.length,
            };
        },
    },

    catalog: {
        canResolveSongCatalogRefs: song => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'spotify',

        async getPlaylistTracks(id, limit, offset) {
            const data = await spotifyFetch<any>(`playlists/${id}/tracks?limit=${Math.min(limit, 100)}&offset=${offset}`);
            const rawItems = Array.isArray(data.items) ? data.items : [];
            const items = normalizeSpotifyList(
                rawItems.map((item: any) => item.track),
                track => normalizeSpotifySong(track),
            );
            return {
                items,
                total: data.total,
                hasMore: Boolean(data.next),
                nextOffset: offset + items.length,
            };
        },

        async getPlaylistDetail(id) {
            const data = await spotifyFetch<any>(`playlists/${id}`);
            return normalizeSpotifyCollection(data, 'playlist');
        },

        async getAlbumTracks(id, limit = 50, offset = 0) {
            const data = await spotifyFetch<any>(`albums/${id}/tracks?limit=${Math.min(limit, 50)}&offset=${offset}`);
            const albumData = await spotifyFetch<any>(`albums/${id}`).catch(() => null);
            const rawItems = Array.isArray(data.items) ? data.items : [];
            const items = normalizeSpotifyList(rawItems, track => {
                if (albumData && !track.album) track.album = albumData;
                return normalizeSpotifySong(track);
            });
            return {
                items,
                total: data.total,
                hasMore: Boolean(data.next),
                nextOffset: offset + items.length,
            };
        },

        async getAlbumDetail(id) {
            const data = await spotifyFetch<any>(`albums/${id}`);
            return normalizeSpotifyCollection(data, 'album');
        },

        async getArtistSongs(id, limit, offset) {
            const data = await spotifyFetch<any>(`artists/${id}/top-tracks?market=from_token`);
            const rawItems = Array.isArray(data.tracks) ? data.tracks : [];
            const items = normalizeSpotifyList(rawItems.slice(offset, offset + limit), track => normalizeSpotifySong(track));
            return {
                items,
                total: rawItems.length,
                hasMore: offset + limit < rawItems.length,
                nextOffset: offset + items.length,
            };
        },

        async getArtistAlbums(id, limit, offset) {
            const data = await spotifyFetch<any>(`artists/${id}/albums?limit=${Math.min(limit, 50)}&offset=${offset}`);
            const rawItems = Array.isArray(data.items) ? data.items : [];
            const items = normalizeSpotifyList(rawItems, item => normalizeSpotifyCollection(item, 'album'));
            return {
                items,
                total: data.total,
                hasMore: Boolean(data.next),
                nextOffset: offset + items.length,
            };
        },

        async getArtistDetail(id) {
            const data = await spotifyFetch<any>(`artists/${id}`);
            const coverUrl = Array.isArray(data.images) && data.images[0]?.url ? data.images[0].url : undefined;
            return {
                providerId: 'spotify',
                id: String(data.id),
                type: 'artist',
                name: String(data.name || ''),
                coverUrl,
            };
        },
    },

    search: {
        async searchSongs(query, limit, offset) {
            const data = await spotifyFetch<any>(`search?q=${encodeURIComponent(query)}&type=track&limit=${Math.min(limit, 50)}&offset=${offset}`);
            const rawItems = Array.isArray(data.tracks?.items) ? data.tracks.items : [];
            const items = normalizeSpotifyList(rawItems, track => normalizeSpotifySong(track));
            return {
                items,
                total: data.tracks?.total,
                hasMore: Boolean(data.tracks?.next),
                nextOffset: offset + items.length,
            };
        },
    },

    recommendations: {
        async getDailySongs() {
            try {
                const data = await spotifyFetch<any>('me/top/tracks?limit=30');
                const rawItems = Array.isArray(data.items) ? data.items : [];
                return normalizeSpotifyList(rawItems, track => normalizeSpotifySong(track));
            } catch {
                return [];
            }
        },

        async getRecommendedCollections(limit) {
            try {
                const data = await spotifyFetch<any>(`browse/featured-playlists?limit=${Math.min(limit, 20)}`);
                const rawItems = Array.isArray(data.playlists?.items) ? data.playlists.items : [];
                return normalizeSpotifyList(rawItems, item => normalizeSpotifyCollection(item, 'playlist'));
            } catch {
                return [];
            }
        },
    },

    playback: {
        async getSongDetail(id) {
            const track = await spotifyFetch<any>(`tracks/${id}`);
            return normalizeSpotifySong(track);
        },

        async getAudioSource(song, quality) {
            // 策略 0：本地 librespot 音频流内核（官方 320kbps 高清音轨、完整播放不受 30 秒截断限制）
            if (typeof window !== 'undefined' && window.electron?.getLibrespotStatus) {
                try {
                    let status = await window.electron.getLibrespotStatus();
                    // 若后台 librespot 守护进程仍在与 Spotify AP 建立握手，等待最多 3 秒直至就绪
                    if (status?.online && !status?.playbackReady) {
                        for (let i = 0; i < 6; i++) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                            status = await window.electron.getLibrespotStatus();
                            if (status?.playbackReady) break;
                        }
                    }
                    if (status?.online && status?.playbackReady) {
                        const rawTrackId = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'spotify'
                            ? (song.sourceRef.mediaId || song.id)
                            : song.id;
                        const cleanTrackId = String(rawTrackId || '').replace(/^spotify:track:/i, '');
                        const durationSec = Math.max(1, Math.round((song.durationMs || 180000) / 1000));
                        const playId = `${cleanTrackId}_${Date.now()}`;
                        return {
                            url: `http://127.0.0.1:32112/silent.wav?id=${encodeURIComponent(cleanTrackId)}&duration=${durationSec}&playId=${playId}`,
                            quality: 'lossless',
                            format: 'spotify-connect-320k',
                            bitrate: 320,
                            fetchedAt: Date.now(),
                        };
                    }
                } catch {
                    // librespot 暂未就绪，平滑降级
                }
            }

            // 策略 1：跨平台音频检索梯队（网易云 -> 酷狗 -> QQ音乐 -> 波点音乐），实现完整高品质播放与全屏音频频谱可视化
            try {
                const fallbackAudio = await searchFallbackAudio(song, quality);
                if (fallbackAudio?.url) {
                    return fallbackAudio;
                }
            } catch {
                // 检索异常时回落
            }

            // 策略 2：回落至 Spotify 30秒预览音频
            const previewUrl = song.sourceRef?.kind === 'online' && typeof song.sourceRef.providerData?.previewUrl === 'string'
                ? song.sourceRef.providerData.previewUrl
                : null;
            if (previewUrl) {
                return {
                    url: previewUrl,
                    quality: 'standard',
                    fetchedAt: Date.now(),
                };
            }

            throw new OnlineProviderError('not-playable', '未能匹配到该 Spotify 曲目的播放音源', 'spotify');
        },

        getAvailability: () => ({ state: 'playable' }),
    },

    lyrics: {
        async getLyrics(song) {
            // 使用 Folia 内置多源歌词引擎跨平台匹配逐字歌词，优先使用清洗后的纯净歌名提高命中率
            const cleanTitle = sanitizeSongTitle(song.name);
            const candidates = cleanTitle && cleanTitle !== song.name
                ? [{ ...song, name: cleanTitle }, song]
                : [song];

            for (const candidateSong of candidates) {
                try {
                    // autoMatchBestLyric 收的是歌名/歌手/时长三个参数，不是整个 song 对象
                    const matched = await autoMatchBestLyric(
                        candidateSong.name,
                        candidateSong.artists?.[0]?.name || '',
                        candidateSong.durationMs || 0,
                    );
                    // isPureMusic 为真时结果里没有歌词，必须先窄化再取 lyrics
                    if (matched && !matched.isPureMusic) {
                        return {
                            lyrics: matched.lyrics,
                            isPureMusic: false,
                        };
                    }
                } catch {
                    // 尝试下一个候选
                }
            }

            return {
                lyrics: null,
                isPureMusic: false,
            };
        },
    },
};
