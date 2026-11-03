import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';

// test/unit/playback/stageHifiSnapshot.test.ts
// A Stage round trip from a song mpv was playing (findings #2, #10). Entering the stage stops mpv, so the
// main snapshot has to say which engine sounded the song and where mpv was; leaving the stage then restores
// that song's source (which routes it to HiFi again at that position) instead of putting back a null
// address under a PLAYING player, and first pauses and empties the deck the stage's media played on. The hook
// runs without a renderer, as in currentSongStageRoutes.test.ts; the source restore is a stub that records
// what it was asked.

const env = vi.hoisted(() => ({
    effects: [] as Array<() => unknown>,
    // The hook's refs by call order, kept across "renders" as React keeps them.
    refs: [] as Array<{ current: unknown }>,
    refIndex: 0,
    restoreCalls: [] as Array<{ song: SongResult; resumeAt: number | null; stillWanted: boolean; queue: SongResult[] | undefined }>,
}));

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => (env.refs[env.refIndex++] ??= { current }),
    useState: (value: unknown) => [value, vi.fn()],
    useEffect: (effect: () => unknown) => { env.effects.push(effect); },
}));
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
}));
vi.mock('@/hooks/usePlayerCapSource', () => ({
    usePlayerCapSource: () => ({
        state: { track: null, lyrics: null, activePlayer: null, clock: { durationSec: 0 }, connectionStatus: 'disabled', playerState: 'paused' },
        players: [],
        getCurrentTimeSec: () => 0,
    }),
}));
vi.mock('@/utils/lyrics/LyricParserFactory', () => ({ LyricParserFactory: { parse: async () => null } }));
vi.mock('@/components/app/playback/restore/restorePlaybackSource', () => ({
    restorePlaybackSourceForSong: vi.fn(async (song: SongResult, options: {
        pendingResumeTimeRef?: { current: number | null };
        stillWanted: () => boolean;
        queue?: SongResult[];
    }) => {
        env.restoreCalls.push({
            song,
            resumeAt: options.pendingResumeTimeRef?.current ?? null,
            stillWanted: options.stillWanted(),
            queue: options.queue,
        });
        return 'restored';
    }),
}));

const { useStagePlaybackController } = await import('@/components/app/playback/useStagePlaybackController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStageSettingsStore } = await import('@/stores/useStageSettingsStore');
const { hifiPlaybackClock } = await import('@/services/hifi/hifiPlayback');
const { askForSong, makeSongCurrent } = await import('@/components/app/playback/currentSong');
const { restorePlaybackSourceForSong } = await import('@/components/app/playback/restore/restorePlaybackSource');

const localSong = {
    id: 'l1', name: 'Local', artists: [], album: { id: '', name: '' }, durationMs: 200000,
    isLocal: true, localRef: { songId: 'l1' }, sourceRef: { kind: 'local', mediaId: 'l1' },
} as unknown as SongResult;
const navidromeSong = {
    id: 'n1', name: 'Navi', artists: [], album: { id: '', name: '' }, durationMs: 200000,
    isNavidrome: true, sourceRef: { kind: 'navidrome', mediaId: 'n1' },
} as unknown as SongResult;
const onlineSong: SongResult = {
    id: 'm1', name: 'Online', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'm1' },
};

/** The refs App hands the hook (usePlaybackRuntimeRefs), as plain objects. */
const createRefs = () => ({
    audioRef: { current: null as HTMLAudioElement | null },
    blobUrlRef: { current: null as string | null },
    shouldAutoPlay: { current: false },
    pendingResumeTimeRef: { current: null as number | null },
    lastAudioRecoverySourceRef: { current: null as string | null },
    currentOnlineAudioUrlFetchedAtRef: { current: null as number | null },
});
let refs: ReturnType<typeof createRefs>;

