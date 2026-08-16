import * as THREE from 'three';

// src/components/visualizer/brut/brutGlyphBatch.ts
// A fixed-capacity quad batch for the active line's character plates.
//
// WHY not InstancedMesh: it gives a per-instance matrix and colour, but no per-instance ALPHA and
// no per-instance UV without patching the shader. A plain BufferGeometry whose `position` is
// rewritten each frame and whose `color` attribute has itemSize 4 gives per-plate transform, tint
// AND opacity for free (three multiplies diffuseColor by vColor, alpha included), in ONE draw call
// and with zero GLSL. Rewriting 48 quads is ~1.3k floats per frame, which is nothing.
//
// Unused slots collapse to a zero-area quad rather than changing the draw range.

export interface BrutGlyphQuad {
    centerX: number;
    centerY: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    roll: number;
    r: number;
    g: number;
    b: number;
    a: number;
}

export const createBrutGlyphQuad = (): BrutGlyphQuad => ({
    centerX: 0,
    centerY: 0,
    z: 0,
    halfWidth: 0,
    halfHeight: 0,
    roll: 0,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
});

const CORNER_X = [-1, 1, 1, -1];
const CORNER_Y = [-1, -1, 1, 1];

export const createBrutGlyphGeometry = (slots: number): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(slots * 4 * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(slots * 4 * 2), 2);
    const color = new THREE.BufferAttribute(new Float32Array(slots * 4 * 4), 4);
    position.setUsage(THREE.DynamicDrawUsage);
    color.setUsage(THREE.DynamicDrawUsage);

    const indices = new Uint16Array(slots * 6);
    for (let slot = 0; slot < slots; slot += 1) {
        const base = slot * 4;
        const offset = slot * 6;
        indices[offset] = base;
        indices[offset + 1] = base + 1;
        indices[offset + 2] = base + 2;
        indices[offset + 3] = base;
        indices[offset + 4] = base + 2;
        indices[offset + 5] = base + 3;
    }

    geometry.setAttribute('position', position);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute('color', color);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // The batch is rewritten every frame and always sits in front of the camera; a cached bounding
    // sphere would be stale, so culling is disabled by the consumer instead.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    return geometry;
};

/** Writes one slot's UV sub-rect. Only changes when the raster or the unit list changes. */
export const writeBrutGlyphUv = (
    geometry: THREE.BufferGeometry,
    slot: number,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
): void => {
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const array = uv.array as Float32Array;
    const base = slot * 8;
    array[base] = u0; array[base + 1] = v0;
    array[base + 2] = u1; array[base + 3] = v0;
    array[base + 4] = u1; array[base + 5] = v1;
    array[base + 6] = u0; array[base + 7] = v1;
    uv.needsUpdate = true;
};

export const writeBrutGlyphQuad = (geometry: THREE.BufferGeometry, slot: number, quad: BrutGlyphQuad): void => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const colors = color.array as Float32Array;
    const cos = Math.cos(quad.roll);
    const sin = Math.sin(quad.roll);

    for (let corner = 0; corner < 4; corner += 1) {
        const dx = CORNER_X[corner] * quad.halfWidth;
        const dy = CORNER_Y[corner] * quad.halfHeight;
        const positionBase = (slot * 4 + corner) * 3;
        positions[positionBase] = quad.centerX + dx * cos - dy * sin;
        positions[positionBase + 1] = quad.centerY + dx * sin + dy * cos;
        positions[positionBase + 2] = quad.z;

        const colorBase = (slot * 4 + corner) * 4;
        colors[colorBase] = quad.r;
        colors[colorBase + 1] = quad.g;
        colors[colorBase + 2] = quad.b;
        colors[colorBase + 3] = quad.a;
    }
};

/** Collapses a slot to zero area so it costs no fill. */
export const hideBrutGlyphSlot = (geometry: THREE.BufferGeometry, slot: number): void => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    for (let corner = 0; corner < 4; corner += 1) {
        const base = (slot * 4 + corner) * 3;
        positions[base] = 0;
        positions[base + 1] = 0;
        positions[base + 2] = 0;
    }
};

export const commitBrutGlyphBatch = (geometry: THREE.BufferGeometry): void => {
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
};
