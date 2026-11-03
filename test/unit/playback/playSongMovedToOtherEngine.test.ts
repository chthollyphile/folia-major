import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/playback/playSongMovedToOtherEngine.test.ts
// Pins what playSong hands the library controller when the HiFi bridge moves the song it was playing
// to the other engine (a HiFi failure, HiFi switched off, the replay after the queue ended): where the
// song starts, whether it plays and whether it shows its own 'loaded' toast reach onPlayLocalSong and
// onPlayNavidromeSong. A play this one defers (the timed skip after a failure) is another song's, and
// starts as every play does.
// Written like queueReplaceLibraryRaces.test.ts: the hooks run without a renderer, the store is the
// real one; the library, the file access, the Navidrome server, the online services and the HiFi
// service are stubs.

const env = vi.hoisted(() => ({
    songs: [] as unknown[],
    /** The engine the HiFi service picks for a local or Navidrome song. */
    route: 'web' as 'web' | 'hifi',
    /** What the HiFi service was asked to start. */
    hifiStarts: [] as Array<{ song: { name: string }; startSec: number }>,
    /** What the audio source answers for an online song id; a plain http address when nothing is set. */
    audioResultFor: new Map<string, unknown>(),
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
    getAudioFromLocalSong: async (song: { id: string }) => `blob:${song.id}`,
    getFileFromLocalSong: async (song: { id: string }) => ({ name: `${song.id}.flac` }),
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
    getNavidromeConfig: () => ({ serverUrl: 'https://navi.test' }),
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
// The online song that fails, so that its play defers a skip to the next song.
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => true, getProviderLabel: (id: string) => id } }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: () => false }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: async () => null,
}));
vi.mock('@/services/onlinePlayback', () => ({
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
    loadOnlineSongAudioSource: async (song: { id: string }) => (
        env.audioResultFor.get(song.id) ?? { kind: 'ok', audioSrc: `https://audio.test/${song.id}` }
    ),
    loadOnlineSongLyrics: async () => {},
}));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: async () => null }));
// The HiFi service: which engine a song plays on, and the start of a track on mpv, recorded.
vi.mock('@/services/hifi/hifiPlayback', () => ({
    hifiRouteFor: () => env.route,
    beginHifiTrack: async (options: { song: { name: string }; startSec: number }) => {
        env.hifiStarts.push({ song: options.song, startSec: options.startSec });
        return 'ready';
    },
    isHifiRoute: () => false,
    hifiTransport: { pause: vi.fn(), resume: vi.fn(), seek: vi.fn(), isPaused: () => true },
}));

const { useLibraryPlaybackController } = await import('@/components/app/playback/start/useLibraryPlaybackController');
const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { setPlayQueue, usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { currentTime } = await import('@/stores/motionSignals');
const { PlayerState } = await import('@/types');
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
/** A Navidrome song as the queue holds it: the unified song carrying the server's record. */
const queuedNavidrome = (song: NavidromeSong): SongResult => ({
    ...song, sourceRef: { kind: 'navidrome', mediaId: song.navidromeData.id }, navidromeData: song,
} as unknown as SongResult);
const online = (id: string): SongResult => ({
    id, name: id.toUpperCase(), artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});

const localOne = localRecord('l1', 'L1');
const localTwo = localRecord('l2', 'L2');
const [q1, q2] = [queuedLocal('l1', 'L1'), queuedLocal('l2', 'L2')];
const naviOne = queuedNavidrome(navidrome('n1', 'N1'));
const x = online('x');

/** The options the bridge's replay gives playSong for a paused song moved to the Web engine at 42.5 s. */
const movedPaused = { shouldNavigateToPlayer: false, startAtSec: 42.5, autoplay: false, quietLoadedToast: true };
/** The toast that says why the song left HiFi, showing when the replay starts. */
const hifiToast = { type: 'error' as const, text: 'hifi.errors.DEVICE_BUSY' };

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const store = () => usePlaybackStore.getState();
const status = () => useStatusMessageStore.getState().message;

beforeEach(() => {
    // A local play from a queue also warms the songs next to it a second later: not this test's subject.
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    env.songs = [localOne, localTwo];
    env.route = 'web';
    env.hifiStarts.length = 0;
    env.audioResultFor.clear();
    retireBlobUrl(null);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    currentTime.set(0);
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
    return { refs, queue };
}

describe('a song the HiFi bridge replays through playSong on the other engine', () => {
    it('a local file falling back to the Web engine starts where HiFi was, stays paused, and shows no "loaded" toast', async () => {
        const { refs, queue } = mount();
        useStatusMessageStore.setState({ message: hifiToast });

        await queue.playSong(q1, [], false, movedPaused);
        await settle();

        expect(store().audioSrc).toBe('blob:l1');
        // The deck seeks there once its metadata is in.
        expect(refs.pendingResumeTimeRef.current).toBe(42.5);
        expect(currentTime.get()).toBe(42.5);
        expect(refs.shouldAutoPlay.current).toBe(false);
        expect(store()).toMatchObject({ playerState: PlayerState.PAUSED, isLoadingToPlay: false });
        expect(status()).toEqual(hifiToast);
    });

    it('a Navidrome song falling back to the Web engine does the same', async () => {
        const { refs, queue } = mount();
        useStatusMessageStore.setState({ message: hifiToast });

        await queue.playSong(naviOne, [], false, movedPaused);
        await settle();

        expect(store().audioSrc).toBe('https://navi.test/stream/n1');
        expect(refs.pendingResumeTimeRef.current).toBe(42.5);
        expect(refs.shouldAutoPlay.current).toBe(false);
        expect(store().playerState).toBe(PlayerState.PAUSED);
        expect(status()).toEqual(hifiToast);
    });

    it('the replay after the queue ended, still on HiFi, loads mpv at the place it was sought to', async () => {
        const { refs, queue } = mount();
        env.route = 'hifi';

        await queue.playSong(q2, [], false, { shouldNavigateToPlayer: false, startAtSec: 61 });
        await settle();

        expect(env.hifiStarts).toEqual([expect.objectContaining({ song: expect.objectContaining({ name: 'L2' }), startSec: 61 })]);
        // Not given: it plays, as every play does.
        expect(refs.shouldAutoPlay.current).toBe(true);
    });

    it('a play this one defers (the timed skip after a failure) starts at the beginning, plays, and says it loaded', async () => {
        const { refs, queue } = mount();
        env.audioResultFor.set('x', {
            kind: 'unavailable', failure: onlineFailureOf({ operation: 'audio', providerId: 'bodian' }, { detail: { case: 'no-audio' } }),
        });
        setPlayQueue([x, q1]);

        // Given the moved song's options, as a mod's before-play hook that redirects the replay would leave them.
        await queue.playSong(x, store().playQueue, false, movedPaused);
        expect(status()).toMatchObject({ text: 'failure.noAudio', countdown: expect.anything() });

        // The listener skips at once instead of waiting for the countdown.
        status()?.onAction?.();
        await settle();
        await settle();

        expect(store().currentSong).toMatchObject({ name: 'L1' });
        expect(store().audioSrc).toBe('blob:l1');
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(currentTime.get()).toBe(0);
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(store().isLoadingToPlay).toBe(true);
        expect(status()).toMatchObject({ type: 'success', text: 'status.localMusicLoaded' });
    });
});
