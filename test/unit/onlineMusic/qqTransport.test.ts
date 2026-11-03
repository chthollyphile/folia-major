import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqTransport.test.ts

const storage = new Map<string, string>();

// Opaque backend session string; qq-music-api hands back the whole `qqmusic_session=<token>` cookie on 803.
const CONFIRMED_COOKIE = 'qqmusic_session=opaque-token';

describe('QQ Music Web transport', () => {
    it.each([401, 404, 429, 502])('keeps HTTP %s separate from the backend body code', async (status) => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 123, token: 'private-token' }, { status })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        await expect(requestQq('login_qr_key')).rejects.toMatchObject({ httpStatus: status, cause: { code: 123 } });
    });
    // httpStatus 是 OnlineProviderError 自己的可选字段：构造时传入，别的 provider 不传就是 undefined。
    it('takes the HTTP status through the OnlineProviderError constructor', async () => {
        const { OnlineProviderError } = await import('@/types/onlineMusic');
        const error = new OnlineProviderError('network', 'request failed', 'qq', { code: 123 }, 502);
        expect(error.httpStatus).toBe(502);
        expect(error.cause).toEqual({ code: 123 });
        expect(new OnlineProviderError('network', 'request failed', 'kugou').httpStatus).toBeUndefined();
    });
    // 429 退避的冷却时长交给调用方（core 的登录会话据此暂缓重试）：响应体的 retryAfterMs 优先，没有时读 Retry-After 秒数。
    it.each([
        ['the body', { code: 429, retryAfterMs: 24_999 }, {}, 24_999],
        ['the Retry-After header', { code: 429 }, { 'Retry-After': '25' }, 25_000],
        ['nowhere', { code: 429 }, {}, undefined],
        ['a malformed header', { code: 429 }, { 'Retry-After': 'soon' }, undefined],
    ])('reads the backend cooldown of a rejected request from %s', async (_source, body, headers, expected) => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status: 429, headers })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const error = await requestQq('login_qr_key').then(
            () => null,
            (failure: unknown) => failure as { httpStatus?: number; retryAfterMs?: number },
        );
        expect(error).toMatchObject({ httpStatus: 429 });
        expect(error?.retryAfterMs).toBe(expected);
    });
    beforeEach(() => {
        vi.resetModules();
        storage.clear();
        vi.stubEnv('VITE_QQ_API_BASE', 'https://qq.example.test');
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('reports unavailable when VITE_QQ_API_BASE is not configured', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        expect(getQqTransportAvailability()).toEqual({ configured: false, reason: 'not-configured' });
        await expect(requestQq('login_qr_key')).rejects.toMatchObject({ code: 'unavailable' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // 没配后端地址是持久的：播放侧显示「未配置」，而不是让用户反复重试。
    it('marks a missing VITE_QQ_API_BASE as a persistent configuration gap', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '');
        vi.stubGlobal('fetch', vi.fn());
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('music_play', { songmid: 'song-mid' }).catch((thrown: unknown) => thrown);
        expect(error).toMatchObject({ code: 'unavailable', providerId: 'qq' });
        expect(describeQqFailure('audio', error)).toEqual({ case: 'not-configured' });
    });

    // 500 正文只给 `{ error }`（后端 observability.js）：原文要交出去，否则诊断时只剩一个状态码。
    it('carries the backend error text of a 500 with the status', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json(
            { error: 'get-music-play failed: upstream reset' },
            { status: 500 },
        )));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('music_play', { songmid: 'song-mid', quality: 'flac' }).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({ code: 'network', httpStatus: 500 });
        // A plain 5xx is no refusal and no gap in the configuration: the shared rules read its status.
        expect(describeQqFailure('audio', error)).toEqual({ httpStatus: 500, message: 'get-music-play failed: upstream reset' });
    });

    // 登录态播放走 musicu：上游 HTTP 200 但带非零业务码时，后端的 QqProtocolError 一律包成 500 `{ error }`。
    // 上游其实应答了，这不是服务故障：是拒绝，带上游码。
    it.each([
        ['the request code', 'get-music-play failed (HTTP 200, global=0, code=104003)', '104003'],
        ['the global code when the request code is missing', 'get-music-play failed (HTTP 200, global=2000, code=unknown)', '2000'],
        ['no code when the answer has no request item', 'get-music-play failed (HTTP 200, global=0, code=unknown)', undefined],
    ])('reads an upstream business refusal wrapped in a 500 with %s', async (_label, backendText, code) => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: backendText }, { status: 500 })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('music_play', { songmid: 'song-mid', quality: 'flac' }).catch((thrown: unknown) => thrown);

        expect(describeQqFailure('audio', error)).toEqual({
            case: 'refused', httpStatus: 500, message: backendText, ...(code ? { code } : {}),
        });
    });

    // 3.2.0 起网关码与凭证拒绝码同时出现时改回 502，正文是同一个协议模板（GatewayCredentialConflictError）：
    // 仍是上游应答过的拒绝。新路由的 502 带 errorKey，不按这个模板认，按后端分的 kind：QQ 答了却拒绝的
    // （`upstream-business` 等）算平台拒绝；连不上 QQ 的（`network`、`upstream-http`）和没有 kind 的照旧按服务失败处理。
    it('reads the gateway/credential conflict 502 as an upstream refusal, and a new-route 502 by its kind', async () => {
        const backendText = 'get-music-play failed (HTTP 200, global=2000, code=1000)';
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(Response.json({ error: backendText }, { status: 502 }))
            .mockResolvedValueOnce(Response.json(
                { code: 502, kind: 'upstream-business', errorKey: 'upstream.unknown', message: backendText, retryable: false },
                { status: 502 },
            ))
            .mockResolvedValueOnce(Response.json(
                { code: 502, kind: 'network', errorKey: 'network.timeout', message: 'Upstream request timed out', retryable: true },
                { status: 502 },
            ))
            .mockResolvedValueOnce(Response.json(
                { code: 502, errorKey: 'upstream.unknown', message: 'Upstream rejected the request' },
                { status: 502 },
            )));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const legacy = await requestQq('music_play', { songmid: 'song-mid' }).catch((thrown: unknown) => thrown);
        expect(describeQqFailure('audio', legacy)).toMatchObject({ case: 'refused', code: '1000' });

        const newRoute = await requestQq('user_daily_songs').catch((thrown: unknown) => thrown);
        expect(newRoute).toMatchObject({ code: 'network', httpStatus: 502 });
        expect(describeQqFailure('collection', newRoute)).toMatchObject({ case: 'refused', httpStatus: 502 });

        const unreachable = await requestQq('user_daily_songs').catch((thrown: unknown) => thrown);
        expect(describeQqFailure('collection', unreachable)).not.toHaveProperty('case');

        const noKind = await requestQq('user_daily_songs').catch((thrown: unknown) => thrown);
        expect(describeQqFailure('collection', noKind)).not.toHaveProperty('case');
    });

    it.each([
        ['an axios failure', 'Request failed with status code 503'],
        ['a non-2xx upstream answer', 'get-music-play failed (HTTP 302, global=0, code=unknown)'],
    ])('keeps %s inside a 500 as a service failure', async (_label, backendText) => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: backendText }, { status: 500 })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('music_play', { songmid: 'song-mid' }).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({ code: 'network', httpStatus: 500 });
        expect(describeQqFailure('audio', error)).toEqual({ httpStatus: 500, message: backendText });
    });

    it('prefers the backend message over its error field and skips blank ones', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(Response.json({ message: 'primary text', error: 'secondary text' }, { status: 502 }))
            .mockResolvedValueOnce(Response.json({ message: '   ', error: 'secondary text' }, { status: 502 })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        expect(describeQqFailure('audio', await requestQq('login_status').catch((thrown: unknown) => thrown))).toMatchObject({ message: 'primary text' });
        expect(describeQqFailure('audio', await requestQq('login_status').catch((thrown: unknown) => thrown))).toMatchObject({ message: 'secondary text' });
    });

    // 501 是后端没配好这项能力（serverless 入口缺少配置）：再试也一样。
    it('marks a 501 as a persistent configuration gap while keeping the network code', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'QQ login is not configured' }, { status: 501 })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('music_play', { songmid: 'song-mid' }).catch((thrown: unknown) => thrown);
        expect(error).toMatchObject({ code: 'network', httpStatus: 501 });
        expect(describeQqFailure('audio', error)).toEqual({ case: 'not-configured', httpStatus: 501, message: 'QQ login is not configured' });
    });

    it('builds the documented endpoint URL with params and a cache-busting timestamp', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            code: 200,
            data: { qrimg: 'data:image/png;base64,fixture' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        expect(getQqTransportAvailability()).toEqual({ configured: true });
        await expect(requestQq('login_qr_create', { key: 'qr-key' })).resolves.toEqual({
            code: 200,
            data: { qrimg: 'data:image/png;base64,fixture' },
        });

        const requestUrl = new URL(fetchMock.mock.calls[0][0]);
        expect(requestUrl.origin).toBe('https://qq.example.test');
        expect(requestUrl.pathname).toBe('/login/qr/create');
        expect(requestUrl.searchParams.get('key')).toBe('qr-key');
        expect(Number(requestUrl.searchParams.get('timestamp'))).toBeGreaterThan(0);
        expect(requestUrl.searchParams.get('cookie')).toBeNull();
    });

    it('carries the login channel the caller passed and never invents one', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('login_qr_key', { channel: 'qq' });
        await requestQq('login_qr_key', { channel: 'wechat' });
        // No module-level default: an unspecified channel stays unspecified, so a stale choice
        // can never leak from one login dialog into the next.
        await requestQq('login_qr_key');
        await requestQq('login_status');

        const urls = fetchMock.mock.calls.map(call => new URL(call[0]));
        expect(urls[0].searchParams.get('channel')).toBe('qq');
        expect(urls[1].searchParams.get('channel')).toBe('wechat');
        expect(urls[2].searchParams.get('channel')).toBeNull();
        expect(urls[3].searchParams.get('channel')).toBeNull();
    });

    it('cancels a QR session on the documented keyed route', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_qr_cancel', { key: 'qr-key' })).resolves.toEqual({ code: 200 });

        const requestUrl = new URL(fetchMock.mock.calls[0][0]);
        expect(requestUrl.pathname).toBe('/login/qr/cancel');
        // 取消必须是 keyed 的：后端没有、也不该有全局清空的入口。
        expect(requestUrl.searchParams.get('key')).toBe('qr-key');
    });

    it('stores the opaque cookie verbatim on 803 and replays it as a query parameter', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({
                code: 803,
                message: 'Authorization login successful',
                cookie: CONFIRMED_COOKIE,
            }))
            .mockResolvedValueOnce(Response.json({
                code: 200,
                playlist: [{ tid: 7, dirName: '我喜欢' }],
                total: 1,
                more: false,
            }));
        vi.stubGlobal('fetch', fetchMock);
        const { hasQqSession, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('login_qr_check', { key: 'qr-key' });
        expect(storage.get('online_provider:qq:cookie')).toBe(CONFIRMED_COOKIE);
        expect(hasQqSession()).toBe(true);

        await expect(requestQq('user_playlist', { uid: '123' })).resolves.toMatchObject({
            playlist: [{ tid: 7, dirName: '我喜欢' }],
            total: 1,
            more: false,
        });

        const playlistUrl = new URL(fetchMock.mock.calls[1][0]);
        expect(playlistUrl.pathname).toBe('/user/playlist');
        expect(playlistUrl.searchParams.get('cookie')).toBe(CONFIRMED_COOKIE);
        expect(playlistUrl.searchParams.get('uid')).toBe('123');
        // The backend serves `Access-Control-Allow-Origin: *` without credentials, so cookies must not ride the request.
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit' });
        // 外部实例是跨源的：自定义头会触发 preflight，所以这条路径不带 header。
        expect(fetchMock.mock.calls[1][1]?.headers).toEqual({});
    });

    it('sends the session as a header when the base is same-origin, and as a query when it is not', async () => {
        // 同源部署（`VITE_QQ_API_BASE=/api/qq`）改走 header：sealed token 是密文本身，
        // query 是它唯一会被 CDN / edge access log 完整记下来的地方。
        vi.stubEnv('VITE_QQ_API_BASE', '/api/qq');
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('login_status');

        const [target, init] = fetchMock.mock.calls[0];
        // 相对 URL 要原样保留，前端不该替后端拼出一个绝对地址。
        expect(String(target).startsWith('/api/qq/login/status?')).toBe(true);
        // 后端 header 只收裸 token，`?cookie=` 收的才是整串 cookie —— 两者语义不同。
        expect(init?.headers).toEqual({ 'X-QQ-Session': 'opaque-token' });
        // 同源请求必须带上浏览器已取得的 Vercel protection cookie，否则 Preview 会被 SSO redirect。
        expect(init?.credentials).toBe('same-origin');
        expect(new URLSearchParams(String(target).split('?')[1]).get('cookie')).toBeNull();
    });

    it('drops an unrecognised same-origin session instead of putting it in the URL', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '/api/qq');
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        storage.set('online_provider:qq:cookie', 'not-a-session-cookie');
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('login_status');

        const [target, init] = fetchMock.mock.calls[0];
        expect(init?.headers).toEqual({});
        expect(new URLSearchParams(String(target).split('?')[1]).get('cookie')).toBeNull();
        expect(storage.has('online_provider:qq:cookie')).toBe(false);
    });

    it('exposes the backend channel declaration route', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            code: 200,
            data: { channels: ['wechat'], sessionMode: 'sealed', configured: true },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('login_channels');

        expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/login/channels');
    });

    it('puts playback, playlist, and song identifiers in documented path segments', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('music_play', { songmid: 'song-mid', quality: 'flac' });
        await requestQq('song_list_detail', { disstid: 9757480713 });
        await requestQq('song_info', { songmid: 'song-mid', songid: 42 });

        const urls = fetchMock.mock.calls.map(call => new URL(call[0]));
        expect(urls.map(url => url.pathname)).toEqual([
            '/getMusicPlay/song-mid',
            '/getSongListDetail/9757480713',
            '/getSongInfo/song-mid/42',
        ]);
        expect(urls[0].searchParams.get('quality')).toBe('flac');
        expect(urls[0].searchParams.get('songmid')).toBeNull();
        expect(urls[1].searchParams.get('disstid')).toBeNull();
        expect(urls[2].searchParams.get('songid')).toBeNull();
    });

    it('reads the favourite albums from the paged user route', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('user_albums', { offset: 20, limit: 20 });

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe('/user/albums');
        expect(url.searchParams.get('offset')).toBe('20');
        expect(url.searchParams.get('limit')).toBe('20');
    });

    // 专辑 / 歌手路由虽然声明了路径参数，但 controller 只读 `ctx.query`，
    // 走路径参数会被静默忽略，上游只会回 400。
    it('sends every album and artist identifier as a query parameter instead of a path segment', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('album_info', { albummid: '0016l2F430zMux' });
        await requestQq('artist_albums', { singermid: '0025NhlN2yWrP4', limit: 20, page: 40 });
        await requestQq('artist_songs', { singermid: '0025NhlN2yWrP4', limit: 20, page: 3 });

        const urls = fetchMock.mock.calls.map(call => new URL(call[0]));
        expect(urls.map(url => url.pathname)).toEqual([
            '/getAlbumInfo',
            '/getSingerAlbum',
            '/getSingerHotsong',
        ]);
        expect(urls[0].searchParams.get('albummid')).toBe('0016l2F430zMux');
        expect(urls[1].searchParams.get('singermid')).toBe('0025NhlN2yWrP4');
        expect(urls[1].searchParams.get('limit')).toBe('20');
        expect(urls[1].searchParams.get('page')).toBe('40');
        expect(urls[2].searchParams.get('singermid')).toBe('0025NhlN2yWrP4');
        expect(urls[2].searchParams.get('page')).toBe('3');
    });

    // 被上游拒收时 HTTP 仍是 200，状态码只在响应体里。放过它的代价是人工验收看到的那个现象：
    // 专辑页与歌手页全空，日志里没有任何一条错误，只能靠抓包才知道 id 传错了类型。
    it('surfaces an upstream rejection that arrives as HTTP 200', async () => {
        // 每次都新建 Response：body 只能读一次，复用同一个实例第二次会读成空。
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({
            response: { code: 1101, subcode: 1101, message: 'para error!' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('album_info', { albummid: '88971' })).rejects.toMatchObject({
            code: 'invalid-response',
            message: expect.stringContaining('1101'),
        });
        await expect(requestQq('album_info', { albummid: '88971' })).rejects.toThrow(/para error!/);
    });

    // 两条歌手路由的外层 code 恒为 0，真正的状态藏在 `response.singer.code` 里。
    it('surfaces a singer rejection nested below an all-clear envelope', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({
                response: { code: 0, singer: { code: 400, data: { songlist: [] } } },
            }))
            .mockResolvedValueOnce(Response.json({
                response: { code: 0, singer: { code: 104400, data: { albumList: [], total: 0 } } },
            }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('artist_songs', { singermid: '4286' })).rejects.toMatchObject({
            code: 'invalid-response',
            message: expect.stringContaining('response.singer'),
        });
        await expect(requestQq('artist_albums', { singermid: '4286' })).rejects.toThrow(/104400/);
    });

    it('lets an accepted catalog response through untouched', async () => {
        const body = {
            response: { code: 0, singer: { code: 0, data: { songlist: [], total_song: 0 } } },
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('artist_songs', { singermid: '0025NhlN2yWrP4' })).resolves.toEqual(body);
    });

    // 歌单详情的上游是匿名 CGI，被拒收时同样只在响应体里给码；不检查就会退化成一个空歌单。
    it('surfaces an upstream rejection on the playlist detail route', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({
            response: { code: 3, subcode: 3, message: 'no such diss', cdlist: [] },
        })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('song_list_detail', { disstid: '7' })).rejects.toMatchObject({
            code: 'invalid-response',
            message: expect.stringContaining('code 3'),
        });
    });

    // 登录路由用的是另一套码值（`login_status` 正常就回 200），不能被曲库那条规则误伤。
    it('leaves non-catalog operations out of the upstream status check', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 200, data: {} })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_status')).resolves.toEqual({ code: 200, data: {} });
    });

    it('rejects a missing required path parameter before issuing a request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('music_play')).rejects.toMatchObject({ code: 'invalid-response' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('passes pending and failed QR states through without storing a session', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ code: 801, message: 'Waiting for QR scan' }))
            .mockResolvedValueOnce(Response.json({ code: 802, message: 'QR code scanned' }))
            .mockResolvedValueOnce(Response.json({
                code: 800,
                message: 'QR login failed',
                upstreamCode: 50006,
                retryAfterMs: 31000,
            }));
        vi.stubGlobal('fetch', fetchMock);
        const { hasQqSession, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_qr_check', { key: 'qr-key' })).resolves.toMatchObject({ code: 801 });
        await expect(requestQq('login_qr_check', { key: 'qr-key' })).resolves.toMatchObject({ code: 802 });
        // The upstream safety number stays untranslated for the provider to surface.
        await expect(requestQq('login_qr_check', { key: 'qr-key' })).resolves.toMatchObject({
            code: 800,
            upstreamCode: 50006,
            retryAfterMs: 31000,
        });

        expect(storage.has('online_provider:qq:cookie')).toBe(false);
        expect(hasQqSession()).toBe(false);
    });

    it('returns the unauthenticated login status body instead of throwing', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, data: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_status')).resolves.toEqual({ code: 200, data: {} });
    });

    // 任何路由在 QQ 拒绝这一次调用时都回 401，不说明登录没了：问一次 login_status，它还认得这个用户，session 就留着。
    it('maps 401 to auth-required and keeps the stored session while login_status still names the user', async () => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const fetchMock = vi.fn(async (url: string) => (url.includes('/login/status')
            ? Response.json({ code: 200, data: { profile: { musicid: 123 } } })
            : Response.json({ code: 401, message: 'Login required' }, { status: 401 })));
        vi.stubGlobal('fetch', fetchMock);
        const { hasQqSession, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('user_detail')).rejects.toMatchObject({
            code: 'auth-required',
            providerId: 'qq',
        });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(storage.get('online_provider:qq:cookie')).toBe(CONFIRMED_COOKIE);
        expect(hasQqSession()).toBe(true);
    });

    // 登录在 Folia 开着时到期：第一次 401 后问一次 login_status，后端不再认出这个用户就清掉 session，之后的歌按游客播放。
    it('drops the session after a 401 once login_status no longer names the user, asking once at a time', async () => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const fetchMock = vi.fn(async (url: string) => (url.includes('/login/status')
            ? Response.json({ code: 200, data: {} })
            : Response.json({ code: 401, message: 'Login required' }, { status: 401 })));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await Promise.all(['a', 'b'].map(songmid => expect(requestQq('music_play', { songmid })).rejects.toMatchObject({ code: 'auth-required' })));
        await vi.waitFor(() => expect(storage.has('online_provider:qq:cookie')).toBe(false));
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/login/status'))).toHaveLength(1);
        await expect(requestQq('music_play', { songmid: 'c' })).rejects.toMatchObject({ code: 'auth-required' });
        expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('cookie=');
    });

    // login_status 自己的 401 不再问；401 时存着的已经换成别的 session，也不问。
    it('checks only after a 401 on another route, and only while the session sent is the one stored', async () => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        let answerRefusal: (() => void) | undefined;
        const fetchMock = vi.fn((url: string) => (url.includes('/getMusicPlay/held')
            ? new Promise<Response>(resolve => { answerRefusal = () => resolve(Response.json({}, { status: 401 })); })
            : Promise.resolve(Response.json({ code: 401 }, { status: 401 }))));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_status')).rejects.toMatchObject({ code: 'auth-required' });
        const refused = requestQq('music_play', { songmid: 'held' });
        await vi.waitFor(() => expect(answerRefusal).toBeTypeOf('function'));
        storage.set('online_provider:qq:cookie', 'qqmusic_session=signed-in-again');
        answerRefusal!();
        await expect(refused).rejects.toMatchObject({ code: 'auth-required' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        // A 401 with the session stored now is checked: login_status refuses it as well, and it goes.
        await expect(requestQq('music_play', { songmid: 'other' })).rejects.toMatchObject({ code: 'auth-required' });
        await vi.waitFor(() => expect(storage.has('online_provider:qq:cookie')).toBe(false));
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    // 主进程这次没读出加密的登录仓库（没有系统加密）：存着的 session 不带，按游客播放，session 留着。这次扫码登录时仓库把读不出的
    // 那份删掉（qqAuthSessionRepository 的 save），主进程从此答读得出：新 session 照常带，页面重新载入以后也带。
    it('does not send the stored session while the sign-in store is unreadable, but sends one signed in this run, also after a reload', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '');
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const backend = { storeUnreadable: true };
        const getQqApiStatus = vi.fn(async () => ({ status: 'running', port: 4000, error: null, sessionStoreUnreadable: backend.storeUnreadable }));
        vi.stubGlobal('window', { electron: { getQqPort: vi.fn().mockResolvedValue(4000), getQqApiStatus } });
        const fetchMock = vi.fn(async (url: string) => {
            if (!url.includes('/login/qr/check')) return Response.json({ code: 200, data: {} });
            backend.storeUnreadable = false;
            return Response.json({ code: 803, cookie: 'qqmusic_session=signed-in-now' });
        });
        vi.stubGlobal('fetch', fetchMock);
        const transport = await import('@/services/onlineMusic/qq/qqTransport');

        await transport.requestQq('login_status');
        expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('cookie=');
        expect(await transport.isQqSessionParked()).toBe(true);
        expect(transport.hasUsableQqSession()).toBe(false);
        expect(storage.get('online_provider:qq:cookie')).toBe(CONFIRMED_COOKIE);

        await transport.requestQq('login_qr_check', { key: 'k' });
        await transport.requestQq('login_status');
        expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(`cookie=${encodeURIComponent('qqmusic_session=signed-in-now')}`);
        expect(await transport.isQqSessionParked()).toBe(false);
        expect(transport.hasUsableQqSession()).toBe(true);

        // The page is loaded again in the same run (a renderer crash, a reopening without mods).
        vi.resetModules();
        const reloaded = await import('@/services/onlineMusic/qq/qqTransport');
        await reloaded.requestQq('login_status');
        expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(`cookie=${encodeURIComponent('qqmusic_session=signed-in-now')}`);
        expect(await reloaded.isQqSessionParked()).toBe(false);
    });

    it('maps upstream failures to a network error carrying the backoff body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(
            { code: 429, message: 'QR login is temporarily backed off', retryAfterMs: 31000 },
            { status: 429 },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_qr_key')).rejects.toMatchObject({
            code: 'network',
            providerId: 'qq',
            cause: { retryAfterMs: 31000 },
        });
    });

    // 旧后端没有新加的路由，回 404。那是「没有声明这个能力」，调用方要能回落而不是报网络错。
    it('maps a missing route to unsupported rather than a network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not Found' }, { status: 404 })));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('user_playlist_detail', { tid: '7', dirid: 2 })).rejects.toMatchObject({
            code: 'unsupported',
            providerId: 'qq',
        });
    });

    it('maps an unreadable body to invalid-response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_status')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('prefers the embedded Electron server over the configured Web base', async () => {
        const getQqPort = vi.fn().mockResolvedValue(45123);
        vi.stubGlobal('window', { electron: { getQqPort } });
        // A Response body can only be read once, so each call needs a fresh Response.
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
            Response.json({ code: 200, data: {} })
        ));
        vi.stubGlobal('fetch', fetchMock);
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        expect(getQqTransportAvailability()).toEqual({ configured: true });
        await requestQq('login_status');
        await requestQq('login_status');

        const [firstUrl] = fetchMock.mock.calls[0];
        expect(String(firstUrl)).toContain('http://127.0.0.1:45123/login/status');
        expect(String(firstUrl)).not.toContain('qq.example.test');
        // The resolved port is cached, so a second request does not cross the IPC bridge again.
        expect(getQqPort).toHaveBeenCalledTimes(1);
    });

    it('reports configured in Electron even before the embedded server finished starting', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '');
        const getQqPort = vi.fn().mockResolvedValue(null);
        vi.stubGlobal('window', { electron: { getQqPort } });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        expect(getQqTransportAvailability()).toEqual({ configured: true });
        await expect(requestQq('login_status')).rejects.toMatchObject({ code: 'unavailable' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // 内嵌后端没在监听可能只是还在启动：说本地服务没在跑，不说没配置。
    it('tells an embedded backend that is not running as the local service stopped', async () => {
        vi.stubGlobal('window', { electron: { getQqPort: vi.fn().mockResolvedValue(null) } });
        vi.stubGlobal('fetch', vi.fn());
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('music_play', { songmid: 'song-mid' }).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({ code: 'unavailable' });
        expect(describeQqFailure('audio', error)).toEqual({ case: 'local-service-stopped' });
    });

    it('hands on the backend message and its wait, but never the session cookie', async () => {
        storage.set('online_provider:qq:cookie', 'qqmusic_session=secret-session-token');
        const fetchMock = vi.fn().mockResolvedValue(Response.json(
            { code: 429, message: 'QR login is temporarily backed off', retryAfterMs: 30000 },
            { status: 429 },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('login_qr_key', { channel: 'qq' }).catch((thrown: Error) => thrown);

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ httpStatus: 429, retryAfterMs: 30000 });
        expect(describeQqFailure('audio', error)).toEqual({ httpStatus: 429, retryAfterMs: 30000, message: 'QR login is temporarily backed off' });
        expect((error as Error).message).not.toContain('secret-session-token');
    });

    it('tells an unreachable backend apart from a backend that answered with an error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('login_qr_check', { key: 'k' }).catch((thrown: unknown) => thrown);
        expect(describeQqFailure('audio', error)).toEqual({ case: 'unreachable' });
    });

    // 3.3.0 的写入路由只收 POST + JSON；会话照旧走 `?cookie=`（跨源）或 header（同源），后端两种都认。
    it('posts a JSON body to the write routes and keeps the session where the GET routes put it', async () => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, changed: true }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('user_playlist_tracks', {}, { tid: '70001', op: 'add', songs: [{ id: 101, type: 0 }] });

        const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const url = new URL(target);
        expect(url.pathname).toBe('/user/playlist/tracks');
        expect(url.searchParams.get('cookie')).toBe(CONFIRMED_COOKIE);
        expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' } });
        expect(JSON.parse(String(init.body))).toEqual({ tid: '70001', op: 'add', songs: [{ id: 101, type: 0 }] });
    });

    // 3.3.1 的红心与收藏专辑同样只收 POST + JSON。
    it('posts the like and album subscription writes to their documented routes', async () => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('user_song_like', {}, { song: { id: 101, mid: 'song-mid', type: 0 }, liked: true });
        await requestQq('user_album_subscribe', {}, { id: '000FixAlbum001', subscribed: false });

        const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
        expect(calls.map(([target]) => new URL(target).pathname)).toEqual(['/user/song/like', '/user/album/subscribe']);
        expect(calls.map(([, init]) => init.method)).toEqual(['POST', 'POST']);
        expect(JSON.parse(String(calls[0][1].body))).toEqual({ song: { id: 101, mid: 'song-mid', type: 0 }, liked: true });
        expect(JSON.parse(String(calls[1][1].body))).toEqual({ id: '000FixAlbum001', subscribed: false });
    });

    it('refuses to send the like and album subscription writes without a body', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('user_song_like')).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(requestQq('user_album_subscribe')).rejects.toMatchObject({ code: 'invalid-response' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends a same-origin write with the session header and no session in the URL', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '/api/qq');
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, subscribed: true }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQq('user_playlist_subscribe', {}, { tid: '70001', subscribed: true });

        const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(String(target).startsWith('/api/qq/user/playlist/subscribe?')).toBe(true);
        expect(String(target)).not.toContain('cookie=');
        expect(init).toMatchObject({
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-QQ-Session': 'opaque-token', 'Content-Type': 'application/json' },
        });
    });

    // 方法和正文要配对：读路由带正文、写路由不带正文都是调用方的错，不发请求。
    it('refuses a body on a read route and a write route without one', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('user_daily_songs', {}, { refresh: true })).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(requestQq('user_playlist_tracks')).rejects.toMatchObject({ code: 'invalid-response' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // 新路由的 message 是通用英文，真正说明失败类别的是 errorKey，上游数字码另放；两样都要交出去。
    // 应用里写入的失败不经过 describeQqFailure（omni 只为播放和读集合调用它），这里只看一个错怎么读。
    it('names the errorKey and upstream code of a new-route failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
            { code: 502, kind: 'upstream-business', errorKey: 'playlist.already-applied', message: 'Upstream rejected the request', retryable: false, upstreamCode: 80092 },
            { status: 502 },
        )));
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');
        const { describeQqFailure } = await import('@/services/onlineMusic/qq/qqFailure');

        const error = await requestQq('user_playlist_tracks', {}, { tid: '1', op: 'add', songs: [] }).catch((thrown: Error) => thrown);

        expect(error).toMatchObject({ code: 'network', httpStatus: 502 });
        expect(describeQqFailure('collection', error)).toEqual({
            case: 'refused', httpStatus: 502, upstreamCode: '80092', message: 'playlist.already-applied upstream 80092: Upstream rejected the request',
        });
    });

    it('says why the embedded server is not running', async () => {
        vi.stubEnv('VITE_QQ_API_BASE', '');
        const getQqApiStatus = vi.fn().mockResolvedValue({ status: 'error', port: null, error: 'listen: EADDRINUSE', updatedAt: 1 });
        vi.stubGlobal('window', { electron: { getQqPort: vi.fn().mockResolvedValue(null), getQqApiStatus } });
        const { requestQq } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQq('login_qr_key')).rejects.toMatchObject({
            code: 'unavailable',
            message: 'Embedded QQMusicApi is not running (status error: listen: EADDRINUSE)',
        });
    });
});

