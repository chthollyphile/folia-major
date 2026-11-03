import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveProviderAccountSnapshot } from '@/services/onlineMusic/providerAccountCache';
import { omni, PLAYLIST_ADD_BATCH } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OmniRequestRunner, OmniSongDetail, OnlineMusicProvider, ProviderCapabilities, ProviderCollection } from '@/types/onlineMusic';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import { installOmniResultHooks } from '@/services/hostExtensionHooks';

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
                getLikedSongIds: async () => ({ ids: ['liked-song'], whole: true }),
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

    it('adds several songs to one playlist in a single provider request', async () => {
        const updateTracks = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: { updatePlaylistTracks: updateTracks },
        });
        const collection: ProviderCollection = { providerId, id: 'batch', name: 'Batch', type: 'playlist' };
        const songs = [song(providerId, 'one'), song(providerId, 'two'), song(providerId, 'three')];

        await omni.addSongsToPlaylist(songs, collection);

        expect(updateTracks).toHaveBeenCalledTimes(1);
        expect(updateTracks).toHaveBeenCalledWith('add', collection, songs);
    });

    it('splits a long batch into requests of PLAYLIST_ADD_BATCH, in order', async () => {
        const updateTracks = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: { updatePlaylistTracks: updateTracks },
        });
        const collection: ProviderCollection = { providerId, id: 'long', name: 'Long', type: 'playlist' };
        const songs = Array.from({ length: PLAYLIST_ADD_BATCH * 2 + 3 }, (_, index) => song(providerId, `s${index}`));

        await omni.addSongsToPlaylist(songs, collection);

        expect(updateTracks.mock.calls.map(call => (call as unknown[])[2])).toEqual([
            songs.slice(0, PLAYLIST_ADD_BATCH),
            songs.slice(PLAYLIST_ADD_BATCH, PLAYLIST_ADD_BATCH * 2),
            songs.slice(PLAYLIST_ADD_BATCH * 2),
        ]);
    });

    it('still refreshes the account playlists when a later batch fails', async () => {
        const updateTracks = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('rate limited'));
        const getUserPlaylists = vi.fn(async () => ({ items: [], hasMore: false, nextOffset: 0 }));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: { updatePlaylistTracks: updateTracks },
            library: { getUserPlaylists },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { user: { id: 'user', nickname: 'User' } });
        const collection: ProviderCollection = { providerId, id: 'partial', name: 'Partial', type: 'playlist' };
        const songs = Array.from({ length: PLAYLIST_ADD_BATCH + 1 }, (_, index) => song(providerId, `p${index}`));

        await expect(omni.addSongsToPlaylist(songs, collection)).rejects.toThrow('rate limited');
        await vi.waitFor(() => expect(getUserPlaylists).toHaveBeenCalled());
    });

    it('refuses the whole batch when one song is of another provider', async () => {
        const updateTracks = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, mutations: true, playlistTrackMutations: true },
            mutations: { updatePlaylistTracks: updateTracks },
        });
        const collection: ProviderCollection = { providerId, id: 'batch', name: 'Batch', type: 'playlist' };

        await expect(omni.addSongsToPlaylist([song(providerId, 'one'), song('netease', 'stray')], collection))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(updateTracks).not.toHaveBeenCalled();
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

    it('takes no report of a song its provider says it cannot vouch for', () => {
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            capabilities: { ...capabilities, playbackReports: true },
            playbackReports: { canReport: target => target.id !== '6', reportPlayback: async () => {} },
        });

        expect(omni.canReportPlayback(song(providerId, '5'))).toBe(true);
        expect(omni.canReportPlayback(song(providerId, '6'))).toBe(false);
    });

    it('answers false rather than throwing for a song no online provider owns', () => {
        const localSong = { ...song(providerId), sourceRef: { kind: 'local', mediaId: 'local-1' } } as UnifiedSong;

        expect(omni.canReportPlayback(localSong)).toBe(false);
    });
});

