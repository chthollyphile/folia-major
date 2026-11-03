import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PlayerState, type StatusMessage, type UnifiedSong } from '@/types';
import { OnlineProviderError, type OnlineFailureCaseId } from '@/types/onlineMusic';

// test/unit/playback/onlinePlaybackStop.test.ts — exercise the queue's error branch without a browser or network.

const stateSetters = vi.hoisted(() => [] as Mock[]);
// 按调用顺序在多次“渲染”（多次调用 controller()）之间保留 ref，和 React 一样。
const hookRefs = vi.hoisted(() => ({ list: [] as { current: unknown }[], index: 0 }));
// state 同理按调用顺序保留：setter 写进去，下一次 controller() 读得到（确认替代版本要先「渲染」出弹窗状态）。
const hookStates = vi.hoisted(() => ({ list: [] as { value: unknown }[], index: 0 }));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => (hookRefs.list[hookRefs.index++] ??= { current }),
    // 记下每个 useState 的 setter：替代版本弹窗只能从这里观察到。
    useState: (value: unknown) => {
        const slot = (hookStates.list[hookStates.index++] ??= { value });
        const setter = vi.fn((next: unknown) => {
            slot.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
        });
        stateSetters.push(setter);
        return [slot.value, setter];
    },
    useEffect: vi.fn(),
}));
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/stores/usePlaybackStore', async importOriginal => {
    const actual = await importOriginal<typeof import('@/stores/usePlaybackStore')>();
    return { ...actual, usePlaybackStore: Object.assign(
        (selector: (state: unknown) => unknown) => selector(actual.usePlaybackStore.getState()), actual.usePlaybackStore) };
});
// 控制器在失败那一刻经 getState() 读「无法播放时自动跳过」；用例按需改 audioSettings.autoSkipUnplayable。
const audioSettings = vi.hoisted(() => ({ audioQuality: 'high', loopMode: 'all', autoSkipUnplayable: false }));
vi.mock('@/stores/useAudioSettingsStore', () => ({
    useAudioSettingsStore: Object.assign(
        (selector: (state: unknown) => unknown) => selector(audioSettings),
        { getState: () => audioSettings },
    ),
}));
vi.mock('@/stores/useSearchNavigationStore', () => ({
    useSearchNavigationStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/services/hostExtensionHooks', () => ({ hasBeforePlayHook: () => false, lyricsForNoLyrics: () => null, notifyPlaybackFailed: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { canPlaySong: () => true, getProviderLabel: (id: string) => id, getSongReplacement: vi.fn(async () => null) },
}));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: vi.fn(() => false) }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: vi.fn(async () => null),
}));
vi.mock('@/services/prefetchService', () => ({
    getPrefetchedData: () => null,
    prefetchNearbySongs: vi.fn(),
    invalidateAndRefetch: vi.fn(),
    refreshPrefetchAfterQueueEdit: vi.fn(),
}));
vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongAudioSource: vi.fn(),
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
    loadOnlineSongLyrics: vi.fn(async () => undefined),
}));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: vi.fn(async () => null) }));

const { useEffect } = await import('react');
const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');
const { isSongUnavailable } = await import('@/services/onlineMusic/songAvailability');
const { omni } = await import('@/services/onlineMusic/omni');
const { loadOnlineLyricsState } = await import('@/utils/onlineLyricsState');
const { getCachedSongCoverUrl } = await import('@/services/onlineMusic/resourceCache');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');
const { notifyPlaybackFailed } = await import('@/services/hostExtensionHooks');
const { askForSong, askedSongKeyRef, dropPlaysInFlight, startOfAskedSong } = await import('@/components/app/playback/currentSong');
const { mediaFailureOf, onlineFailureOf } = await import('@/services/onlineMusic/failure/onlineFailureCase');
const { useLoginWindowStore } = await import('@/components/login/loginWindowStore');
const { neteaseAnswerError } = await import('@/services/onlineMusic/netease/neteaseFailure');
const { hifiTransport } = await import('@/services/hifi/hifiPlayback');
const notified = vi.mocked(notifyPlaybackFailed);
const getSongReplacement = vi.mocked(omni.getSongReplacement);

// What the loader answers where the song cannot be had: Bodian's, with a code of its own quoted.
const failureOf = (caseId: OnlineFailureCaseId) => onlineFailureOf({ operation: 'audio', providerId: 'bodian' }, { detail: { case: caseId, code: '20018' } });
const unavailable = (caseId: OnlineFailureCaseId) => ({ kind: 'unavailable' as const, failure: failureOf(caseId) });
type LoaderResult = Awaited<ReturnType<typeof loadOnlineSongAudioSource>>;
const makeSong = (id: string): UnifiedSong => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const songs: UnifiedSong[] = ['1', '2', '3'].map(makeSong);
const loader = vi.mocked(loadOnlineSongAudioSource);
const message = () => useStatusMessageStore.getState().message as StatusMessage | null;
// The countdown's skip, as the timer would call it when the time is over.
const countdownSkip = () => (vi.mocked(window.setTimeout).mock.calls.at(-1)![0] as () => void)();
// react 被 mock 成不跑 effect：需要 Stage 接管订阅的用例显式执行这次登记的 effect；清理函数在 afterEach 里调用，订阅不漏到下一个用例。
const effectCleanups: Array<() => void> = [];
const runEffects = () => {
    for (const [effect] of vi.mocked(useEffect).mock.calls) {
        const cleanup = (effect as () => unknown)();
        if (typeof cleanup === 'function') effectCleanups.push(cleanup as () => void);
    }
};
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

