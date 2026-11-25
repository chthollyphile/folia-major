import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBlob } from 'music-metadata';
import {
    deleteFolderSongs,
    clearFolderIgnore,
    EMBEDDED_METADATA_VERSION,
    deleteSongsByIds,
    deleteLocalSong as deleteLocalMusicSong,
    extractMetadataFromFilename,
    getAudioFromFile,
    getAudioFromLocalSong,
    importFolder,
    LocalFolderUnavailableError,
    probeLocalRootAccess,
    reauthorizeLocalRoot,
    resyncAllFolders,
    resyncFolder,
    removeImportedRoot,
} from '@/services/localMusicService';
import {
    deleteDirHandle,
    deleteLocalLibrarySnapshot,
    deleteLocalSong,
    deleteLocalSongs,
    getDirHandles,
    getFromCache,
    getLocalLibrarySnapshot,
    getLocalSongs,
    saveDirHandles,
    saveLocalLibrarySnapshot,
    saveLocalSong,
    saveLocalSongs,
    saveToCache,
} from '@/services/db';
import { removeCachedCover } from '@/services/coverCache';
import { removeDeletedLocalSongsFromFoliaPlaylists } from '@/services/foliaPlaylist/foliaPlaylistService';
import { useLyricSettingsStore } from '@/stores/useLyricSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { DEFAULT_LOCAL_LYRIC_FORMAT_ORDER } from '@/utils/lyrics/localLyricFormatOrder';
import { applyUploadedLocalLyrics } from '@/utils/lyrics/localLyricsUpload';
import { setLocalFolderIgnored } from '@/services/localLibraryFolderIgnore';
import type { LocalLibrarySnapshot, LocalSong } from '@/types';
import { audio, block, flac, jpeg, picture } from '../utils/flacMetadataFixtures';

// test/unit/services/localMusicService.test.ts
// Covers local folder import root reuse and subfolder resync routing.

vi.mock('@/services/db', () => ({
    deleteDirHandle: vi.fn(),
    deleteLocalLibrarySnapshot: vi.fn(),
    deleteLocalSong: vi.fn(),
    deleteLocalSongs: vi.fn(),
    getDirHandles: vi.fn(),
    getFromCache: vi.fn(),
    getLocalLibrarySnapshot: vi.fn(),
    getLocalSongs: vi.fn(),
    saveDirHandles: vi.fn(),
    saveLocalLibrarySnapshot: vi.fn(),
    saveLocalSong: vi.fn(),
    saveLocalSongs: vi.fn(),
    saveToCache: vi.fn(),
}));
vi.mock('@/services/coverCache', () => ({
    removeCachedCover: vi.fn(),
}));
vi.mock('@/services/foliaPlaylist/foliaPlaylistService', () => ({
    removeDeletedLocalSongsFromFoliaPlaylists: vi.fn(),
}));

class FakeFileHandle {
    kind = 'file' as const;
    name: string;
    private readonly file: File;

    constructor(name: string, options: { content?: BlobPart; lastModified?: number; type?: string; } = {}) {
        this.name = name;
        this.file = new File([options.content ?? 'audio'], name, {
            type: options.type ?? 'audio/mpeg',
            lastModified: options.lastModified ?? 1000,
        });
    }

    async getFile() {
        return this.file;
    }
}

class FakeDirectoryHandle {
    kind = 'directory' as const;
    private readonly entries: Array<FakeDirectoryHandle | FakeFileHandle>;

    constructor(
        public name: string,
        entries: Array<FakeDirectoryHandle | FakeFileHandle> = [],
        private readonly sameEntryToken = name
    ) {
        this.entries = entries;
    }

    async *values() {
        for (const entry of this.entries) {
            yield entry;
        }
    }

    async getDirectoryHandle(name: string) {
        const entry = this.entries.find(item => item.kind === 'directory' && item.name === name);
        if (!entry || entry.kind !== 'directory') {
            throw new Error(`Missing directory ${name}`);
        }
        return entry;
    }

    async getFileHandle(name: string) {
        const entry = this.entries.find(item => item.kind === 'file' && item.name === name);
        if (!entry || entry.kind !== 'file') {
            throw new Error(`Missing file ${name}`);
        }
        return entry;
    }

    async queryPermission() {
        return 'granted' as PermissionState;
    }

    async requestPermission() {
        return 'granted' as PermissionState;
    }

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return other instanceof FakeDirectoryHandle && other.sameEntryToken === this.sameEntryToken;
    }
}

const createLibraryHandle = (token = 'library-root') => new FakeDirectoryHandle('Music', [
    new FakeDirectoryHandle('Disc 1', [
        new FakeFileHandle('Track 01.mp3'),
    ], `${token}:disc-1`),
], token);

const createLibraryHandleWithLyric = (lyricName: string, lyricContent: string, token = 'library-root') => new FakeDirectoryHandle('Music', [
    new FakeDirectoryHandle('Disc 1', [
        new FakeFileHandle('Track 01.mp3'),
        new FakeFileHandle(lyricName, { content: lyricContent, type: 'text/plain' }),
    ], `${token}:disc-1`),
], token);

const createSong = (patch: Partial<LocalSong> = {}): LocalSong => ({
    id: 'local-track-01',
    fileName: 'Track 01.mp3',
    filePath: 'Music/Disc 1/Track 01.mp3',
    title: 'Track 01',
    titleOrigin: 'import',
    importedMetadata: { title: 'Track 01', titleSource: 'filename', artistNames: [] },
    duration: 0,
    fileSize: 5,
    fileLastModified: 1000,
    fileSignature: 'Music/Disc 1/Track 01.mp3::5::1000',
    mimeType: 'audio/mpeg',
    addedAt: 1000,
    folderName: 'Music/Disc 1',
    ...patch,
});

const createSnapshotWithLegacyOtherLyricKind = (): LocalLibrarySnapshot => ({
    rootFolderName: 'Music',
    scannedAt: 1000,
    tree: {
        name: 'Music',
        relativePath: 'Music',
        hash: 'legacy-root',
        files: [],
        children: [
            {
                name: 'Disc 1',
                relativePath: 'Music/Disc 1',
                hash: 'legacy-disc',
                files: [
                    {
                        name: 'Track 01.mp3',
                        relativePath: 'Music/Disc 1/Track 01.mp3',
                        kind: 'audio',
                        size: 5,
                        lastModified: 1000,
                        signature: 'Music/Disc 1/Track 01.mp3::5::1000',
                    },
                    {
                        name: 'Track 01.ttml',
                        relativePath: 'Music/Disc 1/Track 01.ttml',
                        kind: 'other',
                        size: 43,
                        lastModified: 1000,
                        signature: 'Music/Disc 1/Track 01.ttml::43::1000',
                    },
                ],
                children: [],
            },
        ],
    },
});

