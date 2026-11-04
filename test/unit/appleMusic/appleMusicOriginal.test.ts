import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { getAppleMusicLyricSearchAlias } from '../../../src/services/onlineMusic/appleMusic/appleMusicOriginal';
import { normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';

// Exercise the bounded cross-storefront bridge and cache without using personal account data.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');
afterEach(() => vi.unstubAllGlobals());
describe('Apple Music original metadata', () => {
    it('uses a library song catalog identity and returns a paired title and artist', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { name: '宵の余、良い!', artistName: '百鬼あやめ', albumName: '作品' } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const song = normalizeAppleMusicSong({ id: 'i.library', type: 'library-songs', attributes: { name: 'Yoi no Yo,Yoi!', playParams: { catalogId: '1588262504' } } });
        expect(await getAppleMusicLyricSearchAlias(song)).toMatchObject({ title: '宵の余、良い!', artist: '百鬼あやめ', song: { aliases: ['宵の余、良い!', '百鬼あやめ'] } });
        await getAppleMusicLyricSearchAlias(song);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request).toHaveBeenCalledWith('songOriginal', { catalogId: '1588262504' });
    });
    it('never asks for an already non-Latin title', async () => {
        const request = vi.fn(async () => ({ ok: true, data: null }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const song = normalizeAppleMusicSong({ id: '8001', type: 'songs', attributes: { name: '日本語' } });
        expect(await getAppleMusicLyricSearchAlias(song)).toBeNull();
        expect(request).not.toHaveBeenCalled();
        const missing = normalizeAppleMusicSong({ id: '8002', type: 'songs', attributes: { name: 'Latin title' } });
        expect(await getAppleMusicLyricSearchAlias(missing)).toBeNull();
        expect(await getAppleMusicLyricSearchAlias(missing)).toBeNull();
        expect(request).toHaveBeenCalledTimes(2);
    });
    it('does not return an alias when the original title is unchanged', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { name: 'Same title', artistName: '原文歌手' } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const song = normalizeAppleMusicSong({ id: '8003', type: 'songs', attributes: { name: 'Same title', artistName: 'Artist' } });
        expect(await getAppleMusicLyricSearchAlias(song)).toBeNull();
    });
    it('retries transient failures and never reuses Chinese aliases after a storefront switch', async () => {
        let attempts = 0;
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront' ? { data: { data: [{ id: 'cn' }] } }
            : ++attempts === 1 ? { status: 503 } : { data: { data: [{ attributes: { name: '原文', artistName: '歌手' } }] } });
        const window = { MusicKit: { getInstance: () => ({ api: { music: call } }) } } as Record<string, unknown>;
        const context = { window, URL };
        const request = validateRequest({ id: 'x', operation: 'songOriginal', params: { catalogId: '9001' } });
        expect(await runInNewContext(requestExpression(request), context)).toMatchObject({ ok: false, error: 'request-failed' });
        expect(await runInNewContext(requestExpression(request), context)).toMatchObject({ ok: true, data: { name: '原文' } });
        window.__foliaStorefront = { data: { data: [{ id: 'us' }] } };
        expect(await runInNewContext(requestExpression(request), context)).toMatchObject({ ok: true, data: null });
        expect(attempts).toBe(2);
    });
    it('restricts IDs and asks Japan only from the Chinese storefront', async () => {
        expect(validateRequest({ id: 'x', operation: 'songOriginal', params: { catalogId: '../bad' } })).toBeNull();
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront' ? { data: { data: [{ id: 'cn' }] } } : { data: { data: [{ attributes: { name: '日本語', artistName: '歌手', albumName: '作品' } }] } });
        const r = validateRequest({ id: 'x', operation: 'songOriginal', params: { catalogId: '123' } });
        const result = await runInNewContext(requestExpression(r), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL });
        expect(result).toMatchObject({ ok: true, data: { name: '日本語', artistName: '歌手' } });
        expect(call).toHaveBeenCalledWith('v1/catalog/jp/songs/123', { l: 'ja' });
        const context = { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL };
        await runInNewContext(requestExpression(r), context);
        await runInNewContext(requestExpression(r), context);
        expect(call.mock.calls.filter(([path]) => path === 'v1/catalog/jp/songs/123')).toHaveLength(2);
    });
});
