import { acquireExternalPlayback, releaseAllExternalPlayback } from '@/services/externalPlaybackSession';
import { beginPlaybackRequest } from '@/services/playbackRequest';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PlayerState, type StatusMessage, type UnifiedSong } from '@/types';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { OnlineAudioSourceResult, PlaybackFailureReason } from '@/types/playbackFailure';

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
vi.mock('@/services/hostExtensionHooks', () => ({ hasBeforePlayHook: () => false, notifyPlaybackFailed: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => true } }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({
    isSongUnavailable: vi.fn(() => false),
    getSongReplacement: vi.fn(async () => null),
}));
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
const { usePlaybackQueueController } = await import('@/hooks/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');
const { getSongReplacement, isSongUnavailable } = await import('@/services/onlineMusic/songAvailability');
const { loadOnlineLyricsState } = await import('@/utils/onlineLyricsState');
const { getCachedSongCoverUrl } = await import('@/services/onlineMusic/resourceCache');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');
const { notifyPlaybackFailed } = await import('@/services/hostExtensionHooks');
const notified = vi.mocked(notifyPlaybackFailed);

const makeSong = (id: string): UnifiedSong => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const songs: UnifiedSong[] = ['1', '2', '3'].map(makeSong);
const loader = vi.mocked(loadOnlineSongAudioSource);
const failed = (reason: PlaybackFailureReason): OnlineAudioSourceResult => ({ kind: 'failed', failure: { reason, stage: 'resolve-url' } });
const message = () => useStatusMessageStore.getState().message as StatusMessage | null;
// App 持有的播放代次在多次“渲染”之间是同一个 ref。
const playbackGenerationRef = { current: 0 };
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
    vi.mocked(getSongReplacement).mockReset().mockImplementation(async () => null);
    vi.mocked(loadOnlineLyricsState).mockReset().mockImplementation(async () => null);
    vi.mocked(getCachedSongCoverUrl).mockReset().mockImplementation(async () => null);
    playbackGenerationRef.current = 0;
    audioSettings.autoSkipUnplayable = false;
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: songs[0], playQueue: songs,
        playerState: PlayerState.PLAYING, isFmMode: false, audioSrc: 'https://cdn.example/1.mp3' });
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    releaseAllExternalPlayback();
    effectCleanups.splice(0).forEach(cleanup => cleanup());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function controller({ mainPlaybackSnapshotRef = { current: null }, onPlayNavidromeSong }: {
    mainPlaybackSnapshotRef?: { current: unknown };
    onPlayNavidromeSong?: (...args: unknown[]) => Promise<void>;
} = {}) {
    hookRefs.index = 0;
    hookStates.index = 0;
    const pause = vi.fn();
    const shouldAutoPlayRef = { current: true };
    const currentSongRef = { current: getPlaybackSongKey(songs[0]) as string | number | null };
    const playbackAutoSkipCountRef = { current: 0 };
    const blobUrlRef = { current: null as string | null };
    const persistLastPlaybackCache = vi.fn(async () => undefined);
    const setLyrics = vi.fn();
    const result = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false, shouldNavigateToPlayerOnTrackChange: true,
        audioRef: { current: { pause } }, shouldAutoPlayRef, currentSongRef, playbackGenerationRef, playbackAutoSkipCountRef,
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
        ...result, pause, shouldAutoPlayRef, currentSongRef, playbackAutoSkipCountRef, blobUrlRef,
        persistLastPlaybackCache, setLyrics, setPendingUnavailableReplacement,
    };
}

