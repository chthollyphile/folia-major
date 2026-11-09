import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/playback/songAudioSource.test.ts
// Pins the three functions of src/components/app/playback/source/songAudioSource.ts: what each kind of
// song (a local file, a Navidrome song, an online song) gets back with the address its audio plays
// from. The file access, the Navidrome server and the online source are stubs; the registry of
// copies the browser can play is the real one. No request leaves the test.
// What is said for each failure is in test/unit/onlineMusic/onlineFailureTexts.test.ts.
// The HiFi route's side is pinned here too: a local file handed over as itself, a Navidrome song's
// stream of the original file and the format the server writes onto it.

const env = vi.hoisted(() => ({
    asked: [] as string[],
    unreadable: false,
    serverSong: null as unknown,
    audioResult: null as unknown,
}));

vi.mock('@/services/localMusicService', () => ({
    getAudioFromLocalSong: async (song: { id: string }) => { env.asked.push(`file ${song.id}`); return env.unreadable ? null : `blob:${song.id}`; },
    getFileFromLocalSong: async (song: { id: string }) => { env.asked.push(`the file itself ${song.id}`); return env.unreadable ? null : { name: `${song.id}.flac` }; },
    ensureLocalSongCoverAsset: async (song: { id: string }) => { env.asked.push(`cover asset ${song.id}`); return { ...song, localCoverAssetId: 'asset' }; },
}));
vi.mock('@/services/navidromeService', () => ({
    navidromeApi: {
        getStreamUrl: (config: { serverUrl: string }, id: string, format?: string) => `${config.serverUrl}/stream/${id}${format ? `?format=${format}` : ''}`,
        getSong: async (_config: unknown, id: string) => { env.asked.push(`server song ${id}`); return env.serverSong; },
    },
}));
vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongAudioSource: async (song: { id: string }, quality: string, prefetched: unknown) => {
        env.asked.push(`audio source ${song.id} ${quality} ${prefetched === null ? 'nothing prefetched' : 'with what was prefetched'}`);
        return env.audioResult;
    },
}));

const { loadLocalSongAudio, loadLocalSongHifiSource, loadNavidromeSongAudio, loadOnlineSongAudio } = await import('@/components/app/playback/source/songAudioSource');
const { clearPlaybackRepresentationsForTests, registerPlaybackRepresentation } = await import('@/services/playbackRecovery/representationRegistry');

const copy = (songKey: string, sourceRevision: string) => ({ songKey, sourceRevision, representationId: 'transcoded', url: `blob:copy-of-${songKey}` } as never);
const localFile = { id: 'l1', fileSize: 10, fileLastModified: 20 } as LocalSong;
const navidromeConfig = { serverUrl: 'https://navi.test' } as never;
const aNavidromeSong = () => ({
    id: 'n1', name: 'N', durationMs: 1000, isNavidrome: true, navidromeData: { id: 'n1', path: 'a/b.flac', suffix: 'flac' },
} as unknown as NavidromeSong);
const onlineSong = { id: 'x1', name: 'X', sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'x1' } } as unknown as SongResult;

beforeEach(() => {
    env.asked.length = 0;
    env.unreadable = false;
    env.serverSong = null;
    env.audioResult = null;
    clearPlaybackRepresentationsForTests();
    vi.spyOn(Date, 'now').mockReturnValue(5000);
});

describe('the audio of a local file', () => {
    it('is a blob URL of the file, with the record after its cover asset was asked for', async () => {
        const audio = await loadLocalSongAudio(localFile);

        expect(env.asked).toEqual(['file l1', 'cover asset l1']);
        expect(audio).toMatchObject({ blobUrl: 'blob:l1', localSong: { id: 'l1', localCoverAssetId: 'asset' } });
    });

    it('is nothing when the file cannot be read, and the cover asset is not asked for', async () => {
        env.unreadable = true;

        expect(await loadLocalSongAudio(localFile)).toBeNull();
        expect(env.asked).toEqual(['file l1']);
    });

    it('finds the copy the browser can play only when it was made from the file as it is now', async () => {
        const audio = await loadLocalSongAudio(localFile);

        expect(audio?.recoveredCopy('local:l1')).toBeNull();
        registerPlaybackRepresentation(copy('local:l1', 'l1:10:20'));
        expect(audio?.recoveredCopy('local:l1')).toMatchObject({ url: 'blob:copy-of-local:l1' });
        // A copy of the file before it changed: not used, and forgotten.
        registerPlaybackRepresentation(copy('local:l1', 'l1:11:20'));
        expect(audio?.recoveredCopy('local:l1')).toBeNull();
    });
});

describe('a local file for the HiFi route', () => {
    it('is the file itself and no blob URL, with the record after its cover asset was asked for', async () => {
        const source = await loadLocalSongHifiSource(localFile);

        expect(env.asked).toEqual(['the file itself l1', 'cover asset l1']);
        expect(source).toEqual({ file: { name: 'l1.flac' }, localSong: { ...localFile, localCoverAssetId: 'asset' } });
    });

    it('is nothing when the file cannot be read, and the cover asset is not asked for', async () => {
        env.unreadable = true;

        expect(await loadLocalSongHifiSource(localFile)).toBeNull();
        expect(env.asked).toEqual(['the file itself l1']);
    });
});

