import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type LocalSong, type SongResult } from '@/types';
import type { PlaybackSnapshot, WindowPlaybackHandoff } from '@/types/appPlayback';
import type { OnlineFailureCaseId } from '@/types/onlineMusic';

// test/unit/playback/currentSongRestoreRoutes.test.ts
// Pins what the routes that bring a remembered song back write for the current song: the restore of
// the last session at launch, the handoff to a rebuilt window, the shared function that fetches the
// song's audio and lyrics again (restorePlaybackSourceForSong), and what the online recovery then
// answers when it compares its song with the key.
// The hooks run without a renderer (plain stand-ins for React's hooks, the real stores); their
// effects are collected and the test runs the one it is about. The cache, the library, the
// Navidrome server and the online services are stubs. No request leaves the test.
// The second half pins the audio address these routes write, per kind of song: where it comes from,
// what happens to the blob URL that was there, when the address counts as fetched, the cover, the
// lyrics, and what a song that cannot be brought back leaves behind.
// The last describe pins the local and Navidrome restores on the HiFi route: no address and no blob
// URL, the track handed to the HiFi service (a stub here) to take over or load at the resume time,
// and the hand-off's position taken from mpv's clock.
// After it: a new window that finds nothing to restore (at launch or from the hand-off) asks the HiFi
// service to stop the track an earlier window left playing in mpv.

const env = vi.hoisted(() => ({
    note: (_label: string) => {},
    effects: [] as Array<() => unknown>,
    cache: new Map<string, unknown>(),
    songs: [] as unknown[],
    replayGain: null as unknown,
    detail: (_label: string) => {},
    /** Local song ids whose file cannot be read. */
    unreadable: new Set<string>(),
    /** What the Navidrome server answers for the song itself. */
    serverSong: null as unknown,
    /** What the audio source answers for a song id; a plain http address when nothing is set. */
    audioResultFor: new Map<string, unknown>(),
    canPlay: true,
    cachedLyrics: null as unknown,
    /** Told by every stub that a restore waits on, with the name of the wait. */
    reached: (_wait: string) => {},
    /** The cover of a local file as the cover cache has it. */
    cachedLocalCover: null as string | null,
    /** The engine the HiFi service picks for a local or Navidrome song. */
    route: 'web' as 'web' | 'hifi',
    /** The songs the HiFi service was asked to route, as `<kind> <song key>`. */
    routesAsked: [] as string[],
    /** What the HiFi service was asked to start, with the Navidrome carrier's data as it was at the call. */
    hifiStarts: [] as Array<{ song: { name: string }; source: Record<string, unknown>; startSec: number; adoptRunning?: boolean; navidromeData?: Record<string, unknown> }>,
    /** Held until it resolves: the first answer about the mpv runtime. */
    hifiRuntimeKnown: Promise.resolve() as Promise<void>,
    /** Whether the player is on the HiFi route, and mpv's position, for the hand-off's capture. */
    onHifiRoute: false,
    hifiPosition: 0,
    /** The reasons the HiFi service was asked to stop a track an earlier window left playing. */
    released: [] as string[],
    /** How often the HiFi service was installed (it then takes its first look at mpv). */
    hifiInstalls: 0,
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
vi.mock('@/services/db', () => ({
    getFromCache: async (key: string) => { env.reached(`cache ${key}`); return env.cache.get(key) ?? null; },
    saveToCache: async () => {},
    removeFromCache: async () => {},
    getLocalSongs: async () => { env.reached('library'); return env.songs; },
}));
vi.mock('@/services/coverCache', () => ({
    getCachedCoverUrl: async () => { env.reached('cover cache'); return env.cachedLocalCover; },
    loadCachedOrFetchCover: async () => { env.reached('cover fetch'); return null; },
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
    ensureLocalSongCoverAsset: async (song: { id: string }) => { env.detail(`wait cover asset ${song.id}`); return song; },
}));
vi.mock('@/utils/lyrics/localSongLyrics', () => ({
    resolveLocalSongLyrics: async () => { env.reached('local lyrics'); return { lyrics: null, source: null }; },
}));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: async () => { env.reached('catalog'); return { entities: [], assignments: [] }; },
}));
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => ({ serverUrl: 'https://navi.test' }),
    isNavidromeEnabled: () => true,
    navidromeApi: {
        getStreamUrl: (_config: unknown, id: string, format?: string) => `https://navi.test/stream/${id}${format ? `?format=${format}` : ''}`,
        getSong: async (_config: unknown, id: string) => { env.note(`wait navidrome song ${id}`); return env.serverSong; },
    },
}));
// The HiFi service: which engine a song plays on, the start of a track on mpv (recorded), the wait for
// the first answer about the runtime, and the route and position the hand-off's capture reads.
vi.mock('@/services/hifi/hifiPlayback', () => ({
    hifiRouteFor: (kind: string, songKey: string) => { env.routesAsked.push(`${kind} ${songKey}`); return env.route; },
    beginHifiTrack: async (options: { song: { name: string }; source: Record<string, unknown> & { carrier?: { navidromeData: Record<string, unknown> } }; startSec: number; adoptRunning?: boolean }) => {
        const navidromeData = options.source.carrier ? { ...options.source.carrier.navidromeData } : undefined;
        env.hifiStarts.push({ ...options, navidromeData });
        env.note(`hifi ${options.song.name} ${String(options.source.kind)} from ${options.startSec}${options.adoptRunning ? ' adopt' : ''}`);
        return 'ready';
    },
    whenHifiRuntimeKnown: () => { env.reached('hifi runtime'); return env.hifiRuntimeKnown; },
    isHifiRoute: () => env.onHifiRoute,
    getHifiPosition: () => env.hifiPosition,
    releaseUnclaimedHifiTrack: (reason: string) => { env.released.push(reason); return false; },
    installHifiPlayback: () => { env.hifiInstalls += 1; },
}));
vi.mock('@/utils/appNavidromeLyrics', () => ({
    hydrateNavidromeLyricPayload: async () => {},
    resolvePreferredNavidromeLyrics: async () => { env.reached('navidrome lyrics'); return null; },
}));
vi.mock('@/services/onlinePlayback', () => ({
    applyOnlineAudioSourceMetadata: (song: object, replayGain: unknown) => (replayGain ? { ...song, replayGain } : song),
    loadOnlineSongAudioSource: async (song: { id: string }) => {
        env.note(`wait audio source ${song.id}`);
        return env.audioResultFor.get(song.id) ?? { kind: 'ok', audioSrc: `https://audio.test/${song.id}`, replayGain: env.replayGain };
    },
}));
vi.mock('@/utils/onlineLyricsState', () => ({
    loadOnlineLyricsState: async (song: { id: string }) => { env.note(`wait lyrics state ${song.id}`); return { lyricsSource: 'online' }; },
    resolveOnlineLyrics: (_state: unknown, lyrics: unknown) => lyrics,
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        canPlaySong: () => env.canPlay,
        getProviderLabel: (id: string) => id,
        getLyrics: async (song: { id: string }) => { env.note(`wait lyrics ${song.id}`); return { lyrics: null, isPureMusic: true }; },
    },
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    getCachedSongCoverUrl: async () => { env.reached('remembered cover'); return null; },
    getSongCacheWithLegacyMigration: async () => { env.reached('cached lyrics'); return env.cachedLyrics; },
}));
vi.mock('@/services/onlineMusic/songMetadata', () => ({ getSongCoverUrl: () => null }));
vi.mock('@/services/prefetchService', () => ({ prefetchNearbySongs: vi.fn() }));

const { restorePlaybackSourceForSong } = await import('@/components/app/playback/restore/restorePlaybackSource');
const { createOnlineRecoveryController } = await import('@/components/app/playback/restore/createOnlineRecoveryController');
const { useSessionRestoreController } = await import('@/components/app/playback/restore/useSessionRestoreController');
const { useElectronWindowPlaybackHandoff } = await import('@/components/app/playback/restore/useElectronWindowPlaybackHandoff');
const { usePlaybackRuntimeRefs } = await import('@/components/app/playback/usePlaybackRuntimeRefs');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { askedSongKeyRef, askForSong, dropPlaysInFlight, makeSongCurrent, startRestore } = await import('@/components/app/playback/currentSong');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { useHifiSettingsStore } = await import('@/stores/useHifiSettingsStore');
const { prefetchNearbySongs } = await import('@/services/prefetchService');
const { clearPlaybackRepresentationsForTests, registerPlaybackRepresentation } = await import('@/services/playbackRecovery/representationRegistry');
const { buildLocalSourceRevision } = await import('@/services/playbackRecovery/sourceRevision');
const { resetPlaybackStore, watchCurrentSong } = await import('./currentSongWatch');
const { replacePlayQueue } = await import('@/stores/usePlaybackStore');
const { noteWholeQueueWrite } = await import('@/services/wholeQueueWrites');
// Folium's replaceQueue and its undo, as a mod and the listener reach them: the real host side.
const { registerFoliumQueueWriter, replaceFoliumQueue, resetFoliumQueueReplaceForTest } = await import('@/mods/runtime/queue/hostQueueReplace');
const { undoFoliumQueueReplace } = await import('@/mods/runtime/queue/queueReplaceUndo');
const { readFoliumQueueVersion, resetFoliumQueueVersionForTest } = await import('@/mods/runtime/queue/queueVersion');
const { resolveFoliumQueueKind } = await import('@/mods/runtime/hostQueue');
const { toFoliumSong } = await import('@/mods/folium/dto');
const { onlineFailureOf } = await import('@/services/onlineMusic/failure/onlineFailureCase');
const unavailable = (caseId: OnlineFailureCaseId = 'no-audio') => ({
    kind: 'unavailable', failure: onlineFailureOf({ operation: 'audio', providerId: 'bodian' }, { detail: { case: caseId } }),
});

