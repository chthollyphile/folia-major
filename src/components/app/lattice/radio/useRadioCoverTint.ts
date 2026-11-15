import { useEffect, useState } from 'react';
import { extractRepresentativeColors } from '../../../../utils/colorExtractor';
import { useWallPosterArtwork } from '../../../wall/useWallPosterArtwork';

// src/components/app/lattice/radio/useRadioCoverTint.ts
// 电台墙背面朝上的卡用封面的颜色：取一张小图的代表色，按封面地址记在模块里（一首歌只取一次）。
// 取不到（没有 CORS 头、加载失败）时为 null，卡面退回按歌曲 id 算出来的颜色。

const SAMPLE_SIZE_PX = 96;
const tints = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

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
            tints.set(url, tint);
            pending.delete(url);
            return tint;
        });
    pending.set(url, task);
    return task;
};

/** 封面的代表色（#rrggbb），还没取到或取不到时为 null。 */
export const useRadioCoverTint = (coverUrl: string | undefined): string | null => {
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

    if (!sample) return null;
    if (tints.has(sample)) return tints.get(sample) ?? null;
    return tint?.url === sample ? tint.color : null;
};
