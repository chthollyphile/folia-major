import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider } from '@/types/onlineMusic';

// test/unit/services/onlineAudioLevelCache.test.ts
// The quality option decides what plays, for a song in the media cache too.
//
// A song played to its end is saved under a key that names the song and no level, and playback
// takes that copy first. So a song played through at 'standard' went on playing the standard copy
// after the option was moved to 'high', with the option's button lit on 'high' the whole time.
//
// Run through the real services from the provider's URL to the saved copy and back, because the
// rule only holds if three places agree on one thing: the URL omni noted a level for, the URL the
// writer is handed when the song ends, and the level playback asks the cache with.

const store = new Map<string, unknown>();
const audio = new Map<string, Blob>();
// db.ts swallows a write that fails: the caller is told nothing, and the entry is as it was.
let levelWritesFail = false;
// The desktop side cannot delete a file (held open on Windows).
let deleteFails = false;

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => store.get(key) ?? null),
    saveToCache: vi.fn(async (key: string, value: unknown) => {
        if (levelWritesFail && key.startsWith('audioLevel_')) return;
        store.set(key, value);
    }),
    removeFromCache: vi.fn(async (key: string) => { store.delete(key); }),
}));
vi.mock('@/services/audioCache', () => ({
    getCachedAudioBlob: vi.fn(async (key: string) => audio.get(key) ?? null),
    hasCachedAudio: vi.fn(async (key: string) => audio.has(key)),
    saveAudioBlob: vi.fn(async (key: string, blob: Blob) => { audio.set(key, blob); }),
    // As the desktop side deletes: only while the file is the size that was read.
    removeAudioBlob: vi.fn(async (key: string, size: number) => {
        if (deleteFails) throw new Error('EBUSY: resource busy or locked');
        if (audio.get(key)?.size !== size) return false;
        audio.delete(key);
        return true;
    }),
    notifyAudioCached: vi.fn(),
    onAudioCached: () => () => { },
    cacheLimitBytes: () => 0,
}));
vi.mock('@/services/coverCache', () => ({ getCachedCoverUrl: vi.fn(), hasCachedCover: vi.fn(), saveCoverBlob: vi.fn() }));

// Statically, so the (large) module graph behind onlinePlayback is paid during collection.
const { registerOnlineMusicProvider, unregisterOnlineMusicProvider } = await import('@/services/onlineMusic/providerRegistry');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');
const { cachePlayedTrackAssets } = await import('@/services/playedTrackCache');
const { clearPrefetchRuntime, getPrefetchedData } = await import('@/services/prefetchService');

const providerId = 'level-cache-test';
const song: UnifiedSong = {
    id: 'a',
    name: 'Song',
    artists: [],
    album: { id: '', name: '' },
    durationMs: 200_000,
    sourceRef: { kind: 'online', providerId, mediaId: 'a' },
};
const audioKey = `audio_online:${providerId}:a`;
const levelKey = `audioLevel_online:${providerId}:a`;

// Stands in for the element the play length of a file is read with: by the writer before it stores
// a file, and by playback before it plays a copy. The body of each file is its own address (or a
// name a test gives it), and `shareOf` says what share of the song's stated length it plays for:
// all of it unless a test says otherwise, or 'silent' for a file whose header never answers.
const shareOf = new Map<string, number | 'silent'>();
// What happens elsewhere while a file's header is being read (a write of the song's whole file).
const whileReading = new Map<string, () => void>();
let lastObjectUrlBlob: Blob | null = null;
class HeaderReader {
    preload = '';
    duration = NaN;
    onloadedmetadata: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
        const blob = lastObjectUrlBlob;
        void blob?.text().then(text => {
            const body = text.trimEnd();
            whileReading.get(body)?.();
            const share = shareOf.get(body) ?? 1;
            if (share === 'silent') return;
            this.duration = song.durationMs / 1000 * share;
            this.onloadedmetadata?.();
        });
    }
    removeAttribute() { }
    load() { }
}