describe('the audio of a Navidrome song', () => {
    it('is its stream address, and the server is asked for the song at once', () => {
        const audio = loadNavidromeSongAudio(navidromeConfig, aNavidromeSong());

        expect(audio.streamUrl).toBe('https://navi.test/stream/n1');
        expect(env.asked).toEqual(['server song n1']);
    });

    it('writes the server\'s replay gain onto the song when it is waited for, and leaves the song alone when the server has none', async () => {
        const song = aNavidromeSong();
        env.serverSong = { replayGain: { trackGain: -4 } };
        const audio = loadNavidromeSongAudio(navidromeConfig, song);
        expect(song.navidromeData.replayGain).toBeUndefined();

        await audio.takeServerGain();
        expect(song.navidromeData.replayGain).toEqual({ trackGain: -4 });

        env.serverSong = {};
        await loadNavidromeSongAudio(navidromeConfig, song).takeServerGain();
        expect(song.navidromeData.replayGain).toEqual({ trackGain: -4 });
    });

    it('gives the stream of the original file for the HiFi route only when asked, and the web address stays as it was', () => {
        const audio = loadNavidromeSongAudio(navidromeConfig, aNavidromeSong());

        expect(audio.rawStreamUrl()).toBe('https://navi.test/stream/n1?format=raw');
        expect(audio.streamUrl).toBe('https://navi.test/stream/n1');
    });

    it('writes the file\'s format onto the song with the gain on the HiFi route, and only the gain on the web route', async () => {
        const format = { contentType: 'audio/flac', bitDepth: 24, samplingRate: 96000, channelCount: 2 };
        env.serverSong = { replayGain: { trackGain: -4 }, ...format };

        const onTheWeb = aNavidromeSong();
        await loadNavidromeSongAudio(navidromeConfig, onTheWeb).takeServerGain();
        expect(onTheWeb.navidromeData).toEqual({ id: 'n1', path: 'a/b.flac', suffix: 'flac', replayGain: { trackGain: -4 } });

        const onHifi = aNavidromeSong();
        await loadNavidromeSongAudio(navidromeConfig, onHifi).takeServerGainAndFormat();
        expect(onHifi.navidromeData).toEqual({ id: 'n1', path: 'a/b.flac', suffix: 'flac', replayGain: { trackGain: -4 }, ...format });
        // One request for both: the server is asked once per load.
        expect(env.asked).toEqual(['server song n1', 'server song n1']);
    });

    it('keeps the format the song had where the server leaves a field out, or does not answer', async () => {
        const song = aNavidromeSong();
        Object.assign(song.navidromeData, { contentType: 'audio/x-flac', bitDepth: 16, samplingRate: 44100, channelCount: 2 });
        env.serverSong = { samplingRate: 48000 };
        await loadNavidromeSongAudio(navidromeConfig, song).takeServerGainAndFormat();
        expect(song.navidromeData).toMatchObject({ contentType: 'audio/x-flac', bitDepth: 16, samplingRate: 48000, channelCount: 2 });
        expect(song.navidromeData.replayGain).toBeUndefined();

        env.serverSong = null;
        await loadNavidromeSongAudio(navidromeConfig, song).takeServerGainAndFormat();
        expect(song.navidromeData).toMatchObject({ contentType: 'audio/x-flac', bitDepth: 16, samplingRate: 48000, channelCount: 2 });
    });

    it('names the revision of the song at this address, and finds the copy made from it', () => {
        const song = aNavidromeSong();
        const audio = loadNavidromeSongAudio(navidromeConfig, song);
        const revision = 'n1:a/b.flac:flac:1000:https://navi.test/stream/n1';

        expect(audio.revisionOf(song as unknown as SongResult)).toBe(revision);
        expect(audio.recoveredCopy(song as unknown as SongResult)).toBeNull();
        registerPlaybackRepresentation(copy('navidrome:n1', revision));
        expect(audio.recoveredCopy(song as unknown as SongResult)).toMatchObject({ url: 'blob:copy-of-navidrome:n1' });
    });
});

describe('the audio of an online song', () => {
    it('hands an address that cannot be had back as it is, and asks with nothing prefetched unless told', async () => {
        const failure = { case: 'sign-in-needed', operation: 'audio', providerId: 'bodian', facts: { errorCode: 'auth-required' } };
        env.audioResult = { kind: 'unavailable', failure };

        expect(await loadOnlineSongAudio(onlineSong, 'high')).toEqual({ kind: 'unavailable', failure });
        expect(env.asked).toEqual(['audio source x1 high nothing prefetched']);
    });

    it('gives an address that was just asked for the time now', async () => {
        env.audioResult = { kind: 'ok', audioSrc: 'https://audio.test/x1', replayGain: { trackGain: -2 } };

        expect(await loadOnlineSongAudio(onlineSong, 'high')).toEqual({
            kind: 'ok', audioSrc: 'https://audio.test/x1', replayGain: { trackGain: -2 }, fetchedAt: 5000,
        });
    });

    it('gives a copy from the media cache no fetch time', async () => {
        env.audioResult = { kind: 'ok', audioSrc: 'blob:copy', blobUrl: 'blob:copy' };

        expect(await loadOnlineSongAudio(onlineSong, 'high')).toMatchObject({ blobUrl: 'blob:copy', fetchedAt: null });
    });

    it('gives the prefetched address the time it was prefetched at, and another address the time now', async () => {
        const prefetched = { audioUrl: 'https://audio.test/prefetched', audioUrlFetchedAt: 1234 } as never;

        env.audioResult = { kind: 'ok', audioSrc: 'https://audio.test/prefetched' };
        expect(await loadOnlineSongAudio(onlineSong, 'high', prefetched)).toMatchObject({ fetchedAt: 1234 });
        env.audioResult = { kind: 'ok', audioSrc: 'https://audio.test/asked-again' };
        expect(await loadOnlineSongAudio(onlineSong, 'high', prefetched)).toMatchObject({ fetchedAt: 5000 });
        expect(env.asked).toEqual(['audio source x1 high with what was prefetched', 'audio source x1 high with what was prefetched']);
    });
});
