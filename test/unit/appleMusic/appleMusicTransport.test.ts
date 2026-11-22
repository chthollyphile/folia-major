// @builtin-sources
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../src/i18n/config';
import { requestAppleMusic } from '../../../sources/appleMusic/client/appleMusicTransport';
import { freshAppleMusicProvider, stubAppleMusicBridge } from '../helpers/appleMusicSource';

// The renderer must receive common provider errors, not companion protocol details or credentials.
let off: (() => void) | null = null;
afterEach(() => { off?.(); off = null; vi.unstubAllGlobals(); });

describe('Apple Music transport', () => {
    it('returns the companion result through the main entry', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { items: [] } }));
        off = stubAppleMusicBridge(request);
        await expect(requestAppleMusic('search', { query: 'example' })).resolves.toEqual({ items: [] });
        expect(request).toHaveBeenCalledWith('search', { query: 'example' });
    });

    it('maps authentication and malformed-response errors to the common contract', async () => {
        off = stubAppleMusicBridge(vi.fn(async () => ({ ok: false, error: 'auth-required' })));
        await expect(requestAppleMusic('playlists')).rejects.toMatchObject({ code: 'auth-required', cause: 'auth-required' });
        // Through the host's provider the error names the source.
        await expect(freshAppleMusicProvider().library!.getUserPlaylists!('', 20, 0)).rejects.toMatchObject({ code: 'auth-required', providerId: 'appleMusic' });
        off = stubAppleMusicBridge(vi.fn(async () => ({ ok: false, error: 'invalid-response' })));
        await expect(requestAppleMusic('playlists')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('includes only allowlisted playback stages in failures', async () => {
        const request = vi.fn(async (): Promise<unknown> => ({ ok: false, error: 'playback-failed', playbackStage: 'play' }));
        off = stubAppleMusicBridge(request);
        await expect(requestAppleMusic('playSong')).rejects.toMatchObject({ code: 'not-playable', cause: 'playback-failed', message: 'Apple Music companion request failed (stage: play)' });
        request.mockResolvedValueOnce({ ok: false, error: 'playback-failed', playbackStage: 'private-url-or-token' });
        await expect(requestAppleMusic('playSong')).rejects.toMatchObject({ message: 'Apple Music companion request failed' });
    });

    it('reports a main entry that does not answer as a failed request', async () => {
        await expect(requestAppleMusic('accountStatus')).rejects.toMatchObject({ code: 'network' });
    });
});

describe('Apple Music availability', () => {
    it('offers the source on Windows and macOS only', () => {
        expect(freshAppleMusicProvider({ platform: 'win32' }).getAvailability!()).toEqual({ configured: true });
        expect(freshAppleMusicProvider({ platform: 'darwin' }).getAvailability!()).toEqual({ configured: true });
        const linux = freshAppleMusicProvider({ platform: 'linux' }).getAvailability!();
        expect(linux).toMatchObject({ configured: false, reason: 'not-configured' });
        // The message is the mod's own text, followed across languages.
        expect(linux.messageKey).toBeTruthy();
        expect(i18n.t(linux.messageKey!)).not.toBe(linux.messageKey);
        expect(freshAppleMusicProvider({ platform: 'unknown' }).getAvailability!()).toMatchObject({ configured: false, reason: 'runtime-unavailable' });
        freshAppleMusicProvider();
    });
});
