// @vitest-environment jsdom
// @builtin-sources
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { OnlineMusicProvider, ProviderCapabilities } from '@/types/onlineMusic';

// test/unit/onlineMusic/matchingOnlyInterface.test.ts
// Folium 2.0 (dev/folium/folium-2-plan.md §5.3): a source used only for matching is in none of the lists the
// interface draws - the switcher and the sign-in window (the account controller's list), the search sources,
// the source in effect (home, explore), the command palette's search-<id> - nor in what folium.omni and
// folium.account show a mod. It is still a lyric source and a metadata match source, it counts as signed out
// (its account is not read, shown or reported to, and what it kept stays), its songs are marked and do not play,
// and a switch of its state shows at once. One rule for a source registered at run time (as a source mod's is)
// and for a platform the host still registers itself: only the state table decides.

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({ searchQQLyrics: vi.fn(async () => []), fetchQQLyrics: vi.fn(async () => null) }));
// switchSourceState asks the main process through the mods bridge: it answers with the table it now holds.
vi.mock('@/mods/ipc', async (importOriginal) => ({
    ...await importOriginal<Record<string, unknown>>(),
    invokeSetSourceState: vi.fn(async (sourceId: string, state: string) => ({ ok: true, states: { [sourceId]: state } })),
}));

const { omni } = await import('@/services/onlineMusic/omni');
const { registerOnlineMusicProvider, unregisterOnlineMusicProvider } = await import('@/services/onlineMusic/providerRegistry');
const { canSourceMatchOnly, getSourceState, setSourceStates } = await import('@/services/onlineMusic/sourceStates');
const { declareSource } = await import('@/services/onlineMusic/sourceDeclarations');
const { participants, isParticipantReady, participantSkipReason } = await import('@/services/onlineMusic/crossSource');
const { getSongTag, isSongSourceMissing } = await import('@/services/onlineMusic/songAvailability');
const { getPlaybackReportProviderIds } = await import('@/services/onlineMusic/playbackReportGate');
const { useOnlineProviderAccountStore } = await import('@/stores/useOnlineProviderAccountStore');
const { accountStorePort } = await import('@/library/core/account/providerAccountDeps.service');
const { COMMAND_PALETTE_COMMANDS } = await import('@/components/command-palette/commandRegistry');
const { installProviderSearchCommands } = await import('@/components/command-palette/providerSearchCommandsInstaller');
const { resolveSearchSources, useSearchSources } = await import('@/components/app/search/searchSources');
const { useCrossSourceParticipants } = await import('@/hooks/useCrossSourceParticipants');
const { FOLIUM_HOST_OMNI_SOURCE } = await import('@/mods/runtime/omni/hostOmni');
const { getFoliumAccountState } = await import('@/mods/runtime/hostAccount');
const { isQueueSongPlayable } = await import('@/components/app/playback/playableSong');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');
const { getPrefetchedData, updatePrefetchedAudioUrl } = await import('@/services/prefetchService');
const { keptPlayAccountsOf, noteSongPlayed } = await import('@/components/app/home/explore/recentPlays');
const { historyScopes } = await import('@/components/app/scratchpad/useScratchpadHistory');
const { switchSourceState } = await import('@/mods/runtime/sourceSwitches');
const { invokeSetSourceState } = await import('@/mods/ipc');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A source registered at run time, as a Folium 2 source mod's is (the host does not know it is a mod). */
const SAMPLE = 'sample-matcher';

const capabilities = (patch: Partial<ProviderCapabilities>): ProviderCapabilities => ({
    search: false, playback: false, lyrics: false, auth: false, userLibrary: false, playlists: false, albums: false,
    artists: false, recommendations: false, mutations: false, wordByWordLyrics: false, ...patch,
});

