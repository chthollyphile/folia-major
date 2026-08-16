import * as THREE from 'three';
import {
    BRUT_FACE_COUNT,
    BRUT_SHAFT_HALF,
    BRUT_SHELL_HEIGHT,
    BRUT_SHELL_ROWS,
    BRUT_SHELL_TILE_U,
    BRUT_SHELL_TILE_V,
} from './brutConstants';
import { resolveBrutDepthBrightness } from './brutDepthGradient';
import { resolveBrutFaceAngle } from './brutFaceBasis';

// src/components/visualizer/brut/brutShellGeometry.ts
// The whole infinite shaft is ONE mesh: four inward-facing walls, each subdivided vertically so a
// per-vertex brightness ramp can carry the depth gradient (bright toward the mouth, black downward)
// without any shader patching. The mesh is snapped by exactly one module height as the camera
// ascends, which is why BRUT_SHELL_TILE_V must divide BRUT_MODULE_HEIGHT into whole tiles.

const ROW_COUNT = BRUT_SHELL_ROWS + 1;
const VERTS_PER_FACE = ROW_COUNT * 2;

/** Builds the four-wall shell with position/normal/uv/color attributes. Caller owns disposal. */
export const createBrutShellGeometry = (): THREE.BufferGeometry => {
    const vertexCount = VERTS_PER_FACE * BRUT_FACE_COUNT;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3).fill(1);
    const indices = new Uint16Array(BRUT_SHELL_ROWS * 6 * BRUT_FACE_COUNT);

    let indexCursor = 0;
    for (let face = 0; face < BRUT_FACE_COUNT; face += 1) {
        const angle = resolveBrutFaceAngle(face);
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const faceOffset = face * VERTS_PER_FACE;

        for (let row = 0; row < ROW_COUNT; row += 1) {
            const height = (row / BRUT_SHELL_ROWS) * BRUT_SHELL_HEIGHT;
            for (let column = 0; column < 2; column += 1) {
                const lateral = column === 0 ? -BRUT_SHAFT_HALF : BRUT_SHAFT_HALF;
                const vertex = faceOffset + row * 2 + column;
                positions[vertex * 3] = -sin * BRUT_SHAFT_HALF + cos * lateral;
                positions[vertex * 3 + 1] = height;
                positions[vertex * 3 + 2] = -cos * BRUT_SHAFT_HALF - sin * lateral;
                normals[vertex * 3] = sin;
                normals[vertex * 3 + 1] = 0;
                normals[vertex * 3 + 2] = cos;
                uvs[vertex * 2] = (lateral + BRUT_SHAFT_HALF) / BRUT_SHELL_TILE_U;
                uvs[vertex * 2 + 1] = height / BRUT_SHELL_TILE_V;
            }
        }

        for (let row = 0; row < BRUT_SHELL_ROWS; row += 1) {
            const a = faceOffset + row * 2;
            const b = a + 1;
            const c = a + 3;
            const d = a + 2;
            indices[indexCursor] = a;
            indices[indexCursor + 1] = b;
            indices[indexCursor + 2] = c;
            indices[indexCursor + 3] = a;
            indices[indexCursor + 4] = c;
            indices[indexCursor + 5] = d;
            indexCursor += 6;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colorAttribute);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
};

/**
 * Rewrites the shell's brightness ramp relative to the camera. 200 vertices, so this is cheap
 * enough to run every frame - which matters, because the ramp has to track the camera continuously
 * while the mesh itself only snaps once per module.
 */
export const updateBrutShellDepthGradient = (
    geometry: THREE.BufferGeometry,
    shellBaseY: number,
    cameraY: number,
): void => {
    const attribute = geometry.getAttribute('color') as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;

    for (let row = 0; row < ROW_COUNT; row += 1) {
        const worldY = shellBaseY + (row / BRUT_SHELL_ROWS) * BRUT_SHELL_HEIGHT;
        const brightness = resolveBrutDepthBrightness(worldY, cameraY);

        for (let face = 0; face < BRUT_FACE_COUNT; face += 1) {
            const base = (face * VERTS_PER_FACE + row * 2) * 3;
            array[base] = brightness;
            array[base + 1] = brightness;
            array[base + 2] = brightness;
            array[base + 3] = brightness;
            array[base + 4] = brightness;
            array[base + 5] = brightness;
        }
    }

    attribute.needsUpdate = true;
};