/** One "render" of the hook with the stores as they are now; the refs live across renders, as in App. */
const render = () => {
    env.effects.length = 0;
    env.refIndex = 0;
    return useStagePlaybackController({
        isDev: false,
        isElectronWindow: false,
        audioRef: refs.audioRef,
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        navigateToPlayer: vi.fn(),
    } as never);
};

/** The main player as it stands on a route: the song current, the idle deck at 3 s, mpv at 90 s. */
/** A deck as the hook touches it, with what was done to it in order. */
const fakeDeck = (currentTime: number) => {
    const calls: string[] = [];
    return {
        calls,
        currentTime,
        pause: vi.fn(() => { calls.push('pause'); }),
        load: vi.fn(() => { calls.push('load'); }),
        removeAttribute: vi.fn((name: string) => { calls.push(`removeAttribute:${name}`); }),
    };
};

const playingMain = (song: SongResult, route: 'hifi' | 'web', playerState = PlayerState.PLAYING) => {
    makeSongCurrent(song);
    usePlaybackStore.setState({
        activePlaybackContext: 'main',
        currentSong: song,
        playQueue: [song],
        playbackRoute: route,
        audioSrc: route === 'hifi' ? null : 'blob:main',
        playerState,
        duration: 200,
    });
    refs.audioRef.current = fakeDeck(3) as unknown as HTMLAudioElement;
    // Frozen at 90 s so the assertions do not chase the extrapolating clock.
    hifiPlaybackClock.sync({ positionSec: 90, paused: true, durationSec: 200 });
};

/** Into the stage (an empty stage-api entry) and out again; the route guard's part is played by hand. */
const roundTrip = async () => {
    const main = render();
    await main.openStagePlayer();
    const snapshot = main.mainPlaybackSnapshotRef.current;
    // Entering the stage context left the HiFi route (hifiRouteGuard): mpv stopped, route web.
    usePlaybackStore.setState({ playbackRoute: 'web' });
    render().leaveStagePlayback();
    return snapshot;
};

beforeEach(() => {
    refs = createRefs();
    env.refs.length = 0;
    env.restoreCalls.length = 0;
    vi.mocked(restorePlaybackSourceForSong).mockClear();
    useStageSettingsStore.setState({ enableNowPlayingStage: false, enablePlayerCapStage: false });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    makeSongCurrent(null);
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: null, audioSrc: null, playbackRoute: 'web', playQueue: [], playerState: PlayerState.IDLE });
    vi.restoreAllMocks();
});

describe('the main snapshot', () => {
    it('records the HiFi route and mpv\'s position, not the idle deck\'s', async () => {
        playingMain(localSong, 'hifi');
        await render().openStagePlayer();
        // render() is the hook's object of that call; the snapshot ref is shared across renders.
        const snapshot = render().mainPlaybackSnapshotRef.current;
        expect(snapshot).toMatchObject({ route: 'hifi', currentTime: 90, audioSrc: null, currentSong: localSong });
    });

    it('records the web route and the deck\'s position on the web route', async () => {
        playingMain(localSong, 'web');
        await render().openStagePlayer();
        expect(render().mainPlaybackSnapshotRef.current).toMatchObject({ route: 'web', currentTime: 3, audioSrc: 'blob:main' });
    });

    it('is captured with the route whenever the main player changes', () => {
        playingMain(localSong, 'hifi');
        const stage = render();
        const capture = env.effects.filter(effect => String(effect).includes('lastKnownMainSongRef'));
        expect(capture).toHaveLength(1);
        capture[0]();
        expect(stage.mainPlaybackSnapshotRef.current).toMatchObject({ route: 'hifi', currentTime: 90 });
    });
});

