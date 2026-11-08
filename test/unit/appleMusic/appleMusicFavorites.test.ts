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
    it('accepts only a catalog identity and an explicit boolean for writes', () => {
        for (const params of [{ catalogId: 'i.library', liked: true }, { catalogId: '123', liked: 'true' }, { catalogId: '../123', liked: false }]) {
            expect(validateRequest({ id: 'test', operation: 'likeSong', params })).toBeNull();
        }
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
