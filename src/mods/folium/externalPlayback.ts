import { omni } from '@/services/onlineMusic/omni';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { currentTime } from '@/stores/motionSignals';
import { PlayerState, type SongResult } from '@/types';
import type { PlaybackRequest } from '@/types/externalPlayback';
import { beginPlaybackRequest } from '@/services/playbackRequest';
import {
    acquireExternalPlayback,
    isExternalPlaybackOwner,
    releaseExternalPlayback,
    releaseExternalPlaybackForMod,
    releaseAllExternalPlayback,
    setExternalPlaybackCapabilities,
    invalidateExternalPlaybackSource,
} from '@/services/externalPlaybackSession';
import type { ModRuntimeInfo } from '../types';
import type { FoliumPlaybackSession, FoliumPlaybackSessions, FoliumPlaybackSessionIntent, FoliumPlaybackSessionCapabilities } from './contract';
import { resolveFoliumSongRef, toFoliumSong } from './dto';
import { reportFoliumIssue } from './status';
import { registerFoliumServiceDisposer } from './lifecycle';

// src/mods/folium/externalPlayback.ts
interface Actions {
    play(song: SongResult, request: PlaybackRequest): Promise<void> | void;
    stop(): void;
    canAcquire?(): boolean;
    seek(seconds: number): void;
}
let actions: Actions | null = null;
const validateCapabilities = (value: FoliumPlaybackSessionCapabilities) => {
    if (!value || ['canNext', 'canPrevious', 'canSeek'].some(key => typeof value[key as keyof typeof value] !== 'boolean'))
        throw new Error('invalid-playback-session-capabilities');
    return Object.freeze({ canNext: value.canNext, canPrevious: value.canPrevious, canSeek: value.canSeek });
};

/** Clear media while leaving queue restoration to the lease's release path. */
function stopSessionMedia(host: Actions) {
    try { host.stop(); }
    finally {
        usePlaybackStore.setState({ currentSong: null, audioSrc: null, lyrics: null,
            activeLocalLyricsSource: null, cachedCoverUrl: null, duration: 0,
            playerState: PlayerState.IDLE, currentLineIndex: -1 });
        currentTime.set(0);
    }
}
export const registerExternalPlaybackActions = (value: Actions | null) => {
    if (!value) releaseAllExternalPlayback();
    actions = value;
};

export function createFoliumPlaybackSessions(mod: ModRuntimeInfo): FoliumPlaybackSessions {
    let active = true;
    const requireAccess = () => {
        if (!active) throw new Error('mod-service-disposed');
        if (!mod.experimental?.includes('playback.sessions'))
            throw new Error('experimental-not-declared:playback.sessions');
        if (!mod.permissions.includes('playback.control')) throw new Error('permission-denied:playback.control');
    };
    registerFoliumServiceDisposer(mod.id, () => {
        active = false;
        releaseExternalPlaybackForMod(mod.id);
    });
    return Object.freeze<FoliumPlaybackSessions>({
        version: 1,
        async resolveSong(provider, id) {
            requireAccess();
            if (typeof provider !== 'string' || !provider || typeof id !== 'string' || !id || id.length > 2048)
                throw new Error('invalid-song-reference');
            const song = await omni.getSongDetail(provider, id);
            requireAccess();
            if (!song) throw new Error('song-unavailable');
            return toFoliumSong(song)!;
        },
        acquire({ onIntent, restore, capabilities }) {
            requireAccess();
            if (restore !== 'queue-stopped' || typeof onIntent !== 'function')
                throw new Error('invalid-playback-session-options');
            const initialCapabilities = capabilities === undefined ? undefined : validateCapabilities(capabilities);
            if (!actions) throw new Error('playback-unavailable');
            const host = actions;
            const state = usePlaybackStore.getState();
            if (
                state.activePlaybackContext !== 'main' ||
                state.transitionDisplay ||
                state.isFmMode ||
                host.canAcquire?.() === false
            ) {
                throw new Error('external-playback-context-unavailable');
            }
            const queue = [...state.playQueue];
            const report = (error: unknown) => reportFoliumIssue(mod.id, 'playback session', error);
            const token = acquireExternalPlayback({
                modId: mod.id,
                report,
                capabilities: initialCapabilities,
                dispatch: (intent) => {
                    const dto: FoliumPlaybackSessionIntent =
                        intent.type === 'play'
                            ? { type: 'play', song: toFoliumSong(intent.song)! }
                            : intent.type === 'enqueue'
                              ? { type: 'enqueue', songs: intent.songs.map((song) => toFoliumSong(song)!) }
                              : intent;
                    return onIntent(dto);
                },
                cleanup: () => {
                    try {
                        stopSessionMedia(host);
                    } finally {
                        usePlaybackStore.setState({
                            playQueue: queue,
                            isFmMode: false,
                        });
                    }
                },
            });
            try {
                stopSessionMedia(host);
                state.setPlayQueue([]);
            } catch (error) {
                releaseExternalPlayback(token);
                throw error;
            }
            return Object.freeze<FoliumPlaybackSession>({
                stop() {
                    requireAccess();
                    if (!isExternalPlaybackOwner(token)) throw new Error('playback-session-released');
                    invalidateExternalPlaybackSource(token);
                    stopSessionMedia(host);
                },
                setCapabilities(value) {
                    requireAccess();
                    setExternalPlaybackCapabilities(token, validateCapabilities(value));
                },
                play(song) {
                    if (!active || !isExternalPlaybackOwner(token))
                        return Promise.resolve({ status: 'cancelled' as const });
                    const resolved = resolveFoliumSongRef(song.ref);
                    if (!resolved) return Promise.resolve({ status: 'unavailable' as const });
                    invalidateExternalPlaybackSource(token, 'superseded');
                    const request = beginPlaybackRequest(token);
                    try {
                        Promise.resolve(host.play(resolved, request))
                            .catch((error) => {
                                if (request.isCurrent()) {
                                    report(error);
                                    request.finish('failed');
                                }
                            })
                            .finally(() => request.finish('cancelled'));
                    } catch (error) {
                        report(error);
                        request.finish('failed');
                    }
                    return request.result;
                },
                seek(seconds) {
                    requireAccess();
                    if (!isExternalPlaybackOwner(token)) throw new Error('playback-session-released');
                    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('invalid-playback-position');
                    host.seek(seconds);
                },
                release: () => releaseExternalPlayback(token),
            });
        },
    });
}
