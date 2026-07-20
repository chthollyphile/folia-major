import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import type { AmllDbPlatform, LyricData, LyricProviderSource, SongResult } from '../../types';
import { calculateMatchScore, calculateMatchScoreDetails } from './matchScore';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { fetchAmllDbLyrics } from './providers/amllDbProvider';
import { applyNeteaseChorusByTime } from './chorusEffects';

// src/utils/lyrics/lyricMatchSources.ts

const AMLL_DB_SEARCH_LIMIT_PER_SOURCE = 5;
const AMLL_DB_MAX_PROBES = 4;
const AMLL_DB_MAX_RESULTS = 5;

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

export const sourceSupportsManualSearch = (source: LyricProviderSource): boolean => source !== 'amll';

const withAmllDbPlatform = (song: SongResult, platform: AmllDbPlatform): SongResult => ({
    ...song,
    amllDbPlatform: platform,
});

const sortByMatchScore = (songs: SongResult[], target: LyricMatchSearchTarget) => (
    [...songs].sort((a, b) => calculateMatchScore(target, b) - calculateMatchScore(target, a))
);

const hasChorusMarkers = (lyrics: LyricData | null): boolean => (
    Boolean(lyrics?.lines.some(line => line.isChorus))
);

const getAmllDbCandidateKey = (song: SongResult): string => `${song.amllDbPlatform ?? 'unknown'}:${song.id}`;

function shouldProbeAmllDbCandidate(song: SongResult, target: LyricMatchSearchTarget): boolean {
    const details = calculateMatchScoreDetails(target, song);
    if (!details.titleMatched) {
        return false;
    }

    const identityMatched = details.artistMatched || details.albumMatched === true;
    if (!identityMatched) {
        return false;
    }

    return details.score >= 72 && details.durationMatched !== false;
}

// Searches NetEase and QQ candidates, then keeps only candidates that have AMLLDB TTML.
export async function searchAmllDbLyricCandidates(
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    const [neteaseResult, qqResult] = await Promise.allSettled([
        getOnlineMusicProvider('netease')?.search?.searchSongs(query, AMLL_DB_SEARCH_LIMIT_PER_SOURCE, 0)
            || Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
        searchQQLyrics(query, 1, AMLL_DB_SEARCH_LIMIT_PER_SOURCE),
    ]);

    const neteaseSongs = neteaseResult.status === 'fulfilled'
        ? neteaseResult.value.items.map(song => withAmllDbPlatform(song, 'ncm'))
        : [];
    const qqSongs = qqResult.status === 'fulfilled'
        ? qqResult.value.map(song => withAmllDbPlatform(song, 'qq'))
        : [];

    const seen = new Set<string>();
    const candidates = sortByMatchScore([...neteaseSongs, ...qqSongs], target)
        .filter(candidate => {
            const key = getAmllDbCandidateKey(candidate);
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return shouldProbeAmllDbCandidate(candidate, target);
        })
        .slice(0, AMLL_DB_MAX_PROBES);

    const probes = candidates.map(async (candidate) => {
        const platform = candidate.amllDbPlatform;
        if (!platform) {
            return null;
        }

        const lyrics = await fetchAmllDbLyrics(platform, candidate.id);
        return lyrics ? candidate : null;
    });

    const results = await Promise.all(probes);
    const available = results.filter((candidate): candidate is SongResult => candidate !== null)
        .slice(0, AMLL_DB_MAX_RESULTS);

    return available;
}

export async function searchLyricsByMatchSource(
    source: LyricProviderSource,
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    if (source === 'netease') {
        const page = await getOnlineMusicProvider('netease')?.search?.searchSongs(query, 50, 0);
        return sortByMatchScore(page?.items || [], target);
    }
    if (source === 'qq') {
        return sortByMatchScore(await searchQQLyrics(query), target);
    }
    if (source === 'kugou') {
        const page = await getOnlineMusicProvider('kugou')?.search?.searchSongs(query, 50, 0);
        return sortByMatchScore(page?.items || [], target);
    }
    return searchAmllDbLyricCandidates(query, target);
}

export async function fetchLyricsForMatchSource(
    source: LyricProviderSource,
    selectedResult: SongResult,
): Promise<LyricMatchFetchResult | null> {
    if (source === 'netease') {
        const result = await getOnlineMusicProvider('netease')?.lyrics?.getLyrics(selectedResult);
        if (!result) return null;
        return {
            lyrics: result.lyrics,
            isPureMusic: result.isPureMusic,
        };
    }
    if (source === 'qq') {
        return {
            lyrics: await fetchQQLyrics(selectedResult),
            isPureMusic: false,
        };
    }
    if (source === 'kugou') {
        const result = await getOnlineMusicProvider('kugou')?.lyrics?.getLyrics(selectedResult);
        if (!result) return null;
        return { lyrics: result.lyrics, isPureMusic: result.isPureMusic };
    }

    const platform = selectedResult.amllDbPlatform;
    if (!platform) {
        return null;
    }
    const lyrics = await fetchAmllDbLyrics(platform, selectedResult.id);
    const chorusRanges = platform === 'ncm' && !hasChorusMarkers(lyrics)
        ? await getOnlineMusicProvider('netease')?.lyrics?.getChorusRanges?.(selectedResult.id) ?? []
        : [];

    return {
        lyrics: lyrics && chorusRanges.length > 0
            ? applyNeteaseChorusByTime(lyrics, chorusRanges)
            : lyrics,
        isPureMusic: false,
        matchedLyricsProviderPlatform: platform,
    };
}
