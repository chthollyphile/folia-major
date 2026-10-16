import type { MutableRefObject } from 'react';
import { retireBlobUrl } from '@/services/playbackBlobUrls';
import { setAudioSrc, setPlayerState } from '@/stores/usePlaybackStore';
import { PlayerState } from '@/types';

// src/components/app/playback/createSessionTransport.ts
// Direct lease operations preserve pause on seek and synchronously disarm pending autoplay on stop.
export function createSessionTransport(
    refs: {
        audioRef: MutableRefObject<HTMLAudioElement | null>;
        shouldAutoPlay: MutableRefObject<boolean>;
        currentSongRef: MutableRefObject<string | number | null>;
        blobUrlRef: MutableRefObject<string | null>;
        pendingResumeTimeRef: MutableRefObject<number | null>;
        clearLoading?: () => void;
    },
    canAcquire: () => boolean = () => true,
) {
    return {
        canAcquire,
        stop() {
            refs.shouldAutoPlay.current = false;
            refs.currentSongRef.current = null;
            refs.pendingResumeTimeRef.current = null;
            const audio = refs.audioRef.current;
            try {
                audio?.pause();
                audio?.removeAttribute('src');
                audio?.load();
            } finally {
                retireBlobUrl(refs.blobUrlRef.current);
                refs.blobUrlRef.current = null;
                setAudioSrc(null);
                refs.clearLoading?.();
                setPlayerState(PlayerState.IDLE);
            }
        },
        seek(seconds: number) {
            const audio = refs.audioRef.current;
            if (!audio || audio.readyState < 1) return;
            audio.currentTime = Number.isFinite(audio.duration)
                ? Math.min(seconds, Math.max(0, audio.duration - 0.1))
                : seconds;
        },
    };
}
