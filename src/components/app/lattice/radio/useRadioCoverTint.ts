import { useEffect, useState } from 'react';
import { extractRepresentativeColors } from '../../../../utils/colorExtractor';
import { useWallPosterArtwork } from '../../../wall/useWallPosterArtwork';

// src/components/app/lattice/radio/useRadioCoverTint.ts
// 电台墙背面朝上的卡用封面的颜色：取一张小图（封面的最小档，约 256 px）的代表色，按封面地址记在模块里
// （一首歌只取一次）。记下的条数有上限，最旧的先丢：私人 FM 一直往后续，不让它随听过的歌一直涨。

const SAMPLE_SIZE_PX = 96;
const MAX_REMEMBERED_TINTS = 200;
const tints = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

const remember = (url: string, tint: string | null) => {
    tints.delete(url);
    tints.set(url, tint);
    while (tints.size > MAX_REMEMBERED_TINTS) {
        const oldest = tints.keys().next().value;
        if (oldest === undefined) break;
        tints.delete(oldest);
    }
};

const sampleTint = (url: string): Promise<string | null> => {
    const running = pending.get(url);
    if (running) return running;
    const task = extractRepresentativeColors(url, 1)
        .then(colors => colors[0] ?? null)
        .catch((error: unknown) => {
            console.warn('[LatticeRadio] cover tint failed', error);
            return null;
        })
        .then(tint => {
            remember(url, tint);
            pending.delete(url);
            return tint;
        });
    pending.set(url, task);
    return task;
};

/** 封面取色的结果：settled 为 false 时还在取；取完了 color 为代表色（#rrggbb），取不到（没有 CORS 头、加载失败）为 null。 */
export type RadioCoverTint = { settled: boolean; color: string | null };

const PENDING: RadioCoverTint = { settled: false, color: null };

export const useRadioCoverTint = (coverUrl: string | undefined): RadioCoverTint => {
    const sample = useWallPosterArtwork(coverUrl, SAMPLE_SIZE_PX);
    const [tint, setTint] = useState<{ url: string; color: string | null } | null>(null);

    useEffect(() => {
        if (!sample || tints.has(sample)) return;
        let cancelled = false;
        void sampleTint(sample).then(color => {
            if (!cancelled) setTint({ url: sample, color });
        });
        return () => { cancelled = true; };
    }, [sample]);

    if (!sample) return { settled: true, color: null };
    if (tints.has(sample)) return { settled: true, color: tints.get(sample) ?? null };
    return tint?.url === sample ? { settled: true, color: tint.color } : PENDING;
};
