import { LyricData, LyricProviderSource, SongResult } from '../../types';
import { neteaseApi } from '../../services/netease';
import { fetchNeteaseChorusRanges, processNeteaseLyrics } from './neteaseProcessing';
import { applyNeteaseChorusByTime } from './chorusEffects';
import type { NeteaseChorusRange } from './chorusEffects';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from './providers/kugouLyricProvider';
import { fetchAmllDbLyrics } from './providers/amllDbProvider';
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

const hasChorusMarkers = (lyrics: LyricData | null): boolean => (
    Boolean(lyrics?.lines.some(line => line.isChorus))
);

export interface AutoMatchBestLyricOptions {
    album?: string;
    preferredSource?: LyricProviderSource;
    allowLineSyncedFallback?: boolean;
    neteaseCandidate?: {
        id: number | string;
        lyrics: LyricData | null;
        isPureMusic?: boolean;
        chorusRanges?: NeteaseChorusRange[];
    };
}

export type AutoMatchBestLyricMatch = {
    lyrics: LyricData;
    source: LyricProviderSource;
    id: number | string;
    qqMid?: string;
    kgHash?: string;
    matchedLyricsProviderPlatform?: 'ncm' | 'qq';
    isPureMusic?: false;
};

export type AutoMatchBestLyricPureMusic = {
    isPureMusic: true;
};

export type AutoMatchBestLyricResult = AutoMatchBestLyricMatch | AutoMatchBestLyricPureMusic | null;

export const hasSynchronizedLyricTimeline = (lyrics: LyricData | null): lyrics is LyricData => {
    if (!lyrics || lyrics.lines.length === 0) {
        return false;
    }

    const timedLines = lyrics.lines.filter(line => (
        Number.isFinite(line.startTime)
        && Number.isFinite(line.endTime)
        && line.startTime >= 0
        && line.endTime > line.startTime
        && line.fullText.trim().length > 0
    ));
    const timedWords = timedLines.flatMap(line => line.words).filter(word => (
        Number.isFinite(word.startTime)
        && Number.isFinite(word.endTime)
        && word.endTime > word.startTime
    ));
    if (timedWords.length >= 2) {
        const firstWordStart = Math.min(...timedWords.map(word => word.startTime));
        const lastWordEnd = Math.max(...timedWords.map(word => word.endTime));
        if (lastWordEnd - firstWordStart >= 0.5) {
            return true;
        }
    }

    if (timedLines.length < 2) {
        return false;
    }

    const firstLineStart = Math.min(...timedLines.map(line => line.startTime));
    const lastLineEnd = Math.max(...timedLines.map(line => line.endTime));
    if (lastLineEnd - firstLineStart >= 1) {
        return true;
    }

    return false;
};

