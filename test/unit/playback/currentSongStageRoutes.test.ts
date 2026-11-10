import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';
import type { PlaybackSnapshot, WindowPlaybackHandoff } from '@/types/appPlayback';

// test/unit/playback/currentSongStageRoutes.test.ts
// Pins what the Stage routes write for the current song, and in which order: loading a stage media
// session, a stage lyrics session and a Now Playing track, clearing the surface, putting a saved
// snapshot back, and the PlayerCap mirror. Each line of a log is one write with the key of the song
// asked for as it stands at that moment.
// The hook runs without a renderer (plain stand-ins for React's hooks, the real stores); its
// effects are collected instead of run, so a test can run the one it is about. The lyric parser
// and the PlayerCap source are stubs. No request leaves the test.

const env = vi.hoisted(() => ({
    note: (_label: string) => {},
    effects: [] as Array<() => unknown>,
    parsedLyrics: null as unknown,
    playerCap: {
        track: null as unknown,
        lyrics: null as unknown,
        activePlayer: null as string | null,
        clock: { durationSec: 0 },
        connectionStatus: 'disabled',
        playerState: 'paused',
    },
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
    usePlayerCapSource: () => ({ state: env.playerCap, players: [], getCurrentTimeSec: () => 0 }),
}));
vi.mock('@/utils/lyrics/LyricParserFactory', () => ({
    LyricParserFactory: { parse: async () => { env.note('wait parse'); return env.parsedLyrics; } },
}));

const { useStagePlaybackController } = await import('@/components/app/playback/useStagePlaybackController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStageSettingsStore } = await import('@/stores/useStageSettingsStore');
const { playsDroppedSoFar } = await import('@/components/app/playback/currentSong');
const { resetPlaybackStore, watchCurrentSong } = await import('./currentSongWatch');

const mainSong: SongResult = {
    id: 'm1', name: 'Main', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'm1' },
};
const lyricLines = { lines: [{ fullText: 'la', startTime: 1, endTime: 2, words: [{ text: 'la', startTime: 1, endTime: 2 }] }] };
const mediaSession = { id: 's1', title: 'Stage', audioSrc: 'https://stage.test/s1', lyricsText: '[00:01.00]la', updatedAt: 5 };
const lyricsSession = { id: 'ly1', title: 'Words', lyricSource: { type: 'local', lrcContent: '[00:01.00]la' }, updatedAt: 7 };

const snapshotOf = (song: SongResult | null): PlaybackSnapshot => ({
    currentSong: song, lyrics: null, cachedCoverUrl: null, audioSrc: song ? 'https://audio.test/main' : null,
    playQueue: song ? [song] : [], isFmMode: false, playerState: PlayerState.PAUSED,
    currentTime: 12, duration: 100, currentLineIndex: -1,
});
const handoffOf = (stage: Partial<WindowPlaybackHandoff['stage']>, nowPlaying: Partial<WindowPlaybackHandoff['nowPlaying']> = {}) => ({
    version: 1,
    capturedAt: 0,
    activePlaybackContext: 'stage',
    mainPlayback: null,
    activePlayback: null,
    stage: { status: null, source: 'stage-api', playback: null, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null }, ...stage },
    nowPlaying: { track: null, lyricPayload: null, paused: true, progressMs: 0, progressQuality: 'coarse', displayTimeSec: 0, ...nowPlaying },
    ui: { currentView: 'player', playerChromeHidden: false, mainWindowBorderVisible: false, transparentModeEnabled: false },
} as unknown as WindowPlaybackHandoff);

beforeEach(() => {
    resetPlaybackStore();
    useStageSettingsStore.setState({ enableNowPlayingStage: false, enablePlayerCapStage: false });
    env.effects.length = 0;
    env.parsedLyrics = lyricLines;
    env.playerCap = { track: null, lyrics: null, activePlayer: null, clock: { durationSec: 0 }, connectionStatus: 'disabled', playerState: 'paused' };
});
afterEach(() => {
    env.note = () => {};
    resetPlaybackStore();
});

