import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';

// test/unit/playback/queueReplaceRaces.test.ts
// Pins what the queue controller leaves of a whole-queue write (a mod's folium.playback.replaceQueue, or
// the undo of one) that comes while one of its plays waits: the play lands without writing its old queue
// back, a failure's countdown, retry and other-version dialog act on the queue and Personal FM of the
// moment they are pressed, a play that does not land does not turn FM back on, the FM top-up adds no
// radio songs after the new queue, and a Stage API add fails instead of adding to it. Without a
// whole-queue write everything stays as it was.
// The waits covered include a mod's beforePlay hook (FM as the write left it, a failure puts back what
// the play itself overwrote), a top-up batch that fails, and a skip from a song that never became current.
// The top-up is also pinned against the writes that are not a new queue (an add, an edit in place, a
// copy the store took before this render): it still adds its batch to the queue as it is and steps on,
// and drops only for a play, a mode or a scene that came while it waited.
// Last, which plays count as starting a queue of their own (queueStarts.ts), which the FM mode switch and
// the home scene card wait on: not a step through the queue there is, nor a copy of it.
// Written like currentSongPlaySong.test.ts: the hook runs without a renderer, the store is the real one,
// and the services that wait are stubs held by gates. Unlike there the hook keeps its refs, its state and
// its effects across calls, as React keeps them across renders, so calling it again after a write is the
// render that hands the failure buttons the newest handleNextTrack and playSong.

const env = vi.hoisted(() => {
    const state = {
        /** Song ids whose audio address is held until the promise resolves. */
        audioGate: new Map<string, Promise<unknown>>(),
        /** What the audio source answers for a song id; a plain http address when nothing is set. */
        audioResultFor: new Map<string, unknown>(),
        /** Song ids their platform marks unavailable. */
        unavailable: new Set<string>(),
        /** What the lookup of another version answers for a song id. */
        replacementFor: new Map<string, unknown>(),
        /** The Personal FM batch, held until it resolves. */
        fmBatch: null as Promise<unknown[]> | null,
        /** Holds the Stage API's lookup of a song's details. */
        detailGate: null as Promise<unknown> | null,
        /** An installed `beforePlay` hook (a mod's) that answers when this resolves, or none. */
        beforePlay: null as Promise<unknown> | null,
        effects: [] as Array<() => unknown>,
        slots: [] as Array<{ current: unknown }>,
        slotAt: 0,
        rendering: false,
    };
    /** The nth ref or state of every render of the hook is the same one, as React keeps it. */
    const slot = (initial: unknown) => {
        if (!state.rendering) return { current: initial };
        const at = state.slotAt;
        state.slotAt += 1;
        state.slots[at] ??= { current: initial };
        return state.slots[at];
    };
    return { self: state, slot };
});

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => env.slot(current),
    useState: (initial: unknown) => {
        const held = env.slot(initial);
        const set = (next: unknown) => {
            held.current = typeof next === 'function' ? (next as (previous: unknown) => unknown)(held.current) : next;
        };
        return [held.current, set];
    },
    useEffect: (effect: () => unknown) => {
        if (env.self.rendering) env.self.effects.push(effect);
    },
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
    hasBeforePlayHook: () => Boolean(env.self.beforePlay),
    runBeforePlayHook: async (song: unknown) => { await env.self.beforePlay; return song; },
    lyricsForNoLyrics: () => null,
    notifyPlaybackFailed: () => undefined,
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        canPlaySong: () => true,
        getProviderLabel: (id: string) => id,
        getPersonalFm: () => env.self.fmBatch ?? Promise.resolve([]),
        getSongReplacement: async (song: { id: string }) => env.self.replacementFor.get(String(song.id)) ?? null,
        getSongDetail: async (_providerId: string, id: number) => {
            await env.self.detailGate;
            return { id: `d${id}`, name: `D${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000, sourceRef: { kind: 'online', providerId: 'bodian', mediaId: `d${id}` } };
        },
    },
}));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null,
    isSongUnavailable: (song: { id: unknown } | null | undefined) => Boolean(song && env.self.unavailable.has(String(song.id))),
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => null,
    getCachedSongCoverUrl: async () => null,
}));
const prefetch = vi.hoisted(() => ({
    prefetchNearbySongs: vi.fn(),
    refreshPrefetchAfterQueueEdit: vi.fn(),
    invalidateAndRefetch: vi.fn(),
}));
vi.mock('@/services/prefetchService', () => ({
    getPrefetchedData: () => null,
    clearPrefetchRuntime: vi.fn(),
    ...prefetch,
}));
vi.mock('@/services/onlinePlayback', () => ({
    // A copy, as a song that took its replay gain is: the landing has a new object to put in the queue.
    applyOnlineAudioSourceMetadata: (song: object) => ({ ...song }),
    loadOnlineSongAudioSource: async (song: { id: string }) => {
        await env.self.audioGate.get(String(song.id));
        return env.self.audioResultFor.get(String(song.id)) ?? { kind: 'ok', audioSrc: `https://audio.test/${song.id}` };
    },
    loadOnlineSongLyrics: async () => {},
}));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: async () => null }));

