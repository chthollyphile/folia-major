import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/playback/queueReplaceLibraryRaces.test.ts
// Pins what a local or Navidrome play leaves of a whole-queue write (a mod's folium.playback.replaceQueue,
// or the undo of one) that comes while it waits: started from the queue (playSong hands the library
// controller the store's queue), it lands without writing that queue back, swapping its song in only
// where the new queue holds it, and saves and fetches around the new queue. A play of a list of its own
// (a click in the local library) still writes its list, and adding a local song to the queue adds it to
// the queue as it is after the add's waits.
// The reloads of the playing local song after its lyrics changed (an upload, a match) land in the queue as
// it is after their own saves and reads, too.
// Written like currentSongLibraryRoutes.test.ts: the hooks run without a renderer, the store is the
// real one, and the library, the file access and the Navidrome server are stubs held by gates.

const env = vi.hoisted(() => ({
    songs: [] as unknown[],
    /** Local song ids whose file reading is held until the promise resolves. */
    fileGate: new Map<string, Promise<unknown>>(),
    /** Holds the preparing of a local song's cover asset. */
    coverAssetGate: null as Promise<unknown> | null,
    /** Holds the reading of a Navidrome song's match data. */
    matchCacheGate: null as Promise<unknown> | null,
    /** Holds the saving of a local song's record (new lyrics). */
    saveGate: null as Promise<unknown> | null,
    /** Holds the reading of the local library's records. */
    listGate: null as Promise<unknown> | null,
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
vi.mock('@/services/db', () => ({
    getFromCache: async () => null,
    saveToCache: async () => {},
    removeFromCache: async () => {},
    getLocalSongs: async () => { await env.listGate; return env.songs; },
    getLocalSong: async (id: string) => (env.songs as Array<{ id: string }>).find(song => song.id === id) ?? null,
    saveLocalSong: async () => { await env.saveGate; },
    getFromCacheWithMigration: async () => { await env.matchCacheGate; return null; },
}));
vi.mock('@/services/localMusicService', () => ({
    getAudioFromLocalSong: async (song: { id: string }) => { await env.fileGate.get(song.id); return `blob:${song.id}`; },
    ensureLocalSongCoverAsset: async (song: unknown) => { await env.coverAssetGate; return song; },
    matchLyrics: async () => {},
}));
vi.mock('@/utils/lyrics/localSongMatchContext', async importOriginal => ({
    ...await importOriginal<typeof import('@/utils/lyrics/localSongMatchContext')>(),
    shouldRunLocalSongAutomaticMatch: () => false,
}));
vi.mock('@/utils/lyrics/localSongLyrics', () => ({
    resolveLocalSongLyrics: async () => ({ lyrics: null, source: null }),
}));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: async () => ({ entities: [], assignments: [] }),
}));
vi.mock('@/services/coverCache', () => ({
    getCachedCoverUrl: async () => null,
    loadCachedOrFetchCover: async (_cacheKey: string, url: string) => `cached:${url}`,
}));
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => ({ serverUrl: 'https://navi.test' }),
    isNavidromeEnabled: () => true,
    navidromeApi: {
        getStreamUrl: (_config: unknown, id: string) => `https://navi.test/stream/${id}`,
        getSong: async () => null,
        getCoverArtUrl: (_config: unknown, id: string) => `https://navi.test/cover/${id}`,
    },
}));
vi.mock('@/utils/appNavidromeLyrics', () => ({
    hydrateNavidromeLyricPayload: async () => {},
    resolvePreferredNavidromeLyrics: async () => ({ lines: [{ fullText: 'la', startTime: 0, endTime: 1, words: [] }] }),
}));
vi.mock('@/services/hostExtensionHooks', () => ({
    hasBeforePlayHook: () => false,
    runBeforePlayHook: async (song: unknown) => song,
    lyricsForNoLyrics: () => null,
    notifyPlaybackFailed: () => undefined,
}));
const { prefetchNearbySongs } = vi.hoisted(() => ({ prefetchNearbySongs: vi.fn(async () => {}) }));
vi.mock('@/services/prefetchService', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/prefetchService')>(),
    prefetchNearbySongs,
}));

