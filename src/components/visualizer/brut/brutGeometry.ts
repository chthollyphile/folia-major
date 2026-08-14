// src/components/visualizer/brut/brutGeometry.ts
// Produces deterministic facade relief so recycled wall modules stay visually stable while scrolling.

export const BRUT_LINE_SPACING = 3.35;
export const BRUT_CHUNK_HEIGHT = 11;
export const BRUT_WALL_WIDTH = 17;

export interface BrutReliefBlock {
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
}

const hash = (value: number) => {
    const sine = Math.sin(value * 91.733) * 43758.5453;
    return sine - Math.floor(sine);
};

/** Builds broad architectural ribs rather than a noisy field of unrelated decorative boxes. */
export const buildBrutReliefBlocks = (chunkIndex: number): BrutReliefBlock[] => {
    const blocks: BrutReliefBlock[] = [];
    for (let index = 0; index < 13; index += 1) {
        const seed = chunkIndex * 37 + index * 7.13;
        const isVertical = hash(seed + 1) > 0.38;
        const width = isVertical ? 0.35 + hash(seed + 2) * 0.9 : 1.1 + hash(seed + 2) * 2.8;
        const height = isVertical ? 1.2 + hash(seed + 3) * 4.5 : 0.28 + hash(seed + 3) * 0.72;
        blocks.push({
            x: (hash(seed + 4) - 0.5) * (BRUT_WALL_WIDTH - width - 0.6),
            y: (hash(seed + 5) - 0.5) * (BRUT_CHUNK_HEIGHT - height - 0.4),
            width,
            height,
            depth: 0.18 + hash(seed + 6) * 0.78,
        });
    }
    return blocks;
};
