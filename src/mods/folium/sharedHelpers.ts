import type { Line, Theme } from '@/types';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import { segmentLyricWords } from '@/utils/lyrics/wordSegmentation';
import { segmentIcuFolia } from '@/utils/lyrics/icuFolia';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '@/utils/fontStacks';
import { getRecentCompletedLine, getUpcomingLine, getUpcomingLines } from '@/components/visualizer/runtime';
import { buildWordColorRanges, resolveWordColor } from '@/components/visualizer/wordColoring';
import type { FoliumLine, FoliumLyricsHelpers, FoliumThemeHelpers } from './contract';
import { toFoliumLines } from './dto';
import { normalizeFoliumLyricsTrack, parseFoliumLyricsTrack } from './lyricsSource';

// src/mods/folium/sharedHelpers.ts
// `folium.lyrics` and `folium.theme`: the pure helpers builtin visualizers
// share, handed to mods so they lay out, time and color lyrics the same way.
// FoliumLine / FoliumTheme mirror the host Line / Theme, so every helper here
// is the host function itself behind a type boundary, not a second copy.
// Nothing here holds state, and both the main and the export window get it.
// `parse` is the one asynchronous helper: it runs the local lyric file
// pipeline, whose parsers live in a worker.

// FoliumLine carries every Line field the helpers read, under the same names.
const asLines = (lines: readonly FoliumLine[]) => lines as unknown as Line[];

const lyricsHelpers: FoliumLyricsHelpers = {
    getLineRenderEndTime: (line) => getLineRenderEndTime(line),
    // A mod's line carries the user's split but not icu-folia's baked one (the DTO copies only the
    // contract's fields), so the default split is computed here; it is memoised for per-frame use.
    segmentWords: (line) => segmentLyricWords({
        fullText: line.fullText,
        wordSegments: line.wordSegments,
        autoWordSegments: segmentIcuFolia(line.fullText) ?? undefined,
    }),
    getRecentCompletedLine: (lines, lineIndex, time) => (
        getRecentCompletedLine({
            lines: asLines(lines),
            currentLineIndex: lineIndex,
            currentTime: time,
            getLineEndTime: getLineRenderEndTime,
        }) as unknown as FoliumLine | null
    ),
    getUpcomingLine: (lines, lineIndex, time) => getUpcomingLine(asLines(lines), lineIndex, time) as unknown as FoliumLine | null,
    getUpcomingLines: (lines, lineIndex, count) => getUpcomingLines(asLines(lines), lineIndex, count) as unknown as FoliumLine[],
    buildWordColorRanges: (fullText, wordColors) => buildWordColorRanges(fullText, wordColors),
    resolveWordColor: (wordText, wordColors, fallbackColor, options) => (
        resolveWordColor(wordText, wordColors, fallbackColor, { cjkMatchMode: options?.cjkMatchMode })
    ),
    parse: async (track) => {
        const { track: checked, reason } = normalizeFoliumLyricsTrack(track);
        if (!checked) throw new TypeError(`invalid-lyrics-track: ${reason}`);
        const lyrics = await parseFoliumLyricsTrack(checked);
        return Object.freeze({
            lines: toFoliumLines(lyrics?.lines),
            isWordByWord: Boolean(lyrics?.isWordByWord && lyrics.lines.length > 0),
        });
    },
};

export const FOLIUM_LYRICS_HELPERS: FoliumLyricsHelpers = Object.freeze(lyricsHelpers);

const themeHelpers: FoliumThemeHelpers = {
    resolveFontStack: (theme) => resolveThemeFontStack(theme as Pick<Theme, 'fontStyle' | 'fontFamily' | 'fontFamilyStack'>),
    resolveTranslationFontStack: (theme) => (
        resolveThemeTranslationFontStack(theme as Pick<Theme, 'fontStyle' | 'fontFamily' | 'fontFamilyStack'>)
    ),
    resolveFontWeight: (theme, fallback) => resolveThemeFontWeight(theme, fallback),
};

export const FOLIUM_THEME_HELPERS: FoliumThemeHelpers = Object.freeze(themeHelpers);