const onlineSong: SongResult = {
    id: 'x1', name: 'X', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'x1' },
};
const otherSong: SongResult = { ...onlineSong, id: 'y1', name: 'Y', sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'y1' } };
const localRecord = {
    id: 'l1', fileName: 'L.mp3', filePath: 'Music/L.mp3', title: 'L', titleOrigin: 'import',
    importedMetadata: { title: 'L', titleSource: 'filename', artistNames: [] },
    duration: 100, fileSize: 1, fileLastModified: 1, mimeType: 'audio/mpeg', addedAt: 1, folderName: 'Music',
} as unknown as LocalSong;
const localSong = {
    id: 'l1', name: 'L (remembered)', artists: [], album: { id: 0, name: '' }, durationMs: 100,
    isLocal: true, localRef: { songId: 'l1' }, sourceRef: { kind: 'local', mediaId: 'l1' },
} as unknown as SongResult;
const navidromeSong = {
    id: 'n1', name: 'N', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    isNavidrome: true, sourceRef: { kind: 'navidrome', mediaId: 'n1' },
    navidromeData: { id: 'n1', name: 'N', navidromeData: { id: 'n1' } },
} as unknown as SongResult;

beforeEach(() => {
    resetPlaybackStore();
    env.effects.length = 0;
    env.cache.clear();
    env.songs = [localRecord];
    env.replayGain = null;
    env.unreadable.clear();
    env.serverSong = null;
    env.audioResultFor.clear();
    env.canPlay = true;
    env.cachedLyrics = null;
    env.reached = () => {};
    env.cachedLocalCover = null;
    env.route = 'web';
    env.routesAsked.length = 0;
    env.hifiStarts.length = 0;
    env.hifiRuntimeKnown = Promise.resolve();
    env.onHifiRoute = false;
    env.hifiPosition = 0;
    env.released.length = 0;
    env.hifiInstalls = 0;
    useHifiSettingsStore.setState({ enabled: false });
    useAudioSettingsStore.setState({ autoPlayOnLaunch: false });
    vi.mocked(prefetchNearbySongs).mockClear();
    clearPlaybackRepresentationsForTests();
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    env.note = () => {};
    env.detail = () => {};
    vi.restoreAllMocks();
    resetPlaybackStore();
    vi.unstubAllGlobals();
});

function watchWithRefs({ address = false } = {}) {
    const refs = usePlaybackRuntimeRefs();
    const watch = watchCurrentSong(refs.currentSongRef, address ? refs : undefined);
    env.note = label => { watch.note(label); env.reached(label); };
    env.detail = label => { watch.detail(label); env.reached(label); };
    env.effects.length = 0;
    return { refs, watch, setLyrics: (lyrics: unknown) => watch.note(`lyrics=${lyrics ? 'set' : 'null'}`) };
}
const effectNaming = (text: string) => {
    const found = env.effects.filter(effect => String(effect).includes(text));
    expect(found).toHaveLength(1);
    return found[0];
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const sourceParams = (refs: ReturnType<typeof usePlaybackRuntimeRefs>, setLyrics: (lyrics: unknown) => void, queue: SongResult[]) => ({
    audioQuality: 'high',
    blobUrlRef: refs.blobUrlRef,
    currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
    setLyrics,
    queue,
    // Taken as the two routes take it: once the song is current, before the restore's first wait.
    stillWanted: startRestore(),
} as never);

/**
 * A mod's replaceQueue of `songs` on the queue as it is now, through the host's own replacement (so that its
 * undo is the real one), with the App's save recorded into `saved`. Undone with `undoFoliumQueueReplace`.
 */
const replaceAsAMod = (songs: SongResult[], saved: SongResult[][]) => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    registerFoliumQueueWriter({ persist: async (_song, queue) => { saved.push(queue); }, refreshPrefetch: () => {} });
    const state = usePlaybackStore.getState();
    const result = replaceFoliumQueue('mod-x', songs.map(song => toFoliumSong(song)!.ref!), readFoliumQueueVersion(state.playQueue, resolveFoliumQueueKind(state)));
    expect(result.status).toBe('replaced');
};
afterEach(() => {
    registerFoliumQueueWriter(null);
    resetFoliumQueueReplaceForTest();
    resetFoliumQueueVersionForTest();
});

/** The online recovery, built as App builds it: from the store's song. */
const recoveryFor = (audioSrc: string) => createOnlineRecoveryController({
    audioQuality: 'high',
    currentSong: usePlaybackStore.getState().currentSong,
    audioSrc,
    audioRef: { current: { currentTime: 3, currentSrc: audioSrc } },
    blobUrlRef: { current: null },
    shouldAutoPlayRef: { current: false },
    pendingResumeTimeRef: { current: null },
    onlinePlaybackRecoveryRef: { current: new Map() },
    lastAudioRecoverySourceRef: { current: null },
    currentOnlineAudioUrlFetchedAtRef: { current: null },
    persistLastPlaybackCache: vi.fn(async () => undefined),
    onlineAudioUrlTtlMs: 60_000,
    onlineAudioUrlRefreshBufferMs: 5_000,
} as never);

describe('fetching a remembered song\'s source again (restorePlaybackSourceForSong)', () => {
    it('online: only patches the song it was given, and the key is not touched', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        makeSongCurrent(onlineSong);
        env.replayGain = { trackGain: -3 };
        watch.take();

        await restorePlaybackSourceForSong(onlineSong, sourceParams(refs, setLyrics, [onlineSong]));

        expect(watch.take()).toEqual([
            'cover=null key=online:bodian:x1',
            'wait lyrics state x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'wait audio source x1 | song=X key=online:bodian:x1',
            'audio=https://audio.test/x1 key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'wait lyrics x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'lyrics=null | song=X key=online:bodian:x1',
        ]);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({
            id: 'x1', onlineLyricsState: { lyricsSource: 'online' }, replayGain: { trackGain: -3 }, isPureMusic: true,
        });
    });

    it('online: writes nothing when another song is the one asked for', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        makeSongCurrent(otherSong);
        env.replayGain = { trackGain: -3 };
        watch.take();

        await expect(restorePlaybackSourceForSong(onlineSong, sourceParams(refs, setLyrics, [onlineSong]))).resolves.toBe('stale');

        expect(watch.take()).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBe(otherSong);
    });

    it('Navidrome: shows the rebuilt song in the place of the remembered one, and the key stays on it', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        makeSongCurrent(navidromeSong);
        watch.take();

        await restorePlaybackSourceForSong(navidromeSong, sourceParams(refs, setLyrics, [navidromeSong]));

        expect(watch.take()).toEqual([
            'cover=null key=navidrome:n1',
            'wait navidrome song n1 | song=N key=navidrome:n1',
            'audio=https://navi.test/stream/n1 key=navidrome:n1',
            'lyrics=null | song=N key=navidrome:n1',
            'song=N key=navidrome:n1',
        ]);
        expect(refs.currentSongRef.current).toBe('navidrome:n1');
        expect(usePlaybackStore.getState().currentSong?.playbackSourceRevision).toEqual(expect.any(String));
    });

    it('a local file: shows the rebuilt song in the place of the remembered one, and the key stays on it', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        makeSongCurrent(localSong);
        watch.take();

        await restorePlaybackSourceForSong(localSong, sourceParams(refs, setLyrics, [localSong]));

        expect(watch.take()).toEqual([
            'cover=null key=local:l1',
            'wait local file l1 | song=L (remembered) key=local:l1',
            'song=L key=local:l1',
            'audio=blob:l1 key=local:l1',
            'lyrics=null | song=L key=local:l1',
            'cover=null key=local:l1',
        ]);
    });

    it('a local file found again under another id: the key follows the rebuilt song', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        // Remembered under an id the library no longer has; found by its title and length.
        const remembered = { ...localSong, id: 'gone', name: 'L', localRef: { songId: 'gone' }, sourceRef: { kind: 'local', mediaId: 'gone' } } as unknown as SongResult;
        makeSongCurrent(remembered);
        watch.take();

        await restorePlaybackSourceForSong(remembered, sourceParams(refs, setLyrics, [remembered]));

        expect(watch.take().slice(0, 3)).toEqual([
            'cover=null key=local:gone',
            'wait local file l1 | song=L key=local:gone',
            'song=L key=local:l1',
        ]);
        expect(refs.currentSongRef.current).toBe('local:l1');
    });

    it('a local file: writes nothing when another song was asked for in the meantime, and that ask keeps the key', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        makeSongCurrent(localSong);
        // A play of another song has asked for it and is still waiting to show it.
        askForSong(otherSong);
        watch.take();

        await expect(restorePlaybackSourceForSong(localSong, sourceParams(refs, setLyrics, [localSong]))).resolves.toBe('stale');

        expect(watch.take()).toEqual([]);
        expect(refs.currentSongRef.current).toBe('online:bodian:y1');
    });
});

