import type { LocalSong, SongResult } from '../../types';
import type { TranscodeFallbackRequest, TranscodeFallbackResult, TranscodeFallbackSource } from '../../types/playbackRecovery';
import { getFileFromLocalSong } from '../localMusicService';
import { getPlaybackSongKey, isLocalPlaybackSong, isNavidromePlaybackSong, resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import { buildLocalSourceRevision, buildNavidromeSourceRevision } from './sourceRevision';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { errorMessage } from '../../utils/errorText';

// Resolves renderer-owned sources into the narrow, validated Electron transcode IPC contract.

const buildRequestId = () => (
    globalThis.crypto?.randomUUID?.()
    ?? `transcode-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const rendererRequests = new Map<string, AbortController>();

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw Object.assign(new Error('Transcode cancelled'), { code: 'CANCELLED' });
};

export const buildTranscodeFallbackSource = async (
    song: SongResult,
    failedSource: string,
    localSongs: LocalSong[],
    signal?: AbortSignal,
): Promise<TranscodeFallbackSource | null> => {
    throwIfAborted(signal);
    const songKey = getPlaybackSongKey(song);
    if (isLocalPlaybackSong(song)) {
        const localSong = localSongs.find(candidate => candidate.id === song.localRef.songId);
        if (!localSong) return null;
        const file = await getFileFromLocalSong(localSong);
        throwIfAborted(signal);
        if (!file || file.size <= 0) return null;
        const data = await file.arrayBuffer();
        throwIfAborted(signal);
        return {
            kind: 'local',
            songKey,
            sourceRevision: buildLocalSourceRevision(localSong, file),
            fileName: file.name || localSong.fileName,
            data,
        };
    }

    if (isNavidromePlaybackSong(song)) {
        const carrier = resolveNavidromePlaybackCarrier(song);
        if (!carrier) return null;
        const data = carrier.navidromeData;
        const common = {
            kind: 'navidrome',
            songKey,
            fileName: `${data.id}.${data.suffix || 'audio'}`,
        } as const;
        if (failedSource.startsWith('blob:')) {
            const bytes = await (await fetch(failedSource, { signal })).arrayBuffer();
            throwIfAborted(signal);
            return {
                ...common,
                sourceRevision: buildNavidromeSourceRevision(song, data.streamUrl),
                data: bytes,
            };
        }
        const url = /^https?:/i.test(failedSource) ? failedSource : data.streamUrl;
        return {
            ...common,
            sourceRevision: buildNavidromeSourceRevision(song, url),
            url,
        };
    }

    return null;
};

export const startPlayableTranscode = (
    song: SongResult,
    failedSource: string,
    localSongs: LocalSong[],
    priority: TranscodeFallbackRequest['priority'],
): { requestId: string; result: Promise<TranscodeFallbackResult> } => {
    const bridge = window.electron?.requestTranscodeFallback;
    const requestId = buildRequestId();
    if (!bridge) return { requestId, result: Promise.resolve({ ok: false, errorCode: 'NOT_ELECTRON' }) };
    const controller = new AbortController();
    rendererRequests.set(requestId, controller);
    const result = (async () => {
        try {
            const source = await buildTranscodeFallbackSource(song, failedSource, localSongs, controller.signal);
            throwIfAborted(controller.signal);
            if (!source) return { ok: false, errorCode: 'SOURCE_UNAVAILABLE' };
            const request: TranscodeFallbackRequest = {
                requestId,
                priority,
                source,
                limitBytes: useAudioSettingsStore.getState().mediaCacheLimitGb * 1024 * 1024 * 1024,
            };
            return await bridge(request);
        } catch (error) {
            const cancelled = controller.signal.aborted || (error as Error)?.name === 'AbortError';
            return {
                ok: false,
                errorCode: cancelled ? 'CANCELLED' : (error as { code?: string }).code || 'SOURCE_UNAVAILABLE',
                message: errorMessage(error),
            };
        } finally {
            if (rendererRequests.get(requestId) === controller) rendererRequests.delete(requestId);
        }
    })();
    return { requestId, result };
};

export const cancelPlayableTranscode = (requestId: string): void => {
    if (!requestId) return;
    console.info('[TranscodeFallback] renderer-cancel', { requestId });
    rendererRequests.get(requestId)?.abort();
    rendererRequests.delete(requestId);
    void window.electron?.cancelTranscodeFallback?.(requestId);
};
