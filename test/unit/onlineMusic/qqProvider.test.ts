import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqProvider.test.ts

const requestMock = vi.hoisted(() => vi.fn());
const musicuMock = vi.hoisted(() => vi.fn());
const clearSessionMock = vi.hoisted(() => vi.fn());
const writeSessionValueMock = vi.hoisted(() => vi.fn());
const searchQQSongsMock = vi.hoisted(() => vi.fn());
const fetchQQLyricsMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true, parked: false }));

vi.mock('@/services/onlineMusic/qq/qqTransport', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/qq/qqTransport')>(),
    getQqTransportAvailability: () => ({ configured: true }),
    getQqRemoteApiBase: () => 'https://qq.example.test',
    hasQqSession: () => transportState.hasSession,
    hasUsableQqSession: () => transportState.hasSession,
    isQqSessionParked: async () => transportState.parked,
    clearQqSession: clearSessionMock,
    requestQq: requestMock,
    requestQqMusicu: musicuMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    writeProviderSessionValue: writeSessionValueMock,
}));

// 登录确认后的续期在后台接着问后端（qqSessionRefresh.ts，有它自己的测试）；这里不让它占 requestMock 排好的回答。
vi.mock('@/services/onlineMusic/qq/qqSessionRefresh', () => ({
    keepQqSessionFresh: () => { },
    stopQqSessionRefresh: () => { },
    resetQqSessionRefresh: () => { },
}));

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({
    searchQQSongs: searchQQSongsMock,
    fetchQQLyrics: fetchQQLyricsMock,
}));