// The media cache keeps the level a copy was fetched at, and asks for it by the URL the bytes came
// from: the quality option may be moved between a URL being handed out and its bytes being saved.
describe('the level an audio URL was handed out at', () => {
    // A provider that tells two levels apart and puts the one it was asked for in its URL.
    const twoLevelProvider = (
        urlOf = (mediaId: string, quality: string) => `https://${providerId}/${mediaId}/${quality}`,
    ): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        playback: {
            getSongDetail: async mediaId => song(providerId, String(mediaId)),
            audioQualityLevels: ['standard', 'high'],
            getAudioSource: async (target, quality) => ({
                url: urlOf(String(target.sourceRef?.mediaId), quality), fetchedAt: 1, quality,
            }),
        },
    });

    it('is the level the preference meant to the provider when that URL was asked for', async () => {
        registerOnlineMusicProvider(twoLevelProvider());

        const first = await omni.getAudioSource(song(providerId, 'a'), 'standard');
        // The option is moved while the first URL is still playing.
        const second = await omni.getAudioSource(song(providerId, 'a'), 'hires');

        expect(omni.levelOfAudioSource(first!.url)).toBe('standard');
        expect(omni.levelOfAudioSource(second!.url)).toBe('high');
    });

    it('is unknown for a URL no provider handed out', () => {
        expect(omni.levelOfAudioSource('blob:http://localhost/0b8f')).toBeUndefined();
        expect(omni.levelOfAudioSource('https://navidrome.test/rest/stream?id=1')).toBeUndefined();
    });

    // NetEase hands out http and playback upgrades it to https. A deck that has played out reports
    // its element's `currentSrc`, which is the URL as the parser writes it.
    it('is found by the spelling playback and the audio element hold', async () => {
        registerOnlineMusicProvider(twoLevelProvider(mediaId => `http://m1.music.126.net/${mediaId} live.mp3`));

        await omni.getAudioSource(song(providerId, 'b'), 'high');

        expect(omni.levelOfAudioSource('https://m1.music.126.net/b%20live.mp3')).toBe('high');
    });

    it('forgets the oldest URL once it holds 200', async () => {
        registerOnlineMusicProvider(twoLevelProvider());

        for (let index = 0; index <= 200; index += 1) {
            await omni.getAudioSource(song(providerId, `n${index}`), 'high');
        }

        expect(omni.levelOfAudioSource(`https://${providerId}/n0/high`)).toBeUndefined();
        expect(omni.levelOfAudioSource(`https://${providerId}/n1/high`)).toBe('high');
    });
});

