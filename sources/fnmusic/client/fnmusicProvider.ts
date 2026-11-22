import type {
    FoliumSourceCollection,
    FoliumSourceDef,
    FoliumSourceLibrary,
    FoliumSourceLyricsResult,
    FoliumSourceMutations,
    FoliumSourceNamedRef,
    FoliumSourcePage,
    FoliumSourceSong,
    FoliumSourceUser,
    FoliumText,
    FoliumSourceCatalog,
} from '@folia/folium';
import {
    fnMusicBridgeStatus,
    fnMusicCoverUrl,
    fnMusicError,
    fnMusicLogin,
    fnMusicLogout,
    fnMusicStreamSource,
    fnmusicRequest,
} from './fnmusicTransport';

// sources/fnmusic/client/fnmusicProvider.ts
// 飞牛音乐（飞牛 fnOS 官方音乐服务器）音源的定义（folium.sources.register 收的那份）：每个能力族一组成员，形状是
// 公开契约的。宿主的开关由实现了哪些能力推导，和迁之前手写的开关表一致：搜索、播放、歌词（Folia 歌词文档）、
// 账号（表单登录）、曲库（歌单、专辑、红心）、目录（歌单、专辑、歌手）、改动（红心、歌单增删歌、建歌单），没有推荐。
// 模组只在桌面版的主窗口里跑（模组系统的桥只有 Electron 有），所以没有迁之前「网页版没有桥」的那一支。
//
// 字段映射（见模组 README）：
//  歌曲: guid / title / artists[{guid,name}] / album{guid,name,coverId,artists} /
//        duration(ms) / coverId / trackNo / discNo / isFavorite / isCue / createdAt(秒)
//  搜索: GET /music/api/v1/search/track?q=&page=&size= → { total, list }
//  歌词: GET /music/api/v1/lyric/list?trackGUID= → { list, preferred }
//  播放: 主进程桥回媒体路由 stream 的地址（转发 /music/api/v1/track/stream?guid=）

/** What the definition needs of the host besides the transport: the mod's own texts, as keys. */
export interface FnMusicSourceEnv {
    text(key: string): FoliumText;
}

type FnMusicRecord = Record<string, unknown>;
const record = (value: unknown): FnMusicRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as FnMusicRecord : {}
);
/** A field as text: strings as they are, numbers too (ids may come as numbers); anything else is empty. */
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const artistsOf = (raw: unknown): FoliumSourceNamedRef[] => {
    const seen = new Set<string>();
    return list(raw).flatMap(entry => {
        const single = record(entry);
        const name = text(typeof entry === 'string' ? entry : (single.name ?? single.artistName));
        const id = text(typeof entry === 'string' ? entry : (single.guid ?? single.id ?? single.artistId));
        if (!name || seen.has(name)) return [];
        seen.add(name);
        // 迁之前没有 guid 的歌手也按名字开目录（catalogRef 用名字作 id），照旧。
        return [{ id: id || name, name }];
    });
};

const coverOf = (coverId: unknown): string => fnMusicCoverUrl(text(coverId));

/** 归一化一首飞牛音乐歌曲（字段名取自网页端 Sj 映射器）。封面地址由 coverId 生成，coverId 也存在 data 里。 */
export const normalizeFnMusicSong = (raw: unknown): FoliumSourceSong => {
    const item = record(raw);
    const id = text(item.guid ?? item.id ?? item.mediaId ?? '');
    if (!id) throw fnMusicError('invalid-response', '飞牛音乐歌曲缺少 guid');
    const album = record(item.album);
    const albumId = text(album.guid ?? item.albumId ?? '');
    const coverId = text(item.coverId ?? album.coverId ?? '');
    return {
        id,
        title: text(item.title ?? item.trackName ?? item.name ?? ''),
        artists: artistsOf(item.artists),
        album: {
            id: albumId,
            name: text(album.name ?? item.albumName ?? ''),
            coverUrl: coverOf(coverId),
            // 没有专辑 guid 的歌，专辑名不开目录（迁之前 catalogRef 只在有 guid 时给）。
            ...(albumId ? {} : { ref: false }),
        },
        durationMs: Math.max(0, Number(item.duration ?? item.durationMs ?? 0)) || 0,
        data: {
            coverId,
            createdAt: (item.createdAt as number | string | null | undefined) ?? null,
            updatedAt: (item.updatedAt as number | string | null | undefined) ?? null,
            isFavorite: Boolean(item.isFavorite),
            isCue: Boolean(item.isCue),
            trackNo: (item.trackNo as number | string | null | undefined) ?? null,
            discNo: (item.discNo as number | string | null | undefined) ?? null,
        },
    };
};

