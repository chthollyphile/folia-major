import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';
import type { PlaybackSnapshot, WindowPlaybackHandoff } from '@/types/appPlayback';

// test/unit/playback/handoffExternalPlayback.test.ts
// Pins the window hand-off for a song a provider's own player sounds (the external route): the old
// window hands the player over with its snapshot and takes it back when the rebuild is refused; the
// new window takes the running player over, or stops it when nothing takes it and shows the song
// paused. The hooks run without a renderer (plain stand-ins for React's hooks, the real stores); the
// source restore and the external route are stubs that record what they were asked.

const env = vi.hoisted(() => ({
    effects: [] as Array<() => unknown>,
    restoreOutcome: 'restored' as 'restored' | 'failed' | 'stale',
    duringRestore: (): unknown => undefined,
    adopted: true,
    externalRoute: false,
    /** The song the external session has, and whether the app has shown and announced it. */
    externalSong: null as unknown,
    sounding: false,
    calls: [] as string[],
}));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
    useEffect: (effect: () => unknown) => { env.effects.push(effect); },
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
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key, on: () => {}, language: 'en' } }));
vi.mock('@/components/app/playback/restore/restorePlaybackSource', () => ({
    restorePlaybackSourceForSong: async () => {
        await env.duringRestore();
        return env.restoreOutcome;
    },
}));
vi.mock('@/services/onlineMusic/externalPlayback', () => ({
    adoptExternalPlayback: async (song: SongResult) => { env.calls.push(`adopt ${song.id}`); return env.adopted; },
    releaseUnclaimedExternalTrack: (song: SongResult, reason: string) => { env.calls.push(`release ${song.id} (${reason})`); },
    handOverExternalPlayback: () => { env.calls.push('hand over'); },
    handOverExternalPlaybackDuringRestore: () => { env.calls.push('hand over during restore'); },
    pauseExternalPlayback: () => { env.calls.push('pause'); return true; },
    getExternalSong: () => env.externalSong,
    reclaimExternalPlayback: (reason: string) => { env.calls.push(`reclaim (${reason})`); },
    isExternalRoute: () => env.externalRoute,
    isExternalPlaybackSounding: () => env.externalRoute && env.sounding,
    getExternalPosition: () => 42,
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { canPlayExternally: (song: SongResult) => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'appleMusic' },
}));
vi.mock('@/services/hifi/hifiPlayback', () => ({
    getHifiPosition: () => 0,
    installHifiPlayback: () => {},
    isHifiRoute: () => false,
    releaseUnclaimedHifiTrack: () => false,
}));
vi.mock('@/services/hifi/hifiEngine', () => ({ hifiEngine: { getSnapshot: async () => null } }));

const { useElectronWindowPlaybackHandoff } = await import('@/components/app/playback/restore/useElectronWindowPlaybackHandoff');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { askForSong, makeSongCurrent } = await import('@/components/app/playback/currentSong');
const { resetPlaybackStore } = await import('./currentSongWatch');

const externalSong: SongResult = {
    id: 'am1', name: 'A', artists: [], album: { id: '', name: '' }, durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'am1' },
};
const otherSong: SongResult = { ...externalSong, id: 'am2', name: 'B', sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'am2' } };
const webSong: SongResult = { ...externalSong, id: 'x1', name: 'X', sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'x1' } };

