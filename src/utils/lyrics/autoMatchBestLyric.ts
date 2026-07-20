import { LyricData, LyricProviderSource, SongResult } from '../../types';
import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import type { OnlineProviderId, ProviderLyricsResult } from '../../types/onlineMusic';
import { applyNeteaseChorusByTime } from './chorusEffects';
import type { NeteaseChorusRange } from './chorusEffects';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { fetchAmllDbLyrics } from './providers/amllDbProvider';
import { normalizeLyricMatchDurationMs } from './duration';
import { calculateMatchScoreDetails } from './matchScore';
import { buildLyricSearchQuery } from './searchQuery';
import { buildLyricSourceOrder } from './sourcePriority';
import { resolveProviderLyricsChorus } from './chorusResolver';

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

const getProviderChorusRanges = (providerId: OnlineProviderId, song: SongResult) => (
    getOnlineMusicProvider(providerId)?.lyrics?.getChorusRanges?.(song.id) ?? Promise.resolve([])
);

export interface AutoMatchProviderCandidate {
    providerId: 'netease' | 'kugou';
    song: SongResult;
    lyricsResult: ProviderLyricsResult;
}

export interface AutoMatchBestLyricOptions {
    album?: string;
    preferredSource?: LyricProviderSource;
    metadataCandidate?: {
        source: 'netease' | 'qq' | 'kugou';
        songId: number | string;
    };
    exactMatchOnly?: boolean;
    providerCandidate?: AutoMatchProviderCandidate;
    /** @deprecated Use providerCandidate so the baseline follows the song's provider. */
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
    song: SongResult;
    matchedLyricsProviderPlatform?: 'ncm' | 'qq';
    isPureMusic?: false;
};

export type AutoMatchBestLyricPureMusic = {
    isPureMusic: true;
    source?: LyricProviderSource;
    id?: number | string;
};

export type AutoMatchBestLyricResult = AutoMatchBestLyricMatch | AutoMatchBestLyricPureMusic | null;

const getNumericNeteaseId = (id: number | string): number | null => {
    const numericId = typeof id === 'number' ? id : Number(id);
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
};

