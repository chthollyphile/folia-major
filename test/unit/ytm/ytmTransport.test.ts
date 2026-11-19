import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestYtm, ytmReasonOf } from '../../../sources/ytm/client/ytmTransport';
import { setBuiltinSourceRpc } from '../helpers/builtinSources';
import { lazyYtmProvider } from '../helpers/ytmSource';
// @builtin-sources

// test/unit/ytm/ytmTransport.test.ts — the client's way to the main entry, through the registered source mod: folium.rpc's
// `request`, whose answer is the bridge's `{ ok, data }` or `{ ok: false, error }`. (The mod runs in the desktop app
// only: the built-in provider's "no bridge on the web build" has no counterpart.)

const ytmProvider = lazyYtmProvider();

afterEach(() => {
    vi.restoreAllMocks();
});

describe('YouTube Music transport', () => {
    it('returns the bridge data and turns a bridge error into the host’s error with its code', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce({ ok: true, data: { items: [] } })
            .mockResolvedValueOnce({ ok: true, data: { items: [1] } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'auth-required', message: 'Sign in to YouTube Music' } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'auth-required', message: 'Sign in to YouTube Music' } });
        const off = setBuiltinSourceRpc('ytm', { request });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(await requestYtm('playlist', { id: 'LM' })).toEqual({ items: [] });
        expect(await requestYtm('playlist', { id: 'LM' })).toEqual({ items: [1] });
        expect(log.mock.calls).toEqual([['[Ytm] playlist returned no items']]);
        expect(request).toHaveBeenCalledWith('playlist', { id: 'LM' });
        await expect(requestYtm('playlist', { id: 'LM' })).rejects.toMatchObject({ code: 'auth-required', message: 'Sign in to YouTube Music' });
        // Through the host, the error names the source.
        await expect(ytmProvider.search!.searchSongs('fixture', 30, 0)).rejects.toMatchObject({
            name: 'OnlineProviderError', code: 'auth-required', message: 'Sign in to YouTube Music', providerId: 'ytm',
        });
        // Only the failure is logged, with the operation and the bridge's code.
        expect(warn.mock.calls.filter(([line]) => String(line).startsWith('[Ytm]'))).toEqual([
            [expect.stringMatching(/^\[Ytm\] playlist failed after \d+ms: auth-required \(Sign in to YouTube Music\)$/)],
            [expect.stringMatching(/^\[Ytm\] search_songs failed after \d+ms: auth-required \(Sign in to YouTube Music\)$/)],
        ]);
        off();
    });

    it('keeps the desktop side’s reason on the error, and reads a code the host does not know as invalid-response', async () => {
        const off = setBuiltinSourceRpc('ytm', { request: vi.fn()
            .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'The browser ended', reason: 'exited' } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'something-new', message: 'New' } }) });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failed = await requestYtm('web_login_start').catch((error: unknown) => error);
        expect(failed).toMatchObject({ code: 'network', message: 'The browser ended' });
        expect(ytmReasonOf(failed)).toBe('exited');
        await expect(requestYtm('login_status')).rejects.toMatchObject({ code: 'invalid-response', message: 'New' });
        expect(ytmReasonOf(new Error('x'))).toBeNull();
        off();
    });

    it('reports a broken call to the main entry as a network error', async () => {
        const off = setBuiltinSourceRpc('ytm', { request: vi.fn().mockRejectedValue(new Error('channel closed')) });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(requestYtm('search_songs', { query: 'x' })).rejects.toMatchObject({ code: 'network' });
        expect(warn).toHaveBeenCalledWith('[Ytm] search_songs did not reach the desktop app', expect.any(Error));
        off();
    });
});
