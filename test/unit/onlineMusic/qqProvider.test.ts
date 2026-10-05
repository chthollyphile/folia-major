import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqProvider.test.ts

const requestMock = vi.hoisted(() => vi.fn());
const clearSessionMock = vi.hoisted(() => vi.fn());
const writeSessionValueMock = vi.hoisted(() => vi.fn());
const searchQQLyricsMock = vi.hoisted(() => vi.fn());
const fetchQQLyricsMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('@/services/onlineMusic/qqTransport', () => ({
    getQqTransportAvailability: () => ({ configured: true }),
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
}));

import { qqProvider, resetQqProviderRuntimeCache } from '@/services/onlineMusic/qqProvider';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from '@/services/onlineMusic/qqNormalize';
import { OnlineProviderError } from '@/types/onlineMusic';
import { formatQrLoginDiagnosticReport } from '@/utils/qrLoginDiagnosticReport';

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
        clearSessionMock.mockReset();
        writeSessionValueMock.mockReset();
        searchQQLyricsMock.mockReset();
        fetchQQLyricsMock.mockReset();
        transportState.hasSession = true;
        resetQqProviderRuntimeCache();
    });

    it('declares readable library features without exposing unsupported mutations or recommendations', () => {
        expect(qqProvider.capabilities).toMatchObject({
            userLibrary: true,
            playlists: true,
            userAlbums: true,
            likes: true,
            recommendations: false,
            mutations: false,
        });
        expect(qqProvider.mutations).toBeUndefined();
        expect(qqProvider.recommendations).toBeUndefined();
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

    it('normalizes the playlist and profile payloads, including a profile without a display name', () => {
        expect(normalizeQqCollection(PLAYLIST_ITEM)).toEqual({
            providerId: 'qq',
            id: 7,
            name: '我喜欢',
            type: 'playlist',
            coverUrl: 'https://img.example.test/big.jpg',
            trackCount: 2,
            providerData: { tid: 7, dirId: 201, owned: true },
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
            .mockResolvedValueOnce({
                code: 800,
                message: 'QR login failed',
                upstreamCode: 50006,
                retryAfterMs: 31000,
            });

        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'waiting' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'scanned' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'confirmed' });
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({ state: 'expired' });
        // An upstream rejection is not an expired code; the unnamed safety number stays out of the state.
        await expect(qqProvider.auth!.checkQr!('qr-key')).resolves.toEqual({
            state: 'error',
            message: 'QR login failed',
        });

        expect(requestMock).toHaveBeenCalledWith('login_qr_check', { key: 'qr-key' });
        expect(writeSessionValueMock).toHaveBeenCalledExactlyOnceWith('qq', 'cookie', 'qqmusic_session=opaque-token');
    });

    it('puts safe backend failure details into the copied QQ diagnostics and clears them for a new QR', async () => {
        requestMock.mockResolvedValueOnce({ data: { unikey: 'qr-key' } });
        await qqProvider.auth!.getQrKey!('qq');
        requestMock.mockResolvedValueOnce({
            code: 800,
            message: 'QR login failed',
            failureStage: 'credential-validation',
            failureReason: 'upstream-rejected',
            upstreamCode: 50006,
            retryAfterMs: 30000,
            cookie: 'qqmusic_session=private-credential',
        });
        await qqProvider.auth!.checkQr!('qr-key');

        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines).toContain('qr-check: stage=credential-validation reason=upstream-rejected upstreamCode=50006 retryAfterMs=30000');
        expect(lines.join('\n')).not.toContain('private-credential');
        expect(lines.join('\n')).not.toContain('qr-key');

        requestMock.mockResolvedValueOnce({ data: { unikey: 'new-key' } });
        await qqProvider.auth!.getQrKey!('qq');
        expect(await qqProvider.auth!.getQrLoginDiagnostics!()).toEqual([]);
    });

    it('rejects unrecognised diagnostic strings and still reports an older backend failure', async () => {
        requestMock.mockResolvedValueOnce({
            code: 800,
            message: 'QR login failed',
            failureStage: 'private-credential',
            failureReason: 'qqmusic_key=private-credential',
            retryAfterMs: 31000,
        });
        await qqProvider.auth!.checkQr!('qr-key');
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines).toContain('qr-check: stage=unavailable reason=unavailable upstreamCode=unavailable retryAfterMs=31000');
        expect(lines.join('\n')).not.toContain('private-credential');
    });

    it('keeps a safe transport category when the QR check itself throws', async () => {
        requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'request failed with private-token', 'qq'));
        await expect(qqProvider.auth!.checkQr!('qr-key')).rejects.toBeInstanceOf(OnlineProviderError);
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines).toEqual(['qr-check: transport=network']);
        expect(lines.join('\n')).not.toContain('private-token');
    });

    it.each(['qr-key', 'qr-create', 'qr-check'] as const)('includes HTTP and cooldown origin for %s in the copied report', async (step) => {
        const body = {
            failureStage: 'qr-key', failureReason: 'local-backoff', retryAfterMs: 30000,
            lastFailure: { failureStage: 'device-bootstrap', failureReason: 'upstream-rejected',
                upstreamHttpStatus: 200, upstreamCode: -30002, upstreamSubCode: -99 },
            token: 'private-token', cookie: 'private-cookie', ip: '192.0.2.1', uin: 'private-account',
        };
        requestMock.mockRejectedValueOnce(Object.assign(new OnlineProviderError('network', 'private-message', 'qq', body), { httpStatus: 429 }));
        const auth = qqProvider.auth!;
        await (step === 'qr-key' ? auth.getQrKey!('qq') : step === 'qr-create' ? auth.createQr!('private-key') : auth.checkQr!('private-key')).catch(() => undefined);
        const lines = await auth.getQrLoginDiagnostics!();
        expect(lines[0]).toContain(`${step}: transport=network httpStatus=429 stage=qr-key reason=local-backoff`);
        expect(lines[1]).toContain('last-failure: stage=device-bootstrap reason=upstream-rejected upstreamCode=-30002');
        expect(lines[1]).toContain('upstreamHttpStatus=200');
        expect(lines[1]).toContain('upstreamSubCode=-99');
        const report = formatQrLoginDiagnosticReport({ generatedAt: Date.now(), appVersion: 'test', userAgent: 'test',
            providerId: 'qq', methodId: 'qq', failure: 'start-error', timeline: [], providerLines: lines });
        expect(report).toContain(`qq details:\n  ${step}: transport=network httpStatus=429`);
        expect(report).not.toMatch(/private-|192\.0\.2\.1/);
    });

    it('reports HTTP 429 from an older backend without inferring its cause', async () => {
        requestMock.mockRejectedValueOnce(Object.assign(new OnlineProviderError('network', 'QQMusicApi request failed: 429', 'qq'), { httpStatus: 429 }));
        await qqProvider.auth!.getQrKey!('qq').catch(() => undefined);
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines[0]).toContain('httpStatus=429 stage=unavailable reason=unavailable');
        expect(lines.join('\n')).not.toContain('last-failure');
    });

    it('records a missing session after confirmation without exposing the confirmed cookie', async () => {
        requestMock.mockResolvedValueOnce({ code: 803, cookie: 'qqmusic_session=private-cookie' });
        await qqProvider.auth!.checkQr!('private-key');
        transportState.hasSession = false;
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines).toContain('account-refresh: reason=missing-session');
        expect(lines.join('\n')).not.toMatch(/private-cookie|private-key/);
    });

    it.each(['anonymous', 'auth-required', 'network'] as const)('records the post-confirmation account result %s', async (reason) => {
        requestMock.mockResolvedValueOnce({ code: 803 });
        await qqProvider.auth!.checkQr!('key');
        if (reason === 'anonymous') requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        else requestMock.mockRejectedValueOnce(Object.assign(new OnlineProviderError(reason === 'auth-required' ? reason : 'network', 'private-token', 'qq'), { httpStatus: reason === 'auth-required' ? 401 : 502 }));
        await qqProvider.auth!.getLoginStatus().catch(() => undefined);
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines[0]).toContain('qr-check: result=confirmed');
        expect(lines[1]).toContain(reason === 'anonymous' ? 'account-refresh: reason=anonymous' : `account-refresh: transport=${reason}`);
        expect(lines.join('\n')).not.toContain('private-token');
    });

    it('keeps a late check from the previous QR out of the next report', async () => {
        let finish!: (response: unknown) => void;
        requestMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const oldCheck = qqProvider.auth!.checkQr!('old-key');
        requestMock.mockResolvedValueOnce({ data: { unikey: 'new-key' } });
        await qqProvider.auth!.getQrKey!('qq');
        finish({ code: 800, retryAfterMs: 30000, failureStage: 'mqtt-listener', failureReason: 'mqtt-websocket-closed' });
        await oldCheck;
        expect(await qqProvider.auth!.getQrLoginDiagnostics!()).toEqual([]);
    });

    it('records a missing QR key without changing the empty return value', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        await expect(qqProvider.auth!.getQrKey!('qq')).resolves.toBe('');
        expect(await qqProvider.auth!.getQrLoginDiagnostics!()).toEqual(['qr-key: reason=missing-key']);
    });

    it('records a missing QR image without changing the empty return value', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, data: {} });
        await expect(qqProvider.auth!.createQr!('key')).resolves.toBe('');
        expect(await qqProvider.auth!.getQrLoginDiagnostics!()).toEqual(['qr-create: reason=missing-image']);
    });

    it('distinguishes the new confirmed cookie from an already stored session', async () => {
        transportState.hasSession = true;
        requestMock.mockResolvedValueOnce({ code: 803 });
        await qqProvider.auth!.checkQr!('key');
        const lines = await qqProvider.auth!.getQrLoginDiagnostics!();
        expect(lines[0]).toContain('hasSession=true hasCookie=false');
    });

    it('keeps a late account response out of a newly confirmed QR report', async () => {
        requestMock.mockResolvedValueOnce({ code: 803 });
        await qqProvider.auth!.checkQr!('old-key');
        let finish!: (response: unknown) => void;
        requestMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const oldAccount = qqProvider.auth!.getLoginStatus();
        requestMock.mockResolvedValueOnce({ data: { unikey: 'new-key' } });
        await qqProvider.auth!.getQrKey!('qq');
        requestMock.mockResolvedValueOnce({ code: 803 });
        await qqProvider.auth!.checkQr!('new-key');
        finish({ code: 200, data: {} });
        await oldAccount;
        expect(await qqProvider.auth!.getQrLoginDiagnostics!()).toEqual(['qr-check: result=confirmed hasSession=true hasCookie=false']);
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
            mutations: false,
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