import { qqProvider, resetQqProviderRuntimeCache } from '@/services/onlineMusic/qq/qqProvider';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from '@/services/onlineMusic/qq/qqNormalize';
import { describeQqFailure } from '@/services/onlineMusic/qq/qqFailure';
import { QQ_API_BASE_MISSING, QQ_ONLINE_REQUEST_LIMIT_MS } from '@/services/onlineMusic/qq/qqTransport';
import { OnlineRequestTimeout } from '@/services/onlineMusic/failure/onlineRequestLimit';
import { autoRetryDelaysMs, onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
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
        musicuMock.mockReset();
        clearSessionMock.mockReset();
        writeSessionValueMock.mockReset();
        searchQQSongsMock.mockReset();
        fetchQQLyricsMock.mockReset();
        transportState.hasSession = true;
        resetQqProviderRuntimeCache();
    });

    // 3.3.0 开放了推荐、歌单增删与收藏歌单，3.3.1 补上红心与收藏专辑；不喜欢与历史日推后端还没有，不能冒出来。
    it('declares the 3.3.1 recommendations and mutations without the ones the backend lacks', () => {
        expect(qqProvider.capabilities).toMatchObject({
            userLibrary: true,
            playlists: true,
            userAlbums: true,
            likes: true,
            recommendations: true,
            mutations: true,
            playlistTrackMutations: true,
            playlistSubscription: true,
        });
        expect(qqProvider.capabilities.personalFmModes).toBeFalsy();
        expect(qqProvider.capabilities.historyRecommendations).toBeFalsy();
        expect(Object.keys(qqProvider.recommendations ?? {}).sort()).toEqual(['getDailySongs', 'getPersonalFm', 'getRecommendedCollections']);
        expect(Object.keys(qqProvider.mutations ?? {}).sort()).toEqual([
            'canAddToPlaylist', 'canEditPlaylistTracks', 'canSubscribe', 'createPlaylist', 'likeSong', 'subscribeAlbum', 'subscribePlaylist',
            'updatePlaylistTracks',
        ]);
        expect(qqProvider.catalog?.getSubscriptionStatus).toBeTypeOf('function');
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

    it('keeps the owned playlist update time in milliseconds across account cache hydration', () => {
        const collection = normalizeQqCollection({ ...PLAYLIST_ITEM, updateTime: 1792948021 });
        expect(collection.updatedAt).toBe(1792948021000);
        expect(normalizeQqCollection(collection)).toEqual(collection);
        expect(normalizeQqCollection({ ...PLAYLIST_ITEM, updatedAt: 1792948021000, updateTime: 1 }).updatedAt)
            .toBe(1792948021000);
        expect(normalizeQqCollection({ tid: 8, dirId: 1, dirName: '自建歌单', songNum: 0, updateTime: '1792948025' }).updatedAt)
            .toBe(1792948025000);
    });

    it('does not treat an empty liked folder or a favourite ordering time as a collection version', () => {
        expect(normalizeQqCollection({ ...PLAYLIST_ITEM, songNum: 0, updateTime: 1792948021 }).updatedAt).toBeUndefined();
        expect(normalizeQqCollection({ ...PLAYLIST_ITEM, songNum: 0, updatedAt: 1792948021000 }).updatedAt).toBeUndefined();
        expect(normalizeQqCollection({ tid: 9, name: '收藏歌单', songnum: 3, orderTime: 1792948021 }).updatedAt).toBeUndefined();
        for (const updateTime of [undefined, null, '', 0, -1, 'invalid', Infinity]) {
            expect(normalizeQqCollection({ ...PLAYLIST_ITEM, updateTime }).updatedAt).toBeUndefined();
        }
    });

    it('normalizes the playlist and profile payloads, including a profile without a display name', () => {
        expect(normalizeQqCollection(PLAYLIST_ITEM)).toEqual({
            providerId: 'qq',
            id: 7,
            name: '我喜欢',
            type: 'playlist',
            coverUrl: 'https://img.example.test/big.jpg',
            trackCount: 2,
            isOwned: true,
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

        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'waiting' });
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'scanned' });
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'confirmed' });
        // 自然过期：不带失败字段的 800，或 failureReason=qr-timeout；后端要等多久再给码一并交出。
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'expired' });
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'expired', failure: { retryAfterMs: 30000 } });
        // An upstream rejection is not an expired code. The safety number is handed on as a fact for
        // the sign-in dialog, still unnamed, with the wait the upstream asked for.
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'code 800: QR login failed',
            failure: { case: 'retry-later', code: '800', message: 'QR login failed', upstreamCode: '50006', retryAfterMs: 31000 },
        });

        expect(requestMock).toHaveBeenCalledWith('login_qr_check', { key: 'qr-key' });
        expect(writeSessionValueMock).toHaveBeenCalledExactlyOnceWith('qq', 'cookie', 'qqmusic_session=opaque-token');
    });

    // 3.1.3 起后端用 failureReason 说停在哪里：手机上取消、在那里拒绝，都是这一边结束了这个码。
    it('reads a login canceled or turned down on the phone as the code ending, with the backend\'s wait', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 800, message: 'QR code expired', failureStage: 'qr-event', failureReason: 'user-canceled', retryAfterMs: 30000 })
            .mockResolvedValueOnce({ code: 800, message: 'QR code expired', failureStage: 'qr-event', failureReason: 'login-rejected', retryAfterMs: 30000 });

        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'expired', failure: { retryAfterMs: 30000 } });
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({ state: 'expired', failure: { retryAfterMs: 30000 } });
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
            await qqProvider.auth!.startLogin!();
        };
        // The case the check hands the sign-in window.
        const caseOfCheck = async () => {
            const checked = await qqProvider.auth!.checkLogin!('qr-key');
            return checked.state === 'error' ? checked.failure?.case : undefined;
        };

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        // 微信通道的凭据交换没有回退：20279 直接在响应上。
        it('reads the device limit straight off the response', async () => {
            requestMock.mockResolvedValueOnce({ ...validationFailure, failureStage: 'credential-exchange', upstreamCode: 20279 });
            expect(await caseOfCheck()).toBe('device-limit');
        });

        // QQ 通道：响应里只剩验证那一步的 1000，20279 在主进程记下的本轮凭据交换里。
        it('finds the device limit in this round\'s credential exchange on desktop', async () => {
            await requestKey();
            const getLoginDiagnostics = stubDesktop([exchangeResult(Date.now() + 1000, 20279)]);
            requestMock.mockResolvedValueOnce(validationFailure);

            expect(await caseOfCheck()).toBe('device-limit');
            expect(getLoginDiagnostics).toHaveBeenCalledWith('qq');
        });

        it('ignores an exchange from an earlier round and a different exchange code', async () => {
            await requestKey();
            stubDesktop([exchangeResult(1, 20279)]);
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await caseOfCheck()).not.toBe('device-limit');

            stubDesktop([exchangeResult(Date.now() + 1000, 20279), exchangeResult(Date.now() + 2000, 50006)]);
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await caseOfCheck()).not.toBe('device-limit');
        });

        // 3.3.0：QQ 通道被再验证盖掉的换凭证结果在 primaryFailure 里，网页版也认得出来，不必问主进程。
        it('reads the device limit out of primaryFailure without asking the desktop', async () => {
            const getLoginDiagnostics = stubDesktop([]);
            requestMock.mockResolvedValueOnce({
                ...validationFailure,
                fallbackAttempted: true,
                primaryFailure: { failureStage: 'credential-exchange', failureReason: 'upstream-rejected', upstreamCode: 20279, upstreamErrorKey: 'auth.device-limit' },
            });

            expect(await caseOfCheck()).toBe('device-limit');
            expect(getLoginDiagnostics).not.toHaveBeenCalled();
        });

        // 登记过的错误键与上游码等价：后端只在通道、步骤、码都对得上时才给。
        it('takes the registered error key as the device limit', async () => {
            requestMock.mockResolvedValueOnce({ ...validationFailure, failureStage: 'credential-exchange', upstreamCode: undefined, upstreamErrorKey: 'auth.device-limit' });
            expect(await caseOfCheck()).toBe('device-limit');

            requestMock.mockResolvedValueOnce({
                ...validationFailure,
                primaryFailure: { failureStage: 'credential-exchange', upstreamCode: 50006 },
                failureHint: { key: 'login.wrong-scan-app', message: 'Use mobile QQ to scan' },
            });
            expect(await caseOfCheck()).not.toBe('device-limit');
        });

        // 网页版没有主进程可问；取快照失败也只是少了这条提示。
        it('falls back to a plain failure without a desktop snapshot', async () => {
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await caseOfCheck()).not.toBe('device-limit');

            vi.stubGlobal('window', { electron: { getLoginDiagnostics: vi.fn().mockRejectedValue(new Error('ipc closed')) } });
            requestMock.mockResolvedValueOnce(validationFailure);
            expect(await caseOfCheck()).not.toBe('device-limit');
        });
    });

    it('says where the backend stopped in the line it logs, also for stages and reasons it does not know yet', async () => {
        requestMock.mockResolvedValueOnce({
            code: 800,
            message: 'QR login failed',
            failureStage: 'some-future-stage',
            failureReason: 'some-future-reason',
            upstreamHttpStatus: 503,
            retryAfterMs: 30000,
            failureHint: { key: 'login.some-future-hint', message: 'Something new' },
        });

        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toMatchObject({
            state: 'error',
            message: 'code 800: QR login failed (stage some-future-stage, reason some-future-reason)',
            failure: { code: '800', message: 'QR login failed', retryAfterMs: 30000 },
        });
    });

    it('reports a failed session without a cooldown, and an unexpected code, as errors rather than expiry', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 800, message: 'QR login failed', failureStage: 'credential-exchange' })
            .mockResolvedValueOnce({ code: 500, message: 'Internal Server Error' });

        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toMatchObject({
            state: 'error',
            message: 'code 800: QR login failed (stage credential-exchange, reason unknown)',
        });
        await expect(qqProvider.auth!.checkLogin!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'code 500: Internal Server Error',
            failure: { code: '500', message: 'Internal Server Error' },
        });
    });

    it('asks for the QR with the chosen channel and fails instead of handing out an empty key or image', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, data: { unikey: 'qr-key' } });
        await expect(qqProvider.auth!.startLogin!('wechat')).resolves.toBe('qr-key');
        expect(requestMock).toHaveBeenLastCalledWith('login_qr_key', { channel: 'wechat' });

        requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        await expect(qqProvider.auth!.startLogin!('qq')).rejects.toMatchObject({
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
        const error = new OnlineProviderError('network', 'QQMusicApi request failed: 429', 'qq', body, 429, 30000);
        requestMock.mockRejectedValueOnce(error);

        await expect(qqProvider.auth!.startLogin!('qq')).rejects.toBe(error);
    });

    it('keeps the QR code for the lifetime QQ gives it', () => {
        expect(qqProvider.auth!.getLoginTtlMs!()).toBe(175_000);
    });

    it('describes its side of the session and the last account check for the report', async () => {
        const texts = async () => (await qqProvider.auth!.getLoginDiagnostics!()).map(line => line.text);
        expect(await texts()).toEqual([
            'session: backend session stored=yes',
            'login channels: not declared by the backend',
            'last account check: none',
            'login methods shown: qq, wechat',
        ]);

        transportState.hasSession = false;
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect((await texts())[2]).toMatch(/^last account check: \d\d:\d\d:\d\d\.\d{3} no backend session stored$/);
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

        expect((await qqProvider.auth!.getLoginDiagnostics!())[2].text).toContain(expected);
    });

    it('cancels one QR session by key and never lets the failure reach the caller', async () => {
        requestMock.mockResolvedValueOnce({ code: 200 });
        await expect(qqProvider.auth!.cancelLogin!('qr-key')).resolves.toBeUndefined();
        expect(requestMock).toHaveBeenCalledExactlyOnceWith('login_qr_cancel', { key: 'qr-key' });

        // 调用方在关窗时 fire-and-forget，抛出去只会让 UI 卡在一个用户无从处理的错误上。
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 503', 'qq'));
        await expect(qqProvider.auth!.cancelLogin!('qr-key')).resolves.toBeUndefined();
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

    // 主进程这次没读出加密的登录仓库：后端里没有会话，不认这个 session 不等于登出，session 要留着。
    it('reports the login status as unavailable, not anonymous, while the sign-in store could not be read', async () => {
        transportState.parked = true;
        try {
            requestMock
                .mockResolvedValueOnce({ code: 200, data: {} })
                .mockRejectedValueOnce(new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq'));

            await expect(qqProvider.auth!.getLoginStatus()).rejects.toMatchObject({ code: 'unavailable' });
            await expect(qqProvider.auth!.getLoginStatus()).rejects.toMatchObject({ code: 'unavailable' });
            expect(clearSessionMock).not.toHaveBeenCalled();
        } finally {
            transportState.parked = false;
        }
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

    // 网页上的单曲页按 songmid 定位，与网易云的 `getSongPageUrl` 同一份契约：拿不到 songmid 就不给链接。
    it('links a song to its QQ Music web page by songmid', () => {
        expect(qqProvider.getSongPageUrl?.(normalizeQqSong(SEARCH_ITEM))).toBe('https://y.qq.com/n/ryqq/songDetail/003rJSwm3TechU');
        expect(qqProvider.getSongPageUrl?.(normalizeQqSong({ ...SEARCH_ITEM, mid: '' }))).toBeNull();
    });

    it('routes search and lyrics through the existing QQ modules', async () => {
        // 没有会话时搜索走匿名直连；带会话的路径见 qqSearch.test.ts。
        transportState.hasSession = false;
        searchQQSongsMock.mockResolvedValue([{
            id: 5105918,
            name: '海阔天空',
            artists: [{ id: 4558, name: 'Beyond' }],
            album: { id: 8112, name: '乐与怒' },
            durationMs: 326_000,
            qqMid: '003rJSwm3TechU',
        }]);
        fetchQQLyricsMock.mockResolvedValue({ lines: [], isWordByWord: true });

        const page = await qqProvider.search!.searchSongs('海阔天空', 20, 20);
        expect(searchQQSongsMock).toHaveBeenCalledWith('海阔天空', 2, 20);
        expect(requestMock).not.toHaveBeenCalled();
        expect(page).toMatchObject({ hasMore: false, nextOffset: 40 });
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

    // A song's UnifiedSong.id is its numeric songid (normalizeQqSong), which `/getSongInfo` on upstream 3.3.3
    // cannot look up: it hands QQ the songid as a string and gets an empty shell back. So a numeric songid goes
    // to musicu directly (`requestQqMusicu`), as a JSON number; a single songmid still goes through the backend.
    describe('song detail by id', () => {
        const SUNNY_TRACK = {
            id: 97773,
            mid: '0039MnYb0qxYhV',
            name: '晴天',
            title: '晴天',
            singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
            album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
            file: { media_mid: '0039MnYb0qxYhV' },
            interval: 269,
        };
        const EMPTY_TRACK = { id: 0, mid: '', name: '' };
        type Param = { song_type: number; song_id?: unknown; song_mid?: unknown };
        type Requests = Record<string, { module: string; method: string; param: Param }>;
        const TRACKS_BY_ID = new Map<unknown, unknown>([[97773, SUNNY_TRACK], [5105918, SEARCH_ITEM], [2147483647, SUNNY_TRACK]]);
        const TRACKS_BY_MID = new Map<unknown, unknown>([['0039MnYb0qxYhV', SUNNY_TRACK], ['003rJSwm3TechU', SEARCH_ITEM]]);
        // musicu as QQ answers it: a known song, an empty shell for a songid it has no song by (code 0) and for a
        // songmid it does not know (code 404).
        const answerOf = ({ song_id: songId, song_mid: songMid }: Param) => {
            if (songMid !== undefined) {
                const track = TRACKS_BY_MID.get(songMid);
                return track ? { code: 0, data: { track_info: track } } : { code: 404, data: { track_info: EMPTY_TRACK } };
            }
            return { code: 0, data: { track_info: TRACKS_BY_ID.get(songId) ?? EMPTY_TRACK } };
        };
        const answersOf = (requests: Requests) => Object.fromEntries(
            Object.entries(requests).map(([key, request]) => [key, answerOf(request.param)]),
        );
        const sentRequests = (call: number): Requests[string][] => Object.values(musicuMock.mock.calls[call][0] as Requests);
        const flush = () => new Promise(resolve => setTimeout(resolve, 0));

        beforeEach(() => {
            musicuMock.mockImplementation(async (requests: Requests) => answersOf(requests));
        });

        it('looks a numeric songid up at musicu as a JSON number, not through the backend', async () => {
            for (const id of ['97773', 97773, ' 5105918 ']) {
                musicuMock.mockClear();
                const song = await qqProvider.playback!.getSongDetail(id);
                expect(musicuMock).toHaveBeenCalledTimes(1);
                const [request] = sentRequests(0);
                expect(sentRequests(0)).toHaveLength(1);
                expect(request).toMatchObject({ module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_type: 0 } });
                expect(typeof request.param.song_id).toBe('number');
                expect(request.param.song_id).toBe(Number(String(id).trim()));
                expect(request.param).not.toHaveProperty('song_mid');
                expect(song).toMatchObject(String(id).trim() === '97773'
                    ? { id: 97773, qqMid: '0039MnYb0qxYhV', name: '晴天' }
                    : { id: 5105918, qqMid: '003rJSwm3TechU' });
            }
            expect(requestMock).not.toHaveBeenCalled();
        });

        it('still looks a single songmid up through the backend', async () => {
            requestMock.mockResolvedValueOnce({ response: { songinfo: { data: { track_info: SEARCH_ITEM } } } });
            await expect(qqProvider.playback!.getSongDetail('003rJSwm3TechU')).resolves.toMatchObject({ qqMid: '003rJSwm3TechU' });
            // A songmid QQ answers with an empty shell is still none.
            requestMock.mockResolvedValueOnce({ response: { songinfo: { data: { track_info: { mid: '', id: 0, name: '' } } } } });
            await expect(qqProvider.playback!.getSongDetail('0039MnYb0qxYhX')).resolves.toBeNull();
            expect(requestMock.mock.calls).toEqual([
                ['song_info', { songmid: '003rJSwm3TechU' }],
                ['song_info', { songmid: '0039MnYb0qxYhX' }],
            ]);
            expect(musicuMock).not.toHaveBeenCalled();
        });

        it('normalizes the same track the same, by songmid through the backend and by songid at musicu', async () => {
            requestMock.mockResolvedValueOnce({ response: { songinfo: { data: { track_info: SEARCH_ITEM } } } });
            const bySongmid = await qqProvider.playback!.getSongDetail('003rJSwm3TechU');
            const bySongid = await qqProvider.playback!.getSongDetail(5105918);

            expect(bySongid).toEqual(bySongmid);
            expect(bySongid).toEqual(normalizeQqSong(SEARCH_ITEM));
        });

        it('answers null for an empty shell with code 0 or 404, and rejects any other code', async () => {
            musicuMock.mockResolvedValueOnce({ q0: { code: 0, data: { track_info: EMPTY_TRACK } } });
            await expect(qqProvider.playback!.getSongDetail(2000000000)).resolves.toBeNull();
            musicuMock.mockResolvedValueOnce({ q0: { code: 404, data: { track_info: EMPTY_TRACK } } });
            await expect(qqProvider.playback!.getSongDetail(2000000001)).resolves.toBeNull();
            musicuMock.mockResolvedValueOnce({ q0: { code: 500, data: undefined } });
            await expect(qqProvider.playback!.getSongDetail(97773)).rejects.toMatchObject({
                code: 'invalid-response',
                providerId: 'qq',
                cause: { id: '97773', code: 500 },
            });
            musicuMock.mockResolvedValueOnce({ q0: { code: undefined, data: undefined } });
            await expect(qqProvider.playback!.getSongDetail(97773)).rejects.toMatchObject({ code: 'invalid-response' });
        });

        it('sends an id that is no int32 songid to the backend as a songmid on the single path', async () => {
            requestMock.mockResolvedValue({ response: { songinfo: { data: { track_info: { mid: '', id: 0, name: '' } } } } });
            for (const id of ['2147483648', '0123', '0039MnYb0qxYhV']) {
                await expect(qqProvider.playback!.getSongDetail(id)).resolves.toBeNull();
            }
            expect(requestMock.mock.calls).toEqual([
                ['song_info', { songmid: '2147483648' }],
                ['song_info', { songmid: '0123' }],
                ['song_info', { songmid: '0039MnYb0qxYhV' }],
            ]);
            expect(musicuMock).not.toHaveBeenCalled();

            await expect(qqProvider.playback!.getSongDetail('2147483647')).resolves.toMatchObject({ qqMid: '0039MnYb0qxYhV' });
            expect(sentRequests(0)[0].param.song_id).toBe(2147483647);
            expect(requestMock).toHaveBeenCalledTimes(3);
        });

        it('declares songs by id in groups of 25', () => {
            expect(qqProvider.playback?.getSongDetails).toBeTypeOf('function');
            expect(qqProvider.playback?.songDetailsPerRequest).toBe(25);
        });

        it('looks 25 mixed ids up in one musicu request, songids as numbers and songmids by song_mid', async () => {
            const ids = Array.from({ length: 25 }, (_, index) => (
                index % 5 === 0 ? '0039MnYb0qxYhV' : index % 5 === 1 ? '003rJSwm3TechU' : index % 5 === 2 ? 97773 : index % 5 === 3 ? '5105918' : 2000000000 + index
            ));
            const songs = await qqProvider.playback!.getSongDetails!(ids);

            expect(musicuMock).toHaveBeenCalledTimes(1);
            const requests = sentRequests(0);
            expect(requests).toHaveLength(25);
            requests.forEach((request, index) => {
                expect(request).toMatchObject({ module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq' });
                const id = ids[index];
                if (typeof id === 'string' && id.startsWith('0')) {
                    expect(request.param).toEqual({ song_type: 0, song_mid: id });
                } else {
                    expect(request.param).toEqual({ song_type: 0, song_id: Number(id) });
                    expect(typeof request.param.song_id).toBe('number');
                }
            });
            expect(requestMock).not.toHaveBeenCalled();
            expect(songs.map(song => song?.qqMid ?? null)).toEqual(ids.map(id => (
                id === '0039MnYb0qxYhV' || id === 97773 ? '0039MnYb0qxYhV'
                    : id === '003rJSwm3TechU' || id === '5105918' ? '003rJSwm3TechU'
                        : null
            )));
        });

        it('asks more than 25 ids in groups of 25, one request after the other', async () => {
            const ids = Array.from({ length: 60 }, (_, index) => 1000 + index);
            const answers: (() => void)[] = [];
            musicuMock.mockImplementation((requests: Requests) => new Promise(resolve => {
                answers.push(() => resolve(answersOf(requests)));
            }));

            const songs = qqProvider.playback!.getSongDetails!(ids);
            await flush();
            expect(musicuMock).toHaveBeenCalledTimes(1);
            answers[0]();
            await flush();
            expect(musicuMock).toHaveBeenCalledTimes(2);
            answers[1]();
            await flush();
            expect(musicuMock).toHaveBeenCalledTimes(3);
            answers[2]();

            await expect(songs).resolves.toEqual(ids.map(() => null));
            expect([0, 1, 2].map(call => sentRequests(call).length)).toEqual([25, 25, 10]);
            expect([0, 1, 2].flatMap(call => sentRequests(call).map(request => request.param.song_id))).toEqual(ids);
        });

        it('rejects the whole call when a group or one of its requests is refused, instead of answering nulls', async () => {
            const ids = Array.from({ length: 30 }, (_, index) => 1000 + index);
            const refused = new OnlineProviderError('network', 'QQ musicu request failed: 429', 'qq', undefined, 429);
            musicuMock
                .mockImplementationOnce(async (requests: Requests) => answersOf(requests))
                .mockRejectedValueOnce(refused);
            await expect(qqProvider.playback!.getSongDetails!(ids)).rejects.toBe(refused);

            musicuMock.mockImplementationOnce(async (requests: Requests) => ({
                ...answersOf(requests),
                q3: { code: 2001, data: undefined },
            }));
            await expect(qqProvider.playback!.getSongDetails!([97773, 1, 2, 3, 4])).rejects.toMatchObject({
                code: 'invalid-response',
                cause: { id: '3', code: 2001 },
            });
        });

        it('asks nothing for no ids', async () => {
            await expect(qqProvider.playback!.getSongDetails!([])).resolves.toEqual([]);
            expect(musicuMock).not.toHaveBeenCalled();
            expect(requestMock).not.toHaveBeenCalled();
        });
    });

    // Which error getAudioSource throws when no level gives a URL; what it means is said in qqFailure.ts.
    describe('audio source failures', () => {
        const SONG = normalizeQqSong(SEARCH_ITEM);
        // 后端把每个文件的原因都换成了这一句固定文案（qrLogin.js:482-495），它证明不了会员、地区或下架。
        const EMPTY_PLAY_LINK = { data: { playUrl: { '003rJSwm3TechU': { url: '', error: '暂无播放链接' } } } };
        const PLAYABLE = { data: { playUrl: { '003rJSwm3TechU': { url: 'https://audio.example.test/song.mp3' } } } };

        const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => (
            promise.then(() => { throw new Error('the request did not fail'); }, (failure: unknown) => failure)
        );
        const caseOf = async (promise: Promise<unknown>) => describeQqFailure('audio', await rejectionOf(promise));

        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => { });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        // 有会话时三档都没链接，再要一次试听；试听也没有，才说没有音频。
        it('says no audio after three empty play links and no preview clip, one request per level', async () => {
            requestMock.mockResolvedValue(EMPTY_PLAY_LINK);

            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'lossless'))).toEqual({ case: 'no-audio' });
            expect(requestMock).toHaveBeenCalledTimes(4);
            expect(requestMock).toHaveBeenLastCalledWith('music_play', { songmid: '003rJSwm3TechU', mediaId: '001MediaMidFixture', preview: 1 });
        });

        it('hands out the preview clip, marked as one, where no level gave a link', async () => {
            requestMock
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce({ data: { playUrl: { '003rJSwm3TechU': { url: 'https://audio.example.test/clip.mp3', preview: true } } } });

            await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).resolves.toEqual({
                url: 'https://audio.example.test/clip.mp3',
                fetchedAt: expect.any(Number),
                quality: 'standard',
                preview: true,
            });
        });

        // 后端没在这一条上标 `preview`：那是整首的链接，不当成试听。
        it('does not mark a link as a preview where the backend did not', async () => {
            requestMock
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce({ data: { playUrl: { '003rJSwm3TechU': { url: 'https://audio.example.test/full.mp3', error: false } } } });

            const source = await qqProvider.playback!.getAudioSource(SONG, 'lossless');
            expect(source).toMatchObject({ url: 'https://audio.example.test/full.mp3', quality: 'standard' });
            expect(source).not.toHaveProperty('preview');
        });

        // 试听那一次失败只是没有试听：照原来的说法说没有音频，不把试听的错交出去。
        it('says no audio where the preview request itself failed', async () => {
            requestMock
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 500', 'qq', { error: 'get-music-play failed' }, 500));

            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'lossless'))).toEqual({ case: 'no-audio' });
        });

        // Only a hint: no session, and the backend issued empty links. Never a sign-in that ended.
        it('says signing in may help only when there is no session and the backend issued empty links', async () => {
            transportState.hasSession = false;
            requestMock.mockResolvedValue(EMPTY_PLAY_LINK);
            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'high'))).toEqual({ case: 'no-audio', likelyCause: 'sign-in' });

            // 形态坏掉的应答不是「没给链接」，登录提示无从谈起。
            requestMock.mockReset();
            requestMock
                .mockResolvedValueOnce({ data: {} })
                .mockResolvedValueOnce({ data: { playUrl: 'https://audio.example.test/song.mp3' } });
            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'high'))).toEqual({ case: 'no-audio' });
            expect(requestMock).toHaveBeenCalledTimes(2);
        });

        it('rejects a song without a songmid as an invalid response before issuing any request', async () => {
            const song = {
                ...SONG,
                qqMid: undefined,
                sourceRef: { kind: 'local' as const, mediaId: 'file-1' },
            };

            await expect(qqProvider.playback!.getAudioSource(song, 'lossless')).rejects.toMatchObject({
                code: 'invalid-response',
                message: 'QQ song has no songmid',
                providerId: 'qq',
            });
            expect(requestMock).not.toHaveBeenCalled();
        });

        it.each([
            ['the backend asks to wait', () => new OnlineProviderError('network', 'QQMusicApi request failed: 429', 'qq', { retryAfterMs: 25_000 }, 429, 25_000)],
            ['the web build has no backend address', () => new OnlineProviderError('unavailable', QQ_API_BASE_MISSING, 'qq')],
            // QQ has no other endpoint, and the next level would wait as long again.
            ['the request was not answered in time', () => new OnlineRequestTimeout(QQ_ONLINE_REQUEST_LIMIT_MS)],
        ])('stops at the first request where %s', async (_label, thrown) => {
            const error = thrown();
            requestMock.mockRejectedValue(error);

            await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).rejects.toBe(error);
            expect(requestMock).toHaveBeenCalledTimes(1);
        });

        it('degrades past a network failure and returns the next quality that has a URL', async () => {
            requestMock
                .mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi music_play unreachable: Failed to fetch', 'qq'))
                .mockResolvedValueOnce(PLAYABLE);

            await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).resolves.toEqual({
                url: 'https://audio.example.test/song.mp3',
                fetchedAt: expect.any(Number),
                quality: 'high',
            });
            expect(requestMock).toHaveBeenCalledTimes(2);
        });

        it('rethrows the very same auth-required instance from a lower quality', async () => {
            const authError = new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', undefined, 401);
            requestMock
                .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                .mockRejectedValueOnce(authError);

            const error = await qqProvider.playback!.getAudioSource(SONG, 'lossless').catch((thrown: unknown) => thrown);

            expect(error).toBe(authError);
            expect(requestMock).toHaveBeenCalledTimes(2);
        });

        // The backend's answer says more than a request that failed beside it.
        it('says no audio where a level answered with an empty link after another failed with 500', async () => {
            requestMock
                .mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 500', 'qq', { error: 'get-music-play failed' }, 500))
                .mockResolvedValue(EMPTY_PLAY_LINK);

            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'lossless'))).toEqual({ case: 'no-audio' });
            // 三档，加上一次试听。
            expect(requestMock).toHaveBeenCalledTimes(4);
        });

        // 有档连不上时只有标准音质回了空链接才要试听；不然照连不上报，播放那边按 autoRetryDelaysMs 再要。
        describe('a level that could not be reached beside an empty link', () => {
            const PREVIEW_CLIP = { data: { playUrl: { '003rJSwm3TechU': { url: 'https://audio.example.test/clip.mp3', preview: true } } } };
            const unreachable = () => new OnlineProviderError('network', 'QQMusicApi music_play unreachable: Failed to fetch', 'qq');
            const levelsAsked = () => requestMock.mock.calls.map(([, params]) => (
                (params as { preview?: number; quality?: string }).preview ? 'preview' : (params as { quality?: string }).quality
            ));
            const playerRetries = (failure: unknown) => autoRetryDelaysMs(onlineFailureOf({ operation: 'audio', providerId: 'qq' }, { error: failure }));

            // 会员碰上网络抖动：flac 回空，另两档连不上。交出试听的话播放那边就当成功了，会员只听到一分钟。
            it('throws the level that could not be reached instead of a preview where the standard tier did not answer', async () => {
                const first = unreachable();
                requestMock
                    .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                    .mockRejectedValueOnce(first)
                    .mockRejectedValueOnce(unreachable())
                    .mockResolvedValueOnce(PREVIEW_CLIP);

                const failure = await rejectionOf(qqProvider.playback!.getAudioSource(SONG, 'lossless'));
                expect(failure).toBe(first);
                expect(playerRetries(failure)).toEqual([1000, 3000]);
                expect(levelsAsked()).toEqual(['flac', '320', '128']);
            });

            // 标准音质回了空链接：这个账号拿不到整首，更高的档连不上也不用再要。
            it('asks for the preview where the standard tier answered with an empty link, whatever failed above it', async () => {
                requestMock
                    .mockRejectedValueOnce(unreachable())
                    .mockRejectedValueOnce(unreachable())
                    .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                    .mockResolvedValueOnce(PREVIEW_CLIP);

                await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).resolves.toMatchObject({
                    url: 'https://audio.example.test/clip.mp3',
                    preview: true,
                });
                expect(levelsAsked()).toEqual(['flac', '320', '128', 'preview']);
            });

            it('neither asks for a preview nor says no audio where no level answered at all', async () => {
                const first = unreachable();
                requestMock.mockRejectedValueOnce(first).mockRejectedValue(unreachable());

                await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).rejects.toBe(first);
                expect(levelsAsked()).toEqual(['flac', '320', '128']);
            });

            // 和播放那边用同一条规则算「连不上」。3.3.3 调 QQ 超时（25 秒）回的是不带拒绝码的 500。
            it.each([
                ['a 500 without a refusal code', () => new OnlineProviderError(
                    'network', 'QQMusicApi request failed: 500', 'qq', { error: 'get-music-play failed' }, 500,
                )],
                ['a 502 the backend sorted as not reaching QQ', () => new OnlineProviderError(
                    'network', 'QQMusicApi request failed: 502', 'qq', { errorKey: 'network.timeout' }, 502,
                )],
            ])('counts %s on the standard tier as not reached', async (_label, thrown) => {
                const failure = thrown();
                requestMock
                    .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                    .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                    .mockRejectedValueOnce(failure);

                await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).rejects.toBe(failure);
                expect(levelsAsked()).toEqual(['flac', '320', '128']);
            });

            // 不是「连不上」的失败再要也一样：旁边有档回了空链接，照旧要试听。
            it.each([
                ['an upstream refusal the backend wrapped in a 500', () => new OnlineProviderError(
                    'network', 'QQMusicApi request failed: 500', 'qq', { error: 'get-music-play failed (HTTP 200, global=0, code=104003)' }, 500,
                )],
                ['a 502 the backend sorted as a refusal', () => new OnlineProviderError(
                    'network', 'QQMusicApi request failed: 502', 'qq', { errorKey: 'upstream.business', kind: 'upstream-business', upstreamCode: 104003 }, 502,
                )],
                ['a 403', () => new OnlineProviderError('network', 'QQMusicApi request failed: 403', 'qq', undefined, 403)],
                ['an answer that could not be read', () => new OnlineProviderError('invalid-response', 'QQMusicApi music_play body unreadable', 'qq')],
            ])('still asks for the preview where the standard tier fails with %s', async (_label, thrown) => {
                requestMock
                    .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                    .mockResolvedValueOnce(EMPTY_PLAY_LINK)
                    .mockRejectedValueOnce(thrown())
                    .mockResolvedValueOnce(PREVIEW_CLIP);

                await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).resolves.toMatchObject({ preview: true });
                expect(levelsAsked()).toEqual(['flac', '320', '128', 'preview']);
            });

            // 先碰到平台拒绝、后面的档连不上：报的是连不上的那个错，播放那边才会再要。
            it('throws the level that could not be reached, not an earlier refusal', async () => {
                const reachFailure = unreachable();
                requestMock
                    .mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 403', 'qq', undefined, 403))
                    .mockRejectedValueOnce(reachFailure)
                    .mockRejectedValueOnce(unreachable());

                await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).rejects.toBe(reachFailure);
            });

            it('stops at a request the backend asked to wait on', async () => {
                const wait = new OnlineProviderError('network', 'QQMusicApi request failed: 429', 'qq', { retryAfterMs: 25_000 }, 429, 25_000);
                requestMock.mockResolvedValueOnce(EMPTY_PLAY_LINK).mockRejectedValueOnce(wait);

                await expect(qqProvider.playback!.getAudioSource(SONG, 'lossless')).rejects.toBe(wait);
                expect(levelsAsked()).toEqual(['flac', '320']);
            });
        });

        // 后端把上游业务拒绝（QqProtocolError）包成 500：QQ 音乐其实答了话，是拒绝，不是服务异常。
        it('reads an upstream business refusal on every quality as a refusal, with its code', async () => {
            requestMock.mockImplementation(async () => {
                throw new OnlineProviderError(
                    'network', 'QQMusicApi request failed: 500', 'qq', { error: 'get-music-play failed (HTTP 200, global=0, code=104003)' }, 500,
                );
            });

            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'lossless'))).toMatchObject({ case: 'refused', code: '104003', httpStatus: 500 });
            expect(requestMock).toHaveBeenCalledTimes(3);
        });

        // 3.3.0 的 restriction：数字码只进日志，hint.key 只有 maybe-* 两种算「可能」原因，而且只认最后一档（标准音质）的。
        const restricted = (hintKey: string, codes: Record<string, number> = { result: 104003, subcode: 1 }) => ({
            data: { playUrl: { '003rJSwm3TechU': {
                url: '',
                error: '暂无播放链接',
                restriction: { key: 'url_unavailable', evidence: 'observed-response', codes, hint: { key: hintKey, message: 'Preset English text' } },
            } } },
        });

        it('gives no possible cause for a restriction whose hint confirms nothing', async () => {
            requestMock.mockResolvedValue(restricted('playback.reason-unconfirmed'));
            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'high'))).toEqual({ case: 'no-audio' });
        });

        it.each([
            ['playback.maybe-membership', 'subscription'],
            ['playback.maybe-region-restricted', 'region'],
        ] as const)('turns %s on the standard tier into a possible cause, never a definite reason', async (hintKey, cause) => {
            requestMock
                .mockResolvedValueOnce(restricted('playback.reason-unconfirmed'))
                .mockResolvedValueOnce(restricted(hintKey));

            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'high'))).toEqual({ case: 'no-audio', likelyCause: cause });
        });

        // 可能原因只看最后一档：最后一档失败了，前面档位的提示不能代表这次失败。
        it.each([
            ['throws', () => requestMock.mockRejectedValueOnce(new OnlineProviderError('invalid-response', 'QQMusicApi music_play body unreadable', 'qq'))],
            ['answers without an entry', () => requestMock.mockResolvedValueOnce({ data: { playUrl: {} } })],
        ])('drops a possible cause when the last tier %s', async (_label, failLastTier) => {
            requestMock.mockResolvedValueOnce(restricted('playback.maybe-membership'));
            failLastTier();

            expect(await caseOf(qqProvider.playback!.getAudioSource(SONG, 'high'))).toEqual({ case: 'no-audio' });
        });

        it('never turns an empty play link into a takedown, a refusal of this song or a preview', async () => {
            transportState.hasSession = false;
            requestMock.mockResolvedValue(EMPTY_PLAY_LINK);

            expect((await caseOf(qqProvider.playback!.getAudioSource(SONG, 'hires')))?.case).toBe('no-audio');
            // QQ 不声明歌曲级的静态可用性，运行时失败也不会回写到那里。
            expect(qqProvider.playback?.getAvailability).toBeUndefined();
        });
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
        await expect(qqProvider.library!.getLikedSongIds!(123)).resolves.toEqual({ ids: ['003rJSwm3TechU'], whole: true });
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

    // 读不出来的一页不能当成“没有喜欢的歌”，没读到底的列表不能当成整份。
    it('fails the liked-song read on an answer without the list, and says a list that stops short is not whole', async () => {
        requestMock.mockResolvedValueOnce({ code: 200 });
        await expect(qqProvider.library!.getLikedSongIds!(123)).rejects.toMatchObject({ code: 'invalid-response' });

        // QQ counts three songs and gives one, then nothing.
        requestMock
            .mockResolvedValueOnce({ code: 200, songs: [SEARCH_ITEM], total: 3, more: false })
            .mockResolvedValueOnce({ code: 200, songs: [], total: 3, more: false });
        await expect(qqProvider.library!.getLikedSongIds!(123)).resolves.toEqual({ ids: ['003rJSwm3TechU'], whole: false });

        // A full page with no count and no word of more: the list may go on.
        requestMock.mockResolvedValueOnce({ code: 200, songs: Array.from({ length: 100 }, () => SEARCH_ITEM) });
        await expect(qqProvider.library!.getLikedSongIds!(123)).resolves.toMatchObject({ whole: false });

        // A short page with no count ends the list.
        requestMock.mockResolvedValueOnce({ code: 200, songs: [SEARCH_ITEM] });
        await expect(qqProvider.library!.getLikedSongIds!(123)).resolves.toEqual({ ids: ['003rJSwm3TechU'], whole: true });
    });

    it('counts the liked songs by the count the first page of the list gives, and gives none where QQ names none', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, songs: [SEARCH_ITEM], total: 37, more: false });
        await expect(qqProvider.library!.getLikedSongCount!(123)).resolves.toBe(37);
        expect(requestMock.mock.calls).toEqual([['user_liked_songs', { offset: 0, limit: 100 }]]);

        requestMock.mockResolvedValueOnce({ code: 200, songs: [SEARCH_ITEM] });
        await expect(qqProvider.library!.getLikedSongCount!(123)).resolves.toBeNull();
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
            total: 50,
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

    // 读账号的地方（`account/accountRead.ts` 的 `keptAccount`）会把已正规化的缓存再喂回来，第二遍若有损耗，
    // 曲库水合出来的就是被洗空的专辑而不是缓存里的那份。
    it('keeps album and artist collections stable when the cached copy is normalized again', () => {
        const album = normalizeQqCollection(SINGER_ALBUM_ITEM, 'album');
        const artist = normalizeQqCollection(SINGER_INFO_ITEM, 'artist');

        expect(normalizeQqCollection(album, 'album')).toEqual(album);
        expect(normalizeQqCollection(artist, 'artist')).toEqual(artist);
        // 读账号时（account/accountRead.ts）用 `collection.type` 再正规化一次，走的是同一个分支。
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
});

