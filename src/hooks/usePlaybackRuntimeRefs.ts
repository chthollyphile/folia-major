import { useEffect, useMemo, useRef } from 'react';
import type { SongResult } from '../types';
import type { OnlineRecoveryResult } from '../types/playbackFailure';
import { usePlaybackStore } from '../stores/usePlaybackStore';

// src/hooks/usePlaybackRuntimeRefs.ts
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
    /** The playing song's id, readable synchronously by loaders that must not close over state. */
    const currentSongRef = useRef<string | number | null>(null);
    /**
     * 主播放每提交一次当前歌曲就加一：点歌落地（同一首歌重新点播也算）、离开 Stage 恢复主快照、会话恢复、窗口交接、
     * automix 取消。在途的音源刷新和播放中失败据此判断自己是否属于已被取代的那次播放；只比歌曲 key 时，
     * 重播同一首会让旧结果冒充当前。本地 / Navidrome 播放不经在线恢复，没有接入。
     */
    const playbackGenerationRef = useRef(0);
    const currentSongFullRef = useRef<SongResult | null>(null);
    const playbackAutoSkipCountRef = useRef(0);
    const volumePreviewFrameRef = useRef<number | null>(null);
    const pendingVolumePreviewRef = useRef<number | null>(null);
    const pendingResumeTimeRef = useRef<number | null>(null);
    /** In-flight online source refreshes, keyed by playback song key plus playback generation. */
    const onlinePlaybackRecoveryRef = useRef<Map<string, Promise<OnlineRecoveryResult>>>(new Map());
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
        currentSongRef,
        playbackGenerationRef,
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
