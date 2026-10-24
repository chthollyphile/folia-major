import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineLyricsState, UnifiedSong } from '@/types';

// test/unit/playback/currentSongPlaySong.test.ts
// Pins what playSong writes for an online song, and in which order: the key of the song the player
// was asked for moves BEFORE the wait for the stored lyrics state, the store shows the song AFTER
// it, and later work of an overtaken play drops out when it compares its own key with that one.
// The hook runs without a renderer: React's hooks are replaced by plain stand-ins, the store is
// the real one, and the services that would wait on a network or a database are stubs that say
// when they were called. No request leaves the test.
// The second half pins the audio address of an online song: where it comes from, what happens to
// the blob URL of the song before, when the address counts as fetched, the cover, and what an
// address that cannot be had leaves behind.

const env = vi.hoisted(() => ({
    note: (_label: string) => {},
    lyricsStateFor: new Map<string, Promise<unknown>>(),
    /** Song ids whose audio address is held until the promise resolves. */
    audioGate: new Map<string, Promise<unknown>>(),
    /** An installed `beforePlay` hook that answers when this resolves, or none. */
    beforePlay: null as Promise<unknown> | null,
    detail: (_label: string) => {},
    /** What the audio source answers for a song id; a plain http address when nothing is set. */
    audioResultFor: new Map<string, unknown>(),
    prefetchedFor: new Map<string, unknown>(),
    coverFor: new Map<string, string>(),
    /** Song ids whose lyric load is held until the promise resolves. */
    lyricsGate: new Map<string, Promise<unknown>>(),
    /** How often a load that ended without lyrics asked a mod for some. */
    emptyLoadsSupplied: 0,
    lyricCallbacks: new Map<string, {
        isCurrent: () => boolean;
        onPureMusicChange: (isPureMusic: boolean) => void;
        onStateChange: (state: unknown) => void;
    }>(),
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
vi.mock('@/services/hostExtensionHooks', () => ({
    hasBeforePlayHook: () => Boolean(env.beforePlay),
    runBeforePlayHook: async (song: unknown) => { env.note('wait before-play hook'); await env.beforePlay; return song; },
    lyricsForNoLyrics: () => { env.emptyLoadsSupplied += 1; return null; },
    // A play that fails tells the extensions (Folium playback.failed); nothing listens here.
    notifyPlaybackFailed: () => undefined,
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => true, getProviderLabel: (id: string) => id } }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: () => false }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: async (song: { id: string }) => { env.note(`wait cover ${song.id}`); return env.coverFor.get(song.id) ?? null; },
}));
vi.mock('@/services/prefetchService', () => ({
    getPrefetchedData: (song: { id: string }) => env.prefetchedFor.get(song.id) ?? null,
    prefetchNearbySongs: vi.fn(),
    clearPrefetchRuntime: vi.fn(),
}));
vi.mock('@/services/automix/profileService', () => ({ clearTrackProfileRuntime: vi.fn() }));
// The saved session, as the emptying of the player forgets it.
vi.mock('@/services/db', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/db')>(),
    removeFromCache: vi.fn(async () => undefined),
}));
// The real hand-over of blob URLs, with a line for each call.
vi.mock('@/services/playbackBlobUrls', async importOriginal => {
    const real = await importOriginal<typeof import('@/services/playbackBlobUrls')>();
    return { retireBlobUrl: (url: string | null) => { env.detail(`retire ${url}`); real.retireBlobUrl(url); } };
});
vi.mock('@/services/onlinePlayback', () => ({
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
    loadOnlineSongAudioSource: async (song: { id: string }, _quality: unknown, prefetched: unknown) => {
        env.note(`wait audio source ${song.id}${prefetched ? ' (with what was prefetched)' : ''}`);
        await env.audioGate.get(song.id);
        return env.audioResultFor.get(song.id) ?? { kind: 'ok', audioSrc: `https://audio.test/${song.id}` };
    },
    loadOnlineSongLyrics: async (song: { id: string }, _prefetched: unknown, _userId: unknown, callbacks: never) => {
        env.note(`wait lyrics ${song.id}`);
        env.lyricCallbacks.set(song.id, callbacks);
        await env.lyricsGate.get(song.id);
    },
}));
vi.mock('@/utils/onlineLyricsState', () => ({
    loadOnlineLyricsState: (song: { id: string }) => {
        env.note(`wait lyrics state ${song.id}`);
        return env.lyricsStateFor.get(song.id) ?? Promise.resolve(null);
    },
}));

