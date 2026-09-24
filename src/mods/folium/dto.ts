import type { Line, SongResult, Theme } from '@/types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '@/utils/fontStacks';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import { getPlaybackSourceRef } from '@/utils/appPlaybackGuards';
import type { FoliumLine, FoliumSong, FoliumTheme } from './contract';

// src/mods/folium/dto.ts
// Projections from host-internal types into the frozen Folium DTOs. This is the
// only place that knows both shapes, so a host refactor of Line / Theme /
// SongResult is absorbed here instead of breaking every mod.

const DEFAULT_LYRIC_FONT_WEIGHT = 500;

const lineCache = new WeakMap<readonly Line[], readonly FoliumLine[]>();

/*
 * Lines are projected once per lyric array identity: the host replaces the
 * array when lyrics change, so identity is exactly the invalidation signal,
 * and every mount of the same song shares one frozen projection.
 */
export const toFoliumLines = (lines: readonly Line[] | null | undefined): readonly FoliumLine[] => {
    if (!lines || lines.length === 0) return Object.freeze([]);
    const cached = lineCache.get(lines);
    if (cached) return cached;
    const projected = Object.freeze(lines.map((line) => Object.freeze({
        text: line.fullText ?? (line.words ?? []).map((word) => word.text).join(''),
        startTime: line.startTime,
        endTime: getLineRenderEndTime(line),
        words: Object.freeze((line.words ?? []).map((word) => Object.freeze({
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
        }))) as FoliumLine['words'],
        ...(line.translation ? { translation: line.translation } : {}),
        ...(line.romanization ? { romanization: line.romanization } : {}),
    })));
    lineCache.set(lines, projected);
    return projected;
};

export const toFoliumTheme = (theme: Theme | null | undefined, isDaylight: boolean): FoliumTheme => ({
    backgroundColor: theme?.backgroundColor ?? '#09090b',
    primaryColor: theme?.primaryColor ?? '#fafafa',
    secondaryColor: theme?.secondaryColor ?? '#a1a1aa',
    accentColor: theme?.accentColor ?? '#fafafa',
    fontFamily: resolveThemeFontStack({
        fontStyle: theme?.fontStyle ?? 'sans',
        fontFamily: theme?.fontFamily,
        fontFamilyStack: theme?.fontFamilyStack,
    }),
    fontWeight: resolveThemeFontWeight(theme, DEFAULT_LYRIC_FONT_WEIGHT),
    isDaylight,
});

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
 */
const MAX_SONG_REFS = 2000;
const refBySong = new WeakMap<SongResult, string>();
const songByRef = new Map<string, SongResult>();
let refCounter = 0;

const refFor = (song: SongResult): string => {
    const existing = refBySong.get(song);
    if (existing && songByRef.has(existing)) return existing;
    refCounter += 1;
    const ref = `song-${refCounter.toString(36)}`;
    refBySong.set(song, ref);
    songByRef.set(ref, song);
    if (songByRef.size > MAX_SONG_REFS) {
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

/*
 * Maps transformed DTO lines back to host lines. A line object the handler
 * left in place keeps its original host Line (with render hints, agents,
 * background vocals…); a new or edited one is rebuilt from its DTO fields.
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
        if (!dto || typeof dto.text !== 'string' || !Number.isFinite(dto.startTime) || !Number.isFinite(dto.endTime)) {
            return;
        }
        const words = Array.isArray(dto.words)
            ? dto.words
                .filter((word) => word && typeof word.text === 'string' && Number.isFinite(word.startTime) && Number.isFinite(word.endTime))
                .map((word) => ({ text: word.text, startTime: word.startTime, endTime: word.endTime }))
            : [];
        lines.push({
            words: words.length > 0 ? words : [{ text: dto.text, startTime: dto.startTime, endTime: dto.endTime }],
            startTime: dto.startTime,
            endTime: dto.endTime,
            fullText: dto.text,
            ...(typeof dto.translation === 'string' ? { translation: dto.translation } : {}),
            ...(typeof dto.romanization === 'string' ? { romanization: dto.romanization } : {}),
        });
    });
    return lines;
};
