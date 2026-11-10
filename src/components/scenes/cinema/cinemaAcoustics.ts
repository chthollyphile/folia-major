import type { AcousticWorld } from '../definition';
import { BAYS, BLOCKS, BOXES, HALL, PROSCENIUM, ROWS, SCREEN, STAGE, bayZ, boxOut, rowFloor } from './cinemaLayout';

// src/components/scenes/cinema/cinemaAcoustics.ts
// The hall as the sound hears it, from the same measurements as the picture (cinemaLayout.ts), so the two
// rooms cannot drift apart (scene-engine-design.md 4.5). Ported from the prototype that was measured and
// listened to (proto/scene-sound phonon.cjs buildHall): the room shell, the screen wall and proscenium, the
// stage, the raked treads, the seat blocks, and what stands out of the shell in the picture (the side boxes,
// the pilasters, the ceiling beams). Things under about 0.3 m (rails, lamps, sconces) are left out: they are
// shorter than the wavelengths that carry most of the reverberation. Material ids are those of
// services/sceneSound/acousticMaterials.ts. Metres, Y up.

/**
 * THX asks for thick absorbers on the side and rear walls and says nothing of the ceiling; an absorbent ceiling
 * gives this hall about 0.3 s, a painted one about 0.55 s (prototype). The prototype was heard with this one.
 */
const CEILING = 'ceiling-absorber';

