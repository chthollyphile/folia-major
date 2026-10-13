import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestBodian } from '@/services/onlineMusic/bodianTransport';
import { OnlineProviderError } from '@/types/onlineMusic';

// test/unit/onlineMusic/bodianTransport.test.ts

afterEach(() => vi.unstubAllGlobals());

// 取出 requestBodian 的拒绝值；意外 resolve 时让用例失败。
const rejectionOf = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error('expected requestBodian to reject'); },
    (caught: unknown) => caught as OnlineProviderError,
);

describe('Bodian page-size adaptation', () => {
    it.each([150, 1000])('bounds the GridView batch of %s while preserving its physical cursor', async limit => {
        const data = { list: [{ id: 1 }], bodianPagination: { nextOffset: 200, hasMore: true } };
        const bodianRequest = vi.fn().mockResolvedValue({ ok: true, data });
        vi.stubGlobal('window', { electron: { bodianRequest } });
        expect(await requestBodian('playlist_tracks', { id: '123', limit, offset: 100, source: 5 })).toEqual(data);
        expect(bodianRequest).toHaveBeenCalledWith('playlist_tracks', { id: '123', limit: 100, offset: 100, source: 5 });
    });
});

describe('Bodian transport failures', () => {
    it('reports a missing desktop bridge as a persistent unavailable runtime', async () => {
        vi.stubGlobal('window', { electron: {} });
        const error = await rejectionOf(requestBodian('audio', { id: '1' }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({ code: 'unavailable', providerId: 'bodian', details: { stage: 'runtime', transient: false } });
    });

    it('reports a rejected IPC call as a local unavailable failure and keeps the cause', async () => {
        const ipcFailure = new Error('IPC channel closed');
        vi.stubGlobal('window', { electron: { bodianRequest: vi.fn().mockRejectedValue(ipcFailure) } });
        const error = await rejectionOf(requestBodian('audio', { id: '1' }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({ code: 'unavailable', providerId: 'bodian', details: { stage: 'ipc' } });
        expect(error.cause).toBe(ipcFailure);
        // IPC 故障的持久与否证实不了，不写 transient。
        expect(error.details?.transient).toBeUndefined();
    });

    it.each([
        [{ code: 'network', message: 'Bodian request timed out' }, { code: 'timeout' }],
        [{ code: 'network', message: 'Bodian HTTP 503' }, { code: 'network', httpStatus: 503 }],
        [{ code: 'not-playable', message: 'Bodian requires additional playback rights' }, { code: 'entitlement-required' }],
        [{ code: 'auth-required', message: 'Bodian rejected the request (code 11012)' },
            { code: 'auth-required', details: { auth: 'expired', upstreamCode: 11012 } }],
        [{ code: 'region-restricted', message: '由于版权保护，该资源仅限中国大陆地区使用' },
            { code: 'region-restricted', message: '由于版权保护，该资源仅限中国大陆地区使用' }],
    ])('maps the package error %j through the Bodian error table', async (bridgeError, expected) => {
        vi.stubGlobal('window', { electron: { bodianRequest: vi.fn().mockResolvedValue({ ok: false, error: bridgeError }) } });
        const error = await rejectionOf(requestBodian('audio', { id: '1' }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({ providerId: 'bodian', ...expected });
    });

    it('keeps auth-required for library sign-in failures so session cleanup still runs', async () => {
        const bridgeError = { code: 'auth-required', message: 'Bodian sign-in is required' };
        vi.stubGlobal('window', { electron: { bodianRequest: vi.fn().mockResolvedValue({ ok: false, error: bridgeError }) } });
        await expect(requestBodian('user_albums')).rejects.toMatchObject({ code: 'auth-required', message: 'Bodian sign-in is required' });
    });
});
