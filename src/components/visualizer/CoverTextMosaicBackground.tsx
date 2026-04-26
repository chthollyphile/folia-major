import React, { forwardRef, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Theme } from '../../types';
import { resolveThemeFontStack } from '../../utils/fontStacks';

interface CoverTextMosaicBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
    text: string;
    opacity?: number;
    width: number;
    height: number;
}

const SAMPLE_CANVAS_SIZE = 72;
const DEFAULT_TEXT = 'FOLIA';
const MAX_CANVAS_PIXELS = 1_800_000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

const normalizeText = (text: string) => {
    const normalized = text.replace(/\s+/g, '').trim();
    return normalized.length > 0 ? normalized : DEFAULT_TEXT;
};

const resolveCells = ({ width, height }: { width: number; height: number; }) => {
    const minSide = Math.max(Math.min(width, height), 1);
    const cellSize = clamp(minSide / 52, 9, 18);
    return {
        cellSize,
        columns: clamp(Math.floor(width / cellSize), 32, 96),
        rows: clamp(Math.floor(height / cellSize), 24, 72),
    };
};

const resolveColor = (data: Uint8ClampedArray, index: number) => {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
    const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;

    return {
        r,
        g,
        b,
        saturation,
        luminance,
    };
};

const CoverTextMosaicBackground = memo(forwardRef<HTMLDivElement, CoverTextMosaicBackgroundProps>(({
    coverUrl,
    theme,
    text,
    opacity = 0.32,
    width,
    height,
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [isReady, setIsReady] = useState(false);
    const textSource = useMemo(() => normalizeText(text), [text]);
    const fontFamily = useMemo(() => resolveThemeFontStack(theme), [theme]);

    useEffect(() => {
        let cancelled = false;
        const canvas = canvasRef.current;

        if (!canvas || !coverUrl || width <= 0 || height <= 0) {
            setIsReady(false);
            return () => {
                cancelled = true;
            };
        }

        setIsReady(false);

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';

        image.onload = () => {
            if (cancelled) return;

            try {
                const canvasWidth = Math.max(Math.floor(width), 1);
                const canvasHeight = Math.max(Math.floor(height), 1);
                const maxDprForBudget = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(canvasWidth * canvasHeight, 1));
                const dpr = clamp(Math.min(window.devicePixelRatio || 1, maxDprForBudget), 0.35, 2);
                canvas.width = Math.floor(canvasWidth * dpr);
                canvas.height = Math.floor(canvasHeight * dpr);
                canvas.style.width = `${canvasWidth}px`;
                canvas.style.height = `${canvasHeight}px`;

                const context = canvas.getContext('2d');
                const sampleCanvas = document.createElement('canvas');
                const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
                if (!context || !sampleContext) return;

                sampleCanvas.width = SAMPLE_CANVAS_SIZE;
                sampleCanvas.height = SAMPLE_CANVAS_SIZE;

                const naturalWidth = image.naturalWidth || image.width;
                const naturalHeight = image.naturalHeight || image.height;
                const sourceSize = Math.min(naturalWidth, naturalHeight);
                const sourceX = Math.max((naturalWidth - sourceSize) * 0.5, 0);
                const sourceY = Math.max((naturalHeight - sourceSize) * 0.5, 0);

                sampleContext.drawImage(
                    image,
                    sourceX,
                    sourceY,
                    sourceSize,
                    sourceSize,
                    0,
                    0,
                    SAMPLE_CANVAS_SIZE,
                    SAMPLE_CANVAS_SIZE,
                );

                const sampleData = sampleContext.getImageData(0, 0, SAMPLE_CANVAS_SIZE, SAMPLE_CANVAS_SIZE).data;
                const { cellSize, columns, rows } = resolveCells({ width: canvasWidth, height: canvasHeight });
                const gridWidth = columns * cellSize;
                const gridHeight = rows * cellSize;
                const offsetX = (canvasWidth - gridWidth) * 0.5;
                const offsetY = (canvasHeight - gridHeight) * 0.5;

                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                context.clearRect(0, 0, canvasWidth, canvasHeight);
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.font = `760 ${Math.max(cellSize * 0.88, 8)}px ${fontFamily}`;
                context.shadowBlur = cellSize * 0.42;
                context.globalCompositeOperation = 'source-over';

                for (let row = 0; row < rows; row += 1) {
                    for (let column = 0; column < columns; column += 1) {
                        const sampleX = clamp(Math.floor((column / Math.max(columns - 1, 1)) * (SAMPLE_CANVAS_SIZE - 1)), 0, SAMPLE_CANVAS_SIZE - 1);
                        const sampleY = clamp(Math.floor((row / Math.max(rows - 1, 1)) * (SAMPLE_CANVAS_SIZE - 1)), 0, SAMPLE_CANVAS_SIZE - 1);
                        const sampleIndex = (sampleY * SAMPLE_CANVAS_SIZE + sampleX) * 4;
                        const color = resolveColor(sampleData, sampleIndex);
                        const cellAlpha = clamp(
                            0.13 + color.saturation * 0.24 + Math.abs(color.luminance - 0.5) * 0.2,
                            0.13,
                            0.48,
                        );
                        const charIndex = (row * columns + column * 7 + row * 11) % textSource.length;
                        const char = textSource[charIndex] ?? DEFAULT_TEXT[0]!;
                        const x = offsetX + column * cellSize + cellSize * 0.5;
                        const y = offsetY + row * cellSize + cellSize * 0.5;
                        const lift = mix(16, 48, 1 - color.luminance);
                        const r = clamp(color.r + lift, 0, 255);
                        const g = clamp(color.g + lift, 0, 255);
                        const b = clamp(color.b + lift, 0, 255);

                        context.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${cellAlpha})`;
                        context.shadowColor = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${cellAlpha * 0.7})`;
                        context.fillText(char, x, y);
                    }
                }

                context.shadowBlur = 0;
                context.shadowColor = 'transparent';

                if (!cancelled) {
                    setIsReady(true);
                }
            } catch (error) {
                console.warn('[CoverTextMosaicBackground] Failed to sample cover image', error);
                if (!cancelled) {
                    setIsReady(false);
                }
            }
        };

        image.onerror = () => {
            if (!cancelled) {
                setIsReady(false);
            }
        };
        image.src = coverUrl;

        return () => {
            cancelled = true;
        };
    }, [coverUrl, fontFamily, height, textSource, theme.accentColor, theme.primaryColor, width]);

    return (
        <div
            ref={ref}
            aria-hidden="true"
            className="absolute left-0 top-0 z-[1] overflow-hidden pointer-events-none transition-opacity duration-700"
            style={{
                width,
                height,
                opacity: isReady ? opacity : 0,
                mixBlendMode: 'screen',
                transformOrigin: '0 0',
                willChange: 'transform, opacity',
                maskImage: 'radial-gradient(circle at 50% 48%, black 0%, black 58%, transparent 86%)',
                WebkitMaskImage: 'radial-gradient(circle at 50% 48%, black 0%, black 58%, transparent 86%)',
            }}
        >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>
    );
}), (previous, next) => (
    previous.coverUrl === next.coverUrl
    && previous.text === next.text
    && previous.opacity === next.opacity
    && previous.width === next.width
    && previous.height === next.height
    && previous.theme.backgroundColor === next.theme.backgroundColor
    && previous.theme.primaryColor === next.theme.primaryColor
    && previous.theme.secondaryColor === next.theme.secondaryColor
    && previous.theme.accentColor === next.theme.accentColor
    && previous.theme.fontFamily === next.theme.fontFamily
    && previous.theme.fontStyle === next.theme.fontStyle
));

export default CoverTextMosaicBackground;