const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { retireBlobUrl } = await import('@/services/playbackBlobUrls');
const { makeSongCurrent } = await import('@/components/app/playback/currentSong');
const { emptyPlayerForProviderChange } = await import('@/library/app/createLibraryAccountPort');
const { removeFromCache } = await import('@/services/db');
const { resetPlaybackStore, watchCurrentSong } = await import('./currentSongWatch');
const { onlineFailureOf } = await import('@/services/onlineMusic/failure/onlineFailureCase');
const unavailable = (caseId: 'sign-in-needed' | 'no-audio') => ({
    kind: 'unavailable', failure: onlineFailureOf({ operation: 'audio', providerId: 'bodian' }, { detail: { case: caseId } }),
});

const [songA, songB]: UnifiedSong[] = ['1', '2'].map(id => ({
    id, name: id === '1' ? 'A' : 'B', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
}));
const keyA = 'online:bodian:1';
const keyB = 'online:bodian:2';

beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    env.lyricsStateFor.clear();
    env.audioGate.clear();
    env.beforePlay = null;
    env.lyricCallbacks.clear();
    env.lyricsGate.clear();
    env.emptyLoadsSupplied = 0;
    env.audioResultFor.clear();
    env.prefetchedFor.clear();
    env.coverFor.clear();
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    env.note = () => {};
    env.detail = () => {};
    vi.restoreAllMocks();
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

function mount({ address = false } = {}) {
    const refs = usePlaybackRuntimeRefs();
    const watch = watchCurrentSong(refs.currentSongRef, address ? refs : undefined);
    env.note = watch.note;
    env.detail = watch.detail;
    const interruptStage = vi.fn();
    const queue = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        setLyrics: (lyrics: unknown) => watch.note(`lyrics=${lyrics ? 'set' : 'null'}`),
        setIsLyricsLoading: vi.fn(),
        navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache: vi.fn(async () => undefined),
        restoreCachedThemeForSong: vi.fn(async () => { watch.note('wait theme'); }),
        interruptStagePlaybackForMainTransition: interruptStage,
        audioRef: refs.audioRef,
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        mainPlaybackSnapshotRef: { current: null },
        playbackAutoSkipCountRef: refs.playbackAutoSkipCountRef,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
    } as never);
    return { refs, watch, queue, interruptStage };
}

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

