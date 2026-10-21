import type { MonetAudioStyle } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { MONET_AUDIO_BAR_COUNT, resolveMonetAudioGain, type MonetAudioFrame } from './monetAudioSpectrum';

// Draws either the original bottom rail or a spectrum mirrored around the lyrics-area centre.
interface MonetAudioCanvasOptions {
    color: string;
    mode: MonetAudioStyle;
    centered: boolean;
    gain: number;
    placeholder: boolean;
}

const traceCurve = (context: CanvasRenderingContext2D, points: { x: number; y: number }[]) => {
    context.moveTo(points[0].x, points[0].y);
    for (let index = 0; index < points.length - 1; index += 1) {
        const xc = (points[index].x + points[index + 1].x) / 2;
        const yc = (points[index].y + points[index + 1].y) / 2;
        context.quadraticCurveTo(points[index].x, points[index].y, xc, yc);
    }
    context.lineTo(points[points.length - 1].x, points[points.length - 1].y);
};

export const createMonetAudioPainter = (
    context: CanvasRenderingContext2D,
    { color, mode, centered, gain, placeholder }: MonetAudioCanvasOptions,
) => {
    const responseGain = resolveMonetAudioGain(gain);
    // Both gradients depend only on the canvas size and the theme colour (fixed for this effect
    // run), so they are rebuilt when the size changes rather than on every frame.
    let gradientSize = '';
    let inkGradient: CanvasGradient;
    let areaGradient: CanvasGradient;
    const resolveGradients = (width: number, height: number) => {
        const size = `${width}x${height}`;
        if (size !== gradientSize) {
            gradientSize = size;
            inkGradient = context.createLinearGradient(0, 0, width, 0);
            inkGradient.addColorStop(0, colorWithAlpha(color, 0.72));
            inkGradient.addColorStop(0.5, colorWithAlpha(color, 0.94));
            inkGradient.addColorStop(1, colorWithAlpha(color, 0.72));
            areaGradient = context.createLinearGradient(0, 0, 0, height);
            if (centered) {
                areaGradient.addColorStop(0, colorWithAlpha(color, 0.0));
                areaGradient.addColorStop(0.5, colorWithAlpha(color, 0.24));
                areaGradient.addColorStop(1, colorWithAlpha(color, 0.0));
            } else {
                areaGradient.addColorStop(0, colorWithAlpha(color, 0.24));
                areaGradient.addColorStop(1, colorWithAlpha(color, 0.0));
            }
        }
    };

    return (width: number, height: number, frame: MonetAudioFrame | null) => {
        if (width <= 0 || height <= 0) return;
        resolveGradients(width, height);
        context.clearRect(0, 0, width, height);
        context.strokeStyle = placeholder ? colorWithAlpha(color, 0.96) : inkGradient;
        context.fillStyle = placeholder ? colorWithAlpha(color, 0.9) : inkGradient;
        context.lineWidth = 1.5;
        context.lineCap = 'round';

        const baseline = centered ? height / 2 : height;
        const extent = centered ? Math.max(0, height / 2 - 1) : height;
        const points: { x: number; y: number }[] = [];
        const gap = width / MONET_AUDIO_BAR_COUNT;
        for (let index = 0; index < MONET_AUDIO_BAR_COUNT; index += 1) {
            const spectrumIndex = index / (MONET_AUDIO_BAR_COUNT - 1);
            const envelope = Math.sin(spectrumIndex * Math.PI);
            let response: number;
            if (placeholder) {
                const val = 0.12 + (Math.sin(index * 0.35) * 0.5 + 0.5) * 0.42;
                response = val * (mode === 'line' ? 1 : 0.8);
            } else {
                const band = frame?.spectrum[index] ?? 0;
                const time = frame?.time ?? 0;
                const energy = frame?.energy ?? 0.08;
                if (mode === 'line') {
                    const wave =
                        Math.sin(index * 0.24 + time * 0.004) * 0.08 +
                        Math.sin(index * 0.68 + time * 0.0028) * 0.05;
                    response = energy * 0.04 + band * 0.8 + wave * 0.04;
                } else {
                    const pulse = Math.sin(index * 0.45 + time * 0.006) * 0.5 + 0.5;
                    response = energy * 0.04 + band * 0.82 + pulse * 0.02;
                }
            }
            const amplitude = Math.max(0, Math.min(1,
                (mode === 'line' ? 0 : 0.02) + response * responseGain * envelope,
            ));
            const barHeight = extent * amplitude;
            if (mode === 'line') {
                points.push({ x: spectrumIndex * width, y: baseline - barHeight });
            } else {
                const x = index * gap + gap * 0.14;
                context.fillRect(x, baseline - barHeight, Math.max(1.35, gap * 0.34), barHeight * (centered ? 2 : 1));
            }
        }
        if (mode !== 'line') return;

        // Fill area under the curve
        context.beginPath();
        traceCurve(context, points);
        context.lineTo(width, baseline);
        context.lineTo(0, baseline);
        context.closePath();
        const lowerPoints = centered
            ? points.map(point => ({ x: point.x, y: height - point.y }))
            : null;
        if (lowerPoints) {
            // Trace in the same direction to preserve the exact mirrored smoothing geometry.
            traceCurve(context, lowerPoints);
            context.lineTo(width, baseline);
            context.lineTo(0, baseline);
            context.closePath();
        }
        context.fillStyle = areaGradient;
        context.fill();

        // Stroke the response curve and its mirrored counterpart when centered.
        context.beginPath();
        traceCurve(context, points);
        if (lowerPoints) traceCurve(context, lowerPoints);
        context.lineWidth = 2.0;
        context.stroke();
    };
};
