import type { ScreenQuad } from '../definition';

// src/components/scenes/engine/surfaceSample.ts
// ctx.surfaces.sample: what a surface shows now (the user's lyric style and background, as seen), as a
// small picture. The window is captured by the desktop app (electron/scenes/screenCapture.cjs); the web
// build has no capture and gets null.

interface SceneScreenApi {
    capture(request: { x: number; y: number; width: number; height: number; outWidth: number; outHeight: number }): Promise<Uint8Array | null>;
}

const sceneScreenApi = (): SceneScreenApi | null =>
    (globalThis as { electron?: { sceneScreen?: SceneScreenApi } }).electron?.sceneScreen ?? null;

/** The share of the quad's box left out at each side, so the room round the surface is not in the picture. */
const INSET = 0.08;

/**
 * Captures the quad (in the coordinates of `box`) as a width × height picture; null when it cannot
 * (web build, the surface off the window, a minimised window).
 */
// ponytail: CSS pixels are taken as window pixels, so a page zoom other than 100% samples a shifted rect.
export const sampleSurface = async (box: HTMLElement, quad: ScreenQuad, width: number, height: number): Promise<ImageBitmap | null> => {
    const api = sceneScreenApi();
    if (!api) return null;
    // A surface partly behind the camera is not sampled: the scene keeps the light it had.
    if (quad.some(point => point.w !== undefined && point.w <= 0)) return null;
    const at = box.getBoundingClientRect();
    const xs = quad.map(point => point.x / (point.w ?? 1));
    const ys = quad.map(point => point.y / (point.w ?? 1));
    const inX = (Math.max(...xs) - Math.min(...xs)) * INSET;
    const inY = (Math.max(...ys) - Math.min(...ys)) * INSET;
    const left = Math.max(0, at.left + Math.min(...xs) + inX);
    const top = Math.max(0, at.top + Math.min(...ys) + inY);
    const right = Math.min(window.innerWidth, at.left + Math.max(...xs) - inX);
    const bottom = Math.min(window.innerHeight, at.top + Math.max(...ys) - inY);
    if (right - left < 4 || bottom - top < 4) return null;
    const png = await api.capture({ x: left, y: top, width: right - left, height: bottom - top, outWidth: width, outHeight: height });
    if (!png) return null;
    return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
};
