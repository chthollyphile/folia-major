import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { motionValue } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import VisualizerMonet from '@/components/visualizer/monet/VisualizerMonet';
import { DEFAULT_MONET_TUNING, type AudioBands, type Line, type MonetTuning, type Theme } from '@/types';

// Keep Monet's real placement branch while replacing the child renderers with identifiable output.

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/visualizer/VisualizerShell', () => ({
    default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/visualizer/monet/AudioOverlay', () => ({
    default: ({ centered, gain, paused }: { centered: boolean; gain: number; paused: boolean }) =>
        createElement('canvas', { 'data-centered': centered, 'data-gain': gain, 'data-paused': paused }),
}));
vi.mock('@/components/visualizer/monet/MonetLyricsRail', () => ({
    default: () => createElement('section', { 'data-lyrics-rail': true }),
}));
vi.mock('@/components/visualizer/monet/MonetFloatingDecor', () => ({ default: () => null }));
vi.mock('@/components/visualizer/monet/MonetPortraitImage', () => ({ default: () => null }));

const line: Line = { fullText: 'A lyric', startTime: 0, endTime: 5, words: [] };
const render = (lines: Line[], tuning: Partial<MonetTuning>) => renderToStaticMarkup(createElement(VisualizerMonet, {
    lines, currentLineIndex: lines.length ? 0 : -1, currentTime: motionValue(1),
    audioPower: motionValue(128), audioBands: {} as AudioBands, paused: true,
    theme: { primaryColor: '#ffffff', secondaryColor: '#aaaaaa', backgroundColor: '#111111', fontStyle: 'sans' } as Theme,
    monetTuning: { ...DEFAULT_MONET_TUNING, audioGain: 1.5, ...tuning },
}));

describe('Monet audio placement', () => {
    it.each([{ lines: [] }, { lines: [line] }])('preserves explicit placement regardless of whether lyrics are available: %j', ({ lines }) => {
        const lyricsPlacement = render(lines, { audioPlacement: 'lyrics' });
        expect(lyricsPlacement).toContain('data-audio-placement="lyrics"');
        expect(lyricsPlacement).toContain('data-centered="true"');
        expect(lyricsPlacement).toContain('data-gain="1.5"');
        expect(lyricsPlacement).toContain('data-paused="true"');
        expect(lyricsPlacement).not.toContain('data-lyrics-rail');
        expect(lyricsPlacement).not.toContain('data-audio-placement="bottom"');

        const bottomPlacement = render(lines, { audioPlacement: 'bottom' });
        expect(bottomPlacement).toContain('data-audio-placement="bottom"');
        expect(bottomPlacement).toContain('data-centered="false"');
        expect(bottomPlacement).toContain('data-lyrics-rail');
    });

    it('restores the lyric rail when audio is disabled without discarding the selected placement', () => {
        const tuning = { audioPlacement: 'lyrics' as const, showAudioVisualization: false };
        const markup = render([line], tuning);
        expect(markup).toContain('data-lyrics-rail');
        expect(markup).not.toContain('data-audio-placement');
        expect(markup).not.toContain('<canvas');
        expect(render([line], { ...tuning, showAudioVisualization: true })).toContain('data-audio-placement="lyrics"');
    });
});