describe('online playback stop conditions', () => {
    it.each([
        ['not-signed-in', 'status.songLoginRequired'],
        ['session-expired', 'status.loginExpired'],
        ['membership-required', 'status.songMembershipRequired'],
        ['purchase-required', 'status.songPurchaseRequired'],
        ['entitlement-required', 'status.songEntitlementRequired'],
        ['preview-only', 'status.songPreviewOnly'],
        ['region-restricted', 'status.songRegionRestricted'],
        ['network', 'status.songNetworkFailed'],
        ['timeout', 'status.songRequestTimedOut'],
        ['service-unavailable', 'status.songServiceUnavailable'],
        ['rate-limited', 'status.songRateLimitedNoWait'],
        ['invalid-response', 'status.songTemporarilyUnavailable'],
        ['unknown', 'status.songTemporarilyUnavailable'],
    ] as const)('pauses and never schedules queue skipping for %s', async (reason, text) => {
        loader.mockResolvedValue(failed(reason));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(message()).toMatchObject({ type: 'error', text, persistent: true });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(loader).toHaveBeenCalledOnce();
        expect(getSongReplacement).not.toHaveBeenCalled();
    });

    it('offers a retry instead of a scheduled skip when the cause is unknown', async () => {
        loader.mockResolvedValue(failed('unknown'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()?.onAction).toBeTypeOf('function');
        expect(message()).toMatchObject({ actionLabel: 'ui.retry', cancelLabel: 'status.skipUnavailableAction' });
    });

    it('keeps the queue and the current song untouched after a network failure', async () => {
        const before = structuredClone(songs);
        loader.mockResolvedValue(failed('network'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(message()).toMatchObject({ persistent: true, actionLabel: 'ui.retry', cancelLabel: 'status.skipUnavailableAction' });
        expect(usePlaybackStore.getState().playQueue).toBe(songs);
        expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
        expect(songs).toEqual(before);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
        expect(queue.currentSongRef.current).toBe(getPlaybackSongKey(songs[0]));
    });

    it('asks the loader to retry while the request is current and shows the retrying notice', async () => {
        let retrying: StatusMessage | null = null;
        loader.mockImplementation(async (_song, _quality, _prefetched, options) => {
            expect(options?.retry?.isCurrent()).toBe(true);
            options?.retry?.onRetrying?.({ reason: 'network', stage: 'resolve-url' }, 1);
            retrying = message();
            return failed('network');
        });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(retrying).toMatchObject({ type: 'info', text: 'status.songRetrying' });
    });

    it('retries the same song when the retry action is pressed', async () => {
        loader.mockResolvedValue(failed('network'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        message()?.onAction?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[1]);
    });

    it('skips to the next song in the latest queue when the request used the store queue', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValue(failed('network'));
        const queue = controller();
        await queue.playSong(songs[1]);
        usePlaybackStore.setState({ playQueue: [songs[0], songs[1], extra] });
        message()?.onCancel?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(extra);
        expect(queue.playbackAutoSkipCountRef.current).toBe(0);
    });

    it('retries against the queue as it is when the button is pressed, keeping edits made meanwhile', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValueOnce(failed('network')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        const queue = controller();
        // The store's own queue, the way handleNextTrack and Folium's playQueueItem pass it.
        await queue.playSong(songs[1], usePlaybackStore.getState().playQueue);
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
        loader.mockResolvedValueOnce(failed('network')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/9.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], usePlaybackStore.getState().playQueue);
        const shown = message()!;
        usePlaybackStore.setState({ playQueue: [songs[0], songs[1], extra] }); // song 3 removed, 9 added
        const rerendered = controller();

        shown.onCancel?.();
        await vi.waitFor(() => expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledOnce());
        expect(loader.mock.calls[1][0]).toBe(extra);
        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['1', '2', '9']);
    });

    it('keeps the snapshot of an explicit queue that never reached the store', async () => {
        const playlist = [songs[1], makeSong('8')];
        loader.mockResolvedValueOnce(failed('network')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/8.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], playlist);
        const shown = message()!;
        usePlaybackStore.setState({ playQueue: [songs[0], makeSong('9')] });
        controller();

        shown.onCancel?.();
        await vi.waitFor(() => expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '8' }));
        expect(loader.mock.calls[1][0]).toBe(playlist[1]);
        expect(usePlaybackStore.getState().playQueue).toEqual(playlist);
    });

    it('puts the FM state back when an FM play does not land, and sets it again on retry', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        loader.mockResolvedValueOnce(failed('network')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/f1.mp3' });
        const queue = controller();
        await queue.playSong(fm[0], fm, true);
        expect(usePlaybackStore.getState()).toMatchObject({ isFmMode: false, currentSong: songs[0], playQueue: songs });

        message()?.onAction?.();
        await vi.waitFor(() => expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: 'f1' }));
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
    });

    it('stays in FM mode when a playlist song picked during FM fails', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        usePlaybackStore.setState({ currentSong: fm[0], playQueue: fm, isFmMode: true });
        loader.mockResolvedValue(failed('unknown'));
        const queue = controller();
        await queue.playSong(songs[1], songs, false);
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
    });

    it('restores the FM state from before the first of two requests that both fail', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        const first = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(failed('unknown'));
        const queue = controller();
        const a = queue.playSong(fm[0], fm, true);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs, false);
        expect(usePlaybackStore.getState().isFmMode).toBe(false);
        first.resolve(failed('network'));
        await a;
        expect(usePlaybackStore.getState().isFmMode).toBe(false);

        // The reverse: FM was on, an FM-off request and then an FM request both fail.
        usePlaybackStore.setState({ isFmMode: true });
        loader.mockReset();
        const second = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(second.promise).mockResolvedValueOnce(failed('unknown'));
        const b = queue.playSong(songs[1], songs, false);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(fm[0], fm, true);
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
        second.resolve(failed('network'));
        await b;
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
    });

    it('turns a thrown loader error into a classified failure', async () => {
        loader.mockRejectedValue(new TypeError('Failed to fetch'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(message()).toMatchObject({ text: 'status.songNetworkFailed', actionLabel: 'ui.retry' });
        expect(window.setTimeout).not.toHaveBeenCalled();
    });
});

