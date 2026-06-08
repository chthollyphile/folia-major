import React, { useEffect, useRef } from 'react';
import type { AudioBands, MonetAudioStyle, Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';

// src/components/visualizer/monet/AudioOverlay.tsx
// Renders the bottom audio rail for Monet with a lightweight canvas loop in player mode and a static placeholder in preview mode.
interface AudioOverlayProps {
    audioPower: AudioBands['bass'];
    audioBands: AudioBands;
    theme: Theme;
    mode: MonetAudioStyle;
    staticMode?: boolean;
    isPreviewMode?: boolean;
}

const BAR_COUNT = 72;

const drawStaticBars = (context: CanvasRenderingContext2D, width: number, height: number, theme: Theme, mode: MonetAudioStyle) => {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = colorWithAlpha(theme.primaryColor, 0.92);
    context.fillStyle = colorWithAlpha(theme.primaryColor, 0.9);
    context.lineWidth = 2;
    context.lineCap = 'round';

    if (mode === 'line') {
        context.beginPath();
        for (let index = 0; index < BAR_COUNT; index += 1) {
            const x = (index / (BAR_COUNT - 1)) * width;
            const y = height * (0.62 - Math.sin(index * 0.42) * 0.14);
            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }
        context.stroke();
        return;
    }

    const gap = width / BAR_COUNT;
    for (let index = 0; index < BAR_COUNT; index += 1) {
        const barHeight = height * (0.16 + (Math.sin(index * 0.35) * 0.5 + 0.5) * 0.55);
        const x = index * gap + gap * 0.15;
        context.fillRect(x, height - barHeight, Math.max(2, gap * 0.52), barHeight);
    }
};

const AudioOverlay: React.FC<AudioOverlayProps> = ({
    audioPower,
    audioBands,
    theme,
    mode,
    staticMode = false,
    isPreviewMode = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        let frameId = 0;

        const resizeCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
            const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
            if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
                canvas.width = nextWidth;
                canvas.height = nextHeight;
            }
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            return { width: rect.width, height: rect.height };
        };

        const draw = () => {
            const { width, height } = resizeCanvas();
            if (width <= 0 || height <= 0) {
                return;
            }

            context.clearRect(0, 0, width, height);
            const bars = [
                audioBands.bass.get(),
                audioBands.lowMid.get(),
                audioBands.mid.get(),
                audioBands.vocal.get(),
                audioBands.treble.get(),
            ];
            const energy = Math.min(1, Math.max(0.08, audioPower.get() / 255));
            const gradient = context.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, colorWithAlpha(theme.primaryColor, 0.82));
            gradient.addColorStop(0.45, colorWithAlpha(theme.accentColor, 0.95));
            gradient.addColorStop(1, colorWithAlpha(theme.primaryColor, 0.82));
            context.fillStyle = gradient;
            context.strokeStyle = gradient;
            context.lineWidth = 2;
            context.lineCap = 'round';

            if (mode === 'line') {
                context.beginPath();
                for (let index = 0; index < BAR_COUNT; index += 1) {
                    const x = (index / (BAR_COUNT - 1)) * width;
                    const band = bars[index % bars.length] / 255;
                    const wave = Math.sin(index * 0.26 + performance.now() * 0.004) * 0.16;
                    const y = height * (0.72 - (energy * 0.32 + band * 0.22 + wave * 0.12));
                    if (index === 0) {
                        context.moveTo(x, y);
                    } else {
                        context.lineTo(x, y);
                    }
                }
                context.stroke();
            } else {
                const gap = width / BAR_COUNT;
                for (let index = 0; index < BAR_COUNT; index += 1) {
                    const band = bars[index % bars.length] / 255;
                    const pulse = Math.sin(index * 0.45 + performance.now() * 0.006) * 0.5 + 0.5;
                    const barHeight = height * (0.14 + energy * 0.4 + band * 0.22 + pulse * 0.08);
                    const x = index * gap + gap * 0.15;
                    context.fillRect(x, height - barHeight, Math.max(2, gap * 0.5), barHeight);
                }
            }
        };

        const drawStatic = () => {
            const { width, height } = resizeCanvas();
            drawStaticBars(context, width, height, theme, mode);
        };

        if (staticMode || isPreviewMode) {
            drawStatic();
            return;
        }

        const loop = () => {
            draw();
            frameId = window.requestAnimationFrame(loop);
        };

        loop();
        window.addEventListener('resize', drawStatic);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', drawStatic);
        };
    }, [audioBands, audioPower, isPreviewMode, mode, staticMode, theme]);

    return <canvas ref={canvasRef} className="h-full w-full" />;
};

export default AudioOverlay;
