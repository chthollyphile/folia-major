import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppleMusicTransportAvailability, requestAppleMusic } from '../../../src/services/onlineMusic/appleMusic/appleMusicTransport';

// The renderer must receive common provider errors, not companion protocol details or credentials.
afterEach(() => { vi.unstubAllGlobals(); });

describe('Apple Music transport', () => {
    it('returns the companion result through its preload boundary', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { items: [] } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await expect(requestAppleMusic('search', { query: 'example' })).resolves.toEqual({ items: [] });
        expect(request).toHaveBeenCalledWith('search', { query: 'example' });
    });

    it('maps authentication and malformed-response errors to the common contract', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: false, error: 'auth-required' })) } });
        await expect(requestAppleMusic('playlists')).rejects.toMatchObject({ code: 'auth-required', providerId: 'appleMusic' });
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: false, error: 'invalid-response' })) } });
        await expect(requestAppleMusic('playlists')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('includes only allowlisted playback stages in failures', async () => {
        const request = vi.fn(async () => ({ ok: false, error: 'playback-failed', playbackStage: 'play' }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await expect(requestAppleMusic('playSong')).rejects.toMatchObject({ code: 'not-playable', cause: 'playback-failed', message: 'Apple Music companion request failed (stage: play)' });
        request.mockResolvedValueOnce({ ok: false, error: 'playback-failed', playbackStage: 'private-url-or-token' });
        await expect(requestAppleMusic('playSong')).rejects.toMatchObject({ message: 'Apple Music companion request failed' });
    });
    it('reports an absent desktop bridge without making a request', async () => {
        vi.stubGlobal('window', {});
        await expect(requestAppleMusic('accountStatus')).rejects.toMatchObject({ code: 'unavailable' });
    });
});

describe('Apple Music transport availability', () => {
    it('keeps Windows disabled until a development build explicitly opts in', () => {
        const request = vi.fn();
        vi.stubGlobal('window', { electron: { platform: 'win32', appleMusicRequest: request } });
        expect(getAppleMusicTransportAvailability()).toEqual({ configured: false, reason: 'not-configured', messageKey: 'home.appleMusicWindowsPending' });
        vi.stubGlobal('window', { electron: { platform: 'win32', appleMusicRequest: request, appleMusicWindowsExperimental: true } });
        expect(getAppleMusicTransportAvailability()).toEqual({ configured: true });
    });
    it('offers the source on macOS with the desktop bridge only', () => {
        const request = vi.fn();
        vi.stubGlobal('window', { electron: { platform: 'darwin', appleMusicRequest: request } });
        expect(getAppleMusicTransportAvailability()).toEqual({ configured: true });
        vi.stubGlobal('window', { electron: { platform: 'linux', appleMusicRequest: request } });
        expect(getAppleMusicTransportAvailability()).toEqual({ configured: false, reason: 'not-configured', messageKey: 'home.appleMusicLinuxUnsupported' });
        vi.stubGlobal('window', { electron: { platform: 'darwin' } });
        expect(getAppleMusicTransportAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
        vi.stubGlobal('window', {});
        expect(getAppleMusicTransportAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });
});