const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { replacePlayQueue, setIsFmMode, setPlayQueue, usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { makeSongCurrent } = await import('@/components/app/playback/currentSong');
const { noteWholeQueueWrite } = await import('@/services/wholeQueueWrites');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');
const { resetPlaybackStore } = await import('./currentSongWatch');
const { onlineFailureOf } = await import('@/services/onlineMusic/failure/onlineFailureCase');
const { usePersonalFmModeStore } = await import('@/stores/usePersonalFmModeStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { queueStartsSoFar } = await import('@/components/app/playback/start/queueStarts');

const online = (id: string): SongResult => ({
    id, name: id.toUpperCase(), artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const unavailable = (caseId: 'no-audio' | 'unknown' | 'sign-in-needed') => ({
    kind: 'unavailable', failure: onlineFailureOf({ operation: 'audio', providerId: 'bodian' }, { detail: { case: caseId } }),
});
const [a, b, c] = ['a', 'b', 'c'].map(online);
const [x, y] = ['x', 'y'].map(online);
const [f1, f2, f3] = ['f1', 'f2', 'f3'].map(online);
const [p1, p2] = ['p1', 'p2'].map(online);

const deferred = <T = void,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const keys = (queue: readonly SongResult[]) => queue.map(getPlaybackSongKey);
const store = () => usePlaybackStore.getState();
const status = () => useStatusMessageStore.getState().message;

/** A whole-queue write, as replaceQueue and its undo make it: counted, then one store update with FM. */
const replaceWhole = (queue: SongResult[], isFmMode = false) => {
    noteWholeQueueWrite();
    replacePlayQueue(queue, isFmMode);
};

/** Holds the audio address of `song` until the returned function is called. */
const holdAddress = (song: SongResult) => {
    const gate = deferred();
    env.self.audioGate.set(String(song.id), gate.promise);
    return gate.resolve;
};

/** The player with `queue` in the store and `current` shown, Personal FM as given. */
const playerWith = (queue: SongResult[], current: SongResult | null, isFmMode = false) => {
    setPlayQueue(queue);
    setIsFmMode(isFmMode);
    makeSongCurrent(current);
};

beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    env.self.audioGate.clear();
    env.self.audioResultFor.clear();
    env.self.unavailable.clear();
    env.self.replacementFor.clear();
    env.self.fmBatch = null;
    env.self.detailGate = null;
    env.self.beforePlay = null;
    env.self.effects.length = 0;
    env.self.slots.length = 0;
    Object.values(prefetch).forEach(fn => fn.mockClear());
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    vi.restoreAllMocks();
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

function mount() {
    const refs = usePlaybackRuntimeRefs();
    const persistLastPlaybackCache = vi.fn(async (_song: SongResult | null, _queue: SongResult[]) => undefined);
    const params = {
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache,
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
    };
    /** One render of the hook: its closures read the stores as they are now. */
    const render = () => {
        env.self.rendering = true;
        env.self.slotAt = 0;
        env.self.effects.length = 0;
        try {
            return usePlaybackQueueController(params as never);
        } finally {
            env.self.rendering = false;
        }
    };
    const queue = render();
    return { queue, render, persistLastPlaybackCache };
}

describe('a play that lands after the queue was replaced whole', () => {
    it('swaps itself into the new queue when that queue holds it, and saves and fetches around the new queue', async () => {
        playerWith([a, b, c], a);
        const { queue, persistLastPlaybackCache } = mount();
        const release = holdAddress(b);
        const play = queue.playSong(b, store().playQueue);
        await settle();

        const replaced = [x, { ...b }, y];
        replaceWhole(replaced);
        release();
        await play;

        // Only B's entry is new (the copy the play resolved); X and Y are the mod's own objects.
        const landed = store().playQueue;
        expect(keys(landed)).toEqual(keys(replaced));
        expect(landed[0]).toBe(x);
        expect(landed[2]).toBe(y);
        expect(landed[1]).not.toBe(replaced[1]);
        expect(store().currentSong).toMatchObject({ id: 'b' });
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), landed);
        expect(prefetch.prefetchNearbySongs).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), landed, expect.anything(), undefined);
    });

    it('leaves the new queue as it is when that queue does not hold it', async () => {
        playerWith([a, b, c], a);
        const { queue, persistLastPlaybackCache } = mount();
        const release = holdAddress(b);
        const play = queue.playSong(b, store().playQueue);
        await settle();

        const replaced = [x, y];
        replaceWhole(replaced);
        release();
        await play;

        expect(store().playQueue).toBe(replaced);
        expect(store().currentSong).toMatchObject({ id: 'b' });
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), replaced);
        expect(prefetch.prefetchNearbySongs).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), replaced, expect.anything(), undefined);
    });

    it.each([
        ['the queue panel\'s display copy', (queue: SongResult[]) => queue.map(song => ({ ...song }))],
        ['the Stage API\'s select', (queue: SongResult[]) => [...queue]],
    ])('treats %s like the store\'s queue', async (_caller, copyOf) => {
        playerWith([a, b, c], a);
        const { queue } = mount();
        const release = holdAddress(b);
        const play = queue.playSong(b, copyOf(store().playQueue));
        await settle();

        const replaced = [x, y];
        replaceWhole(replaced);
        release();
        await play;

        expect(store().playQueue).toBe(replaced);
    });

    it('a list of its own (a playlist\'s songs) still writes that list: the user played it', async () => {
        playerWith([a, b, c], a);
        const { queue } = mount();
        const release = holdAddress(p1);
        const play = queue.playSong(p1, [p1, p2]);
        await settle();

        replaceWhole([x, y]);
        release();
        await play;

        expect(keys(store().playQueue)).toEqual(keys([p1, p2]));
    });

    it('without a whole-queue write nothing changes: the play writes the queue it was given, over an edit made meanwhile', async () => {
        playerWith([a, b, c], a);
        const { queue, persistLastPlaybackCache } = mount();
        const release = holdAddress(b);
        const play = queue.playSong(b, store().playQueue);
        await settle();

        // A plain edit, not a whole-queue write: the play's queue wins, as it always did.
        setPlayQueue([a, b]);
        release();
        await play;

        expect(keys(store().playQueue)).toEqual(keys([a, b, c]));
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), store().playQueue);
        expect(prefetch.prefetchNearbySongs).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), store().playQueue, expect.anything(), undefined);
    });
});