/** One "render" of the hook, with the stores as they are now. */
function mount() {
    const refs = usePlaybackRuntimeRefs();
    const watch = watchCurrentSong(refs.currentSongRef);
    env.note = watch.note;
    env.effects.length = 0;
    const stage = useStagePlaybackController({
        isDev: false,
        isElectronWindow: false,
        audioRef: refs.audioRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        setLyrics: (lyrics: unknown) => watch.note(`lyrics=${lyrics ? 'set' : 'null'}`),
        setIsLyricsLoading: vi.fn(),
        navigateToPlayer: vi.fn(),
    } as never);
    return { refs, watch, stage };
}

const lyricsEntry = (session: unknown) => handoffOf({ status: { activeEntryKind: 'lyrics', lyricsSession: session } as never });
/** What clearing the surface writes, with the key as given. */
const cleared = (key: string) => [
    `song=null key=${key}`,
    `lyrics=null | song=null key=${key}`,
    `cover=null key=${key}`,
    `audio=null key=${key}`,
    `queue~[] key=${key}`,
];

describe('stage media session and the current song', () => {
    it('asks for the stage song before it waits for its lyrics to be parsed, and shows it after', async () => {
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(null);
        watch.take();

        await stage.loadStageSessionIntoPlayback(mediaSession as never);

        expect(watch.take()).toEqual([
            // The key has moved; the store does not show the song yet.
            'wait parse | song=null key=stage:s1',
            'song=Stage key=stage:s1',
            'lyrics=set | song=Stage key=stage:s1',
            'cover=null key=stage:s1',
            'audio=https://stage.test/s1 key=stage:s1',
            'queue=[] key=stage:s1',
        ]);
        expect(refs.currentSongRef.current).toBe('stage:s1');
    });

    it('clears the key and then the store when the session is gone', async () => {
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();

        await stage.loadStageSessionIntoPlayback(null);

        expect(watch.take()).toEqual(cleared('null'));
        expect(refs.currentSongRef.current).toBeNull();
    });
});

describe('opening the stage and the main plays in flight', () => {
    it('drops them when the main player is left for the stage, and not when the stage is already open', async () => {
        const { stage } = mount();
        const atStart = playsDroppedSoFar();

        await stage.openStagePlayer();
        expect(playsDroppedSoFar()).toBe(atStart + 1);
        expect(usePlaybackStore.getState().activePlaybackContext).toBe('stage');

        // A second "render", now on the stage: opening it again leaves no main player behind.
        await mount().stage.openStagePlayer();
        expect(playsDroppedSoFar()).toBe(atStart + 1);
    });

    it('drops them when a rebuilt window comes back on the stage, and not when it comes back on the main player', async () => {
        const { stage } = mount();
        const atStart = playsDroppedSoFar();

        await stage.restoreStagePlaybackHandoff({ ...lyricsEntry(null), activePlaybackContext: 'main' });
        expect(playsDroppedSoFar()).toBe(atStart);

        await stage.restoreStagePlaybackHandoff(lyricsEntry(null));
        expect(playsDroppedSoFar()).toBe(atStart + 1);
    });
});

describe('stage lyrics session and the current song', () => {
    it('clears the key and the surface, then writes the key and the song together', async () => {
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();

        await stage.restoreStagePlaybackHandoff(lyricsEntry(lyricsSession));

        expect(watch.take()).toEqual([
            'wait parse | song=Stage key=stage:s1',
            ...cleared('null'),
            'song=Words key=stage:7',
            'cover=null key=stage:7',
            'audio=null key=stage:7',
            'queue=[] key=stage:7',
            'lyrics=set | song=Words key=stage:7',
        ]);
        expect(refs.currentSongRef.current).toBe('stage:7');
    });

    it('clears the key with the store when the lyrics cannot be shown', async () => {
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();
        env.parsedLyrics = { lines: [] };

        await stage.restoreStagePlaybackHandoff(lyricsEntry(lyricsSession));

        expect(watch.take()).toEqual(['wait parse | song=Stage key=stage:s1', ...cleared('null')]);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
        expect(refs.currentSongRef.current).toBeNull();
    });

    it('clears the key and then the store when the session is gone', async () => {
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();

        await stage.restoreStagePlaybackHandoff(lyricsEntry(null));

        expect(watch.take()).toEqual(cleared('null'));
        expect(refs.currentSongRef.current).toBeNull();
    });
});

