import type { Artist, SongResult, UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type {
    AudioQualityPreference,
    LoginFailureDetail,
    LoginState,
    MediaId,
    OnlineMusicProvider,
    ProviderAudioSource,
    ProviderCollection,
    ProviderLikedSongIds,
    ProviderLyricsResult,
    ProviderPage,
    ProviderUser,
} from '../../../types/onlineMusic';
import { parseFoliaLyricDocument } from '../../../utils/lyrics/foliaLyricDocument';
import {
    fnMusicBridgeStatus,
    fnMusicCoverUrl,
    fnMusicLogin,
    fnMusicLogout,
    fnMusicStreamSource,
    fnmusicRequest,
    makeFnMusicDeviceId,
} from './fnmusicTransport';

// src/services/onlineMusic/fnmusic/fnmusicProvider.ts
// 飞牛音乐（飞牛 fnOS 官方音乐服务器）provider。
//
// 协议说明：见 docs/fnmusic-protocol.md，字段映射：
//  歌曲: guid / title / artists[{guid,name}] / album{guid,name,coverId,artists} /
//        duration(ms) / coverId / trackNo / discNo / isFavorite / isCue / createdAt(秒)
//  搜索: GET /music/api/v1/search/track?q=&page=&size= → { total, list }
//  歌词: GET /music/api/v1/lyric/list?trackGUID= → { list, preferred }
//  播放: GET /music/api/v1/track/stream?trackGUID= → 播放源（hls:// 经 /api/stream/unified 转 m3u8）

type FnMusicRecord = Record<string, any>;
const record = (value: unknown): FnMusicRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const text = (value: unknown): string => (value == null ? '' : String(value));
const catalogRef = (kind: 'album' | 'artist', id: unknown) => (
    id ? { providerId: 'fnmusic' as const, kind, id: text(id) } : undefined
);

const artistsOf = (raw: unknown): Artist[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.flatMap(entry => {
        const single = record(entry);
        const name = text(typeof entry === 'string' ? entry : (single.name ?? single.artistName));
        const id = text(typeof entry === 'string' ? entry : (single.guid ?? single.id ?? single.artistId));
        if (!name || seen.has(name)) return [];
        seen.add(name);
        return [{ id: id || name, name, catalogRef: catalogRef('artist', id || name) }];
    });
};

const coverOf = (coverId: unknown): string => {
    const id = text(coverId);
    if (!id) return '';
    return fnMusicCoverUrl(id);
};

/** 归一化一首飞牛音乐歌曲（字段名取自网页端 Sj 映射器）。
 *  封面：歌曲数据只携带 coverId（providerData.coverId），album.coverUrl 在归一化时用
 *  当前代理端口生成；端口变化后重新归一化即刷新，历史歌曲数据不依赖写死的 URL。 */
export const normalizeFnMusicSong = (raw: unknown): UnifiedSong => {
    const item = record(raw);
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'fnmusic') return item as UnifiedSong;
    const id = text(item.guid ?? item.id ?? item.mediaId ?? '');
    if (!id) throw new OnlineProviderError('invalid-response', '飞牛音乐歌曲缺少 guid', 'fnmusic');
    const album = record(item.album);
    const albumId = text(album.guid ?? item.albumId ?? '');
    return {
        id,
        name: text(item.title ?? item.trackName ?? item.name ?? ''),
        artists: artistsOf(item.artists),
        album: {
            id: albumId,
            name: text(album.name ?? item.albumName ?? ''),
            coverUrl: coverOf(item.coverId ?? album.coverId) || '',
            catalogRef: catalogRef('album', albumId),
        },
        durationMs: Math.max(0, Number(item.duration ?? item.durationMs ?? 0)),
        sourceRef: {
            kind: 'online',
            providerId: 'fnmusic',
            mediaId: id,
            providerData: {
                coverId: text(item.coverId ?? album.coverId ?? ''),
                createdAt: item.createdAt ?? null,
                updatedAt: item.updatedAt ?? null,
                isFavorite: Boolean(item.isFavorite),
                isCue: Boolean(item.isCue),
                trackNo: item.trackNo ?? null,
                discNo: item.discNo ?? null,
            },
        },
    };
};