describe('Personal FM and a play that does not land', () => {
    it('is not turned back on by a play that fails after the queue was replaced whole', async () => {
        // FM plays; the user picks a playlist song, which leaves FM, and its address is refused.
        playerWith([f1, f2, f3], f1, true);
        const { queue } = mount();
        env.self.audioResultFor.set('p1', unavailable('sign-in-needed'));
        const release = holdAddress(p1);
        const play = queue.playSong(p1, [p1, p2], false);
        await settle();
        expect(store().isFmMode).toBe(false);

        replaceWhole([x, y]);
        release();
        await play;

        // Without the write the failed play would put FM back on; the replacement ended it.
        expect(store().isFmMode).toBe(false);
        expect(store().playQueue).toEqual([x, y]);
    });

    it('is not handed to a later play that does not land either', async () => {
        playerWith([f1, f2, f3], f1, true);
        const { queue } = mount();
        // The first play waits; it keeps "FM was on" for whichever play lands.
        const releaseFirst = holdAddress(p1);
        const first = queue.playSong(p1, [p1, p2], false);
        await settle();

        replaceWhole([x, y]);
        // A play started after the write that fails at once.
        env.self.audioResultFor.set('x', unavailable('sign-in-needed'));
        await queue.playSong(x, store().playQueue, false);
        expect(store().isFmMode).toBe(false);

        releaseFirst();
        await first;
        expect(store().isFmMode).toBe(false);
    });

    it('an FM play from the queue that waited for a mod\'s beforePlay hook while the queue was replaced does not turn FM back on', async () => {
        playerWith([f1, f2, f3], f1, true);
        const { queue } = mount();
        const hook = deferred();
        env.self.beforePlay = hook.promise;
        const play = queue.playSong(f2, store().playQueue, true);
        await settle();

        const replaced = [x, y];
        replaceWhole(replaced);
        hook.resolve();
        await play;

        // The song plays on outside the new queue; FM stays as the replacement left it.
        expect(store().currentSong).toMatchObject({ id: 'f2' });
        expect(store().isFmMode).toBe(false);
        expect(store().playQueue).toBe(replaced);
    });

    it('nor does one that waited for the hook and then fails', async () => {
        playerWith([f1, f2, f3], f1, true);
        const { queue } = mount();
        env.self.audioResultFor.set('f2', unavailable('sign-in-needed'));
        const hook = deferred();
        env.self.beforePlay = hook.promise;
        const play = queue.playSong(f2, store().playQueue, true);
        await settle();

        replaceWhole([x, y]);
        hook.resolve();
        await play;

        expect(store().isFmMode).toBe(false);
        expect(keys(store().playQueue)).toEqual(keys([x, y]));
    });

    it('a play that does not land puts FM back as it was when the play wrote it, a replacement during the hook\'s wait included', async () => {
        // Personal FM started with a batch of its own (a list the store does not hold): after the hook it
        // still turns FM on, as the user asked, over the replacement during the wait. Its address is refused.
        playerWith([a, b, c], a);
        const { queue } = mount();
        env.self.audioResultFor.set('f1', unavailable('sign-in-needed'));
        const hook = deferred();
        env.self.beforePlay = hook.promise;
        const play = queue.playSong(f1, [f1, f2], true);
        await settle();

        const replaced = [x, y];
        replaceWhole(replaced);
        hook.resolve();
        await play;

        // Nothing landed: FM goes back off, as the replacement had left it, under the queue the play never wrote.
        expect(store().isFmMode).toBe(false);
        expect(store().playQueue).toBe(replaced);
    });
});

