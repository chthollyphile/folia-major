import type { AmllDbPlatform, LyricData } from '../../../types';
import { parseLyricsByFormat } from '../parserCore';

// src/utils/lyrics/providers/amllDbProvider.ts

const AMLL_DB_BASE_URL = 'https://amll-ttml-db.stevexmh.net';
const isElectron = typeof window !== 'undefined' && (window as any).electron;

export const buildAmllDbLyricsUrl = (platform: AmllDbPlatform, musicId: number | string): string => (
    `${AMLL_DB_BASE_URL}/${platform}/${encodeURIComponent(String(musicId))}?format=ttml`
);

const buildAmllDbRequestUrl = (platform: AmllDbPlatform, musicId: number | string): string => {
    const targetUrl = buildAmllDbLyricsUrl(platform, musicId);
    return isElectron ? targetUrl : `/api/lyric-proxy?url=${encodeURIComponent(targetUrl)}`;
};

export async function fetchAmllDbLyrics(
    platform: AmllDbPlatform,
    musicId: number | string,
): Promise<LyricData | null> {
    const id = String(musicId).trim();
    if (!id) {
        return null;
    }

    try {
        const response = await fetch(buildAmllDbRequestUrl(platform, id));
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
        console.warn(`[AMLLDB] Failed to fetch ${platform}/${id}:`, error);
        return null;
    }
}
