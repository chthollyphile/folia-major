import { useEffect, useRef } from 'react';
import { type MotionValue } from 'framer-motion';
import { type VisualizerMode } from '../../types';
import { getPreviewPlaceholderStartOffset } from './PreviewPlaceholder';
import { toVisualizerAudioLevel } from './audioLevels';

// Drives preview-only motion values without putting frame-by-frame data into React state.
interface VisPlaygroundPreviewPlaybackOptions {
    audioPower: MotionValue<number>;
    bass: MotionValue<number>;
    lowMid: MotionValue<number>;
    mid: MotionValue<number>;
    vocal: MotionValue<number>;
    treble: MotionValue<number>;
    spectrum: MotionValue<Uint8Array<ArrayBuffer>>;
    currentTime: MotionValue<number>;
    visualizerMode: VisualizerMode;
    loopDuration: number;
    playbackKey: string;
    isPaused: boolean;
}

export const useVisPlaygroundPreviewPlayback = ({
    audioPower,
    bass,
    lowMid,
    mid,
    vocal,
    treble,
    spectrum,
    currentTime,
    visualizerMode,
    loopDuration,
    playbackKey,
    isPaused,
}: VisPlaygroundPreviewPlaybackOptions) => {
    const elapsedRef = useRef(0);
    const lastTickRef = useRef<number | null>(null);

    useEffect(() => {
        const offset = getPreviewPlaceholderStartOffset(visualizerMode, loopDuration);
        elapsedRef.current = offset;
        lastTickRef.current = null;
        currentTime.set(offset);
    }, [currentTime, loopDuration, playbackKey, visualizerMode]);

    useEffect(() => {
        if (isPaused) {
            lastTickRef.current = null;
            return undefined;
        }

        let frameId = 0;
        const tick = (now: number) => {
            const previousTick = lastTickRef.current ?? now;
            elapsedRef.current = (elapsedRef.current + (now - previousTick) / 1000) % loopDuration;
            lastTickRef.current = now;
            currentTime.set(elapsedRef.current);

            const wave = (offset: number, speed: number, floor: number, amplitude: number) =>
                floor + (Math.sin(now * speed + offset) * 0.5 + 0.5) * amplitude;

            audioPower.set(toVisualizerAudioLevel(wave(0.2, 0.0024, 0.16, 0.18)));
            bass.set(toVisualizerAudioLevel(wave(0.9, 0.0032, 0.14, 0.2)));
            lowMid.set(toVisualizerAudioLevel(wave(1.7, 0.0028, 0.12, 0.16)));
            mid.set(toVisualizerAudioLevel(wave(2.6, 0.0023, 0.1, 0.14)));
            vocal.set(toVisualizerAudioLevel(wave(3.4, 0.0038, 0.16, 0.22)));
            treble.set(toVisualizerAudioLevel(wave(4.2, 0.0046, 0.08, 0.14)));

            const nextSpectrum = new Uint8Array(64);
            for (let index = 0; index < nextSpectrum.length; index += 1) {
                const normalizedIndex = index / Math.max(1, nextSpectrum.length - 1);
                const lowShape = Math.exp(-normalizedIndex * 2.4);
                const harmonic =
                    Math.sin(now * 0.0027 + normalizedIndex * Math.PI * 3.4) * 0.18 +
                    Math.sin(now * 0.0052 + normalizedIndex * Math.PI * 11.5) * 0.08;
                const shimmer = Math.sin(now * 0.0018 + normalizedIndex * Math.PI * 1.2) * 0.12;
                const amplitude = Math.max(0, Math.min(1, lowShape * 0.8 + 0.08 + harmonic + shimmer));
                nextSpectrum[index] = Math.round(amplitude * 255);
            }
            spectrum.set(nextSpectrum);

            frameId = window.requestAnimationFrame(tick);
        };

        frameId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frameId);
    }, [audioPower, bass, currentTime, isPaused, loopDuration, lowMid, mid, spectrum, treble, vocal]);
};
