import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppleMusicLikedSongIds, setAppleMusicSongLiked } from '../../../src/services/onlineMusic/appleMusic/appleMusicData';
import { normalizeAppleMusicPlaylist, normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';

// Favorite reads and writes use the real serialized request boundary without personal credentials.
const require = createRequire(import.meta.url);
const { validateRequest, requestExpression } = require('../../../electron/appleMusic/companionRequests.cjs');
afterEach(() => vi.unstubAllGlobals());

describe('Apple Music favorites', () => {
    it('accepts only a catalog or library song identity and an explicit boolean for writes', () => {
        for (const params of [{ catalogId: 'i.bad-id', liked: true }, { catalogId: 'l.album', liked: true }, { catalogId: '123', liked: 'true' }, { catalogId: '../123', liked: false }]) {
            expect(validateRequest({ id: 'test', operation: 'likeSong', params })).toBeNull();
        }
        expect(validateRequest({ id: 'test', operation: 'likeSong', params: { catalogId: 'i.library', liked: true } })).not.toBeNull();
    });
    // An upload has only a library id: favorited as a library song, or loved through its library rating
    // where the favorites endpoint does not take it (refused with a status, or by throwing).
    const runLike = (call: unknown, catalogId: string, liked: boolean) => runInNewContext(
        requestExpression(validateRequest({ id: 'test', operation: 'likeSong', params: { catalogId, liked } })),
        { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
    it('favorites an upload as a library song', async () => {
        const call = vi.fn(async () => ({ status: 202 }));
        await expect(runLike(call, 'i.upload', true)).resolves.toMatchObject({ ok: true, data: { route: 'favorites' } });
        expect(call).toHaveBeenCalledExactlyOnceWith('v1/me/favorites', { 'ids[library-songs]': 'i.upload' }, { method: 'POST' });
    });
    it.each([
        ['a refusal', async () => ({ status: 400 })],
        ['a thrown refusal', async () => { throw Object.assign(new Error('bad'), { status: 400 }); }],
    ])('loves an upload by its library rating after %s from favorites', async (_name, favorites: () => Promise<unknown>) => {
        const call = vi.fn(async (path: string) => path === 'v1/me/favorites' ? favorites() : { status: 204 });
        await expect(runLike(call, 'i.upload', true)).resolves.toMatchObject({ ok: true, data: { route: 'rating' } });
        expect(call).toHaveBeenLastCalledWith('v1/me/ratings/library-songs/i.upload', {}, {
            method: 'PUT', body: JSON.stringify({ type: 'rating', attributes: { value: 1 } }),
        });
    });
    it('clears the rating too when unliking an upload the favorites endpoint took', async () => {
        const call = vi.fn(async (path: string) => ({ status: path === 'v1/me/favorites' ? 204 : 404 }));
        await expect(runLike(call, 'i.upload', false)).resolves.toMatchObject({ ok: true, data: { route: 'favorites' } });
        expect(call).toHaveBeenLastCalledWith('v1/me/ratings/library-songs/i.upload', {}, { method: 'DELETE' });
    });
    it.each([429, 500, undefined])('reports a favorites failure (%s) for an upload instead of trying its rating', async status => {
        const call = vi.fn(async () => ({ status }));
        await expect(runLike(call, 'i.upload', false)).resolves.toMatchObject({ ok: false, route: 'favorites' });
        expect(call).toHaveBeenCalledOnce();
        const silent = vi.fn(async () => { throw new Error('offline'); });
        await expect(runLike(silent, 'i.upload', true)).resolves.toMatchObject({ ok: false, error: 'request-failed' });
        expect(silent).toHaveBeenCalledOnce();
    });
    it('clears an upload\'s rating to unlike it, taking a missing rating as done', async () => {
        const call = vi.fn(async (path: string) => ({ status: path === 'v1/me/favorites' ? 400 : 404 }));
        await expect(runLike(call, 'i.upload', false)).resolves.toMatchObject({ ok: true, data: { route: 'rating' } });
        expect(call).toHaveBeenLastCalledWith('v1/me/ratings/library-songs/i.upload', {}, { method: 'DELETE' });
    });
    it('reports the refusal of both routes, and does not fall back for a catalog song or an expired sign-in', async () => {
        const both = vi.fn(async () => ({ status: 403 }));
        await expect(runLike(both, 'i.upload', true)).resolves.toMatchObject({ ok: false, error: 'upstream-error', httpStatus: 403, route: 'rating' });
        const expired = vi.fn(async () => ({ status: 401 }));
        await expect(runLike(expired, 'i.upload', true)).resolves.toMatchObject({ ok: false, error: 'auth-required' });
        expect(expired).toHaveBeenCalledOnce();
        const catalog = vi.fn(async () => ({ status: 400 }));
        await expect(runLike(catalog, '123', true)).resolves.toMatchObject({ ok: false, error: 'upstream-error', httpStatus: 400 });
        expect(catalog).toHaveBeenCalledOnce();
        const offline = vi.fn(async () => { throw new Error('offline'); });
        await expect(runLike(offline, '123', true)).resolves.toMatchObject({ ok: false, error: 'request-failed' });
    });
    it.each([true, false])('writes the favorite flag (%s) without deleting a library song', async liked => {
        const call = vi.fn(async () => ({ status: 202 }));
        const request = validateRequest({ id: 'test', operation: 'likeSong', params: { catalogId: '123', liked } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
        expect(result).toMatchObject({ ok: true });
        expect(call).toHaveBeenCalledExactlyOnceWith('v1/me/favorites', { 'ids[songs]': '123' }, { method: liked ? 'POST' : 'DELETE' });
    });
    it('preserves SDK v3 nested fetch options when that API is available', async () => {
        const call = vi.fn(async () => ({ status: 202 }));
        const request = validateRequest({ id: 'test', operation: 'likeSong', params: { catalogId: '123', liked: true } });
        await expect(runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { v3: { music: call } } }) } } })).resolves.toMatchObject({ ok: true });
        expect(call).toHaveBeenCalledExactlyOnceWith('v1/me/favorites', { 'ids[songs]': '123' }, { fetchOptions: { method: 'POST' } });
    });
    it('uses the webpage RequestInit shape rather than falling back to GET', async () => {
        const call = vi.fn(async (_path: string, _query: unknown, options?: { method?: string }) => ({ status: options?.method === 'POST' ? 202 : 405 }));
        const request = validateRequest({ id: 'test', operation: 'likeSong', params: { catalogId: '123', liked: true } });
        await expect(runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } })).resolves.toMatchObject({ ok: true });
    });
    it.each([401, 403, 500, undefined])('does not claim a rejected or unreadable write succeeded (%s)', async status => {
        const call = vi.fn(async () => ({ status }));
        const request = validateRequest({ id: 'test', operation: 'likeSong', params: { catalogId: '123', liked: true } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
        expect(result).toMatchObject({ ok: false, error: status === 401 ? 'auth-required' : 'upstream-error' });
    });
    it('marks only the system tagged playlist, never a matching display name', () => {
        expect(normalizeAppleMusicPlaylist({ id: 'p.a', type: 'library-playlists', attributes: { name: 'Favorite Songs' } }).isLiked).not.toBe(true);
        expect(normalizeAppleMusicPlaylist({ id: 'p.b', type: 'library-playlists', attributes: { isFavoritePlaylist: true } }).isLiked).toBe(true);
    });
    it('reads all favorite pages and uses catalog identities across library and catalog rows', async () => {
        const request = vi.fn(async (op: string, params: Record<string, unknown>) => {
            if (op === 'playlists') return { ok: true, data: { items: [{ id: 'p.fav', type: 'library-playlists', attributes: { isFavoritePlaylist: true } }], hasMore: false, nextOffset: 1 } };
            expect(op).toBe('playlistTracks');
            expect(params.playlistId).toBe('p.fav');
            return { ok: true, data: { items: [{ id: params.offset === 0 ? 'i.a' : 'i.b', type: 'library-songs', attributes: { playParams: { catalogId: params.offset === 0 ? '123' : '456' } } }], hasMore: params.offset === 0, nextOffset: Number(params.offset) + 1 } };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await expect(getAppleMusicLikedSongIds()).resolves.toEqual({ ids: ['123', '456'], whole: true });
    });
    it('keeps a missing system list uncertain instead of erasing saved likes', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data: { items: [], hasMore: false, nextOffset: 0 } })) } });
        await expect(getAppleMusicLikedSongIds()).resolves.toEqual({ ids: [], whole: false });
    });
    it('propagates a later page failure instead of returning a partial whole list', async () => {
        let page = 0;
        const request = vi.fn(async (op: string) => {
            if (op === 'playlists') return { ok: true, data: { items: [{ id: 'p.fav', type: 'library-playlists', attributes: { isFavoritePlaylist: true } }], hasMore: false, nextOffset: 1 } };
            if (page++) return { ok: false, error: 'request-failed' };
            return { ok: true, data: { items: [{ id: '123', type: 'songs', attributes: {} }], hasMore: true, nextOffset: 1 } };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await expect(getAppleMusicLikedSongIds()).rejects.toMatchObject({ code: 'network' });
    });
    it('resolves a library row to its catalog ID for a mutation', async () => {
        const request = vi.fn(async () => ({ ok: true, data: {} }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await setAppleMusicSongLiked(normalizeAppleMusicSong({ id: 'i.a', type: 'library-songs', attributes: { playParams: { catalogId: '123' } } }), false);
        expect(request).toHaveBeenCalledWith('likeSong', { catalogId: '123', liked: false });
    });
});
