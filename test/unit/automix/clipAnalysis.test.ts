import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/clipAnalysis.test.ts
// What automix measures from a song's audio is kept per song, and read before anything is measured
// again: the profile (tempo, beat grid, loudness, how the song starts and ends) is stored, the
// separated windows are held for the session. Measured from a preview clip, either stood in for the
// song after the account could play the whole of it. So nothing is measured or kept from a URL marked
// as a preview, or from a file proven shorter than the song (wholeSongCheck.ts), and a stored profile
// of such a file is not used. A file whose length cannot be told is taken for the song, as always.
//
// Only the outermost things are stand-ins: the database, the media cache, fetch, the element that
// reads a file's header and the decoder. "Measured" below is the decoder being asked.

const { stored, saveToCache, saveAudioBlob, saveSongAudioLevel, previews, cache, audioListeners, getCachedSongAudioBlob, keepProviderSongAudio, ownCache } = vi.hoisted(() => ({
    stored: new Map<string, unknown>(),
    saveToCache: vi.fn(),
    saveAudioBlob: vi.fn(),
    saveSongAudioLevel: vi.fn(),
    previews: new Set<string>(),
    cache: { copy: null as Blob | null },
    audioListeners: new Set<(cacheKey: string, keptUrl?: string) => void>(),
    getCachedSongAudioBlob: vi.fn(),
    keepProviderSongAudio: vi.fn(async (..._args: unknown[]) => true),
    // Songs whose provider keeps its audio in a cache of its own, by id.
    ownCache: new Set<string>(),
}));

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => stored.get(key) ?? null),
    saveToCache: (...args: unknown[]) => saveToCache(...args),
}));
vi.mock('@/services/audioCache', () => ({
    saveAudioBlob: (...args: unknown[]) => saveAudioBlob(...args),
    notifyAudioCached: vi.fn(),
    onAudioCached: (listener: (cacheKey: string, keptUrl?: string) => void) => {
        audioListeners.add(listener);
        return () => audioListeners.delete(listener);
    },
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    getCachedSongAudioBlob: (...args: unknown[]) => getCachedSongAudioBlob(...args),
    hasCachedSongAudio: vi.fn(async () => cache.copy !== null),
    saveSongAudioLevel: (...args: unknown[]) => saveSongAudioLevel(...args),
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { levelOfAudioSource: () => 'high', isPreviewAudioSource: (url: string) => previews.has(url) },
}));
vi.mock('@/services/onlineMusic/providerRegistry', () => ({
    keepsOwnSongAudio: (song: SongResult) => ownCache.has(String(song.id)),
    hasProviderKeptSongAudio: vi.fn(async () => false),
    keepProviderSongAudio: (...args: unknown[]) => keepProviderSongAudio(...args),
}));
vi.mock('@/services/analysis/beatThis', () => ({ canRunBeatThis: () => false, analyseBeatGrid: vi.fn() }));
vi.mock('@/services/automix/analysisOffThread', () => ({ analyseTrackOffThread: vi.fn(), melSpectrogramOffThread: vi.fn() }));

const { clearTrackProfileRuntime, ensureTrackProfile, getTrackProfile, recordPlayedTail, setAnalysisScope } = await import('@/services/automix/profileService');
const { ensureStems, setWantedStems, stemWindowKey } = await import('@/services/automix/stems');
const { refreshModelAvailability } = await import('@/services/analysis/modelAvailability');
const { TRACK_PROFILE_VERSION } = await import('@/services/automix/trackProfile');

const songOf = (id: string) => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: id },
}) as unknown as SongResult;
const profileKey = (song: SongResult) => `automix_profile_online:kugou:${song.id}`;

// The file's header says it plays for `playLength` seconds.
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
// The decoder: asked means measured. It has nothing to decode with here, which ends the analysis
// after the step under test.
const decode = vi.fn(async (_bytes: ArrayBuffer): Promise<AudioBuffer> => { throw new Error('no decoder here'); });
class OfflineContext {
    decodeAudioData(bytes: ArrayBuffer) { return decode(bytes); }
}

