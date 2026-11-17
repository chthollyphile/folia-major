import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../src/i18n/config';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';
import { canAddToAppleMusicPlaylist, getAppleMusicPlaylists } from '../../../src/services/onlineMusic/appleMusic/appleMusicData';

// Exercise the virtual library playlist through the transport and the companion's actual page expression.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');
const LIBRARY_ID = 'library-songs';
const provider = () => createAppleMusicProvider(() => ({ configured: true }));
const rawSong = (id: string, catalogId?: string) => ({
    id, type: 'library-songs', attributes: { name: id, playParams: { id, kind: 'song', isLibrary: true } },
    ...(catalogId ? { relationships: { catalog: { data: [{ id: catalogId, type: 'songs' }] } } } : {}),
});
const rawPlaylist = (id: string) => ({ id, type: 'library-playlists', attributes: { name: id, canEdit: true } });

function installBridge(readPage: (offset: number, limit: number, path: string) => unknown) {
    const call = vi.fn(async (path: string, params?: { offset: number; limit: number }) => path === 'v1/me/storefront'
        ? { data: { data: [{ id: 'cn' }] } }
        : { data: readPage(params?.offset ?? 0, params?.limit ?? 100, path) });
    const context = { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL, console };
    const bridge = vi.fn(async (operation: string, params: unknown) => {
        const request = validateRequest({ id: 'read', operation, params });
        if (!request) return { ok: false, error: 'invalid-request' };
        return runInNewContext(requestExpression(request), context);
    });
    vi.stubGlobal('window', { electron: { appleMusicRequest: bridge } });
    return { call, bridge };
}

const libraryTracks = (limit = 20, offset = 0) => provider().catalog!.getPlaylistTracks!(LIBRARY_ID, limit, offset);

afterEach(() => { vi.unstubAllGlobals(); });

