import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { PlayerState } from '../types';
import type { ReplayGainInfo, ReplayGainMode, SongResult, StatusMessage } from '../types';
import type { LocalSong } from '../types';
import { saveAudioBlob } from '../services/audioCache';
import { hasCachedSongAudio } from '../services/onlineMusic/resourceCache';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import { resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';
import { calculateReplayGain } from '../utils/replayGain';
import { saveToCache } from '../services/db';

// src/hooks/usePlaybackAudioBridge.ts

type UsePlaybackAudioBridgeParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioSrc: string | null;
    currentSong: SongResult | null;
    localSongs: LocalSong[];
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
    localSongs,
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

    // Recalculates source-specific gain after the audio graph or playback settings become ready.
    const applyReplayGain = useCallback(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;

        let replayGainInfo: ReplayGainInfo | undefined;
        const localSongId = (currentSong as SongResult & { localRef?: { songId: string } }).localRef?.songId;
        const localData = localSongId ? localSongs.find(song => song.id === localSongId) : undefined;
        if ((currentSong as SongResult & { isLocal?: boolean }).isLocal && localData) {
            replayGainInfo = {
                trackGain: typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : localData.replayGain,
                trackPeak: localData.replayGainTrackPeak,
                albumGain: localData.replayGainAlbumGain,
                albumPeak: localData.replayGainAlbumPeak,
            };
        }

        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const navidromeReplayGain = navidromeSong?.navidromeData.replayGain;
        if (navidromeReplayGain) {
            replayGainInfo = navidromeReplayGain;
        }

        if (currentSong.sourceRef?.kind === 'online') {
            replayGainInfo = currentSong.replayGain;
        }

        const calculation = calculateReplayGain(replayGainInfo, replayGainMode);
        replayGainLinearRef.current = calculation.linearGain;

        try {
            syncOutputGain(getTargetPlaybackVolume(), 0.1);
            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: calculation.gainDb,
                effective: calculation.effectiveGainDb,
                peak: calculation.peak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${calculation.effectiveGainDb}dB (raw=${calculation.gainDb}dB, peak=${calculation.peak ?? 'n/a'}, linear=${calculation.linearGain.toFixed(2)})`);
            }
        } catch (error) {
            console.warn('[AudioContext] Failed to apply ReplayGain', error);
        }
    }, [audioContextRef, currentSong, gainNodeRef, getTargetPlaybackVolume, localSongs, replayGainLinearRef, replayGainMode, syncOutputGain]);

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
            applyReplayGain();
            syncOutputGain(getTargetPlaybackVolume(), 0);
        } catch (error) {
            console.error('Audio Context Setup Failed:', error);
        }
    }, [analyserRef, applyReplayGain, audioContextRef, audioRef, gainNodeRef, getTargetPlaybackVolume, sourceRef, syncOutputGain]);

    const cacheSongAssets = useCallback(async () => {
        if (!currentSong || !audioSrc || audioSrc.startsWith('blob:')) return;

        const existing = await hasCachedSongAudio(currentSong);
        if (existing || !enableMediaCache) return;

        console.log('[Cache] Caching fully played song:', currentSong.name);

        try {
            const response = await fetch(audioSrc);
            const blob = await response.blob();
            await saveAudioBlob(getSongResourceCacheKey('audio', currentSong), blob);
            console.log('[Cache] Audio saved');
        } catch (error) {
            console.error('[Cache] Failed to download audio for cache', error);
        }

        const coverUrl = getCoverUrl();
        if (coverUrl) {
            try {
                const response = await fetch(coverUrl, { mode: 'cors' });
                const blob = await response.blob();
                await saveToCache(getSongResourceCacheKey('cover', currentSong), blob);
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
        applyReplayGain();
    }, [applyReplayGain]);

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
                            setPlayerState(PlayerState.PLAYING);
                            setupAudioAnalyzer();
                        })
                        .catch(error => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                setPlayerState(PlayerState.PLAYING);
                                return;
                            }

                            if (error.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
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
