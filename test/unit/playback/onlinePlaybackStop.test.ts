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
vi.mock('@/services/onlinePlayback', () => ({ loadOnlineSongAudioSource: vi.fn() }));

const { usePlaybackQueueController } = await import('@/hooks/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');
const songs: UnifiedSong[] = ['1', '2'].map(id => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    // 当前曲刻意取 songs[1]：这些用例测的是「播放一首不可用的歌」，而「点正在播的那首=只展开播放器、
    // 不重新加载」是另一条早返回（见 usePlaybackQueueController 里的说明），两者混在一起会互相遮蔽。
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: songs[1], playQueue: songs,
        playerState: PlayerState.PLAYING, isFmMode: false });
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => vi.unstubAllGlobals());

function controller() {
    const pause = vi.fn();
    const shouldAutoPlayRef = { current: true };
    const result = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false,
        audioRef: { current: { pause } }, shouldAutoPlayRef,
        playbackAutoSkipCountRef: { current: 0 }, setIsLyricsLoading: vi.fn(),
        interruptStagePlaybackForMainTransition: vi.fn(),
        // 类型上必填（点当前曲会用它打开播放器）；这些用例不走那条路径，给个空实现即可。
        navigateToPlaybackView: vi.fn(),
    } as never);
    return { ...result, pause, shouldAutoPlayRef };
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