describe('restoring the last session and the current song', () => {
    const restoreLastSession = (refs: ReturnType<typeof usePlaybackRuntimeRefs>, setLyrics: (lyrics: unknown) => void) => {
        env.cache.set('last_song', onlineSong);
        env.cache.set('last_queue', [onlineSong, otherSong]);
        useSessionRestoreController({
            blobUrlRef: refs.blobUrlRef,
            currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
            setLyrics,
            restoreCachedThemeForSong: vi.fn(async () => 'none'),
            persistLastPlaybackCache: vi.fn(async () => undefined),
            clearPersistedStagePlaybackCache: vi.fn(async () => undefined),
            loadLocalSongs: vi.fn(async () => undefined),
            loadLocalPlaylists: vi.fn(async () => undefined),
            shouldAutoPlayRef: refs.shouldAutoPlay,
        } as never);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // The effect that reads the remembered song from the cache: the only one that names it.
        return effectNaming('last_song');
    };

    it('gives up when a song was asked for while the remembered one was being read', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        const restore = restoreLastSession(refs, setLyrics);
        // Asked for from inside the read, not before the restore starts: a check made before the
        // reads would not see it.
        env.reached = wait => { if (wait === 'cache last_song') askForSong(otherSong); };

        restore();
        await settle();

        expect(watch.take()).toEqual([]);
        expect(refs.currentSongRef.current).toBe('online:bodian:y1');
    });

    it('does not leave the intent to play standing when no source lands for the remembered song', async () => {
        const { refs, setLyrics } = watchWithRefs();
        useAudioSettingsStore.setState({ autoPlayOnLaunch: true });
        // The remembered song has no address any more: the restore answers no, without throwing.
        env.audioResultFor.set('x1', unavailable());

        restoreLastSession(refs, setLyrics)();
        await settle();

        expect(refs.currentSongRef.current).toBe('online:bodian:x1');
        expect(usePlaybackStore.getState().audioSrc).toBeNull();
        expect(refs.shouldAutoPlay.current).toBe(false);
    });

    it('leaves the intent to play and the prefetch to the play that overtook the restore', async () => {
        const { refs, setLyrics } = watchWithRefs();
        useAudioSettingsStore.setState({ autoPlayOnLaunch: true });
        // Another song is asked for while the remembered one's address is fetched, as its play does.
        env.reached = wait => {
            if (!wait.startsWith('wait audio source')) return;
            askForSong(otherSong);
            refs.shouldAutoPlay.current = true;
        };

        restoreLastSession(refs, setLyrics)();
        await settle();

        expect(refs.currentSongRef.current).toBe('online:bodian:y1');
        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(prefetchNearbySongs).not.toHaveBeenCalled();
    });

    it('leaves the intent to play, the prefetch and the message to a play of the SAME song that overtook the restore', async () => {
        const { refs, setLyrics } = watchWithRefs();
        // The restore itself would find no address and say so.
        env.audioResultFor.set('x1', unavailable());
        // The remembered song is played from a list while its address is fetched, as its play does.
        env.reached = wait => {
            if (!wait.startsWith('wait audio source')) return;
            askForSong(onlineSong);
            refs.shouldAutoPlay.current = true;
        };

        restoreLastSession(refs, setLyrics)();
        await settle();

        expect(refs.shouldAutoPlay.current).toBe(true);
        expect(prefetchNearbySongs).not.toHaveBeenCalled();
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('makes the remembered song current, so the online recovery takes a fresh address for it', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        restoreLastSession(refs, setLyrics)();
        await settle();

        expect(watch.take()).toEqual([
            'song=X key=online:bodian:x1',
            'queue=[X,Y] key=online:bodian:x1',
            'cover=null key=online:bodian:x1',
            'wait lyrics state x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'wait audio source x1 | song=X key=online:bodian:x1',
            'audio=https://audio.test/x1 key=online:bodian:x1',
            'wait lyrics x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'lyrics=null | song=X key=online:bodian:x1',
        ]);
        expect(refs.currentSongRef.current).toBe('online:bodian:x1');

        // The restored song's address stops working: the recovery fetches a new one, compares its
        // song with the key, and keeps the new address.
        const recovery = recoveryFor('https://audio.test/x1');
        await expect(recovery.recoverOnlinePlaybackSource({ failedSrc: 'https://audio.test/x1', autoplay: true })).resolves.toEqual({ recovered: true });
        expect(watch.take()).toEqual([
            'wait audio source x1 | song=X key=online:bodian:x1',
            'audio=https://audio.test/x1 key=online:bodian:x1',
        ]);
    });
});

