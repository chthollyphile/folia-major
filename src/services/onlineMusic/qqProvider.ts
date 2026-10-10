import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    OnlineSearchSuggestion,
    ProviderCollection,
    ProviderComment,
    ProviderLyricsResult,
    ProviderPage,
    ProviderUser,
    QrLoginMethod,
    QrLoginState,
} from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';
import type { ProviderSongListCategoryGroup } from '../../types/onlineMusic';
import { normalizeCommentText } from './commentText';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { toSafePlaybackUrl } from '../../utils/appPlaybackHelpers';
import { QQ_SEARCH_TYPE, fetchQQLyrics, searchQQLyrics, searchQQByType } from '../../utils/lyrics/providers/qqLyricProvider';
import { writeProviderSessionValue } from './providerStorage';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from './qqNormalize';
import { clearQqSession, getQqTransportAvailability, hasQqSession, requestQq } from './qqTransport';

// src/services/onlineMusic/qqProvider.ts

const errorFields = (error: unknown) => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
});

const searchSongs = async (query: string, limit: number, offset: number) => {
    // Reuses the QQ search that already backs lyric matching; only the provider contract is new.
    const results = await searchQQLyrics(query, Math.floor(offset / Math.max(1, limit)) + 1, limit);
    const items = results.map(normalizeQqSong);
    return { items, hasMore: items.length === limit, nextOffset: offset + items.length };
};

// smartbox 联想：后端 controller 读 query 里的 `key`，回包是 `{ response: { data: { song/singer/... } } }`。
// 单曲给 name + 歌手，歌手给 name（选中即搜歌手名）；MV 与专辑联想不进搜索框。
// 单曲项额外带一份正规化好的可播歌曲：smartbox 的 singer 是平铺字符串，先映射成
// normalizeQqSong 认的数组形状再正规化，点联想就能直接播，不必绕结果页。
const getSmartboxSuggestions = async (query: string): Promise<OnlineSearchSuggestion[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const response = await requestQq<any>('smartbox', { key: trimmed });
    const data = response?.response?.data;
    if (!data) return [];
    const songItems = Array.isArray(data?.song?.itemlist) ? data.song.itemlist : [];
    const singerItems = Array.isArray(data?.singer?.itemlist) ? data.singer.itemlist : [];
    const readName = (item: unknown): string => {
        const name = (item as { name?: unknown })?.name;
        return typeof name === 'string' ? name.trim() : '';
    };
    const readSinger = (item: unknown): string => {
        const singer = (item as { singer?: unknown })?.singer;
        return typeof singer === 'string' ? singer.trim() : '';
    };
    const toPlayableShape = (item: Record<string, unknown>) => (
        typeof item.singer === 'string'
            ? { ...item, singer: [{ name: item.singer }] }
            : item
    );
    return [
        ...songItems.slice(0, 6).map((raw: unknown) => {
            const item = (raw ?? {}) as Record<string, unknown>;
            return {
                kind: 'song' as const,
                value: readName(item),
                ...(readSinger(item) ? { detail: readSinger(item) } : {}),
                song: normalizeQqSong(toPlayableShape(item)),
            };
        }),
        ...singerItems.slice(0, 3).map((item: unknown) => ({
            kind: 'singer' as const,
            value: readName(item),
        })),
    ].filter(suggestion => suggestion.value.length > 0);
};

// 类型搜索：2=专辑（item_album）、3=歌单（item_songlist），一次各取一页。歌单卡不可写
//（搜索到的是别人的歌单，normalizeQqCollection 认不出 owned），点卡片只导航。
const searchCollections = async (query: string, limit: number, offset: number) => {
    const trimmed = query.trim();
    const page = Math.floor(offset / Math.max(1, limit)) + 1;
    const [albums, playlists] = trimmed
        ? await Promise.all([
            searchQQByType(trimmed, page, limit, QQ_SEARCH_TYPE.album),
            searchQQByType(trimmed, page, limit, QQ_SEARCH_TYPE.playlist),
        ])
        : [[], []];
    const items = [
        ...albums.map((item: unknown) => normalizeQqCollection(item, 'album')),
        ...playlists.map((item: unknown) => normalizeQqCollection(item, 'playlist')),
    ];
    return { items, hasMore: false, nextOffset: offset + items.length };
};

const QQ_QUALITY_FALLBACKS: Record<
    AudioQualityPreference,
    Array<{ apiQuality: '128' | '320' | 'flac'; resolvedQuality: AudioQualityPreference }>
> = {
    standard: [{ apiQuality: '128', resolvedQuality: 'standard' }],
    high: [
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    lossless: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    // The current backend protocol exposes FLAC but no distinct Hi-Res tier.
    hires: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
};

const getQqSongMid = (song: SongResult): string => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    return String(song.qqMid || sourceRef?.providerData?.songMid || sourceRef?.mediaId || '').trim();
};

/**
 * 读一次歌单详情，并把「上游没读到这个歌单」和「歌单确实是空的」分开。
 *
 * 上游这条是匿名 CGI：歌单不公开时它**照样回 `code: 0`**，只是 `cdlist[0]` 退化成一个空壳 ——
 * 没有 `dissname`，songlist 为空数组。2026-09-11 用真实账号对一个 `dirShow: 2` 的自建歌单抓到的是
 * `{ code: 0, disstid: '9777066643', dissname: undefined, songlist: [] }`：`disstid` 照样回声，
 * 所以判据是 `dissname` 在不在，而不是 `disstid`，也不是 `cdlist` 或 songlist 的长度 —— 真的空歌单
 * 会带着完整的 `dissname` 回来。两者混成同一个空结果，就是用户看到的那个没有报错的「暂无内容」。
 */
const loadRawPlaylistTracks = async (
    id: MediaId,
    collection?: ProviderCollection,
): Promise<{ tracks: unknown[]; total?: number }> => {
    const response = await requestQq<any>('song_list_detail', { disstid: String(id) });
    const cdlist = response?.response?.cdlist;
    const detail = Array.isArray(cdlist) ? cdlist[0] : undefined;
    const dissname = String(detail?.dissname ?? '').trim();

    if (!detail || typeof detail !== 'object' || !dissname) {
        // 已知不公开时报 `not-public` 而不是 `invalid-response`：这不是协议坏了，是这条匿名
        // 路由没资格读它 —— 后端补上带凭据的歌单路由之后，自建歌单就不会再走到这里。调用方据此
        // 给用户一句能看懂的解释，而不是把协议细节甩到界面上。
        const dirShow = Number(collection?.providerData?.dirShow);
        const notPublic = Number.isFinite(dirShow) && dirShow !== 1;
        throw new OnlineProviderError(
            notPublic ? 'not-public' : 'invalid-response',
            `QQMusicApi song_list_detail could not read playlist ${String(id)}`
            + `${notPublic ? ' (not a public playlist; this anonymous endpoint cannot read it)' : ''}`,
            'qq',
            response?.response,
        );
    }

    const tracks = Array.isArray(detail.songlist) ? detail.songlist : [];
    const total = Number(detail.total_song_num ?? detail.songnum);
    return { tracks, ...(Number.isFinite(total) && total >= 0 ? { total } : {}) };
};

