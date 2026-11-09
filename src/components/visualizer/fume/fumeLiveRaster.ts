import type { FumeBlock } from './fumeTypes';
import type { FumeBlockTiming } from './fumeBlockFrame';
import { drawFumeLiveBlock, type FumeLiveBlockParams } from './fumeCanvasText';

// src/components/visualizer/fume/fumeLiveRaster.ts
// Draws a printing block for Lab > Fix lyric animation freeze on Linux without asking Chromium's glyph
// cache for a new size every frame.
//
// Drawn straight onto the stage under the camera transform, the live block's text is rasterized at a
// device scale that changes continuously while the camera floats and zooms, and fume leaked ~0.06
// fd/s that way on Linux even with the glow filters on (docs/linux-glyph-cache-fd-leak.md). So the
// block is drawn by the same code (drawFumeLiveBlock) into its own canvas at the raster level just
// above the current device scale, and that canvas is drawn onto the stage shrunk by the rest - under
// 1.5%, with the camera itself still continuous. Only the part of the block on screen is drawn, so a
// live canvas never exceeds the viewport; it only ever grows, in LIVE_CANVAS_GRANULE steps.

const LIVE_IDLE_MS = 5_000;
/** Canvas capacity grows in steps of this many device pixels, so a zoom does not reallocate every frame. */
const LIVE_CANVAS_GRANULE = 256;
/** Raster levels per octave: the text is shrunk by at most 2^(1/48), 1.5%. */
const LIVE_RASTER_LEVELS_PER_OCTAVE = 48;

/** The smallest raster level at or above `scale`. */
export const resolveLiveRasterScale = (scale: number) => (
    2 ** (Math.ceil(Math.log2(Math.max(scale, 1e-3)) * LIVE_RASTER_LEVELS_PER_OCTAVE - 1e-9) / LIVE_RASTER_LEVELS_PER_OCTAVE)
);

interface LiveCanvas {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    lastUsed: number;
    /** Device-pixel extent drawn last time, cleared before the next draw. */
    usedWidth: number;
    usedHeight: number;
}

export interface FumeLiveRasterFrame {
    /** Device pixels per world unit on the stage this frame (camera scale times the stage's pixel ratio: devicePixelRatio × 分辨率倍数). */
    deviceScale: number;
    /** The world rect on screen this frame. */
    visible: { left: number; top: number; right: number; bottom: number };
}

/** What to draw onto the stage: `canvas`'s (0, 0, width, height) at world rect (x, y, worldWidth, worldHeight). */
export interface FumeLiveRasterImage {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    x: number;
    y: number;
    worldWidth: number;
    worldHeight: number;
}

export class FumeLiveRaster {
    private readonly canvases = new Map<string, LiveCanvas>();

    draw(
        block: FumeBlock,
        timing: FumeBlockTiming,
        params: FumeLiveBlockParams,
        { deviceScale, visible }: FumeLiveRasterFrame,
        now: number,
    ): FumeLiveRasterImage | null {
        // Texels per world unit.
        const scale = resolveLiveRasterScale(deviceScale);
        // Room around the block for glows (their blur is in device pixels) and the print stamps, which
        // drop in from above the line.
        const glowReach = (12 + block.fontPx * 0.7) * Math.max(params.glowIntensity, 1) * 1.5;
        const pad = Math.ceil(block.lineHeight * 0.5 + glowReach / Math.max(scale, 0.01));
        const left = Math.max(block.x - pad, visible.left);
        const top = Math.max(block.y - pad, visible.top);
        const right = Math.min(block.x + block.width + pad, visible.right);
        const bottom = Math.min(block.y + block.height + pad, visible.bottom);
        if (right <= left || bottom <= top) return null;
        const width = Math.max(1, Math.ceil((right - left) * scale));
        const height = Math.max(1, Math.ceil((bottom - top) * scale));

        const live = this.ensure(block.id, width, height);
        const { context } = live;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, Math.max(live.usedWidth, width), Math.max(live.usedHeight, height));
        context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
        drawFumeLiveBlock(context, block, timing, params);
        live.usedWidth = width;
        live.usedHeight = height;
        live.lastUsed = now;

        return { canvas: live.canvas, width, height, x: left, y: top, worldWidth: width / scale, worldHeight: height / scale };
    }

    private ensure(id: string, width: number, height: number) {
        const current = this.canvases.get(id);
        if (current && current.canvas.width >= width && current.canvas.height >= height) return current;

        const canvas = current?.canvas ?? document.createElement('canvas');
        canvas.width = Math.ceil(Math.max(width, current?.canvas.width ?? 0) / LIVE_CANVAS_GRANULE) * LIVE_CANVAS_GRANULE;
        canvas.height = Math.ceil(Math.max(height, current?.canvas.height ?? 0) / LIVE_CANVAS_GRANULE) * LIVE_CANVAS_GRANULE;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Fume live text canvas is unavailable');
        const live = { canvas, context, lastUsed: 0, usedWidth: 0, usedHeight: 0 };
        this.canvases.set(id, live);
        return live;
    }

    /** Releases canvases of blocks that have not been live for a while. */
    sweep(now: number) {
        for (const [id, live] of this.canvases) {
            if (now - live.lastUsed <= LIVE_IDLE_MS) continue;
            live.canvas.width = 0;
            live.canvas.height = 0;
            this.canvases.delete(id);
        }
    }

    clear() {
        this.sweep(Number.POSITIVE_INFINITY);
    }
}
