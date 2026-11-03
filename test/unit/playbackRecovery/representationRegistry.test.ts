import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { clearPlaybackRepresentationsForTests, getPlaybackAnalysisKey, getPlaybackRepresentation, getPlaybackRepresentationForRevision, onPlaybackRepresentationRegistered, registerPlaybackRepresentation } from '@/services/playbackRecovery/representationRegistry';

// Ensures analysis invalidates original decode failures when playback adopts a new representation.

const song: SongResult = {
    id: 'local-id',
    name: 'Unsupported track',
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 10_000,
    sourceRef: { kind: 'local', mediaId: 'local-id' },
    playbackSourceRevision: 'size:mtime',
};

describe('playback representation registry', () => {
    beforeEach(clearPlaybackRepresentationsForTests);

    it('keeps the original analysis key until a fallback is registered', () => {
        expect(getPlaybackAnalysisKey(song)).toBe('local:local-id');
        expect(getPlaybackRepresentation(song)).toBeNull();
    });

    it('versions profile and stem keys with the representation id', () => {
        registerPlaybackRepresentation({
            songKey: 'local:local-id',
            sourceRevision: 'size:mtime',
            representationId: 'transcode:abc',
            kind: 'transcoded',
            url: 'folia-transcode://media/key/audio.flac',
            mimeType: 'audio/flac',
            timelineOffsetSec: 0,
        });
        expect(getPlaybackAnalysisKey(song)).toBe('local:local-id@transcode:abc');
        expect(getPlaybackRepresentation(song)?.url).toContain('folia-transcode:');
        expect(getPlaybackRepresentationForRevision('local:local-id', 'size:mtime')).not.toBeNull();
        expect(getPlaybackRepresentationForRevision('local:local-id', 'changed')).toBeNull();
        expect(getPlaybackRepresentationForRevision('local:local-id', 'size:mtime')).toBeNull();
    });

    it('never exposes a stale representation to analysis', () => {
        registerPlaybackRepresentation({
            songKey: 'local:local-id',
            sourceRevision: 'old',
            representationId: 'transcode:old',
            kind: 'transcoded',
            url: 'folia-transcode://media/old/audio.flac',
            mimeType: 'audio/flac',
            timelineOffsetSec: 0,
        });

        expect(getPlaybackRepresentation(song)).toBeNull();
        expect(getPlaybackAnalysisKey(song)).toBe('local:local-id');
    });

    // The analysis listens here to re-read a song under its new key; a listener's failure is not the
    // playback recovery's, which registered the transcode and goes on to play it.
    it('tells its listeners after registering, and a listener that throws undoes nothing', () => {
        const transcode = {
            songKey: 'local:local-id',
            sourceRevision: 'size:mtime',
            representationId: 'transcode:abc',
            kind: 'transcoded' as const,
            url: 'folia-transcode://media/key/audio.flac',
            mimeType: 'audio/flac',
            timelineOffsetSec: 0,
        };
        const keysSeen: string[] = [];
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const stopThrowing = onPlaybackRepresentationRegistered(() => { throw new Error('listener failed'); });
        const stopListening = onPlaybackRepresentationRegistered(() => { keysSeen.push(getPlaybackAnalysisKey(song)); });

        try {
            registerPlaybackRepresentation(transcode);
            expect(keysSeen).toEqual(['local:local-id@transcode:abc']);
            expect(getPlaybackRepresentation(song)?.representationId).toBe('transcode:abc');
            expect(warn).toHaveBeenCalledTimes(1);

            stopListening();
            registerPlaybackRepresentation(transcode);
            expect(keysSeen).toHaveLength(1);
        } finally {
            stopThrowing();
            stopListening();
            warn.mockRestore();
        }
    });
});
