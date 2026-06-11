import { describe, expect, it } from 'vitest';
import { DEFAULT_MONET_TUNING, type Line, type MonetBackgroundLayout } from '@/types';
import { getMonetBackgroundCacheKey } from '@/components/visualizer/monet/monetBackgroundPipeline';
import { buildMonetDisplayTokens, resolveMonetLyricContext } from '@/components/visualizer/monet/VisualizerMonet';
import { buildMonetVisibleLineEntries } from '@/components/visualizer/monet/monetLyricsModel';
import { resolveStoredMonetTuning } from '@/stores/useSettingsUiStore';

// test/unit/visualizer/monetSettings.test.ts
// Locks the Monet tuning normalization and the aligned lyric-pair contract.
describe('Monet tuning and lyric helpers', () => {
    it('normalizes persisted Monet tuning values', () => {
        expect(resolveStoredMonetTuning({
            backgroundSource: 'uploaded-global',
            backgroundBlurPx: 999,
            backgroundOverlayOpacity: -2,
            backgroundCropMode: 'full-artwork',
            backgroundLayout: 'full-overlay',
            audioStyle: 'line',
            coverPaneRatio: 0.9,
            lyricsFocusScale: 4,
            fontScale: 3,
        })).toEqual({
            backgroundSource: 'uploaded-global',
            backgroundBlurPx: 120,
            backgroundOverlayOpacity: 0,
            backgroundCropMode: 'full-artwork',
            backgroundLayout: 'full-overlay',
            audioStyle: 'line',
            coverPaneRatio: 0.68,
            lyricsFocusScale: 1.3,
            fontScale: 1.5,
        });

        expect(resolveStoredMonetTuning({ backgroundLayout: 'bogus' as MonetBackgroundLayout }))
            .toEqual(expect.objectContaining({ backgroundLayout: DEFAULT_MONET_TUNING.backgroundLayout }));

        expect(resolveStoredMonetTuning({})).toEqual(DEFAULT_MONET_TUNING);
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

    it('changes the background cache key when source or tuning changes', () => {
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
            tuning: DEFAULT_MONET_TUNING,
        });
        const second = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            theme,
            tuning: { ...DEFAULT_MONET_TUNING, backgroundBlurPx: DEFAULT_MONET_TUNING.backgroundBlurPx + 1 },
        });
        const third = getMonetBackgroundCacheKey({
            coverUrl: 'cover-a',
            monetBackgroundImage: { id: 'uploaded-1', name: 'bg', url: 'blob:test' },
            theme,
            tuning: { ...DEFAULT_MONET_TUNING, backgroundSource: 'uploaded-global' },
        });

        expect(first).not.toBe(second);
        expect(second).not.toBe(third);

        const layoutBase = getMonetBackgroundCacheKey({
            coverUrl: 'cover-b',
            theme,
            tuning: DEFAULT_MONET_TUNING,
        });
        const layoutChanged = getMonetBackgroundCacheKey({
            coverUrl: 'cover-b',
            theme,
            tuning: { ...DEFAULT_MONET_TUNING, backgroundLayout: 'full-overlay' },
        });
        expect(layoutBase).not.toBe(layoutChanged);
    });
});
