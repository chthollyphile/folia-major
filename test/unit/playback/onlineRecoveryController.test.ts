import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAudioSourceMock = vi.hoisted(() => vi.fn());
const setAudioSrcMock = vi.hoisted(() => vi.fn());
const setPlayQueueMock = vi.hoisted(() => vi.fn());
const playbackState = vi.hoisted(() => ({ playQueue: [] as unknown[] }));

vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongAudioSource: loadAudioSourceMock,
    applyOnlineAudioSourceMetadata: (song: unknown, replayGain?: unknown) => (replayGain ? { ...(song as object), replayGain } : song),
}));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: { getState: () => playbackState },
    setAudioSrc: setAudioSrcMock,
    setCurrentSong: vi.fn(),
    setPlayQueue: setPlayQueueMock,
}));

import {
    createOnlineRecoveryController,
    getOnlineRecoveryKey,
    type OnlineRecovery,
} from '@/components/app/playback/restore/createOnlineRecoveryController';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import { askForSong } from '@/components/app/playback/currentSong';
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

const otherSong: SongResult = {
    id: 'qq-other',
    name: 'Other',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    qqMid: '000OtherSongMid',
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: '000OtherSongMid' },
};

const ref = <T,>(value: T) => ({ current: value });

// QQ mints a fresh vkey/guid per request, so consecutive refreshes of one file differ only in query.
const streamUrl = (vkey: string) =>
    `http://isure.stream.qqmusic.qq.com/M800004Th6td4LaoZs004Th6td4LaoZs.mp3?guid=${vkey}&vkey=${vkey}&uin=1&fromtag=8`;

const createController = (audioSrc: string, {
    currentSong = song,
    recoveryRef = ref(new Map<string, Promise<OnlineRecovery>>()),
    blobUrlRef = ref<string | null>(null),
}: {
    currentSong?: SongResult;
    recoveryRef?: { current: Map<string, Promise<OnlineRecovery>> };
    blobUrlRef?: { current: string | null };
} = {}) => {
    const lastAudioRecoverySourceRef = ref<string | null>(null);
    const audioRef = ref<HTMLAudioElement | null>({ currentTime: 0, currentSrc: audioSrc } as HTMLAudioElement);
    const shouldAutoPlayRef = ref(false);
    const pendingResumeTimeRef = ref<number | null>(null);
    const persistLastPlaybackCache = vi.fn(async () => undefined);

    // The recovery works for the song the player was last asked for.
    askForSong(currentSong);
    const controller = createOnlineRecoveryController({
        audioQuality: 'high',
        currentSong,
        audioSrc,
        audioRef,
        blobUrlRef,
        shouldAutoPlayRef,
        pendingResumeTimeRef,
        onlinePlaybackRecoveryRef: recoveryRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef: ref<number | null>(null),
        persistLastPlaybackCache,
        onlineAudioUrlTtlMs: 60_000,
        onlineAudioUrlRefreshBufferMs: 5_000,
    });

    return {
        controller, lastAudioRecoverySourceRef, shouldAutoPlayRef, recoveryRef,
        blobUrlRef, pendingResumeTimeRef, persistLastPlaybackCache,
    };
};

type LoaderResult = { kind: 'ok'; audioSrc: string; blobUrl?: string; replayGain?: unknown } | { kind: 'unavailable'; failure: unknown };
// What the loader answers where the platform could not be reached.
const unreachable = () => onlineFailureOf({ operation: 'audio', providerId: 'qq' }, { detail: { case: 'unreachable' } });
const pendingLoad = () => {
    let finish!: (result: LoaderResult) => void;
    const promise = new Promise<LoaderResult>(resolve => { finish = resolve; });
    return { promise, finish };
};

