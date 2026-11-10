import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodianMutations } from '@/services/onlineMusic/bodian/bodianMutations';

// test/unit/onlineMusic/bodianMutations.test.ts

const mocks = vi.hoisted(() => ({ request: vi.fn(), clear: vi.fn() }));
vi.mock('@/services/onlineMusic/bodian/bodianTransport', () => ({ requestBodian: mocks.request }));
vi.mock('@/services/onlineMusic/bodian/bodianLibrary', () => ({ clearBodianLibraryCache: mocks.clear }));
beforeEach(() => vi.resetAllMocks());

describe('Bodian mutation adapter', () => {
    it.each(['add', 'del'] as const)('uses one bounded batch for the liked playlist (%s)', async operation => {
        const playlist = { providerId: 'bodian', type: 'playlist' as const, id: '123', name: '我喜欢', isOwned: true, isLiked: true };
        await bodianMutations.updatePlaylistTracks!(operation, playlist, ['456', '789']);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith(operation === 'add' ? 'playlist_tracks_add' : 'playlist_tracks_del',
            { id: '123', trackIds: '456,789' });
        mocks.request.mockClear();
        await expect(bodianMutations.updatePlaylistTracks!(operation, playlist, Array.from({ length: 101 }, (_, i) => String(i + 1))))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it('serializes track IDs through the primitive-only IPC contract', async () => {
        await bodianMutations.updatePlaylistTracks!('add', { providerId: 'bodian', type: 'playlist', id: '123', name: 'Test', isOwned: true }, ['456', '789']);
        expect(mocks.request).toHaveBeenCalledWith('playlist_tracks_add', { id: '123', trackIds: '456,789' });
        expect(mocks.clear).toHaveBeenCalled();
    });
    it('invalidates cached pages even when the write response fails', async () => {
        mocks.request.mockRejectedValue(new Error('response lost'));
        await expect(bodianMutations.updatePlaylistTracks!('del', '123', ['456'])).rejects.toThrow('response lost');
        expect(mocks.clear).toHaveBeenCalled();
    });
    it('rejects another provider playlist before IPC', async () => {
        await expect(bodianMutations.updatePlaylistTracks!('add', { providerId: 'qq', type: 'playlist', id: '123', name: 'Other', isOwned: true }, ['456']))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it('maps like state to the single-song IPC operation', async () => {
        await bodianMutations.likeSong!('456', false);
        expect(mocks.request).toHaveBeenCalledWith('like_song', { id: '456', liked: false });
    });
});
