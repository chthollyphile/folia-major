import { afterEach, describe, expect, it, vi } from 'vitest';
import { appleMusicCatalogSongId, getAppleMusicPlaylistTracks, getAppleMusicPlaylists, searchAppleMusic } from '../../../src/services/onlineMusic/appleMusic/appleMusicData';
import { normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';

// A missing catalog identity and a broken cursor must not become false success or an empty library.
afterEach(() => { vi.unstubAllGlobals(); });

describe('Apple Music data adapter', () => {
    it('uses catalog IDs for library-song lyrics and never guesses from the library ID', () => {
        const song = normalizeAppleMusicSong({ id: 'i.example', type: 'library-songs', attributes: { playParams: { catalogId: '123' } } });
        expect(appleMusicCatalogSongId(song)).toBe('123');
        const unknown = normalizeAppleMusicSong({ id: 'i.example', type: 'library-songs' });
        expect(() => appleMusicCatalogSongId(unknown)).toThrow();
    });

    it('preserves a server-provided next offset and maps playlist identity', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({
            ok: true, data: { items: [{ id: 'p.example', type: 'library-playlists' }], nextOffset: 5, hasMore: true },
        })) } });
        // One row wanted: the server's own next offset is kept, and no second page is read.
        await expect(getAppleMusicPlaylists(1, 0)).resolves.toMatchObject({
            nextOffset: 5, hasMore: true, items: [{ id: 'p.example', providerId: 'appleMusic' }],
        });
    });

    it('rejects malformed pagination rather than returning an incomplete page', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({
            ok: true, data: { items: [], nextOffset: 0, hasMore: true },
        })) } });
        await expect(getAppleMusicPlaylists(5, 0)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('leaves rows this adapter does not model out of a library page', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({
            ok: true,
            data: {
                items: [
                    { id: 'p.1', type: 'library-playlists' },
                    { id: 'f.1', type: 'library-playlist-folders' },
                ],
                nextOffset: 2,
                hasMore: false,
            },
        })) } });
        await expect(getAppleMusicPlaylists(10, 0)).resolves.toMatchObject({
            items: [{ id: 'p.1', providerId: 'appleMusic' }],
            nextOffset: 2,
            hasMore: false,
        });
    });

    it('reads a page larger than one Apple request in several requests', async () => {
        const request = vi.fn(async (_operation: string, params: { limit: number; offset: number }) => ({
            ok: true,
            data: {
                items: Array.from({ length: params.limit }, (_, index) => ({
                    id: `s.${params.offset + index}`, type: 'library-songs',
                })),
                nextOffset: params.offset + params.limit,
                hasMore: params.offset + params.limit < 150,
            },
        }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const page = await getAppleMusicPlaylistTracks('p.example', 150, 0);
        expect(page.items).toHaveLength(150);
        expect(page.hasMore).toBe(false);
        expect(page.nextOffset).toBe(150);
        expect(request.mock.calls.map(([, params]) => [params.limit, params.offset])).toEqual([[100, 0], [50, 100]]);
    });

    it('does not issue an empty search', async () => {
        const request = vi.fn();
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await expect(searchAppleMusic('  ', 10, 0)).resolves.toMatchObject({ items: [], hasMore: false });
        expect(request).not.toHaveBeenCalled();
    });
});
