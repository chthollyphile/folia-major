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
import { useLyricSettingsStore } from '@/stores/useLyricSettingsStore';
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
        vi.mocked(deleteDirHandle).mockReset();
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
        vi.mocked(saveDirHandles).mockResolvedValue(undefined);
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
});
