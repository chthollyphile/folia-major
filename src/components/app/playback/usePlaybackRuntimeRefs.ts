import { useEffect, useMemo, useRef } from 'react';
import type { SongResult } from '../../../types';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { askedSongKeyRef } from './currentSong';
import type { OnlineRecovery } from './restore/createOnlineRecoveryController';

// src/components/app/playback/usePlaybackRuntimeRefs.ts
//
// The mutable substrate the playback controllers coordinate through.
//
// These are not state: nothing renders off them, and writing one must not schedule a render. They
// exist because several hooks - the queue, the transport, the audio graph, the stage bridge, the
// automix decks - need to see each other's in-flight work within the same tick, and a store write
// is one render too late for that.
//
// Collected here so the coupling is one named thing rather than twenty loose `useRef` lines in
// App.tsx. App.tsx still has to be the one that holds it: the controllers are siblings, so their
// shared substrate has to live at their common ancestor.
//
// A ref that only one hook reads does NOT belong here - it belongs inside that hook.

export type PlaybackRuntimeRefs = ReturnType<typeof usePlaybackRuntimeRefs>;

export const usePlaybackRuntimeRefs = () => {
    // Points at whichever automix deck is currently the one being listened to. Everything
    // downstream - transport, progress, lyrics, media session - reads playback through here and
    // stays unaware that there are two elements.
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    /** The object URL currently backing <audio>, so the previous one can be revoked exactly once. */
    const blobUrlRef = useRef<string | null>(null);
    const animationFrameRef = useRef<number>(0);
    const shouldAutoPlay = useRef(false);
    const currentSongFullRef = useRef<SongResult | null>(null);
    const playbackAutoSkipCountRef = useRef(0);
    const volumePreviewFrameRef = useRef<number | null>(null);
    const pendingVolumePreviewRef = useRef<number | null>(null);
    const pendingResumeTimeRef = useRef<number | null>(null);
    // The recoveries of an online song's address in flight, one per start of a song (its key and
    // `startOfAskedSong`), so one for a start never answers for another (createOnlineRecoveryController.ts).
    const onlinePlaybackRecoveryRef = useRef<Map<string, Promise<OnlineRecovery>>>(new Map());
    const lastAudioRecoverySourceRef = useRef<string | null>(null);
    const currentOnlineAudioUrlFetchedAtRef = useRef<number | null>(null);

    const currentSong = usePlaybackStore(state => state.currentSong);
    useEffect(() => {
        currentSongFullRef.current = currentSong;
    }, [currentSong]);

    // Refs are stable, so the container is built once; consumers can depend on it directly.
    return useMemo(() => ({
        audioRef,
        audioContextRef,
        analyserRef,
        gainNodeRef,
        blobUrlRef,
        animationFrameRef,
        shouldAutoPlay,
        // The key of the song the player was last asked for, readable synchronously by loaders that
        // must not close over state. Read-only: src/components/app/playback/currentSong.ts holds it and is its only
        // writer.
        currentSongRef: askedSongKeyRef,
        currentSongFullRef,
        playbackAutoSkipCountRef,
        volumePreviewFrameRef,
        pendingVolumePreviewRef,
        pendingResumeTimeRef,
        onlinePlaybackRecoveryRef,
        lastAudioRecoverySourceRef,
        currentOnlineAudioUrlFetchedAtRef,
    }), []);
};
