import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';

// Exercise all-library-song pages through the transport and the companion's actual page expression.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');
const provider = () => createAppleMusicProvider(() => ({ configured: true }));
const rawSong = (id: string, catalogId?: string) => ({
    id, type: 'library-songs', attributes: { name: id, playParams: { id, kind: 'song', isLibrary: true } },
    ...(catalogId ? { relationships: { catalog: { data: [{ id: catalogId, type: 'songs' }] } } } : {}),
});

function installBridge(readPage: (offset: number, limit: number) => unknown) {
    const call = vi.fn(async (path: string, params?: { offset: number; limit: number }) => path === 'v1/me/storefront'
        ? { data: { data: [{ id: 'cn' }] } }
        : { data: readPage(params!.offset, params!.limit) });
    const context = { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL, console };
    const bridge = vi.fn(async (operation: string, params: unknown) => {
        const request = validateRequest({ id: 'read', operation, params });
        if (!request) return { ok: false, error: 'invalid-request' };
        return runInNewContext(requestExpression(request), context);
    });
    vi.stubGlobal('window', { electron: { appleMusicRequest: bridge } });
    return { call, bridge };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Apple Music all library songs', () => {
    it('advertises all songs separately without adding playback or cloud capabilities', () => {
        expect(provider().capabilities).toMatchObject({ userSongs: true, playback: false, externalPlayback: true });
        expect(provider().capabilities.userCloud).not.toBe(true);
    });

    it('returns an empty library as a complete page', async () => {
        const { call } = installBridge(() => ({ data: [] }));
        await expect(provider().library!.getUserSongs!('account', 20, 0)).resolves.toEqual({ items: [], hasMore: false, nextOffset: 0 });
        expect(call).toHaveBeenCalledWith('v1/me/library/songs', { limit: 20, offset: 0, include: 'catalog' });
    });

    it('keeps library identity separate from catalog mapping and retains unplayable uploads', async () => {
        installBridge(() => ({ data: [rawSong('i.mapped', '123'), rawSong('i.upload')] }));
        const adapter = provider();
        const page = await adapter.library!.getUserSongs!('account', 20, 0);
        expect(page.items.map(song => song.id)).toEqual(['i.mapped', 'i.upload']);
        expect(page.items[0].sourceRef).toMatchObject({ kind: 'online', providerId: 'appleMusic', mediaId: 'i.mapped', providerData: { catalogId: '123', resourceType: 'library-songs' } });
        expect(page.items[1].sourceRef).toMatchObject({ kind: 'online', providerId: 'appleMusic', mediaId: 'i.upload', providerData: { resourceType: 'library-songs' } });
        expect(page.items[1].sourceRef?.kind === 'online' && page.items[1].sourceRef.providerData?.catalogId).toBeUndefined();
        expect(adapter.externalPlayback!.canPlay!(page.items[0])).toBe(true);
        expect(adapter.externalPlayback!.canPlay!(page.items[1])).toBe(false);
        expect(page.nextOffset).toBe(2);
    });

    it('publishes one upstream page even when the caller asks for more than 100 rows', async () => {
        const { bridge } = installBridge((_offset, limit) => ({
            data: Array.from({ length: limit }, (_, index) => rawSong(`i.${index}`)),
            next: '/v1/me/library/songs?offset=105',
        }));
        const page = await provider().library!.getUserSongs!('account', 500, 0);
        expect(page.items).toHaveLength(100);
        expect(page.nextOffset).toBe(105);
        expect(page.hasMore).toBe(true);
        expect(bridge.mock.calls).toEqual([['librarySongs', { limit: 100, offset: 0 }]]);
    });

    it('retries exactly the failed raw page without rereading an already published page', async () => {
        let failed = false;
        const { bridge } = installBridge((offset, limit) => {
            if (offset === 100) return {
                data: Array.from({ length: limit }, (_, index) => rawSong(`i.${offset + index}`)),
                next: '/v1/me/library/songs?offset=200',
            };
            if (!failed) { failed = true; throw new Error('temporary failure'); }
            return { data: [rawSong('i.200')] };
        });
        const adapter = provider();
        const first = await adapter.library!.getUserSongs!('account', 500, 100);
        expect(first.items).toHaveLength(100);
        expect(first.nextOffset).toBe(200);
        await expect(adapter.library!.getUserSongs!('account', 500, first.nextOffset)).rejects.toMatchObject({ code: 'network' });
        await expect(adapter.library!.getUserSongs!('account', 500, first.nextOffset))
            .resolves.toMatchObject({ items: [{ id: 'i.200' }], nextOffset: 201, hasMore: false });
        expect(bridge.mock.calls).toEqual([
            ['librarySongs', { limit: 100, offset: 100 }],
            ['librarySongs', { limit: 100, offset: 200 }],
            ['librarySongs', { limit: 100, offset: 200 }],
        ]);
    });

    it('continues beyond offset 100000 through the renderer and the real companion cursor parser', async () => {
        const { bridge } = installBridge(offset => offset === 100001
            ? { data: [rawSong('i.high')], next: '/v1/me/library/songs?offset=100050' }
            : { data: [rawSong('i.last')] });
        const adapter = provider();
        const first = await adapter.library!.getUserSongs!('account', 500, 100001);
        expect(first).toMatchObject({ items: [{ id: 'i.high' }], hasMore: true, nextOffset: 100050 });
        await expect(adapter.library!.getUserSongs!('account', 500, first.nextOffset))
            .resolves.toMatchObject({ items: [{ id: 'i.last' }], hasMore: false, nextOffset: 100051 });
        expect(bridge.mock.calls).toEqual([
            ['librarySongs', { limit: 100, offset: 100001 }],
            ['librarySongs', { limit: 100, offset: 100050 }],
        ]);
    });

    it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects malformed library-song input offset %s', async offset => {
        const { bridge } = installBridge(() => ({ data: [] }));
        await expect(provider().library!.getUserSongs!('account', 20, offset)).rejects.toMatchObject({ code: 'invalid-response' });
        expect(bridge).not.toHaveBeenCalled();
    });

    it.each(['-1', '100001.5', '9007199254740992', 'unknown', '100001'])('rejects malformed or nonadvancing high cursor %s', async cursor => {
        installBridge(() => ({ data: [rawSong('i.high')], next: `/v1/me/library/songs?offset=${cursor}` }));
        await expect(provider().library!.getUserSongs!('account', 20, 100001)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('keeps the cursor between caller pages even when the row has no catalog identity', async () => {
        installBridge(offset => offset === 0
            ? { data: [rawSong('i.first')], next: '/v1/me/library/songs?offset=7' }
            : { data: [rawSong('i.last', '456')] });
        const adapter = provider();
        const first = await adapter.library!.getUserSongs!('account', 1, 0);
        expect(first).toMatchObject({ hasMore: true, nextOffset: 7, items: [{ id: 'i.first' }] });
        const last = await adapter.library!.getUserSongs!('account', 1, first.nextOffset);
        expect(last).toMatchObject({ hasMore: false, nextOffset: 8, items: [{ id: 'i.last' }] });
    });

    it('rejects invalid pages and upstream failures rather than silently completing the library', async () => {
        installBridge(() => ({ data: [rawSong('i.first')], next: '/v1/me/library/songs?offset=0' }));
        await expect(provider().library!.getUserSongs!('account', 1, 0)).rejects.toMatchObject({ code: 'invalid-response' });
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: false, error: 'auth-required' })) } });
        await expect(provider().library!.getUserSongs!('account', 1, 0)).rejects.toMatchObject({ code: 'auth-required' });
    });

    it('whitelists safe librarySongs offsets without relaxing other operations or forwarding endpoints', () => {
        expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { offset: 100001, limit: 10, path: '/anything', userId: 'private' } }))
            .toEqual({ id: 'r', operation: 'librarySongs', params: { offset: 100001, limit: 10 } });
        expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { offset: Number.MAX_SAFE_INTEGER, limit: 10 } }))
            .toEqual({ id: 'r', operation: 'librarySongs', params: { offset: Number.MAX_SAFE_INTEGER, limit: 10 } });
        expect(validateRequest({ id: 'r', operation: 'libraryAlbums', params: { offset: 100001, limit: 10 } })).toBeNull();
        expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { limit: 101 } })).toBeNull();
        for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { offset } })).toBeNull();
        }
    });
});