describe('the handoff to a rebuilt window and the current song', () => {
    const snapshotOf = (song: SongResult | null): PlaybackSnapshot => ({
        currentSong: song, lyrics: null, cachedCoverUrl: null, audioSrc: song ? 'https://audio.test/old' : null,
        playQueue: song ? [song, otherSong] : [], isFmMode: false, playerState: PlayerState.PAUSED,
        currentTime: 12, duration: 100, currentLineIndex: -1,
    });
    const handoffOf = (snapshot: PlaybackSnapshot | null) => ({
        version: 1, capturedAt: 0, activePlaybackContext: 'main', mainPlayback: snapshot, activePlayback: snapshot,
        stage: { status: null, source: null, playback: null, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
        nowPlaying: { track: null, lyricPayload: null, paused: true, progressMs: 0, progressQuality: 'coarse', displayTimeSec: 0 },
        ui: { currentView: 'home', playerChromeHidden: false, mainWindowBorderVisible: false, transparentModeEnabled: false },
    } as unknown as WindowPlaybackHandoff);
    const restoreFrom = async (snapshot: PlaybackSnapshot | null, askedMeanwhile: SongResult | null = null, duringTheRead?: () => void) => {
        const { refs, watch, setLyrics } = watchWithRefs();
        const persistLastPlaybackCache = vi.fn(async (_song: SongResult | null, _queue: SongResult[]) => undefined);
        askForSong(null);
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
        vi.stubGlobal('window', { electron: { consumeWindowPlaybackHandoff: async () => {
            // Asked for while the main process answers, not before the restore starts: a check
            // made before this wait would not see it.
            if (askedMeanwhile) askForSong(askedMeanwhile);
            duringTheRead?.();
            return handoffOf(snapshot);
        } } });
        useElectronWindowPlaybackHandoff({
            isElectronWindow: true,
            navigateToPlayer: vi.fn(),
            audioRef: refs.audioRef,
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
            restoreStagePlaybackHandoff: vi.fn(async () => undefined),
            setLyrics,
            setIsLyricsLoading: vi.fn(),
            blobUrlRef: refs.blobUrlRef,
            shouldAutoPlayRef: refs.shouldAutoPlay,
            pendingResumeTimeRef: refs.pendingResumeTimeRef,
            lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef,
            currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
            applyTransparentPlayerBackground: vi.fn(),
            restoreCachedThemeForSong: vi.fn(async () => 'none'),
            persistLastPlaybackCache,
        } as never);
        // The effect that asks the main process for the handoff: the only one that makes this call.
        effectNaming('consumeWindowPlaybackHandoff()')();
        await settle();
        return { refs, watch, persistLastPlaybackCache };
    };

    it('makes the handed-over song current, the store and the key together', async () => {
        const { refs, watch } = await restoreFrom(snapshotOf(onlineSong));

        expect(watch.take()).toEqual([
            'song=X key=online:bodian:x1',
            'lyrics=null | song=X key=online:bodian:x1',
            'cover=null key=online:bodian:x1',
            'audio=null key=online:bodian:x1',
            'queue=[X,Y] key=online:bodian:x1',
            'cover=null key=online:bodian:x1',
            'wait lyrics state x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'wait audio source x1 | song=X key=online:bodian:x1',
            'audio=https://audio.test/x1 key=online:bodian:x1',
            'wait lyrics x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
            'lyrics=null | song=X key=online:bodian:x1',
        ]);
        expect(refs.currentSongRef.current).toBe('online:bodian:x1');
    });

    it('restores nothing over a song that was asked for in the new window meanwhile', async () => {
        const withSong = await restoreFrom(snapshotOf(onlineSong), otherSong);
        expect(withSong.watch.take()).toEqual([]);
        expect(withSong.refs.currentSongRef.current).toBe('online:bodian:y1');

        const withNone = await restoreFrom(snapshotOf(null), otherSong);
        expect(withNone.watch.take()).toEqual([]);
        expect(withNone.refs.currentSongRef.current).toBe('online:bodian:y1');
    });

    it('leaves a queue a mod replaced whole while the handoff was read, and the FM it ended, and hands the song over all the same', async () => {
        const modQueue = [otherSong];
        const { refs } = await restoreFrom({ ...snapshotOf(onlineSong), isFmMode: true }, null, () => {
            noteWholeQueueWrite();
            replacePlayQueue(modQueue, false);
        });

        expect(usePlaybackStore.getState().playQueue).toBe(modQueue);
        expect(usePlaybackStore.getState().isFmMode).toBe(false);
        expect(refs.currentSongRef.current).toBe('online:bodian:x1');
        expect(usePlaybackStore.getState().audioSrc).toBe('https://audio.test/x1');
    });

    it('saves the mod\'s queue once the handed-over song is current: the replacement found no song to save it with', async () => {
        // An online song without replay gain: the source's restore saves nothing of its own.
        const modQueue = [otherSong];
        const { persistLastPlaybackCache } = await restoreFrom(snapshotOf(onlineSong), null, () => {
            noteWholeQueueWrite();
            replacePlayQueue(modQueue, false);
        });

        expect(persistLastPlaybackCache).toHaveBeenLastCalledWith(onlineSong, modQueue);
    });

    it('the undo of a replacement made while the handoff was read puts back the handed-over queue and its FM, not the new window\'s empty queue', async () => {
        const handedOver = { ...snapshotOf(onlineSong), isFmMode: true };
        const saved: SongResult[][] = [];
        await restoreFrom(handedOver, null, () => replaceAsAMod([otherSong], saved));
        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['y1']);

        expect(undoFoliumQueueReplace()).toBe(true);

        expect(usePlaybackStore.getState().playQueue).toBe(handedOver.playQueue);
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
        expect(saved.at(-1)).toBe(handedOver.playQueue);
    });

    it('leaves no song current when none was handed over', async () => {
        const { refs, watch } = await restoreFrom(snapshotOf(null));

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

describe('the online recovery and the key', () => {
    it('throws a fresh address away when the key is another song\'s', async () => {
        const { watch } = watchWithRefs();
        usePlaybackStore.setState({ currentSong: onlineSong, playQueue: [onlineSong] });
        askForSong(otherSong);
        const recovery = recoveryFor('https://audio.test/old');

        await expect(recovery.recoverOnlinePlaybackSource({ failedSrc: 'https://audio.test/old', autoplay: true })).resolves.toEqual({ recovered: false, stale: true });

        expect(watch.take().filter(line => !line.startsWith('wait'))).toEqual([]);
    });

    it('takes the fresh address and patches the song when the key is its song\'s, and does not write the key', async () => {
        const { watch } = watchWithRefs();
        usePlaybackStore.setState({ currentSong: onlineSong, playQueue: [onlineSong] });
        env.replayGain = { trackGain: -3 };
        askForSong(onlineSong);
        const recovery = recoveryFor('https://audio.test/old');

        await expect(recovery.recoverOnlinePlaybackSource({ failedSrc: 'https://audio.test/old', autoplay: true })).resolves.toEqual({ recovered: true });

        expect(watch.take().map(line => line.replace(/ key=.*$/, ''))).toEqual([
            'wait audio source x1 | song=X',
            'song~X',
            'queue=[X]',
            'audio=https://audio.test/x1',
        ]);
        expect(askedSongKeyRef.current).toBe('online:bodian:x1');
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ id: 'x1', replayGain: { trackGain: -3 } });
    });
});

describe('the audio address a restore writes, per kind of song', () => {
    const status = () => useStatusMessageStore.getState().message;
    const representation = (songKey: string, sourceRevision: string) => ({
        songKey, sourceRevision, representationId: 'transcoded', url: `blob:transcoded-${songKey}`,
    } as never);
    /** A restore of `song` into a player that still holds a blob URL and a fetch time. */
    const restore = async (song: SongResult) => {
        const { refs, watch, setLyrics } = watchWithRefs({ address: true });
        makeSongCurrent(song);
        refs.blobUrlRef.current = 'blob:before';
        refs.currentOnlineAudioUrlFetchedAtRef.current = 777;
        watch.take();
        const restored = await restorePlaybackSourceForSong(song, sourceParams(refs, setLyrics, [song]));
        return { refs, restored, log: watch.take() };
    };

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(5000);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('Navidrome: the stream address with no fetch time, the server\'s gain, the cover, the revision; a copy the browser can play is not looked for', async () => {
        const song = structuredClone(navidromeSong) as SongResult & { navidromeData: { navidromeData: Record<string, unknown> } };
        song.navidromeData.navidromeData.coverArtUrl = 'https://navi.test/cover/n1';
        env.serverSong = { replayGain: { trackGain: -4 } };
        registerPlaybackRepresentation(representation('navidrome:n1', 'n1:::1000:https://navi.test/stream/n1'));

        const { restored, log } = await restore(song);

        expect(log).toEqual([
            'cover=null key=navidrome:n1',
            'wait navidrome song n1 | song=N key=navidrome:n1',
            'audio=https://navi.test/stream/n1 key=navidrome:n1 blobRef=blob:before fetchedAt=null',
            'cover=https://navi.test/cover/n1 key=navidrome:n1',
            'lyrics=null | song=N key=navidrome:n1',
            'song=N key=navidrome:n1',
        ]);
        expect(restored).toBe('restored');
        expect(song.navidromeData.navidromeData.replayGain).toEqual({ trackGain: -4 });
        expect(usePlaybackStore.getState().currentSong?.playbackSourceRevision).toBe('n1:::1000:https://navi.test/stream/n1');
        expect(env.routesAsked).toEqual(['navidrome navidrome:n1']);
        expect(env.hifiStarts).toEqual([]);
    });

    it('a local file: the blob URL that was there is revoked at once, the new one has no fetch time; a copy the browser can play is not looked for', async () => {
        registerPlaybackRepresentation(representation('local:l1', buildLocalSourceRevision(localRecord)));

        const { refs, restored, log } = await restore(localSong);

        expect(log).toEqual([
            'cover=null key=local:l1',
            'wait local file l1 | song=L (remembered) key=local:l1',
            'wait cover asset l1',
            'song=L key=local:l1',
            'revoke blob:before',
            'audio=blob:l1 key=local:l1 blobRef=blob:l1 fetchedAt=null',
            'lyrics=null | song=L key=local:l1',
            'cover=null key=local:l1',
        ]);
        expect(restored).toBe('restored');
        expect(refs.blobUrlRef.current).toBe('blob:l1');
        expect(env.routesAsked).toEqual(['local local:l1']);
        expect(env.hifiStarts).toEqual([]);
    });

    it('a local file that cannot be read, or is no longer in the library: no address, and the listener is told which', async () => {
        env.unreadable.add('l1');
        const unreadable = await restore(localSong);
        expect(unreadable.log.filter(line => /^(audio|song|revoke)/.test(line))).toEqual([]);
        expect(unreadable.restored).toBe('failed');
        expect(status()).toMatchObject({ type: 'info', text: 'status.localFileReauthorize' });

        env.songs = [];
        const gone = await restore(localSong);
        expect(gone.log.filter(line => /^(audio|song|revoke|wait local)/.test(line))).toEqual([]);
        expect(gone.restored).toBe('failed');
        expect(status()).toMatchObject({ type: 'info', text: 'status.localSongNotInLibrary' });
    });

    it('online, an http address: it counts as fetched now, and the blob URL that was there stays', async () => {
        const { log } = await restore(onlineSong);

        expect(log.filter(line => /^(audio|revoke)/.test(line))).toEqual([
            'audio=https://audio.test/x1 key=online:bodian:x1 blobRef=blob:before fetchedAt=5000',
        ]);
    });

    it('online, an address that is neither a blob nor http: it counts as fetched now too', async () => {
        env.audioResultFor.set('x1', { kind: 'ok', audioSrc: 'folia-ytm://audio/x1?k=one' });

        const { log } = await restore(onlineSong);

        expect(log.filter(line => /^(audio|revoke)/.test(line))).toEqual([
            'audio=folia-ytm://audio/x1?k=one key=online:bodian:x1 blobRef=blob:before fetchedAt=5000',
        ]);
    });

    it('online, a copy from the media cache: the blob URL that was there is revoked at once, the copy has no fetch time', async () => {
        env.audioResultFor.set('x1', { kind: 'ok', audioSrc: 'blob:copy-x1', blobUrl: 'blob:copy-x1' });

        const { log } = await restore(onlineSong);

        expect(log.filter(line => /^(audio|revoke)/.test(line))).toEqual([
            'revoke blob:before',
            'audio=blob:copy-x1 key=online:bodian:x1 blobRef=blob:copy-x1 fetchedAt=null',
        ]);
    });

    it('online, a song its platform cannot play: the address is not asked for, and the listener is told', async () => {
        env.canPlay = false;

        const { restored, log } = await restore(onlineSong);

        expect(log).toEqual([
            'cover=null key=online:bodian:x1',
            'wait lyrics state x1 | song=X key=online:bodian:x1',
            'song~X key=online:bodian:x1',
        ]);
        expect(restored).toBe('failed');
        expect(status()).toMatchObject({ type: 'error', text: 'status.playbackFailed' });
    });

    it('online, an address that is refused: no address is written, and what went wrong is said, with no button', async () => {
        const said: string[] = [];
        for (const caseId of ['preview-only', 'sign-in-needed', 'subscription-required', 'region-restricted', 'unreachable', 'unknown'] as const) {
            env.audioResultFor.set('x1', unavailable(caseId));
            const { restored, log } = await restore(onlineSong);
            expect(log.filter(line => /^(audio|revoke)/.test(line))).toEqual([]);
            expect(restored).toBe('failed');
            expect(status()?.onAction).toBeUndefined();
            said.push(`${status()?.text} ${status()?.note ?? '-'}`);
        }

        expect(said).toEqual([
            'status.songPreviewOnly -', 'failure.signInNeeded failure.noteSignIn', 'status.songSubscriptionRequired -', 'status.songRegionRestricted -',
            'failure.unreachable failure.noteCheckNetwork', 'status.playbackFailed failure.noteUnknown',
        ]);
    });

    it('online, lyrics kept in the cache are used and the platform is not asked for them', async () => {
        env.cachedLyrics = { lines: [{ fullText: 'la', startTime: 0, endTime: 1, words: [] }] };

        const { log } = await restore(onlineSong);

        expect(log.slice(-3)).toEqual([
            'audio=https://audio.test/x1 key=online:bodian:x1 blobRef=blob:before fetchedAt=5000',
            'song~X key=online:bodian:x1',
            'lyrics=set | song=X key=online:bodian:x1',
        ]);
    });
});

describe('the audio address the online recovery writes', () => {
    const recover = async (result: unknown) => {
        const blobUrlRef = { current: 'blob:before' as string | null };
        const currentOnlineAudioUrlFetchedAtRef = { current: 777 as number | null };
        const shouldAutoPlayRef = { current: false };
        const pendingResumeTimeRef = { current: null as number | null };
        askForSong(onlineSong);
        usePlaybackStore.setState({ currentSong: onlineSong, playQueue: [onlineSong] });
        const watch = watchCurrentSong(askedSongKeyRef, { blobUrlRef, currentOnlineAudioUrlFetchedAtRef });
        env.note = watch.note;
        env.detail = watch.detail;
        env.audioResultFor.set('x1', result);
        const recovery = createOnlineRecoveryController({
            audioQuality: 'high',
            currentSong: onlineSong,
            audioSrc: 'https://audio.test/old',
            audioRef: { current: { currentTime: 3, currentSrc: 'https://audio.test/old' } },
            blobUrlRef,
            shouldAutoPlayRef,
            pendingResumeTimeRef,
            onlinePlaybackRecoveryRef: { current: new Map() },
            lastAudioRecoverySourceRef: { current: null },
            currentOnlineAudioUrlFetchedAtRef,
            persistLastPlaybackCache: vi.fn(async () => undefined),
            onlineAudioUrlTtlMs: 60_000,
            onlineAudioUrlRefreshBufferMs: 5_000,
        } as never);
        const outcome = await recovery.recoverOnlinePlaybackSource({ failedSrc: 'https://audio.test/old', autoplay: true });
        return { recovered: outcome.recovered, outcome, log: watch.take(), blobUrlRef, shouldAutoPlayRef, pendingResumeTimeRef };
    };

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(5000);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
    });

    it('a copy from the media cache: the blob URL that was there is revoked at once, the copy has no fetch time, and playback goes on from where it was', async () => {
        const { recovered, log, shouldAutoPlayRef, pendingResumeTimeRef } = await recover({ kind: 'ok', audioSrc: 'blob:copy-x1', blobUrl: 'blob:copy-x1' });

        expect(log).toEqual([
            'wait audio source x1 | song=X key=online:bodian:x1',
            'revoke blob:before',
            'audio=blob:copy-x1 key=online:bodian:x1 blobRef=blob:copy-x1 fetchedAt=null',
        ]);
        expect([recovered, shouldAutoPlayRef.current, pendingResumeTimeRef.current]).toEqual([true, true, 3]);
    });

    it('an address that is not a blob, http or not: it counts as fetched now, and no blob URL is left to hand over', async () => {
        const http = await recover({ kind: 'ok', audioSrc: 'https://audio.test/new' });
        expect(http.log.slice(1)).toEqual([
            'revoke blob:before',
            'audio=https://audio.test/new key=online:bodian:x1 blobRef=null fetchedAt=5000',
        ]);

        const other = await recover({ kind: 'ok', audioSrc: 'folia-ytm://audio/x1?k=two' });
        expect(other.log.slice(1)).toEqual([
            'revoke blob:before',
            'audio=folia-ytm://audio/x1?k=two key=online:bodian:x1 blobRef=null fetchedAt=5000',
        ]);
    });

    it('an address that is refused: nothing is written, the blob URL that was there stays, and why is handed on', async () => {
        const { recovered, outcome, log, blobUrlRef, shouldAutoPlayRef } = await recover(unavailable('sign-in-needed'));

        expect(log).toEqual(['wait audio source x1 | song=X key=online:bodian:x1']);
        expect([recovered, blobUrlRef.current, shouldAutoPlayRef.current]).toEqual([false, 'blob:before', false]);
        expect(outcome).toMatchObject({ failure: { case: 'sign-in-needed' } });
    });
});

