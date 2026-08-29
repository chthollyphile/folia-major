import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/stemWaitsForBytes.test.ts
// Separation may read cached bytes and never download any, so for an online track it is asked at
// the one moment the media cache is guaranteed to be empty: the effect fires when the track starts,
// and the file arrives only when analysis downloads it - which for the incoming track sits behind a
// URL resolve of its own, seconds later.
//
// Giving up there made stems a coin flip. From a real queue, two consecutive uncached pairs: the
// first was asked four times and the fourth landed after the download, so it separated; the second
// was asked three times, all inside one second, all before it - and that blend ran with no stems
// while the bytes had been on disk for three minutes. Nothing distinguished them but timing, and
// the log said nothing either way, because the reason prints once per window.
//
// So the request waits for the write instead of guessing at its schedule. What is checked here is
// the waiting, not the separating: every assertion is about whether the media cache is READ again,
// which is the last thing that happens before the decode and the model this environment has neither
// of. The suite runs on node, so `window` is stood up by hand as the other automix tests do it.

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

/** What `saveAudioBlob` would announce for this song. */
const cacheKeyOf = (song: SongResult) => `audio_online:kugou:${song.id}`;
const announce = (cacheKey: string) => { listeners.forEach(listener => listener(cacheKey)); };

// kugou rather than netease on purpose: netease carries legacy cache keys, so one lookup would read
// the cache twice and every count below would have to explain itself.
const songNamed = (id: string): SongResult => ({
    id,
    name: `track ${id}`,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: id },
} as unknown as SongResult);

/** A window nothing has moved on from, asked for the way the deck effect asks. */
const request = (song: SongResult) => ({
    song,
    role: 'tail' as const,
    audioUrl: 'https://example.invalid/track.mp3',
    stillWanted: () => true,
});

describe('a window whose bytes are not cached yet', () => {
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
    });

    it('reads the cache again when the bytes land, instead of giving up', async () => {
        const song = songNamed('1');
        setWantedStems([stemWindowKey(song, 'tail')]);

        await ensureStems(request(song));
        expect(getCachedAudioBlob).toHaveBeenCalledTimes(1);

        // The write analysis makes a few seconds later. This is the whole fix: before it, the log
        // ended at the line above and the transition ran on the master crossfade.
        announce(cacheKeyOf(song));
        await vi.waitFor(() => expect(getCachedAudioBlob).toHaveBeenCalledTimes(2));
    });

    it('ignores a write for a different track', async () => {
        const song = songNamed('2');
        setWantedStems([stemWindowKey(song, 'tail')]);

        await ensureStems(request(song));
        announce(cacheKeyOf(songNamed('999')));

        await new Promise(resolve => { setTimeout(resolve, 10); });
        expect(getCachedAudioBlob).toHaveBeenCalledTimes(1);
    });

    it('stops waiting once the pair it belongs to is no longer the one coming', async () => {
        const song = songNamed('3');
        setWantedStems([stemWindowKey(song, 'tail')]);
        await ensureStems(request(song));

        // A skip. The deck effect names the new pair on every track change, which is what bounds the
        // wait: an album skipped through would otherwise leave one entry per track passed, each
        // holding a song and waiting on a file nothing will ever ask for again.
        setWantedStems([stemWindowKey(songNamed('4'), 'tail')]);
        announce(cacheKeyOf(song));

        await new Promise(resolve => { setTimeout(resolve, 10); });
        expect(getCachedAudioBlob).toHaveBeenCalledTimes(1);
    });

    it('does not re-enter for a pair the listener has already left', async () => {
        const song = songNamed('5');
        setWantedStems([stemWindowKey(song, 'tail')]);
        let paired = true;
        await ensureStems({ ...request(song), stillWanted: () => paired });

        // Still wanted by the eviction set - this is the other half, the one the session moved on
        // from between the request and the write. Re-entering would spend a decode to learn it.
        paired = false;
        announce(cacheKeyOf(song));

        await new Promise(resolve => { setTimeout(resolve, 10); });
        expect(getCachedAudioBlob).toHaveBeenCalledTimes(1);
    });
});
