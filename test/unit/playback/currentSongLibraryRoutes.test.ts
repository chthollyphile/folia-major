import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/playback/currentSongLibraryRoutes.test.ts
// Pins what playing a local file and playing a Navidrome song write, and in which order: the key of
// the song asked for, the lyrics, the store's song, the audio source, the cover, the queue. For a
// local file it also pins the work that finishes later (the match and the second reading of the
// file's metadata): what it does when another song was asked for in between.
// The hook runs without a renderer (plain stand-ins for React's hooks, the real store); the
// library, the file access and the Navidrome server are stubs. No request leaves the test.
// The second half pins the audio address of a local file and of a Navidrome song: where it comes
// from, what happens to the blob URL of the song before, the copy that replaces an address the
// browser could not play, the cover, and what a file that cannot be read leaves behind.
// The last describe pins the same plays on the HiFi route: no blob URL is made and no address is
// written; the track goes to the HiFi service (a stub here) with the file itself or the stream of the
// original file, and the rest of the play is the web route's.
// After it: a play the HiFi bridge asks to start further in, paused, or without its own toasts (a song
// it moves to the other engine), on both routes.

const env = vi.hoisted(() => ({
    note: (_label: string) => {},
    songs: [] as unknown[],
    /** Local song ids whose automatic match runs, each held until its promise resolves. */
    matchGate: new Map<string, Promise<unknown>>(),
    /** `<song id>#<nth reading>` of a local file's lyrics, held until its promise resolves. */
    lyricsGate: new Map<string, Promise<unknown>>(),
    lyricsReadings: new Map<string, number>(),
    detail: (_label: string) => {},
    /** Local song ids whose file cannot be read. */
    unreadable: new Set<string>(),
    navidromeConfig: { serverUrl: 'https://navi.test' } as unknown,
    /** What the Navidrome server answers for the song itself. */
    serverSong: null as unknown,
    /** Holds the reading of a Navidrome song's own lyrics until it resolves. */
    navidromeLyricsGate: null as Promise<unknown> | null,
    /** Runs while a local song's record is being saved. */
    duringSave: null as (() => Promise<unknown>) | null,
    /** Runs while something is being saved to the cache (an online song's lyrics state). */
    duringCacheSave: null as (() => Promise<unknown>) | null,
    /** The engine the HiFi service picks for a local or Navidrome song. */
    route: 'web' as 'web' | 'hifi',
    /** The songs the HiFi service was asked to route, as `<kind> <song key>`. */
    routesAsked: [] as string[],
    /** What the HiFi service was asked to start, with the Navidrome carrier's data as it was at the call. */
    hifiStarts: [] as Array<{ song: { name: string }; source: Record<string, unknown>; startSec: number; adoptRunning?: boolean; navidromeData?: Record<string, unknown> }>,
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
    saveToCache: async () => { await env.duringCacheSave?.(); },
    removeFromCache: async () => {},
    getLocalSongs: async () => env.songs,
    saveLocalSong: async () => { await env.duringSave?.(); },
    getFromCacheWithMigration: async () => null,
}));
vi.mock('@/services/localMusicService', () => ({
    getAudioFromLocalSong: async (song: { id: string }) => {
        env.note(`wait local file ${song.id}`);
        return env.unreadable.has(song.id) ? null : `blob:${song.id}`;
    },
    getFileFromLocalSong: async (song: { id: string }) => {
        env.note(`wait the file itself ${song.id}`);
        return env.unreadable.has(song.id) ? null : { name: `${song.id}.flac` };
    },
    ensureLocalSongCoverAsset: async (song: { id: string }) => {
        env.detail(`wait cover asset ${song.id}`);
        return song;
    },
    matchLyrics: async (song: { id: string }) => { env.note(`wait match ${song.id}`); await env.matchGate.get(song.id); },
}));
vi.mock('@/utils/lyrics/localSongMatchContext', async importOriginal => ({
    ...await importOriginal<typeof import('@/utils/lyrics/localSongMatchContext')>(),
    shouldRunLocalSongAutomaticMatch: (song: { id: string }) => env.matchGate.has(song.id),
}));
vi.mock('@/utils/lyrics/localSongLyrics', () => ({
    resolveLocalSongLyrics: async (song: { id: string }) => {
        const reading = (env.lyricsReadings.get(song.id) ?? 0) + 1;
        env.lyricsReadings.set(song.id, reading);
        env.note(`wait local lyrics ${song.id}#${reading}`);
        await env.lyricsGate.get(`${song.id}#${reading}`);
        return { lyrics: null, source: null };
    },
}));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: async () => ({ entities: [], assignments: [] }),
}));
vi.mock('@/services/coverCache', () => ({
    getCachedCoverUrl: async () => null,
    loadCachedOrFetchCover: async (cacheKey: string, url: string) => { env.detail(`wait cover cache ${cacheKey}`); return `cached:${url}`; },
}));
// The real hand-over of blob URLs, with a line for each call.
vi.mock('@/services/playbackBlobUrls', async importOriginal => {
    const real = await importOriginal<typeof import('@/services/playbackBlobUrls')>();
    return { retireBlobUrl: (url: string | null) => { env.detail(`retire ${url}`); real.retireBlobUrl(url); } };
});
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => env.navidromeConfig,
    isNavidromeEnabled: () => true,
    navidromeApi: {
        getStreamUrl: (_config: unknown, id: string, format?: string) => `https://navi.test/stream/${id}${format ? `?format=${format}` : ''}`,
        getSong: async (_config: unknown, id: string) => { env.note(`wait navidrome song ${id}`); return env.serverSong; },
        getCoverArtUrl: (_config: unknown, id: string) => `https://navi.test/cover/${id}`,
    },
}));
// The HiFi service: which engine a song plays on, and the start of a track on mpv, recorded.
vi.mock('@/services/hifi/hifiPlayback', () => ({
    hifiRouteFor: (kind: string, songKey: string) => { env.routesAsked.push(`${kind} ${songKey}`); return env.route; },
    beginHifiTrack: async (options: { song: { name: string }; source: Record<string, unknown> & { carrier?: { navidromeData: Record<string, unknown> } }; startSec: number; adoptRunning?: boolean }) => {
        const navidromeData = options.source.carrier ? { ...options.source.carrier.navidromeData } : undefined;
        env.hifiStarts.push({ ...options, navidromeData });
        env.note(`hifi ${options.song.name} ${String(options.source.kind)} from ${options.startSec}`);
        return 'ready';
    },
}));
vi.mock('@/utils/appNavidromeLyrics', () => ({
    hydrateNavidromeLyricPayload: async () => {},
    resolvePreferredNavidromeLyrics: async (song: { id: string }) => {
        env.note(`wait navidrome lyrics ${song.id}`);
        await env.navidromeLyricsGate;
        return { lines: [{ fullText: 'la', startTime: 0, endTime: 1, words: [] }] };
    },
}));