const songPage = (items: FoliumSourceSong[], total: number, offset: number): FoliumSourcePage<FoliumSourceSong> => ({
    items,
    total,
    hasMore: offset + items.length < total,
    nextOffset: offset + items.length,
});

/** 歌词项取文本字段（Folia 歌词文档）。接口字段名做了多候选兼容。 */
const lyricTextOf = (raw: unknown): string => {
    const item = record(raw);
    return text(item.lyric ?? item.lyrics ?? item.content ?? item.lrc ?? item.text ?? '');
};

/** 数量字段（网页端可能是 number 或数字字符串）。 */
const countOf = (value: unknown): number | undefined => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

type Query = Record<string, string | number | boolean | undefined>;

/** 列表接口信封：可能为 { total, list }，也可能直接是数组。list 缺失按空列表处理，total 缺失按 list 长度。 */
const pageList = async (path: string, params: Query | undefined): Promise<{ total: number; list: unknown[] }> => {
    const raw = await fnmusicRequest(path, params);
    if (Array.isArray(raw)) return { total: raw.length, list: raw };
    const envelope = record(raw);
    const items = list(envelope.list);
    const total = Number(envelope.total ?? items.length) || items.length;
    return { total, list: items };
};

const pageParams = (limit: number, offset: number) => ({ page: Math.floor(offset / limit) + 1, size: limit });

/** 歌单/专辑/歌手列表项 → 收藏卡片（字段名与网页端 bundle 对齐）。 */
const collectionOf = (type: 'playlist' | 'album' | 'artist') => (raw: unknown): FoliumSourceCollection => {
    const item = record(raw);
    const artists = Array.isArray(item.artists)
        ? item.artists.flatMap((entry: unknown) => {
            const a = record(entry);
            const artistName = text(a.name ?? a.artistName);
            return artistName ? [{ name: artistName, id: text(a.guid ?? a.id ?? a.artistId ?? artistName) }] : [];
        })
        : undefined;
    const trackCount = countOf(item.trackCount ?? item.track_total ?? item.songCount ?? item.trackTotal);
    const albumCount = countOf(item.albumCount ?? item.album_total);
    const description = text(item.description ?? item.summary ?? '');
    return {
        id: text(item.guid ?? item.id ?? ''),
        type,
        name: text(item.name ?? item.title ?? ''),
        coverUrl: coverOf(item.coverId),
        ...(description ? { description } : {}),
        ...(trackCount !== undefined ? { trackCount } : {}),
        ...(albumCount !== undefined ? { albumCount } : {}),
        ...(artists ? { artists } : {}),
    };
};

/** detail 接口响应 → 收藏卡片；没有 id 回 null。 */
const collectionDetailOf = (type: 'playlist' | 'album' | 'artist') => (raw: unknown): FoliumSourceCollection | null => {
    const item = record(raw);
    return text(item.guid ?? item.id ?? '') ? collectionOf(type)(item) : null;
};

