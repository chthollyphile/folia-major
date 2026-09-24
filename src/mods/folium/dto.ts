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

export const toFoliumSong = (song: SongResult | null | undefined): FoliumSong | null => {
    if (!song) return null;
    return {
        id: song.id === undefined || song.id === null ? null : String(song.id),
        title: song.name ?? '',
        artist: (song.artists ?? []).map((artist) => artist?.name).filter(Boolean).join(' / '),
        album: song.album?.name ?? null,
        source: describeSource(song),
    };
};

/** Song DTO from the title/artist pair visualizers receive (no SongResult there). */
export const toFoliumSongFromMeta = (
    title: string | null | undefined,
    artist: string | null | undefined,
    album?: string | null,
): FoliumSong | null => (
    title || artist
        ? { id: null, title: title ?? '', artist: artist ?? '', album: album ?? null, source: null }
        : null
);
