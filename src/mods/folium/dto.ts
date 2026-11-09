import type {
    Line,
    LyricAlternateText,
    LyricBackgroundVocal,
    LyricRuby,
    LyricSyllable,
    SongResult,
    Theme,
    Word,
} from '@/types';
import { buildLineRenderHints, getLineRenderHints } from '@/utils/lyrics/renderHints';
import { isValidWordSegmentation } from '@/utils/lyrics/wordSegmentation';
import { getLineBackgroundVocals } from '@/components/visualizer/harmonyRuntime';
import { getPlaybackSourceRef } from '@/utils/appPlaybackGuards';
import type { OnlineFailureCaseId } from '@/types/onlineMusic';
import type {
    FoliumBackgroundVocal,
    FoliumLine,
    FoliumLyricAlternateText,
    FoliumLyricSyllable,
    FoliumPlaybackFailureReason,
    FoliumSong,
    FoliumTheme,
    FoliumWord,
} from './contract';

// src/mods/folium/dto.ts
// Projections from host-internal types into the frozen Folium DTOs. This is the
// only place that knows both shapes, so a host refactor of Line / Theme /
// SongResult is absorbed here instead of breaking every mod.

const lineCache = new WeakMap<readonly Line[], readonly FoliumLine[]>();

// Frozen copies with optional fields left out when absent, so a projected
// object never carries keys the host line did not have.
const freezeRubies = (rubies: readonly LyricRuby[]) => Object.freeze(rubies.map((ruby) => Object.freeze({
    text: ruby.text,
    startTime: ruby.startTime,
    endTime: ruby.endTime,
})));

const freezeSyllables = (syllables: readonly LyricSyllable[]): FoliumLyricSyllable[] => Object.freeze(syllables.map((syllable) => Object.freeze({
    text: syllable.text,
    startTime: syllable.startTime,
    endTime: syllable.endTime,
    ...(syllable.endsWithSpace !== undefined ? { endsWithSpace: syllable.endsWithSpace } : {}),
    ...(syllable.ruby?.length ? { ruby: freezeRubies(syllable.ruby) } : {}),
    ...(syllable.obscene !== undefined ? { obscene: syllable.obscene } : {}),
    ...(syllable.emptyBeat !== undefined ? { emptyBeat: syllable.emptyBeat } : {}),
}))) as FoliumLyricSyllable[];

const freezeWords = (words: readonly Word[] | undefined): FoliumWord[] => Object.freeze((words ?? []).map((word) => Object.freeze({
    text: word.text,
    startTime: word.startTime,
    endTime: word.endTime,
    ...(word.syllables?.length ? { syllables: freezeSyllables(word.syllables) } : {}),
}))) as FoliumWord[];

const freezeAlternateTexts = (texts: readonly LyricAlternateText[]): FoliumLyricAlternateText[] => Object.freeze(texts.map((alternate) => Object.freeze({
    role: alternate.role,
    ...(alternate.language !== undefined ? { language: alternate.language } : {}),
    text: alternate.text,
    ...(alternate.syllables?.length ? { syllables: freezeSyllables(alternate.syllables) } : {}),
}))) as FoliumLyricAlternateText[];

const freezeBackgroundVocal = (vocal: LyricBackgroundVocal): FoliumBackgroundVocal => Object.freeze({
    text: vocal.text,
    startTime: vocal.startTime,
    endTime: vocal.endTime,
    words: freezeWords(vocal.words),
    ...(vocal.agentId !== undefined ? { agentId: vocal.agentId } : {}),
    ...(vocal.translation ? { translation: vocal.translation } : {}),
    ...(vocal.romanization ? { romanization: vocal.romanization } : {}),
    ...(vocal.alternateTexts?.length ? { alternateTexts: freezeAlternateTexts(vocal.alternateTexts) } : {}),
});

