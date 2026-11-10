import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qishuiProvider } from '@/services/onlineMusic/qishui/qishuiProvider';
import { qishuiCatalog, qishuiLibrary } from '@/services/onlineMusic/qishui/qishuiCatalog';
import { qishuiMutations } from '@/services/onlineMusic/qishui/qishuiMutations';
import { clearQishuiPlayback, readQishuiSongs } from '@/services/onlineMusic/qishui/qishuiPlayback';
import { normalizeQishuiCollection, normalizeQishuiSong } from '@/services/onlineMusic/qishui/qishuiNormalize';
import { omni } from '@/services/onlineMusic/omni';
import type { ProviderCollection } from '@/types/onlineMusic';
import { track } from './fixtures';

// Exercise the existing Omni entry points and renderer adapter with safe IPC replies.
const request = vi.fn();
const playlist = (extra: Partial<ProviderCollection> = {}): ProviderCollection => ({
    providerId: 'qishui', type: 'playlist', id: '99', name: 'List', isOwned: true, ...extra,
});
const song = () => normalizeQishuiSong(track());
beforeEach(() => {
    clearQishuiPlayback();
    request.mockReset().mockResolvedValue({ ok: true, data: null });
    vi.stubGlobal('window', { electron: { qishuiRequest: request } });
});
afterEach(() => { clearQishuiPlayback(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Qishui account capabilities', () => {
    it('offers hearts and playlist edits through Omni, while unavailable writes stay absent', () => {
        expect(omni.canLikeSong(song())).toBe(true);
        expect(omni.canAddSongToPlaylist(song())).toBe(true);
        expect(omni.canCreatePlaylistForSong(song())).toBe(false);
        expect(omni.canSubscribeCollection(playlist({ isOwned: false }))).toBe(false);
        expect(omni.canEditCollectionTracks(playlist())).toBe(true);
        expect(omni.canEditCollectionTracks(playlist({ isOwned: false }))).toBe(false);
        expect(omni.canEditCollectionTracks(playlist({ type: 'history', isOwned: false }))).toBe(false);
    });
    it('marks only the owned built-in liked list for heart-based editing', () => {
        const raw = { base_info: { id: '9', type: 1 }, isOwned: true };
        const liked = normalizeQishuiCollection(raw);
        expect(liked.isLiked).toBe(true);
        expect(omni.canEditCollectionTracks(liked)).toBe(true);
        expect(qishuiMutations.canAddToPlaylist!(liked)).toBe(false);
        expect(normalizeQishuiCollection({ ...raw, isOwned: false }).isLiked).toBeUndefined();
    });
    it('preserves ownership and the liked marker when detail omits the account flags', async () => {
        request.mockResolvedValue({ ok: true, data: { base_info: { id: '99', title: 'Detail' } } });
        expect(await qishuiCatalog.getPlaylistDetail!('99', playlist({ isLiked: true })))
            .toMatchObject({ isOwned: true, isLiked: true });
        expect(await qishuiCatalog.getPlaylistDetail!('99', playlist({ isOwned: false })))
            .toMatchObject({ isOwned: false });
    });
    it.each([true, false])('sends a heart change with the source identity (liked=%s)', async liked => {
        const target = { ...song(), id: 'local-display-id' };
        await qishuiMutations.likeSong!(target, liked);
        expect(request).toHaveBeenCalledExactlyOnceWith('like_song', { id: '7676337516358617115', liked });
    });
    it.each(['add', 'del'] as const)('routes %s to the package and keeps exact media IDs', async operation => {
        await omni.updateCollectionTracks(playlist(), operation, [{ ...song(), id: 'display-id' }]);
        expect(request).toHaveBeenCalledExactlyOnceWith(operation === 'add' ? 'playlist_add_tracks' : 'playlist_remove_tracks', {
            id: '99', ids: ['7676337516358617115'],
        });
    });
    it('rejects foreign tracks, non-owned/liked/history lists, and oversized batches before IPC', async () => {
        for (const target of [playlist({ isOwned: false }), playlist({ isLiked: true }), playlist({ type: 'history' }), playlist({ providerId: 'netease' })]) {
            await expect(qishuiMutations.updatePlaylistTracks!('add', target, [song()])).rejects.toMatchObject({ code: 'unsupported' });
        }
        const foreign = { ...song(), sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '1' } };
        await expect(qishuiMutations.likeSong!(foreign, true)).rejects.toMatchObject({ code: 'unsupported' });
        await expect(qishuiMutations.updatePlaylistTracks!('add', playlist(), [foreign])).rejects.toMatchObject({ code: 'unsupported' });
        await expect(qishuiMutations.updatePlaylistTracks!('add', playlist(), Array(101).fill(song()))).rejects.toMatchObject({ code: 'unsupported' });
        expect(request).not.toHaveBeenCalled();
    });
    it('keeps partial liked reads partial and propagates failures instead of emptying hearts', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { ids: ['123'], whole: false } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'invalid-response', message: 'Page is missing' } })
            .mockResolvedValueOnce({ ok: true, data: {} });
        await expect(qishuiLibrary.getLikedSongIds!('account')).resolves.toEqual({ ids: ['123'], whole: false });
        await expect(qishuiLibrary.getLikedSongIds!('account')).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(qishuiLibrary.getLikedSongIds!('account')).rejects.toMatchObject({ code: 'invalid-response' });
    });
    it('makes recent plays a read-only collection with correct virtual-row pagination', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { items: [{ base_info: { id: '11', title: 'First' }, isOwned: true }], hasMore: true, nextOffset: 1, total: 2 } })
            .mockResolvedValueOnce({ ok: true, data: { items: [{ base_info: { id: '12', title: 'Next' }, isOwned: true }], hasMore: false, nextOffset: 2, total: 2 } });
        const first = await qishuiLibrary.getUserPlaylists('account', 2, 0);
        expect(first.items.map(item => item.id)).toEqual(['recent-played', '11']);
        expect(first).toMatchObject({ nextOffset: 2, total: 3, hasMore: true });
        expect(first.items[0]).toMatchObject({ type: 'history', isOwned: false, coverUrl: expect.stringContaining('data:image/svg+xml') });
        const next = await qishuiLibrary.getUserPlaylists('account', 2, first.nextOffset);
        expect(next.items.map(item => item.id)).toEqual(['12']);
        expect(next).toMatchObject({ nextOffset: 3, hasMore: false });
        expect(request.mock.calls.map(call => call[1])).toEqual([{ limit: 1, offset: 0 }, { limit: 2, offset: 1 }]);
    });
    it('keeps the first playlist available when the caller asks for one collection at a time', async () => {
        request.mockResolvedValue({ ok: true, data: { items: [{ base_info: { id: '11' } }], hasMore: false, nextOffset: 1 } });
        const first = await qishuiLibrary.getUserPlaylists('account', 1, 0);
        expect(first).toMatchObject({ nextOffset: 1, hasMore: true });
        const next = await qishuiLibrary.getUserPlaylists('account', 1, first.nextOffset);
        expect(next.items.map(item => item.id)).toEqual(['11']);
        expect(request.mock.calls[1][1]).toEqual({ limit: 1, offset: 0 });
    });
    it('reads platform history through Omni collection paging', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { items: [track('2')], hasMore: true, nextOffset: 3 } });
        const result = await omni.getCollectionTracks(playlist({ id: 'recent-played', type: 'history', isOwned: false }), { limit: 1, offset: 2 });
        expect(result).toMatchObject({ items: [{ id: '2', sourceRef: { providerId: 'qishui' } }], nextOffset: 3, hasMore: true });
        expect(request).toHaveBeenCalledExactlyOnceWith('recent_played', { limit: 1, offset: 2 });
        expect(await qishuiCatalog.getPlaylistDetail!('recent-played')).toMatchObject({ type: 'history', isOwned: false });
    });
    it('routes recommendation dislike through Omni and preserves write failures', async () => {
        expect(omni.canDislikeSong(song())).toBe(true);
        await expect(omni.dislikeSong(song())).resolves.toEqual({});
        expect(request).toHaveBeenCalledWith('dislike_song', { id: song().id, disliked: true });
        request.mockResolvedValue({ ok: false, error: { code: 'auth-required', message: 'Sign in' } });
        await expect(qishuiMutations.likeSong!(song(), true)).rejects.toMatchObject({ code: 'auth-required' });
    });
});

