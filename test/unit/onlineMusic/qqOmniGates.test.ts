import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { normalizeQqCollection, normalizeQqSong } from '@/services/onlineMusic/qq/qqNormalize';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { canDislikeCurrentSong } from '@/utils/playerLikeAvailability';
import type { UnifiedSong } from '@/types';

// test/unit/onlineMusic/qqOmniGates.test.ts
// QQ 能收藏歌单与专辑、能加删歌、能红心，却不能不喜欢：通用界面的门控按真 provider 走一遍。

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));

afterEach(() => {
    vi.restoreAllMocks();
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
    omni.invalidateActiveRequests();
});

// GetPlaylistByUin 的自建条目带 dirName；收藏条目没有。
const liked = normalizeQqCollection({ tid: 7, dirId: 201, dirName: '我喜欢', songNum: 2 });
const owned = normalizeQqCollection({ tid: 70001, dirId: 5, dirName: '自建', songNum: 3 });
const ownedSystemDir = normalizeQqCollection({ tid: 70002, dirId: 5, dirType: 2, dirName: '系统目录', songNum: 3 });
const favourite = normalizeQqCollection({ tid: 80001, dirId: 36, name: '收藏的歌单', songnum: 9 });
const recommended = normalizeQqCollection({ tid: 90001, title: '推荐歌单', creator: { encrypt_uin: 'enc', nick: '别人' } });

describe('QQ collection gates', () => {
    // 「我喜欢」以前编辑不了（没有红心），会因此落到收藏分支，一点就是去收藏自己的 201 目录。
    it('never offers to subscribe the account\'s own playlists, liked one included', () => {
        expect(omni.canSubscribeCollection(liked)).toBe(false);
        expect(omni.canSubscribeCollection(owned)).toBe(false);
        expect(omni.canSubscribeCollection(favourite)).toBe(true);
        expect(omni.canSubscribeCollection(recommended)).toBe(true);
        // 3.3.1 起能收藏专辑。
        expect(omni.canSubscribeCollection({ ...recommended, type: 'album' })).toBe(true);
    });

    it('edits only the ordinary playlists the backend accepts writes for', () => {
        expect(omni.canEditCollectionTracks(owned)).toBe(true);
        expect(omni.canEditCollectionTracks(ownedSystemDir)).toBe(false);
        // 「我喜欢」走红心：删歌就是取消红心。
        expect(omni.canEditCollectionTracks(liked)).toBe(true);
    });

    it('offers the like button on a QQ song', () => {
        expect(omni.canLikeSong(normalizeQqSong({ mid: 'mid-a', id: 1, name: 'a', singer: [], album: {} }))).toBe(true);
    });
});

describe('QQ personal FM dislike', () => {
    const qqSong = normalizeQqSong({ mid: 'mid-a', id: 1, name: 'a', singer: [], album: {} });

    it('greys out the FM trash for a provider without dislike', () => {
        expect(canDislikeCurrentSong(qqSong)).toBe(false);
        expect(canDislikeCurrentSong(null)).toBe(false);
        const neteaseSong: UnifiedSong = { id: 1, name: 'n', artists: [], album: { id: '', name: '' }, durationMs: 1,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } };
        expect(canDislikeCurrentSong(neteaseSong)).toBe(true);
    });
});

describe('home feed sections', () => {
    const qqRecommendations = () => getOnlineMusicProvider('qq')!.recommendations!;

    // 日推被上游拒绝不该把 FM 卡和推荐歌单一起拖下去。
    it('keeps the other sections when one fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(qqRecommendations(), 'getPersonalFm').mockResolvedValue([]);
        vi.spyOn(qqRecommendations(), 'getDailySongs').mockRejectedValue(new Error('recommendation.rejected'));
        vi.spyOn(qqRecommendations(), 'getRecommendedCollections').mockResolvedValue([recommended]);
        useOnlineProviderAccountStore.getState().setActiveProviderId('qq');

        await expect(omni.getHomeFeed()).resolves.toEqual({ personalFm: [], dailySongs: [], recommendedCollections: [recommended], partial: true });
        expect(console.warn).toHaveBeenCalledWith('[Omni] Home feed section failed', expect.objectContaining({ providerId: 'qq' }));
    });

    it('reports a complete feed without the partial flag', async () => {
        vi.spyOn(qqRecommendations(), 'getPersonalFm').mockResolvedValue([]);
        vi.spyOn(qqRecommendations(), 'getDailySongs').mockResolvedValue([]);
        vi.spyOn(qqRecommendations(), 'getRecommendedCollections').mockResolvedValue([]);
        useOnlineProviderAccountStore.getState().setActiveProviderId('qq');

        expect(await omni.getHomeFeed()).not.toHaveProperty('partial');
    });

    // 作废不是某一块的失败：一块被中止，整次照常作废，资源也就不会把空块当成读到的结果。
    it('aborts the whole feed when one section was aborted', async () => {
        const abort = new DOMException('aborted', 'AbortError');
        vi.spyOn(qqRecommendations(), 'getPersonalFm').mockResolvedValue([]);
        vi.spyOn(qqRecommendations(), 'getDailySongs').mockRejectedValue(abort);
        vi.spyOn(qqRecommendations(), 'getRecommendedCollections').mockResolvedValue([]);
        useOnlineProviderAccountStore.getState().setActiveProviderId('qq');

        await expect(omni.getHomeFeed()).rejects.toBe(abort);
    });

    it('fails only when every section failed', async () => {
        const failure = new Error('offline');
        vi.spyOn(qqRecommendations(), 'getPersonalFm').mockRejectedValue(failure);
        vi.spyOn(qqRecommendations(), 'getDailySongs').mockRejectedValue(new Error('offline too'));
        vi.spyOn(qqRecommendations(), 'getRecommendedCollections').mockRejectedValue(new Error('offline as well'));
        useOnlineProviderAccountStore.getState().setActiveProviderId('qq');

        await expect(omni.getHomeFeed()).rejects.toBe(failure);
    });
});
