import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAddToAppleMusicPlaylist, updateAppleMusicPlaylistTracks } from '../../../src/services/onlineMusic/appleMusic/appleMusicData';
import { normalizeAppleMusicPlaylist, normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';

// Appending uses validated catalog IDs and fresh server permissions; no personal playlists are changed.
const require = createRequire(import.meta.url);
const { validateRequest, requestExpression, createRequestDispatcher } = require('../../../electron/appleMusic/companionRequests.cjs');
const playlist = (attributes: Record<string, unknown> = {}) => normalizeAppleMusicPlaylist({
    id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true, ...attributes },
});
const message = (params: unknown = { playlistId: 'p.owned', catalogIds: ['123'] }) => validateRequest({ id: 'test', operation: 'addPlaylistTracks', params });
const run = (call: unknown, params?: unknown) => runInNewContext(requestExpression(message(params)), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
afterEach(() => vi.unstubAllGlobals());

describe('Apple Music playlist additions', () => {
    it('accepts bounded catalog or library song IDs and library playlist IDs only', () => {
        for (const params of [
            { playlistId: '../p.x', catalogIds: ['123'] }, { playlistId: 'pl.catalog', catalogIds: ['123'] },
            { playlistId: 'p.x', catalogIds: ['i.bad-id'] }, { playlistId: 'p.x', catalogIds: [] },
            { playlistId: 'p.x', catalogIds: Array(101).fill('123') },
        ]) expect(message(params)).toBeNull();
        expect(message({ playlistId: 'p.x', catalogIds: ['123', '123'] }).params.catalogIds).toEqual(['123']);
    });
    it('offers explicitly editable playlists but excludes favorites and missing permission', () => {
        expect(canAddToAppleMusicPlaylist(playlist())).toBe(true);
        for (const attrs of [{ canEdit: false }, { canEdit: undefined }, { isFavoritePlaylist: true }]) {
            expect(canAddToAppleMusicPlaylist(playlist(attrs))).toBe(false);
        }
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        expect(provider.capabilities.playlistTrackMutations).toBe(true);
        expect(provider.mutations?.canEditPlaylistTracks?.(playlist())).toBe(false);
    });
    it('resolves library rows before sending a single append request', async () => {
        const request = vi.fn(async () => ({ ok: true, data: {} }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const song = normalizeAppleMusicSong({ id: 'i.a', type: 'library-songs', attributes: { playParams: { catalogId: '123' } } });
        await updateAppleMusicPlaylistTracks('add', playlist(), [song, song]);
        expect(request).toHaveBeenCalledExactlyOnceWith('addPlaylistTracks', { playlistId: 'p.owned', catalogIds: ['123'] });
        await expect(updateAppleMusicPlaylistTracks('del', playlist(), [song])).rejects.toMatchObject({ code: 'unsupported' });
        expect(request).toHaveBeenCalledOnce();
    });
    // An upload has no catalog song: it goes into the playlist as the library song it is.
    it('appends an upload as a library song beside catalog songs', async () => {
        const request = vi.fn(async () => ({ ok: true, data: {} }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const upload = normalizeAppleMusicSong({ id: 'i.upload', type: 'library-songs', attributes: { playParams: { id: 'i.upload', isLibrary: true } } });
        const mapped = normalizeAppleMusicSong({ id: 'i.a', type: 'library-songs', attributes: { playParams: { catalogId: '123' } } });
        await updateAppleMusicPlaylistTracks('add', playlist(), [upload, mapped]);
        expect(request).toHaveBeenCalledExactlyOnceWith('addPlaylistTracks', { playlistId: 'p.owned', catalogIds: ['i.upload', '123'] });
        const call = vi.fn().mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true } }] } }).mockResolvedValueOnce({ status: 204 });
        await expect(run(call, { playlistId: 'p.owned', catalogIds: ['i.upload', '123'] })).resolves.toMatchObject({ ok: true });
        expect(call).toHaveBeenNthCalledWith(2, 'v1/me/library/playlists/p.owned/tracks', { representation: 'resources' }, {
            method: 'POST', body: JSON.stringify({ data: [{ id: 'i.upload', type: 'library-songs' }, { id: '123', type: 'songs' }] }),
        });
    });
    it('reports a refusal MusicKit throws as the status it carries, not a lost request', async () => {
        const owned = { status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true } }] } };
        const refused = vi.fn().mockResolvedValueOnce(owned).mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 400 }));
        await expect(run(refused)).resolves.toMatchObject({ ok: false, error: 'upstream-error', httpStatus: 400 });
        const lost = vi.fn().mockResolvedValueOnce(owned).mockRejectedValueOnce(new Error('offline'));
        await expect(run(lost)).resolves.toMatchObject({ ok: false, error: 'request-failed' });
    });
    it('rechecks permission then appends with the official resource body', async () => {
        const call = vi.fn().mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true } }] } }).mockResolvedValueOnce({ status: 204 });
        await expect(run(call)).resolves.toMatchObject({ ok: true });
        expect(call).toHaveBeenNthCalledWith(1, 'v1/me/library/playlists/p.owned', { extend: 'tags' });
        expect(call).toHaveBeenNthCalledWith(2, 'v1/me/library/playlists/p.owned/tracks', { representation: 'resources' }, {
            method: 'POST', body: JSON.stringify({ data: [{ id: '123', type: 'songs' }] }),
        });
    });
    it('sends a real append with the webpage flat method/body contract', async () => {
        let written = false;
        const call = vi.fn(async (path: string, _query: unknown, options?: { method?: string; body?: string }) => {
            if (!path.endsWith('/tracks')) return { status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true } }] } };
            if (options?.method === 'POST') {
                written = JSON.parse(options.body || '{}').data?.[0]?.id === '123';
                return { status: 204 };
            }
            // A mistaken GET can succeed without ever changing the playlist.
            return { status: 200, data: { data: [] } };
        });
        await expect(run(call)).resolves.toMatchObject({ ok: true });
        expect(written).toBe(true);
    });
    it.each([{ canEdit: false }, {}, { canEdit: true, tags: ['favorited'] }])('does not write when current server permission forbids it (%o)', async attributes => {
        const call = vi.fn(async () => ({ status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes }] } }));
        await expect(run(call)).resolves.toMatchObject({ ok: false, error: 'unsupported' });
        expect(call).toHaveBeenCalledOnce();
    });
    it.each([401, 403, 500])('does not report failed appends as success or retry them (%s)', async status => {
        const call = vi.fn().mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true } }] } }).mockResolvedValueOnce({ status });
        await expect(run(call)).resolves.toMatchObject({ ok: false, error: status === 401 ? 'auth-required' : 'upstream-error' });
        expect(call).toHaveBeenCalledTimes(2);
    });
    it('does not invite a startup retry when navigation obscures an already sent append', async () => {
        let generation = 0;
        let finish!: (value: unknown) => void;
        const pending = new Promise(resolve => { finish = resolve; });
        const contents = { isDestroyed: () => false, getURL: () => 'https://music.apple.com/cn/browse', executeJavaScript: vi.fn(() => pending) };
        const dispatch = createRequestDispatcher(() => contents, 1000, () => generation);
        const result = dispatch(message());
        await vi.waitFor(() => expect(contents.executeJavaScript).toHaveBeenCalledOnce());
        generation++;
        finish({ ok: true, data: {} });
        await expect(result).resolves.toMatchObject({ ok: false, error: 'request-failed' });
    });
    it('does not retry when the append response is lost after sending', async () => {
        const call = vi.fn().mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'p.owned', type: 'library-playlists', attributes: { canEdit: true } }] } }).mockRejectedValueOnce(new Error('private response'));
        await expect(run(call)).resolves.toEqual({ ok: false, error: 'request-failed' });
        expect(call).toHaveBeenCalledTimes(2);
    });
});