describe('online playback recovery bounds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadAudioSourceMock.mockReset();
    });

    it('keys retries on the media path so a re-minted stream token cannot restart the loop', () => {
        expect(getOnlineRecoveryKey(streamUrl('one'))).toBe(getOnlineRecoveryKey(streamUrl('two')));
        expect(getOnlineRecoveryKey(streamUrl('one')))
            .toBe('http://isure.stream.qqmusic.qq.com/M800004Th6td4LaoZs004Th6td4LaoZs.mp3');
        // YouTube Music 的地址每次请求都换一把 key：同一首歌必须落在同一个重试 key 上。
        expect(getOnlineRecoveryKey('folia-ytm://audio/m9SMT5ipbxk?k=one'))
            .toBe(getOnlineRecoveryKey('folia-ytm://audio/m9SMT5ipbxk?k=two'));
        expect(getOnlineRecoveryKey('folia-ytm://audio/m9SMT5ipbxk?k=one'))
            .not.toBe(getOnlineRecoveryKey('folia-ytm://audio/ZRtdQ81jPUQ?k=one'));
        expect(getOnlineRecoveryKey('blob:folia/abc')).toBe('blob:folia/abc');
        expect(getOnlineRecoveryKey(null)).toBeNull();
    });

    it('refuses a second recovery for the same media file after the refreshed URL also fails', async () => {
        const firstUrl = streamUrl('one');
        const { controller } = createController(firstUrl);
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two') });

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: firstUrl, autoplay: true }))
            .resolves.toEqual({ recovered: true });
        // The refreshed URL fails too. Before this guard the differing vkey made it look brand new,
        // so the error -> refresh -> error cycle never reached skipAfterPlaybackFailure().
        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('two'), autoplay: true }))
            .resolves.toEqual({ recovered: false });
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(1);
    });

    it('lets a forced (manual) retry bypass the per-file guard', async () => {
        const firstUrl = streamUrl('one');
        const { controller } = createController(firstUrl);
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two') });

        await controller.recoverOnlinePlaybackSource({ failedSrc: firstUrl, autoplay: true });
        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('two'), autoplay: true, force: true }))
            .resolves.toEqual({ recovered: true });
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(2);
    });

    it('allows a refresh again once the source actually played', async () => {
        const firstUrl = streamUrl('one');
        const { controller, lastAudioRecoverySourceRef } = createController(firstUrl);
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two') });

        await controller.recoverOnlinePlaybackSource({ failedSrc: firstUrl, autoplay: true });
        // Stands in for the audio element's `playing` event clearing the guard.
        lastAudioRecoverySourceRef.current = null;

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('two'), autoplay: true }))
            .resolves.toEqual({ recovered: true });
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(2);
    });

    it('commits a refreshed source without autoplay after pause during its fetch', async () => {
        const { controller, shouldAutoPlayRef } = createController(streamUrl('one'));
        const load = pendingLoad();
        loadAudioSourceMock.mockImplementation(() => load.promise);
        let wantsPlayback = true;
        const recovery = controller.recoverOnlinePlaybackSource({
            autoplay: true, shouldAutoplay: () => wantsPlayback,
        });
        wantsPlayback = false;
        load.finish({ kind: 'ok', audioSrc: streamUrl('two') });
        await expect(recovery).resolves.toEqual({ recovered: true });
        expect(setAudioSrcMock).toHaveBeenCalledWith(streamUrl('two'));
        expect(shouldAutoPlayRef.current).toBe(false);
    });

    it('honors a later resume before the pending refresh commits', async () => {
        const { controller, shouldAutoPlayRef } = createController(streamUrl('one'));
        const load = pendingLoad();
        loadAudioSourceMock.mockImplementation(() => load.promise);
        let wantsPlayback = true;
        const recovery = controller.recoverOnlinePlaybackSource({
            autoplay: true, shouldAutoplay: () => wantsPlayback,
        });
        wantsPlayback = false;
        wantsPlayback = true;
        load.finish({ kind: 'ok', audioSrc: streamUrl('two') });
        await expect(recovery).resolves.toEqual({ recovered: true });
        expect(setAudioSrcMock).toHaveBeenCalledWith(streamUrl('two'));
        expect(shouldAutoPlayRef.current).toBe(true);
    });
});