// 后端有没有 `/user/playlist-detail` 只取决于它的版本，一个会话里不会变，所以探到一次 404
// 就记下来，不再为每一页重试。刷新页面自然会重新探测。
let ownedPlaylistRouteMissing = false;

export const resetQqProviderRuntimeCache = (): void => {
    ownedPlaylistRouteMissing = false;
};

// 推荐面向。猜你喜欢（刷歌）是唯一必须登录的一路；雷达与新歌速递各自一条上游接口。
// 雷达和新歌没有独立的 provider 方法（`OnlineRecommendationProvider` 只约定了 getDailySongs /
// getPersonalFm / getRecommendedCollections），所以按酷狗那套 `virtualRecommendation` 约定把它们
// 伪装成歌单交给 UI：catalog 认出标记后回源拉歌，订阅与收藏这类写操作对它一律不适用。

/** 新歌速递的地区页签：1 内地 / 2 欧美 / 3 日本 / 4 韩国 / 5 最新 / 6 港台。 */
const QQ_NEW_SONG_TYPE = 5;

/** 一次刷歌拉多少首。上游默认只回 5 条，连续刷歌靠这里一次多要一些。 */
const QQ_PERSONAL_FM_SIZE = 30;

/** 相似歌曲一段要多少首。后端封顶 50。 */
const QQ_SIMILAR_SONG_SIZE = 20;

/** 推荐歌单广场单页上限，与后端 `getRecommendPlaylists` 的封顶一致。 */
const QQ_RECOMMEND_PLAYLIST_LIMIT = 40;

type QqRecommendationRowId = 'similar' | 'radar' | 'new-songs';

const QQ_RECOMMENDATION_ROWS: ReadonlyArray<{ id: QqRecommendationRowId; name: string }> = [
    { id: 'similar', name: '相似歌曲' },
    { id: 'radar', name: '雷达' },
    { id: 'new-songs', name: '新歌速递' },
];

const asRecord = (value: unknown): Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
);

/**
 * 上游在不同接口上裹的层数不一样：`VecSongs[].Track` 与 `List[].Playlist.basic` 都要拆一层，
 * 而 `tracks` / `songlist` 里的条目本身就是 Track。这里两种形状都认，免某一支改了包裹方式
 * 就整行变空 —— 推荐行没有第二级数据源可以回退。
 */
const unwrapTrack = (value: unknown): unknown => {
    const entry = asRecord(value);
    const track = asRecord(entry.Track);
    return Object.keys(track).length > 0 ? track : value;
};

const unwrapPlaylist = (value: unknown): unknown => {
    const entry = asRecord(value);
    const playlist = asRecord(entry.Playlist);
    const basic = asRecord(playlist.basic);
    return Object.keys(basic).length > 0 ? basic : value;
};

/**
 * 归一化一批条目并丢掉没有 songmid 的。
 * 判据是 `qqMid` 而不是 `sourceRef.mediaId`：后者在缺 mid 时会回退成数字 songId 而依然为真，
 * 但 `getAudioSource` 与 catalog 解析都拿不到可用的 songmid，那种歌既播不了也点不开专辑。
 */
/**
 * 歌单分类树（探针 2026-10-08）：上游  里每组带
 *  与 （ 是数字字符串， 是中文名）。
 * id 全部原样字符串化不做拆解：那些数字是上游的内部键，拆开就丢了连续性。
 */
/**
 * 上游分类名带 HTML 实体（实测 ，即 R&B）。
 * 只解决显示，id 不动：那些实体是上游注释编码，不解码用户就看到一串“&#38;”。
 */
export const decodeQqEntities = (text: string): string => text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export const toQqCategoryGroups = (raw: unknown): ProviderSongListCategoryGroup[] => {
    const groups = (raw as { response?: { data?: { categories?: unknown[] } } })
        ?.response?.data?.categories;
    if (!Array.isArray(groups)) return [];

    return groups.map((group: any) => ({
        id: String(group?.categoryGroupId ?? group?.categoryGroupName ?? ''),
        label: decodeQqEntities(String(group?.categoryGroupName ?? '')),
        items: (Array.isArray(group?.items) ? group.items : []).map((item: any) => ({
            id: String(item?.categoryId ?? ''),
            label: decodeQqEntities(String(item?.categoryName ?? '')),
        })),
        // 分组名空白或者没有条目的组是无意义占位，不要呈现给用户。
    })).filter(group => group.label && group.items.length > 0);
};

/**
 * 按分类拉歌单广场（排序固定最热 sortId=5，采用上游默认这个最稳的值）。
 * 内容与其他广场场景完全同构： + 。
 */
const fetchQqCategorySongLists = async (
    categoryId: string,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    const response = await requestQq<any>('song_lists', {
        categoryId,
        sortId: 5,
        page: Math.floor(Math.max(0, offset) / Math.max(1, limit)),
        limit,
    });
    const data = response?.response?.data ?? {};
    const list = (Array.isArray(data?.list) ? data.list : []).map((item: unknown) => normalizeQqCollection(item, 'playlist'));
    const total = Number(data?.sum) || list.length;
    return {
        items: list,
        total,
        hasMore: offset + list.length < total,
        nextOffset: offset + list.length,
    };
};

const toQqSongs = (raw: unknown): UnifiedSong[] => (
    Array.isArray(raw)
        ? raw.map(unwrapTrack).map(normalizeQqSong).filter(song => Boolean(song.qqMid))
        : []
);

/**
 * QQ h5 评论字段拼法特殊（探针 2026-10-08 实测晴天）：正文是 rootcommentcontent
 * （不是 content！读错会把每条评论当空过滤掉 → 热门歌也显示「还没有评论」）、
 * 点赞 praisenum、时间 time（unix 秒）、头像 avatarurl。表情是 [em]xxxx[/em] 标记，剥掉只留文字。
 * 主评论（hot/comment 两栏）与楼层回复共用这一份映射，别复制粘贴出第二套。
 */
