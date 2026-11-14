// @builtin-sources
import { beforeEach, describe, expect, it } from 'vitest';
import { clearBodianLibraryCache } from '../../../sources/bodian/client/bodianLibrary';
import { answerBodianRequests, lazyBodian } from '../helpers/bodianSource';

// test/unit/onlineMusic/bodianMutations.test.ts
// The mutations of the Bodian source mod as the host has them (registered by the unit setup); requests to its main
// entry are answered here. Folium 2.0 S5: the library cache is the module's own, so its clearing is seen by the next
// read asking Bodian again, not by a mock of the function.

const { request } = answerBodianRequests();
const bodianMutations = lazyBodian(provider => provider.mutations);
const bodianLibrary = lazyBodian(provider => provider.library);

beforeEach(() => { request.mockReset(); clearBodianLibraryCache(); });

/** Reads the account's playlists once, so that a later page comes from the module's cache unless it was cleared. */
const primeLibraryCache = async () => {
    request.mockImplementation(async (operation: string) => (
        operation === 'user_playlists' ? { liked: {}, owned: { playLists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }, collected: {} } : {}
    ));
    await bodianLibrary.getUserPlaylists('100', 1, 0);
    request.mockClear();
};
const libraryCacheWasCleared = async () => {
    await bodianLibrary.getUserPlaylists('100', 1, 1);
    return request.mock.calls.some(([operation]) => operation === 'user_playlists');
};

describe('Bodian mutation adapter', () => {
    it.each(['add', 'del'] as const)('uses one bounded batch for the liked playlist (%s)', async operation => {
        const playlist = { providerId: 'bodian', type: 'playlist' as const, id: '123', name: '我喜欢', isOwned: true, isLiked: true };
        await bodianMutations.updatePlaylistTracks!(operation, playlist, ['456', '789']);
        expect(request).toHaveBeenCalledExactlyOnceWith(operation === 'add' ? 'playlist_tracks_add' : 'playlist_tracks_del',
            { id: '123', trackIds: '456,789' });
        request.mockClear();
        await expect(bodianMutations.updatePlaylistTracks!(operation, playlist, Array.from({ length: 101 }, (_, i) => String(i + 1))))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(request).not.toHaveBeenCalled();
    });
    it('serializes track IDs through the primitive-only IPC contract', async () => {
        await primeLibraryCache();
        await bodianMutations.updatePlaylistTracks!('add', { providerId: 'bodian', type: 'playlist', id: '123', name: 'Test', isOwned: true }, ['456', '789']);
        expect(request).toHaveBeenCalledWith('playlist_tracks_add', { id: '123', trackIds: '456,789' });
        expect(await libraryCacheWasCleared()).toBe(true);
    });
    it('invalidates cached pages even when the write response fails', async () => {
        await primeLibraryCache();
        request.mockRejectedValue(new Error('response lost'));
        await expect(bodianMutations.updatePlaylistTracks!('del', '123', ['456'])).rejects.toThrow('response lost');
        request.mockReset();
        request.mockResolvedValue({ liked: {}, owned: { playLists: [] }, collected: {} });
        expect(await libraryCacheWasCleared()).toBe(true);
    });
    // Folium 2.0 S5: a playlist of another provider never reaches the source (omni.updateCollectionTracks sends a
    // collection to its own provider, and refuses one of another provider than the song's); what the source still
    // refuses itself, before any request, is a playlist the account does not own.
    it('rejects a playlist the account does not own before IPC', async () => {
        await expect(bodianMutations.updatePlaylistTracks!('add', { providerId: 'bodian', type: 'playlist', id: '123', name: 'Other', isOwned: false }, ['456']))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(request).not.toHaveBeenCalled();
    });
    it('maps like state to the single-song IPC operation', async () => {
        await bodianMutations.likeSong!('456', false);
        expect(request).toHaveBeenCalledWith('like_song', { id: '456', liked: false });
    });
});
