import type { VisualizerSharedProps, VisualizerSongHandoff } from '../definition';

// src/components/visualizer/monet/monetSongHandoff.ts
// Which song Monet's words show through a blend's song hand-off. The cover and the background are the
// incoming song's from the blend's start and fade in along the hand-off (VisualizerMonet,
// VisualizerRenderer); the words change at the audio crossover, with the intro of any song change, and
// from then on the lyric rail reads the incoming song's own lyrics, clock and line. The theme Monet draws
// itself with (the words, the decor) changes with them.

/** Where on the hand-off (0..1) the words change song: its halfway mark, the audio crossover (handoffProgress.ts). */
export const MONET_HANDOFF_TEXT_SWITCH = 0.5;

/** What the words are drawn from: the song's names, its lyrics, the clock and line they are read at, and its theme. */
export type MonetSongText = Pick<
    VisualizerSharedProps,
    'seed' | 'songTitle' | 'songArtist' | 'songAlbum' | 'lines' | 'currentTime' | 'currentLineIndex' | 'theme' | 'subtitleTheme'
>;

/** Whether the words show the incoming song at this point of the hand-off. */
export const monetTextShowsIncoming = (progress: number): boolean => progress >= MONET_HANDOFF_TEXT_SWITCH;

/** The song the words show: the props' until the hand-off has passed the crossover, the incoming one's after. */
export const resolveMonetSongText = (
    shown: MonetSongText,
    handoff: VisualizerSongHandoff | null | undefined,
    crossed: boolean,
): MonetSongText => (
    handoff && crossed
        ? {
            seed: handoff.seed,
            songTitle: handoff.songTitle,
            songArtist: handoff.songArtist,
            songAlbum: handoff.songAlbum,
            lines: handoff.lines,
            currentTime: handoff.currentTime,
            currentLineIndex: handoff.currentLineIndex,
            theme: handoff.theme,
            subtitleTheme: handoff.subtitleTheme,
        }
        : shown
);
