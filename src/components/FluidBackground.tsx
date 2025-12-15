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

            // Fill background with the first color or a dark base
            ctx.fillStyle = colors[0] || theme.backgroundColor;
            ctx.fillRect(0, 0, width, height);

            // Create a seeded-like randomness for consistent blob positions per re-render (if any)
            // But since this is a static draw based on input, we can just use fixed random-ish math.
            const seed = 12345;
            const seededRandom = (offset: number) => {
                const x = Math.sin(seed + offset * 12345) * 10000;
                return x - Math.floor(x);
            };

            // Draw blobs
            // We'll draw slightly fewer, larger blobs for that "fluid" look
            const blobCount = 5;

            colors.slice(0, 5).forEach((color, i) => {
                // Generate random position and size
                const cx = seededRandom(i * 7) * width;
                const cy = seededRandom(i * 11) * height;
                const maxDim = Math.max(width, height);
                const radius = (0.4 + seededRandom(i * 3) * 0.4) * maxDim; // 40-80% of screen size

                // Create radial gradient
                // radial-gradient(circle, color 0%, transparent 70%)
                const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

                // Parse color to add alpha for blending if it's not already rgba? 
                // Assuming colors are usually hex or rgb.
                // We'll let canvas handle color string, but we want opacity fade.
                // To do that nicely in canvas with strings, we rely on globalCompositeOperation or just transparent colors.
                // A simple trick: set globalAlpha.

                ctx.globalAlpha = 0.6; // Base opacity for blobs
                gradient.addColorStop(0, color);
                gradient.addColorStop(0.7, 'transparent'); // Fades out
                gradient.addColorStop(1, 'transparent');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            });

            // Reset alpha
            ctx.globalAlpha = 1.0;
        };

        const generate = async () => {
            let colors: string[] = [];
            if (coverUrl) {
                try {
                    const extracted = await extractColors(coverUrl, 5);
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
            // Use a lower internal resolution for performance + natural blurriness?
            // Or full resolution? let's stick to client sizes but maybe cap it if massive.
            // Actually, for a background, 1/2 resolution is often fine and performs better.
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                // Re-draw immediately if possible, or trigger effect?
                // The easiest way is to let the effect run, but loop dependency is tricky.
                // We'll just set dimensions here and let the generate() calls handle drawing.
            }
        };

        // Initial setup
        resize();
        generate();

        // Optional: window resize listener
        // Since it's a "static" background generated at start, maybe we don't care about live resizing too much?
        // But if window resizes, we might just stretch.
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
    // Returns true if props are equal (do NOT re-render)
    // Returns false if props are different (DO re-render)

    // Check if theme reference changed (deep check might be overkill but theme object ref usually changes)
    const themeChanged = prevProps.theme !== nextProps.theme;

    // Check if coverUrl changed
    const coverChanged = prevProps.coverUrl !== nextProps.coverUrl;

    // We only want to re-render (return false) if these actually changed.
    return !themeChanged && !coverChanged;
});

export default FluidBackground;
