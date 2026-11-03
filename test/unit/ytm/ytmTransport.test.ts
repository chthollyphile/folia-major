import { afterEach, describe, expect, it, vi } from 'vitest';
import { getYtmTransportAvailability, requestYtm } from '@/services/onlineMusic/ytm/ytmTransport';

// test/unit/ytm/ytmTransport.test.ts

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('YouTube Music transport', () => {
    it('is unavailable outside the desktop app, which hides the provider on the web build', async () => {
        expect(getYtmTransportAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
        vi.stubGlobal('window', { electron: {} });
        expect(getYtmTransportAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
        await expect(requestYtm('login_status')).rejects.toMatchObject({ code: 'unavailable', providerId: 'ytm' });
    });

    it('returns the bridge data and turns a bridge error into a provider error with its code', async () => {
        const ytmRequest = vi.fn()
            .mockResolvedValueOnce({ ok: true, data: { items: [] } })
            .mockResolvedValueOnce({ ok: true, data: { items: [1] } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'auth-required', message: 'Sign in to YouTube Music' } });
        vi.stubGlobal('window', { electron: { ytmRequest } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(getYtmTransportAvailability()).toEqual({ configured: true });
        expect(await requestYtm('playlist', { id: 'LM' })).toEqual({ items: [] });
        expect(await requestYtm('playlist', { id: 'LM' })).toEqual({ items: [1] });
        expect(log.mock.calls).toEqual([['[Ytm] playlist returned no items']]);
        expect(ytmRequest).toHaveBeenCalledWith('playlist', { id: 'LM' });
        await expect(requestYtm('playlist', { id: 'LM' })).rejects.toMatchObject({
            name: 'OnlineProviderError', code: 'auth-required', message: 'Sign in to YouTube Music', providerId: 'ytm',
        });
        // Only the failure is logged, with the operation and the bridge's code.
        expect(warn.mock.calls).toEqual([[expect.stringMatching(/^\[Ytm\] playlist failed after \d+ms: auth-required \(Sign in to YouTube Music\)$/)]]);
    });

    it('reports a broken IPC call as a network error', async () => {
        vi.stubGlobal('window', { electron: { ytmRequest: vi.fn().mockRejectedValue(new Error('channel closed')) } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(requestYtm('search_songs', { query: 'x' })).rejects.toMatchObject({ code: 'network', providerId: 'ytm' });
        expect(warn).toHaveBeenCalledWith('[Ytm] search_songs did not reach the desktop app');
    });
});
