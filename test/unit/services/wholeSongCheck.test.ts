import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/services/wholeSongCheck.test.ts
// The one rule asked before a song's audio is stored, and before what is measured from it is kept.
// Two numbers, because the song's stated length can be another version's: under half of it a file
// is not the song (refused, deleted, not measured); from 90% it is proven to be the whole song
// (what it takes to write over a copy). In between it is neither.
//
// Both writers ask the URL half first, before they download (playedTrackCache.ts,
// profileService.ts); the store check says the same on its own, so a writer that asks only it
// cannot store a clip either.

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { isPreviewAudioSource: (url: string) => url.includes('trial') },
}));

const { mayStoreSongAudio, whyNotTheSong, whyNotTheSongPlayed } = await import('@/services/wholeSongCheck');

const song = { id: '1', name: 'Song', durationMs: 200_000 } as unknown as SongResult;
const src = 'https://cdn.test/song.mp3';

// The element the header is read with: the file plays for `playLength` seconds.
let playLength = 200;
class HeaderReader {
    preload = '';
    duration = NaN;
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
        queueMicrotask(() => { this.duration = playLength; this.onloadedmetadata?.(); });
    }
    removeAttribute() { }
    load() { }
}
const withHeader = (seconds: number) => {
    playLength = seconds;
    vi.stubGlobal('Audio', HeaderReader);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:read');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
};

describe('the two shares', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        // seconds of 200, a first copy, over a copy, not the song
        [99, false, false, true],
        [100, true, false, false],
        [179, true, false, false],
        [180, true, true, false],
    ])('a file that plays for %d seconds of 200: a first copy %s, over a copy %s, not the song %s', async (seconds, first, over, notTheSong) => {
        withHeader(seconds);
        const blob = new Blob(['x']);

        expect((await mayStoreSongAudio(song, src, blob, false)).store).toBe(first);
        expect((await mayStoreSongAudio(song, src, blob, true)).store).toBe(over);
        expect(Boolean(await whyNotTheSong(song, null, blob))).toBe(notTheSong);
        expect(Boolean(whyNotTheSongPlayed(song, null, seconds))).toBe(notTheSong);
    });

    it('takes a whole song for the song where the platform states another version\'s length', async () => {
        withHeader(180);
        const statedLonger = { ...song, durationMs: 210_000 } as SongResult;

        expect((await mayStoreSongAudio(statedLonger, src, new Blob(['x']), false)).store).toBe(true);
        expect(await whyNotTheSong(statedLonger, null, new Blob(['x']))).toBeNull();
        expect(whyNotTheSongPlayed(statedLonger, src, 180)).toBeNull();
    });

    it('refuses a URL marked as a preview clip without reading the file, with or without a copy', async () => {
        const Audio = vi.fn();
        vi.stubGlobal('Audio', Audio);

        for (const writesOver of [false, true]) {
            await expect(mayStoreSongAudio(song, 'https://cdn.test/trial.mp3', new Blob(['x']), writesOver))
                .resolves.toEqual({ store: false, why: 'a preview clip, as its provider said' });
        }
        expect(Audio).not.toHaveBeenCalled();
        expect(whyNotTheSongPlayed(song, 'https://cdn.test/trial.mp3', 200)).toBe('a preview clip, as its provider said');
    });
});
