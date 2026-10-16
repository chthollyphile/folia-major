// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, String(value)),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});
vi.mock('@/services/localMusicService', async (original) => ({
    ...(await original<typeof import('@/services/localMusicService')>()),
    getAudioFromLocalSong: vi.fn(),
}));
vi.mock('@/services/db', async (original) => ({
    ...(await original<typeof import('@/services/db')>()),
    getFromCacheWithMigration: vi.fn(),
}));
vi.mock('@/services/navidromeService', async (original) => {
    const actual = await original<typeof import('@/services/navidromeService')>();
    return {
        ...actual,
        getNavidromeConfig: () => ({ server: 'https://example.invalid', username: 'test' }),
        navidromeApi: {
            ...actual.navidromeApi,
            getStreamUrl: () => 'https://example.invalid/song',
            getSong: async () => ({}),
        },
    };
});
vi.mock('@/utils/keyboardTargets', async (original) => ({
    ...(await original<typeof import('@/utils/keyboardTargets')>()),
    hasBlockingWindow: () => false, isTextEntryTarget: () => false,
}));
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { acquireExternalPlayback, releaseAllExternalPlayback } from '@/services/externalPlaybackSession';
import { invalidatePlaybackRequest } from '@/services/playbackRequest';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { currentTime } from '@/stores/motionSignals';
import { isMacPlatform } from '@/utils/platform';
import { useLibraryPlaybackController } from '@/hooks/useLibraryPlaybackController';
import { usePlaybackInteractionBridge } from '@/hooks/usePlaybackInteractionBridge';
import { getAudioFromLocalSong } from '@/services/localMusicService';
import { getFromCacheWithMigration } from '@/services/db';
import { createQueueMutations } from '@/components/app/player-panel/createQueueMutations';
import { createSessionTransport } from '@/components/app/playback/createSessionTransport';
import { PlayerState, type LocalSong, type SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/mod-system/externalPlaybackRouting.test.ts
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = usePlaybackStore.getState();
const ref = <T>(value: T) => ({ current: value });
let root: Root | undefined;
const own = (dispatch = vi.fn()) =>
    acquireExternalPlayback({ modId: 'test', dispatch, cleanup: vi.fn(), report: vi.fn() });
const song = { id: 99, name: 'Room', artists: [], album: { id: 1, name: '' }, durationMs: 100000 } as SongResult;
function mount(component: React.FC) {
    const box = document.createElement('div');
    document.body.append(box);
    root = createRoot(box);
    act(() => {
        root!.render(React.createElement(component));
    });
}
const params = () => ({
    likedSongIds: new Set<number>(),
    setLyrics: vi.fn(),
    setIsLyricsLoading: vi.fn(),
    setLikedSongIds: vi.fn(),
    navigateToPlaybackView: vi.fn(),
    persistLastPlaybackCache: vi.fn(async () => {}),
    restoreCachedThemeForSong: vi.fn(async () => {}),
    interruptStagePlaybackForMainTransition: () => null,
    blobUrlRef: ref<string | null>(null),
    shouldAutoPlayRef: ref(false),
    currentSongRef: ref<string | number | null>(null),
    currentOnlineAudioUrlFetchedAtRef: ref<number | null>(null),
});
beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState(initial, true);
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
    act(() => {
        root?.unmount();
    });
    root = undefined;
    releaseAllExternalPlayback();
    invalidatePlaybackRequest();
    document.body.replaceChildren();
});

it('routes arrow-key seek with pause-preserving semantics instead of changing the element', () => {
    const dispatch = vi.fn();
    own(dispatch);
    usePlaybackStore.setState({
        currentSong: song,
        audioSrc: 'room-source',
        playerState: PlayerState.PAUSED,
        duration: 100,
    });
    useAppViewStore.setState({ view: 'player', isPanelOpen: false });
    currentTime.set(10);
    const audio = { currentTime: 10 } as HTMLAudioElement;
    mount(() => {
        usePlaybackInteractionBridge({
            stageActiveEntryKind: null,
            isNowPlayingStageActive: false,
            audioRef: ref(audio),
            stageLyricsClockRef: ref({ startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null }),
            cyclePlayerChromeVisibilityMode: vi.fn(),
            handleNextTrack: vi.fn(),
            handlePrevTrack: vi.fn(),
            navigateBackFromPlayer: vi.fn(),
            pausePlayback: vi.fn(),
            resumePlayback: vi.fn(async () => {}),
            syncStageLyricsClock: vi.fn(),
        });
        return null;
    });
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
    });
    expect(audio.currentTime).toBe(10);
    expect(dispatch).toHaveBeenCalledWith({ type: 'seek', seconds: 15, resume: false });
});

it.each([false, true])('routes empty-session track shortcuts only outside Stage (Stage=%s)', (stage) => {
    const next = vi.fn(), previous = vi.fn();
    useAppViewStore.setState({ view: 'player', isPanelOpen: false });
    mount(() => {
        usePlaybackInteractionBridge({
            stageActiveEntryKind: null, isNowPlayingStageActive: stage, audioRef: ref(null),
            stageLyricsClockRef: ref({ startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null }),
            cyclePlayerChromeVisibilityMode: vi.fn(), handleNextTrack: next, handlePrevTrack: previous,
            navigateBackFromPlayer: vi.fn(), pausePlayback: vi.fn(), resumePlayback: vi.fn(async () => {}), syncStageLyricsClock: vi.fn(),
        });
        return null;
    });
    const press = () => act(() => {
        for (const code of ['ArrowLeft', 'ArrowRight']) window.dispatchEvent(new KeyboardEvent('keydown', {
            code, ctrlKey: !isMacPlatform, metaKey: isMacPlatform, bubbles: true, cancelable: true,
        }));
    });
    press();
    expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled();
    own();
    press();
    expect(next).toHaveBeenCalledTimes(stage ? 0 : 1); expect(previous).toHaveBeenCalledTimes(stage ? 0 : 1);
    next.mockClear(); previous.mockClear();
    releaseAllExternalPlayback();
    press();
    expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled();
});

