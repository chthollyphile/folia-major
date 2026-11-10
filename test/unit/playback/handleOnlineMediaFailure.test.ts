import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOnlineMediaFailure } from '@/components/app/playback/handleOnlineMediaFailure';
import { askForSong, startOfAskedSong } from '@/components/app/playback/currentSong';
import type { OnlineRecovery, OnlineRecoveryOptions } from '@/components/app/playback/restore/createOnlineRecoveryController';
import type { PlaybackFailureSkipOptions } from '@/components/app/playback/start/usePlaybackQueueController';
import { mediaFailureOf, onlineFailureOf, type OnlineFailure } from '@/services/onlineMusic/failure/onlineFailureCase';
import {
    clearCachedSongAudioDistrust,
    isCachedSongAudioDistrusted,
} from '@/services/playbackRecovery/mediaCacheGuard';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import type { SongResult } from '@/types';

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
const streamUrl = 'https://isure.stream.qqmusic.qq.com/M800004Th6td4LaoZs.mp3?vkey=one';
const failureOf = (caseId: 'region-restricted' | 'unreachable' | 'unknown') => onlineFailureOf({ operation: 'audio', providerId: 'qq' }, { detail: { case: caseId } });

const audioWithError = (code: number | null, currentTime = 42) => ({
    error: code === null ? null : { code },
    currentTime,
}) as unknown as HTMLAudioElement;

const setup = (results: OnlineRecovery[]) => {
    const recover = vi.fn<(options: OnlineRecoveryOptions) => Promise<OnlineRecovery>>();
    for (const result of results) recover.mockResolvedValueOnce(result);
    const skip = vi.fn<(shown?: OnlineFailure, options?: PlaybackFailureSkipOptions) => void>();
    return { recover, skip };
};
const handle = (audioElement: HTMLAudioElement, failedSrc: string, autoplay: boolean, { recover, skip }: ReturnType<typeof setup>) => (
    handleOnlineMediaFailure({ audioElement, failedSrc, song, autoplay, recoverOnlinePlaybackSource: recover, skipAfterPlaybackFailure: skip })
);

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('handleOnlineMediaFailure', () => {
    let start = 0;
    beforeEach(() => {
        clearCachedSongAudioDistrust(song);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        askForSong(song);
        start = startOfAskedSong();
    });

    it('ignores an aborted load', async () => {
        const deps = setup([]);
        await handle(audioWithError(1), streamUrl, true, deps);
        expect(deps.recover).not.toHaveBeenCalled();
        expect(deps.skip).not.toHaveBeenCalled();
    });

    it.each([
        ['recovered', { recovered: true }],
        ['stale', { recovered: false, stale: true }],
    ] as const)('does nothing more once the refresh is %s', async (_label, outcome) => {
        const deps = setup([outcome]);
        await handle(audioWithError(3), streamUrl, true, deps);
        expect(deps.recover).toHaveBeenCalledWith({ failedSrc: streamUrl, resumeAt: 42, autoplay: true, bypassMediaCache: false });
        expect(deps.skip).not.toHaveBeenCalled();
    });

    it('hands why the new address could not be had, with the song and its start, to the queue', async () => {
        const failure = failureOf('region-restricted');
        const deps = setup([{ recovered: false, failure }]);
        await handle(audioWithError(4), streamUrl, false, deps);
        expect(deps.skip).toHaveBeenCalledTimes(1);
        expect(deps.skip).toHaveBeenCalledWith(failure, { failedSongKey: songKey, failedStart: start, retry: expect.any(Function) });
    });

    it.each([
        [2, 'unreachable'],
        [3, 'audio-unplayable'],
        [4, 'audio-unplayable'],
    ] as const)('falls back to the media error (code %s) when no new address was asked for', async (code, caseId) => {
        const deps = setup([{ recovered: false }]);
        await handle(audioWithError(code), streamUrl, true, deps);
        expect(deps.skip).toHaveBeenCalledWith(
            expect.objectContaining({ case: caseId, operation: 'media', providerId: 'qq' }),
            { failedSongKey: songKey, failedStart: start, retry: expect.any(Function) },
        );
    });

    it('distrusts a cached blob and asks past the media cache', async () => {
        const deps = setup([{ recovered: true }]);
        expect(isCachedSongAudioDistrusted(song)).toBe(false);
        await handle(audioWithError(3, 10), 'blob:folia/cached-audio', true, deps);
        expect(isCachedSongAudioDistrusted(song)).toBe(true);
        expect(deps.recover).toHaveBeenCalledWith({
            failedSrc: 'blob:folia/cached-audio', resumeAt: 10, autoplay: true, bypassMediaCache: true,
        });
        expect(deps.skip).not.toHaveBeenCalled();
    });

    it('reads the element before the first wait', async () => {
        const audio = { error: { code: 2 }, currentTime: 42 } as unknown as { error: { code: number } | null; currentTime: number };
        const deps = setup([]);
        deps.recover.mockImplementationOnce(async () => {
            // The element moves on while the new address is asked for.
            audio.error = null;
            audio.currentTime = 0;
            return { recovered: false };
        });
        await handle(audio as unknown as HTMLAudioElement, streamUrl, true, deps);
        expect(deps.skip).toHaveBeenCalledWith(
            mediaFailureOf({ code: 2 }, 'qq'),
            { failedSongKey: songKey, failedStart: start, retry: expect.any(Function) },
        );
    });

    it('retries with force and keeps offering the same retry from where it failed after a second failure', async () => {
        const firstFailure = failureOf('unknown');
        const secondFailure = failureOf('unreachable');
        const deps = setup([
            { recovered: false, failure: firstFailure },
            { recovered: false, failure: secondFailure },
            { recovered: false, failure: secondFailure },
        ]);
        await handle(audioWithError(3, 7), 'blob:folia/cached-audio', false, deps);
        const { retry } = deps.skip.mock.calls[0][1]!;
        retry!();
        await flush();

        expect(deps.recover).toHaveBeenNthCalledWith(2, { force: true, autoplay: true, resumeAt: 7, bypassMediaCache: true });
        expect(deps.skip).toHaveBeenCalledTimes(2);
        expect(deps.skip).toHaveBeenLastCalledWith(secondFailure, { failedSongKey: songKey, failedStart: start, retry });

        // The second toast's retry is the same one: forced again, and still back at 0:07 rather than from the start.
        deps.skip.mock.calls[1][1]!.retry!();
        await flush();
        expect(deps.recover).toHaveBeenNthCalledWith(3, { force: true, autoplay: true, resumeAt: 7, bypassMediaCache: true });
        expect(deps.skip).toHaveBeenCalledTimes(3);
    });

    it('stays quiet when the forced retry recovers, or when the song moved on meanwhile', async () => {
        const deps = setup([
            { recovered: false, failure: failureOf('unknown') },
            { recovered: true },
            { recovered: false, stale: true },
        ]);
        await handle(audioWithError(4), streamUrl, true, deps);
        deps.skip.mock.calls[0][1]!.retry!();
        await flush();
        deps.skip.mock.calls[0][1]!.retry!();
        await flush();

        expect(deps.recover).toHaveBeenCalledTimes(3);
        expect(deps.skip).toHaveBeenCalledTimes(1);
    });
});