// 直发 musicu 的请求（按数字 songid 查歌、批量查歌）：不经 qq-music-api 后端，桌面端直连，网页版经同源的 /api/lyric-proxy。
describe('QQ musicu requests', () => {
    const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const RELAYED = '/api/lyric-proxy?url=https%3A%2F%2Fu.y.qq.com%2Fcgi-bin%2Fmusicu.fcg';
    const DETAIL = { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_type: 0, song_id: 97773 } };
    // QQ 的回答是 text/plain 的 JSON（实测）。
    const musicuAnswer = (body: unknown, init: ResponseInit = {}) => new Response(
        typeof body === 'string' ? body : JSON.stringify(body),
        { ...init, headers: { 'content-type': 'text/plain; charset=utf-8', ...(init.headers ?? {}) } },
    );
    const answered = () => vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => musicuAnswer({
        code: 0, ts: 1, q0: { code: 0, data: { track_info: { id: 97773, mid: '0039MnYb0qxYhV' } } },
    }));
    const failureOf = (promise: Promise<unknown>) => promise.then(
        () => null,
        (failure: unknown) => failure as { code?: string; httpStatus?: number; retryAfterMs?: number; cause?: unknown; message?: string },
    );

    beforeEach(() => {
        vi.resetModules();
        storage.clear();
        // 这条路不看后端地址：两者都没有时也照发。
        vi.stubEnv('VITE_QQ_API_BASE', '');
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('posts straight to musicu on the desktop, without credentials and without the embedded backend', async () => {
        vi.stubGlobal('window', { electron: {} });
        const fetchMock = answered();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQqMusicu({ q0: DETAIL })).resolves.toEqual({
            q0: { code: 0, data: { track_info: { id: 97773, mid: '0039MnYb0qxYhV' } } },
        });
        const [target, init] = fetchMock.mock.calls[0];
        expect(String(target)).toBe(MUSICU);
        expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' } });
        expect(JSON.parse(String(init?.body))).toEqual({ comm: { ct: 24, cv: 0 }, q0: DETAIL });
        expect(JSON.parse(String(init?.body)).q0.param.song_id).toBe(97773);
    });

    it('posts through the same-origin lyric relay on the web, without VITE_QQ_API_BASE', async () => {
        const fetchMock = answered();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQqMusicu({ q0: DETAIL });
        const [target, init] = fetchMock.mock.calls[0];
        expect(String(target)).toBe(RELAYED);
        expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
        expect(JSON.parse(String(init?.body))).toEqual({ comm: { ct: 24, cv: 0 }, q0: DETAIL });
    });

    it.each([
        ['the desktop', { electron: {} }],
        ['the web', undefined],
    ])('never carries the stored session on %s', async (_where, windowValue) => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        if (windowValue) vi.stubGlobal('window', windowValue);
        const fetchMock = answered();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await requestQqMusicu({ q0: DETAIL });
        const [target, init] = fetchMock.mock.calls[0];
        expect(String(target)).not.toContain('cookie=');
        expect(String(target)).not.toContain('opaque-token');
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(String(init?.body)).not.toContain('opaque-token');
    });

    it('hands back each asked key as its code and data, and nothing else', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => musicuAnswer({
            code: 0,
            ts: 1,
            q0: { code: 404, data: { track_info: { mid: '' } } },
            q1: { code: '0', data: { track_info: { mid: 'x' } } },
            q2: { code: null },
            q9: { code: 0, data: { extra: true } },
        })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQqMusicu({ q0: DETAIL, q1: DETAIL, q2: DETAIL, q3: DETAIL })).resolves.toEqual({
            q0: { code: 404, data: { track_info: { mid: '' } } },
            q1: { code: 0, data: { track_info: { mid: 'x' } } },
            q2: { code: undefined, data: undefined },
            q3: { code: undefined, data: undefined },
        });
    });

    it('reads a failed fetch as network, with the error as its cause', async () => {
        const unreachable = new TypeError('Failed to fetch');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(unreachable));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        const error = await failureOf(requestQqMusicu({ q0: DETAIL }));
        expect(error).toMatchObject({ code: 'network', cause: unreachable });
        expect(error?.message).toBe('QQ musicu unreachable: Failed to fetch');
        expect(error?.httpStatus).toBeUndefined();
    });

    it('gives up after its time limit and aborts the request', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        }));
        const { requestQqMusicu, QQ_MUSICU_REQUEST_LIMIT_MS } = await import('@/services/onlineMusic/qq/qqTransport');
        const { OnlineRequestTimeout } = await import('@/services/onlineMusic/failure/onlineRequestLimit');
        expect(QQ_MUSICU_REQUEST_LIMIT_MS).toBe(20_000);

        const pending = failureOf(requestQqMusicu({ q0: DETAIL }));
        await vi.advanceTimersByTimeAsync(QQ_MUSICU_REQUEST_LIMIT_MS - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        const error = await pending;
        expect(error).toBeInstanceOf(OnlineRequestTimeout);
        expect(error).toMatchObject({ code: 'network' });
        expect(signal?.aborted).toBe(true);
    });

    it('reads a 429 as network with its status, and the wait a Retry-After asks for', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(musicuAnswer('', { status: 429 }))
            .mockResolvedValueOnce(musicuAnswer('', { status: 429, headers: { 'Retry-After': '25' } })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        const bare = await failureOf(requestQqMusicu({ q0: DETAIL }));
        expect(bare).toMatchObject({ code: 'network', httpStatus: 429 });
        expect(bare?.retryAfterMs).toBeUndefined();
        const waiting = await failureOf(requestQqMusicu({ q0: DETAIL }));
        expect(waiting).toMatchObject({ code: 'network', httpStatus: 429, retryAfterMs: 25_000 });
    });

    it("keeps the status of a direct 500, which is QQ's own", async () => {
        vi.stubGlobal('window', { electron: {} });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(musicuAnswer('', { status: 500 })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQqMusicu({ q0: DETAIL })).rejects.toMatchObject({
            code: 'network', httpStatus: 500, message: 'QQ musicu request failed: 500',
        });
    });

    it.each([500, 502])("drops the status of the web relay's own %s", async (status) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Proxy request failed' }, { status })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        const error = await failureOf(requestQqMusicu({ q0: DETAIL }));
        expect(error).toMatchObject({ code: 'network', message: `QQ musicu request failed: ${status}` });
        expect(error?.httpStatus).toBeUndefined();
    });

    // 只托管静态文件、没有 /api/lyric-proxy 的部署：是连不上，不是「这条路由没有」。
    it('reads a web 404 as network with its status, not as unsupported', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQqMusicu({ q0: DETAIL })).rejects.toMatchObject({ code: 'network', httpStatus: 404 });
    });

    it('reads an HTML page as invalid-response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>', {
            headers: { 'content-type': 'text/html' },
        })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        await expect(requestQqMusicu({ q0: DETAIL })).rejects.toMatchObject({ code: 'invalid-response' });
    });

    // 实测：一次超过 30 个子请求时，整次和各子请求都是 { code: 500000 }，没有 data。
    it('reads a refused call as invalid-response with its code', async () => {
        const requests = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`q${index}`, DETAIL]));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(musicuAnswer({
            code: 500000,
            ts: 1,
            start_ts: 1,
            traceid: 't',
            ...Object.fromEntries(Object.keys(requests).map(key => [key, { code: 500000 }])),
        })));
        const { requestQqMusicu } = await import('@/services/onlineMusic/qq/qqTransport');

        const error = await failureOf(requestQqMusicu(requests));
        expect(error).toMatchObject({ code: 'invalid-response', cause: { code: 500000 } });
        expect(error?.message).toContain('500000');
    });
});