const normalizeFnMusicUser = (raw: unknown): ProviderUser => {
    const item = record(raw);
    const account = text(item.account ?? item.username ?? '');
    return {
        id: text(item.guid ?? item.id ?? item.uid ?? account ?? 'fnmusic-user'),
        nickname: text(item.name ?? item.nickname ?? account) || 'fnmusic-user',
        avatarUrl: text(item.avatarUrl ?? item.avatar ?? '') || undefined,
    };
};

const fnMusicPage = (items: UnifiedSong[], total: number, offset: number, limit: number): ProviderPage<UnifiedSong> => ({
    items,
    total,
    hasMore: offset + items.length < total,
    nextOffset: offset + items.length,
});

const songIdOf = (song: SongResult): string => {
    const source = song.sourceRef;
    if (source?.kind !== 'online' || source.providerId !== 'fnmusic') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to 飞牛音乐', 'fnmusic');
    }
    return text(source.mediaId);
};

/** 统一错误文案（日志用）。 */
const errorMessageOf = (error: unknown): string => (
    error instanceof Error ? error.message : String(error)
);

/** 歌词项取文本字段（LRC 文本）。接口字段名做了多候选兼容。 */
const lyricTextOf = (raw: unknown): string => {
    const item = record(raw);
    return text(item.lyric ?? item.lyrics ?? item.content ?? item.lrc ?? item.text ?? '');
};

/** 数量字段（网页端可能是 number 或数字字符串）。 */
const countOf = (value: unknown): number | undefined => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** 列表接口信封：可能为 { total, list }，也可能直接是数组。list 缺失按空列表处理，total 缺失按 list 长度。 */
const pageList = async <T = unknown>(path: string, params: Record<string, string | number | boolean | undefined> | undefined): Promise<{ total: number; list: T[] }> => {
    const raw = await fnmusicRequest<unknown>(path, params);
    if (Array.isArray(raw)) return { total: raw.length, list: raw as T[] };
    const record = (raw && typeof raw === 'object' ? raw : {}) as { total?: unknown; list?: unknown };
    const list = Array.isArray(record.list) ? record.list as T[] : [];
    const total = Number(record.total ?? list.length) || list.length;
    return { total, list };
};

/** 歌单/专辑/歌手列表项 → 收藏卡片（字段名与网页端 bundle 对齐）。 */
const collectionOf = (type: 'playlist' | 'album' | 'artist') => (raw: unknown): ProviderCollection => {
    const item = record(raw);
    const id = text(item.guid ?? item.id ?? '');
    return {
        providerId: 'fnmusic',
        id,
        type,
        name: text(item.name ?? item.title ?? ''),
        coverUrl: coverOf(item.coverId) || '',
        description: text(item.description ?? item.summary ?? ''),
        trackCount: countOf(item.trackCount ?? item.track_total ?? item.songCount ?? item.trackTotal),
        albumCount: countOf(item.albumCount ?? item.album_total),
        artists: Array.isArray(item.artists)
            ? item.artists.map((entry: unknown) => {
                const a = record(entry);
                const artistName = text(a.name ?? a.artistName);
                return artistName
                    ? { name: artistName, id: text(a.guid ?? a.id ?? a.artistId ?? artistName) }
                    : null;
            }).filter((a: { name: string; id: string } | null): a is { name: string; id: string } => a !== null)
            : undefined,
    };
};

/** detail 接口响应 → 收藏卡片（元数据字段可能与列表项略有出入，做兼容）。 */
const collectionDetailOf = (type: 'playlist' | 'album' | 'artist') => (raw: unknown): ProviderCollection | null => {
    const item = record(raw);
    const id = text(item.guid ?? item.id ?? '');
    if (!id) return null;
    return collectionOf(type)(item);
};