// qq-music-api 3.3.3 接上的能力：会员等级、歌单只读一次、逐首确认红心、歌单页的播放数、云盘与探索页的开关。
// 回应形状取自 3.3.3 的使用文档（「登录后的资料与歌单」「选对歌单详情接口」「收藏与查询收藏状态」）；数字与名字是虚构示例。
describe('qqProvider (3.3.3 library)', () => {
    beforeEach(() => {
        requestMock.mockReset();
        transportState.hasSession = true;
        resetQqProviderRuntimeCache();
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('declares the cloud and the explore page with their members', () => {
        expect(qqProvider.capabilities).toMatchObject({ userCloud: true, explore: true });
        expect(qqProvider.library?.getCloudCollection).toBeTypeOf('function');
        expect(qqProvider.catalog?.getCloudTracks).toBeTypeOf('function');
        expect(qqProvider.explore?.getFeed).toBeTypeOf('function');
    });

    it.each([
        ['free', 0],
        ['green', 1],
        ['super', 2],
    ])('reads the %s membership into vipType %i', async (vipLevel, vipType) => {
        requestMock
            .mockResolvedValueOnce({ code: 200, data: { profile: { str_musicid: '10001', nick: '示例用户' } } })
            .mockResolvedValueOnce({ code: 200, isVip: vipType > 0, vipLevel });

        await expect(qqProvider.auth!.getLoginStatus!()).resolves.toMatchObject({ id: '10001', vipType });
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['login_status', 'user_vip']);
    });

    // 判断不出来不当成免费；会员等级读不到也不影响登录。等级一个账号只读一次，所以读不到的那次换一个账号。
    it('leaves vipType out where the level is unknown or could not be read', async () => {
        const profileOf = (id: string) => ({ code: 200, data: { profile: { str_musicid: id, nick: '示例用户' } } });
        requestMock
            .mockResolvedValueOnce(profileOf('10001'))
            .mockResolvedValueOnce({ code: 200, isVip: false, vipLevel: 'unknown' })
            .mockResolvedValueOnce(profileOf('10002'))
            .mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq', { errorKey: 'upstream.unknown' }, 502));

        const unknown = await qqProvider.auth!.getLoginStatus!();
        const failed = await qqProvider.auth!.getLoginStatus!();

        expect(unknown).toMatchObject({ id: '10001' });
        expect(unknown).not.toHaveProperty('vipType');
        expect(failed).toMatchObject({ id: '10002' });
        expect(failed).not.toHaveProperty('vipType');
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['login_status', 'user_vip', 'login_status', 'user_vip']);
    });

    it('keeps vipType through a round trip of the cached user', () => {
        expect(normalizeQqUser({ id: '10001', nickname: '示例用户', vipType: 2 })).toMatchObject({ vipType: 2 });
    });

    // 账号层每 50 张要一页；后端一次给整份，所以一轮只请求一次。
    it('asks for the playlists once a round and pages the rest out of that answer', async () => {
        const playlist = Array.from({ length: 120 }, (_, index) => ({ tid: 1000 + index, dirId: index + 1, dirName: `歌单 ${index}` }));
        requestMock.mockResolvedValueOnce({ code: 200, playlist, total: 120, more: false });

        const pages = [];
        for (let offset = 0; offset < 120; offset += 50) pages.push(await qqProvider.library!.getUserPlaylists(123, 50, offset));

        expect(requestMock).toHaveBeenCalledTimes(1);
        expect(pages.map(page => page.items.length)).toEqual([50, 50, 20]);
        expect(pages[2]).toMatchObject({ hasMore: false, nextOffset: 120 });

        // 下一轮从第一页开始，重新读。
        requestMock.mockResolvedValueOnce({ code: 200, playlist: playlist.slice(0, 1), total: 1, more: false });
        await expect(qqProvider.library!.getUserPlaylists(123, 50, 0)).resolves.toMatchObject({ total: 1, hasMore: false });
        expect(requestMock).toHaveBeenCalledTimes(2);
    });

    // 一轮读到的整份歌单只给读它的那个账号切：换了账号，后面的页也重新读。
    it('never pages one account\'s playlists out of another account\'s round', async () => {
        const listOf = (prefix: number) => Array.from({ length: 60 }, (_, index) => ({ tid: prefix + index, dirId: index + 1, dirName: `歌单 ${index}` }));
        requestMock
            .mockResolvedValueOnce({ code: 200, playlist: listOf(1000), total: 60, more: false })
            .mockResolvedValueOnce({ code: 200, playlist: listOf(5000), total: 60, more: false });

        await qqProvider.library!.getUserPlaylists('10001', 50, 0);
        const other = await qqProvider.library!.getUserPlaylists('20002', 50, 50);

        expect(requestMock).toHaveBeenCalledTimes(2);
        expect(other.items.map(item => item.id)).toEqual(Array.from({ length: 10 }, (_, index) => 5050 + index));
    });

    it('asks whether songs are liked by songmid and answers only what the backend is sure of', async () => {
        requestMock.mockResolvedValueOnce({
            code: 200,
            type: 'song',
            items: [
                { id: 'mid-a', status: 'subscribed' },
                { id: 'mid-b', status: 'not-subscribed' },
                { id: 'mid-c', status: 'unknown' },
            ],
        });

        // 数字 id 是没有 songmid 的歌，不拿去问。
        await expect(qqProvider.library!.areSongsLiked!(['mid-a', 'mid-b', 'mid-c', 12345, 'mid-a']))
            .resolves.toEqual({ 'mid-a': true, 'mid-b': false });
        expect(requestMock).toHaveBeenCalledWith('user_subscription_status', { type: 'song', ids: 'mid-a,mid-b,mid-c' });

        requestMock.mockClear();
        await expect(qqProvider.library!.areSongsLiked!([12345])).resolves.toEqual({});
        expect(requestMock).not.toHaveBeenCalled();
    });

    describe('playlist detail', () => {
        const ownPlaylist = normalizeQqCollection({ tid: 70001, dirId: 5, dirName: '自建歌单', songNum: 3 });

        it('reads an own playlist\'s play count with one song of it', async () => {
            requestMock.mockResolvedValueOnce({ code: 200, songs: [], total: 3, more: true, play_cnt: 42 });

            await expect(qqProvider.catalog!.getPlaylistDetail!(ownPlaylist.id, ownPlaylist)).resolves.toMatchObject({ id: 70001, playCount: 42 });
            expect(requestMock).toHaveBeenCalledWith('user_playlist_detail', { tid: '70001', dirid: 5, offset: 0, limit: 1, playCount: 1 });
        });

        it('reads another\'s playlist from the anonymous detail only where it has no play count yet', async () => {
            const favourite = normalizeQqCollection({ tid: 80001, dirId: 36, name: '收藏的歌单', songnum: 9 });
            requestMock.mockResolvedValueOnce({ response: { code: 0, cdlist: [{ dissname: '收藏的歌单', visitnum: 777, desc: '示例简介', songlist: [] }] } });

            await expect(qqProvider.catalog!.getPlaylistDetail!(favourite.id, favourite))
                .resolves.toMatchObject({ playCount: 777, description: '示例简介' });
            expect(requestMock).toHaveBeenCalledWith('song_list_detail', { disstid: '80001' });

            requestMock.mockClear();
            const recommended = normalizeQqCollection({ tid: 90001, title: '推荐歌单', play_cnt: 4321 });
            await expect(qqProvider.catalog!.getPlaylistDetail!(recommended.id, recommended)).resolves.toBe(recommended);
            expect(requestMock).not.toHaveBeenCalled();
        });

        it('asks nothing for the liked list, and hands the playlist back where the detail fails', async () => {
            const liked = normalizeQqCollection(PLAYLIST_ITEM);
            await expect(qqProvider.catalog!.getPlaylistDetail!(liked.id, liked)).resolves.toBe(liked);
            expect(requestMock).not.toHaveBeenCalled();

            requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq', undefined, 502));
            await expect(qqProvider.catalog!.getPlaylistDetail!(ownPlaylist.id, ownPlaylist)).resolves.toBe(ownPlaylist);
        });

        it('leaves the play count out where the upstream gives null', async () => {
            requestMock.mockResolvedValueOnce({ code: 200, songs: [], total: 3, more: true, play_cnt: null });
            const detail = await qqProvider.catalog!.getPlaylistDetail!(ownPlaylist.id, ownPlaylist);
            expect(detail).not.toHaveProperty('playCount');
        });

        it('keeps reading own playlists with credentials after the anonymous detail answers 404', async () => {
            const favourite = normalizeQqCollection({ tid: 80001, dirId: 36, name: '收藏的歌单', songnum: 9 });
            requestMock.mockRejectedValueOnce(new OnlineProviderError('unsupported', 'QQMusicApi has no route', 'qq'));
            await expect(qqProvider.catalog!.getPlaylistDetail!(favourite.id, favourite)).resolves.toBe(favourite);

            requestMock.mockResolvedValueOnce({ code: 200, songs: [], total: 3, more: true, play_cnt: 42 });
            await expect(qqProvider.catalog!.getPlaylistDetail!(ownPlaylist.id, ownPlaylist)).resolves.toMatchObject({ playCount: 42 });
            expect(requestMock).toHaveBeenLastCalledWith('user_playlist_detail', expect.objectContaining({ tid: '70001', dirid: 5 }));
        });
    });
});
