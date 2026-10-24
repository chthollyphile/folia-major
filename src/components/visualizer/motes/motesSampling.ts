// Bounded sampling of a lyric's alpha mask, with deterministic scatter seeds.
export const MAX_MOTES_PARTICLES = 24000;
export const RECOMMENDED_MOTES_PARTICLES = 6000;

export interface MotesMaskPoints {
    x: Float32Array;
    y: Float32Array;
    alpha: Float32Array;
    pointSpacing: number;
}

export const hashMotesSeed = (text: string) => {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
};

export const createMotesRandom = (seed: number) => {
    let state = seed || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
};

// Under pressure, keep one stroke sample per occupied spatial cell instead of random local holes.
const sampleBudgetedMask = (
    image: Pick<ImageData, 'width' | 'height' | 'data'>, budget: number, spacing: number, seed: number,
) => {
    const x = new Float32Array(budget);
    const y = new Float32Array(budget);
    const alpha = new Float32Array(budget);
    let seen = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const random = createMotesRandom(seed);
        seen = 0;
        let row = 0;
        for (let top = 0; top < image.height; top += spacing, row += 1) {
            const rowShift = row % 2 * spacing * 0.5;
            for (let left = -rowShift; left < image.width; left += spacing) {
                const cellLeft = Math.max(0, left);
                const right = Math.min(image.width, left + spacing);
                const bottom = Math.min(image.height, top + spacing);
                const targetX = (cellLeft + right) / 2 + (random() - 0.5) * (right - cellLeft) * 0.65;
                const targetY = (top + bottom) / 2 + (random() - 0.5) * (bottom - top) * 0.65;
                let closest = Infinity;
                let px = 0; let py = 0; let coverage = 0;
                for (let cy = Math.max(0, Math.ceil(top - 0.5)); cy < bottom - 0.5; cy += 1) {
                    for (let cx = Math.max(0, Math.ceil(cellLeft - 0.5)); cx < right - 0.5; cx += 1) {
                        const value = image.data[(cy * image.width + cx) * 4 + 3] / 255;
                        if (!(value > 0.15)) continue;
                        const distance = (cx + 0.5 - targetX) ** 2 + (cy + 0.5 - targetY) ** 2;
                        if (distance >= closest) continue;
                        closest = distance; px = cx + 0.5; py = cy + 0.5; coverage = value;
                    }
                }
                if (!coverage) continue;
                const slot = seen < budget ? seen : Math.floor(random() * (seen + 1));
                seen += 1;
                if (slot >= budget) continue;
                // Stay inside the selected mask pixel without snapping every grain to its center.
                x[slot] = px + (random() - 0.5) * 0.8;
                y[slot] = py + (random() - 0.5) * 0.8;
                alpha[slot] = coverage;
            }
        }
        if (seen <= budget) break;
        spacing *= Math.sqrt(seen / budget) * 1.01;
    }
    const length = Math.min(seen, budget);
    return { x: x.slice(0, length), y: y.slice(0, length), alpha: alpha.slice(0, length) };
};

// Bounded sampling preserves local strokes and compensates the represented area when density is reduced.
export const sampleMotesMask = (
    image: Pick<ImageData, 'width' | 'height' | 'data'>,
    { step = 2, maxPoints = RECOMMENDED_MOTES_PARTICLES, seed = 1 } = {},
): MotesMaskPoints => {
    const budget = Math.min(MAX_MOTES_PARTICLES, Math.max(0, Math.floor(Number.isFinite(maxPoints) ? maxPoints : RECOMMENDED_MOTES_PARTICLES)));
    const stride = Math.max(1, Number.isFinite(step) ? step : 2);
    const x = new Float32Array(budget);
    const y = new Float32Array(budget);
    const alpha = new Float32Array(budget);
    if (budget === 0) return { x, y, alpha, pointSpacing: stride };
    const random = createMotesRandom(seed);
    const jitter = createMotesRandom(seed ^ 0x9e3779b9);
    let seen = 0;
    for (let py = stride / 2; py < image.height; py += stride) {
        for (let px = stride / 2; px < image.width; px += stride) {
            // Test the stored precision too: rounding at a pixel edge must not cross out of the mask.
            const anchorX = Math.fround(px);
            const anchorY = Math.fround(py);
            if (anchorX >= image.width || anchorY >= image.height) continue;
            let coverage = image.data[(Math.floor(anchorY) * image.width + Math.floor(anchorX)) * 4 + 3] / 255;
            if (!(coverage > 0.15)) continue;
            // Break the fixed grid without moving a target out of its painted stroke.
            const angle = jitter() * Math.PI * 2;
            const radius = Math.sqrt(jitter()) * stride * 0.45;
            const candidateX = Math.fround(anchorX + Math.cos(angle) * radius);
            const candidateY = Math.fround(anchorY + Math.sin(angle) * radius);
            const candidateCoverage = candidateX >= 0 && candidateY >= 0 && candidateX < image.width && candidateY < image.height
                ? image.data[(Math.floor(candidateY) * image.width + Math.floor(candidateX)) * 4 + 3] / 255
                : 0;
            const accepted = candidateCoverage > 0.15;
            if (accepted) coverage = candidateCoverage;
            const slot = seen < budget ? seen : Math.floor(random() * (seen + 1));
            seen += 1;
            if (slot >= budget) continue;
            x[slot] = accepted ? candidateX : anchorX;
            y[slot] = accepted ? candidateY : anchorY;
            alpha[slot] = coverage;
        }
    }
    const points = seen > budget
        ? sampleBudgetedMask(image, budget, stride * Math.sqrt(seen / budget), seed)
        : { x: x.slice(0, seen), y: y.slice(0, seen), alpha: alpha.slice(0, seen) };
    // Fewer samples must cover the same stroke area, rather than thinning a long sentence to dust.
    const pointSpacing = stride * Math.sqrt(Math.max(1, seen / Math.max(1, points.x.length)));
    return { ...points, pointSpacing };
};