describe('taken-down songs', () => {
    it('looks up a replacement and then counts down without pausing at runtime', async () => {
        loader.mockResolvedValueOnce(failed('taken-down')).mockResolvedValueOnce(failed('unknown'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(getSongReplacement).toHaveBeenCalledWith(songs[1]);
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songUnavailablePrompt', persistent: true });

        const countdownSkip = vi.mocked(window.setTimeout).mock.calls[0][0] as () => void;
        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[2]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });

    it('opens the replacement dialog instead of counting down when one exists', async () => {
        const replacement = makeSong('7');
        loader.mockResolvedValue(failed('taken-down'));
        vi.mocked(getSongReplacement).mockResolvedValue({ song: replacement, label: 'Live' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.setPendingUnavailableReplacement).toHaveBeenLastCalledWith(expect.objectContaining({
            originalSong: songs[1], replacementSong: replacement, typeDesc: 'Live', queue: songs,
        }));
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toBeNull();
    });

    it('counts down for a statically taken-down song without asking the loader', async () => {
        vi.mocked(isSongUnavailable).mockImplementation(song => song === songs[1]);
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(loader).not.toHaveBeenCalled();
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(message()).toMatchObject({ text: 'status.songUnavailablePrompt' });
    });

    it('reports a failed replacement lookup as a connection problem without counting down', async () => {
        vi.mocked(isSongUnavailable).mockImplementation(song => song === songs[1]);
        vi.mocked(getSongReplacement).mockRejectedValue(new OnlineProviderError('network', 'offline', 'bodian'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songNetworkFailed', actionLabel: 'ui.retry' });
    });

    it('stops counting down once the automatic skips are used up', async () => {
        loader.mockResolvedValue(failed('taken-down'));
        const queue = controller();
        await queue.playSong(songs[1], songs, false, { unavailableSkipCount: 2 });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toEqual({ type: 'error', text: 'status.songUnavailable' });
    });
});

describe('skip unplayable songs setting', () => {
    const extraSongs = ['4', '5'].map(makeSong);
    const longQueue = [...songs, ...extraSongs];

    it('counts a restricted song down to the next one and counts the skip', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValueOnce(failed('membership-required')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.pause).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songUnplayableSkipPrompt', persistent: true });
        expect(getSongReplacement).not.toHaveBeenCalled();

        const countdownSkip = vi.mocked(window.setTimeout).mock.calls[0][0] as () => void;
        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[2]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });

    it('stops skipping restricted songs once the automatic skips are used up', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValue(failed('region-restricted'));
        usePlaybackStore.setState({ playQueue: longQueue });
        const queue = controller();
        await queue.playSong(longQueue[0], longQueue);

        // 两次倒计时跳过（计数 1、2），第三首失败时次数已用尽：不再倒计时，退回该原因原本的停播消息与按钮。
        for (let skipped = 1; skipped <= 2; skipped += 1) {
            const countdownSkip = vi.mocked(window.setTimeout).mock.calls.at(-1)![0] as () => void;
            countdownSkip();
            await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(skipped + 1));
            await vi.waitFor(() => expect(queue.playbackAutoSkipCountRef.current).toBe(skipped));
        }
        await vi.waitFor(() => expect(message()).toMatchObject({ text: 'status.songRegionRestricted', persistent: true }));
        expect(window.setTimeout).toHaveBeenCalledTimes(2);
        expect(loader.mock.calls.map(([song]) => song)).toEqual([longQueue[0], longQueue[1], longQueue[2]]);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
    });

    it('does not count a skip past a network failure even with the setting on', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValueOnce(failed('network')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs, false, { unavailableSkipCount: 1 });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songNetworkFailed', cancelLabel: 'status.skipUnavailableAction' });

        message()?.onCancel?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(queue.playbackAutoSkipCountRef.current).toBe(0);
    });

    it('does not count a manual skip past a restricted song while the setting is off', async () => {
        loader.mockResolvedValueOnce(failed('membership-required')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs, false, { unavailableSkipCount: 1 });
        expect(window.setTimeout).not.toHaveBeenCalled();
        message()?.onAction?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(queue.playbackAutoSkipCountRef.current).toBe(0);
    });

    // 设置打开、次数已用尽：不再倒计时，退回常驻消息；用户手动点「跳过」仍算一次连跳，下一首受限时也不会重新开始倒计时。
    it('counts a manual skip past a restricted song while the setting is on', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValueOnce(failed('membership-required')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs, false, { unavailableSkipCount: 2 });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(message()).toMatchObject({ text: 'status.songMembershipRequired', actionLabel: 'status.skipUnavailableAction' });
        message()?.onAction?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[2]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(3);
    });

    // 取消倒计时 = 这次不跳：和设置关闭时一样停播并给出重试 / 跳过。否则 transport 停在 PLAYING（出错 deck 的 pause 事件被忽略），
    // 强制刷新的「重试」也没了。
    it('pauses and offers the forced retry when a mid-playback countdown is cancelled', () => {
        audioSettings.autoSkipUnplayable = true;
        const retry = vi.fn();
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'unknown', stage: 'refresh' }, { failedSongKey: getPlaybackSongKey(songs[0]), retry });
        expect(message()).toMatchObject({ text: 'status.songUnplayableSkipPrompt', cancelLabel: 'status.cancel' });
        expect(queue.pause).not.toHaveBeenCalled();

        message()?.onCancel?.();
        expect(window.clearTimeout).toHaveBeenCalled();
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(message()).toMatchObject({
            text: 'status.songTemporarilyUnavailable', persistent: true,
            actionLabel: 'ui.retry', cancelLabel: 'status.skipUnavailableAction',
        });
        message()?.onAction?.();
        expect(retry).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unknown', phase: 'mid-playback', willAutoSkip: true }));
    });

    it('stops with the restricted message when a play countdown is cancelled', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValueOnce(failed('membership-required')).mockReturnValueOnce(new Promise(() => undefined));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        message()?.onCancel?.();
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(message()).toMatchObject({ text: 'status.songMembershipRequired', actionLabel: 'status.skipUnavailableAction' });

        message()?.onAction?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
        expect(loader.mock.calls[1][0]).toBe(songs[2]);
        expect(notified).toHaveBeenCalledOnce();
    });

    it('counts down on a mid-playback restricted failure and counts the skip', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockReturnValue(new Promise(() => undefined));
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'preview-only', stage: 'refresh' }, { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(message()).toMatchObject({ text: 'status.songUnplayableSkipPrompt', persistent: true });
        expect(queue.pause).not.toHaveBeenCalled();

        const countdownSkip = vi.mocked(window.setTimeout).mock.calls[0][0] as () => void;
        countdownSkip();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(songs[1]);
        expect(queue.playbackAutoSkipCountRef.current).toBe(1);
    });
});

