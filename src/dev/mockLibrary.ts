import type { LocalSong } from '../types';
import type { ModRuntimeInfo } from '../mods/types';
import { importDirectoryHandle } from '../services/localMusicService';
import { buildUnifiedLocalSong } from '../services/playbackAdapters';
import { createFoliumPlaybackService } from '../mods/folium/services';
import { toFoliumSong } from '../mods/folium/dto';
import { buildMockAudio, buildMockCover, buildMockLyrics, type MockLyricLine, type MockTrackTags } from './mockSongAssets';
import { DEV_PLAYBACK_CALLER, waitForPlaybackHost, writeFileOnce } from './mockSong';

// src/dev/mockLibrary.ts
// A whole mock library for testing queues: three artists, two albums each, four short tracks an album
// (24 tracks of 20 seconds). Like the mock song, the files are made in the page, written to an OPFS
// folder (one subfolder an album, with its own cover) and imported as a real local library folder; then
// the whole library becomes the play queue, in album order, and its first track plays. Short tracks so
// that a queue runs through in minutes; distinct keys and covers so that an order is easy to read.

const MOCK_LIBRARY_FOLDER_NAME = 'Folia Dev Mock Library';
const TRACK_SECONDS = 20;
const TRACKS_PER_ALBUM = 4;

// Replacing the queue is its own permission: the dev helper acts as a mod with control and queue would.
const DEV_LIBRARY_CALLER: ModRuntimeInfo = {
    ...DEV_PLAYBACK_CALLER,
    id: 'folia-dev-mock-library',
    name: 'Dev mock library',
    permissions: ['playback.control', 'playback.queue'],
};

type MockAlbum = { artist: string; album: string; colors: readonly [string, string, string]; label: string; transpose: number };

// Each album in its own key (a semitone ratio), so tracks of different albums sound different.
const semitones = (count: number) => 2 ** (count / 12);
const MOCK_ALBUMS: readonly MockAlbum[] = [
    { artist: 'Mock Ensemble', album: 'First Light', colors: ['#f7971e', '#ffd200', '#21d4fd'], label: 'LIGHT', transpose: semitones(0) },
    { artist: 'Mock Ensemble', album: 'Night Shift', colors: ['#141e30', '#243b55', '#7f53ac'], label: 'NIGHT', transpose: semitones(-3) },
    { artist: 'Dev Quartet', album: 'Fixtures', colors: ['#11998e', '#38ef7d', '#f9f871'], label: 'FIX', transpose: semitones(2) },
    { artist: 'Dev Quartet', album: 'Edge Cases', colors: ['#ee0979', '#ff6a00', '#ffd452'], label: 'EDGE', transpose: semitones(5) },
    { artist: '测试乐团', album: '晨', colors: ['#a1c4fd', '#c2e9fb', '#fbc2eb'], label: '晨', transpose: semitones(-5) },
    { artist: '测试乐团', album: '暮', colors: ['#614385', '#516395', '#f093fb'], label: '暮', transpose: semitones(7) },
];

const TRACK_WORDS = ['One', 'Two', 'Three', 'Four'];
const CJK_TRACK_WORDS = ['一', '二', '三', '四'];

const isCjkText = (text: string) => /[\u3000-\u9fff]/.test(text);

const trackTags = (album: MockAlbum, track: number): MockTrackTags => ({
    title: isCjkText(album.album) ? `${album.album}之${CJK_TRACK_WORDS[track - 1]}` : `${album.album} ${TRACK_WORDS[track - 1]}`,
    artist: album.artist,
    album: album.album,
    track,
});

/** Four word-timed lines that name the track, so the lyrics on screen say which one is playing. */
const trackLyrics = (tags: MockTrackTags): MockLyricLine[] => {
    const titleWords = isCjkText(tags.title)
        ? Array.from(tags.title)
        : tags.title.split(' ').map((word, index, all) => (index < all.length - 1 ? `${word} ` : word));
    return [
        { start: 2, words: titleWords },
        { start: 6, words: [`${tags.artist} `, '· ', tags.album] },
        { start: 10, words: ['track ', String(tags.track)] },
        { start: 14, words: titleWords },
    ];
};