const snapshotOf = (song: SongResult): PlaybackSnapshot => ({
    currentSong: song, lyrics: null, cachedCoverUrl: null, audioSrc: null,
    playQueue: [song], isFmMode: false, playerState: PlayerState.PLAYING,
    currentTime: 40, duration: 200, currentLineIndex: -1,
});
const handoffOf = (snapshot: PlaybackSnapshot) => ({
    version: 1, capturedAt: 0, activePlaybackContext: 'main', mainPlayback: snapshot, activePlayback: snapshot,
    stage: { status: null, source: null, playback: null, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
    nowPlaying: { track: null, lyricPayload: null, paused: true, progressMs: 0, progressQuality: 'coarse', displayTimeSec: 0 },
    ui: { currentView: 'home', playerChromeHidden: false, mainWindowBorderVisible: false, transparentModeEnabled: false },
} as unknown as WindowPlaybackHandoff);

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const mountHook = (electron: Record<string, unknown>, pendingResumeTimeRef: { current: number | null } = { current: null }) => {
    const shouldAutoPlayRef = { current: false };
    const applyTransparentPlayerBackground = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('window', { electron });
    env.effects.length = 0;
    const surface = useElectronWindowPlaybackHandoff({
        isElectronWindow: true,
        navigateToPlayer: vi.fn(),
        audioRef: { current: null },
        mainPlaybackSnapshotRef: { current: null },
        stageStatus: null,
        stageSource: null,
        stageLyricsClockRef: { current: {} },
        nowPlayingTrack: null,
        nowPlayingLyricPayload: null,
        nowPlayingPaused: true,
        nowPlayingProgressMs: 0,
        nowPlayingProgressQuality: 'coarse',
        getNowPlayingDisplayTime: () => 0,
        restoreStagePlaybackHandoff: vi.fn(async () => { await env.duringRestore(); }),
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        blobUrlRef: { current: null },
        shouldAutoPlayRef,
        pendingResumeTimeRef,
        lastAudioRecoverySourceRef: { current: null },
        currentOnlineAudioUrlFetchedAtRef: { current: null },
        applyTransparentPlayerBackground,
        restoreCachedThemeForSong: vi.fn(async () => 'none'),
        persistLastPlaybackCache: vi.fn(async () => undefined),
    } as never);
    return { surface, shouldAutoPlayRef, applyTransparentPlayerBackground };
};

/** A new window reads the hand-off of `song`; `askedMeanwhile` is asked for while the main process answers. */
const restoreFrom = async (song: SongResult, askedMeanwhile: SongResult | null = null) => {
    askForSong(null);
    const mounted = mountHook({
        consumeWindowPlaybackHandoff: async () => {
            if (askedMeanwhile) askForSong(askedMeanwhile);
            return handoffOf(snapshotOf(song));
        },
    });
    const consume = env.effects.filter(effect => String(effect).includes('consumeWindowPlaybackHandoff()'));
    expect(consume).toHaveLength(1);
    consume[0]();
    await settle();
    await settle();
    return mounted;
};

beforeEach(() => {
    resetPlaybackStore();
    env.restoreOutcome = 'restored';
    env.duringRestore = () => undefined;
    env.adopted = true;
    env.externalRoute = false;
    env.externalSong = null;
    env.sounding = false;
    env.calls.length = 0;
});
afterEach(() => {
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

describe('a new window and the player the old one handed over', () => {
    it('takes the running player over: nothing is stopped, and nothing of this window starts it by itself', async () => {
        const { shouldAutoPlayRef } = await restoreFrom(externalSong);
        expect(env.calls).toEqual(['adopt am1']);
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('stops a player it could not take over, and shows the song paused', async () => {
        env.adopted = false;
        const { shouldAutoPlayRef } = await restoreFrom(externalSong);
        expect(env.calls).toEqual(['adopt am1', 'release am1 (not taken over)']);
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('stops the player when the restore failed, and shows the song paused rather than playing', async () => {
        env.restoreOutcome = 'failed';
        const { shouldAutoPlayRef } = await restoreFrom(externalSong);
        expect(env.calls).toEqual(['release am1 (restore failed)']);
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('stops the player when another song was asked for while the source was restored, and leaves that song its own state', async () => {
        env.duringRestore = () => makeSongCurrent(otherSong);
        const { shouldAutoPlayRef } = await restoreFrom(externalSong);
        expect(env.calls).toEqual(['release am1 (the restore was overtaken)']);
        // Written by the snapshot; the play that overtook the restore decides what follows.
        expect(shouldAutoPlayRef.current).toBe(true);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('stops the player when another song was asked for while the hand-off was read', async () => {
        await restoreFrom(externalSong, otherSong);
        expect(env.calls).toEqual(['release am1 (another song was asked for)']);
    });

    it('neither takes over nor stops anything for a song the app\'s own engine plays', async () => {
        await restoreFrom(webSong);
        expect(env.calls).toEqual([]);
    });
});

describe('the old window handing the player over', () => {
    const capture = () => {
        makeSongCurrent(externalSong);
        usePlaybackStore.setState({ playerState: PlayerState.PLAYING, playbackRoute: 'external' });
        env.externalRoute = true;
        env.externalSong = externalSong;
        env.sounding = true;
    };

    it('records the player as it sounds, and hands it over with the snapshot', () => {
        capture();
        const { surface } = mountHook({});
        const handoff = surface.captureWindowPlaybackHandoff();
        expect(handoff.activePlayback).toMatchObject({ playerState: PlayerState.PLAYING, currentTime: 42 });
        expect(env.calls).toEqual(['hand over']);
    });

    it('stops a start still on its way rather than hand it over: the snapshot names the song before it', () => {
        makeSongCurrent(webSong);
        usePlaybackStore.setState({ playerState: PlayerState.PAUSED, playbackRoute: 'external' });
        env.externalRoute = true;
        env.externalSong = externalSong;
        const { surface } = mountHook({});
        const handoff = surface.captureWindowPlaybackHandoff();
        expect(env.calls).toEqual(['pause']);
        expect(handoff.activePlayback).toMatchObject({ currentSong: { id: 'x1' }, playerState: PlayerState.PAUSED });

        // The first song of the session: nothing is on screen yet.
        env.calls.length = 0;
        makeSongCurrent(null);
        mountHook({}).surface.captureWindowPlaybackHandoff();
        expect(env.calls).toEqual(['pause']);
    });

    it('takes the player back when the rebuild is refused or fails, and keeps it handed over when it happens', async () => {
        capture();
        const setWindowTransparentMode = vi.fn(async () => false);
        const refused = mountHook({ setWindowTransparentMode });
        await refused.surface.toggleTransparentModeWithHandoff(true);
        expect(env.calls).toEqual(['hand over', 'reclaim (the rebuild was refused)']);
        expect(refused.applyTransparentPlayerBackground).not.toHaveBeenCalled();

        env.calls.length = 0;
        setWindowTransparentMode.mockRejectedValueOnce(new Error('ipc gone'));
        await expect(refused.surface.toggleTransparentModeWithHandoff(true)).rejects.toThrow('ipc gone');
        expect(env.calls).toEqual(['hand over', 'reclaim (the rebuild failed)']);

        env.calls.length = 0;
        setWindowTransparentMode.mockResolvedValueOnce(true);
        await refused.surface.toggleTransparentModeWithHandoff(true);
        expect(env.calls).toEqual(['hand over']);
        expect(refused.applyTransparentPlayerBackground).toHaveBeenCalledWith(true);
    });
});

// Rebuilt again before it finished restoring what it was handed (a wallpaper window rebuilt once more
// for the desktop's transparency, two rebuilds close together): the window has not got its playback yet.
describe('a window rebuilt again while it restores the snapshot it was handed', () => {
    const rebuildWhileRestoring = (consumed: Promise<WindowPlaybackHandoff | null>) => {
        askForSong(null);
        let requested!: (request: { requestId: string }) => void;
        const submitWindowPlaybackHandoff = vi.fn(async (_requestId: string, _handoff: WindowPlaybackHandoff) => true);
        const setWindowTransparentMode = vi.fn(async (_enabled: boolean, _handoff: WindowPlaybackHandoff) => true);
        const mounted = mountHook({
            consumeWindowPlaybackHandoff: () => consumed,
            onWindowPlaybackHandoffRequested: (callback: typeof requested) => { requested = callback; return () => {}; },
            submitWindowPlaybackHandoff,
            setWindowTransparentMode,
        });
        // Mounted in the order App runs them: the request listener, then the read of the hand-off.
        for (const effect of env.effects) effect();
        return { ...mounted, request: (requestId: string) => requested({ requestId }), submitWindowPlaybackHandoff, setWindowTransparentMode };
    };
    const blockRestore = () => {
        let finish!: () => void;
        env.duringRestore = () => new Promise<void>(resolve => { finish = resolve; });
        return () => finish();
    };

    it('passes the snapshot it is restoring on as it came, and the player with it', async () => {
        const finishRestore = blockRestore();
        const handoff = handoffOf(snapshotOf(externalSong));
        const { request, submitWindowPlaybackHandoff } = rebuildWhileRestoring(Promise.resolve(handoff));
        await settle();
        request('r1');
        await settle();
        expect(submitWindowPlaybackHandoff).toHaveBeenCalledTimes(1);
        expect(submitWindowPlaybackHandoff.mock.calls[0]).toEqual(['r1', handoff]);
        expect(env.calls).toEqual(['hand over during restore']);

        // Its own take-over still happens; the external route lands it handed over.
        finishRestore();
        await settle();
        await settle();
        expect(env.calls).toEqual(['hand over during restore', 'adopt am1']);
    });

    it('waits for the hand-off it is still reading, and passes that on', async () => {
        blockRestore();
        let answer!: (handoff: WindowPlaybackHandoff) => void;
        const handoff = handoffOf(snapshotOf(externalSong));
        const { request, submitWindowPlaybackHandoff } = rebuildWhileRestoring(new Promise(resolve => { answer = resolve; }));
        request('r1');
        await settle();
        expect(submitWindowPlaybackHandoff).not.toHaveBeenCalled();
        answer(handoff);
        await settle();
        await settle();
        expect(submitWindowPlaybackHandoff.mock.calls[0]).toEqual(['r1', handoff]);
        expect(env.calls).toEqual(['hand over during restore']);
    });

    it('keeps a song asked for here meanwhile, and stops the handed-over player nobody will take', async () => {
        const finishRestore = blockRestore();
        const handoff = handoffOf(snapshotOf(externalSong));
        const { request, submitWindowPlaybackHandoff } = rebuildWhileRestoring(Promise.resolve(handoff));
        await settle();
        askForSong(webSong);
        request('r1');
        await settle();
        expect(submitWindowPlaybackHandoff.mock.calls[0][1]).not.toBe(handoff);
        expect(env.calls).toEqual(['release am1 (another song was asked for)']);
        finishRestore();
        await settle();
    });

    it('passes it on for a transparency toggle too, and takes the player back when the toggle is refused', async () => {
        blockRestore();
        const handoff = handoffOf(snapshotOf(externalSong));
        const { surface, setWindowTransparentMode } = rebuildWhileRestoring(Promise.resolve(handoff));
        await settle();
        setWindowTransparentMode.mockResolvedValueOnce(false);
        await surface.toggleTransparentModeWithHandoff(true);
        expect(setWindowTransparentMode.mock.calls[0]).toEqual([true, handoff]);
        expect(env.calls).toEqual(['hand over during restore', 'reclaim (the rebuild was refused)']);
    });

    it('passes a Stage hand-off on as it came: the Stage song is the one its restore shows', async () => {
        const finishRestore = blockRestore();
        const stageSong: SongResult = { ...webSong, id: 'stage1', name: 'S', sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'stage1' } };
        const stagePlayback = snapshotOf(stageSong);
        const handoff = {
            ...handoffOf(snapshotOf(externalSong)),
            activePlaybackContext: 'stage',
            activePlayback: stagePlayback,
            stage: { status: null, source: null, playback: stagePlayback, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
        } as unknown as WindowPlaybackHandoff;
        const { request, submitWindowPlaybackHandoff } = rebuildWhileRestoring(Promise.resolve(handoff));
        await settle();
        // The Stage restore has put its song up and is still loading it.
        askForSong(stageSong);
        request('r1');
        await settle();
        expect(submitWindowPlaybackHandoff.mock.calls[0]).toEqual(['r1', handoff]);
        expect(env.calls).toEqual([]);
        finishRestore();
        await settle();
    });

    it('answers for itself once its restore is done', async () => {
        const handoff = handoffOf(snapshotOf(webSong));
        const { request, submitWindowPlaybackHandoff } = rebuildWhileRestoring(Promise.resolve(handoff));
        await settle();
        await settle();
        request('r1');
        await settle();
        expect(submitWindowPlaybackHandoff.mock.calls[0][1]).not.toBe(handoff);
        expect(env.calls).toEqual([]);
    });
});

describe('the position a snapshot records for a song restored on <audio>', () => {
    it('is where the song resumes while <audio> has not loaded it yet', () => {
        makeSongCurrent(webSong);
        usePlaybackStore.setState({ playerState: PlayerState.PLAYING });
        const { surface } = mountHook({}, { current: 95 });
        expect(surface.captureWindowPlaybackHandoff().activePlayback).toMatchObject({ currentTime: 95 });
    });
});