const fnMusicPageOf = (list: unknown[], total: number, offset: number, limit: number): ProviderPage<UnifiedSong> =>
    fnMusicPage(list.map(normalizeFnMusicSong), total, offset, limit);

export const fnMusicLibrary = {
    /** 我的歌单。请求失败抛错（不返回空页）：accountRead 失败时保留旧数据，避免空列表覆盖账户歌单。 */
    async getUserPlaylists(_userId: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
        const { total, list } = await pageList<unknown>('/music/api/v1/playlist/list', {
            page: Math.floor(offset / limit) + 1,
            size: limit,
        });
        const items = list.map(collectionOf('playlist'));
        return { items, total, hasMore: offset + items.length < total, nextOffset: offset + items.length };
    },

    /** 专辑列表（Folia 的「专辑」页）。请求失败抛错（不返回空页）。 */
    async getUserAlbums(_userId: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> {
        const { total, list } = await pageList<unknown>('/music/api/v1/album/list', {
            page: Math.floor(offset / limit) + 1,
            size: limit,
        });
        const items = list.map(collectionOf('album'));
        return { items, total, hasMore: offset + items.length < total, nextOffset: offset + items.length };
    },

    /** 我喜欢的歌曲 id 全量（favorite-track/list 分页循环）。只读到尾才 whole:true，
     *  中途失败或超过页数上限必须 whole:false（否则未读到的歌会被去掉红心并存进快照）。 */
    async getLikedSongIds(): Promise<ProviderLikedSongIds> {
        const ids: string[] = [];
        const PAGE = 100;
        const MAX_PAGES = 20;
        let complete = false;
        try {
            for (let page = 1; page <= MAX_PAGES; page += 1) {
                const raw = await fnmusicRequest<{ list?: unknown; total?: unknown }>(
                    '/music/api/v1/favorite-track/list',
                    { page, size: PAGE },
                );
                const list = Array.isArray(raw?.list) ? raw.list : [];
                const pageIds = list
                    .map((entry) => text(record(entry).trackGUID ?? record(entry).guid ?? record(entry).id ?? ''))
                    .filter(Boolean);
                ids.push(...pageIds);
                const total = Number(raw?.total ?? 0);
                if (list.length < PAGE) { complete = true; break; }
                if (total > 0 && ids.length >= total) { complete = true; break; }
            }
        } catch (error) {
            console.warn('[FnMusic] favorite-track/list failed:', errorMessageOf(error));
        }
        return { ids, whole: complete };
    },
} as const;

/** 变更能力：红心（favorite-track create/delete）、添加/移除歌单曲目（playlist add-track/remove-track）、建歌单（playlist create）。
 *  飞牛音乐没有"收藏歌单"接口（网页端无此功能），明确禁用。 */
export const fnMusicMutations = {
    likeSong: async (song: MediaId | SongResult, liked: boolean): Promise<void> => {
        const id = typeof song === 'string' ? song : (typeof song === 'number' ? String(song) : songIdOf(song));
        await fnmusicRequest<unknown>(
            liked ? '/music/api/v1/favorite-track/create' : '/music/api/v1/favorite-track/delete',
            undefined,
            { method: 'POST', body: { trackGUID: id } },
        );
    },
    canSubscribe: () => false,
    canAddToPlaylist: () => true,
    async createPlaylist(name: string): Promise<ProviderCollection> {
        const raw = await fnmusicRequest<unknown>('/music/api/v1/playlist/create', undefined, { method: 'POST', body: { name } });
        return collectionOf('playlist')(raw);
    },
    async updatePlaylistTracks(
        operation: 'add' | 'del',
        playlist: MediaId | ProviderCollection,
        tracks: Array<MediaId | SongResult>,
    ): Promise<void> {
        const playlistId = typeof playlist === 'string' ? playlist : (typeof playlist === 'number' ? String(playlist) : playlist.id);
        const trackGUIDs = tracks.map((track) => (
            typeof track === 'string' ? track : (typeof track === 'number' ? String(track) : songIdOf(track))
        ));
        await fnmusicRequest<unknown>(
            operation === 'add' ? '/music/api/v1/playlist/add-track' : '/music/api/v1/playlist/remove-track',
            undefined,
            { method: 'POST', body: { guid: playlistId, trackGUIDs } },
        );
    },
} as const;

export const fnMusicCatalog = {
    /** 歌单内歌曲：/music/api/v1/track/playlist-detail/list?playlistGUID=&page=&size= */
    async getPlaylistTracks(id: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
        const { total, list } = await pageList<unknown>('/music/api/v1/track/playlist-detail/list', {
            playlistGUID: id,
            page: Math.floor(offset / limit) + 1,
            size: limit,
        });
        return fnMusicPageOf(list, total, offset, limit);
    },

    async getPlaylistDetail(id: string): Promise<ProviderCollection | null> {
        const raw = await fnmusicRequest<unknown>('/music/api/v1/playlist/detail', { guid: id });
        return collectionDetailOf('playlist')(raw);
    },

    /** 专辑内歌曲：/music/api/v1/track/album-detail/list?albumGUID=&page=&size= */
    async getAlbumTracks(id: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
        const { total, list } = await pageList<unknown>('/music/api/v1/track/album-detail/list', {
            albumGUID: id,
            page: Math.floor(offset / limit) + 1,
            size: limit,
        });
        return fnMusicPageOf(list, total, offset, limit);
    },

    async getAlbumDetail(id: string): Promise<ProviderCollection | null> {
        const raw = await fnmusicRequest<unknown>('/music/api/v1/album/detail', { guid: id });
        return collectionDetailOf('album')(raw);
    },

    /** 歌手歌曲：/music/api/v1/track/artist-detail/list?artistGUID=&page=&size= */
    async getArtistSongs(id: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
        const { total, list } = await pageList<unknown>('/music/api/v1/track/artist-detail/list', {
            artistGUID: id,
            page: Math.floor(offset / limit) + 1,
            size: limit,
        });
        return fnMusicPageOf(list, total, offset, limit);
    },

    async getArtistDetail(id: string): Promise<ProviderCollection | null> {
        const raw = await fnmusicRequest<unknown>('/music/api/v1/artist/detail', { guid: id });
        return collectionDetailOf('artist')(raw);
    },
} as const;

export const fnmusicProvider: OnlineMusicProvider = {
    id: 'fnmusic',
    displayName: '飞牛音乐',
    shortName: '飞牛',
    mark: { letter: '飞', color: '#0891b2' },
    // 仅桌面端（Electron 主进程桥）可用：网页/Docker 下浏览器丢 Cookie 受限头且受 CORS 限制。
    getAvailability: () => {
        if (typeof window !== 'undefined' && !(window as any).electron?.fnmusicRequest) {
            return { configured: false, reason: 'runtime-unavailable' as const };
        }
        // 桌面端：有主进程桥即可用（与其它桌面端平台一致，configured 恒 true，
        // 避免未登录用户整行 off、点不进登录表单；登录态由桥的 getStatus 反映）。
        return { configured: true } as const;
    },
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: false,
        auth: true,
        userLibrary: true, playlists: true, albums: true, artists: true, userAlbums: true,
        recommendations: false, mutations: true, likes: true, playlistTrackMutations: true,
    },
    normalizeSong: normalizeFnMusicSong,
    normalizeUser: normalizeFnMusicUser,
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return fnMusicPage([], 0, offset, limit);
            const page = Math.floor(offset / limit) + 1; // 网页端 page 从 1 起
            const raw = await fnmusicRequest<{ total?: unknown; list?: unknown }>(
                '/music/api/v1/search/track',
                { q: query, page, size: limit },
            );
            const list = Array.isArray(raw?.list) ? raw.list : [];
            const total = Number(raw?.total ?? list.length) || list.length;
            const items = list.map(normalizeFnMusicSong);
            return fnMusicPage(items, total, offset, limit);
        },
    },
    playback: {
        async getSongDetail(id) {
            const raw = await fnmusicRequest<unknown>('/music/api/v1/track/metadata', { trackGUID: id });
            const item = record(raw);
            return normalizeFnMusicSong(item.track ?? item.song ?? raw);
        },
        async getAudioSource(song, quality: AudioQualityPreference) {
            const url = await fnMusicStreamSource(songIdOf(song), quality);
            return { url, fetchedAt: Date.now(), quality } as ProviderAudioSource;
        },
    },
    lyrics: {
        async getLyrics(song): Promise<ProviderLyricsResult> {
            const raw = await fnmusicRequest<{ list?: unknown; preferred?: unknown }>(
                '/music/api/v1/lyric/list',
                { trackGUID: songIdOf(song) },
            );
            const list = Array.isArray(raw?.list) ? raw.list : [];
            if (list.length === 0) return { lyrics: null, isPureMusic: false };
            const preferredIndex = Number(raw?.preferred ?? 0);
            const candidates = list.length > 1 && Number.isFinite(preferredIndex) && preferredIndex >= 0 && preferredIndex < list.length
                ? [list[preferredIndex], ...list.slice(0, preferredIndex), ...list.slice(preferredIndex + 1)]
                : list;
            for (const candidate of candidates) {
                const lrcText = lyricTextOf(candidate);
                if (!lrcText) continue;
                const lyrics = parseFoliaLyricDocument(lrcText);
                return { lyrics, mainText: lrcText, isPureMusic: false };
            }
            return { lyrics: null, isPureMusic: false };
        },
    },
    library: fnMusicLibrary,
    catalog: fnMusicCatalog,
    mutations: fnMusicMutations,
    auth: {
        getLoginTexts: () => ({ title: 'home.loginTitleFnMusic', note: 'home.loginNoteFnMusic' }),
        // 表单式登录：登录窗口按声明渲染字段，提交后由本 provider 完成登录（主进程保存凭据）。
        getLoginForm: () => ({
            fields: [
                { key: 'base', type: 'url', labelKey: 'fnmusic.serverUrl', placeholderKey: 'fnmusic.serverUrlPlaceholder', required: true },
                { key: 'username', type: 'text', labelKey: 'fnmusic.username', placeholderKey: 'fnmusic.usernamePlaceholder', required: true },
                { key: 'password', type: 'password', labelKey: 'fnmusic.password', required: true },
            ],
            submitLabelKey: 'fnmusic.login',
            noteKey: 'fnmusic.loginNote',
            // 错误按 code 走 i18n（120001 → auth-required；网络失败 → network；其余 → invalid-response）。
            errorKeys: {
                'auth-required': 'fnmusic.errorBadCredentials',
                network: 'fnmusic.errorNetwork',
                'invalid-response': 'fnmusic.errorBadResponse',
            },
        }),
        async submitLoginForm(values) {
            await fnMusicLogin({
                base: text(values.base),
                username: text(values.username),
                password: text(values.password),
                deviceId: makeFnMusicDeviceId(),
            });
        },
        async getLoginStatus(): Promise<ProviderUser | null> {
            const status = fnMusicBridgeStatus();
            if (!status?.authenticated) return null;
            return {
                id: status.username || 'fnmusic-user',
                nickname: status.username || 'fnmusic-user',
            };
        },
        async logout() {
            await fnMusicLogout();
        },
        // 账号密码登录走 omni 通用表单（登录窗口按 provider 声明渲染表单），此处不再读本地配置。
        async startLogin(): Promise<string> {
            throw new OnlineProviderError(
                'auth-required',
                '请在登录窗口填写飞牛音乐服务器地址与账号',
                'fnmusic',
            );
        },
        async checkLogin(): Promise<LoginState> {
            const status = fnMusicBridgeStatus();
            return status?.authenticated ? { state: 'confirmed' } : { state: 'error', message: '登录未完成' };
        },
        describeLoginFailure: (_step, error): LoginFailureDetail | null => ({
            case: 'unknown',
            message: error instanceof Error ? error.message : '登录失败',
        }),
    },
};
