import * as THREE from 'three';
import { mulberry32 } from './brutHash';

// src/components/visualizer/brut/brutGraffiti.ts
// Spray-stencil marks painted white on transparent, so the material tints them from the theme.
// Three separate textures rather than an atlas: three extra draw calls is cheaper to reason about
// than patching the standard material's shader for a per-instance UV offset.

const SIZE = 256;

const withCanvas = (paint: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d')!;
    paint(context);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
};

/** Speckled overspray plus a few gravity drips, applied over whatever was painted below. */
const addSprayArtifacts = (context: CanvasRenderingContext2D, random: () => number) => {
    context.globalCompositeOperation = 'source-over';
    for (let index = 0; index < 340; index += 1) {
        const alpha = 0.05 + random() * 0.28;
        context.fillStyle = `rgba(255,255,255,${alpha})`;
        context.beginPath();
        context.arc(random() * SIZE, random() * SIZE, 0.4 + random() * 1.6, 0, Math.PI * 2);
        context.fill();
    }
    for (let index = 0; index < 7; index += 1) {
        const x = 40 + random() * (SIZE - 80);
        const y = 90 + random() * 80;
        const length = 20 + random() * 70;
        const gradient = context.createLinearGradient(0, y, 0, y + length);
        gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(x, y, 1.6 + random() * 2.4, length);
    }
};

const paintStencilMark = (context: CanvasRenderingContext2D, text: string, random: () => number) => {
    context.save();
    context.translate(SIZE / 2, SIZE / 2);
    context.rotate((random() - 0.5) * 0.16);
    context.font = `900 ${112 + Math.floor(random() * 22)}px "Arial Black", Impact, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(255,255,255,0.86)';
    context.fillText(text, 0, 0);
    // Stencil bridges: cut horizontal slots through the letterforms.
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000000';
    for (let index = 0; index < 3; index += 1) {
        context.fillRect(-SIZE / 2, -50 + index * 42 + random() * 8, SIZE, 5 + random() * 4);
    }
    context.restore();
    addSprayArtifacts(context, random);
};

const paintTag = (context: CanvasRenderingContext2D, random: () => number) => {
    context.strokeStyle = 'rgba(255,255,255,0.8)';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (let stroke = 0; stroke < 4; stroke += 1) {
        context.lineWidth = 5 + random() * 9;
        context.beginPath();
        context.moveTo(24 + random() * 40, 70 + random() * 120);
        for (let segment = 0; segment < 3; segment += 1) {
            context.bezierCurveTo(
                random() * SIZE, random() * SIZE,
                random() * SIZE, random() * SIZE,
                30 + random() * (SIZE - 60), 50 + random() * (SIZE - 100),
            );
        }
        context.stroke();
    }
    addSprayArtifacts(context, random);
};

const paintArrow = (context: CanvasRenderingContext2D, random: () => number) => {
    context.fillStyle = 'rgba(255,255,255,0.82)';
    context.save();
    context.translate(SIZE / 2, SIZE / 2);
    context.rotate((random() - 0.5) * 0.5);
    context.beginPath();
    context.moveTo(-92, -22);
    context.lineTo(34, -22);
    context.lineTo(34, -58);
    context.lineTo(102, 0);
    context.lineTo(34, 58);
    context.lineTo(34, 22);
    context.lineTo(-92, 22);
    context.closePath();
    context.fill();
    context.restore();
    for (let index = 0; index < 3; index += 1) {
        context.fillRect(20 + index * 34, SIZE - 62, 14, 44);
    }
    addSprayArtifacts(context, random);
};

export interface BrutGraffitiTextures {
    textures: THREE.CanvasTexture[];
    dispose: () => void;
}

export const createBrutGraffitiTextures = (seed: number): BrutGraffitiTextures => {
    const random = mulberry32(seed);
    const marks = ['07', 'B4', 'K9'];
    const textures = [
        withCanvas(context => paintStencilMark(context, marks[Math.floor(random() * marks.length)], random)),
        withCanvas(context => paintTag(context, random)),
        withCanvas(context => paintArrow(context, random)),
    ];

    return {
        textures,
        dispose: () => textures.forEach(texture => texture.dispose()),
    };
};