// A preview clip may begin somewhere inside its song rather than at its start. Playback reads the
// start by the URL its deck holds, the same way it reads whether the URL is a clip at all.
describe('where a preview clip starts in its song', () => {
    const clipProvider = (clipStartMs?: number): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        playback: {
            getSongDetail: async mediaId => song(providerId, String(mediaId)),
            getAudioSource: async target => ({
                url: `https://${providerId}/${target.sourceRef?.mediaId}`,
                fetchedAt: 1,
                quality: 'standard',
                preview: true,
                ...(clipStartMs ? { clipStartMs } : {}),
            }),
        },
    });

    it('is remembered with the URL it was handed out under', async () => {
        registerOnlineMusicProvider(clipProvider(208320));
        const version = omni.audioSourceMetadataVersion();

        await omni.getAudioSource(song(providerId, 'clip'), 'standard');
        expect(omni.audioSourceMetadataVersion()).toBe(version + 1);

        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/clip`)).toBe(208320);
    });

    it.each([NaN, Infinity, -Infinity, -1])('ignores an invalid clip start: %s', async clipStartMs => {
        registerOnlineMusicProvider(clipProvider(clipStartMs));
        await omni.getAudioSource(song(providerId, 'invalid-start'), 'standard');
        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/invalid-start`)).toBe(0);
    });

    it('forgets a preview start if the same URL is handed out as a whole song', async () => {
        registerOnlineMusicProvider(clipProvider(30000));
        await omni.getAudioSource(song(providerId, 'same-url'), 'standard');
        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/same-url`)).toBe(30000);
        registerOnlineMusicProvider({
            ...clipProvider(30000),
            playback: {
                getSongDetail: async mediaId => song(providerId, String(mediaId)),
                getAudioSource: async () => ({
                    url: `https://${providerId}/same-url`, fetchedAt: 1, quality: 'standard',
                    preview: false, clipStartMs: 30000,
                }),
            },
        });
        await omni.getAudioSource(song(providerId, 'same-url'), 'standard');
        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/same-url`)).toBe(0);
    });

    it('expires old preview entries with the bounded audio-source registry', async () => {
        registerOnlineMusicProvider(clipProvider(30000));
        for (let index = 0; index <= 200; index++) {
            await omni.getAudioSource(song(providerId, `preview-${index}`), 'standard');
        }
        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/preview-0`)).toBe(0);
        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/preview-1`)).toBe(30000);
    });

    it('is zero for a clip that starts at the beginning and for a URL no provider handed out', async () => {
        registerOnlineMusicProvider(clipProvider());

        await omni.getAudioSource(song(providerId, 'from-start'), 'standard');

        expect(omni.previewClipStartMsOfAudioSource(`https://${providerId}/from-start`)).toBe(0);
        expect(omni.previewClipStartMsOfAudioSource('blob:http://localhost/0b8f')).toBe(0);
    });
});

// What a provider knows of a failed request is left on the error it threw, and the error goes on as it is.
describe('a request for audio or for a collection\'s tracks that fails', () => {
    const refused = new Error('E_SEVENTH 7');
    const failing = (describeFailure: OnlineMusicProvider['describeFailure']): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        describeFailure,
        playback: {
            getSongDetail: async mediaId => song(providerId, String(mediaId)),
            getAudioSource: async () => { throw refused; },
        },
        catalog: { getPlaylistTracks: async () => { throw refused; } },
    });
    const playlist = { providerId, id: 'p1', name: 'P', type: 'playlist' } as ProviderCollection;

    afterEach(() => installOmniResultHooks(null));

    it('leaves the provider\'s description on the error, for the audio and for the tracks', async () => {
        const describeFailure = vi.fn((operation: string) => ({ code: '7', message: `${operation} refused` }));
        registerOnlineMusicProvider(failing(describeFailure));

        const audioError = await omni.getAudioSource(song(providerId), 'high').catch((error: unknown) => error);
        expect(audioError).toBe(refused);
        expect(onlineFailureOf({ operation: 'audio' }, { error: audioError })).toMatchObject({ case: 'refused', facts: { code: '7', message: 'audio refused' } });

        const tracksError = await omni.getCollectionTracks(playlist, { limit: 10, offset: 0 }).catch((error: unknown) => error);
        expect(tracksError).toBe(refused);
        expect(onlineFailureOf({ operation: 'collection' }, { error: tracksError }).facts.message).toBe('collection refused');
        expect(describeFailure.mock.calls.map(([operation]) => operation)).toEqual(['audio', 'collection']);
    });

    it('lets the error go on as it is when the provider\'s description throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerOnlineMusicProvider(failing(() => { throw new TypeError('bad'); }));

        await expect(omni.getAudioSource(song(providerId), 'high')).rejects.toBe(refused);
        expect(warn).toHaveBeenCalledWith('[Omni] describeFailure threw; the error goes on without a note', { operation: 'audio' }, expect.any(TypeError));
        warn.mockRestore();
    });

    // A mod's omni audio hook could always give a URL where the provider gave none; a provider that throws keeps that.
    it('asks the mods\' audio hook for a source when the provider threw, and throws only when it gives none', async () => {
        registerOnlineMusicProvider(failing(() => null));
        const hook = vi.fn(async (_song: unknown, source: unknown) => source as null);
        installOmniResultHooks({ audio: hook });
        await expect(omni.getAudioSource(song(providerId), 'high')).rejects.toBe(refused);
        expect(hook).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), null);

        installOmniResultHooks({ audio: async () => ({ url: 'https://mod.test/1.mp3', fetchedAt: 1, quality: 'standard' }) });
        await expect(omni.getAudioSource(song(providerId), 'high')).resolves.toMatchObject({ url: 'https://mod.test/1.mp3' });
    });
});