beforeEach(() => {
    vi.clearAllMocks();
    stateSetters.length = 0;
    hookRefs.list.length = 0;
    hookStates.list.length = 0;
    loader.mockReset();
    vi.mocked(isSongUnavailable).mockReset().mockImplementation(() => false);
    getSongReplacement.mockReset().mockImplementation(async () => null);
    vi.mocked(loadOnlineLyricsState).mockReset().mockImplementation(async () => null);
    vi.mocked(getCachedSongCoverUrl).mockReset().mockImplementation(async () => null);
    audioSettings.autoSkipUnplayable = false;
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: songs[0], playQueue: songs,
        playerState: PlayerState.PLAYING, isFmMode: false, audioSrc: 'https://cdn.example/1.mp3' });
    // The song that plays is the one the player was last asked for (currentSong.ts), as App leaves it.
    askForSong(songs[0]);
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    effectCleanups.splice(0).forEach(cleanup => cleanup());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function controller({ skipsSoFar = 0, mainPlaybackSnapshotRef = { current: null }, onPlayNavidromeSong }: {
    skipsSoFar?: number;
    mainPlaybackSnapshotRef?: { current: unknown };
    onPlayNavidromeSong?: (...args: unknown[]) => Promise<void>;
} = {}) {
    hookRefs.index = 0;
    hookStates.index = 0;
    const pause = vi.fn();
    const shouldAutoPlayRef = { current: true };
    const playbackAutoSkipCountRef = { current: skipsSoFar };
    const blobUrlRef = { current: null as string | null };
    const persistLastPlaybackCache = vi.fn(async () => undefined);
    const setLyrics = vi.fn();
    const result = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false, shouldNavigateToPlayerOnTrackChange: true,
        audioRef: { current: { pause } }, shouldAutoPlayRef, playbackAutoSkipCountRef,
        blobUrlRef, pendingResumeTimeRef: { current: null },
        lastAudioRecoverySourceRef: { current: null }, currentOnlineAudioUrlFetchedAtRef: { current: null },
        mainPlaybackSnapshotRef,
        setIsLyricsLoading: vi.fn(), setLyrics, persistLastPlaybackCache,
        navigateToPlaybackView: vi.fn(), restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(),
        onPlayNavidromeSong,
    } as never);
    const setPendingUnavailableReplacement = stateSetters.at(-1)!;
    return {
        ...result, pause, shouldAutoPlayRef, playbackAutoSkipCountRef, blobUrlRef,
        persistLastPlaybackCache, setLyrics, setPendingUnavailableReplacement,
    };
}

