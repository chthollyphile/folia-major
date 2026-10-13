import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqProvider.test.ts

const requestMock = vi.hoisted(() => vi.fn());
const clearSessionMock = vi.hoisted(() => vi.fn());
const writeSessionValueMock = vi.hoisted(() => vi.fn());
const searchQQLyricsMock = vi.hoisted(() => vi.fn());
const fetchQQLyricsMock = vi.hoisted(() => vi.fn());
const searchQQByTypeMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('@/services/onlineMusic/qqTransport', () => ({
    getQqTransportAvailability: () => ({ configured: true }),
    getQqRemoteApiBase: () => 'https://qq.example.test',
    hasQqSession: () => transportState.hasSession,
    clearQqSession: clearSessionMock,
    requestQq: requestMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    writeProviderSessionValue: writeSessionValueMock,
}));

vi.mock('@/utils/lyrics/providers/qqLyricProvider', () => ({
    searchQQLyrics: searchQQLyricsMock,
    fetchQQLyrics: fetchQQLyricsMock,
    searchQQByType: searchQQByTypeMock,
    QQ_SEARCH_TYPE: { song: 7, album: 2, playlist: 3 },
}));

import { qqProvider, resetQqProviderRuntimeCache } from '@/services/onlineMusic/qqProvider';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from '@/services/onlineMusic/qqNormalize';
import { OnlineProviderError } from '@/types/onlineMusic';

// Field shape of the verified `music.search.SearchCgiService` item consumed by the existing QQ search;
// the identifiers are the public ones documented by the qq-music-api routes.
const SEARCH_ITEM = {
    id: 5105918,
    mid: '003rJSwm3TechU',
    title: '海阔天空',
    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: 'Beyond' }],
    album: { id: 8112, mid: '0016l2F430zMux', name: '乐与怒' },
    file: { media_mid: '001MediaMidFixture' },
    interval: 326,
};

// `/getSongInfo`（`music.pf_song_detail_svr` 同族）响应：红心/歌单写操作要的数字 songId
// 就从这里补齐 —— 对外身份是 songmid，写接口只认数字 id。
const SONG_INFO_RESPONSE = {
    response: {
        code: 0,
        songinfo: {
            data: {
                track_info: {
                    id: 5105918,
                    mid: '003rJSwm3TechU',
                    name: '海阔天空',
                    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: 'Beyond' }],
                    album: { id: 8112, mid: '0016l2F430zMux', name: '乐与怒' },
                    file: { media_mid: '001MediaMidFixture' },
                    interval: 326,
                },
            },
        },
    },
};

// Sanitized GetPlaylistByUin shape captured during account acceptance testing.
const PLAYLIST_ITEM = {
    tid: 7,
    dirId: 201,
    dirName: '我喜欢',
    songNum: 2,
    picUrl: 'https://img.example.test/small.jpg',
    bigpicUrl: 'https://img.example.test/big.jpg',
};

// 脱敏后的 `/login/status`（`GetLoginUserInfo`）响应，形状取自真实账号：
// 账号字段全在 `data.profile.info` 里，顶层只有 errMsg 与几个运营位（挂件、横幅、动态头像入口）。
// 🔴 整个响应里**没有 musicid / uin**，所以 `id` 只能是空串 —— 那不是映射漏了，是上游这条路由不给。
const LOGIN_STATUS_RESPONSE = {
    code: 200,
    data: {
        profile: {
            errMsg: 'OK',
            identify: 0,
            info: {
                nick: '多多绿🍵',
                logo: 'https://pic6.y.qq.com/qqmusic/avatar/6f4b366b-1739203735/140',
                hasUnuditLogo: 0,
                gender: 0,
                birthday: 0,
                city: '',
                singerID: 0,
                logos: null,
                isAiLogo: false,
                bgPic: '',
            },
            celebrityInfo: { uin: 0, name: '', pic: '', singerid: 0 },
            pendantInfo: {
                staticImg: 'http://y.gtimg.cn/music/common/upload/t_music_pendant_conf/6535071.png',
                dynamicImg: 'http://y.gtimg.cn/music/common/upload/t_music_pendant_conf/6535071.png',
                status: 1,
                id: 478,
            },
            aiLogoPortal: { isShow: true, icon: 'https://music-file6.y.qq.com/ocs/ai.png', text: '设置魔法百变头像' },
            banner: { isShow: true, picOfBanner: 'https://music-file6.y.qq.com/ocs/banner.png' },
        },
    },
};

// 脱敏后的 `/getAlbumInfo`（`fcg_v8_album_info_cp.fcg`）响应：一次同时给出专辑详情与完整曲目表。
const ALBUM_INFO_RESPONSE = {
    response: {
        code: 0,
        data: {
            mid: '0016l2F430zMux',
            id: 8112,
            name: '乐与怒',
            aDate: '1993-05-01',
            company: '华纳音乐',
            desc: '专辑简介',
            singerid: 4558,
            singermid: '0025NhlN2yWrP4',
            singername: 'Beyond',
            total: 3,
            total_song_num: 3,
            list: [
                { songid: 1, songmid: 'album-song-1', songname: '海阔天空', albummid: '0016l2F430zMux', interval: 326 },
                { songid: 2, songmid: 'album-song-2', songname: '爸爸妈妈', albummid: '0016l2F430zMux', interval: 245 },
                { songid: 3, songmid: 'album-song-3', songname: '情人', albummid: '0016l2F430zMux', interval: 289 },
            ],
        },
        message: 'succ',
        subcode: 0,
    },
};

// `music.musichallAlbum.AlbumListServer / GetAlbumList` 条目的宽松写法：
// 同一批 musicu 模块里 mid 字段有 `albumMID` / `albumMid` 两种拼法，正规化两种都要认。
const SINGER_ALBUM_ITEM = {
    albumID: 8112,
    albumMID: '0016l2F430zMux',
    albumName: '乐与怒',
    publishDate: '1993-05-01',
    singerID: 4558,
    singerMID: '0025NhlN2yWrP4',
    singerName: 'Beyond',
    songNum: 10,
};

// 实测 `/getSingerAlbum` 真实返回的条目形状（已脱敏）：mid 是小驼峰、曲目数字段叫
// `totalNum` 且恒为 0，而且**条目里根本没有歌手 mid**，只有 `singerName` 一个字符串。
const SINGER_ALBUM_ITEM_UPSTREAM = {
    albumMid: '0016l2F430zMux',
    albumName: '乐与怒',
    albumTranName: '',
    publishDate: '1993-05-01',
    totalNum: 0,
    albumType: '录音室专辑',
    albumID: 8112,
    singerName: 'Beyond',
    tags: null,
};

// 脱敏后的 `music.web_singer_info_svr / get_singer_detail_info` singer_info 区块。
const SINGER_INFO_BLOCK = {
    id: 4558,
    mid: '0025NhlN2yWrP4',
    name: 'Beyond',
};

// 简介与两个总数在上游是 singer_info 的兄弟字段，getArtistDetail 摊平后才交给正规化。
const SINGER_INFO_ITEM = {
    ...SINGER_INFO_BLOCK,
    total_song: 810,
    total_album: 31,
    singer_brief: '香港摇滚乐队。',
};

