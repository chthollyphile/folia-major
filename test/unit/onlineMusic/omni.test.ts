import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProviderAccountSnapshot } from '@/services/onlineMusic/providerAccountCache';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCapabilities, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/omni.test.ts

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

const providerId = 'omni-test';
const otherProviderId = 'omni-resource-test';
const missingProviderId = 'omni-missing-provider-test';
const capabilities: ProviderCapabilities = {
    search: true, playback: true, lyrics: false, auth: false, userLibrary: false,
    playlists: false, albums: false, artists: false, recommendations: false,
    mutations: false, wordByWordLyrics: false,
};
const song = (owner: string, mediaId = '1'): UnifiedSong => ({
    id: mediaId,
    name: `${owner}:${mediaId}`,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: owner, mediaId },
});

const provider = (id: string, search: OnlineMusicProvider['search']): OnlineMusicProvider => ({
    id,
    displayName: id,
    capabilities,
    normalizeSong: raw => song(id, String((raw as { id?: string }).id || '1')),
    search,
    playback: {
        getSongDetail: async mediaId => song(id, String(mediaId)),
        getAudioSource: async target => ({ url: `https://${id}/${target.sourceRef?.mediaId}`, fetchedAt: 1, quality: 'standard' }),
    },
});

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
    unregisterOnlineMusicProvider(otherProviderId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
});

