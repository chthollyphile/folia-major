import type { AmllDbPlatform, LyricData, SongResult } from '../../../types';
import { parseLyricsByFormat } from '../parserCore';
import {
    buildAmllApiLyricsUrl,
    buildAmllApiSearchUrl,
    getAmllApiData,
    type AmllApiSearchPage,
    type AmllApiSearchParams,
    type AmllApiSongItem,
} from './amllApi';

// src/utils/lyrics/providers/amllDbProvider.ts

const AMLL_DB_CACHE_LIMIT = 200;
const lyricsCache = new Map<string, Promise<LyricData | null>>();

type AmllDbMusicId = number | string | null | undefined;

const normalizeMusicIds = (ids: readonly AmllDbMusicId[]): string[] => ids
    .map(id => String(id ?? '').trim())
    .filter((id, index, all) => id && all.indexOf(id) === index);

export function clearAmllDbLyricsCache(): void {
    lyricsCache.clear();
}

// AMLL 里 QQ 歌曲有的按 mid 收录，有的按数字 ID 收录（约 2:1），两种都要试；mid 在前。
// 音源模组的歌 id 就是 mid，数字 ID 在 sourceRef.providerData.songId（模组归一时放的）；旧的歌 id 本身就是数字 ID。
const numericSongIdOf = (ref: SongResult['sourceRef']): AmllDbMusicId => {
    const songId = ref?.kind === 'online' ? ref.providerData?.songId : undefined;
    return typeof songId === 'number' || typeof songId === 'string' ? songId : undefined;
};

export function getAmllDbMusicIds(
    platform: AmllDbPlatform,
    song: Pick<SongResult, 'id' | 'qqMid' | 'sourceRef'>,
): string[] {
    return normalizeMusicIds(platform === 'qq' ? [song.qqMid, song.id, numericSongIdOf(song.sourceRef)] : [song.id]);
}

async function fetchAmllDbLyricsUncached(
    platform: AmllDbPlatform,
    musicId: string,
): Promise<LyricData | null> {
    try {
        const song = await getAmllApiData<AmllApiSongItem>(buildAmllApiLyricsUrl(platform, musicId));
        const ttml = song?.lyrics;
        if (!ttml?.trim() || !/<tt(?:\s|>)/i.test(ttml)) {
            return null;
        }

        const parsed = parseLyricsByFormat('ttml', ttml);
        return parsed?.lines?.length ? parsed : null;
    } catch (error) {
        console.warn(`[AMLLDB] Failed to fetch ${platform}/${musicId}:`, error);
        return null;
    }
}

function fetchAmllDbLyricsCached(platform: AmllDbPlatform, id: string): Promise<LyricData | null> {
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

// 传入多个 ID 时按顺序逐个查询，返回第一个有歌词的结果
export async function fetchAmllDbLyrics(
    platform: AmllDbPlatform,
    musicId: AmllDbMusicId | readonly AmllDbMusicId[],
): Promise<LyricData | null> {
    for (const id of normalizeMusicIds(Array.isArray(musicId) ? musicId : [musicId])) {
        const lyrics = await fetchAmllDbLyricsCached(platform, id);
        if (lyrics) {
            return lyrics;
        }
    }
    return null;
}

// 官方搜索。没有结果返回空列表；限流、服务端错误、网络错误返回 null，调用方据此区分「搜不到」和「没搜成」
export async function searchAmllDbSongs(
    params: AmllApiSearchParams,
    pageSize: number,
): Promise<AmllApiSongItem[] | null> {
    try {
        const page = await getAmllApiData<AmllApiSearchPage>(buildAmllApiSearchUrl(params, pageSize));
        return page ? page.items : null;
    } catch (error) {
        console.warn('[AMLLDB] Search failed:', params, error);
        return null;
    }
}
