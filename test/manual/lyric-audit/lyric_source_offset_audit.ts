import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// test/manual/lyric-audit/lyric_source_offset_audit.ts

export interface CliOptions {
    songId: number;
    outputPath?: string;
}

export interface SourceAudit {
    source: 'netease' | 'qq' | 'kugou';
    candidate: {
        id: number | string;
        title: string;
        artist: string;
        album: string;
        durationMs: number;
        score: number;
        titleMatched: boolean;
        artistMatched: boolean;
        albumMatched: boolean | null;
        durationMatched: boolean | null;
    };
    lyrics: {
        available: boolean;
        isWordByWord: boolean;
        lineCount: number;
        matchedLineCount: number;
        wordCount: number;
        firstLineStartSec: number | null;
        lastLineEndSec: number | null;
        timelineSpanSec: number | null;
    };
}

export interface PairwiseOffsetAudit {
    from: string;
    to: string;
    matchedKeys: number;
    startDeltaSec: OffsetStats | null;
    endDeltaSec: OffsetStats | null;
    driftSec: number | null;
}

export interface OffsetStats {
    mean: number;
    median: number;
    p95Abs: number;
    min: number;
    max: number;
    absMean: number;
    first: number;
    last: number;
}

export interface LyricSourceAuditReport {
    requestedSongId: number;
    song: {
        title: string;
        artist: string;
        album: string;
        durationMs: number;
        searchQuery: string;
    };
    sourceAudits: SourceAudit[];
    pairwise: PairwiseOffsetAudit[];
    durationCalibration: Array<{
        pair: string;
        medianOffsetSec: number | null;
        candidateDurationDeltaSec: number | null;
        lyricTimelineDeltaSec: number | null;
        durationCanExplainOffset: boolean;
    }>;
    matchedLines?: MatchedLineDetail[];
}

export interface MatchedLineDetail {
    key: string;
    text: string;
    netease: { startTime: number; endTime: number; duration: number } | null;
    qq: { startTime: number; endTime: number; duration: number } | null;
    kugou: { startTime: number; endTime: number; duration: number } | null;
}

type LyricData = import('../../../src/types').LyricData;
type RawNeteaseLyric = import('../../../src/utils/lyrics/types').RawNeteaseLyric;

type KeyedLine = {
    key: string;
    line: LyricData['lines'][number];
    index: number;
};

const DEFAULT_SONG_ID = 488642006;
const MAX_SEARCH_RESULTS = 10;
const AUTO_MATCH_MIN_SCORE = 75;

const loadEnvLocal = () => {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) {
            return;
        }

        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }

        if (key && !(key in process.env)) {
            process.env[key] = value;
        }
    });
};