describe('Apple Music virtual library playlist', () => {
    it('uses existing playlist capabilities without a separate all-songs or cloud contract', () => {
        const adapter = provider();
        expect(adapter.capabilities).toMatchObject({ userLibrary: true, playlists: true, playback: false, externalPlayback: true });
        expect(adapter.capabilities).not.toHaveProperty('userSongs');
        expect(adapter.library).not.toHaveProperty('getUserSongs');
        expect(adapter.capabilities.userCloud).not.toBe(true);
    });

    it('prepends one translated non-favorite library card on the first playlist page', async () => {
        const { bridge } = installBridge(() => ({ data: [rawPlaylist('p.first')], next: '/v1/me/library/playlists?offset=7' }));
        const first = await getAppleMusicPlaylists(1, 0);
        expect(first.items).toHaveLength(2);
        expect(first.items[0]).toMatchObject({ providerId: 'appleMusic', id: LIBRARY_ID, type: 'playlist', name: i18n.t('appleMusic.libraryPlaylistName'), isOwned: true });
        expect(first.items[0].isLiked).not.toBe(true);
        expect(first.items[1].id).toBe('p.first');
        expect(first).toMatchObject({ hasMore: true, nextOffset: 7 });
        expect(bridge.mock.calls).toEqual([['playlists', { limit: 1, offset: 0 }]]);
    });

    it('keeps the library entry even when there are no real playlists', async () => {
        installBridge(() => ({ data: [] }));
        const page = await getAppleMusicPlaylists(20, 0);
        expect(page).toMatchObject({ items: [{ id: LIBRARY_ID, type: 'playlist' }], hasMore: false, nextOffset: 0 });
        expect(page.items).toHaveLength(1);
    });

    it('does not insert the virtual card on subsequent playlist pages or shift their raw cursor', async () => {
        const { bridge } = installBridge(() => ({ data: [rawPlaylist('p.last')] }));
        const page = await getAppleMusicPlaylists(20, 7);
        expect(page.items.map(item => item.id)).toEqual(['p.last']);
        expect(page).toMatchObject({ hasMore: false, nextOffset: 8 });
        expect(bridge.mock.calls).toEqual([['playlists', { limit: 20, offset: 7 }]]);
    });

    it('routes the fixed playlist id to an empty complete library-song page', async () => {
        const { call, bridge } = installBridge(() => ({ data: [] }));
        await expect(libraryTracks()).resolves.toEqual({ items: [], hasMore: false, nextOffset: 0 });
        expect(call).toHaveBeenCalledWith('v1/me/library/songs', { limit: 20, offset: 0, include: 'catalog' });
        expect(bridge.mock.calls).toEqual([['librarySongs', { limit: 20, offset: 0 }]]);
    });

    it('keeps normal playlist ids on the existing playlist track endpoint', async () => {
        const { call } = installBridge(() => ({ data: [rawSong('i.playlist', '123')] }));
        await expect(provider().catalog!.getPlaylistTracks!('p.normal', 10, 0)).resolves.toMatchObject({ items: [{ id: 'i.playlist' }] });
        expect(call).toHaveBeenCalledWith('v1/me/library/playlists/p.normal/tracks', { limit: 10, offset: 0 });
    });

    it('keeps library identity separate from catalog mapping and plays uploads by their library id', async () => {
        installBridge(() => ({ data: [rawSong('i.mapped', '123'), rawSong('i.upload')] }));
        const adapter = provider();
        const page = await adapter.catalog!.getPlaylistTracks!(LIBRARY_ID, 20, 0);
        expect(page.items.map(song => song.id)).toEqual(['i.mapped', 'i.upload']);
        expect(page.items[0].sourceRef).toMatchObject({ kind: 'online', providerId: 'appleMusic', mediaId: 'i.mapped', providerData: { catalogId: '123', resourceType: 'library-songs' } });
        expect(page.items[1].sourceRef).toMatchObject({ kind: 'online', providerId: 'appleMusic', mediaId: 'i.upload', providerData: { resourceType: 'library-songs' } });
        expect(page.items[1].sourceRef?.kind === 'online' && page.items[1].sourceRef.providerData?.catalogId).toBeUndefined();
        expect(adapter.externalPlayback!.canPlay!(page.items[0])).toBe(true);
        expect(adapter.externalPlayback!.canPlay!(page.items[1])).toBe(true);
        expect(page.nextOffset).toBe(2);
    });

    // An iTunes upload has no catalog song: it plays and is liked by its library id, its status matches
    // by that id, and lyrics (catalog-only) still refuse it.
    it('steers the companion by an upload\'s library id and follows its status', async () => {
        const { bridge } = installBridge(() => ({ data: [rawSong('i.upload')] }));
        const adapter = provider();
        const [upload] = (await adapter.catalog!.getPlaylistTracks!(LIBRARY_ID, 20, 0)).items;
        bridge.mockImplementation(async (operation: string) => operation === 'playbackStatus'
            ? { ok: true, data: { itemId: 'i.upload', catalogId: '', isPlaying: true, state: 2, positionMs: 1000, durationMs: 200000 } }
            : { ok: true, data: {} });
        const external = adapter.externalPlayback!;
        await external.play(upload, 0);
        expect(bridge).toHaveBeenCalledWith('playSong', expect.objectContaining({ catalogId: 'i.upload' }));
        const status = await external.getStatus(upload);
        expect(status).toMatchObject({ mediaId: 'i.upload', isPlaying: true });
        expect(external.isStatusForSong(upload, status)).toBe(true);
        await expect(adapter.lyrics!.getLyrics(upload)).rejects.toMatchObject({ code: 'unsupported' });
        await adapter.mutations!.likeSong!(upload, true);
        expect(bridge).toHaveBeenLastCalledWith('likeSong', { catalogId: 'i.upload', liked: true });
    });

    // A mapped library song keeps playing by its catalog id; an upload next in line is left out of the
    // prepared tail and starts through playSong; a wrong-form playbackId falls back to the row's own id.
    it('keeps mapped songs on their catalog id and leaves uploads out of the prepared tail', async () => {
        const { bridge } = installBridge(() => ({ data: [rawSong('i.mapped', '123'), rawSong('i.upload'), rawSong('i.next', '456')] }));
        const adapter = provider();
        const [mapped, upload, next] = (await adapter.catalog!.getPlaylistTracks!(LIBRARY_ID, 20, 0)).items;
        bridge.mockImplementation(async (operation: string) => operation === 'playbackStatus'
            ? { ok: true, data: { itemId: 'i.mapped', catalogId: '123', isPlaying: true, state: 2, positionMs: 1000, durationMs: 200000 } }
            : { ok: true, data: {} });
        const external = adapter.externalPlayback!;
        await external.play(mapped, 0);
        expect(bridge).toHaveBeenCalledWith('playSong', expect.objectContaining({ catalogId: '123' }));
        expect(external.isStatusForSong(mapped, await external.getStatus(mapped))).toBe(true);
        await external.prepareNext!(mapped, [upload, next]);
        expect(bridge).toHaveBeenCalledWith('prepareNext', { catalogId: '123', nextIds: [] });
        await external.play(upload, 0);
        await external.prepareNext!(upload, [next]);
        expect(bridge).toHaveBeenCalledWith('prepareNext', { catalogId: 'i.upload', nextIds: ['456'] });
        const oddPlaybackId = { ...upload, sourceRef: { ...upload.sourceRef!, providerData: { resourceType: 'library-songs', playbackId: 'x' } } } as typeof upload;
        expect(adapter.externalPlayback!.canPlay!(oddPlaybackId)).toBe(true);
    });

    it('does not play a library row whose id is not a library song id', () => {
        const adapter = provider();
        const odd = { id: 'x', name: 'x', artists: [], album: { id: '', name: '' }, durationMs: 0,
            sourceRef: { kind: 'online' as const, providerId: 'appleMusic', mediaId: 'l.album', providerData: { resourceType: 'library-songs' } } };
        expect(adapter.externalPlayback!.canPlay!(odd)).toBe(false);
    });

    it('assembles a caller page from bounded raw pages using each upstream cursor', async () => {
        const { bridge } = installBridge((offset, limit) => ({
            data: Array.from({ length: limit }, (_, index) => rawSong(`i.${offset + index}`)),
            next: `/v1/me/library/songs?offset=${offset + limit + 5}`,
        }));
        const page = await libraryTracks(250);
        expect(page.items).toHaveLength(250);
        expect(page).toMatchObject({ nextOffset: 265, hasMore: true });
        expect(page.items[100].id).toBe('i.105');
        expect(page.items[200].id).toBe('i.210');
        expect(bridge.mock.calls).toEqual([
            ['librarySongs', { limit: 100, offset: 0 }],
            ['librarySongs', { limit: 100, offset: 105 }],
            ['librarySongs', { limit: 50, offset: 210 }],
        ]);
    });

    it('continues after 100 songs using the server cursor, including unmapped songs', async () => {
        const { bridge } = installBridge(offset => offset === 0
            ? { data: Array.from({ length: 100 }, (_, index) => rawSong(`i.${index}`)), next: '/v1/me/library/songs?offset=105' }
            : { data: [rawSong('i.last', '456')] });
        const first = await libraryTracks(100);
        await expect(libraryTracks(100, first.nextOffset)).resolves.toMatchObject({ hasMore: false, nextOffset: 106, items: [{ id: 'i.last' }] });
        expect(bridge.mock.calls).toEqual([
            ['librarySongs', { limit: 100, offset: 0 }], ['librarySongs', { limit: 100, offset: 105 }],
        ]);
    });

    it('never accepts additions to the virtual id even with editable playlist metadata', async () => {
        const { bridge } = installBridge(() => ({ data: [] }));
        const card = { providerId: 'appleMusic', id: LIBRARY_ID, type: 'playlist' as const, name: 'Library', providerData: { resourceType: 'library-playlists', canEdit: true } };
        expect(canAddToAppleMusicPlaylist(card)).toBe(false);
        await expect(provider().mutations!.updatePlaylistTracks!('add', card, ['123'])).rejects.toMatchObject({ code: 'unsupported' });
        expect(bridge).not.toHaveBeenCalled();
    });

    it('does not read the virtual library as favorite song ids', async () => {
        const { bridge } = installBridge(() => ({ data: [] }));
        await expect(provider().library!.getLikedSongIds!('account')).resolves.toEqual({ ids: [], whole: false });
        expect(bridge.mock.calls).toEqual([['playlists', { limit: 100, offset: 0 }]]);
    });

    it('rejects invalid pages and auth failures rather than silently completing the library', async () => {
        installBridge(() => ({ data: [rawSong('i.first')], next: '/v1/me/library/songs?offset=0' }));
        await expect(libraryTracks(1)).rejects.toMatchObject({ code: 'invalid-response' });
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: false, error: 'auth-required' })) } });
        await expect(libraryTracks(1)).rejects.toMatchObject({ code: 'auth-required' });
    });

    it('uses the companion standard offset ceiling and request whitelist', () => {
        expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { offset: 100000, limit: 10, path: '/anything', userId: 'private' } }))
            .toEqual({ id: 'r', operation: 'librarySongs', params: { offset: 100000, limit: 10 } });
        expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { offset: 100001, limit: 10 } })).toBeNull();
        expect(validateRequest({ id: 'r', operation: 'librarySongs', params: { limit: 101 } })).toBeNull();
    });
});