describe('omni routing', () => {
    it('falls back from a persisted provider missing in the current build', () => {
        useOnlineProviderAccountStore.getState().setActiveProviderId(missingProviderId);

        expect(omni.getActiveProviderSummary()?.providerId).toBe('netease');
        expect(omni.getActiveCapabilities()).toEqual(omni.getProviderCapabilities('netease'));
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe(missingProviderId);
    });

    it('marks a provider without auth as one that needs no account', () => {
        registerOnlineMusicProvider(provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }));
        const summaries = omni.getProviderSummaries();

        expect(summaries.find(summary => summary.providerId === providerId)?.requiresAccount).toBe(false);
        expect(summaries.find(summary => summary.providerId === 'netease')?.requiresAccount).toBe(true);
    });

    it('reports songs from unavailable providers as unplayable without routing them elsewhere', () => {
        expect(omni.canPlaySong(song(missingProviderId))).toBe(false);
    });

    it('routes ordinary search through the active provider and resources through their owner', async () => {
        const activeSearch = vi.fn(async () => ({ items: [song(providerId)], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider(provider(providerId, { searchSongs: activeSearch }));
        registerOnlineMusicProvider(provider(otherProviderId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }));
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);

        await expect(omni.searchSongs('query', { limit: 10, offset: 0 })).resolves.toMatchObject({ items: [{ name: `${providerId}:1` }] });
        await expect(omni.getAudioSource(song(otherProviderId, '9'), 'standard')).resolves.toMatchObject({ url: `https://${otherProviderId}/9` });
        expect(activeSearch).toHaveBeenCalledWith('query', 10, 0);
    });

    it('forwards normalized provider ReplayGain metadata through the audio facade', async () => {
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: {
                getSongDetail: async mediaId => song(providerId, String(mediaId)),
                getAudioSource: async target => ({
                    url: `https://${providerId}/${target.sourceRef?.mediaId}`,
                    fetchedAt: 1,
                    quality: 'standard',
                    replayGain: { trackGain: -4.5 },
                }),
            },
        });

        await expect(omni.getAudioSource(song(providerId, 'gain-song'), 'standard')).resolves.toMatchObject({
            replayGain: { trackGain: -4.5 },
        });
    });

    it('routes chorus range lookup through the song owner', async () => {
        const getChorusRanges = vi.fn(async () => [{ startTime: 10, endTime: 20 }]);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            lyrics: {
                getLyrics: async () => ({ lyrics: null, isPureMusic: false }),
                getChorusRanges,
            },
        });

        const target = song(providerId, 'chorus-song');
        await expect(omni.getChorusRanges(target)).resolves.toEqual([{ startTime: 10, endTime: 20 }]);
        expect(getChorusRanges).toHaveBeenCalledWith('chorus-song');
    });

    it('rejects a late active-provider result after invalidation', async () => {
        let resolveSearch!: (value: { items: UnifiedSong[]; hasMore: false; nextOffset: number }) => void;
        registerOnlineMusicProvider(provider(providerId, {
            searchSongs: () => new Promise(resolve => { resolveSearch = resolve; }),
        }));
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        const pending = omni.searchSongs('late', { limit: 10, offset: 0 });
        omni.invalidateActiveRequests();
        resolveSearch({ items: [song(providerId)], hasMore: false, nextOffset: 1 });
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('reads provider song likes through the Omni facade', () => {
        const target = song(providerId, 'liked-song');
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            likedSongIds: ['liked-song'],
        });

        expect(omni.isSongLiked(target)).toBe(true);
        expect(omni.isSongLiked(song(providerId, 'other-song'))).toBe(false);
        expect(omni.isSongLiked({ ...target, sourceRef: { kind: 'local', mediaId: 'liked-song' } })).toBe(false);
    });

    it('returns only the owning provider playlists for an online song', () => {
        const playlist: ProviderCollection = {
            providerId,
            id: 'kugou-playlist',
            name: 'KuGou playlist',
            type: 'playlist',
        };
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            collections: [playlist, { ...playlist, id: 'kugou-album', type: 'album' }],
        });
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: { updatePlaylistTracks: async () => undefined },
        });

        expect(omni.getPlaylistsForSong(song(providerId))).toEqual([playlist]);
        expect(omni.getPlaylistsForSong({ ...song(providerId), sourceRef: { kind: 'local', mediaId: 'local-song' } })).toEqual([]);
    });

    it('does not expose read-only provider playlists as mutation targets', async () => {
        const playlist: ProviderCollection = {
            providerId,
            id: 'read-only-playlist',
            name: 'Read-only playlist',
            type: 'playlist',
        };
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, userLibrary: true, playlists: true },
            library: {
                getUserPlaylists: async () => ({ items: [playlist], hasMore: false, nextOffset: 1 }),
            },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { collections: [playlist] });

        expect(omni.canAddSongToPlaylist(song(providerId))).toBe(false);
        expect(omni.canEditCollectionTracks(playlist)).toBe(false);
        expect(omni.canSubscribeCollection(playlist)).toBe(false);
        expect(omni.getPlaylistsForSong(song(providerId))).toEqual([]);
        expect(omni.canDislikeSong(song(providerId))).toBe(false);
        await expect(omni.subscribe(playlist, true)).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.dislikeSong(song(providerId))).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('lets a provider hide playlists that cannot accept track mutations', () => {
        const addable: ProviderCollection = {
            providerId,
            id: 'addable',
            name: 'Addable',
            type: 'playlist',
        };
        const hidden: ProviderCollection = {
            providerId,
            id: 'hidden',
            name: 'Hidden',
            type: 'playlist',
        };
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: {
                canAddToPlaylist: playlist => playlist.id === addable.id,
                updatePlaylistTracks: async () => undefined,
            },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            collections: [addable, hidden],
        });

        expect(omni.getPlaylistsForSong(song(providerId))).toEqual([addable]);
    });

    it('refreshes the owning provider playlist cache through Omni', async () => {
        const playlist: ProviderCollection = {
            providerId,
            id: 'refreshed-playlist',
            name: 'Refreshed playlist',
            type: 'playlist',
        };
        const getUserPlaylists = vi.fn(async () => ({ items: [playlist], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            library: { getUserPlaylists },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'user', nickname: 'User' },
            collections: [{ providerId, id: 'cloud', name: 'Cloud', type: 'cloud' }],
        });

        await expect(omni.refreshProviderPlaylists(providerId)).resolves.toEqual([playlist]);

        expect(getUserPlaylists).toHaveBeenCalledWith('user', 50, 0);
        expect(useOnlineProviderAccountStore.getState().accounts[providerId]?.collections).toEqual([
            playlist,
            { providerId, id: 'cloud', name: 'Cloud', type: 'cloud' },
        ]);
    });

    it('toggles a song through its owning provider and updates only that provider cache', async () => {
        const kugouLike = vi.fn(async () => undefined);
        const neteaseLike = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, likes: true },
            mutations: { likeSong: kugouLike },
        });
        registerOnlineMusicProvider({
            ...provider(otherProviderId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, likes: true },
            mutations: { likeSong: neteaseLike },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { likedSongIds: ['existing'] });

        const target = song(providerId, 'kugou-song');
        await expect(omni.toggleSongLike(target)).resolves.toBe(true);

        expect(kugouLike).toHaveBeenCalledWith(target, true);
        expect(neteaseLike).not.toHaveBeenCalled();
        expect(useOnlineProviderAccountStore.getState().accounts[providerId]?.likedSongIds).toEqual(['existing', 'kugou-song']);
    });

    it('keeps readable likes visible without exposing an unsupported like mutation', async () => {
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, likes: true },
            library: {
                getUserPlaylists: async () => ({ items: [], hasMore: false, nextOffset: 0 }),
                getLikedSongIds: async () => ['liked-song'],
            },
        });
        const target = song(providerId, 'liked-song');
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { likedSongIds: ['liked-song'] });

        expect(omni.isSongLiked(target)).toBe(true);
        expect(omni.canLikeSong(target)).toBe(false);
        await expect(omni.toggleSongLike(target)).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('routes playlist track updates through the collection owner', async () => {
        const updateTracks = vi.fn(async () => undefined);
        const refreshedPlaylist: ProviderCollection = {
            providerId,
            id: 'kugou-playlist',
            name: 'Refreshed KuGou playlist',
            type: 'playlist',
        };
        const getUserPlaylists = vi.fn(async () => ({ items: [refreshedPlaylist], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: { updatePlaylistTracks: updateTracks },
            library: { getUserPlaylists },
        });
        const collection: ProviderCollection = {
            providerId,
            id: 'kugou-playlist',
            name: 'KuGou playlist',
            type: 'playlist',
        };
        const target = song(providerId, 'kugou-song');
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'user', nickname: 'User' },
        });

        await omni.addSongToPlaylist(target, collection);

        expect(updateTracks).toHaveBeenCalledWith('add', collection, [target]);
        expect(getUserPlaylists).toHaveBeenCalledWith('user', 50, 0);
    });

    it('rejects a playlist that its provider marks as non-mutable', async () => {
        const updateTracks = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: {
                canAddToPlaylist: () => false,
                updatePlaylistTracks: updateTracks,
            },
        });

        await expect(omni.addSongToPlaylist(song(providerId), {
            providerId,
            id: 'hidden',
            name: 'Hidden',
            type: 'playlist',
        })).rejects.toMatchObject({ code: 'unsupported' });
        expect(updateTracks).not.toHaveBeenCalled();
    });

    it('routes a listening report to the provider that owns the song', async () => {
        const reportPlayback = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, playbackReports: true },
            playbackReports: { reportPlayback },
        });
        registerOnlineMusicProvider(provider(otherProviderId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }));
        useOnlineProviderAccountStore.getState().setActiveProviderId(otherProviderId);

        const target = song(providerId, '5');
        expect(omni.canReportPlayback(target)).toBe(true);
        await omni.reportPlayback(target, { playedSeconds: 45, totalSeconds: 240 });

        expect(reportPlayback).toHaveBeenCalledWith(target, { playedSeconds: 45, totalSeconds: 240 });
    });

    it('refuses a listening report for a provider that does not declare the capability', async () => {
        registerOnlineMusicProvider(provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }));

        const target = song(providerId, '5');
        expect(omni.canReportPlayback(target)).toBe(false);
        await expect(omni.reportPlayback(target, { playedSeconds: 45 })).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('answers false rather than throwing for a song no online provider owns', () => {
        const localSong = { ...song(providerId), sourceRef: { kind: 'local', mediaId: 'local-1' } } as UnifiedSong;

        expect(omni.canReportPlayback(localSong)).toBe(false);
    });
});