// The analysis and prefetch of the songs around the one played, stubbed for the whole file: only
// whether a play asks for it is pinned (the last describe), and no other test here depends on it.
const { prefetchNearbySongs } = vi.hoisted(() => ({ prefetchNearbySongs: vi.fn(async () => {}) }));
vi.mock('@/services/prefetchService', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/prefetchService')>(),
    prefetchNearbySongs,
}));

const { useLibraryPlaybackController } = await import('@/components/app/playback/start/useLibraryPlaybackController');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { askForSong, dropPlaysInFlight, makeSongCurrent, startPlay } = await import('@/components/app/playback/currentSong');
const { currentTime } = await import('@/stores/motionSignals');
const { PlayerState } = await import('@/types');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { retireBlobUrl } = await import('@/services/playbackBlobUrls');
const { clearPlaybackRepresentationsForTests, registerPlaybackRepresentation } = await import('@/services/playbackRecovery/representationRegistry');
const { buildLocalSourceRevision } = await import('@/services/playbackRecovery/sourceRevision');
const { resetPlaybackStore, watchCurrentSong } = await import('./currentSongWatch');

const localSong = (id: string, title: string): LocalSong => ({
    id,
    fileName: `${title}.mp3`,
    filePath: `Music/${title}.mp3`,
    title,
    titleOrigin: 'import',
    importedMetadata: { title, titleSource: 'filename', artistNames: [] },
    duration: 100,
    fileSize: 1234,
    fileLastModified: 1000,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    folderName: 'Music',
    hasLocalLyrics: true,
} as LocalSong);
const localOne = localSong('l1', 'L1');
const localTwo = localSong('l2', 'L2');
const navidromeSong = {
    id: 'n1', name: 'N1', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    isNavidrome: true, navidromeData: { id: 'n1', title: 'N1' },
} as unknown as NavidromeSong;
const navidromeTwo = {
    id: 'n2', name: 'N2', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    isNavidrome: true, navidromeData: { id: 'n2', title: 'N2' },
} as unknown as NavidromeSong;

beforeEach(() => {
    resetPlaybackStore();
    env.songs = [localOne, localTwo];
    env.matchGate.clear();
    env.lyricsGate.clear();
    env.lyricsReadings.clear();
    env.unreadable.clear();
    env.navidromeConfig = { serverUrl: 'https://navi.test' };
    env.serverSong = null;
    env.navidromeLyricsGate = null;
    env.duringSave = null;
    env.duringCacheSave = null;
    env.route = 'web';
    env.routesAsked.length = 0;
    env.hifiStarts.length = 0;
    clearPlaybackRepresentationsForTests();
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    env.note = () => {};
    env.detail = () => {};
    vi.restoreAllMocks();
    resetPlaybackStore();
});

function mount({ address = false } = {}) {
    const refs = usePlaybackRuntimeRefs();
    const watch = watchCurrentSong(refs.currentSongRef, address ? refs : undefined);
    env.note = watch.note;
    env.detail = watch.detail;
    // The mark's setter as App hands it out: every write is counted.
    const lyricsLoadingWritesRef = { current: 0 };
    const setIsLyricsLoading = vi.fn(() => { lyricsLoadingWritesRef.current += 1; });
    const persistLastPlaybackCache = vi.fn(async () => undefined);
    const library = useLibraryPlaybackController({
        setLyrics: (lyrics: unknown) => watch.note(`lyrics=${lyrics ? 'set' : 'null'}`),
        setIsLyricsLoading,
        lyricsLoadingWritesRef,
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
    return { refs, watch, library, setIsLyricsLoading, persistLastPlaybackCache };
}

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};
/** Lets the work a play leaves running behind it reach its next wait or its end. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('playing a local file and the current song', () => {
    it('asks for the song before it writes the lyrics, the song and the audio source', async () => {
        const { refs, watch, library } = mount();
        await library.onPlayLocalSong(localOne);
        await settle();
        watch.take();

        await library.onPlayLocalSong(localTwo);
        await settle();

        expect(watch.take()).toEqual([
            'wait local file l2 | song=L1 key=local:l1',
            'wait local lyrics l2#1 | song=L1 key=local:l1',
            // The key has moved; the store still shows the song before.
            'lyrics=null | song=L1 key=local:l2',
            'song=L2 key=local:l2',
            'audio=blob:l2 key=local:l2',
            'cover=null key=local:l2',
            'queue=[L2] key=local:l2',
            // The work left running: the file's metadata is read again and the song patched with it.
            'wait local lyrics l2#2 | song=L2 key=local:l2',
            'song~L2 key=local:l2',
            'lyrics=null | song=L2 key=local:l2',
            'cover=null key=local:l2',
        ]);
        expect(refs.currentSongRef.current).toBe('local:l2');
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
    });

    it('drops the work left running when another song was asked for during the match', async () => {
        const { refs, watch, library } = mount();
        const match = deferred();
        env.matchGate.set('l1', match.promise);

        await library.onPlayLocalSong(localOne);
        await settle();
        expect(watch.log.at(-1)).toBe('wait match l1 | song=L1 key=local:l1');
        await library.onPlayLocalSong(localTwo);
        await settle();
        watch.take();

        match.resolve();
        await settle();

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
        expect(refs.currentSongRef.current).toBe('local:l2');
    });

    /** Plays L1 and holds the work it leaves running at the second reading of the file's metadata. */
    const heldAtSecondReading = async () => {
        const mounted = mount();
        const secondReading = deferred();
        env.lyricsGate.set('l1#2', secondReading.promise);
        await mounted.library.onPlayLocalSong(localOne);
        await settle();
        expect(mounted.watch.log.at(-1)).toBe('wait local lyrics l1#2 | song=L1 key=local:l1');
        return { ...mounted, secondReading };
    };

    it('writes nothing of the first song when another was asked for during its second reading', async () => {
        const { refs, watch, library, secondReading, setIsLyricsLoading } = await heldAtSecondReading();
        await library.onPlayLocalSong(localTwo);
        await settle();
        watch.take();
        setIsLyricsLoading.mockClear();

        secondReading.resolve();
        await settle();

        // Neither L1's lyrics nor its cover land on L2, and L2's loading mark is left alone.
        expect(watch.take()).toEqual([]);
        expect(setIsLyricsLoading).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l2');
        expect(refs.currentSongRef.current).toBe('local:l2');
    });

    it.each([
        // The stage asks for its own song only after a wait: until then the key still names L1.
        ['the stage was opened', () => dropPlaysInFlight()],
        ['the platform was switched', () => { dropPlaysInFlight(); makeSongCurrent(null); }],
    ])('writes nothing when %s during its second reading', async (_route, emptyThePlayer) => {
        const { watch, secondReading, setIsLyricsLoading } = await heldAtSecondReading();
        emptyThePlayer();
        watch.take();
        setIsLyricsLoading.mockClear();

        secondReading.resolve();
        await settle();

        expect(watch.take()).toEqual([]);
        expect(setIsLyricsLoading).not.toHaveBeenCalled();
    });

    it('still writes what the second reading found when a newer play ended without a song', async () => {
        const { refs, watch, library, secondReading, setIsLyricsLoading } = await heldAtSecondReading();
        // The newer play starts and gives up: its file cannot be read. L1 goes on playing.
        env.unreadable.add('l2');
        await library.onPlayLocalSong(localTwo);
        await settle();
        watch.take();

        secondReading.resolve();
        await settle();

        expect(watch.take()).toEqual([
            'song~L1 key=local:l1',
            'lyrics=null | song=L1 key=local:l1',
            'cover=null key=local:l1',
        ]);
        // L1's loading mark does not stay behind.
        expect(setIsLyricsLoading).toHaveBeenLastCalledWith(false);
        expect(refs.currentSongRef.current).toBe('local:l1');
    });
});