const isSelectedMetadataCandidate = (
    source: 'netease' | 'qq' | 'kugou',
    song: SongResult,
    candidate?: AutoMatchBestLyricOptions['metadataCandidate'],
): boolean => {
    if (!candidate || candidate.source !== source) return false;
    if (source === 'qq') {
        return String(song.qqMid ?? song.id) === String(candidate.songId);
    }
    if (source === 'kugou') {
        return String(song.kgHash ?? song.id).toUpperCase() === String(candidate.songId).toUpperCase();
    }
    return String(song.id) === String(candidate.songId);
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
    const providerCandidate = options.providerCandidate ?? (options.neteaseCandidate ? {
        providerId: 'netease' as const,
        song: {
            id: options.neteaseCandidate.id,
            name: title,
            artists: artist ? [{ id: 0, name: artist }] : [],
            album: { id: 0, name: options.album || '' },
            durationMs: normalizedDurationMs,
            sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: String(options.neteaseCandidate.id) },
        },
        lyricsResult: {
            lyrics: options.neteaseCandidate.lyrics,
            isPureMusic: options.neteaseCandidate.isPureMusic ?? false,
            chorusRanges: options.neteaseCandidate.chorusRanges ?? [],
        },
    } : undefined);
    const activeProviderChorusRanges: NeteaseChorusRange[] = providerCandidate?.lyricsResult.chorusRanges ?? [];
    let discoveredNeteaseChorusRanges: NeteaseChorusRange[] = [];
    let neteaseCandidateSongs: SongResult[] | null = null;
    let qqBestCandidate: SongResult | null | undefined;
    let kugouBestCandidate: SongResult | null | undefined;

    const searchOrder = options.exactMatchOnly && options.metadataCandidate
        ? [options.metadataCandidate.source]
        : buildLyricSourceOrder(options.preferredSource);

    const getNeteaseCandidateSongs = async (): Promise<SongResult[]> => {
        if (neteaseCandidateSongs) {
            return neteaseCandidateSongs;
        }
        if (providerCandidate?.providerId === 'netease') {
            neteaseCandidateSongs = [providerCandidate.song];
            return neteaseCandidateSongs;
        }
        if (options.metadataCandidate?.source === 'netease') {
            const songId = getNumericNeteaseId(options.metadataCandidate.songId);
            neteaseCandidateSongs = songId ? [{
                id: songId,
                name: title,
                artists: artist ? [{ id: 0, name: artist }] : [],
                album: { id: 0, name: options.album || '' },
                durationMs: normalizedDurationMs,
                sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(songId) },
            }] : [];
            return neteaseCandidateSongs;
        }

        const neteaseSearchRes = await withTimeout(
            getOnlineMusicProvider('netease')?.search?.searchSongs(searchQuery, AUTO_MATCH_SEARCH_LIMIT, 0)
                || Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'NetEase search',
            { items: [], hasMore: false, nextOffset: 0 }
        );
        const neteaseSongs = neteaseSearchRes.items;
        const bestCandidate = selectBestCandidate('netease', neteaseSongs, targetSong);
        neteaseCandidateSongs = bestCandidate ? [bestCandidate] : [];
        return neteaseCandidateSongs;
    };

    const getQqBestCandidate = async (): Promise<SongResult | null> => {
        if (qqBestCandidate !== undefined) {
            return qqBestCandidate;
        }
        const qqSongs = (await withTimeout(
            searchQQLyrics(searchQuery, 1, AUTO_MATCH_SEARCH_LIMIT),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'QQ search',
            []
        )) ?? [];
        if (options.metadataCandidate?.source === 'qq') {
            const exactCandidate = qqSongs.find(song => isSelectedMetadataCandidate('qq', song, options.metadataCandidate));
            if (exactCandidate || options.exactMatchOnly) {
                qqBestCandidate = exactCandidate ?? null;
                return qqBestCandidate;
            }
        }
        qqBestCandidate = selectBestCandidate('qq', qqSongs, targetSong);
        return qqBestCandidate;
    };

    const getKugouBestCandidate = async (): Promise<SongResult | null> => {
        if (kugouBestCandidate !== undefined) return kugouBestCandidate;
        if (providerCandidate?.providerId === 'kugou') {
            kugouBestCandidate = providerCandidate.song;
            return kugouBestCandidate;
        }

        const page = await withTimeout(
            getOnlineMusicProvider('kugou')?.search?.searchSongs(searchQuery, AUTO_MATCH_SEARCH_LIMIT, 0)
                || Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'Kugou search',
            { items: [], hasMore: false, nextOffset: 0 },
        );
        if (options.metadataCandidate?.source === 'kugou') {
            const exactCandidate = page.items.find(song => isSelectedMetadataCandidate('kugou', song, options.metadataCandidate));
            if (exactCandidate || options.exactMatchOnly) {
                kugouBestCandidate = exactCandidate ?? null;
                return kugouBestCandidate;
            }
        }
        kugouBestCandidate = selectBestCandidate('kugou', page.items, targetSong);
        return kugouBestCandidate;
    };

    const getNeteaseProcessed = async (song: SongResult) => {
        if (providerCandidate?.providerId === 'netease' && String(providerCandidate.song.id) === String(song.id)) {
            return providerCandidate.lyricsResult;
        }

        return await withTimeout(
                (async () => {
                    return await getOnlineMusicProvider('netease')?.lyrics?.getLyrics(song) || null;
                })(),
                PROVIDER_LYRIC_TIMEOUT_MS,
                `NetEase lyric fetch for ${song.id}`,
                null
            );
    };

    const getKugouProcessed = async (song: SongResult): Promise<ProviderLyricsResult | null> => {
        if (providerCandidate?.providerId === 'kugou'
            && String(providerCandidate.song.kgHash ?? providerCandidate.song.id).toUpperCase() === String(song.kgHash ?? song.id).toUpperCase()) {
            return providerCandidate.lyricsResult;
        }
        return await withTimeout(
            getOnlineMusicProvider('kugou')?.lyrics?.getLyrics(song) ?? Promise.resolve(null),
            PROVIDER_LYRIC_TIMEOUT_MS,
            `Kugou lyric fetch for ${song.id}`,
            null,
        );
    };

    // Applies chorus behavior from the active provider result to whichever lyric source wins.
    const resolveMatchedLyrics = async (
        lyrics: LyricData,
        sourceResult: ProviderLyricsResult | null,
        sourceProviderId: 'netease' | 'kugou',
        sourceSong: SongResult,
    ): Promise<LyricData> => {
        const providerResult = providerCandidate
            ? { ...providerCandidate.lyricsResult, lyrics, isPureMusic: false }
            : { ...(sourceResult ?? { isPureMusic: false }), lyrics, isPureMusic: false };
        const resolved = await resolveProviderLyricsChorus(providerResult, {
            providerId: providerCandidate?.providerId ?? sourceProviderId,
            songId: providerCandidate?.song.id ?? sourceSong.id,
        });
        return resolved.result.lyrics ?? lyrics;
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
            console.log(`[autoMatchBestLyric] AMLLDB ${platform}/${song.id} returned lyrics but they are not word-by-word. Continuing with the next source.`);
            return null;
        }
        const chorusRanges = !hasChorusMarkers(lyrics)
            ? activeProviderChorusRanges.length > 0
                ? activeProviderChorusRanges
                : platform === 'ncm'
                    ? (discoveredNeteaseChorusRanges.length > 0
                        ? discoveredNeteaseChorusRanges
                        : await getProviderChorusRanges('netease', song))
                    : []
            : [];
        const decoratedLyrics = chorusRanges.length > 0
            ? applyNeteaseChorusByTime(lyrics, chorusRanges)
            : lyrics;

        console.log(`[autoMatchBestLyric] Found AMLLDB word-by-word lyric match from ${platform}!`);
        return {
            lyrics: decoratedLyrics,
            source: 'amll',
            id: song.id,
            song,
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
                    console.log(`[autoMatchBestLyric] Checking NetEase candidate: "${song.name}" by "${song.artists?.map(artist => artist.name).join(', ')}"`);
                    const processed = await getNeteaseProcessed(song);

                    if (!processed) {
                        continue;
                    }

                    if (processed.isPureMusic) {
                        console.log(`[autoMatchBestLyric] NetEase candidate "${song.name}" is pure music. Skipping alternative lyric sources.`);
                        return { isPureMusic: true, source: 'netease', id: song.id };
                    }

                    if (processed.chorusRanges && processed.chorusRanges.length > 0) {
                        discoveredNeteaseChorusRanges = processed.chorusRanges;
                    }

                    const acceptsExactNonWordByWord = options.exactMatchOnly
                        && isSelectedMetadataCandidate('netease', song, options.metadataCandidate);
                    if (processed.lyrics && (processed.lyrics.isWordByWord || acceptsExactNonWordByWord)) {
                        console.log(`[autoMatchBestLyric] Found accepted NetEase lyric match!`);
                        return {
                            lyrics: await resolveMatchedLyrics(processed.lyrics, processed, 'netease', song),
                            source: 'netease',
                            id: song.id,
                            song,
                        };
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] NetEase search/fetch failed:`, error);
            }
        } else if (searchSource === 'amll') {
            try {
                if (options.metadataCandidate?.source === 'qq') {
                    const qqCandidate = await getQqBestCandidate();
                    if (qqCandidate && isSelectedMetadataCandidate('qq', qqCandidate, options.metadataCandidate)) {
                        const result = await tryAmllDbCandidate('qq', qqCandidate);
                        if (result) {
                            return result;
                        }
                    }
                }

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
                        fetchQQLyrics(song, {
                            chorusRanges: activeProviderChorusRanges.length > 0
                                ? activeProviderChorusRanges
                                : discoveredNeteaseChorusRanges,
                        }),
                        PROVIDER_LYRIC_TIMEOUT_MS,
                        `QQ lyric fetch for ${song.id}`,
                        null
                    );
                    const acceptsExactNonWordByWord = options.exactMatchOnly
                        && isSelectedMetadataCandidate('qq', song, options.metadataCandidate);
                    if (parsedLyrics && (parsedLyrics.isWordByWord || acceptsExactNonWordByWord)) {
                        console.log(`[autoMatchBestLyric] Found accepted QQ lyric match!`);
                        return {
                            lyrics: parsedLyrics,
                            source: 'qq',
                            id: song.id,
                            qqMid: song.qqMid,
                            song,
                        };
                    }
                }
            } catch (error) {
                console.error(`[autoMatchBestLyric] QQ search/fetch failed:`, error);
            }
        } else if (searchSource === 'kugou') {
            // 3. Kugou Music
            try {
                const bestCandidate = await getKugouBestCandidate();
                const candidateSongs = bestCandidate ? [bestCandidate] : [];

                for (const song of candidateSongs) {
                    console.log(`[autoMatchBestLyric] Checking Kugou candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
                    const processed = await getKugouProcessed(song);
                    if (processed?.isPureMusic) {
                        return { isPureMusic: true, source: 'kugou', id: song.kgHash ?? song.id };
                    }
                    const acceptsExactNonWordByWord = options.exactMatchOnly
                        && isSelectedMetadataCandidate('kugou', song, options.metadataCandidate);
                    if (processed?.lyrics && (processed.lyrics.isWordByWord || acceptsExactNonWordByWord)) {
                        console.log(`[autoMatchBestLyric] Found perfect Kugou word-by-word lyric match!`);
                        return {
                            lyrics: await resolveMatchedLyrics(processed.lyrics, processed, 'kugou', song),
                            source: 'kugou',
                            id: song.id,
                            kgHash: song.kgHash,
                            song,
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