beforeEach(async () => {
    vi.clearAllMocks();
    clearTrackProfileRuntime();
    stored.clear();
    previews.clear();
    cache.copy = null;
    ownCache.clear();
    getCachedSongAudioBlob.mockImplementation(async () => cache.copy);
    keepProviderSongAudio.mockResolvedValue(true);
    playLength = 200;
    vi.stubGlobal('window', {
        OfflineAudioContext: OfflineContext,
        electron: { separateStems: vi.fn(), getAutomixModelsPresent: vi.fn(async () => ({ beat_this: false, htdemucs: true })) },
    });
    await refreshModelAvailability();
    vi.stubGlobal('Audio', HeaderReader);
    // Big enough for the media cache to write it (playbackRecovery/mediaCacheGuard.ts).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(32 * 1024)]) })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:read');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

describe('the automix profile', () => {
    const analyse = async (song: SongResult, audioUrl: string | null) => {
        setAnalysisScope([song]);
        await ensureTrackProfile({ song, wantGrid: false, audioUrl, enableMediaCache: true });
    };

    it('measures and stores the whole song read from its URL', async () => {
        await analyse(songOf('1'), 'https://cdn.test/whole.mp3');

        expect(decode).toHaveBeenCalledTimes(1);
        expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        expect(saveSongAudioLevel).toHaveBeenCalledWith(songOf('1'), 'high');
    });

    it('neither downloads nor measures a URL marked as a preview clip', async () => {
        previews.add('https://cdn.test/trial.mp3');

        await analyse(songOf('2'), 'https://cdn.test/trial.mp3');

        expect(fetch).not.toHaveBeenCalled();
        expect(decode).not.toHaveBeenCalled();
        expect(saveAudioBlob).not.toHaveBeenCalled();
    });

    it('neither stores nor measures a file from a URL that plays for 30 seconds of the song', async () => {
        playLength = 30;

        await analyse(songOf('3'), 'https://cdn.test/short.mp3');

        expect(saveAudioBlob).not.toHaveBeenCalled();
        expect(saveSongAudioLevel).not.toHaveBeenCalled();
        expect(decode).not.toHaveBeenCalled();
    });

    it('measures a copy in the media cache, unless it plays for 30 seconds of the song', async () => {
        cache.copy = new Blob(['copy']);
        await analyse(songOf('4'), null);
        expect(decode).toHaveBeenCalledTimes(1);

        playLength = 30;
        await analyse(songOf('5'), null);
        expect(decode).toHaveBeenCalledTimes(1);
    });

    // Kept by a version that measured clips. A whole-file profile names the length of the file.
    it('does not use a stored profile of a file that played for 30 seconds of the song, and measures the song again', async () => {
        const fromClip = { version: TRACK_PROFILE_VERSION, partial: false, duration: 30, gridless: true, bpm: null, loudness: -9 };
        stored.set(profileKey(songOf('6')), fromClip);
        await analyse(songOf('6'), 'https://cdn.test/whole.mp3');
        expect(decode).toHaveBeenCalledTimes(1);
        expect(getTrackProfile(songOf('6'))).not.toEqual(fromClip);

        // Over half the song: no clip, whatever the stated length says (it may be another version's).
        const fromSong = { ...fromClip, duration: 120 };
        stored.set(profileKey(songOf('7')), fromSong);
        await analyse(songOf('7'), 'https://cdn.test/whole.mp3');
        expect(decode).toHaveBeenCalledTimes(1);
        expect(getTrackProfile(songOf('7'))).toEqual(fromSong);
    });

    it('measures and stores a whole song whose platform states another version\'s, longer length', async () => {
        const statedLonger = { ...songOf('20'), durationMs: 210_000 } as SongResult;
        playLength = 180;

        await analyse(statedLonger, 'https://cdn.test/whole.mp3');

        expect(saveAudioBlob).toHaveBeenCalledTimes(1);
        expect(decode).toHaveBeenCalledTimes(1);
    });

    // A skip is not remembered as a profile, so the song is asked again on every prefetch pass (one
    // per song start). The file found not to be the song is not read again for it.
    it('downloads a file proven not to be the song once, not on every pass; a failed download is tried again', async () => {
        playLength = 30;
        for (let pass = 0; pass < 3; pass += 1) await analyse(songOf('21'), 'https://cdn.test/short.mp3');
        expect(fetch).toHaveBeenCalledTimes(1);

        // Another URL is another file.
        await analyse(songOf('21'), 'https://cdn.test/other.mp3');
        expect(fetch).toHaveBeenCalledTimes(2);

        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        for (let pass = 0; pass < 2; pass += 1) await analyse(songOf('22'), 'https://cdn.test/whole.mp3');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reads a copy proven not to be the song once, until the song\'s audio is written or the copy is gone', async () => {
        const song = songOf('23');
        cache.copy = new Blob(['a clip kept as the song']);
        playLength = 30;
        for (let pass = 0; pass < 3; pass += 1) await analyse(song, null);
        expect(getCachedSongAudioBlob).toHaveBeenCalledTimes(1);

        // A new copy of the song: what the end-of-song writer announces.
        audioListeners.forEach(listener => listener('audio_online:kugou:23'));
        await analyse(song, null);
        expect(getCachedSongAudioBlob).toHaveBeenCalledTimes(2);

        // Playback deleted it.
        cache.copy = null;
        await analyse(song, null);
        expect(getCachedSongAudioBlob).toHaveBeenCalledTimes(3);
    });

    // A song measured earlier is not read again, but its provider is still asked to keep its file.
    it('does not ask a provider with a cache of its own to keep a URL marked as a preview clip', async () => {
        ownCache.add('24');
        stored.set(profileKey(songOf('24')), { version: TRACK_PROFILE_VERSION, partial: false, duration: 200, gridless: true, bpm: null, loudness: -9 });
        previews.add('https://cdn.test/trial.mp3');

        await analyse(songOf('24'), 'https://cdn.test/trial.mp3');
        clearTrackProfileRuntime();
        await analyse(songOf('24'), 'https://cdn.test/whole.mp3');

        await vi.waitFor(() => expect(keepProviderSongAudio).toHaveBeenCalled());
        expect(keepProviderSongAudio.mock.calls).toEqual([[songOf('24'), 'https://cdn.test/whole.mp3']]);
    });

    // A head-only profile is completed from what the deck heard when the track played out. A deck
    // that played a clip heard how the clip ends.
    it('completes a head-only profile from a deck that played the song, not from one that played a clip', async () => {
        const hop = 0.5;
        const heard = (seconds: number) => Array.from({ length: seconds / hop }, () => -20);
        const headOnly = { version: TRACK_PROFILE_VERSION, partial: true, duration: 40, gridless: true, bpm: null, loudness: -9 };
        for (const id of ['8', '9', '10']) {
            stored.set(profileKey(songOf(id)), headOnly);
            await analyse(songOf(id), null);
        }
        expect(getTrackProfile(songOf('8'))).toEqual(headOnly);

        previews.add('https://cdn.test/trial.mp3');
        recordPlayedTail(songOf('8'), heard(30), hop, 30, 'https://cdn.test/short.mp3');
        recordPlayedTail(songOf('9'), heard(200), hop, 200, 'https://cdn.test/trial.mp3');
        expect(saveToCache).not.toHaveBeenCalled();

        recordPlayedTail(songOf('10'), heard(200), hop, 200, 'https://cdn.test/whole.mp3');
        expect(saveToCache).toHaveBeenCalledExactlyOnceWith(profileKey(songOf('10')), expect.objectContaining({ partial: false, duration: 200 }));
    });
});

describe('the separated windows', () => {
    const separate = async (song: SongResult) => {
        setWantedStems([stemWindowKey(song, 'tail')]);
        await ensureStems({ song, role: 'tail', audioUrl: null, stillWanted: () => true });
    };

    it('separates a copy in the media cache, unless it plays for 30 seconds of the song', async () => {
        cache.copy = new Blob(['copy']);
        await separate(songOf('11'));
        expect(decode).toHaveBeenCalledTimes(1);

        playLength = 30;
        await separate(songOf('12'));
        expect(decode).toHaveBeenCalledTimes(1);
    });
});
