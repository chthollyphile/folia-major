import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOnlineMediaFailure } from '@/components/app/playback/handleOnlineMediaFailure';
import {
    clearCachedSongAudioDistrust,
    isCachedSongAudioDistrusted,
} from '@/services/playbackRecovery/mediaCacheGuard';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import type { SongResult } from '@/types';
import type { OnlineRecoveryOptions, OnlineRecoveryResult, PlaybackFailure, PlaybackFailureSkipOptions } from '@/types/playbackFailure';

// test/unit/playback/handleOnlineMediaFailure.test.ts

const song: SongResult = {
    id: 'qq-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    qqMid: '004Th6td4LaoZs',
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: '004Th6td4LaoZs' },
};
const songKey = getPlaybackSongKey(song);
// 出错时的播放代次；失败交给统一策略时原样带上，策略据此判断失败是否仍属于当前这次播放。
const GENERATION = 3;
const streamUrl = 'https://isure.stream.qqmusic.qq.com/M800004Th6td4LaoZs.mp3?vkey=one';

const audioWithError = (code: number | null, currentTime = 42) => ({
    error: code === null ? null : { code },
    currentTime,
}) as unknown as HTMLAudioElement;

const setup = (results: OnlineRecoveryResult[]) => {
    const recover = vi.fn<(options: OnlineRecoveryOptions) => Promise<OnlineRecoveryResult>>();
    for (const result of results) recover.mockResolvedValueOnce(result);
    const skip = vi.fn<(failure?: PlaybackFailure, options?: PlaybackFailureSkipOptions) => void>();
    return { recover, skip };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('handleOnlineMediaFailure', () => {
    beforeEach(() => {
        clearCachedSongAudioDistrust(song);
    });

    it('ignores an aborted load', async () => {
        const { recover, skip } = setup([]);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(1), failedSrc: streamUrl, song, playbackGeneration: GENERATION, autoplay: true,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        expect(recover).not.toHaveBeenCalled();
        expect(skip).not.toHaveBeenCalled();
    });

    it.each(['recovered', 'stale'] as const)('does nothing more once the refresh is %s', async status => {
        const { recover, skip } = setup([{ status }]);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(3), failedSrc: streamUrl, song, playbackGeneration: GENERATION, autoplay: true,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        expect(recover).toHaveBeenCalledWith({ failedSrc: streamUrl, resumeAt: 42, autoplay: true, bypassMediaCache: false });
        expect(skip).not.toHaveBeenCalled();
    });

    it('hands the refresh failure and the failed song key to the failure policy', async () => {
        const failure: PlaybackFailure = { reason: 'region-restricted', stage: 'refresh', providerId: 'qq' };
        const { recover, skip } = setup([{ status: 'failed', failure }]);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(4), failedSrc: streamUrl, song, playbackGeneration: GENERATION, autoplay: false,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        expect(skip).toHaveBeenCalledTimes(1);
        expect(skip).toHaveBeenCalledWith(failure, { failedSongKey: songKey, failedGeneration: GENERATION, retry: expect.any(Function) });
    });

    it.each([
        [2, { reason: 'network', stage: 'media-element', providerId: 'qq' }],
        [3, { reason: 'unknown', stage: 'media-element', providerId: 'qq', mediaErrorCode: 3 }],
        [4, { reason: 'unknown', stage: 'media-element', providerId: 'qq', mediaErrorCode: 4 }],
    ])('falls back to the media error (code %s) when no refresh was attempted', async (code, expected) => {
        const { recover, skip } = setup([{ status: 'not-attempted' }]);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(code), failedSrc: streamUrl, song, playbackGeneration: GENERATION, autoplay: true,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        expect(skip).toHaveBeenCalledWith(expected, { failedSongKey: songKey, failedGeneration: GENERATION, retry: expect.any(Function) });
    });

    it('distrusts a cached blob and refreshes past the media cache', async () => {
        const { recover, skip } = setup([{ status: 'recovered' }]);
        expect(isCachedSongAudioDistrusted(song)).toBe(false);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(3, 10), failedSrc: 'blob:folia/cached-audio', song, playbackGeneration: GENERATION, autoplay: true,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        expect(isCachedSongAudioDistrusted(song)).toBe(true);
        expect(recover).toHaveBeenCalledWith({
            failedSrc: 'blob:folia/cached-audio', resumeAt: 10, autoplay: true, bypassMediaCache: true,
        });
        expect(skip).not.toHaveBeenCalled();
    });

    it('captures the element state before the first await', async () => {
        const audio = { error: { code: 2 }, currentTime: 42 } as unknown as { error: { code: number } | null; currentTime: number };
        const { recover, skip } = setup([]);
        recover.mockImplementationOnce(async () => {
            // The element moves on while the refresh is in flight.
            audio.error = null;
            audio.currentTime = 0;
            return { status: 'not-attempted' };
        });
        await handleOnlineMediaFailure({
            audioElement: audio as unknown as HTMLAudioElement, failedSrc: streamUrl, song, playbackGeneration: GENERATION, autoplay: true,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        expect(skip).toHaveBeenCalledWith(
            { reason: 'network', stage: 'media-element', providerId: 'qq' },
            { failedSongKey: songKey, failedGeneration: GENERATION, retry: expect.any(Function) },
        );
    });

    it('retries with force and keeps offering the same position-preserving retry after a second failure', async () => {
        const firstFailure: PlaybackFailure = { reason: 'unknown', stage: 'refresh', providerId: 'qq' };
        const secondFailure: PlaybackFailure = { reason: 'network', stage: 'refresh', providerId: 'qq' };
        const { recover, skip } = setup([
            { status: 'failed', failure: firstFailure },
            { status: 'failed', failure: secondFailure },
            { status: 'failed', failure: secondFailure },
        ]);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(3, 7), failedSrc: 'blob:folia/cached-audio', song, playbackGeneration: GENERATION, autoplay: false,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        const { retry } = skip.mock.calls[0][1]!;
        retry!();
        await flush();

        expect(recover).toHaveBeenNthCalledWith(2, { force: true, autoplay: true, resumeAt: 7, bypassMediaCache: true });
        expect(skip).toHaveBeenCalledTimes(2);
        expect(skip).toHaveBeenLastCalledWith(secondFailure, { failedSongKey: songKey, failedGeneration: GENERATION, retry });

        // The second toast's retry is the same one: forced again, and still back at 0:07 rather than from the start.
        skip.mock.calls[1][1]!.retry!();
        await flush();
        expect(recover).toHaveBeenNthCalledWith(3, { force: true, autoplay: true, resumeAt: 7, bypassMediaCache: true });
        expect(skip).toHaveBeenCalledTimes(3);
    });

    it('stays quiet when the forced retry recovers', async () => {
        const { recover, skip } = setup([
            { status: 'failed', failure: { reason: 'unknown', stage: 'refresh' } },
            { status: 'recovered' },
        ]);
        await handleOnlineMediaFailure({
            audioElement: audioWithError(4), failedSrc: streamUrl, song, playbackGeneration: GENERATION, autoplay: true,
            recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip,
        });
        skip.mock.calls[0][1]!.retry!();
        await flush();

        expect(recover).toHaveBeenCalledTimes(2);
        expect(skip).toHaveBeenCalledTimes(1);
    });
});