describe('omni like mutations', () => {
    const likeProvider = (likeSong: NonNullable<OnlineMusicProvider['mutations']>['likeSong']): OnlineMusicProvider => ({
        ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
        capabilities: { ...capabilities, mutations: true, likes: true },
        mutations: { likeSong },
    });

    afterEach(() => useOnlineProviderAccountStore.getState().clearAccount(providerId));

    const seedAccount = (state: { likedSongIds: string[] }) => {
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            status: 'authenticated',
            user: { id: 'user', nickname: 'Listener' },
            ...state,
        });
    };

    it('keeps likedSongIds in sync when likeSong is called directly', async () => {
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: ['7'] });

        await omni.likeSong(song(providerId, '7'), false);

        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        expect(account.likedSongIds).toEqual([]);
    });

    // What a provider needs beyond the song to like or unlike it (a row in its liked playlist) is
    // the adapter's own to keep.
    it('hands the provider the song and the state asked for, and nothing else', async () => {
        const likeSong = vi.fn(async () => undefined);
        registerOnlineMusicProvider(likeProvider(likeSong));
        seedAccount({ likedSongIds: ['7'] });

        const target = song(providerId, '7');
        await omni.likeSong(target, false);

        expect(likeSong).toHaveBeenCalledExactlyOnceWith(target, false);
    });

    it('leaves the liked state untouched when the mutation fails', async () => {
        registerOnlineMusicProvider(likeProvider(async () => { throw new Error('network'); }));
        seedAccount({ likedSongIds: ['7'] });

        await expect(omni.likeSong(song(providerId, '7'), false)).rejects.toThrow('network');

        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        expect(account.likedSongIds).toEqual(['7']);
    });

    it('persists the new liked list so a restart does not restore the old heart', async () => {
        vi.mocked(saveProviderAccountSnapshot).mockClear();
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: ['7'] });

        await omni.likeSong(song(providerId, '7'), false);

        expect(saveProviderAccountSnapshot).toHaveBeenCalledWith(providerId, expect.objectContaining({
            likedSongIds: [],
        }));
    });

    it('keeps the mutation successful when persisting the snapshot fails', async () => {
        vi.mocked(saveProviderAccountSnapshot).mockRejectedValueOnce(new Error('disk full'));
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: [] });

        await expect(omni.likeSong(song(providerId, '7'), true)).resolves.toBeUndefined();
        expect(useOnlineProviderAccountStore.getState().accounts[providerId].likedSongIds.map(String)).toEqual(['7']);
    });

    it('adds the song to likedSongIds', async () => {
        registerOnlineMusicProvider(likeProvider(async () => undefined));
        seedAccount({ likedSongIds: [] });

        const nextLiked = await omni.toggleSongLike(song(providerId, '7'));

        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        expect(nextLiked).toBe(true);
        expect(account.likedSongIds.map(String)).toEqual(['7']);
    });
});

