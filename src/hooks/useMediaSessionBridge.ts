import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { PlayerState, SongResult } from '../types';

// Bridges Folia playback state to the browser Media Session API.
type UseMediaSessionBridgeOptions = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    cachedCoverUrl: string | null;
    playerState: PlayerState;
    isNowPlayingStageActive: boolean;
    t: (key: string) => string;
    mediaSessionPlayRef: RefObject<() => Promise<void>>;
    mediaSessionPauseRef: RefObject<() => void>;
    mediaSessionPrevRef: RefObject<() => void>;
    mediaSessionNextRef: RefObject<() => Promise<void> | void>;
    isNowPlayingControlDisabledRef: RefObject<boolean>;
};

export const useMediaSessionBridge = ({
    audioRef,
    currentSong,
    cachedCoverUrl,
    playerState,
    isNowPlayingStageActive,
    t,
    mediaSessionPlayRef,
    mediaSessionPauseRef,
    mediaSessionPrevRef,
    mediaSessionNextRef,
    isNowPlayingControlDisabledRef,
}: UseMediaSessionBridgeOptions) => {
    useEffect(() => {
        if (!('mediaSession' in navigator)) {
            return;
        }

        const mediaSession = navigator.mediaSession;
        const setActionHandlerSafely = (
            action: MediaSessionAction,
            handler: MediaSessionActionHandler | null
        ) => {
            try {
                mediaSession.setActionHandler(action, handler);
            } catch (e) {
                console.warn(`[MediaSession] Failed to bind ${action} handler`, e);
            }
        };

        setActionHandlerSafely('play', async () => {
            if (isNowPlayingControlDisabledRef.current || !audioRef.current) {
                return;
            }

            try {
                await mediaSessionPlayRef.current();
            } catch (e) {
                console.error('MediaSession play failed', e);
            }
        });
        setActionHandlerSafely('pause', () => {
            if (isNowPlayingControlDisabledRef.current || !audioRef.current) {
                return;
            }

            mediaSessionPauseRef.current();
        });
        setActionHandlerSafely('previoustrack', () => {
            if (isNowPlayingControlDisabledRef.current) {
                return;
            }
            mediaSessionPrevRef.current();
        });
        setActionHandlerSafely('nexttrack', () => {
            if (isNowPlayingControlDisabledRef.current) {
                return;
            }
            void mediaSessionNextRef.current();
        });

        return () => {
            setActionHandlerSafely('play', null);
            setActionHandlerSafely('pause', null);
            setActionHandlerSafely('previoustrack', null);
            setActionHandlerSafely('nexttrack', null);
        };
    }, [audioRef, isNowPlayingControlDisabledRef, mediaSessionNextRef, mediaSessionPauseRef, mediaSessionPlayRef, mediaSessionPrevRef]);

    useEffect(() => {
        if (!('mediaSession' in navigator)) {
            return;
        }

        const mediaSession = navigator.mediaSession;

        if (!currentSong) {
            try {
                mediaSession.metadata = null;
            } catch (e) {
                console.warn('[MediaSession] Failed to clear metadata', e);
            }
            return;
        }

        const artistName = currentSong.ar?.map(a => a.name).join(', ')
            || currentSong.artists?.map(a => a.name).join(', ')
            || t('ui.unknownArtist');
        const albumName = currentSong.al?.name || currentSong.album?.name || '';
        const cover = cachedCoverUrl || currentSong.al?.picUrl || currentSong.album?.picUrl || '';

        try {
            mediaSession.metadata = new MediaMetadata({
                title: currentSong.name,
                artist: artistName,
                album: albumName,
                artwork: cover ? [
                    { src: cover, sizes: '512x512', type: 'image/jpeg' }
                ] : []
            });
        } catch (e) {
            console.warn('[MediaSession] Failed to update metadata', e);
        }
    }, [cachedCoverUrl, currentSong, t]);

    useEffect(() => {
        if (!('mediaSession' in navigator)) {
            return;
        }

        try {
            navigator.mediaSession.playbackState = isNowPlayingStageActive
                ? 'none'
                : currentSong
                    ? (playerState === PlayerState.PLAYING ? 'playing' : 'paused')
                    : 'none';
        } catch (e) {
            console.warn('[MediaSession] Failed to update playback state', e);
        }
    }, [currentSong, isNowPlayingStageActive, playerState]);
};
