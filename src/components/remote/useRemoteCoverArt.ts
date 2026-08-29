import { useCallback, useEffect, useRef, useState } from 'react';
import { extractColors } from '../../utils/colorExtractor';

// src/components/remote/useRemoteCoverArt.ts
// 遥控窗口的封面预读：提前把队列邻居的封面解码进浏览器缓存并算好取色，
// 真正切歌时封面与背景色同帧到位，过渡不会先空一拍再补图。

/** 邻居取色缓存上限，够覆盖来回切几首，不至于把 blob URL 一直攥在手里 */
const COVER_COLOR_CACHE_LIMIT = 8;

type UseRemoteCoverArtParams = {
    backgroundMode: 'default' | 'cover' | 'transparent';
    trackKey: string | null;
    coverUrl: string | null;
    prevTrackKey: string | null;
    prevTrackCoverUrl: string | null;
    nextTrackKey: string | null;
    nextTrackCoverUrl: string | null;
};

export type RemoteCoverArt = {
    /** 当前曲目的取色结果 */
    coverColors: string[];
    /** 预读好的取色；交接过半时用来提前把背景换成下一首的配色 */
    getCachedCoverColors: (trackKey: string | null, coverUrl: string | null) => string[] | undefined;
};

/**
 * 取色按曲目标识缓存，而不是按封面 URL：邻居封面来自曲目元数据，当前曲目的封面
 * 却优先用播放器的实时/缓存 URL，同一首歌两侧的 URL 常常不是同一个。按 URL 缓存
 * 会让预读在真正需要的那一刻必然 miss，背景先退回上一首的配色再跳一次。
 */
const resolveColorCacheKey = (trackKey: string | null, coverUrl: string | null): string | null => (
    trackKey ?? coverUrl
);

export const useRemoteCoverArt = ({
    backgroundMode,
    trackKey,
    coverUrl,
    prevTrackKey,
    prevTrackCoverUrl,
    nextTrackKey,
    nextTrackCoverUrl,
}: UseRemoteCoverArtParams): RemoteCoverArt => {
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const colorCacheRef = useRef<Map<string, string[]>>(new Map());

    const rememberCoverColors = useCallback((cacheKey: string, colors: string[]) => {
        const cache = colorCacheRef.current;
        cache.delete(cacheKey);
        cache.set(cacheKey, colors);
        while (cache.size > COVER_COLOR_CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            cache.delete(oldest);
        }
    }, []);

    // 换歌时先看预读缓存：命中就直接铺色，背景不用等取色算完再跳一次色
    useEffect(() => {
        if (backgroundMode !== 'cover' || !coverUrl) {
            return;
        }

        const cacheKey = resolveColorCacheKey(trackKey, coverUrl);
        const cached = cacheKey ? colorCacheRef.current.get(cacheKey) : undefined;
        if (cached) {
            setCoverColors(cached);
            return;
        }

        let mounted = true;
        extractColors(coverUrl, 3).then(colors => {
            if (!mounted) return;
            setCoverColors(colors);
            if (colors.length > 0 && cacheKey) {
                rememberCoverColors(cacheKey, colors);
            }
        }).catch(() => {
            if (mounted) setCoverColors([]);
        });

        return () => { mounted = false; };
    }, [coverUrl, trackKey, backgroundMode, rememberCoverColors]);

    useEffect(() => {
        const neighbors = [
            { key: nextTrackKey, url: nextTrackCoverUrl },
            { key: prevTrackKey, url: prevTrackCoverUrl },
        ].filter((neighbor): neighbor is { key: string | null; url: string } => Boolean(neighbor.url));
        if (neighbors.length === 0) {
            return;
        }

        let mounted = true;
        neighbors.forEach(({ url }) => {
            const warmup = new Image();
            warmup.crossOrigin = 'Anonymous';
            warmup.src = url;
        });

        if (backgroundMode !== 'cover') {
            return;
        }

        neighbors.forEach(({ key, url }) => {
            const cacheKey = resolveColorCacheKey(key, url);
            if (!cacheKey || colorCacheRef.current.has(cacheKey)) {
                return;
            }

            extractColors(url, 3).then(colors => {
                if (mounted && colors.length > 0) {
                    rememberCoverColors(cacheKey, colors);
                }
            }).catch(() => { /* 预读失败无所谓，切过去时会照常现取 */ });
        });

        return () => { mounted = false; };
    }, [nextTrackKey, nextTrackCoverUrl, prevTrackKey, prevTrackCoverUrl, backgroundMode, rememberCoverColors]);

    const getCachedCoverColors = useCallback((
        cachedTrackKey: string | null,
        cachedCoverUrl: string | null,
    ): string[] | undefined => {
        const cacheKey = resolveColorCacheKey(cachedTrackKey, cachedCoverUrl);
        return cacheKey ? colorCacheRef.current.get(cacheKey) : undefined;
    }, []);

    return { coverColors, getCachedCoverColors };
};