const readValue = (args: string[], index: number, optionName: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${optionName} requires a value.`);
    }
    return value;
};

const parseSongId = (value: string | undefined): number => {
    if (!value) {
        return DEFAULT_SONG_ID;
    }

    const songId = Number(value);
    if (!Number.isInteger(songId) || songId <= 0) {
        throw new Error('songId must be a positive integer.');
    }
    return songId;
};

const parseArgs = (args: string[]): CliOptions => {
    const positional: string[] = [];
    const options: Partial<CliOptions> = {};

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        switch (arg) {
            case '--out':
                options.outputPath = readValue(args, index, arg);
                index += 1;
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`Unknown option: ${arg}`);
                }
                positional.push(arg);
                break;
        }
    }

    return {
        songId: parseSongId(positional[0]),
        outputPath: options.outputPath,
    };
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
};

const percentileAbs = (values: number[], percentile: number) => {
    const sorted = values.map(value => Math.abs(value)).sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
    return sorted[index];
};

const round = (value: number | null, digits = 3) => {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }
    return Number(value.toFixed(digits));
};

const buildOffsetStats = (values: number[]): OffsetStats | null => {
    if (values.length === 0) {
        return null;
    }

    return {
        mean: round(mean(values)) ?? 0,
        median: round(median(values)) ?? 0,
        p95Abs: round(percentileAbs(values, 0.95)) ?? 0,
        min: round(Math.min(...values)) ?? 0,
        max: round(Math.max(...values)) ?? 0,
        absMean: round(mean(values.map(value => Math.abs(value)))) ?? 0,
        first: round(values[0]) ?? 0,
        last: round(values[values.length - 1]) ?? 0,
    };
};

const pickSong = <T>(
    results: T[],
    scoreGetter: (result: T) => number,
    identityOk: (result: T) => boolean,
) => {
    const sorted = [...results].sort((left, right) => scoreGetter(right) - scoreGetter(left));
    return sorted.find(identityOk) ?? sorted[0] ?? null;
};

const formatArtists = (artists: Array<{ name: string }> | undefined) =>
    artists?.map(artist => artist.name).filter(Boolean).join(', ') ?? '';

const createMatchedLineKeys = (
    lyrics: LyricData,
    normalizeLyricMatchText: (value: string) => string,
): KeyedLine[] => {
    const counters = new Map<string, number>();

    return lyrics.lines
        .map((line, index) => {
            const normalizedText = normalizeLyricMatchText(line.fullText || '');
            if (!normalizedText) {
                return null;
            }

            const nextCount = (counters.get(normalizedText) ?? 0) + 1;
            counters.set(normalizedText, nextCount);

            return {
                key: `${normalizedText}#${nextCount}`,
                line,
                index,
            };
        })
        .filter((entry): entry is KeyedLine => entry !== null);
};

/**
 * 使用最长公共子序列（LCS / Needleman-Wunsch）算法，对齐两组歌词行。
 * 返回以 list1 的 key 为键、list2 对应的 key 为值的 Map。
 */
const alignLyricsPairwise = (
    list1: KeyedLine[],
    list2: KeyedLine[],
    normalizeLyricMatchText: (value: string) => string,
): Map<string, string> => {
    // 计算两行歌词之间的相似度 (基于字符级 LCS)
    const getSimilarity = (line1: KeyedLine, line2: KeyedLine): number => {
        const text1 = normalizeLyricMatchText(line1.line.fullText || '');
        const text2 = normalizeLyricMatchText(line2.line.fullText || '');
        if (!text1 || !text2) return 0;
        if (text1 === text2) return 1.0;

        const m = text1.length;
        const n = text2.length;
        const dp = Array.from({ length: m + 1 }, () => new Float32Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (text1[i - 1] === text2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        const lcsLen = dp[m][n];
        return (2 * lcsLen) / (m + n);
    };

    const m = list1.length;
    const n = list2.length;
    const dp = Array.from({ length: m + 1 }, () => new Float32Array(n + 1));
    const parent = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

    const MATCH_THRESHOLD = 0.45;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            let bestScore = dp[i - 1][j];
            let choice = 1; // 1 = skip list1

            if (dp[i][j - 1] > bestScore) {
                bestScore = dp[i][j - 1];
                choice = 2; // 2 = skip list2
            }

            const sim = getSimilarity(list1[i - 1], list2[j - 1]);
            if (sim >= MATCH_THRESHOLD) {
                const matchScore = dp[i - 1][j - 1] + sim;
                if (matchScore > bestScore) {
                    bestScore = matchScore;
                    choice = 3; // 3 = match
                }
            }

            dp[i][j] = bestScore;
            parent[i][j] = choice;
        }
    }

    const matchMap = new Map<string, string>();
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        const choice = parent[i][j];
        if (choice === 3) {
            matchMap.set(list1[i - 1].key, list2[j - 1].key);
            i--;
            j--;
        } else if (choice === 2) {
            j--;
        } else {
            i--;
        }
    }

    return matchMap;
};