describe('stale requests', () => {
    it('drops a superseded failure so the newer request keeps its message', async () => {
        const first = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(failed('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        first.resolve(failed('network'));
        await a;
        expect(message()).toBe(latest);
        expect(message()).toMatchObject({ text: 'status.songTemporarilyUnavailable' });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(queue.pause).toHaveBeenCalledOnce();
    });

    it('ignores the retry notice of a superseded request', async () => {
        const first = deferred<OnlineAudioSourceResult>();
        let onRetrying: (() => void) | undefined;
        loader.mockImplementationOnce((_song, _quality, _prefetched, options) => {
            onRetrying = () => options?.retry?.onRetrying?.({ reason: 'network', stage: 'resolve-url' }, 1);
            return first.promise;
        }).mockResolvedValueOnce(failed('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        onRetrying?.();
        expect(message()).toBe(latest);
        first.resolve(failed('network'));
        await a;
    });

    it('does not open a replacement dialog for a superseded lookup', async () => {
        const lookup = deferred<{ song: UnifiedSong; label: string } | null>();
        vi.mocked(isSongUnavailable).mockImplementation(song => song === songs[1]);
        vi.mocked(getSongReplacement).mockReturnValueOnce(lookup.promise);
        loader.mockResolvedValue(failed('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(getSongReplacement).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        lookup.resolve({ song: makeSong('7'), label: 'Live' });
        await a;
        expect(queue.setPendingUnavailableReplacement).not.toHaveBeenCalledWith(expect.objectContaining({ originalSong: songs[1] }));
        expect(message()).toBe(latest);
        expect(window.setTimeout).not.toHaveBeenCalled();
    });

    it('writes nothing from a superseded loader error', async () => {
        const first = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(failed('unknown'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        const latest = message();
        first.reject(new TypeError('Failed to fetch'));
        await a;
        expect(message()).toBe(latest);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('lets a newer request win while the older one waits for its lyrics state', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const lyricsState = deferred<null>();
        vi.mocked(loadOnlineLyricsState).mockReturnValueOnce(lyricsState.promise);
        loader.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'blob:a', blobUrl: 'blob:a' }).mockResolvedValueOnce(failed('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loadOnlineLyricsState).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        lyricsState.resolve(null);
        await a;
        expect(revoke).toHaveBeenCalledWith('blob:a');
        expect(queue.currentSongRef.current).toBe(getPlaybackSongKey(songs[0]));
        expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(queue.setLyrics).not.toHaveBeenCalled();
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    // 落地之后等封面期间又点了一首：新请求只是开始、还没落地，这首歌仍要接上音源，否则新请求失败时会停在没有音源的半落地状态。
    it('still gives a landed song its source when a newer request has only started', async () => {
        const cover = deferred<string | null>();
        const pendingNext = deferred<OnlineAudioSourceResult>();
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

        pendingNext.resolve(failed('network'));
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

    it('counts every landed play as a new playback, the same song again included', async () => {
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/1.mp3' });
        const queue = controller();
        await queue.playSong(songs[0], songs);
        expect(playbackGenerationRef.current).toBe(1);
        await queue.playSong(songs[0], songs);
        expect(playbackGenerationRef.current).toBe(2);
    });

    it('still plays a successful request end to end', async () => {
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('https://cdn.example/2.mp3');
        expect(queue.currentSongRef.current).toBe(getPlaybackSongKey(songs[1]));
        expect(queue.shouldAutoPlayRef.current).toBe(true);
        expect(queue.persistLastPlaybackCache).toHaveBeenCalledOnce();
    });
});

describe('Stage takeover', () => {
    // Stage 接管同一个 audio 元素后，还在加载的主播放请求作废：失败不暂停 Stage、不弹窗，成功不落进 Stage 上下文。
    it('stops the loader retrying and drops a late failure of a request Stage took over', async () => {
        const load = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(load.promise);
        const queue = controller();
        runEffects();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        const retry = loader.mock.calls[0][3]?.retry;
        expect(retry?.isCurrent()).toBe(true);

        usePlaybackStore.setState({ activePlaybackContext: 'stage', audioSrc: 'https://stage.example/a.mp3' });
        expect(retry?.isCurrent()).toBe(false);
        retry?.onRetrying?.({ reason: 'network', stage: 'resolve-url' }, 1);
        expect(message()?.text).not.toBe('status.songRetrying');

        load.resolve(failed('network'));
        await pending;
        expect(queue.pause).not.toHaveBeenCalled();
        expect(queue.shouldAutoPlayRef.current).toBe(true);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(message()?.persistent).toBeFalsy();
    });

    it('does not land a late success into the Stage context', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const load = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(load.promise);
        const queue = controller();
        runEffects();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

        usePlaybackStore.setState({ activePlaybackContext: 'stage', audioSrc: 'https://stage.example/a.mp3' });
        load.resolve({ kind: 'ok', audioSrc: 'blob:late', blobUrl: 'blob:late' });
        await pending;
        expect(revoke).toHaveBeenCalledWith('blob:late');
        expect(usePlaybackStore.getState().audioSrc).toBe('https://stage.example/a.mp3');
        expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
        expect(queue.currentSongRef.current).toBe(getPlaybackSongKey(songs[0]));
        expect(playbackGenerationRef.current).toBe(0);
    });

    it('hands the main snapshot back the FM state from before a request Stage took over', async () => {
        const fm = [makeSong('f1'), makeSong('f2')];
        usePlaybackStore.setState({ currentSong: fm[0], playQueue: fm, isFmMode: true });
        const load = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(load.promise);
        const mainPlaybackSnapshotRef = { current: null as Record<string, unknown> | null };
        const queue = controller({ mainPlaybackSnapshotRef });
        runEffects();
        const pending = queue.playSong(songs[1], songs, false);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(usePlaybackStore.getState().isFmMode).toBe(false);

        // openStagePlayer: snapshot the main picture (carrying the pending request's FM flag), then switch; Stage turns FM off.
        mainPlaybackSnapshotRef.current = {
            currentSong: fm[0], lyrics: null, cachedCoverUrl: null, audioSrc: 'https://cdn.example/f1.mp3', playQueue: fm,
            isFmMode: false, playerState: PlayerState.PLAYING, currentTime: 12, duration: 200, currentLineIndex: -1,
        };
        usePlaybackStore.setState({ activePlaybackContext: 'stage', isFmMode: false });
        expect(mainPlaybackSnapshotRef.current).toMatchObject({ isFmMode: true, currentSong: fm[0] });

        load.resolve(failed('network'));
        await pending;
        // The superseded request no longer puts its FM state back into the live (Stage) store.
        expect(usePlaybackStore.getState().isFmMode).toBe(false);
        expect(queue.pause).not.toHaveBeenCalled();
    });
});

describe('skipAfterPlaybackFailure', () => {
    it('shows a retry for a mid-playback network failure instead of counting down', () => {
        const retry = vi.fn();
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'media-element' }, {
            failedSongKey: getPlaybackSongKey(songs[0]), retry,
        });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(message()).toMatchObject({ text: 'status.songNetworkFailed', actionLabel: 'ui.retry', persistent: true });
        message()?.onAction?.();
        expect(retry).toHaveBeenCalledOnce();
        expect(message()).toBeNull();
    });

    it('replays the current song when no retry is supplied', async () => {
        loader.mockResolvedValue(failed('unknown'));
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'unknown', stage: 'media-element' });
        message()?.onAction?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(songs[0]);
    });

    it('skips along the queue as it is when the button is pressed, not as it was when the failure showed', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValue(failed('unknown'));
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'media-element' }, {
            failedSongKey: getPlaybackSongKey(songs[0]),
        });
        const shown = message()!;
        const edited = [songs[0], extra, songs[1], songs[2]];
        usePlaybackStore.setState({ playQueue: edited });
        controller(); // the store change re-renders the hook

        shown.onCancel?.();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(extra);
        expect(usePlaybackStore.getState().playQueue).toBe(edited);
    });

    it('replays the failed song against the latest queue so queue edits survive the retry', async () => {
        const extra = makeSong('9');
        loader.mockResolvedValue({ kind: 'ok', audioSrc: 'https://cdn.example/1-fresh.mp3' });
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'unknown', stage: 'media-element' }, {
            failedSongKey: getPlaybackSongKey(songs[0]),
        });
        const shown = message()!;
        const edited = [songs[0], extra];
        usePlaybackStore.setState({ playQueue: edited });
        const rerendered = controller();

        shown.onAction?.();
        await vi.waitFor(() => expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledOnce());
        expect(loader.mock.calls[0][0]).toBe(songs[0]);
        expect(usePlaybackStore.getState().playQueue).toEqual(edited);
        expect(rerendered.persistLastPlaybackCache).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), edited);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    it('clears a failure toast the previous song raised while the new one was still loading', async () => {
        const load = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(load.promise);
        const queue = controller();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

        // Song 1 still owns the deck until song 2 commits, so its late failure is shown.
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'refresh' }, { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(message()).toMatchObject({ text: 'status.songNetworkFailed', persistent: true });

        load.resolve({ kind: 'ok', audioSrc: 'https://cdn.example/2.mp3' });
        await pending;
        expect(queue.currentSongRef.current).toBe(getPlaybackSongKey(songs[1]));
        expect(message()?.persistent).toBeFalsy();
        expect(queue.shouldAutoPlayRef.current).toBe(true);
    });

    it('does nothing when the failed song is no longer current', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'refresh' }, { failedSongKey: getPlaybackSongKey(songs[1]) });
        expect(message()).toBeNull();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    // 同一首歌重新点播落地后 key 没变、代次变了：旧失败既不暂停新播放，也不弹窗。
    it('does nothing for a failure from an earlier playback of the song that is playing again', () => {
        const queue = controller();
        playbackGenerationRef.current = 4;
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'refresh' }, {
            failedSongKey: getPlaybackSongKey(songs[0]), failedGeneration: 3,
        });
        expect(message()).toBeNull();
        expect(queue.pause).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('turns the buttons of a failure into a plain dismiss once the song has been played again', () => {
        const retry = vi.fn();
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'unknown', stage: 'media-element' }, {
            failedSongKey: getPlaybackSongKey(songs[0]), failedGeneration: 0, retry,
        });
        const shown = message()!;
        expect(shown).toMatchObject({ actionLabel: 'ui.retry', persistent: true });

        playbackGenerationRef.current += 1;
        shown.onAction?.();
        expect(retry).not.toHaveBeenCalled();
        expect(message()).toBeNull();
    });

    it('keeps the playbackErrorPrompt countdown when called without a failure', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure();
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(message()).toMatchObject({ text: 'status.playbackErrorPrompt', persistent: true });
        expect(queue.pause).not.toHaveBeenCalled();
    });
});

