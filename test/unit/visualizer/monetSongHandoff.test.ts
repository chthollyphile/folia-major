import { describe, expect, it } from 'vitest';
import { motionValue } from 'framer-motion';
import type { Line, Theme } from '@/types';
import type { VisualizerSongHandoff } from '@/components/visualizer/definition';
import {
    MONET_HANDOFF_TEXT_SWITCH,
    monetTextShowsIncoming,
    resolveMonetSongText,
    type MonetSongText,
} from '@/components/visualizer/monet/monetSongHandoff';

// test/unit/visualizer/monetSongHandoff.test.ts
// Which song Monet's words show through a blend: the one on screen until the audio crossover, the
// incoming one after, with its own lyrics, clock, line and theme.

const line = (text: string, startTime: number): Line => ({ words: [], startTime, endTime: startTime + 2, fullText: text });
const themeA = { name: 'A', primaryColor: '#aaaaaa' } as Theme;
const themeB = { name: 'B', primaryColor: '#bbbbbb' } as Theme;

const outgoing: MonetSongText = {
    seed: 'song-a',
    songTitle: 'A',
    songArtist: 'Artist A',
    songAlbum: 'Album A',
    lines: [line('a1', 0), line('a2', 180)],
    currentTime: motionValue(190),
    currentLineIndex: 1,
    theme: themeA,
};

const handoff: VisualizerSongHandoff = {
    progress: motionValue(0),
    seed: 'song-b',
    songTitle: 'B',
    songArtist: 'Artist B',
    songAlbum: 'Album B',
    coverUrl: 'cover-b',
    theme: themeB,
    lines: [line('b1', 3), line('b2', 9)],
    currentTime: motionValue(9.5),
    currentLineIndex: 1,
};

describe('which song Monet\'s words show through a blend', () => {
    it('changes at the audio crossover, the hand-off\'s halfway mark', () => {
        expect(MONET_HANDOFF_TEXT_SWITCH).toBe(0.5);
        expect(monetTextShowsIncoming(0)).toBe(false);
        expect(monetTextShowsIncoming(0.499)).toBe(false);
        expect(monetTextShowsIncoming(0.5)).toBe(true);
        expect(monetTextShowsIncoming(1)).toBe(true);
    });

    it('shows the song on screen, on its own clock and line, before the crossover', () => {
        expect(resolveMonetSongText(outgoing, handoff, false)).toBe(outgoing);
    });

    it('shows the incoming song after it, with its own lyrics, clock, line and theme', () => {
        const shown = resolveMonetSongText(outgoing, handoff, true);
        expect(shown).toMatchObject({ seed: 'song-b', songTitle: 'B', songArtist: 'Artist B', songAlbum: 'Album B' });
        expect(shown.lines).toBe(handoff.lines);
        expect(shown.currentTime).toBe(handoff.currentTime);
        expect(shown.currentLineIndex).toBe(1);
        expect(shown.theme).toBe(themeB);
    });

    it('shows the props without a blend, and after a cancel', () => {
        expect(resolveMonetSongText(outgoing, null, true)).toBe(outgoing);
        expect(resolveMonetSongText(outgoing, undefined, false)).toBe(outgoing);
    });
});
