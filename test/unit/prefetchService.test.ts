import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { OnlineProviderError } from '@/types/onlineMusic';
import { clearPrefetchRuntime, getPrefetchWindowKey, getPrefetchedData, resolvePrefetchAudioUrl, shouldRefreshPrefetchAfterQueueEdit, updatePrefetchedAudioUrl } from '@/services/prefetchService';

// test/unit/prefetchService.test.ts

const mocks = vi.hoisted(() => ({
    getAudioSource: vi.fn(),
    hasCachedSongAudio: vi.fn(),
    getProviderPlaybackCooldown: vi.fn(),
    noteProviderFailure: vi.fn(),
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getAudioSource: (...args: unknown[]) => mocks.getAudioSource(...args),
        canPlaySong: () => true,
    },
}));
vi.mock('@/services/onlineMusic/resourceCache', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/resourceCache')>(),
    hasCachedSongAudio: (...args: unknown[]) => mocks.hasCachedSongAudio(...args),
}));
vi.mock('@/services/playbackRecovery/providerPlaybackCooldown', () => ({
    getProviderPlaybackCooldown: (...args: unknown[]) => mocks.getProviderPlaybackCooldown(...args),
    noteProviderFailure: (...args: unknown[]) => mocks.noteProviderFailure(...args),
}));

const song: SongResult = {
    id: 'prefetch-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'prefetch-song' },
};

describe('prefetched online ReplayGain metadata', () => {
    beforeEach(() => clearPrefetchRuntime());

    it('keeps ReplayGain alongside a prefetched URL', () => {
        updatePrefetchedAudioUrl(song, 'https://audio.test/song.flac', 'high', {
            trackGain: -7.1,
            trackPeak: 0.9,
        });

        expect(getPrefetchedData(song, 'high')).toMatchObject({
            audioUrl: 'https://audio.test/song.flac',
            replayGain: { trackGain: -7.1, trackPeak: 0.9 },
        });
    });

    it('keeps the media-cache sentinel, which has no quality to mismatch', () => {
        // 'CACHED_IN_DB' says the bytes are already on disk. It is not a URL, so there is nothing
        // to re-fetch at a different quality - but the mismatch branch answered by nulling it,
        // and a cached track therefore reported itself as uncached the first time anything asked.
        updatePrefetchedAudioUrl(song, 'CACHED_IN_DB', 'standard');

        expect(getPrefetchedData(song, 'hires')).toMatchObject({ audioUrl: 'CACHED_IN_DB' });
    });

    it('invalidates URL metadata together on a quality mismatch', () => {
        updatePrefetchedAudioUrl(song, 'https://audio.test/song.flac', 'high', { trackGain: -7.1 });

        expect(getPrefetchedData(song, 'lossless')).toMatchObject({
            audioUrl: null,
            replayGain: undefined,
        });
    });
});

describe('prefetch window key', () => {
    const track = (id: string): SongResult => ({
        ...song,
        id,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
    });
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(track);

    it('changes only when the songs around the playing one change', () => {
        const current = queue[2];
        const window = getPrefetchWindowKey(current, queue);
        // 窗口（b c d e）外的编辑（把 g 挪到 f 前面）不需要重新预取。
        expect(getPrefetchWindowKey(current, [queue[0], queue[1], queue[2], queue[3], queue[4], queue[6], queue[5]])).toBe(window);
        // 下一首换了（把 f 挪到正在播放的下一首）就要。
        expect(getPrefetchWindowKey(current, [queue[0], queue[1], queue[2], queue[5], queue[3], queue[4], queue[6]])).not.toBe(window);
        // 上一首换了也要（「上一首」是预取的）。
        expect(getPrefetchWindowKey(current, [queue[1], queue[0], queue[2], queue[3], queue[4], queue[5], queue[6]])).not.toBe(window);
    });

    it('is empty when the playing song is not in the queue', () => {
        expect(getPrefetchWindowKey(track('z'), queue)).toBe('');
    });
});

describe('prefetch refresh after an in-place queue edit', () => {
    const track = (id: string): SongResult => ({
        ...song,
        id,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
    });
    const queue = ['a', 'b', 'c', 'd', 'e', 'f'].map(track);
    const current = queue[1];

    it('refreshes only when the window around the playing song changed', () => {
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, [queue[0], queue[1], queue[4], queue[2], queue[3], queue[5]])).toBe(true);
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, [queue[0], queue[1], queue[2], queue[3], queue[5], queue[4]])).toBe(false);
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, queue)).toBe(false);
        expect(shouldRefreshPrefetchAfterQueueEdit(null, queue, [...queue].reverse())).toBe(false);
    });

    it('leaves the prefetch alone when the playing song was removed from the queue', () => {
        // 新窗口键为空：invalidateAndRefetch 会删掉当前歌的预取、中止邻近预取又不重启，所以不刷新。
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, queue.filter(item => item !== current))).toBe(false);
    });

    it('does not refresh a queue left with only the playing song', () => {
        expect(shouldRefreshPrefetchAfterQueueEdit(current, queue, [current])).toBe(false);
    });
});