// 用户看得到的每次失败报告一次（Folium playback.failed 经 hostExtensionHooks.notifyPlaybackFailed）。
describe('reporting playback failures', () => {
    it('reports a failed pick once, for the requested song, after the loader gave up retrying', async () => {
        loader.mockImplementation(async (_song, _quality, _prefetched, options) => {
            options?.retry?.onRetrying?.({ reason: 'network', stage: 'resolve-url' }, 1);
            expect(notified).not.toHaveBeenCalled();
            return failed('network');
        });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'network', phase: 'play', willAutoSkip: false });
    });

    it('does not report a superseded request', async () => {
        const first = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(first.promise).mockResolvedValueOnce(failed('unknown'));
        const queue = controller();
        const a = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await queue.playSong(songs[2], songs);
        first.resolve(failed('network'));
        await a;
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith(expect.objectContaining({ song: songs[2], reason: 'unknown' }));
    });

    it('reports a taken-down countdown as an automatic skip', async () => {
        loader.mockResolvedValue(failed('taken-down'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'taken-down', phase: 'play', willAutoSkip: true });
    });

    it('reports a song whose replacement dialog opened as taken-down, without a skip', async () => {
        loader.mockResolvedValue(failed('taken-down'));
        vi.mocked(getSongReplacement).mockResolvedValue({ song: makeSong('7'), label: 'Live' });
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(queue.setPendingUnavailableReplacement).toHaveBeenLastCalledWith(expect.objectContaining({ originalSong: songs[1] }));
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'taken-down', phase: 'play', willAutoSkip: false });
    });

    // 确认替代版本后 playSong 抛出没被它接住的异常（这里是歌词状态读取）：界面提示「播放出错」，替代版本同样报告一次。
    it('reports a confirmed replacement whose load throws', async () => {
        const replacement = makeSong('7');
        loader.mockResolvedValueOnce(failed('taken-down')).mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/7.mp3' });
        vi.mocked(getSongReplacement).mockResolvedValue({ song: replacement, label: 'Live' });
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

    it('drops the error of a confirmed replacement a newer pick has taken over', async () => {
        const replacement = makeSong('7');
        const lyricsState = deferred<null>();
        loader.mockResolvedValueOnce(failed('taken-down'))
            .mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/7.mp3' })
            .mockResolvedValueOnce(failed('network'));
        vi.mocked(getSongReplacement).mockResolvedValue({ song: replacement, label: 'Live' });
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
        expect(notified).toHaveBeenCalledWith(expect.objectContaining({ song: songs[2], reason: 'network' }));
    });

    it('reports a restricted song the setting counts down as an automatic skip', async () => {
        audioSettings.autoSkipUnplayable = true;
        loader.mockResolvedValue(failed('purchase-required'));
        const queue = controller();
        await queue.playSong(songs[1], songs);
        expect(notified).toHaveBeenCalledWith({ song: songs[1], reason: 'purchase-required', phase: 'play', willAutoSkip: true });
    });

    // 本地 / Navidrome 的失败在 useLibraryPlaybackController 里提示和报告：playSong 把「这次点歌是否仍是最新请求」交给它，
    // 被更新的点歌取代后那边就不提示也不报告。
    it('tells a library play when a newer pick has replaced it', async () => {
        const onPlayNavidromeSong = vi.fn(async (..._args: unknown[]) => undefined);
        const navi = { ...makeSong('n1'), sourceRef: undefined, isNavidrome: true, navidromeData: { id: 'n1' } } as unknown as UnifiedSong;
        loader.mockReturnValue(new Promise(() => undefined));
        const queue = controller({ onPlayNavidromeSong });
        await queue.playSong(navi, [navi]);
        const options = onPlayNavidromeSong.mock.calls[0][2] as { isCurrent?: () => boolean };
        expect(options.isCurrent?.()).toBe(true);

        void queue.playSong(songs[1], songs);
        expect(options.isCurrent?.()).toBe(false);
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
        queue.skipAfterPlaybackFailure({ reason: 'session-expired', stage: 'refresh' }, { failedSongKey: getPlaybackSongKey(songs[0]) });
        expect(notified).toHaveBeenCalledOnce();
        expect(notified).toHaveBeenCalledWith({ song: songs[0], reason: 'session-expired', phase: 'mid-playback', willAutoSkip: false });
    });

    it('does not report a mid-playback failure of a song no longer current', () => {
        const queue = controller();
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'refresh' }, { failedSongKey: getPlaybackSongKey(songs[1]) });
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
        queue.currentSongRef.current = failedSongKey;
        // 在线源：刷新一次仍失败后带着媒体元素的原因进来（handleOnlineMediaFailure）。
        queue.skipAfterPlaybackFailure({ reason: 'unknown', stage: 'media-element', mediaErrorCode: 4 },
            { failedSongKey, failedGeneration: playbackGenerationRef.current });
        expect(notified).toHaveBeenLastCalledWith({ song: landed, reason: 'unknown', phase: 'mid-playback', willAutoSkip: false });
        // 本地、Navidrome、转码失败：不带原因的那条路径。
        queue.skipAfterPlaybackFailure();
        expect(notified).toHaveBeenLastCalledWith({ song: landed, reason: null, phase: 'mid-playback', willAutoSkip: true });
        expect(notified).toHaveBeenCalledTimes(2);
        expect(notified).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'play' }));
    });
});