const { useLibraryPlaybackController } = await import('@/components/app/playback/start/useLibraryPlaybackController');
const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { replacePlayQueue, setPlayQueue, usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { makeSongCurrent } = await import('@/components/app/playback/currentSong');
const { noteWholeQueueWrite } = await import('@/services/wholeQueueWrites');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');
const { resetPlaybackStore } = await import('./currentSongWatch');

const localRecord = (id: string, title: string): LocalSong => ({
    id, fileName: `${title}.mp3`, filePath: `Music/${title}.mp3`, title, titleOrigin: 'import',
    importedMetadata: { title, titleSource: 'filename', artistNames: [] },
    duration: 100, fileSize: 1234, fileLastModified: 1000, mimeType: 'audio/mpeg', addedAt: 1, folderName: 'Music',
    hasLocalLyrics: true,
} as LocalSong);
/** A local song as the queue holds it. */
const queuedLocal = (id: string, name: string): SongResult => ({
    id, name, artists: [], album: { id: '', name: '' }, durationMs: 100,
    isLocal: true, localRef: { songId: id }, sourceRef: { kind: 'local', mediaId: id },
} as unknown as SongResult);
const online = (id: string): SongResult => ({
    id, name: id.toUpperCase(), artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const navidrome = (id: string, name: string) => ({
    id, name, artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    isNavidrome: true, navidromeData: { id, title: name },
} as unknown as NavidromeSong);
/** A Navidrome song as the queue holds it: the unified song carrying the server's record. */
const queuedNavidrome = (song: NavidromeSong): SongResult => ({
    ...song, sourceRef: { kind: 'navidrome', mediaId: song.navidromeData.id }, navidromeData: song,
} as unknown as SongResult);

const localOne = localRecord('l1', 'L1');
const localTwo = localRecord('l2', 'L2');
const [q1, q2] = [queuedLocal('l1', 'L1'), queuedLocal('l2', 'L2')];
const [x, y] = ['x', 'y'].map(online);
const naviOne = navidrome('n1', 'N1');
const naviTwo = navidrome('n2', 'N2');

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const keys = (queue: readonly SongResult[]) => queue.map(getPlaybackSongKey);
const store = () => usePlaybackStore.getState();

/** A whole-queue write, as replaceQueue and its undo make it. */
const replaceWhole = (queue: SongResult[]) => {
    noteWholeQueueWrite();
    replacePlayQueue(queue, false);
};

beforeEach(() => {
    // A local play from a queue also warms the songs next to it a second later: not this test's subject.
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    resetPlaybackStore();
    env.songs = [localOne, localTwo];
    env.fileGate.clear();
    env.coverAssetGate = null;
    env.matchCacheGate = null;
    env.saveGate = null;
    env.listGate = null;
    prefetchNearbySongs.mockClear();
    useStatusMessageStore.setState({ message: null });
    useAudioSettingsStore.setState({ queueAddBehavior: 'append' });
});
afterEach(() => {
    vi.restoreAllMocks();
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

function mount() {
    const refs = usePlaybackRuntimeRefs();
    const persistLastPlaybackCache = vi.fn(async (_song: SongResult | null, _queue: SongResult[]) => undefined);
    const library = useLibraryPlaybackController({
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        lyricsLoadingWritesRef: { current: 0 },
        navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache,
        restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(() => null),
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
    } as never);
    const queue = usePlaybackQueueController({
        localSongs: [localOne, localTwo], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        setLyrics: vi.fn(),
        setIsLyricsLoading: vi.fn(),
        navigateToPlaybackView: vi.fn(),
        persistLastPlaybackCache,
        restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(),
        onPlayLocalSong: library.onPlayLocalSong,
        onPlayNavidromeSong: library.onPlayNavidromeSong,
        audioRef: refs.audioRef,
        blobUrlRef: refs.blobUrlRef,
        shouldAutoPlayRef: refs.shouldAutoPlay,
        mainPlaybackSnapshotRef: { current: null },
        playbackAutoSkipCountRef: refs.playbackAutoSkipCountRef,
        pendingResumeTimeRef: refs.pendingResumeTimeRef,
        currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
        lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
    } as never);
    return { library, queue, persistLastPlaybackCache };
}

describe('a local song played from the queue, landing after the queue was replaced whole', () => {
    /** Starts L2 from the store's queue [L1, L2] (the next track), held while its file is read. */
    const heldAtTheFile = async () => {
        setPlayQueue([q1, q2]);
        makeSongCurrent(q1);
        const mounted = mount();
        const file = deferred();
        env.fileGate.set('l2', file.promise);
        const play = mounted.queue.playSong(q2, store().playQueue);
        await settle();
        return { ...mounted, play, release: file.resolve };
    };

    it('swaps itself in where the new queue holds it, and saves and fetches around the new queue', async () => {
        const { play, release, persistLastPlaybackCache } = await heldAtTheFile();
        const replaced = [x, { ...q2 }, y];
        replaceWhole(replaced);
        release();
        await play;

        const landed = store().playQueue;
        expect(keys(landed)).toEqual(keys(replaced));
        expect(landed[0]).toBe(x);
        expect(landed[2]).toBe(y);
        expect(landed[1]).toBe(store().currentSong);
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'L2' }), landed);
        expect(prefetchNearbySongs).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'L2' }), landed, expect.anything(), undefined);
    });

    it('writes no queue where the new queue does not hold it', async () => {
        const { play, release, persistLastPlaybackCache } = await heldAtTheFile();
        const replaced = [x, y];
        replaceWhole(replaced);
        release();
        await play;

        expect(store().playQueue).toBe(replaced);
        expect(store().currentSong).toMatchObject({ name: 'L2' });
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'L2' }), replaced);
        expect(prefetchNearbySongs).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'L2' }), replaced, expect.anything(), undefined);
    });

    it('a local song played as a list of its own (a click in the local library) still writes its list', async () => {
        setPlayQueue([q1, q2]);
        makeSongCurrent(q1);
        const { library } = mount();
        const file = deferred();
        env.fileGate.set('l2', file.promise);
        const play = library.onPlayLocalSong(localTwo);
        await settle();

        replaceWhole([x, y]);
        file.resolve();
        await play;

        expect(keys(store().playQueue)).toEqual(['local:l2']);
    });
});