function selectBestCandidate(
    source: LyricProviderSource,
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
    let neteaseCandidateSongs: any[] | null = null;
    let qqBestCandidate: SongResult | null | undefined;
    let synchronizedFallback: AutoMatchBestLyricMatch | null = null;

    const captureSynchronizedFallback = (candidate: AutoMatchBestLyricMatch) => {
        if (options.allowLineSyncedFallback && !synchronizedFallback && hasSynchronizedLyricTimeline(candidate.lyrics)) {
            synchronizedFallback = candidate;
        }
    };

    const defaultOrder = ['netease', 'amll', 'qq', 'kugou'] as const;
    const searchOrder = options.preferredSource
        ? [options.preferredSource, ...defaultOrder.filter(s => s !== options.preferredSource)]
        : defaultOrder;

    const getNeteaseCandidateSongs = async (): Promise<any[]> => {
        if (neteaseCandidateSongs) {
            return neteaseCandidateSongs;
        }
        if (options.neteaseCandidate) {
            neteaseCandidateSongs = [{ id: options.neteaseCandidate.id, name: title, ar: artist ? [{ name: artist }] : [] }];
            return neteaseCandidateSongs;
        }

        const neteaseSearchRes = await withTimeout(
            neteaseApi.cloudSearch(searchQuery, AUTO_MATCH_SEARCH_LIMIT),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'NetEase search',
            { result: { songs: [] } }
        );
        const neteaseSongs = neteaseSearchRes.result?.songs || [];
        const bestCandidate = selectBestCandidate('netease', neteaseSongs, targetSong);
        neteaseCandidateSongs = bestCandidate ? [bestCandidate] : [];
        return neteaseCandidateSongs;
    };

    const getQqBestCandidate = async (): Promise<SongResult | null> => {
        if (qqBestCandidate !== undefined) {
            return qqBestCandidate;
        }
        const qqSongs = await withTimeout(
            searchQQLyrics(searchQuery, 1, AUTO_MATCH_SEARCH_LIMIT),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'QQ search',
            []
        );
        qqBestCandidate = selectBestCandidate('qq', qqSongs, targetSong);
        return qqBestCandidate;
    };

    const getNeteaseProcessed = async (song: any) => {
        return String(options.neteaseCandidate?.id) === String(song.id)
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
    };

    const tryAmllDbCandidate = async (
        platform: 'ncm' | 'qq',
        song: any,
    ): Promise<AutoMatchBestLyricMatch | null> => {
        console.log(`[autoMatchBestLyric] Probing AMLLDB ${platform}/${song.id} for "${song.name || title}"`);
        const lyrics = await withTimeout(
            fetchAmllDbLyrics(platform, song.id),
            PROVIDER_LYRIC_TIMEOUT_MS,
            `AMLLDB lyric fetch for ${platform}/${song.id}`,
            null
        );
        if (!lyrics) {
            console.log(`[autoMatchBestLyric] AMLLDB ${platform}/${song.id} returned no TTML lyrics. Continuing with the next source.`);
            return null;
        }
        if (!lyrics.isWordByWord) {
            captureSynchronizedFallback({
                lyrics,
                source: 'amll',
                id: song.id,
                matchedLyricsProviderPlatform: platform,
                ...(platform === 'qq' ? { qqMid: song.qqMid } : {}),
            });
            console.log(`[autoMatchBestLyric] AMLLDB ${platform}/${song.id} returned lyrics but they are not word-by-word. Continuing with the next source.`);
            return null;
        }
        const chorusRanges = platform === 'ncm' && !hasChorusMarkers(lyrics)
            ? (neteaseChorusRanges.length > 0 ? neteaseChorusRanges : await fetchNeteaseChorusRanges(song.id))
            : [];
        const decoratedLyrics = chorusRanges.length > 0
            ? applyNeteaseChorusByTime(lyrics, chorusRanges)
            : lyrics;

        console.log(`[autoMatchBestLyric] Found AMLLDB word-by-word lyric match from ${platform}!`);
        return {
            lyrics: decoratedLyrics,
            source: 'amll',
            id: song.id,
            matchedLyricsProviderPlatform: platform,
            ...(platform === 'qq' ? { qqMid: song.qqMid } : {}),
        };
    };

    for (const searchSource of searchOrder) {
        if (searchSource === 'netease') {
            // 1. NetEase Music
            try {
                const candidateSongs = await getNeteaseCandidateSongs();

                for (const song of candidateSongs) {
                    console.log(`[autoMatchBestLyric] Checking NetEase candidate: "${song.name}" by "${song.ar?.map((a: any) => a.name).join(', ')}"`);
                    const processed = await getNeteaseProcessed(song);

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
                    if (processed.lyrics) {
                        captureSynchronizedFallback({
                            lyrics: processed.lyrics,
                            source: 'netease',
                            id: song.id,
                        });
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] NetEase search/fetch failed:`, error);
            }
        } else if (searchSource === 'amll') {
            try {
                const neteaseCandidates = await getNeteaseCandidateSongs();
                if (neteaseCandidates.length === 0) {
                    console.log('[autoMatchBestLyric] Skipping AMLLDB auto probe because no reliable NetEase candidate id was found.');
                    continue;
                }

                for (const song of neteaseCandidates) {
                    const result = await tryAmllDbCandidate('ncm', song);
                    if (result) {
                        return result;
                    }
                }
                console.log('[autoMatchBestLyric] AMLLDB auto probe finished after NCM miss; QQ AMLLDB probing is reserved for manual matching.');
            } catch (error) {
                console.error(`[autoMatchBestLyric] AMLLDB probe failed:`, error);
            }
        } else if (searchSource === 'qq') {
            // 2. QQ Music
            try {
                const bestCandidate = await getQqBestCandidate();
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
                    if (parsedLyrics) {
                        captureSynchronizedFallback({
                            lyrics: parsedLyrics,
                            source: 'qq',
                            id: song.id,
                            qqMid: song.qqMid,
                        });
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
                    if (parsedLyrics) {
                        captureSynchronizedFallback({
                            lyrics: parsedLyrics,
                            source: 'kugou',
                            id: song.id,
                            kgHash: song.kgHash,
                        });
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] Kugou search/fetch failed:`, error);
            }
        }
    }

    if (synchronizedFallback) {
        console.log('[autoMatchBestLyric] Using a verified line-synchronized lyric fallback.');
        return synchronizedFallback;
    }

    console.log(`[autoMatchBestLyric] No synchronized lyric match found across any source.`);
    return null;
}