describe('qqProvider', () => {
    beforeEach(() => {
        requestMock.mockReset();
        clearSessionMock.mockReset();
        writeSessionValueMock.mockReset();
        searchQQLyricsMock.mockReset();
        fetchQQLyricsMock.mockReset();
        searchQQByTypeMock.mockReset();
        transportState.hasSession = true;
        resetQqProviderRuntimeCache();
    });

    it('declares library features, recommendations and mutations', () => {
        expect(qqProvider.capabilities).toMatchObject({
            userLibrary: true,
            playlists: true,
            userAlbums: true,
            likes: true,
            recommendations: true,
            mutations: true,
            playlistTrackMutations: true,
        });
        expect(qqProvider.mutations).toBeDefined();
        expect(qqProvider.recommendations).toBeDefined();
    });

    // 红心 = 写进「我喜欢」目录（dirid 201）。数字 id 来自歌曲对象本身；
    // 只有一个 mid 时应先补详情换数字 id，不能拿 mid 去打写接口。
    it('likes a song through the numeric id and unlikes through the same route', async () => {
        requestMock
            .mockImplementation(async (operation: string) => {
                if (operation === 'song_info') return SONG_INFO_RESPONSE;
                return { code: 200 };
            });

        await qqProvider.mutations?.likeSong?.({
            id: '003rJSwm3TechU',
            name: '海阔天空',
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: '003rJSwm3TechU' },
        } as never, true);
        expect(requestMock).toHaveBeenCalledWith('like_song', { songid: '5105918' });

        await qqProvider.mutations?.likeSong?.(5105918, false);
        expect(requestMock).toHaveBeenCalledWith('unlike_song', { songid: '5105918' });
    });

    // 电台「不感兴趣」：mid 先解析成数字 id 再打 feedback_radio，上游不回替换曲（replacement 空）。
    it('dislikes a radio song through the numeric id', async () => {
        requestMock
            .mockImplementation(async (operation: string) => {
                if (operation === 'song_info') return SONG_INFO_RESPONSE;
                return { code: 200 };
            });

        const result = await qqProvider.recommendations?.dislikeSong?.('003rJSwm3TechU');
        expect(requestMock).toHaveBeenCalledWith('recommend_radio_dislike', { songid: '5105918' });
        expect(result).toEqual({});
    });

    it('refuses to dislike when the numeric id cannot be resolved', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'song_info') return null;
            return { code: 200 };
        });
        await expect(qqProvider.recommendations?.dislikeSong?.('badmid'))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(requestMock).not.toHaveBeenCalledWith('recommend_radio_dislike', expect.anything());
    });

    // QQ 歌曲评论：topid 必须是数字 songid（mid 会假空），先解析再打；热评置顶再拼普通评论。
    it('merges hot and normal comments fetched by numeric songid', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'song_info') return SONG_INFO_RESPONSE;
            if (operation === 'get_comments') {
                return {
                    response: {
                        hot_comment: { commentlist: [{ rootcommentid: 'h1', rootcommentcontent: '热评[em]e1[/em]', nick: 'A', praisenum: 500, time: 1700000000, avatarurl: 'http://x/a.jpg', ispraise: 1 }] },
                        comment: { commentlist: [{ rootcommentid: 'c1', rootcommentcontent: '普通\\n第二行\\/斜杠', nick: 'B', praisenum: 2 }, { rootcommentid: 'c2', rootcommentcontent: '   ', nick: '空' }], commenttotal: 100 },
                    },
                };
            }
            return { code: 200 };
        });
        const commentSong = { id: '003rJSwm3TechU', name: '海阔天空', sourceRef: { kind: 'online', providerId: 'qq', mediaId: '003rJSwm3TechU' } } as never;
        const page = await qqProvider.comments?.getSongComments?.(commentSong, 20, 0);
        expect(page?.items).toHaveLength(2);
        // 正文取 rootcommentcontent 且剥掉 [em] 表情；点赞 praisenum、头像 avatarurl 升 https
        expect(page?.items[0]).toMatchObject({ id: 'h1', isHot: true, content: '热评', likedCount: 500, userName: 'A', avatarUrl: 'https://x/a.jpg', liked: true });
        expect(page?.items[1]).toMatchObject({ id: 'c1', content: '普通\n第二行/斜杠' });
        expect(page?.items[1]).not.toHaveProperty('liked');
        // 关键：get_comments 的 topid 用的是解析出的数字 id，不是 mid
        expect(requestMock).toHaveBeenCalledWith('get_comments', expect.objectContaining({ id: '5105918' }));
    });

    // 锁死现状（探针 2026-10-08）：评论点赞的 h5 通道拒收安卓扫码凭证（g_tk 过后仍 code -1），
    // 音乐 app 会话接不通；在拿到 web 登录通道/已证实的 musicu 评论模块之前，QQ 不声明 likeComment，
    // UI 连假按钮都不出。接通后实现这个方法并把断言反过来。
    it('does not expose comment likes until the write channel authenticates', () => {
        expect(qqProvider.comments?.likeComment).toBeUndefined();
    });

    // 楼中楼回复：cmd=6 + rootcommentid 走同一路由，形状同主评论、commenttotal 可真翻页。
    it('loads comment replies via cmd=6 with the parent comment id', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'song_info') return SONG_INFO_RESPONSE;
            if (operation === 'get_comments') {
                return {
                    response: {
                        comment: { commentlist: [{ rootcommentid: 'r1', rootcommentcontent: '回复一', nick: 'C', praisenum: 3, time: 1700000000 }], commenttotal: 417 },
                    },
                };
            }
            return { code: 200 };
        });
        const commentSong = { id: '003rJSwm3TechU', name: '海阔天空', sourceRef: { kind: 'online', providerId: 'qq', mediaId: '003rJSwm3TechU' } } as never;
        const page = await qqProvider.comments?.getCommentReplies?.(commentSong, 'c-root-1', 20, 0);
        expect(page?.items).toHaveLength(1);
        expect(page?.items[0]).toMatchObject({ id: 'r1', content: '回复一', userName: 'C', likedCount: 3 });
        expect(page?.hasMore).toBe(true);
        expect(page?.total).toBe(417);
        expect(requestMock).toHaveBeenCalledWith('get_comments', expect.objectContaining({
            id: '5105918', cmd: 6, rootcommentid: 'c-root-1',
        }));
    });

    // 新建歌单：后端 AddPlaylist 的回包不带 dirId，所以建完重拉自建歌单按名字认领。
    // 后端控制器读的是小写 `dirname` 查询参数，传错大小写会被 400 拒收。
    it('creates a playlist and claims it back by name from the owned list', async () => {
        requestMock
            .mockImplementation(async (operation: string) => {
                if (operation === 'playlist_create') return { code: 200, data: {} };
                if (operation === 'user_playlist') {
                    return {
                        total: 1,
                        playlist: [{ ...PLAYLIST_ITEM, tid: 8, dirId: 202, dirName: '我的测试歌单', songNum: 0 }],
                    };
                }
                return { code: 200 };
            });

        const created = await qqProvider.mutations?.createPlaylist?.('我的测试歌单');

        expect(requestMock).toHaveBeenCalledWith('playlist_create', { dirname: '我的测试歌单' });
        expect(created).toMatchObject({
            name: '我的测试歌单',
            providerId: 'qq',
            type: 'playlist',
        });
        expect(created?.providerData).toMatchObject({ owned: true, dirId: 202 });
    });

    it('refuses an empty playlist name without calling the write route', async () => {
        await expect(qqProvider.mutations?.createPlaylist?.('   ')).rejects.toMatchObject({
            code: 'unsupported',
        });
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('reports an invalid response when a created playlist cannot be claimed afterwards', async () => {
        requestMock
            .mockImplementation(async (operation: string) => {
                if (operation === 'playlist_create') return { code: 200, data: {} };
                if (operation === 'user_playlist') return { total: 0, playlist: [] };
                return { code: 200 };
            });

        await expect(qqProvider.mutations?.createPlaylist?.('我的测试歌单')).rejects.toMatchObject({
            code: 'invalid-response',
        });
    });

    // smartbox 联想：后端回包是 `{ response: { data: { song, singer } } }`；单曲带歌手作副行，
    // 歌手项选中即搜歌手名；MV/专辑联想不进搜索框，空查询直接短路。
    it('reads smartbox suggestions out of the wrapped response and drops empty ones', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'smartbox') {
                return {
                    response: {
                        code: 0,
                        data: {
                            song: {
                                itemlist: [
                                    { id: 4835784, mid: '001yS0N33yPm1B', name: '海阔天空', singer: 'BEYOND' },
                                    { id: 453246231, mid: '001FNg1I3mmdsP', name: '海阔天空', singer: 'G.E.M.邓紫棋' },
                                    { id: 106643901, mid: '002rZjwv4ddzKt', name: '', singer: '' },
                                ],
                            },
                            singer: {
                                itemlist: [{ id: 38603, mid: '003yKo3P1yilYs', name: '海阔天空', singer: '海阔天空' }],
                            },
                            album: { itemlist: [{ id: 8561, mid: '002XWx9122oM17', name: '海阔天空', singer: '信乐团' }] },
                            mv: { itemlist: [{ id: 134009, mid: '0024jbha2gPk27', name: '海阔天空', singer: 'BEYOND' }] },
                        },
                    },
                };
            }
            return { code: 200 };
        });

        const suggestions = await qqProvider.search?.getSmartboxSuggestions?.('海阔天空');

        expect(requestMock).toHaveBeenCalledWith('smartbox', { key: '海阔天空' });
        expect(suggestions).toHaveLength(3);
        expect(suggestions?.[0]).toMatchObject({ kind: 'song', value: '海阔天空', detail: 'BEYOND' });
        // 单曲联想必须带可播歌曲：mid 进 qqMid，平铺的 singer 字符串要映射成数组歌手
        expect(suggestions?.[0]?.song).toMatchObject({
            qqMid: '001yS0N33yPm1B',
            name: '海阔天空',
            artists: [{ name: 'BEYOND' }],
        });
        expect(suggestions?.[0]?.song?.sourceRef).toMatchObject({ kind: 'online', providerId: 'qq' });
        expect(suggestions?.[1]).toMatchObject({ kind: 'song', value: '海阔天空', detail: 'G.E.M.邓紫棋' });
        expect(suggestions?.[2]).toMatchObject({ kind: 'singer', value: '海阔天空' });
        expect(suggestions?.[2]?.song).toBeUndefined();
    });

    it('short-circuits smartbox suggestions on an empty query', async () => {
        expect(await qqProvider.search?.getSmartboxSuggestions?.('  ')).toEqual([]);
        expect(requestMock).not.toHaveBeenCalled();
    });

    // 类型搜索：专辑（item_album）与歌单（item_songlist）各取一页；搜索到的歌单认不出
    // owned，所以集合卡天然不可写 —— 点卡片只导航。
    it('searches collections of both types and keeps them unwritable', async () => {
        searchQQByTypeMock.mockImplementation(async (_keyword: string, _page: number, _size: number, searchType: number) => {
            if (searchType === 2) {
                return [{
                    albummid: '002STRxZ3ptE8B',
                    id: 30060997,
                    name: '测试专辑',
                    pic: 'https://img.example.test/album.jpg',
                    singer: 'stowic',
                    song_num: 3,
                    publish_date: '2022-08-21',
                }];
            }
            return [{
                dissid: '7279275468',
                dissname: '华语| 默写青春',
                songnum: '35',
                nickname: 'QQ音乐官方歌单',
                logo: 'https://img.example.test/list.jpg',
            }];
        });

        const page = await qqProvider.search?.searchCollections?.('华语', 12, 0);

        expect(searchQQByTypeMock).toHaveBeenCalledWith('华语', 1, 12, 2);
        expect(searchQQByTypeMock).toHaveBeenCalledWith('华语', 1, 12, 3);
        expect(page?.items).toHaveLength(2);
        expect(page?.items?.[0]).toMatchObject({ type: 'album', name: '测试专辑', providerId: 'qq' });
        expect(page?.items?.[0]?.providerData).toMatchObject({ albumMid: '002STRxZ3ptE8B' });
        expect(page?.items?.[1]).toMatchObject({ type: 'playlist', name: '华语| 默写青春' });
        // 搜索到的歌单是别人的：没有 owned 标记，歌单写判定天然拒收。
        expect(page?.items?.[1]?.providerData?.owned).toBeUndefined();
    });

    // ── 推荐面向 ────────────────────────────────────────────────────────────
    // 下面三个用例固定三件事：请求打到了哪条路由、上游裹的那一层有没有被拆开、以及没有
    // songmid 的条目会不会被丢掉。前两个是接口契约，第三个是数据可靠性 —— 一首播不了的歌混进
    // 刷歌流里，用户点下去只会看到一次无解释的失败。

    const RADIO_TRACK = {
        mid: 'radio-mid-1',
        id: 9001,
        name: 'Radio Song',
        title: 'Radio Song',
        singer: [{ mid: '0025NhlN2yWrP4', name: 'Beyond' }],
        album: { mid: '0016l2F430zMux', name: '乐与怒' },
        interval: 240,
    };

    // 雷达条目裹在 `VecSongs[].Track` 里，比刷歌那条多一层。
    const RADAR_TRACK = {
        Track: {
            ...RADIO_TRACK,
            mid: 'radar-mid-1',
            name: 'Radar Song',
            title: 'Radar Song',
        },
    };

    const NEW_SONG = {
        ...RADIO_TRACK,
        mid: 'newsong-mid-1',
        name: 'New Song',
        title: 'New Song',
    };

    // 没有 mid 的条目：既拿不到播放链接，也点不开专辑，必须在正规化阶段就丢掉。
    const MIDLESS_TRACK = { id: 9002, name: 'No Mid', title: 'No Mid', interval: 200 };

