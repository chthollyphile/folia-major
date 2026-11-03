import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/profileState.test.ts
// Where a track's analysis stands, as the armed log prints it. "never requested" has to stay apart
// from every way a requested track can come back empty: the two read the same in a plan made blind,
// and only the first is a caller that forgot to ask - how local and Navidrome songs went unanalysed.

vi.mock('@/services/db', () => ({ getFromCache: async () => null, saveToCache: async () => {} }));

const { describeProfileState, ensureTrackProfile, setAnalysisScope } = await import('@/services/automix/profileService');

const song = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'local', mediaId: id },
});

describe('describeProfileState', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('says a track nobody asked about was never requested', () => {
        expect(describeProfileState(song('untouched'))).toBe('never requested');
    });

    it('says a requested track was dropped when it was out of scope at its turn', async () => {
        const dropped = song('dropped');
        setAnalysisScope([]);

        await ensureTrackProfile({ song: dropped, wantGrid: false, enableMediaCache: false });

        expect(describeProfileState(dropped)).toBe('dropped, not the current or the next track when its turn came');
    });

    it('says why a track in scope was skipped', async () => {
        // A local song with no file reader registered: nothing to read it with.
        const unreadable = song('unreadable');
        vi.stubGlobal('window', globalThis);
        setAnalysisScope([unreadable]);

        await ensureTrackProfile({ song: unreadable, wantGrid: false, enableMediaCache: false });

        expect(describeProfileState(unreadable)).toMatch(/^skipped: /);
    });
});