it('drops local audio arriving after acquisition and revokes its uncommitted blob', async () => {
    const input = params();
    let library!: ReturnType<typeof useLibraryPlaybackController>;
    mount(() => {
        library = useLibraryPlaybackController(input);
        return null;
    });
    let resolve!: (value: string) => void;
    vi.mocked(getAudioFromLocalSong).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
        pending = library.onPlayLocalSong({ id: 'local' } as LocalSong);
    });
    own();
    act(() => {
        usePlaybackStore.setState({ currentSong: song, audioSrc: 'room-source' });
    });
    await act(async () => {
        resolve('blob:old-local');
        await pending;
    });
    expect(usePlaybackStore.getState().audioSrc).toBe('room-source');
    expect(input.shouldAutoPlayRef.current).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-local');
    expect(input.persistLastPlaybackCache).not.toHaveBeenCalled();
});

it('drops a Navidrome load after acquisition even when its cached lyrics arrive later', async () => {
    const input = params();
    let library!: ReturnType<typeof useLibraryPlaybackController>;
    mount(() => {
        library = useLibraryPlaybackController(input);
        return null;
    });
    let resolve!: (value: unknown) => void;
    vi.mocked(getFromCacheWithMigration).mockReturnValueOnce(
        new Promise((done) => {
            resolve = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
        pending = library.onPlayNavidromeSong({
            id: 'nav',
            name: 'Nav',
            isNavidrome: true,
            navidromeData: {
                id: 'nav',
                streamUrl: 'https://example.invalid/song',
                albumId: 'a',
                artistId: 'r',
                path: '/song.mp3',
                suffix: 'mp3',
            },
        } as NavidromeSong);
    });
    own();
    act(() => {
        usePlaybackStore.setState({ currentSong: song, audioSrc: 'room-source' });
    });
    await act(async () => {
        resolve({ lyricsSource: 'online', matchedLyrics: { lines: [] } });
        await pending;
    });
    expect(usePlaybackStore.getState().audioSrc).toBe('room-source');
    expect(input.shouldAutoPlayRef.current).toBe(false);
    expect(input.persistLastPlaybackCache).not.toHaveBeenCalled();
});

it('routes bulk Navidrome enqueue and blocks personal queue edits while owned', () => {
    const dispatch = vi.fn();
    own(dispatch);
    usePlaybackStore.setState({ playQueue: [song] });
    const persist = vi.fn(async () => {});
    const mutations = createQueueMutations({
        currentSong: song,
        playQueue: [song],
        persistLastPlaybackCache: persist,
        t: (key) => key,
        queueAddBehavior: 'append',
        audioQuality: 'standard',
    });
    mutations.addNavidromeSongsToQueue([
        {
            id: 'nav',
            name: 'Nav',
            isNavidrome: true,
            artists: [],
            album: { id: 'a', name: '' },
            durationMs: 1000,
            navidromeData: {
                id: 'nav',
                streamUrl: 'https://example.invalid/song',
                albumId: 'a',
                artistId: 'r',
                path: '/song.mp3',
                suffix: 'mp3',
            },
        } as NavidromeSong,
    ]);
    expect(dispatch.mock.calls[0][0].type).toBe('enqueue');
    expect(dispatch.mock.calls[0][0].songs).toHaveLength(1);
    mutations.removeQueueSong(0);
    expect(mutations.applyQueueBatchOperation('remove', [0])).toBe(false);
    expect(usePlaybackStore.getState().playQueue).toEqual([song]);
    expect(persist).not.toHaveBeenCalled();
});

it('lease transport seek preserves pause and stop disarms autoplay even if pause throws', () => {
    const audio = {
        currentTime: 4,
        duration: 100,
        readyState: 1,
        paused: true,
        pause: vi.fn(() => {
            throw Error('pause');
        }),
        removeAttribute: vi.fn(),
        load: vi.fn(),
        play: vi.fn(),
    };
    const refs = {
        audioRef: ref(audio as unknown as HTMLAudioElement),
        shouldAutoPlay: ref(true),
        currentSongRef: ref<string | number | null>('99'),
        blobUrlRef: ref<string | null>(null),
        pendingResumeTimeRef: ref<number | null>(7),
    };
    const transport = createSessionTransport(refs);
    transport.seek(12);
    expect(audio.currentTime).toBe(12);
    expect(audio.play).not.toHaveBeenCalled();
    expect(() => transport.stop()).toThrow('pause');
    expect(refs.shouldAutoPlay.current).toBe(false);
    expect(refs.currentSongRef.current).toBeNull();
    expect(refs.pendingResumeTimeRef.current).toBeNull();
    expect(usePlaybackStore.getState().audioSrc).toBeNull();
});
