import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/kugouTransport.test.ts

const storage = new Map<string, string>();

describe('KuGou Web transport', () => {
    beforeEach(() => {
        vi.resetModules();
        storage.clear();
        vi.stubEnv('VITE_KUGOU_API_BASE', 'https://kugou.example.test');
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

    it('logs Electron IPC playback requests in the renderer console', async () => {
        const kugouRequest = vi.fn().mockResolvedValue({ status: 1, url: ['https://example.test/song.mp3'] });
        vi.stubGlobal('window', { electron: { kugouRequest } });
        const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const { requestKugou } = await import('@/services/onlineMusic/kugouTransport');

        await requestKugou('song_url', { hash: 'HASH', quality: '128' });

        expect(infoLog).toHaveBeenCalledWith('[KuGouTransport] ipc:start', expect.objectContaining({
            operation: 'song_url',
            params: expect.objectContaining({ hash: 'HASH', quality: '128' }),
        }));
        expect(infoLog).toHaveBeenCalledWith('[KuGouTransport] ipc:success', expect.objectContaining({
            operation: 'song_url', audioUrlCandidateCount: 1,
        }));
    });

    it('registers a fresh dfid and retries when an audio URL request requires verification', async () => {
        vi.stubGlobal('window', undefined);
        const { requestKugou } = await import('@/services/onlineMusic/kugouTransport');
        const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        storage.set('online_provider:kugou:dfid', 'stale-dfid');
        storage.set('online_provider:kugou:token', 'token');
        storage.set('online_provider:kugou:userid', '9');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ status: 0, errcode: 20028, error: '本次请求需要验证' }))
            .mockResolvedValueOnce(Response.json({ status: 1, data: { dfid: 'fresh-dfid' } }))
            .mockResolvedValueOnce(Response.json({ status: 1, url: ['https://example.test/song.mp3'] }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(requestKugou('song_url', { hash: 'HASH' })).resolves.toEqual({
            status: 1,
            url: ['https://example.test/song.mp3'],
        });

        expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe('/register/dev');
        const retriedUrl = new URL(fetchMock.mock.calls[2][0]);
        expect(retriedUrl.pathname).toBe('/song/url');
        expect(retriedUrl.searchParams.get('cookie')).toBe('dfid=fresh-dfid;token=token;userid=9');
        expect(warnLog).toHaveBeenCalledWith('[KuGouTransport] request:verification-required', expect.objectContaining({
            operation: 'song_url', errorCode: 20028,
        }));
        expect(infoLog).toHaveBeenCalledWith('[KuGouTransport] request:retry', expect.objectContaining({
            operation: 'song_url', reason: 'device-verification',
        }));
        expect(infoLog).toHaveBeenCalledWith('[KuGouTransport] request:complete', expect.objectContaining({
            operation: 'song_url', audioUrlCandidateCount: 1,
        }));
    });
});