describe('Qishui explicit playability checks', () => {
    it('retains preview metadata through Omni, never applying clip offsets to full songs', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { url: 'https://v.example.test/clip', quality: 'standard', fetchedAt: 1, preview: true, clipStartMs: 30000 } })
            .mockResolvedValueOnce({ ok: true, data: { url: 'https://v.example.test/full', quality: 'standard', fetchedAt: 1, preview: false, clipStartMs: 30000 } });
        const preview = await omni.getAudioSource(song(), 'standard');
        expect(preview).toMatchObject({ preview: true, clipStartMs: 30000 });
        expect(omni.isPreviewAudioSource(preview!.url)).toBe(true);
        expect(omni.previewClipStartMsOfAudioSource(preview!.url)).toBe(30000);
        const full = await omni.getAudioSource(song(), 'standard');
        expect(omni.previewClipStartMsOfAudioSource(full!.url)).toBe(0);
        expect(omni.previewClipStartMsOfAudioSource('https://unknown.test/clip')).toBe(0);
    });
    it('distinguishes an explicit pass from restriction, unknown codes and missing tracks', async () => {
        request.mockResolvedValue({ ok: true, data: { statuses: [
            { id: '1', riskResult: 0 }, { id: '2', riskResult: 5 }, { id: '3', riskResult: -1 },
        ] } });
        const songs = await readQishuiSongs(['1', '2', '3', '4'].map(id => track(id)));
        expect(songs.map(song => qishuiProvider.playback!.getAvailability!(song))).toEqual([
            { state: 'playable' }, { state: 'unknown', reason: 'restricted' }, { state: 'unknown' }, { state: 'unknown' },
        ]);
        clearQishuiPlayback();
        expect(qishuiProvider.playback!.getAvailability!(songs[0])).toEqual({ state: 'unknown' });
    });
    it('does not hide search results when the optional check fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        request.mockResolvedValueOnce({ ok: true, data: { items: [track('1')], nextOffset: 1, hasMore: false } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'Unavailable' } });
        const page = await qishuiProvider.search!.searchSongs('Song', 20, 0);
        expect(page.items.map(song => song.id)).toEqual(['1']);
        expect(qishuiProvider.playback!.getAvailability!(page.items[0])).toEqual({ state: 'unknown' });
    });
    it('drops a playability answer that arrives after an account change', async () => {
        let finish!: (reply: unknown) => void;
        request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = readQishuiSongs([track('1')]);
        clearQishuiPlayback();
        finish({ ok: true, data: { statuses: [{ id: '1', riskResult: 0 }] } });
        const [song] = await pending;
        expect(qishuiProvider.playback!.getAvailability!(song)).toEqual({ state: 'unknown' });
    });
});