describe('the failure buttons after the queue was replaced whole', () => {
    it('the skip after the countdown plays the new queue\'s first song, with FM still off and nothing of the old queue put in', async () => {
        playerWith([f1, f2, f3], f1, true);
        const { queue, render } = mount();
        env.self.audioResultFor.set('f2', unavailable('no-audio'));
        await queue.playSong(f2, store().playQueue, true);
        expect(status()).toMatchObject({ text: 'failure.noAudio', countdown: expect.anything() });

        const replaced = [x, y];
        replaceWhole(replaced);
        render();
        status()?.onAction?.();
        await settle();

        expect(store().currentSong).toMatchObject({ id: 'x' });
        expect(store().isFmMode).toBe(false);
        expect(keys(store().playQueue)).toEqual(keys(replaced));
    });

    it('the skip after the countdown starts the new queue also when no song was current yet', async () => {
        // A launch with no session: the first song tried fails before it ever becomes current.
        playerWith([a, b, c], null);
        const { queue, render } = mount();
        env.self.audioResultFor.set('a', unavailable('no-audio'));
        await queue.playSong(a, store().playQueue);
        expect(status()).toMatchObject({ text: 'failure.noAudio', countdown: expect.anything() });

        const replaced = [x, y];
        replaceWhole(replaced);
        render();
        status()?.onAction?.();
        await settle();

        expect(store().currentSong).toMatchObject({ id: 'x' });
        expect(keys(store().playQueue)).toEqual(keys(replaced));
    });

    it('without a whole-queue write that skip plays the next song of the queue it was given, as before', async () => {
        playerWith([a, b, c], null);
        const { queue, render } = mount();
        env.self.audioResultFor.set('a', unavailable('no-audio'));
        await queue.playSong(a, store().playQueue);

        render();
        status()?.onAction?.();
        await settle();

        expect(store().currentSong).toMatchObject({ id: 'b' });
    });

    it('the retry does not turn FM back on', async () => {
        // F3 is the last of the batch: nothing to skip to, so the failure offers a retry.
        playerWith([f1, f2, f3], f2, true);
        const { queue, render } = mount();
        env.self.audioResultFor.set('f3', unavailable('unknown'));
        await queue.playSong(f3, store().playQueue, true);
        expect(status()).toMatchObject({ actionLabel: 'ui.retry' });

        replaceWhole([x, y]);
        render();
        env.self.audioResultFor.delete('f3');
        status()?.onAction?.();
        await settle();

        expect(store().currentSong).toMatchObject({ id: 'f3' });
        expect(store().isFmMode).toBe(false);
        // The song plays again within the new queue; not in it, it goes back in front, as any replay of it does.
        expect(keys(store().playQueue)).toEqual(keys([f3, x, y]));
    });

    it('the other version\'s dialog plays with the queue and FM of the moment it is confirmed, and leaves a queue without the original as it is', async () => {
        playerWith([f1, f2, f3], f1, true);
        const { queue, render } = mount();
        env.self.unavailable.add('f2');
        const other = online('f2-other');
        env.self.replacementFor.set('f2', { song: other, label: 'live' });
        await queue.playSong(f2, store().playQueue, true);

        const replaced = [x, y];
        replaceWhole(replaced);
        const rendered = render();
        expect(rendered.pendingUnavailableReplacement).toMatchObject({ originalSong: f2 });
        await rendered.handleUnavailableReplacementConfirm();

        expect(store().currentSong).toMatchObject({ id: 'f2-other' });
        expect(store().isFmMode).toBe(false);
        expect(store().playQueue).toBe(replaced);
    });

    it('the other version takes the original\'s place when the new queue holds the original', async () => {
        playerWith([a, b, c], a);
        const { queue, render } = mount();
        env.self.unavailable.add('b');
        const other = online('b-other');
        env.self.replacementFor.set('b', { song: other, label: 'live' });
        await queue.playSong(b, store().playQueue);

        replaceWhole([x, b, y]);
        await render().handleUnavailableReplacementConfirm();

        expect(keys(store().playQueue)).toEqual(keys([x, other, y]));
    });
});

