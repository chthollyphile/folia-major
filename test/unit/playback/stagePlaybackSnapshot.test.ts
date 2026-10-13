import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';
import type { PlaybackSnapshot } from '@/types/appPlayback';

// test/unit/playback/stagePlaybackSnapshot.test.ts
// 离开 Stage 时恢复主播放快照，要把 currentSongRef 一并切回主歌曲：否则恢复与失败处理会把它当成陈旧结果丢弃。

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => ({ current }),
    useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, vi.fn()],
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
vi.mock('@/stores/useStageSettingsStore', () => ({
    useStageSettingsStore: (selector: (state: unknown) => unknown) => selector({
        enableNowPlayingStage: false, enablePlayerCapStage: false,
        playerCapHost: '', playerCapPlayer: '', playerCapTimeBasis: 'progress', playerCapSticky: false,
    }),
}));
vi.mock('@/hooks/usePlayerCapSource', async () => {
    const { initialPlayerCapSession } = await import('@/utils/playerCapSession');
    return {
        usePlayerCapSource: () => ({ state: initialPlayerCapSession(), players: [], getCurrentTimeSec: () => 0 }),
    };
});
vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async () => null),
    removeFromCache: vi.fn(async () => undefined),
    saveToCache: vi.fn(async () => undefined),
}));
vi.mock('@/services/nowPlayingProvider', () => ({ NowPlayingProvider: vi.fn() }));

const { useStagePlaybackController } = await import('@/hooks/useStagePlaybackController');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');

const mainSong: SongResult = {
    id: 'main', name: 'Main', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'main' },
};
const stageSong = {
    id: -1, name: 'Stage Session', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    isStage: true, sourceRef: { kind: 'stage', mediaId: 'stage-session' },
} as unknown as SongResult;

const mainSnapshot: PlaybackSnapshot = {
    currentSong: mainSong, lyrics: null, cachedCoverUrl: null, audioSrc: 'https://cdn.example/main.mp3',
    playQueue: [mainSong], isFmMode: false, playerState: PlayerState.PLAYING,
    currentTime: 30, duration: 200, currentLineIndex: -1,
};

const mount = () => {
    const currentSongRef = { current: getPlaybackSongKey(stageSong) as string | number | null };
    const playbackGenerationRef = { current: 5 };
    const controller = useStagePlaybackController({
        isDev: false, isElectronWindow: false,
        audioRef: { current: null }, currentSongRef, playbackGenerationRef,
        shouldAutoPlayRef: { current: false }, pendingResumeTimeRef: { current: null },
        lastAudioRecoverySourceRef: { current: null }, currentOnlineAudioUrlFetchedAtRef: { current: null },
        setLyrics: vi.fn(), setIsLyricsLoading: vi.fn(), navigateToPlayer: vi.fn(),
    });
    controller.mainPlaybackSnapshotRef.current = mainSnapshot;
    return { controller, currentSongRef, playbackGenerationRef };
};

describe('stage playback snapshots', () => {
    beforeEach(() => {
        usePlaybackStore.setState({ activePlaybackContext: 'stage', currentSong: stageSong, playQueue: [], audioSrc: null });
    });

    it('commits currentSongRef to the main song when leaving Stage', () => {
        const { controller, currentSongRef, playbackGenerationRef } = mount();
        controller.leaveStagePlayback();

        expect(usePlaybackStore.getState().currentSong).toBe(mainSong);
        expect(currentSongRef.current).toBe(getPlaybackSongKey(mainSong));
        // A refresh started for the main song before Stage opened belongs to an earlier playback and must read as stale.
        expect(playbackGenerationRef.current).toBe(6);
    });

    it('commits currentSongRef to the main song when a main play request interrupts Stage', () => {
        const { controller, currentSongRef } = mount();
        controller.interruptStagePlaybackForMainTransition();

        expect(currentSongRef.current).toBe(getPlaybackSongKey(mainSong));
    });
});
