import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqTransport.test.ts

const storage = new Map<string, string>();

// Opaque backend session string; qq-music-api hands back the whole `qqmusic_session=<token>` cookie on 803.
const CONFIRMED_COOKIE = 'qqmusic_session=opaque-token';

describe('QQ Music Web transport', () => {
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
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qqTransport');

        expect(getQqTransportAvailability()).toEqual({ configured: false, reason: 'not-configured' });
        await expect(requestQq('login_qr_key')).rejects.toMatchObject({ code: 'unavailable' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('builds the documented endpoint URL with params and a cache-busting timestamp', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            code: 200,
            data: { qrimg: 'data:image/png;base64,fixture' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qqTransport');

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

    it('adds the selected login channel only to QR key requests', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const {
            getQqLoginChannel,
            requestQq,
            setQqLoginChannel,
        } = await import('@/services/onlineMusic/qqTransport');

        expect(getQqLoginChannel()).toBe('mobile');
        await requestQq('login_qr_key');
        setQqLoginChannel('wechat');
        expect(getQqLoginChannel()).toBe('wechat');
        await requestQq('login_qr_key');
        await requestQq('login_status');

        const urls = fetchMock.mock.calls.map(call => new URL(call[0]));
        expect(urls[0].searchParams.get('channel')).toBe('mobile');
        expect(urls[1].searchParams.get('channel')).toBe('wechat');
        expect(urls[2].searchParams.get('channel')).toBeNull();
        setQqLoginChannel('mobile');
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
        const { hasQqSession, requestQq } = await import('@/services/onlineMusic/qqTransport');

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
    });

    it('puts playback, playlist, and song identifiers in documented path segments', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qqTransport');

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

    it('rejects a missing required path parameter before issuing a request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qqTransport');

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
        const { hasQqSession, requestQq } = await import('@/services/onlineMusic/qqTransport');

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
        const { requestQq } = await import('@/services/onlineMusic/qqTransport');

        await expect(requestQq('login_status')).resolves.toEqual({ code: 200, data: {} });
    });

    it('maps 401 to auth-required and clears the stored session', async () => {
        storage.set('online_provider:qq:cookie', CONFIRMED_COOKIE);
        const fetchMock = vi.fn().mockResolvedValue(
            Response.json({ code: 401, message: 'Login required' }, { status: 401 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const { hasQqSession, requestQq } = await import('@/services/onlineMusic/qqTransport');

        await expect(requestQq('user_detail')).rejects.toMatchObject({
            code: 'auth-required',
            providerId: 'qq',
        });
        expect(storage.has('online_provider:qq:cookie')).toBe(false);
        expect(hasQqSession()).toBe(false);
    });

    it('maps upstream failures to a network error carrying the backoff body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json(
            { code: 429, message: 'QR login is temporarily backed off', retryAfterMs: 31000 },
            { status: 429 },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qqTransport');

        await expect(requestQq('login_qr_key')).rejects.toMatchObject({
            code: 'network',
            providerId: 'qq',
            cause: { retryAfterMs: 31000 },
        });
    });

    it('maps an unreadable body to invalid-response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qqTransport');

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
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qqTransport');

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
        const { getQqTransportAvailability, requestQq } = await import('@/services/onlineMusic/qqTransport');

        expect(getQqTransportAvailability()).toEqual({ configured: true });
        await expect(requestQq('login_status')).rejects.toMatchObject({ code: 'unavailable' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps QR keys and session cookies out of error messages', async () => {
        storage.set('online_provider:qq:cookie', 'qqmusic_session=secret-session-token');
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 502 }, { status: 502 }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestQq } = await import('@/services/onlineMusic/qqTransport');

        const error = await requestQq('login_qr_check', { key: 'secret-qr-key' }).catch((thrown: Error) => thrown);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('QQMusicApi request failed: 502');
        expect((error as Error).message).not.toContain('secret-qr-key');
        expect((error as Error).message).not.toContain('secret-session-token');
    });
});