const getAudioSource = vi.fn(async () => ({ url: 'https://example.invalid/a.mp3' }));
const getLoginStatus = vi.fn(async () => ({ status: 'anonymous' as const }));
const getLyrics = vi.fn(async () => ({ lyrics: null, isPureMusic: false }));
const reportPlayback = vi.fn(async () => undefined);
const sampleProvider = {
    id: SAMPLE,
    displayName: 'Sample',
    capabilities: capabilities({
        search: true, playback: true, auth: true, playbackReports: true, lyrics: true,
        mutations: true, likes: true, playlistTrackMutations: true,
    }),
    normalizeSong: (raw: unknown) => raw,
    search: { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) },
    playback: { getAudioSource, getSongDetail: async () => null },
    playbackReports: { reportPlayback },
    lyrics: { getLyrics },
    mutations: { likeSong: vi.fn(async () => undefined), updatePlaylistTracks: vi.fn(async () => undefined), createPlaylist: vi.fn() },
    auth: { getLoginStatus, logout: async () => undefined },
} as unknown as OnlineMusicProvider;

const songOf = (providerId: string): SongResult => ({
    id: `${providerId}-1`, name: 'Song', artists: [], album: { id: '', name: '' }, duration: 1000,
    sourceRef: { kind: 'online', providerId, mediaId: '1' },
} as unknown as SongResult);

const signedIn = (nickname: string) => ({
    status: 'authenticated' as const,
    user: { id: `${nickname}-id`, nickname },
    collections: [],
    likedSongIds: [],
    wantedLikes: {},
    hydration: 'ready' as const,
    freshness: 'fresh' as const,
});

const shownIds = () => omni.getProviderSummaries().map(summary => summary.providerId);
const searchCommandIds = () => COMMAND_PALETTE_COMMANDS.map(command => command.id).filter(id => id.startsWith('search-'));

let undeclare: () => void = () => undefined;

beforeEach(() => {
    registerOnlineMusicProvider(sampleProvider);
    // It gives local songs online details without an account (songs@1.metadataMatch, access anonymous).
    undeclare = declareSource(SAMPLE, { songs: { access: 'anonymous', metadataMatch: true }, checksAvailability: false });
    installProviderSearchCommands();
});

afterEach(() => {
    setSourceStates({});
    undeclare();
    unregisterOnlineMusicProvider(SAMPLE);
    useOnlineProviderAccountStore.setState({ accounts: {} });
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    getAudioSource.mockClear();
    getLoginStatus.mockClear();
});

