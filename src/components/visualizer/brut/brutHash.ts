// src/components/visualizer/brut/brutHash.ts
// Deterministic scalar noise for the facade. Every consumer seeds from an ABSOLUTE index
// (module index, ordinal) so seeking backwards regenerates byte-identical geometry.

/** Small stateful PRNG, used where a stream of values is more convenient than a hash. */
export const mulberry32 = (seed: number) => () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

/** Stateless 1D hash in [0, 1). Stable across reloads because it only uses Math.sin. */
export const hash1 = (value: number): number => {
    const sine = Math.sin(value * 91.733) * 43758.5453;
    return sine - Math.floor(sine);
};

/** Signed variant in [-0.5, 0.5). */
export const hashSigned = (value: number): number => hash1(value) - 0.5;

/** Turns an arbitrary seed string (song id, title) into a stable numeric pattern seed. */
export const hashStringSeed = (text: string): number => {
    let accumulator = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        accumulator ^= text.charCodeAt(index);
        accumulator = Math.imul(accumulator, 0x01000193);
    }
    return ((accumulator >>> 0) % 100003) / 997;
};
