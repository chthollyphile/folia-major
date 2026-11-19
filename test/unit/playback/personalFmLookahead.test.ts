// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/playback/personalFmLookahead.test.ts
// 私人 FM 的提前续歌：当前曲目落到队列最后两首就向电台要一批接在后面（直接点了后面的一首也续上），
// 等这一批时电台或队列变了就丢掉。

const omniMock = vi.hoisted(() => ({
    getPersonalFm: vi.fn<(options?: unknown) => Promise<SongResult[]>>(async () => []),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const { fmLookaheadWanted, topUpPersonalFm } = await import('@/components/app/playback/start/personalFmLookahead');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { noteQueueStart } = await import('@/components/app/playback/start/queueStarts');

const song = (index: number): SongResult => ({
    id: String(index), name: `Song ${index}`, artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' }, durationMs: 180000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(index) },
});

const queueOf = (...indices: number[]) => indices.map(song);

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    omniMock.getPersonalFm.mockReset();
    usePlaybackStore.setState({ isFmMode: false, playQueue: [], currentSong: null });
});

describe('when Personal FM tops up ahead', () => {
    it('wants a batch once the playing song is among the last two of the queue', () => {
        const queue = queueOf(1, 2, 3, 4, 5);
        expect(fmLookaheadWanted(true, queue, queue[2])).toBe(false);
        expect(fmLookaheadWanted(true, queue, queue[3])).toBe(true);
        expect(fmLookaheadWanted(true, queue, queue[4])).toBe(true);
    });

    it('wants nothing outside FM or for a song not in the queue', () => {
        const queue = queueOf(1, 2);
        expect(fmLookaheadWanted(false, queue, queue[1])).toBe(false);
        expect(fmLookaheadWanted(true, queue, song(9))).toBe(false);
        expect(fmLookaheadWanted(true, queue, null)).toBe(false);
    });
});

describe('topping up Personal FM ahead', () => {
    it('appends the songs of the batch the queue does not have yet, without moving the playing song', async () => {
        const queue = queueOf(1, 2, 3);
        usePlaybackStore.setState({ isFmMode: true, playQueue: queue, currentSong: queue[2] });
        omniMock.getPersonalFm.mockResolvedValueOnce(queueOf(3, 4, 5, 4));

        await expect(topUpPersonalFm(queue[2])).resolves.toBe(2);
        const state = usePlaybackStore.getState();
        expect(state.playQueue.map(item => item.id)).toEqual(['1', '2', '3', '4', '5']);
        expect(state.currentSong?.id).toBe('3');
    });

    it('drops the batch when another song started playing while it came', async () => {
        const queue = queueOf(1, 2, 3);
        usePlaybackStore.setState({ isFmMode: true, playQueue: queue, currentSong: queue[2] });
        omniMock.getPersonalFm.mockImplementationOnce(async () => {
            usePlaybackStore.setState({ currentSong: queue[0] });
            return queueOf(4, 5);
        });

        await expect(topUpPersonalFm(queue[2])).resolves.toBe(0);
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });

    it('drops the batch when FM ended or a queue of its own started while it came', async () => {
        const queue = queueOf(1, 2);
        usePlaybackStore.setState({ isFmMode: true, playQueue: queue, currentSong: queue[1] });
        omniMock.getPersonalFm.mockImplementationOnce(async () => {
            usePlaybackStore.setState({ isFmMode: false });
            return queueOf(3);
        });
        await expect(topUpPersonalFm(queue[1])).resolves.toBe(0);

        usePlaybackStore.setState({ isFmMode: true });
        omniMock.getPersonalFm.mockImplementationOnce(async () => {
            noteQueueStart();
            return queueOf(3);
        });
        await expect(topUpPersonalFm(queue[1])).resolves.toBe(0);
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });

    it('leaves the queue as it is when the radio fails', async () => {
        const queue = queueOf(1, 2);
        usePlaybackStore.setState({ isFmMode: true, playQueue: queue, currentSong: queue[1] });
        omniMock.getPersonalFm.mockRejectedValueOnce(new Error('offline'));

        await expect(topUpPersonalFm(queue[1])).resolves.toBe(0);
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });
});