const mapQqCommentList = (list: any, isHot: boolean): ProviderComment[] => {
    return (Array.isArray(list) ? list : [])
        .map((raw: any): ProviderComment | null => {
            const content = normalizeCommentText(raw?.rootcommentcontent ?? raw?.middlecommentcontent ?? raw?.content);
            if (!content) return null;
            const likedCount = Number(raw?.praisenum ?? raw?.agree?.num);
            const timeSec = Number(raw?.time ?? raw?.addtime);
            return {
                id: raw?.rootcommentid ?? raw?.commentid ?? 0,
                content,
                userName: String(raw?.nick || raw?.rootcommentnick || raw?.username || '匿名'),
                avatarUrl: raw?.avatarurl ? String(raw.avatarurl).replace(/^http:/, 'https:') : undefined,
                ...(Number.isFinite(likedCount) && likedCount >= 0 ? { likedCount } : {}),
                // ispraise=我赞没赞。读取匿名时它恒 0（上游按观看者算），只有带登录态读才可信——
                // 但如实映射没有副作用；QQ 点赞写通道另有一关（见 likeComment 未声明的注释）。
                ...(raw?.ispraise !== undefined && raw?.ispraise !== null ? { liked: Number(raw.ispraise) > 0 } : {}),
                ...(Number.isFinite(timeSec) && timeSec > 0 ? { timeStr: new Date(timeSec * 1000).toISOString().slice(0, 10) } : {}),
                ...(isHot ? { isHot: true } : {}),
            } satisfies ProviderComment;
        })
        .filter((c: ProviderComment | null): c is ProviderComment => Boolean(c));
};

/**
 * 解析出上游写操作要的数字 songId。
 * 红心（AddSonglist）只认数字 id，而对外身份是 songmid —— 对象歌优先用已带的数字 id，
 * 只有一个 mid 时补一次歌曲详情（有去重缓存）。解析不出就返回 null，调用方决定怎么报错。
 */
const resolveQqNumericSongId = async (song: MediaId | SongResult): Promise<number | null> => {
    if (typeof song === 'object' && song !== null) {
        const direct = Number(song.id);
        if (Number.isFinite(direct) && direct > 0) return direct;
        const mid = getQqSongMid(song);
        if (!mid) return null;
        const detail = await requestQqSongDetail(mid);
        return detail ? (Number(detail.id) || null) : null;
    }
    const direct = Number(song);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const detail = await requestQqSongDetail(String(song));
    return detail ? (Number(detail.id) || null) : null;
};

const isQqVirtualRecommendation = (collection?: ProviderCollection): boolean => (
    collection?.providerData?.virtualRecommendation === true
);

const getQqRecommendationRowId = (collection?: ProviderCollection): QqRecommendationRowId | undefined => {
    const rowId = String(collection?.providerData?.rowId ?? '');
    return QQ_RECOMMENDATION_ROWS.some(row => row.id === rowId) ? rowId as QqRecommendationRowId : undefined;
};

const getQqRecommendationSeed = (collection?: ProviderCollection): string => (
    String(collection?.providerData?.seedSongId ?? '')
);

/**
 * 回源拉一个虚拟推荐行的歌曲。按 rowId 分派到各自的上游接口。
 *
 * `similar` 一行必须带种子（当前正在听的那首），没有种子就返回空 —— 相似歌曲是唯一一段
 * 跟着播放状态走的内容，没种子时它没有意义，宁可不出也不给一份账号级的通用推荐冒充。
 */
const loadQqRecommendationRow = async (
    rowId: QqRecommendationRowId,
    seedSongId?: string,
): Promise<UnifiedSong[]> => {
    if (rowId === 'similar') {
        const seed = String(seedSongId ?? '').trim();
        if (!seed) return [];
        // 上游只认 songid 一个键；多带 num 会回 code 10006（实测）。条数由上游决定。
        const response = await requestQq<any>('recommend_similar', { songid: seed });
        return toQqSongs(response?.tracks);
    }
    if (rowId === 'radar') {
        const response = await requestQq<any>('recommend_radar', { page: 0 });
        return toQqSongs(response?.tracks);
    }
    const response = await requestQq<any>('recommend_new_songs', { type: QQ_NEW_SONG_TYPE });
    return toQqSongs(response?.songs);
};

/**
 * 带凭据地读用户自己的歌单，响应形状与 `/user/liked-songs` 一致。
 *
 * 返回 `null` 表示这个后端没有这条路由（旧版本），调用方据此回落到匿名路径 —— 与
 * `login_channels` 的处理方式相同：404 是「没有声明这个能力」，不是错误。其余失败照常抛出，
 * 否则一次网络抖动会被误判成「后端不支持」并在整个会话里粘住。
 */
const loadRawOwnedPlaylistTracks = async (
    tid: MediaId,
    dirId: number,
    limit: number,
    offset: number,
): Promise<{ tracks: unknown[]; total?: number; more: boolean } | null> => {
    if (ownedPlaylistRouteMissing) return null;
    try {
        const response = await requestQq<any>('user_playlist_detail', {
            tid: String(tid),
            dirid: dirId,
            offset,
            limit,
        });
        const tracks = Array.isArray(response?.songs) ? response.songs : [];
        const total = Number(response?.total);
        return {
            tracks,
            ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
            more: response?.more === true,
        };
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'unsupported') {
            ownedPlaylistRouteMissing = true;
            return null;
        }
        throw error;
    }
};

const loadRawLikedTracks = async (
    limit: number,
    offset: number,
): Promise<{ tracks: unknown[]; total?: number; more: boolean }> => {
    const response = await requestQq<any>('user_liked_songs', { offset, limit });
    const tracks = Array.isArray(response?.songs) ? response.songs : [];
    const total = Number(response?.total);
    return {
        tracks,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        more: response?.more === true,
    };
};

