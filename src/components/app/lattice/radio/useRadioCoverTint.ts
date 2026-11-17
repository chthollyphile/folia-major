import { useEffect, useState } from 'react';
import { loadImagePixels } from '../../../../utils/colorExtractor';
import { extractRepresentativeColorsFromPixels } from '../../../../utils/colorPalette';
import { useWallPosterArtwork } from '../../../wall/useWallPosterArtwork';

// src/components/app/lattice/radio/useRadioCoverTint.ts
// 电台墙背面朝上的卡用的封面信息：取一张小图（封面的最小档）读一次像素，得到两样东西——封面的代表色（取色回来
// 之前背面先是中性色）和一张十几像素见方、压低了饱和度的缩略图（「棱纹玻璃」后面那层模糊的封面：浏览器放大小图
// 本身就是糊的，不用 CSS 的 blur 滤镜，卡变大变小时不必每帧重新模糊）。按封面地址记在模块里（一首歌只取一次）；
// 记下的条数有上限，最旧的先丢：私人 FM 一直往后续，不让它随听过的歌一直涨。

const SAMPLE_SIZE_PX = 96;
/** 模糊缩略图的边长：再大就看得出封面内容，再小只剩一团颜色。 */
const VEIL_SIZE_PX = 12;
const MAX_REMEMBERED = 200;

type CoverSample = { color: string | null; veil: string | null };

const samples = new Map<string, CoverSample>();
const pending = new Map<string, Promise<CoverSample>>();
const FAILED: CoverSample = { color: null, veil: null };

const remember = (url: string, sample: CoverSample) => {
    samples.delete(url);
    samples.set(url, sample);
    while (samples.size > MAX_REMEMBERED) {
        const oldest = samples.keys().next().value;
        if (oldest === undefined) break;
        samples.delete(oldest);
    }
};

/** 50×50 的像素缩成 VEIL_SIZE_PX 见方、饱和度降一半、略压暗，导出成 data URL。画不了时返回 null。 */
const drawVeil = (pixels: Uint8ClampedArray): string | null => {
    const side = Math.round(Math.sqrt(pixels.length / 4));
    if (side <= 0) return null;
    const source = document.createElement('canvas');
    source.width = side;
    source.height = side;
    const target = document.createElement('canvas');
    target.width = VEIL_SIZE_PX;
    target.height = VEIL_SIZE_PX;
    const sourceContext = source.getContext('2d');
    const targetContext = target.getContext('2d');
    if (!sourceContext || !targetContext) return null;
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(pixels), side, side), 0, 0);
    targetContext.filter = 'saturate(55%) brightness(85%)';
    targetContext.imageSmoothingQuality = 'high';
    targetContext.drawImage(source, 0, 0, VEIL_SIZE_PX, VEIL_SIZE_PX);
    return target.toDataURL('image/png');
};

const sampleCover = (url: string): Promise<CoverSample> => {
    const running = pending.get(url);
    if (running) return running;
    const task = loadImagePixels(url, { silent: true })
        .then((pixels): CoverSample => (pixels
            ? { color: extractRepresentativeColorsFromPixels(pixels, 1)[0] ?? null, veil: drawVeil(pixels) }
            : FAILED))
        .catch((error: unknown) => {
            console.warn('[LatticeRadio] cover sample failed', error);
            return FAILED;
        })
        .then(sample => {
            remember(url, sample);
            pending.delete(url);
            return sample;
        });
    pending.set(url, task);
    return task;
};

/**
 * 封面取样的结果：settled 为 false 时还在取；取完了 color 为代表色（#rrggbb）、veil 为模糊缩略图的 data URL，
 * 取不到（没有 CORS 头、加载失败）时两者都为 null。
 */
export type RadioCoverTint = { settled: boolean; color: string | null; veil: string | null };

const PENDING: RadioCoverTint = { settled: false, color: null, veil: null };
const NONE: RadioCoverTint = { settled: true, color: null, veil: null };

/**
 * `deferred`：先不取样（取过的照常给），之后再取。取样要从画布读回像素、再编码一张缩略图，都在主线程上同步做，
 * 电台墙打开时那一波浮上来的时候不做。
 */
export const useRadioCoverTint = (coverUrl: string | undefined, { deferred = false }: { deferred?: boolean } = {}): RadioCoverTint => {
    const sample = useWallPosterArtwork(coverUrl, SAMPLE_SIZE_PX);
    const [result, setResult] = useState<{ url: string; sample: CoverSample } | null>(null);

    useEffect(() => {
        if (!sample || samples.has(sample) || deferred) return;
        let cancelled = false;
        void sampleCover(sample).then(value => {
            if (!cancelled) setResult({ url: sample, sample: value });
        });
        return () => { cancelled = true; };
    }, [deferred, sample]);

    if (!sample) return NONE;
    const known = samples.get(sample) ?? (result?.url === sample ? result.sample : null);
    return known ? { settled: true, ...known } : PENDING;
};
