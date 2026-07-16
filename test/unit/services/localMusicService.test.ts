import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractMetadataFromFilename, importFolder, resyncAllFolders, resyncFolder } from '@/services/localMusicService';
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
import type { LocalLibrarySnapshot, LocalSong } from '@/types';

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

class FakeFileHandle {
    kind = 'file' as const;
    name: string;
    private readonly file: File;

    constructor(name: string, options: { content?: string; lastModified?: number; type?: string; } = {}) {
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

        vi.mocked(getLocalSongs).mockResolvedValue([]);
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(null);
        vi.mocked(getDirHandles).mockResolvedValue({});
        vi.mocked(saveDirHandles).mockResolvedValue(undefined);
        vi.mocked(saveLocalSongs).mockResolvedValue(undefined);
        vi.mocked(saveLocalLibrarySnapshot).mockResolvedValue(undefined);
        vi.mocked(getFromCache).mockResolvedValue([]);

        vi.stubGlobal('window', {
            showDirectoryPicker: vi.fn(),
            dispatchEvent: vi.fn(),
        });
        vi.stubGlobal('CustomEvent', class {
            constructor(public type: string, public init?: CustomEventInit) {}
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
});