const toFoliumLine = (line: Line): FoliumLine => {
    const backgroundVocals = getLineBackgroundVocals(line);
    const renderHints = getLineRenderHints(line)!;
    return Object.freeze({
        words: freezeWords(line.words),
        startTime: line.startTime,
        endTime: line.endTime,
        fullText: line.fullText ?? (line.words ?? []).map((word) => word.text).join(''),
        renderHints: Object.freeze({ ...renderHints }),
        ...(line.translation ? { translation: line.translation } : {}),
        ...(line.romanization ? { romanization: line.romanization } : {}),
        ...(line.alternateTexts?.length ? { alternateTexts: freezeAlternateTexts(line.alternateTexts) } : {}),
        ...(line.id !== undefined ? { id: line.id } : {}),
        ...(line.agentId !== undefined ? { agentId: line.agentId } : {}),
        ...(line.songPart !== undefined ? { songPart: line.songPart } : {}),
        ...(line.blockIndex !== undefined ? { blockIndex: line.blockIndex } : {}),
        ...(line.isChorus !== undefined ? { isChorus: line.isChorus } : {}),
        ...(line.chorusEffect !== undefined ? { chorusEffect: line.chorusEffect } : {}),
        ...(backgroundVocals.length > 0
            ? { backgroundVocals: Object.freeze(backgroundVocals.map(freezeBackgroundVocal)) as FoliumBackgroundVocal[] }
            : {}),
        ...(line.wordSegments?.length ? { wordSegments: Object.freeze([...line.wordSegments]) as string[] } : {}),
    });
};

/*
 * Lines are projected once per lyric array identity: the host replaces the
 * array when lyrics change (a saved word split included), so identity is
 * exactly the invalidation signal, and every mount of the same song shares one
 * frozen projection.
 */
export const toFoliumLines = (lines: readonly Line[] | null | undefined): readonly FoliumLine[] => {
    if (!lines || lines.length === 0) return Object.freeze([]);
    const cached = lineCache.get(lines);
    if (cached) return cached;
    const projected = Object.freeze(lines.map(toFoliumLine));
    lineCache.set(lines, projected);
    return projected;
};

