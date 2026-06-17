import { LyricData, SongResult } from '../../types';
import { neteaseApi } from '../../services/netease';
import { processNeteaseLyrics } from './neteaseProcessing';
import type { NeteaseChorusRange } from './chorusEffects';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from './providers/kugouLyricProvider';
import { normalizeLyricMatchDurationMs } from './duration';
import { calculateMatchScoreDetails } from './matchScore';
import { buildLyricSearchQuery } from './searchQuery';

// src/utils/lyrics/autoMatchBestLyric.ts
// Utility module for automatically matching the best word-by-word lyrics across multiple sources.

const PROVIDER_SEARCH_TIMEOUT_MS = 3500;
const PROVIDER_LYRIC_TIMEOUT_MS = 5000;
const AUTO_MATCH_SEARCH_LIMIT = 10;
const AUTO_MATCH_MIN_SCORE = 75;
const SHOULD_LOG_MATCH_DETAILS = import.meta.env.DEV;

export interface AutoMatchBestLyricOptions {
    album?: string;
    preferredSource?: 'netease' | 'qq' | 'kugou';
    neteaseCandidate?: {
        id: number | string;
        lyrics: LyricData | null;
        isPureMusic?: boolean;
        chorusRanges?: NeteaseChorusRange[];
    };
}

export type AutoMatchBestLyricMatch = {
    lyrics: LyricData;
    source: 'netease' | 'qq' | 'kugou';
    id: number | string;
    qqMid?: string;
    kgHash?: string;
    isPureMusic?: false;
};

export type AutoMatchBestLyricPureMusic = {
    isPureMusic: true;
};

export type AutoMatchBestLyricResult = AutoMatchBestLyricMatch | AutoMatchBestLyricPureMusic | null;

function selectBestCandidate(
    source: 'netease' | 'qq' | 'kugou',
    songs: SongResult[],
    target: { title: string; artist: string; durationMs: number; album?: string }
): SongResult | null {
    const isReliableCandidate = (details: ReturnType<typeof calculateMatchScoreDetails>) =>
        details.titleMatched && (details.artistMatched || details.albumMatched === true);

    const scored = songs
        .slice(0, AUTO_MATCH_SEARCH_LIMIT)
        .map(song => ({
            song,
            details: calculateMatchScoreDetails(target, song)
        }))
        .sort((a, b) => b.details.score - a.details.score);

    if (SHOULD_LOG_MATCH_DETAILS) {
        for (const item of scored) {
            console.log(
                `[autoMatchBestLyric] ${source} candidate "${item.song.name}" score=${item.details.score} ` +
                `(title=${item.details.titleMatched ? 'hit' : 'miss'}, artist=${item.details.artistMatched ? 'hit' : 'miss'}, ` +
                `album=${item.details.albumMatched === null ? 'n/a' : (item.details.albumMatched ? 'hit' : 'miss')}, ` +
                `duration=${item.details.durationMatched === null ? 'n/a' : (item.details.durationMatched ? 'hit' : 'miss')})`
            );
        }
    }

    const best = scored.find(item => isReliableCandidate(item.details)) ?? scored[0];
    if (!best) {
        return null;
    }

    console.log(`[autoMatchBestLyric] Best ${source} candidate: "${best.song.name}" score=${best.details.score}`);
    if (!isReliableCandidate(best.details)) {
        console.log(`[autoMatchBestLyric] Skipping ${source} candidate because title and identity fields did not match`);
        return null;
    }
    if (best.details.score < AUTO_MATCH_MIN_SCORE) {
        console.log(`[autoMatchBestLyric] Skipping ${source} candidate because score ${best.details.score} is below ${AUTO_MATCH_MIN_SCORE}`);
        return null;
    }

    return best.song;
}

// Bounds slow remote providers so one source cannot block the whole automatic match.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => {
                    console.warn(`[autoMatchBestLyric] ${label} timed out after ${timeoutMs}ms`);
                    resolve(fallback);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

/**
 * Searches and matches the best word-by-word lyric across NetEase, QQ Music, and Kugou Music.
 * Priority: NetEase > QQ Music > Kugou Music.
 * A match is considered perfect if duration difference is <= 3s and title is matched.
 * Returns the parsed lyrics and matching details, or null if no perfect match is found.
 */
