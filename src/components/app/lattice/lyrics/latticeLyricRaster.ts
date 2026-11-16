import type { Texture } from 'pixi.js';
import type { MeasureText } from './latticeLyricLayout';

// src/components/app/lattice/lyrics/latticeLyricRaster.ts
// Typography probing bisects the font sizes and token wrapping measures every grapheme prefix, so one
// layout asks for the same (text, font) pair many times over. Bounded, shared by every runtime, and
// dropped whenever a web font finishes loading.
const MEASURE_CACHE_LIMIT = 4096;

// The measurement context and its cache outlive any one runtime: a lyric scene is torn down and built
// again whenever its card stops showing lyrics (the radio wall does so on every song switch, browse and
// drag), and a fresh cache paid the whole typography probe and every line's wrapping again each time.
// Any 2D context measures alike, so all runtimes share one. A web font that finishes loading makes every
// measurement taken before it stale (they fell back to another face), so the cache listens to the document
// itself: a runtime's fontsEpoch (useFontsEpoch) counts from 0 per mount and misses a font that landed while
// no lyric scene was up.
let sharedContext: CanvasRenderingContext2D | null = null;
// Keyed font first so no separator has to be reserved out of the measured text.
const measurements = new Map<string, Map<string, { width: number; height: number }>>();
let measured = 0;
const clearMeasureCache = () => { measurements.clear(); measured = 0; };
let watchingFonts = false;

/** One shared measurement context; textures are owned by visible pieces and released with them. */
export function createLatticeRaster(pixi: typeof import('pixi.js')) {
    sharedContext ??= document.createElement('canvas').getContext('2d');
    const context = sharedContext;
    if (!context) throw new Error('Lattice text rasterization is unavailable');
    if (!watchingFonts) {
        watchingFonts = true;
        // Lives as long as the cache does (the page): one listener, never removed.
        document.fonts.addEventListener('loadingdone', clearMeasureCache);
    }
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
    /**
     * `resolution` is device pixels per CSS pixel of the surface; the texture reports CSS-pixel size.
     * `rtl` paints with an RTL base direction, so a word's trailing space lands on its left and the
     * first letter sits at the raster's right edge, where the mirrored sweep starts.
     */
    const rasterize = (text: string, font: string, fontPx: number, resolution: number, rtl = false): { texture: Texture; width: number; height: number; pad: number } => {
        context.font = font;
        const metrics = context.measureText(text);
        const pad = Math.ceil(Math.max(fontPx * 0.5, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight - metrics.width, 2));
        const width = Math.max(1, Math.ceil(metrics.width + pad * 2));
        const ascent = Math.max(fontPx, metrics.actualBoundingBoxAscent);
        const height = Math.ceil(ascent + Math.max(fontPx * 0.3, metrics.actualBoundingBoxDescent) + pad * 2);
        const surface = document.createElement('canvas');
        surface.width = Math.ceil(width * resolution); surface.height = Math.ceil(height * resolution);
        const paint = surface.getContext('2d');
        if (!paint) throw new Error('Lattice text texture is unavailable');
        paint.scale(resolution, resolution); paint.font = font; paint.fillStyle = '#ffffff';
        if (rtl) { paint.direction = 'rtl'; paint.textAlign = 'left'; }
        paint.fillText(text, pad, pad + ascent);
        // Construct at resolution 1 and set the real one afterwards. Given `resolution` up front,
        // CanvasSource derives width = canvas.width / resolution, TextureSource multiplies it back,
        // and resizeCanvas() compares that float with the integer canvas size using `!==`: for any
        // resolution whose round trip is inexact (0.76, 1.14, 1.52, 1.75...) it reassigns
        // canvas.width, which wipes the glyph just painted. The setter only rescales width/height.
        // Keep the explicit 1: omitted, the derivation divides by undefined and only works because
        // TextureSource treats the resulting NaN as "no width given".
        const source = new pixi.CanvasSource({ resource: surface, resolution: 1 });
        source.resolution = resolution;
        return { texture: new pixi.Texture({ source }), width, height, pad };
    };
    return { measure, rasterize, clearMeasureCache };
}
export type LatticeRaster = ReturnType<typeof createLatticeRaster>;