describe('online playback stop conditions', () => {
    it.each([
        ['region-restricted', 'status.songRegionRestricted'],
        ['sign-in-needed', 'failure.signInNeeded'],
        ['preview-only', 'status.songPreviewOnly'],
        ['subscription-required', 'status.songSubscriptionRequired'],
        ['purchase-required', 'status.songPurchaseRequired'],
        ['entitlement-required', 'status.songEntitlementRequired'],
        ['not-configured', 'status.songServiceNotConfigured'],
    ] as const)('pauses and never schedules queue skipping for %s', async (caseId, text) => {
        loader.mockResolvedValue(unavailable(caseId));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(message()).toMatchObject({ type: 'error', text });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(loader).toHaveBeenCalledOnce();
        expect(getSongReplacement).not.toHaveBeenCalled();
    });

    // It used to come back as an empty address, and the song was skipped as taken down.
    it('stops with the sign-in message when NetEase answers 301 for the address', async () => {
        const error = neteaseAnswerError({ code: 301, msg: '需要登录' }, 'the song URL');
        loader.mockResolvedValue({ kind: 'unavailable', failure: onlineFailureOf({ operation: 'audio', providerId: 'netease' }, { error }) });
        const queue = controller();
        await queue.playSong(songs[0], songs);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'failure.signInNeeded', actionLabel: 'failure.signIn', providerId: 'netease' });
    });

    it('offers to sign in again when the sign-in has ended', async () => {
        loader.mockResolvedValue(unavailable('sign-in-needed'));
        await controller().playSong(songs[0], songs);
        const shown = message();
        expect(shown).toMatchObject({ note: 'failure.noteSignIn', providerId: 'bodian', actionLabel: 'failure.signIn', durationMs: 6000 });
        shown?.onAction?.();
        expect(useLoginWindowStore.getState()).toMatchObject({ isOpen: true, providerId: 'bodian' });
        expect(message()).toBeNull();
    });

    it.each(['no-audio', 'unreachable', 'local-service-stopped', 'retry-later', 'refused', 'unknown'] as const)(
        'counts down to the next song for %s, with what happened above the countdown',
        async caseId => {
            loader.mockResolvedValue(unavailable(caseId));
            const queue = controller();
            await queue.playSong(songs[0], songs);
            expect(window.setTimeout).toHaveBeenCalledOnce();
            expect(queue.pause).not.toHaveBeenCalled();
            const shown = message();
            expect(shown).toMatchObject({ persistent: true, countdown: { text: 'failure.skipCountdown' }, quote: { text: '20018' }, providerId: 'bodian' });
            expect(shown?.text).not.toBe('status.songUnavailable');
        },
    );

    it('offers a retry when there is nothing to skip to and asking again may help', async () => {
        loader.mockResolvedValue(unavailable('unreachable'));
        await controller().playSong(songs[0], songs, false, { unavailableSkipCount: 2 });
        expect(window.setTimeout).not.toHaveBeenCalled();
        const shown = message();
        expect(shown).toMatchObject({ text: 'failure.unreachable', note: 'failure.noteCheckNetwork', actionLabel: 'ui.retry', durationMs: 6000 });
        expect(shown?.persistent).toBeUndefined();
        shown?.onAction?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[0]);
    });

    it('offers nothing when there is nothing to skip to and asking again would not help', async () => {
        loader.mockResolvedValue(unavailable('no-audio'));
        await controller().playSong(songs[0], songs, false, { unavailableSkipCount: 2 });
        const shown = message();
        expect(shown).toMatchObject({ text: 'failure.noAudio', quote: { text: '20018' } });
        expect(shown?.onAction).toBeUndefined();
    });

    it('keeps the queue and the current song untouched after a failure', async () => {
        const before = structuredClone(songs);
        loader.mockResolvedValue(unavailable('unreachable'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(usePlaybackStore.getState().playQueue).toBe(songs);
        expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
        expect(songs).toEqual(before);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
        expect(askedSongKeyRef.current).toBe(getPlaybackSongKey(songs[0]));
    });

    it('asks the loader to ask again while the request is current, and says so', async () => {
        let retrying: StatusMessage | null = null;
        loader.mockImplementation(async (_song, _quality, _prefetched, options) => {
            expect(options?.retry?.isCurrent()).toBe(true);
            options?.retry?.onRetrying?.(failureOf('unreachable'), 1);
            retrying = message();
            return unavailable('unreachable');
        });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(retrying).toMatchObject({ type: 'info', text: 'status.songRetrying', providerId: 'bodian' });
    });

    it('skips to the next song in the latest queue when the request used the store queue', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValueOnce(unavailable('unreachable')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1]);
        usePlaybackStore.setState({ playQueue: [songs[0], songs[1], extra] });
        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(extra);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });

    it('retries against the queue as it is when the button is pressed, keeping edits made meanwhile', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValueOnce(unavailable('unreachable')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        const queue = controller();
        // The store's own queue, the way handleNextTrack and Folium's playQueueItem pass it.
        await queue.playSong(songs[1], usePlaybackStore.getState().playQueue, false, { unavailableSkipCount: 2 });
        const shown = message()!;
        const edited = [songs[0], songs[1], extra];
        usePlaybackStore.setState({ playQueue: edited });
        const rerendered = controller(); // the store change re-renders the hook

        shown.onAction?.();
        await vi.waitFor(() => expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledOnce());
        expect(loader.mock.calls[1][0]).toBe(songs[1]);
        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['1', '2', '9']);
        expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }), edited);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    it('skips along the edited queue when the request passed the store queue', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValueOnce(unavailable('unreachable')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/9.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], usePlaybackStore.getState().playQueue);
        usePlaybackStore.setState({ playQueue: [songs[0], songs[1], extra] }); // song 3 removed, 9 added
        const rerendered = controller();

        countdownSkip();
        await vi.waitFor(() => expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledOnce());
        expect(loader.mock.calls[1][0]).toBe(extra);
        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['1', '2', '9']);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    it('keeps the snapshot of an explicit queue that never reached the store', async () => {
        const playlist = [songs[1], makeSong('8')];
        loader.mockResolvedValueOnce(unavailable('unreachable')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/8.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], playlist);
        usePlaybackStore.setState({ playQueue: [songs[0], makeSong('9')] });
        const rerendered = controller();

        countdownSkip();
        await vi.waitFor(() => expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '8' }));
        expect(loader.mock.calls[1][0]).toBe(playlist[1]);
        expect(usePlaybackStore.getState().playQueue).toEqual(playlist);
        // The skip is the newest playSong's (the rerendered hook's), and counted there.
        expect(rerendered.playbackAutoSkipCountRef.current).toBe(1);
        expect(queue.playbackAutoSkipCountRef.current).toBe(0);
    });

    it('puts the FM state back when an FM play does not land, and sets it again on retry', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        loader.mockResolvedValueOnce(unavailable('unreachable')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/f1.mp3' });
        const queue = controller();
        await queue.playSong(fm[0], fm, true, { unavailableSkipCount: 2 });
        expect(usePlaybackStore.getState()).toMatchObject({ isFmMode: false, currentSong: songs[0], playQueue: songs });

        message()?.onAction?.();
        await vi.waitFor(() => expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: 'f1' }));
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
    });

    it('stays in FM mode when a playlist song picked during FM fails', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        usePlaybackStore.setState({ currentSong: fm[0], playQueue: fm, isFmMode: true });
        loader.mockResolvedValue(unavailable('unknown'));
        const queue = controller();
        await queue.playSong(songs[1], songs, false);
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
    });

    it('restores the FM state from before the first of two requests that both fail', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        const first = deferred<LoaderResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(unavailable('unknown'));
        const queue = controller();
        const a = queue.playSong(fm[0], fm, true);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs, false);
        expect(usePlaybackStore.getState().isFmMode).toBe(false);
        first.resolve(unavailable('unreachable'));
        await a;
        expect(usePlaybackStore.getState().isFmMode).toBe(false);

        // The reverse: FM was on, an FM-off request and then an FM request both fail.
        usePlaybackStore.setState({ isFmMode: true });
        loader.mockReset();
        const second = deferred<LoaderResult>();
        loader.mockReturnValueOnce(second.promise).mockResolvedValueOnce(unavailable('unknown'));
        const b = queue.playSong(songs[1], songs, false);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(fm[0], fm, true);
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
        second.resolve(unavailable('unreachable'));
        await b;
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
    });

    // The loader answers a failure instead of throwing: a throw is no platform's, and still says something.
    it('still says the song could not be played when the loader throws', async () => {
        loader.mockRejectedValue(new TypeError('Failed to fetch'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(message()).toMatchObject({ type: 'error', text: 'status.playbackFailed', countdown: { text: 'failure.skipCountdown' } });
    });
});

