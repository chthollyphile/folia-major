import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { normalizeAppleMusicLibraryAlbum } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';

// Library album identifiers must remain library identities through the private page bridge.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');
describe('Apple Music library albums', () => {
    it('normalizes the library identity and enables the library album capability', () => {
        expect(normalizeAppleMusicLibraryAlbum({ id: 'l.example', type: 'library-albums', attributes: { name: 'Album', trackCount: 8 } }))
            .toMatchObject({ id: 'l.example', type: 'album', trackCount: 8, providerData: { resourceType: 'library-albums' } });
        expect(createAppleMusicProvider(() => ({ configured: true })).capabilities.userAlbums).toBe(true);
        expect(() => normalizeAppleMusicLibraryAlbum({ id: '../bad', type: 'library-albums' })).toThrow();
    });
    it('requests only fixed library paths and retains the song catalog relationship', async () => {
        expect(validateRequest({ id: 'x', operation: 'libraryAlbumTracks', params: { albumId: '../bad' } })).toBeNull();
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront' ? { data: { data: [{ id: 'cn' }] } } :
            { data: { data: [{ id: 'i.song', type: 'library-songs', attributes: { name: 'Song' }, relationships: { catalog: { data: [{ id: '123' }] } } }] } });
        const request = validateRequest({ id: 'x', operation: 'libraryAlbumTracks', params: { albumId: 'l.example', limit: 20, offset: 0 } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL, console });
        expect(call).toHaveBeenCalledWith('v1/me/library/albums/l.example/tracks', { limit: 20, offset: 0, include: 'catalog' });
        expect(result).toMatchObject({ ok: true, data: { items: [{ attributes: { playParams: { catalogId: '123' } } }] } });
    });
});
