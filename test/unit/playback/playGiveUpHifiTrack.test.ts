import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/playback/playGiveUpHifiTrack.test.ts
// Pins that a play which gives up before it shows its song leaves the song that plays on HiFi its
// "still wanted" (the `onceShown` answer currentSong.ts hands the HiFi track): a local file that cannot
// be read, a record that is gone, a Navidrome server that is not set up, an online refusal that stops,
// a countdown to the next song, a taken-down song whose dialog of another version opens, and a play
// overtaken while it waited. playSong hands a local song over to onPlayLocalSong, and both give up.
// A newer play still on its way, or one that showed its song, leaves it overtaken.
// Written like playSongMovedToOtherEngine.test.ts: the hooks run without a renderer, the store is the
// real one; the library, the file access, the Navidrome server, the online services and the HiFi
// service are stubs.

const env = vi.hoisted(() => ({
    songs: [] as unknown[],
    unreadable: new Set<string>(),
    navidromeConfig: { serverUrl: 'https://navi.test' } as unknown,
    takenDown: new Set<string>(),
    /** What the HiFi service was asked to start, with the play's answer it keeps on the track. */
    hifiStarts: [] as Array<{ song: { name: string }; stillWanted?: () => boolean }>,
    /** What the audio source answers for an online song id; a plain http address when nothing is set. */
    audioResultFor: new Map<string, unknown>(),
    /** Online song ids whose audio address is held until the promise resolves. */
    audioGate: new Map<string, Promise<unknown>>(),
}));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
    useEffect: vi.fn(),
}));
// A store read as a hook answers from its state at the moment of the call; everything else about
// the stores is real.
vi.mock('zustand', async importOriginal => {
    const { createStore } = await import('zustand/vanilla');
    const build = (initializer: never) => {
        const api = createStore(initializer);
        return Object.assign((selector?: (state: unknown) => unknown) => (selector ? selector(api.getState()) : api.getState()), api);
    };
    return { ...await importOriginal<typeof import('zustand')>(), create: (initializer?: never) => (initializer ? build(initializer) : build) };
});
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/db', () => ({
    getFromCache: async () => null,
    saveToCache: async () => {},
    removeFromCache: async () => {},
    getLocalSongs: async () => env.songs,
    getLocalSong: async (id: string) => (env.songs as Array<{ id: string }>).find(song => song.id === id) ?? null,
    saveLocalSong: async () => {},
    getFromCacheWithMigration: async () => null,
}));
vi.mock('@/services/localMusicService', () => ({
    getAudioFromLocalSong: async (song: { id: string }) => (env.unreadable.has(song.id) ? null : `blob:${song.id}`),
    getFileFromLocalSong: async (song: { id: string }) => (env.unreadable.has(song.id) ? null : { name: `${song.id}.flac` }),
    ensureLocalSongCoverAsset: async (song: unknown) => song,
    matchLyrics: async () => {},
}));
vi.mock('@/utils/lyrics/localSongMatchContext', async importOriginal => ({
    ...await importOriginal<typeof import('@/utils/lyrics/localSongMatchContext')>(),
    shouldRunLocalSongAutomaticMatch: () => false,
}));
vi.mock('@/utils/lyrics/localSongLyrics', () => ({
    resolveLocalSongLyrics: async () => ({ lyrics: null, source: null }),
}));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: async () => ({ entities: [], assignments: [] }),
}));
vi.mock('@/services/coverCache', () => ({
    getCachedCoverUrl: async () => null,
    loadCachedOrFetchCover: async (_cacheKey: string, url: string) => `cached:${url}`,
}));
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => env.navidromeConfig,
    isNavidromeEnabled: () => true,
    navidromeApi: {
        getStreamUrl: (_config: unknown, id: string) => `https://navi.test/stream/${id}`,
        getSong: async () => null,
        getCoverArtUrl: (_config: unknown, id: string) => `https://navi.test/cover/${id}`,
    },
}));
vi.mock('@/utils/appNavidromeLyrics', () => ({
    hydrateNavidromeLyricPayload: async () => {},
    resolvePreferredNavidromeLyrics: async () => ({ lines: [{ fullText: 'la', startTime: 0, endTime: 1, words: [] }] }),
}));
vi.mock('@/services/hostExtensionHooks', () => ({
    hasBeforePlayHook: () => false,
    runBeforePlayHook: async (song: unknown) => song,
    lyricsForNoLyrics: () => null,
    notifyPlaybackFailed: () => undefined,
}));
vi.mock('@/services/prefetchService', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/prefetchService')>(),
    getPrefetchedData: () => null,
    prefetchNearbySongs: vi.fn(async () => {}),
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        canPlaySong: () => true,
        getProviderLabel: (id: string) => id,
        getSongReplacement: async () => ({
            song: { id: 'other', name: 'Other version', artists: [], album: { id: '', name: '' }, durationMs: 1000, sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'other' } },
            label: 'live',
        }),
    },
}));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: (song: { id: string }) => env.takenDown.has(String(song.id)) }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: async () => null,
}));
vi.mock('@/services/onlinePlayback', () => ({
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
    loadOnlineSongAudioSource: async (song: { id: string }) => {
        await env.audioGate.get(song.id);
        return env.audioResultFor.get(song.id) ?? { kind: 'ok', audioSrc: `https://audio.test/${song.id}` };
    },
    loadOnlineSongLyrics: async () => {},
}));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: async () => null }));
// The HiFi service: every local and Navidrome song plays on it, and the start of a track is recorded.
vi.mock('@/services/hifi/hifiPlayback', () => ({
    hifiRouteFor: () => 'hifi',
    beginHifiTrack: async (options: { song: { name: string }; stillWanted?: () => boolean }) => {
        env.hifiStarts.push({ song: options.song, stillWanted: options.stillWanted });
        return 'ready';
    },
    isHifiRoute: () => true,
    hifiTransport: { pause: vi.fn(async () => undefined), resume: vi.fn(), seek: vi.fn(), isPaused: () => true },
}));