describe('a restore that is overtaken', () => {
    const coverMatchedOnline = { ...localRecord, useOnlineCover: true, onlineMetadata: { coverUrl: 'https://cover.test/l1' } } as LocalSong;
    const copy = { kind: 'ok', audioSrc: 'blob:copy-x1', blobUrl: 'blob:copy-x1' };
    /** Restores `song`; another song is asked for while the restore waits on `wait`. Answers what it wrote after that. */
    const overtakenDuring = async (song: SongResult, wait: string) => {
        const { refs, watch, setLyrics } = watchWithRefs({ address: true });
        const persistLastPlaybackCache = vi.fn(async () => undefined);
        makeSongCurrent(song);
        let asked = false;
        env.reached = reachedWait => {
            if (asked || !reachedWait.startsWith(wait)) return;
            asked = true;
            askForSong(otherSong);
            watch.take();
        };
        const restored = await restorePlaybackSourceForSong(song, { ...sourceParams(refs, setLyrics, [song]) as object, persistLastPlaybackCache } as never);
        expect(asked).toBe(true);
        return { restored, persistLastPlaybackCache, wrote: watch.take().filter(line => !line.startsWith('wait')) };
    };

    beforeEach(() => {
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
    });

    it.each([
        ['Navidrome', 'wait navidrome song', navidromeSong],
        ['Navidrome', 'navidrome lyrics', navidromeSong],
        ['a local file', 'library', localSong],
        ['a local file', 'local lyrics', localSong],
        ['a local file', 'cover cache', localSong],
        ['a local file', 'cover fetch', localSong],
        ['online', 'remembered cover', onlineSong],
        ['online', 'wait lyrics state', onlineSong],
        ['online', 'cached lyrics', onlineSong],
        ['online', 'wait lyrics x1', onlineSong],
    ] as const)('%s, another song asked for during "%s": nothing more is written, and the last-playback record is left alone', async (_kind, wait, song) => {
        env.songs = [coverMatchedOnline];
        // With lyrics or a cover in the cache the restore would write them right after that read.
        env.cachedLyrics = wait === 'cached lyrics' ? { lines: [{ fullText: 'la', startTime: 0, endTime: 1, words: [] }] } : null;
        env.cachedLocalCover = wait === 'cover cache' ? 'blob:cached-cover' : null;

        const { restored, persistLastPlaybackCache, wrote } = await overtakenDuring(structuredClone(song) as SongResult, wait);

        expect(wrote).toEqual([]);
        expect(restored).toBe('stale');
        expect(persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    it.each([
        ['a local file, during the reading of the file', 'wait local file', localSong, ['revoke blob:l1']],
        ['a local file, during the reading of the catalog', 'catalog', localSong, ['revoke blob:l1']],
        ['online, during the fetch of a copy from the media cache', 'wait audio source', onlineSong, ['revoke blob:copy-x1']],
    ] as const)('%s: the blob URL it just made is given back, and nothing else is written', async (_what, wait, song, expected) => {
        env.audioResultFor.set('x1', copy);

        const { restored, wrote } = await overtakenDuring(song, wait);

        expect(wrote).toEqual(expected);
        expect(restored).toBe('stale');
    });

    it('a local file that cannot be read, another song asked for during the reading: the listener is not told about the old song', async () => {
        env.unreadable.add('l1');

        const { restored, wrote } = await overtakenDuring(localSong, 'wait local file');

        expect(wrote).toEqual([]);
        expect(restored).toBe('stale');
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('a local file found again under another id is restored to the end: the key it compares with follows the rebuilt song', async () => {
        const { refs, watch, setLyrics } = watchWithRefs();
        const remembered = { ...localSong, id: 'gone', name: 'L', localRef: { songId: 'gone' }, sourceRef: { kind: 'local', mediaId: 'gone' } } as unknown as SongResult;
        makeSongCurrent(remembered);
        watch.take();

        await expect(restorePlaybackSourceForSong(remembered, sourceParams(refs, setLyrics, [remembered]))).resolves.toBe('restored');

        expect(watch.take().slice(-2)).toEqual(['lyrics=null | song=L key=local:l1', 'cover=null key=local:l1']);
    });

    it.each([
        ['a local file, during the reading of the library', 'library', localSong, []],
        ['a local file, during the reading of the file', 'wait local file', localSong, ['revoke blob:l1']],
        ['a local file, during the reading of the catalog', 'catalog', localSong, ['revoke blob:l1']],
        ['Navidrome, during the server\'s answer', 'wait navidrome song', navidromeSong, []],
        ['online, during the reading of the lyrics state', 'wait lyrics state', onlineSong, []],
        ['online, during the fetch of a copy from the media cache', 'wait audio source', onlineSong, ['revoke blob:copy-x1']],
    ] as const)('%s, a play of the SAME song lands: the restore ends, and the play keeps its address and its blob URL', async (_what, wait, song, expected) => {
        env.audioResultFor.set('x1', copy);
        const { refs, watch, setLyrics } = watchWithRefs({ address: true });
        const persistLastPlaybackCache = vi.fn(async () => undefined);
        makeSongCurrent(song);
        const stillWanted = startRestore();
        let played = false;
        env.reached = reachedWait => {
            if (played || !reachedWait.startsWith(wait)) return;
            played = true;
            // What a play writes when its own wait ends: its blob URL, the ask, the address.
            refs.blobUrlRef.current = 'blob:of-the-play';
            askForSong(song);
            usePlaybackStore.getState().setAudioSrc('blob:of-the-play');
            watch.take();
        };

        const restored = await restorePlaybackSourceForSong(song, { ...sourceParams(refs, setLyrics, [song]) as object, persistLastPlaybackCache, stillWanted } as never);

        expect(played).toBe(true);
        expect(watch.take().filter(line => !line.startsWith('wait'))).toEqual(expected);
        expect(restored).toBe('stale');
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:of-the-play');
        expect(refs.blobUrlRef.current).toBe('blob:of-the-play');
        expect(persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    it('ends when the plays in flight are dropped, also while its song is still the one asked for', async () => {
        const { refs, watch, setLyrics } = watchWithRefs({ address: true });
        makeSongCurrent(onlineSong);
        const stillWanted = startRestore();
        // What opening the stage does before it asks for the stage's song.
        env.reached = reachedWait => { if (reachedWait.startsWith('wait audio source')) dropPlaysInFlight(); };
        watch.take();

        await expect(restorePlaybackSourceForSong(onlineSong, { ...sourceParams(refs, setLyrics, [onlineSong]) as object, stillWanted } as never)).resolves.toBe('stale');

        expect(watch.take().filter(line => line.startsWith('audio'))).toEqual([]);
    });
});

describe('the handoff to a rebuilt window when the song cannot be fetched again', () => {
    const handoffWith = (snapshot: PlaybackSnapshot) => ({
        version: 1, capturedAt: 0, activePlaybackContext: 'main', mainPlayback: snapshot, activePlayback: snapshot,
        stage: { status: null, source: null, playback: null, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
        nowPlaying: { track: null, lyricPayload: null, paused: true, progressMs: 0, progressQuality: 'coarse', displayTimeSec: 0 },
        ui: { currentView: 'home', playerChromeHidden: false, mainWindowBorderVisible: false, transparentModeEnabled: false },
    } as unknown as WindowPlaybackHandoff);
    const handOver = async (askedMeanwhile: SongResult | null) => {
        // A new window: nothing is asked for yet.
        resetPlaybackStore();
        const { refs, watch, setLyrics } = watchWithRefs();
        env.audioResultFor.set('x1', unavailable());
        if (askedMeanwhile) {
            env.reached = wait => { if (wait.startsWith('wait audio source')) askForSong(askedMeanwhile); };
        }
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
        vi.stubGlobal('window', { electron: { consumeWindowPlaybackHandoff: async () => handoffWith({
            currentSong: onlineSong, lyrics: null, cachedCoverUrl: null, audioSrc: 'https://audio.test/old', playQueue: [onlineSong],
            isFmMode: false, playerState: PlayerState.PAUSED, currentTime: 12, duration: 100, currentLineIndex: -1,
        }) } });
        useElectronWindowPlaybackHandoff({
            isElectronWindow: true, navigateToPlayer: vi.fn(), audioRef: refs.audioRef, mainPlaybackSnapshotRef: { current: null },
            stageStatus: null, stageSource: null, stageLyricsClockRef: { current: {} }, nowPlayingTrack: null, nowPlayingLyricPayload: null,
            nowPlayingPaused: true, nowPlayingProgressMs: 0, nowPlayingProgressQuality: 'coarse', getNowPlayingDisplayTime: () => 0,
            restoreStagePlaybackHandoff: vi.fn(async () => undefined), setLyrics, setIsLyricsLoading: vi.fn(),
            blobUrlRef: refs.blobUrlRef, shouldAutoPlayRef: refs.shouldAutoPlay, pendingResumeTimeRef: refs.pendingResumeTimeRef,
            lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef, currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
            applyTransparentPlayerBackground: vi.fn(), restoreCachedThemeForSong: vi.fn(async () => 'none'), persistLastPlaybackCache: vi.fn(async () => undefined),
        } as never);
        effectNaming('consumeWindowPlaybackHandoff()')();
        await settle();
        return watch.take().filter(line => line.startsWith('audio=h'));
    };

    it('falls back to the old window\'s address for the handed-over song, and not when a song was asked for meanwhile, another or the same', async () => {
        expect(await handOver(null)).toEqual(['audio=https://audio.test/old key=online:bodian:x1']);
        expect(await handOver(otherSong)).toEqual([]);
        expect(await handOver(onlineSong)).toEqual([]);
    });
});

describe('a whole-queue write while the last session is read', () => {
    /**
     * Restores `song` and `queue` from the cache; a mod replaces the queue whole while `last_song` is read
     * (`replace`, or a bare count and store write of `modQueue`).
     */
    const restoreWithReplacement = async (song: SongResult, queue: SongResult[], modQueue: SongResult[], replace?: () => void) => {
        const { refs, setLyrics } = watchWithRefs();
        env.cache.set('last_song', song);
        env.cache.set('last_queue', queue);
        env.reached = wait => {
            if (wait !== 'cache last_song') return;
            if (replace) {
                replace();
                return;
            }
            noteWholeQueueWrite();
            replacePlayQueue(modQueue, false);
        };
        const persistLastPlaybackCache = vi.fn(async (_song: SongResult | null, _queue: SongResult[]) => undefined);
        useSessionRestoreController({
            blobUrlRef: refs.blobUrlRef,
            currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
            setLyrics,
            restoreCachedThemeForSong: vi.fn(async () => 'none'),
            persistLastPlaybackCache,
            clearPersistedStagePlaybackCache: vi.fn(async () => undefined),
            loadLocalSongs: vi.fn(async () => undefined),
            loadLocalPlaylists: vi.fn(async () => undefined),
            shouldAutoPlayRef: refs.shouldAutoPlay,
        } as never);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        effectNaming('last_song')();
        await settle();
        return { refs, persistLastPlaybackCache };
    };

    it('keeps the mod\'s queue, restores the song, and saves and fetches around the mod\'s queue (online, with replay gain)', async () => {
        env.replayGain = { trackGain: -3 };
        const modQueue = [otherSong];
        const { refs, persistLastPlaybackCache } = await restoreWithReplacement(onlineSong, [onlineSong, otherSong], modQueue);

        expect(usePlaybackStore.getState().playQueue).toBe(modQueue);
        expect(refs.currentSongRef.current).toBe('online:bodian:x1');
        expect(usePlaybackStore.getState().audioSrc).toBe('https://audio.test/x1');
        // Saved with the song once it is current (the replacement's own save had no song to keep), and
        // again once the replay gain came: the mod's queue both times.
        expect(persistLastPlaybackCache.mock.calls.map(([, queue]) => queue)).toEqual([modQueue, modQueue]);
        expect(prefetchNearbySongs).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' }), modQueue, 'high', undefined);
    });

    it('saves the mod\'s queue on the local rebuild\'s path too', async () => {
        const modQueue = [otherSong];
        const { persistLastPlaybackCache } = await restoreWithReplacement(localSong, [localSong], modQueue);

        expect(usePlaybackStore.getState().playQueue).toBe(modQueue);
        expect(usePlaybackStore.getState().currentSong).toMatchObject({ name: 'L' });
        expect(persistLastPlaybackCache.mock.calls.length).toBeGreaterThan(0);
        expect(persistLastPlaybackCache.mock.calls.every(([, queue]) => queue === modQueue)).toBe(true);
    });

    it('the undo of the replacement puts back the remembered queue, not the empty one of launch, and saves it', async () => {
        const saved: SongResult[][] = [];
        await restoreWithReplacement(onlineSong, [onlineSong, otherSong], [], () => replaceAsAMod([otherSong], saved));
        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['y1']);

        expect(undoFoliumQueueReplace()).toBe(true);

        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['x1', 'y1']);
        expect(saved.at(-1)?.map(song => song.id)).toEqual(['x1', 'y1']);
    });

    it('counts a whole-queue write made once the App mounted, before the restore could start (on the desktop it waits for the window handoff check)', async () => {
        const { refs, setLyrics } = watchWithRefs();
        env.cache.set('last_song', onlineSong);
        env.cache.set('last_queue', [onlineSong, otherSong]);
        // Rendered with the App, which hands mods replaceQueue in the same commit.
        useSessionRestoreController({
            blobUrlRef: refs.blobUrlRef,
            currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
            setLyrics,
            restoreCachedThemeForSong: vi.fn(async () => 'none'),
            persistLastPlaybackCache: vi.fn(async () => undefined),
            clearPersistedStagePlaybackCache: vi.fn(async () => undefined),
            loadLocalSongs: vi.fn(async () => undefined),
            loadLocalPlaylists: vi.fn(async () => undefined),
            shouldAutoPlayRef: refs.shouldAutoPlay,
        } as never);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const restore = effectNaming('last_song');
        // A mod replaces the queue before the restore's effect gets to run.
        const modQueue = [otherSong];
        noteWholeQueueWrite();
        replacePlayQueue(modQueue, false);

        restore();
        await settle();

        expect(usePlaybackStore.getState().playQueue).toBe(modQueue);
        expect(refs.currentSongRef.current).toBe('online:bodian:x1');
    });

    it('without a whole-queue write restores the remembered queue as before', async () => {
        const { refs, setLyrics } = watchWithRefs();
        env.cache.set('last_song', onlineSong);
        env.cache.set('last_queue', [onlineSong, otherSong]);
        useSessionRestoreController({
            blobUrlRef: refs.blobUrlRef,
            currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
            setLyrics,
            restoreCachedThemeForSong: vi.fn(async () => 'none'),
            persistLastPlaybackCache: vi.fn(async () => undefined),
            clearPersistedStagePlaybackCache: vi.fn(async () => undefined),
            loadLocalSongs: vi.fn(async () => undefined),
            loadLocalPlaylists: vi.fn(async () => undefined),
            shouldAutoPlayRef: refs.shouldAutoPlay,
        } as never);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        effectNaming('last_song')();
        await settle();

        expect(usePlaybackStore.getState().playQueue.map(song => song.id)).toEqual(['x1', 'y1']);
    });
});

describe('a local or Navidrome restore on the HiFi route', () => {
    const status = () => useStatusMessageStore.getState().message;
    const format = { contentType: 'audio/flac', bitDepth: 24, samplingRate: 96000, channelCount: 2 };
    /** A restore of `song` on the HiFi route into a player that still holds a blob URL, a fetch time and maybe a time to resume at. */
    const restoreOnHifi = async (song: SongResult, resumeAt: number | null = null) => {
        const { refs, watch, setLyrics } = watchWithRefs({ address: true });
        makeSongCurrent(song);
        refs.blobUrlRef.current = 'blob:before';
        refs.currentOnlineAudioUrlFetchedAtRef.current = 777;
        refs.pendingResumeTimeRef.current = resumeAt;
        env.route = 'hifi';
        watch.take();
        const restored = await restorePlaybackSourceForSong(song, {
            ...sourceParams(refs, setLyrics, [song]) as object,
            pendingResumeTimeRef: refs.pendingResumeTimeRef,
        } as never);
        return { refs, restored, log: watch.take() };
    };

    beforeEach(() => {
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => env.detail(`revoke ${url}`));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('Navidrome: the stream of the original file, with the format and gain on the carrier, taken over or loaded at the resume time; no address', async () => {
        const song = structuredClone(navidromeSong) as SongResult & { navidromeData: { navidromeData: Record<string, unknown> } };
        song.navidromeData.navidromeData.coverArtUrl = 'https://navi.test/cover/n1';
        env.serverSong = { replayGain: { trackGain: -4 }, ...format };

        const { refs, restored, log } = await restoreOnHifi(song, 42);

        expect(log).toEqual([
            'cover=null key=navidrome:n1',
            'wait navidrome song n1 | song=N key=navidrome:n1',
            'hifi N navidrome from 42 adopt | song=N key=navidrome:n1',
            'cover=https://navi.test/cover/n1 key=navidrome:n1',
            'lyrics=null | song=N key=navidrome:n1',
            'song=N key=navidrome:n1',
        ]);
        expect(restored).toBe('restored');
        const [start] = env.hifiStarts;
        expect(start.source).toEqual({ kind: 'navidrome', carrier: song.navidromeData, streamUrl: 'https://navi.test/stream/n1?format=raw' });
        expect(start.navidromeData).toMatchObject({ replayGain: { trackGain: -4 }, ...format });
        // The time to resume at is spent here: no <audio> loads to spend it.
        expect(refs.pendingResumeTimeRef.current).toBeNull();
        expect(refs.currentOnlineAudioUrlFetchedAtRef.current).toBeNull();
        // As on the web route, a Navidrome restore leaves the blob URL alone.
        expect(refs.blobUrlRef.current).toBe('blob:before');
        expect(usePlaybackStore.getState().audioSrc).toBeNull();
        expect(usePlaybackStore.getState().currentSong?.playbackSourceRevision).toBe('n1:::1000:https://navi.test/stream/n1');
    });

    it('a local file: the file itself, taken over or loaded from its beginning when no time was left; the blob URL that was there is revoked at once', async () => {
        const { refs, restored, log } = await restoreOnHifi(localSong);

        expect(log).toEqual([
            'cover=null key=local:l1',
            'wait the file itself l1 | song=L (remembered) key=local:l1',
            'wait cover asset l1',
            'song=L key=local:l1',
            'revoke blob:before',
            'hifi L local from 0 adopt | song=L key=local:l1',
            'lyrics=null | song=L key=local:l1',
            'cover=null key=local:l1',
        ]);
        expect(restored).toBe('restored');
        expect(env.routesAsked).toEqual(['local local:l1']);
        expect(env.hifiStarts).toEqual([expect.objectContaining({
            song: expect.objectContaining({ name: 'L' }),
            source: { kind: 'local', localSong: localRecord, file: { name: 'l1.flac' } },
            startSec: 0,
            adoptRunning: true,
        })]);
        expect(refs.blobUrlRef.current).toBeNull();
        expect(refs.currentOnlineAudioUrlFetchedAtRef.current).toBeNull();
    });

    it('defers the load to the first play, and the track keeps the restore\'s answer to "still wanted"', async () => {
        const { restored } = await restoreOnHifi(localSong, 42);

        expect(restored).toBe('restored');
        const [start] = env.hifiStarts as Array<{ startSec: number; adoptRunning?: boolean; deferLoad?: boolean; stillWanted?: () => boolean }>;
        expect(start).toMatchObject({ startSec: 42, adoptRunning: true, deferLoad: true });
        expect(start.stillWanted?.()).toBe(true);
        askForSong(otherSong);
        expect(start.stillWanted?.()).toBe(false);
        // Taking over or deferring is the HiFi service's: nothing an earlier window left is stopped here.
        expect(env.released).toEqual([]);
    });

    it('a Navidrome song defers its load the same way', async () => {
        await restoreOnHifi(structuredClone(navidromeSong) as SongResult, 5);
        expect(env.hifiStarts).toEqual([expect.objectContaining({ startSec: 5, adoptRunning: true, deferLoad: true })]);
    });

    it('a restore that takes nothing over (it failed, or was overtaken) stops what an earlier window left in mpv', async () => {
        env.unreadable.add('l1');
        expect((await restoreOnHifi(localSong)).restored).toBe('failed');
        expect(env.released).toEqual(['restore failed']);

        env.unreadable.clear();
        env.released.length = 0;
        const { refs, setLyrics } = watchWithRefs();
        makeSongCurrent(localSong);
        const restoring = restorePlaybackSourceForSong(localSong, sourceParams(refs, setLyrics, [localSong]));
        askForSong(otherSong);
        await expect(restoring).resolves.toBe('stale');
        expect(env.released).toEqual(['restore stale']);
    });

    it('a restore that lands on the web route leaves the stopping to the route guard, which sees its address', async () => {
        const { refs, setLyrics } = watchWithRefs();
        makeSongCurrent(localSong);
        await expect(restorePlaybackSourceForSong(localSong, sourceParams(refs, setLyrics, [localSong]))).resolves.toBe('restored');
        expect(usePlaybackStore.getState().audioSrc).toBe('blob:l1');
        expect(env.released).toEqual([]);
    });

    it('a local file found again under another id: the route is asked for the song it was found as', async () => {
        const remembered = { ...localSong, id: 'gone', name: 'L', localRef: { songId: 'gone' }, sourceRef: { kind: 'local', mediaId: 'gone' } } as unknown as SongResult;

        const { refs, restored } = await restoreOnHifi(remembered, 7);

        expect(restored).toBe('restored');
        expect(env.routesAsked).toEqual(['local local:l1']);
        expect(env.hifiStarts.map(start => start.startSec)).toEqual([7]);
        expect(refs.currentSongRef.current).toBe('local:l1');
    });

    it('a local file that cannot be read: nothing starts, and the listener is told as on the web route', async () => {
        env.unreadable.add('l1');

        const { refs, restored, log } = await restoreOnHifi(localSong, 42);

        expect(log.filter(line => /^(audio|song|revoke|hifi)/.test(line))).toEqual([]);
        expect(restored).toBe('failed');
        expect(status()).toMatchObject({ type: 'info', text: 'status.localFileReauthorize' });
        expect(env.hifiStarts).toEqual([]);
        expect(refs.blobUrlRef.current).toBe('blob:before');
    });

    it('with HiFi on, waits for the first answer about the mpv runtime before it asks for the route', async () => {
        useHifiSettingsStore.setState({ enabled: true });
        let answer!: () => void;
        env.hifiRuntimeKnown = new Promise<void>(resolve => { answer = resolve; });
        const reached: string[] = [];
        const { refs, setLyrics } = watchWithRefs();
        env.reached = wait => { reached.push(wait); };
        makeSongCurrent(localSong);
        env.route = 'hifi';

        const restoring = restorePlaybackSourceForSong(localSong, sourceParams(refs, setLyrics, [localSong]));
        await vi.waitFor(() => expect(reached).toContain('hifi runtime'));
        await settle();
        expect(env.routesAsked).toEqual([]);
        expect(reached).not.toContain('wait the file itself l1');

        answer();
        await expect(restoring).resolves.toBe('restored');
        expect(env.routesAsked).toEqual(['local local:l1']);
        expect(env.hifiStarts).toHaveLength(1);
    });

    it('with HiFi on, a song asked for during that wait ends the restore before the file is read', async () => {
        useHifiSettingsStore.setState({ enabled: true });
        let answer!: () => void;
        env.hifiRuntimeKnown = new Promise<void>(resolve => { answer = resolve; });
        const { refs, watch, setLyrics } = watchWithRefs();
        makeSongCurrent(localSong);
        env.route = 'hifi';
        watch.take();

        const restoring = restorePlaybackSourceForSong(localSong, sourceParams(refs, setLyrics, [localSong]));
        await settle();
        askForSong(otherSong);
        answer();

        await expect(restoring).resolves.toBe('stale');
        expect(watch.take().filter(line => line.startsWith('wait the file itself'))).toEqual([]);
        expect(env.hifiStarts).toEqual([]);
    });

    it('with HiFi off, does not wait for the runtime', async () => {
        const reached: string[] = [];
        const { refs, setLyrics } = watchWithRefs();
        env.reached = wait => { reached.push(wait); };
        makeSongCurrent(navidromeSong);

        await expect(restorePlaybackSourceForSong(navidromeSong, sourceParams(refs, setLyrics, [navidromeSong]))).resolves.toBe('restored');

        expect(reached).not.toContain('hifi runtime');
        expect(env.routesAsked).toEqual(['navidrome navidrome:n1']);
    });

    describe('the handoff to a rebuilt window', () => {
        const snapshotOf = (song: SongResult, playerState = PlayerState.PLAYING): PlaybackSnapshot => ({
            currentSong: song, lyrics: null, cachedCoverUrl: null, audioSrc: null,
            playQueue: [song], isFmMode: false, playerState, currentTime: 12, duration: 100, currentLineIndex: -1,
        });
        const handoffOf = (snapshot: PlaybackSnapshot) => ({
            version: 1, capturedAt: 0, activePlaybackContext: 'main', mainPlayback: snapshot, activePlayback: snapshot,
            stage: { status: null, source: null, playback: null, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
            nowPlaying: { track: null, lyricPayload: null, paused: true, progressMs: 0, progressQuality: 'coarse', displayTimeSec: 0 },
            ui: { currentView: 'home', playerChromeHidden: false, mainWindowBorderVisible: false, transparentModeEnabled: false },
        } as unknown as WindowPlaybackHandoff);
        /** Mounts the hand-off as App does; with a snapshot, the new window consumes it. */
        const mountHandoff = (snapshot: PlaybackSnapshot | null, audioTime = 0) => {
            const { refs, watch, setLyrics } = watchWithRefs();
            vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
            vi.stubGlobal('window', { electron: { consumeWindowPlaybackHandoff: async () => (snapshot ? handoffOf(snapshot) : null) } });
            const handoff = useElectronWindowPlaybackHandoff({
                isElectronWindow: true, navigateToPlayer: vi.fn(), audioRef: { current: { currentTime: audioTime } }, mainPlaybackSnapshotRef: { current: null },
                stageStatus: null, stageSource: null, stageLyricsClockRef: { current: {} }, nowPlayingTrack: null, nowPlayingLyricPayload: null,
                nowPlayingPaused: true, nowPlayingProgressMs: 0, nowPlayingProgressQuality: 'coarse', getNowPlayingDisplayTime: () => 0,
                restoreStagePlaybackHandoff: vi.fn(async () => undefined), setLyrics, setIsLyricsLoading: vi.fn(),
                blobUrlRef: refs.blobUrlRef, shouldAutoPlayRef: refs.shouldAutoPlay, pendingResumeTimeRef: refs.pendingResumeTimeRef,
                lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef, currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
                applyTransparentPlayerBackground: vi.fn(), restoreCachedThemeForSong: vi.fn(async () => 'none'), persistLastPlaybackCache: vi.fn(async () => undefined),
            } as never) as { captureWindowPlaybackHandoff: () => WindowPlaybackHandoff };
            return { refs, watch, handoff };
        };

        it('the handed-over local file is taken over or loaded at the position it had, and that position is spent', async () => {
            env.route = 'hifi';
            const { refs, watch } = mountHandoff(snapshotOf(localSong));
            effectNaming('consumeWindowPlaybackHandoff()')();
            await settle();

            expect(env.hifiStarts).toEqual([expect.objectContaining({ startSec: 12, adoptRunning: true })]);
            expect(refs.pendingResumeTimeRef.current).toBeNull();
            expect(refs.shouldAutoPlay.current).toBe(true);
            expect(watch.take().filter(line => line.startsWith('audio='))).toEqual(['audio=null key=local:l1']);
        });

        it('on the web route the position is left for <audio> to spend', async () => {
            const { refs, watch } = mountHandoff(snapshotOf(localSong));
            effectNaming('consumeWindowPlaybackHandoff()')();
            await settle();

            expect(env.hifiStarts).toEqual([]);
            expect(refs.pendingResumeTimeRef.current).toBe(12);
            expect(watch.take().filter(line => line.startsWith('audio='))).toEqual(['audio=null key=local:l1', 'audio=blob:l1 key=local:l1']);
        });

        it('the capture takes the position from mpv\'s clock on the HiFi route, and from <audio> on the web route', () => {
            makeSongCurrent(localSong);
            const { handoff } = mountHandoff(null, 33);

            expect(handoff.captureWindowPlaybackHandoff().mainPlayback?.currentTime).toBe(33);

            env.onHifiRoute = true;
            env.hifiPosition = 71.5;
            expect(handoff.captureWindowPlaybackHandoff().mainPlayback?.currentTime).toBe(71.5);
        });
    });
});

describe('a new window with nothing to restore stops what an earlier window left playing in mpv', () => {
    const stageSong = {
        id: 's1', name: 'S', artists: [], album: { id: '', name: '' }, durationMs: 1000,
        sourceRef: { kind: 'stage', mediaId: 's1' },
    } as unknown as SongResult;

    describe('the restore of the last session', () => {
        const restoreSession = async (lastSong: SongResult | null, duringTheRead?: () => void) => {
            const { refs, setLyrics } = watchWithRefs();
            if (lastSong) env.cache.set('last_song', lastSong);
            env.reached = wait => { if (wait === 'cache last_song') duringTheRead?.(); };
            useSessionRestoreController({
                blobUrlRef: refs.blobUrlRef,
                currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
                setLyrics,
                restoreCachedThemeForSong: vi.fn(async () => 'none'),
                persistLastPlaybackCache: vi.fn(async () => undefined),
                clearPersistedStagePlaybackCache: vi.fn(async () => undefined),
                loadLocalSongs: vi.fn(async () => undefined),
                loadLocalPlaylists: vi.fn(async () => undefined),
                shouldAutoPlayRef: refs.shouldAutoPlay,
            } as never);
            vi.spyOn(console, 'log').mockImplementation(() => {});
            effectNaming('last_song')();
            await settle();
        };

        it('no song remembered', async () => {
            await restoreSession(null);
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('a song asked for while the remembered one was read', async () => {
            await restoreSession(onlineSong, () => askForSong(otherSong));
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('the remembered local file is gone from the library', async () => {
            const gone = { ...localSong, id: 'gone', localRef: { songId: 'gone' }, sourceRef: { kind: 'local', mediaId: 'gone' } } as unknown as SongResult;
            await restoreSession(gone);
            expect(usePlaybackStore.getState().currentSong).toBeNull();
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('a Stage session was remembered', async () => {
            await restoreSession(stageSong);
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('a song that is restored leaves it to the source\'s restore (which took it over, or stopped it)', async () => {
            await restoreSession(onlineSong);
            expect(usePlaybackStore.getState().audioSrc).toBe('https://audio.test/x1');
            expect(env.released).toEqual([]);
        });
    });

    describe('the handoff to a rebuilt window', () => {
        const snapshotOf = (song: SongResult | null): PlaybackSnapshot => ({
            currentSong: song, lyrics: null, cachedCoverUrl: null, audioSrc: null,
            playQueue: song ? [song] : [], isFmMode: false, playerState: PlayerState.PAUSED,
            currentTime: 12, duration: 100, currentLineIndex: -1,
        });
        const handoffOf = (snapshot: PlaybackSnapshot | null, activePlaybackContext: 'main' | 'stage' = 'main') => ({
            version: 1, capturedAt: 0, activePlaybackContext, mainPlayback: snapshot, activePlayback: snapshot,
            stage: { status: null, source: null, playback: null, lyricsClock: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
            nowPlaying: { track: null, lyricPayload: null, paused: true, progressMs: 0, progressQuality: 'coarse', displayTimeSec: 0 },
            ui: { currentView: 'home', playerChromeHidden: false, mainWindowBorderVisible: false, transparentModeEnabled: false },
        } as unknown as WindowPlaybackHandoff);
        /**
         * The new window consumes `handoff`; `askedMeanwhile` is asked for while the main process answers, and
         * `hifiSnapshot` is the main process's answer to a look at mpv (none: a build without HiFi).
         */
        const restoreHandoff = async (
            handoff: WindowPlaybackHandoff,
            askedMeanwhile: SongResult | null = null,
            hifiSnapshot?: () => Promise<null>,
        ) => {
            const { refs, setLyrics } = watchWithRefs();
            askForSong(null);
            // What had been stopped when the Stage began to restore.
            let releasedBeforeStage: string[] | null = null;
            vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
            vi.stubGlobal('window', { electron: {
                consumeWindowPlaybackHandoff: async () => {
                    if (askedMeanwhile) askForSong(askedMeanwhile);
                    return handoff;
                },
                ...(hifiSnapshot ? { hifi: { getSnapshot: hifiSnapshot } } : {}),
            } });
            useElectronWindowPlaybackHandoff({
                isElectronWindow: true, navigateToPlayer: vi.fn(), audioRef: refs.audioRef, mainPlaybackSnapshotRef: { current: null },
                stageStatus: null, stageSource: null, stageLyricsClockRef: { current: {} }, nowPlayingTrack: null, nowPlayingLyricPayload: null,
                nowPlayingPaused: true, nowPlayingProgressMs: 0, nowPlayingProgressQuality: 'coarse', getNowPlayingDisplayTime: () => 0,
                restoreStagePlaybackHandoff: vi.fn(async () => { releasedBeforeStage = [...env.released]; }),
                setLyrics, setIsLyricsLoading: vi.fn(),
                blobUrlRef: refs.blobUrlRef, shouldAutoPlayRef: refs.shouldAutoPlay, pendingResumeTimeRef: refs.pendingResumeTimeRef,
                lastAudioRecoverySourceRef: refs.lastAudioRecoverySourceRef, currentOnlineAudioUrlFetchedAtRef: refs.currentOnlineAudioUrlFetchedAtRef,
                applyTransparentPlayerBackground: vi.fn(), restoreCachedThemeForSong: vi.fn(async () => 'none'), persistLastPlaybackCache: vi.fn(async () => undefined),
            } as never);
            effectNaming('consumeWindowPlaybackHandoff()')();
            await settle();
            return { releasedBeforeStage: releasedBeforeStage as string[] | null };
        };

        it('no song handed over', async () => {
            await restoreHandoff(handoffOf(snapshotOf(null)));
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('the stop waits for this window\'s first look at mpv, which is asked for after the hand-off', async () => {
            let answer!: () => void;
            const asked: number[] = [];
            await restoreHandoff(handoffOf(snapshotOf(null)), null, () => {
                // How often the HiFi service had been installed (and taken its first look) when this look was asked for.
                asked.push(env.hifiInstalls);
                return new Promise<null>(resolve => { answer = () => resolve(null); });
            });
            expect(asked).toEqual([1]);
            // Until the main process answers, the track the old window left is not known yet: nothing is stopped.
            expect(env.released).toEqual([]);

            answer();
            await settle();
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('a song asked for in the new window while the handoff was read', async () => {
            await restoreHandoff(handoffOf(snapshotOf(localSong)), otherSong);
            expect(env.hifiStarts).toEqual([]);
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('the old window was on the Stage: stopped before the Stage plays', async () => {
            const { releasedBeforeStage } = await restoreHandoff(handoffOf(snapshotOf(localSong), 'stage'));
            expect(releasedBeforeStage).toEqual(['nothing to restore']);
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('the handed-over song is a Stage song', async () => {
            await restoreHandoff(handoffOf(snapshotOf(stageSong)));
            expect(env.released).toEqual(['nothing to restore']);
        });

        it('a song that is handed over leaves it to the source\'s restore', async () => {
            env.route = 'hifi';
            await restoreHandoff(handoffOf(snapshotOf(localSong)));
            expect(env.hifiStarts).toEqual([expect.objectContaining({ startSec: 12, adoptRunning: true })]);
            expect(env.released).toEqual([]);
        });
    });
});