describe('playSong and the current song (online)', () => {
    it('lets a mod supply lyrics when a load that found none ends, only for the song still asked for', async () => {
        const { queue } = mount();
        const lyricsA = deferred<void>();
        env.lyricsGate.set('1', lyricsA.promise);
        const playA = queue.playSong(songA, [songA, songB]);
        await vi.waitFor(() => expect(env.lyricCallbacks.has('1')).toBe(true));

        await queue.playSong(songB, [songA, songB]);
        expect(env.emptyLoadsSupplied).toBe(1);

        // A's load ends after B was asked for: nothing is supplied for A.
        lyricsA.resolve();
        await playA;
        expect(env.emptyLoadsSupplied).toBe(1);
    });

    it('asks for the song before it waits for the lyrics state, and shows it after', async () => {
        const { refs, watch, queue } = mount();
        await queue.playSong(songA, [songA, songB]);
        watch.take();

        await queue.playSong(songB, [songA, songB]);

        expect(watch.take()).toEqual([
            `wait audio source 2 | song=A key=${keyA}`,
            // The key has moved; the store still shows the song before.
            `wait lyrics state 2 | song=A key=${keyB}`,
            `lyrics=null | song=A key=${keyB}`,
            `song=B key=${keyB}`,
            `cover=null key=${keyB}`,
            `audio=null key=${keyB}`,
            `queue=[A,B] key=${keyB}`,
            `wait cover 2 | song=B key=${keyB}`,
            `audio=https://audio.test/2 key=${keyB}`,
            `wait lyrics 2 | song=B key=${keyB}`,
            `wait theme | song=B key=${keyB}`,
        ]);
        expect(refs.currentSongRef.current).toBe(keyB);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '2', onlineLyricsState: undefined });
        // What the lyric loader was given to ask "is this still my song".
        expect(env.lyricCallbacks.get('1')?.isCurrent()).toBe(false);
        expect(env.lyricCallbacks.get('2')?.isCurrent()).toBe(true);
    });

    it('writes nothing more for a play that was overtaken while it waited for the lyrics state', async () => {
        const { refs, watch, queue } = mount();
        const stateA = deferred<OnlineLyricsState | null>();
        const stateB = deferred<OnlineLyricsState | null>();
        env.lyricsStateFor.set('1', stateA.promise);
        env.lyricsStateFor.set('2', stateB.promise);

        const playA = queue.playSong(songA, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait lyrics state 1'));
        const playB = queue.playSong(songB, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait lyrics state 2'));
        watch.take();

        stateA.resolve(null);
        await playA;
        // B is the latest play, so A stops here: A is not shown, and it writes no queue and no audio source.
        expect(watch.take()).toEqual([]);

        stateB.resolve(null);
        await playB;
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('https://audio.test/2');
        expect(refs.currentSongRef.current).toBe(keyB);
    });

    it('puts the key back on the song that is shown when it gives up for a newer play that asks for no song', async () => {
        const { refs, watch, queue } = mount();
        await queue.playSong(songA, [songA, songB]);
        const stateB = deferred<OnlineLyricsState | null>();
        env.lyricsStateFor.set('2', stateB.promise);
        const playB = queue.playSong(songB, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait lyrics state 2'));
        expect(refs.currentSongRef.current).toBe(keyB);

        // A newer play that ends before it asks for its song: a local file whose record is gone.
        await queue.playSong({ ...songA, id: 'gone', name: 'Gone', isLocal: true, localRef: { songId: 'gone' }, sourceRef: undefined } as never);
        watch.take();
        stateB.resolve(null);
        await playB;

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: '1' });
        // B is never shown, so the key does not stay on it: A's recovery and lyric loader go on.
        expect(refs.currentSongRef.current).toBe(keyA);
        expect(env.lyricCallbacks.get('1')?.isCurrent()).toBe(true);
    });

    it('patches the song from the lyric loader without moving the key, and never onto another song', async () => {
        const { refs, watch, queue } = mount();
        await queue.playSong(songA, [songA, songB]);
        await queue.playSong(songB, [songA, songB]);
        watch.take();

        // A's loader answers late: the store is on B, so nothing changes.
        env.lyricCallbacks.get('1')?.onPureMusicChange(true);
        env.lyricCallbacks.get('2')?.onStateChange({ lyricsSource: 'imported' });

        expect(watch.take()).toEqual([`song~B key=${keyB}`, `song~B key=${keyB}`]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({
            id: '2', onlineLyricsState: { lyricsSource: 'imported' },
        });
        expect(usePlaybackStore.getState().currentSong?.isPureMusic).toBeUndefined();
        expect(refs.currentSongRef.current).toBe(keyB);
    });

    // What a provider switch, or a sign-out of the active provider, does to the player.
    const emptyThePlayer = (refs: ReturnType<typeof mount>['refs']) => emptyPlayerForProviderChange({
        automixRef: { current: null },
        audioRef: refs.audioRef,
        shouldAutoPlay: refs.shouldAutoPlay,
        setLyrics: () => {},
        setIsLyricsLoading: () => {},
    }, 'bodian');

    it('writes nothing when the player was emptied while the play waited for the before-play hook', async () => {
        const { refs, watch, queue, interruptStage } = mount();
        const hook = deferred<void>();
        env.beforePlay = hook.promise;

        const play = queue.playSong(songA, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait before-play hook'));
        emptyThePlayer(refs);
        watch.take();

        hook.resolve();
        await play;

        // It stops before its first step after the hook.
        expect(interruptStage).not.toHaveBeenCalled();
        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
    });

    it('writes nothing when the player was emptied while the play was still fetching its address', async () => {
        const { refs, watch, queue } = mount();
        const address = deferred<void>();
        env.audioGate.set('1', address.promise);

        const play = queue.playSong(songA, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait audio source 1'));
        emptyThePlayer(refs);
        watch.take();

        address.resolve();
        await play;

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
        expect(refs.currentSongRef.current).toBeNull();
    });

    it('writes nothing when the player was emptied while the play waited for the lyrics state', async () => {
        const { refs, watch, queue } = mount();
        const stateA = deferred<OnlineLyricsState | null>();
        env.lyricsStateFor.set('1', stateA.promise);

        const play = queue.playSong(songA, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait lyrics state 1'));
        emptyThePlayer(refs);
        watch.take();

        stateA.resolve(null);
        await play;

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
        expect(refs.currentSongRef.current).toBeNull();
    });

    it('forgets the saved song and queue, so the next launch brings nothing back', () => {
        const { refs } = mount();
        vi.mocked(removeFromCache).mockClear();
        emptyThePlayer(refs);
        expect(vi.mocked(removeFromCache).mock.calls.map(([key]) => key).sort()).toEqual(['last_queue', 'last_song']);
    });
});

describe('playSong and the audio address (online)', () => {
    const copyOf = (id: string) => ({ kind: 'ok', audioSrc: `blob:copy-${id}`, blobUrl: `blob:copy-${id}` });
    const status = () => useStatusMessageStore.getState().message;

    beforeEach(() => {
        // Empties the list of blob URLs handed over by an earlier test.
        retireBlobUrl(null);
        vi.spyOn(Date, 'now').mockReturnValue(5000);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
    });

    it('a fresh http address: the blob URL of the song before is handed over and not revoked, and the address counts as fetched now', async () => {
        const { refs, watch, queue } = mount({ address: true });
        env.audioResultFor.set('1', copyOf('1'));
        await queue.playSong(songA, [songA, songB]);
        refs.pendingResumeTimeRef.current = 42;
        refs.lastAudioRecoverySourceRef.current = 'https://audio.test/failed';
        watch.take();

        await queue.playSong(songB, [songA, songB]);

        expect(watch.take()).toEqual([
            `wait audio source 2 | song=A key=${keyA}`,
            `wait lyrics state 2 | song=A key=${keyB}`,
            `lyrics=null | song=A key=${keyB}`,
            `song=B key=${keyB}`,
            `cover=null key=${keyB}`,
            // The address is cleared first; A's blob URL is still the one to hand over.
            `audio=null key=${keyB} blobRef=blob:copy-1 fetchedAt=null`,
            'retire blob:copy-1',
            `queue=[A,B] key=${keyB}`,
            `wait cover 2 | song=B key=${keyB}`,
            `audio=https://audio.test/2 key=${keyB} blobRef=null fetchedAt=5000`,
            `wait lyrics 2 | song=B key=${keyB}`,
            `wait theme | song=B key=${keyB}`,
        ]);
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(refs.lastAudioRecoverySourceRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(true);
    });

    it('a copy from the media cache: its blob URL is the one to hand over next, and it has no fetch time', async () => {
        const { refs, watch, queue } = mount({ address: true });
        env.audioResultFor.set('2', copyOf('2'));
        await queue.playSong(songA, [songA, songB]);
        expect(refs.currentOnlineAudioUrlFetchedAtRef.current).toBe(5000);
        watch.take();

        await queue.playSong(songB, [songA, songB]);

        expect(watch.take().filter(line => line.startsWith('audio') || line.startsWith('retire') || line.startsWith('revoke'))).toEqual([
            `audio=null key=${keyB} blobRef=null fetchedAt=null`,
            'retire null',
            `audio=blob:copy-2 key=${keyB} blobRef=blob:copy-2 fetchedAt=null`,
        ]);
    });

    it('a prefetched address keeps the time it was prefetched at, and the prefetched cover is used when none is cached', async () => {
        const { watch, queue } = mount({ address: true });
        env.prefetchedFor.set('1', { audioUrl: 'https://audio.test/1', audioUrlFetchedAt: 1234, coverUrl: 'https://cover.test/prefetched-1' });
        env.prefetchedFor.set('2', { audioUrl: 'https://audio.test/2', audioUrlFetchedAt: 2345, coverUrl: 'https://cover.test/prefetched-2' });
        env.coverFor.set('2', 'blob:cached-cover-2');

        await queue.playSong(songA, [songA, songB]);
        await queue.playSong(songB, [songA, songB]);

        expect(watch.take().filter(line => /^(audio=h|cover=\S+:|wait audio)/.test(line))).toEqual([
            'wait audio source 1 (with what was prefetched) | song=null key=null',
            `cover=https://cover.test/prefetched-1 key=${keyA}`,
            `audio=https://audio.test/1 key=${keyA} blobRef=null fetchedAt=1234`,
            `wait audio source 2 (with what was prefetched) | song=A key=${keyA}`,
            `cover=blob:cached-cover-2 key=${keyB}`,
            `audio=https://audio.test/2 key=${keyB} blobRef=null fetchedAt=2345`,
        ]);
    });

    it('an address that is neither a blob nor http has no fetch time', async () => {
        const { watch, queue } = mount({ address: true });
        env.audioResultFor.set('1', { kind: 'ok', audioSrc: 'folia-ytm://audio/1?k=one' });

        await queue.playSong(songA, [songA]);

        expect(watch.take().filter(line => line.startsWith('audio=f'))).toEqual([
            `audio=folia-ytm://audio/1?k=one key=${keyA} blobRef=null fetchedAt=null`,
        ]);
    });

    it('a play overtaken while it fetched a copy revokes that copy at once and writes nothing', async () => {
        const { watch, queue } = mount({ address: true });
        const address = deferred<void>();
        env.audioGate.set('1', address.promise);
        env.audioResultFor.set('1', copyOf('1'));

        const playA = queue.playSong(songA, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait audio source 1'));
        await queue.playSong(songB, [songA, songB]);
        watch.take();

        address.resolve();
        await playA;

        expect(watch.take()).toEqual(['revoke blob:copy-1']);
        expect(usePlaybackStore.getState().audioSrc).toBe('https://audio.test/2');
    });

    it('a play that gives up after asking leaves the intent to play, the time to resume at and the fetch time to the song the key goes back to, and gives its copy back', async () => {
        const { refs, watch, queue } = mount({ address: true });
        await queue.playSong(songA, [songA, songB]);
        // A is paused, was recovered once, and its address counts as fetched.
        refs.shouldAutoPlay.current = false;
        refs.pendingResumeTimeRef.current = 42;
        refs.lastAudioRecoverySourceRef.current = 'https://audio.test/failed';
        expect(refs.currentOnlineAudioUrlFetchedAtRef.current).toBe(5000);
        env.audioResultFor.set('2', copyOf('2'));
        const stateB = deferred<OnlineLyricsState | null>();
        env.lyricsStateFor.set('2', stateB.promise);
        const playB = queue.playSong(songB, [songA, songB]);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait lyrics state 2'));
        // A newer play that ends before it asks for its song: a local file whose record is gone.
        await queue.playSong({ ...songA, id: 'gone', name: 'Gone', isLocal: true, localRef: { songId: 'gone' }, sourceRef: undefined } as never);
        watch.take();

        stateB.resolve(null);
        await playB;

        expect(watch.take()).toEqual(['revoke blob:copy-2']);
        expect(refs.currentSongRef.current).toBe(keyA);
        expect([
            refs.shouldAutoPlay.current, refs.pendingResumeTimeRef.current,
            refs.lastAudioRecoverySourceRef.current, refs.currentOnlineAudioUrlFetchedAtRef.current,
        ]).toEqual([false, 42, 'https://audio.test/failed', 5000]);
    });

    it('a play overtaken while it read the cached cover gives its copy back', async () => {
        const { refs, watch, queue } = mount({ address: true });
        env.audioResultFor.set('2', copyOf('2'));
        const note = env.note;
        // Another song is asked for while B reads its cover, after B was shown.
        env.note = label => {
            note(label);
            if (label.startsWith('wait cover 2')) makeSongCurrent(songA);
        };

        await queue.playSong(songB, [songA, songB]);

        expect(watch.take().filter(line => /^(audio=b|revoke)/.test(line))).toEqual(['revoke blob:copy-2']);
        expect(refs.blobUrlRef.current).toBeNull();
    });

    it('an address refused for a reason the listener must act on: no song, no address, no autoplay, and the reason is said', async () => {
        const { refs, watch, queue } = mount({ address: true });
        env.audioResultFor.set('1', unavailable('sign-in-needed'));
        refs.shouldAutoPlay.current = true;

        await queue.playSong(songA, [songA, songB]);

        expect(watch.take()).toEqual(['wait audio source 1 | song=null key=null']);
        expect(status()).toMatchObject({ type: 'error', text: 'failure.signInNeeded', providerId: 'bodian' });
        expect(refs.shouldAutoPlay.current).toBe(false);
    });

    it('an address that cannot be had: with no song to skip to it says so, with one it asks before skipping', async () => {
        const { watch, queue } = mount({ address: true });
        env.audioResultFor.set('1', unavailable('no-audio'));

        await queue.playSong(songA, [songA]);
        expect(status()).toMatchObject({ type: 'error', text: 'failure.noAudio' });

        await queue.playSong(songA, [songA, songB]);
        expect(status()).toMatchObject({ type: 'error', text: 'failure.noAudio', countdown: { text: 'failure.skipCountdown' }, persistent: true });
        expect(watch.take().filter(line => !line.startsWith('wait audio source 1'))).toEqual([]);
    });
});