const getPlaylistTracks = async (
    id: MediaId,
    limit: number,
    offset: number,
    collection?: ProviderCollection,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);

    // 雷达 / 新歌速递没有上游歌单 id：它们是 getRecommendedCollections 造出来的虚拟歌单，
    // 曲目要回源重拉。这里先于 dirId 判断走，否则它们会被当成普通歌单打到一个无效 id 上。
    const virtualRowId = getQqRecommendationRowId(collection);
    if (virtualRowId) {
        const items = await loadQqRecommendationRow(virtualRowId, getQqRecommendationSeed(collection));
        const page = items.slice(safeOffset, safeOffset + safeLimit);
        return {
            items: page,
            total: items.length,
            // 虚拟歌单是一次性拉回整行的，没有真正的下一页
            hasMore: safeOffset + page.length < items.length,
            nextOffset: safeOffset + page.length,
        };
    }

    const dirId = Number(collection?.providerData?.dirId);
    const owned = collection?.providerData?.owned === true;

    // 我喜欢留在它自己那条早就可用的路由上：换到新路由只会让一个本来就正常的功能去承担
    // 新后端的风险，而它要解决的问题（读不到不公开的自建歌单）在这里根本不存在。
    if (dirId === 201) {
        const { tracks, total, more } = await loadRawLikedTracks(safeLimit, safeOffset);
        const items = tracks.map(normalizeQqSong);
        const nextOffset = offset + items.length;
        return {
            items,
            ...(total === undefined ? {} : { total }),
            hasMore: more || (total !== undefined && nextOffset < total),
            nextOffset,
        };
    }

    // 其余自建歌单优先走带凭据的路由：只有它读得到不公开的歌单，而且支持真正的分页，不必像匿名
    // 路径那样每翻一页重拉整张歌单。判据是 `owned` 而不是 dirId —— 收藏的歌单也带 dirId，而带凭据的
    // 路由读收藏歌单会少歌：实测一张 37 首的收藏歌单只回 36 首（缺一首付费歌），连 total 也跟着变成 36，
    // 界面上完全看不出来。收藏歌单留在匿名路由上是完整的。
    if (owned && Number.isFinite(dirId) && dirId > 0) {
        const page = await loadRawOwnedPlaylistTracks(id, dirId, safeLimit, safeOffset);
        if (page) {
            const items = page.tracks.map(normalizeQqSong);
            const nextOffset = safeOffset + items.length;
            return {
                items,
                ...(page.total === undefined ? {} : { total: page.total }),
                // 空页必须停：上游的 total 可能比实际能读到的多（被过滤的歌），只看 total 会一直翻空页。
                hasMore: items.length > 0 && (page.more || (page.total !== undefined && nextOffset < page.total)),
                nextOffset,
            };
        }
    }

    // 收藏的、分享链接进来的歌单本来就只能走匿名路由；后端太旧时也回落到这里。
    const { tracks, total } = await loadRawPlaylistTracks(id, collection);
    const items = tracks
        .slice(offset, offset + Math.max(0, limit))
        .map(normalizeQqSong);
    const nextOffset = offset + items.length;
    return {
        items,
        ...(total === undefined ? {} : { total }),
        hasMore: nextOffset < tracks.length,
        nextOffset,
    };
};

const getSongDetail = async (id: MediaId) => {
    const response = await requestQq<any>('song_info', { songmid: String(id) });
    const track = response?.response?.songinfo?.data?.track_info;
    if (!track || typeof track !== 'object') return null;
    const song = normalizeQqSong(track);
    return song.qqMid ? song : null;
};

const qqSongDetailRequests = new Map<string, Promise<UnifiedSong | null>>();

// 同一首歌的专辑与歌手会各触发一次解析，两次落到同一个 songmid 上，去重掉重复请求。
const requestQqSongDetail = (songmid: string): Promise<UnifiedSong | null> => {
    const cached = qqSongDetailRequests.get(songmid);
    if (cached) return cached;

    const request = getSongDetail(songmid).finally(() => {
        if (qqSongDetailRequests.get(songmid) === request) qqSongDetailRequests.delete(songmid);
    });
    qqSongDetailRequests.set(songmid, request);
    return request;
};

const hasQqCatalogRefs = (song: UnifiedSong): boolean => Boolean(
    song.album?.catalogRef
    && song.artists.length > 0
    && song.artists.every(artist => Boolean(artist.catalogRef)),
);

// 搜索复用的是 `utils/lyrics` 里那条 `u.y.qq.com` 歌词搜索，它只把数字 `album.id` /
// `singer.id` 带出来，albummid 与 singermid 在那一层就被丢掉了。点专辑 / 歌手时补一次
// `/getSongInfo` 取回 mid —— 与 kugou 补 KRM 元数据是同一套契约，只在真的要导航时才发请求。
export const resolveQqSongCatalogRefs = async (song: UnifiedSong): Promise<UnifiedSong> => {
    if (hasQqCatalogRefs(song)) return song;

    const songmid = getQqSongMid(song);
    if (!songmid) return song;

    const detail = await requestQqSongDetail(songmid);
    if (!detail) return song;

    return {
        ...song,
        // 歌手整组替换：解析后的每一项都带 mid，混用两份会让 catalogRefs 的按名匹配对上没有 mid 的那个。
        artists: detail.artists.length > 0 ? detail.artists : song.artists,
        album: {
            ...song.album,
            ...(detail.album.catalogRef
                ? { id: detail.album.id, catalogRef: detail.album.catalogRef }
                : {}),
            name: song.album.name || detail.album.name,
            coverUrl: song.album.coverUrl || detail.album.coverUrl,
        },
    };
};

const getAudioSource = async (song: SongResult, quality: AudioQualityPreference) => {
    const songmid = getQqSongMid(song);
    if (!songmid) return null;
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const mediaId = String(sourceRef?.providerData?.mediaMid || '').trim();

    // The backend answers HTTP 200 with an empty `url` plus an `error` string when the account may
    // not stream the song (membership, region, takedown). Without keeping that apart from a request
    // failure, an unplayable song looks exactly like a transient error worth retrying.
    let sawEmptyPlayLink = false;

    for (const candidate of QQ_QUALITY_FALLBACKS[quality]) {
        try {
            const response = await requestQq<any>('music_play', {
                songmid,
                ...(mediaId ? { mediaId } : {}),
                quality: candidate.apiQuality,
            });
            const direct = response?.data?.playUrl?.[songmid];
            const fallback = Object.values(response?.data?.playUrl ?? {})[0] as any;
            const entry = direct ?? fallback;
            const url = toSafePlaybackUrl(String(direct?.url || fallback?.url || ''));
            if (url) {
                return {
                    url,
                    fetchedAt: Date.now(),
                    quality: candidate.resolvedQuality,
                };
            }
            if (entry) {
                sawEmptyPlayLink = true;
            }
        } catch (error) {
            if (error instanceof OnlineProviderError && error.code === 'auth-required') throw error;
            console.warn('[QQProvider] playback:quality-failed', {
                requestedQuality: quality,
                candidateQuality: candidate.resolvedQuality,
                ...errorFields(error),
            });
        }
    }

    console.warn('[QQProvider] playback:no-source', {
        requestedQuality: quality,
        hasMediaMid: Boolean(mediaId),
        // `true` means the upstream answered normally but issued no stream for this account.
        upstreamRefusedPlayLink: sawEmptyPlayLink,
    });
    return null;
};

// Delegates to the existing QRC pipeline, which owns decryption, translation and romanization.
const getLyrics = async (song: SongResult): Promise<ProviderLyricsResult> => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const songMid = song.qqMid || sourceRef?.mediaId || '';
    const songId = sourceRef?.providerData?.songId ?? song.id;
    if (!songMid || !songId) {
        console.warn('[QQProvider] lyrics:missing-identity', { hasSongMid: Boolean(songMid), hasSongId: Boolean(songId) });
        return { lyrics: null, isPureMusic: false };
    }

    const lyrics = await fetchQQLyrics({ ...song, id: songId as MediaId, qqMid: songMid });
    return { lyrics: lyrics ?? null, isPureMusic: false };
};

