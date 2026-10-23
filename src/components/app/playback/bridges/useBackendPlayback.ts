import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { backendPlayback, usesPlaybackBackend } from '../../../../services/playbackBackend/controller';
import { getPlaybackBackend, selectedPlaybackBackend, subscribePlaybackBackends } from '../../../../services/playbackBackend/registry';
import { usePlaybackStore, setPlayerState } from '../../../../stores/usePlaybackStore';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { currentTime } from '../../../../stores/motionSignals';
import { PlayerState } from '../../../../types';

// UI half of the generic backend seam; the engine remains entirely outside the host.

export const useBackendPlayback = ({ audioRef, audioContextRef, pendingResumeTimeRef, shouldAutoPlayRef, loopMode, onEnded }: {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    loopMode: string;
    onEnded: () => void;
}) => {
    const selected = useSyncExternalStore(subscribePlaybackBackends, selectedPlaybackBackend);
    const entry = useSyncExternalStore(subscribePlaybackBackends, getPlaybackBackend);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const activeContext = usePlaybackStore(state => state.activePlaybackContext);
    const ended = useRef(onEnded);
    ended.current = onEnded;
    const repeat = useRef(loopMode);
    repeat.current = loopMode;
    const previousSelection = useRef(selected);
    const { t } = useTranslation();

    useEffect(() => {
        if (previousSelection.current === selected) return;
        previousSelection.current = selected;
        shouldAutoPlayRef.current = false;
        setPlayerState(PlayerState.PAUSED);
    }, [selected, shouldAutoPlayRef]);

    useEffect(() => backendPlayback.subscribe(event => {
        if (!usesPlaybackBackend() || !usePlaybackStore.getState().audioSrc) return;
        if (event.type === 'status') {
            const { status } = event;
            const store = usePlaybackStore.getState();
            if (store.duration !== status.duration) store.setDuration(status.duration);
            currentTime.set(status.position);
            if (status.state === 'playing') setPlayerState(PlayerState.PLAYING);
            if (status.state === 'paused' || status.state === 'stopped') setPlayerState(PlayerState.PAUSED);
        } else if (event.type === 'ended') {
            if (repeat.current === 'one') {
                void backendPlayback.seek(0).then(() => backendPlayback.play()).catch(error => {
                    console.error('[PlaybackBackend] Repeat failed', error);
                    setPlayerState(PlayerState.PAUSED);
                });
            } else ended.current();
        } else {
            console.error('[PlaybackBackend] Engine failed', new Error(event.message));
            setPlayerState(PlayerState.PAUSED);
            setStatusMessage({ type: 'error', text: t('options.playbackBackendFailed') });
        }
    }), [t]);

    useEffect(() => {
        if (!selected) return;
        audioRef.current?.pause();
        if (audioContextRef.current?.state === 'running') {
            void audioContextRef.current.suspend().catch(error => console.warn('[PlaybackBackend] Suspending Web Audio failed', error));
        }
        if (!audioSrc || activeContext === 'stage') {
            void backendPlayback.stop().catch(error => console.warn('[PlaybackBackend] Stop failed', error));
            return;
        }
        if (!entry) return;
        let cancelled = false;
        void backendPlayback.open(audioSrc).then(async () => {
            if (cancelled) return;
            const resumeAt = pendingResumeTimeRef.current;
            if (resumeAt !== null) {
                pendingResumeTimeRef.current = null;
                await backendPlayback.seek(Math.max(0, resumeAt));
            }
        }).catch(error => {
            if (cancelled) return;
            console.error('[PlaybackBackend] Opening source failed', error);
            setPlayerState(PlayerState.PAUSED);
            setStatusMessage({ type: 'error', text: t('options.playbackBackendFailed') });
        });
        return () => { cancelled = true; };
    }, [selected, entry, audioSrc, activeContext, audioRef, audioContextRef, pendingResumeTimeRef, t]);

    return selected !== null;
};