describe('the Personal FM top-up', () => {
    it('adds no radio songs after a queue replaced whole while the batch came, and steps through the new queue', async () => {
        playerWith([f1, f2], f1, true);
        const { queue, render } = mount();
        const batch = deferred<unknown[]>();
        env.self.fmBatch = batch.promise;
        const next = queue.handleNextTrack();
        await settle();

        const replaced = [x, y];
        replaceWhole(replaced);
        render();
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys(replaced));
        expect(store().currentSong).toMatchObject({ id: 'x' });
        expect(store().isFmMode).toBe(false);
    });

    it.each([
        ['the second to last', f1],
        ['the last', f2],
    ])('a batch that fails after the queue was replaced whole (on %s song) puts no old FM queue back, and steps through the new queue', async (_where, current) => {
        playerWith([f1, f2], current, true);
        const { queue, render } = mount();
        const batch = deferred<unknown[]>();
        env.self.fmBatch = batch.promise;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const next = queue.handleNextTrack();
        await settle();

        const replaced = [x, y];
        replaceWhole(replaced);
        render();
        batch.reject(new Error('network'));
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys(replaced));
        expect(store().currentSong).toMatchObject({ id: 'x' });
        expect(store().isFmMode).toBe(false);
    });
});

describe('the Personal FM top-up, with writes that are not a new queue', () => {
    type NextOptions = Parameters<ReturnType<typeof mount>['queue']['handleNextTrack']>[0];
    /** FM on air: the next step tops up, and waits for the batch. */
    const topUp = (options: NextOptions = {}) => {
        const { queue, render } = mount();
        const batch = deferred<unknown[]>();
        env.self.fmBatch = batch.promise;
        const next = queue.handleNextTrack({ allowStopOnMissing: true, ...options });
        return { next, batch, render };
    };
    /** Every song of the queue a new object, as a library refresh, a recovery or a restore writes it. */
    const copyInPlace = () => setPlayQueue(previous => previous.map(song => ({ ...song })));

    beforeEach(() => {
        usePersonalFmModeStore.setState({ providerSelections: {} });
    });

    it('without a write adds the batch and plays the next song', async () => {
        playerWith([f1, f2], f1, true);
        const { next, batch } = topUp();
        await settle();
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2, f3]));
        expect(store().currentSong).toMatchObject({ id: 'f2' });
        expect(store().isFmMode).toBe(true);
    });

    it('still adds and steps on after the queue was copied in place while the batch came', async () => {
        playerWith([f1, f2], f1, true);
        const { next, batch } = topUp();
        await settle();
        copyInPlace();
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2, f3]));
        expect(store().currentSong).toMatchObject({ id: 'f2' });
    });

    it('keeps a song the listener added while the batch came, and adds the batch after it', async () => {
        useAudioSettingsStore.setState({ queueAddBehavior: 'append' });
        playerWith([f1, f2], f1, true);
        const { next, batch, render } = topUp();
        await settle();
        render().addOnlineSongToQueue(x);
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2, x, f3]));
        expect(store().currentSong).toMatchObject({ id: 'f2' });
    });

    it('steps on through the queue as it is when the batch fails after an edit in place', async () => {
        playerWith([f1, f2], f1, true);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { next, batch } = topUp();
        await settle();
        copyInPlace();
        batch.reject(new Error('network'));
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2]));
        expect(store().currentSong).toMatchObject({ id: 'f2' });
    });

    it('stops at the end of the last song when the batch fails after an edit in place', async () => {
        playerWith([f1, f2], f2, true);
        usePlaybackStore.getState().setPlayerState(PlayerState.PLAYING);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { next, batch } = topUp();
        await settle();
        copyInPlace();
        batch.reject(new Error('network'));
        await next;
        await settle();

        expect(store().currentSong).toMatchObject({ id: 'f2' });
        expect(store().playerState).toBe(PlayerState.IDLE);
    });

    it('adds to the store\'s queue when this render\'s queue was already an older copy of it', async () => {
        playerWith([f1, f2], f1, true);
        const { queue } = mount();
        // Written after the render, as an edit is before the next render comes.
        copyInPlace();
        const batch = deferred<unknown[]>();
        env.self.fmBatch = batch.promise;
        const next = queue.handleNextTrack({ allowStopOnMissing: true });
        await settle();
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2, f3]));
        expect(store().currentSong).toMatchObject({ id: 'f2' });
    });

    it('steps from a song that never became current (the skip after a failure) with none shown', async () => {
        playerWith([f1, f2], null, true);
        const { next, batch } = topUp({ fromSong: f1 });
        await settle();
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2, f3]));
        expect(store().currentSong).toMatchObject({ id: 'f2' });
    });

    it.each([
        ['mode', { mode: 'FAMILIAR', scene: null }],
        ['scene', { mode: 'SCENE_RCMD', scene: 'night' }],
    ])('drops the batch when the %s changed while it came', async (_what, selection) => {
        playerWith([f1, f2], f1, true);
        const { next, batch } = topUp();
        await settle();
        usePersonalFmModeStore.setState({ providerSelections: { bodian: selection as never } });
        batch.resolve([f3]);
        await next;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([f1, f2]));
        expect(store().currentSong).toMatchObject({ id: 'f1' });
    });

    it('drops the batch when another play started while it came, before that play landed', async () => {
        playerWith([f1, f2], f1, true);
        const { next, batch, render } = topUp();
        await settle();
        const release = holdAddress(p1);
        const other = render().playSong(p1, [p1, p2], true);
        await settle();
        batch.resolve([f3]);
        await next;
        await settle();
        release();
        await other;
        await settle();

        expect(keys(store().playQueue)).toEqual(keys([p1, p2]));
        expect(store().currentSong).toMatchObject({ id: 'p1' });
    });
});

