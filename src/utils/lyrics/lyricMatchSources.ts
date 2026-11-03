import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { AmllDbPlatform, LyricData, LyricProviderSource, SongResult } from '../../types';
import type { ChorusRange, ProviderLyricsResult } from '../../types/onlineMusic';
import { calculateMatchScore } from './matchScore';
import { searchQQLyrics, fetchQQLyrics } from '../../services/onlineMusic/qq/qqLyricProvider';
import { fetchAmllDbLyrics, getAmllDbMusicIds, searchAmllDbSongs } from './providers/amllDbProvider';
import { buildAmllDbSearchQueries, toAmllDbSongResults } from './amllDbCandidates';
import { applyChorusRangesByTime } from './chorusEffects';
import { hasRenderableLyrics } from './validity';
import { LYRIC_SOURCE_IDS, getLyricSource } from './lyricSources';

// src/utils/lyrics/lyricMatchSources.ts
// How each lyric source of lyricSources.ts is searched and fetched: for the match windows, for
// the automatic pick and for the metadata search.

const AMLL_DB_SEARCH_PAGE_SIZE = 50;
const AMLL_DB_MAX_RESULTS = 20;
const MATCH_WINDOW_SEARCH_LIMIT = 50;
// QQ's search has only ever been asked for one page of 20 songs at most.
const QQ_SEARCH_PAGE_MAX = 20;

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

// What a source gives for one song. A lyric from AMLL DB names the platform it was kept under.
export type LyricSourceLyrics = ProviderLyricsResult & { matchedLyricsProviderPlatform?: AmllDbPlatform };

export interface LyricSourceAccess {
    /**
     * The source's songs for `query`, `limit` of them at most. `target` is the song being matched,
     * for a source that has to choose its candidates itself.
     */
    search(query: string, limit: number, target: LyricMatchSearchTarget): Promise<SongResult[]>;
    /**
     * The lyrics of one of the source's songs, or null when the source cannot be asked.
     * `lent.chorusRanges` are chorus ranges found elsewhere, for a fetch that marks the chorus itself.
     */
    fetch(song: SongResult, lent: { chorusRanges: ChorusRange[] }): Promise<LyricSourceLyrics | null>;
    /** What the source knows a song by, as text: two songs with one key are the same song there. */
    songKey(song: Pick<SongResult, 'id' | 'qqMid' | 'kgHash'>): string;
    /**
     * Set when a song's id alone is enough to fetch its lyrics: gives the id to fetch with, or
     * null when `songId` cannot be one of the source's. Without it, a song picked for the source
     * is looked for among the source's search results.
     */
    knownById?(songId: number | string): number | string | null;
    /** True when the chorus ranges it gives are kept, to be lent to a fetch that marks the chorus itself. */
    sharesChorusRanges?: boolean;
    /** True when its fetch has marked the chorus already, from the ranges lent to it or from its own text. */
    marksChorusOnFetch?: boolean;
}

// A source that needs an account is a source only while one is signed in.
export const isLyricMatchSourceOffered = (source: LyricProviderSource): boolean => {
    const entry = getLyricSource(source);
    if (entry.needsConfiguredProvider) {
        const provider = getOnlineMusicProvider(source);
        if (!provider || provider.getAvailability?.().configured === false) return false;
    }
    return !entry.needsAccount || Boolean(useOnlineProviderAccountStore.getState().accounts[source]?.user);
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
    const chorusRanges = platform === 'ncm' && !hasChorusMarkers(lyrics)
        ? await getOnlineMusicProvider('netease')?.lyrics?.getChorusRanges?.(song.id) ?? []
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

// Where a source differs from that. A source with no entry here is reached as its platform alone.
const OWN_ACCESS: Partial<Record<LyricProviderSource, Partial<LyricSourceAccess>>> = {
    netease: {
        knownById: (songId) => {
            const numericId = typeof songId === 'number' ? songId : Number(songId);
            return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
        },
        sharesChorusRanges: true,
    },
    // AMLL DB is searched through its own API, by the words typed like the platforms (#515).
    amll: {
        search: (query, _limit, target) => searchAmllDbLyricCandidates(query, target),
        fetch: song => fetchAmllDbCandidateLyrics(song),
    },
    // QQ's lyrics are read from QQ's own lyric service, which needs no QQ account and knows a
    // song by its mid.
    qq: {
        search: (query, limit) => searchQQLyrics(query, 1, Math.min(limit, QQ_SEARCH_PAGE_MAX)),
        fetch: async (song, lent) => ({ lyrics: await fetchQQLyrics(song, lent) ?? null, isPureMusic: false }),
        songKey: song => String(song.qqMid ?? song.id),
        marksChorusOnFetch: true,
    },
    kugou: {
        songKey: song => String(song.kgHash ?? song.id).toUpperCase(),
    },
    // Its track ids are 1-30 digits, past what a number holds exactly: kept as text, never made a number.
    qishui: {
        knownById: songId => (typeof songId === 'string' ? /^\d{1,30}$/.test(songId) ? songId : null
            : Number.isSafeInteger(songId) && songId >= 0 ? String(songId) : null),
    },
};

const accessBySource = new Map<LyricProviderSource, LyricSourceAccess>(
    LYRIC_SOURCE_IDS.map(source => [source, { ...platformAccess(source), ...OWN_ACCESS[source] }]),
);

export const getLyricSourceAccess = (source: LyricProviderSource): LyricSourceAccess => (
    accessBySource.get(source) as LyricSourceAccess
);

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
