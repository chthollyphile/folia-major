import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type UnifiedSong } from '@/types';

// test/unit/playback/onlinePlaybackStop.test.ts — exercise the queue's error branch without a browser or network.

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
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
vi.mock('@/stores/useHeartbeatModeStore', async importOriginal => {
    const actual = await importOriginal<typeof import('@/stores/useHeartbeatModeStore')>();
    return { ...actual, useHeartbeatModeStore: Object.assign(
        (selector: (state: unknown) => unknown) => selector(actual.useHeartbeatModeStore.getState()), actual.useHeartbeatModeStore) };
});
vi.mock('@/stores/useAudioSettingsStore', () => ({
    useAudioSettingsStore: (selector: (state: unknown) => unknown) => selector({ audioQuality: 'high', loopMode: 'all' }),
}));
vi.mock('@/stores/useSearchNavigationStore', () => ({
    useSearchNavigationStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/services/hostExtensionHooks', () => ({ hasBeforePlayHook: () => false }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => true } }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ isSongUnavailable: () => false }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ hasCachedSongAudio: async () => null }));
vi.mock('@/services/prefetchService', () => ({ getPrefetchedData: () => null }));
vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongAudioSource: vi.fn(),
    applyOnlineAudioSourceMetadata: (song: UnifiedSong) => song,
}));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: vi.fn() }));

const { usePlaybackQueueController } = await import('@/hooks/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');
const { loadOnlineLyricsState } = await import('@/utils/onlineLyricsState');
const { useHeartbeatModeStore } = await import('@/stores/useHeartbeatModeStore');
const { stopHeartbeatMode } = await import('@/services/heartbeatPlayback');
const songs: UnifiedSong[] = ['1', '2'].map(id => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: songs[0], playQueue: songs,
        playerState: PlayerState.PLAYING, isFmMode: false, audioSrc: 'blob:existing-song' });
    useHeartbeatModeStore.getState().stop();
    vi.mocked(loadOnlineLyricsState).mockReset().mockResolvedValue(null);
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function controller() {
    const pause = vi.fn();
    const shouldAutoPlayRef = { current: true };
    const currentSongRef = { current: 'online:bodian:1' };
    const pendingResumeTimeRef = { current: 25 };
    const lastAudioRecoverySourceRef = { current: 'existing-recovery-source' };
    const currentOnlineAudioUrlFetchedAtRef = { current: 1000 };
    const blobUrlRef = { current: 'blob:existing-song' };
    const setLyrics = vi.fn();
    const setIsLyricsLoading = vi.fn();
    const result = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        audioRef: { current: { pause } }, shouldAutoPlayRef, currentSongRef, pendingResumeTimeRef,
        lastAudioRecoverySourceRef, currentOnlineAudioUrlFetchedAtRef, blobUrlRef, setLyrics,
        playbackAutoSkipCountRef: { current: 0 }, setIsLyricsLoading,
        interruptStagePlaybackForMainTransition: vi.fn(),
    } as never);
    return { ...result, pause, shouldAutoPlayRef, currentSongRef, pendingResumeTimeRef,
        lastAudioRecoverySourceRef, currentOnlineAudioUrlFetchedAtRef, blobUrlRef, setLyrics, setIsLyricsLoading };
}

