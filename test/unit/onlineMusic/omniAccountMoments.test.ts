import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { saveProviderAccountSnapshot } from '@/services/onlineMusic/providerAccountCache';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { OnlineLibraryProvider, OnlineMusicProvider } from '@/types/onlineMusic';

// test/unit/onlineMusic/omniAccountMoments.test.ts
// A moment told to omni: the provider whose account is shown is asked for the count of its liked
// list, and the liked ids are read through the one rule when that count is not the one held.

vi.mock('@/services/onlineMusic/providerAccountCache', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/onlineMusic/providerAccountCache')>()),
    saveProviderAccountSnapshot: vi.fn(async () => ({
        version: 1 as const,
        savedAt: 1,
        user: { id: 'user', nickname: 'Listener' },
        collections: [],
        likedSongIds: [],
    })),
}));

// A provider of its own for every test: omni keeps when each provider was last checked.
let providerId = '';
let made = 0;

const show = (library: Partial<OnlineLibraryProvider>, likedSongIds: string[]) => {
    const provider: OnlineMusicProvider = {
        id: providerId,
        displayName: providerId,
        capabilities: {
            search: false, playback: true, lyrics: false, auth: true, userLibrary: true,
            playlists: true, albums: false, artists: false, recommendations: false,
            mutations: true, likes: true, wordByWordLyrics: false,
        },
        normalizeSong: raw => raw as never,
        library: { getUserPlaylists: async () => ({ items: [], hasMore: false, nextOffset: 0 }), ...library },
    };
    registerOnlineMusicProvider(provider);
    useOnlineProviderAccountStore.setState({ activeProviderId: providerId });
    useOnlineProviderAccountStore.getState().updateAccount(providerId, {
        status: 'authenticated',
        user: { id: 'user', nickname: 'Listener' },
        likedSongIds,
    });
};

const likedIds = () => useOnlineProviderAccountStore.getState().accounts[providerId].likedSongIds;

describe('omni account moments', () => {
    let log: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        made += 1;
        providerId = `omni-account-moment-test-${made}`;
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(saveProviderAccountSnapshot).mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        unregisterOnlineMusicProvider(providerId);
        useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
    });

    it('reads the liked ids of the provider shown when its count differs, applies them by the rule and saves them', async () => {
        const getLikedSongCount = vi.fn(async () => 2);
        const getLikedSongIds = vi.fn(async () => ({ ids: ['kept', 'liked-elsewhere'], whole: true }));
        show({ getLikedSongCount, getLikedSongIds }, ['kept']);

        omni.accountMoment('window-returned');

        await vi.waitFor(() => expect(likedIds()).toEqual(['kept', 'liked-elsewhere']));
        expect(getLikedSongCount).toHaveBeenCalledWith('user');
        expect(getLikedSongIds).toHaveBeenCalledWith('user');
        expect(log.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            `[Like] ${providerId}: window-returned: the liked list counts 2, 1 held: the liked songs are read whole`,
            `[Like] ${providerId}: liked songs read (whole, 2 ids) applied: 1 added, 0 removed, 0 kept because pressed`,
        ]);
        await vi.waitFor(() => expect(saveProviderAccountSnapshot).toHaveBeenCalledWith(providerId, expect.objectContaining({
            likedSongIds: ['kept', 'liked-elsewhere'],
        })));
    });

    it('reads nothing while the count is the number of liked ids held', async () => {
        const getLikedSongCount = vi.fn(async () => 1);
        const getLikedSongIds = vi.fn(async () => ({ ids: ['another'], whole: true }));
        show({ getLikedSongCount, getLikedSongIds }, ['kept']);

        omni.accountMoment('home-entered');

        await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
            `[Like] ${providerId}: home-entered: the liked list counts 1, 1 held: the liked songs are not read`,
        ));
        expect(getLikedSongIds).not.toHaveBeenCalled();
        expect(likedIds()).toEqual(['kept']);
    });

    it('takes an empty list where the count asked just before was 0 too: the last heart taken back elsewhere goes out', async () => {
        const getLikedSongIds = vi.fn(async () => ({ ids: [], whole: true }));
        show({ getLikedSongCount: async () => 0, getLikedSongIds }, ['unliked-elsewhere']);

        omni.accountMoment('window-returned');

        await vi.waitFor(() => expect(likedIds()).toEqual([]));
        expect(log).toHaveBeenCalledWith(`[Like] ${providerId}: liked songs read (whole, 0 ids) applied: 0 added, 1 removed, 0 kept because pressed`);
        await vi.waitFor(() => expect(saveProviderAccountSnapshot).toHaveBeenCalled());
    });

    it('lets the rule refuse an empty list the platform did not count as empty: it puts no heart out', async () => {
        const getLikedSongIds = vi.fn(async () => ({ ids: [], whole: true }));
        show({ getLikedSongCount: async () => 2, getLikedSongIds }, ['kept']);

        omni.accountMoment('window-returned');

        await vi.waitFor(() => expect(getLikedSongIds).toHaveBeenCalled());
        await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('not applied: it is empty while items are held')));
        expect(likedIds()).toEqual(['kept']);
        expect(saveProviderAccountSnapshot).not.toHaveBeenCalled();
    });

    it('reads nothing from a provider whose adapter has no count of its liked list', async () => {
        const getLikedSongIds = vi.fn(async () => ({ ids: ['another'], whole: true }));
        show({ getLikedSongIds }, ['kept']);

        omni.accountMoment('window-returned');

        await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
            `[Like] ${providerId}: window-returned: its adapter has no count of the liked list short of reading it: the liked songs are not read`,
        ));
        expect(getLikedSongIds).not.toHaveBeenCalled();
    });
});