/**
 * 忽略 target 歌词开头未与参考歌词（网易云）匹配的元数据或前奏歌词行，
 * 以参考歌词的第一句匹配行为基准，裁剪 target 歌词。
 */
const trimMetadataLines = (
    refLyrics: LyricData | null,
    targetLyrics: LyricData | null,
    normalizeLyricMatchText: (value: string) => string,
): LyricData | null => {
    if (!refLyrics || !targetLyrics || refLyrics.lines.length === 0 || targetLyrics.lines.length === 0) {
        return targetLyrics;
    }

    const refKeyed = createMatchedLineKeys(refLyrics, normalizeLyricMatchText);
    const targetKeyed = createMatchedLineKeys(targetLyrics, normalizeLyricMatchText);

    if (refKeyed.length === 0 || targetKeyed.length === 0) {
        return targetLyrics;
    }

    const alignment = alignLyricsPairwise(refKeyed, targetKeyed, normalizeLyricMatchText);

    // 寻找参考歌词中第一个在 target 歌词中拥有匹配项的行
    for (const refEntry of refKeyed) {
        const matchedKey = alignment.get(refEntry.key);
        if (matchedKey) {
            const matchedEntry = targetKeyed.find(entry => entry.key === matchedKey);
            if (matchedEntry) {
                const matchedIndex = targetLyrics.lines.findIndex(line => line === matchedEntry.line);
                if (matchedIndex > 0) {
                    return {
                        ...targetLyrics,
                        lines: targetLyrics.lines.slice(matchedIndex),
                    };
                }
            }
            break;
        }
    }

    return targetLyrics;
};

/**
 * 比对并整理不同歌词源中相同行（通过归一化文本匹配）的详细时间戳与持续时间。
 */