const DEFAULT_THEME: Theme = {
    name: 'default',
    backgroundColor: '#09090b',
    primaryColor: '#fafafa',
    accentColor: '#fafafa',
    secondaryColor: '#a1a1aa',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

/** The host Theme field for field (see contract.ts), plus isDaylight. */
export const toFoliumTheme = (theme: Theme | null | undefined, isDaylight: boolean): FoliumTheme => {
    const source = theme ?? DEFAULT_THEME;
    return {
        name: source.name ?? DEFAULT_THEME.name,
        backgroundColor: source.backgroundColor ?? DEFAULT_THEME.backgroundColor,
        primaryColor: source.primaryColor ?? DEFAULT_THEME.primaryColor,
        accentColor: source.accentColor ?? DEFAULT_THEME.accentColor,
        secondaryColor: source.secondaryColor ?? DEFAULT_THEME.secondaryColor,
        fontStyle: source.fontStyle ?? DEFAULT_THEME.fontStyle,
        ...(source.fontFamily ? { fontFamily: source.fontFamily } : {}),
        ...(source.fontFamilyStack?.length ? { fontFamilyStack: Object.freeze([...source.fontFamilyStack]) as string[] } : {}),
        ...(source.fontWeight !== undefined ? { fontWeight: source.fontWeight } : {}),
        animationIntensity: source.animationIntensity ?? DEFAULT_THEME.animationIntensity,
        ...(source.wordColors?.length
            ? { wordColors: Object.freeze(source.wordColors.map((entry) => Object.freeze({ word: entry.word, color: entry.color }))) as FoliumTheme['wordColors'] }
            : {}),
        ...(source.lyricsIcons?.length ? { lyricsIcons: Object.freeze([...source.lyricsIcons]) as string[] } : {}),
        ...(source.provider ? { provider: source.provider } : {}),
        ...(source.description ? { description: source.description } : {}),
        isDaylight,
    };
};

const describeSource = (song: SongResult): string | null => {
    try {
        const ref = getPlaybackSourceRef(song);
        return ref.kind === 'online' ? ref.providerId : ref.kind;
    } catch {
        return null;
    }
};

/*
 * Song refs: opaque tokens that let a mod hand a song back to the host
 * (playSong, enqueue, beforePlay.replaceWith) without ever holding a
 * SongResult. The same host object always gets the same token; the map is
 * bounded, so a token for a long-gone song eventually stops resolving.
 * Eviction is least recently handed out, not oldest minted: a reused token
 * moves to the end of the map, so minting the rest of one getQueue page (at
 * most 500 songs, well under the bound) can never evict a token that same
 * page has just returned.
 */
/**
 * How many song refs stay resolvable (Folium 1.7: 5,000, up from 2,000). `folium.omni` pages
 * (searches, lookups, an album's songs) share the pool with the queue, so one mod reading many pages
 * must not push out the refs the queue and other mods hold; one call still returns far fewer.
 */
export const FOLIUM_SONG_REF_POOL_SIZE = 5000;
/** How every song ref begins; `folium.omni` tells a song DTO from a collection DTO by it. */
export const FOLIUM_SONG_REF_PREFIX = 'song-';
const refBySong = new WeakMap<SongResult, string>();
const songByRef = new Map<string, SongResult>();
let refCounter = 0;

const refFor = (song: SongResult): string => {
    const existing = refBySong.get(song);
    if (existing && songByRef.has(existing)) {
        // Map keeps insertion order: delete and set again to mark the token as just used.
        songByRef.delete(existing);
        songByRef.set(existing, song);
        return existing;
    }
    refCounter += 1;
    const ref = `${FOLIUM_SONG_REF_PREFIX}${refCounter.toString(36)}`;
    refBySong.set(song, ref);
    songByRef.set(ref, song);
    if (songByRef.size > FOLIUM_SONG_REF_POOL_SIZE) {
        const oldest = songByRef.keys().next().value;
        if (oldest !== undefined) songByRef.delete(oldest);
    }
    return ref;
};

/** The host song behind a DTO's `ref`, or null when unknown or expired. */
export const resolveFoliumSongRef = (ref: unknown): SongResult | null => (
    typeof ref === 'string' ? songByRef.get(ref) ?? null : null
);

export const toFoliumSong = (song: SongResult | null | undefined): FoliumSong | null => {
    if (!song) return null;
    return {
        id: song.id === undefined || song.id === null ? null : String(song.id),
        title: song.name ?? '',
        artist: (song.artists ?? []).map((artist) => artist?.name).filter(Boolean).join(' / '),
        album: song.album?.name ?? null,
        source: describeSource(song),
        ref: refFor(song),
    };
};

// Host reason codes are not API: mods see five coarse classes. A Record so a new host reason fails
// the type check until it is classed here.
const FOLIUM_PLAYBACK_FAILURE_REASONS: Readonly<Record<OnlineFailureCaseId, FoliumPlaybackFailureReason>> = Object.freeze({
    'sign-in-needed': 'auth',
    'account-refused': 'restricted',
    'subscription-required': 'restricted',
    'purchase-required': 'restricted',
    'entitlement-required': 'restricted',
    'preview-only': 'restricted',
    'region-restricted': 'restricted',
    'not-public': 'restricted',
    'taken-down': 'taken-down',
    unreachable: 'network',
    'local-service-stopped': 'network',
    'retry-later': 'network',
    'not-configured': 'unknown',
    'no-audio': 'unknown',
    'audio-unplayable': 'unknown',
    refused: 'unknown',
    unknown: 'unknown',
});

/** The coarse Folium class of a host failure reason; no reason (a path without one) is `unknown`. */
export const toFoliumPlaybackFailureReason = (reason: OnlineFailureCaseId | null | undefined): FoliumPlaybackFailureReason => (
    reason && Object.prototype.hasOwnProperty.call(FOLIUM_PLAYBACK_FAILURE_REASONS, reason)
        ? FOLIUM_PLAYBACK_FAILURE_REASONS[reason]
        : 'unknown'
);

/** Song DTO from the title/artist pair visualizers receive (no SongResult there). */
export const toFoliumSongFromMeta = (
    title: string | null | undefined,
    artist: string | null | undefined,
    album?: string | null,
): FoliumSong | null => (
    title || artist
        ? { id: null, title: title ?? '', artist: artist ?? '', album: album ?? null, source: null, ref: null }
        : null
);

// Mod-supplied objects: any shape until each field is checked.
type RawRecord = Record<string, unknown>;

const isTimed = (value: unknown): value is RawRecord & { startTime: number; endTime: number } => (
    Boolean(value)
    && Number.isFinite((value as { startTime?: unknown }).startTime)
    && Number.isFinite((value as { endTime?: unknown }).endTime)
);

const hasText = (value: unknown): value is RawRecord & { text: string } => (
    Boolean(value) && typeof (value as { text?: unknown }).text === 'string'
);

const optionalString = <K extends string>(key: K, value: unknown) => (
    typeof value === 'string' ? { [key]: value } as Record<K, string> : {}
);

const optionalNumber = <K extends string>(key: K, value: unknown) => (
    Number.isFinite(value) ? { [key]: value as number } as Record<K, number> : {}
);

const optionalBoolean = <K extends string>(key: K, value: unknown) => (
    typeof value === 'boolean' ? { [key]: value } as Record<K, boolean> : {}
);

const hostSyllables = (value: unknown): LyricSyllable[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const syllables = value
        .filter((syllable) => hasText(syllable) && isTimed(syllable))
        .map((syllable): LyricSyllable => ({
            text: syllable.text,
            startTime: syllable.startTime,
            endTime: syllable.endTime,
            ...optionalBoolean('endsWithSpace', syllable.endsWithSpace),
            ...(Array.isArray(syllable.ruby)
                ? { ruby: (syllable.ruby.filter((ruby) => hasText(ruby) && isTimed(ruby)) as LyricRuby[]).map((ruby) => ({ text: ruby.text, startTime: ruby.startTime, endTime: ruby.endTime })) }
                : {}),
            ...optionalBoolean('obscene', syllable.obscene),
            ...optionalNumber('emptyBeat', syllable.emptyBeat),
        }));
    return syllables.length > 0 ? syllables : undefined;
};

const hostWords = (value: unknown): Word[] => (
    Array.isArray(value)
        ? value
            .filter((word) => hasText(word) && isTimed(word))
            .map((word): Word => {
                const syllables = hostSyllables(word.syllables);
                return { text: word.text, startTime: word.startTime, endTime: word.endTime, ...(syllables ? { syllables } : {}) };
            })
        : []
);

const hostAlternateTexts = (value: unknown): LyricAlternateText[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const texts = value
        .filter((alternate) => hasText(alternate) && typeof alternate.role === 'string')
        .map((alternate): LyricAlternateText => {
            const syllables = hostSyllables(alternate.syllables);
            return {
                role: alternate.role as string,
                ...optionalString('language', alternate.language),
                text: alternate.text,
                ...(syllables ? { syllables } : {}),
            };
        });
    return texts.length > 0 ? texts : undefined;
};

const hostBackgroundVocals = (value: unknown): LyricBackgroundVocal[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const vocals = value
        .filter((vocal) => hasText(vocal) && isTimed(vocal))
        .map((vocal): LyricBackgroundVocal => {
            const alternateTexts = hostAlternateTexts(vocal.alternateTexts);
            return {
                text: vocal.text,
                startTime: vocal.startTime,
                endTime: vocal.endTime,
                words: hostWords(vocal.words),
                ...optionalString('agentId', vocal.agentId),
                ...optionalString('translation', vocal.translation),
                ...optionalString('romanization', vocal.romanization),
                ...(alternateTexts ? { alternateTexts } : {}),
            };
        });
    return vocals.length > 0 ? vocals : undefined;
};

const CHORUS_EFFECTS = new Set(['bars', 'circles', 'beams']);

/*
 * Maps transformed DTO lines back to host lines. A line object the handler
 * left in place keeps its original host Line; a new or edited one is rebuilt
 * from its DTO fields, each checked on the way in. Render hints are never
 * taken from the mod: the host recomputes them from the rebuilt timing, and a
 * word split that no longer joins back to the text is dropped.
 */
export const fromFoliumLines = (original: readonly Line[], originalDtos: readonly FoliumLine[], next: readonly FoliumLine[]): Line[] => {
    const indexByDto = new Map(originalDtos.map((dto, index) => [dto, index] as const));
    const lines: Line[] = [];
    next.forEach((dto) => {
        const index = indexByDto.get(dto);
        if (index !== undefined) {
            lines.push(original[index]);
            return;
        }
        if (!dto || typeof dto.fullText !== 'string' || !isTimed(dto)) {
            return;
        }
        const words = hostWords(dto.words);
        const alternateTexts = hostAlternateTexts(dto.alternateTexts);
        const backgroundVocals = hostBackgroundVocals(dto.backgroundVocals);
        const wordSegments = Array.isArray(dto.wordSegments)
            && dto.wordSegments.every((segment) => typeof segment === 'string')
            && isValidWordSegmentation(dto.fullText, dto.wordSegments)
            ? [...dto.wordSegments]
            : undefined;
        const line: Line = {
            words: words.length > 0 ? words : [{ text: dto.fullText, startTime: dto.startTime, endTime: dto.endTime }],
            startTime: dto.startTime,
            endTime: dto.endTime,
            fullText: dto.fullText,
            ...optionalString('translation', dto.translation),
            ...optionalString('romanization', dto.romanization),
            ...(alternateTexts ? { alternateTexts } : {}),
            ...optionalString('id', dto.id),
            ...optionalString('agentId', dto.agentId),
            ...optionalString('songPart', dto.songPart),
            ...optionalNumber('blockIndex', dto.blockIndex),
            ...optionalBoolean('isChorus', dto.isChorus),
            ...(CHORUS_EFFECTS.has(dto.chorusEffect as string) ? { chorusEffect: dto.chorusEffect } : {}),
            ...(backgroundVocals ? { backgroundVocals } : {}),
            ...(wordSegments ? { wordSegments } : {}),
        };
        lines.push({ ...line, renderHints: buildLineRenderHints(line) });
    });
    return lines;
};
