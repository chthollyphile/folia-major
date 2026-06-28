import type { AmllDbPlatform, LyricData } from '../../../types';
import { parseLyricsByFormat } from '../parserCore';

// src/utils/lyrics/providers/amllDbProvider.ts

const AMLL_DB_BASE_URL = 'https://amll-ttml-db.stevexmh.net';
const AMLL_DB_CACHE_LIMIT = 200;
const AMLL_DB_FETCH_TIMEOUT_MS = 5000;
const isElectron = typeof window !== 'undefined' && (window as any).electron;
const lyricsCache = new Map<string, Promise<LyricData | null>>();

export const buildAmllDbLyricsUrl = (platform: AmllDbPlatform, musicId: number | string): string => (
    `${AMLL_DB_BASE_URL}/${platform}/${encodeURIComponent(String(musicId))}?format=ttml`
);

const buildAmllDbRequestUrl = (platform: AmllDbPlatform, musicId: number | string): string => {
    const targetUrl = buildAmllDbLyricsUrl(platform, musicId);
    return isElectron ? targetUrl : `/api/lyric-proxy?url=${encodeURIComponent(targetUrl)}`;
};

export function clearAmllDbLyricsCache(): void {
    lyricsCache.clear();
}

async function fetchAmllDbLyricsUncached(
    platform: AmllDbPlatform,
    musicId: number | string,
): Promise<LyricData | null> {
    try {
        const response = await fetch(buildAmllDbRequestUrl(platform, musicId), {
            credentials: 'omit',
            signal: AbortSignal.timeout(AMLL_DB_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            return null;
        }

        const ttml = await response.text();
        if (!ttml.trim() || !/<tt(?:\s|>)/i.test(ttml)) {
            return null;
        }

        const parsed = parseLyricsByFormat('ttml', ttml);
        return parsed?.lines?.length ? parsed : null;
    } catch (error) {
        console.warn(`[AMLLDB] Failed to fetch ${platform}/${musicId}:`, error);
        return null;
    }
}

export async function fetchAmllDbLyrics(
    platform: AmllDbPlatform,
    musicId: number | string,
): Promise<LyricData | null> {
    const id = String(musicId).trim();
    if (!id) {
        return null;
    }

    const cacheKey = `${platform}:${id}`;
    const cached = lyricsCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const request = fetchAmllDbLyricsUncached(platform, id);
    lyricsCache.set(cacheKey, request);
    if (lyricsCache.size > AMLL_DB_CACHE_LIMIT) {
        const oldestKey = lyricsCache.keys().next().value;
        if (oldestKey) {
            lyricsCache.delete(oldestKey);
        }
    }

    return request;
}
