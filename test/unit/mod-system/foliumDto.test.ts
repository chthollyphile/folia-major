import { describe, expect, it } from 'vitest';
import type { Line, SongResult, Theme } from '@/types';
import { fromFoliumLines, toFoliumLines, toFoliumPlaybackFailureReason, toFoliumSong, toFoliumTheme } from '@/mods/folium/dto';
import type { OnlineFailureCaseId } from '@/types/onlineMusic';
import { FOLIUM_LYRICS_HELPERS, FOLIUM_THEME_HELPERS } from '@/mods/folium/sharedHelpers';
import { buildLineRenderHints, getLineRenderEndTime, getLineRenderHints } from '@/utils/lyrics/renderHints';
import { resolveThemeFontStack } from '@/utils/fontStacks';

// test/unit/mod-system/foliumDto.test.ts
// The DTO projections are the only place that knows host types and Folium
// types at once. These pin that lines and themes mirror the host shapes field
// for field, that nothing else leaks, that edited lines come back validated,
// and that the shared helpers answer exactly as the host functions do.

const line = (overrides: Partial<Line> = {}): Line => ({
    words: [{ text: 'hi', startTime: 1, endTime: 2 }],
    startTime: 1,
    endTime: 2,
    fullText: 'hi',
    ...overrides,
});

describe('toFoliumLines', () => {
    it('mirrors the host line field for field', () => {
        const vocal = { text: 'ooh', startTime: 1.2, endTime: 1.8, words: [{ text: 'ooh', startTime: 1.2, endTime: 1.8 }], agentId: 'v2' };
        const source = line({
            words: [{ text: 'hi', startTime: 1, endTime: 2, syllables: [{ text: 'hi', startTime: 1, endTime: 2, ruby: [{ text: 'ひ', startTime: 1, endTime: 2 }] }] }],
            translation: 'salut',
            romanization: 'hai',
            alternateTexts: [{ role: 'translation', language: 'fr', text: 'salut' }],
            id: 'L1',
            agentId: 'v1',
            songPart: 'Chorus',
            blockIndex: 3,
            isChorus: true,
            chorusEffect: 'bars',
            backgroundVocals: [vocal],
            wordSegments: ['h', 'i'],
        });
        const [projected] = toFoliumLines([source]);
        expect(projected).toEqual({
            words: source.words,
            startTime: 1,
            endTime: 2,
            fullText: 'hi',
            renderHints: getLineRenderHints(source),
            translation: 'salut',
            romanization: 'hai',
            alternateTexts: source.alternateTexts,
            id: 'L1',
            agentId: 'v1',
            songPart: 'Chorus',
            blockIndex: 3,
            isChorus: true,
            chorusEffect: 'bars',
            backgroundVocals: [vocal],
            wordSegments: ['h', 'i'],
        });
    });

    it('omits absent optional fields and always fills render hints', () => {
        const source = line();
        const [projected] = toFoliumLines([source]);
        expect(Object.keys(projected).sort()).toEqual(['endTime', 'fullText', 'renderHints', 'startTime', 'words']);
        expect(projected.endTime).toBe(2);
        expect(projected.renderHints.renderEndTime).toBe(getLineRenderEndTime(source));
    });

    it('folds the legacy single background vocal into backgroundVocals', () => {
        const vocal = { text: 'ah', startTime: 1, endTime: 2, words: [] };
        expect(toFoliumLines([line({ backgroundVocal: vocal })])[0].backgroundVocals).toEqual([vocal]);
    });

    it('never leaks host-only fields', () => {
        const [projected] = toFoliumLines([line({ extra: 1 } as unknown as Partial<Line>)]);
        expect(projected).not.toHaveProperty('extra');
        expect(projected).not.toHaveProperty('backgroundVocal');
    });

    it('caches by array identity and freezes deeply', () => {
        const lines = [line({ words: [{ text: 'hi', startTime: 1, endTime: 2, syllables: [{ text: 'hi', startTime: 1, endTime: 2 }] }] })];
        const first = toFoliumLines(lines);
        expect(toFoliumLines(lines)).toBe(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first[0])).toBe(true);
        expect(Object.isFrozen(first[0].renderHints)).toBe(true);
        expect(Object.isFrozen(first[0].words[0].syllables![0])).toBe(true);
    });

    it('falls back to joined words when fullText is missing', () => {
        const [projected] = toFoliumLines([line({ fullText: undefined as unknown as string })]);
        expect(projected.fullText).toBe('hi');
    });
});

describe('fromFoliumLines', () => {
    it('keeps untouched lines and rebuilds edited ones with validated fields', () => {
        const kept = line();
        const edited = line({ startTime: 3, endTime: 4, fullText: 'yo', words: [] });
        const dtos = toFoliumLines([kept, edited]);
        const [first, second] = fromFoliumLines([kept, edited], dtos, [
            dtos[0],
            {
                ...dtos[1],
                fullText: 'you',
                isChorus: true,
                songPart: 'Verse',
                wordSegments: ['yo', 'u'],
                chorusEffect: 'nope' as never,
                renderHints: { ...dtos[1].renderHints, renderEndTime: 999 },
            },
        ]);
        expect(first).toBe(kept);
        expect(second).toMatchObject({ fullText: 'you', isChorus: true, songPart: 'Verse', wordSegments: ['yo', 'u'] });
        expect(second).not.toHaveProperty('chorusEffect');
        // Render hints come from the host, never from the mod.
        expect(second.renderHints).toEqual(buildLineRenderHints(second));
    });

    it('drops a word split that no longer joins back to the text', () => {
        const source = line();
        const dtos = toFoliumLines([source]);
        const [rebuilt] = fromFoliumLines([source], dtos, [{ ...dtos[0], fullText: 'hey', wordSegments: ['h', 'i'] }]);
        expect(rebuilt).not.toHaveProperty('wordSegments');
    });
});