const getLoginStatus = async (): Promise<ProviderUser | null> => {
    // No opaque backend session means the account cannot be authenticated, so the startup request is skipped.
    if (!hasQqSession()) return null;

    try {
        const response = await requestQq<any>('login_status');
        const profile = response?.data?.profile;
        if (!profile) {
            console.info('[QQProvider] login-status:anonymous');
            return null;
        }
        const user = normalizeQqUser(profile);
        // The acceptance test account returned a profile without a display name, so the profile itself is the signal.
        console.info('[QQProvider] login-status:profile', {
            hasUserId: Boolean(user.id),
            hasNickname: Boolean(user.nickname),
        });
        return user;
    } catch (error) {
        // Missing, expired, rejected, or non-persisted backend sessions all arrive as 401.
        if (error instanceof OnlineProviderError && error.code === 'auth-required') {
            console.info('[QQProvider] login-status:auth-required');
            return null;
        }
        console.warn('[QQProvider] login-status:error', errorFields(error));
        throw error;
    }
};

const logout = async (): Promise<void> => {
    if (hasQqSession()) {
        await requestQq('logout').catch(error => {
            console.warn('[QQProvider] logout:error', errorFields(error));
        });
    }
    clearQqSession();
};

// 扫码登录方式：`id` 就是后端 `?channel=` 的取值，UI 层只认 labelKey 与 iconKey。
// services 层不 import 任何 .svg，图标由 UI 层按 iconKey 映射到静态资源。
// `qq` 是 QQ 扫码登录通道的 canonical 名字（旧名 `mobile`，后端仍在入口归一，
// 所以新版 Folia 配旧后端也不会断）。协议本身没变：仍送 tmeLoginType 6、收回 loginType 2。
const QQ_LOGIN_METHODS: QrLoginMethod[] = [
    { id: 'qq', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
    { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
];

const DEFAULT_QQ_LOGIN_METHOD_ID = QQ_LOGIN_METHODS[0].id;

// 后端声明的通道集合。初值 null 表示「还没问到」，此时沿用上面的硬编码数组，
// 所以没有 /login/channels 的旧后端行为完全不变。
let declaredChannels: string[] | null = null;
let channelProbe: Promise<void> | null = null;
let channelProbeRetryAt = 0;

const CHANNEL_PROBE_RETRY_DELAY_MS = 30_000;

/**
 * 后台探测成功后缓存结果；失败或 404 都先保留硬编码数组，普通渲染按冷却时间重试，登录动作可立即重试。
 * 包一层 `Promise.resolve()` 是因为调用方 `getAvailability` 是同步的、渲染期就会被读到 ——
 * 探测无论如何都不该把异常抛回渲染路径。
 */
const refreshDeclaredChannels = (forceRetry = false): Promise<void> => {
    if (channelProbe) return channelProbe;
    if (!forceRetry && Date.now() < channelProbeRetryAt) return Promise.resolve();
    channelProbe = Promise.resolve()
        .then(() => requestQq<any>('login_channels'))
        .then(response => {
            const channels = response?.data?.channels;
            if (!Array.isArray(channels) || channels.length === 0) throw new Error('Invalid QQ login channels');
            declaredChannels = channels.map(String);
            channelProbeRetryAt = 0;
        })
        .catch(() => {
            // 旧后端或暂时性网络错误都先回落到硬编码数组；清掉 Promise 才能在稍后或打开登录时重试。
            channelProbe = null;
            channelProbeRetryAt = Date.now() + CHANNEL_PROBE_RETRY_DELAY_MS;
        });
    return channelProbe;
};

// 前端只显示该 runtime 真正支持的通道：serverless 只有微信，不该显示点进去必定失败的 QQ。
// 后端只宣告一个通道时回空数组 —— Grid3D 的既有逻辑会直接进单步流程，
// serverless 用户连选择器都看不到，比多一次无意义的点击更好，且一行 UI 都不用改。
const getQrLoginMethods = (): QrLoginMethod[] => {
    void refreshDeclaredChannels();
    if (!declaredChannels) return QQ_LOGIN_METHODS;
    const supported = QQ_LOGIN_METHODS.filter(method => declaredChannels?.includes(method.id));
    return supported.length > 1 ? supported : [];
};

/** 登录动作必须等能力发现完成，避免启动的二维码通道与弹窗显示的选项来自两个时刻。 */
const resolveQrLoginMethods = async (): Promise<QrLoginMethod[]> => {
    await refreshDeclaredChannels(true);
    return getQrLoginMethods();
};

const resolveQrLoginMethodId = (methodId?: string): string => {
    if (methodId) return methodId;
    const supported = declaredChannels
        ? QQ_LOGIN_METHODS.filter(method => declaredChannels?.includes(method.id))
        : [];
    return supported.length === 1 ? supported[0].id : DEFAULT_QQ_LOGIN_METHOD_ID;
};

/** 测试用：通道缓存是模块级单例，跨用例必须能清掉。 */
export const resetQqLoginChannelCache = (): void => {
    declaredChannels = null;
    channelProbe = null;
    channelProbeRetryAt = 0;
};

// provider 摘要在应用启动时就会被读到，把探测挂在这里，等用户真的打开登录弹窗时结果早已落地，
// UI 不会先显示两个通道再缩成一个。
const getAvailability = (): ReturnType<typeof getQqTransportAvailability> => {
    const availability = getQqTransportAvailability();
    if (availability.configured) void refreshDeclaredChannels();
    return availability;
};

// 后端的会话寿命是 180 秒（qq-music-api 的 `QR_TTL_MS`），前端早 5 秒收手：
// 二维码失效时用户看到的是可重试的「已过期」，而不是一个还在轮询的死码。
const QQ_QR_TTL_MS = 175_000;

const checkQr = async (key: string): Promise<QrLoginState> => {
    const response = await requestQq<any>('login_qr_check', { key });
    const code = Number(response?.code);
    if (code === 801) return { state: 'waiting' };
    if (code === 802) return { state: 'scanned' };
    if (code === 803) {
        // Idempotent with the transport, which already stored the opaque session string on this response.
        if (typeof response?.cookie === 'string' && response.cookie) {
            writeProviderSessionValue('qq', 'cookie', response.cookie);
        }
        return { state: 'confirmed' };
    }
    if (code === 800) {
        // 800 also carries an upstream rejection; `upstreamCode` is the upstream safety number, left unnamed.
        if (response?.upstreamCode !== undefined || response?.retryAfterMs !== undefined) {
            console.warn('[QQProvider] qr-check:upstream-rejected', {
                upstreamCode: response?.upstreamCode,
                retryAfterMs: response?.retryAfterMs,
            });
            return { state: 'error', message: response?.message };
        }
        return { state: 'expired' };
    }
    return { state: 'error', message: response?.message };
};

// `/user/playlist` returns the whole GetPlaylistByUin list and takes no upstream paging parameters,
// so the Omni page window is applied locally instead of being forwarded.
const getUserPlaylists = async (
    _userId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    // 不传 `uid`：会话账号是这条 route 唯一读得到的账号，而后端从凭据里挑出来的账号 ID 比前端
    // 手上这个展示用的可靠 —— 微信凭据的 `musicid` 是占位的 0，回传它只会让自建歌单整段消失。
    const response = await requestQq<any>('user_playlist', {});
    const playlists = Array.isArray(response?.playlist) ? response.playlist : [];
    const items = playlists
        .slice(offset, offset + Math.max(0, limit))
        .map((item: unknown) => normalizeQqCollection(item));
    const nextOffset = offset + items.length;
    const total = Number(response?.total);
    if (offset === 0) {
        // `more` reports an upstream continuation this endpoint cannot request, so it is only observable here.
        console.info('[QQProvider] playlists:loaded', {
            count: playlists.length,
            ...(Number.isFinite(total) ? { total } : {}),
            more: Boolean(response?.more),
        });
    }

    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        hasMore: nextOffset < playlists.length,
        nextOffset,
    };
};

const getLikedSongIds = async (_userId: MediaId): Promise<MediaId[]> => {
    const tracks: unknown[] = [];
    let offset = 0;
    while (offset < 10000) {
        const page = await loadRawLikedTracks(100, offset);
        tracks.push(...page.tracks);
        const nextOffset = offset + page.tracks.length;
        if (page.tracks.length === 0 || (!page.more && (page.total === undefined || nextOffset >= page.total)))
            break;
        offset = nextOffset;
    }
    return tracks
        .map(normalizeQqSong)
        .map(item => item.sourceRef?.kind === 'online' ? item.sourceRef.mediaId : item.id)
        .filter((id): id is MediaId => id !== undefined && id !== null && id !== '');
};

const getUserAlbums = async (
    _userId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    // 这条 route 只读会话账号，没有 uid 参数 —— 与 `/user/playlist` 的 uid 兜底不同。
    // 分页也是后端做的，不像歌单那样一次全取回来再本地切片。
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const response = await requestQq<any>('user_albums', { offset: safeOffset, limit: safeLimit });
    const albums = Array.isArray(response?.albums) ? response.albums : [];
    const items = albums.map((item: unknown) => normalizeQqCollection(item, 'album'));
    const nextOffset = safeOffset + items.length;
    const total = Number(response?.total);

    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        // 空页一律终止翻页：后端说 more 但一条都没给的话，继续翻就是死循环。
        hasMore: Boolean(response?.more) && items.length > 0,
        nextOffset,
    };
};

