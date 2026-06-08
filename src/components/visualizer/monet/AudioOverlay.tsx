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
const MIN_RAW_SPECTRUM_BIN = 6;

const buildSpectrumAnchors = (bands: number[]) => {
    const [bass, lowMid, mid, vocal, treble] = bands;
    return [
        bass * 1.08,
        bass * 0.96,
        bass * 0.74 + lowMid * 0.26,
        lowMid,
        lowMid * 0.58 + mid * 0.42,
        mid,
        mid * 0.42 + vocal * 0.58,
        vocal,
        vocal * 0.48 + treble * 0.52,
        treble,
        treble * 0.82,
    ].map(value => Math.max(0, Math.min(1, value)));
};

const sampleSpectrumProfile = (bands: number[], normalizedIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(1, normalizedIndex));
    const anchors = buildSpectrumAnchors(bands);
    const logIndex = Math.log10(1 + clampedIndex * 9);
    const scaledIndex = logIndex * (anchors.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(lowerIndex + 1, anchors.length - 1);
    const interpolation = scaledIndex - lowerIndex;
    const lowerValue = anchors[lowerIndex] ?? 0;
    const upperValue = bands[upperIndex] ?? lowerValue;
    const interpolated = lowerValue + (upperValue - lowerValue) * interpolation;

    // Add a fuller contour so the profile reads like a continuous response curve.
    const contour =
        0.92 +
        Math.sin(clampedIndex * Math.PI * 3.4 - Math.PI * 0.3) * 0.08 +
        Math.sin(clampedIndex * Math.PI * 9.2 + Math.PI * 0.2) * 0.035;
    return Math.max(0, Math.min(1, interpolated * contour));
};

const sampleRawSpectrumProfile = (rawSpectrum: Uint8Array, normalizedIndex: number) => {
    if (rawSpectrum.length <= MIN_RAW_SPECTRUM_BIN) {
        return 0;
    }

    const clampedIndex = Math.max(0, Math.min(1, normalizedIndex));
    const usableBinCount = Math.max(1, rawSpectrum.length - MIN_RAW_SPECTRUM_BIN);
    const mappedIndex = Math.expm1(clampedIndex * Math.log(usableBinCount + 1));
    const centerIndex = MIN_RAW_SPECTRUM_BIN + mappedIndex;
    const edgeSoftness = 1 - Math.abs(clampedIndex - 0.5) * 2;
    const windowRadius = Math.max(1, Math.round(5 - edgeSoftness * 3));
    const start = Math.max(MIN_RAW_SPECTRUM_BIN, Math.floor(centerIndex - windowRadius));
    const end = Math.min(rawSpectrum.length - 1, Math.ceil(centerIndex + windowRadius));

    let weightedSum = 0;
    let weightTotal = 0;
    for (let index = start; index <= end; index += 1) {
        const distance = Math.abs(index - centerIndex);
        const weight = Math.max(0.1, 1 - distance / (windowRadius + 1));
        weightedSum += rawSpectrum[index] * weight;
        weightTotal += weight;
    }

    const averaged = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const normalized = Math.max(0, Math.min(1, (averaged - 12) / 243));
    const lowFrequencyCompensation = 0.62 + clampedIndex * 0.52;
    const presenceLift = 0.92 + Math.sqrt(clampedIndex) * 0.14;
    return Math.max(0, Math.min(1, normalized * lowFrequencyCompensation * presenceLift));
};

const drawStaticBars = (context: CanvasRenderingContext2D, width: number, height: number, theme: Theme, mode: MonetAudioStyle) => {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = colorWithAlpha(theme.primaryColor, 0.96);
    context.fillStyle = colorWithAlpha(theme.primaryColor, 0.9);
    context.lineWidth = 1.5;
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
        const barHeight = height * (0.12 + (Math.sin(index * 0.35) * 0.5 + 0.5) * 0.42);
        const x = index * gap + gap * 0.14;
        context.fillRect(x, height - barHeight, Math.max(1.35, gap * 0.34), barHeight);
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
            const bands = [
                audioBands.bass.get() / 255,
                audioBands.lowMid.get() / 255,
                audioBands.mid.get() / 255,
                audioBands.vocal.get() / 255,
                audioBands.treble.get() / 255,
            ];
            const rawSpectrum = audioBands.spectrum?.get() ?? new Uint8Array(0);
            const hasRawSpectrum = rawSpectrum.length > MIN_RAW_SPECTRUM_BIN;
            const energy = Math.min(1, Math.max(0.08, audioPower.get() / 255));
            const primaryInk = colorWithAlpha(theme.primaryColor, 0.94);
            const softInk = colorWithAlpha(theme.primaryColor, 0.72);
            const gradient = context.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, softInk);
            gradient.addColorStop(0.5, primaryInk);
            gradient.addColorStop(1, softInk);
            context.fillStyle = gradient;
            context.strokeStyle = gradient;
            context.lineWidth = 1.5;
            context.lineCap = 'round';

            if (mode === 'line') {
                context.beginPath();
                for (let index = 0; index < BAR_COUNT; index += 1) {
                    const x = (index / (BAR_COUNT - 1)) * width;
                    const spectrumIndex = index / (BAR_COUNT - 1);
                    const band = hasRawSpectrum
                        ? sampleRawSpectrumProfile(rawSpectrum, spectrumIndex)
                        : sampleSpectrumProfile(bands, spectrumIndex);
                    const wave =
                        Math.sin(index * 0.24 + performance.now() * 0.004) * 0.08 +
                        Math.sin(index * 0.68 + performance.now() * 0.0028) * 0.05;
                    const y = height * (0.9 - (energy * 0.12 + band * 0.42 + wave * 0.08));
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
                    const spectrumIndex = index / (BAR_COUNT - 1);
                    const band = hasRawSpectrum
                        ? sampleRawSpectrumProfile(rawSpectrum, spectrumIndex)
                        : sampleSpectrumProfile(bands, spectrumIndex);
                    const pulse = Math.sin(index * 0.45 + performance.now() * 0.006) * 0.5 + 0.5;
                    const barHeight = height * (0.08 + energy * 0.18 + band * 0.34 + pulse * 0.03);
                    const x = index * gap + gap * 0.14;
                    context.fillRect(x, height - barHeight, Math.max(1.35, gap * 0.34), barHeight);
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