/** One static mesh of the hall; triangles face the side the sound is on. */
export const cinemaAcousticWorld = (): AcousticWorld => {
    const materials: string[] = [];
    const positions: number[] = [];
    const indices: number[] = [];
    const triangleMaterials: number[] = [];
    type P = [number, number, number];
    const quad = (a: P, b: P, c: P, d: P, material: string) => {
        const base = positions.length / 3;
        positions.push(...a, ...b, ...c, ...d);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        let m = materials.indexOf(material);
        if (m < 0) m = materials.push(material) - 1;
        triangleMaterials.push(m, m);
    };
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: string) => { // outward faces
        quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], material); // top
        quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], material); // +z
        quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], material); // -z
        quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], material); // +x
        quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], material); // -x
        quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], material); // bottom
    };
    const W = HALL.halfWidth; const H = HALL.ceiling; const B = HALL.back;
    quad([-W, 0, 0], [-W, 0, B], [W, 0, B], [W, 0, 0], 'carpet'); // floor, facing +y
    quad([-W, H, 0], [W, H, 0], [W, H, B], [-W, H, B], CEILING); // ceiling, facing -y
    quad([-W, 0, 0], [-W, H, 0], [-W, H, B], [-W, 0, B], 'wall-absorber'); // left wall, facing +x
    quad([W, 0, B], [W, H, B], [W, H, 0], [W, 0, 0], 'wall-absorber'); // right wall, facing -x
    quad([W, 0, B], [-W, 0, B], [-W, H, B], [W, H, B], 'wall-absorber'); // rear wall, facing -z
    // Screen wall (z = 0, facing +z) inside the proscenium: the screen, with the masking and curtains round it.
    // The proscenium wall stands PROSCENIUM.z in front of it, with the reveal of the opening between the two.
    const sx = SCREEN.width / 2; const sy0 = SCREEN.centerY - SCREEN.height / 2; const sy1 = SCREEN.centerY + SCREEN.height / 2;
    const px = PROSCENIUM.halfWidth; const pt = PROSCENIUM.top; const pz = PROSCENIUM.z;
    const xs = [-W, -px, -sx, sx, px, W]; const ys = [0, sy0, sy1, pt, H];
    for (let i = 0; i < xs.length - 1; i += 1) {
        for (let j = 0; j < ys.length - 1; j += 1) {
            const cx = (xs[i] + xs[i + 1]) / 2; const cy = (ys[j] + ys[j + 1]) / 2;
            const inside = Math.abs(cx) < px && cy < pt;
            const material = Math.abs(cx) < sx && cy > sy0 && cy < sy1 ? 'perforated-screen' : inside ? 'velvet-heavy' : 'wall-absorber';
            const z = inside ? 0 : pz;
            quad([xs[i], ys[j], z], [xs[i + 1], ys[j], z], [xs[i + 1], ys[j + 1], z], [xs[i], ys[j + 1], z], material);
        }
    }
    quad([-px, 0, pz], [-px, 0, 0], [-px, pt, 0], [-px, pt, pz], 'wall-absorber'); // reveal, left, facing +x
    quad([px, 0, 0], [px, 0, pz], [px, pt, pz], [px, pt, 0], 'wall-absorber'); // reveal, right, facing -x
    quad([-px, pt, 0], [px, pt, 0], [px, pt, pz], [-px, pt, pz], 'wall-absorber'); // reveal, top, facing -y
    // The fluted pilasters flanking the proscenium, and one at each bay of the side walls (0.3 m out, 0.56 m wide).
    for (const side of [-1, 1]) {
        const [a, b] = [side * PROSCENIUM.pilasterInner, side * PROSCENIUM.pilasterOuter].sort((p, q) => p - q);
        box(a, b, 0, pt + 0.4, pz, pz + 0.34, 'wall-absorber');
        for (let bay = 1; bay < BAYS.count; bay += 1) {
            const z = bayZ(bay);
            const [x0, x1] = side > 0 ? [W - 0.3, W] : [-W, -W + 0.3];
            box(x0, x1, 0, H, z - 0.28, z + 0.28, 'wall-absorber');
        }
    }
    // The ceiling beams, one per bay, 0.62 m deep and 0.6 m wide across the hall, finished as the ceiling.
    for (let bay = 0; bay < BAYS.count; bay += 1) {
        const z = bayZ(bay);
        box(-W, W, H - 0.62, H, z - 0.3, z + 0.3, CEILING);
    }
    // The boxes: a bowed wooden front standing out of each side wall from its foot (0.3 m under the box floor) to
    // the rail, a wooden soffit under it and a carpeted floor in it; open to the hall above the rail.
    const { z0: bz0, z1: bz1, floorY, railY } = BOXES;
    const foot = floorY - 0.3; const top = railY + 0.07; const segments = 12;
    for (const side of [-1, 1]) {
        const at = (t: number): [number, number] => [side * (W - boxOut(t)), bz0 + (bz1 - bz0) * t];
        const wall = side * W;
        for (let k = 0; k < segments; k += 1) {
            const [xa, za] = at(k / segments); const [xb, zb] = at((k + 1) / segments);
            if (side < 0) {
                quad([xa, foot, za], [xa, top, za], [xb, top, zb], [xb, foot, zb], 'wood'); // front, facing the hall
                quad([xa, foot, za], [xb, foot, zb], [wall, foot, zb], [wall, foot, za], 'wood'); // soffit, facing down
                quad([xa, floorY, za], [wall, floorY, za], [wall, floorY, zb], [xb, floorY, zb], 'carpet'); // floor, facing up
            } else {
                quad([xa, foot, za], [xb, foot, zb], [xb, top, zb], [xa, top, za], 'wood');
                quad([xa, foot, za], [wall, foot, za], [wall, foot, zb], [xb, foot, zb], 'wood');
                quad([xa, floorY, za], [xb, floorY, zb], [wall, floorY, zb], [wall, floorY, za], 'carpet');
            }
        }
        // The ends of the front, from the wall out to where it starts and ends.
        for (const [t, z, facing] of [[0, bz0, -1], [1, bz1, 1]]) {
            const [x] = at(t);
            const [p, q] = (side > 0) === (facing > 0) ? [x, wall] : [wall, x];
            quad([p, foot, z], [q, foot, z], [q, top, z], [p, top, z], 'wood');
        }
    }
    box(-px, px, 0, STAGE.height, 0, STAGE.front, 'wood');
    // Raked treads: straight across the hall (the rows' 40 m arcs are ignored for the floor), one box per raised row.
    const backZ = (row: number) => ROWS.first + row * ROWS.pitch;
    for (let row = 0; row < ROWS.count; row += 1) {
        const h = rowFloor(row);
        if (h <= 0) continue;
        const z1 = row === ROWS.count - 1 ? B : backZ(row) - ROWS.treadFront + ROWS.pitch;
        box(-W, W, 0, h, backZ(row) - ROWS.treadFront, z1, 'carpet');
    }
    // Seat blocks: one slab per block and row, as deep as the row's tread and as high as the seat backs, so rows
    // touch and the seat material lies on the audience plane. Published seat absorption is per m2 of seating
    // floor (Beranek's method); boxes with open gaps between rows would count it several times over.
    const sideEdge = BLOCKS.aisleOuter + BLOCKS.sideSeats * BLOCKS.seatPitch;
    const blocks = [[-BLOCKS.aisleInner, BLOCKS.aisleInner], [-sideEdge, -BLOCKS.aisleOuter], [BLOCKS.aisleOuter, sideEdge]];
    for (let row = 0; row < ROWS.count; row += 1) {
        const h = rowFloor(row);
        const z0 = backZ(row) - ROWS.treadFront; const z1 = row === ROWS.count - 1 ? B : z0 + ROWS.pitch;
        for (const [x0, x1] of blocks) box(x0, x1, h, h + 1.0, z0, z1, 'seat-upholstered');
    }
    return {
        meshes: [{
            id: 'hall',
            positions: Float32Array.from(positions),
            indices: Uint32Array.from(indices),
            triangleMaterials: Uint16Array.from(triangleMaterials),
            materials,
        }],
    };
};

/**
 * The two screen speakers as the sound hears them (prototype SPEAKERS): just inside the picture's edge
 * (0.45 of the width out), at two thirds of its height, and 0.3 m in front of the screen, since Steam Audio's
 * reflections do not pass through a surface and a speaker behind it would get none.
 */
export const CINEMA_SPEAKERS = {
    L: [-0.45 * SCREEN.width, SCREEN.centerY - SCREEN.height / 2 + (2 / 3) * SCREEN.height, 0.3],
    R: [0.45 * SCREEN.width, SCREEN.centerY - SCREEN.height / 2 + (2 / 3) * SCREEN.height, 0.3],
} as const;
