import { mulberry32 } from './brutHash';

// src/components/visualizer/brut/brutHeightField.ts
// Board-formed concrete relief as a tileable height field. Everything the material's realism rests
// on is decided here: the normal map, the baked ambient occlusion and the stain placement are all
// derived from this one array, so the pores, seams and tie holes agree across every map.
//
// Pure and DOM-free (vitest runs in a node environment), so it stays unit testable.

export interface BrutTieHole {
    x: number;
    y: number;
    radius: number;
}

export interface BrutHeightField {
    size: number;
    /** Relief in arbitrary units, roughly [-1, 1]. */
    values: Float32Array;
    /** Tie-hole centres in pixels - rust and water stains originate from these. */
    tieHoles: BrutTieHole[];
    /** Y pixel of each formwork board seam. */
    seams: number[];
}

const BOARDS = 6;
const TIE_COLUMNS = 3;
const TIE_ROWS = 2;

const buildLattice = (period: number, random: () => number): Float32Array => {
    const values = new Float32Array(period * period);
    for (let index = 0; index < values.length; index += 1) {
        values[index] = random();
    }
    return values;
};

/** Bilinear value-noise sample with wrap-around, so every octave tiles seamlessly. */
const sampleLattice = (values: Float32Array, period: number, x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ix0 = ((x0 % period) + period) % period;
    const iy0 = ((y0 % period) + period) % period;
    const ix1 = (ix0 + 1) % period;
    const iy1 = (iy0 + 1) % period;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = values[iy0 * period + ix0] + (values[iy0 * period + ix1] - values[iy0 * period + ix0]) * sx;
    const bottom = values[iy1 * period + ix0] + (values[iy1 * period + ix1] - values[iy1 * period + ix0]) * sx;
    return top + (bottom - top) * sy;
};

/** Builds the aggregate grain, formwork board seams, form-tie holes and air voids. */
export const createBrutHeightField = (size: number, seed: number): BrutHeightField => {
    const random = mulberry32(seed);
    const values = new Float32Array(size * size);
    const octaves = [8, 16, 32, 64].map(period => ({ period, lattice: buildLattice(period, random) }));

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let grain = 0;
            let amplitude = 0.5;
            octaves.forEach(({ period, lattice }) => {
                grain += (sampleLattice(lattice, period, (x / size) * period, (y / size) * period) - 0.5) * amplitude;
                amplitude *= 0.55;
            });
            values[y * size + x] = grain * 0.5;
        }
    }

    // Wood formwork: each board leaves a bled ridge at its top edge, a shadowed groove under it,
    // and its own vertical grain streak so neighbouring planks read as different timber.
    const boardHeight = size / BOARDS;
    const seams: number[] = [];
    const grainLattice = buildLattice(64, random);
    for (let board = 0; board < BOARDS; board += 1) {
        const seamY = Math.round(board * boardHeight);
        seams.push(seamY);
        const grainPhase = random() * 64;
        for (let x = 0; x < size; x += 1) {
            const wobble = Math.round((sampleLattice(grainLattice, 64, (x / size) * 64, grainPhase) - 0.5) * 2.4);
            for (let offset = -3; offset <= 4; offset += 1) {
                const y = ((seamY + offset + wobble) % size + size) % size;
                const relief = offset < 0 ? 0.34 * (1 + offset / 3) : -0.42 * (1 - offset / 5);
                values[y * size + x] += relief;
            }
            const streak = (sampleLattice(grainLattice, 64, (x / size) * 64 * 4, grainPhase) - 0.5) * 0.12;
            for (let y = seamY; y < seamY + boardHeight && y < size; y += 1) {
                values[y * size + x] += streak;
            }
        }
    }

    // Form-tie holes: the single strongest "this is real board-formed concrete" cue.
    const tieHoles: BrutTieHole[] = [];
    for (let row = 0; row < TIE_ROWS; row += 1) {
        for (let column = 0; column < TIE_COLUMNS; column += 1) {
            const centerX = (column + 0.5) * (size / TIE_COLUMNS) + (random() - 0.5) * 18;
            const centerY = (row + 0.5) * (size / TIE_ROWS) + (random() - 0.5) * 18;
            const radius = 6 + random() * 2.5;
            tieHoles.push({ x: centerX, y: centerY, radius });

            const reach = Math.ceil(radius) + 3;
            for (let dy = -reach; dy <= reach; dy += 1) {
                for (let dx = -reach; dx <= reach; dx += 1) {
                    const distance = Math.hypot(dx, dy);
                    if (distance > reach) continue;
                    const x = ((Math.round(centerX) + dx) % size + size) % size;
                    const y = ((Math.round(centerY) + dy) % size + size) % size;
                    values[y * size + x] += distance < radius
                        ? -0.95 * (1 - distance / radius)
                        : 0.16 * (1 - (distance - radius) / 3);
                }
            }
        }
    }

    // Air voids.
    for (let index = 0; index < 420; index += 1) {
        const x = Math.floor(random() * size);
        const y = Math.floor(random() * size);
        values[y * size + x] -= 0.25 + random() * 0.35;
    }

    return { size, values, tieHoles, seams };
};

/** Box-blurred height, used as the ambient-occlusion source baked into the albedo. */
export const blurBrutHeightField = (field: BrutHeightField, radius: number): Float32Array => {
    const { size, values } = field;
    const horizontal = new Float32Array(size * size);
    const output = new Float32Array(size * size);
    const window = radius * 2 + 1;

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let sum = 0;
            for (let offset = -radius; offset <= radius; offset += 1) {
                sum += values[y * size + (((x + offset) % size) + size) % size];
            }
            horizontal[y * size + x] = sum / window;
        }
    }

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let sum = 0;
            for (let offset = -radius; offset <= radius; offset += 1) {
                sum += horizontal[((((y + offset) % size) + size) % size) * size + x];
            }
            output[y * size + x] = sum / window;
        }
    }

    return output;
};
