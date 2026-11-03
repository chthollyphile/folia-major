import type { LyricData } from '@/types';
import type { ChorusRange, ProviderLyricsResult } from '@/types/onlineMusic';
import { LocalFileLyricAdapter } from '@/utils/lyrics/adapters/LocalFileLyricAdapter';
import { resolveLyricProcessingOptions } from '@/utils/lyrics/filtering';
import { parseLRC } from '@/utils/lyrics/parserCore';
import type { FoliumLegacyLyricsResult, FoliumLyricFormat, FoliumLyricsTrack } from './contract';

// src/mods/folium/lyricsSource.ts
// Lyrics from a mod: it hands raw lyric text plus its format, and the host parses it exactly like a
// local lyric file (LocalFileLyricAdapter: .fia documents, awlrc containers, combined-timeline splitting,
// the parser worker). Shared by the `omni.providers` adapter and `folium.lyrics.parse`.
//
// Parsed with the defaults builtin providers use: interludes kept, no display filter. The filter runs
// when lyrics are shown (createLyricsSetter), so baking it in here would freeze the user's current
// pattern into the lyric cache.

export const FOLIUM_LYRIC_FORMATS: readonly FoliumLyricFormat[] = Object.freeze([
    'lrc', 'enhanced-lrc', 'yrc', 'qrc', 'krc', 'ttml', 'vtt', 'awlrc',
]);

/** Per text field, in UTF-16 code units. Lyric files are kilobytes; this only stops a runaway string. */
export const FOLIUM_LYRIC_TEXT_LIMIT = 1024 * 1024;
export const FOLIUM_CHORUS_RANGE_LIMIT = 64;

type TrackCheck = { track: FoliumLyricsTrack; reason?: undefined } | { track: null; reason: string };

const isFoliumLyricFormat = (value: unknown): value is FoliumLyricFormat => (
    typeof value === 'string' && (FOLIUM_LYRIC_FORMATS as readonly string[]).includes(value)
);

/** An optional text field: absent and empty both mean "none"; anything but a string is malformed. */
const checkOptionalText = (value: unknown, field: string): { text?: string; reason?: string } => {
    if (value === undefined || value === null || value === '') return {};
    if (typeof value !== 'string') return { reason: `${field} must be a string` };
    if (value.length > FOLIUM_LYRIC_TEXT_LIMIT) return { reason: `${field} is longer than ${FOLIUM_LYRIC_TEXT_LIMIT} characters` };
    return { text: value };
};

/** Validates a track from a mod and copies the fields the host reads, so later mutation cannot reach it. */
export const normalizeFoliumLyricsTrack = (value: unknown): TrackCheck => {
    if (!value || typeof value !== 'object') return { track: null, reason: 'not an object' };
    const raw = value as Record<string, unknown>;
    if (!isFoliumLyricFormat(raw.format)) {
        return { track: null, reason: `format must be one of ${FOLIUM_LYRIC_FORMATS.join(', ')}` };
    }
    if (typeof raw.text !== 'string' || !raw.text.trim()) return { track: null, reason: 'text must be a non-empty string' };
    if (raw.text.length > FOLIUM_LYRIC_TEXT_LIMIT) {
        return { track: null, reason: `text is longer than ${FOLIUM_LYRIC_TEXT_LIMIT} characters` };
    }
    const translation = checkOptionalText(raw.translationText, 'translationText');
    if (translation.reason) return { track: null, reason: translation.reason };
    const romanization = checkOptionalText(raw.romanizationText, 'romanizationText');
    if (romanization.reason) return { track: null, reason: romanization.reason };
    return {
        track: {
            format: raw.format,
            text: raw.text,
            ...(translation.text ? { translationText: translation.text } : {}),
            ...(romanization.text ? { romanizationText: romanization.text } : {}),
        },
    };
};

/** Parses a validated track through the local lyric file pipeline. */
export const parseFoliumLyricsTrack = (track: FoliumLyricsTrack): Promise<LyricData | null> => (
    new LocalFileLyricAdapter().parse({
        type: 'local',
        lrcContent: track.text,
        tLrcContent: track.translationText,
        rLrcContent: track.romanizationText,
        formatHint: track.format,
    }, resolveLyricProcessingOptions({}))
);

const normalizeChorusRanges = (value: unknown): ChorusRange[] => {
    if (!Array.isArray(value)) return [];
    const ranges: ChorusRange[] = [];
    for (const item of value) {
        if (ranges.length >= FOLIUM_CHORUS_RANGE_LIMIT) break;
        const startTime = Number((item as ChorusRange | null)?.startTime);
        const endTime = Number((item as ChorusRange | null)?.endTime);
        if (Number.isFinite(startTime) && Number.isFinite(endTime) && startTime >= 0 && startTime < endTime) {
            ranges.push({ startTime, endTime });
        }
    }
    return ranges;
};