// `/getAlbumInfo` 一次返回专辑详情与全部曲目，专辑详情与曲目两个方法共用同一份响应形状。
const loadRawAlbum = async (id: MediaId): Promise<{ album: any; tracks: unknown[] }> => {
    const response = await requestQq<any>('album_info', { albummid: String(id ?? '').trim() });
    const data = response?.response?.data;
    const album = data && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
    return { album, tracks: Array.isArray(album?.list) ? album.list : [] };
};

const getAlbumDetail = async (
    id: MediaId,
    existingCollection?: ProviderCollection,
): Promise<ProviderCollection | null> => {
    const { album } = await loadRawAlbum(id);
    if (!album) return existingCollection || null;

    const normalized = normalizeQqCollection({ ...album, albummid: album.mid ?? String(id) }, 'album');
    return {
        ...normalized,
        name: normalized.name || existingCollection?.name || '',
        coverUrl: normalized.coverUrl || existingCollection?.coverUrl,
        description: normalized.description || existingCollection?.description,
        trackCount: normalized.trackCount !== undefined && normalized.trackCount > 0
            ? normalized.trackCount
            : existingCollection?.trackCount,
        artists: normalized.artists?.length ? normalized.artists : existingCollection?.artists,
        publishedAt: normalized.publishedAt ?? existingCollection?.publishedAt,
        publisher: normalized.publisher || existingCollection?.publisher,
    };
};

const getAlbumTracks = async (
    id: MediaId,
    limit = 50,
    offset = 0,
    collection?: ProviderCollection,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    // 上游一次返回整张专辑且不接受分页参数，所以页窗在本地切片，与歌单曲目的处理方式一致。
    const { album, tracks } = await loadRawAlbum(id);
    // 专辑曲目条目只带 albumname 顶层字段，正规化后专辑名为空，用专辑本身的名字补齐。
    const albumName = String(collection?.name || album?.name || '');
    const items = tracks
        .slice(offset, offset + Math.max(0, limit))
        .map(raw => {
            const song = normalizeQqSong(raw);
            if (song.album.name || !albumName) return song;
            return { ...song, album: { ...song.album, name: albumName } };
        });
    const total = Number(album?.total_song_num ?? album?.total ?? tracks.length);
    const nextOffset = offset + items.length;
    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        hasMore: nextOffset < tracks.length,
        nextOffset,
    };
};

const getArtistDetail = async (id: MediaId): Promise<ProviderCollection | null> => {
    const singermid = String(id ?? '').trim();
    if (!singermid) return null;

    // `get_singer_detail_info` 与歌手曲目共用一条路由，顺带返回 singer_info、singer_brief 与两个总数，
    // 所以详情不另开端点，只取一首歌把响应压到最小。简介与总数是 singer_info 的兄弟字段，需要摊平后再正规化。
    const response = await requestQq<any>('artist_songs', { singermid, limit: 1, page: 1 });
    const data = response?.response?.singer?.data;
    // 头像上游不给，由 mid 按 photo_new 规则补齐。
    return normalizeQqCollection({
        singermid,
        ...(data && typeof data === 'object' ? data.singer_info : undefined),
        singer_brief: data?.singer_brief,
        total_song: data?.total_song,
        total_album: data?.total_album,
    }, 'artist');
};

const getArtistSongs = async (
    id: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    const pageSize = Math.max(1, limit);
    // `/getSingerHotsong` 的 page 是从 1 起算的页码，上游会换算成 sin = (page - 1) * num。
    const response = await requestQq<any>('artist_songs', {
        singermid: String(id ?? '').trim(),
        limit: pageSize,
        page: Math.floor(Math.max(0, offset) / pageSize) + 1,
    });
    const data = response?.response?.singer?.data;
    const songs = Array.isArray(data?.songlist) ? data.songlist : [];
    const items = songs.map(normalizeQqSong);
    const total = Number(data?.total_song);
    const nextOffset = offset + items.length;
    const hasTotal = Number.isFinite(total) && total >= 0;
    return {
        items,
        ...(hasTotal ? { total } : {}),
        hasMore: hasTotal ? nextOffset < total : items.length >= pageSize,
        nextOffset,
    };
};

