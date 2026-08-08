import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshQqLibraryAccount, type QqLibraryRefreshDeps } from '@/hooks/useQqLibrary';
import type { OnlineProviderAccountState } from '@/stores/useOnlineProviderAccountStore';
import type { ProviderCollection, ProviderUser } from '@/types/onlineMusic';

// test/unit/hooks/useQqLibrary.test.ts

const QQ_CAPABILITIES = {
    search: true,
    playback: true,
    lyrics: true,
    auth: true,
    userLibrary: true,
    playlists: true,
    albums: false,
    artists: false,
    recommendations: false,
    mutations: false,
    wordByWordLyrics: true,
    likes: true,
};

// The acceptance test account reached `GetLoginUserInfo` with an empty nickname, and `normalizeQqUser` reports `id: ''`
// when the profile carries no account id, so the leanest real user is the one worth testing against.
const NAMELESS_USER: ProviderUser = { id: '', nickname: '' };

const collection = (id: number, name: string): ProviderCollection => ({
    providerId: 'qq',
    id: String(id),
    name,
    type: 'playlist',
});

const createDeps = (overrides: Partial<QqLibraryRefreshDeps> = {}): QqLibraryRefreshDeps => ({
    availability: { configured: true },
    capabilities: { ...QQ_CAPABILITIES },
    cachedUser: null,
    checkLoginStatus: vi.fn().mockResolvedValue(NAMELESS_USER),
    loadLikedSongIds: vi.fn().mockResolvedValue([]),
    loadPlaylistPage: vi.fn().mockResolvedValue({ items: [], hasMore: false, nextOffset: 0 }),
    saveSnapshot: vi.fn().mockResolvedValue(1_770_000_000_000),
    updateAccount: vi.fn(),
    ...overrides,
});

const patchesFrom = (updateAccount: QqLibraryRefreshDeps['updateAccount']): Partial<OnlineProviderAccountState>[] => (
    vi.mocked(updateAccount).mock.calls.map(([patch]) => patch)
);

describe('useQqLibrary refresh', () => {
    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('marks the account anonymous without contacting the backend when the API base is not configured', async () => {
        const deps = createDeps({ availability: { configured: false, reason: 'not-configured' } });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(false);

        expect(deps.checkLoginStatus).not.toHaveBeenCalled();
        expect(deps.loadLikedSongIds).not.toHaveBeenCalled();
        expect(deps.loadPlaylistPage).not.toHaveBeenCalled();
        expect(patchesFrom(deps.updateAccount)).toEqual([{
            status: 'anonymous',
            user: null,
            error: 'not-configured',
            hydration: 'ready',
            freshness: 'fresh',
        }]);
    });

    it('treats a profile with no nickname and no account id as authenticated', async () => {
        const deps = createDeps({
            loadPlaylistPage: vi.fn().mockResolvedValue({
                items: [collection(7, '我喜欢')],
                hasMore: false,
                nextOffset: 1,
            }),
        });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(true);

        const final = patchesFrom(deps.updateAccount).at(-1);
        expect(final).toMatchObject({
            status: 'authenticated',
            user: NAMELESS_USER,
            collections: [collection(7, '我喜欢')],
            freshness: 'fresh',
            lastUpdatedAt: 1_770_000_000_000,
        });
        // An empty account id is forwarded as-is; the provider then omits `uid` and the session supplies it.
        expect(deps.loadPlaylistPage).toHaveBeenCalledWith('', 50, 0);
    });

    it('stops refreshing and skips playlists when the session is gone', async () => {
        const deps = createDeps({
            cachedUser: NAMELESS_USER,
            checkLoginStatus: vi.fn().mockResolvedValue(null),
        });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(false);

        expect(deps.loadPlaylistPage).not.toHaveBeenCalled();
        expect(deps.saveSnapshot).not.toHaveBeenCalled();
        // The cached account keeps its authenticated shell while the status call decides; clearing is the hook's job.
        expect(patchesFrom(deps.updateAccount)).toEqual([{
            status: 'authenticated',
            hydration: 'ready',
            freshness: 'refreshing',
            error: undefined,
        }]);
    });

    it('walks every playlist page until the provider reports no more local rows', async () => {
        const loadPlaylistPage = vi.fn()
            .mockResolvedValueOnce({ items: [collection(7, '我喜欢')], hasMore: true, nextOffset: 50 })
            .mockResolvedValueOnce({ items: [collection(8, '收藏')], hasMore: false, nextOffset: 51 });
        const deps = createDeps({ loadPlaylistPage });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(true);

        expect(loadPlaylistPage.mock.calls).toEqual([['', 50, 0], ['', 50, 50]]);
        expect(patchesFrom(deps.updateAccount).at(-1)?.collections)
            .toEqual([collection(7, '我喜欢'), collection(8, '收藏')]);
    });

    it('stops paging when the provider stops advancing its offset', async () => {
        const loadPlaylistPage = vi.fn().mockResolvedValue({
            items: [collection(7, '我喜欢')],
            hasMore: true,
            nextOffset: 0,
        });
        const deps = createDeps({ loadPlaylistPage });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(true);

        expect(loadPlaylistPage).toHaveBeenCalledOnce();
    });

    it('keeps the authenticated account and records the failure when playlists cannot be read', async () => {
        const deps = createDeps({
            loadPlaylistPage: vi.fn().mockRejectedValue(new Error('qq_request_failed_500')),
        });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(true);

        expect(deps.saveSnapshot).not.toHaveBeenCalled();
        expect(patchesFrom(deps.updateAccount).at(-1)).toEqual({
            status: 'authenticated',
            user: NAMELESS_USER,
            error: 'qq_request_failed_500',
            hydration: 'ready',
            freshness: 'error',
        });
    });

    it('loads liked song ids and saves them in the account snapshot', async () => {
        const deps = createDeps({
            loadLikedSongIds: vi.fn().mockResolvedValue(['liked-mid']),
            loadPlaylistPage: vi.fn().mockResolvedValue({
                items: [collection(7, '我喜欢')],
                hasMore: false,
                nextOffset: 1,
            }),
        });

        await refreshQqLibraryAccount(deps);

        expect(deps.loadLikedSongIds).toHaveBeenCalledWith('');
        expect(deps.saveSnapshot).toHaveBeenCalledWith(NAMELESS_USER, [collection(7, '我喜欢')], ['liked-mid']);
        expect(patchesFrom(deps.updateAccount).at(-1)?.likedSongIds).toEqual(['liked-mid']);
    });

    it('skips the playlist walk when the provider does not declare a user library', async () => {
        const deps = createDeps({
            capabilities: { ...QQ_CAPABILITIES, userLibrary: false },
        });

        await expect(refreshQqLibraryAccount(deps)).resolves.toBe(true);

        expect(deps.loadPlaylistPage).not.toHaveBeenCalled();
        expect(deps.saveSnapshot).toHaveBeenCalledWith(NAMELESS_USER, [], []);
    });
});