// Two levels, as YouTube Music has, each its own file. Handed out as NetEase hands its URLs out,
// over http, which playback upgrades: the writer is given a spelling the provider never returned.
const provider: OnlineMusicProvider = {
    id: providerId,
    displayName: providerId,
    capabilities: {
        search: false, playback: true, lyrics: false, auth: false, userLibrary: false,
        playlists: false, albums: false, artists: false, recommendations: false,
        mutations: false, wordByWordLyrics: false,
    },
    normalizeSong: () => song,
    playback: {
        getSongDetail: async () => song,
        audioQualityLevels: ['standard', 'high'],
        getAudioSource: async (_song, quality) => {
            asked += 1;
            if (!reachable) throw new Error('offline');
            return { url: `http://m1.music.126.net/a-${quality}.mp3`, fetchedAt: 1, quality, ...(previewOnly ? { preview: true } : {}) };
        },
    },
};
let reachable = true;
// The account may play only a clip of the song: the provider marks the URL it hands out.
let previewOnly = false;
let asked = 0;

/** Plays the song as the queue does under `preference`, and answers with what the player was given. */
const play = async (preference: 'standard' | 'high' | 'lossless' | 'hires') => {
    clearPrefetchRuntime();
    const result = await loadOnlineSongAudioSource(song, preference, null);
    if (result.kind !== 'ok') throw new Error('the song did not load');
    return result.audioSrc;
};
const savedBytes = async () => (await audio.get(audioKey)?.text())?.trimEnd();
// A fetched file: big enough for the media cache to write it.
const fileOf = (name: string) => new Blob([name.padEnd(32 * 1024)]);

describe('a cached song and the quality option', () => {
    beforeEach(() => {
        store.clear();
        audio.clear();
        reachable = true;
        levelWritesFail = false;
        previewOnly = false;
        asked = 0;
        shareOf.clear();
        vi.stubGlobal('Audio', HeaderReader);
        registerOnlineMusicProvider(provider);
        // The body of each file is its own address, so a saved copy says where it came from.
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, blob: async () => fileOf(url) })));
        vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
            lastObjectUrlBlob = blob as Blob;
            return 'blob:cached-copy';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });
    afterAll(() => unregisterOnlineMusicProvider(providerId));

    it('plays the copy while the option stays at the level the song was played through at', async () => {
        await cachePlayedTrackAssets(song, await play('standard'));

        expect(await play('standard')).toBe('blob:cached-copy');
    });

    it('plays a file of the new level, not the copy, once the option has moved', async () => {
        await cachePlayedTrackAssets(song, await play('standard'));

        expect(await play('high')).toBe('https://m1.music.126.net/a-high.mp3');
    });

    it('holds the new level after the song has been played to its end at it', async () => {
        await cachePlayedTrackAssets(song, await play('standard'));
        await cachePlayedTrackAssets(song, await play('high'));

        expect(await savedBytes()).toBe('https://m1.music.126.net/a-high.mp3');
        expect(await play('high')).toBe('blob:cached-copy');
        expect(await play('standard')).toBe('https://m1.music.126.net/a-standard.mp3');
    });

    // A provider may answer a song with less than the song (a preview clip of a members-only one),
    // and the URL plays as it comes. The whole song saved earlier must not be lost to the clip.
    it('keeps the copy when the file of the new level is a clip of the song', async () => {
        await cachePlayedTrackAssets(song, await play('standard'));
        shareOf.set('https://m1.music.126.net/a-high.mp3', 0.15);
        await cachePlayedTrackAssets(song, await play('high'));

        expect(await savedBytes()).toBe('https://m1.music.126.net/a-standard.mp3');
        expect(await play('standard')).toBe('blob:cached-copy');
        expect(await play('high')).toBe('https://m1.music.126.net/a-high.mp3');
    });

    // The new file must not be left under the old level's name: it would play as 'standard'.
    it('plays the new copy at any setting when its level could not be saved', async () => {
        await cachePlayedTrackAssets(song, await play('standard'));
        const playing = await play('high');
        levelWritesFail = true;
        await cachePlayedTrackAssets(song, playing);

        expect(await savedBytes()).toBe('https://m1.music.126.net/a-high.mp3');
        expect(await play('high')).toBe('blob:cached-copy');
        expect(await play('standard')).toBe('blob:cached-copy');
    });

    // The option is moved to 'high' while the song plays from its 'standard' URL, and the song is
    // asked for once more at the new level before it ends. What is saved when it ends is the
    // standard file, and it must be saved as that.
    it('saves the copy at the level it was fetched at when the option moved while it played', async () => {
        const playing = await play('standard');
        await play('high');
        await cachePlayedTrackAssets(song, playing);

        expect(await savedBytes()).toBe('https://m1.music.126.net/a-standard.mp3');
        expect(await play('high')).toBe('https://m1.music.126.net/a-high.mp3');
        expect(await play('standard')).toBe('blob:cached-copy');
    });

    // A stored preference the provider does not list lights its nearest lower level, and that
    // level's copy has to answer for it.
    it('plays the copy under a stored preference the provider serves at the level of that copy', async () => {
        await cachePlayedTrackAssets(song, await play('high'));

        expect(await play('hires')).toBe('blob:cached-copy');
    });

    // Offline, or the sign-in has ended: a copy of another level is better than no song.
    it('plays the copy of another level when the provider has no URL to give', async () => {
        await cachePlayedTrackAssets(song, await play('standard'));
        reachable = false;
        vi.spyOn(console, 'warn').mockImplementation(() => { });

        expect(await play('high')).toBe('blob:cached-copy');
        audio.clear();
        await expect(play('high')).rejects.toThrow('did not load');
    });

    it('goes on playing a copy saved before levels were kept, at any setting', async () => {
        audio.set(audioKey, new Blob(['an older copy']));

        expect(await play('standard')).toBe('blob:cached-copy');
        expect(await play('high')).toBe('blob:cached-copy');
    });
});