// 预取只在成功时写；失败、冷却和被新队列取代的结果都返回 null，调用方什么都不写。
describe('resolvePrefetchAudioUrl', () => {
    const signal = () => new AbortController().signal;

    beforeEach(() => {
        clearPrefetchRuntime();
        vi.clearAllMocks();
        mocks.hasCachedSongAudio.mockResolvedValue(false);
        mocks.getProviderPlaybackCooldown.mockReturnValue(null);
        mocks.getAudioSource.mockResolvedValue({
            url: 'https://audio.test/song.flac',
            fetchedAt: 0,
            quality: 'high',
            replayGain: { trackGain: -6 },
        });
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('returns the provider URL and its ReplayGain', async () => {
        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toEqual({
            audioUrl: 'https://audio.test/song.flac',
            replayGain: { trackGain: -6 },
        });
        expect(mocks.getAudioSource).toHaveBeenCalledWith(song, 'high');
    });

    it('answers the media-cache sentinel without asking the provider', async () => {
        mocks.hasCachedSongAudio.mockResolvedValue(true);

        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toEqual({ audioUrl: 'CACHED_IN_DB' });
        expect(mocks.getAudioSource).not.toHaveBeenCalled();
    });

    it('writes nothing when the provider fails or gives no URL', async () => {
        mocks.getAudioSource.mockRejectedValueOnce(new OnlineProviderError('not-playable', 'no link', 'netease'));
        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();

        mocks.getAudioSource.mockResolvedValueOnce(null);
        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();

        mocks.getAudioSource.mockResolvedValueOnce({ url: '', fetchedAt: 0, quality: 'high' });
        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();

        expect(getPrefetchedData(song)).toBeNull();
    });

    it('rejects a URL the loader would also refuse, so a prefetch cannot smuggle it past the guard', async () => {
        mocks.getAudioSource.mockResolvedValueOnce({ url: 'javascript:alert(1)', fetchedAt: 0, quality: 'high' });
        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();

        mocks.getAudioSource.mockResolvedValueOnce({ url: '   ', fetchedAt: 0, quality: 'high' });
        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();
    });

    it('does not ask the provider while it is cooling down', async () => {
        mocks.getProviderPlaybackCooldown.mockReturnValue({ remainingMs: 12_000 });

        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();
        expect(mocks.getProviderPlaybackCooldown).toHaveBeenCalledWith('netease', 'prefetch');
        expect(mocks.getAudioSource).not.toHaveBeenCalled();
    });

    it('notes a rate-limited failure against the provider', async () => {
        mocks.getAudioSource.mockRejectedValueOnce(
            new OnlineProviderError('rate-limited', 'slow down', 'netease', undefined, 429, 30_000),
        );

        await expect(resolvePrefetchAudioUrl(song, 'high', signal())).resolves.toBeNull();
        expect(mocks.noteProviderFailure).toHaveBeenCalledTimes(1);
        expect(mocks.noteProviderFailure).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'rate-limited',
            stage: 'prefetch',
            providerId: 'netease',
            httpStatus: 429,
            retryAfterMs: 30_000,
        }));
    });

    it('drops a URL that arrives after the prefetch was superseded', async () => {
        const controller = new AbortController();
        mocks.getAudioSource.mockImplementationOnce(async () => {
            controller.abort();
            return { url: 'https://audio.test/stale.flac', fetchedAt: 0, quality: 'high' };
        });

        await expect(resolvePrefetchAudioUrl(song, 'high', controller.signal)).resolves.toBeNull();
        expect(getPrefetchedData(song)).toBeNull();
    });

    it('does not ask the provider once aborted during the media-cache check', async () => {
        const controller = new AbortController();
        mocks.hasCachedSongAudio.mockImplementationOnce(async () => {
            controller.abort();
            return false;
        });

        await expect(resolvePrefetchAudioUrl(song, 'high', controller.signal)).resolves.toBeNull();
        expect(mocks.getAudioSource).not.toHaveBeenCalled();
    });
});
