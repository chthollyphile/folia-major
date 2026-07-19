import { describe, expect, it } from 'vitest';
import { createSongSyncFingerprint, createSongSyncFingerprintCandidates } from '@/services/sync/syncFingerprint';
import type { SongResult, UnifiedSong } from '@/types';

// test/unit/sync/syncFingerprint.test.ts
// Verifies stable cross-device song fingerprints and configurable shard mapping.

const baseSong: SongResult = {
    id: 123,
    name: ' Bad   Apple ',
    artists: [{ id: 1, name: 'Nomico' }],
    album: { id: 2, name: 'Lovelight' },
    durationMs: 219321,
};

describe('sync fingerprint', () => {
    it('uses stable Netease song ids when available', () => {
        expect(createSongSyncFingerprint(baseSong)).toBe('netease:id:123');
    });

    it('uses local and navidrome source kinds to avoid cross-source collisions', () => {
        const localSong: UnifiedSong = {
            ...baseSong,
            isLocal: true,
            localRef: { songId: 'local-1' },
            sourceRef: { kind: 'local', mediaId: 'local-1' },
        };
        const navidromeSong: UnifiedSong = {
            ...baseSong,
            isNavidrome: true,
            sourceRef: { kind: 'navidrome', mediaId: 'navidrome-1' },
            navidromeData: {
                title: 'Bad Apple',
                artist: 'Nomico',
                durationMs: 219321,
            },
        };

        expect(createSongSyncFingerprint(localSong)).toBe('local|bad apple|nomico|220');
        expect(createSongSyncFingerprint(navidromeSong)).toBe('navidrome|bad apple|nomico|220');
    });

    it('keeps metadata candidates for old Netease sync keys', () => {
        expect(createSongSyncFingerprintCandidates(baseSong)).toEqual([
            'netease:id:123',
            'netease|bad apple|nomico|220',
        ]);
    });

});
