import { describe, expect, it } from 'vitest';
import {
    buildStagePlayerSnapshot,
    buildStagePlayerQueueItemId,
    resolveStagePlayerPositionSec,
    resolveStagePlayerQueueItemIndex,
} from '@/utils/stagePlayerSnapshot';
import { PlayerState, type SongResult } from '@/types';

// Keeps Stage player snapshot clock selection stable across stage-session variants.

describe('stage player snapshot clock selection', () => {
    it('uses the synthetic lyrics clock for stage sessions without an audio element', () => {
        const positionSec = resolveStagePlayerPositionSec({
            activePlaybackContext: 'stage',
            isExternalPlaybackSourceActive: false,
            audioCurrentTimeSec: null,
            motionCurrentTimeSec: 5,
            syntheticStageLyricsTimeSec: 1.75,
        });

        expect(positionSec).toBe(1.75);
    });

    it('keeps audio element time authoritative for external pushed media sessions', () => {
        const positionSec = resolveStagePlayerPositionSec({
            activePlaybackContext: 'stage',
            isExternalPlaybackSourceActive: false,
            audioCurrentTimeSec: 2.25,
            motionCurrentTimeSec: 5,
            syntheticStageLyricsTimeSec: 1.75,
        });

        expect(positionSec).toBe(2.25);
    });

    it('does not use the stage lyrics clock for external playback source snapshots', () => {
        const positionSec = resolveStagePlayerPositionSec({
            activePlaybackContext: 'stage',
            isExternalPlaybackSourceActive: true,
            audioCurrentTimeSec: null,
            motionCurrentTimeSec: 5,
            syntheticStageLyricsTimeSec: 1.75,
        });

        expect(positionSec).toBe(5);
    });
});

describe('stage player queue item ids', () => {
    const buildSong = (id: number, name: string): SongResult => ({
        id,
        name,
        artists: [],
        album: { id: 0, name: '', coverUrl: '' },
        durationMs: 1000,
    });

    it('rejects stale queue item ids when the same index now points at another song', () => {
        const originalSong = buildSong(42, 'Original');
        const replacementSong = buildSong(99, 'Replacement');
        const staleQueueItemId = buildStagePlayerQueueItemId(originalSong, 0);

        expect(resolveStagePlayerQueueItemIndex([replacementSong], staleQueueItemId)).toBe(-1);
    });

    it('resolves queue item ids only when source, song id, and index still match', () => {
        const queue = [
            buildSong(42, 'First'),
            buildSong(99, 'Second'),
        ];

        expect(resolveStagePlayerQueueItemIndex(queue, buildStagePlayerQueueItemId(queue[1], 1))).toBe(1);
        expect(resolveStagePlayerQueueItemIndex(queue, buildStagePlayerQueueItemId(queue[1], 0))).toBe(-1);
    });
});

describe('stage player snapshot duration', () => {
    const song: SongResult = {
        id: 42,
        name: 'Metadata Duration Song',
        artists: [],
        album: { id: 0, name: '', coverUrl: '' },
        durationMs: 211906,
    };

    it('falls back to current track metadata duration when playback duration is unknown', () => {
        const snapshot = buildStagePlayerSnapshot({
            activePlaybackContext: 'main',
            isExternalPlaybackSourceActive: false,
            currentSong: song,
            playQueue: [song],
            playerState: PlayerState.IDLE,
            positionMs: 0,
            durationMs: 0,
            canGoPrevious: false,
            canGoNext: false,
            coverUrl: null,
        });

        expect(snapshot.durationMs).toBe(211906);
        expect(snapshot.current?.durationMs).toBe(211906);
    });
});
