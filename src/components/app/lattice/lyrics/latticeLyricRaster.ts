import type { Texture } from 'pixi.js';
import type { MeasureText } from './latticeLyricLayout';

// src/components/app/lattice/lyrics/latticeLyricRaster.ts
// Typography probing walks 40 font sizes and token wrapping measures every grapheme prefix, so one
// layout asks for the same (text, font) pair many times over. Bounded, and dropped on a font epoch.
const MEASURE_CACHE_LIMIT = 4096;

/** One measurement context per runtime; textures are owned by visible pieces and released with them. */
export function createLatticeRaster(pixi: typeof import('pixi.js')) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Lattice text rasterization is unavailable');
    // Keyed font first so no separator has to be reserved out of the measured text.
    const measurements = new Map<string, Map<string, { width: number; height: number }>>();
    let measured = 0;
    const clearMeasureCache = () => { measurements.clear(); measured = 0; };
    const measure: MeasureText = (text, font) => {
        let byText = measurements.get(font);
        const cached = byText?.get(text);
        if (cached) return cached;
        context.font = font;
        const metrics = context.measureText(text);
        const size = { width: metrics.width, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent };
        if (measured >= MEASURE_CACHE_LIMIT) { clearMeasureCache(); byText = undefined; }
        if (!byText) { byText = new Map(); measurements.set(font, byText); }
        byText.set(text, size);
        measured++;
        return size;
    };
    const rasterize = (text: string, font: string, fontPx: number): { texture: Texture; width: number; height: number; pad: number } => {
        context.font = font;
        const metrics = context.measureText(text);
        const pad = Math.ceil(Math.max(fontPx * 0.5, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight - metrics.width, 2));
        const width = Math.max(1, Math.ceil(metrics.width + pad * 2));
        const ascent = Math.max(fontPx, metrics.actualBoundingBoxAscent);
        const height = Math.ceil(ascent + Math.max(fontPx * 0.3, metrics.actualBoundingBoxDescent) + pad * 2);
        const surface = document.createElement('canvas');
        surface.width = width * 2; surface.height = height * 2;
        const paint = surface.getContext('2d');
        if (!paint) throw new Error('Lattice text texture is unavailable');
        paint.scale(2, 2); paint.font = font; paint.fillStyle = '#ffffff';
        paint.fillText(text, pad, pad + ascent);
        return { texture: new pixi.Texture({ source: new pixi.CanvasSource({ resource: surface, resolution: 2 }) }), width, height, pad };
    };
    return { measure, rasterize, clearMeasureCache };
}
export type LatticeRaster = ReturnType<typeof createLatticeRaster>;
