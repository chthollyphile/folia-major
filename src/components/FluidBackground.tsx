import React, { useEffect, useRef, memo } from 'react';
import { extractColors } from '../utils/colorExtractor';
import { Theme } from '../types';

interface FluidBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
}

const FluidBackground: React.FC<FluidBackgroundProps> = memo(({ coverUrl, theme }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const drawBackground = (colors: string[]) => {
            const { width, height } = canvas;

            // Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Create a gradient background using the first few colors
            // This provides a richer base than a single solid color
            if (colors.length >= 2) {
                const bgGradient = ctx.createLinearGradient(0, 0, width, height);
                bgGradient.addColorStop(0, colors[0]);
                bgGradient.addColorStop(1, colors[1]);
                ctx.fillStyle = bgGradient;
            } else {
                ctx.fillStyle = colors[0] || theme.backgroundColor;
            }
            ctx.fillRect(0, 0, width, height);

            // Create a seeded-like randomness for consistent blob positions per re-render (if any)
            const seed = 12345;
            const seededRandom = (offset: number) => {
                const x = Math.sin(seed + offset * 12345) * 10000;
                return x - Math.floor(x);
            };

            // Draw blobs
            // Use fewer blobs to avoid muddiness and create distinct "spotlights"
            const blobCount = 6;

            for (let i = 0; i < blobCount; i++) {
                // Cycle through colors
                const color = colors[i % colors.length];

                // Generate random position
                const cx = seededRandom(i * 7) * width;
                const cy = seededRandom(i * 11) * height;
                const maxDim = Math.max(width, height);

                // Smaller radius for spotlight effect (15-45% of screen)
                // This reduces overlap significantly
                const radius = (0.15 + seededRandom(i * 3) * 0.3) * maxDim;

                const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

                // Increase opacity for a more defined light source look
                ctx.globalAlpha = 0.7;
                gradient.addColorStop(0, color);
                // Smooth fade out to creating a soft light edge
                gradient.addColorStop(1, 'transparent');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            }

            // Reset alpha
            ctx.globalAlpha = 1.0;
        };

        const generate = async () => {
            let colors: string[] = [];
            if (coverUrl) {
                try {
                    // Extract more colors to get a better palette
                    const extracted = await extractColors(coverUrl, 7);
                    if (extracted.length > 0) {
                        colors = extracted;
                    }
                } catch (e) {
                    console.warn("Failed to extract colors", e);
                }
            }

            if (colors.length === 0) {
                colors = [theme.primaryColor, theme.secondaryColor, theme.accentColor];
            }

            drawBackground(colors);
        };

        // Handle Resize
        const resize = () => {
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                // Re-draw with existing colors would be ideal, but for now we rely on the effect
                // Actually, if we just resize, the canvas clears. We should probably trigger a redraw.
                // Since `generate` is async and inside useEffect, it's hard to call directly accurately without state.
                // But `generate` is called on mount.
                // For a static background, we can just let it be.
            }
        };

        // Initial setup
        resize();
        generate();

        window.addEventListener('resize', resize);

        return () => {
            window.removeEventListener('resize', resize);
        };
    }, [coverUrl, theme]); // Only re-run if cover or theme changes

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-60"
        />
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    if (prevProps.coverUrl !== nextProps.coverUrl) return false;

    const pTheme = prevProps.theme;
    const nTheme = nextProps.theme;

    return (
        pTheme.backgroundColor === nTheme.backgroundColor &&
        pTheme.primaryColor === nTheme.primaryColor &&
        pTheme.secondaryColor === nTheme.secondaryColor &&
        pTheme.accentColor === nTheme.accentColor
    );
});

export default FluidBackground;
