import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';

// test/unit/playback/queueAddInARow.test.ts
// Adds to the queue made one after another before the next render (a mod's folium.playback.enqueue in a
// loop, an add after an await): each builds on the queue the one before left, with the add setting and the
// playback context as they are at the call. The hook runs once without a renderer, as in
// currentSongPlaySong.test.ts, so the callbacks it hands out are the ones a single render made; the
// stores are the real ones.

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [value, vi.fn()],
    useEffect: vi.fn(),
}));
// A store read as a hook answers from its state at the moment of the call; everything else about the
// stores is real.
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
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => true, getProviderLabel: (id: string) => id } }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: () => false }));
vi.mock('@/services/prefetchService', () => ({
    getPrefetchedData: () => null,
    prefetchNearbySongs: vi.fn(),
    invalidateAndRefetch: vi.fn(),
    refreshPrefetchAfterQueueEdit: vi.fn(),
}));

const { usePlaybackQueueController } = await import('@/components/app/playback/start/usePlaybackQueueController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');

const song = (id: string): UnifiedSong => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const playing = song('now');
const [a, b, c] = ['a', 'b', 'c'].map(song);
const idsOf = (queue: readonly { id: unknown }[] | undefined) => (queue ?? []).map(item => item.id);

let behaviorBefore: ReturnType<typeof useAudioSettingsStore.getState>['queueAddBehavior'];

beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), setInterval: vi.fn(() => 2), clearTimeout: vi.fn(), clearInterval: vi.fn() });
    behaviorBefore = useAudioSettingsStore.getState().queueAddBehavior;
    usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: playing, playQueue: [playing], isFmMode: false });
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    useAudioSettingsStore.setState({ queueAddBehavior: behaviorBefore });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/* One render of the controller: what it hands out keeps what this render saw. */
function mount() {
    const persistLastPlaybackCache = vi.fn(async (_song: unknown, _queue: UnifiedSong[]) => undefined);
    const mainPlaybackSnapshotRef = { current: null as Record<string, unknown> | null };
    const queue = usePlaybackQueueController({
        localSongs: [], localLibraryCatalog: {}, isNowPlayingStageActive: false, shouldNavigateToPlayerOnTrackChange: true,
        audioRef: { current: null }, shouldAutoPlayRef: { current: true }, playbackAutoSkipCountRef: { current: 0 },
        blobUrlRef: { current: null }, pendingResumeTimeRef: { current: null },
        lastAudioRecoverySourceRef: { current: null }, currentOnlineAudioUrlFetchedAtRef: { current: null },
        mainPlaybackSnapshotRef,
        setIsLyricsLoading: vi.fn(), setLyrics: vi.fn(), persistLastPlaybackCache,
        navigateToPlaybackView: vi.fn(), restoreCachedThemeForSong: vi.fn(async () => undefined),
        interruptStagePlaybackForMainTransition: vi.fn(),
    } as never);
    return { queue, persistLastPlaybackCache, mainPlaybackSnapshotRef };
}

describe('adds to the queue in a row, before the next render', () => {
    // It used to read the queue this render saw: three adds in a row each started from [now], and the
    // queue ended as [now, c].
    it('keeps every song added last, in the order added', () => {
        useAudioSettingsStore.setState({ queueAddBehavior: 'append' });
        const { queue, persistLastPlaybackCache } = mount();
        for (const next of [a, b, c]) queue.addOnlineSongToQueue(next);
        expect(idsOf(usePlaybackStore.getState().playQueue)).toEqual(['now', 'a', 'b', 'c']);
        expect(persistLastPlaybackCache.mock.calls.map(([, saved]) => idsOf(saved))).toEqual([
            ['now', 'a'],
            ['now', 'a', 'b'],
            ['now', 'a', 'b', 'c'],
        ]);
    });

    it('puts each song added next right after the one playing, the last added first', () => {
        useAudioSettingsStore.setState({ queueAddBehavior: 'next' });
        const { queue } = mount();
        for (const next of [a, b, c]) queue.addOnlineSongToQueue(next);
        expect(idsOf(usePlaybackStore.getState().playQueue)).toEqual(['now', 'c', 'b', 'a']);
    });

    it('adds the way the setting says at the call, not as it was at the render', () => {
        useAudioSettingsStore.setState({ queueAddBehavior: 'append' });
        const { queue } = mount();
        queue.addOnlineSongToQueue(a);
        useAudioSettingsStore.setState({ queueAddBehavior: 'next' });
        queue.addOnlineSongToQueue(b);
        expect(idsOf(usePlaybackStore.getState().playQueue)).toEqual(['now', 'b', 'a']);
        expect(useStatusMessageStore.getState().message).toMatchObject({ text: 'status.added_to_next_play' });
    });

    it('adds to the main queue kept aside once the stage took playback after the render', () => {
        useAudioSettingsStore.setState({ queueAddBehavior: 'append' });
        const { queue, mainPlaybackSnapshotRef } = mount();
        mainPlaybackSnapshotRef.current = { currentSong: playing, playQueue: [playing], isFmMode: false };
        usePlaybackStore.setState({ activePlaybackContext: 'stage', playQueue: [] });
        queue.addOnlineSongToQueue(a);
        queue.addOnlineSongToQueue(b);
        expect(idsOf(mainPlaybackSnapshotRef.current?.playQueue as UnifiedSong[])).toEqual(['now', 'a', 'b']);
        expect(usePlaybackStore.getState().playQueue).toEqual([]);
    });
});
