// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/playback/queueShuffleRoutes.test.ts — what the queue shuffle stands on, and what it
// does on the route where another program sounds the songs: it is Folia's own queue order, so
// shuffling it hands the player's queue the new order instead of the one prepared before.
// Only the real Stage, whose queue another window drives, refuses the shuffle.

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn(() => true),
    canPlaySong: vi.fn(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn(async () => {}),
    pauseExternalPlayback: vi.fn(async () => {}),
    resumeExternalPlayback: vi.fn(async () => {}),
    seekExternalPlayback: vi.fn(async () => {}),
    setExternalPlaybackVolume: vi.fn(async () => {}),
    getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
        mediaId: 'a', isPlaying: true, positionMs: 1000, durationMs: 200000, ended: false,
    })),
    isExternalPlaybackStatusForSong: vi.fn(() => true),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const { canShuffleQueue } = await import('@/utils/playbackNeighbors');
const engine = await import('@/services/onlineMusic/externalPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');

const songOf = (mediaId: string, name: string): SongResult => ({
    id: mediaId,
    name,
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId, providerData: { resourceType: 'songs' } },
});

const a = songOf('a', 'A');
const b = songOf('b', 'B');
const c = songOf('c', 'C');
const d = songOf('d', 'D');

describe('the queue shuffle and the route it runs on', () => {
    it('is offered on the route where a player outside the app sounds the songs', () => {
        // The external route passes no stage flag: Folia keeps the order, the player is told it.
        expect(canShuffleQueue(3, false, false)).toBe(true);
    });

    it('is refused while the Stage drives the queue', () => {
        expect(canShuffleQueue(3, false, true)).toBe(false);
    });

    it('is refused with one song and in Personal FM', () => {
        expect(canShuffleQueue(1, false, false)).toBe(false);
        expect(canShuffleQueue(3, true, false)).toBe(false);
    });
});

describe('shuffling the queue of an external song', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: a,
            playQueue: [a, b, c], isFmMode: false,
        });
        omniMock.prepareExternalPlaybackQueue.mockClear();
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        let position = 1000;
        omniMock.getExternalPlaybackStatus.mockReset().mockImplementation(async () => {
            position += 500;
            return { mediaId: 'a', isPlaying: true, positionMs: position, durationMs: 200000, ended: false };
        });
        await engine.beginExternalPlayback(a);
        engine.announceExternalPlayback();
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
    });

    it('hands the player the order the queue has after the shuffle', async () => {
        // Two answers that move: the preparation waits for real progress, then asks for the tail.
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledWith(a, [b, c]);

        // The shuffle of the queue Folia holds: the two songs after this one are now others, and the
        // player is told the new order rather than the one prepared before it.
        usePlaybackStore.setState({ playQueue: [a, d, b, c] });
        await vi.advanceTimersByTimeAsync(600);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(a, [d, b]);
    });
});
