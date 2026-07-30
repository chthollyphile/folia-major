// src/components/visualizer/sonnet/sonnetRandom.ts
// Supplies deterministic selection without relying on process-global random state.
export const hashSonnetSeed = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};
