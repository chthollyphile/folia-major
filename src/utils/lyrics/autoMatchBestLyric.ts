import { LyricData, LyricProviderSource, SongResult } from '../../types';
import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import type { OnlineProviderId, ProviderLyricsResult } from '../../types/onlineMusic';
import { fetchAmllDbLyrics, getAmllDbMusicIds } from './providers/amllDbProvider';
import { applyChorusRangesByTime } from './chorusEffects';
import type { ChorusRange } from './chorusEffects';
import { normalizeLyricMatchDurationMs } from './duration';
import { calculateMatchScoreDetails } from './matchScore';
import { buildLyricSearchQuery } from './searchQuery';
import { buildLyricSourceOrder } from './sourcePriority';
import { resolveProviderLyricsChorus } from './chorusResolver';
import { hasRenderableLyrics } from './validity';
import { getLyricSourceAccess, isLyricMatchSourceOffered } from './lyricMatchSources';
import { getLyricSource } from './lyricSources';
import type { PlatformLyricSource } from './lyricSources';
import type { LocalSongMetadataLyricCandidate } from './localSongMatchContext';

// src/utils/lyrics/autoMatchBestLyric.ts
// Utility module for preferring word-by-word lyrics while retaining a usable line-by-line fallback.

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
    /** The lyric source the song's own platform is (getPlatformLyricSource). */
    providerId: PlatformLyricSource;
    song: SongResult;
    lyricsResult: ProviderLyricsResult;
}