const albumFolderName = (album: MockAlbum) => `${album.artist} - ${album.album}`;
const trackFileBase = (tags: MockTrackTags) => `${String(tags.track).padStart(2, '0')} ${tags.title}`;

// The audio takes a moment to synthesize: made once a page load, like the mock song's.
const audioByFile = new Map<string, Blob>();
// Calls that overlap (?mockLibrary at launch plus an agent's own call) share one import.
let pendingLoad: Promise<LocalSong[]> | null = null;

const prepareLibraryFolder = async (): Promise<FileSystemDirectoryHandle> => {
    const root = await navigator.storage.getDirectory();
    const libraryDir = await root.getDirectoryHandle(MOCK_LIBRARY_FOLDER_NAME, { create: true });
    for (const album of MOCK_ALBUMS) {
        const dir = await libraryDir.getDirectoryHandle(albumFolderName(album), { create: true });
        await writeFileOnce(dir, 'cover.png', () => buildMockCover({ colors: album.colors, label: album.label }));
        for (let track = 1; track <= TRACKS_PER_ALBUM; track += 1) {
            const tags = trackTags(album, track);
            const base = trackFileBase(tags);
            const audioKey = `${albumFolderName(album)}/${base}`;
            await writeFileOnce(dir, `${base}.wav`, () => {
                let audio = audioByFile.get(audioKey);
                if (!audio) {
                    audio = buildMockAudio({ tags, seconds: TRACK_SECONDS, transpose: album.transpose });
                    audioByFile.set(audioKey, audio);
                }
                return audio;
            });
            await writeFileOnce(dir, `${base}.lrc`, () => new Blob([buildMockLyrics(tags, trackLyrics(tags))], { type: 'text/plain' }));
        }
    }
    return libraryDir;
};

/** The library's tracks in album order (the order of MOCK_ALBUMS, then the track number in the file name). */
const inAlbumOrder = (songs: LocalSong[]): LocalSong[] => {
    const albumIndex = new Map(MOCK_ALBUMS.map((album, index) => [albumFolderName(album), index]));
    const position = (song: LocalSong) => {
        const folder = song.folderName?.split('/').at(-1) ?? '';
        return (albumIndex.get(folder) ?? MOCK_ALBUMS.length) * 100 + Number.parseInt(song.fileName, 10);
    };
    return songs.filter(song => song.fileName.endsWith('.wav')).sort((a, b) => position(a) - position(b));
};

const importAndQueue = async (): Promise<LocalSong[]> => {
    const playback = createFoliumPlaybackService(DEV_LIBRARY_CALLER, 'main');
    await waitForPlaybackHost(playback);

    const imported = inAlbumOrder(await importDirectoryHandle(await prepareLibraryFolder()));
    if (imported.length === 0) throw new Error('[DevMockLibrary] nothing was imported');
    const songs = imported.map(localSong => toFoliumSong(buildUnifiedLocalSong({ localSong, matchedSong: null, coverUrl: null, preferOnlineMetadata: false })));
    const queue = songs.filter(song => song !== null);
    if (queue.length !== imported.length) throw new Error('[DevMockLibrary] could not build every song');

    // Play the first track, then make the whole library the queue around it.
    if (!(await playback.playSong(queue[0]))) throw new Error('[DevMockLibrary] the player did not take the first track');
    const result = await playback.replaceQueue(queue, { expectedVersion: playback.getQueue({ limit: 1 }).version });
    if (result.status !== 'replaced') throw new Error(`[DevMockLibrary] the queue was not replaced (${result.reason})`);
    console.log(`[DevMockLibrary] Queued ${result.length} mock tracks from ${MOCK_LIBRARY_FOLDER_NAME}`);
    if (playback.getState().state !== 'playing') {
        console.warn('[DevMockLibrary] The queue is loaded but not playing (autoplay blocked?); press play.');
    }
    return imported;
};

/** Imports the mock library into the local library and plays all of it as the queue. Resolves with its library records. */
export const loadMockLibrary = (): Promise<LocalSong[]> => {
    pendingLoad ??= importAndQueue().finally(() => {
        pendingLoad = null;
    });
    return pendingLoad;
};
