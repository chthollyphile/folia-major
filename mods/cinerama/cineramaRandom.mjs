// mods/cinerama/cineramaRandom.mjs
// Deterministic selection, mirrored from Sonnet's sonnetRandom: one song must
// always resolve to the same split / layout / animation, so seeking or a rebuild
// never reshuffles the screen. Nothing here touches Math.random.

export const hashCineramaSeed = (value) => {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

// Salts keep the three axes decorrelated: the same line seed must not push
// split, layout and animation into lockstep.
export const mixCineramaSeed = (seed, salt) => (
    Math.imul(((Math.trunc(seed) ^ salt) >>> 0), 2654435761) >>> 0
);

export const cineramaHash01 = (seed, index, salt) => (
    mixCineramaSeed(seed + Math.imul(index + 1, 97), salt) / 4294967296
);

/*
 * Seeded pick that never returns `previous`, so two consecutive lines never
 * repeat the same strategy. Falls back to the seeded choice only when the pool
 * has a single entry.
 */
export const chooseCineramaWithoutRepeat = (choices, seed, previous) => {
    if (!choices || choices.length === 0) return null;
    if (choices.length === 1) return choices[0];
    const start = hashCineramaSeed(seed) % choices.length;
    for (let offset = 0; offset < choices.length; offset += 1) {
        const candidate = choices[(start + offset) % choices.length];
        if (candidate !== previous) return candidate;
    }
    return choices[start];
};