// A platform gives an account that may not play a song a preview clip of it. The clip plays, and the
// listener is told (playback reads `preview`); it is never stored as the song, so once the account
// may play the whole song, the whole song is what plays.
describe('a preview clip and the media cache', () => {
    beforeEach(() => {
        store.clear();
        audio.clear();
        reachable = true;
        previewOnly = false;
        asked = 0;
        shareOf.clear();
        vi.stubGlobal('Audio', HeaderReader);
        registerOnlineMusicProvider(provider);
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, blob: async () => fileOf(url) })));
        vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
            lastObjectUrlBlob = blob as Blob;
            return 'blob:cached-copy';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });
    afterAll(() => unregisterOnlineMusicProvider(providerId));

    const load = async (prefetched: Parameters<typeof loadOnlineSongAudioSource>[2] = null) => {
        const result = await loadOnlineSongAudioSource(song, 'high', prefetched);
        if (result.kind !== 'ok') throw new Error('the song did not load');
        return result;
    };

    it('plays the clip marked as a preview, does not store it, and plays the whole song once the account may', async () => {
        clearPrefetchRuntime();
        previewOnly = true;
        const clip = await load();
        expect(clip).toMatchObject({ audioSrc: 'https://m1.music.126.net/a-high.mp3', preview: true });
        await cachePlayedTrackAssets(song, clip.audioSrc);
        expect(audio.has(audioKey)).toBe(false);

        clearPrefetchRuntime();
        previewOnly = false;
        const whole = await load();
        expect(whole.preview).toBe(false);
        await cachePlayedTrackAssets(song, whole.audioSrc);
        expect(await savedBytes()).toBe('https://m1.music.126.net/a-high.mp3');
    });

    // The URL the prefetch pass holds is played without asking the provider again: the mark has to
    // come with it.
    it('keeps the mark on the URL the prefetch pass holds', async () => {
        clearPrefetchRuntime();
        previewOnly = true;
        await load();
        const prefetched = getPrefetchedData(song, 'high');
        expect(prefetched?.audioUrl).toBe('https://m1.music.126.net/a-high.mp3');

        expect(await load(prefetched)).toMatchObject({ audioSrc: prefetched!.audioUrl, preview: true });
        expect(asked).toBe(1);
    });

    // A copy stored by a version that kept clips: under half the song, it is deleted with its
    // level, and the song is asked of its platform as if there were no copy. Said once it is done.
    it('deletes a copy that plays for 30 seconds of the song, with its level, and plays the platform\'s file', async () => {
        clearPrefetchRuntime();
        audio.set(audioKey, new Blob(['a clip kept as the song']));
        store.set(levelKey, 'high');
        shareOf.set('a clip kept as the song', 0.15);

        expect((await load()).audioSrc).toBe('https://m1.music.126.net/a-high.mp3');
        expect(audio.has(audioKey)).toBe(false);
        expect(store.has(levelKey)).toBe(false);
        expect(console.log).toHaveBeenCalledWith('[Cache] Copy of "Song" deleted: it is shorter than half the song: play length 30.0s, stated length 200.0s');
    });

    // The copy is still on disk, so its level stays with it, and the log says what happened.
    it('keeps the copy and its level when the file cannot be deleted, and plays the platform\'s file', async () => {
        clearPrefetchRuntime();
        audio.set(audioKey, new Blob(['a clip kept as the song']));
        store.set(levelKey, 'high');
        shareOf.set('a clip kept as the song', 0.15);
        deleteFails = true;
        try {
            expect((await load()).audioSrc).toBe('https://m1.music.126.net/a-high.mp3');
        } finally {
            deleteFails = false;
        }

        expect(audio.has(audioKey)).toBe(true);
        expect(store.get(levelKey)).toBe('high');
        expect(console.log).toHaveBeenCalledWith('[Cache] Copy of "Song" not deleted (Error): it is shorter than half the song: play length 30.0s, stated length 200.0s');
    });

    // The stated length may be another version's: a whole song more than a tenth shorter than it is
    // no clip, and offline its deleted copy could not play at all.
    it('plays a copy that plays for 60% of the stated length, and keeps it', async () => {
        clearPrefetchRuntime();
        audio.set(audioKey, new Blob(['another version of the song']));
        shareOf.set('another version of the song', 0.6);

        expect((await load()).audioSrc).toBe('blob:cached-copy');
        expect(audio.has(audioKey)).toBe(true);
        expect(asked).toBe(0);
    });

    // The end of a play of this song writes its whole file, with its level, while playback measures
    // the old clip: the file deleted is only the one measured.
    it('leaves the whole file written while the clip was measured, and its level', async () => {
        clearPrefetchRuntime();
        audio.set(audioKey, new Blob(['a clip kept as the song']));
        shareOf.set('a clip kept as the song', 0.15);
        whileReading.set('a clip kept as the song', () => {
            audio.set(audioKey, new Blob(['the whole song, written while the clip was measured']));
            store.set(levelKey, 'high');
        });
        try {
            expect((await load()).audioSrc).toBe('https://m1.music.126.net/a-high.mp3');
        } finally {
            whileReading.clear();
        }

        expect(await savedBytes()).toBe('the whole song, written while the clip was measured');
        expect(store.get(levelKey)).toBe('high');
        expect(console.log).toHaveBeenCalledWith('[Cache] Copy of "Song" left, a newer file is there: it is shorter than half the song: play length 30.0s, stated length 200.0s');
    });

    it('plays a copy whose header gives no answer within the ceiling', async () => {
        clearPrefetchRuntime();
        audio.set(audioKey, new Blob(['a copy that says nothing']));
        shareOf.set('a copy that says nothing', 'silent');
        vi.useFakeTimers();
        try {
            const loading = load();
            await vi.advanceTimersByTimeAsync(300);

            expect((await loading).audioSrc).toBe('blob:cached-copy');
            expect(audio.has(audioKey)).toBe(true);
            expect(asked).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
