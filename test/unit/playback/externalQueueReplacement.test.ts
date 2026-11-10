import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type * as DbModule from '@/services/db';
import type * as PlaybackBlobUrlModule from '@/services/playbackBlobUrls';
import type * as ZustandModule from 'zustand';

// test/unit/playback/externalQueueReplacement.test.ts — 渲染侧哪一次播放算「整个列表替换播放队列」：
// 歌单、专辑与列表的「播放全部」是一个新列表，要把标记交给外部播放器；单曲播放、加入队列、普通切歌与
// 自动衔接都不是，标记一次也不该出现。测试直接看播放队列钩子交给 startExternalPlayback 的参数。

const env = vi.hoisted(() => ({
    effects: [] as Array<() => unknown>,
    external: false,
    /** 播放器那边的起始，按 startExternalPlayback 交给播放路径的样子记下来。 */
    externalStarts: vi.fn().mockReturnValue({
        attempt: 1,
        askedAt: 0,
        started: Promise.resolve(),
        seeded: Promise.resolve(),
        timings: { prepareMs: 0, playMs: null, statusMs: null, lyricsMs: null, visibleMs: null, coverMs: null },
    }),
}));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
    useEffect: (effect: () => unknown) => { env.effects.push(effect); },
}));
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/onlineMusic/externalPlayback', () => ({
    installExternalPlayback: () => {},
    subscribeExternalPlayback: () => () => {},
    startExternalPlayback: (...args: unknown[]) => env.externalStarts(...args),
    announceExternalPlayback: vi.fn(),
    yieldExternalPlayback: vi.fn(),
    isExternalRoute: () => env.external,
}));
vi.mock('@/components/app/playback/externalSpectrumCapture', () => ({
    stopExternalSpectrumCapture: () => {},
    syncExternalSpectrumForRoute: () => {},
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        canPlayExternally: () => env.external,
        canPlaySong: () => true,
        isExternalPlaybackPrepared: () => false,
        getProviderLabel: (id: string) => id,
    },
}));
vi.mock('@/components/app/playback/externalPlayerWake', () => ({ runExternalPlayerWakeUp: vi.fn(async () => undefined) }));
vi.mock('@/stores/useDesktopSettingsStore', () => ({
    useDesktopSettingsStore: { getState: () => ({ wakeExternalPlayersOnLaunch: false }) },
}));
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: vi.fn() }));
vi.mock('@/services/onlineMusic/failure/onlineFailureCase', () => ({
    onlineFailureOf: () => ({}),
    offersRetry: () => false,
    stopsPlayback: () => false,
}));
vi.mock('@/components/app/playback/source/onlineFailureToast', () => ({ onlineFailureToast: () => ({ type: 'error', text: 'x' }) }));
vi.mock('@/services/hostExtensionHooks', () => ({
    hasBeforePlayHook: () => false,
    runBeforePlayHook: async (song: unknown) => song,
    lyricsForNoLyrics: () => null,
    notifyPlaybackFailed: () => undefined,
}));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: () => false }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: async () => null,
}));
vi.mock('@/services/prefetchService', () => ({
    getPrefetchedData: () => null,
    prefetchNearbySongs: vi.fn(),
    clearPrefetchRuntime: vi.fn(),
    invalidateAndRefetch: vi.fn(),
    refreshPrefetchAfterQueueEdit: vi.fn(),
}));
vi.mock('@/services/automix/profileService', () => ({ clearTrackProfileRuntime: vi.fn() }));
vi.mock('@/services/db', async importOriginal => ({
    ...await importOriginal<typeof DbModule>(),
    getLocalSong: async () => null,
    removeFromCache: vi.fn(async () => undefined),
}));
vi.mock('@/services/playbackBlobUrls', async importOriginal => ({
    ...await importOriginal<typeof PlaybackBlobUrlModule>(),
    retireBlobUrl: vi.fn(),
}));
vi.mock('@/services/onlinePlayback', () => ({
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
    loadOnlineSongAudioSource: async (song: { id: string }) => ({ kind: 'ok', audioSrc: `https://audio.test/${song.id}` }),
    loadOnlineSongLyrics: async () => undefined,
}));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: async () => null }));
vi.mock('zustand', async importOriginal => {
    const { createStore } = await import('zustand/vanilla');
    const build = (initializer: never) => {
        const api = createStore(initializer);
        return Object.assign((selector?: (state: unknown) => unknown) => (selector ? selector(api.getState()) : api.getState()), api);
    };
    return { ...await importOriginal<typeof ZustandModule>(), create: (initializer?: never) => (initializer ? build(initializer) : build) };
});

const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { resetPlaybackStore } = await import('./currentSongWatch');

const [songA, songB, songC]: UnifiedSong[] = ['1', '2', '3'].map(id => ({
    id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
}));

/** 装上一次渲染的播放队列钩子；歌曲走外部播放器那条路。 */
const useQueueController = () => {
    env.effects.length = 0;
    const queue = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        setLyrics: vi.fn(), setIsLyricsLoading: vi.fn(), navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache: vi.fn(async () => undefined),
        restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(),
        audioRef: { current: null },
        blobUrlRef: { current: null },
        shouldAutoPlayRef: { current: true },
        mainPlaybackSnapshotRef: { current: null },
        playbackAutoSkipCountRef: { current: 0 },
        pendingResumeTimeRef: { current: null },
        currentOnlineAudioUrlFetchedAtRef: { current: null },
        lastAudioRecoverySourceRef: { current: null },
    } as never);
    return queue;
};

beforeEach(() => {
    vi.clearAllMocks();
    env.external = true;
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    usePlaybackStore.setState({ currentSong: songA, playQueue: [songA, songB], isFmMode: false });
});

afterEach(() => {
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

describe('什么算用一个新列表替换播放队列', () => {
    it('整单播放把整张新列表交给播放器，并说明这是替换队列', async () => {
        const queue = useQueueController();
        queue.playOnlineQueueFromStart([songA, songB, songC]);
        await vi.waitFor(() => expect(env.externalStarts).toHaveBeenCalled());

        expect(env.externalStarts).toHaveBeenCalledWith(songA, 0, { userAction: true, replaceQueue: true });
    });

    it('单曲加入队列再播放不算替换，播放器那边的队列照旧只收回自己写的歌', async () => {
        const queue = useQueueController();
        queue.handleQueueAddAndPlay(songC);
        await vi.waitFor(() => expect(env.externalStarts).toHaveBeenCalled());

        // 加入队列不动外面播放器的队列：标记整条路上都不出现，不是给个 false 了事。
        expect(env.externalStarts).toHaveBeenCalledWith(songC, 0, { userAction: true });
        // 歌按设置的入队位置进入队列（默认加在末尾），队列本身没有被整张换掉。起播的等待（`waited`）
        // 让这一步落在起播之后，所以等队列落定再看。
        await vi.waitFor(() => expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['1', '2', '3']));
    });

    it('普通切歌不是替换', async () => {
        const queue = useQueueController();
        await queue.handleNextTrack();
        await vi.waitFor(() => expect(env.externalStarts).toHaveBeenCalled());

        expect(env.externalStarts.mock.calls[0][2]).not.toHaveProperty('replaceQueue');
    });
});
