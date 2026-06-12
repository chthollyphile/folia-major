import { describe, expect, it } from 'vitest';
import { DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, type Line, type Theme } from '@/types';
import { getMonetBackgroundCacheKey, resolveWashColor } from '@/components/visualizer/monet/monetBackgroundPipeline';
import { resolveMonetWordColor } from '@/components/visualizer/monet/MonetLyricsRail';
import { buildMonetDisplayTokens, resolveMonetLyricContext } from '@/components/visualizer/monet/VisualizerMonet';
import { buildMonetVisibleLineEntries } from '@/components/visualizer/monet/monetLyricsModel';
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
            portraitStyle: 'rectangular',
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
});