describe('refreshing the local library and the current song', () => {
    it('patches the playing local file in place and leaves the key', async () => {
        const { refs, watch, library } = mount();
        await library.onPlayLocalSong(localOne);
        await settle();
        watch.take();

        await library.onRefreshLocalSongs();

        expect(watch.take()).toEqual(['song~L1 key=local:l1', 'queue~[L1] key=local:l1']);
        expect(refs.currentSongRef.current).toBe('local:l1');
    });

    it('leaves no song current when the playing local file is gone from the library', async () => {
        const { refs, watch, library } = mount();
        await library.onPlayLocalSong(localOne);
        await settle();
        watch.take();
        env.songs = [localTwo];

        await library.onRefreshLocalSongs();

        expect(watch.take()).toEqual(['song=null key=null', 'queue~[] key=null']);
        expect(refs.currentSongRef.current).toBeNull();
    });

    it('clears the loading flag and the autoplay intent when the playing file is gone while its load still runs', async () => {
        const { refs, library, setIsLyricsLoading } = mount();
        // The file's match is still running, so its play has not cleared the loading flag yet.
        env.matchGate.set('l1', new Promise(() => {}));
        await library.onPlayLocalSong(localOne);
        await settle();
        expect(setIsLyricsLoading.mock.calls).toEqual([[true]]);
        expect(refs.shouldAutoPlay.current).toBe(true);
        env.songs = [localTwo];

        await library.onRefreshLocalSongs();

        expect(setIsLyricsLoading.mock.calls).toEqual([[true], [false]]);
        expect(refs.shouldAutoPlay.current).toBe(false);
    });

    it('shows no song when the playing file is gone, and leaves the key with a song asked for in the meantime', async () => {
        const { refs, watch, library, setIsLyricsLoading } = mount();
        await library.onPlayLocalSong(localOne);
        await settle();
        env.songs = [localTwo];
        // A play of another song has asked for it and is still waiting to show it.
        askForSong({ id: 'x1', name: 'X', artists: [], album: { id: '', name: '' }, durationMs: 1, sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'x1' } });
        watch.take();
        setIsLyricsLoading.mockClear();

        await library.onRefreshLocalSongs();

        expect(watch.take()).toEqual(['song=null key=online:bodian:x1', 'queue~[] key=online:bodian:x1']);
        expect(refs.currentSongRef.current).toBe('online:bodian:x1');
        // The intent to play and the loading mark are that play's now: the refresh leaves both.
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(setIsLyricsLoading).not.toHaveBeenCalled();
    });

    it('a local file and a Navidrome song start at their beginning, not at a time left by a restore that was overtaken', async () => {
        const { refs, library } = mount();
        const leftBehind = () => {
            refs.pendingResumeTimeRef.current = 130;
            refs.lastAudioRecoverySourceRef.current = 'https://audio.test/old';
        };
        leftBehind();
        await library.onPlayLocalSong(localOne);
        expect([refs.pendingResumeTimeRef.current, refs.lastAudioRecoverySourceRef.current]).toEqual([null, null]);

        leftBehind();
        await library.onPlayNavidromeSong(navidromeSong);
        expect([refs.pendingResumeTimeRef.current, refs.lastAudioRecoverySourceRef.current]).toEqual([null, null]);
    });
});

describe('playing a Navidrome song and the current song', () => {
    it('asks for the song before it writes the lyrics, the song, the cover and the audio source', async () => {
        const { refs, watch, library } = mount();
        await library.onPlayLocalSong(localOne);
        await settle();
        watch.take();

        await library.onPlayNavidromeSong(navidromeSong);

        expect(watch.take()).toEqual([
            'wait navidrome song n1 | song=L1 key=local:l1',
            'wait navidrome lyrics n1 | song=L1 key=local:l1',
            // The key has moved; the store still shows the song before.
            'lyrics=set | song=L1 key=navidrome:n1',
            'song=N1 key=navidrome:n1',
            'cover=https://navi.test/cover/n1 key=navidrome:n1',
            'audio=https://navi.test/stream/n1 key=navidrome:n1',
            'queue=[N1] key=navidrome:n1',
        ]);
        expect(refs.currentSongRef.current).toBe('navidrome:n1');
    });
});