describe.each([
    ['a source registered at run time', SAMPLE],
    ['a platform the host registers itself', 'qq'],
])('%s, used only for matching', (_kind, sourceId) => {
    it('is in none of the interface\'s lists, and comes back to them when enabled again', () => {
        setSourceStates({ [sourceId]: 'matching' });
        // The switcher and the sign-in window list what the account controller lists.
        expect(shownIds()).not.toContain(sourceId);
        expect(accountStorePort.listProviders().map(summary => summary.providerId)).not.toContain(sourceId);
        // The command palette's search command for it (installed once, before the switch: it follows by itself).
        expect(searchCommandIds()).not.toContain(`search-${sourceId}`);
        // What a mod is shown (folium.omni.listProviders, folium.account.getState).
        expect(FOLIUM_HOST_OMNI_SOURCE.listProviders().map(info => info.providerId)).not.toContain(sourceId);
        expect(getFoliumAccountState(sourceId)).toBeNull();
        // It stays registered: its name is still read by id (the lyric source rows show it).
        expect(omni.getProviderLabel(sourceId)).not.toBe('');

        setSourceStates({});
        expect(shownIds()).toContain(sourceId);
        expect(accountStorePort.listProviders().map(summary => summary.providerId)).toContain(sourceId);
        expect(searchCommandIds()).toContain(`search-${sourceId}`);
        expect(FOLIUM_HOST_OMNI_SOURCE.listProviders().map(info => info.providerId)).toContain(sourceId);
    });

    it('is in the list for matching, signed out', () => {
        useOnlineProviderAccountStore.setState({ accounts: { [sourceId]: signedIn('listener') } });
        setSourceStates({ [sourceId]: 'matching' });
        const summary = omni.getMatchingProviderSummaries().find(candidate => candidate.providerId === sourceId);
        expect(summary).toMatchObject({ status: 'anonymous', user: null, collections: [] });
        setSourceStates({ [sourceId]: 'disabled' });
        expect(omni.getMatchingProviderSummaries().map(candidate => candidate.providerId)).not.toContain(sourceId);
        expect(shownIds()).not.toContain(sourceId);
    });

    it('is never the source in effect: the stored choice stays, and is in effect again once it is enabled', () => {
        useOnlineProviderAccountStore.getState().setActiveProviderId(sourceId);
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe(sourceId);
        setSourceStates({ [sourceId]: 'matching' });
        const { activeProviderId, chosenProviderId } = useOnlineProviderAccountStore.getState();
        expect(activeProviderId).not.toBe(sourceId);
        expect(shownIds()).toContain(activeProviderId);
        expect(chosenProviderId).toBe(sourceId);
        expect(localStorage.getItem('active_online_provider_id')).toBe(sourceId);
        expect(omni.getActiveProviderSummary()?.providerId).toBe(activeProviderId);
        setSourceStates({});
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe(sourceId);
    });

    it('counts as signed out: its account is not read, shown or reported to, and what it kept stays', async () => {
        const kept = signedIn('listener');
        useOnlineProviderAccountStore.setState({ accounts: { [sourceId]: kept } });
        setSourceStates({ [sourceId]: 'matching' });
        await expect(omni.readAccount(sourceId, 'start')).resolves.toBe('not asked');
        await expect(omni.readAccount(sourceId, 'sync')).resolves.toBe('not asked');
        expect(getLoginStatus).not.toHaveBeenCalled();
        expect(getPlaybackReportProviderIds()).not.toContain(sourceId);
        expect(useOnlineProviderAccountStore.getState().accounts[sourceId]).toBe(kept);
        // A crossSource feature that needs an account there skips it, signed in or not.
        expect(participants('search').ready).not.toContain(sourceId);

        setSourceStates({});
        expect(omni.getProviderSummaries().find(summary => summary.providerId === sourceId)?.user).toEqual(kept.user);
        expect(getFoliumAccountState(sourceId)).toMatchObject({ status: 'signed-in' });
    });

    it('keeps its songs where they are, marked, and does not play them', async () => {
        const song = songOf(sourceId);
        setSourceStates({ [sourceId]: 'matching' });
        expect(isSongSourceMissing(song)).toBe(true);
        expect(getSongTag(song, { unavailable: 'gone', video: 'video' })).not.toBe('');
        expect(omni.canPlaySong(song)).toBe(false);
        expect(isQueueSongPlayable(song)).toBe(false);
        await expect(omni.getAudioSource(song, 'standard')).rejects.toMatchObject({ code: 'unavailable', providerId: sourceId });
        const loaded = await loadOnlineSongAudioSource(song, 'standard', null);
        expect(loaded.kind).toBe('unavailable');
        if (sourceId === SAMPLE) expect(getAudioSource).not.toHaveBeenCalled();

        setSourceStates({});
        expect(isSongSourceMissing(song)).toBe(false);
        if (sourceId === SAMPLE) {
            expect(omni.canPlaySong(song)).toBe(true);
            await expect(omni.getAudioSource(song, 'standard')).resolves.toMatchObject({ url: 'https://example.invalid/a.mp3' });
        }
    });

    it('is left out of the federated search', () => {
        useOnlineProviderAccountStore.setState({ accounts: { [sourceId]: signedIn('listener') } });
        setSourceStates({ [sourceId]: 'matching' });
        const sources = resolveSearchSources({
            providers: omni.getProviderSummaries(),
            activeProviderId: useOnlineProviderAccountStore.getState().activeProviderId,
            hasLocalSongs: false,
            navidromeReady: false,
        });
        expect(sources).not.toContain(sourceId);
        expect(participantSkipReason('search', sourceId)).toBe('matching-only');
    });

    it('tells the lists\' listeners of a switch, as of a source coming or going', () => {
        const heard = vi.fn();
        const offOmni = omni.subscribeProviders(heard);
        const offController = accountStorePort.subscribe(heard);
        const before = omni.getProviderRegistryVersion();
        setSourceStates({ [sourceId]: 'matching' });
        expect(heard).toHaveBeenCalled();
        expect(omni.getProviderRegistryVersion()).not.toBe(before);
        heard.mockClear();
        setSourceStates({ [sourceId]: 'matching' });
        expect(heard).not.toHaveBeenCalled();
        offOmni();
        offController();
    });
});

