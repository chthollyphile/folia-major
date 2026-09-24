import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../types';
import { usePlaybackStore, setDuration, setPlayerState } from '../stores/usePlaybackStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { omni } from '../services/onlineMusic/omni';
import type { SongResult } from '../types';
import type { RemotePlaybackSnapshot } from '../types/remotePlayback';
import { commandRemotePlayback, getQueuedRemoteNext, ownsRemotePlayback, queueRemotePlaybackNext, stopRemotePlayback, updateRemotePlaybackClock } from '../services/remotePlayback';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// src/hooks/useRemotePlayback.ts

// Seconds before the end at which the next song is lined up on the backend.
const QUEUE_NEXT_WINDOW_SEC = 8;

const snapshotMatches = (snapshot: RemotePlaybackSnapshot, song: SongResult) => {
    const ref = song.sourceRef;
    const expected = ref?.kind === 'online' ? String(ref.providerData?.catalogId || ref.mediaId) : String(song.id);
    return snapshot.mediaId === expected || snapshot.mediaId === ref?.mediaId || snapshot.catalogMediaId === expected;
};

// Poll the external clock without storing continuous time in React state. `peekNext` names the
// song Folia would advance to, so the backend can hand over on its own instead of waiting for a poll.
export function useRemotePlayback(onEnded: () => void, peekNext?: () => SongResult | null) {
    const song = usePlaybackStore(state => state.currentSong);
    const context = usePlaybackStore(state => state.activePlaybackContext);
    const volume = useAudioSettingsStore(state => state.isMuted ? 0 : state.volume);
    const endedRef = useRef(onEnded);
    endedRef.current = onEnded;
    const peekNextRef = useRef(peekNext);
    peekNextRef.current = peekNext;
    const { t } = useTranslation();
    const key = song ? getPlaybackSongKey(song) : '';
    useEffect(() => {
        if (!song || !omni.usesRemotePlayback(song) || context !== 'main') {
            void stopRemotePlayback().catch(() => {});
            return;
        }
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        let lastPosition = 0;
        let lastDuration = 0;
        let matched = false;
        let endedHandled = false;
        let nextQueued = false;
        const started = performance.now();
        const poll = async () => {
            try {
                const snapshot = await omni.getRemotePlaybackSnapshot(song);
                if (stopped) return;
                if (!ownsRemotePlayback(song)) { stopped = true; return; }
                if (!snapshotMatches(snapshot, song)) {
                    // The backend moved on to the song lined up behind this one: that is the end of this track.
                    const queued = getQueuedRemoteNext();
                    if (queued && snapshotMatches(snapshot, queued) && !endedHandled) {
                        endedHandled = true;
                        endedRef.current();
                        return;
                    }
                    if (!matched && performance.now() - started < 15000) return;
                    if (lastDuration > 0 && lastPosition >= lastDuration - 1.5 && !endedHandled) {
                        endedHandled = true;
                        endedRef.current();
                        return;
                    }
                    if (endedHandled) return;
                    throw new Error('Remote player is playing a different song');
                }
                matched = true;
                const ended = snapshot.duration > 0 && lastPosition >= snapshot.duration - 1.5
                    && (snapshot.position < 1 || snapshot.position >= snapshot.duration - 0.1);
                lastPosition = snapshot.position;
                lastDuration = snapshot.duration;
                updateRemotePlaybackClock(snapshot);
                const nextState = snapshot.playing ? PlayerState.PLAYING : PlayerState.PAUSED;
                const state = usePlaybackStore.getState();
                if (state.duration !== snapshot.duration) setDuration(snapshot.duration);
                if (state.playerState !== nextState) setPlayerState(nextState);
                if (snapshot.position < snapshot.duration - 2) endedHandled = false;
                if (!nextQueued && snapshot.playing && snapshot.duration > 0 && snapshot.duration - snapshot.position <= QUEUE_NEXT_WINDOW_SEC) {
                    nextQueued = true;
                    const next = peekNextRef.current?.() ?? null;
                    if (next) void queueRemotePlaybackNext(next).catch(() => {});
                }
                if (ended && !endedHandled) { endedHandled = true; endedRef.current(); }
            } catch {
                if (stopped) return;
                stopped = true;
                void stopRemotePlayback().catch(() => {});
                setPlayerState(PlayerState.PAUSED);
                setStatusMessage({ type: 'error', text: t('appleMusic.playbackError') });
            } finally {
                if (!stopped) timer = setTimeout(poll, 500);
            }
        };
        void poll();
        return () => { stopped = true; clearTimeout(timer); };
    }, [song, context, t]);
    useEffect(() => {
        if (ownsRemotePlayback(song)) void commandRemotePlayback('volume', volume).catch(() => {});
    }, [key, volume]);
    useEffect(() => () => { void stopRemotePlayback().catch(() => {}); }, []);
}