describe('external playback ownership at the online source boundary', () => {
    beforeEach(() => { vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); });
    const acquire = (dispatch = vi.fn()) => acquireExternalPlayback({
        modId: 'online-test', dispatch, cleanup: vi.fn(), report: vi.fn(),
    });
    it('drops a private song resolving after an acquire/release round trip', async () => {
        const source = deferred<OnlineAudioSourceResult>();
        loader.mockReturnValueOnce(source.promise);
        const queue = controller();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        acquire();
        releaseAllExternalPlayback();
        source.resolve({ kind: 'ok', audioSrc: 'blob:old', blobUrl: 'blob:old' });
        await pending;
        expect(usePlaybackStore.getState().audioSrc).toBe('https://cdn.example/1.mp3');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });
    it('cannot commit a landed private source after a session takes over during the cover await', async () => {
        const cover = deferred<string | null>();
        vi.mocked(getCachedSongCoverUrl).mockReturnValueOnce(cover.promise);
        loader.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'blob:old', blobUrl: 'blob:old' });
        const queue = controller();
        const pending = queue.playSong(songs[1], songs);
        await vi.waitFor(() => expect(getCachedSongCoverUrl).toHaveBeenCalledOnce());
        acquire();
        usePlaybackStore.setState({ audioSrc: 'session-source' });
        cover.resolve(null);
        await pending;
        expect(usePlaybackStore.getState().audioSrc).toBe('session-source');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
    });
    it('commits a session source without autoplay or persisting it as the private queue', async () => {
        const request = beginPlaybackRequest(acquire());
        loader.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'blob:session', blobUrl: 'blob:session' });
        const queue = controller();
        await queue.playSong(songs[1], [songs[1]], false, { request, autoplay: false });
        expect(await request.result).toEqual({ status: 'source-committed' });
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(queue.persistLastPlaybackCache).not.toHaveBeenCalled();
    });
    it('returns session load failure without a local retry/skip prompt and reports decoder failure to the owner', async () => {
        const dispatch = vi.fn();
        const token = acquire(dispatch);
        const request = beginPlaybackRequest(token);
        loader.mockResolvedValueOnce(failed('network'));
        const queue = controller();
        await queue.playSong(songs[1], [], false, { request, autoplay: false });
        expect(await request.result).toEqual({ status: 'failed' });
        expect(message()?.persistent).not.toBe(true);
        queue.skipAfterPlaybackFailure({ reason: 'network', stage: 'resolve-url' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'playback-error' });
        expect(window.setTimeout).not.toHaveBeenCalled();
    });
});
