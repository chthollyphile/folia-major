import * as THREE from 'three';

// src/components/visualizer/brut/brutTextures.ts
// Small shared gradient sprites: contact-shadow decals, the falloff on the fake light cones, the
// dust mote and the shaft-mouth flare. The concrete maps live in brutConcreteTextures.ts and the
// lyric rasters in brutLyricRaster.ts.

/** One reusable blurred contact-shadow decal for facade relief and mounting frames. */
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

/** Soft round sprite used for dust motes and the mouth flare. */
export const createBrutRadialSpriteTexture = (softness = 0.55): THREE.CanvasTexture => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(softness, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
};

/**
 * Falloff for the fake volumetric cones: bright at the top where the light enters, transparent at
 * the rim so the cone has no visible silhouette edge.
 */
export const createBrutBeamFalloffTexture = (): THREE.CanvasTexture => {
    const width = 64;
    const height = 128;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;

    const vertical = context.createLinearGradient(0, 0, 0, height);
    vertical.addColorStop(0, 'rgba(255,255,255,0.92)');
    vertical.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    vertical.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = vertical;
    context.fillRect(0, 0, width, height);

    const horizontal = context.createLinearGradient(0, 0, width, 0);
    horizontal.addColorStop(0, 'rgba(0,0,0,1)');
    horizontal.addColorStop(0.5, 'rgba(0,0,0,0)');
    horizontal.addColorStop(1, 'rgba(0,0,0,1)');
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = horizontal;
    context.fillRect(0, 0, width, height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
};
