import React, { useEffect, useRef, useState } from 'react';
import type { NomandBackgroundTuning, Theme } from '../../../../types';
import { parseColorChannels } from '../../../../utils/colorMix';
import { useFirstFrameDrawn } from '../../styleTransition/firstFrame';
import { createAsciiRenderer, type AsciiPalette, type AsciiRenderer } from './ascii/asciiRenderer';
import { deriveAsciiImageMapsFromImage } from './ascii/asciiImageMaps';
import { resolveDaylightInversion } from './nomandShaderAdjustments';

// src/components/visualizer/backgrounds/nomand/NomandAsciiLayer.tsx
// The Nomand ASCII effect's layer: loads the picture, reads its maps once, and draws the glyphs
// into a canvas one canvas pixel per glyph pixel, scaled up by whole device pixels without
// smoothing. The sway runs in its own loop at 30 fps (the line characters turn in 45° steps,
// so more frames show nothing new), stops while the background is paused, and draws one
// still frame in static mode or with the sway at 0. Nothing per frame goes through React.

/** One sway loop, in seconds: every moving term repeats a whole number of times in it. */
const LOOP_SECONDS = 12;
const FRAME_MS = 1000 / 30;

interface NomandAsciiLayerProps {
    sourceUrl: string;
    tuning: NomandBackgroundTuning;
    theme: Theme;
    isDaylight?: boolean;
    paused?: boolean;
    staticMode?: boolean;
}

const channels = (color: string, fallback: [number, number, number]): [number, number, number] => {
    const parsed = parseColorChannels(color);
    return parsed ? [parsed.r / 255, parsed.g / 255, parsed.b / 255] : fallback;
};

const paletteOf = (theme: Theme): AsciiPalette => ({
    back: channels(theme.backgroundColor, [0, 0, 0]),
    front: channels(theme.accentColor, [1, 1, 1]),
    highlight: channels(theme.primaryColor, [1, 1, 1]),
});

const NomandAsciiLayer: React.FC<NomandAsciiLayerProps> = ({
    sourceUrl,
    tuning,
    theme,
    isDaylight,
    paused = false,
    staticMode = false,
}) => {
    const drawn = useFirstFrameDrawn();
    const boxRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<AsciiRenderer | null>(null);
    const phaseRef = useRef(0);
    const [ready, setReady] = useState(false);
    // A lost context comes back on a new canvas: the key remounts it and everything built on it.
    const [generation, setGeneration] = useState(0);

    const motion = staticMode ? 0 : tuning.asciiMotion;
    const frameRef = useRef({
        motion,
        themeColors: !tuning.asciiOriginalColors,
        invert: resolveDaylightInversion(tuning.asciiInverted, tuning.asciiOriginalColors, isDaylight),
        palette: paletteOf(theme),
        scale: tuning.asciiScale,
    });
    frameRef.current = {
        motion,
        themeColors: !tuning.asciiOriginalColors,
        invert: resolveDaylightInversion(tuning.asciiInverted, tuning.asciiOriginalColors, isDaylight),
        palette: paletteOf(theme),
        scale: tuning.asciiScale,
    };

    /** Draws one frame at the held phase, with the latest settings. */
    const drawNow = useRef(() => {
        const frame = frameRef.current;
        rendererRef.current?.draw({ ...frame, t: phaseRef.current });
    }).current;

    /** Fits the canvas to the box in whole device pixels per glyph pixel, and redraws. */
    const fit = useRef(() => {
        const box = boxRef.current;
        const canvas = canvasRef.current;
        const renderer = rendererRef.current;
        if (!box || !canvas || !renderer) return;
        const dpr = window.devicePixelRatio || 1;
        const devicePerGlyph = Math.max(1, Math.round(frameRef.current.scale * dpr));
        const width = Math.ceil((box.clientWidth * dpr) / devicePerGlyph);
        const height = Math.ceil((box.clientHeight * dpr) / devicePerGlyph);
        if (width < 1 || height < 1) return;
        canvas.style.width = `${(width * devicePerGlyph) / dpr}px`;
        canvas.style.height = `${(height * devicePerGlyph) / dpr}px`;
        if (canvas.width !== width || canvas.height !== height) renderer.resize(width, height);
        drawNow();
    }).current;

    // The renderer lives as long as its canvas.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        let renderer: AsciiRenderer | null = null;
        try {
            renderer = createAsciiRenderer(canvas);
        } catch (error) {
            console.warn('[nomand-ascii] renderer failed', error);
        }
        if (!renderer) {
            drawn();
            return undefined;
        }
        rendererRef.current = renderer;
        const onLost = (event: Event) => {
            event.preventDefault();
            setReady(false);
        };
        const onRestored = () => setGeneration(value => value + 1);
        canvas.addEventListener('webglcontextlost', onLost);
        canvas.addEventListener('webglcontextrestored', onRestored);
        const observer = new ResizeObserver(() => fit());
        if (boxRef.current) observer.observe(boxRef.current);
        fit();
        return () => {
            observer.disconnect();
            canvas.removeEventListener('webglcontextlost', onLost);
            canvas.removeEventListener('webglcontextrestored', onRestored);
            rendererRef.current = null;
            renderer.dispose();
        };
    }, [generation, drawn, fit]);

    // The picture: loaded across origins so its pixels can be read, then analysed once.
    useEffect(() => {
        let cancelled = false;
        setReady(false);
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.onload = () => {
            if (cancelled) return;
            const renderer = rendererRef.current;
            if (!renderer) {
                drawn();
                return;
            }
            try {
                renderer.setImage(image, deriveAsciiImageMapsFromImage(image));
            } catch (error) {
                console.warn('[nomand-ascii] picture unreadable', error);
                drawn();
                return;
            }
            fit();
            setReady(true);
            drawn();
        };
        image.onerror = () => {
            if (!cancelled) drawn();
        };
        image.src = sourceUrl;
        return () => {
            cancelled = true;
            image.onload = null;
            image.onerror = null;
        };
    }, [sourceUrl, generation, drawn, fit]);

    // A new glyph size refits the canvas; any other change draws once (the loop draws it anyway).
    useEffect(() => {
        fit();
    }, [tuning.asciiScale, fit]);
    useEffect(() => {
        drawNow();
    });

    // The sway loop.
    useEffect(() => {
        if (!ready || paused || motion <= 0) return undefined;
        let frame = 0;
        let last = 0;
        const start = performance.now() - phaseRef.current * LOOP_SECONDS * 1000;
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            if (now - last < FRAME_MS - 2) return;
            last = now;
            phaseRef.current = (((now - start) / 1000) / LOOP_SECONDS) % 1;
            drawNow();
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [ready, paused, motion, drawNow]);

    return (
        <div
            ref={boxRef}
            className="absolute inset-0 overflow-hidden"
            style={{ backgroundColor: theme.backgroundColor }}
        >
            <canvas
                key={generation}
                ref={canvasRef}
                className="absolute left-0 top-0"
                style={{ imageRendering: 'pixelated', opacity: ready ? 1 : 0 }}
            />
        </div>
    );
};

export default NomandAsciiLayer;
