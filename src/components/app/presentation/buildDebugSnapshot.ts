import type { LyricData, SongResult, PlayerState } from '../../../types';
import { getAudioSrcKind, resolveDebugLyricsSource, resolveDebugSongSource } from '../../../utils/appPlaybackHelpers';
import { getLineRenderHints } from '../../../utils/lyrics/renderHints';

// src/components/app/presentation/buildDebugSnapshot.ts

// Builds the developer overlay snapshot from current playback and lyric state.
export const buildDebugSnapshot = ({
    shortcutLabel,
    currentSong,
    currentView,
    playerState,
    visualizerMode,
    lyrics,
    currentLineIndex,
    currentTimeValue,
    audioSrc,
    coverUrl,
}: {
    shortcutLabel: string;
    currentSong: SongResult | null;
    currentView: string;
    playerState: PlayerState;
    visualizerMode: string;
    lyrics: LyricData | null;
    currentLineIndex: number;
    currentTimeValue: number;
    audioSrc: string | null;
    coverUrl: string | null;
}) => {
    const debugActiveLine = lyrics && currentLineIndex >= 0 ? lyrics.lines[currentLineIndex] ?? null : null;
    const debugNextLine = (() => {
        if (!lyrics?.lines.length) {
            return null;
        }

        if (debugActiveLine) {
            return lyrics.lines[currentLineIndex + 1] ?? null;
        }

        return lyrics.lines.find(line => line.startTime > currentTimeValue) ?? null;
    })();

    const toLineSnapshot = (line: LyricData['lines'][number] | null) => {
        if (!line) {
            return null;
        }

        const renderHints = getLineRenderHints(line);
        return {
            text: line.fullText || null,
            translation: line.translation ?? null,
            wordCount: line.words.length,
            startTime: line.startTime,
            endTime: line.endTime,
            renderEndTime: renderHints?.renderEndTime ?? null,
            rawDuration: renderHints?.rawDuration ?? Math.max(line.endTime - line.startTime, 0),
            timingClass: renderHints?.timingClass ?? null,
            lineTransitionMode: renderHints?.lineTransitionMode ?? null,
            wordRevealMode: renderHints?.wordRevealMode ?? null,
        };
    };

    return {
        shortcutLabel,
        songKey: currentSong ? `${resolveDebugSongSource(currentSong)}:${currentSong.id}` : null,
        currentView,
        playerState,
        visualizerMode,
        songName: currentSong?.name ?? null,
        songSource: resolveDebugSongSource(currentSong),
        lyricsSource: resolveDebugLyricsSource(currentSong, lyrics),
        audioSrcKind: getAudioSrcKind(audioSrc),
        coverUrlKind: getAudioSrcKind(coverUrl),
        duration: currentSong?.duration ? currentSong.duration / 1000 : null,
        currentLineIndex,
        totalLines: lyrics?.lines.length ?? 0,
        totalWords: lyrics?.lines.reduce((sum, line) => sum + line.words.length, 0) ?? 0,
        maxWordsPerLine: lyrics?.lines.reduce((max, line) => Math.max(max, line.words.length), 0) ?? 0,
        activeLine: toLineSnapshot(debugActiveLine),
        nextLine: toLineSnapshot(debugNextLine),
    };
};