// What Folium's `folium.omni` reads through: songs by id many at a time, lyrics before the
// extension layers, a song's album and artists, and searches kept apart by caller.
describe('omni reads for callers beside the host UI', () => {
    // A detail as these tests compare it: the song's name where one was found, its status otherwise.
    const namesOf = (detail: OmniSongDetail): string => (detail.status === 'found' ? detail.song.name : detail.status);

    afterEach(() => installOmniResultHooks(null));

    it('asks a provider that looks many songs up at once once, in the order of the ids', async () => {
        const getSongDetail = vi.fn(async (mediaId: string | number) => song(providerId, String(mediaId)));
        const getSongDetails = vi.fn(async (ids: (string | number)[]) => ids.map(id => (id === 'gone' ? null : song(providerId, String(id)))));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: { getSongDetail, getSongDetails, getAudioSource: async () => null },
        });

        let runs = 0;
        const run: OmniRequestRunner = work => {
            runs += 1;
            return work();
        };
        const details = await omni.getSongDetails(providerId, ['b', 'gone', 'a'], { run });

        expect(details.map(namesOf)).toEqual([`${providerId}:b`, 'missing', `${providerId}:a`]);
        expect(getSongDetails).toHaveBeenCalledTimes(1);
        expect(getSongDetails).toHaveBeenCalledWith(['b', 'gone', 'a']);
        expect(getSongDetail).not.toHaveBeenCalled();
        // One call to the provider, so one request for the caller to count.
        expect(runs).toBe(1);
    });

    it('fails every id of a many-at-once request that failed, and skips them all where run refused it', async () => {
        const refusal = new Error('the provider refused the song details');
        const getSongDetails = vi.fn(async (_ids: (string | number)[]): Promise<(UnifiedSong | null)[]> => { throw refusal; });
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: { getSongDetail: async () => null, getSongDetails, getAudioSource: async () => null },
        });

        await expect(omni.getSongDetails(providerId, ['1', '2'])).resolves.toEqual([
            { status: 'failed', error: refusal },
            { status: 'failed', error: refusal },
        ]);

        const limited = Object.assign(new Error('rate-limited'), { code: 'rate-limited' });
        getSongDetails.mockClear();
        await expect(omni.getSongDetails(providerId, ['1', '2'], { run: async () => { throw limited; } })).resolves.toEqual([
            { status: 'skipped', error: limited },
            { status: 'skipped', error: limited },
        ]);
        expect(getSongDetails).not.toHaveBeenCalled();
    });

    // A provider whose request takes only so many ids (`songDetailsPerRequest`) is asked in groups of that many,
    // each group its own request through the caller's runner, so that every request is counted.
    describe('a provider that takes so many ids a request', () => {
        const registerGrouped = (
            getSongDetails: (ids: (string | number)[]) => Promise<(UnifiedSong | null)[]>,
            songDetailsPerRequest: number,
        ) => registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: { getSongDetail: async () => null, getSongDetails, songDetailsPerRequest, getAudioSource: async () => null },
        });
        const countingRun = () => {
            const counted = { runs: 0 };
            const run: OmniRequestRunner = work => {
                counted.runs += 1;
                return work();
            };
            return { counted, run };
        };

        it('asks it in groups, one after another, each through run, in the order of the ids', async () => {
            let running = 0;
            let most = 0;
            const getSongDetails = vi.fn(async (ids: (string | number)[]) => {
                running += 1;
                most = Math.max(most, running);
                await new Promise(resolve => setTimeout(resolve, 1));
                running -= 1;
                return ids.map(id => (id === 'd' ? null : song(providerId, String(id))));
            });
            registerGrouped(getSongDetails, 2);
            const { counted, run } = countingRun();

            const details = await omni.getSongDetails(providerId, ['a', 'b', 'c', 'd', 'e'], { run });

            expect(getSongDetails.mock.calls.map(([ids]) => ids)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
            expect(counted.runs).toBe(3);
            expect(most).toBe(1);
            expect(details.map(namesOf)).toEqual([
                `${providerId}:a`, `${providerId}:b`, `${providerId}:c`, 'missing', `${providerId}:e`,
            ]);
        });

        it('fails only the group whose request failed, and asks the groups after it', async () => {
            const gone = new Error('the provider refused this group');
            const getSongDetails = vi.fn(async (ids: (string | number)[]) => {
                if (ids.includes('c')) throw gone;
                return ids.map(id => song(providerId, String(id)));
            });
            registerGrouped(getSongDetails, 2);

            const details = await omni.getSongDetails(providerId, ['a', 'b', 'c', 'd', 'e']);

            expect(getSongDetails).toHaveBeenCalledTimes(3);
            expect(details.map(namesOf)).toEqual([`${providerId}:a`, `${providerId}:b`, 'failed', 'failed', `${providerId}:e`]);
            expect(details[2]).toEqual({ status: 'failed', error: gone });
            expect(details[3]).toEqual({ status: 'failed', error: gone });
        });

        it('skips the group run refuses and every one after it, without asking them', async () => {
            const getSongDetails = vi.fn(async (ids: (string | number)[]) => ids.map(id => song(providerId, String(id))));
            registerGrouped(getSongDetails, 2);
            const limited = Object.assign(new Error('rate-limited'), { code: 'rate-limited' });
            let runs = 0;
            const run: OmniRequestRunner = work => {
                runs += 1;
                return runs === 2 ? Promise.reject(limited) : work();
            };

            const details = await omni.getSongDetails(providerId, ['a', 'b', 'c', 'd', 'e'], { run });

            expect(getSongDetails.mock.calls.map(([ids]) => ids)).toEqual([['a', 'b']]);
            expect(runs).toBe(2);
            expect(details).toEqual([
                { status: 'found', song: expect.objectContaining({ name: `${providerId}:a` }) },
                { status: 'found', song: expect.objectContaining({ name: `${providerId}:b` }) },
                { status: 'skipped', error: limited },
                { status: 'skipped', error: limited },
                { status: 'skipped', error: limited },
            ]);
        });

        it.each([0, -1, 2.5, Number.NaN])('asks all the ids at once where the number is %s', async (per) => {
            const getSongDetails = vi.fn(async (ids: (string | number)[]) => ids.map(id => song(providerId, String(id))));
            registerGrouped(getSongDetails, per);
            const { counted, run } = countingRun();

            const details = await omni.getSongDetails(providerId, ['a', 'b', 'c', 'd', 'e'], { run });

            expect(getSongDetails.mock.calls.map(([ids]) => ids)).toEqual([['a', 'b', 'c', 'd', 'e']]);
            expect(counted.runs).toBe(1);
            expect(details.map(namesOf)).toEqual(['a', 'b', 'c', 'd', 'e'].map(id => `${providerId}:${id}`));
        });
    });

    it('asks any other provider for one song after another, never two at a time', async () => {
        let running = 0;
        let most = 0;
        const getSongDetail = vi.fn(async (mediaId: string | number) => {
            running += 1;
            most = Math.max(most, running);
            await new Promise(resolve => setTimeout(resolve, 1));
            running -= 1;
            return mediaId === 'gone' ? null : song(providerId, String(mediaId));
        });
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: { getSongDetail, getAudioSource: async () => null },
        });

        let runs = 0;
        const run: OmniRequestRunner = work => {
            runs += 1;
            return work();
        };
        const details = await omni.getSongDetails(providerId, ['x', 'gone', 'y'], { run });

        expect(details.map(namesOf)).toEqual([`${providerId}:x`, 'missing', `${providerId}:y`]);
        expect(getSongDetail.mock.calls.map(([id]) => id)).toEqual(['x', 'gone', 'y']);
        expect(most).toBe(1);
        // Each id is its own request to the provider: the caller's runner sees every one.
        expect(runs).toBe(3);
        await expect(omni.getSongDetails(providerId, [])).resolves.toEqual([]);
    });

    it('keeps asking past an id whose request fails, with the provider\'s own error on it', async () => {
        const gone = new Error('the provider threw for this id');
        const getSongDetail = vi.fn(async (mediaId: string | number) => {
            if (mediaId === 'bad') throw gone;
            return song(providerId, String(mediaId));
        });
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: { getSongDetail, getAudioSource: async () => null },
        });

        const first = await omni.getSongDetails(providerId, ['x', 'bad', 'y']);
        expect(first.map(namesOf)).toEqual([`${providerId}:x`, 'failed', `${providerId}:y`]);
        expect(first[1]).toEqual({ status: 'failed', error: gone });

        // A runner that rejects with an error of its own for a request that failed: still that id's
        // failure, with the provider's error, and the ids after it are asked.
        getSongDetail.mockClear();
        const mapping = async <T>(work: () => Promise<T>): Promise<T> => {
            try {
                return await work();
            } catch {
                throw new Error('network');
            }
        };
        const details = await omni.getSongDetails(providerId, ['bad', 'y'], { run: mapping });
        expect(details[0]).toEqual({ status: 'failed', error: gone });
        expect(namesOf(details[1])).toBe(`${providerId}:y`);
        expect(getSongDetail).toHaveBeenCalledTimes(2);
    });

    it('stops asking once run refuses a request, or stops waiting for one, and hands on what it already has', async () => {
        const getSongDetail = vi.fn(async (mediaId: string | number) => song(providerId, String(mediaId)));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: { getSongDetail, getAudioSource: async () => null },
        });

        // Over the allowance from the second request on: refused before the provider is asked.
        const limited = Object.assign(new Error('rate-limited'), { code: 'rate-limited' });
        let allowed = 1;
        const allowance = async <T>(work: () => Promise<T>): Promise<T> => {
            if (allowed <= 0) throw limited;
            allowed -= 1;
            return work();
        };
        const details = await omni.getSongDetails(providerId, ['a', 'b', 'c'], { run: allowance });
        expect(namesOf(details[0])).toBe(`${providerId}:a`);
        expect(details.slice(1)).toEqual([{ status: 'skipped', error: limited }, { status: 'skipped', error: limited }]);
        expect(getSongDetail.mock.calls.map(([id]) => id)).toEqual(['a']);

        // No answer in time: the request runs on, but nothing more is asked.
        getSongDetail.mockClear();
        const late = Object.assign(new Error('network'), { code: 'network' });
        const impatient = async <T>(work: () => Promise<T>): Promise<T> => {
            void work();
            throw late;
        };
        await expect(omni.getSongDetails(providerId, ['a', 'b'], { run: impatient })).resolves.toEqual([
            { status: 'skipped', error: late },
            { status: 'skipped', error: late },
        ]);
        expect(getSongDetail).toHaveBeenCalledTimes(1);
    });

    it('answers nothing found for every id of a provider that plays nothing', async () => {
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            playback: undefined,
        });
        await expect(omni.getSongDetails(providerId, ['1', '2'])).resolves.toEqual([{ status: 'missing' }, { status: 'missing' }]);
    });

    it('reads lyrics past the extension layers with extensionHooks: false, and through them by default', async () => {
        const getLyrics = vi.fn(async (_song: unknown, _context?: unknown) => ({ lyrics: null, mainText: 'provider text', isPureMusic: true }));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            lyrics: { getLyrics },
        });
        const hook = vi.fn(async (_song: unknown, result: object) => ({ ...result, mainText: 'rewritten', lyrics: null, isPureMusic: false }));
        installOmniResultHooks({ lyrics: hook });

        const plain = await omni.getLyrics(song(providerId), { extensionHooks: false });
        expect(plain).toMatchObject({ mainText: 'provider text', isPureMusic: true });
        expect(hook).not.toHaveBeenCalled();
        // The option is Omni's own: the provider is asked as it always is.
        expect(Object.keys(getLyrics.mock.calls[0][1] as object)).not.toContain('extensionHooks');

        await expect(omni.getLyrics(song(providerId))).resolves.toMatchObject({ mainText: 'rewritten' });
        expect(hook).toHaveBeenCalledTimes(1);
    });

    it('hands the caller\'s search session to the provider as it is, and none for the host\'s own search', async () => {
        const searchSongs = vi.fn(async (..._args: unknown[]) => ({ items: [song(providerId)], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider(provider(providerId, { searchSongs }));
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        const context = { session: 'folium:mod-a' };

        await omni.searchSongs('query', { limit: 10, offset: 0 }, context);
        await omni.searchProviderSongs(providerId, 'query', { limit: 5, offset: 5 }, context);
        await omni.searchProviderSongs(providerId, 'query', { limit: 5, offset: 0 });

        expect(searchSongs.mock.calls).toEqual([
            ['query', 10, 0, context],
            ['query', 5, 5, context],
            ['query', 5, 0],
        ]);
        expect(searchSongs.mock.calls[0][3]).toBe(context);
    });

    describe('a song\'s album and artists', () => {
        const catalogCapabilities = { ...capabilities, albums: true, artists: true };
        const listed = (owner: string): UnifiedSong => ({
            ...song(owner, 's1'),
            album: { id: 'shown-album', name: 'Album' },
            artists: [{ id: 'shown-a', name: 'A' }, { id: 'shown-b', name: 'B' }, { id: 'shown-a2', name: 'a ' }],
        });
        const resolved = (owner: string): UnifiedSong => ({
            ...listed(owner),
            album: { id: 'album-1', name: 'Album', catalogRef: { providerId: owner, kind: 'album', id: 'album-1' } },
            artists: [
                { id: 'artist-a', name: 'A', catalogRef: { providerId: owner, kind: 'artist', id: 'artist-a' } },
                { id: 'artist-b', name: 'B', catalogRef: { providerId: owner, kind: 'artist', id: 'artist-b' } },
            ],
        });

        it('reads them with one answer of the provider\'s resolver, each ref once, with its name', async () => {
            const resolveSongCatalogRefs = vi.fn(async (_target: UnifiedSong) => resolved(providerId));
            registerOnlineMusicProvider({
                ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
                capabilities: catalogCapabilities,
                catalog: { resolveSongCatalogRefs },
            });

            await expect(omni.getSongCatalogRefs(listed(providerId))).resolves.toEqual({
                album: { providerId, kind: 'album', id: 'album-1', name: 'Album' },
                artists: [
                    { providerId, kind: 'artist', id: 'artist-a', name: 'A' },
                    { providerId, kind: 'artist', id: 'artist-b', name: 'B' },
                ],
            });
            expect(resolveSongCatalogRefs).toHaveBeenCalledTimes(1);
        });

        it('takes the ids the song carries where the provider has no resolver', async () => {
            registerOnlineMusicProvider({
                ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
                capabilities: catalogCapabilities,
            });
            const target: UnifiedSong = { ...listed(providerId), artists: [{ id: 'shown-a', name: 'A' }, { id: '', name: 'Nobody' }] };

            await expect(omni.getSongCatalogRefs(target)).resolves.toEqual({
                album: { providerId, kind: 'album', id: 'shown-album', name: 'Album' },
                artists: [{ providerId, kind: 'artist', id: 'shown-a', name: 'A' }],
            });
        });

        it('leaves out the kinds the provider does not have, and asks nothing where it has neither', async () => {
            const resolveSongCatalogRefs = vi.fn(async (_target: UnifiedSong) => resolved(providerId));
            registerOnlineMusicProvider({
                ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
                capabilities: { ...capabilities, albums: true, artists: false },
                catalog: { resolveSongCatalogRefs },
            });
            await expect(omni.getSongCatalogRefs(listed(providerId))).resolves.toMatchObject({ album: { id: 'album-1' }, artists: [] });

            unregisterOnlineMusicProvider(providerId);
            registerOnlineMusicProvider({
                ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
                catalog: { resolveSongCatalogRefs },
            });
            resolveSongCatalogRefs.mockClear();
            await expect(omni.getSongCatalogRefs(listed(providerId))).resolves.toEqual({ album: null, artists: [] });
            expect(resolveSongCatalogRefs).not.toHaveBeenCalled();
        });

        it('answers none for a song that is not online', async () => {
            const local = { ...listed(providerId), sourceRef: { kind: 'local', mediaId: 's1' } } as UnifiedSong;
            await expect(omni.getSongCatalogRefs(local)).resolves.toEqual({ album: null, artists: [] });
        });
    });
});
