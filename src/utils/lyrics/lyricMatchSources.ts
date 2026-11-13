import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import { isParticipantReady } from '../../services/onlineMusic/crossSource';
import type { AmllDbPlatform, LyricData, LyricProviderSource, SongResult } from '../../types';
import { calculateMatchScore } from './matchScore';
import { fetchAmllDbLyrics, getAmllDbMusicIds, searchAmllDbSongs } from './providers/amllDbProvider';
import { buildAmllDbSearchQueries, toAmllDbSongResults } from './amllDbCandidates';
import { applyChorusRangesByTime } from './chorusEffects';
import { hasRenderableLyrics } from './validity';
import { getLyricSourceOwnAccess, type LyricMatchSearchTarget, type LyricSourceAccess, type LyricSourceLyrics } from './lyricSources';

// src/utils/lyrics/lyricMatchSources.ts
// How each lyric source of lyricSources.ts is searched and fetched: for the match windows, for
// the automatic pick and for the metadata search. A platform source is reached through its
// provider, unless its own folder registered how else (registerLyricSourceAccess); AMLL DB, the
// host's own source, is reached here.

export type { LyricMatchSearchTarget, LyricSourceAccess, LyricSourceLyrics };

const AMLL_DB_SEARCH_PAGE_SIZE = 50;
const AMLL_DB_MAX_RESULTS = 20;
const MATCH_WINDOW_SEARCH_LIMIT = 50;

export type LyricMatchFetchResult = {
    lyrics: LyricData | null;
    isPureMusic: boolean;
    matchedLyricsProviderPlatform?: AmllDbPlatform;
};

// Whether the source takes part in the lyric match now (crossSource.ts): its platform is there and set up,
// and signed in where it answers only with an account. A source that is not registered does not.
export const isLyricMatchSourceOffered = (source: LyricProviderSource): boolean => isParticipantReady('lyrics', source);

// The online platform AMLL DB keeps a lyric under, by AMLL DB's own name for it: its chorus ranges are that
// platform's to give.
const AMLL_DB_PLATFORM_SOURCES: Record<AmllDbPlatform, LyricProviderSource> = { ncm: 'netease', qq: 'qq' };

/** The chorus ranges of the song `songId` as the platform AMLL DB kept it under has them; none while that platform is not there. */
export const getAmllDbPlatformChorusRanges = async (platform: AmllDbPlatform, songId: number | string) => {
    const source = AMLL_DB_PLATFORM_SOURCES[platform];
    if (!isLyricMatchSourceOffered(source)) return [];
    return await getOnlineMusicProvider(source)?.lyrics?.getChorusRanges?.(songId) ?? [];
};

const sortByMatchScore = (songs: SongResult[], target: LyricMatchSearchTarget) => (
    [...songs].sort((a, b) => calculateMatchScore(target, b) - calculateMatchScore(target, a))
);

const hasChorusMarkers = (lyrics: LyricData | null): boolean => (
    Boolean(lyrics?.lines.some(line => line.isChorus))
);

// AMLL 官方搜索直接返回已收录的歌曲，不用再先搜网易云 / QQ 后逐个探测（#515）。
// 按 buildAmllDbSearchQueries 的顺序搜，有结果就停；请求失败（限流、网络错误）时直接停止，不再发兜底请求。
export async function searchAmllDbLyricCandidates(
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    for (const params of buildAmllDbSearchQueries(query)) {
        const items = await searchAmllDbSongs(params, AMLL_DB_SEARCH_PAGE_SIZE);
        if (items === null) {
            return [];
        }
        const candidates = toAmllDbSongResults(items);
        if (candidates.length > 0) {
            return sortByMatchScore(candidates, target).slice(0, AMLL_DB_MAX_RESULTS);
        }
    }
    return [];
}

// The AMLL DB lyric of a candidate its search gave, with NetEase's chorus ranges when the lyric
// was kept under a NetEase id and marks no chorus itself.
async function fetchAmllDbCandidateLyrics(song: SongResult): Promise<LyricSourceLyrics | null> {
    const platform = song.amllDbPlatform;
    if (!platform) {
        return null;
    }
    const fetchedLyrics = await fetchAmllDbLyrics(platform, getAmllDbMusicIds(platform, song));
    const lyrics = hasRenderableLyrics(fetchedLyrics) ? fetchedLyrics : null;
    // Only NetEase's ranges were ever asked for here (a QQ lyric's chorus comes with QQ's own fetch).
    const chorusRanges = platform === 'ncm' && !hasChorusMarkers(lyrics)
        ? await getAmllDbPlatformChorusRanges(platform, song.id)
        : [];

    return {
        lyrics: lyrics && chorusRanges.length > 0
            ? applyChorusRangesByTime(lyrics, chorusRanges)
            : lyrics,
        isPureMusic: false,
        matchedLyricsProviderPlatform: platform,
    };
}

// A platform source is searched and fetched through the provider registered under its id, and
// knows a song by its id.
const platformAccess = (providerId: LyricProviderSource): LyricSourceAccess => ({
    search: async (query, limit) => (await getOnlineMusicProvider(providerId)?.search?.searchSongs(query, limit, 0))?.items ?? [],
    fetch: async song => await getOnlineMusicProvider(providerId)?.lyrics?.getLyrics(song) ?? null,
    songKey: song => String(song.id),
});

// AMLL DB is searched through its own API, by the words typed like the platforms (#515).
const AMLL_DB_ACCESS: Partial<LyricSourceAccess> = {
    search: (query, _limit, target) => searchAmllDbLyricCandidates(query, target),
    fetch: song => fetchAmllDbCandidateLyrics(song),
};

/**
 * How `source` is searched and fetched: as its platform, with what its own folder registered over that
 * (registerLyricSourceAccess); AMLL DB as the host reaches it.
 */
export const getLyricSourceAccess = (source: LyricProviderSource): LyricSourceAccess => ({
    ...platformAccess(source),
    ...(source === 'amll' ? AMLL_DB_ACCESS : getLyricSourceOwnAccess(source)),
});

export async function searchLyricsByMatchSource(
    source: LyricProviderSource,
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    return sortByMatchScore(await getLyricSourceAccess(source).search(query, MATCH_WINDOW_SEARCH_LIMIT, target), target);
}

export async function fetchLyricsForMatchSource(
    source: LyricProviderSource,
    selectedResult: SongResult,
): Promise<LyricMatchFetchResult | null> {
    const result = await getLyricSourceAccess(source).fetch(selectedResult, { chorusRanges: [] });
    if (!result) return null;
    return {
        lyrics: hasRenderableLyrics(result.lyrics) ? result.lyrics : null,
        isPureMusic: result.isPureMusic,
        ...(result.matchedLyricsProviderPlatform ? { matchedLyricsProviderPlatform: result.matchedLyricsProviderPlatform } : {}),
    };
}