describe('online playback recovery results', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadAudioSourceMock.mockReset();
    });

    it('asks the loader for a refresh and passes bypassMediaCache through', async () => {
        const { controller } = createController('blob:folia/cached');
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two') });

        await controller.recoverOnlinePlaybackSource({ failedSrc: 'blob:folia/cached', autoplay: true, bypassMediaCache: true });
        expect(loadAudioSourceMock).toHaveBeenCalledWith(song, 'high', null, { bypassMediaCache: true });
    });

    it('hands on a loader failure as it was, touching neither queue nor cache', async () => {
        const { controller, persistLastPlaybackCache } = createController(streamUrl('one'));
        const failure = onlineFailureOf({ operation: 'audio', providerId: 'qq' }, { detail: { case: 'sign-in-needed' } });
        loadAudioSourceMock.mockResolvedValue({ kind: 'unavailable', failure });

        const result = await controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), autoplay: true });
        expect(result).toEqual({ recovered: false, failure });
        expect(setAudioSrcMock).not.toHaveBeenCalled();
        expect(setPlayQueueMock).not.toHaveBeenCalled();
        expect(persistLastPlaybackCache).not.toHaveBeenCalled();
    });

    // The loader answers a failure instead of throwing (onlinePlayback.ts): a throw is not a platform's, so nothing says more.
    it('sorts a thrown loader error instead of reporting a bare failure', async () => {
        const { controller } = createController(streamUrl('one'));
        loadAudioSourceMock.mockRejectedValue(new TypeError('Failed to fetch'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const result = await controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), autoplay: true });
        expect(result).toMatchObject({ recovered: false, failure: { case: 'unknown', operation: 'audio', providerId: 'qq' } });
        expect(setPlayQueueMock).not.toHaveBeenCalled();
    });

    it('reports stale when the song changes while the refresh is in flight', async () => {
        const { controller } = createController(streamUrl('one'));
        const load = pendingLoad();
        loadAudioSourceMock.mockImplementation(() => load.promise);

        const recovery = controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), autoplay: true });
        askForSong(otherSong);
        load.finish({ kind: 'ok', audioSrc: streamUrl('two') });

        await expect(recovery).resolves.toEqual({ recovered: false, stale: true });
        expect(setAudioSrcMock).not.toHaveBeenCalled();
    });

    // 同一首歌重新点播落地：key 不变、代次变了。旧刷新的结果不能暂停新播放，也不能把它的音源和进度换回出错时的样子。
    it.each([
        ['fails', { kind: 'unavailable', failure: unreachable() }],
        ['succeeds', { kind: 'ok', audioSrc: 'blob:folia/old-refresh', blobUrl: 'blob:folia/old-refresh' }],
    ] as const)('reports stale when the same song is played again while its refresh %s', async (_outcome, loaded) => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const { controller, blobUrlRef, pendingResumeTimeRef } = createController(streamUrl('one'), {
            blobUrlRef: ref<string | null>('blob:folia/replay'),
        });
        const load = pendingLoad();
        loadAudioSourceMock.mockImplementation(() => load.promise);

        const recovery = controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), resumeAt: 95, autoplay: true });
        askForSong(song); // playSong asked for the same song again
        load.finish(loaded);

        await expect(recovery).resolves.toEqual({ recovered: false, stale: true });
        expect(setAudioSrcMock).not.toHaveBeenCalled();
        expect(pendingResumeTimeRef.current).toBeNull();
        expect(blobUrlRef.current).toBe('blob:folia/replay');
        expect(revoke).not.toHaveBeenCalledWith('blob:folia/replay');
        if (loaded.kind === 'ok') expect(revoke).toHaveBeenCalledWith('blob:folia/old-refresh');
        revoke.mockRestore();
    });

    it('starts a replay its own refresh instead of joining the one left from the earlier playback', async () => {
        const { controller, recoveryRef } = createController(streamUrl('one'));
        const oldLoad = pendingLoad();
        const newLoad = pendingLoad();
        loadAudioSourceMock.mockImplementationOnce(() => oldLoad.promise).mockImplementationOnce(() => newLoad.promise);

        const oldRecovery = controller.recoverOnlinePlaybackSource({ autoplay: true, force: true });
        askForSong(song);
        const newRecovery = controller.recoverOnlinePlaybackSource({ autoplay: true, force: true });
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(2);

        // The old task settles first; its cleanup must leave the replay's in-flight entry alone.
        oldLoad.finish({ kind: 'unavailable', failure: unreachable() });
        await expect(oldRecovery).resolves.toEqual({ recovered: false, stale: true });
        expect(recoveryRef.current.size).toBe(1);
        const joined = controller.recoverOnlinePlaybackSource({ autoplay: true, force: true });
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(2);

        newLoad.finish({ kind: 'ok', audioSrc: streamUrl('two') });
        await expect(newRecovery).resolves.toEqual({ recovered: true });
        await expect(joined).resolves.toEqual({ recovered: true });
        expect(setAudioSrcMock).toHaveBeenCalledWith(streamUrl('two'));
        expect(recoveryRef.current.size).toBe(0);
    });

    it('gives a second song its own recovery while the first one is still in flight', async () => {
        const recoveryRef = ref(new Map<string, Promise<OnlineRecovery>>());
        const first = createController(streamUrl('one'), { recoveryRef });
        const firstLoad = pendingLoad();
        loadAudioSourceMock.mockImplementationOnce(() => firstLoad.promise);
        const firstRecovery = first.controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), autoplay: true });

        // The listener moves on (the helper asks for the new song); App rebuilds the controller for it over the same refs.
        const second = createController('https://cdn.example/other.mp3', { currentSong: otherSong, recoveryRef });
        loadAudioSourceMock.mockResolvedValueOnce({ kind: 'ok', audioSrc: 'https://cdn.example/other-fresh.mp3' });
        const secondRecovery = second.controller.recoverOnlinePlaybackSource({ failedSrc: 'https://cdn.example/other.mp3', autoplay: true });

        await expect(secondRecovery).resolves.toEqual({ recovered: true });
        firstLoad.finish({ kind: 'ok', audioSrc: streamUrl('two') });
        await expect(firstRecovery).resolves.toEqual({ recovered: false, stale: true });

        expect(loadAudioSourceMock).toHaveBeenCalledTimes(2);
        expect(setAudioSrcMock).toHaveBeenCalledTimes(1);
        expect(setAudioSrcMock).toHaveBeenCalledWith('https://cdn.example/other-fresh.mp3');
        expect(recoveryRef.current.size).toBe(0);
    });

    it('shares one in-flight recovery between callers for the same song', async () => {
        const { controller } = createController(streamUrl('one'));
        const load = pendingLoad();
        loadAudioSourceMock.mockImplementation(() => load.promise);

        const first = controller.recoverOnlinePlaybackSource({ autoplay: true, force: true });
        const second = controller.recoverOnlinePlaybackSource({ autoplay: true, force: true });
        load.finish({ kind: 'ok', audioSrc: streamUrl('two') });

        await expect(first).resolves.toEqual({ recovered: true });
        await expect(second).resolves.toEqual({ recovered: true });
        expect(loadAudioSourceMock).toHaveBeenCalledTimes(1);
    });

    it('commits a refreshed ReplayGain into the queue as it is now, not as it was at creation', async () => {
        const { controller, persistLastPlaybackCache } = createController(streamUrl('one'));
        // The queue was edited after the controller was built (it captured [song]).
        const editedQueue = [otherSong, song];
        playbackState.playQueue = editedQueue;
        const replayGain = { trackGain: -6 };
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two'), replayGain });

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), autoplay: true, force: true }))
            .resolves.toEqual({ recovered: true });
        const expectedQueue = [otherSong, { ...song, replayGain }];
        expect(setPlayQueueMock).toHaveBeenCalledWith(expectedQueue);
        expect(persistLastPlaybackCache).toHaveBeenCalledWith({ ...song, replayGain }, expectedQueue);
    });

    // Only the entry is refreshed: a song the queue no longer holds (removed by the user, or a mod replaced
    // the queue whole) is not put back in front of it.
    it('writes no queue when the song is no longer in it, and saves the queue as it is now', async () => {
        const { controller, persistLastPlaybackCache } = createController(streamUrl('one'));
        const editedQueue = [otherSong];
        playbackState.playQueue = editedQueue;
        const replayGain = { trackGain: -6 };
        loadAudioSourceMock.mockResolvedValue({ kind: 'ok', audioSrc: streamUrl('two'), replayGain });

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('one'), autoplay: true, force: true }))
            .resolves.toEqual({ recovered: true });
        expect(setPlayQueueMock).not.toHaveBeenCalled();
        expect(persistLastPlaybackCache).toHaveBeenCalledWith({ ...song, replayGain }, editedQueue);
    });

    it('does not attempt a recovery for a non-online song', async () => {
        const localSong = { ...song, id: 'local-1', sourceRef: undefined, isLocal: true, localRef: { songId: 'local-1' } } as unknown as SongResult;
        const { controller } = createController('blob:folia/local', { currentSong: localSong });

        await expect(controller.recoverOnlinePlaybackSource({ autoplay: true })).resolves.toEqual({ recovered: false });
        expect(loadAudioSourceMock).not.toHaveBeenCalled();
    });

    // The media error alone says only that the file did not play; the address asked for anew says why.
    it('hands on why a new address could not be had, and nothing where none was asked for', async () => {
        const firstUrl = streamUrl('one');
        const { controller } = createController(firstUrl);
        const failure = onlineFailureOf({ operation: 'audio', providerId: 'qq' }, { detail: { case: 'local-service-stopped' } });
        loadAudioSourceMock.mockResolvedValue({ kind: 'unavailable', failure });

        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: firstUrl, autoplay: true }))
            .resolves.toEqual({ recovered: false, failure });
        await expect(controller.recoverOnlinePlaybackSource({ failedSrc: streamUrl('two'), autoplay: true }))
            .resolves.toEqual({ recovered: false });
    });
});