const getArtistAlbums = async (
    id: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    const pageSize = Math.max(1, limit);
    // 同名参数在两个端点语意相反：`/getSingerAlbum` 把 page 直接当 begin 偏移量用，所以原样传 offset。
    const response = await requestQq<any>('artist_albums', {
        singermid: String(id ?? '').trim(),
        limit: pageSize,
        page: Math.max(0, offset),
    });
    const data = response?.response?.singer?.data;
    const albums = Array.isArray(data?.albumList) ? data.albumList : [];
    const items = albums
        .map((item: unknown) => normalizeQqCollection(item, 'album'))
        .filter((collection: ProviderCollection) => collection.id !== '');
    const total = Number(data?.total);
    const nextOffset = offset + albums.length;
    const hasTotal = Number.isFinite(total) && total >= 0;
    return {
        items,
        ...(hasTotal ? { total } : {}),
        hasMore: hasTotal ? nextOffset < total : albums.length >= pageSize,
        nextOffset,
    };
};

export const qqProvider: OnlineMusicProvider = {
    id: 'qq',
    displayName: 'QQ Music',
    shortName: 'QQ音乐',
    getAvailability,
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
        mutations: true,
        playlistTrackMutations: true,
        wordByWordLyrics: true,
        likes: true,
        userAlbums: true,
        comments: true,
    },
    normalizeSong: normalizeQqSong,
    normalizeUser: normalizeQqUser,
    normalizeCollection: normalizeQqCollection,
    songMetadata: {
        getSongMetadata(song) {
            return createProviderSongMetadata(song);
        },
    },
    search: { searchSongs, searchCollections, getSmartboxSuggestions },
    playback: { getSongDetail, getAudioSource },
    lyrics: { getLyrics },
    auth: {
        getLoginStatus,
        logout,
        getQrLoginMethods,
        resolveQrLoginMethods,
        async getQrKey(methodId) {
            const response = await requestQq<any>('login_qr_key', {
                channel: resolveQrLoginMethodId(methodId),
            });
            return String(response?.data?.unikey || '');
        },
        async createQr(key) {
            const response = await requestQq<any>('login_qr_create', { key });
            return String(response?.data?.qrimg || '');
        },
        checkQr,
        getQrTtlMs: () => QQ_QR_TTL_MS,
        async cancelQr(key) {
            // 后端对未知 key 也回 200，所以失败只可能是网络层。调用方在关窗时 fire-and-forget，
            // 抛出去只会让 UI 卡在一个用户无从处理的错误上，而残留会话最迟 3 分钟后自己过期。
            await requestQq('login_qr_cancel', { key }).catch(error => {
                console.warn('[QQProvider] qr-cancel:failed', {
                    name: error instanceof Error ? error.name : 'Error',
                    message: error instanceof Error ? error.message : String(error),
                });
            });
        },
    },
    recommendations: {
        // 刷歌。队列接近末尾时 omni 会反复调这里，所以一次多要一些，并且每首都过一遍
        // normalizeQqSong —— 上游偶尔会混进没有 mid 的条目，那种歌既播不了也点不开。
        async getPersonalFm() {
            const response = await requestQq<any>('recommend_radio', { num: QQ_PERSONAL_FM_SIZE });
            return toQqSongs(response?.tracks);
        },
        async getRecommendationRowSongs(section, options) {
            const row = QQ_RECOMMENDATION_ROWS.find(candidate => candidate.id === section);
            if (!row) return [];
            // seedSongId 在契约上是 MediaId（可能是数字），回源统一按字符串处理。
            const seed = options?.seedSongId !== undefined ? String(options.seedSongId) : '';
            const songs = await loadQqRecommendationRow(row.id, seed);
            return options?.limit ? songs.slice(0, options.limit) : songs;
        },
        async getSimilarSongs(seed, limit = QQ_SIMILAR_SONG_SIZE) {
            const songid = String(seed ?? '').trim();
            if (!songid) return [];
            // 同上：param 只有 songid。limit 只是本地上限，超出的丢掉。
            const response = await requestQq<any>('recommend_similar', { songid });
            return toQqSongs(response?.tracks).slice(0, limit);
        },
        async getRecommendedCollections(limit, context) {
            const seedSongId = context?.seedSongId !== undefined ? String(context.seedSongId) : '';
            // scope 把两个首页入口分成互不重叠的两半：发现要 personal（FM/相似/雷达/新歌），
            // 电台要 editorial（编辑选出来的歌单广场）。不给的那一半连请求都不发。
            const scope = context?.scope ?? 'all';
            const wantEditorial = scope !== 'personalized';
            const wantPersonal = scope !== 'editorial';
            const wanted = Math.min(QQ_RECOMMEND_PLAYLIST_LIMIT, Math.max(1, Math.floor(limit) || 1));
            // 四路各自独立，一条挂了不该让整行消失，所以逐个兜底而不是 Promise.all 一锅端。
            const [playlistResponse, ...rows] = await Promise.all([
                wantEditorial
                    ? requestQq<any>('recommend_playlists', { from: Math.max(0, Math.floor(context?.from ?? 0)), size: wanted })
                    .catch((error: unknown) => {
                        console.warn('[QQProvider] recommend:playlists-failed', errorFields(error));
                        return null;
                    })
                    : Promise.resolve(null),
                ...(wantPersonal ? QQ_RECOMMENDATION_ROWS : []).map(row => (
                    loadQqRecommendationRow(row.id, seedSongId).catch((error: unknown) => {
                        console.warn('[QQProvider] recommend:row-failed', {
                            rowId: row.id,
                            ...errorFields(error),
                        });
                        return [] as UnifiedSong[];
                    })
                )),
            ]);

            const playlists = Array.isArray(playlistResponse?.playlists)
                ? playlistResponse.playlists
                    .map(unwrapPlaylist)
                    .map((item: unknown) => normalizeQqCollection(item, 'playlist'))
                    .filter((collection: ProviderCollection) => collection.id !== '')
                : [];

            // 这里必须和上面的请求列表用同一个范围：scope 为 editorial 时 rows 是空的，
            // 若还遍历全部三行，`rows[index]` 就是 undefined，`.length` 直接抛异常，
            // 整个 getRecommendedCollections 连坐失败，电台页会空掉。
            const virtualRows = (wantPersonal ? QQ_RECOMMENDATION_ROWS : []).flatMap((row, index) => {
                const songs = rows[index] as UnifiedSong[] | undefined;
                return songs && songs.length > 0
                    ? [{
                        providerId: 'qq',
                        id: `qq-recommend-${row.id}`,
                        name: row.name,
                        type: 'playlist' as const,
                        ...(songs[0]?.album.coverUrl ? { coverUrl: songs[0].album.coverUrl } : {}),
                        trackCount: songs.length,
                        providerData: {
                            virtualRecommendation: true,
                            rowId: row.id,
                            seedSongId: row.id === 'similar' ? seedSongId : '',
                        },
                    } satisfies ProviderCollection]
                    : [];
            });

            // 顺序有语义：先是跟「你」和「此刻在听」挂钩的虚拟行，再是编辑选出来的歌单广场。
            // 反过来会把「抖音热门」摆在最前面，让人误以为这就是它的个性化推荐。
            return [...virtualRows, ...playlists];
        },
        // 电台「不感兴趣」：QQ 的反馈接口只认数字 songId，mid 要先解析一次。
        // 上游不回替换曲（与网易/酷狗的 dislike 不同），replacement 留空，调用方（FmTab 垃圾桶）
        // 自己 handleNextTrack。旧后端 404 → requestQq 抛 unsupported，omni.canDislikeSong 已把它挡在门外。
        async dislikeSong(id) {
            const songId = await resolveQqNumericSongId(id);
            if (!songId) {
                throw new OnlineProviderError('unsupported', 'QQ dislike requires a resolvable numeric song id', 'qq');
            }
            await requestQq('recommend_radio_dislike', { songid: String(songId) });
            return {};
        },
    },
    mutations: {
        // 红心 = 写进官方「我喜欢」目录（dirid 201）。omni 的 canLikeSong 认的就是这个方法。
        async likeSong(song, liked) {
            const songId = await resolveQqNumericSongId(song);
            if (!songId) {
                throw new OnlineProviderError('unsupported', 'QQ like requires a resolvable numeric song id', 'qq');
            }
            await requestQq(liked ? 'like_song' : 'unlike_song', { songid: String(songId) });
        },
        // 只有自己建的歌单可写（normalizeQqCollection 用 dirName 判 owned）；收藏来的上游会拒。
        canAddToPlaylist: playlist => (
            Boolean(playlist.providerData?.owned) && Number(playlist.providerData?.dirId) > 0
        ),
        async updatePlaylistTracks(operation, playlist, tracks) {
            const dirId = typeof playlist === 'object'
                ? Number(playlist.providerData?.dirId)
                : Number.NaN;
            if (!Number.isFinite(dirId) || dirId <= 0) {
                throw new OnlineProviderError('unsupported', 'QQ playlist write requires an owned playlist dirId', 'qq');
            }
            const resolved = await Promise.all(tracks.map(track => resolveQqNumericSongId(track)));
            const songIds = resolved.filter((id): id is number => typeof id === 'number' && id > 0);
            if (songIds.length === 0) {
                throw new OnlineProviderError('unsupported', 'no track resolved to a numeric QQ song id', 'qq');
            }
            // operation 必须显式传：后端 recommend 控制器是 `operation === 'del' ? del : add`，
            // 缺省当成添加。曾经这里写成 `operation === 'add' ? 'playlist_songs' : 'playlist_songs'`
            // （两个分支一样、字段也没给），删歌会被后端执行成加歌——用户侧是「删不掉、越删越多」。
            await requestQq('playlist_songs', {
                dirid: String(dirId),
                songids: songIds.join(','),
                operation: operation === 'add' ? 'add' : 'del',
            });
        },
        // 后端 AddPlaylist 的回包形状不稳定（不带 dirId），所以建完重拉自建歌单按名字认领；
        // 认领不到就报错，让上层把「建了但不知道建到哪」如实交给用户，而不是返回一个空壳集合。
        async createPlaylist(dirName) {
            const trimmed = dirName.trim();
            if (!trimmed) {
                throw new OnlineProviderError('unsupported', 'QQ playlist create requires a non-empty name', 'qq');
            }
            await requestQq('playlist_create', { dirname: trimmed });
            const page = await getUserPlaylists('' as MediaId, 100, 0);
            const created = page.items.find(
                item => item.name === trimmed && Boolean(item.providerData?.owned),
            );
            if (!created) {
                throw new OnlineProviderError('invalid-response', 'QQ playlist create was accepted but the playlist was not found afterwards', 'qq');
            }
            return created;
        },
    },
    library: { getUserPlaylists, getUserAlbums, getLikedSongIds },
    catalog: {
        // 只要拿得到 songmid 就补得回 mid，所以能否导航等同于这首歌是不是 QQ 的歌。
        canResolveSongCatalogRefs: song => Boolean(getQqSongMid(song)),
        resolveSongCatalogRefs: resolveQqSongCatalogRefs,
        getPlaylistTracks,
        getAlbumDetail,
        getAlbumTracks,
        getArtistDetail,
        getArtistSongs,
        getArtistAlbums,
        async getSongListCategories() {
            const response = await requestQq<unknown>('song_list_categories');
            return toQqCategoryGroups(response);
        },
        getCategorySongLists: fetchQqCategorySongLists,
    },
    comments: {
        // QQ 歌曲评论走 legacy h5 通道，匿名即可（探针 2026-10-08 判别：topid 必须是**数字 songid**，
        // 传 mid 会 code:0 commenttotal:0 假空）。所以先像 likeSong 那样把 mid 解析成数字 id 再打。
        // 上游热评/普通评论分两栏（hot_comment / comment），这里热评置顶再拼普通评论。
        async getSongComments(song, limit, offset) {
            const songId = await resolveQqNumericSongId(song);
            if (!songId) return { items: [], hasMore: false, nextOffset: offset };
            const response = await requestQq<any>('get_comments', {
                id: String(songId),
                pagesize: limit,
                pagenum: Math.floor(offset / Math.max(1, limit)),
            });
            const resp = response?.response ?? {};
            const items = [
                ...mapQqCommentList(resp?.hot_comment?.commentlist, true),
                ...mapQqCommentList(resp?.comment?.commentlist, false),
            ];
            // 上游 h5 评论翻页用的是 lasthotcommentid 游标（上一页末条的 rootcommentid），
            // 不是页码；我们没有线程化这个游标，所以只出首页，别给 UI 一个会 400 的「加载更多」。
            return { items, total: items.length, hasMore: false, nextOffset: offset };
        },

        // 楼层回复与主评论同路由，只是 cmd=6 且 rootcommentid=主评论 id（fork 控制器把它转成
        // lasthotcommentid 传给 h5）。实测（晴天 2026-10-08）：回 response.comment.commentlist，
        // 形状与主评论条目一致，pagenum 可真翻页。
        async getCommentReplies(song, commentId, limit, offset) {
            const songId = await resolveQqNumericSongId(song);
            if (!songId || !commentId) return { items: [], hasMore: false, nextOffset: offset };
            const response = await requestQq<any>('get_comments', {
                id: String(songId),
                cmd: 6,
                rootcommentid: String(commentId),
                pagesize: limit,
                pagenum: Math.floor(offset / Math.max(1, limit)),
            });
            const section = response?.response?.comment ?? {};
            const items = mapQqCommentList(section?.commentlist, false);
            const total = Number(section?.commenttotal) || items.length;
            return { items, total, hasMore: offset + items.length < total, nextOffset: offset + items.length };
        },
    },
};
