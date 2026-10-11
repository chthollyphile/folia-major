import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { motionValue } from 'framer-motion';
import VisualizerSubtitleOverlay, { getUpcomingLyricsClassName, resolveVisualizerSubtitleOverlayContent } from '@/components/visualizer/VisualizerSubtitleOverlay';
import { DEFAULT_THEME } from '@/services/baseThemes';
import type { Line } from '@/types';

// test/unit/visualizer/subtitleOverlay.test.ts
// Locks the split between hiding the whole subtitle overlay and hiding only translation text.

describe('VisualizerSubtitleOverlay content resolution', () => {
    it('keeps upcoming lyric blur enabled by default and allows disabling it', () => {
        expect(getUpcomingLyricsClassName()).toContain('blur-[1px]');
        expect(getUpcomingLyricsClassName(false)).not.toContain('blur-[1px]');
    });

    const activeLine: Line = {
        startTime: 1,
        endTime: 2,
        fullText: 'Hello',
        translation: '你好',
        romanization: 'Harō',
        words: [],
    };
    const nextLine: Line = {
        startTime: 2,
        endTime: 3,
        fullText: 'World',
        words: [],
    };

    it('hides the entire overlay when the legacy hide setting is enabled', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine,
            recentCompletedLine: null,
            nextLines: [nextLine],
            hideTranslationSubtitle: true,
            showSubtitleTranslation: true,
        });

        expect(content.shouldRenderOverlay).toBe(false);
        expect(content.subtitleText).toBeNull();
        expect(content.upcomingLines).toEqual([]);
    });

    it('keeps upcoming-line hints when only translation text is hidden', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine,
            recentCompletedLine: null,
            nextLines: [nextLine],
            hideTranslationSubtitle: false,
            showSubtitleTranslation: false,
        });

        expect(content.shouldRenderOverlay).toBe(true);
        expect(content.subtitleText).toBeNull();
        expect(content.upcomingLines).toEqual([nextLine]);
    });

    it('selects romanization without falling back to translation', () => {
        const romanized = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine,
            recentCompletedLine: null,
            nextLines: [nextLine],
            hideTranslationSubtitle: false,
            showSubtitleTranslation: true,
            subtitleContentMode: 'romanization',
        });
        const missingRomanization = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: { ...activeLine, romanization: undefined },
            recentCompletedLine: null,
            nextLines: [nextLine],
            hideTranslationSubtitle: false,
            showSubtitleTranslation: true,
            subtitleContentMode: 'romanization',
        });

        expect(romanized.subtitleText).toBe('Harō');
        expect(romanized.upcomingLines).toEqual([]);
        expect(missingRomanization.subtitleText).toBeNull();
        expect(missingRomanization.upcomingLines).toEqual([nextLine]);
    });

    it('resolves romanization from alternate texts when the direct field is absent', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: {
                ...activeLine,
                romanization: undefined,
                alternateTexts: [{ role: 'romanization', text: 'Hello' }],
            },
            recentCompletedLine: null,
            nextLines: [],
            hideTranslationSubtitle: false,
            showSubtitleTranslation: true,
            subtitleContentMode: 'romanization',
        });

        expect(content.subtitleText).toBe('Hello');
    });

    it('stacks romanization above translation in both mode', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine,
            recentCompletedLine: null,
            nextLines: [nextLine],
            subtitleContentMode: 'both',
        });

        expect(content.shouldRenderOverlay).toBe(true);
        expect(content.subtitleTracks).toEqual([
            { role: 'romanization', text: 'Harō' },
            { role: 'translation', text: '你好' },
        ]);
        expect(content.upcomingLines).toEqual([]);
    });

    it('shows a single row without an empty placeholder when only one track exists in both mode', () => {
        const onlyRomanization = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: { ...activeLine, translation: undefined },
            recentCompletedLine: null,
            nextLines: [],
            subtitleContentMode: 'both',
        });
        const onlyTranslation = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: { ...activeLine, romanization: undefined },
            recentCompletedLine: null,
            nextLines: [],
            subtitleContentMode: 'both',
        });

        expect(onlyRomanization.subtitleTracks).toEqual([{ role: 'romanization', text: 'Harō' }]);
        expect(onlyTranslation.subtitleTracks).toEqual([{ role: 'translation', text: '你好' }]);
    });

    it('behaves like today when a both-mode line has neither track', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: { ...activeLine, translation: undefined, romanization: undefined },
            recentCompletedLine: null,
            nextLines: [nextLine],
            subtitleContentMode: 'both',
        });

        expect(content.subtitleTracks).toEqual([]);
        expect(content.subtitleText).toBeNull();
        expect(content.upcomingLines).toEqual([nextLine]);
    });

    it('falls through to the recently completed line when the active line has no readable track', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: { ...activeLine, translation: '//', romanization: undefined },
            recentCompletedLine: activeLine,
            nextLines: [],
            subtitleContentMode: 'both',
        });

        expect(content.subtitleTracks.map(track => track.role)).toEqual(['romanization', 'translation']);
    });

    it('still hides everything when the bottom subtitle is hidden in both mode', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine,
            recentCompletedLine: null,
            nextLines: [],
            hideTranslationSubtitle: true,
            subtitleContentMode: 'both',
        });

        expect(content.shouldRenderOverlay).toBe(false);
        expect(content.subtitleTracks).toEqual([]);
    });

    it('unmounts an empty interlude overlay so AnimatePresence can fade out its previous content', () => {
        const content = resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine: null,
            recentCompletedLine: null,
            nextLines: [nextLine],
        });

        expect(content.shouldRenderOverlay).toBe(false);
        expect(content.upcomingLines).toEqual([]);
    });

    it('holds completed subtitles for 1.5 playback seconds and restores them when seeking back', () => {
        const currentTime = motionValue(2.1);
        const render = () => renderToStaticMarkup(createElement(VisualizerSubtitleOverlay, {
            currentTime,
            showText: true,
            activeLine: null,
            recentCompletedLine: activeLine,
            nextLines: [],
            theme: DEFAULT_THEME,
            translationFontSize: '1rem',
            upcomingFontSize: '0.9rem',
            subtitleContentMode: 'both',
        }));

        expect(render()).toContain('data-subtitle-track="translation"');
        currentTime.set(3.49);
        expect(render()).toContain('data-subtitle-track="romanization"');
        currentTime.set(3.5);
        expect(render()).not.toContain('data-subtitle-track');
        currentTime.set(30);
        expect(render()).not.toContain('data-subtitle-track');
        currentTime.set(2.1);
        expect(render()).toContain('data-subtitle-track="translation"');
        currentTime.set(0);
        expect(render()).not.toContain('data-subtitle-track');
    });
});