describe('taken-down songs', () => {
    it('looks up another version and then counts down without pausing', async () => {
        loader.mockResolvedValueOnce(unavailable('taken-down')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(getSongReplacement).toHaveBeenCalledWith(songs[1]);
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songUnavailable', persistent: true, countdown: { text: 'failure.skipCountdown' } });

        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[2]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });

    it('opens the dialog of another version instead of counting down when one exists', async () => {
        const replacement = makeSong('7');
        loader.mockResolvedValue(unavailable('taken-down'));
        getSongReplacement.mockResolvedValue({ song: replacement, label: 'Live' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.setPendingUnavailableReplacement).toHaveBeenLastCalledWith(expect.objectContaining({
            originalSong: songs[1], replacementSong: replacement, typeDesc: 'Live', queue: songs,
        }));
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toBeNull();
    });

    it('counts down for a song its record says is taken down, without asking the loader', async () => {
        vi.mocked(isSongUnavailable).mockImplementation(song => song === songs[1]);
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(loader).not.toHaveBeenCalled();
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(message()).toMatchObject({ text: 'status.songUnavailable' });
    });

    it('tells a lookup of another version that could not reach the platform as that, not as taken down', async () => {
        vi.mocked(isSongUnavailable).mockImplementation(song => song === songs[1]);
        getSongReplacement.mockRejectedValue(new OnlineProviderError('network', 'offline', 'bodian'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = controller();
        await queue.playSong(songs[1], songs, false, { unavailableSkipCount: 2 });
        expect(message()).toMatchObject({ text: 'failure.unreachable', actionLabel: 'ui.retry' });
    });

    it('stops counting down once the automatic skips are used up', async () => {
        loader.mockResolvedValue(unavailable('taken-down'));
        const queue = controller();
        await queue.playSong(songs[1], songs, false, { unavailableSkipCount: 2 });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ type: 'error', text: 'status.songUnavailable' });
        expect(message()?.onAction).toBeUndefined();
    });
});

describe('skip unplayable songs setting', () => {
    const longQueue = [...songs, ...['4', '5'].map(makeSong)];

    it('counts a refused song down to the next one and counts the skip', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValueOnce(unavailable('subscription-required')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.pause).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songSubscriptionRequired', persistent: true, countdown: { text: 'failure.skipCountdown' } });
        expect(getSongReplacement).not.toHaveBeenCalled();

        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[2]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });

    it('never counts down past a sign-in that has ended', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValue(unavailable('sign-in-needed'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(queue.pause).toHaveBeenCalledOnce();
    });

    it('stops at a refused song once the automatic skips are used up', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValue(unavailable('region-restricted'));
        usePlaybackStore.setState({ playQueue: longQueue });
        const queue = controller();
        await queue.playSong(longQueue[0], longQueue);

        // 两次倒计时跳过（计数 1、2），第三首失败时次数已用尽：不再倒计时，照这个原因停下。
        for (let skipped = 1; skipped <= 2; skipped += 1) {
            countdownSkip();
            await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(skipped + 1));
            await vi.waitFor(() => expect(queue.playbackAutoSkipCountRef.current).toBe(skipped));
        }
        await vi.waitFor(() => expect(message()).toMatchObject({ text: 'status.songRegionRestricted' }));
        expect(message()?.countdown).toBeUndefined();
        expect(window.setTimeout).toHaveBeenCalledTimes(2);
        expect(loader.mock.calls.map(([song]) => song)).toEqual([longQueue[0], longQueue[1], longQueue[2]]);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
    });

    // 取消倒计时 = 这次不跳：和设置关闭时一样，照这个原因停下。
    it('stops with the refusal when a play countdown is cancelled', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValue(unavailable('purchase-required'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        message()?.onCancel?.();
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(message()).toMatchObject({ text: 'status.songPurchaseRequired' });
        expect(message()?.countdown).toBeUndefined();
        expect(notified).toHaveBeenCalledOnce();
    });

    it('stops where it is when a mid-playback countdown past a refusal is cancelled', () => {
        audioSettings.autoSkipUnplayable = true;
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('preview-only'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(message()).toMatchObject({ text: 'status.songPreviewOnly', cancelLabel: 'status.cancel', countdown: { text: 'failure.skipCountdown' } });
        expect(queue.pause).not.toHaveBeenCalled();

        message()?.onCancel?.();
        expect(window.clearTimeout).toHaveBeenCalled();
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(message()).toMatchObject({ text: 'status.songPreviewOnly' });
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith(expect.objectContaining({ reason: 'preview-only', phase: 'mid-playback', willAutoSkip: true }));
    });

    it('counts down on a mid-playback refusal and counts the skip', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockReturnValue(new Promise(() => undefined));
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('preview-only'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(message()).toMatchObject({ persistent: true, countdown: { text: 'failure.skipCountdown' } });
        expect(queue.pause).not.toHaveBeenCalled();

        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(songs[1]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });
});

describe('stale requests', () => {
    it('drops a superseded failure so the newer request keeps its message', async () => {
        const first = deferred<LoaderResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(unavailable('no-audio'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        first.resolve(unavailable('sign-in-needed'));
        await a;
        expect(message()).toBe(latest);
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(queue.pause).not.toHaveBeenCalled();
    });

    it('ignores the retry notice of a superseded request', async () => {
        const first = deferred<LoaderResult>();
        let onRetrying: (() => void) | undefined;
        loader.mockImplementationOnce((_song, _quality, _prefetched, options) => {
            onRetrying = () => options?.retry?.onRetrying?.(failureOf('unreachable'), 1);
            return first.promise;
        }).mockResolvedValueOnce(unavailable('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        onRetrying?.();
        expect(message()).toBe(latest);
        first.resolve(unavailable('unreachable'));
        await a;
    });

    it('does not open the dialog of another version for a superseded lookup', async () => {
        const lookup = deferred<{ song: UnifiedSong; label: string } | null>();
        vi.mocked(isSongUnavailable).mockImplementation(song => song === songs[1]);
        getSongReplacement.mockReturnValueOnce(lookup.promise as never);
        loader.mockResolvedValue(unavailable('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(getSongReplacement).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        lookup.resolve({ song: makeSong('7'), label: 'Live' });
        await a;
        expect(queue.setPendingUnavailableReplacement).not.toHaveBeenCalledWith(expect.objectContaining({ originalSong: songs[1] }));
        expect(message()).toBe(latest);
        expect(window.setTimeout).toHaveBeenCalledOnce();
    });

    it('writes nothing from a superseded loader error', async () => {
        const first = deferred<LoaderResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(unavailable('unknown'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        first.reject(new TypeError('Failed to fetch'));
        await a;
        expect(message()).toBe(latest);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('lets a newer request win while the older one waits for its lyrics state', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const lyricsState = deferred<null>();
        vi.mocked(loadOnlineLyricsState).mockReturnValueOnce(lyricsState.promise);
        loader.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'blob:a', blobUrl: 'blob:a' }).mockResolvedValueOnce(unavailable('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loadOnlineLyricsState).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        lyricsState.resolve(null);
        await a;
        expect(revoke).toHaveBeenCalledWith('blob:a');
        expect(askedSongKeyRef.current).toBe(getPlaybackSongKey(songs[0]));
        expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
        expect(queue.setLyrics).not.toHaveBeenCalled();
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    // 落地之后等封面期间又点了一首：新请求只是开始、还没落地，这首歌仍要接上音源，否则新请求失败时会停在没有音源的半落地状态。
    it('still gives a landed song its source when a newer request has only started', async () => {
        const cover = deferred<string | null>();
        const pendingNext = deferred<LoaderResult>();
        vi.mocked(getCachedSongCoverUrl).mockReturnValueOnce(cover.promise);
        loader.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'blob:b', blobUrl: 'blob:b' }).mockReturnValueOnce(pendingNext.promise);
        const queue = controller();
        const landing = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(getCachedSongCoverUrl).toHaveBeenCalledOnce());
        const next = queue.playSong(songs[2], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));

        cover.resolve(null);
        await landing;
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:b');
        expect(queue.blobUrlRef.current).toBe('blob:b');

        pendingNext.resolve(unavailable('unreachable'));
        await next;
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:b');
    });

    it.each([
        ['another song', '3'],
        ['the same song again', '2'],
    ])('releases the blob of a landed song when %s lands during its cover lookup', async (_label, nextId) => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const cover = deferred<string | null>();
        const nextSrc = `https://cdn.example/${nextId}-fresh.mp3`;
        vi.mocked(getCachedSongCoverUrl).mockReturnValueOnce(cover.promise);
        loader.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'blob:b', blobUrl: 'blob:b' })
            .mockResolvedValueOnce({ kind: 'ok', audioSrc: nextSrc });
        const queue = controller();
        const landing = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(getCachedSongCoverUrl).toHaveBeenCalledOnce());
        await queue.playSong(songs.find(song => song.id === nextId)!, songs);

        cover.resolve(null);
        await landing;
        expect(revoke).toHaveBeenCalledWith('blob:b');
        expect(usePlaybackStore.getState().audioSrc).toBe(nextSrc);
        expect(queue.blobUrlRef.current).toBeNull();
    });

    it('counts every landed play as a new start, the same song again included', async () => {
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/1.mp3' });
        const queue = controller();
        const before = startOfAskedSong();
        await queue.playSong(songs[0], songs);
        const first = startOfAskedSong();
        expect(first).not.toBe(before);
        await queue.playSong(songs[0], songs);
        expect(startOfAskedSong()).not.toBe(first);
    });

    it('still plays a successful request end to end', async () => {
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('https://cdn.example/2.mp3');
        expect(askedSongKeyRef.current).toBe(getPlaybackSongKey(songs[1]));
        expect(queue.shouldAutoPlayRef.current).toBe(true);
        expect(queue.persistLastPlaybackCache).toHaveBeenCalledOnce();
    });
});

describe('Stage takeover', () => {
    // Stage 接管同一个 audio 元素时丢下还在加载的主播放请求（dropPlaysInFlight）：失败不暂停 Stage、不弹窗，成功不落进 Stage 上下文。
    const takeOver = () => {
        dropPlaysInFlight();
        usePlaybackStore.setState({ activePlaybackContext: 'stage', audioSrc: 'https://stage.example/a.mp3' });
    };

    it('stops the loader asking again and drops a late failure of a request Stage took over', async () => {
        const load = deferred<LoaderResult>();
        loader.mockReturnValueOnce(load.promise);
        const queue = controller();
        runEffects();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        const retry = loader.mock.calls[0][3]?.retry;
        expect(retry?.isCurrent()).toBe(true);

        takeOver();
        expect(retry?.isCurrent()).toBe(false);
        retry?.onRetrying?.(failureOf('unreachable'), 1);
        expect(message()?.text).not.toBe('status.songRetrying');

        load.resolve(unavailable('sign-in-needed'));
        await pending;
        expect(queue.pause).not.toHaveBeenCalled();
        expect(queue.shouldAutoPlayRef.current).toBe(true);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(message()?.persistent).toBeFalsy();
    });

    it('does not land a late success into the Stage context', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const load = deferred<LoaderResult>();
        loader.mockReturnValueOnce(load.promise);
        const queue = controller();
        runEffects();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        const start = startOfAskedSong();

        takeOver();
        load.resolve({ kind: 'ok', audioSrc: 'blob:late', blobUrl: 'blob:late' });
        await pending;
        expect(revoke).toHaveBeenCalledWith('blob:late');
        expect(usePlaybackStore.getState().audioSrc).toBe('https://stage.example/a.mp3');
        expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
        expect(askedSongKeyRef.current).toBe(getPlaybackSongKey(songs[0]));
        expect(startOfAskedSong()).toBe(start);
    });

    it('hands the main snapshot back the FM state from before a request Stage took over', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        usePlaybackStore.setState({ currentSong: fm[0], playQueue: fm, isFmMode: true });
        const load = deferred<LoaderResult>();
        loader.mockReturnValueOnce(load.promise);
        const mainPlaybackSnapshotRef = { current: null as Record<string, unknown> | null };
        const queue = controller({ mainPlaybackSnapshotRef });
        runEffects();
        const pending = queue.playSong(songs[1], songs, false);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(usePlaybackStore.getState().isFmMode).toBe(false);

        // openStagePlayer: snapshot the main picture (carrying the pending request's FM flag), drop the plays
        // in flight, then switch; Stage turns FM off.
        mainPlaybackSnapshotRef.current = {
            currentSong: fm[0], lyrics: null, cachedCoverUrl: null, audioSrc: 'https://cdn.example/f1.mp3', playQueue: fm,
            isFmMode: false, playerState: PlayerState.PLAYING, currentTime: 12, duration: 200, currentLineIndex: -1,
        };
        dropPlaysInFlight();
        usePlaybackStore.setState({ activePlaybackContext: 'stage', isFmMode: false });
        expect(mainPlaybackSnapshotRef.current).toMatchObject({ isFmMode: true, currentSong: fm[0] });

        load.resolve(unavailable('unreachable'));
        await pending;
        // The dropped request no longer puts its FM state back into the live (Stage) store.
        expect(usePlaybackStore.getState().isFmMode).toBe(false);
        expect(queue.pause).not.toHaveBeenCalled();
    });
});

describe('skipAfterPlaybackFailure', () => {
    it('after a media error, says why an online song could not play while it counts down', () => {
        controller().skipAfterPlaybackFailure(mediaFailureOf({ code: 3 }, 'bodian'));
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(message()).toMatchObject({
            text: 'failure.audioUnplayable', quote: { text: 'MEDIA_ERR_DECODE', code: '3' }, countdown: { text: 'failure.skipCountdown' }, providerId: 'bodian',
        });
    });

    it('counts the five seconds in one toast that knows the whole time, and skips when they are over', async () => {
        loader.mockResolvedValue(unavailable('no-audio'));
        await controller().playSong(songs[0], songs);
        const first = message();
        expect(first?.countdown).toEqual({ text: 'failure.skipCountdown', seconds: 5, totalMs: 5000 });
        const [atEnd, after] = vi.mocked(window.setTimeout).mock.calls[0] as unknown as [() => void, number];
        expect(after).toBe(5000);

        (vi.mocked(window.setInterval).mock.calls[0][0] as () => void)();
        const ticked = message();
        expect(ticked?.countdown).toEqual({ text: 'failure.skipCountdown', seconds: 4, totalMs: 5000 });
        expect(ticked?.nonce).toBe(first?.nonce);

        // The next song that cannot be had either counts in a toast of its own, though it says the same.
        atEnd();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(message()?.countdown?.seconds).toBe(5));
        expect(message()?.nonce).not.toBe(first?.nonce);
    });

    it('counts down after a media error without a failure, and says so instead of going quiet once there are no more skips', () => {
        controller().skipAfterPlaybackFailure();
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(message()).toMatchObject({ type: 'error', text: 'status.playbackError', persistent: true, countdown: { text: 'failure.skipCountdown' } });

        controller({ skipsSoFar: 2 }).skipAfterPlaybackFailure();
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(message()).toMatchObject({ type: 'error', text: 'status.playbackError' });
        expect(message()?.countdown).toBeUndefined();
    });

    it('skips along the queue as it is when the skip comes, not as it was when the failure showed', async () => {
        const extra = makeSong('9');
        loader.mockReturnValue(new Promise(() => undefined));
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('unreachable'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        const edited = [songs[0], extra, songs[1], songs[2]];
        usePlaybackStore.setState({ playQueue: edited });
        controller(); // the store change re-renders the hook

        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(extra);
        expect(usePlaybackStore.getState().playQueue).toBe(edited);
    });

    it('replays the failed song against the latest queue when no retry is supplied, so queue edits survive', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/1-fresh.mp3' });
        const queue = controller({ skipsSoFar: 2 });
        queue.skipAfterPlaybackFailure(failureOf('unreachable'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        const shown = message()!;
        expect(shown).toMatchObject({ actionLabel: 'ui.retry' });
        const edited = [songs[0], extra];
        usePlaybackStore.setState({ playQueue: edited });
        const rerendered = controller({ skipsSoFar: 2 });

        shown.onAction?.();
        await vi.waitFor(() => expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(songs[0]);
        expect(usePlaybackStore.getState().playQueue).toEqual(edited);
        expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), edited);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    it('asks the caller\'s retry where it has one', () => {
        const retry = vi.fn();
        controller({ skipsSoFar: 2 }).skipAfterPlaybackFailure(failureOf('unreachable'), { failedSongKey: getPlaybackSongKey(songs[0]), retry });
        message()?.onAction?.();
        expect(retry).toHaveBeenCalledOnce();
        expect(message()).toBeNull();
    });

    it('clears a countdown the previous song raised while the new one was still loading', async () => {
        const load = deferred<LoaderResult>();
        loader.mockReturnValueOnce(load.promise);
        const queue = controller();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

        // Song 1 still owns the deck until song 2 lands, so its late failure is shown.
        queue.skipAfterPlaybackFailure(failureOf('unreachable'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(message()).toMatchObject({ persistent: true, countdown: { text: 'failure.skipCountdown' } });

        load.resolve({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        await pending;
        expect(askedSongKeyRef.current).toBe(getPlaybackSongKey(songs[1]));
        expect(message()?.persistent).toBeFalsy();
        expect(window.clearTimeout).toHaveBeenCalled();
        expect(queue.shouldAutoPlayRef.current).toBe(true);
    });

    it('does nothing when the failed song is no longer current', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('unreachable'), { failedSongKey: getPlaybackSongKey(songs[1]) });
        expect(message()).toBeNull();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    // 同一首歌重新点播后 key 没变、开始换了：旧失败既不暂停新播放，也不弹窗。
    it('does nothing for a failure from an earlier start of the song that is playing again', () => {
        const queue = controller();
        const failedStart = startOfAskedSong();
        askForSong(songs[0]);
        queue.skipAfterPlaybackFailure(failureOf('sign-in-needed'), { failedSongKey: getPlaybackSongKey(songs[0]), failedStart });
        expect(message()).toBeNull();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('turns the retry of a failure into a plain dismiss once the song has been started again', () => {
        const retry = vi.fn();
        const queue = controller({ skipsSoFar: 2 });
        queue.skipAfterPlaybackFailure(failureOf('unreachable'), {
            failedSongKey: getPlaybackSongKey(songs[0]), failedStart: startOfAskedSong(), retry,
        });
        const shown = message()!;
        expect(shown).toMatchObject({ actionLabel: 'ui.retry' });

        askForSong(songs[0]);
        shown.onAction?.();
        expect(retry).not.toHaveBeenCalled();
        expect(message()).toBeNull();
    });
});

// 用户看得到的每次失败报告一次（Folium playback.failed 经 hostExtensionHooks.notifyPlaybackFailed）。
describe('reporting playback failures', () => {
    it('reports a failed pick once, for the requested song, after the loader gave up asking again', async () => {
        loader.mockImplementation(async (_song, _quality, _prefetched, options) => {
            options?.retry?.onRetrying?.(failureOf('unreachable'), 1);
            expect(notified).not.toHaveBeenCalled();
            return unavailable('unreachable');
        });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'unreachable', phase: 'play', willAutoSkip: true });
    });

    it('does not report a superseded request', async () => {
        const first = deferred<LoaderResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(unavailable('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        first.resolve(unavailable('unreachable'));
        await a;
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith(expect.objectContaining({ song: songs[2], reason: 'unknown' }));
    });

    it('reports a taken-down countdown as an automatic skip', async () => {
        loader.mockResolvedValue(unavailable('taken-down'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'taken-down', phase: 'play', willAutoSkip: true });
    });

    it('reports a song whose dialog of another version opened as taken-down, without a skip', async () => {
        loader.mockResolvedValue(unavailable('taken-down'));
        getSongReplacement.mockResolvedValue({ song: makeSong('7'), label: 'Live' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.setPendingUnavailableReplacement).toHaveBeenLastCalledWith(expect.objectContaining({ originalSong: songs[1] }));
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'taken-down', phase: 'play', willAutoSkip: false });
    });

    // 确认另一个版本后 playSong 抛出没被它接住的异常（这里是歌词状态读取）：界面提示「播放出错」，另一个版本同样报告一次。
    it('reports a confirmed other version whose load throws', async () => {
        const replacement = makeSong('7');
        loader.mockResolvedValueOnce(unavailable('taken-down')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/7.mp3' });
        getSongReplacement.mockResolvedValue({ song: replacement, label: 'Live' });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await controller().playSong(songs[1], songs);
        notified.mockClear();

        vi.mocked(loadOnlineLyricsState).mockRejectedValueOnce(new Error('corrupt cache entry'));
        await controller().handleUnavailableReplacementConfirm(); // the dialog state re-renders the hook
        expect(loader.mock.calls[1][0]).toBe(replacement);
        expect(message()).toMatchObject({ type: 'error', text: 'status.playbackError' });
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: replacement, reason: null, phase: 'play', willAutoSkip: false });
    });

    it('drops the error of a confirmed other version a newer pick has taken over', async () => {
        const replacement = makeSong('7');
        const lyricsState = deferred<null>();
        loader.mockResolvedValueOnce(unavailable('taken-down'))
            .mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/7.mp3' })
            .mockResolvedValueOnce(unavailable('unreachable'));
        getSongReplacement.mockResolvedValue({ song: replacement, label: 'Live' });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await controller().playSong(songs[1], songs);
        notified.mockClear();

        vi.mocked(loadOnlineLyricsState).mockReturnValueOnce(lyricsState.promise);
        const queue = controller();
        const confirming = queue.handleUnavailableReplacementConfirm();
        await vi.waitFor(() => expect(loadOnlineLyricsState).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        lyricsState.reject(new Error('corrupt cache entry'));
        await confirming;
        expect(message()).toBe(latest);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith(expect.objectContaining({ song: songs[2], reason: 'unreachable' }));
    });

    it('reports a refused song the setting counts down as an automatic skip', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValue(unavailable('purchase-required'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'purchase-required', phase: 'play', willAutoSkip: true });
    });

    it('reports a Navidrome song that has no stream carrier', async () => {
        const broken = { ...makeSong('n1'), sourceRef: undefined, isNavidrome: true } as unknown as UnifiedSong;
        const queue = controller();
        await queue.playSong(broken, [broken]);
        expect(message()).toMatchObject({ type: 'error', text: 'status.playbackError' });
        expect(notified).toHaveBeenCalledWith({ song: broken, reason: null, phase: 'play', willAutoSkip: false });
    });

    it('reports a mid-playback failure for the song that was playing', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('sign-in-needed'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[0], reason: 'sign-in-needed', phase: 'mid-playback', willAutoSkip: false });
    });

    it('does not report a mid-playback failure of a song no longer current', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('unreachable'), { failedSongKey: getPlaybackSongKey(songs[1]) });
        expect(notified).not.toHaveBeenCalled();
    });

    it('reports a bare media error: a countdown while skips are left, a stop once they are used up', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure();
        expect(notified).toHaveBeenLastCalledWith({ song: songs[0], reason: null, phase: 'mid-playback', willAutoSkip: true });

        queue.playbackAutoSkipCountRef.current = 2;
        queue.skipAfterPlaybackFailure();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(notified).toHaveBeenLastCalledWith({ song: songs[0], reason: null, phase: 'mid-playback', willAutoSkip: false });
        expect(notified).toHaveBeenCalledTimes(2);
    });

    it('reports nothing for a song that plays', async () => {
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).not.toHaveBeenCalled();
    });

    // 契约 playback.failed 的 phase 划分：play 只是点歌时拿不到音源；音源拿到之后播放器的媒体错误一律是 mid-playback，
    // 刚点的歌还没出声就出错（CDN 403、解不了码）也一样。改了这条划分就得同时改契约、mods/README.md 和 api.md。
    it('reports a media error on the first load of a picked song as mid-playback, not play', async () => {
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        await controller().playSong(songs[1], songs);
        expect(notified).not.toHaveBeenCalled();
        const landed = usePlaybackStore.getState().currentSong;
        expect(landed).toMatchObject({ id: songs[1].id });

        // 重新「渲染」：点的歌已落地，<audio> 第一次加载就出错。
        const queue = controller();
        const failedSongKey = getPlaybackSongKey(songs[1]);
        // 在线源：刷新一次仍失败后带着媒体元素的原因进来（handleOnlineMediaFailure）。
        queue.skipAfterPlaybackFailure(mediaFailureOf({ code: 4 }, 'bodian'), { failedSongKey, failedStart: startOfAskedSong() });
        expect(notified).toHaveBeenLastCalledWith({ song: landed, reason: 'audio-unplayable', phase: 'mid-playback', willAutoSkip: true });
        // 本地、Navidrome、转码失败：不带原因的那条路径。
        queue.skipAfterPlaybackFailure();
        expect(notified).toHaveBeenLastCalledWith({ song: landed, reason: null, phase: 'mid-playback', willAutoSkip: true });
        expect(notified).toHaveBeenCalledTimes(2);
        expect(notified).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'play' }));
    });
});

// On the HiFi route mpv sounds the song and the deck has no source: a stop that only paused the deck left
// the previous HiFi song playing under a stopped player (findings #3, #12).
describe('stops on the HiFi route', () => {
    let hifiPause: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        hifiPause = vi.spyOn(hifiTransport, 'pause').mockImplementation(async () => undefined);
        usePlaybackStore.setState({ playbackRoute: 'hifi', audioSrc: null });
    });
    afterEach(() => {
        usePlaybackStore.setState({ playbackRoute: 'web' });
    });

    it.each(['sign-in-needed', 'subscription-required', 'region-restricted', 'not-configured'] as const)(
        'pauses mpv as well as the deck when a new online song is refused with %s',
        async (caseId) => {
            loader.mockResolvedValue(unavailable(caseId));
            const queue = controller();
            await queue.playSong(songs[1], songs);
            expect(queue.pause).toHaveBeenCalledOnce();
            expect(hifiPause).toHaveBeenCalledOnce();
            expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        },
    );

    it('pauses mpv when a refusal mid-playback stops the song where it is', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure(failureOf('preview-only'), { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(hifiPause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('pauses mpv when the queue ends', async () => {
        usePlaybackStore.setState({ playQueue: [] });
        const queue = controller();
        await queue.handleNextTrack({ allowStopOnMissing: true });
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(hifiPause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
    });

    it('leaves mpv alone on the web route', async () => {
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: 'https://cdn.example/1.mp3' });
        loader.mockResolvedValue(unavailable('sign-in-needed'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(hifiPause).not.toHaveBeenCalled();
    });

    it('countdown failures do not pause anything', async () => {
        loader.mockResolvedValue(unavailable('unreachable'));
        await controller().playSong(songs[1], songs);
        expect(hifiPause).not.toHaveBeenCalled();
    });
});
