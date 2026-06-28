import { neteaseApi } from '../../services/netease';
import type { AmllDbPlatform, LyricData, LyricProviderSource, SongResult } from '../../types';
import { processNeteaseLyrics } from './neteaseProcessing';
import { calculateMatchScore } from './matchScore';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from './providers/kugouLyricProvider';
import { fetchAmllDbLyrics } from './providers/amllDbProvider';

// src/utils/lyrics/lyricMatchSources.ts

const AMLL_DB_SEARCH_LIMIT = 10;

export type LyricMatchSearchTarget = {
    title: string;
    artist: string;
    durationMs: number;
    album?: string;
};

export type LyricMatchFetchResult = {
    lyrics: LyricData | null;
    isPureMusic: boolean;
    matchedLyricsProviderPlatform?: AmllDbPlatform;
};

export const LYRIC_MATCH_SOURCES: readonly LyricProviderSource[] = ['netease', 'amll', 'qq', 'kugou'];

const withAmllDbPlatform = (song: SongResult, platform: AmllDbPlatform): SongResult => ({
    ...song,
    amllDbPlatform: platform,
});

const sortByMatchScore = (songs: SongResult[], target: LyricMatchSearchTarget) => (
    [...songs].sort((a, b) => calculateMatchScore(target, b) - calculateMatchScore(target, a))
);

// Searches NetEase and QQ candidates, then keeps only candidates that have AMLLDB TTML.
export async function searchAmllDbLyricCandidates(
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    const [neteaseResult, qqResult] = await Promise.allSettled([
        neteaseApi.cloudSearch(query, AMLL_DB_SEARCH_LIMIT),
        searchQQLyrics(query, 1, AMLL_DB_SEARCH_LIMIT),
    ]);

    const neteaseSongs = neteaseResult.status === 'fulfilled'
        ? (neteaseResult.value.result?.songs ?? []).map(song => withAmllDbPlatform(song, 'ncm'))
        : [];
    const qqSongs = qqResult.status === 'fulfilled'
        ? qqResult.value.map(song => withAmllDbPlatform(song, 'qq'))
        : [];

    const candidates = sortByMatchScore([...neteaseSongs, ...qqSongs], target).slice(0, AMLL_DB_SEARCH_LIMIT);
    const available: SongResult[] = [];
    for (const candidate of candidates) {
        const platform = candidate.amllDbPlatform;
        if (!platform) {
            continue;
        }
        const lyrics = await fetchAmllDbLyrics(platform, candidate.id);
        if (lyrics) {
            available.push(candidate);
        }
    }

    return available;
}

export async function searchLyricsByMatchSource(
    source: LyricProviderSource,
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    if (source === 'netease') {
        const response = await neteaseApi.cloudSearch(query);
        return sortByMatchScore(response.result?.songs ?? [], target);
    }
    if (source === 'qq') {
        return sortByMatchScore(await searchQQLyrics(query), target);
    }
    if (source === 'kugou') {
        return sortByMatchScore(await searchKugouLyrics(query), target);
    }
    return searchAmllDbLyricCandidates(query, target);
}

export async function fetchLyricsForMatchSource(
    source: LyricProviderSource,
    selectedResult: SongResult,
): Promise<LyricMatchFetchResult | null> {
    if (source === 'netease') {
        const lyricResponse = await neteaseApi.getLyric(selectedResult.id);
        return processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricResponse), { songId: selectedResult.id });
    }
    if (source === 'qq') {
        return {
            lyrics: await fetchQQLyrics(selectedResult),
            isPureMusic: false,
        };
    }
    if (source === 'kugou') {
        return {
            lyrics: await fetchKugouLyrics(selectedResult),
            isPureMusic: false,
        };
    }

    const platform = selectedResult.amllDbPlatform;
    if (!platform) {
        return null;
    }
    return {
        lyrics: await fetchAmllDbLyrics(platform, selectedResult.id),
        isPureMusic: false,
        matchedLyricsProviderPlatform: platform,
    };
}
