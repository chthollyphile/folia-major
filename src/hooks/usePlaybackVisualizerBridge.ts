import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { findLatestActiveLineIndex } from '../utils/appPlaybackHelpers';
import { PlayerState } from '../types';
import type { LyricData } from '../types';

// src/hooks/usePlaybackVisualizerBridge.ts

type UsePlaybackVisualizerBridgeParams = {
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    animationFrameRef: MutableRefObject<number>;
    activePlaybackContext: 'main' | 'stage';
    audioPower: MotionValue<number>;
    audioBands: {
        bass: MotionValue<number>;
        lowMid: MotionValue<number>;
        mid: MotionValue<number>;
        vocal: MotionValue<number>;
        treble: MotionValue<number>;
    };
    currentTime: MotionValue<number>;
    lyrics: LyricData | null;
    playerState: PlayerState;
    duration: number;
    effectiveLoopMode: 'off' | 'all' | 'one';
    isNowPlayingStageActive: boolean;
    stageActiveEntryKind: string | null;
    stageLyricsSession: unknown;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    setCurrentLineIndex: React.Dispatch<React.SetStateAction<number>>;
    setPlayerState: React.Dispatch<React.SetStateAction<PlayerState>>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    getNowPlayingDisplayTime: () => number;
    syncNowPlayingClock: (progressSec: number, durationSec: number, paused: boolean) => void;
};

// Runs the requestAnimationFrame loop for audio-reactive visuals and lyric timing.
export function usePlaybackVisualizerBridge({
    audioRef,
    analyserRef,
    animationFrameRef,
    activePlaybackContext,
    audioPower,
    audioBands,
    currentTime,
    lyrics,
    playerState,
    duration,
    effectiveLoopMode,
    isNowPlayingStageActive,
    stageActiveEntryKind,
    stageLyricsSession,
    stageLyricsClockRef,
    setCurrentLineIndex,
    setPlayerState,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    getNowPlayingDisplayTime,
    syncNowPlayingClock,
}: UsePlaybackVisualizerBridgeParams) {
    const currentLineIndexRef = useRef(-1);

    const updateLoop = useCallback(() => {
        const audioElement = audioRef.current;
        const isActuallyPlaying = Boolean(audioElement && !audioElement.paused && !audioElement.ended);

        if (isActuallyPlaying && analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);

            const getEnergy = (minHz: number, maxHz: number): number => {
                const start = Math.floor(minHz / 21.5);
                const end = Math.floor(maxHz / 21.5);
                let sum = 0;
                for (let index = start; index <= end; index += 1) {
                    sum += dataArray[index];
                }
                const count = end - start + 1;
                return count > 0 ? sum / count : 0;
            };

            const bass = getEnergy(20, 150);
            const lowMid = getEnergy(150, 400);
            const mid = getEnergy(400, 1200);
            const vocal = getEnergy(1000, 3500);
            const treble = getEnergy(3500, 12000);

            const process = (value: number, boost = 2) => {
                const normalized = value / 255;
                return Math.pow(normalized, boost) * 255;
            };

            audioPower.set(process((bass + lowMid) / 2, 3));
            audioBands.bass.set(process(bass, 1.8));
            audioBands.lowMid.set(process(lowMid, 2));
            audioBands.mid.set(process(mid, 2));
            audioBands.vocal.set(process(vocal, 1.5));
            audioBands.treble.set(process(treble, 2));
        } else {
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);
            audioBands.bass.set(breath);
            audioBands.lowMid.set(breath);
            audioBands.mid.set(breath);
            audioBands.vocal.set(breath);
            audioBands.treble.set(breath);
        }

        if (isActuallyPlaying && audioElement) {
            const time = audioElement.currentTime;
            currentTime.set(time);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, time);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            }
        } else if (isNowPlayingStageActive) {
            const nextTime = getNowPlayingDisplayTime();
            const hasReachedEnd = playerState === PlayerState.PLAYING && duration > 0 && nextTime >= duration;

            currentTime.set(nextTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            } else if (currentLineIndexRef.current !== -1) {
                currentLineIndexRef.current = -1;
                setCurrentLineIndex(-1);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncNowPlayingClock(0, duration, false);
                    currentTime.set(0);
                    if (lyrics) {
                        const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, 0);
                        if (restartedLineIndex !== currentLineIndexRef.current) {
                            currentLineIndexRef.current = restartedLineIndex;
                            setCurrentLineIndex(restartedLineIndex);
                        }
                    }
                } else {
                    syncNowPlayingClock(duration, duration, true);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        } else if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && stageLyricsSession && lyrics) {
            const nextTime = getSyntheticStageLyricsTime();
            const clock = stageLyricsClockRef.current;
            const hasReachedEnd = playerState === PlayerState.PLAYING && nextTime >= clock.endTimeSec;

            currentTime.set(nextTime);

            const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
            if (foundIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = foundIndex;
                setCurrentLineIndex(foundIndex);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncStageLyricsClock(clock.startTimeSec, clock.endTimeSec, PlayerState.PLAYING, clock.startTimeSec);
                    currentTime.set(clock.startTimeSec);
                    const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, clock.startTimeSec);
                    if (restartedLineIndex !== currentLineIndexRef.current) {
                        currentLineIndexRef.current = restartedLineIndex;
                        setCurrentLineIndex(restartedLineIndex);
                    }
                } else {
                    syncStageLyricsClock(clock.endTimeSec, clock.endTimeSec, PlayerState.PAUSED, clock.startTimeSec);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        }

        animationFrameRef.current = requestAnimationFrame(updateLoop);
    }, [
        activePlaybackContext,
        analyserRef,
        animationFrameRef,
        audioBands,
        audioPower,
        audioRef,
        currentTime,
        duration,
        effectiveLoopMode,
        getNowPlayingDisplayTime,
        getSyntheticStageLyricsTime,
        isNowPlayingStageActive,
        lyrics,
        playerState,
        setCurrentLineIndex,
        setPlayerState,
        stageActiveEntryKind,
        stageLyricsClockRef,
        stageLyricsSession,
        syncNowPlayingClock,
        syncStageLyricsClock,
    ]);

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(updateLoop);
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [animationFrameRef, updateLoop]);
}