describe('Now Playing and the current song', () => {
    it('writes the key and the song together', async () => {
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();

        await stage.restoreStagePlaybackHandoff(handoffOf(
            { source: 'now-playing' },
            { track: { id: 'np1', title: 'Heard', artist: 'Someone', durationMs: 5000 } as never },
        ));

        expect(watch.take()).toEqual([
            'song=Heard key=stage:np1',
            'cover=null key=stage:np1',
            'audio=null key=stage:np1',
            'queue=[] key=stage:np1',
            'lyrics=null | song=Heard key=stage:np1',
        ]);
        expect(refs.currentSongRef.current).toBe('stage:np1');
    });

    it('clears the key and then the store when the stage is left', async () => {
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        useStageSettingsStore.setState({ enableNowPlayingStage: true });
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();

        stage.leaveStagePlayback();

        expect(watch.take()).toEqual(cleared('null'));
        expect(refs.currentSongRef.current).toBeNull();
    });
});

describe('a saved snapshot and the current song', () => {
    it('puts the main song back in the store and the key together', async () => {
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();
        stage.mainPlaybackSnapshotRef.current = snapshotOf(mainSong);

        stage.interruptStagePlaybackForMainTransition();

        expect(watch.take()).toEqual([
            'song=Main key=online:bodian:m1',
            'lyrics=null | song=Main key=online:bodian:m1',
            'cover=null key=online:bodian:m1',
            'audio=https://audio.test/main key=online:bodian:m1',
            'queue=[Main] key=online:bodian:m1',
        ]);
        expect(refs.currentSongRef.current).toBe('online:bodian:m1');
    });

    it('empties the store and the key when there is no main song to put back', async () => {
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        const { refs, watch, stage } = mount();
        await stage.loadStageSessionIntoPlayback(mediaSession as never);
        watch.take();
        stage.mainPlaybackSnapshotRef.current = null;

        stage.interruptStagePlaybackForMainTransition();

        expect(watch.take()).toEqual([
            'song=null key=null',
            'lyrics=null | song=null key=null',
            'cover=null key=null',
            'audio=null key=null',
            'queue=[] key=null',
        ]);
        expect(refs.currentSongRef.current).toBeNull();
    });
});

describe('the PlayerCap mirror and the current song', () => {
    it('records the song\'s key, as every other route does', () => {
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        useStageSettingsStore.setState({ enablePlayerCapStage: true });
        env.playerCap = {
            track: { title: 'Cap', name: 'Cap', artist: 'Band', coverUrl: 'https://cap.test/c.jpg' }, lyrics: null,
            activePlayer: 'player', clock: { durationSec: 10 }, connectionStatus: 'connected', playerState: 'playing',
        };
        const { refs, watch } = mount();
        // The effect that copies the PlayerCap track into the player: the only one that names this ref.
        const mirror = env.effects.filter(effect => String(effect).includes('playerCapSongKeyRef'));
        expect(mirror).toHaveLength(1);

        mirror[0]();

        expect(watch.take()).toEqual([
            'song=Cap key=stage:Cap|Cap|Band',
            'cover=https://cap.test/c.jpg key=stage:Cap|Cap|Band',
            'audio=null key=stage:Cap|Cap|Band',
            'queue=[] key=stage:Cap|Cap|Band',
            'lyrics=null | song=Cap key=stage:Cap|Cap|Band',
        ]);
        expect(refs.currentSongRef.current).toBe('stage:Cap|Cap|Band');
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: -2, sourceRef: { kind: 'stage', mediaId: 'Cap|Cap|Band' } });
    });
});
