import type { LocalSong } from '../types';
import type { ModRuntimeInfo } from '../mods/types';
import { importDirectoryHandle } from '../services/localMusicService';
import { buildUnifiedLocalSong } from '../services/playbackAdapters';
import { createFoliumPlaybackService } from '../mods/folium/services';
import { toFoliumSong } from '../mods/folium/dto';
import { buildMockAudio, buildMockCover, buildMockLyrics, MOCK_SONG_ARTIST, MOCK_SONG_TITLE } from './mockSongAssets';

// src/dev/mockSong.ts
// Loads and plays the dev mock song through the real paths: its files go into an OPFS folder, that
// folder is imported as a local library folder (so the song has a real FileSystemFileHandle and is
// played, matched and shown like any local file), and it plays through the same playback service a
// Folium mod uses. Calling it again reuses the folder and the library record.

const MOCK_FOLDER_NAME = 'Folia Dev Mock';
const MOCK_AUDIO_FILE = `${MOCK_SONG_ARTIST} - ${MOCK_SONG_TITLE}.wav`;
const MOCK_LYRICS_FILE = `${MOCK_SONG_ARTIST} - ${MOCK_SONG_TITLE}.lrc`;
const MOCK_COVER_FILE = 'cover.png';
const HOST_WAIT_TIMEOUT_MS = 60_000;
const HOST_WAIT_INTERVAL_MS = 250;

// Playback control only: the dev helper acts as a mod with that one permission would.
export const DEV_PLAYBACK_CALLER: ModRuntimeInfo = {
    id: 'folia-dev-mock-song',
    name: 'Dev mock song',
    version: null,
    author: null,
    description: null,
    permissions: ['playback.control'],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: true,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: false,
    clientUrl: null,
};

// The audio takes a moment to synthesize: made once a page load, not once a call.
let mockAudio: Blob | null = null;
// Calls that overlap (?mockSong at launch plus an agent's own call) share one import and one play.
let pendingPlay: Promise<LocalSong> | null = null;

/** Writes a file unless the same bytes are already there, so an unchanged file keeps its library record as it is. */
export const writeFileOnce = async (dir: FileSystemDirectoryHandle, name: string, makeBlob: () => Blob | Promise<Blob>) => {
    const handle = await dir.getFileHandle(name, { create: true });
    const blob = await makeBlob();
    const existing = await handle.getFile();
    if (existing.size === blob.size) {
        const [before, after] = await Promise.all([existing.arrayBuffer(), blob.arrayBuffer()]);
        const a = new Uint8Array(before);
        const b = new Uint8Array(after);
        if (a.every((byte, index) => byte === b[index])) return;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
};

const prepareMockFolder = async (): Promise<FileSystemDirectoryHandle> => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(MOCK_FOLDER_NAME, { create: true });
    await writeFileOnce(dir, MOCK_AUDIO_FILE, () => (mockAudio ??= buildMockAudio()));
    await writeFileOnce(dir, MOCK_LYRICS_FILE, () => new Blob([buildMockLyrics()], { type: 'text/plain' }));
    await writeFileOnce(dir, MOCK_COVER_FILE, buildMockCover);
    return dir;
};

/** Resolves once App has registered the playback actions; they are not there until it mounts. */
export const waitForPlaybackHost = async (playback: ReturnType<typeof createFoliumPlaybackService>) => {
    const deadline = Date.now() + HOST_WAIT_TIMEOUT_MS;
    for (;;) {
        try {
            playback.getState();
            return;
        } catch (error) {
            if (Date.now() > deadline) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, HOST_WAIT_INTERVAL_MS));
    }
};

const importAndPlay = async (): Promise<LocalSong> => {
    const playback = createFoliumPlaybackService(DEV_PLAYBACK_CALLER, 'main');
    await waitForPlaybackHost(playback);

    const imported = await importDirectoryHandle(await prepareMockFolder());
    const localSong = imported.find(song => song.fileName === MOCK_AUDIO_FILE);
    if (!localSong) throw new Error(`[DevMockSong] ${MOCK_AUDIO_FILE} was not imported`);

    const song = toFoliumSong(buildUnifiedLocalSong({ localSong, matchedSong: null, coverUrl: null, preferOnlineMetadata: false }));
    if (!song) throw new Error('[DevMockSong] could not build the song');
    if (!(await playback.playSong(song))) throw new Error('[DevMockSong] the player did not take the song');
    // The player takes the song even when the browser then refuses to start audio without a user gesture.
    if (playback.getState().state !== 'playing') {
        console.warn('[DevMockSong] The mock song is loaded but not playing (autoplay blocked?); press play.');
    } else {
        console.log('[DevMockSong] Playing the mock song from', localSong.filePath);
    }
    return localSong;
};

/** Imports the mock song into the local library and plays it. Resolves with its library record. */
export const playMockSong = (): Promise<LocalSong> => {
    pendingPlay ??= importAndPlay().finally(() => {
        pendingPlay = null;
    });
    return pendingPlay;
};
