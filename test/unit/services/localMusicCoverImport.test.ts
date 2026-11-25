import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_METADATA_VERSION, importFolder, resyncFolder } from '../../../src/services/localMusicService';
import {
    getDirHandles,
    getFromCache,
    getLocalLibrarySnapshot,
    getLocalSongs,
    saveDirHandles,
    saveLocalLibrarySnapshot,
    saveLocalSongs,
} from '../../../src/services/db';
import {
    prepareLocalCoverBlob,
} from '../../../src/services/localCoverAssetService';
import { parseEmbeddedMetadataAsync } from '../../../src/utils/localMetadataWorkerClient';
import type { LocalLibrarySnapshot, LocalSong } from '../../../src/types';

// test/unit/services/localMusicCoverImport.test.ts
// Verifies one-pass per-song cover hydration, folder-cover priority, and coverless retry behavior.

vi.mock('../../../src/services/db', () => ({
    deleteDirHandle: vi.fn(async () => true),
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

vi.mock('../../../src/services/coverCache', () => ({
    removeCachedCover: vi.fn(),
}));

vi.mock('../../../src/utils/localMetadataWorkerClient', () => ({
    parseEmbeddedMetadataAsync: vi.fn(),
}));

vi.mock('../../../src/services/localCoverAssetService', () => ({
    prepareLocalCoverBlob: vi.fn(),
    stageLocalCoverAsset: vi.fn(),
}));

class FakeFileHandle {
    kind = 'file' as const;
    private readonly file: File;

    constructor(public name: string, content = 'audio', type = 'audio/mpeg', lastModified = 1000) {
        this.file = new File([content], name, { type, lastModified });
    }

    async getFile() {
        return this.file;
    }
}

class FakeDirectoryHandle {
    kind = 'directory' as const;

    constructor(public name: string, private readonly entries: Array<FakeDirectoryHandle | FakeFileHandle>) {}

    async *values() {
        for (const entry of this.entries) yield entry;
    }

    async getDirectoryHandle(name: string) {
        const entry = this.entries.find(item => item.kind === 'directory' && item.name === name);
        if (!entry || entry.kind !== 'directory') throw new Error(`Missing directory ${name}`);
        return entry;
    }

    async getFileHandle(name: string) {
        const entry = this.entries.find(item => item.kind === 'file' && item.name === name);
        if (!entry || entry.kind !== 'file') throw new Error(`Missing file ${name}`);
        return entry;
    }

    async queryPermission() {
        return 'granted' as PermissionState;
    }

    async requestPermission() {
        return 'granted' as PermissionState;
    }
}

const createLibrary = (includeFolderCover = false) => new FakeDirectoryHandle('Music', [
    new FakeDirectoryHandle('Album', [
        new FakeFileHandle('01 First.mp3'),
        new FakeFileHandle('02 Second.mp3'),
        ...(includeFolderCover ? [new FakeFileHandle('cover.jpg', 'folder-cover', 'image/jpeg')] : []),
    ]),
]);

const waitForHydratedSave = async (expectedSongs: number) => {
    await vi.waitFor(() => {
        const hydratedBatch = vi.mocked(saveLocalSongs).mock.calls.find(([songs]) => (
            songs.length === expectedSongs && songs.every(song => song.embeddedMetadataVersion === EMBEDDED_METADATA_VERSION)
        ));
        expect(hydratedBatch).toBeTruthy();
    });
    return vi.mocked(saveLocalSongs).mock.calls.find(([songs]) => (
        songs.length === expectedSongs && songs.every(song => song.embeddedMetadataVersion === EMBEDDED_METADATA_VERSION)
    ))![0];
};

describe('local music cover import', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getLocalSongs).mockResolvedValue([]);
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(null);
        vi.mocked(getDirHandles).mockResolvedValue({});
        vi.mocked(getFromCache).mockResolvedValue([]);
        vi.mocked(saveDirHandles).mockImplementation(async handles => Object.keys(handles));
        vi.mocked(saveLocalSongs).mockResolvedValue(undefined);
        vi.mocked(saveLocalLibrarySnapshot).mockResolvedValue(undefined);
        vi.mocked(prepareLocalCoverBlob).mockResolvedValue(null);

        vi.stubGlobal('window', {
            electron: {},
            showDirectoryPicker: vi.fn(),
            dispatchEvent: vi.fn(),
        });
        vi.stubGlobal('CustomEvent', class {
            constructor(public type: string, public init?: CustomEventInit) {}
        });
    });

    it('parses each changed song once and retains distinct embedded asset ids within one album', async () => {
        const handle = createLibrary();
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(handle as unknown as FileSystemDirectoryHandle);
        vi.mocked(parseEmbeddedMetadataAsync).mockImplementation(async (file, includeCover) => ({
            title: file.name.startsWith('01') ? 'First' : 'Second',
            artist: 'Artist',
            album: 'Shared Album',
            duration: 1,
            cover: includeCover ? new Blob([file.name], { type: 'image/png' }) : undefined,
            coverAssetId: includeCover
                ? `sha256:${file.name.startsWith('01') ? '1'.repeat(64) : '2'.repeat(64)}`
                : undefined,
        }));

        await importFolder();
        const hydratedSongs = await waitForHydratedSave(2);

        expect(parseEmbeddedMetadataAsync).toHaveBeenCalledTimes(2);
        expect(vi.mocked(parseEmbeddedMetadataAsync).mock.calls.every(([, includeCover]) => includeCover === true)).toBe(true);
        expect(hydratedSongs.map(song => song.importedMetadata.albumName)).toEqual(['Shared Album', 'Shared Album']);
        expect(new Set(hydratedSongs.map(song => song.localCoverAssetId))).toEqual(new Set([
            `sha256:${'1'.repeat(64)}`,
            `sha256:${'2'.repeat(64)}`,
        ]));
        expect(hydratedSongs.every(song => song.localCoverAssetId?.startsWith('sha256:'))).toBe(true);
    });

    it('hashes a folder cover once and skips embedded images for every song in that folder', async () => {
        const handle = createLibrary(true);
        const folderAssetId = `sha256:${'f'.repeat(64)}`;
        const folderBlob = new Blob(['folder-cover'], { type: 'image/jpeg' });
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(handle as unknown as FileSystemDirectoryHandle);
        vi.mocked(prepareLocalCoverBlob).mockResolvedValue({ assetId: folderAssetId, blob: folderBlob });
        vi.mocked(parseEmbeddedMetadataAsync).mockResolvedValue({ duration: 1, album: 'Shared Album' });

        await importFolder();
        const hydratedSongs = await waitForHydratedSave(2);

        expect(prepareLocalCoverBlob).toHaveBeenCalledTimes(1);
        expect(parseEmbeddedMetadataAsync).toHaveBeenCalledTimes(2);
        expect(vi.mocked(parseEmbeddedMetadataAsync).mock.calls.every(([, includeCover]) => includeCover === false)).toBe(true);
        expect(hydratedSongs.every(song => (
            song.localCoverAssetId === folderAssetId
            && song.localCoverSource === 'folder'
        ))).toBe(true);
    });

    it('marks a folder cover for rescan when hashing does not produce an asset id', async () => {
        const handle = createLibrary(true);
        const folderBlob = new Blob(['folder-cover'], { type: 'image/jpeg' });
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(handle as unknown as FileSystemDirectoryHandle);
        vi.mocked(prepareLocalCoverBlob).mockResolvedValue({ blob: folderBlob });
        vi.mocked(parseEmbeddedMetadataAsync).mockResolvedValue({ duration: 1, album: 'Shared Album' });

        await importFolder();
        const hydratedSongs = await waitForHydratedSave(2);

        expect(prepareLocalCoverBlob).toHaveBeenCalledOnce();
        expect(hydratedSongs.every(song => (
            song.localCoverAssetId === undefined
            && song.localCoverSource === 'folder'
            && song.localCoverNeedsAssetMigration === true
        ))).toBe(true);
    });

    it('retries without covers when cover-aware parsing fails and still saves metadata', async () => {
        const handle = new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('Album', [new FakeFileHandle('01 Broken Cover.mp3')]),
        ]);
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(handle as unknown as FileSystemDirectoryHandle);
        vi.mocked(parseEmbeddedMetadataAsync).mockImplementation(async (_file, includeCover) => (
            includeCover
                ? null
                : { title: 'Recovered Metadata', artist: 'Artist', album: 'Album', duration: 1 }
        ));

        await importFolder();
        const [hydratedSong] = await waitForHydratedSave(1);

        expect(parseEmbeddedMetadataAsync).toHaveBeenCalledTimes(2);
        expect(vi.mocked(parseEmbeddedMetadataAsync).mock.calls.map(([, includeCover]) => includeCover)).toEqual([true, false]);
        expect(hydratedSong.importedMetadata).toMatchObject({
            title: 'Recovered Metadata',
            albumName: 'Album',
        });
        expect(hydratedSong.localCoverAssetId).toBeUndefined();
        expect(hydratedSong.localCoverNeedsAssetMigration).toBe(true);
    });

    it.each([
        { reason: 'pending cover migration', version: EMBEDDED_METADATA_VERSION, needsMigration: true },
        { reason: 'FLAC metadata parser upgrade', version: 5, needsMigration: undefined },
    ])('retries cover hydration for an unchanged song after $reason', async ({ version, needsMigration }) => {
        const fileName = '01 Retry Cover.flac';
        const handle = new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('Album', [new FakeFileHandle(fileName)]),
        ]);
        const existingSong: LocalSong = {
            id: 'retry-cover',
            fileName,
            filePath: `Music/Album/${fileName}`,
            folderName: 'Music/Album',
            title: 'Retry Cover',
            titleOrigin: 'import',
            importedMetadata: { title: 'Retry Cover', titleSource: 'filename', artistNames: [] },
            duration: 1,
            fileSize: 5,
            fileLastModified: 1000,
            fileSignature: `Music/Album/${fileName}::5::1000`,
            mimeType: 'audio/mpeg',
            addedAt: 1,
            embeddedMetadataVersion: version,
            localCoverNeedsAssetMigration: needsMigration,
        };
        const previousSnapshot: LocalLibrarySnapshot = {
            rootFolderName: 'Music',
            scannedAt: 1,
            tree: {
                name: 'Music',
                relativePath: 'Music',
                hash: 'old-root',
                files: [],
                children: [{
                    name: 'Album',
                    relativePath: 'Music/Album',
                    hash: 'old-album',
                    files: [{
                        name: fileName,
                        relativePath: existingSong.filePath,
                        kind: 'audio',
                        size: 5,
                        lastModified: 1000,
                        signature: existingSong.fileSignature!,
                    }],
                    children: [],
                }],
            },
        };
        const assetId = `sha256:${'7'.repeat(64)}`;
        vi.mocked(getDirHandles).mockResolvedValue({ Music: handle as unknown as FileSystemDirectoryHandle });
        vi.mocked(getLocalSongs).mockResolvedValue([existingSong]);
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(previousSnapshot);
        vi.mocked(parseEmbeddedMetadataAsync).mockResolvedValue({
            duration: 1,
            cover: new Blob(['retry-cover'], { type: 'image/png' }),
            coverAssetId: assetId,
        });

        await resyncFolder('Music');
        const [hydratedSong] = await waitForHydratedSave(1);

        expect(parseEmbeddedMetadataAsync).toHaveBeenCalledOnce();
        expect(hydratedSong.localCoverAssetId).toBe(assetId);
        expect(hydratedSong.localCoverNeedsAssetMigration).toBeUndefined();
        expect(hydratedSong.embeddedMetadataVersion).toBe(EMBEDDED_METADATA_VERSION);
    });

    it('re-parses embedded covers when a previously indexed folder cover is removed', async () => {
        const handle = createLibrary(false);
        const existingSongs: LocalSong[] = ['01 First.mp3', '02 Second.mp3'].map((fileName, index) => ({
            id: `existing-${index}`,
            fileName,
            filePath: `Music/Album/${fileName}`,
            folderName: 'Music/Album',
            title: fileName,
            titleOrigin: 'import',
            importedMetadata: { title: fileName, titleSource: 'filename', artistNames: [] },
            duration: 1,
            fileSize: 5,
            fileLastModified: 1000,
            fileSignature: `Music/Album/${fileName}::5::1000`,
            mimeType: 'audio/mpeg',
            addedAt: 1,
            embeddedMetadataVersion: EMBEDDED_METADATA_VERSION,
            localCoverAssetId: `sha256:${'a'.repeat(64)}`,
            localCoverSource: 'folder',
        }));
        const previousSnapshot: LocalLibrarySnapshot = {
            rootFolderName: 'Music',
            scannedAt: 1,
            tree: {
                name: 'Music',
                relativePath: 'Music',
                hash: 'old-root',
                files: [],
                children: [{
                    name: 'Album',
                    relativePath: 'Music/Album',
                    hash: 'old-album',
                    files: [
                        ...existingSongs.map(song => ({
                            name: song.fileName,
                            relativePath: song.filePath,
                            kind: 'audio' as const,
                            size: 5,
                            lastModified: 1000,
                            signature: song.fileSignature!,
                        })),
                        {
                            name: 'cover.jpg',
                            relativePath: 'Music/Album/cover.jpg',
                            kind: 'cover' as const,
                            size: 12,
                            lastModified: 1000,
                            signature: 'Music/Album/cover.jpg::12::1000',
                        },
                    ],
                    children: [],
                }],
            },
        };
        vi.mocked(getDirHandles).mockResolvedValue({ Music: handle as unknown as FileSystemDirectoryHandle });
        vi.mocked(getLocalSongs).mockResolvedValue(existingSongs);
        vi.mocked(getLocalLibrarySnapshot).mockResolvedValue(previousSnapshot);
        vi.mocked(parseEmbeddedMetadataAsync).mockImplementation(async (file, includeCover) => ({
            duration: 1,
            cover: includeCover ? new Blob([file.name], { type: 'image/png' }) : undefined,
            coverAssetId: includeCover ? `sha256:${file.name.startsWith('01') ? '4'.repeat(64) : '5'.repeat(64)}` : undefined,
        }));

        await resyncFolder('Music');
        const hydratedSongs = await waitForHydratedSave(2);

        expect(vi.mocked(parseEmbeddedMetadataAsync).mock.calls.every(([, includeCover]) => includeCover === true)).toBe(true);
        expect(hydratedSongs.every(song => song.localCoverSource === 'embedded')).toBe(true);
        expect(new Set(hydratedSongs.map(song => song.localCoverAssetId))).toEqual(new Set([
            `sha256:${'4'.repeat(64)}`,
            `sha256:${'5'.repeat(64)}`,
        ]));
    });

    it('applies backpressure while a hydration batch is being saved', async () => {
        const fileCount = 100;
        const handle = new FakeDirectoryHandle('Music', [
            new FakeDirectoryHandle('Album', Array.from({ length: fileCount }, (_, index) => (
                new FakeFileHandle(`${String(index + 1).padStart(3, '0')} Song.mp3`)
            ))),
        ]);
        let releaseFirstHydrationSave!: () => void;
        let notifyFirstHydrationSave!: () => void;
        const firstHydrationSaveStarted = new Promise<void>(resolve => { notifyFirstHydrationSave = resolve; });
        const firstHydrationSaveBlocked = new Promise<void>(resolve => { releaseFirstHydrationSave = resolve; });
        let blockedFirstHydrationSave = false;
        let hydratedSaveSongCount = 0;
        vi.mocked((window as any).showDirectoryPicker).mockResolvedValue(handle as unknown as FileSystemDirectoryHandle);
        vi.mocked(parseEmbeddedMetadataAsync).mockImplementation(async file => {
            const index = Number.parseInt(file.name, 10);
            return {
                duration: 1,
                cover: new Blob([file.name], { type: 'image/png' }),
                coverAssetId: `sha256:${index.toString(16).padStart(64, '0')}`,
            };
        });
        vi.mocked(saveLocalSongs).mockImplementation(async songs => {
            const isHydrationBatch = songs.some(song => song.embeddedMetadataVersion === EMBEDDED_METADATA_VERSION);
            if (isHydrationBatch) hydratedSaveSongCount += songs.length;
            if (isHydrationBatch && !blockedFirstHydrationSave) {
                blockedFirstHydrationSave = true;
                notifyFirstHydrationSave();
                await firstHydrationSaveBlocked;
            }
        });

        await importFolder();
        await firstHydrationSaveStarted;
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(vi.mocked(parseEmbeddedMetadataAsync).mock.calls.length).toBeLessThanOrEqual(55);
        releaseFirstHydrationSave();
        await vi.waitFor(() => expect(parseEmbeddedMetadataAsync).toHaveBeenCalledTimes(fileCount));
        await vi.waitFor(() => expect(hydratedSaveSongCount).toBe(fileCount));
    });
});
