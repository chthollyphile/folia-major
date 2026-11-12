import * as THREE from 'three';

// src/components/scenes/cinema/cinemaReel.ts
// A reel: what the projector shows (the song's cover as a texture) and the light it throws into the
// hall, as the average colours of the cover's left, middle and right thirds (linear).

export interface CinemaReel {
    texture: THREE.Texture;
    /** Width over height of the picture. */
    aspect: number;
    colors: [THREE.Color, THREE.Color, THREE.Color];
}

const SAMPLE_WIDTH = 24;
const SAMPLE_HEIGHT = 8;

/** Lifts the saturation a little and keeps very dark covers from going out entirely. */
const asLight = (r: number, g: number, b: number) => {
    const color = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    const vivid = (channel: number) => Math.max(0, luminance + (channel - luminance) * 1.3);
    color.setRGB(vivid(color.r), vivid(color.g), vivid(color.b));
    if (luminance < 0.05) color.multiplyScalar(Math.sqrt(0.05 / Math.max(luminance, 0.004)));
    return color;
};

/** The light a picture throws, as the average colours of its left, middle and right thirds (linear); null when it cannot be read. */
export const thirdColors = (source: CanvasImageSource): CinemaReel['colors'] | null => {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    let pixels: Uint8ClampedArray;
    try {
        pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    } catch (error) {
        // A cover from another origin without CORS headers taints the canvas; it still shows, only grey light.
        console.warn('[Cinema] Cannot read the cover colours, lighting the hall in grey', error);
        return null;
    }
    const third = SAMPLE_WIDTH / 3;
    const sums = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
        for (let x = 0; x < SAMPLE_WIDTH; x += 1) {
            const index = (y * SAMPLE_WIDTH + x) * 4;
            const sum = sums[Math.min(2, Math.floor(x / third))];
            sum[0] += pixels[index];
            sum[1] += pixels[index + 1];
            sum[2] += pixels[index + 2];
        }
    }
    const count = third * SAMPLE_HEIGHT;
    const [left, middle, right] = sums.map(([r, g, b]) => asLight(r / count, g / count, b / count));
    return [left, middle, right];
};

const greyColors = (): CinemaReel['colors'] => [asLight(120, 116, 110), asLight(128, 124, 118), asLight(120, 116, 110)];

const configure = (texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
};

/** The leader: what the screen shows with no cover, a soft warm light with nothing on the film. */
export const createLeaderReel = (): CinemaReel => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
        const gradient = context.createRadialGradient(32, 30, 4, 32, 32, 46);
        gradient.addColorStop(0, '#8a8478');
        gradient.addColorStop(1, '#4a4640');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
    }
    return { texture: configure(new THREE.CanvasTexture(canvas)), aspect: 1, colors: greyColors() };
};

/** Loads a cover as a reel; null when it cannot be loaded. */
export const loadCinemaReel = (url: string): Promise<CinemaReel | null> => new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
        const aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
        resolve({ texture: configure(new THREE.Texture(image)), aspect, colors: thirdColors(image) ?? greyColors() });
    };
    image.onerror = () => {
        console.warn('[Cinema] Cover failed to load; the screen keeps its current reel');
        resolve(null);
    };
    image.src = url;
});
