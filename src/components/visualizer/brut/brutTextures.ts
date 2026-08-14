import * as THREE from 'three';

// src/components/visualizer/brut/brutTextures.ts
// Builds the procedural concrete grain and browser-shaped lyric masks used by the Brut 3D scene.

const TEXTURE_SIZE = 512;
const LYRIC_TEXTURE_WIDTH = 1536;
const LYRIC_TEXTURE_HEIGHT = 320;

const mulberry32 = (seed: number) => () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

/** Creates a tileable-looking concrete albedo with aggregate, pores, and faint shutter seams. */
export const createBrutConcreteTexture = (seed: number): THREE.CanvasTexture => {
    const random = mulberry32(seed);
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);

    for (let offset = 0; offset < image.data.length; offset += 4) {
        const grain = 116 + Math.floor((random() - 0.5) * 34);
        image.data[offset] = grain;
        image.data[offset + 1] = grain;
        image.data[offset + 2] = grain - 2;
        image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    context.globalAlpha = 0.17;
    for (let index = 0; index < 310; index += 1) {
        const radius = 0.5 + random() * 2.3;
        context.fillStyle = random() > 0.25 ? '#171717' : '#ece9df';
        context.beginPath();
        context.arc(random() * TEXTURE_SIZE, random() * TEXTURE_SIZE, radius, 0, Math.PI * 2);
        context.fill();
    }

    context.globalAlpha = 0.2;
    context.strokeStyle = '#252525';
    context.lineWidth = 1;
    [0.34, 0.68].forEach(position => {
        context.beginPath();
        context.moveTo(0, TEXTURE_SIZE * position);
        context.lineTo(TEXTURE_SIZE, TEXTURE_SIZE * position);
        context.stroke();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 2.4);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
};

/** Produces one reusable blurred contact-shadow decal for facade relief and sign mounting frames. */
export const createBrutSoftShadowTexture = (): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.shadowColor = 'rgba(0,0,0,0.82)';
    context.shadowBlur = 22;
    context.fillStyle = 'rgba(0,0,0,0.46)';
    context.fillRect(29, 29, 70, 70);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
};

export interface BrutLyricRaster {
    texture: THREE.CanvasTexture;
    aspect: number;
}

/** Rasterises one complete lyric line into an alpha-tested sign face with full browser font fallback. */
export const createBrutLyricTexture = (
    text: string,
    fontFamily: string,
    fontWeight: number,
): BrutLyricRaster => {
    const canvas = document.createElement('canvas');
    canvas.width = LYRIC_TEXTURE_WIDTH;
    canvas.height = LYRIC_TEXTURE_HEIGHT;
    const context = canvas.getContext('2d')!;
    const fontSize = 154;
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const measuredWidth = Math.max(1, context.measureText(text).width);
    const contentWidth = Math.min(LYRIC_TEXTURE_WIDTH - 80, measuredWidth);
    const scale = Math.min(1, contentWidth / measuredWidth);

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.scale(scale, scale);
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(255,255,255,0.98)';
    context.fillStyle = '#ffffff';
    context.lineWidth = 3;
    context.strokeText(text, 0, 4);
    context.fillText(text, 0, 4);
    context.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const aspect = Math.min(6.2, Math.max(1.2, (measuredWidth / fontSize) * 0.98));
    return { texture, aspect };
};
