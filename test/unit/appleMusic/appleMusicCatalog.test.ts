import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';
afterEach(() => vi.unstubAllGlobals());
import { normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';

// Song relationships and fixed catalog endpoints connect Folia's navigation to Apple IDs.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');
describe('Apple Music catalog navigation', () => {
    it('preserves catalog album and artist references', () => {
        const song = normalizeAppleMusicSong({ id: '123', type: 'songs', attributes: { name: 'Song', albumName: 'Album', artistName: 'Artist',
            catalogAlbums: [{ id: '456' }], catalogArtists: [{ id: '789', name: 'Artist' }] } });
        expect(song.album.catalogRef).toEqual({ providerId: 'appleMusic', kind: 'album', id: '456' });
        expect(song.artists[0].catalogRef).toEqual({ providerId: 'appleMusic', kind: 'artist', id: '789' });
    });
    it('resolves each artist name when Apple only returns relationship IDs', async () => {
        const original = normalizeAppleMusicSong({ id: '123', type: 'songs', attributes: { name: 'Song', artistName: 'First & Second', albumName: 'Album' } });
        const request = vi.fn(async (operation: string, params: { catalogId?: string }) => ({ ok: true, data: {
            items: operation === 'catalogSong' ? [{ id: '123', type: 'songs', attributes: { artistName: 'First & Second', albumName: 'Album', catalogAlbums: [{ id: '456' }], catalogArtists: [{ id: '1' }, { id: '2' }] } }]
                : [{ id: params.catalogId, type: 'artists', attributes: { name: params.catalogId === '1' ? 'First' : 'Second' } }],
            hasMore: false, nextOffset: 1,
        } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const resolved = await provider.catalog!.resolveSongCatalogRefs!(original);
        expect(resolved.artists.map(artist => [artist.name, artist.catalogRef?.id])).toEqual([['First', '1'], ['Second', '2']]);
        expect(resolved.album.catalogRef?.id).toBe('456');
    });
    it('limits catalog IDs and preserves only selected song relationships', async () => {
        expect(validateRequest({ id: 'x', operation: 'catalogSong', params: { catalogId: '../bad' } })).toBeNull();
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront' ? { data: { data: [{ id: 'cn' }] } } :
            { data: { data: [{ id: '123', type: 'songs', attributes: { name: 'Song' }, relationships: {
                albums: { data: [{ id: '456', type: 'albums', attributes: { name: 'Album', secret: 'private' } }] },
                artists: { data: [{ id: '789', type: 'artists', attributes: { name: 'Artist' } }] },
            } }] } });
        const request = validateRequest({ id: 'x', operation: 'catalogSong', params: { catalogId: '123', limit: 1, offset: 0 } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL, console });
        expect(call).toHaveBeenCalledWith('v1/catalog/cn/songs/123', {});
        expect(result.data.items[0].attributes.catalogAlbums).toEqual([{ id: '456', name: 'Album' }]);
        expect(result.data.items[0].attributes.catalogArtists).toEqual([{ id: '789', name: 'Artist' }]);
    });
});