const buildMatchedLines = (
    neteaseLyrics: LyricData | null,
    qqLyrics: LyricData | null,
    kugouLyrics: LyricData | null,
    normalizeLyricMatchText: (value: string) => string,
): MatchedLineDetail[] => {
    const neteaseSummary = summarizeLyrics(neteaseLyrics, normalizeLyricMatchText);
    const qqSummary = summarizeLyrics(qqLyrics, normalizeLyricMatchText);
    const kugouSummary = summarizeLyrics(kugouLyrics, normalizeLyricMatchText);

    // Align NetEase -> QQ, NetEase -> Kugou, and QQ -> Kugou
    const alignNeteaseQq = alignLyricsPairwise(neteaseSummary.keyedLines, qqSummary.keyedLines, normalizeLyricMatchText);
    const alignNeteaseKugou = alignLyricsPairwise(neteaseSummary.keyedLines, kugouSummary.keyedLines, normalizeLyricMatchText);
    const alignQqKugou = alignLyricsPairwise(qqSummary.keyedLines, kugouSummary.keyedLines, normalizeLyricMatchText);

    const neteaseByKey = new Map(neteaseSummary.keyedLines.map(entry => [entry.key, entry.line]));
    const qqByKey = new Map(qqSummary.keyedLines.map(entry => [entry.key, entry.line]));
    const kugouByKey = new Map(kugouSummary.keyedLines.map(entry => [entry.key, entry.line]));

    const matchedLines: MatchedLineDetail[] = [];
    const matchedQqKeys = new Set<string>();
    const matchedKugouKeys = new Set<string>();

    for (const neteaseEntry of neteaseSummary.keyedLines) {
        const qqKey = alignNeteaseQq.get(neteaseEntry.key);
        const kugouKey = alignNeteaseKugou.get(neteaseEntry.key);

        const neteaseLine = neteaseEntry.line;
        const qqLine = qqKey ? qqByKey.get(qqKey) : null;
        const kugouLine = kugouKey ? kugouByKey.get(kugouKey) : null;

        if (qqKey) matchedQqKeys.add(qqKey);
        if (kugouKey) matchedKugouKeys.add(kugouKey);

        const text = neteaseLine.fullText || qqLine?.fullText || kugouLine?.fullText || '';

        matchedLines.push({
            key: neteaseEntry.key,
            text,
            netease: {
                startTime: round(neteaseLine.startTime) ?? 0,
                endTime: round(neteaseLine.endTime) ?? 0,
                duration: round(neteaseLine.endTime - neteaseLine.startTime) ?? 0,
            },
            qq: qqLine ? {
                startTime: round(qqLine.startTime) ?? 0,
                endTime: round(qqLine.endTime) ?? 0,
                duration: round(qqLine.endTime - qqLine.startTime) ?? 0,
            } : null,
            kugou: kugouLine ? {
                startTime: round(kugouLine.startTime) ?? 0,
                endTime: round(kugouLine.endTime) ?? 0,
                duration: round(kugouLine.endTime - kugouLine.startTime) ?? 0,
            } : null,
        });
    }

    // Collect unmatched QQ lines
    for (const qqEntry of qqSummary.keyedLines) {
        if (matchedQqKeys.has(qqEntry.key)) {
            continue;
        }

        const kugouKey = alignQqKugou.get(qqEntry.key);
        const kugouLine = kugouKey ? kugouByKey.get(kugouKey) : null;
        if (kugouKey) matchedKugouKeys.add(kugouKey);

        const qqLine = qqEntry.line;

        matchedLines.push({
            key: qqEntry.key,
            text: qqLine.fullText || kugouLine?.fullText || '',
            netease: null,
            qq: {
                startTime: round(qqLine.startTime) ?? 0,
                endTime: round(qqLine.endTime) ?? 0,
                duration: round(qqLine.endTime - qqLine.startTime) ?? 0,
            },
            kugou: kugouLine ? {
                startTime: round(kugouLine.startTime) ?? 0,
                endTime: round(kugouLine.endTime) ?? 0,
                duration: round(kugouLine.endTime - kugouLine.startTime) ?? 0,
            } : null,
        });
    }

    // Collect unmatched Kugou lines
    for (const kugouEntry of kugouSummary.keyedLines) {
        if (matchedKugouKeys.has(kugouEntry.key)) {
            continue;
        }

        const kugouLine = kugouEntry.line;

        matchedLines.push({
            key: kugouEntry.key,
            text: kugouLine.fullText || '',
            netease: null,
            qq: null,
            kugou: {
                startTime: round(kugouLine.startTime) ?? 0,
                endTime: round(kugouLine.endTime) ?? 0,
                duration: round(kugouLine.endTime - kugouLine.startTime) ?? 0,
            },
        });
    }

    // Sort chronologically
    matchedLines.sort((left, right) => {
        const leftTime = left.netease?.startTime ?? left.qq?.startTime ?? left.kugou?.startTime ?? 0;
        const rightTime = right.netease?.startTime ?? right.qq?.startTime ?? right.kugou?.startTime ?? 0;
        return leftTime - rightTime;
    });

    return matchedLines;
};

const summarizeLyrics = (
    lyrics: LyricData | null,
    normalizeLyricMatchText: (value: string) => string,
) => {
    if (!lyrics || lyrics.lines.length === 0) {
        return {
            available: false,
            isWordByWord: false,
            lineCount: 0,
            matchedLineCount: 0,
            wordCount: 0,
            firstLineStartSec: null,
            lastLineEndSec: null,
            timelineSpanSec: null,
            keyedLines: [] as KeyedLine[],
        };
    }

    const keyedLines = createMatchedLineKeys(lyrics, normalizeLyricMatchText);
    const firstLine = keyedLines[0]?.line ?? lyrics.lines[0] ?? null;
    const lastLine = keyedLines[keyedLines.length - 1]?.line ?? lyrics.lines[lyrics.lines.length - 1] ?? null;

    return {
        available: true,
        isWordByWord: Boolean(lyrics.isWordByWord),
        lineCount: lyrics.lines.length,
        matchedLineCount: keyedLines.length,
        wordCount: lyrics.lines.reduce((sum, line) => sum + line.words.length, 0),
        firstLineStartSec: round(firstLine?.startTime ?? null),
        lastLineEndSec: round(lastLine?.endTime ?? null),
        timelineSpanSec: firstLine && lastLine ? round(lastLine.endTime - firstLine.startTime) : null,
        keyedLines,
    };
};

