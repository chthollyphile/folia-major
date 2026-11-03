import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBodianApi } from 'bodian-music-api';
import { bodianLibrary, clearBodianLibraryCache } from '@/services/onlineMusic/bodian/bodianLibrary';

// test/unit/onlineMusic/bodianAlbumPaging.test.ts — real package and Folia adapters over mixed collection pages.

const require = createRequire(import.meta.url);
const { createWire } = require('../../helpers/bodianWire.cjs');
const album = { id: 101, albumId: 101, name: 'Album', artist: 'Artist', sourceType: 6, musicCount: 10 };
const playlist = { id: 201, name: 'Playlist', sourceType: 4 };

function setup(items: unknown[]) {
    const wire = createWire(({ url }: { url: URL }) => {
        if (url.pathname === '/api/service/playlist/userCreate') return { code: 200, data: { playLists: [] } };
        if (url.pathname === '/api/service/playlist/fond') return { code: 200, data: {} };
        expect(url.pathname).toBe('/api/service/collect/4/list');
        const size = Number(url.searchParams.get('rn'));
        const start = (Number(url.searchParams.get('pn')) - 1) * size;
        return { code: 200, data: { total: items.length, playLists: items.slice(start, start + size) } };
    });
    const api = createBodianApi({ deviceId: 'a'.repeat(32), requestFactory: wire.factory,
        sessions: { revision: 0, get: () => ({ uid: '123', token: 'fixture', user: { id: '123', nickname: 'Fixture', avatarUrl: '' } }),
            set: vi.fn(), clear: vi.fn() } });
    vi.stubGlobal('window', { electron: { bodianRequest: api.request } });
    return wire;
}

afterEach(() => { vi.unstubAllGlobals(); clearBodianLibraryCache(); });
describe('mixed Bodian collections through the public package', () => {
    it('reads an album after a playlist-only page', async () => {
        setup([playlist, album]);
        const first = await bodianLibrary.getUserAlbums!('123', 1, 0);
        expect(first).toMatchObject({ items: [], nextOffset: 1, hasMore: true });
        const second = await bodianLibrary.getUserAlbums!('123', 1, first.nextOffset);
        expect(second).toMatchObject({ items: [{ id: '101', type: 'album', name: 'Album', trackCount: 10 }],
            nextOffset: 2, hasMore: false });
        expect(second.total).toBeUndefined();
    });
    it('reads a collected playlist after an album-only raw page without listing the albums as playlists', async () => {
        const wire = setup([...Array.from({ length: 100 }, (_, index) => ({ ...album, id: index + 1 })), playlist]);
        const page = await bodianLibrary.getUserPlaylists('123', 50, 0);
        expect(page).toMatchObject({ items: [{ id: '201', type: 'playlist' }], total: 1, hasMore: false });
        expect(page.items).toHaveLength(1);
        expect(wire.calls.filter(({ url }: { url: URL }) => url.pathname.includes('/collect/')).map(({ url }: { url: URL }) => url.searchParams.get('pn')))
            .toEqual(['1', '2']);
    });
});