describe('a play that starts a queue of its own', () => {
    /** How many starts `play` counted. */
    const startsOf = async (play: () => Promise<unknown> | void) => {
        const before = queueStartsSoFar();
        await play();
        await settle();
        return queueStartsSoFar() - before;
    };

    it('is counted for a queue the store does not hold, and for Personal FM turned on or off', async () => {
        playerWith([f1, f2, f3], f1, true);
        const { render } = mount();
        expect(await startsOf(() => render().playSong(p1, [p1, p2], true))).toBe(1);
        expect(await startsOf(() => render().playSong(p1, store().playQueue, false))).toBe(1);
    });

    it('is not counted for a step through the queue there is, a copy of it, or the FM top-up', async () => {
        playerWith([f1, f2, f3, x], f1, true);
        const { render } = mount();
        expect(await startsOf(() => render().handleNextTrack())).toBe(0);
        expect(await startsOf(() => render().playSong(f3, store().playQueue.map(song => ({ ...song })), true))).toBe(0);
        expect(await startsOf(() => render().handleNextTrack())).toBe(0);
        expect(store().currentSong).toMatchObject({ id: 'x' });
        env.self.fmBatch = Promise.resolve([y]);
        expect(await startsOf(() => render().handleNextTrack())).toBe(0);
        expect(store().currentSong).toMatchObject({ id: 'y' });
    });
});

describe('a Stage API add', () => {
    it('fails, and adds nothing, when the queue was replaced whole while its songs loaded', async () => {
        playerWith([a, b], a);
        const complete = vi.fn(async () => undefined);
        let onRequest: ((request: unknown) => void) | null = null;
        vi.stubGlobal('window', {
            setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn(),
            electron: {
                onStagePlayerQueueRequest: (handler: (request: unknown) => void) => { onRequest = handler; return () => {}; },
                completeStagePlayerQueueRequest: complete,
            },
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        mount();
        env.self.effects.find(effect => String(effect).includes('onStagePlayerQueueRequest'))?.();
        const details = deferred();
        env.self.detailGate = details.promise;

        onRequest!({ requestId: 'r1', action: 'append', songId: 7 });
        await settle();
        const replaced = [x, y];
        replaceWhole(replaced);
        details.resolve();
        await vi.waitFor(() => expect(complete).toHaveBeenCalled());

        expect(complete).toHaveBeenCalledWith(expect.objectContaining({
            requestId: 'r1', ok: false, error: 'The queue changed while the request was loading.',
        }));
        expect(store().playQueue).toBe(replaced);
    });
});
