import type { LyricData, SongResult, PlayerState, ThemeMode, DualTheme } from '../../../types';
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
    nowPlayingDebug,
    themeMode,
    activeDualTheme,
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
    nowPlayingDebug: {
        connectionStatus: string;
        isActive: boolean;
        paused: boolean;
        progressMs: number;
        progressQuality: 'precise' | 'coarse';
        trackTitle: string | null;
        durationSec: number;
        lastQuerySource: 'idle' | 'progress' | 'pause-boundary' | 'resume-boundary' | 'poll';
        lastQueryStatus: 'idle' | 'pending' | 'applied' | 'skipped' | 'failed';
        lastResponseProgressMs: number | null;
        lastResponseRttMs: number | null;
        lastCandidateTimeSec: number | null;
        lastDisplayTimeSec: number | null;
        lastDriftSec: number | null;
        lastError: string | null;
    } | null;
    themeMode: ThemeMode;
    activeDualTheme: DualTheme;
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

    const toRawLineSnapshot = (line: LyricData['lines'][number] | null) => {
        if (!line) {
            return null;
        }

        return {
            id: line.id ?? null,
            startTime: line.startTime,
            endTime: line.endTime,
            fullText: line.fullText,
            translation: line.translation ?? null,
            romanization: line.romanization ?? null,
            alternateTexts: line.alternateTexts ?? null,
            agentId: line.agentId ?? null,
            songPart: line.songPart ?? null,
            blockIndex: line.blockIndex ?? null,
            backgroundVocal: line.backgroundVocal ?? null,
            isChorus: line.isChorus ?? false,
            chorusEffect: line.chorusEffect ?? null,
            renderHints: line.renderHints ?? null,
            words: line.words.map(word => ({
                text: word.text,
                startTime: word.startTime,
                endTime: word.endTime,
                ...(word.syllables ? { syllables: word.syllables } : {}),
            })),
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
        duration: currentSong?.durationMs ? currentSong.durationMs / 1000 : null,
        currentLineIndex,
        totalLines: lyrics?.lines.length ?? 0,
        totalWords: lyrics?.lines.reduce((sum, line) => sum + line.words.length, 0) ?? 0,
        maxWordsPerLine: lyrics?.lines.reduce((max, line) => Math.max(max, line.words.length), 0) ?? 0,
        lyricTtml: lyrics?.ttml ?? null,
        nowPlaying: nowPlayingDebug,
        activeLine: toLineSnapshot(debugActiveLine),
        nextLine: toLineSnapshot(debugNextLine),
        rawActiveLine: toRawLineSnapshot(debugActiveLine),
        rawNextLine: toRawLineSnapshot(debugNextLine),
        themeMode,
        activeDualTheme,
    };
};
