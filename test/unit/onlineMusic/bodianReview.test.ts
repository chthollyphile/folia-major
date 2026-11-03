import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/bodianReview.test.ts — shared-provider regressions raised in the Bodian review.

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));
afterEach(() => {
    vi.restoreAllMocks();
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
    omni.invalidateActiveRequests();
});

describe('daily recommendation capability', () => {
    it.each([['netease', true], ['kugou', true], ['qq', true], ['bodian', false]] as const)(
        'shows the daily entry according to %s support', (providerId, supported) => {
            expect(omni.supportsDailySongs(providerId)).toBe(supported);
        },
    );
    it('keeps the daily entry after a transient empty Netease result', async () => {
        const recommendations = getOnlineMusicProvider('netease')!.recommendations!;
        vi.spyOn(recommendations, 'getDailySongs').mockResolvedValue([]);
        vi.spyOn(recommendations, 'getPersonalFm').mockResolvedValue([]);
        vi.spyOn(recommendations, 'getRecommendedCollections').mockResolvedValue([]);
        useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
        expect((await omni.getHomeFeed()).dailySongs).toEqual([]);
        expect(omni.supportsDailySongs('netease')).toBe(true);
    });
});

// Keep the actual provider capability/ownership checks; isolate only network and persistence work.
function prepareLikedAddition(providerId: string) {
    const song: UnifiedSong = { id: '1', name: 'Test', artists: [], album: { id: '', name: '' }, durationMs: 1,
        sourceRef: { kind: 'online', providerId, mediaId: '1' } };
    const playlist: ProviderCollection = { providerId, id: '2', type: 'playlist', name: 'Liked', isOwned: true, isLiked: true };
    useOnlineProviderAccountStore.getState().updateAccount(providerId, {
        user: { id: 'user', nickname: 'Listener' }, likedSongIds: ['existing'],
    });
    vi.spyOn(omni, 'canAddSongToPlaylist').mockReturnValue(true);
    vi.spyOn(omni, 'updateCollectionTracks').mockResolvedValue(undefined);
    vi.spyOn(omni, 'refreshProviderPlaylists').mockResolvedValue([]);
    const readLikes = vi.spyOn(omni, 'getProviderLikedSongIds');
    return { song, playlist, readLikes };
}

describe('liked playlist refresh', () => {
    // NetEase among them: its liked list is asked for past the API server's cache (netease.ts).
    it.each(['netease', 'bodian', 'kugou'])('does not delay %s mutation success while fetching the liked list', async providerId => {
        const { song, playlist, readLikes } = prepareLikedAddition(providerId);
        let finish!: (liked: { ids: string[]; whole: boolean }) => void;
        readLikes.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await omni.addSongToPlaylist(song, playlist);
        expect(readLikes).toHaveBeenCalledWith(providerId, 'user');
        finish({ ids: ['existing', '1'], whole: true });
        await vi.waitFor(() => expect(useOnlineProviderAccountStore.getState().accounts[providerId].likedSongIds).toEqual(['existing', '1']));
    });

    it('ignores a late liked list after logout', async () => {
        const { song, playlist, readLikes } = prepareLikedAddition('bodian');
        let finish!: (liked: { ids: string[]; whole: boolean }) => void;
        readLikes.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await omni.addSongToPlaylist(song, playlist);
        useOnlineProviderAccountStore.getState().clearAccount('bodian');
        finish({ ids: ['stale'], whole: true });
        await Promise.resolve();
        expect(useOnlineProviderAccountStore.getState().accounts.bodian.likedSongIds).toEqual([]);
    });

    it('keeps a like made while the liked list was being fetched, and takes the list for the other songs', async () => {
        const { song, playlist, readLikes } = prepareLikedAddition('bodian');
        vi.spyOn(getOnlineMusicProvider('bodian')!.mutations!, 'likeSong').mockResolvedValue(undefined);
        let finish!: (liked: { ids: string[]; whole: boolean }) => void;
        readLikes.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await omni.addSongToPlaylist(song, playlist);
        await omni.likeSong({ ...song, id: 'newer', sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'newer' } }, true);
        // The list as it was before that like.
        finish({ ids: ['of-the-list'], whole: true });
        await vi.waitFor(() => expect(useOnlineProviderAccountStore.getState().accounts.bodian.likedSongIds).toEqual(['of-the-list', 'newer']));
    });
});