describe('omni like mutations', () => {
    const likeProvider = (likeSong: NonNullable<OnlineMusicProvider['mutations']>['likeSong']): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        capabilities: { ...capabilities, mutations: true, likes: true },
        mutations: { likeSong },
    });

    afterEach(() => useOnlineProviderAccountStore.getState().clearAccount(providerId));

    const seedAccount = (state: { likedSongIds: string[]; likedSongFileIds: Record<string, string | number> }) => {
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            status: 'authenticated',
            user: { id: 'user', nickname: 'Listener' },
            ...state,
        });
    };

    it('keeps likedSongIds in sync when likeSong is called directly', async () => {
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: ['7'], likedSongFileIds: { '7': 987 } });

        await omni.likeSong(song(providerId, '7'), false);

        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        expect(account.likedSongIds).toEqual([]);
        expect(account.likedSongFileIds).toEqual({});
    });

    it('hands the cached playlist-local file id to the provider', async () => {
        const likeSong = vi.fn(async () => undefined);
        registerOnlineMusicProvider(likeProvider(likeSong));
        seedAccount({ likedSongIds: ['7'], likedSongFileIds: { '7': 987 } });

        const target = song(providerId, '7');
        await omni.likeSong(target, false);

        expect(likeSong).toHaveBeenCalledWith(target, false, { likedFileId: 987 });
    });

    it('leaves the liked state untouched and drops the stale file id when the mutation fails', async () => {
        registerOnlineMusicProvider(likeProvider(async () => { throw new Error('network'); }));
        seedAccount({ likedSongIds: ['7'], likedSongFileIds: { '7': 987 } });

        await expect(omni.likeSong(song(providerId, '7'), false)).rejects.toThrow('network');

        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        expect(account.likedSongIds).toEqual(['7']);
        expect(account.likedSongFileIds).toEqual({});
    });

    it('persists the new liked list so a restart does not restore the old heart', async () => {
        vi.mocked(saveProviderAccountSnapshot).mockClear();
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: ['7'], likedSongFileIds: { '7': 987 } });

        await omni.likeSong(song(providerId, '7'), false);

        expect(saveProviderAccountSnapshot).toHaveBeenCalledWith(providerId, expect.objectContaining({
            likedSongIds: [],
        }));
    });

    it('keeps the mutation successful when persisting the snapshot fails', async () => {
        vi.mocked(saveProviderAccountSnapshot).mockRejectedValueOnce(new Error('disk full'));
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: [], likedSongFileIds: {} });

        await expect(omni.likeSong(song(providerId, '7'), true)).resolves.toBeUndefined();
        expect(useOnlineProviderAccountStore.getState().accounts[providerId].likedSongIds.map(String)).toEqual(['7']);
    });

    it('adds the song to likedSongIds without inventing a file id', async () => {
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: [], likedSongFileIds: {} });

        const nextLiked = await omni.toggleSongLike(song(providerId, '7'));

        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        expect(nextLiked).toBe(true);
        expect(account.likedSongIds.map(String)).toEqual(['7']);
        expect(account.likedSongFileIds).toEqual({});
    });
});