const compareOffsets = (
    fromLabel: string,
    fromLyrics: LyricData | null,
    toLabel: string,
    toLyrics: LyricData | null,
    normalizeLyricMatchText: (value: string) => string,
): PairwiseOffsetAudit => {
    const fromSummary = summarizeLyrics(fromLyrics, normalizeLyricMatchText);
    const toSummary = summarizeLyrics(toLyrics, normalizeLyricMatchText);
    
    const alignment = alignLyricsPairwise(fromSummary.keyedLines, toSummary.keyedLines, normalizeLyricMatchText);
    const toByKey = new Map(toSummary.keyedLines.map(entry => [entry.key, entry.line]));

    const startDeltas: number[] = [];
    const endDeltas: number[] = [];

    for (const entry of fromSummary.keyedLines) {
        const peerKey = alignment.get(entry.key);
        if (!peerKey) {
            continue;
        }
        const peer = toByKey.get(peerKey);
        if (!peer) {
            continue;
        }

        startDeltas.push(peer.startTime - entry.line.startTime);
        endDeltas.push(peer.endTime - entry.line.endTime);
    }

    const startStats = buildOffsetStats(startDeltas);
    const endStats = buildOffsetStats(endDeltas);

    return {
        from: fromLabel,
        to: toLabel,
        matchedKeys: startDeltas.length,
        startDeltaSec: startStats,
        endDeltaSec: endStats,
        driftSec: startStats ? round(startStats.last - startStats.first) : null,
    };
};

const evaluateDurationCalibration = (
    pairwise: PairwiseOffsetAudit[],
    sourceAudits: SourceAudit[],
) => {
    return pairwise.map((pair) => {
        const from = sourceAudits.find(source => source.source === pair.from);
        const to = sourceAudits.find(source => source.source === pair.to);
        const candidateDurationDeltaSec = from && to
            ? round((to.candidate.durationMs - from.candidate.durationMs) / 1000)
            : null;
        const lyricTimelineDeltaSec = from?.lyrics.timelineSpanSec !== null && to?.lyrics.timelineSpanSec !== null
            ? round((to.lyrics.timelineSpanSec ?? 0) - (from.lyrics.timelineSpanSec ?? 0))
            : null;
        const medianOffsetSec = pair.startDeltaSec?.median ?? null;
        const durationCanExplainOffset = medianOffsetSec !== null
            && candidateDurationDeltaSec !== null
            && Math.abs(Math.abs(medianOffsetSec) - Math.abs(candidateDurationDeltaSec)) <= 0.35;

        return {
            pair: `${pair.from} -> ${pair.to}`,
            medianOffsetSec,
            candidateDurationDeltaSec,
            lyricTimelineDeltaSec,
            durationCanExplainOffset,
        };
    });
};