describe('leaving the stage back to a song mpv was playing', () => {
    it.each([['local', localSong], ['Navidrome', navidromeSong]] as const)(
        'restores the %s song\'s source at mpv\'s position instead of putting back a null address',
        async (_kind, song) => {
            playingMain(song, 'hifi');
            await roundTrip();

            expect(env.restoreCalls).toHaveLength(1);
            expect(env.restoreCalls[0]).toMatchObject({ song, resumeAt: 90, stillWanted: true, queue: [song] });
            const state = usePlaybackStore.getState();
            expect(state.currentSong).toBe(song);
            expect(state.audioSrc).toBeNull();
            // Not PLAYING over a song nothing sounds yet: the autoplay intent starts it once the load lands.
            expect(state.playerState).toBe(PlayerState.PAUSED);
            expect(refs.shouldAutoPlay.current).toBe(true);
            expect(refs.pendingResumeTimeRef.current).toBe(90);
        },
    );

    it('comes back paused without an intent when it was paused', async () => {
        playingMain(localSong, 'hifi', PlayerState.PAUSED);
        await roundTrip();
        expect(env.restoreCalls).toHaveLength(1);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(refs.shouldAutoPlay.current).toBe(false);
    });

    it('stays idle when it was idle', async () => {
        playingMain(localSong, 'hifi', PlayerState.IDLE);
        await roundTrip();
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
    });

    it('hands the restore a "still wanted" that a newer ask turns off', async () => {
        playingMain(localSong, 'hifi');
        await roundTrip();
        const [, options] = vi.mocked(restorePlaybackSourceForSong).mock.calls[0] as unknown as [SongResult, { stillWanted: () => boolean }];
        expect(options.stillWanted()).toBe(true);
        askForSong(onlineSong);
        expect(options.stillWanted()).toBe(false);
    });

    it('pauses and empties the deck the stage\'s media played on before the restore, which may fail and leave it so', async () => {
        const deck = fakeDeck(42);
        let deckAtRestore: string[] | null = null;
        vi.mocked(restorePlaybackSourceForSong).mockImplementationOnce(async () => {
            deckAtRestore = [...deck.calls];
            return 'failed';
        });
        playingMain(localSong, 'hifi');
        await render().openStagePlayer();
        usePlaybackStore.setState({ playbackRoute: 'web' });
        // The stage's media plays on the deck (loadStageSessionIntoPlayback writes audioSrc).
        usePlaybackStore.setState({ audioSrc: 'https://stage/media.mp3', playerState: PlayerState.PLAYING });
        refs.audioRef.current = deck as unknown as HTMLAudioElement;
        render().leaveStagePlayback();
        await Promise.resolve();

        // A null audioSrc stops no deck (usePlaybackAudioBridge loads only a new address): the hook does.
        expect(usePlaybackStore.getState()).toMatchObject({ audioSrc: null, playbackRoute: 'web' });
        expect(deck.calls).toEqual(['pause', 'removeAttribute:src', 'load']);
        expect(deckAtRestore).toEqual(['pause', 'removeAttribute:src', 'load']);
    });

    it('restores the source too when a main play is interrupted by a play from the stage', async () => {
        playingMain(localSong, 'hifi');
        const main = render();
        await main.openStagePlayer();
        usePlaybackStore.setState({ playbackRoute: 'web' });
        render().interruptStagePlaybackForMainTransition();
        expect(env.restoreCalls).toHaveLength(1);
        expect(env.restoreCalls[0].resumeAt).toBe(90);
    });
});

describe('leaving the stage back to a web song', () => {
    it('puts its address back and restores nothing', async () => {
        playingMain(localSong, 'web');
        await roundTrip();
        expect(restorePlaybackSourceForSong).not.toHaveBeenCalled();
        // The deck plays that address again: it is not emptied.
        expect(refs.audioRef.current?.load).not.toHaveBeenCalled();
        const state = usePlaybackStore.getState();
        expect(state.audioSrc).toBe('blob:main');
        expect(state.playerState).toBe(PlayerState.PLAYING);
        expect(refs.pendingResumeTimeRef.current).toBe(3);
    });

    it('leaves an online song to its own address, even with none in the snapshot', async () => {
        playingMain(onlineSong, 'web');
        usePlaybackStore.setState({ audioSrc: null });
        await roundTrip();
        expect(restorePlaybackSourceForSong).not.toHaveBeenCalled();
    });
});