// 盖楼门面：能力位决定「查看回复」按钮出不出；不支持的 provider 必须安静回空页而不是抛。
describe('omni comment reply threading', () => {
    const commentsProvider = (withReplies: boolean): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        capabilities: { ...capabilities, comments: true },
        comments: {
            getSongComments: async () => ({ items: [], hasMore: false, nextOffset: 0 }),
            ...(withReplies ? {
                getCommentReplies: async (_song: unknown, commentId: unknown) => ({
                    items: [{ id: String(commentId), content: '回复', userName: 'u' }],
                    hasMore: false,
                    nextOffset: 0,
                }),
            } : {}),
        },
    });

    it('threads replies through the owning provider when it supports the floor', async () => {
        registerOnlineMusicProvider(commentsProvider(true));
        const target = song(providerId, '9');
        expect(omni.canThreadCommentReplies(target)).toBe(true);
        const page = await omni.getSongCommentReplies(target, 'c-1', { limit: 20, offset: 0 });
        expect(page.items).toEqual([{ id: 'c-1', content: '回复', userName: 'u' }]);
    });

    it('hides threading and returns an empty page for providers without reply support', async () => {
        registerOnlineMusicProvider(commentsProvider(false));
        const target = song(providerId, '9');
        expect(omni.canThreadCommentReplies(target)).toBe(false);
        const page = await omni.getSongCommentReplies(target, 'c-1', { limit: 20, offset: 0 });
        expect(page.items).toEqual([]);
    });

    it('answers false for a song no online provider owns', () => {
        const localSong = { ...song(providerId), sourceRef: { kind: 'local', mediaId: 'local-1' } } as UnifiedSong;
        expect(omni.canThreadCommentReplies(localSong)).toBe(false);
    });

    // 点赞按能力位渲染：provider 没声明 likeComment 就 canLike=false，UI 连假按钮都不出。
    it('hides comment likes when the provider does not declare the mutation', () => {
        registerOnlineMusicProvider(commentsProvider(false));
        expect(omni.canLikeComment(song(providerId, '9'))).toBe(false);
    });

    it('routes a comment like through the provider that supports it', async () => {
        const likeComment = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, comments: true },
            comments: { getSongComments: async () => ({ items: [], hasMore: false, nextOffset: 0 }), likeComment },
        });
        const target = song(providerId, '9');
        expect(omni.canLikeComment(target)).toBe(true);
        await omni.likeComment(target, 'c-1', true);
        expect(likeComment).toHaveBeenCalledWith(target, 'c-1', true);
    });
});

// 首页（电台/发现）三段式信息流：任何一路失败都不得把整个首页拉空。
describe('omni home feed resilience', () => {
    const feedProvider = (overrides: Partial<NonNullable<OnlineMusicProvider['recommendations']>>): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        capabilities: { ...capabilities, recommendations: true },
        recommendations: {
            getPersonalFm: async () => [],
            getDailySongs: async () => [],
            getRecommendedCollections: async () => [],
            ...overrides,
        },
    });

    beforeEach(() => {
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('keeps the surviving sections when one section throws', async () => {
        registerOnlineMusicProvider(feedProvider({
            getPersonalFm: async () => { throw new Error('fm rate limited'); },
            getRecommendedCollections: async () => [{ id: 'c1', name: '广场', type: 'playlist' } as never],
        }));

        const feed = await omni.getHomeFeed(35, { scope: 'all' });
        // 挂掉的那一段自为空，其余段照常返回
        expect(feed.personalFm).toEqual([]);
        expect(feed.dailySongs).toEqual([]);
        expect(feed.recommendedCollections).toHaveLength(1);
    });

    it('skips the personal FM call entirely for the editorial scope', async () => {
        const getPersonalFm = vi.fn(async () => []);
        registerOnlineMusicProvider(feedProvider({ getPersonalFm }));
        await omni.getHomeFeed(35, { scope: 'editorial' });
        expect(getPersonalFm).not.toHaveBeenCalled();
    });
});