const parseNeteaseLyricsSynchronously = async ({
    neteaseApi,
    detectTimedLyricFormat,
    parseLyricsByFormat,
    extractNeteaseLyricPayload,
    resolveLyricProcessingOptions,
    applyDetectedChorusEffects,
    applyNeteaseChorusByTime,
    source,
    songId,
}: {
    neteaseApi: Awaited<typeof import('../../../src/services/netease')>['neteaseApi'];
    detectTimedLyricFormat: Awaited<typeof import('../../../src/utils/lyrics/formatDetection')>['detectTimedLyricFormat'];
    parseLyricsByFormat: Awaited<typeof import('../../../src/utils/lyrics/parserCore')>['parseLyricsByFormat'];
    extractNeteaseLyricPayload: Awaited<typeof import('../../../src/utils/lyrics/neteaseProcessing')>['extractNeteaseLyricPayload'];
    resolveLyricProcessingOptions: Awaited<typeof import('../../../src/utils/lyrics/filtering')>['resolveLyricProcessingOptions'];
    applyDetectedChorusEffects: Awaited<typeof import('../../../src/utils/lyrics/chorusEffects')>['applyDetectedChorusEffects'];
    applyNeteaseChorusByTime: Awaited<typeof import('../../../src/utils/lyrics/chorusEffects')>['applyNeteaseChorusByTime'];
    source: RawNeteaseLyric;
    songId: number;
}) => {
    const payload = extractNeteaseLyricPayload(source);
    const primaryLyrics = payload.yrcLrc || payload.mainLrc;

    if (!primaryLyrics || payload.isPureMusic) {
        return {
            lyrics: null,
            chorusRanges: [] as Array<{ startTime: number; endTime: number }>,
        };
    }

    const format = payload.yrcLrc ? 'yrc' : detectTimedLyricFormat(payload.mainLrc || primaryLyrics);
    let lyrics = parseLyricsByFormat(
        format,
        primaryLyrics,
        payload.transLrc || '',
        resolveLyricProcessingOptions({ songId }),
    );

    if (lyrics) {
        lyrics.isWordByWord = Boolean(payload.yrcLrc);
    }

    let chorusRanges: Array<{ startTime: number; endTime: number }> = [];
    if (lyrics && payload.mainLrc) {
        const chorusRes = await neteaseApi.getChorus(songId).catch(() => null);
        if (chorusRes && chorusRes.code === 200) {
            const ranges = chorusRes.chorus || chorusRes.data || [];
            if (Array.isArray(ranges) && ranges.length > 0) {
                chorusRanges = ranges.map((range: any) => ({
                    startTime: (range.startTime ?? 0) / 1000,
                    endTime: (range.endTime ?? 0) / 1000,
                }));
                lyrics = applyNeteaseChorusByTime(lyrics, chorusRanges);
            }
        }

        if (chorusRanges.length === 0) {
            lyrics = applyDetectedChorusEffects(lyrics, payload.mainLrc);
        }
    }

    return {
        lyrics,
        chorusRanges,
    };
};

/**
 * 运行歌词源的时间偏差分析并输出JSON报告。
 * @param options 歌曲ID及输出路径配置
 */