describe('online playback stop conditions', () => {
    it.each([
        ['region-restricted', 'status.songRegionRestricted'],
        ['auth-required', 'status.loginExpired'],
        ['preview-only', 'status.songPreviewOnly'],
    ] as const)('pauses and never schedules queue skipping for %s', async (reason, message) => {
        vi.mocked(loadOnlineSongAudioSource).mockResolvedValue({ kind: 'unavailable', reason });
        const queue = controller();
        await queue.playSong(songs[0], songs);
        expect(queue.pause).toHaveBeenCalledOnce();
        expect(queue.shouldAutoPlayRef.current).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.IDLE);
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error', text: message });
        expect(window.setTimeout).not.toHaveBeenCalled();
        expect(loadOnlineSongAudioSource).toHaveBeenCalledOnce();
    });

    it('still schedules a skip for an individually unplayable song', async () => {
        vi.mocked(loadOnlineSongAudioSource).mockResolvedValue({ kind: 'unavailable', reason: 'not-playable' });
        const queue = controller();
        await queue.playSong(songs[0], songs);
        expect(window.setTimeout).toHaveBeenCalledOnce();
        expect(queue.pause).not.toHaveBeenCalled();
    });
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function heartbeatController() {
    const id = useHeartbeatModeStore.getState().begin();
    useHeartbeatModeStore.setState({ loading: false, session: {
        id, providerId: 'bodian', userId: 'listener', playlistId: 'liked', seedSongId: '2',
    } });
    const queue = controller();
    queue.shouldAutoPlayRef.current = false;
    return { queue, options: { heartbeatSessionId: id } };
}

// A cancellation may arrive while a new track is loading; none of that abandoned request owns the old player.
function expectExistingPlayback(queue: ReturnType<typeof controller>) {
    expect(queue.pause).not.toHaveBeenCalled();
    expect(queue.shouldAutoPlayRef.current).toBe(false);
    expect(queue.currentSongRef.current).toBe('online:bodian:1');
    expect(queue.pendingResumeTimeRef.current).toBe(25);
    expect(queue.lastAudioRecoverySourceRef.current).toBe('existing-recovery-source');
    expect(queue.currentOnlineAudioUrlFetchedAtRef.current).toBe(1000);
    expect(queue.blobUrlRef.current).toBe('blob:existing-song');
    expect(queue.setLyrics).not.toHaveBeenCalled();
    expect(queue.setIsLyricsLoading).not.toHaveBeenCalled();
    expect(usePlaybackStore.getState().currentSong).toBe(songs[0]);
    expect(usePlaybackStore.getState().playQueue).toBe(songs);
    expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    expect(usePlaybackStore.getState().audioSrc).toBe('blob:existing-song');
    expect(useStatusMessageStore.getState().message).toMatchObject({ text: 'Stopped by user' });
}

function stopPendingHeartbeat() {
    stopHeartbeatMode();
    useStatusMessageStore.setState({ message: { type: 'info', text: 'Stopped by user' } });
}

describe('stopping Heartbeat during pending playback', () => {
    it.each(['auth-required', 'preview-only', 'region-restricted'] as const)(
        'ignores a late %s audio result without pausing the existing song', async reason => {
            const audio = deferred<Awaited<ReturnType<typeof loadOnlineSongAudioSource>>>();
            vi.mocked(loadOnlineSongAudioSource).mockReturnValue(audio.promise);
            const { queue, options } = heartbeatController();
            const playing = queue.playSong(songs[1], songs, false, options);
            await vi.waitFor(() => expect(loadOnlineSongAudioSource).toHaveBeenCalledOnce());

            stopPendingHeartbeat();
            audio.resolve({ kind: 'unavailable', reason });
            await playing;

            expectExistingPlayback(queue);
            expect(window.setTimeout).not.toHaveBeenCalled();
            expect(loadOnlineLyricsState).not.toHaveBeenCalled();
        },
    );

    it('revokes a blob returned after cancellation without loading its lyrics', async () => {
        const audio = deferred<Awaited<ReturnType<typeof loadOnlineSongAudioSource>>>();
        vi.mocked(loadOnlineSongAudioSource).mockReturnValue(audio.promise);
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const { queue, options } = heartbeatController();
        const playing = queue.playSong(songs[1], songs, false, options);
        await vi.waitFor(() => expect(loadOnlineSongAudioSource).toHaveBeenCalledOnce());

        stopPendingHeartbeat();
        audio.resolve({ kind: 'ok', audioSrc: 'blob:abandoned', blobUrl: 'blob:abandoned' });
        await playing;

        expectExistingPlayback(queue);
        expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:abandoned');
        expect(loadOnlineLyricsState).not.toHaveBeenCalled();
    });

    it('ignores an audio rejection after cancellation instead of replacing the stop notice', async () => {
        const audio = deferred<Awaited<ReturnType<typeof loadOnlineSongAudioSource>>>();
        vi.mocked(loadOnlineSongAudioSource).mockReturnValue(audio.promise);
        const { queue, options } = heartbeatController();
        const playing = queue.playSong(songs[1], songs, false, options);
        await vi.waitFor(() => expect(loadOnlineSongAudioSource).toHaveBeenCalledOnce());

        stopPendingHeartbeat();
        audio.reject(new Error('late audio failure'));
        await playing;

        expectExistingPlayback(queue);
    });

    it('keeps playback refs intact and revokes the preloaded blob when canceled during lyrics lookup', async () => {
        const lyrics = deferred<Awaited<ReturnType<typeof loadOnlineLyricsState>>>();
        vi.mocked(loadOnlineLyricsState).mockReturnValue(lyrics.promise);
        vi.mocked(loadOnlineSongAudioSource).mockResolvedValue({ kind: 'ok', audioSrc: 'blob:abandoned', blobUrl: 'blob:abandoned' });
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const { queue, options } = heartbeatController();
        const playing = queue.playSong(songs[1], songs, false, options);
        await vi.waitFor(() => expect(loadOnlineLyricsState).toHaveBeenCalledOnce());

        stopPendingHeartbeat();
        lyrics.resolve(null);
        await playing;

        expectExistingPlayback(queue);
        expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:abandoned');
    });
});