describe('a local or Navidrome play that is no longer wanted when its wait ends', () => {
    /** Starts a local play and holds it at the first reading of the file's lyrics. */
    const heldLocalPlay = async () => {
        const mounted = mount();
        const firstReading = deferred();
        env.lyricsGate.set('l1#1', firstReading.promise);
        const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const play = mounted.library.onPlayLocalSong(localOne);
        await vi.waitFor(() => expect(mounted.watch.log.at(-1)).toContain('wait local lyrics l1#1'));
        return { ...mounted, firstReading, revoked, play };
    };
    /** Starts a Navidrome play and holds it at the reading of the song's own lyrics. */
    const heldNavidromePlay = async () => {
        const mounted = mount();
        const reading = deferred();
        env.navidromeLyricsGate = reading.promise;
        const play = mounted.library.onPlayNavidromeSong(navidromeSong);
        await vi.waitFor(() => expect(mounted.watch.log.at(-1)).toContain('wait navidrome lyrics n1'));
        return { ...mounted, reading, play };
    };

    it('a local file overtaken by a newer play writes nothing and gives its blob URL back', async () => {
        const { refs, watch, library, firstReading, revoked, play } = await heldLocalPlay();
        await library.onPlayLocalSong(localTwo);
        await settle();
        watch.take();

        firstReading.resolve();
        await play;
        await settle();

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l2');
        expect(refs.currentSongRef.current).toBe('local:l2');
        expect(refs.blobUrlRef.current).toBe('blob:l2');
        expect(revoked.mock.calls).toEqual([['blob:l1']]);
    });

    it('a local file writes nothing when the plays in flight were dropped while it was read', async () => {
        const { refs, watch, firstReading, revoked, play } = await heldLocalPlay();
        // What opening the stage and switching the platform do.
        dropPlaysInFlight();
        watch.take();

        firstReading.resolve();
        await play;
        await settle();

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
        expect(refs.currentSongRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(false);
        expect(revoked.mock.calls).toEqual([['blob:l1']]);
    });

    it('a Navidrome song overtaken by a newer play writes nothing', async () => {
        const { refs, watch, library, reading, play, setIsLyricsLoading } = await heldNavidromePlay();
        await library.onPlayLocalSong(localTwo);
        await settle();
        watch.take();

        reading.resolve();
        await play;

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l2');
        expect(refs.currentSongRef.current).toBe('local:l2');
        // Its own mark at its start, then the two of the newer play (shown, then done). The
        // overtaken play adds none.
        expect(setIsLyricsLoading.mock.calls).toEqual([[true], [true], [false]]);
    });

    it('a Navidrome song overtaken by a play that is still loading leaves the loading mark to that play', async () => {
        const { watch, library, reading, play, setIsLyricsLoading } = await heldNavidromePlay();
        const newer = deferred();
        env.navidromeLyricsGate = newer.promise;
        const newerPlay = library.onPlayNavidromeSong(navidromeTwo);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait navidrome lyrics n2'));

        reading.resolve();
        await play;
        expect(setIsLyricsLoading.mock.calls).toEqual([[true], [true]]);

        newer.resolve();
        await newerPlay;
        expect(setIsLyricsLoading.mock.calls).toEqual([[true], [true], [false]]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'N2' });
    });

    it('a Navidrome song overtaken by a play that ended without a song still takes its own loading mark away', async () => {
        const { library, reading, play, setIsLyricsLoading } = await heldNavidromePlay();
        // The newer play never writes the mark: its file cannot be read.
        env.unreadable.add('l2');
        await library.onPlayLocalSong(localTwo);

        reading.resolve();
        await play;

        expect(setIsLyricsLoading.mock.calls).toEqual([[true], [false]]);
    });

    it('a Navidrome song that fails after a newer play took over says nothing and leaves the loading mark', async () => {
        const { watch, library, setIsLyricsLoading } = mount();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail!: (error: Error) => void;
        const reading = new Promise<void>((_, reject) => { fail = reject; });
        reading.catch(() => {});
        env.navidromeLyricsGate = reading;
        const play = library.onPlayNavidromeSong(navidromeSong);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait navidrome lyrics n1'));
        await library.onPlayLocalSong(localTwo);
        await settle();
        useStatusMessageStore.setState({ message: null });
        setIsLyricsLoading.mockClear();

        fail(new Error('network'));
        await play;

        expect(useStatusMessageStore.getState().message).toBeNull();
        expect(setIsLyricsLoading).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
    });

    it('a Navidrome song writes nothing when the plays in flight were dropped while it loaded', async () => {
        const { refs, watch, reading, play, setIsLyricsLoading } = await heldNavidromePlay();
        dropPlaysInFlight();
        watch.take();

        reading.resolve();
        await play;

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
        expect(refs.currentSongRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(false);
        // The loading mark it set at its start does not stay behind.
        expect(setIsLyricsLoading).toHaveBeenLastCalledWith(false);
        expect(useStatusMessageStore.getState().message).toBeNull();
    });
});

describe('what follows a save that takes a moment', () => {
    const status = () => useStatusMessageStore.getState().message;
    const online = (id: string, name: string): SongResult => ({
        id, name, artists: [], album: { id: '', name: '' }, durationMs: 1000,
        sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
    });
    /** Plays one song after the other; answers the first as the store showed it, and the hook as the render after the last one has it. */
    const afterPlaying = async (plays: Array<(library: ReturnType<typeof mount>['library']) => Promise<unknown>>) => {
        const first = mount();
        await plays[0](first.library);
        await settle();
        const savedFor = usePlaybackStore.getState().currentSong!;
        for (const play of plays.slice(1)) {
            await play(first.library);
            await settle();
        }
        useStatusMessageStore.setState({ message: null });
        return { savedFor, ...mount() };
    };

    it('a lyric match saved for a local file replays that file while it still plays', async () => {
        const { savedFor, library, watch } = await afterPlaying([library => library.onPlayLocalSong(localOne)]);

        await library.handleLyricMatchComplete(savedFor);

        expect(watch.take()[0]).toBe('wait local file l1 | song=L1 key=local:l1');
        expect(status()).toMatchObject({ type: 'success', text: 'status.matchSuccessful' });
    });

    it('a lyric match saved for a local file after another file started replays nothing, and still says what it could not apply', async () => {
        const { savedFor, library, watch } = await afterPlaying([
            library => library.onPlayLocalSong(localOne),
            library => library.onPlayLocalSong(localTwo),
        ]);

        await library.handleLyricMatchComplete(savedFor);
        await settle();

        expect(watch.take()).toEqual([]);
        expect(status()).toBeNull();
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });

        await library.handleLyricMatchComplete(savedFor, 'the cover was not saved');
        expect(watch.take()).toEqual([]);
        expect(status()).toMatchObject({ type: 'error', text: 'the cover was not saved' });
    });

    it('a lyric match saved for a Navidrome song replays that song while it still plays, and nothing after another started', async () => {
        const playing = await afterPlaying([library => library.onPlayNavidromeSong(navidromeSong)]);
        await playing.library.handleNaviLyricMatchComplete(playing.savedFor);
        expect(playing.watch.take()[0]).toBe('wait navidrome song n1 | song=N1 key=navidrome:n1');
        expect(status()).toMatchObject({ type: 'success', text: 'status.matchSuccessful' });

        const movedOn = await afterPlaying([
            library => library.onPlayNavidromeSong(navidromeSong),
            library => library.onPlayNavidromeSong(navidromeTwo),
        ]);
        await movedOn.library.handleNaviLyricMatchComplete(movedOn.savedFor);
        expect(movedOn.watch.take()).toEqual([]);
        expect(status()).toBeNull();
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'N2' });
    });

    it('a lyric match saved for an online song after another started reads and writes nothing for the song that plays now', async () => {
        const { omni } = await import('@/services/onlineMusic/omni');
        const getLyrics = vi.spyOn(omni, 'getLyrics').mockResolvedValue({ lyrics: null, isPureMusic: false } as never);
        makeSongCurrent(online('y1', 'Y'));
        const { library, watch } = mount();

        await library.handleOnlineLyricMatchComplete(online('x1', 'X'));

        expect(getLyrics).not.toHaveBeenCalled();
        expect(watch.take()).toEqual([]);
        expect(status()).toBeNull();
    });

    it('a lyric match saved for an online song writes nothing once another song started while its lyrics were read', async () => {
        const { omni } = await import('@/services/onlineMusic/omni');
        makeSongCurrent(online('x1', 'X'));
        const { library, watch } = mount();
        vi.spyOn(omni, 'getLyrics').mockImplementation(async () => {
            makeSongCurrent(online('y1', 'Y'));
            return { lyrics: null, isPureMusic: false } as never;
        });

        await library.handleOnlineLyricMatchComplete(online('x1', 'X'));

        expect(watch.take().filter(line => line.startsWith('lyrics='))).toEqual([]);
        expect(status()).toBeNull();
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'Y' });
    });

    it('lyrics uploaded for a local file do not replay it once another song was asked for during the save', async () => {
        const { library, watch } = await afterPlaying([library => library.onPlayLocalSong(localOne)]);
        env.duringSave = async () => {
            await library.onPlayLocalSong(localTwo);
            await settle();
            watch.take();
        };

        await library.handleUpdateLocalLyrics('[00:01.00]la', false, 'L1.lrc');
        await settle();

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L2' });
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l2');
    });

    it('lyrics uploaded for an online song are written to the song that plays only while it is still that song', async () => {
        // The parser runs in a worker, which this harness does not have.
        const { LyricParserFactory } = await import('@/utils/lyrics/LyricParserFactory');
        vi.spyOn(LyricParserFactory, 'parse').mockResolvedValue({ lines: [] } as never);
        makeSongCurrent(online('x1', 'X'));
        const stillPlaying = mount();
        await stillPlaying.library.handleImportOnlineLyrics('[00:01.00]la', 'X.lrc');
        expect(stillPlaying.watch.take()).toEqual(['song~X key=online:bodian:x1', 'lyrics=set | song=X key=online:bodian:x1']);
        expect(stillPlaying.persistLastPlaybackCache).toHaveBeenCalledTimes(1);
        expect(status()).toMatchObject({ type: 'success', text: 'Lyrics updated' });

        const { library, watch, persistLastPlaybackCache } = mount();
        useStatusMessageStore.setState({ message: null });
        env.duringCacheSave = async () => {
            makeSongCurrent(online('y1', 'Y'));
            watch.take();
        };

        await library.handleImportOnlineLyrics('[00:01.00]la', 'X.lrc');

        // Y keeps its own lyrics, and X is not remembered as the song played last.
        expect(watch.take()).toEqual([]);
        expect(persistLastPlaybackCache).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'Y' });
        // The upload itself was saved, and that is still said.
        expect(status()).toMatchObject({ type: 'success', text: 'Lyrics updated' });
    });
});