export const runLyricSourceOffsetAudit = async (options: CliOptions): Promise<LyricSourceAuditReport> => {
    loadEnvLocal();

    if (typeof process.env.VITE_NETEASE_API_BASE !== 'string' || !process.env.VITE_NETEASE_API_BASE) {
        throw new Error('VITE_NETEASE_API_BASE is required. Put it in .env.local or export it before running.');
    }

    (globalThis as typeof globalThis & { window?: unknown }).window = { electron: {} as any } as any;

    const [
        { neteaseApi },
        { searchQQLyrics, fetchQQLyrics },
        { searchKugouLyrics, fetchKugouLyrics },
        { buildLyricSearchQuery },
        { calculateMatchScoreDetails, normalizeLyricMatchText },
        { detectTimedLyricFormat },
        { parseLyricsByFormat },
        { extractNeteaseLyricPayload },
        { resolveLyricProcessingOptions },
        { applyDetectedChorusEffects, applyNeteaseChorusByTime },
    ] = await Promise.all([
        import('../../../src/services/netease'),
        import('../../../src/utils/lyrics/providers/qqLyricProvider'),
        import('../../../src/utils/lyrics/providers/kugouLyricProvider'),
        import('../../../src/utils/lyrics/searchQuery'),
        import('../../../src/utils/lyrics/matchScore'),
        import('../../../src/utils/lyrics/formatDetection'),
        import('../../../src/utils/lyrics/parserCore'),
        import('../../../src/utils/lyrics/neteaseProcessing'),
        import('../../../src/utils/lyrics/filtering'),
        import('../../../src/utils/lyrics/chorusEffects'),
    ]);

    const detailResponse = await neteaseApi.getSongDetail(options.songId);
    const song = detailResponse?.songs?.[0];
    if (!song) {
        throw new Error(`Could not load song detail for ${options.songId}.`);
    }

    const title = song.name;
    const artist = formatArtists(song.ar || song.artists);
    const album = song.al?.name || song.album?.name || '';
    const durationMs = song.dt || song.duration || 0;
    const searchQuery = buildLyricSearchQuery(title, artist, album);

    const neteaseRaw = await neteaseApi.getLyric(options.songId);
    const neteaseProcessed = await parseNeteaseLyricsSynchronously({
        neteaseApi,
        detectTimedLyricFormat,
        parseLyricsByFormat,
        extractNeteaseLyricPayload,
        resolveLyricProcessingOptions,
        applyDetectedChorusEffects,
        applyNeteaseChorusByTime,
        source: neteaseApi.getProcessedLyricPayload(neteaseRaw),
        songId: options.songId,
    });

    const qqResults = await searchQQLyrics(searchQuery, 1, MAX_SEARCH_RESULTS);
    const kugouResults = await searchKugouLyrics(searchQuery, 1, MAX_SEARCH_RESULTS);

    const targetSong = { title, artist, album, durationMs };
    const decorateCandidate = (candidate: typeof song) => {
        const details = calculateMatchScoreDetails(targetSong, candidate);
        return {
            candidate,
            details,
            identityOk: details.titleMatched && (details.artistMatched || details.albumMatched === true),
        };
    };

    const qqDecorated = qqResults.map(decorateCandidate);
    const kugouDecorated = kugouResults.map(decorateCandidate);

    const qqPicked = pickSong(
        qqDecorated,
        entry => entry.details.score,
        entry => entry.identityOk && entry.details.score >= AUTO_MATCH_MIN_SCORE,
    );
    const kugouPicked = pickSong(
        kugouDecorated,
        entry => entry.details.score,
        entry => entry.identityOk && entry.details.score >= AUTO_MATCH_MIN_SCORE,
    );

    if (!qqPicked) {
        throw new Error('QQ search returned no usable candidates.');
    }
    if (!kugouPicked) {
        throw new Error('Kugou search returned no usable candidates.');
    }

    const rawQqLyrics = await fetchQQLyrics(qqPicked.candidate, { chorusRanges: neteaseProcessed.chorusRanges ?? [] });
    const rawKugouLyrics = await fetchKugouLyrics(kugouPicked.candidate, { chorusRanges: neteaseProcessed.chorusRanges ?? [] });

    const qqLyrics = trimMetadataLines(neteaseProcessed.lyrics, rawQqLyrics, normalizeLyricMatchText);
    const kugouLyrics = trimMetadataLines(neteaseProcessed.lyrics, rawKugouLyrics, normalizeLyricMatchText);

    const sourceAudits: SourceAudit[] = [
        {
            source: 'netease',
            candidate: {
                id: options.songId,
                title,
                artist,
                album,
                durationMs,
                score: 100,
                titleMatched: true,
                artistMatched: true,
                albumMatched: true,
                durationMatched: true,
            },
            lyrics: ((summary) => ({
                available: summary.available,
                isWordByWord: summary.isWordByWord,
                lineCount: summary.lineCount,
                matchedLineCount: summary.matchedLineCount,
                wordCount: summary.wordCount,
                firstLineStartSec: summary.firstLineStartSec,
                lastLineEndSec: summary.lastLineEndSec,
                timelineSpanSec: summary.timelineSpanSec,
            }))(summarizeLyrics(neteaseProcessed.lyrics, normalizeLyricMatchText)),
        },
        {
            source: 'qq',
            candidate: {
                id: qqPicked.candidate.id,
                title: qqPicked.candidate.name,
                artist: formatArtists(qqPicked.candidate.artists || qqPicked.candidate.ar),
                album: qqPicked.candidate.album?.name || qqPicked.candidate.al?.name || '',
                durationMs: qqPicked.candidate.duration || qqPicked.candidate.dt || 0,
                score: qqPicked.details.score,
                titleMatched: qqPicked.details.titleMatched,
                artistMatched: qqPicked.details.artistMatched,
                albumMatched: qqPicked.details.albumMatched,
                durationMatched: qqPicked.details.durationMatched,
            },
            lyrics: ((summary) => ({
                available: summary.available,
                isWordByWord: summary.isWordByWord,
                lineCount: summary.lineCount,
                matchedLineCount: summary.matchedLineCount,
                wordCount: summary.wordCount,
                firstLineStartSec: summary.firstLineStartSec,
                lastLineEndSec: summary.lastLineEndSec,
                timelineSpanSec: summary.timelineSpanSec,
            }))(summarizeLyrics(qqLyrics, normalizeLyricMatchText)),
        },
        {
            source: 'kugou',
            candidate: {
                id: kugouPicked.candidate.id,
                title: kugouPicked.candidate.name,
                artist: formatArtists(kugouPicked.candidate.artists || kugouPicked.candidate.ar),
                album: kugouPicked.candidate.album?.name || kugouPicked.candidate.al?.name || '',
                durationMs: kugouPicked.candidate.duration || kugouPicked.candidate.dt || 0,
                score: kugouPicked.details.score,
                titleMatched: kugouPicked.details.titleMatched,
                artistMatched: kugouPicked.details.artistMatched,
                albumMatched: kugouPicked.details.albumMatched,
                durationMatched: kugouPicked.details.durationMatched,
            },
            lyrics: ((summary) => ({
                available: summary.available,
                isWordByWord: summary.isWordByWord,
                lineCount: summary.lineCount,
                matchedLineCount: summary.matchedLineCount,
                wordCount: summary.wordCount,
                firstLineStartSec: summary.firstLineStartSec,
                lastLineEndSec: summary.lastLineEndSec,
                timelineSpanSec: summary.timelineSpanSec,
            }))(summarizeLyrics(kugouLyrics, normalizeLyricMatchText)),
        },
    ];

    const pairwise = [
        compareOffsets('netease', neteaseProcessed.lyrics, 'qq', qqLyrics, normalizeLyricMatchText),
        compareOffsets('netease', neteaseProcessed.lyrics, 'kugou', kugouLyrics, normalizeLyricMatchText),
        compareOffsets('qq', qqLyrics, 'kugou', kugouLyrics, normalizeLyricMatchText),
    ];

    const durationCalibration = evaluateDurationCalibration(pairwise, sourceAudits);

    const report: LyricSourceAuditReport = {
        requestedSongId: options.songId,
        song: {
            title,
            artist,
            album,
            durationMs,
            searchQuery,
        },
        sourceAudits,
        pairwise,
        durationCalibration,
        matchedLines: buildMatchedLines(
            neteaseProcessed.lyrics,
            qqLyrics,
            kugouLyrics,
            normalizeLyricMatchText
        ),
    };

    const finalOutputPath = options.outputPath || path.resolve(
        process.cwd(),
        'test/manual/lyric-audit-output',
        `${options.songId}.json`,
    );
    fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
    fs.writeFileSync(finalOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.error(`Wrote lyric source audit to ${finalOutputPath}`);
    return report;
};

const isDirectRun = process.argv[1]
    ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
    : false;

if (isDirectRun) {
    runLyricSourceOffsetAudit(parseArgs(process.argv.slice(2))).catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exitCode = 1;
    });
}