export async function autoMatchBestLyric(
    title: string,
    artist: string,
    durationMs: number,
    options: AutoMatchBestLyricOptions = {}
): Promise<AutoMatchBestLyricResult> {
    const searchQuery = buildLyricSearchQuery(title, artist, options.album);
    const normalizedDurationMs = normalizeLyricMatchDurationMs(durationMs);
    console.log(`[autoMatchBestLyric] Initiating best lyric auto-match for "${searchQuery}" (Duration: ${normalizedDurationMs}ms)`);
    const targetSong = { title, artist, album: options.album, durationMs: normalizedDurationMs };
    let neteaseChorusRanges: NeteaseChorusRange[] = options.neteaseCandidate?.chorusRanges ?? [];

    const defaultOrder = ['netease', 'qq', 'kugou'] as const;
    const searchOrder = options.preferredSource
        ? [options.preferredSource, ...defaultOrder.filter(s => s !== options.preferredSource)]
        : defaultOrder;

    for (const searchSource of searchOrder) {
        if (searchSource === 'netease') {
            // 1. NetEase Music
            try {
                let candidateSongs: any[];
                if (options.neteaseCandidate) {
                    candidateSongs = [{ id: options.neteaseCandidate.id, name: title, ar: artist ? [{ name: artist }] : [] }];
                } else {
                    const neteaseSearchRes = await withTimeout(
                        neteaseApi.cloudSearch(searchQuery, AUTO_MATCH_SEARCH_LIMIT),
                        PROVIDER_SEARCH_TIMEOUT_MS,
                        'NetEase search',
                        { result: { songs: [] } }
                    );
                    const neteaseSongs = neteaseSearchRes.result?.songs || [];
                    const bestCandidate = selectBestCandidate('netease', neteaseSongs, targetSong);
                    candidateSongs = bestCandidate ? [bestCandidate] : [];
                }

                for (const song of candidateSongs) {
                    console.log(`[autoMatchBestLyric] Checking NetEase candidate: "${song.name}" by "${song.ar?.map((a: any) => a.name).join(', ')}"`);
                    const processed = String(options.neteaseCandidate?.id) === String(song.id)
                        ? {
                            lyrics: options.neteaseCandidate.lyrics,
                            isPureMusic: options.neteaseCandidate.isPureMusic ?? false,
                            chorusRanges: options.neteaseCandidate.chorusRanges ?? []
                        }
                        : await withTimeout(
                            (async () => {
                                const lyricRes = await neteaseApi.getLyric(song.id);
                                return processNeteaseLyrics(
                                    {
                                        type: 'netease',
                                        ...lyricRes
                                    },
                                    { songId: song.id }
                                );
                            })(),
                            PROVIDER_LYRIC_TIMEOUT_MS,
                            `NetEase lyric fetch for ${song.id}`,
                            null
                        );

                    if (!processed) {
                        continue;
                    }

                    if (processed.isPureMusic) {
                        console.log(`[autoMatchBestLyric] NetEase candidate "${song.name}" is pure music. Skipping alternative lyric sources.`);
                        return { isPureMusic: true };
                    }

                    if (processed.chorusRanges && processed.chorusRanges.length > 0) {
                        neteaseChorusRanges = processed.chorusRanges;
                    }

                    if (processed.lyrics && processed.lyrics.isWordByWord) {
                        console.log(`[autoMatchBestLyric] Found perfect NetEase word-by-word lyric match!`);
                        return {
                            lyrics: processed.lyrics,
                            source: 'netease',
                            id: song.id
                        };
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] NetEase search/fetch failed:`, error);
            }
        } else if (searchSource === 'qq') {
            // 2. QQ Music
            try {
                const qqSongs = await withTimeout(
                    searchQQLyrics(searchQuery, 1, AUTO_MATCH_SEARCH_LIMIT),
                    PROVIDER_SEARCH_TIMEOUT_MS,
                    'QQ search',
                    []
                );
                const bestCandidate = selectBestCandidate('qq', qqSongs, targetSong);
                const candidateSongs = bestCandidate ? [bestCandidate] : [];

                for (const song of candidateSongs) {
                    console.log(`[autoMatchBestLyric] Checking QQ candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
                    const parsedLyrics = await withTimeout(
                        fetchQQLyrics(song, { chorusRanges: neteaseChorusRanges }),
                        PROVIDER_LYRIC_TIMEOUT_MS,
                        `QQ lyric fetch for ${song.id}`,
                        null
                    );
                    if (parsedLyrics && parsedLyrics.isWordByWord) {
                        console.log(`[autoMatchBestLyric] Found perfect QQ word-by-word lyric match!`);
                        return {
                            lyrics: parsedLyrics,
                            source: 'qq',
                            id: song.id,
                            qqMid: song.qqMid
                        };
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] QQ search/fetch failed:`, error);
            }
        } else if (searchSource === 'kugou') {
            // 3. Kugou Music
            try {
                const kugouSongs = await withTimeout(
                    searchKugouLyrics(searchQuery, 1, AUTO_MATCH_SEARCH_LIMIT),
                    PROVIDER_SEARCH_TIMEOUT_MS,
                    'Kugou search',
                    []
                );
                const bestCandidate = selectBestCandidate('kugou', kugouSongs, targetSong);
                const candidateSongs = bestCandidate ? [bestCandidate] : [];

                for (const song of candidateSongs) {
                    console.log(`[autoMatchBestLyric] Checking Kugou candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
                    const parsedLyrics = await withTimeout(
                        fetchKugouLyrics(song, { chorusRanges: neteaseChorusRanges }),
                        PROVIDER_LYRIC_TIMEOUT_MS,
                        `Kugou lyric fetch for ${song.id}`,
                        null
                    );
                    if (parsedLyrics && parsedLyrics.isWordByWord) {
                        console.log(`[autoMatchBestLyric] Found perfect Kugou word-by-word lyric match!`);
                        return {
                            lyrics: parsedLyrics,
                            source: 'kugou',
                            id: song.id,
                            kgHash: song.kgHash
                        };
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] Kugou search/fetch failed:`, error);
            }
        }
    }

    console.log(`[autoMatchBestLyric] No perfect word-by-word lyric match found across any source.`);
    return null;
}
