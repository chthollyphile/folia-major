import { selectDisplayLyrics, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { readLyricOffset, writeLyricOffset } from '../../utils/lyrics/lyricOffsetMemory';
import { buildLyricsSnapshot } from '../state';
import { ControlError, optionalBoolean, optionalNumber } from '../errors';
import { clamp, seekPlaybackTo } from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/lyrics.ts
// Lyric document, the per-song/global timeline offset, and seeking to a lyric line.

const MIN_OFFSET_MS = -60_000;
const MAX_OFFSET_MS = 60_000;

type OffsetScope = 'song' | 'global';

const currentSongOrFail = () => {
    const song = usePlaybackStore.getState().currentSong;
    if (!song) {
        throw new ControlError('no_song', 'No song is current');
    }
    return song;
};

const readGlobalOffset = (): number => useLyricSettingsStore.getState().globalLyricTimelineOffsetMs;

export const lyricHandlers: Record<string, ControlHandler> = {
    folia_lyrics: (args) => {
        const includeLines = optionalBoolean(args.includeLines, 'includeLines') ?? false;
        const limit = typeof args.limit === 'number' ? args.limit : 200;
        return buildLyricsSnapshot(includeLines, limit);
    },

    folia_lyric_offset: (args) => {
        const scope = (typeof args.scope === 'string' ? args.scope : 'song') as OffsetScope;
        const ms = optionalNumber(args.ms, 'ms');
        const deltaMs = optionalNumber(args.deltaMs, 'deltaMs');
        if (ms !== undefined && deltaMs !== undefined) {
            throw new ControlError('bad_request', 'Provide only one of ms or deltaMs');
        }
        const apply = (current: number): number => (
            clamp(ms !== undefined ? ms : current + (deltaMs ?? 0), MIN_OFFSET_MS, MAX_OFFSET_MS)
        );

        if (scope === 'global') {
            const current = readGlobalOffset();
            if (ms === undefined && deltaMs === undefined) {
                return {
                    scope,
                    offsetMs: current,
                    globalOffsetMs: current,
                    effectiveOffsetMs: current,
                };
            }
            const next = apply(current);
            useLyricSettingsStore.getState().handleSetGlobalLyricTimelineOffsetMs(next);
            const stored = readGlobalOffset();
            return {
                scope,
                offsetMs: stored,
                globalOffsetMs: stored,
                effectiveOffsetMs: stored,
            };
        }

        const song = currentSongOrFail();
        const current = readLyricOffset(song.id);
        if (ms === undefined && deltaMs === undefined) {
            return {
                scope,
                songId: String(song.id),
                offsetMs: current,
                globalOffsetMs: readGlobalOffset(),
                effectiveOffsetMs: current + readGlobalOffset(),
            };
        }
        const next = apply(current);
        writeLyricOffset(song.id, next);
        usePlaybackStore.getState().setLyricTimelineOffsetMs(next);
        const global = readGlobalOffset();
        return {
            scope,
            songId: String(song.id),
            offsetMs: next,
            globalOffsetMs: global,
            effectiveOffsetMs: next + global,
        };
    },

    folia_lyric_seek: (args) => {
        const lineIndex = typeof args.lineIndex === 'number' ? args.lineIndex : undefined;
        const seconds = optionalNumber(args.seconds, 'seconds');
        if (lineIndex === undefined && seconds === undefined) {
            throw new ControlError('bad_request', 'Provide lineIndex or seconds');
        }
        if (lineIndex !== undefined && seconds !== undefined) {
            throw new ControlError('bad_request', 'Provide only one of lineIndex or seconds');
        }
        if (seconds !== undefined) {
            return { lineIndex: null, positionSeconds: seekPlaybackTo(seconds) };
        }

        currentSongOrFail();
        const state = usePlaybackStore.getState();
        const lines = selectDisplayLyrics(state)?.lines ?? [];
        const line = lineIndex !== undefined ? lines[lineIndex] : undefined;
        if (!line) {
            throw new ControlError('bad_request', `Lyric line ${lineIndex} does not exist`, {
                lineIndex,
                lineCount: lines.length,
            });
        }
        const effectiveOffsetMs = state.lyricTimelineOffsetMs + readGlobalOffset();
        const positionSeconds = seekPlaybackTo(line.startTime + effectiveOffsetMs / 1000);
        return {
            lineIndex,
            positionSeconds,
            lineStartTime: line.startTime,
        };
    },
};
