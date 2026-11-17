import { extractRepresentativeColorsFromPixels } from './colorPalette';
import { oklabDistance, oklabToSrgb, srgbToOklab, type Oklab } from './oklab';

// src/utils/colorExtractor.ts
// Reads a cover's pixels and turns them into colours: identity colours for theme building
// (extractColors) and population-weighted ones for backgrounds (extractRepresentativeColors).

/**
 * 把图片缩到 50×50 读出像素（crossOrigin 匿名请求）。图片加载失败、没有 CORS 头、画布被污染（读像素抛
 * SecurityError）时都返回 null。silent：失败时不打 warn（墙上一批头像取色时用，失败只是回退）。
 */
export const loadImagePixels = (imageUrl: string, { silent = false }: { silent?: boolean } = {}): Promise<Uint8ClampedArray | null> => (
    new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "Anonymous";

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }

            // Resize for performance
            const width = 50;
            const height = 50;
            canvas.width = width;
            canvas.height = height;

            try {
                // A 1000 px cover shrunk to 50 px with the default (low) filter is close to point
                // sampling: single JPEG-noise pixels survive as outlier colours.
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                resolve(ctx.getImageData(0, 0, width, height).data);
            } catch (error) {
                // 画布被跨源图片污染时 getImageData 抛错；不吞掉的话这个 Promise 永远不 resolve。
                if (!silent) console.warn("Failed to read image pixels for color extraction", error);
                resolve(null);
            }
        };

        img.onerror = (e) => {
            if (!silent) console.warn("Failed to load image for color extraction", e);
            resolve(null);
        };
        img.src = imageUrl;
    })
);

type Cluster = Oklab & { weight: number; };

const MIN_ALPHA = 128;
// OKLab bin size before clustering: a little under two just-noticeable differences per axis.
const BIN_LIGHTNESS = 0.04;
const BIN_CHROMA_AXIS = 0.025;
const CLUSTER_ITERATIONS = 8;
// Two picks closer than this read as the same colour; the next distinct cluster goes in instead.
const MIN_PICK_DISTANCE = 0.06;

const smoothstep = (edge0: number, edge1: number, value: number) => {
    const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return progress * progress * (3 - 2 * progress);
};

const binPixels = (imageData: Uint8ClampedArray): Cluster[] => {
    const bins = new Map<string, Cluster>();
    for (let index = 0; index < imageData.length; index += 4) {
        if (imageData[index + 3] < MIN_ALPHA) continue;
        const lab = srgbToOklab({ r: imageData[index], g: imageData[index + 1], b: imageData[index + 2] });
        const key = `${Math.round(lab.L / BIN_LIGHTNESS)}:${Math.round(lab.a / BIN_CHROMA_AXIS)}:${Math.round(lab.b / BIN_CHROMA_AXIS)}`;
        const bin = bins.get(key);
        if (bin) {
            bin.L += lab.L;
            bin.a += lab.a;
            bin.b += lab.b;
            bin.weight += 1;
        } else {
            bins.set(key, { ...lab, weight: 1 });
        }
    }
    return [...bins.values()].map(bin => ({ L: bin.L / bin.weight, a: bin.a / bin.weight, b: bin.b / bin.weight, weight: bin.weight }));
};

// Weighted k-means over the bins, seeded deterministically: the heaviest bin first, then each
// next seed where weight × squared distance to the seeds so far is largest (k-means++ without dice).
const clusterBins = (bins: Cluster[], clusterCount: number): Cluster[] => {
    const centers: Oklab[] = [];
    const heaviest = bins.reduce((best, bin) => (bin.weight > best.weight ? bin : best), bins[0]);
    centers.push(heaviest);
    while (centers.length < clusterCount) {
        let next: Cluster | null = null;
        let nextScore = 0;
        for (const bin of bins) {
            const nearest = Math.min(...centers.map(center => oklabDistance(bin, center)));
            const score = bin.weight * nearest * nearest;
            if (score > nextScore) {
                nextScore = score;
                next = bin;
            }
        }
        if (!next) break;
        centers.push(next);
    }

    let clusters: Cluster[] = [];
    for (let iteration = 0; iteration < CLUSTER_ITERATIONS; iteration += 1) {
        const sums = centers.map(() => ({ L: 0, a: 0, b: 0, weight: 0 }));
        for (const bin of bins) {
            let nearestIndex = 0;
            let nearestDistance = Infinity;
            centers.forEach((center, index) => {
                const distance = oklabDistance(bin, center);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });
            const sum = sums[nearestIndex];
            sum.L += bin.L * bin.weight;
            sum.a += bin.a * bin.weight;
            sum.b += bin.b * bin.weight;
            sum.weight += bin.weight;
        }
        clusters = sums
            .filter(sum => sum.weight > 0)
            .map(sum => ({ L: sum.L / sum.weight, a: sum.a / sum.weight, b: sum.b / sum.weight, weight: sum.weight }));
        centers.splice(0, centers.length, ...clusters);
    }
    return clusters;
};

// How much a cluster speaks for the cover's identity: it needs area (specks under ~1 % barely
// count, however loud), some chroma, and a lightness that is neither near-black nor paper-white.
// Grey clusters keep a floor so an all-grey cover still yields its greys in area order.
const scoreCluster = (cluster: Cluster, totalWeight: number) => {
    const share = cluster.weight / totalWeight;
    const area = Math.sqrt(share) * (0.1 + 0.9 * smoothstep(0.004, 0.03, share));
    const chroma = 0.2 + 0.8 * smoothstep(0.02, 0.13, Math.hypot(cluster.a, cluster.b));
    const lightness = 0.25 + 0.75 * Math.max(0, 1 - ((cluster.L - 0.62) / 0.42) ** 2);
    return area * chroma * lightness;
};

const toHex = ({ r, g, b }: { r: number; g: number; b: number; }) => (
    `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
);

/**
 * The cover's identity colours for theme building, best first: pixels are clustered in OKLab and
 * each cluster is ranked by area × chroma × usable lightness, so a large calm colour beats a tiny
 * saturated sticker, and the second pick is a genuinely different colour rather than a shade of
 * the first.
 */
export const extractThemeColorsFromPixels = (imageData: Uint8ClampedArray, count: number): string[] => {
    if (count <= 0) return [];
    const bins = binPixels(imageData);
    if (bins.length === 0) return [];

    const clusters = clusterBins(bins, Math.min(bins.length, Math.max(count + 3, 8)));
    const totalWeight = clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
    const ranked = clusters
        .map(cluster => ({ cluster, score: scoreCluster(cluster, totalWeight) }))
        .sort((left, right) => right.score - left.score);

    const picks: Cluster[] = [];
    for (const { cluster } of ranked) {
        if (picks.length >= count) break;
        if (picks.every(pick => oklabDistance(pick, cluster) >= MIN_PICK_DISTANCE)) {
            picks.push(cluster);
        }
    }
    return picks.map(pick => toHex(oklabToSrgb(pick)));
};

export const extractColors = async (imageUrl: string, count: number = 5): Promise<string[]> => {
    const pixels = await loadImagePixels(imageUrl);
    return pixels ? extractThemeColorsFromPixels(pixels, count) : [];
};

export const extractRepresentativeColors = async (
    imageUrl: string,
    count: number = 5,
): Promise<string[]> => {
    const pixels = await loadImagePixels(imageUrl);
    return pixels ? extractRepresentativeColorsFromPixels(pixels, count) : [];
};