// 推荐歌单广场 `GetRecommendFeed` 的 `List[].Playlist.basic` 条目，形状取自 2026-10-05 的实测响应。
// 与用户歌单那一族不同：封面在 `cover` 对象里（`mid` 为空串），曲数是 `song_cnt`。
const RECOMMEND_PLAYLIST = {
    creator: { uin: '1791747120', nick: 'someone' },
    tid: 42,
    dirid: 50,
    title: '广场歌单',
    desc: '歌单简介',
    cover: {
        id: 0,
        mid: '',
        small_url: 'https://music-file.example.test/small.jpg',
        big_url: 'https://music-file.example.test/big.jpg',
        default_url: 'https://music-file.example.test/big.jpg',
    },
    fav_cnt: 100,
    play_cnt: 200,
    song_cnt: 30,
    dirshow: 1,
};

    const withRecommendationTransport = () => requestMock.mockImplementation(async (operation: string) => {
        switch (operation) {
            case 'recommend_radio':
                return { code: 200, tracks: [RADIO_TRACK, MIDLESS_TRACK] };
            case 'recommend_playlists':
                return { code: 200, playlists: [{ Playlist: { basic: RECOMMEND_PLAYLIST } }], more: false };
            case 'recommend_radar':
                return { code: 200, tracks: [RADAR_TRACK], hasMore: false };
            case 'recommend_new_songs':
                return { code: 200, songs: [NEW_SONG] };
            default:
                return { code: 200 };
        }
    });

    it('normalizes Personal FM tracks and drops the ones without a songmid', async () => {
        withRecommendationTransport();

        const songs = await qqProvider.recommendations?.getPersonalFm?.();

        expect(requestMock).toHaveBeenCalledWith('recommend_radio', { num: 30 });
        expect(songs).toHaveLength(1);
        expect(songs?.[0]).toMatchObject({
            id: 9001,
            name: 'Radio Song',
            qqMid: 'radio-mid-1',
            durationMs: 240_000,
        });
    });

    it('flattens wrapped recommendation rows and keeps virtual rows out of the playlist route', async () => {
        withRecommendationTransport();

        const collections = await qqProvider.recommendations?.getRecommendedCollections?.(25);
        const playlists = collections?.filter(c => c.providerData?.virtualRecommendation !== true) ?? [];
        const virtualRows = collections?.filter(c => c.providerData?.virtualRecommendation === true) ?? [];

        expect(requestMock).toHaveBeenCalledWith('recommend_playlists', { from: 0, size: 25 });
        // 真实歌单走脱壳后的 basic，id 必须是 tid 而不是外层的 Playlist 对象
        expect(playlists).toHaveLength(1);
        expect(playlists[0]).toMatchObject({ id: 42, name: '广场歌单', coverUrl: 'https://music-file.example.test/big.jpg' });

        // 雷达与新歌没有上游歌单，只能作为虚拟歌单存在；雷达那条顺带证明 Track 包装被拆开了
        expect(virtualRows.map(row => row.id)).toEqual(['qq-recommend-radar', 'qq-recommend-new-songs']);
    });

    // 「换一批」的批次偏移必须原样打到后端：context.from 传什么，请求里就是什么。
    it('forwards the batch offset to the recommend_playlists route', async () => {
        withRecommendationTransport();

        await qqProvider.recommendations?.getRecommendedCollections?.(25, { scope: 'editorial', from: 35 });

        expect(requestMock).toHaveBeenCalledWith('recommend_playlists', { from: 35, size: 25 });
    });

    it('re-fetches a virtual recommendation row instead of asking for a playlist that does not exist', async () => {
        withRecommendationTransport();

        const [radarRow] = (await qqProvider.recommendations?.getRecommendedCollections?.(25))
            ?.filter(c => c.providerData?.virtualRecommendation === true) ?? [];
        expect(radarRow).toBeDefined();

        const page = await qqProvider.catalog?.getPlaylistTracks?.(radarRow!.id, 30, 0, radarRow);

        expect(requestMock).toHaveBeenCalledWith('recommend_radar', { page: 0 });
        expect(requestMock).not.toHaveBeenCalledWith('song_list_detail', expect.anything());
        expect(page?.items[0]).toMatchObject({ qqMid: 'radar-mid-1' });
        expect(page?.total).toBe(1);
        expect(page?.hasMore).toBe(false);
    });

    it('normalizes a song onto songmid identity and keeps the numeric id in provider data', () => {
        const song = normalizeQqSong(SEARCH_ITEM);

        expect(song).toMatchObject({
            id: 5105918,
            name: '海阔天空',
            qqMid: '003rJSwm3TechU',
            durationMs: 326_000,
        });
        expect(song.sourceRef).toEqual({
            kind: 'online',
            providerId: 'qq',
            mediaId: '003rJSwm3TechU',
            providerData: {
                songId: 5105918,
                songMid: '003rJSwm3TechU',
                albumMid: '0016l2F430zMux',
                mediaMid: '001MediaMidFixture',
            },
        });
    });

    // 上游同一条目里数字 id 与 mid 并存，选错一个的代价是专辑页 / 歌手页整片空白：
    // `/getAlbumInfo?albummid=8112` 回的是 HTTP 200 加 `code: 1101 para error!`。
    it('picks the album and singer mid over the numeric ids that sit beside them', () => {
        const song = normalizeQqSong(SEARCH_ITEM);

        expect(song.album).toEqual({
            id: '0016l2F430zMux',
            name: '乐与怒',
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T002M0000016l2F430zMux.jpg?max_age=2592000',
            catalogRef: { providerId: 'qq', kind: 'album', id: '0016l2F430zMux' },
        });
        expect(song.artists).toEqual([{
            id: '0025NhlN2yWrP4',
            name: 'Beyond',
            catalogRef: { providerId: 'qq', kind: 'artist', id: '0025NhlN2yWrP4' },
        }]);

        // 数字 id 一个都不该出现在身份位上。
        expect(song.album.id).not.toBe(SEARCH_ITEM.album.id);
        expect(song.artists[0]?.id).not.toBe(SEARCH_ITEM.singer[0]?.id);
    });

    // `/getAlbumInfo` 的曲目条目没有嵌套 album 节点，albummid 平铺在顶层。
    it('reads a flat albummid from an album track entry', () => {
        const song = normalizeQqSong({
            songmid: '000B3Ekk1I79hc',
            songid: 449195,
            songname: '稻香',
            albumid: 36062,
            albummid: '002Neh8l0uciQZ',
            albumname: '魔杰座',
            singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
        });

        expect(song.album).toMatchObject({
            id: '002Neh8l0uciQZ',
            catalogRef: { providerId: 'qq', kind: 'album', id: '002Neh8l0uciQZ' },
        });
        expect(song.artists[0]).toMatchObject({ id: '0025NhlN2yWrP4' });
    });

    // 上游一个 mid 都不给时，数字 id 只能留作显示用的键，且不得伪装成可导航的集合。
    it('keeps a mid-less entry unnavigable instead of falling back to the numeric id', () => {
        const song = normalizeQqSong({
            songmid: '003rJSwm3TechU',
            songname: '海阔天空',
            album: { id: 8112, name: '乐与怒' },
            singer: [{ id: 4558, name: 'Beyond' }],
        });

        expect(song.album.id).toBe(8112);
        expect(song.album.catalogRef).toBeUndefined();
        // 歌手连显示用的数字 id 都不保留：下标够用，而数字 id 会被误当成 singermid。
        expect(song.artists).toEqual([{ id: 0, name: 'Beyond' }]);
    });

    // 空 id 会把整片网格拉崩：卡片的 React key 就是 collection.id，
    // 两张 key="" 的卡片会让 React 报「Encountered two children with the same key」
    // 并且整个网格绘制失败。getArtistAlbums / getArtistSongs 都有这一扇。
    it('drops category song lists that normalize to an empty id', async () => {
        requestMock.mockImplementation(async () => ({
            response: {
                data: {
                    sum: 2,
                    list: [
                        { dissid: 111, dissname: '有 id 的歌单', imgurl: 'http://qpic.y.qq.com/music_cover/a' },
                        { dissname: '没有任何 id 的歌单' },
                    ],
                },
            },
        }));

        const page = await qqProvider.catalog?.getCategorySongLists?.('10000000', 20, 0);

        expect(page?.items.map((item: { id: unknown }) => item.id)).toEqual([111]);
    });

    // 播放量：ProviderCollection 本来就有 playCount，网易云一直映射，
    // 只是 QQ 一直缺失。实测上游字段是 listennum（原始次数，不是「万」）。
    it('reads the play count of a category song list from listennum', () => {
        expect(normalizeQqCollection({
            dissid: 7707261125,
            dissname: '甜度爆表',
            listennum: 8553372,
        })).toMatchObject({ playCount: 8553372 });
    });

    it('leaves playCount absent when the upstream payload has no listen count', () => {
        expect(normalizeQqCollection({ dissid: 1, dissname: '无播放量' }))
            .not.toHaveProperty('playCount');
    });

    // 分类筛选的歌单要得有封面。实测 2026-10-11 抓 /getSongLists 真实响应，
    // 封面在 `imgurl`（单数字串）——这个键不在原来的候选里，所以分类卡片整片只剩骨架。
    it('reads the cover of a category song list, whose cover arrives under imgurl', () => {
        expect(normalizeQqCollection({
            dissid: 7707261125,
            dissname: '甜度爆表 | 旋律说喛射击少女心',
            imgurl: 'http://qpic.y.qq.com/music_cover/s4SoBc0IrDEDpHKlD',
            listennum: 8553372,
        })).toMatchObject({
            id: 7707261125,
            name: '甜度爆表 | 旋律说喛射击少女心',
            coverUrl: expect.stringContaining('s4SoBc0IrDEDpHKlD'),
        });
    });

    // 缓存水合会把正规化结果再喂回来，mid 必须原样活下来。
    it('keeps album and artist mids across a normalize round trip', () => {
        const once = normalizeQqSong(SEARCH_ITEM);
        expect(normalizeQqSong(once)).toEqual(once);
    });

    it('keeps a normalized song stable when it is normalized again from cache', () => {
        const song = normalizeQqSong(SEARCH_ITEM);

        expect(normalizeQqSong(song)).toEqual(song);
    });

    // 「我喜欢」= 自建目录 201：首页特殊集合靠 isLiked 认它。收藏条目也带 dirId（创建者的目录号），不算。
    it('marks only the owned dirId 201 playlist as the liked collection', () => {
        expect(normalizeQqCollection(PLAYLIST_ITEM).isLiked).toBe(true);
        expect(normalizeQqCollection({ tid: 8, dirId: 202, dirName: '自建歌单', songNum: 1 }).isLiked).toBeUndefined();
        expect(normalizeQqCollection({ dissid: 9, dirId: 201, name: '别人的我喜欢', songnum: 1 }).isLiked).toBeUndefined();
    });

    it('normalizes the playlist and profile payloads, including a profile without a display name', () => {
        expect(normalizeQqCollection(PLAYLIST_ITEM)).toEqual({
            providerId: 'qq',
            id: 7,
            name: '我喜欢',
            type: 'playlist',
            coverUrl: 'https://img.example.test/big.jpg',
            trackCount: 2,
            providerData: { tid: 7, dirId: 201, owned: true },
            isLiked: true,
        });
        expect(normalizeQqCollection(normalizeQqCollection(PLAYLIST_ITEM))).toEqual(normalizeQqCollection(PLAYLIST_ITEM));
        expect(normalizeQqCollection({ id: 8, title: '收藏歌单', picurl: 'https://img.example.test/fav.jpg', songnum: 3 })).toEqual({
            providerId: 'qq',
            id: 8,
            name: '收藏歌单',
            type: 'playlist',
            coverUrl: 'https://img.example.test/fav.jpg',
            trackCount: 3,
            providerData: { dissid: 8 },
        });
        // 推荐歌单广场（`GetRecommendFeed` 的 `List[].Playlist.basic`）是另一套拼法：封面在 `cover`
        // 对象里而不是 `picurl`，曲数字段是 `song_cnt` 而不是 `songnum`。实测形状，别再退化回去。
        expect(normalizeQqCollection(RECOMMEND_PLAYLIST)).toEqual({
            providerId: 'qq',
            id: 42,
            name: '广场歌单',
            type: 'playlist',
            coverUrl: 'https://music-file.example.test/big.jpg',
            trackCount: 30,
            providerData: { tid: 42, dirId: 50 },
        });

        expect(normalizeQqUser({ data: { profile: { musicid: 123, nickname: '我的 QQ 账号' } } })).toEqual({
            id: 123,
            nickname: '我的 QQ 账号',
        });
        // The acceptance test account answered with a profile that carries no display name at all.
        expect(normalizeQqUser({ info: {}, banner: {}, errMsg: '' })).toEqual({ id: '', nickname: '' });
    });

    // 🔴 微信凭据的 `musicid` 是占位的 0，真正的账号 ID 只在 `str_musicid` 里。
    it('ignores the placeholder account id a WeChat credential carries', () => {
        expect(normalizeQqUser({ data: { profile: { musicid: 0, str_musicid: '456' } } }))
            .toMatchObject({ id: '456' });
        // 占位值是「这个字段没给」，不是一个可用的账号 ID。
        expect(normalizeQqUser({ data: { profile: { musicid: 0, str_musicid: '0' } } }))
            .toMatchObject({ id: '' });
    });

    it('reads the display name and avatar out of the nested GetLoginUserInfo profile', () => {
        // 真实 `/login/status` 的形状：账号字段全在 `data.profile.info` 里，
        // 顶层只有 errMsg / banner / 各种运营位；整个响应没有 `avatarUrl` 这个名字。
        const user = normalizeQqUser(LOGIN_STATUS_RESPONSE);

        expect(user).toEqual({
            id: '',
            nickname: '多多绿🍵',
            avatarUrl: 'https://pic6.y.qq.com/qqmusic/avatar/6f4b366b-1739203735/140',
        });
        // 缓存水合会把正规化结果再喂回来，那一份用的是 `avatarUrl`，不能因为只认 `info.logo` 而洗掉。
        expect(normalizeQqUser(user)).toEqual(user);
        // 运营位里也有图片 URL（挂件、横幅），一个都不该被当成头像。
        expect(user.avatarUrl).not.toContain('pendant');
        expect(user.avatarUrl).not.toContain('music-file6');
    });

    it('maps every QR state translated by the backend', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 801, message: 'Waiting for QR scan' })
            .mockResolvedValueOnce({ code: 802, message: 'QR code scanned' })
            .mockResolvedValueOnce({
                code: 803,
                message: 'Authorization login successful',
                cookie: 'qqmusic_session=opaque-token',
            })
            .mockResolvedValueOnce({ code: 800, message: 'QR code expired' })
            .mockResolvedValueOnce({ code: 800, message: 'QR code expired', failureStage: 'qr-event', failureReason: 'qr-timeout', retryAfterMs: 30000 })
            .mockResolvedValueOnce({
                code: 800,
                message: 'QR login failed',
                upstreamCode: 50006,
                retryAfterMs: 31000,
            });

        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'waiting' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'scanned' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'confirmed' });
        // 自然过期只认结构化字段：不带失败字段的 800，或 failureReason=qr-timeout。
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'expired' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'expired' });
        // 上游拒绝不是过期：原样交出后端的字段，冷却照样交出，界面据此暂缓重试。
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'code 800: QR login failed',
            retryAfterMs: 31000,
            detail: { code: 800, message: 'QR login failed', upstreamCode: 50006, retryAfterMs: 31000 },
        });

        expect(requestMock).toHaveBeenCalledWith('login_qr_check', { key: 'qr-key' });
        expect(writeSessionValueMock).toHaveBeenCalledExactlyOnceWith('qq', 'cookie', 'qqmusic_session=opaque-token');
    });

    it('hands a login canceled on the phone to core as a structured reason with the backend cooldown', async () => {
        requestMock
            .mockResolvedValueOnce({
                code: 800,
                message: 'QR code expired',
                failureStage: 'qr-event',
                failureReason: 'user-canceled',
                retryAfterMs: 30000,
            })
            .mockResolvedValueOnce({
                code: 800,
                message: 'QR code expired',
                failureStage: 'qr-event',
                failureReason: 'login-rejected',
                retryAfterMs: 30000,
            });

        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toMatchObject({
            state: 'error',
            message: 'code 800: QR code expired (stage qr-event, reason user-canceled)',
            reason: 'canceled-on-device',
            retryAfterMs: 30000,
        });
        // 只有手机上取消才给结构化原因；其余被拒仍是普通失败，冷却照样交出。
        const rejected = await qqProvider.auth!.checkQr!('qr-key');
        expect(rejected).toEqual({
            state: 'error',
            message: 'code 800: QR code expired (stage qr-event, reason login-rejected)',
            retryAfterMs: 30000,
            detail: { code: 800, message: 'QR code expired', failureStage: 'qr-event', failureReason: 'login-rejected', retryAfterMs: 30000 },
        });
    });

    describe('device limit (upstream 20279)', () => {
        const validationFailure = {
            code: 800,
            message: 'QR login failed',
            failureStage: 'credential-validation',
            failureReason: 'upstream-rejected',
            upstreamCode: 1000,
        };
        const exchangeResult = (at: number, upstreamCode: number) => ({
            at, level: 'info', event: 'qq-auth.upstream-result',
            details: { phase: 'credential-exchange', httpStatus: 200, globalCode: 0, upstreamCode },
        });
        const stubDesktop = (authEvents: unknown[]) => {
            const getLoginDiagnostics = vi.fn().mockResolvedValue({ providerId: 'qq', authEvents });
            vi.stubGlobal('window', { electron: { getLoginDiagnostics } });
            return getLoginDiagnostics;
        };
        const requestKey = async () => {
            requestMock.mockResolvedValueOnce({ data: { unikey: 'qr-key' } });
            await qqProvider.auth!.getQrKey!();
        };

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        // 微信通道的凭据交换没有回退：20279 直接在响应上。
        it('reads the device limit straight off the response', async () => {
            requestMock.mockResolvedValueOnce({ ...validationFailure, failureStage: 'credential-exchange', upstreamCode: 20279 });
            await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toMatchObject({ state: 'error', reason: 'device-limit' });
        });

        // QQ 通道：响应里只剩验证那一步的 1000，20279 在主进程记下的本轮凭据交换里。
        it('finds the device limit in this round\'s credential exchange on desktop', async () => {
            await requestKey();
            const getLoginDiagnostics = stubDesktop([exchangeResult(Date.now() + 1000, 20279)]);
            requestMock.mockResolvedValueOnce(validationFailure);

            await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toMatchObject({ state: 'error', reason: 'device-limit' });
            expect(getLoginDiagnostics).toHaveBeenCalledWith('qq');
        });

        it('ignores an exchange from an earlier round and a different exchange code', async () => {
            await requestKey();
            stubDesktop([exchangeResult(1, 20279)]);
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await qqProvider.auth!.checkQr!('qr-key')).not.toHaveProperty('reason');

            stubDesktop([exchangeResult(Date.now() + 1000, 20279), exchangeResult(Date.now() + 2000, 50006)]);
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await qqProvider.auth!.checkQr!('qr-key')).not.toHaveProperty('reason');
        });

        // 网页版没有主进程可问；取快照失败也只是少了这条提示。
        it('falls back to a plain failure without a desktop snapshot', async () => {
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await qqProvider.auth!.checkQr!('qr-key')).not.toHaveProperty('reason');

            vi.stubGlobal('window', { electron: { getLoginDiagnostics: vi.fn().mockRejectedValue(new Error('ipc closed')) } });
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await qqProvider.auth!.checkQr!('qr-key')).not.toHaveProperty('reason');
        });
    });

    it('passes every backend failure field through as written, including categories it does not know yet', async () => {
        requestMock.mockResolvedValueOnce({
            code: 800,
            message: 'QR login failed',
            failureStage: 'some-future-stage',
            failureReason: 'some-future-reason',
            upstreamHttpStatus: 503,
            upstreamGlobalCode: -1,
            retryAfterMs: 30000,
            lastFailure: { failureStage: 'device-bootstrap', failureReason: 'upstream-rejected', upstreamCode: -30002 },
        });

        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'code 800: QR login failed (stage some-future-stage, reason some-future-reason)',
            retryAfterMs: 30000,
            detail: {
                code: 800,
                message: 'QR login failed',
                failureStage: 'some-future-stage',
                failureReason: 'some-future-reason',
                upstreamHttpStatus: 503,
                upstreamGlobalCode: -1,
                retryAfterMs: 30000,
                lastFailure: { failureStage: 'device-bootstrap', failureReason: 'upstream-rejected', upstreamCode: -30002 },
            },
        });
    });

    it('reports a failed session without a cooldown, and an unexpected code, as errors rather than expiry', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 800, message: 'QR login failed', failureStage: 'credential-exchange' })
            .mockResolvedValueOnce({ code: 500, message: 'Internal Server Error' });

        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toMatchObject({
            state: 'error',
            message: 'code 800: QR login failed (stage credential-exchange, reason unknown)',
        });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'code 500: Internal Server Error',
            detail: { code: 500, message: 'Internal Server Error' },
        });
    });

    it('asks for the QR with the chosen channel and fails instead of handing out an empty key or image', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, data: { unikey: 'qr-key' } });
        await expect(qqProvider.auth!.getQrKey!('wechat')).resolves.toBe('qr-key');
        expect(requestMock).toHaveBeenLastCalledWith('login_qr_key', { channel: 'wechat' });

        requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        await expect(qqProvider.auth!.getQrKey!('qq')).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'QQMusicApi login_qr_key returned no key',
            cause: { code: 200, data: {} },
        });

        requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        await expect(qqProvider.auth!.createQr!('qr-key')).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'QQMusicApi login_qr_create returned no image',
        });
    });

    it('hands a transport failure of the QR requests on unchanged, with its HTTP status, body and cooldown', async () => {
        const body = { code: 429, message: 'QR login is temporarily backed off', failureStage: 'qr-key', failureReason: 'local-backoff', retryAfterMs: 30000 };
        const error = new OnlineProviderError('network', 'QQMusicApi login_qr_key failed: HTTP 429 (QR login is temporarily backed off)', 'qq', body, 429, 30000);
        requestMock.mockRejectedValueOnce(error);

        await expect(qqProvider.auth!.getQrKey!('qq')).rejects.toBe(error);
    });

    it('describes its side of the session and the last account check for the report', async () => {
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines).toEqual([
            'runtime: web (remote API https://qq.example.test)',
            'session: backend session stored=yes',
            'login channels: not declared by the backend',
            'last account check: none',
        ]);

        transportState.hasSession = false;
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect((await qqProvider.auth!.getQrLoginDiagnostics!())[3]).toMatch(/^last account check: \d\d:\d\d:\d\d\.\d{3} no backend session stored$/);
    });

    it.each([
        ['anonymous', 'login_status: the backend does not recognize the stored session'],
        ['auth-required', 'login_status failed: QQMusicApi login required'],
        ['network', 'login_status failed: QQMusicApi login_status failed: HTTP 502'],
        ['signed-in', 'signed in (user id present, nickname present)'],
    ] as const)('records the account check result %s', async (outcome, expected) => {
        if (outcome === 'anonymous') requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        else if (outcome === 'signed-in') requestMock.mockResolvedValueOnce({ code: 200, data: { profile: { musicid: 42, info: { nick: 'Lia' } } } });
        else if (outcome === 'auth-required') requestMock.mockRejectedValueOnce(new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', undefined, 401));
        else requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi login_status failed: HTTP 502', 'qq', undefined, 502));

        const info = vi.spyOn(console, 'info').mockImplementation(() => { });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        await qqProvider.auth!.getLoginStatus().catch(() => undefined);
        info.mockRestore();
        warn.mockRestore();

        expect((await qqProvider.auth!.getQrLoginDiagnostics!())[3]).toContain(expected);
    });

    it('cancels one QR session by key and never lets the failure reach the caller', async () => {
        requestMock.mockResolvedValueOnce({ code: 200 });
        await expect(qqProvider.auth!.cancelQr!('qr-key')).resolves.toBeUndefined();
        expect(requestMock).toHaveBeenCalledExactlyOnceWith('login_qr_cancel', { key: 'qr-key' });

        // 调用方在关窗时 fire-and-forget，抛出去只会让 UI 卡在一个用户无从处理的错误上。
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 503', 'qq'));
        await expect(qqProvider.auth!.cancelQr!('qr-key')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('pages the unpaginated user playlist response locally', async () => {
        const playlist = [PLAYLIST_ITEM, { tid: 8, dirName: '收藏歌单' }, { tid: 9, dirName: '试听列表' }];
        requestMock.mockResolvedValue({ code: 200, playlist, total: 3, more: false });

        const firstPage = await qqProvider.library!.getUserPlaylists(123, 2, 0);
        expect(requestMock).toHaveBeenCalledWith('user_playlist', {});
        expect(firstPage.items.map(item => item.name)).toEqual(['我喜欢', '收藏歌单']);
        expect(firstPage).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });

        const secondPage = await qqProvider.library!.getUserPlaylists(123, 2, 2);
        expect(secondPage.items.map(item => item.id)).toEqual([9]);
        expect(secondPage).toMatchObject({ total: 3, hasMore: false, nextOffset: 3 });

        const pastEnd = await qqProvider.library!.getUserPlaylists(123, 2, 4);
        expect(pastEnd).toMatchObject({ items: [], hasMore: false, nextOffset: 4 });
    });

    // 条目形状取自 2026-08-08 对真实账号的实测：收藏专辑走的是 profile-asset CGI，
    // 字段名与 `/getAlbumInfo` 那条不同（pic / songnum / pubtime 都是这条独有的拼写）。
    const FAVORITE_ALBUM = {
        albumid: 88971,
        albummid: '000MkMni19ClKG',
        albumname: '范特西',
        pic: 'https://y.qq.com/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg',
        songnum: 12,
        pubtime: 1419609600,
        ordertime: 1754600000,
        singerid: 4286,
        singermid: '0025NhlN2yWrP4',
        singername: '周杰伦',
        singer: [{ mid: '0025NhlN2yWrP4', name: '周杰伦' }],
        status: 0,
    };

    it('maps a favourite album onto the collection shape without inventing an id', async () => {
        requestMock.mockResolvedValue({ code: 200, albums: [FAVORITE_ALBUM], total: 1, more: false });

        const page = await qqProvider.library!.getUserAlbums!(123, 20, 0);

        expect(requestMock).toHaveBeenCalledWith('user_albums', { offset: 0, limit: 20 });
        // 身份一律用 mid：数字 albumid 传给上游只会换来 1101，页面表现成一片空白。
        expect(page.items[0]).toMatchObject({
            providerId: 'qq',
            id: '000MkMni19ClKG',
            type: 'album',
            name: '范特西',
            coverUrl: 'https://y.qq.com/music/photo_new/T002M000000MkMni19ClKG.jpg',
            trackCount: 12,
            publishedAt: 1419609600000,
        });
        expect(page.items[0].artists?.[0]).toMatchObject({ id: '0025NhlN2yWrP4', name: '周杰伦' });
        expect(page).toMatchObject({ total: 1, hasMore: false, nextOffset: 1 });
    });

    it('keeps the favourite album shape stable when a cached collection is fed back in', async () => {
        requestMock.mockResolvedValue({ code: 200, albums: [FAVORITE_ALBUM], total: 1, more: false });
        const [normalized] = (await qqProvider.library!.getUserAlbums!(123, 20, 0)).items;

        // 缓存水合会把已正规化的结果再喂回来一次，不幂等就会把封面与发行时间洗掉。
        expect(normalizeQqCollection(normalized, 'album')).toEqual(normalized);
    });

    it('pages the favourite albums through the backend and stops on an empty page', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 200, albums: [FAVORITE_ALBUM], total: 2, more: true })
            .mockResolvedValueOnce({ code: 200, albums: [], total: 2, more: true });

        const firstPage = await qqProvider.library!.getUserAlbums!(123, 1, 0);
        expect(requestMock).toHaveBeenLastCalledWith('user_albums', { offset: 0, limit: 1 });
        expect(firstPage).toMatchObject({ total: 2, hasMore: true, nextOffset: 1 });

        // 后端说还有下一页却一条都没给：继续翻就是死循环，必须就地停住。
        const emptyPage = await qqProvider.library!.getUserAlbums!(123, 1, 1);
        expect(requestMock).toHaveBeenLastCalledWith('user_albums', { offset: 1, limit: 1 });
        expect(emptyPage).toMatchObject({ items: [], hasMore: false, nextOffset: 1 });
    });

    it('reports an empty favourite album collection as an empty page', async () => {
        requestMock.mockResolvedValue({ code: 200, albums: [], total: 0, more: false });

        await expect(qqProvider.library!.getUserAlbums!(123, 20, 0)).resolves.toMatchObject({
            items: [],
            total: 0,
            hasMore: false,
            nextOffset: 0,
        });
    });

    // 🔴 回归：微信凭据的 `musicid` 是占位的 0，把它当账号 ID 送上去，后端就会拿 `uin=0` 去查
    // GetPlaylistByUin，自建歌单整段消失，只剩走 encryptUin 的收藏歌单。
    // 会话账号本来就是这条 route 唯一读得到的账号，任何账号 ID 都不该由前端来选。
    it('never lets a client-side account id select the playlist account', async () => {
        requestMock.mockResolvedValue({ code: 200, playlist: [PLAYLIST_ITEM], total: 1, more: false });

        for (const userId of ['', 0, '0', 123]) {
            await qqProvider.library!.getUserPlaylists(userId, 50, 0);
            expect(requestMock).toHaveBeenLastCalledWith('user_playlist', {});
        }
    });

    it('short-circuits the login status without a stored session', async () => {
        transportState.hasSession = false;

        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('reads the login status and treats an expired backend session as anonymous', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 200, data: { profile: { musicid: 123, nickname: '我的 QQ 账号' } } })
            .mockResolvedValueOnce({ code: 200, data: {} })
            .mockRejectedValueOnce(new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq'));

        await expect(qqProvider.auth!.getLoginStatus()).resolves.toEqual({ id: 123, nickname: '我的 QQ 账号' });
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect(requestMock).toHaveBeenCalledWith('login_status');
    });

    it('propagates non-auth login status failures', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq'));

        await expect(qqProvider.auth!.getLoginStatus()).rejects.toMatchObject({ code: 'network' });
    });

    it('clears the local session on logout even when the backend call fails', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq'));

        await qqProvider.auth!.logout();

        expect(requestMock).toHaveBeenCalledWith('logout');
        expect(clearSessionMock).toHaveBeenCalledTimes(1);

        transportState.hasSession = false;
        requestMock.mockClear();
        await qqProvider.auth!.logout();
        expect(requestMock).not.toHaveBeenCalled();
        expect(clearSessionMock).toHaveBeenCalledTimes(2);
    });

    it('routes search and lyrics through the existing QQ modules', async () => {
        searchQQLyricsMock.mockResolvedValue([{
            id: 5105918,
            name: '海阔天空',
            artists: [{ id: 4558, name: 'Beyond' }],
            album: { id: 8112, name: '乐与怒' },
            durationMs: 326_000,
            qqMid: '003rJSwm3TechU',
        }]);
        fetchQQLyricsMock.mockResolvedValue({ lines: [], isWordByWord: true });

        const page = await qqProvider.search!.searchSongs('海阔天空', 20, 20);
        expect(searchQQLyricsMock).toHaveBeenCalledWith('海阔天空', 2, 20);
        expect(page).toMatchObject({ hasMore: false, nextOffset: 21 });
        expect(page.items[0]?.sourceRef).toMatchObject({ providerId: 'qq', mediaId: '003rJSwm3TechU' });

        // The lyric module needs the numeric song id, which only lives in provider data after normalization.
        const result = await qqProvider.lyrics!.getLyrics({ ...page.items[0], id: '003rJSwm3TechU' });
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 5105918,
            qqMid: '003rJSwm3TechU',
        }));
        expect(result).toEqual({ lyrics: { lines: [], isWordByWord: true }, isPureMusic: false });
    });

    it('resolves song detail and degrades authenticated playback quality until a URL exists', async () => {
        requestMock
            .mockResolvedValueOnce({ response: { songinfo: { data: { track_info: SEARCH_ITEM } } } })
            .mockResolvedValueOnce({ data: { playUrl: { '003rJSwm3TechU': { url: '' } } } })
            .mockResolvedValueOnce({ data: { playUrl: { '003rJSwm3TechU': { url: 'https://audio.example.test/song.mp3' } } } });

        await expect(qqProvider.playback!.getSongDetail('003rJSwm3TechU')).resolves.toMatchObject({
            qqMid: '003rJSwm3TechU',
        });
        await expect(qqProvider.playback!.getAudioSource(normalizeQqSong(SEARCH_ITEM), 'lossless')).resolves.toEqual({
            url: 'https://audio.example.test/song.mp3',
            fetchedAt: expect.any(Number),
            quality: 'high',
        });
        expect(requestMock.mock.calls).toEqual([
            ['song_info', { songmid: '003rJSwm3TechU' }],
            ['music_play', { songmid: '003rJSwm3TechU', mediaId: '001MediaMidFixture', quality: 'flac' }],
            ['music_play', { songmid: '003rJSwm3TechU', mediaId: '001MediaMidFixture', quality: '320' }],
        ]);
    });

    it('loads regular playlists normally but uses the encrypted-UIN endpoint for liked songs', async () => {
        requestMock
            .mockResolvedValueOnce({
                // 上游成功时一定带 `dissname`；不公开歌单给的空壳正是少了它（`disstid` 两种情况都会回声）。
                response: { cdlist: [{ disstid: '7', dissname: '公开歌单', songnum: 1, total_song_num: 1, songlist: [SEARCH_ITEM] }] },
            })
            .mockResolvedValue({ code: 200, songs: [SEARCH_ITEM], total: 1, more: false });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0)).resolves.toMatchObject({
            total: 1,
            hasMore: false,
            nextOffset: 1,
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
        });
        await expect(qqProvider.library!.getLikedSongIds!(123)).resolves.toEqual(['003rJSwm3TechU']);
        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0, normalizeQqCollection(PLAYLIST_ITEM))).resolves.toMatchObject({
            total: 1,
            hasMore: false,
            nextOffset: 1,
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
        });
        expect(requestMock.mock.calls).toEqual([
            ['song_list_detail', { disstid: '7' }],
            ['user_liked_songs', { offset: 0, limit: 100 }],
            ['user_liked_songs', { offset: 0, limit: 50 }],
        ]);
    });

    // 匿名这条路由会把歌单截断：上游 total_song_num 说 100 首，disssonglist 只给 2 首。
    // 若原样透传 total，卡片会写上「共 100 首」而「加载更多」点到底也翻不出来——
    // 用户只会觉得应用坏了。对不齐时以「真的拿得到」为准。
    it('never reports more songs than the anonymous route can actually return', async () => {
        requestMock.mockResolvedValueOnce({
            response: {
                cdlist: [{
                    disstid: '7',
                    dissname: '被截断的歌单',
                    songnum: 100,
                    total_song_num: 100,
                    songlist: [SEARCH_ITEM],
                }],
            },
        });

        const page = await qqProvider.catalog!.getPlaylistTracks!(7, 50, 0);

        expect(page.total).toBe(1);
        expect(page.hasMore).toBe(false);
        expect(page.nextOffset).toBe(1);
    });

    // 「歌单读不到」和「歌单是空的」必须分开，判据是 `dissname` 在不在。
    it('fails loudly when the playlist detail carries no cdlist entry', async () => {
        requestMock.mockResolvedValue({ response: { code: 0, cdlist: [] } });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0)).rejects.toMatchObject({
            code: 'invalid-response',
            message: expect.stringContaining('7'),
        });
    });

    // 🔴 旧后端 + 不公开的自建歌单，也就是这个 bug 被报上来时的处境：没有带凭据的路由可用，
    // 匿名 CGI 回 `code: 0` 加一个空壳，按长度判断完全看不出问题。空壳是 2026-09-11 用真实账号抓的：
    // `disstid` 照样回声，缺的是 `dissname`。
    it('fails loudly on the stub a non-public playlist answers with', async () => {
        requestMock
            .mockRejectedValueOnce(new OnlineProviderError('unsupported', 'QQMusicApi has no route', 'qq'))
            .mockResolvedValue({ response: { code: 0, cdlist: [{ disstid: '9777066643', songlist: [] }] } });
        const collection = normalizeQqCollection({ tid: 9777066643, dirId: 1, dirName: '新建歌单1', songNum: 3, dirShow: 2 });

        // `not-public` 而不是 `invalid-response`：协议没坏，是这条路由没资格读它。
        await expect(qqProvider.catalog!.getPlaylistTracks!(9777066643, 50, 0, collection)).rejects.toMatchObject({
            code: 'not-public',
            message: expect.stringContaining('not a public playlist'),
        });
    });

    it('still reports a genuinely empty playlist as an empty page', async () => {
        requestMock.mockResolvedValue({
            response: { code: 0, cdlist: [{ disstid: '7', dissname: '空歌单', songnum: 0, songlist: [] }] },
        });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0)).resolves.toMatchObject({
            items: [],
            total: 0,
            hasMore: false,
        });
    });

    // 自建歌单只有带凭据的路由读得到（匿名 CGI 对不公开歌单回空壳），且它支持真正的分页。
    it('reads an owned playlist through the authenticated route and forwards the real page window', async () => {
        requestMock.mockResolvedValue({ code: 200, songs: [SEARCH_ITEM], total: 8, more: true });
        const collection = normalizeQqCollection({ tid: 7, dirId: 2, dirName: '新建歌单', dirShow: 2 });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 100, collection)).resolves.toMatchObject({
            total: 8,
            hasMore: true,
            nextOffset: 101,
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
        });
        expect(requestMock).toHaveBeenCalledWith(
            'user_playlist_detail',
            { tid: '7', dirid: 2, offset: 100, limit: 50 },
        );
    });

    // 用户可以自行部署任意版本的后端，新路由在旧后端上必然 404。
    it('falls back to the anonymous route when the backend has no authenticated playlist route', async () => {
        requestMock
            .mockRejectedValueOnce(new OnlineProviderError('unsupported', 'QQMusicApi has no route', 'qq'))
            .mockResolvedValue({
                response: { code: 0, cdlist: [{ disstid: '7', dissname: '新建歌单', total_song_num: 1, songlist: [SEARCH_ITEM] }] },
            });
        const collection = normalizeQqCollection({ tid: 7, dirId: 2, dirName: '新建歌单' });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0, collection)).resolves.toMatchObject({
            total: 1,
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
        });
        expect(requestMock.mock.calls.map(call => call[0]))
            .toEqual(['user_playlist_detail', 'song_list_detail']);

        // 探到一次 404 就记住，后续页不再重试新路由。
        requestMock.mockClear();
        await qqProvider.catalog!.getPlaylistTracks!(7, 50, 0, collection);
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['song_list_detail']);
    });

    // 网络抖动不能被当成「后端不支持」，否则整个会话都会粘在匿名路径上。
    it('does not treat a transient failure as a missing route', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq'));
        const collection = normalizeQqCollection({ tid: 7, dirId: 2, dirName: '新建歌单' });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0, collection))
            .rejects.toMatchObject({ code: 'network' });
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['user_playlist_detail']);
    });

    // 🔴 收藏的他人歌单在 `/user/playlist` 里也带 `dirId`（创建者账号里的目录号），字段形状取自
    // 2026-09-11 的真实账号。带凭据的路由读它会少歌：37 首只回 36 首，total 也变成 36。
    it('keeps a favourited playlist on the anonymous route even though it carries a dirId', async () => {
        requestMock.mockResolvedValue({
            response: { code: 0, cdlist: [{ disstid: '7009600126', dissname: '毕业季：不为青春画句号', total_song_num: 37, songlist: [SEARCH_ITEM] }] },
        });
        const favourite = normalizeQqCollection({
            tid: 7009600126, dirId: 36, name: '毕业季：不为青春画句号', songnum: 37, dirShow: 1, orderTime: 1789128000, dirType: 0,
        });

        expect(favourite.providerData).not.toHaveProperty('owned');
        await qqProvider.catalog!.getPlaylistTracks!(7009600126, 50, 0, favourite);
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['song_list_detail']);
    });

    // 3.1.4 起，后端带会话时用凭据重读匿名 CGI 回 `code: 10` 的官方算法歌单，改写成同样的 `cdlist[0]`；
    // `/user/playlist` 的收藏条目也补上了 `bigpicUrl`（官方歌单是第一首歌的专辑图）。
    it('reads an official algorithmic playlist through the credential-backed song_list_detail', async () => {
        const cover = 'https://y.gtimg.cn/music/photo_new/T002R300x300M0000016l2F430zMux.jpg?max_age=2592000';
        requestMock.mockResolvedValue({
            response: {
                code: 0, subcode: 0, cdnum: 1, realcdnum: 1,
                cdlist: [{ disstid: '211111', dissname: '百万收藏', logo: cover, songnum: 50, total_song_num: 50, songlist: [SEARCH_ITEM] }],
            },
        });
        const official = normalizeQqCollection({
            tid: 211111, dirId: 0, name: '百万收藏', songnum: 50, dirShow: 1, dirType: 3, logo: '', bigpicUrl: cover, picUrl: cover,
        });

        expect(official.coverUrl).toBeTruthy();
        expect(official.providerData).not.toHaveProperty('owned');
        await expect(qqProvider.catalog!.getPlaylistTracks!(211111, 50, 0, official)).resolves.toMatchObject({
            items: [expect.objectContaining({ qqMid: '003rJSwm3TechU' })],
            // songnum 说 50，但这条应答只带回 1 首：total 以实到条数封顶（契约见
            // 'never reports more songs than the anonymous route can actually return'）。
            total: 1,
        });
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['song_list_detail']);
    });

    it('remembers that a playlist is owned when the cached collection is normalized again', () => {
        const owned = normalizeQqCollection({ tid: 7, dirId: 2, dirName: '新建歌单', songNum: 3 });
        expect(normalizeQqCollection(owned).providerData).toMatchObject({ tid: 7, dirId: 2, owned: true });
    });

    // 上游的 total 可能比实际读得到的多（被过滤掉的歌）：只看 total 的话会一直翻空页。
    it('stops paging an owned playlist on an empty page even when the total promises more', async () => {
        requestMock.mockResolvedValue({ code: 200, songs: [], total: 37, more: false });
        const collection = normalizeQqCollection({ tid: 7, dirId: 2, dirName: '新建歌单' });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 36, collection)).resolves.toMatchObject({
            items: [],
            hasMore: false,
            nextOffset: 36,
        });
    });

    // 404 只说明后端没有这条路由，不说明歌单不公开：「不是公开歌单」这句解释只能留给真正的空壳。
    it('does not blame playlist visibility for a missing anonymous route', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('unsupported', 'QQMusicApi has no song_list_detail route', 'qq'));
        const favourite = normalizeQqCollection({ tid: 7, dirId: 36, name: '收藏', dirShow: 2 });

        await expect(qqProvider.catalog!.getPlaylistTracks!(7, 50, 0, favourite)).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('normalizes album and artist collections onto mid identity and derives the cover from it', () => {
        expect(normalizeQqCollection(SINGER_ALBUM_ITEM, 'album')).toEqual({
            providerId: 'qq',
            id: '0016l2F430zMux',
            name: '乐与怒',
            type: 'album',
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T002M0000016l2F430zMux.jpg?max_age=2592000',
            trackCount: 10,
            artists: [{
                id: '0025NhlN2yWrP4',
                name: 'Beyond',
                catalogRef: { providerId: 'qq', kind: 'artist', id: '0025NhlN2yWrP4' },
            }],
            publishedAt: Date.parse('1993-05-01'),
            providerData: { albumMid: '0016l2F430zMux' },
        });
        expect(normalizeQqCollection(SINGER_INFO_ITEM, 'artist')).toEqual({
            providerId: 'qq',
            id: '0025NhlN2yWrP4',
            name: 'Beyond',
            type: 'artist',
            // 歌手头像与专辑封面同一套规则，只差 T001 / T002 前缀。
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T001M0000025NhlN2yWrP4.jpg?max_age=2592000',
            description: '香港摇滚乐队。',
            trackCount: 810,
            albumCount: 31,
            providerData: { singerMid: '0025NhlN2yWrP4' },
        });
    });

    // 歌手专辑页的条目不带歌手 mid，只有名字；这里把该端点的真实产出钉住，
    // 免得后来的人以为专辑卡片上的 artists[].id 是个可以拿去查询的 mid。
    it('normalizes a real getSingerAlbum entry even though it carries no singer mid', () => {
        expect(normalizeQqCollection(SINGER_ALBUM_ITEM_UPSTREAM, 'album')).toEqual({
            providerId: 'qq',
            id: '0016l2F430zMux',
            name: '乐与怒',
            type: 'album',
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T002M0000016l2F430zMux.jpg?max_age=2592000',
            // `totalNum` 恒为 0，不在 trackCount 的取值清单里；宁可缺字段也不要写入一个假的 0，
            // 打开专辑页时 getAlbumDetail 会用 total_song_num 补齐。
            artists: [{ id: 0, name: 'Beyond' }],
            publishedAt: Date.parse('1993-05-01'),
            providerData: { albumMid: '0016l2F430zMux' },
        });

        // 缺了歌手 mid 也必须幂等，否则专辑卡片水合一次就掉名字。
        const album = normalizeQqCollection(SINGER_ALBUM_ITEM_UPSTREAM, 'album');
        expect(normalizeQqCollection(album, album.type)).toEqual(album);
    });

    // `omni.normalizeCachedCollection` 会把已正规化的缓存再喂回来，第二遍若有损耗，
    // 曲库水合出来的就是被洗空的专辑而不是缓存里的那份。
    it('keeps album and artist collections stable when the cached copy is normalized again', () => {
        const album = normalizeQqCollection(SINGER_ALBUM_ITEM, 'album');
        const artist = normalizeQqCollection(SINGER_INFO_ITEM, 'artist');

        expect(normalizeQqCollection(album, 'album')).toEqual(album);
        expect(normalizeQqCollection(artist, 'artist')).toEqual(artist);
        // useQqLibrary 用 `collection.type` 再正规化一次，走的是同一个分支。
        expect(normalizeQqCollection(album, album.type)).toEqual(album);
        expect(normalizeQqCollection(artist, artist.type)).toEqual(artist);
        // 缓存条目也要能扛住默认的 `playlist` 类型参数。
        expect(normalizeQqCollection(album)).toEqual(album);
        expect(normalizeQqCollection(artist)).toEqual(artist);
    });

    it('merges the album detail response over the collection the caller already had', async () => {
        requestMock.mockResolvedValue(ALBUM_INFO_RESPONSE);

        await expect(qqProvider.catalog!.getAlbumDetail!('0016l2F430zMux', {
            providerId: 'qq',
            id: '0016l2F430zMux',
            name: '缓存专辑名',
            type: 'album',
            description: '缓存简介',
            trackCount: 99,
        })).resolves.toMatchObject({
            id: '0016l2F430zMux',
            name: '乐与怒',
            type: 'album',
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T002M0000016l2F430zMux.jpg?max_age=2592000',
            description: '专辑简介',
            trackCount: 3,
            publisher: '华纳音乐',
            publishedAt: Date.parse('1993-05-01'),
            artists: [{ id: '0025NhlN2yWrP4', name: 'Beyond' }],
            providerData: { albumMid: '0016l2F430zMux' },
        });
        expect(requestMock).toHaveBeenCalledWith('album_info', { albummid: '0016l2F430zMux' });

        // 上游给空响应时不能把调用方已经显示的内容洗掉。
        requestMock.mockResolvedValue({ response: { code: 0 } });
        await expect(qqProvider.catalog!.getAlbumDetail!('0016l2F430zMux', {
            providerId: 'qq',
            id: '0016l2F430zMux',
            name: '缓存专辑名',
            type: 'album',
        })).resolves.toMatchObject({ name: '缓存专辑名' });
        await expect(qqProvider.catalog!.getAlbumDetail!('0016l2F430zMux')).resolves.toBeNull();
    });

    it('pages the album track list locally because the upstream returns every track at once', async () => {
        requestMock.mockResolvedValue(ALBUM_INFO_RESPONSE);

        const firstPage = await qqProvider.catalog!.getAlbumTracks!('0016l2F430zMux', 2, 0);
        expect(firstPage.items.map(song => song.name)).toEqual(['海阔天空', '爸爸妈妈']);
        expect(firstPage).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });

        const secondPage = await qqProvider.catalog!.getAlbumTracks!('0016l2F430zMux', 2, 2);
        expect(secondPage.items.map(song => song.name)).toEqual(['情人']);
        expect(secondPage).toMatchObject({ total: 3, hasMore: false, nextOffset: 3 });
        // 曲目条目不带专辑名，由专辑本身补齐。
        expect(secondPage.items[0]?.album.name).toBe('乐与怒');

        const pastEnd = await qqProvider.catalog!.getAlbumTracks!('0016l2F430zMux', 2, 4);
        expect(pastEnd).toMatchObject({ items: [], hasMore: false, nextOffset: 4 });
        expect(requestMock.mock.calls).toEqual([
            ['album_info', { albummid: '0016l2F430zMux' }],
            ['album_info', { albummid: '0016l2F430zMux' }],
            ['album_info', { albummid: '0016l2F430zMux' }],
        ]);
    });

    // `/getSingerHotsong` 把 `page` 读成从 1 起算的页码，再换算成 `sin = (page - 1) * num`。
    it('converts the artist song offset into a 1-based page number', async () => {
        requestMock.mockResolvedValue({
            response: {
                code: 0,
                singer: { code: 0, data: { songlist: [SEARCH_ITEM], singer_info: SINGER_INFO_BLOCK, total_song: 810 } },
            },
        });

        const page = await qqProvider.catalog!.getArtistSongs!('0025NhlN2yWrP4', 20, 0);
        expect(page.items[0]).toMatchObject({ qqMid: '003rJSwm3TechU' });
        expect(page).toMatchObject({ total: 810, hasMore: true, nextOffset: 1 });

        await qqProvider.catalog!.getArtistSongs!('0025NhlN2yWrP4', 20, 40);
        await qqProvider.catalog!.getArtistSongs!('0025NhlN2yWrP4', 20, 55);
        expect(requestMock.mock.calls).toEqual([
            ['artist_songs', { singermid: '0025NhlN2yWrP4', limit: 20, page: 1 }],
            ['artist_songs', { singermid: '0025NhlN2yWrP4', limit: 20, page: 3 }],
            ['artist_songs', { singermid: '0025NhlN2yWrP4', limit: 20, page: 3 }],
        ]);
    });

    // `/getSingerAlbum` 的参数同样叫 `page`，但它是原样当 `begin` 交给上游的，
    // 所以同名参数这里必须传行偏移量而不是页码。
    it('forwards the artist album offset unchanged because `page` is really a begin offset', async () => {
        requestMock.mockResolvedValue({
            response: {
                code: 0,
                singer: { code: 0, data: { albumList: [SINGER_ALBUM_ITEM, { albumName: '无 mid 的条目' }], total: 31 } },
            },
        });

        const page = await qqProvider.catalog!.getArtistAlbums!('0025NhlN2yWrP4', 20, 0);
        // 没有 mid 的专辑没有可用的识别键，直接丢弃而不是渲染出来。
        expect(page.items).toEqual([normalizeQqCollection(SINGER_ALBUM_ITEM, 'album')]);
        expect(page).toMatchObject({ total: 31, hasMore: true, nextOffset: 2 });

        await qqProvider.catalog!.getArtistAlbums!('0025NhlN2yWrP4', 20, 40);
        await qqProvider.catalog!.getArtistAlbums!('0025NhlN2yWrP4', 20, 55);
        expect(requestMock.mock.calls).toEqual([
            ['artist_albums', { singermid: '0025NhlN2yWrP4', limit: 20, page: 0 }],
            ['artist_albums', { singermid: '0025NhlN2yWrP4', limit: 20, page: 40 }],
            ['artist_albums', { singermid: '0025NhlN2yWrP4', limit: 20, page: 55 }],
        ]);
    });

    it('reuses the singer detail route for artist metadata and derives the avatar from the mid', async () => {
        requestMock.mockResolvedValue({
            response: {
                singer: {
                    code: 0,
                    data: {
                        songlist: [SEARCH_ITEM],
                        singer_info: SINGER_INFO_BLOCK,
                        singer_brief: '香港摇滚乐队。',
                        total_song: 810,
                        total_album: 31,
                    },
                },
            },
        });

        await expect(qqProvider.catalog!.getArtistDetail!('0025NhlN2yWrP4')).resolves.toEqual({
            providerId: 'qq',
            id: '0025NhlN2yWrP4',
            name: 'Beyond',
            type: 'artist',
            coverUrl: 'https://y.gtimg.cn/music/photo_new/T001M0000025NhlN2yWrP4.jpg?max_age=2592000',
            description: '香港摇滚乐队。',
            trackCount: 810,
            albumCount: 31,
            providerData: { singerMid: '0025NhlN2yWrP4' },
        });
        // 详情不需要曲目，所以只取一首把响应压到最小；page 与 getArtistSongs 一样是从 1 起算。
        expect(requestMock).toHaveBeenCalledWith('artist_songs', { singermid: '0025NhlN2yWrP4', limit: 1, page: 1 });

        // 没有 mid 就没有可以向后端查询的对象。
        requestMock.mockClear();
        await expect(qqProvider.catalog!.getArtistDetail!('')).resolves.toBeNull();
        expect(requestMock).not.toHaveBeenCalled();
    });

    // 人工验收时专辑页与歌手页都是空的：请求发的是 `albummid=88971` / `singermid=4286`，
    // 那是数字 album id 与 singer id。搜索复用的歌词搜索接口只带出数字 id，mid 在那一层就丢了，
    // 所以点击时必须先补一次 `/getSongInfo` 才拿得到 mid。
    describe('catalog id resolution', () => {
        // 真实 `searchQQLyrics` 的产出形状：数字 id 齐全，一个 mid 都没有。
        const SEARCH_RESULT_WITHOUT_MIDS = {
            id: 5105918,
            name: '海阔天空',
            artists: [{ id: 4286, name: 'Beyond' }],
            album: { id: 88971, name: '乐与怒' },
            durationMs: 326_000,
            qqMid: '003rJSwm3TechU',
        };

        const trackInfoResponse = {
            response: { songinfo: { data: { track_info: SEARCH_ITEM } } },
        };

        it('trades the numeric album and singer ids for mids before navigation', async () => {
            requestMock.mockResolvedValue(trackInfoResponse);

            const song = normalizeQqSong(SEARCH_RESULT_WITHOUT_MIDS);
            // 正规化救不回丢掉的 mid，只能保证数字 id 不会被当成可导航的身份。
            expect(song.album.catalogRef).toBeUndefined();
            expect(song.artists[0]?.catalogRef).toBeUndefined();

            const resolved = await qqProvider.catalog!.resolveSongCatalogRefs!(song);

            expect(requestMock).toHaveBeenCalledWith('song_info', { songmid: '003rJSwm3TechU' });
            expect(resolved.album).toMatchObject({
                id: '0016l2F430zMux',
                catalogRef: { providerId: 'qq', kind: 'album', id: '0016l2F430zMux' },
            });
            expect(resolved.artists).toEqual([{
                id: '0025NhlN2yWrP4',
                name: 'Beyond',
                catalogRef: { providerId: 'qq', kind: 'artist', id: '0025NhlN2yWrP4' },
            }]);
            // 数字 id 一个都不许留在身份位上——它们正是 1101 para error 的来源。
            expect(resolved.album.id).not.toBe(88971);
            expect(resolved.artists[0]?.id).not.toBe(4286);
        });

        it('sends the mid, never the numeric id, to every catalog endpoint', async () => {
            requestMock.mockResolvedValue(trackInfoResponse);
            const resolved = await qqProvider.catalog!.resolveSongCatalogRefs!(
                normalizeQqSong(SEARCH_RESULT_WITHOUT_MIDS),
            );
            const albumId = resolved.album.catalogRef!.id;
            const artistId = resolved.artists[0]!.catalogRef!.id;

            requestMock.mockReset();
            requestMock.mockResolvedValue({
                response: {
                    code: 0,
                    data: { mid: '0016l2F430zMux', name: '乐与怒', list: [] },
                    singer: { data: { songlist: [], albumList: [], singer_info: SINGER_INFO_BLOCK } },
                },
            });

            await qqProvider.catalog!.getAlbumDetail!(albumId);
            await qqProvider.catalog!.getAlbumTracks!(albumId, 10, 0);
            await qqProvider.catalog!.getArtistDetail!(artistId);
            await qqProvider.catalog!.getArtistSongs!(artistId, 20, 0);
            await qqProvider.catalog!.getArtistAlbums!(artistId, 20, 0);

            expect(requestMock.mock.calls).toEqual([
                ['album_info', { albummid: '0016l2F430zMux' }],
                ['album_info', { albummid: '0016l2F430zMux' }],
                ['artist_songs', { singermid: '0025NhlN2yWrP4', limit: 1, page: 1 }],
                ['artist_songs', { singermid: '0025NhlN2yWrP4', limit: 20, page: 1 }],
                ['artist_albums', { singermid: '0025NhlN2yWrP4', limit: 20, page: 0 }],
            ]);
            requestMock.mock.calls.forEach(([, params]) => {
                const sent = String((params as any).albummid ?? (params as any).singermid);
                expect(sent).not.toMatch(/^\d+$/);
            });
        });

        it('skips the extra request when the mids already survived normalization', async () => {
            const song = normalizeQqSong(SEARCH_ITEM);
            await expect(qqProvider.catalog!.resolveSongCatalogRefs!(song)).resolves.toBe(song);
            expect(requestMock).not.toHaveBeenCalled();
        });

        it('resolves album and artist through a single shared song_info request', async () => {
            requestMock.mockResolvedValue(trackInfoResponse);
            const song = normalizeQqSong(SEARCH_RESULT_WITHOUT_MIDS);

            await Promise.all([
                qqProvider.catalog!.resolveSongCatalogRefs!(song),
                qqProvider.catalog!.resolveSongCatalogRefs!(song),
            ]);

            expect(requestMock).toHaveBeenCalledTimes(1);
        });

        it('leaves the song untouched when the detail lookup yields nothing', async () => {
            requestMock.mockResolvedValue({ response: { songinfo: { data: {} } } });
            const song = normalizeQqSong(SEARCH_RESULT_WITHOUT_MIDS);

            await expect(qqProvider.catalog!.resolveSongCatalogRefs!(song)).resolves.toBe(song);
        });

        // 拿不到 QQ 的歌曲标识就没有可查的对象，UI 据此不把专辑 / 歌手显示成可点击的。
        it('reports whether a song carries a QQ identity to resolve from', () => {
            expect(qqProvider.catalog!.canResolveSongCatalogRefs!(normalizeQqSong(SEARCH_ITEM))).toBe(true);

            const localSong = {
                ...normalizeQqSong(SEARCH_ITEM),
                qqMid: undefined,
                sourceRef: { kind: 'local' as const, mediaId: 'file-1' },
            };
            expect(qqProvider.catalog!.canResolveSongCatalogRefs!(localSong)).toBe(false);
        });
    });

    it('declares the playback, catalog, and likes capabilities for the QQ provider', () => {
        expect(qqProvider.capabilities).toMatchObject({
            search: true,
            lyrics: true,
            auth: true,
            userLibrary: true,
            playlists: true,
            albums: true,
            artists: true,
            wordByWordLyrics: true,
            playback: true,
            likes: true,
            mutations: true,
            playlistTrackMutations: true,
        });
        expect(qqProvider.playback).toBeDefined();
        expect(qqProvider.catalog?.getPlaylistTracks).toBeTypeOf('function');
        expect(qqProvider.catalog?.getAlbumDetail).toBeTypeOf('function');
        expect(qqProvider.catalog?.getAlbumTracks).toBeTypeOf('function');
        expect(qqProvider.catalog?.getArtistDetail).toBeTypeOf('function');
        expect(qqProvider.catalog?.getArtistSongs).toBeTypeOf('function');
        expect(qqProvider.catalog?.getArtistAlbums).toBeTypeOf('function');
        expect(qqProvider.library?.getLikedSongIds).toBeTypeOf('function');
        // 后端 2.2.0 起有 `/user/albums`，收藏专辑不再是空页。
        expect(qqProvider.library?.getUserAlbums).toBeTypeOf('function');
        expect(qqProvider.getAvailability?.()).toEqual({ configured: true });
    });

    // 删歌必须把 operation=del 传给后端。后端 recommend 控制器是
    // `operation === 'del' ? del : add`——缺省就是加。这里曾经写成
    // `operation === 'add' ? 'playlist_songs' : 'playlist_songs'`（两个分支一样），
    // 用户删一首歌会被加回去，界面表现是「删不掉、越删越多」。
    it('sends operation=add and operation=del to the QQ playlist write route', async () => {
        requestMock.mockImplementation(async () => ({ code: 200 }));
        const playlist = {
            id: '202',
            providerData: { owned: true, dirId: 202 },
        } as never;

        await qqProvider.mutations?.updatePlaylistTracks?.('add', playlist, [5105918]);
        expect(requestMock).toHaveBeenLastCalledWith('playlist_songs', {
            dirid: '202',
            songids: '5105918',
            operation: 'add',
        });

        await qqProvider.mutations?.updatePlaylistTracks?.('del', playlist, [5105918]);
        expect(requestMock).toHaveBeenLastCalledWith('playlist_songs', {
            dirid: '202',
            songids: '5105918',
            operation: 'del',
        });
    });
});
