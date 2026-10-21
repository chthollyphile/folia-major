import React, { useEffect, useRef } from 'react';
import type { AudioBands, MonetAudioStyle, Theme } from '../../../types';
import { createMonetAudioPainter } from './monetAudioCanvas';
import { MONET_AUDIO_BAR_COUNT, sampleMonetSpectrum, type MonetAudioFrame } from './monetAudioSpectrum';

// src/components/visualizer/monet/AudioOverlay.tsx
// Renders Monet's audio rail or lyrics-area spectrum, with a static placeholder in preview mode.
interface AudioOverlayProps {
    audioPower: AudioBands['bass'];
    audioBands: AudioBands;
    theme: Theme;
    mode: MonetAudioStyle;
    centered?: boolean;
    gain?: number;
    paused?: boolean;
    staticMode?: boolean;
    isPreviewMode?: boolean;
}

const AudioOverlay: React.FC<AudioOverlayProps> = ({
    audioPower,
    audioBands,
    theme,
    mode,
    centered = false,
    gain = 1,
    paused = false,
    staticMode = false,
    isPreviewMode = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const lastFrameRef = useRef<MonetAudioFrame | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        let frameId: number | null = null;
        let active = true;
        let canvasWidth = 0;
        let canvasHeight = 0;
        let canvasDpr = 0;
        const placeholder = staticMode || isPreviewMode;
        const paint = createMonetAudioPainter(context, {
            color: theme.primaryColor, mode, centered, gain, placeholder,
        });

        const resizeCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            if (rect.width === canvasWidth && rect.height === canvasHeight && dpr === canvasDpr) return false;
            canvasWidth = rect.width;
            canvasHeight = rect.height;
            canvasDpr = dpr;
            const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
            const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
            if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
                canvas.width = nextWidth;
                canvas.height = nextHeight;
            }
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            return true;
        };

        const draw = () => {
            if (canvasWidth <= 0 || canvasHeight <= 0) return;
            if (!placeholder && (!paused || !lastFrameRef.current)) {
                const frame = lastFrameRef.current ?? {
                    spectrum: new Float32Array(MONET_AUDIO_BAR_COUNT), energy: 0, time: 0,
                };
                sampleMonetSpectrum([
                    audioBands.bass.get() / 255,
                    audioBands.lowMid.get() / 255,
                    audioBands.mid.get() / 255,
                    audioBands.vocal.get() / 255,
                    audioBands.treble.get() / 255,
                ], audioBands.spectrum?.get(), frame.spectrum);
                frame.energy = Math.min(1, Math.max(0.08, audioPower.get() / 255));
                frame.time = performance.now();
                lastFrameRef.current = frame;
            }
            paint(canvasWidth, canvasHeight, lastFrameRef.current);
        };
        const handleResize = () => {
            if (active && resizeCanvas()) draw();
        };
        const loop = () => {
            if (!active) return;
            draw();
            frameId = window.requestAnimationFrame(loop);
        };

        resizeCanvas();
        draw();
        const observer = new ResizeObserver(handleResize);
        observer.observe(canvas);
        window.addEventListener('resize', handleResize);
        if (!placeholder && !paused) frameId = window.requestAnimationFrame(loop);

        return () => {
            active = false;
            if (frameId !== null) window.cancelAnimationFrame(frameId);
            observer.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, [audioBands, audioPower, centered, gain, isPreviewMode, mode, paused, staticMode, theme.primaryColor]);

    return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
};

export default AudioOverlay;
