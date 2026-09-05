import type { Texture } from 'pixi.js';
import type { MeasureText } from './latticeLyricLayout';

// src/components/app/lattice/lyrics/latticeLyricRaster.ts
/** One measurement context per runtime; textures are owned by visible pieces and released with them. */
export function createLatticeRaster(pixi: typeof import('pixi.js')) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Lattice text rasterization is unavailable');
    const measure: MeasureText = (text, font) => {
        context.font = font;
        const metrics = context.measureText(text);
        return { width: metrics.width, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent };
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
    return { measure, rasterize };
}
export type LatticeRaster = ReturnType<typeof createLatticeRaster>;
