import { useEffect, useMemo, useRef } from 'react';
import { selectDisplayPlayerState, usePlaybackStore } from '../../../../stores/usePlaybackStore';

// src/components/app/playback/bridges/useTransportCommandRefs.ts
//
// Latest-value handles for the surfaces that live outside React: the OS media session, the Windows
// taskbar thumbbar, the remote control and Discord presence. They are registered once with the main
// process and then fire whenever the user presses something there, so they cannot close over a
// render's values - they read through these.

// Kept as the consumers' exact signatures rather than a widened union: the bridges' ref types are
// what they are, and widening here would only move the mismatch to their call sites.
type TransportCommandRefsParams = {
    resumePlayback: () => Promise<void>;
    pausePlayback: () => void;
    handlePrevTrack: () => void;
    handleNextTrack: (options?: never) => Promise<void>;
};

export const useTransportCommandRefs = ({
    resumePlayback,
    pausePlayback,
    handlePrevTrack,
    handleNextTrack,
}: TransportCommandRefsParams) => {
    const currentSong = usePlaybackStore(state => state.currentSong);
    // The transport the picture belongs to, not the raw one: every consumer of this ref asks "is
    // the listener hearing music right now" - the taskbar buttons, the remote's play/pause toggle,
    // the voice-input auto-pause. During a blend's lead the raw state is IDLE while the outgoing
    // deck plays on, and all three then offered play on a track that was already playing: pressing
    // it started the arriving deck early and took the blend with it.
    const displayPlayerState = usePlaybackStore(selectDisplayPlayerState);

    const mediaSessionPlayRef = useRef(resumePlayback);
    const mediaSessionPauseRef = useRef(pausePlayback);
    const mediaSessionPrevRef = useRef(handlePrevTrack);
    const mediaSessionNextRef = useRef(handleNextTrack);
    const taskbarHasTrackRef = useRef(Boolean(currentSong));
    const taskbarPlayerStateRef = useRef(displayPlayerState);

    useEffect(() => {
        mediaSessionPlayRef.current = resumePlayback;
    }, [resumePlayback]);

    useEffect(() => {
        mediaSessionPauseRef.current = pausePlayback;
    }, [pausePlayback]);

    useEffect(() => {
        mediaSessionPrevRef.current = handlePrevTrack;
    }, [handlePrevTrack]);

    useEffect(() => {
        mediaSessionNextRef.current = handleNextTrack;
    }, [handleNextTrack]);

    useEffect(() => {
        taskbarHasTrackRef.current = Boolean(currentSong);
    }, [currentSong]);

    useEffect(() => {
        taskbarPlayerStateRef.current = displayPlayerState;
    }, [displayPlayerState]);

    // Refs are stable, so the container is built once.
    return useMemo(() => ({
        mediaSessionPlayRef,
        mediaSessionPauseRef,
        mediaSessionPrevRef,
        mediaSessionNextRef,
        taskbarHasTrackRef,
        taskbarPlayerStateRef,
    }), []);
};