describe('a source used only for matching, beyond the lists (review of the first pass)', () => {
    const NINE = ['netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify', 'qishui', 'appleMusic', 'fnmusic'];

    it('is not in effect even when no other source is shown: nothing is', () => {
        useOnlineProviderAccountStore.getState().setActiveProviderId(SAMPLE);
        setSourceStates({ ...Object.fromEntries(NINE.map(id => [id, 'disabled'])), [SAMPLE]: 'matching' });
        expect(shownIds()).toEqual([]);
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe('');
        expect(useOnlineProviderAccountStore.getState().chosenProviderId).toBe(SAMPLE);
        expect(omni.getActiveCapabilities().search).toBe(false);
        setSourceStates({});
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe(SAMPLE);
    });

    it('offers no heart, no playlist and no account of its own for its songs, and its lyrics are asked as nobody', async () => {
        const song = songOf(SAMPLE);
        const playlist = { id: 'p1', name: 'Mine', type: 'playlist', providerId: SAMPLE };
        useOnlineProviderAccountStore.setState({ accounts: { [SAMPLE]: { ...signedIn('listener'), likedSongIds: ['1'], collections: [playlist] } as never } });
        expect(omni.isSongLiked(song)).toBe(true);
        expect(omni.getPlaylistsForSong(song)).toHaveLength(1);
        setSourceStates({ [SAMPLE]: 'matching' });
        expect(omni.isSongLiked(song)).toBe(false);
        expect(omni.canLikeSong(song)).toBe(false);
        expect(omni.canAddSongToPlaylist(song)).toBe(false);
        expect(omni.canCreatePlaylistForSong(song)).toBe(false);
        expect(omni.getPlaylistsForSong(song)).toEqual([]);
        await expect(omni.likeSong(song, false)).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.addSongsToPlaylist([song], playlist as never)).rejects.toMatchObject({ code: 'unsupported' });
        await omni.getLyrics(song, { userId: 'given' });
        expect(getLyrics).toHaveBeenLastCalledWith(song, expect.objectContaining({ userId: null }));
        setSourceStates({});
        await omni.getLyrics(song);
        expect(getLyrics).toHaveBeenLastCalledWith(song, expect.objectContaining({ userId: 'listener-id' }));
    });

    it('keeps its songs in the play history under every account kept on this device, its account unread (as after a restart)', () => {
        // Played while signed in; the account store holds nothing of it now (it is not read while used only for matching).
        noteSongPlayed(songOf(SAMPLE), 'listener-id');
        noteSongPlayed(songOf('qq'), 'qq-listener');
        setSourceStates({ [SAMPLE]: 'matching', qq: 'disabled', 'gone-mod-source': 'disabled' });
        expect(omni.getSourcesNotShown()).toEqual(expect.arrayContaining([SAMPLE, 'qq', 'gone-mod-source']));
        expect(keptPlayAccountsOf(SAMPLE)).toEqual(['listener-id']);
        const scopes = historyScopes();
        expect(scopes).toContainEqual({ kind: 'online', providerId: SAMPLE, accountId: 'listener-id' });
        expect(scopes).toContainEqual({ kind: 'online', providerId: 'qq', accountId: 'qq-listener' });
        setSourceStates({});
        expect(omni.getSourcesNotShown()).toEqual([]);
    });

    it('takes no listening report and no dislike for its songs, also of one that was playing at the switch', async () => {
        const song = songOf(SAMPLE);
        useOnlineProviderAccountStore.setState({ accounts: { [SAMPLE]: signedIn('listener') } });
        expect(omni.canReportPlayback(song)).toBe(true);
        setSourceStates({ [SAMPLE]: 'matching' });
        expect(omni.canReportPlayback(song)).toBe(false);
        expect(omni.canDislikeSong(song)).toBe(false);
        await expect(omni.reportPlayback(song, { playedSeconds: 60 } as never)).rejects.toMatchObject({ code: 'unavailable' });
        expect(reportPlayback).not.toHaveBeenCalled();
    });

    it('does not hand out what was prefetched for its songs', async () => {
        const song = songOf(SAMPLE);
        updatePrefetchedAudioUrl(song, 'https://example.invalid/prefetched.mp3', 'standard');
        expect(getPrefetchedData(song, 'standard')?.audioUrl).toBe('https://example.invalid/prefetched.mp3');
        setSourceStates({ [SAMPLE]: 'matching' });
        expect(getPrefetchedData(song, 'standard')).toBeNull();
        const prefetched = { audioUrl: 'https://example.invalid/prefetched.mp3', audioUrlFetchedAt: Date.now(), audioUrlQuality: 'standard' };
        await expect(loadOnlineSongAudioSource(song, 'standard', prefetched as never)).resolves.toMatchObject({ kind: 'unavailable' });
        setSourceStates({});
        expect(getPrefetchedData(song, 'standard')?.audioUrl).toBe('https://example.invalid/prefetched.mp3');
    });
});

