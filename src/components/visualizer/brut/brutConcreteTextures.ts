import * as THREE from 'three';
import { blurBrutHeightField, createBrutHeightField, type BrutHeightField } from './brutHeightField';
import { mulberry32 } from './brutHash';

// src/components/visualizer/brut/brutConcreteTextures.ts
// Albedo (with baked AO, water staining, rust and efflorescence), roughness and a Sobel-derived
// normal map, all from one height field so every cue lines up with the same pores and tie holes.
//
// Orientation: CanvasTexture defaults to flipY = true (canvas row 0 sits at v = 1), while
// DataTexture does not flip. The normal map is therefore written in REVERSED row order, and its
// green channel takes +d(height)/d(row) rather than -, so it registers with the canvas maps.
// The normal map must also stay in NoColorSpace - an sRGB normal map is the classic "the lighting
// is subtly wrong everywhere" bug.

const TEXTURE_SIZE = 512;
const NORMAL_STRENGTH = 2.6;

export interface BrutConcreteTextures {
    map: THREE.CanvasTexture;
    normalMap: THREE.DataTexture;
    roughnessMap: THREE.CanvasTexture;
    dispose: () => void;
}

const paintAlbedo = (field: BrutHeightField, occlusion: Float32Array, random: () => number): HTMLCanvasElement => {
    const { size, values, tieHoles, seams } = field;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(size, size);

    for (let index = 0; index < values.length; index += 1) {
        const shade = 1 + values[index] * 0.16;
        const ambient = Math.max(0.5, Math.min(1.18, 1 + (values[index] - occlusion[index]) * 0.55));
        const level = Math.max(0, Math.min(255, 152 * shade * ambient));
        image.data[index * 4] = level;
        image.data[index * 4 + 1] = level;
        image.data[index * 4 + 2] = level * 0.985;
        image.data[index * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    // Water staining runs downward from the tie holes and from under every board seam.
    context.globalCompositeOperation = 'source-over';
    const drawStain = (x: number, y: number, width: number, height: number, alpha: number, color: string) => {
        const gradient = context.createLinearGradient(0, y, 0, y + height);
        gradient.addColorStop(0, color.replace('$A', String(alpha)));
        gradient.addColorStop(1, color.replace('$A', '0'));
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(x - width * 0.35, y);
        context.lineTo(x + width * 0.35, y);
        context.lineTo(x + width * 0.8, y + height);
        context.lineTo(x - width * 0.8, y + height);
        context.closePath();
        context.fill();
    };

    tieHoles.forEach((hole) => {
        drawStain(hole.x, hole.y, 12 + random() * 10, 90 + random() * 120, 0.09 + random() * 0.05, 'rgba(0,0,0,$A)');
        // Rust originates only where a steel tie rod actually is - that physical motive is what
        // makes the streak read as a photograph rather than as decoration.
        drawStain(hole.x + (random() - 0.5) * 4, hole.y + hole.radius, 5 + random() * 5, 60 + random() * 90, 0.12 + random() * 0.1, 'rgba(122,68,28,$A)');
    });

    seams.forEach((seamY) => {
        for (let index = 0; index < 2; index += 1) {
            drawStain(random() * size, seamY + 5, 26 + random() * 40, 70 + random() * 110, 0.05 + random() * 0.04, 'rgba(0,0,0,$A)');
        }
        if (random() > 0.45) {
            context.filter = 'blur(6px)';
            drawStain(random() * size, seamY + 4, 40 + random() * 50, 50 + random() * 70, 0.16, 'rgba(238,236,226,$A)');
            context.filter = 'none';
        }
    });

    return canvas;
};

const paintRoughness = (field: BrutHeightField, random: () => number): HTMLCanvasElement => {
    const { size, values, tieHoles } = field;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(size, size);

    for (let index = 0; index < values.length; index += 1) {
        const level = Math.max(0, Math.min(255, 240 + values[index] * 12));
        image.data[index * 4] = level;
        image.data[index * 4 + 1] = level;
        image.data[index * 4 + 2] = level;
        image.data[index * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    // Wet-looking stains are smoother than the surrounding concrete.
    context.globalCompositeOperation = 'multiply';
    tieHoles.forEach((hole) => {
        const gradient = context.createLinearGradient(0, hole.y, 0, hole.y + 140);
        gradient.addColorStop(0, 'rgba(150,150,150,0.55)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(hole.x - 14, hole.y, 28 + random() * 12, 150);
    });
    context.globalCompositeOperation = 'source-over';

    return canvas;
};

const buildNormalTexture = (field: BrutHeightField): THREE.DataTexture => {
    const { size, values } = field;
    const data = new Uint8Array(size * size * 4);
    const wrap = (value: number) => ((value % size) + size) % size;

    for (let row = 0; row < size; row += 1) {
        const target = size - 1 - row;
        for (let column = 0; column < size; column += 1) {
            const dx = values[row * size + wrap(column + 1)] - values[row * size + wrap(column - 1)];
            const dRow = values[wrap(row + 1) * size + column] - values[wrap(row - 1) * size + column];
            const nx = -dx * NORMAL_STRENGTH;
            const ny = dRow * NORMAL_STRENGTH;
            const length = Math.hypot(nx, ny, 1);
            const offset = (target * size + column) * 4;
            data[offset] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
            data[offset + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
            data[offset + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
            data[offset + 3] = 255;
        }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
};

/** Builds the one shared concrete texture set. Clone it per surface to vary the tiling. */
export const createBrutConcreteTextures = (seed: number): BrutConcreteTextures => {
    const field = createBrutHeightField(TEXTURE_SIZE, seed);
    const occlusion = blurBrutHeightField(field, 6);
    const random = mulberry32(seed + 977);

    const map = new THREE.CanvasTexture(paintAlbedo(field, occlusion, random));
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;

    const roughnessMap = new THREE.CanvasTexture(paintRoughness(field, random));
    roughnessMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;

    const normalMap = buildNormalTexture(field);

    return {
        map,
        normalMap,
        roughnessMap,
        dispose: () => {
            map.dispose();
            normalMap.dispose();
            roughnessMap.dispose();
        },
    };
};

/**
 * A clone shares the GPU upload (three r151+ shares Texture.source) and only carries its own
 * sampler state, so per-surface tiling costs a JS object rather than another texture.
 */
export const cloneBrutConcreteTextures = (
    source: BrutConcreteTextures,
    repeatU: number,
    repeatV: number,
): BrutConcreteTextures => {
    const map = source.map.clone();
    const normalMap = source.normalMap.clone();
    const roughnessMap = source.roughnessMap.clone();
    [map, normalMap, roughnessMap].forEach((texture) => {
        texture.repeat.set(repeatU, repeatV);
        texture.needsUpdate = true;
    });

    return {
        map,
        normalMap,
        roughnessMap,
        dispose: () => {
            map.dispose();
            normalMap.dispose();
            roughnessMap.dispose();
        },
    };
};