const collectionPage = async (path: string, type: 'playlist' | 'album', limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>> => {
    const { total, list: items } = await pageList(path, pageParams(limit, offset));
    const collections = items.map(collectionOf(type));
    return { items: collections, total, hasMore: offset + collections.length < total, nextOffset: offset + collections.length };
};

const tracksPage = async (path: string, idParam: string, id: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> => {
    const { total, list: items } = await pageList(path, { [idParam]: id, ...pageParams(limit, offset) });
    return songPage(items.map(normalizeFnMusicSong), total, offset);
};

const songIdOf = (song: string | FoliumSourceSong): string => (typeof song === 'string' ? song : song.id);

export const fnMusicLibrary: FoliumSourceLibrary = {
    /** 我的歌单。请求失败抛错（不返回空页）：账号读失败时保留旧数据，避免空列表覆盖账户歌单。 */
    getUserPlaylists: (_userId, limit, offset) => collectionPage('/music/api/v1/playlist/list', 'playlist', limit, offset),

    /** 专辑列表（Folia 的「专辑」页）。请求失败抛错（不返回空页）。 */
    getUserAlbums: (_userId, limit, offset) => collectionPage('/music/api/v1/album/list', 'album', limit, offset),

    /** 我喜欢的歌曲 id 全量（favorite-track/list 分页循环）。只读到尾才 whole:true，
     *  中途失败或超过页数上限必须 whole:false（否则未读到的歌会被去掉红心并存进快照）。 */
    async getLikedSongIds() {
        const ids: string[] = [];
        const PAGE = 100;
        const MAX_PAGES = 20;
        let complete = false;
        try {
            for (let page = 1; page <= MAX_PAGES; page += 1) {
                const raw = record(await fnmusicRequest('/music/api/v1/favorite-track/list', { page, size: PAGE }));
                const items = list(raw.list);
                ids.push(...items
                    .map(entry => text(record(entry).trackGUID ?? record(entry).guid ?? record(entry).id ?? ''))
                    .filter(Boolean));
                const total = Number(raw.total ?? 0);
                if (items.length < PAGE) { complete = true; break; }
                if (total > 0 && ids.length >= total) { complete = true; break; }
            }
        } catch (error) {
            // 日志交错误本体（栈/字段都在），不只 message。
            console.warn('[FnMusic] favorite-track/list failed:', error);
        }
        return { ids, whole: complete };
    },
};

/** 变更能力：红心（favorite-track create/delete）、添加/移除歌单曲目（playlist add-track/remove-track）、建歌单（playlist create）。
 *  飞牛音乐没有"收藏歌单"接口（网页端无此功能），明确禁用。 */
export const fnMusicMutations: FoliumSourceMutations = {
    async likeSong(song, liked) {
        await fnmusicRequest(
            liked ? '/music/api/v1/favorite-track/create' : '/music/api/v1/favorite-track/delete',
            undefined,
            { method: 'POST', body: { trackGUID: songIdOf(song) } },
        );
    },
    canSubscribe: () => false,
    canAddToPlaylist: () => true,
    async createPlaylist(name) {
        const raw = await fnmusicRequest('/music/api/v1/playlist/create', undefined, { method: 'POST', body: { name } });
        return collectionOf('playlist')(raw);
    },
    async updatePlaylistTracks(operation, playlist, tracks) {
        const playlistId = typeof playlist === 'string' ? playlist : playlist.id;
        await fnmusicRequest(
            operation === 'add' ? '/music/api/v1/playlist/add-track' : '/music/api/v1/playlist/remove-track',
            undefined,
            { method: 'POST', body: { guid: playlistId, trackGUIDs: tracks.map(songIdOf) } },
        );
    },
};

export const fnMusicCatalog: FoliumSourceCatalog = {
    /** 歌单内歌曲：/music/api/v1/track/playlist-detail/list?playlistGUID=&page=&size= */
    getPlaylistTracks: (id, limit, offset) => tracksPage('/music/api/v1/track/playlist-detail/list', 'playlistGUID', id, limit, offset),
    getPlaylistDetail: async id => collectionDetailOf('playlist')(await fnmusicRequest('/music/api/v1/playlist/detail', { guid: id })),
    /** 专辑内歌曲：/music/api/v1/track/album-detail/list?albumGUID=&page=&size= */
    getAlbumTracks: (id, limit = 100, offset = 0) => tracksPage('/music/api/v1/track/album-detail/list', 'albumGUID', id, limit, offset),
    getAlbumDetail: async id => collectionDetailOf('album')(await fnmusicRequest('/music/api/v1/album/detail', { guid: id })),
    /** 歌手歌曲：/music/api/v1/track/artist-detail/list?artistGUID=&page=&size= */
    getArtistSongs: (id, limit, offset) => tracksPage('/music/api/v1/track/artist-detail/list', 'artistGUID', id, limit, offset),
    getArtistDetail: async id => collectionDetailOf('artist')(await fnmusicRequest('/music/api/v1/artist/detail', { guid: id })),
};

/** 歌词：/music/api/v1/lyric/list 的 preferred 那份排第一，取第一份有文字的，按 Folia 歌词文档交给宿主解析。 */
const getLyrics = async (song: FoliumSourceSong): Promise<FoliumSourceLyricsResult | null> => {
    const raw = record(await fnmusicRequest('/music/api/v1/lyric/list', { trackGUID: song.id }));
    const items = list(raw.list);
    if (items.length === 0) return null;
    const preferredIndex = Number(raw.preferred ?? 0);
    const candidates = items.length > 1 && Number.isFinite(preferredIndex) && preferredIndex >= 0 && preferredIndex < items.length
        ? [items[preferredIndex], ...items.slice(0, preferredIndex), ...items.slice(preferredIndex + 1)]
        : items;
    for (const candidate of candidates) {
        const lyricText = lyricTextOf(candidate);
        if (lyricText) return { main: { format: 'folia', text: lyricText } };
    }
    return null;
};

const toUser = (status: Awaited<ReturnType<typeof fnMusicBridgeStatus>>): FoliumSourceUser | null => {
    if (!status?.authenticated) return null;
    // 账号 id 用 NAS 上的用户 guid；没有时用「登录名@服务器」，两台 NAS 上同名的账号不会被当成一个。
    const host = status.base ? (() => { try { return new URL(status.base).host; } catch { return status.base; } })() : '';
    const username = status.username || 'fnmusic-user';
    return {
        id: status.userId || (host ? `${username}@${host}` : username),
        nickname: status.nickname || username,
    };
};

/** The source of the manifest's `sources[0]` (id `fnmusic`). */
export const createFnMusicSource = (env: FnMusicSourceEnv): FoliumSourceDef => ({
    id: 'fnmusic',
    // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
    displayName: '飞牛音乐',
    shortName: env.text('name.short'),
    mark: { letter: '飞', color: '#0891b2' },
    capabilities: {
        'search@1': {
            // 迁之前「有登录的平台算要账号」：没登录时搜索页不列它（搜什么都要先连上 NAS）。
            access: 'account',
            async searchSongs(query, limit, offset) {
                if (!query.trim()) return songPage([], 0, offset);
                const raw = record(await fnmusicRequest('/music/api/v1/search/track', { q: query, ...pageParams(limit, offset) }));
                const items = list(raw.list);
                const total = Number(raw.total ?? items.length) || items.length;
                return songPage(items.map(normalizeFnMusicSong), total, offset);
            },
        },
        'songs@1': {
            async getSong(id) {
                const raw = await fnmusicRequest('/music/api/v1/track/metadata', { trackGUID: id });
                const item = record(raw);
                return normalizeFnMusicSong(item.track ?? item.song ?? raw);
            },
        },
        'playback.audio@1': {
            // track/stream 只回 NAS 上的原始文件，没有可选的音质：只列一档，音质选项不给不起作用的档位。
            audioQualityLevels: ['standard'],
            async getAudioSource(song) {
                return { url: await fnMusicStreamSource(song.id) };
            },
        },
        // 不是别的歌的歌词来源（迁之前不在歌词来源表里），没有 crossSource。
        'lyrics@1': { getLyrics },
        'auth@1': {
            getLoginTexts: () => ({ title: env.text('login.title'), note: env.text('login.note') }),
            // 表单式登录：登录窗口按声明渲染字段，提交后由本音源完成登录（主进程保存凭据）。
            getLoginForm: () => ({
                fields: [
                    { key: 'base', type: 'url', label: env.text('form.serverUrl'), placeholder: env.text('form.serverUrlPlaceholder'), required: true },
                    { key: 'username', type: 'text', label: env.text('form.username'), placeholder: env.text('form.usernamePlaceholder'), required: true },
                    { key: 'password', type: 'password', label: env.text('form.password'), required: true },
                ],
                submitLabel: env.text('form.submit'),
                note: env.text('form.note'),
                // 错误按 code 显示（120001 → auth-required；网络失败 → network；地址不成形 → unavailable；其余 → invalid-response）。
                errors: {
                    'auth-required': env.text('error.badCredentials'),
                    network: env.text('error.network'),
                    'invalid-response': env.text('error.badResponse'),
                    unavailable: env.text('error.badServerUrl'),
                },
            }),
            async submitLoginForm(values) {
                // 不传 deviceId：主进程桥复用已保存的值（首次登录才生成），避免每次重新登录都在 NAS 设备列表里新增一台 Folia。
                await fnMusicLogin({ base: text(values.base), username: text(values.username), password: text(values.password) });
            },
            getLoginStatus: async () => toUser(await fnMusicBridgeStatus()),
            async logout() {
                await fnMusicLogout();
            },
            // 账号密码登录走表单（登录窗口按声明渲染），没有扫码或网页登录。
            startLogin: () => Promise.reject(fnMusicError('auth-required', '请在登录窗口填写飞牛音乐服务器地址与账号')),
            async checkLogin() {
                const status = await fnMusicBridgeStatus();
                return status?.authenticated ? { state: 'confirmed' } : { state: 'error', message: '登录未完成' };
            },
            describeLoginFailure: (_step, error) => ({
                case: 'unknown',
                message: error instanceof Error ? error.message : '登录失败',
            }),
        },
        'library@1': fnMusicLibrary,
        'catalog@1': fnMusicCatalog,
        'mutations@1': fnMusicMutations,
    },
});
