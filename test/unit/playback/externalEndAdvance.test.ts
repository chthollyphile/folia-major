import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type * as ExternalPlaybackModule from '@/services/onlineMusic/externalPlayback';
import type * as DbModule from '@/services/db';
import type * as PlaybackBlobUrlModule from '@/services/playbackBlobUrls';
import type * as ZustandModule from 'zustand';

// test/unit/playback/externalEndAdvance.test.ts — 外部播放器报「这一首放完了」时，桥往哪儿走：
// 单曲循环下重播当前这首，别的情况照常前进；播放器自己按键跳的仍然照常切。
// 这里不渲染 React，hooks 由替身顶上，播放事件由安装时拿到的监听器投进去。
// 后半段把桥接真的播放队列钩子上，跑一条从播放事件到播放器收到起点的串联。

const env = vi.hoisted(() => ({
    effects: [] as Array<() => unknown>,
    listener: null as null | ((event: unknown) => void),
    loopMode: 'all' as string,
    isFmMode: false,
    external: false,
    next: vi.fn(),
    prev: vi.fn(),
    /** 播放器那边的起始，按 startExternalPlayback 交给播放路径的样子记下来。 */
    externalStarts: vi.fn().mockReturnValue({
        attempt: 1,
        askedAt: 0,
        started: Promise.resolve(),
        seeded: Promise.resolve(),
        waited: Promise.resolve(),
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
vi.mock('@/services/onlineMusic/externalPlayback', async importOriginal => ({
    ...await importOriginal<typeof ExternalPlaybackModule>(),
    installExternalPlayback: () => {},
    subscribeExternalPlayback: (listener: (event: unknown) => void) => { env.listener = listener; return () => {}; },
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
        warmUpExternalPlayers: vi.fn(async () => undefined),
        canPlayExternally: () => env.external,
        isExternalPlaybackPrepared: () => false,
        canPlaySong: () => true,
        getProviderLabel: (id: string) => id,
        // The bridge asks a song's provider whether it can give the real spectrum; none of these do.
        externalPlaybackTraits: () => ({ capturesSystemAudio: false }),
    },
}));
vi.mock('@/components/app/playback/externalPlayerWake', () => ({ runExternalPlayerWarmUp: vi.fn(async () => undefined) }));
vi.mock('@/stores/useDesktopSettingsStore', () => {
    // The bridge also follows the spectrum switch, so the store it follows has to be subscribable.
    const read = () => ({ wakeExternalPlayersOnLaunch: false, externalSystemAudioSpectrum: false });
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return { useDesktopSettingsStore: Object.assign(store, { getState: read, subscribe: () => () => {} }) };
});
vi.mock('@/stores/useAudioSettingsStore', () => {
    const read = () => ({
        loopMode: env.loopMode,
        audioQuality: 'lossless',
        queueAddBehavior: 'append',
        autoSkipUnplayable: false,
        isMuted: false,
        volume: 1,
    });
    const store = (selector?: (state: unknown) => unknown) => (selector ? selector(read()) : read());
    return { useAudioSettingsStore: Object.assign(store, { getState: read, subscribe: () => () => {} }) };
});
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

const { useExternalPlaybackBridge } = await import('@/components/app/playback/bridges/useExternalPlaybackBridge');
const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { resetPlaybackStore } = await import('./currentSongWatch');

const [songA, songB]: UnifiedSong[] = ['1', '2'].map(id => ({
    id, name: id === '1' ? 'A' : 'B', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
}));

/** 装上桥，返回投一个播放事件进去的手法。 */
const InstallBridge = () => {
    env.effects.length = 0;
    env.listener = null;
    useExternalPlaybackBridge({ handleNextTrack: env.next, handlePrevTrack: env.prev });
    for (const effect of env.effects) effect();
    expect(env.listener).not.toBeNull();
    return (event: unknown) => env.listener!(event);
};

/** 装上真的播放队列钩子，再接上桥：播放事件走完整的一段，落到开启播放器的那次调用上。 */
const InstallOnRealQueue = () => {
    env.effects.length = 0;
    env.listener = null;
    const refs = usePlaybackRuntimeRefs();
    const queue = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        setLyrics: vi.fn(), setIsLyricsLoading: vi.fn(), navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache: vi.fn(async () => undefined),
        restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(),
        audioRef: refs.audioRef,
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        mainPlaybackSnapshotRef: { current: null },
        playbackAutoSkipCountRef: refs.playbackAutoSkipCountRef,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
    } as never);
    useExternalPlaybackBridge({ handleNextTrack: queue.handleNextTrack, handlePrevTrack: queue.handlePrevTrack });
    for (const effect of env.effects) effect();
    expect(env.listener).not.toBeNull();
    return (event: unknown) => env.listener!(event);
};

beforeEach(() => {
    vi.clearAllMocks();
    env.loopMode = 'all';
    env.isFmMode = false;
    env.external = false;
    // 队列钩子挂监听时读的还是浏览器那边的 window，这里给一份不带主进程接口的。
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    usePlaybackStore.setState({ isFmMode: false });
});

afterEach(() => {
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

describe('播放器自己放到一首的结尾时', () => {
    it('单曲循环下重播这一首，不往前走', () => {
        env.loopMode = 'one';
        const fire = InstallBridge();
        fire({ type: 'ended', heard: true });

        expect(env.next).toHaveBeenCalledTimes(1);
        expect(env.next).toHaveBeenCalledWith(expect.objectContaining({ replayCurrent: true }));
    });

    it('别的循环模式下照常切下一首，不带重播', () => {
        env.loopMode = 'all';
        const fire = InstallBridge();
        fire({ type: 'ended' });

        expect(env.next).toHaveBeenCalledTimes(1);
        expect(env.next.mock.calls[0][0]).not.toHaveProperty('replayCurrent');
        expect(env.next).toHaveBeenCalledWith(expect.objectContaining({ autoAdvance: true }));
    });

    it('私人 FM 里不走单曲循环：队列到头就停，不重播', () => {
        env.loopMode = 'one';
        usePlaybackStore.setState({ isFmMode: true });
        const fire = InstallBridge();
        fire({ type: 'ended' });

        expect(env.next.mock.calls[0][0]).not.toHaveProperty('replayCurrent');
    });

    it('播放器自己按键跳的照常切歌，哪怕在单曲循环下', () => {
        env.loopMode = 'one';
        const fire = InstallBridge();
        fire({ type: 'ended', skipped: 'next' });

        expect(env.next.mock.calls[0][0]).not.toHaveProperty('replayCurrent');
    });

    it('这一首没响过就报放完，不重播，照常往前走', () => {
        env.loopMode = 'one';
        const fire = InstallBridge();
        // 播放器自己一直没确认在放这一首（起播就没落地），这时候的放完不是它放完的。
        fire({ type: 'ended', heard: false });

        expect(env.next).toHaveBeenCalledTimes(1);
        expect(env.next.mock.calls[0][0]).not.toHaveProperty('replayCurrent');
    });

    it('单曲循环下用户自己按上一首，走上一首而不是重播这一首', () => {
        env.loopMode = 'one';
        const fire = InstallBridge();
        fire({ type: 'ended', skipped: 'previous', heard: true });

        expect(env.next).not.toHaveBeenCalled();
        expect(env.prev).toHaveBeenCalledTimes(1);
        // 队首没有更早的歌时才从头放这一首，这里照旧交给上一首那条路。
        expect(env.prev).toHaveBeenCalledWith({ replayCurrentAtStart: true });
    });

    it('这一首真放过才重播', () => {
        env.loopMode = 'one';
        const fire = InstallBridge();
        fire({ type: 'ended', heard: true });

        expect(env.next.mock.calls[0][0]).toHaveProperty('replayCurrent', true);
    });
});

describe('单曲循环下这一首放完，接到真的队列上', () => {
    it('重播当前这首、从 0 起，队列不往前挪', () => {
        env.external = true;
        env.loopMode = 'one';
        usePlaybackStore.setState({ currentSong: songA, playQueue: [songA, songB], duration: 1 });
        const fire = InstallOnRealQueue();
        // 降级模式下播放器只报这一首放完了，不带 skipped，队列也清不回自己名下。
        fire({ type: 'ended', heard: true });

        expect(env.externalStarts).toHaveBeenCalledTimes(1);
        // 当前这首、从 0 起；这次是 Folia 自己往前走的，所以不算用户的按键。
        expect(env.externalStarts).toHaveBeenCalledWith(songA, 0, { userAction: false });
        expect(usePlaybackStore.getState().currentSong?.id).toBe('1');
        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['1', '2']);
    });
});