const NO_LYRICS: ProviderLyricsResult = { lyrics: null, isPureMusic: false };

/**
 * Whether a `getLyrics` answer is the deprecated Folium 1.3 shape, `{ lrc, translationLrc }`: an `lrc`
 * string and neither track. registries/omniProviders.ts says it to the mod with the same test.
 */
export const isFoliumLegacyLyricsResult = (raw: unknown): raw is FoliumLegacyLyricsResult => {
    if (!raw || typeof raw !== 'object') return false;
    const result = raw as Record<string, unknown>;
    return result.main === undefined && result.wordByWord === undefined && typeof result.lrc === 'string';
};

/** The Folium 1.3 answer, read as plain LRC with its translation. Folium 2 drops it. */
const resolveLegacyLyricsResult = (raw: FoliumLegacyLyricsResult): ProviderLyricsResult => {
    if (!raw.lrc.trim()) return NO_LYRICS;
    const translationLrc = typeof raw.translationLrc === 'string' ? raw.translationLrc : undefined;
    return {
        lyrics: parseLRC(raw.lrc, translationLrc ?? ''),
        mainText: raw.lrc,
        translationText: translationLrc ?? null,
        isPureMusic: false,
    };
};

const hasLines = (lyrics: LyricData | null): lyrics is LyricData => Boolean(lyrics && lyrics.lines.length > 0);

/** A track that throws while parsing counts as one that parsed to nothing, so the fallback still runs. */
const tryParseTrack = async (track: FoliumLyricsTrack, label: string, key: string): Promise<LyricData | null> => {
    try {
        return await parseFoliumLyricsTrack(track);
    } catch (error) {
        console.warn(`[Folium] ${label}: the ${key} lyrics track failed to parse`, error);
        return null;
    }
};

/**
 * Turns a provider's `getLyrics` answer into the host's provider result. `label` names the provider in
 * warnings about tracks that were dropped as malformed.
 */
export const resolveFoliumLyricsResult = async (raw: unknown, label: string): Promise<ProviderLyricsResult> => {
    if (!raw || typeof raw !== 'object') return NO_LYRICS;
    if (isFoliumLegacyLyricsResult(raw)) return resolveLegacyLyricsResult(raw);
    const result = raw as Record<string, unknown>;
    if (result.isPureMusic === true) return { lyrics: null, isPureMusic: true };

    const checkTrack = (key: 'main' | 'wordByWord'): FoliumLyricsTrack | null => {
        if (result[key] === undefined || result[key] === null) return null;
        const { track, reason } = normalizeFoliumLyricsTrack(result[key]);
        if (!track) console.warn(`[Folium] ${label}: ignored the ${key} lyrics track (${reason})`);
        return track;
    };
    const main = checkTrack('main');
    const wordByWord = checkTrack('wordByWord');

    let chosen: FoliumLyricsTrack | null = null;
    let lyrics: LyricData | null = null;
    if (wordByWord) {
        // Like NetEase's yrc / ytlrc: a word-timed track without its own translation or romanization
        // borrows the line-timed track's.
        const merged: FoliumLyricsTrack = {
            ...wordByWord,
            ...(!wordByWord.translationText && main?.translationText ? { translationText: main.translationText } : {}),
            ...(!wordByWord.romanizationText && main?.romanizationText ? { romanizationText: main.romanizationText } : {}),
        };
        const parsed = await tryParseTrack(merged, label, 'wordByWord');
        if (hasLines(parsed)) {
            chosen = merged;
            lyrics = parsed;
        } else if (main) {
            console.warn(`[Folium] ${label}: the wordByWord lyrics track parsed to no lines; using main`);
        }
    }
    if (!lyrics && main) {
        const parsed = await tryParseTrack(main, label, 'main');
        if (hasLines(parsed)) {
            chosen = main;
            lyrics = parsed;
        }
    }
    if (!chosen || !lyrics) return NO_LYRICS;

    const chorusRanges = normalizeChorusRanges(result.chorusRanges);
    return {
        lyrics,
        // Raw text only where the host reads it as LRC: the chorus text fallback strips `[mm:ss.xx]`
        // tags and nothing else, so a TTML or YRC body there would silently match no line. Left empty,
        // the fallback rebuilds its text from the parsed lines instead.
        mainText: chosen === main && main.format === 'lrc' ? main.text : null,
        wordByWordText: null,
        translationText: chosen.translationText ?? null,
        romanizationText: chosen.romanizationText ?? null,
        isPureMusic: false,
        ...(chorusRanges.length > 0 ? { chorusRanges } : {}),
    };
};