describe('localMusicService', () => {
    describe('extractMetadataFromFilename', () => {
        it.each([
            ['01. Title.wav', 'Title'],
            ['01 - Title.wav', 'Title'],
            ['1-01 恋せよ乙女!.wav', '恋せよ乙女!'],
            ['01 - Apple Lossless.alac', 'Apple Lossless'],
            ['01 - WavPack fallback.wv', 'WavPack fallback'],
            ['02 - Monkey fallback.ape', 'Monkey fallback'],
        ])('removes explicit track prefixes from %s', (fileName, title) => {
            expect(extractMetadataFromFilename(fileName)).toEqual({ title });
        });

        it.each([
            '2024.wav',
            '2024 Title.wav',
            '1234. Title.wav',
        ])('preserves numeric titles that are not explicit track prefixes: %s', (fileName) => {
            expect(extractMetadataFromFilename(fileName)).toEqual({
                title: fileName.replace(/\.wav$/, ''),
            });
        });
    });

    beforeEach(() => {
        vi.mocked(deleteDirHandle).mockReset().mockResolvedValue(true);
        vi.mocked(deleteLocalLibrarySnapshot).mockReset();
        vi.mocked(deleteLocalSong).mockReset();
        vi.mocked(deleteLocalSongs).mockReset();
        vi.mocked(getDirHandles).mockReset();
        vi.mocked(getFromCache).mockReset();
        vi.mocked(getLocalLibrarySnapshot).mockReset();
        vi.mocked(getLocalSongs).mockReset();
        vi.mocked(saveDirHandles).mockReset();
        vi.mocked(saveLocalLibrarySnapshot).mockReset();
        vi.mocked(saveLocalSong).mockReset();
        vi.mocked(saveLocalSongs).mockReset();
        vi.mocked(saveToCache).mockReset();
        vi.mocked(removeCachedCover).mockReset();

        vi.mocked(getLocalSongs).mockResolvedValue([]);
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(null);
        vi.mocked(getDirHandles).mockResolvedValue({});
        vi.mocked(saveDirHandles).mockImplementation(async handles => Object.keys(handles));
        vi.mocked(saveLocalSongs).mockResolvedValue(undefined);
        vi.mocked(saveLocalLibrarySnapshot).mockResolvedValue(undefined);
        vi.mocked(getFromCache).mockResolvedValue([]);
        useLyricSettingsStore.setState({ localLyricFormatOrder: [...DEFAULT_LOCAL_LYRIC_FORMAT_ORDER] });

        vi.stubGlobal('window', {
            electron: {},
            showDirectoryPicker: vi.fn(),
            dispatchEvent: vi.fn(),
        });
        vi.stubGlobal('CustomEvent', class {
            constructor(public type: string, public init?: CustomEventInit) {}
        });
    });

    describe('local audio playback input', () => {
        afterEach(() => vi.restoreAllMocks());

        it.each(['accessible', 'persisted', 'stale'] as const)('repairs FLAC playback from a %s file handle', async route => {
            const source = flac([block(6, picture({ mime: '', image: jpeg }), true)]);
            const handle = new FakeFileHandle('Cover.flac', { content: source, type: 'audio/flac' });
            const file = await handle.getFile();
            const original = new Uint8Array(await file.arrayBuffer());
            const stale = new FakeFileHandle('Cover.flac');
            vi.spyOn(stale, 'getFile').mockRejectedValue(new Error('Stale handle'));
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.mocked(getDirHandles).mockResolvedValue({
                Music: new FakeDirectoryHandle('Music', [handle]) as unknown as FileSystemDirectoryHandle,
            });
            const song = createSong({
                id: `flac-playback-${route}`,
                fileName: 'Cover.flac',
                filePath: 'Music/Cover.flac',
                folderName: 'Music',
                fileHandle: route === 'persisted' ? undefined : (route === 'stale' ? stale : handle) as unknown as FileSystemFileHandle,
            });
            const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:repaired-local-flac');

            expect(await getAudioFromLocalSong(song)).toBe('blob:repaired-local-flac');
            const playbackInput = createUrl.mock.calls[0][0] as Blob;
            expect(playbackInput).not.toBe(file);
            expect(await playbackInput.slice(54, 64).text()).toBe('image/jpeg');
            expect((await parseBlob(playbackInput)).common.picture?.[0].data).toEqual(jpeg);
            expect(new Uint8Array(await playbackInput.slice(-audio.length).arrayBuffer())).toEqual(audio);
            expect(new Uint8Array(await file.arrayBuffer())).toEqual(original);
        });

        it('repairs direct file input before creating the playback URL', async () => {
            const file = new File([flac([block(6, picture({ mime: '', image: jpeg }), true)])], 'Cover.flac');
            const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:repaired-direct-file');
            expect(await getAudioFromFile(file)).toBe('blob:repaired-direct-file');
            expect(await (createUrl.mock.calls[0][0] as Blob).slice(54, 64).text()).toBe('image/jpeg');
        });

        it.each([
            ['valid FLAC', flac([block(6, picture(), true)])],
            ['MP3', new Blob(['ID3 mp3 audio'], { type: 'audio/mpeg' })],
        ])('uses the original File for %s without creating a replacement Blob', async (_, source) => {
            const file = new File([source], 'Valid audio', { type: source.type });
            const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unchanged-file');
            expect(await getAudioFromFile(file)).toBe('blob:unchanged-file');
            expect(createUrl).toHaveBeenCalledWith(file);
        });
    });

    it('rescans the existing root when the same folder is imported again', async () => {
        const persistedHandle = createLibraryHandle();
        const selectedHandle = createLibraryHandle();
        vi.mocked(getDirHandles).mockResolvedValue({ Music: persistedHandle as unknown as FileSystemDirectoryHandle });
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(selectedHandle as unknown as FileSystemDirectoryHandle);

        const importedSongs = await importFolder();

        expect(importedSongs).toHaveLength(1);
        expect(saveDirHandles).toHaveBeenCalledWith({ Music: selectedHandle });
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({ rootFolderName: 'Music' }));
        expect(saveLocalSongs).toHaveBeenCalledWith([
            expect.objectContaining<Partial<LocalSong>>({
                filePath: 'Music/Disc 1/Track 01.mp3',
                folderName: 'Music/Disc 1',
            }),
        ]);
    });

    it('imports formats handled by the Electron transcode fallback', async () => {
        (window as any).electron.requestTranscodeFallback = vi.fn();
        const fallbackFileNames = [
            'Track.alac',
            'Track.ape',
            'Track.wv',
            'Track.tta',
            'Track.wma',
            'Track.aif',
            'Track.aiff',
            'Track.caf',
            'Track.dsf',
            'Track.dff',
        ];
        const selectedHandle = new FakeDirectoryHandle('Music', [
            ...fallbackFileNames.map(name => new FakeFileHandle(name, { type: 'application/octet-stream' })),
            new FakeFileHandle('Not Audio.txt', { type: 'text/plain' }),
        ]);
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(
            selectedHandle as unknown as FileSystemDirectoryHandle,
        );

        const importedSongs = await importFolder();

        expect(importedSongs.map(song => song.fileName).sort()).toEqual(fallbackFileNames.sort());
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({
            tree: expect.objectContaining({
                files: expect.arrayContaining(fallbackFileNames.map(name => expect.objectContaining({
                    name,
                    kind: 'audio',
                }))),
            }),
        }));
    });

    it('does not import Electron-only fallback formats in the Web build', async () => {
        const selectedHandle = new FakeDirectoryHandle('Music', [
            new FakeFileHandle('Playable.mp3'),
            new FakeFileHandle('Needs Electron.wv', { type: 'audio/wavpack' }),
            new FakeFileHandle('Needs Electron.wma', { type: 'audio/x-ms-wma' }),
        ]);
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(
            selectedHandle as unknown as FileSystemDirectoryHandle,
        );

        const importedSongs = await importFolder();

        expect(importedSongs.map(song => song.fileName)).toEqual(['Playable.mp3']);
    });

    it('reuses handles collected during traversal without probing or resolving file paths again', async () => {
        const lyricHandle = new FakeFileHandle('Track.lrc', { content: '[00:00.00]Track', type: 'text/plain' });
        const coverHandle = new FakeFileHandle('cover.jpg', { content: 'cover', type: 'image/jpeg' });
        const albumHandle = new FakeDirectoryHandle('Album', [
            new FakeFileHandle('Track.mp3'),
            lyricHandle,
            coverHandle,
        ]);
        const selectedHandle = new FakeDirectoryHandle('Music', [albumHandle]);
        const rootDirectoryLookup = vi.spyOn(selectedHandle, 'getDirectoryHandle');
        const rootFileLookup = vi.spyOn(selectedHandle, 'getFileHandle');
        const albumDirectoryLookup = vi.spyOn(albumHandle, 'getDirectoryHandle');
        const albumFileLookup = vi.spyOn(albumHandle, 'getFileHandle');
        const lyricFileLookup = vi.spyOn(lyricHandle, 'getFile');
        const coverFileLookup = vi.spyOn(coverHandle, 'getFile');
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(
            selectedHandle as unknown as FileSystemDirectoryHandle,
        );

        const importedSongs = await importFolder();

        expect(importedSongs).toHaveLength(1);
        expect(rootDirectoryLookup).not.toHaveBeenCalled();
        expect(rootFileLookup).not.toHaveBeenCalled();
        expect(albumDirectoryLookup).not.toHaveBeenCalled();
        expect(albumFileLookup).not.toHaveBeenCalled();
        expect(lyricFileLookup).toHaveBeenCalledOnce();
        expect(coverFileLookup).toHaveBeenCalledOnce();
    });

    it('applies root .foliaignore rules to files, snapshots, and nested directories', async () => {
        const selectedHandle = new FakeDirectoryHandle('Music', [
            new FakeFileHandle('.foliaignore', {
                content: 'Ignored/\n*.tmp.mp3\n!keep.tmp.mp3\n',
                type: 'text/plain',
            }),
            new FakeDirectoryHandle('Ignored', [new FakeFileHandle('Hidden.mp3')]),
            new FakeDirectoryHandle('Visible', [
                new FakeFileHandle('Drop.tmp.mp3'),
                new FakeFileHandle('keep.tmp.mp3'),
                new FakeFileHandle('Track.mp3'),
            ]),
        ]);
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(
            selectedHandle as unknown as FileSystemDirectoryHandle,
        );

        const importedSongs = await importFolder();

        expect(importedSongs.map(song => song.filePath)).toEqual([
            'Music/Visible/keep.tmp.mp3',
            'Music/Visible/Track.mp3',
        ]);
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({
            tree: expect.objectContaining({
                children: [expect.objectContaining({
                    relativePath: 'Music/Visible',
                    files: expect.arrayContaining([
                        expect.objectContaining({ relativePath: 'Music/Visible/keep.tmp.mp3' }),
                        expect.objectContaining({ relativePath: 'Music/Visible/Track.mp3' }),
                    ]),
                })],
            }),
        }));
    });

    it('applies nested .foliaignore rules relative to each directory', async () => {
        const selectedHandle = new FakeDirectoryHandle('Music', [
            new FakeFileHandle('.foliaignore', { content: '*.mp3\n', type: 'text/plain' }),
            new FakeDirectoryHandle('Album', [
                new FakeFileHandle('.foliaignore', { content: '!keep.mp3\n*.flac\n', type: 'text/plain' }),
                new FakeFileHandle('keep.mp3'),
                new FakeFileHandle('drop.mp3'),
                new FakeFileHandle('drop.flac'),
            ]),
            new FakeDirectoryHandle('Other', [new FakeFileHandle('keep.mp3')]),
        ]);
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(
            selectedHandle as unknown as FileSystemDirectoryHandle,
        );

        const importedSongs = await importFolder();

        expect(importedSongs.map(song => song.filePath)).toEqual(['Music/Album/keep.mp3']);
        const savedSnapshot = vi.mocked(saveLocalLibrarySnapshot).mock.calls[0][0];
        expect(savedSnapshot.tree.children.map(node => node.relativePath)).toEqual([
            'Music/Album',
            'Music/Other',
        ]);
        expect(savedSnapshot.tree.children[0].files).toEqual([
            expect.objectContaining({ relativePath: 'Music/Album/keep.mp3' }),
        ]);
    });

    it('routes a child-folder resync through the imported root handle', async () => {
        const persistedHandle = createLibraryHandle();
        vi.mocked(getDirHandles).mockResolvedValue({ Music: persistedHandle as unknown as FileSystemDirectoryHandle });

        const importedSongs = await resyncFolder('Music/Disc 1');

        expect(importedSongs).toHaveLength(1);
        expect((window as any).showDirectoryPicker).not.toHaveBeenCalled();
        expect(saveDirHandles).toHaveBeenCalledWith({ Music: persistedHandle });
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({ rootFolderName: 'Music' }));
        expect(saveLocalSongs).toHaveBeenCalledWith([
            expect.objectContaining<Partial<LocalSong>>({
                filePath: 'Music/Disc 1/Track 01.mp3',
                folderName: 'Music/Disc 1',
            }),
        ]);
    });

    it.each([
        ['Track 01.ttml', '<tt xmlns="http://www.w3.org/ns/ttml"></tt>', 'ttml'],
        ['Track 01.qrc', '[1000,500](1000,500)Hi', 'qrc'],
        ['Track 01.yrc', '[1000,500](1000,500,0)Hi', 'yrc'],
        ['Track 01.krc', '[1000,500]<0,500,0>Hi', 'krc'],
    ] as const)('indexes %s sidecar lyrics with an explicit format', async (lyricName, lyricContent, expectedFormat) => {
        const selectedHandle = createLibraryHandleWithLyric(lyricName, lyricContent);
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(selectedHandle as unknown as FileSystemDirectoryHandle);

        const importedSongs = await importFolder();

        expect(importedSongs).toHaveLength(1);
        expect(saveLocalSongs).toHaveBeenCalledWith([
            expect.objectContaining<Partial<LocalSong>>({
                filePath: 'Music/Disc 1/Track 01.mp3',
                hasLocalLyrics: true,
                localLyricsContent: lyricContent,
                localLyricsFormat: expectedFormat,
            }),
        ]);
    });

    it('prefers a Folia .fia sidecar over an .lrc of the same name', async () => {
        const fiaContent = '{"format":"folia-lyricdata","version":1,"song":{},"lyrics":{"lines":[]}}';
        const selectedHandle = new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('Disc 1', [
                new FakeFileHandle('Track 01.mp3'),
                new FakeFileHandle('Track 01.lrc', { content: '[00:00.00]plain', type: 'text/plain' }),
                new FakeFileHandle('Track 01.fia', { content: fiaContent, type: 'application/json' }),
            ], 'library-root:disc-1'),
        ], 'library-root');
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(selectedHandle as unknown as FileSystemDirectoryHandle);

        await importFolder();

        expect(saveLocalSongs).toHaveBeenCalledWith([
            expect.objectContaining<Partial<LocalSong>>({
                filePath: 'Music/Disc 1/Track 01.mp3',
                hasLocalLyrics: true,
                localLyricsContent: fiaContent,
            }),
        ]);
    });

    describe('lyric format order', () => {
        const lrcContent = '[00:00.00]plain';
        const ttmlContent = '<tt xmlns="http://www.w3.org/ns/ttml"></tt>';
        const TTML_FIRST = ['ttml', 'lrc', 'vtt', 'qrc', 'yrc', 'krc'] as const;
        type FileSpec = { name: string; content?: string; lastModified?: number; };
        const DEFAULT_FILES: FileSpec[] = [
            { name: 'Track 01.mp3' },
            { name: 'Track 01.lrc', content: lrcContent },
            { name: 'Track 01.ttml', content: ttmlContent },
            { name: 'Track 02.mp3' },
            { name: 'Track 02.lrc', content: lrcContent },
        ];
        const createHandle = (files: FileSpec[]) => new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('Disc 1', files.map(file => new FakeFileHandle(file.name, {
                content: file.content,
                lastModified: file.lastModified,
                type: file.content === undefined ? undefined : 'text/plain',
            })), 'library-root:disc-1'),
        ], 'library-root');
        const byName = (songs: LocalSong[], fileName: string) => songs.find(song => song.fileName === fileName)!;

        // Imports once with the current order and returns the persisted songs and snapshot.
        const importOnce = async (files = DEFAULT_FILES) => {
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(createHandle(files) as unknown as FileSystemDirectoryHandle);
            const songs = await importFolder();
            const snapshot = vi.mocked(saveLocalLibrarySnapshot).mock.calls.at(-1)![0] as LocalLibrarySnapshot;
            return { songs, snapshot };
        };

        // Resyncs against the given records. Unchanged tracks come back as these same objects, so a
        // reference check tells re-read tracks from reused ones without racing background hydration.
        const resyncWith = async (songs: LocalSong[], snapshot: LocalLibrarySnapshot, files = DEFAULT_FILES) => {
            // Background hydration needs a Worker, so mark the songs as hydrated to keep the
            // metadata-version rescan out of the diff under test.
            const previous = songs.map(song => ({ ...song, embeddedMetadataVersion: EMBEDDED_METADATA_VERSION }));
            vi.mocked(getDirHandles).mockResolvedValue({ Music: createHandle(files) as unknown as FileSystemDirectoryHandle });
            vi.mocked(getLocalSongs).mockResolvedValue(previous);
            vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(snapshot);
            const resynced = (await resyncFolder('Music'))!;
            return { resynced, previous };
        };

        it('picks the sidecar format ranked first by the configured order', async () => {
            useLyricSettingsStore.setState({ localLyricFormatOrder: [...TTML_FIRST] });

            const { songs, snapshot } = await importOnce();

            expect(byName(songs, 'Track 01.mp3')).toMatchObject({
                localLyricsContent: ttmlContent,
                localLyricsFormat: 'ttml',
                localLyricsOrigin: 'sidecar',
            });
            expect(snapshot.lyricFormatOrder).toEqual([...TTML_FIRST]);
        });

        it('ranks translation sidecars by the same order', async () => {
            useLyricSettingsStore.setState({ localLyricFormatOrder: ['vtt', 'lrc', 'ttml', 'qrc', 'yrc', 'krc'] });

            const { songs } = await importOnce([
                { name: 'Track 01.mp3' },
                { name: 'Track 01.t.lrc', content: '[00:00.00]lrc translation' },
                { name: 'Track 01.t.vtt', content: 'WEBVTT\n\n00:00.000 --> 00:01.000\nvtt translation' },
            ]);

            expect(byName(songs, 'Track 01.mp3').localTranslationLyricsContent).toContain('vtt translation');
        });

        it('re-reads only tracks whose winning sidecar changes after the order changes', async () => {
            const { songs, snapshot } = await importOnce();
            expect(byName(songs, 'Track 01.mp3').localLyricsContent).toBe(lrcContent);

            useLyricSettingsStore.setState({ localLyricFormatOrder: [...TTML_FIRST] });
            const { resynced, previous } = await resyncWith(songs, snapshot);

            const track1 = byName(resynced, 'Track 01.mp3');
            expect(track1).not.toBe(byName(previous, 'Track 01.mp3'));
            expect(track1).toMatchObject({ id: byName(previous, 'Track 01.mp3').id, localLyricsContent: ttmlContent, localLyricsFormat: 'ttml' });
            expect(byName(resynced, 'Track 02.mp3')).toBe(byName(previous, 'Track 02.mp3'));
        });

        it('re-reads every audio file that shares the affected sidecar', async () => {
            const files: FileSpec[] = [
                { name: 'Track 01.mp3' },
                { name: 'Track 01.flac' },
                { name: 'Track 01.lrc', content: lrcContent },
                { name: 'Track 01.ttml', content: ttmlContent },
            ];
            const { songs, snapshot } = await importOnce(files);

            useLyricSettingsStore.setState({ localLyricFormatOrder: [...TTML_FIRST] });
            const { resynced } = await resyncWith(songs, snapshot, files);

            expect(byName(resynced, 'Track 01.mp3').localLyricsContent).toBe(ttmlContent);
            expect(byName(resynced, 'Track 01.flac').localLyricsContent).toBe(ttmlContent);
        });

        it('treats a snapshot without a stored order as scanned with the default order', async () => {
            const { songs, snapshot } = await importOnce();
            const { lyricFormatOrder: _omitted, ...legacySnapshot } = snapshot;

            const unchanged = await resyncWith(songs, legacySnapshot);
            expect(byName(unchanged.resynced, 'Track 01.mp3')).toBe(byName(unchanged.previous, 'Track 01.mp3'));
            expect(byName(unchanged.resynced, 'Track 02.mp3')).toBe(byName(unchanged.previous, 'Track 02.mp3'));

            useLyricSettingsStore.setState({ localLyricFormatOrder: [...TTML_FIRST] });
            const reordered = await resyncWith(songs, legacySnapshot);
            expect(byName(reordered.resynced, 'Track 01.mp3').localLyricsContent).toBe(ttmlContent);
        });

        it('keeps the stored order when a folder ignore rewrites the snapshot', async () => {
            useLyricSettingsStore.setState({ localLyricFormatOrder: [...TTML_FIRST] });
            const { songs, snapshot } = await importOnce();
            let storedSnapshot = snapshot;
            vi.mocked(getLocalLibrarySnapshot).mockImplementation(async () => storedSnapshot);
            vi.mocked(saveLocalLibrarySnapshot).mockImplementation(async value => { storedSnapshot = value; });

            await setLocalFolderIgnored('Music/Elsewhere', true);
            expect(storedSnapshot.lyricFormatOrder).toEqual([...TTML_FIRST]);

            // Back to the default: the track scanned under ttml-first has to switch back to its .lrc.
            useLyricSettingsStore.setState({ localLyricFormatOrder: [...DEFAULT_LOCAL_LYRIC_FORMAT_ORDER] });
            const { resynced } = await resyncWith(songs, storedSnapshot);
            expect(byName(resynced, 'Track 01.mp3').localLyricsContent).toBe(lrcContent);
        });

        it('keeps uploaded lyrics when only the format order changes', async () => {
            const { songs, snapshot } = await importOnce();
            const uploaded = songs.map(song => song.fileName === 'Track 01.mp3'
                ? applyUploadedLocalLyrics(song, { content: '[00:00.00]uploaded', isTranslation: false, fileName: 'mine.lrc' })
                : song);

            useLyricSettingsStore.setState({ localLyricFormatOrder: [...TTML_FIRST] });
            const { resynced } = await resyncWith(uploaded, snapshot);

            expect(byName(resynced, 'Track 01.mp3')).toMatchObject({
                localLyricsContent: '[00:00.00]uploaded',
                localLyricsOrigin: 'upload',
            });
        });

        it('replaces uploaded lyrics once a sidecar of the track changes on disk', async () => {
            const { songs, snapshot } = await importOnce();
            const uploaded = songs.map(song => song.fileName === 'Track 01.mp3'
                ? applyUploadedLocalLyrics(song, { content: '[00:00.00]uploaded', isTranslation: false, fileName: 'mine.lrc' })
                : song);
            const editedFiles = DEFAULT_FILES.map(file => file.name === 'Track 01.lrc'
                ? { ...file, content: '[00:00.00]edited', lastModified: 2000 }
                : file);

            const { resynced } = await resyncWith(uploaded, snapshot, editedFiles);

            expect(byName(resynced, 'Track 01.mp3')).toMatchObject({
                localLyricsContent: '[00:00.00]edited',
                localLyricsOrigin: 'sidecar',
            });
        });
    });

    it('rescans audio when a sidecar file kind changes from legacy other to lyric', async () => {
        const lyricContent = '<tt xmlns="http://www.w3.org/ns/ttml"></tt>';
        const persistedHandle = createLibraryHandleWithLyric('Track 01.ttml', lyricContent);
        vi.mocked(getDirHandles).mockResolvedValue({ Music: persistedHandle as unknown as FileSystemDirectoryHandle });
        vi.mocked(getLocalSongs).mockResolvedValue([createSong()]);
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(createSnapshotWithLegacyOtherLyricKind());

        const importedSongs = await resyncFolder('Music');

        expect(importedSongs).toHaveLength(1);
        expect(saveLocalSongs).toHaveBeenCalledWith([
            expect.objectContaining<Partial<LocalSong>>({
                id: 'local-track-01',
                filePath: 'Music/Disc 1/Track 01.mp3',
                hasLocalLyrics: true,
                localLyricsContent: lyricContent,
                localLyricsFormat: 'ttml',
            }),
        ]);
    });

    it('deduplicates nested folders before rescanning all imported roots', async () => {
        const musicHandle = createLibraryHandle('music-root');
        const otherHandle = createLibraryHandle('other-root');
        vi.mocked(getDirHandles).mockResolvedValue({
            Music: musicHandle as unknown as FileSystemDirectoryHandle,
            Other: otherHandle as unknown as FileSystemDirectoryHandle,
        });
        vi.mocked(getLocalSongs).mockResolvedValue([
            createSong({ id: 'music-track-01', folderName: 'Music/Disc 1', filePath: 'Music/Disc 1/Track 01.mp3' }),
            createSong({ id: 'music-track-02', folderName: 'Music/Disc 1/Sub', filePath: 'Music/Disc 1/Sub/Track 02.mp3' }),
            createSong({ id: 'other-track-01', folderName: 'Other/Disc 1', filePath: 'Other/Disc 1/Track 01.mp3' }),
        ]);

        const importedSongs = await resyncAllFolders();

        expect(importedSongs).toHaveLength(2);
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledTimes(2);
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({ rootFolderName: 'Music' }));
        expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({ rootFolderName: 'Other' }));
    });

    it('removes the external cover cache when deleting a local song', async () => {
        await deleteLocalMusicSong('local-track-01');

        expect(deleteLocalSong).toHaveBeenCalledWith('local-track-01');
        expect(removeCachedCover).toHaveBeenCalledWith('cover_local_local-track-01');
    });

    it('removes every external cover cache when deleting a folder tree', async () => {
        vi.mocked(getLocalSongs).mockResolvedValue([
            createSong({ id: 'song-1' }),
            createSong({
                id: 'song-2',
                folderName: 'Music/Disc 1/Sub',
                filePath: 'Music/Disc 1/Sub/Track 02.mp3',
            }),
            createSong({
                id: 'song-3',
                folderName: 'Other',
                filePath: 'Other/Track 03.mp3',
            }),
        ]);

        await deleteFolderSongs('Music/Disc 1');

        expect(deleteLocalSongs).toHaveBeenCalledWith(['song-1', 'song-2']);
        expect(removeDeletedLocalSongsFromFoliaPlaylists).toHaveBeenCalledWith(['song-1', 'song-2']);
        expect(removeCachedCover).toHaveBeenCalledTimes(2);
        expect(removeCachedCover).toHaveBeenCalledWith('cover_local_song-1');
        expect(removeCachedCover).toHaveBeenCalledWith('cover_local_song-2');
    });

    it('persists a deleted child as ignored, skips its contents, and restores it after clearing ignore', async () => {
        let snapshot: LocalLibrarySnapshot | null = null;
        vi.mocked(getLocalLibrarySnapshot).mockImplementation(async () => snapshot);
        vi.mocked(saveLocalLibrarySnapshot).mockImplementation(async value => { snapshot = value; });
        const ignoredChild = new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Hidden.mp3')]);
        const traverseChild = vi.spyOn(ignoredChild, 'values');
        const root = new FakeDirectoryHandle('Music', [ignoredChild]);
        vi.mocked(getDirHandles).mockResolvedValue({ Music: root as unknown as FileSystemDirectoryHandle });

        await deleteFolderSongs('Music/Disc 1');
        expect(snapshot!.ignoredFolderPaths).toEqual(['Music/Disc 1']);
        expect(snapshot!.tree.children[0]).toMatchObject({ ignored: true, files: [], children: [] });
        expect(deleteDirHandle).not.toHaveBeenCalled();

        expect(await resyncAllFolders()).toEqual([]);
        expect(traverseChild).not.toHaveBeenCalled();
        expect(snapshot!.tree.children[0]).toMatchObject({ ignored: true, relativePath: 'Music/Disc 1' });

        await clearFolderIgnore('Music/Disc 1');
        expect(snapshot!.ignoredFolderPaths).toEqual([]);
        expect(snapshot!.tree.children[0].ignored).not.toBe(true);
        expect(traverseChild).toHaveBeenCalled();
        expect(saveLocalSongs).toHaveBeenCalledWith([
            expect.objectContaining({ filePath: 'Music/Disc 1/Hidden.mp3' }),
        ]);
    });

    it('matches ignored paths literally without excluding similarly named siblings', async () => {
        let snapshot: LocalLibrarySnapshot | null = null;
        vi.mocked(getLocalLibrarySnapshot).mockImplementation(async () => snapshot);
        vi.mocked(saveLocalLibrarySnapshot).mockImplementation(async value => { snapshot = value; });
        const root = new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('[Live]', [new FakeFileHandle('Hidden.mp3')]),
            new FakeDirectoryHandle('[Live] 2', [new FakeFileHandle('Keep.mp3')]),
        ]);
        vi.mocked(getDirHandles).mockResolvedValue({ Music: root as unknown as FileSystemDirectoryHandle });
        await deleteFolderSongs('Music/[Live]');

        expect(await resyncFolder('Music')).toEqual([
            expect.objectContaining({ filePath: 'Music/[Live] 2/Keep.mp3' }),
        ]);
    });

    it('cleans cover cache when deleting a selected batch by song id', async () => {
        vi.mocked(getLocalSongs).mockResolvedValue([createSong({ id: 'song-1' })]);

        await deleteSongsByIds(['song-1', 'song-1']);

        expect(deleteLocalSongs).toHaveBeenCalledWith(['song-1']);
        expect(removeDeletedLocalSongsFromFoliaPlaylists).toHaveBeenCalledWith(['song-1']);
        expect(removeCachedCover).toHaveBeenCalledWith('cover_local_song-1');
    });

    it('removes an imported root even when it contains no music', async () => {
        vi.mocked(getLocalSongs).mockResolvedValue([]);

        await removeImportedRoot('EmptyRoot');

        expect(deleteDirHandle).toHaveBeenCalledWith('EmptyRoot');
        expect(deleteLocalLibrarySnapshot).toHaveBeenCalledWith('EmptyRoot');
        expect(deleteLocalSongs).not.toHaveBeenCalled();
    });

    it('clears ignored children when deleting their entire root from folder details', async () => {
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue({
            rootFolderName: 'Music', scannedAt: 1, ignoredFolderPaths: ['Music/Hidden'],
            tree: { name: 'Music', relativePath: 'Music', hash: '', files: [], children: [] },
        });
        await deleteFolderSongs('Music');
        expect(deleteDirHandle).toHaveBeenCalledWith('Music');
        expect(deleteLocalLibrarySnapshot).toHaveBeenCalledWith('Music');
        expect(saveLocalLibrarySnapshot).not.toHaveBeenCalled();
    });

    describe('a folder that cannot be read is not a folder whose files were deleted', () => {
        const gone = () => new DOMException('The drive is gone', 'NotFoundError');
        const unreadable = (handle: FakeDirectoryHandle) => {
            (handle as unknown as { values: () => AsyncIterable<never>; }).values = () => ({
                [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(gone()) }),
            });
            return handle;
        };
        const unreadableFile = (name: string) => {
            const handle = new FakeFileHandle(name);
            (handle as unknown as { getFile: () => Promise<File>; }).getFile = () => Promise.reject(gone());
            return handle;
        };
        const twoDiscs = (token = 'library-root') => new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Track 01.mp3')], `${token}:disc-1`),
            new FakeDirectoryHandle('Disc 2', [new FakeFileHandle('Track 02.mp3')], `${token}:disc-2`),
        ], token);
        const setRootHandle = (handle: FakeDirectoryHandle) => {
            vi.mocked(getDirHandles).mockResolvedValue({ Music: handle as unknown as FileSystemDirectoryHandle });
        };
        // 先正常扫一遍，把扫出来的歌和快照当成「已经在曲库里」的状态。
        const importOnce = async (handle: FakeDirectoryHandle) => {
            setRootHandle(handle);
            const songs = await resyncFolder('Music') as LocalSong[];
            const snapshot = vi.mocked(saveLocalLibrarySnapshot).mock.calls.at(-1)?.[0] as LocalLibrarySnapshot;
            vi.mocked(getLocalSongs).mockResolvedValue(songs);
            vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(snapshot);
            vi.mocked(deleteLocalSong).mockClear();
            vi.mocked(saveLocalSongs).mockClear();
            vi.mocked(saveLocalLibrarySnapshot).mockClear();
            vi.mocked(saveDirHandles).mockClear();
            vi.mocked(removeDeletedLocalSongsFromFoliaPlaylists).mockClear();
            return { songs, snapshot };
        };
        const flattenPaths = (snapshot: LocalLibrarySnapshot) => {
            const paths: string[] = [];
            const walk = (node: LocalLibrarySnapshot['tree']) => {
                node.files.forEach(file => paths.push(file.relativePath));
                node.children.forEach(walk);
            };
            walk(snapshot.tree);
            return paths.sort();
        };

        beforeEach(() => {
            vi.mocked(removeDeletedLocalSongsFromFoliaPlaylists).mockReset();
            useStatusMessageStore.setState({ message: null });
        });

        it('abandons the scan when the root cannot be listed: no song deleted, no snapshot saved, and the user is told', async () => {
            await importOnce(twoDiscs());
            setRootHandle(unreadable(twoDiscs()));

            const error = await resyncFolder('Music').catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(LocalFolderUnavailableError);
            expect(error).toMatchObject({ rootFolderName: 'Music', reason: 'unreadable' });
            expect(deleteLocalSong).not.toHaveBeenCalled();
            expect(saveLocalLibrarySnapshot).not.toHaveBeenCalled();
            expect(saveDirHandles).not.toHaveBeenCalled();
            expect(removeDeletedLocalSongsFromFoliaPlaylists).not.toHaveBeenCalled();
            const message = useStatusMessageStore.getState().message;
            expect(message).toMatchObject({ type: 'error' });
            expect(message?.text).toContain('“Music”');
            expect(message?.text).not.toContain('localMusic.');
            expect(message?.note).toBeTruthy();
            expect(message?.note).not.toContain('localMusic.');
            expect((error as Error).message).toBe(message?.text);
        });

        it('stays quiet when the caller asked not to announce (the auto scan), and still throws', async () => {
            await importOnce(twoDiscs());
            setRootHandle(unreadable(twoDiscs()));

            await expect(resyncFolder('Music', { announceUnavailable: false })).rejects.toBeInstanceOf(LocalFolderUnavailableError);

            expect(useStatusMessageStore.getState().message).toBeNull();
            expect(deleteLocalSong).not.toHaveBeenCalled();
        });

        it('keeps the songs under a subfolder that cannot be listed, and carries its snapshot branch over', async () => {
            const { songs, snapshot } = await importOnce(twoDiscs());
            const next = new FakeDirectoryHandle('Music', [
                new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Track 01.mp3')], 'library-root:disc-1'),
                unreadable(new FakeDirectoryHandle('Disc 2', [], 'library-root:disc-2')),
            ], 'library-root');
            setRootHandle(next);

            const result = await resyncFolder('Music');

            expect(deleteLocalSong).not.toHaveBeenCalled();
            expect(removeDeletedLocalSongsFromFoliaPlaylists).not.toHaveBeenCalled();
            expect(result?.map(song => song.id).sort()).toEqual(songs.map(song => song.id).sort());
            const saved = vi.mocked(saveLocalLibrarySnapshot).mock.calls.at(-1)?.[0] as LocalLibrarySnapshot;
            expect(flattenPaths(saved)).toEqual(flattenPaths(snapshot));
            expect(useStatusMessageStore.getState().message).toBeNull();
        });

        it('keeps the songs under an unreadable subfolder even when there is no earlier snapshot of it', async () => {
            const { songs } = await importOnce(twoDiscs());
            vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(null);
            setRootHandle(new FakeDirectoryHandle('Music', [
                new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Track 01.mp3')], 'library-root:disc-1'),
                unreadable(new FakeDirectoryHandle('Disc 2', [], 'library-root:disc-2')),
            ], 'library-root'));

            const result = await resyncFolder('Music');

            expect(deleteLocalSong).not.toHaveBeenCalled();
            expect(result?.map(song => song.id).sort()).toEqual(songs.map(song => song.id).sort());
        });

        it('keeps the song of a file that is listed but cannot be read, and reconciles its siblings', async () => {
            const { songs } = await importOnce(twoDiscs());
            const sibling = songs.find(song => song.filePath === 'Music/Disc 1/Track 01.mp3') as LocalSong;
            setRootHandle(new FakeDirectoryHandle('Music', [
                new FakeDirectoryHandle('Disc 1', [], 'library-root:disc-1'),
                new FakeDirectoryHandle('Disc 2', [unreadableFile('Track 02.mp3')], 'library-root:disc-2'),
            ], 'library-root'));

            const result = await resyncFolder('Music');

            expect(vi.mocked(deleteLocalSong).mock.calls.map(call => call[0])).toEqual([sibling.id]);
            expect(result?.map(song => song.filePath)).toEqual(['Music/Disc 2/Track 02.mp3']);
        });

        it('does not take a sibling folder with the same name prefix for the unreadable one', async () => {
            const discs = () => [
                new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Track 01.mp3')], 'r:disc-1'),
                new FakeDirectoryHandle('Disc 10', [new FakeFileHandle('Track 10.mp3')], 'r:disc-10'),
            ];
            const { songs } = await importOnce(new FakeDirectoryHandle('Music', discs(), 'library-root'));
            const inDisc10 = songs.find(song => song.filePath === 'Music/Disc 10/Track 10.mp3') as LocalSong;
            setRootHandle(new FakeDirectoryHandle('Music', [
                unreadable(new FakeDirectoryHandle('Disc 1', [], 'r:disc-1')),
                new FakeDirectoryHandle('Disc 10', [], 'r:disc-10'),
            ], 'library-root'));

            await resyncFolder('Music');

            expect(vi.mocked(deleteLocalSong).mock.calls.map(call => call[0])).toEqual([inDisc10.id]);
        });

        it('does not delete when a readable root yields no file at all while the library has songs for it', async () => {
            await importOnce(twoDiscs());
            setRootHandle(new FakeDirectoryHandle('Music', [], 'library-root'));

            const error = await resyncFolder('Music').catch((caught: unknown) => caught);

            expect(error).toMatchObject({ name: 'LocalFolderUnavailableError', reason: 'empty' });
            expect(deleteLocalSong).not.toHaveBeenCalled();
            expect(saveLocalLibrarySnapshot).not.toHaveBeenCalled();
            expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error' });
        });

        it('lets an empty result through when the folder carries .foliaignore rules', async () => {
            const { songs } = await importOnce(twoDiscs());
            setRootHandle(new FakeDirectoryHandle('Music', [
                new FakeFileHandle('.foliaignore', { content: 'Disc 1/\nDisc 2/\n', type: 'text/plain' }),
                new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Track 01.mp3')], 'library-root:disc-1'),
                new FakeDirectoryHandle('Disc 2', [new FakeFileHandle('Track 02.mp3')], 'library-root:disc-2'),
            ], 'library-root'));

            await resyncFolder('Music');

            expect(vi.mocked(deleteLocalSong).mock.calls.map(call => call[0]).sort()).toEqual(songs.map(song => song.id).sort());
        });

        it('still deletes the song of a file that is really gone, and drops it from the playlists', async () => {
            const { songs } = await importOnce(twoDiscs());
            const gone = songs.find(song => song.filePath === 'Music/Disc 2/Track 02.mp3') as LocalSong;
            setRootHandle(new FakeDirectoryHandle('Music', [
                new FakeDirectoryHandle('Disc 1', [new FakeFileHandle('Track 01.mp3')], 'library-root:disc-1'),
                new FakeDirectoryHandle('Disc 2', [], 'library-root:disc-2'),
            ], 'library-root'));

            const result = await resyncFolder('Music');

            expect(vi.mocked(deleteLocalSong).mock.calls.map(call => call[0])).toEqual([gone.id]);
            expect(removeDeletedLocalSongsFromFoliaPlaylists).toHaveBeenCalledWith([gone.id]);
            expect(result?.map(song => song.filePath)).toEqual(['Music/Disc 1/Track 01.mp3']);
            expect(saveLocalLibrarySnapshot).toHaveBeenCalledTimes(1);
        });

        it('rescans the other folders when one of them is unreadable, then reports that one', async () => {
            const other = new FakeDirectoryHandle('Other', [new FakeFileHandle('Song.mp3')], 'other-root');
            vi.mocked(getDirHandles).mockResolvedValue({
                Music: unreadable(twoDiscs()) as unknown as FileSystemDirectoryHandle,
                Other: other as unknown as FileSystemDirectoryHandle,
            });

            await expect(resyncAllFolders()).rejects.toMatchObject({ rootFolderName: 'Music', reason: 'unreadable' });

            expect(saveLocalLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({ rootFolderName: 'Other' }));
            expect(useStatusMessageStore.getState().message?.text).toContain('“Music”');
        });
    });
    // Electron 43.8.12 drops the folder handles earlier versions saved: every call on one then never settles.
    describe('folder access lost to a dropped handle', () => {
        const deadHandle = () => {
            const handle = createLibraryHandle('dead-root');
            handle.queryPermission = () => new Promise<PermissionState>(() => { });
            handle.isSameEntry = () => new Promise<boolean>(() => { });
            return handle;
        };

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('tells reachable, dead and missing roots apart without hanging', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue([
                createSong({ id: 'a', filePath: 'Music/Disc 1/Track 01.mp3' }),
                createSong({ id: 'b', filePath: 'Dead/x.mp3', folderName: 'Dead' }),
                createSong({ id: 'c', filePath: 'Dead/y.mp3', folderName: 'Dead' }),
                createSong({ id: 'd', filePath: 'Unsaved/z.mp3', folderName: 'Unsaved' }),
            ]);
            vi.mocked(getDirHandles).mockResolvedValue({
                Music: createLibraryHandle() as unknown as FileSystemDirectoryHandle,
                Dead: deadHandle() as unknown as FileSystemDirectoryHandle,
            });

            const probing = probeLocalRootAccess();
            await vi.advanceTimersByTimeAsync(3000);

            expect(await probing).toEqual(expect.arrayContaining([
                { rootFolderName: 'Music', songCount: 1, access: 'ok' },
                { rootFolderName: 'Dead', songCount: 2, access: 'dead' },
                { rootFolderName: 'Unsaved', songCount: 1, access: 'missing' },
            ]));
        });

        it('puts a picked folder back under the old root, keeping the song ids', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            const existing = createSong({ id: 'kept-id', fileSize: 1, matchedLyricsSongId: 'kept-lyric' });
            vi.mocked(getLocalSongs).mockResolvedValue([existing]);
            vi.mocked(getDirHandles).mockResolvedValue({ Music: deadHandle() as unknown as FileSystemDirectoryHandle });
            const picked = createLibraryHandle('picked');
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(picked);

            expect(await reauthorizeLocalRoot('Music')).toBe('restored');

            expect(saveDirHandles).toHaveBeenCalledWith({ Music: picked });
            expect(saveLocalSongs).toHaveBeenCalledWith([
                expect.objectContaining<Partial<LocalSong>>({ id: 'kept-id', matchedLyricsSongId: 'kept-lyric' }),
            ]);
            expect(deleteLocalSong).not.toHaveBeenCalled();
        });

        it('refuses a folder that holds none of the root songs, writing nothing', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue([createSong({ id: 'kept-id' })]);
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(
                new FakeDirectoryHandle('Other', [new FakeFileHandle('Elsewhere.mp3')]),
            );

            expect(await reauthorizeLocalRoot('Music')).toBe('mismatch');

            expect(saveDirHandles).not.toHaveBeenCalled();
            expect(saveLocalSongs).not.toHaveBeenCalled();
            expect(deleteLocalSong).not.toHaveBeenCalled();
        });

        // Four songs in four album folders; `present` says which of them the picked folder holds.
        const fourAlbums = (present: readonly number[], token = 'picked') => new FakeDirectoryHandle('Music', [0, 1, 2, 3]
            .filter(index => present.includes(index))
            .map(index => new FakeDirectoryHandle(`Album ${index}`, [new FakeFileHandle('Track.mp3')], `${token}:${index}`)), token);
        const fourAlbumSongs = () => [0, 1, 2, 3].map(index => createSong({
            id: `song-${index}`,
            filePath: `Music/Album ${index}/Track.mp3`,
            folderName: `Music/Album ${index}`,
            fileName: 'Track.mp3',
            fileSignature: `Music/Album ${index}/Track.mp3::5::1000`,
        }));

        it('refuses a folder holding fewer than half of the sampled songs', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue(fourAlbumSongs());
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(fourAlbums([0]));

            expect(await reauthorizeLocalRoot('Music')).toBe('mismatch');
            expect(saveDirHandles).not.toHaveBeenCalled();
        });

        it('accepts a folder holding half of them, which loses only the songs really gone', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue(fourAlbumSongs());
            const picked = fourAlbums([0, 1]);
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(picked);

            expect(await reauthorizeLocalRoot('Music')).toBe('restored');
            expect(saveDirHandles).toHaveBeenCalledWith({ Music: picked });
        });

        it('refuses a rescan that would remove most of the root even when the sample passed', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            // 72 songs sampled every third one (24): the picked folder holds exactly the sampled third, so the
            // sample passes while the rescan would remove the other 48.
            const songs = Array.from({ length: 72 }, (_, index) => createSong({
                id: `song-${index}`,
                fileName: `Track ${index}.mp3`,
                filePath: `Music/Track ${index}.mp3`,
                folderName: 'Music',
            }));
            vi.mocked(getLocalSongs).mockResolvedValue(songs);
            const picked = new FakeDirectoryHandle('Music', songs
                .filter((_, index) => index % 3 === 0)
                .map(song => new FakeFileHandle(song.fileName)), 'picked');
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(picked);

            expect(await reauthorizeLocalRoot('Music')).toBe('mismatch');
            expect(deleteLocalSong).not.toHaveBeenCalled();
            expect(deleteLocalSongs).not.toHaveBeenCalled();
            expect(saveDirHandles).not.toHaveBeenCalled();
        });

        it('puts a lost root back in place when its folder is imported again, instead of a copy', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue([createSong({ id: 'kept-id' })]);
            vi.mocked(getDirHandles).mockResolvedValue({});
            const picked = createLibraryHandle('picked');
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(picked);

            await importFolder();

            expect(saveDirHandles).toHaveBeenCalledWith({ Music: picked });
            expect(saveLocalSongs).toHaveBeenCalledWith([expect.objectContaining<Partial<LocalSong>>({ id: 'kept-id' })]);
        });

        it('imports a partial copy named like a lost root as a new root, deleting nothing', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue(fourAlbumSongs());
            vi.mocked(getDirHandles).mockResolvedValue({});
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(fourAlbums([0, 1, 2]));

            await importFolder();

            expect(saveDirHandles).toHaveBeenCalledWith(expect.objectContaining({ 'Music (2)': expect.anything() }));
            expect(deleteLocalSong).not.toHaveBeenCalled();
            expect(deleteLocalSongs).not.toHaveBeenCalled();
        });

        it('reports a folder whose new handle did not store as failed', async () => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue([createSong({ id: 'kept-id' })]);
            vi.mocked(saveDirHandles).mockResolvedValue(null);
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(createLibraryHandle('picked'));

            expect(await reauthorizeLocalRoot('Music')).toBe('failed');
        });

        it('says to click again when the picker refuses a click whose activation ran out', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            vi.mocked((window as any).showDirectoryPicker).mockRejectedValue(Object.assign(new Error('no activation'), { name: 'SecurityError' }));
            expect(await reauthorizeLocalRoot('Music')).toBe('retry');
        });

        it('takes a handle waiting for permission (the browser after a restart) for reachable', async () => {
            const handle = createLibraryHandle();
            handle.queryPermission = async () => 'prompt';
            vi.mocked(getLocalSongs).mockResolvedValue([createSong({ filePath: 'Browser/Track 01.mp3', folderName: 'Browser' })]);
            vi.mocked(getDirHandles).mockResolvedValue({ Browser: handle as unknown as FileSystemDirectoryHandle });
            expect(await probeLocalRootAccess()).toEqual([{ rootFolderName: 'Browser', songCount: 1, access: 'ok' }]);
        });

        it('returns cancelled when the picker is dismissed', async () => {
            vi.mocked((window as any).showDirectoryPicker).mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            expect(await reauthorizeLocalRoot('Music')).toBe('cancelled');
            expect(saveDirHandles).not.toHaveBeenCalled();
        });

        it('asks for the folder again when a rescan finds its saved handle dead', async () => {
            vi.useFakeTimers();
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            vi.mocked(getLocalSongs).mockResolvedValue([createSong({ id: 'kept-id' })]);
            vi.mocked(getDirHandles).mockResolvedValue({ Music: deadHandle() as unknown as FileSystemDirectoryHandle });
            const picked = createLibraryHandle('picked');
            vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(picked);

            const rescanning = resyncFolder('Music');
            await vi.advanceTimersByTimeAsync(3000);
            vi.useRealTimers();
            const songs = await rescanning;

            expect((window as any).showDirectoryPicker).toHaveBeenCalledTimes(1);
            expect(saveDirHandles).toHaveBeenCalledWith({ Music: picked });
            expect(songs?.map(song => song.id)).toEqual(['kept-id']);
        });
    });
});
