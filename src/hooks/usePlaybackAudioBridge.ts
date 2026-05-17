import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { ReplayGainMode, SongResult, StatusMessage } from '../types';
import type { LocalSong, PlayerState } from '../types';
import { hasCachedAudio, saveAudioBlob } from '../services/audioCache';
import { getOnlineSongCacheKey } from '../services/netease';
import { saveToCache } from '../services/db';

// src/hooks/usePlaybackAudioBridge.ts

type UsePlaybackAudioBridgeParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioSrc: string | null;
    currentSong: SongResult | null;
    isLyricsLoading: boolean;
    enableMediaCache: boolean;
    isPanelOpen: boolean;
    panelTab: string;
    replayGainMode: ReplayGainMode;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    gainNodeRef: MutableRefObject<GainNode | null>;
    replayGainLinearRef: MutableRefObject<number>;
    sourceRef: MutableRefObject<MediaElementAudioSourceNode | null>;
    setPlayerState: React.Dispatch<React.SetStateAction<PlayerState>>;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    getCoverUrl: () => string | null;
    updateCacheSize: () => void;
    t: (key: string) => string;
};

// Bridges audio element setup, autoplay, replay gain, and media caching.
export function usePlaybackAudioBridge({
    audioRef,
    audioSrc,
    currentSong,
    isLyricsLoading,
    enableMediaCache,
    isPanelOpen,
    panelTab,
    replayGainMode,
    shouldAutoPlayRef,
    audioContextRef,
    analyserRef,
    gainNodeRef,
    replayGainLinearRef,
    sourceRef,
    setPlayerState,
    setStatusMsg,
    syncOutputGain,
    getTargetPlaybackVolume,
    getCoverUrl,
    updateCacheSize,
    t,
}: UsePlaybackAudioBridgeParams) {
    const previousAudioSrcRef = useRef<string | null>(null);
    const replayGainLogSignatureRef = useRef<string | null>(null);

    const setupAudioAnalyzer = useCallback(() => {
        if (!audioRef.current || sourceRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;

            const gainNode = ctx.createGain();
            gainNodeRef.current = gainNode;

            const source = ctx.createMediaElementSource(audioRef.current);
            source.connect(gainNode);
            gainNode.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
            syncOutputGain(getTargetPlaybackVolume(), 0);
        } catch (error) {
            console.error('Audio Context Setup Failed:', error);
        }
    }, [audioContextRef, audioRef, analyserRef, gainNodeRef, getTargetPlaybackVolume, sourceRef, syncOutputGain]);

    const cacheSongAssets = useCallback(async () => {
        if (!currentSong || !audioSrc || audioSrc.startsWith('blob:')) return;

        const existing = await hasCachedAudio(getOnlineSongCacheKey('audio', currentSong));
        if (existing || !enableMediaCache) return;

        console.log('[Cache] Caching fully played song:', currentSong.name);

        try {
            const response = await fetch(audioSrc);
            const blob = await response.blob();
            await saveAudioBlob(getOnlineSongCacheKey('audio', currentSong), blob);
            console.log('[Cache] Audio saved');
        } catch (error) {
            console.error('[Cache] Failed to download audio for cache', error);
        }

        const coverUrl = getCoverUrl();
        if (coverUrl) {
            try {
                const response = await fetch(coverUrl, { mode: 'cors' });
                const blob = await response.blob();
                await saveToCache(getOnlineSongCacheKey('cover', currentSong), blob);
                console.log('[Cache] Cover saved');
            } catch (error) {
                console.error('[Cache] Failed to download cover for cache', error);
            }
        }

        if (isPanelOpen && panelTab === 'account') {
            updateCacheSize();
        }
    }, [audioSrc, currentSong, enableMediaCache, getCoverUrl, isPanelOpen, panelTab, updateCacheSize]);

    useEffect(() => {
        if (audioRef.current) {
            syncOutputGain(getTargetPlaybackVolume(), 0.015);
        }
    }, [audioRef, getTargetPlaybackVolume, syncOutputGain]);

    useEffect(() => {
        localStorage.setItem('local_replaygain_mode', replayGainMode);
    }, [replayGainMode]);

    useEffect(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;

        let replayGainDb = 0;
        let replayGainPeak: number | undefined;
        if ((currentSong as SongResult & { isLocal?: boolean; localData?: LocalSong }).isLocal && (currentSong as SongResult & { localData?: LocalSong }).localData) {
            const localData = (currentSong as SongResult & { localData: LocalSong }).localData;

            if (replayGainMode === 'track') {
                replayGainDb = typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : (typeof localData.replayGain === 'number' ? localData.replayGain : 0);
                replayGainPeak = localData.replayGainTrackPeak;
            } else if (replayGainMode === 'album') {
                replayGainDb = typeof localData.replayGainAlbumGain === 'number'
                    ? localData.replayGainAlbumGain
                    : (typeof localData.replayGainTrackGain === 'number'
                        ? localData.replayGainTrackGain
                        : (typeof localData.replayGain === 'number' ? localData.replayGain : 0));
                replayGainPeak = localData.replayGainAlbumPeak ?? localData.replayGainTrackPeak;
            }
        }

        let effectiveReplayGainDb = replayGainDb;
        if (
            replayGainMode !== 'off' &&
            typeof replayGainPeak === 'number' &&
            replayGainPeak > 0 &&
            replayGainPeak <= 1 &&
            replayGainDb > 0
        ) {
            const clipSafeGainDb = -20 * Math.log10(replayGainPeak);
            effectiveReplayGainDb = Math.min(replayGainDb, clipSafeGainDb);
        }

        const linearGain = Math.pow(10, effectiveReplayGainDb / 20);
        replayGainLinearRef.current = linearGain;

        try {
            syncOutputGain(getTargetPlaybackVolume(), 0.1);
            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: replayGainDb,
                effective: effectiveReplayGainDb,
                peak: replayGainPeak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${effectiveReplayGainDb}dB (raw=${replayGainDb}dB, peak=${replayGainPeak ?? 'n/a'}, linear=${linearGain.toFixed(2)})`);
            }
        } catch (error) {
            console.warn('[AudioContext] Failed to apply ReplayGain', error);
        }
    }, [audioContextRef, currentSong, gainNodeRef, getTargetPlaybackVolume, replayGainLinearRef, replayGainMode, syncOutputGain]);

    useEffect(() => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            previousAudioSrcRef.current = audioSrc;
            return;
        }

        if (audioSrc && previousAudioSrcRef.current && previousAudioSrcRef.current !== audioSrc) {
            audioElement.pause();
            audioElement.load();
        }

        previousAudioSrcRef.current = audioSrc;
    }, [audioRef, audioSrc]);

    useEffect(() => {
        if (audioSrc && audioRef.current) {
            if (shouldAutoPlayRef.current && !isLyricsLoading) {
                shouldAutoPlayRef.current = false;
                syncOutputGain(getTargetPlaybackVolume(), 0);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setPlayerState('playing');
                            setupAudioAnalyzer();
                        })
                        .catch(error => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                setPlayerState('playing');
                                return;
                            }

                            if (error.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState('paused');
                            }
                        });
                }
            }
        }
    }, [audioRef, audioSrc, getTargetPlaybackVolume, isLyricsLoading, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldAutoPlayRef, syncOutputGain, t]);

    return {
        setupAudioAnalyzer,
        cacheSongAssets,
    };
}