describe('toFoliumTheme', () => {
    it('mirrors the host theme and adds isDaylight', () => {
        const theme: Theme = {
            name: 't', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#f0f', secondaryColor: '#888',
            fontStyle: 'serif', fontFamily: 'Custom', fontFamilyStack: ['Custom', 'Other'], fontWeight: 700,
            animationIntensity: 'chaotic', wordColors: [{ word: 'love', color: '#f00' }], lyricsIcons: ['heart'],
            provider: 'ai', description: 'desc',
        };
        expect(toFoliumTheme(theme, true)).toEqual({ ...theme, isDaylight: true });
    });

    it('leaves the user font family unresolved; the helper resolves it like builtin modes do', () => {
        const theme = { name: 't', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#f0f', secondaryColor: '#888', fontStyle: 'serif', animationIntensity: 'normal' } as Theme;
        const projected = toFoliumTheme(theme, false);
        expect(projected).not.toHaveProperty('fontFamily');
        expect(FOLIUM_THEME_HELPERS.resolveFontStack(projected)).toBe(resolveThemeFontStack(theme));
    });

    it('has safe defaults without a theme', () => {
        const projected = toFoliumTheme(null, false);
        expect(projected.backgroundColor).toBeTruthy();
        expect(projected.fontStyle).toBe('sans');
        expect(projected.animationIntensity).toBe('normal');
    });
});

describe('folium.lyrics helpers', () => {
    const lines = toFoliumLines([
        line({ startTime: 0, endTime: 1, fullText: 'a', words: [] }),
        line({ startTime: 2, endTime: 3, fullText: 'b', words: [] }),
        line({ startTime: 4, endTime: 5, fullText: 'c', words: [] }),
    ]);

    it('reads the render end time and the neighbouring lines', () => {
        expect(FOLIUM_LYRICS_HELPERS.getLineRenderEndTime(lines[0])).toBe(lines[0].renderHints.renderEndTime);
        expect(FOLIUM_LYRICS_HELPERS.getLineRenderEndTime(null)).toBe(Number.NEGATIVE_INFINITY);
        expect(FOLIUM_LYRICS_HELPERS.getUpcomingLine(lines, 0, 0.5)).toBe(lines[1]);
        expect(FOLIUM_LYRICS_HELPERS.getUpcomingLine(lines, -1, 3.5)).toBe(lines[2]);
        expect(FOLIUM_LYRICS_HELPERS.getUpcomingLines(lines, 0)).toEqual([lines[1], lines[2]]);
        expect(FOLIUM_LYRICS_HELPERS.getRecentCompletedLine(lines, -1, 3.9)).toBe(lines[1]);
    });

    it('segments words with the saved split first', () => {
        expect(FOLIUM_LYRICS_HELPERS.segmentWords({ fullText: '你好世界', wordSegments: ['你好', '世界'] }).map((part) => part.segment))
            .toEqual(['你好', '世界']);
        expect(FOLIUM_LYRICS_HELPERS.segmentWords({ fullText: 'hello world' }).filter((part) => part.isWordLike).map((part) => part.segment))
            .toEqual(['hello', 'world']);
    });

    it('colors keywords the way builtin modes do', () => {
        const wordColors = [{ word: 'love', color: '#f00' }];
        expect(FOLIUM_LYRICS_HELPERS.resolveWordColor('Love', wordColors, '#fff')).toBe('#f00');
        expect(FOLIUM_LYRICS_HELPERS.resolveWordColor('hate', wordColors, '#fff')).toBe('#fff');
        expect(FOLIUM_LYRICS_HELPERS.buildWordColorRanges('i love you', wordColors)).toEqual([
            expect.objectContaining({ startOffset: 2, endOffset: 6, color: '#f00' }),
        ]);
    });
});

describe('toFoliumSong', () => {
    it('joins artists and reports the source kind', () => {
        const song = {
            id: 42,
            name: 'Song',
            artists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
            album: { id: 3, name: 'Album' },
            durationMs: 1000,
        } as unknown as SongResult;
        expect(toFoliumSong(song)).toEqual({ id: '42', title: 'Song', artist: 'A / B', album: 'Album', source: 'netease', ref: expect.any(String) });
        expect(toFoliumSong(song)!.ref).toBe(toFoliumSong(song)!.ref);
        expect(toFoliumSong(null)).toBeNull();
    });
});

describe('toFoliumPlaybackFailureReason', () => {
    // Every host reason, with the coarse class mods see. A Record so a reason added to the host type
    // without a row here fails the type check, and the length check below catches a dropped row.
    const CLASSES: Record<OnlineFailureCaseId, string> = {
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
    };

    it('classes all seventeen host reasons', () => {
        expect(Object.keys(CLASSES)).toHaveLength(17);
        for (const [reason, expected] of Object.entries(CLASSES)) {
            expect(toFoliumPlaybackFailureReason(reason as OnlineFailureCaseId), reason).toBe(expected);
        }
    });

    it('only ever answers one of the five contract classes', () => {
        const allowed = new Set(['auth', 'restricted', 'taken-down', 'network', 'unknown']);
        for (const reason of Object.keys(CLASSES)) {
            expect(allowed.has(toFoliumPlaybackFailureReason(reason as OnlineFailureCaseId))).toBe(true);
        }
    });

    it('treats a path without a reason, or a reason it does not know, as unknown', () => {
        expect(toFoliumPlaybackFailureReason(null)).toBe('unknown');
        expect(toFoliumPlaybackFailureReason(undefined)).toBe('unknown');
        expect(toFoliumPlaybackFailureReason('brand-new-reason' as OnlineFailureCaseId)).toBe('unknown');
    });
});