describe('a Navidrome song played from the queue, landing after the queue was replaced whole', () => {
    const heldAtTheMatchData = async () => {
        setPlayQueue([queuedNavidrome(naviOne), queuedNavidrome(naviTwo)]);
        makeSongCurrent(store().playQueue[0]);
        const mounted = mount();
        const matchData = deferred();
        env.matchCacheGate = matchData.promise;
        const play = mounted.queue.playSong(store().playQueue[1], store().playQueue);
        await settle();
        return { ...mounted, play, release: matchData.resolve };
    };

    it('swaps itself in where the new queue holds it, and saves and fetches around the new queue', async () => {
        const { play, release, persistLastPlaybackCache } = await heldAtTheMatchData();
        const replaced = [x, queuedNavidrome(naviTwo), y];
        replaceWhole(replaced);
        release();
        await play;

        const landed = store().playQueue;
        expect(keys(landed)).toEqual(keys(replaced));
        expect(landed[0]).toBe(x);
        expect(landed[2]).toBe(y);
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'N2' }), landed);
        expect(prefetchNearbySongs).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'N2' }), landed, expect.anything(), undefined);
    });

    it('writes no queue where the new queue does not hold it', async () => {
        const { play, release, persistLastPlaybackCache } = await heldAtTheMatchData();
        const replaced = [x, y];
        replaceWhole(replaced);
        release();
        await play;

        expect(store().playQueue).toBe(replaced);
        expect(store().currentSong).toMatchObject({ name: 'N2' });
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'N2' }), replaced);
    });

    it('a Navidrome song played as a list of its own still writes its list', async () => {
        setPlayQueue([q1, q2]);
        makeSongCurrent(q1);
        const { library } = mount();
        const matchData = deferred();
        env.matchCacheGate = matchData.promise;
        const play = library.onPlayNavidromeSong(naviOne, [naviOne, naviTwo]);
        await settle();

        replaceWhole([x, y]);
        matchData.resolve();
        await play;

        expect(keys(store().playQueue)).toEqual(['navidrome:n1', 'navidrome:n2']);
    });
});

describe('reloading the local song that plays once its lyrics changed', () => {
    it('after lyrics are uploaded, lands in a queue replaced whole while they were saved, not in the queue seen before', async () => {
        setPlayQueue([q1, q2]);
        makeSongCurrent(q1);
        const { library, persistLastPlaybackCache } = mount();
        const save = deferred();
        env.saveGate = save.promise;
        const update = library.handleUpdateLocalLyrics('[00:00.00]la', false, 'l1.lrc');
        await settle();

        const replaced = [x, { ...q1 }, y];
        replaceWhole(replaced);
        save.resolve();
        await update;
        // The reload is not awaited by the upload: wait for its landing.
        await vi.waitFor(() => expect(persistLastPlaybackCache).toHaveBeenCalled());

        const landed = store().playQueue;
        expect(keys(landed)).toEqual(keys(replaced));
        expect(landed[0]).toBe(x);
        expect(landed[2]).toBe(y);
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'L1' }), landed);
    });

    it('after a lyric match, lands in a queue replaced whole while the library was read again', async () => {
        setPlayQueue([q1, q2]);
        makeSongCurrent(q1);
        const { library } = mount();
        const list = deferred();
        env.listGate = list.promise;
        const complete = library.handleLyricMatchComplete(q1);
        await settle();

        const replaced = [x, { ...q1 }, y];
        replaceWhole(replaced);
        list.resolve();
        await complete;

        const landed = store().playQueue;
        expect(keys(landed)).toEqual(keys(replaced));
        expect(landed[0]).toBe(x);
        expect(landed[2]).toBe(y);
    });
});

describe('adding a local song to the queue', () => {
    it('adds it to the queue as the store holds it after the add\'s waits, and writes no older queue back', async () => {
        setPlayQueue([q1]);
        makeSongCurrent(q1);
        const { library, persistLastPlaybackCache } = mount();
        const coverAsset = deferred();
        env.coverAssetGate = coverAsset.promise;
        const add = library.handleLocalQueueAdd(localTwo);
        await settle();

        replaceWhole([x, y]);
        coverAsset.resolve();
        await add;

        expect(keys(store().playQueue)).toEqual(['online:bodian:x', 'online:bodian:y', 'local:l2']);
        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(q1, store().playQueue);
    });
});
