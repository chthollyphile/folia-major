import type { SongResult } from '../../../types';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { getSizedCoverUrl, resolveCoverSizeStep } from '../../../utils/coverUrl';

// src/components/app/scratchpad/scratchpadCover.ts
// 速记簿里画封面用的地址：按显示大小（CSS px）乘设备像素比取最近的一档缩略图（256 / 512 / 1024，见 coverUrl），不用原图。
// 平台给的原图常有一两千像素，展开整页一屏一百多张卡，每张都解码一张大图、再缩小斜着画，整页就卡（用户反馈，2026-11-07）。
// 不认识的地址（本地 blob 等）原样返回。

export const scratchpadCoverUrl = (song: SongResult | null | undefined, cssPx: number): string | undefined => {
    const url = getSongCoverUrl(song);
    if (!url) return undefined;
    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const step = resolveCoverSizeStep(cssPx * ratio);
    return Number.isFinite(step) ? getSizedCoverUrl(url, step) || url : url;
};
