import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAudioSourceMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongAudioSource: loadAudioSourceMock,
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
}));

import {
    createOnlineRecoveryController,
    getOnlineRecoveryKey,
} from '@/components/app/playback/createOnlineRecoveryController';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import type { SongResult } from '@/types';

// test/unit/playback/onlineRecoveryController.test.ts

const song: SongResult = {
    id: 'qq-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    qqMid: '004Th6td4LaoZs',
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: '004Th6td4LaoZs' },
};

const ref = <T,>(value: T) => ({ current: value });

// QQ mints a fresh vkey/guid per request, so consecutive refreshes of one file differ only in query.
const streamUrl = (vkey: string) =>
    `http://isure.stream.qqmusic.qq.com/M800004Th6td4LaoZs004Th6td4LaoZs.mp3?guid=${vkey}&vkey=${vkey}&uin=1&fromtag=8`;

const createController = (audioSrc: string) => {
    const lastAudioRecoverySourceRef = ref<string | null>(null);
    const audioRef = ref<HTMLAudioElement | null>({ currentTime: 0, currentSrc: audioSrc } as HTMLAudioElement);
    const setAudioSrc = vi.fn();

    const controller = createOnlineRecoveryController({
        audioQuality: 'high',
        currentSong: song,
        audioSrc,
        audioRef,
        currentSongRef: ref<string | number | null>(getPlaybackSongKey(song)),
        blobUrlRef: ref<string | null>(null),
        shouldAutoPlayRef: ref(false),
        pendingResumeTimeRef: ref<number | null>(null),
        onlinePlaybackRecoveryRef: ref<Promise<boolean> | null>(null),
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef: ref<number | null>(null),
        setAudioSrc,
        setCurrentSong: vi.fn(),
        setPlayQueue: vi.fn(),
        persistLastPlaybackCache: vi.fn(async () => undefined),
        playQueue: [song],
        onlineAudioUrlTtlMs: 60_000,
        onlineAudioUrlRefreshBufferMs: 5_000,
    } as unknown as Parameters<typeof createOnlineRecoveryController>[0]);

    return { controller, lastAudioRecoverySourceRef, setAudioSrc };
};

describe('online playback recovery bounds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keys retries on the media path so a re-minted stream token cannot restart the loop', () => {
        expect(getOnlineRecoveryKey(streamUrl('one'))).toBe(getOnlineRecoveryKey(streamUrl('two')));
        expect(getOnlineRecoveryKey(streamUrl('one')))
            .toBe('http://isure.stream.qqmusic.qq.com/M800004Th6td4LaoZs004Th6td4LaoZs.mp3');
        expect(getOnlineRecoveryKey('blob:folia/abc')).toBe('blob:folia/abc');
        expect(getOnlineRecoveryKey(null)).toBeNull();
    });

    it('refuses a second recovery for the same media file after the refreshed URL also fails', async () => {
        const firstUrl = streamUrl('one');
        const { controller } = createController(firstUrl);
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two') });

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: firstUrl, autoplay: true }))
            .resolves.toBe(true);
        // The refreshed URL fails too. Before this guard the differing vkey made it look brand new,
        // so the error -> refresh -> error cycle never reached skipAfterPlaybackFailure().
        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('two'), autoplay: true }))
            .resolves.toBe(false);
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(1);
    });

    it('allows a refresh again once the source actually played', async () => {
        const firstUrl = streamUrl('one');
        const { controller, lastAudioRecoverySourceRef } = createController(firstUrl);
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two') });

        await controller.recoverOnlinePlaybackSource({ failedSrc: firstUrl, autoplay: true });
        // Stands in for the audio element's `playing` event clearing the guard.
        lastAudioRecoverySourceRef.current = null;

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('two'), autoplay: true }))
            .resolves.toBe(true);
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(2);
    });
});
