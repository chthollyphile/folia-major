import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { handoffLyricCurrentTime, handoffProgress } from '../../stores/motionSignals';
import { selectCoverUrl, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getSongAlbumLabel, getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { NO_LYRIC_LINES } from '../../utils/lyrics/noLyricLines';
import type { VisualizerSongHandoff } from './definition';

// src/components/visualizer/useVisualizerSongHandoff.ts
// The main window's feed of a blend's song hand-off to the visualizer: while a blend holds the
// picture on the outgoing track, the live state is already the incoming one (the queue advanced at
// the arm), so the incoming song, cover and lyrics are read from it. Its clock and line come from
// the visualizer bridge, which reads the incoming deck on the frame it reads the outgoing one.

/**
 * The blend's incoming song for the visualizer, or null when no blend runs or the style draws none.
 * `themes` are the live ones: the incoming song's once its theme has come.
 */
export const useVisualizerSongHandoff = (
    enabled: boolean,
    themes: Pick<VisualizerSongHandoff, 'theme' | 'subtitleTheme'>,
): VisualizerSongHandoff | null => {
    const incoming = usePlaybackStore(useShallow(state => {
        const held = state.transitionDisplay;
        const song = state.currentSong;
        // A blend into the same song (repeat one) hands nothing over: the picture already shows it.
        if (!enabled || !held || !song || song.id === held.song?.id) return null;
        return {
            song,
            lyrics: state.lyrics,
            coverUrl: selectCoverUrl(state),
            lineIndex: state.handoffLineIndex,
        };
    }));

    return useMemo(() => {
        if (!incoming) return null;
        const { song, lyrics, coverUrl, lineIndex } = incoming;
        return {
            progress: handoffProgress,
            seed: song.id,
            songTitle: song.name,
            songArtist: getSongArtistLabel(song) || null,
            songAlbum: getSongAlbumLabel(song) || null,
            coverUrl,
            theme: themes.theme,
            subtitleTheme: themes.subtitleTheme,
            lines: lyrics?.lines || NO_LYRIC_LINES,
            currentTime: handoffLyricCurrentTime,
            currentLineIndex: lineIndex,
        };
    }, [incoming, themes]);
};
