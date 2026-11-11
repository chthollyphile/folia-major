// @vitest-environment jsdom
// 临时复审探针 6：在 7d4a71608 上复核暂停态、replayed、用尽后的收敛。结束前删除。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ExternalPlaybackTraits, ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

const omniMock = vi.hoisted(() => {
    const NONE = {
        capturesSystemAudio: false, startsWithoutWaiting: false, backsOffStatusPolls: false, holdsMediaKeysWhilePlaying: false,
        seekLimitMs: null as number | null, loopsTrackNatively: false, followsPlayerChanges: false,
    };
    return {
        NONE,
        canPlayExternally: vi.fn(() => true),
        canPlaySong: vi.fn(() => true),
        prepareExternalPlaybackQueue: vi.fn(async () => {}),
        playSongExternally: vi.fn(async () => {}),
        pauseExternalPlayback: vi.fn(async () => {}),
        resumeExternalPlayback: vi.fn(async () => {}),
        seekExternalPlayback: vi.fn(async () => {}),
        setExternalPlaybackVolume: vi.fn(async () => {}),
        setExternalTrackRepeat: vi.fn(async (): Promise<undefined> => undefined),
        getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
            mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false,
        })),
        isExternalPlaybackStatusForSong: vi.fn(() => true),
        adoptExternalPlayback: vi.fn(() => {}),
        externalPlaybackTraits: vi.fn((): ExternalPlaybackTraits => ({
            capturesSystemAudio: true, startsWithoutWaiting: true, backsOffStatusPolls: true, holdsMediaKeysWhilePlaying: true,
            seekLimitMs: 8000, loopsTrackNatively: true, followsPlayerChanges: true,
        })),
    };
});
vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const song: SongResult = {
    id: '123', name: 'Example', artists: [{ id: '', name: 'Artist' }], album: { id: '', name: 'Album' },
    durationMs: 200000, sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: '123', providerData: { resourceType: 'songs' } },
};
const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false, ...overrides,
});

describe('probes 6', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('probe reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song], isFmMode: false,
        });
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.seekExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.prepareExternalPlaybackQueue.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
    });
    afterEach(() => {
        engine.stopExternalPlayback('probe end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const startFrom = async (positionMs: number) => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs, isPlaying: true }));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(500);
    };

    it('S1 paused player keeps naming the old spot past the 3 reads', async () => {
        await startFrom(10000);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10200, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        engine.seekExternalPlayback(60);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10500, isPlaying: false }));
        const seen: string[] = [];
        for (let waited = 0; waited < 2500; waited += 100) {
            await vi.advanceTimersByTimeAsync(100);
            seen.push(`${waited + 100}:${engine.getExternalPosition().toFixed(2)}`);
        }
        console.log('[S1] paused stale reads', seen.join(' '));
    });

    it('S2 repeat turn right after a drop', async () => {
        await startFrom(190000);
        engine.seekExternalPlayback(199);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 200, isPlaying: true, replayed: true }));
        await vi.advanceTimersByTimeAsync(500);
        console.log('[S2] after a repeat turn', engine.getExternalPosition());
    });

    it('S3 playing stale reads past the budget, Spotify traits', async () => {
        await startFrom(10000);
        engine.seekExternalPlayback(60);
        await vi.advanceTimersByTimeAsync(20);
        const landedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: performance.now() < landedAt + 1400 ? 10500 : 61400 + Math.round(performance.now() - landedAt - 1400), isPlaying: true })
        ));
        let previous = engine.getExternalPosition();
        let still = 0;
        let longest = 0;
        for (let waited = 0; waited < 3000; waited += 50) {
            await vi.advanceTimersByTimeAsync(50);
            const position = engine.getExternalPosition();
            still = position > previous + 1e-9 ? 0 : still + 50;
            longest = Math.max(longest, still);
            previous = position;
        }
        console.log('[S3] longest stall (Spotify traits)', longest);
    });

    it('S4 Apple Music stall after the budget runs out', async () => {
        omniMock.externalPlaybackTraits.mockReturnValue(omniMock.NONE);
        await startFrom(10000);
        engine.seekExternalPlayback(60);
        await vi.advanceTimersByTimeAsync(20);
        const landedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: performance.now() < landedAt + 1400 ? 10500 : 61400 + Math.round(performance.now() - landedAt - 1400), isPlaying: true })
        ));
        let previous = engine.getExternalPosition();
        let still = 0;
        let longest = 0;
        for (let waited = 0; waited < 3000; waited += 50) {
            await vi.advanceTimersByTimeAsync(50);
            const position = engine.getExternalPosition();
            still = position > previous + 1e-9 ? 0 : still + 50;
            longest = Math.max(longest, still);
            previous = position;
        }
        console.log('[S4] longest stall (no declared limit)', longest);
    });

    it('S5 paused read whose old spot is near the end', async () => {
        await startFrom(190000);
        engine.seekExternalPlayback(30);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 190500, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(600);
        console.log('[S5] drop back to 30, old spot 190.5, clock', engine.getExternalPosition(), usePlaybackStore.getState().playerState);
    });
});