describe('the lyric and the metadata match keep a source used only for matching', () => {
    it('lists it as a lyric source and a metadata match source, anonymously', () => {
        useOnlineProviderAccountStore.setState({ accounts: { qq: signedIn('listener') } });
        setSourceStates({ qq: 'matching', netease: 'matching', [SAMPLE]: 'matching' });
        expect(participants('lyrics').ready).toEqual(expect.arrayContaining(['qq', 'netease']));
        expect(participants('metadata').ready).toEqual(['netease', 'qq', 'kugou', SAMPLE]);
        expect(isParticipantReady('lyrics', 'qq')).toBe(true);
        expect(omni.getMatchingProviderSummaries().map(summary => summary.providerId)).toEqual(expect.arrayContaining(['qq', 'netease', SAMPLE]));
    });

    it('drops it from them only when it is switched off', () => {
        setSourceStates({ qq: 'disabled', [SAMPLE]: 'disabled' });
        expect(participants('lyrics').ready).not.toContain('qq');
        expect(participantSkipReason('lyrics', 'qq')).toBe('not-enabled');
        expect(participants('metadata').ready).not.toContain(SAMPLE);
    });
});

describe('the screens follow a switch at once', () => {
    let root: Root | null = null;
    let container: HTMLDivElement | null = null;

    afterEach(() => {
        act(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    it('redraws the search sources and the lyric sources without a reload', () => {
        const seen: { search: string[]; lyrics: string[] }[] = [];
        const Probe = () => {
            const { sources } = useSearchSources(false);
            const { ready } = useCrossSourceParticipants('lyrics');
            seen.push({ search: [...sources], lyrics: [...ready] });
            return null;
        };
        // The search sources: a run-time source signed in; the lyric sources: QQ (anonymous there).
        useOnlineProviderAccountStore.setState({ accounts: { [SAMPLE]: signedIn('listener') } });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root!.render(React.createElement(Probe)));
        expect(seen.at(-1)!.search).toContain(SAMPLE);
        expect(seen.at(-1)!.lyrics).toContain('qq');

        act(() => setSourceStates({ qq: 'matching', [SAMPLE]: 'matching' }));
        expect(seen.at(-1)!.search).not.toContain(SAMPLE);
        expect(seen.at(-1)!.lyrics).toContain('qq');

        act(() => setSourceStates({ qq: 'disabled', [SAMPLE]: 'matching' }));
        expect(seen.at(-1)!.lyrics).not.toContain('qq');

        act(() => setSourceStates({}));
        expect(seen.at(-1)!.search).toContain(SAMPLE);
        expect(seen.at(-1)!.lyrics).toContain('qq');
    });
});

describe('the nine built-in platforms', () => {
    it('can be used only for matching where they match anonymously (the window checks, the main process stores)', async () => {
        expect(['netease', 'qq', 'kugou', 'qishui'].filter(canSourceMatchOnly)).toEqual(['netease', 'qq', 'kugou', 'qishui']);
        await expect(switchSourceState('spotify', 'matching')).resolves.toMatchObject({ ok: false, error: 'source-cannot-match-only' });
        await expect(switchSourceState('qq', 'matching')).resolves.toMatchObject({ ok: true });
        expect(invokeSetSourceState).toHaveBeenCalledWith('qq', 'matching');
        expect(getSourceState('qq')).toBe('matching');
        expect(shownIds()).not.toContain('qq');
    });

    it('all show, as before, while nobody switched any', () => {
        expect(shownIds()).toEqual(expect.arrayContaining(['netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify', 'qishui', 'appleMusic', 'fnmusic']));
        expect(omni.getMatchingProviderSummaries().map(summary => summary.providerId)).toEqual(shownIds());
    });
});