const { useLibraryPlaybackController } = await import('@/components/app/playback/start/useLibraryPlaybackController');
const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { retireBlobUrl } = await import('@/services/playbackBlobUrls');
const { onlineFailureOf } = await import('@/services/onlineMusic/failure/onlineFailureCase');
const { resetPlaybackStore } = await import('./currentSongWatch');

const localRecord = (id: string, title: string): LocalSong => ({
    id, fileName: `${title}.mp3`, filePath: `Music/${title}.mp3`, title, titleOrigin: 'import',
    importedMetadata: { title, titleSource: 'filename', artistNames: [] },
    duration: 100, fileSize: 1234, fileLastModified: 1000, mimeType: 'audio/mpeg', addedAt: 1, folderName: 'Music',
    hasLocalLyrics: true,
} as LocalSong);
/** A local song as the queue holds it. */
const queuedLocal = (id: string, name: string): SongResult => ({
    id, name, artists: [], album: { id: '', name: '' }, durationMs: 100,
    isLocal: true, localRef: { songId: id }, sourceRef: { kind: 'local', mediaId: id },
} as unknown as SongResult);
const navidrome = (id: string, name: string) => ({
    id, name, artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    isNavidrome: true, navidromeData: { id, title: name },
} as unknown as NavidromeSong);
const queuedNavidrome = (song: NavidromeSong): SongResult => ({
    ...song, sourceRef: { kind: 'navidrome', mediaId: song.navidromeData.id }, navidromeData: song,
} as unknown as SongResult);
const online = (id: string): SongResult => ({
    id, name: id.toUpperCase(), artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const unavailable = (caseId: 'sign-in-needed' | 'no-audio') => ({
    kind: 'unavailable', failure: onlineFailureOf({ operation: 'audio', providerId: 'bodian' }, { detail: { case: caseId } }),
});

const localOne = localRecord('l1', 'L1');
const localTwo = localRecord('l2', 'L2');
const [q1, q2] = [queuedLocal('l1', 'L1'), queuedLocal('l2', 'L2')];
const gone = queuedLocal('gone', 'Gone');
const naviOne = queuedNavidrome(navidrome('n1', 'N1'));

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const status = () => useStatusMessageStore.getState().message;

beforeEach(() => {
    // A local play from a queue also warms the songs next to it a second later: not this test's subject.
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    env.songs = [localOne, localTwo];
    env.unreadable.clear();
    env.navidromeConfig = { serverUrl: 'https://navi.test' };
    env.takenDown.clear();
    env.hifiStarts.length = 0;
    env.audioResultFor.clear();
    env.audioGate.clear();
    retireBlobUrl(null);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useStatusMessageStore.setState({ message: null });
    useAudioSettingsStore.setState({ autoSkipUnplayable: false });
});
afterEach(() => {
    vi.restoreAllMocks();
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

function mount() {
    const refs = usePlaybackRuntimeRefs();
    const persistLastPlaybackCache = vi.fn(async (_song: SongResult | null, _queue: SongResult[]) => undefined);
    const library = useLibraryPlaybackController({
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        lyricsLoadingWritesRef: { current: 0 },
        navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache,
        restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(() => null),
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
    } as never);
    const queue = usePlaybackQueueController({
        localSongs: [localOne, localTwo], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache,
        restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(),
        onPlayLocalSong: library.onPlayLocalSong,
        onPlayNavidromeSong: library.onPlayNavidromeSong,
        audioRef: refs.audioRef,
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        mainPlaybackSnapshotRef: { current: null },
        playbackAutoSkipCountRef: refs.playbackAutoSkipCountRef,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
    } as never);
    return { library, queue };
}

/** L1 plays on HiFi, started by playSong as a click on it would; returns the answer its track keeps. */
const playL1OnHifi = async (queue: ReturnType<typeof mount>['queue']) => {
    await queue.playSong(q1, [q1, q2]);
    await settle();
    const [start] = env.hifiStarts;
    expect(start.song).toMatchObject({ name: 'L1' });
    expect(start.stillWanted?.()).toBe(true);
    return start.stillWanted!;
};

describe('a play that gives up before it shows its song, and the song playing on HiFi', () => {
    it('a local file that cannot be read: playSong hands it over and both give up', async () => {
        const { queue } = mount();
        const stillWanted = await playL1OnHifi(queue);
        env.unreadable.add('l2');

        const play = queue.playSong(q2, [q1, q2]);
        // While its file is read, a newer play is on its way.
        expect(stillWanted()).toBe(false);
        await play;
        await settle();

        expect(status()).toMatchObject({ type: 'error', text: 'status.localFileAccessError' });
        expect(env.hifiStarts).toHaveLength(1);
        expect(stillWanted()).toBe(true);
    });

    it('a local song whose record is gone, and a Navidrome song with no server set up', async () => {
        const { queue, library } = mount();
        const stillWanted = await playL1OnHifi(queue);

        await queue.playSong(gone, [q1, gone]);
        expect(status()).toMatchObject({ type: 'error', text: 'status.localFilePlaybackError' });
        expect(stillWanted()).toBe(true);

        env.navidromeConfig = null;
        await queue.playSong(naviOne, [q1, naviOne]);
        await library.onPlayNavidromeSong(navidrome('n1', 'N1'));
        expect(status()).toMatchObject({ type: 'error', text: 'Navidrome not configured' });
        expect(stillWanted()).toBe(true);
    });

    it('an online song refused for a reason the listener must act on, and one that counts down to the next song', async () => {
        const { queue } = mount();
        const stillWanted = await playL1OnHifi(queue);

        env.audioResultFor.set('x', unavailable('sign-in-needed'));
        await queue.playSong(online('x'), [q1, online('x')]);
        expect(status()).toMatchObject({ type: 'error', text: 'failure.signInNeeded' });
        expect(stillWanted()).toBe(true);

        env.audioResultFor.set('y', unavailable('no-audio'));
        await queue.playSong(online('y'), [q1, online('y'), q2]);
        expect(status()).toMatchObject({ countdown: expect.anything() });
        expect(stillWanted()).toBe(true);
    });

    it('a taken-down song whose dialog of another version opens', async () => {
        const { queue } = mount();
        const stillWanted = await playL1OnHifi(queue);
        env.takenDown.add('t');

        await queue.playSong(online('t'), [q1, online('t')]);
        expect(stillWanted()).toBe(true);
    });

    it('a play overtaken while it waited, by one that then gave up', async () => {
        const { queue } = mount();
        const stillWanted = await playL1OnHifi(queue);
        let release!: () => void;
        env.audioGate.set('w', new Promise<void>(resolve => { release = resolve; }));

        const waiting = queue.playSong(online('w'), [q1, online('w')]);
        await settle();
        // The online play waits for its address: it is on its way, and a play after it that gives up changes nothing.
        expect(stillWanted()).toBe(false);
        await queue.playSong(gone, [q1, gone]);
        expect(stillWanted()).toBe(false);
        // Its address comes: it finds itself overtaken and gives up too.
        release();
        await waiting;

        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L1' });
        expect(stillWanted()).toBe(true);
    });

    it('a local file or a Navidrome song overtaken while it is read, by a play that then gave up', async () => {
        const { queue, library } = mount();
        const stillWanted = await playL1OnHifi(queue);

        const reading = library.onPlayLocalSong(localTwo);
        await queue.playSong(gone, [q1, gone]);
        await reading;
        expect(env.hifiStarts).toHaveLength(1);
        expect(stillWanted()).toBe(true);

        const loading = library.onPlayNavidromeSong(navidrome('n1', 'N1'));
        await queue.playSong(gone, [q1, gone]);
        await loading;
        expect(env.hifiStarts).toHaveLength(1);
        expect(stillWanted()).toBe(true);
    });

    it('a newer play that shows its song leaves it overtaken', async () => {
        const { queue } = mount();
        const stillWanted = await playL1OnHifi(queue);

        await queue.playSong(q2, [q1, q2]);
        await settle();

        expect(env.hifiStarts.map(start => start.song.name)).toEqual(['L1', 'L2']);
        expect(stillWanted()).toBe(false);
        expect(env.hifiStarts[1].stillWanted?.()).toBe(true);
    });
});