describe('the lyric match window', () => {
    it('is not opened for a local file whose record the library does not have, and the panel stays open', async () => {
        const { useAppViewStore } = await import('@/stores/useAppViewStore');
        const first = mount();
        await first.library.onPlayLocalSong(localOne);
        await settle();
        useAppViewStore.setState({ isPanelOpen: true });
        // The hook's own list of local songs is empty in this harness: no record for L1.
        const { library } = mount();

        library.openLyricMatch();

        expect(useAppViewStore.getState().isPanelOpen).toBe(true);
        expect(library.isLyricMatchOpen).toBe(false);
    });
});

describe('the audio address of a local file and of a Navidrome song', () => {
    const status = () => useStatusMessageStore.getState().message;
    const aNavidromeSong = () => ({
        id: 'n1', name: 'N1', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
        isNavidrome: true, navidromeData: { id: 'n1', title: 'N1', streamUrl: 'https://navi.test/stream/n1' },
    } as unknown as NavidromeSong);
    // A file whose cover is the one matched online.
    const localThree = { ...localSong('l3', 'L3'), useOnlineCover: true, onlineMetadata: { coverUrl: 'https://cover.test/l3' } } as LocalSong;
    const representation = (songKey: string, sourceRevision: string) => ({
        songKey, sourceRevision, representationId: 'transcoded', url: `blob:transcoded-${songKey}`,
    } as never);

    beforeEach(() => {
        // Empties the list of blob URLs handed over by an earlier test.
        retireBlobUrl(null);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
    });

    /** Plays L1 first, so there is a blob URL to hand over and a fetch time left by an online song. */
    const afterLocalOne = async () => {
        const mounted = mount({ address: true });
        await mounted.library.onPlayLocalSong(localOne);
        await settle();
        mounted.refs.currentOnlineAudioUrlFetchedAtRef.current = 777;
        mounted.watch.take();
        return mounted;
    };

    it('a local file: read, asked for its cover asset, the blob URL of the song before handed over and not revoked', async () => {
        const { refs, watch, library } = await afterLocalOne();
        env.songs = [localOne, localThree];

        await library.onPlayLocalSong(localThree);
        await settle();

        expect(watch.take()).toEqual([
            'wait local file l3 | song=L1 key=local:l1',
            'wait cover asset l3',
            'wait local lyrics l3#1 | song=L1 key=local:l1',
            'retire blob:l1',
            'lyrics=null | song=L1 key=local:l3',
            'song=L3 key=local:l3',
            // A local play leaves the fetch time of the song before as it was.
            'audio=blob:l3 key=local:l3 blobRef=blob:l3 fetchedAt=777',
            'wait cover cache cover_local_l3',
            'queue=[L3] key=local:l3',
            'cover=cached:https://cover.test/l3 key=local:l3',
            'wait local lyrics l3#2 | song=L3 key=local:l3',
            'song~L3 key=local:l3',
            'lyrics=null | song=L3 key=local:l3',
        ]);
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ playbackSourceRevision: buildLocalSourceRevision(localThree) });
        // The route was asked before the file was read, and the web route starts nothing on mpv.
        expect(env.routesAsked.at(-1)).toBe('local local:l3');
        expect(env.hifiStarts).toEqual([]);
    });

    it('a local file that has a copy the browser can play: the copy is the address, and the file\'s own blob URL is given back', async () => {
        const { watch, library } = await afterLocalOne();
        registerPlaybackRepresentation(representation('local:l2', buildLocalSourceRevision(localTwo)));

        await library.onPlayLocalSong(localTwo);
        await settle();

        expect(watch.take().filter(line => /^(audio|retire|revoke)/.test(line))).toEqual([
            'retire blob:l1',
            'retire blob:l2',
            // No deck is sounding L1 here, so the hand-over of L2's unused URL lets it go.
            'revoke blob:l1',
            'retire null',
            'revoke blob:l2',
            'audio=blob:transcoded-local:l2 key=local:l2 blobRef=null fetchedAt=777',
        ]);
    });

    it('a copy made for another state of the file is not used', async () => {
        const { watch, library } = await afterLocalOne();
        registerPlaybackRepresentation(representation('local:l2', 'l2:999:999'));

        await library.onPlayLocalSong(localTwo);
        await settle();

        expect(watch.take().filter(line => line.startsWith('audio'))).toEqual([
            'audio=blob:l2 key=local:l2 blobRef=blob:l2 fetchedAt=777',
        ]);
    });

    it('a local file that cannot be read: nothing is written and the listener is told', async () => {
        const { refs, watch, library } = await afterLocalOne();
        env.unreadable.add('l2');

        await library.onPlayLocalSong(localTwo);
        await settle();

        expect(watch.take()).toEqual(['wait local file l2 | song=L1 key=local:l1']);
        expect(status()).toMatchObject({ type: 'error', text: 'status.localFileAccessError' });
        expect(refs.blobUrlRef.current).toBe('blob:l1');
    });

    it('a Navidrome song: the stream address, the server\'s gain on the song, and the blob URL of the song before left alone', async () => {
        const { refs, watch, library } = await afterLocalOne();
        const song = aNavidromeSong();
        env.serverSong = { replayGain: { trackGain: -4 } };

        await library.onPlayNavidromeSong(song);

        expect(watch.take()).toEqual([
            'wait navidrome song n1 | song=L1 key=local:l1',
            'wait navidrome lyrics n1 | song=L1 key=local:l1',
            'lyrics=set | song=L1 key=navidrome:n1',
            'song=N1 key=navidrome:n1',
            'cover=https://navi.test/cover/n1 key=navidrome:n1',
            'audio=https://navi.test/stream/n1 key=navidrome:n1 blobRef=blob:l1 fetchedAt=777',
            'queue=[N1] key=navidrome:n1',
        ]);
        expect(song.navidromeData.replayGain).toEqual({ trackGain: -4 });
        expect(usePlaybackStore.getState().currentSong).toMatchObject({
            playbackSourceRevision: 'n1:::1000:https://navi.test/stream/n1',
        });
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(env.routesAsked).toEqual(['local local:l1', 'navidrome navidrome:n1']);
        expect(env.hifiStarts).toEqual([]);
    });

    it('a Navidrome song that has a copy the browser can play: the copy is the address', async () => {
        const { watch, library } = await afterLocalOne();
        registerPlaybackRepresentation(representation('navidrome:n1', 'n1:::1000:https://navi.test/stream/n1'));

        await library.onPlayNavidromeSong(aNavidromeSong());

        expect(watch.take().filter(line => line.startsWith('audio'))).toEqual([
            'audio=blob:transcoded-navidrome:n1 key=navidrome:n1 blobRef=blob:l1 fetchedAt=777',
        ]);
    });

    it('a Navidrome song with no server set up: nothing is written and the listener is told', async () => {
        const { watch, library } = await afterLocalOne();
        env.navidromeConfig = null;

        await library.onPlayNavidromeSong(aNavidromeSong());

        expect(watch.take()).toEqual([]);
        expect(status()).toMatchObject({ type: 'error', text: 'Navidrome not configured' });
    });
});