export interface AutoMatchBestLyricOptions {
    album?: string;
    preferredSource?: LyricProviderSource;
    metadataCandidate?: LocalSongMetadataLyricCandidate;
    exactMatchOnly?: boolean;
    providerCandidate?: AutoMatchProviderCandidate;
    /** Another name the artist may be listed under; asked for only when the given one finds nothing. */
    alternateArtist?: () => Promise<string | null>;
    /** @deprecated Use providerCandidate so the baseline follows the song's provider. */
    neteaseCandidate?: {
        id: number | string;
        lyrics: LyricData | null;
        isPureMusic?: boolean;
        chorusRanges?: ChorusRange[];
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

// Whether `song` is the song picked for `source` in the metadata dialog.
const isSelectedMetadataCandidate = (
    source: LyricProviderSource,
    song: SongResult,
    candidate?: AutoMatchBestLyricOptions['metadataCandidate'],
): boolean => {
    if (!candidate || candidate.source !== source) return false;
    const { songKey } = getLyricSourceAccess(source);
    return songKey(song) === songKey({ id: candidate.songId });
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
 * Searches and matches the best lyric across the lyric sources of lyricSources.ts.
 * Source priority follows the configured preference, while word-by-word lyrics outrank line-by-line lyrics.
 * A match is considered perfect if duration difference is <= 3s and title is matched.
 * Returns the parsed lyrics and matching details, or null if no reliable match is found.
 */
async function matchUnderArtist(
    title: string,
    artist: string,
    durationMs: number,
    options: AutoMatchBestLyricOptions
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
    const activeProviderChorusRanges: ChorusRange[] = providerCandidate?.lyricsResult.chorusRanges ?? [];
    // The chorus ranges a source that shares them (NetEase) gave in this run.
    let sharedChorusRanges: ChorusRange[] = [];
    const bestCandidates = new Map<LyricProviderSource, SongResult | null>();
    // Written by the steps below; the cast keeps the type wide for the reads after them.
    let lineByLineFallback = null as AutoMatchBestLyricMatch | null;

    // A preferred source that is not on offer (Spotify with no account signed in) counts as none chosen.
    const preferredSource = options.preferredSource && isLyricMatchSourceOffered(options.preferredSource)
        ? options.preferredSource
        : undefined;
    const searchOrder = options.exactMatchOnly && options.metadataCandidate
        ? [options.metadataCandidate.source]
        : buildLyricSourceOrder(preferredSource);

    // A platform source's song for the title and artist: the active song when it is that
    // platform's own, the song picked in the metadata dialog when there is one, else the best of
    // one search, made only while the source is on offer. Found once in a run.
    const getBestCandidate = async (source: LyricProviderSource): Promise<SongResult | null> => {
        const found = bestCandidates.get(source);
        if (found !== undefined) return found;
        const candidate = await findBestCandidate(source);
        bestCandidates.set(source, candidate);
        return candidate;
    };

    const findBestCandidate = async (source: LyricProviderSource): Promise<SongResult | null> => {
        if (providerCandidate?.providerId === source) return providerCandidate.song;
        if (!isLyricMatchSourceOffered(source)) return null;
        const access = getLyricSourceAccess(source);
        const picked = options.metadataCandidate?.source === source ? options.metadataCandidate : undefined;
        if (picked && access.knownById) {
            const songId = access.knownById(picked.songId);
            return songId === null ? null : {
                id: songId,
                name: title,
                artists: artist ? [{ id: 0, name: artist }] : [],
                album: { id: 0, name: options.album || '' },
                durationMs: normalizedDurationMs,
                sourceRef: { kind: 'online', providerId: source, mediaId: String(songId) },
            };
        }

        const songs = (await withTimeout(
            access.search(searchQuery, AUTO_MATCH_SEARCH_LIMIT, targetSong),
            PROVIDER_SEARCH_TIMEOUT_MS,
            `${source} search`,
            []
        )) ?? [];
        if (picked) {
            const exactCandidate = songs.find(song => isSelectedMetadataCandidate(source, song, picked));
            if (exactCandidate || options.exactMatchOnly) {
                return exactCandidate ?? null;
            }
        }
        return selectBestCandidate(source, songs, targetSong);
    };

    // The source's lyrics for `song`: those already in hand when it is the active song, else fetched.
    const getProcessed = async (source: LyricProviderSource, song: SongResult): Promise<ProviderLyricsResult | null> => {
        const access = getLyricSourceAccess(source);
        if (providerCandidate?.providerId === source && access.songKey(providerCandidate.song) === access.songKey(song)) {
            return providerCandidate.lyricsResult;
        }

        return await withTimeout(
            access.fetch(song, {
                chorusRanges: activeProviderChorusRanges.length > 0
                    ? activeProviderChorusRanges
                    : sharedChorusRanges,
            }),
            PROVIDER_LYRIC_TIMEOUT_MS,
            `${source} lyric fetch for ${song.id}`,
            null,
        );
    };

    // Applies chorus behavior from the active provider result to whichever lyric source wins.
    const resolveMatchedLyrics = async (
        lyrics: LyricData,
        sourceResult: ProviderLyricsResult | null,
        source: LyricProviderSource,
        sourceSong: SongResult,
    ): Promise<LyricData> => {
        // A song whose platform has lines only (Spotify) has no chorus data to lend: the winner's
        // own text marks its chorus lines.
        const lender = providerCandidate && !getLyricSource(providerCandidate.providerId).linesOnly
            ? providerCandidate
            : undefined;
        const providerResult = lender
            ? { ...lender.lyricsResult, lyrics, isPureMusic: false }
            : { ...(sourceResult ?? { isPureMusic: false }), lyrics, isPureMusic: false };
        const resolved = await resolveProviderLyricsChorus(providerResult, {
            providerId: lender?.providerId ?? source,
            songId: lender?.song.id ?? sourceSong.id,
        });
        return resolved.result.lyrics ?? lyrics;
    };

    const tryAmllDbCandidate = async (
        platform: 'ncm' | 'qq',
        song: any,
    ): Promise<AutoMatchBestLyricMatch | null> => {
        console.log(`[autoMatchBestLyric] Probing AMLLDB ${platform}/${song.id} for "${song.name || title}"`);
        // QQ 要依次试 mid 和数字 ID，每次请求各有超时，外层按 ID 个数放宽，否则第一次慢了第二个 ID 就轮不到
        const musicIds = getAmllDbMusicIds(platform, song);
        const lyrics = await withTimeout(
            fetchAmllDbLyrics(platform, musicIds),
            PROVIDER_LYRIC_TIMEOUT_MS * Math.max(1, musicIds.length),
            `AMLLDB lyric fetch for ${platform}/${song.id}`,
            null
        );
        if (!hasRenderableLyrics(lyrics)) {
            console.log(`[autoMatchBestLyric] AMLLDB ${platform}/${song.id} returned no TTML lyrics. Continuing with the next source.`);
            return null;
        }
        const chorusRanges = !hasChorusMarkers(lyrics)
            ? activeProviderChorusRanges.length > 0
                ? activeProviderChorusRanges
                : platform === 'ncm'
                    ? (sharedChorusRanges.length > 0
                        ? sharedChorusRanges
                        : await getProviderChorusRanges('netease', song))
                    : []
            : [];
        const decoratedLyrics = chorusRanges.length > 0
            ? applyChorusRangesByTime(lyrics, chorusRanges)
            : lyrics;

        console.log(`[autoMatchBestLyric] Found AMLLDB ${lyrics.isWordByWord ? 'word-by-word' : 'line-by-line'} lyric match from ${platform}!`);
        return {
            lyrics: decoratedLyrics,
            source: 'amll',
            id: song.id,
            song,
            matchedLyricsProviderPlatform: platform,
            ...(platform === 'qq' ? { qqMid: song.qqMid } : {}),
        };
    };

    // Asks one platform source for its candidate's lyrics. Answers what ends the pick (a
    // word-by-word match, the lines of the song picked in the metadata dialog when only that song
    // is wanted, or a pure-music verdict); any other lines are kept as the fallback.
    const tryPlatformSource = async (source: LyricProviderSource): Promise<AutoMatchBestLyricResult> => {
        const { linesOnly } = getLyricSource(source);
        // Lines-only lyrics can be the fallback, never the word-by-word match, so such a source
        // is not asked once another source has given lines.
        if (linesOnly && lineByLineFallback) return null;

        const song = await getBestCandidate(source);
        if (!song) return null;
        console.log(`[autoMatchBestLyric] Checking ${source} candidate: "${song.name}" by "${song.artists?.map(artist => artist.name).join(', ')}"`);
        const processed = await getProcessed(source, song);
        if (!processed) return null;

        const access = getLyricSourceAccess(source);
        if (!linesOnly) {
            if (processed.isPureMusic) {
                console.log(`[autoMatchBestLyric] ${source} candidate "${song.name}" is pure music. Skipping alternative lyric sources.`);
                return { isPureMusic: true, source, id: song.id };
            }
            if (access.sharesChorusRanges && processed.chorusRanges && processed.chorusRanges.length > 0) {
                sharedChorusRanges = processed.chorusRanges;
            }
        }
        if (!hasRenderableLyrics(processed.lyrics)) return null;

        const match: AutoMatchBestLyricMatch = {
            lyrics: access.marksChorusOnFetch
                ? processed.lyrics
                : await resolveMatchedLyrics(processed.lyrics, processed, source, song),
            source,
            id: song.id,
            qqMid: song.qqMid,
            kgHash: song.kgHash,
            song,
        };
        const acceptsExactNonWordByWord = options.exactMatchOnly
            && isSelectedMetadataCandidate(source, song, options.metadataCandidate);
        if (!linesOnly && (processed.lyrics.isWordByWord || acceptsExactNonWordByWord)) {
            console.log(`[autoMatchBestLyric] Found accepted ${source} lyric match!`);
            return match;
        }
        lineByLineFallback ??= match;
        console.log(`[autoMatchBestLyric] Keeping ${source} line-by-line lyrics as fallback while checking for word-by-word lyrics.`);
        return null;
    };

    // AMLL DB keeps lyrics under NetEase and QQ song ids, so it is asked about those two sources'
    // candidates: the QQ song picked in the metadata dialog when there is one, then NetEase's.
    const tryAmllDb = async (): Promise<AutoMatchBestLyricResult> => {
        if (options.metadataCandidate?.source === 'qq') {
            const qqCandidate = await getBestCandidate('qq');
            if (qqCandidate && isSelectedMetadataCandidate('qq', qqCandidate, options.metadataCandidate)) {
                const result = await tryAmllDbCandidate('qq', qqCandidate);
                if (result) {
                    if (result.lyrics.isWordByWord) {
                        return result;
                    }
                    lineByLineFallback ??= result;
                }
            }
        }

        const neteaseCandidate = await getBestCandidate('netease');
        if (!neteaseCandidate) {
            console.log('[autoMatchBestLyric] Skipping AMLLDB auto probe because no reliable NetEase candidate id was found.');
            return null;
        }

        const result = await tryAmllDbCandidate('ncm', neteaseCandidate);
        if (result) {
            if (result.lyrics.isWordByWord) {
                return result;
            }
            lineByLineFallback ??= result;
        }
        console.log('[autoMatchBestLyric] AMLLDB auto probe finished after NCM miss; QQ AMLLDB probing is reserved for manual matching.');
        return null;
    };

    for (const source of searchOrder) {
        try {
            // AMLL DB is the one source that is not a platform: it has no songs of its own to search,
            // and a step of its own here. Another source that is not a platform has none yet and is
            // passed over.
            const settled = getLyricSource(source).platform
                ? await tryPlatformSource(source)
                : source === 'amll' ? await tryAmllDb() : null;
            if (settled) return settled;
        } catch (error) {
            console.error(`[autoMatchBestLyric] ${source} search/fetch failed:`, error);
        }
    }

    if (lineByLineFallback) {
        console.log(`[autoMatchBestLyric] No word-by-word lyric match found; using ${lineByLineFallback.source} line-by-line fallback.`);
        return lineByLineFallback;
    }

    console.log(`[autoMatchBestLyric] No reliable lyric match found across any source.`);
    return null;
}

// A song's provider may name the artist differently from the lyric sources, which then find
// nothing; `options.alternateArtist` gives the search one more go under the other name.
export async function autoMatchBestLyric(
    title: string,
    artist: string,
    durationMs: number,
    options: AutoMatchBestLyricOptions = {}
): Promise<AutoMatchBestLyricResult> {
    const match = await matchUnderArtist(title, artist, durationMs, options);
    if (match || !options.alternateArtist) return match;
    const alternate = await withTimeout(
        options.alternateArtist().catch(() => null),
        PROVIDER_SEARCH_TIMEOUT_MS,
        'Alternate artist name',
        null
    );
    if (!alternate || alternate === artist) return null;
    console.log(`[autoMatchBestLyric] Searching again with the artist as "${alternate}"`);
    return matchUnderArtist(title, alternate, durationMs, options);
}
