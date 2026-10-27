import { CONTROL_API_VERSION, CONTROL_GROUPS, CONTROL_TOOLS } from '../../shared/controlCatalog.mjs';
import { omni } from '../services/onlineMusic/omni';
import { useAppViewStore } from '../stores/useAppViewStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { useSettingsModalStore } from '../stores/useSettingsModalStore';
import { selectDisplayLyrics, selectDisplayPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { currentTime } from '../stores/motionSignals';
import { isOnlinePlaybackSong } from '../utils/appPlaybackGuards';
import { queueIndexOf } from '../utils/playbackNeighbors';
import {
    activeProviderId,
    isCommandPaletteOpen,
    playbackStateName,
    providerSummaries,
    readWindowStatus,
    summarizeSong,
} from './helpers';
import { ControlError } from './errors';
import type {
    ControlAppInfo,
    ControlSongSummary,
    ControlStateQuery,
    ControlStateSnapshot,
    ControlToolMeta,
} from './types';

// src/control/state.ts
// Read-only snapshots: the full folia_state document, the compact folia_status summary, and the
// tool list. Everything here reads stores through getState(), never through React.

type CatalogTool = Omit<ControlToolMeta, 'available'>;

const CATALOG_TOOLS = CONTROL_TOOLS as unknown as readonly CatalogTool[];

export const CONTROL_CATALOG_VERSION = CONTROL_API_VERSION as 1;

/** Catalog order, annotated with whether this renderer can execute the tool. */
export const buildToolsList = (group?: string): ControlToolMeta[] => {
    if (group !== undefined && !CONTROL_GROUPS.includes(group)) {
        throw new ControlError('bad_request', `Unknown tool group "${group}"`, { groups: CONTROL_GROUPS });
    }
    return CATALOG_TOOLS
        .filter(tool => group === undefined || tool.group === group)
        .map(tool => ({ ...tool, available: tool.executor === 'bridge' }));
};

export const buildLyricsSnapshot = (
    includeLines: boolean,
    limit = 200,
): ControlStateSnapshot['lyrics'] => {
    const state = usePlaybackStore.getState();
    const lyrics = selectDisplayLyrics(state);
    const lines = lyrics?.lines ?? [];
    const currentLineIndex = state.currentLineIndex;
    const currentLine = currentLineIndex >= 0 && currentLineIndex < lines.length
        ? {
            index: currentLineIndex,
            startTime: lines[currentLineIndex]!.startTime,
            endTime: lines[currentLineIndex]!.endTime,
            text: lines[currentLineIndex]!.fullText,
        }
        : null;
    const format = !lyrics || lines.length === 0
        ? null
        : lyrics.ttml
            ? 'ttml'
            : lyrics.isWordByWord
                ? 'enhanced-lrc'
                : 'lrc';
    return {
        available: lines.length > 0,
        format,
        lineCount: lines.length,
        currentLineIndex,
        offsetMs: state.lyricTimelineOffsetMs,
        globalOffsetMs: useLyricSettingsStore.getState().globalLyricTimelineOffsetMs,
        currentLine,
        ...(includeLines
            ? {
                lines: lines.slice(0, Math.max(1, Math.trunc(limit))).map((line, index) => ({
                    index,
                    startTime: line.startTime,
                    endTime: line.endTime,
                    text: line.fullText,
                })),
            }
            : {}),
    };
};

const currentSongLiked = (): boolean | null => {
    const song = usePlaybackStore.getState().currentSong;
    if (!song || !isOnlinePlaybackSong(song)) {
        return null;
    }
    try {
        return omni.isSongLiked(song);
    } catch (error) {
        console.warn('[Control] Could not read the like state:', error);
        return null;
    }
};

/** PROTOCOL §2.2, sections included per the folia_state arguments. */
export const buildStateSnapshot = (
    args: ControlStateQuery,
    app: ControlAppInfo,
): ControlStateSnapshot => {
    const playback = usePlaybackStore.getState();
    const audio = useAudioSettingsStore.getState();
    const visualizer = useVisualizerSettingsStore.getState();
    const theme = useThemeSettingsStore.getState();
    const view = useAppViewStore.getState();
    const currentSong = playback.currentSong;
    const queue = playback.playQueue;
    const includeQueue = args.includeQueue !== false;
    const includeProviders = args.includeProviders !== false;

    return {
        app: {
            version: app.version,
            platform: app.platform,
            isElectron: app.isElectron,
            controlVersion: CONTROL_CATALOG_VERSION,
        },
        view: {
            view: view.view,
            panelOpen: view.isPanelOpen,
            panelTab: view.panelTab ?? null,
            settingsOpen: useSettingsModalStore.getState().settingsModalState.isOpen,
            paletteOpen: isCommandPaletteOpen(),
        },
        playback: {
            state: playbackStateName(selectDisplayPlayerState(playback)),
            isLoadingToPlay: playback.isLoadingToPlay,
            isFmMode: playback.isFmMode,
            song: currentSong ? summarizeSong(currentSong) : null,
            positionSeconds: currentTime.get(),
            durationSeconds: playback.duration,
            queueLength: queue.length,
            currentQueueIndex: queueIndexOf(queue, currentSong),
            replayGainMode: playback.replayGainMode,
            lyricOffsetMs: playback.lyricTimelineOffsetMs,
            liked: currentSongLiked(),
        },
        volume: {
            level: audio.volume,
            percent: Math.round(audio.volume * 100),
            muted: audio.isMuted,
            loopMode: audio.loopMode,
        },
        visualizer: {
            mode: visualizer.visualizerMode,
            background: visualizer.visualizerBackgroundMode,
            randomPerSong: visualizer.randomVisualizerModePerSong,
            smartBeatEnabled: visualizer.smartBeat.mode !== 'off',
            glowBlurQuantize: visualizer.glowBlurQuantize,
            frameRate: visualizer.visualizerFrameRate,
        },
        theme: {
            daylight: theme.isDaylight,
            followSystemTheme: theme.followSystemTheme,
            coverColorBg: theme.useCoverColorBg,
            staticMode: theme.staticMode,
            disableHomeDynamicBackground: theme.disableHomeDynamicBackground,
        },
        lyrics: buildLyricsSnapshot(args.includeLyrics === true),
        providers: includeProviders ? providerSummaries() : [],
        ...(includeQueue
            ? {
                queue: {
                    items: queue.slice(0, 100).map((song: ControlSongLike, index) => ({
                        index,
                        song: summarizeSong(song),
                    })),
                    total: queue.length,
                },
            }
            : {}),
    };
};

type ControlSongLike = Parameters<typeof summarizeSong>[0];

/** The compact one-call summary behind folia_status. */
export const buildStatusSnapshot = async (app: ControlAppInfo): Promise<Record<string, unknown>> => {
    const snapshot = buildStateSnapshot({ includeQueue: false, includeLyrics: false, includeProviders: true }, app);
    const providerId = activeProviderId();
    const activeProvider = providerId
        ? snapshot.providers.find(provider => provider.id === providerId) ?? null
        : null;
    const summary: ControlSongSummary | null = snapshot.playback.song;
    return {
        app: snapshot.app,
        view: snapshot.view,
        provider: activeProvider,
        providerCount: snapshot.providers.length,
        nowPlaying: summary
            ? {
                song: summary,
                state: snapshot.playback.state,
                isFmMode: snapshot.playback.isFmMode,
                positionSeconds: snapshot.playback.positionSeconds,
                durationSeconds: snapshot.playback.durationSeconds,
                liked: snapshot.playback.liked,
            }
            : null,
        volume: snapshot.volume,
        visualizer: { mode: snapshot.visualizer.mode, background: snapshot.visualizer.background },
        theme: snapshot.theme,
        queueLength: snapshot.playback.queueLength,
        window: await readWindowStatus(),
    };
};
