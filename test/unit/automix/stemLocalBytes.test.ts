import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/stemLocalBytes.test.ts
// A local next-up track never enters the online media cache and gets no prefetch URL (prefetchSong
// skips local files), so before the `readBytes` entry its head parked forever on "not in the media
// cache yet" - a wait nothing would ever end, because no cache event fires for a file already on disk.
//
// What is checked is that the local head reads its OWN bytes and does not park: `readBytes` is called,
// and announcing a cache write afterwards does not re-enter (a parked request would). The decode and
// the model this environment has neither of; the observable is the byte read, the last step before them.

const { listeners, getCachedAudioBlob } = vi.hoisted(() => ({
    listeners: new Set<(cacheKey: string) => void>(),
    getCachedAudioBlob: vi.fn(),
}));

vi.mock('@/services/audioCache', () => ({
    onAudioCached: (listener: (cacheKey: string) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    getCachedAudioBlob,
    hasCachedAudio: vi.fn().mockResolvedValue(false),
    saveAudioBlob: vi.fn(),
}));

import { refreshModelAvailability } from '@/services/automix/modelAvailability';
import { ensureStems, setWantedStems, stemWindowKey } from '@/services/automix/stems';

const announce = (cacheKey: string) => { listeners.forEach(listener => listener(cacheKey)); };

const localSong = (id: string): SongResult => ({
    id,
    name: `local track ${id}`,
    isLocal: true,
    localRef: { songId: id },
} as unknown as SongResult);

describe('a local next-up head with no URL and no cache', () => {
    beforeEach(async () => {
        (globalThis as { window?: object }).window = {
            electron: {
                separateStems: vi.fn(),
                getAutomixModelsPresent: vi.fn().mockResolvedValue({ beat_this: true, htdemucs: true }),
            },
        };
        await refreshModelAvailability();
        getCachedAudioBlob.mockReset();
        getCachedAudioBlob.mockResolvedValue(null);
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('reads its own bytes and does not park on the media cache', async () => {
        const song = localSong('L1');
        setWantedStems([stemWindowKey(song, 'head')]);
        const readBytes = vi.fn().mockResolvedValue(new ArrayBuffer(1024));

        await ensureStems({ song, role: 'head', audioUrl: null, stillWanted: () => true, readBytes });
        // Entered the local byte path - the entry the incoming head was missing entirely.
        expect(readBytes).toHaveBeenCalledTimes(1);

        // A parked request would re-enter here and read again; a local one never parked, so this is a
        // no-op and the count holds.
        announce('audio_online:kugou:L1');
        await new Promise(resolve => { setTimeout(resolve, 10); });
        expect(readBytes).toHaveBeenCalledTimes(1);
    });

    it('does not park when the local file is unreachable either', async () => {
        const song = localSong('L2');
        setWantedStems([stemWindowKey(song, 'head')]);
        const readBytes = vi.fn().mockResolvedValue(null);

        await ensureStems({ song, role: 'head', audioUrl: null, stillWanted: () => true, readBytes });
        expect(readBytes).toHaveBeenCalledTimes(1);

        // An unreachable local file is a dead end, not a wait: nothing will fire a cache event for it,
        // so it must not sit parked. Announcing does not re-enter.
        announce('audio_online:kugou:L2');
        await new Promise(resolve => { setTimeout(resolve, 10); });
        expect(readBytes).toHaveBeenCalledTimes(1);
    });
});