describe('a local file and a Navidrome song on the HiFi route', () => {
    const status = () => useStatusMessageStore.getState().message;
    const aNavidromeSong = () => ({
        id: 'n1', name: 'N1', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
        isNavidrome: true, navidromeData: { id: 'n1', title: 'N1', streamUrl: 'https://navi.test/stream/n1' },
    } as unknown as NavidromeSong);
    const localThree = { ...localSong('l3', 'L3'), useOnlineCover: true, onlineMetadata: { coverUrl: 'https://cover.test/l3' } } as LocalSong;
    const representation = (songKey: string, sourceRevision: string) => ({
        songKey, sourceRevision, representationId: 'transcoded', url: `blob:transcoded-${songKey}`,
    } as never);

    beforeEach(() => {
        retireBlobUrl(null);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
    });

    /** Plays L1 on the web route first, so there is a blob URL to hand over and a fetch time left by an online song; later plays go to HiFi. */
    const afterLocalOneOnTheWeb = async () => {
        const mounted = mount({ address: true });
        await mounted.library.onPlayLocalSong(localOne);
        await settle();
        mounted.refs.currentOnlineAudioUrlFetchedAtRef.current = 777;
        mounted.watch.take();
        env.route = 'hifi';
        return mounted;
    };

    it('a local file: the file itself goes to the HiFi service in the place of the address, and the blob URL of the song before is handed over', async () => {
        const { refs, watch, library } = await afterLocalOneOnTheWeb();
        env.songs = [localOne, localThree];

        await library.onPlayLocalSong(localThree);
        await settle();

        expect(watch.take()).toEqual([
            'wait the file itself l3 | song=L1 key=local:l1',
            'wait cover asset l3',
            'wait local lyrics l3#1 | song=L1 key=local:l1',
            'retire blob:l1',
            'lyrics=null | song=L1 key=local:l3',
            'song=L3 key=local:l3',
            // No address: the web route's `audio=` line is this one.
            'hifi L3 local from 0 | song=L3 key=local:l3',
            'wait cover cache cover_local_l3',
            'queue=[L3] key=local:l3',
            'cover=cached:https://cover.test/l3 key=local:l3',
            'wait local lyrics l3#2 | song=L3 key=local:l3',
            'song~L3 key=local:l3',
            'lyrics=null | song=L3 key=local:l3',
        ]);
        expect(env.routesAsked.at(-1)).toBe('local local:l3');
        expect(env.hifiStarts).toEqual([expect.objectContaining({
            song: expect.objectContaining({ name: 'L3' }),
            source: { kind: 'local', localSong: localThree, file: { name: 'l3.flac' } },
            startSec: 0,
        })]);
        expect(env.hifiStarts[0].adoptRunning).toBeUndefined();
        expect(refs.blobUrlRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(refs.currentOnlineAudioUrlFetchedAtRef.current).toBe(777);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(true);
        expect(status()).toMatchObject({ type: 'success', text: 'status.localMusicLoaded' });
    });

    it('a local file that has a copy the browser can play: the copy is not looked for, mpv plays the file', async () => {
        const { watch, library } = await afterLocalOneOnTheWeb();
        registerPlaybackRepresentation(representation('local:l2', buildLocalSourceRevision(localTwo)));

        await library.onPlayLocalSong(localTwo);
        await settle();

        expect(watch.take().filter(line => /^(audio|retire|revoke|hifi)/.test(line))).toEqual([
            'retire blob:l1',
            'hifi L2 local from 0 | song=L2 key=local:l2',
        ]);
    });

    it('a local file that cannot be read: nothing is written, nothing starts, and the listener is told as on the web route', async () => {
        const { refs, watch, library } = await afterLocalOneOnTheWeb();
        env.unreadable.add('l2');

        await library.onPlayLocalSong(localTwo);
        await settle();

        expect(watch.take()).toEqual(['wait the file itself l2 | song=L1 key=local:l1']);
        expect(status()).toMatchObject({ type: 'error', text: 'status.localFileAccessError' });
        expect(env.hifiStarts).toEqual([]);
        expect(refs.blobUrlRef.current).toBe('blob:l1');
    });

    it('a local file overtaken by a newer play while it was read writes nothing, starts nothing and has no blob URL to give back', async () => {
        const { watch, library } = await afterLocalOneOnTheWeb();
        const firstReading = deferred();
        env.lyricsGate.set('l2#1', firstReading.promise);
        const play = library.onPlayLocalSong(localTwo);
        await vi.waitFor(() => expect(watch.log.at(-1)).toContain('wait local lyrics l2#1'));
        // The file itself was read, and no blob URL was made of it.
        expect(watch.take().filter(line => line.startsWith('wait'))).toEqual([
            'wait the file itself l2 | song=L1 key=local:l1',
            'wait cover asset l2',
            'wait local lyrics l2#1 | song=L1 key=local:l1',
        ]);
        env.route = 'web';
        await library.onPlayLocalSong(localThree);
        await settle();
        watch.take();

        firstReading.resolve();
        await play;
        await settle();

        // Nothing of L2 is written or started, and nothing is revoked for it.
        expect(watch.take()).toEqual([]);
        expect(env.hifiStarts).toEqual([]);
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l3');
        expect(useStatusMessageStore.getState().message).toMatchObject({ text: 'status.localMusicLoaded' });
    });

    it('a Navidrome song: the stream of the original file goes to the HiFi service with the carrier, its format and gain already on it', async () => {
        const { refs, watch, library } = await afterLocalOneOnTheWeb();
        const song = aNavidromeSong();
        const format = { contentType: 'audio/flac', bitDepth: 24, samplingRate: 96000, channelCount: 2 };
        env.serverSong = { replayGain: { trackGain: -4 }, ...format };
        // A copy made for the web route is not looked for.
        registerPlaybackRepresentation(representation('navidrome:n1', 'n1:::1000:https://navi.test/stream/n1'));

        await library.onPlayNavidromeSong(song);

        expect(watch.take()).toEqual([
            'wait navidrome song n1 | song=L1 key=local:l1',
            'wait navidrome lyrics n1 | song=L1 key=local:l1',
            'lyrics=set | song=L1 key=navidrome:n1',
            'song=N1 key=navidrome:n1',
            'cover=https://navi.test/cover/n1 key=navidrome:n1',
            // The web route leaves the local song's blob URL in place; this route makes none, so it goes now.
            'retire blob:l1',
            'hifi N1 navidrome from 0 | song=N1 key=navidrome:n1',
            'queue=[N1] key=navidrome:n1',
        ]);
        expect(env.routesAsked.at(-1)).toBe('navidrome navidrome:n1');
        const [start] = env.hifiStarts;
        expect(start.source).toEqual({ kind: 'navidrome', carrier: song, streamUrl: 'https://navi.test/stream/n1?format=raw' });
        expect(start.navidromeData).toMatchObject({ replayGain: { trackGain: -4 }, ...format });
        expect(start).toMatchObject({ song: { name: 'N1' }, startSec: 0 });
        expect(start.adoptRunning).toBeUndefined();
        expect(refs.blobUrlRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(true);
        expect(status()).toMatchObject({ type: 'success', text: 'status.navidromeSongLoaded' });
    });

    it('a Navidrome song on the web route takes no format from the server\'s record', async () => {
        const { library } = mount();
        const song = aNavidromeSong();
        env.serverSong = { replayGain: { trackGain: -4 }, bitDepth: 24, samplingRate: 96000 };

        await library.onPlayNavidromeSong(song);

        expect(song.navidromeData).not.toHaveProperty('bitDepth');
        expect(song.navidromeData).not.toHaveProperty('samplingRate');
        expect(env.hifiStarts).toEqual([]);
    });

    it('a local file and a Navidrome song start at their beginning, not at a time left by a restore that was overtaken', async () => {
        const { refs, library } = mount();
        env.route = 'hifi';
        const leftBehind = () => {
            refs.pendingResumeTimeRef.current = 130;
            refs.lastAudioRecoverySourceRef.current = 'https://audio.test/old';
        };
        leftBehind();
        await library.onPlayLocalSong(localOne);
        expect([refs.pendingResumeTimeRef.current, refs.lastAudioRecoverySourceRef.current]).toEqual([null, null]);

        leftBehind();
        await library.onPlayNavidromeSong(navidromeSong);
        expect([refs.pendingResumeTimeRef.current, refs.lastAudioRecoverySourceRef.current]).toEqual([null, null]);
        expect(env.hifiStarts.map(start => start.startSec)).toEqual([0, 0]);
    });
});

describe('a library play and the songs around it', () => {
    beforeEach(() => {
        prefetchNearbySongs.mockClear();
        // A local play from a queue also warms the songs next to it a second later: not this test's subject.
        vi.stubGlobal('window', { setTimeout: vi.fn() });
    });
    afterEach(() => vi.unstubAllGlobals());

    // Without it no library song was ever analysed for automix: every transition in a local or
    // Navidrome queue had no profile at either end and came out a plain fade.
    it('asks for the songs around a local file played from a queue', async () => {
        const { library } = mount();
        await library.onPlayLocalSong(localOne, [localOne, localTwo]);

        expect(prefetchNearbySongs).toHaveBeenCalledTimes(1);
        const [current, queue] = prefetchNearbySongs.mock.calls[0] as unknown as [SongResult, SongResult[]];
        expect(current).toMatchObject({ name: 'L1' });
        expect(queue.map(song => song.name)).toEqual(['L1', 'L2']);
    });

    it('asks for the songs around a Navidrome song played from a queue', async () => {
        const { library } = mount();
        await library.onPlayNavidromeSong(navidromeSong, [navidromeSong, navidromeTwo]);

        expect(prefetchNearbySongs).toHaveBeenCalledTimes(1);
        const [current, queue] = prefetchNearbySongs.mock.calls[0] as unknown as [SongResult, SongResult[]];
        expect(current).toMatchObject({ name: 'N1' });
        expect(queue.map(song => song.name)).toEqual(['N1', 'N2']);
    });

    // A song played on its own is still measured: the volume balance needs its loudness.
    it('asks for the song itself when it is the whole queue', async () => {
        const { library } = mount();
        await library.onPlayLocalSong(localOne);
        await library.onPlayNavidromeSong(navidromeSong);

        const calls = prefetchNearbySongs.mock.calls as unknown as [SongResult, SongResult[]][];
        expect(calls.map(([current]) => current.name)).toEqual(['L1', 'N1']);
    });
});

describe('a play moved to the other engine: where it starts, whether it plays, and its toasts', () => {
    const status = () => useStatusMessageStore.getState().message;
    const aNavidromeSong = () => ({
        id: 'n1', name: 'N1', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
        isNavidrome: true, navidromeData: { id: 'n1', title: 'N1', streamUrl: 'https://navi.test/stream/n1' },
    } as unknown as NavidromeSong);
    const moved = { startAtSec: 42.5, autoplay: false, quietLoadedToast: true };

    beforeEach(() => {
        retireBlobUrl(null);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        currentTime.set(0);
    });

    it('a local file on the web route: the deck resumes there, paused, and no "loaded" toast takes the place of the one showing', async () => {
        const { refs, library } = mount();
        useStatusMessageStore.setState({ message: { type: 'error', text: 'hifi.errors.DEVICE_BUSY' } });

        await library.onPlayLocalSong(localOne, [], moved);
        await settle();

        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l1');
        expect(refs.pendingResumeTimeRef.current).toBe(42.5);
        expect(refs.shouldAutoPlay.current).toBe(false);
        expect(currentTime.get()).toBe(42.5);
        expect(usePlaybackStore.getState()).toMatchObject({ playerState: PlayerState.PAUSED, isLoadingToPlay: false });
        expect(status()).toEqual({ type: 'error', text: 'hifi.errors.DEVICE_BUSY' });
    });

    it('a local file on the HiFi route: mpv loads there, with the play\'s own answer to "still wanted"', async () => {
        const { refs, library } = mount();
        env.route = 'hifi';

        await library.onPlayLocalSong(localOne, [], { startAtSec: 42.5, autoplay: true });
        await settle();

        expect(env.hifiStarts).toHaveLength(1);
        const [start] = env.hifiStarts as Array<{ startSec: number; stillWanted?: () => boolean }>;
        expect(start.startSec).toBe(42.5);
        // The time to resume at is mpv's to take, not the deck's.
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(usePlaybackStore.getState()).toMatchObject({ isLoadingToPlay: true });
        expect(status()).toMatchObject({ type: 'success', text: 'status.localMusicLoaded' });
        expect(start.stillWanted?.()).toBe(true);
        startPlay();
        expect(start.stillWanted?.()).toBe(false);
    });

    it('a Navidrome song on the web route and on the HiFi route', async () => {
        const { refs, library } = mount();
        useStatusMessageStore.setState({ message: { type: 'error', text: 'hifi.errors.MPV_CRASHED' } });

        await library.onPlayNavidromeSong(aNavidromeSong(), [], moved);
        expect(usePlaybackStore.getState().audioSrc).toBe('https://navi.test/stream/n1');
        expect(refs.pendingResumeTimeRef.current).toBe(42.5);
        expect(refs.shouldAutoPlay.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(status()).toEqual({ type: 'error', text: 'hifi.errors.MPV_CRASHED' });

        env.route = 'hifi';
        await library.onPlayNavidromeSong(aNavidromeSong(), [], { startAtSec: 9 });
        const [start] = env.hifiStarts as Array<{ startSec: number; stillWanted?: () => boolean }>;
        expect(start.startSec).toBe(9);
        expect(start.stillWanted?.()).toBe(true);
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(status()).toMatchObject({ type: 'success', text: 'status.navidromeSongLoaded' });
    });

    it('a play with none of them starts at the beginning and plays, as before', async () => {
        const { refs, library } = mount();
        refs.pendingResumeTimeRef.current = 99;

        await library.onPlayLocalSong(localOne);
        await settle();

        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(currentTime.get()).toBe(0);
        expect(usePlaybackStore.getState().isLoadingToPlay).toBe(true);
    });

    it('a start that is not a positive number is the beginning', async () => {
        const { refs, library } = mount();

        await library.onPlayLocalSong(localOne, [], { startAtSec: Number.NaN });
        await settle();
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        await library.onPlayLocalSong(localTwo, [], { startAtSec: -3 });
        await settle();
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(currentTime.get()).toBe(0);
    });
});
