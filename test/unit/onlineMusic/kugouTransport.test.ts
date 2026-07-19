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

    it('prefers Electron IPC and returns its raw body', async () => {
        const kugouRequest = vi.fn().mockResolvedValue({ status: 1, url: ['https://example.test/song.mp3'] });
        vi.stubGlobal('window', { electron: { kugouRequest } });
        const { requestKugou } = await import('@/services/onlineMusic/kugouTransport');

        await expect(requestKugou('song_url', { hash: 'HASH', quality: '128' })).resolves.toEqual({
            status: 1, url: ['https://example.test/song.mp3'],
        });
        expect(kugouRequest).toHaveBeenCalledWith('song_url', { hash: 'HASH', quality: '128' });
    });

    it('registers a fresh dfid and retries when an audio URL request requires verification', async () => {
        vi.stubGlobal('window', undefined);
        const { requestKugou } = await import('@/services/onlineMusic/kugouTransport');
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
    });

    it('uses the dedicated KRM metadata endpoint on Web', async () => {
        vi.stubGlobal('window', undefined);
        storage.set('online_provider:kugou:dfid', 'device');
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 1, data: [] }));
        vi.stubGlobal('fetch', fetchMock);
        const { requestKugou } = await import('@/services/onlineMusic/kugouTransport');

        await requestKugou('krm_audio', {
            album_audio_id: '42', fields: 'album_info,authors.base,base,audio_info',
        });

        const requestUrl = new URL(fetchMock.mock.calls[0][0]);
        expect(requestUrl.pathname).toBe('/krm/audio');
        expect(requestUrl.searchParams.get('album_audio_id')).toBe('42');
    });

    it('does not fall back to Web after an Electron IPC failure', async () => {
        const ipcError = new Error('ipc failed');
        const kugouRequest = vi.fn().mockRejectedValue(ipcError);
        const fetchMock = vi.fn();
        vi.stubGlobal('window', { electron: { kugouRequest } });
        vi.stubGlobal('fetch', fetchMock);
        const { requestKugou } = await import('@/services/onlineMusic/kugouTransport');

        await expect(requestKugou('search', { keywords: 'song' })).rejects.toBe(ipcError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports unavailable when neither transport is configured', async () => {
        vi.stubGlobal('window', undefined);
        vi.stubEnv('VITE_KUGOU_API_BASE', '');
        const { getKugouTransportAvailability, requestKugou } = await import('@/services/onlineMusic/kugouTransport');

        expect(getKugouTransportAvailability()).toEqual({ configured: false, reason: 'not-configured' });
        await expect(requestKugou('search', { keywords: 'song' })).rejects.toMatchObject({ code: 'unavailable' });
    });
});
