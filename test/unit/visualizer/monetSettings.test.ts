import { describe, expect, it } from 'vitest';
import { DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, type Line, type Theme } from '@/types';
import { getMonetBackgroundCacheKey, resolveWashColor, checkCanvasFilterSupport } from '@/components/visualizer/monet/monetBackgroundPipeline';
import { resolveMonetWordColor } from '@/components/visualizer/monet/MonetLyricsRail';
import { buildMonetDisplayTokens, resolveMonetLyricContext } from '@/components/visualizer/monet/VisualizerMonet';
import { buildMonetVisibleLineEntries } from '@/components/visualizer/monet/monetLyricsModel';
import { colorWithAlpha, mixColors, parseColorChannels } from '@/components/visualizer/colorMix';
import { buildWordColorRanges, prepareWordColorMatchers, resolveTokenColorMap } from '@/components/visualizer/wordColoring';
import { resolveStoredMonetBackgroundTuning, resolveStoredMonetTuning, resolveVisualizerBackgroundMode } from '@/stores/useSettingsUiStore';

// test/unit/visualizer/monetSettings.test.ts
// Locks Monet tuning normalization, background cache keys, and lyric helper contracts.
describe('Monet tuning and lyric helpers', () => {
    it('keeps bright wash targets bright in daylight themes instead of pulling them toward dark text color', () => {
        const washColor = resolveWashColor(
            0.95,
            { r: 245, g: 245, b: 244 },
            { r: 234, g: 88, b: 12 },
            { r: 28, g: 25, b: 23 },
        );

        expect(washColor.r).toBeGreaterThan(220);
        expect(washColor.g).toBeGreaterThan(190);
        expect(washColor.b).toBeGreaterThan(170);
    });

    it('normalizes persisted Monet background tuning values from legacy storage', () => {
        expect(resolveStoredMonetBackgroundTuning({
            backgroundSource: 'uploaded-global',
            backgroundBlurPx: 999,
            backgroundOverlayOpacity: -2,
            backgroundCropMode: 'full-artwork',
            backgroundLayout: 'full-overlay',
            backgroundGrayscale: -1,
            backgroundSaturation: 9,
            backgroundWash: 2,
            backgroundHalfPaneOffsetX: 99,
            backgroundWashColorMode: 'custom',
            backgroundWashCustomColor: 'AABBCC',
            coverPaneRatio: 0.9,
            lyricsFocusScale: 4,
        })).toEqual({
            backgroundSource: 'uploaded-global',
            backgroundLayout: 'full-overlay',
            backgroundBlurPx: 60,
            backgroundOverlayOpacity: 0,
            backgroundGrayscale: 0,
            backgroundSaturation: 2,
            backgroundWash: 1,
            backgroundHalfPaneOffsetX: 40,
            backgroundWashColorMode: 'custom',
            backgroundWashCustomColor: '#aabbcc',
        });

        expect(resolveStoredMonetBackgroundTuning({
            backgroundCropMode: 'full-artwork',
            coverPaneRatio: 0.9,
            lyricsFocusScale: 4,
            backgroundHalfPaneOffsetX: -99,
            backgroundWashColorMode: 'bad' as never,
            backgroundWashCustomColor: 'nope',
        })).toEqual({
            ...DEFAULT_MONET_BACKGROUND_TUNING,
            backgroundHalfPaneOffsetX: -40,
        });

        expect(resolveStoredMonetBackgroundTuning({})).toEqual(DEFAULT_MONET_BACKGROUND_TUNING);
    });

    it('normalizes persisted Monet lyric and portrait tuning values', () => {
        expect(resolveStoredMonetTuning({
            keywordColoringEnabled: false,
            audioStyle: 'line',
            fontScale: 3,
            portraitSource: 'custom',
        })).toEqual({
            keywordColoringEnabled: false,
            audioStyle: 'line',
            fontScale: 1.5,
            portraitSource: 'custom',
            showDescription: true,
            portraitOffsetX: 0,
            portraitStyle: 'square',
            showPortraitDragHanger: true,
        });

        expect(resolveStoredMonetTuning({
            backgroundCropMode: 'full-artwork',
            coverPaneRatio: 0.9,
            lyricsFocusScale: 4,
            portraitSource: 'bad' as never,
        })).toEqual(DEFAULT_MONET_TUNING);

        expect(resolveStoredMonetTuning({})).toEqual(DEFAULT_MONET_TUNING);
    });

    it('resolves automatic visualizer background mode', () => {
        expect(resolveVisualizerBackgroundMode(null, 'monet')).toBe('monet');
        expect(resolveVisualizerBackgroundMode(null, 'classic')).toBe('common');
        expect(resolveVisualizerBackgroundMode('common', 'monet')).toBe('common');
        expect(resolveVisualizerBackgroundMode('monet', 'classic')).toBe('monet');
    });

    it('builds stable display tokens without dropping spaces or punctuation', () => {
        const line: Line = {
            startTime: 0,
            endTime: 2,
            fullText: 'Hello, world!',
            translation: '你好，世界！',
            words: [
                { text: 'Hello', startTime: 0, endTime: 0.7 },
                { text: 'world', startTime: 0.8, endTime: 1.4 },
            ],
        };

        expect(buildMonetDisplayTokens(line).map(token => token.text).join('')).toBe(line.fullText);
        expect(buildMonetDisplayTokens(line).map(token => [token.text, token.startOffset, token.endOffset])).toEqual([
            ['Hello', 0, 5],
            [', ', 5, 7],
            ['world', 7, 12],
            ['!', 12, 13],
        ]);
    });

    it('keeps TTML syllable timing on Monet timed tokens', () => {
        const line: Line = {
            startTime: 1,
            endTime: 2,
            fullText: 'hurricane',
            words: [{
                text: 'hurricane',
                startTime: 1,
                endTime: 2,
                syllables: [
                    { text: 'hurri', startTime: 1, endTime: 1.4 },
                    { text: 'cane', startTime: 1.4, endTime: 2, endsWithSpace: true },
                ],
            }],
        };

        const [token] = buildMonetDisplayTokens(line);

        expect(token.text).toBe('hurricane');
        expect(token.graphemeTimings.map(timing => timing.char).join('')).toBe('hurricane');
        expect(token.graphemeTimings[5]).toMatchObject({ char: 'c', startTime: 1.4 });
        expect(token.graphemeTimings[8].startTime).toBeCloseTo(1.85);
    });

    it('keeps lyric context aligned around the active line', () => {
        const lines: Line[] = [
            { startTime: 0, endTime: 1, fullText: 'A', words: [] },
            { startTime: 1, endTime: 2, fullText: 'B', translation: 'Bee', words: [] },
            { startTime: 2, endTime: 3, fullText: 'C', words: [] },
        ];

        expect(resolveMonetLyricContext(lines, 1, lines[1], lines[0], lines[2])).toEqual({
            previousLine: lines[0],
            activeLine: lines[1],
            nextLine: lines[2],
        });

        expect(resolveMonetLyricContext(lines, -1, null, lines[0], lines[1])).toEqual({
            previousLine: lines[0],
            activeLine: null,
            nextLine: lines[1],
        });
    });

    it('assigns explicit waiting active passed states for the lyric rail', () => {
        const lines: Line[] = [
            { startTime: 0, endTime: 1, fullText: 'A', words: [] },
            { startTime: 2, endTime: 3, fullText: 'B', words: [] },
            { startTime: 4, endTime: 5, fullText: 'C', words: [] },
        ];

        expect(buildMonetVisibleLineEntries({
            lines,
            currentLineIndex: 1,
            activeLine: lines[1],
            recentCompletedLine: lines[0],
            upcomingLine: lines[2],
            currentTime: 2.5,
            before: 1,
            after: 1,
        }).map(entry => entry.status)).toEqual(['passed', 'active', 'waiting']);

        expect(buildMonetVisibleLineEntries({
            lines,
            currentLineIndex: -1,
            activeLine: null,
            recentCompletedLine: lines[0],
            upcomingLine: lines[1],
            currentTime: 1.5,
            before: 1,
            after: 1,
        }).map(entry => entry.status)).toEqual(['passed', 'waiting', 'waiting']);
    });

    it('gates Monet keyword coloring through tuning', () => {
        const theme: Theme = {
            name: 'Keyword Theme',
            backgroundColor: '#000000',
            primaryColor: '#ffffff',
            accentColor: '#ff99aa',
            secondaryColor: '#dddddd',
            fontStyle: 'sans',
            animationIntensity: 'normal',
            wordColors: [
                { word: 'night glow', color: '#ffee88' },
                { word: '雨', color: '#66ccff' },
            ],
        };

        expect(resolveMonetWordColor('night', theme, '#ffffff', true)).toBe('#ffee88');
        expect(resolveMonetWordColor('雨', theme, '#ffffff', true)).toBe('#66ccff');
        expect(resolveMonetWordColor('night', theme, '#ffffff', false)).toBe('#ffffff');
    });

    it('ignores malformed persisted keyword color entries', () => {
        const theme: Theme = {
            name: 'Keyword Theme',
            backgroundColor: '#000000',
            primaryColor: '#ffffff',
            accentColor: '#ff99aa',
            secondaryColor: '#dddddd',
            fontStyle: 'sans',
            animationIntensity: 'normal',
            wordColors: [
                undefined,
                { color: '#ff0000' },
                { word: undefined, color: '#00ff00' },
                { word: 'night', color: '#ffee88' },
            ] as unknown as Theme['wordColors'],
        };

        expect(prepareWordColorMatchers(theme.wordColors)).toEqual([
            { color: '#ffee88', cjkPhrases: [], englishWords: ['night'], priority: 5 },
        ]);
        expect(resolveMonetWordColor('night', theme, '#ffffff', true)).toBe('#ffee88');
        expect(resolveMonetWordColor('day', theme, '#ffffff', true)).toBe('#ffffff');
    });

    it('keeps visualizer canvas colors valid when a persisted theme has invalid hex colors', () => {
        expect(parseColorChannels('#e9b11')).toBeNull();
        expect(colorWithAlpha('#e9b11', 0.42)).toBe('rgba(255, 255, 255, 0.42)');
        expect(colorWithAlpha(undefined as unknown as string, 0.35)).toBe('rgba(255, 255, 255, 0.35)');
        expect(colorWithAlpha('rgb(nope, 20, 30)', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
        expect(mixColors('#e9b11', '#000000', 0.2, 0.7)).toBe('rgba(255, 255, 255, 0.7)');
    });

    it('maps CJK phrase coloring by full-line ranges instead of coloring every matching particle token', () => {
        const line: Line = {
            startTime: 0,
            endTime: 8,
            fullText: 'の 時の欠片 の',
            words: [
                { text: 'の', startTime: 0, endTime: 1 },
                { text: '時', startTime: 1, endTime: 2 },
                { text: 'の', startTime: 2, endTime: 3 },
                { text: '欠', startTime: 3, endTime: 4 },
                { text: '片', startTime: 4, endTime: 5 },
                { text: 'の', startTime: 5, endTime: 6 },
            ],
        };
        const tokens = buildMonetDisplayTokens(line);
        const ranges = buildWordColorRanges(line.fullText, [{ word: '時の欠片', color: '#66ccff' }]);
        const colorMap = resolveTokenColorMap(tokens, ranges);

        expect(ranges).toEqual([{ startOffset: 2, endOffset: 6, color: '#66ccff', priority: 4 }]);
        expect(tokens.map(token => [token.text, colorMap.get(token.key) ?? null])).toEqual([
            ['の', null],
            [' ', null],
            ['時', '#66ccff'],
            ['の', '#66ccff'],
            ['欠', '#66ccff'],
            ['片', '#66ccff'],
            [' ', null],
            ['の', null],
        ]);
    });

    it('colors repeated CJK phrase ranges without falling back to single-character includes', () => {
        const line: Line = {
            startTime: 0,
            endTime: 10,
            fullText: '時の欠片と時の欠片',
            words: [
                { text: '時', startTime: 0, endTime: 1 },
                { text: 'の', startTime: 1, endTime: 2 },
                { text: '欠', startTime: 2, endTime: 3 },
                { text: '片', startTime: 3, endTime: 4 },
                { text: 'と', startTime: 4, endTime: 5 },
                { text: '時', startTime: 5, endTime: 6 },
                { text: 'の', startTime: 6, endTime: 7 },
                { text: '欠', startTime: 7, endTime: 8 },
                { text: '片', startTime: 8, endTime: 9 },
            ],
        };
        const tokens = buildMonetDisplayTokens(line);
        const ranges = buildWordColorRanges(line.fullText, [{ word: '時の欠片', color: '#66ccff' }]);
        const colorMap = resolveTokenColorMap(tokens, ranges);

        expect(ranges.map(range => [range.startOffset, range.endOffset])).toEqual([[0, 4], [5, 9]]);
        expect(tokens.map(token => [token.text, colorMap.get(token.key) ?? null])).toEqual([
            ['時', '#66ccff'],
            ['の', '#66ccff'],
            ['欠', '#66ccff'],
            ['片', '#66ccff'],
            ['と', null],
            ['時', '#66ccff'],
            ['の', '#66ccff'],
            ['欠', '#66ccff'],
            ['片', '#66ccff'],
        ]);
    });

    it('keeps English keyword coloring as normalized word range matches', () => {
        const line: Line = {
            startTime: 0,
            endTime: 4,
            fullText: 'Night, glow! daylight',
            words: [
                { text: 'Night', startTime: 0, endTime: 1 },
                { text: 'glow', startTime: 1, endTime: 2 },
                { text: 'daylight', startTime: 2, endTime: 3 },
            ],
        };
        const tokens = buildMonetDisplayTokens(line);
        const ranges = buildWordColorRanges(line.fullText, [{ word: 'night glow', color: '#ffee88' }]);
        const colorMap = resolveTokenColorMap(tokens, ranges);

        expect(tokens.map(token => [token.text, colorMap.get(token.key) ?? null])).toEqual([
            ['Night', '#ffee88'],
            [', ', null],
            ['glow', '#ffee88'],
            ['! ', null],
            ['daylight', null],
        ]);
    });

    it('prepares keyword matchers once while letting English ranges scan the line once', () => {
        const line: Line = {
            startTime: 0,
            endTime: 4,
            fullText: 'Night, rain and glow',
            words: [
                { text: 'Night', startTime: 0, endTime: 1 },
                { text: 'rain', startTime: 1, endTime: 2 },
                { text: 'glow', startTime: 2, endTime: 3 },
            ],
        };
        const tokens = buildMonetDisplayTokens(line);
        const matchers = prepareWordColorMatchers([
            { word: 'night glow', color: '#ffee88' },
            { word: 'rain', color: '#66ccff' },
        ]);
        const ranges = buildWordColorRanges(line.fullText, [
            { word: 'night glow', color: '#ffee88' },
            { word: 'rain', color: '#66ccff' },
        ]);
        const colorMap = resolveTokenColorMap(tokens, ranges);

        expect(matchers).toEqual([
            { color: '#ffee88', cjkPhrases: [], englishWords: ['night', 'glow'], priority: 5 },
            { color: '#66ccff', cjkPhrases: [], englishWords: ['rain'], priority: 4 },
        ]);
        expect(colorMap.get(tokens[0].key)).toBe('#ffee88');
        expect(colorMap.get(tokens[2].key)).toBe('#66ccff');
        expect(colorMap.get(tokens[4].key)).toBe('#ffee88');
    });

    it('changes the background cache key only when source or background treatment changes', () => {
        const theme = {
            name: 'Test Theme',
            backgroundColor: '#000000',
            primaryColor: '#ffffff',
            accentColor: '#ff99aa',
            secondaryColor: '#dddddd',
            fontStyle: 'sans' as const,
            animationIntensity: 'normal' as const,
        };

        const first = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: DEFAULT_MONET_BACKGROUND_TUNING,
        });
        const second = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundBlurPx: DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx + 1 },
        });
        const third = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            monetBackgroundImage: { id: 'uploaded-1', name: 'bg', url: 'blob:test' },
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundSource: 'uploaded-global' },
        });
        const overlayChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundOverlayOpacity: DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity + 0.02 },
        });
        const grayscaleChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundGrayscale: 0.2 },
        });
        const saturationChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundSaturation: 1.4 },
        });
        const washChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundWash: 0.6 },
        });
        const washColorChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundWashColorMode: 'custom', backgroundWashCustomColor: '#aabbcc' },
        });
        const nonBackgroundChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: {
                ...DEFAULT_MONET_BACKGROUND_TUNING,
                backgroundLayout: 'full-overlay',
                backgroundHalfPaneOffsetX: 20,
            },
        });

        expect(first).not.toBe(second);
        expect(second).not.toBe(third);
        expect(first).not.toBe(overlayChanged);
        expect(first).not.toBe(grayscaleChanged);
        expect(first).not.toBe(saturationChanged);
        expect(first).not.toBe(washChanged);
        expect(first).not.toBe(washColorChanged);
        expect(first).toBe(nonBackgroundChanged);

        const layoutBase = getMonetBackgroundCacheKey({
            coverUrl: 'cover-b',
            theme,
            tuning: DEFAULT_MONET_BACKGROUND_TUNING,
        });
        const layoutChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-b',
            theme,
            tuning: {
                ...DEFAULT_MONET_BACKGROUND_TUNING,
                backgroundLayout: 'full-overlay',
                backgroundHalfPaneOffsetX: 24,
                backgroundCropMode: 'full-artwork',
            } as typeof DEFAULT_MONET_BACKGROUND_TUNING & { backgroundCropMode: string; },
        });
        expect(layoutBase).toBe(layoutChanged);
    });

    it('handles canvas filter feature detection without throwing', () => {
        // Feature detection returns boolean and doesn't crash
        const supported = checkCanvasFilterSupport();
        expect(typeof supported).toBe('boolean');
    });
});
