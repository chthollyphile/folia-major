import { LocalSong, LyricData, LocalLibrarySnapshot, LocalLibrarySnapshotFile, LocalLibrarySnapshotNode, type SongResult } from '../types';
import { saveLocalSong, saveLocalSongs, deleteLocalSong as dbDeleteLocalSong, deleteLocalSongs as dbDeleteLocalSongs, saveDirHandles, getDirHandles, deleteDirHandle, getLocalSongs, getLocalLibrarySnapshot, saveLocalLibrarySnapshot, deleteLocalLibrarySnapshot } from './db';
import { neteaseApi } from './netease';
import { getLocalPlaylists, saveLocalPlaylists } from './localPlaylistService';
import { parseEmbeddedMetadataAsync, type EmbeddedMetadataResult } from '../utils/localMetadataWorkerClient';
import { processNeteaseLyrics } from '../utils/lyrics/neteaseProcessing';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { normalizeLyricMatchText } from '../utils/lyrics/matchScore';
import { createSafeObjectUrl, isBlob } from '../utils/blobGuards';
import { resolveExplicitFileTimedLyricFormat, type ExplicitFileTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { applyMatchedMetadata } from './localLibraryCatalogService';
import { buildLyricSearchQuery } from '../utils/lyrics/searchQuery';
import { buildLocalSongLyricMatchContext, shouldRefreshLocalSongLyricsFromMetadata } from '../utils/lyrics/localSongMatchContext';
import { buildImportedMetadataSnapshot } from '../utils/localSongMetadata';
import { getLocalLibraryCatalogSnapshot } from './localLibraryEntityRepository';
import { resolveLocalSongMetadata } from './playbackAdapters';


type EmbeddedMetadata = EmbeddedMetadataResult;

const EMBEDDED_METADATA_VERSION = 3;

interface ImportPreparationMetrics {
    getFileMs: number;
    lyricReadMs: number;
    coverReadMs: number;
    parseMetadataMs: number;
    durationFallbackMs: number;
    usedDurationFallback: boolean;
}

interface FileEntryForImport {
    handle: FileSystemFileHandle;
    folderName: string;
    relativePath: string;
}

interface LocalLyricFileCandidate {
    handle: FileSystemFileHandle;
    format?: ExplicitFileTimedLyricFormat;
}

interface SnapshotTraversalResult {
    tree: LocalLibrarySnapshotNode;
    relevantFileCount: number;
}

interface ImportDiffPlan {
    changedEntries: FileEntryForImport[];
    reusedSongs: LocalSong[];
    removedSongs: LocalSong[];
    totalAudioFiles: number;
    relevantFileCount: number;
    lrcMap: Map<string, LocalLyricFileCandidate>;
    tlrcMap: Map<string, FileSystemFileHandle>;
    coverMap: Map<string, FileSystemFileHandle>;
    snapshot: LocalLibrarySnapshot;
}

// In-memory storage for hot-path access. Persistent recovery uses directory handles from IndexedDB.
const fileHandleMap = new Map<string, FileSystemFileHandle>();
const embeddedCoverRequestMap = new Map<string, Promise<LocalSong>>();
const AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i;
const LYRIC_EXTENSIONS = /\.(lrc|vtt|ttml|qrc|yrc|krc)$/i;
const TRANSLATION_LYRIC_EXTENSIONS = /\.t\.(lrc|vtt)$/i;
const IMPORT_CONCURRENCY = 6;
const LOCAL_MUSIC_UPDATED_EVENT = 'folia-local-music-updated';
export const LOCAL_MUSIC_SCAN_PROGRESS_EVENT = 'folia-local-music-scan-progress';
const HYDRATION_BATCH_SIZE = 25;
const HYDRATION_REFRESH_EVERY = 100;
const SNAPSHOT_HASH_SEED = 2166136261;
const REIMPORT_HANDLE_MISSING_ERROR = 'Missing persisted directory handle for reimport';
const PREFERRED_FOLDER_COVER_FILES = ['cover.png', 'cover.jpg', 'cover.jpeg'];

interface LocalMusicScanProgressDetail {
    active: boolean;
    folderName: string;
    totalSongs: number;
    completedSongs: number;
}

function formatImportDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms.toFixed(1)}ms`;
    }

    return `${(ms / 1000).toFixed(2)}s`;
}

function notifyLocalMusicUpdated() {
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_UPDATED_EVENT));
}

async function removeDeletedSongIdsFromPlaylists(songIds: string[]): Promise<void> {
    if (songIds.length === 0) {
        return;
    }

    const removingIds = new Set(songIds);
    const playlists = await getLocalPlaylists();
    let changed = false;
    const nextPlaylists = playlists.map(playlist => {
        const nextSongIds = playlist.songIds.filter(songId => !removingIds.has(songId));
        if (nextSongIds.length === playlist.songIds.length) {
            return playlist;
        }

        changed = true;
        return {
            ...playlist,
            songIds: nextSongIds,
        };
    });

    if (changed) {
        await saveLocalPlaylists(nextPlaylists);
    }
}

function notifyLocalMusicScanProgress(detail: LocalMusicScanProgressDetail) {
    window.dispatchEvent(new CustomEvent(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, { detail }));
}

async function getImportDirectoryHandle(expectedRootName?: string): Promise<FileSystemDirectoryHandle | null> {
    if (expectedRootName) {
        const dirHandles = await getDirHandles();
        const persistedHandle = dirHandles[expectedRootName];

        if (!persistedHandle) {
            throw new Error(REIMPORT_HANDLE_MISSING_ERROR);
        }

        const permissionAwareHandle = persistedHandle as FileSystemDirectoryHandle & {
            queryPermission: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
            requestPermission: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
        };

        let permission = await permissionAwareHandle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') {
            permission = await permissionAwareHandle.requestPermission({ mode: 'read' });
        }

        if (permission !== 'granted') {
            return null;
        }

        return persistedHandle;
    }

    if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API not supported in this browser');
    }

    // @ts-ignore - showDirectoryPicker is not in all TypeScript definitions
    return await window.showDirectoryPicker();
}

async function findImportedRootForHandle(dirHandle: FileSystemDirectoryHandle): Promise<string | null> {
    const dirHandles = await getDirHandles();
    const selectedHandle = dirHandle as FileSystemDirectoryHandle & {
        isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
    };

    if (!selectedHandle.isSameEntry) {
        return null;
    }

    for (const [rootFolderName, persistedHandle] of Object.entries(dirHandles)) {
        try {
            if (await selectedHandle.isSameEntry(persistedHandle)) {
                return rootFolderName;
            }
        } catch (error) {
            console.warn(`[LocalMusic][Import] Failed to compare imported directory with "${rootFolderName}":`, error);
        }
    }

    return null;
}

// Generate UUID for local songs
function generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Extract basic metadata from filename.
// Expected format: "Artist - Title.mp3", "Artist-Title.mp3", or "Title.mp3".
export function extractMetadataFromFilename(fileName: string): { title?: string; artist?: string; } {
    // 去掉扩展名
    let nameWithoutExt = fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');

    // 去掉开头的cue切分产生的序号 "01. ", "01 - ", or "1-01 " 
    nameWithoutExt = nameWithoutExt.replace(/^\d{1,3}(?:[-.]\d{1,3})?(?:\s*[-.]\s*|\s+)/, '');

    // 分割艺术家和标题 - 尝试 " - " (带空格)
    let parts = nameWithoutExt.split(' - ');
    if (parts.length === 2) {
        return {
            artist: parts[0].trim(),
            title: parts[1].trim()
        };
    }

    // 尝试 "-" (不带空格) - 但要确保不是单词中间的连字符
    // 我们检查最后一个"-"是否可能是分隔符
    const lastDashIndex = nameWithoutExt.lastIndexOf('-');
    if (lastDashIndex > 0 && lastDashIndex < nameWithoutExt.length - 1) {
        const potentialTitle = nameWithoutExt.substring(0, lastDashIndex).trim();
        const potentialArtist = nameWithoutExt.substring(lastDashIndex + 1).trim();

        // 如果分割后的两部分都有内容，使用这个分割
        if (potentialTitle && potentialArtist) {
            return {
                artist: potentialArtist,
                title: potentialTitle
            };
        }
    }

    return {
        title: nameWithoutExt.trim()
    };
}

// Get audio duration from file
async function getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
        const audio = new Audio();
        const url = createSafeObjectUrl(file);
        if (!url) {
            resolve(0);
            return;
        }

        audio.addEventListener('loadedmetadata', () => {
            const duration = audio.duration * 1000; // Convert to milliseconds
            URL.revokeObjectURL(url);
            resolve(duration);
        });

        audio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            resolve(0); // Default duration on error
        });

        audio.src = url;
    });
}

function isAudioFile(file: File): boolean {
    return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

function isAudioFileName(fileName: string): boolean {
    return AUDIO_EXTENSIONS.test(fileName);
}

function getFolderCoverPriority(fileName: string): number {
    return PREFERRED_FOLDER_COVER_FILES.indexOf(fileName.toLowerCase());
}

function getTimedLyricPriority(fileName: string): number {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.t.lrc') || lowerName.endsWith('.lrc')) {
        return 0;
    }
    if (lowerName.endsWith('.t.vtt') || lowerName.endsWith('.vtt')) {
        return 1;
    }
    if (lowerName.endsWith('.ttml')) {
        return 2;
    }
    if (lowerName.endsWith('.qrc')) {
        return 3;
    }
    if (lowerName.endsWith('.yrc')) {
        return 4;
    }
    if (lowerName.endsWith('.krc')) {
        return 5;
    }
    return Number.MAX_SAFE_INTEGER;
}

function getParentRelativePath(relativePath: string): string {
    const lastSlashIndex = relativePath.lastIndexOf('/');
    return lastSlashIndex === -1 ? '' : relativePath.slice(0, lastSlashIndex);
}

function getAudioBasePath(relativePath: string): string {
    return relativePath.replace(AUDIO_EXTENSIONS, '');
}

function getSidecarLyricBasePath(relativePath: string, kind: 'lyric' | 'translationLyric'): string {
    const withoutLyricSuffix = kind === 'translationLyric'
        ? relativePath.replace(/\.t\.(lrc|vtt)$/i, '')
        : relativePath.replace(/\.(lrc|vtt|ttml|qrc|yrc|krc)$/i, '');

    // Support both "track.lrc" and "track.mp3.lrc" style sidecar lyrics.
    return getAudioBasePath(withoutLyricSuffix);
}

function getSnapshotFileKind(fileName: string): LocalLibrarySnapshotFile['kind'] {
    const lowerName = fileName.toLowerCase();
    if (TRANSLATION_LYRIC_EXTENSIONS.test(lowerName)) {
        return 'translationLyric';
    }
    if (LYRIC_EXTENSIONS.test(lowerName)) {
        return 'lyric';
    }
    if (getFolderCoverPriority(lowerName) !== -1) {
        return 'cover';
    }
    if (isAudioFileName(fileName)) {
        return 'audio';
    }
    return 'other';
}

function buildFileSignature(relativePath: string, size: number, lastModified: number): string {
    return `${relativePath}::${size}::${lastModified}`;
}

function hashString(input: string): string {
    let hash = SNAPSHOT_HASH_SEED;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashSnapshotNode(
    relativePath: string,
    files: LocalLibrarySnapshotFile[],
    children: LocalLibrarySnapshotNode[]
): string {
    const normalizedFiles = files
        .map(file => `${file.kind}:${file.relativePath}:${file.size}:${file.lastModified}`)
        .sort()
        .join('|');
    const normalizedChildren = children
        .map(child => `${child.relativePath}:${child.hash}`)
        .sort()
        .join('|');

    return hashString(`${relativePath}__${normalizedFiles}__${normalizedChildren}`);
}

function getDurationFromParsedMetadata(durationSeconds?: number): number {
    if (typeof durationSeconds !== 'number' || !isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    return Math.round(durationSeconds * 1000);
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) {
                return;
            }

            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    };

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

async function extractEmbeddedMetadata(file: File, includeCover = false): Promise<EmbeddedMetadata> {
    const parsed = await parseEmbeddedMetadataAsync(file, includeCover);
    if (!parsed) {
        throw new Error('Metadata worker returned null');
    }
    return parsed;
}

function getImportedAlbumKey(song: LocalSong): string | null {
    const albumName = song.importedMetadata.albumName;
    if (!albumName) {
        return null;
    }

    return `name-${albumName}`;
}

async function buildSnapshotTree(
    handle: FileSystemDirectoryHandle,
    currentPath: string
): Promise<SnapshotTraversalResult> {
    const files: LocalLibrarySnapshotFile[] = [];
    const children: LocalLibrarySnapshotNode[] = [];
    let relevantFileCount = 0;

    const childEntries: Array<FileSystemHandle> = [];

    try {
        // @ts-ignore
        for await (const entry of handle.values()) {
            childEntries.push(entry);
        }
    } catch (error) {
        console.warn(`[LocalMusic][Import] Skip unreadable directory "${currentPath}":`, error);

        return {
            tree: {
                name: handle.name,
                relativePath: currentPath,
                hash: hashSnapshotNode(currentPath, [], []),
                files: [],
                children: []
            },
            relevantFileCount: 0
        };
    }

    childEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of childEntries) {
        if (entry.kind === 'directory') {
            const childPath = `${currentPath}/${entry.name}`;

            try {
                const childResult = await buildSnapshotTree(entry as FileSystemDirectoryHandle, childPath);
                children.push(childResult.tree);
                relevantFileCount += childResult.relevantFileCount;
            } catch (error) {
                console.warn(`[LocalMusic][Import] Skip failed child directory "${childPath}":`, error);
            }

            continue;
        }

        const kind = getSnapshotFileKind(entry.name);
        if (kind === 'other') {
            continue;
        }

        const fileHandle = entry as FileSystemFileHandle;

        try {
            const file = await fileHandle.getFile();
            const relativePath = `${currentPath}/${file.name}`;
            const signature = buildFileSignature(relativePath, file.size, file.lastModified);

            files.push({
                name: file.name,
                relativePath,
                kind,
                size: file.size,
                lastModified: file.lastModified,
                signature
            });
            relevantFileCount += 1;
        } catch (error) {
            console.warn(`[LocalMusic][Import] Skip unreadable file "${currentPath}/${entry.name}":`, error);
        }
    }

    const tree: LocalLibrarySnapshotNode = {
        name: handle.name,
        relativePath: currentPath,
        hash: hashSnapshotNode(currentPath, files, children),
        files,
        children
    };

    return { tree, relevantFileCount };
}

function flattenSnapshotFiles(node: LocalLibrarySnapshotNode, target = new Map<string, LocalLibrarySnapshotFile>()) {
    node.files.forEach(file => {
        target.set(file.relativePath, file);
    });
    node.children.forEach(child => flattenSnapshotFiles(child, target));
    return target;
}

async function collectImportDiffPlan(
    rootFolderName: string,
    dirHandle: FileSystemDirectoryHandle,
    existingSongs: LocalSong[],
    previousSnapshot: LocalLibrarySnapshot | null
): Promise<ImportDiffPlan> {
    const traversalResult = await buildSnapshotTree(dirHandle, rootFolderName);
    const snapshot: LocalLibrarySnapshot = {
        rootFolderName,
        scannedAt: Date.now(),
        tree: traversalResult.tree
    };

    const currentFiles = flattenSnapshotFiles(snapshot.tree);
    const previousFiles = previousSnapshot ? flattenSnapshotFiles(previousSnapshot.tree) : new Map<string, LocalLibrarySnapshotFile>();
    const existingSongsByPath = new Map(existingSongs.map(song => [song.filePath, song]));
    const currentAudioPaths = new Set<string>();
    const changedAudioPaths = new Set<string>();
    const changedLyricBasePaths = new Set<string>();
    const changedCoverFolders = new Set<string>();
    const lyricCandidates = new Map<string, { handle: FileSystemFileHandle; priority: number; format?: ExplicitFileTimedLyricFormat; }>();
    const translationLyricCandidates = new Map<string, { handle: FileSystemFileHandle; priority: number; }>();
    const coverCandidates = new Map<string, { handle: FileSystemFileHandle; priority: number; }>();

    currentFiles.forEach((file) => {
        const previousFile = previousFiles.get(file.relativePath);
        const hasChanged = !previousFile || previousFile.signature !== file.signature || previousFile.kind !== file.kind;

        if (file.kind === 'audio') {
            currentAudioPaths.add(file.relativePath);
            if (hasChanged || !existingSongsByPath.has(file.relativePath)) {
                changedAudioPaths.add(file.relativePath);
            }
            return;
        }

        if (hasChanged && (file.kind === 'lyric' || file.kind === 'translationLyric')) {
            const basePath = getSidecarLyricBasePath(file.relativePath, file.kind);
            changedLyricBasePaths.add(basePath);
        }

        if (file.kind === 'cover' && hasChanged) {
            changedCoverFolders.add(getParentRelativePath(file.relativePath));
        }
    });

    const previousAudioPaths = Array.from(previousFiles.values())
        .filter(file => file.kind === 'audio')
        .map(file => file.relativePath);

    previousAudioPaths.forEach((relativePath) => {
        if (!currentAudioPaths.has(relativePath)) {
            const removedSong = existingSongsByPath.get(relativePath);
            if (removedSong) {
                existingSongsByPath.delete(relativePath);
            }
        }
    });

    changedLyricBasePaths.forEach(basePath => {
        const audioFile = Array.from(currentFiles.values()).find(file =>
            file.kind === 'audio' && getAudioBasePath(file.relativePath) === basePath
        );
        if (audioFile) {
            changedAudioPaths.add(audioFile.relativePath);
        }
    });

    previousFiles.forEach((file) => {
        if (file.kind === 'cover' && !currentFiles.has(file.relativePath)) {
            changedCoverFolders.add(getParentRelativePath(file.relativePath));
        }
    });

    changedCoverFolders.forEach(folderPath => {
        currentFiles.forEach(file => {
            if (file.kind === 'audio' && getParentRelativePath(file.relativePath) === folderPath) {
                changedAudioPaths.add(file.relativePath);
            }
        });
    });

    const changedEntries: FileEntryForImport[] = [];
    const reusedSongs: LocalSong[] = [];
    const removedSongs = existingSongs.filter(song => !currentAudioPaths.has(song.filePath));
    const allRelevantFiles = Array.from(currentFiles.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const snapshotFile of allRelevantFiles) {
        const pathSegments = snapshotFile.relativePath.split('/');
        const fileName = pathSegments[pathSegments.length - 1];
        const folderName = pathSegments.slice(0, -1).join('/');

        if (snapshotFile.kind === 'lyric' || snapshotFile.kind === 'translationLyric') {
            const relativePathFromRoot = snapshotFile.relativePath.startsWith(`${rootFolderName}/`)
                ? snapshotFile.relativePath.slice(rootFolderName.length + 1)
                : snapshotFile.relativePath;
            const fileHandle = await resolveFileHandleFromDirHandle(dirHandle, relativePathFromRoot);
            const baseName = getSidecarLyricBasePath(snapshotFile.relativePath, snapshotFile.kind);
            const priority = getTimedLyricPriority(snapshotFile.name);
            const format = resolveExplicitFileTimedLyricFormat(snapshotFile.name);

            if (snapshotFile.kind === 'translationLyric') {
                const existingTranslationLyric = translationLyricCandidates.get(baseName);
                if (!existingTranslationLyric || priority < existingTranslationLyric.priority) {
                    translationLyricCandidates.set(baseName, { handle: fileHandle, priority });
                }
            } else {
                const existingLyric = lyricCandidates.get(baseName);
                if (!existingLyric || priority < existingLyric.priority) {
                    lyricCandidates.set(baseName, { handle: fileHandle, priority, format });
                }
            }
            continue;
        }

        if (snapshotFile.kind === 'cover') {
            const relativePathFromRoot = snapshotFile.relativePath.startsWith(`${rootFolderName}/`)
                ? snapshotFile.relativePath.slice(rootFolderName.length + 1)
                : snapshotFile.relativePath;
            const fileHandle = await resolveFileHandleFromDirHandle(dirHandle, relativePathFromRoot);
            const folderKey = getParentRelativePath(snapshotFile.relativePath);
            const priority = getFolderCoverPriority(snapshotFile.name);
            const existingCover = coverCandidates.get(folderKey);

            if (!existingCover || priority < existingCover.priority) {
                coverCandidates.set(folderKey, { handle: fileHandle, priority });
            }
            continue;
        }

        if (snapshotFile.kind !== 'audio') {
            continue;
        }

        const relativePathFromRoot = snapshotFile.relativePath.startsWith(`${rootFolderName}/`)
            ? snapshotFile.relativePath.slice(rootFolderName.length + 1)
            : snapshotFile.relativePath;
        const fileHandle = await resolveFileHandleFromDirHandle(dirHandle, relativePathFromRoot);
        const existingSong = existingSongsByPath.get(snapshotFile.relativePath);

        if (
            changedAudioPaths.has(snapshotFile.relativePath)
            || !existingSong
            || existingSong.embeddedMetadataVersion !== EMBEDDED_METADATA_VERSION
        ) {
            changedEntries.push({
                handle: fileHandle,
                folderName,
                relativePath: snapshotFile.relativePath
            });
            continue;
        }

        fileHandleMap.set(existingSong.id, fileHandle);
        existingSong.fileHandle = fileHandle;
        existingSong.fileSize = snapshotFile.size;
        existingSong.fileLastModified = snapshotFile.lastModified;
        existingSong.fileSignature = snapshotFile.signature;
        reusedSongs.push(existingSong);
    }

    return {
        changedEntries,
        reusedSongs,
        removedSongs,
        totalAudioFiles: currentAudioPaths.size,
        relevantFileCount: traversalResult.relevantFileCount,
        lrcMap: new Map(Array.from(lyricCandidates.entries()).map(([baseName, value]) => [baseName, { handle: value.handle, format: value.format }])),
        tlrcMap: new Map(Array.from(translationLyricCandidates.entries()).map(([baseName, value]) => [baseName, value.handle])),
        coverMap: new Map(Array.from(coverCandidates.entries()).map(([folderKey, value]) => [folderKey, value.handle])),
        snapshot
    };
}

async function buildImportedSong(
    entry: FileEntryForImport,
    lrcMap: Map<string, LocalLyricFileCandidate>,
    tlrcMap: Map<string, FileSystemFileHandle>,
    coverMap: Map<string, FileSystemFileHandle>,
    coverBlobCache: Map<string, Promise<Blob | undefined>>,
    includeEmbeddedMetadata = true,
    existingSong?: LocalSong
): Promise<{ song: LocalSong | null; metrics: ImportPreparationMetrics; }> {
    const fileHandle = entry.handle;
    const getFileStartedAt = performance.now();
    const file = await fileHandle.getFile();
    const getFileMs = performance.now() - getFileStartedAt;

    if (!isAudioFile(file)) {
        return {
            song: null,
            metrics: {
                getFileMs,
                lyricReadMs: 0,
                coverReadMs: 0,
                parseMetadataMs: 0,
                durationFallbackMs: 0,
                usedDurationFallback: false
            }
        };
    }

    const metadata = extractMetadataFromFilename(file.name);
    const baseName = getAudioBasePath(entry.relativePath);

    let localLyricsContent: string | undefined;
    let localLyricsFormat: ExplicitFileTimedLyricFormat | undefined;
    let localTranslationLyricsContent: string | undefined;
    const lyricReadStartedAt = performance.now();

    if (lrcMap.has(baseName)) {
        try {
            const lyricCandidate = lrcMap.get(baseName)!;
            const lrcFile = await lyricCandidate.handle.getFile();
            localLyricsContent = await lrcFile.text();
            localLyricsFormat = lyricCandidate.format;
        } catch (e) {
            console.error(`[LocalMusic] Failed to read local lyric for ${file.name}`, e);
        }
    }

    if (tlrcMap.has(baseName)) {
        try {
            const tlrcFile = await tlrcMap.get(baseName)!.getFile();
            localTranslationLyricsContent = await tlrcFile.text();
        } catch (e) {
            console.error(`[LocalMusic] Failed to read local translation lyric for ${file.name}`, e);
        }
    }
    const lyricReadMs = performance.now() - lyricReadStartedAt;

    let folderCover: Blob | undefined;
    const coverReadStartedAt = performance.now();
    if (coverMap.has(entry.folderName)) {
        if (!coverBlobCache.has(entry.folderName)) {
            coverBlobCache.set(entry.folderName, (async () => {
                try {
                    const coverFile = await coverMap.get(entry.folderName)!.getFile();
                    return coverFile;
                } catch (error) {
                    console.warn(`[LocalMusic] Failed to read folder cover for ${entry.folderName}:`, error);
                    return undefined;
                }
            })());
        }
        folderCover = await coverBlobCache.get(entry.folderName)!;
    }
    const coverReadMs = performance.now() - coverReadStartedAt;

    let embeddedMetadata: EmbeddedMetadata = {};
    let parseMetadataMs = 0;
    if (includeEmbeddedMetadata) {
        const parseMetadataStartedAt = performance.now();

        try {
            embeddedMetadata = await extractEmbeddedMetadata(file, false);
        } catch (e) {
            console.warn(`[LocalMusic] Failed to parse metadata for ${file.name}:`, e);
        }
        parseMetadataMs = performance.now() - parseMetadataStartedAt;
    }

    let durationFallbackMs = 0;
    let usedDurationFallback = false;
    let duration = embeddedMetadata.duration || 0;
    if (includeEmbeddedMetadata && !duration) {
        usedDurationFallback = true;
        const durationFallbackStartedAt = performance.now();
        duration = await getAudioDuration(file);
        durationFallbackMs = performance.now() - durationFallbackStartedAt;
    }

    const songId = existingSong?.id || generateId();
    const importedMetadata = buildImportedMetadataSnapshot({
        fileName: file.name,
        embeddedTitle: embeddedMetadata.title,
        fallbackTitle: metadata.title,
        embeddedArtist: embeddedMetadata.artist,
        fallbackArtist: metadata.artist,
        embeddedAlbum: embeddedMetadata.album,
    });
    const titleOrigin = existingSong?.titleOrigin || 'import';
    const localSong: LocalSong = {
        ...existingSong,
        id: songId,
        fileName: file.name,
        filePath: entry.relativePath,
        duration,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        fileSignature: buildFileSignature(entry.relativePath, file.size, file.lastModified),
        mimeType: file.type,
        bitrate: embeddedMetadata.bitrate || 0,
        addedAt: existingSong?.addedAt || Date.now(),
        title: titleOrigin === 'import' ? importedMetadata.title : existingSong?.title || importedMetadata.title,
        titleOrigin,
        importedMetadata,
        onlineMetadata: existingSong?.onlineMetadata,
        trackNumber: embeddedMetadata.trackNumber,
        discNumber: embeddedMetadata.discNumber,
        embeddedCover: folderCover || embeddedMetadata.cover,
        hasManualLyricSelection: existingSong?.hasManualLyricSelection ?? false,
        folderName: entry.folderName,
        hasLocalLyrics: !!localLyricsContent,
        localLyricsContent,
        localLyricsFormat: localLyricsContent ? localLyricsFormat : undefined,
        hasLocalTranslationLyrics: !!localTranslationLyricsContent,
        localTranslationLyricsContent,
        hasEmbeddedLyrics: !!embeddedMetadata.lyrics,
        embeddedLyricsContent: embeddedMetadata.lyrics,
        hasEmbeddedTranslationLyrics: !!embeddedMetadata.translationLyrics,
        embeddedTranslationLyricsContent: embeddedMetadata.translationLyrics,
        replayGain: embeddedMetadata.replayGain,
        replayGainTrackGain: embeddedMetadata.replayGainTrackGain,
        replayGainTrackPeak: embeddedMetadata.replayGainTrackPeak,
        replayGainAlbumGain: embeddedMetadata.replayGainAlbumGain,
        replayGainAlbumPeak: embeddedMetadata.replayGainAlbumPeak,
        matchedLyrics: existingSong?.matchedLyrics,
        matchedIsPureMusic: existingSong?.matchedIsPureMusic,
        matchedLyricsSongId: existingSong?.matchedLyricsSongId,
        matchedLyricsSource: existingSong?.matchedLyricsSource,
        matchedLyricsProviderPlatform: existingSong?.matchedLyricsProviderPlatform,
        noAutoMatch: existingSong?.noAutoMatch,
        lyricsSource: existingSong?.lyricsSource,
        useOnlineCover: existingSong?.useOnlineCover,
    };

    fileHandleMap.set(songId, fileHandle);
    localSong.fileHandle = fileHandle;

    return {
        song: localSong,
        metrics: {
            getFileMs,
            lyricReadMs,
            coverReadMs,
            parseMetadataMs,
            durationFallbackMs,
            usedDurationFallback
        }
    };
}

async function hydrateSongMetadata(song: LocalSong): Promise<LocalSong> {
    const fileHandle = fileHandleMap.get(song.id) || song.fileHandle;
    if (!fileHandle) {
        return song;
    }

    try {
        const file = await fileHandle.getFile();
        const embeddedMetadata = await extractEmbeddedMetadata(file, false);

        song.duration = embeddedMetadata.duration || song.duration || 0;
        song.fileSize = file.size;
        song.mimeType = file.type;
        song.bitrate = embeddedMetadata.bitrate || song.bitrate || 0;
        const filenameMetadata = extractMetadataFromFilename(file.name);
        song.importedMetadata = buildImportedMetadataSnapshot({
            fileName: file.name,
            embeddedTitle: embeddedMetadata.title,
            fallbackTitle: filenameMetadata.title,
            embeddedArtist: embeddedMetadata.artist,
            fallbackArtist: filenameMetadata.artist,
            embeddedAlbum: embeddedMetadata.album,
        });
        if (song.titleOrigin === 'import') song.title = song.importedMetadata.title;
        song.trackNumber = embeddedMetadata.trackNumber;
        song.discNumber = embeddedMetadata.discNumber;
        song.embeddedMetadataVersion = EMBEDDED_METADATA_VERSION;
        song.hasEmbeddedLyrics = !!embeddedMetadata.lyrics;
        song.embeddedLyricsContent = embeddedMetadata.lyrics;
        song.hasEmbeddedTranslationLyrics = !!embeddedMetadata.translationLyrics;
        song.embeddedTranslationLyricsContent = embeddedMetadata.translationLyrics;
        song.replayGain = embeddedMetadata.replayGain;
        song.replayGainTrackGain = embeddedMetadata.replayGainTrackGain;
        song.replayGainTrackPeak = embeddedMetadata.replayGainTrackPeak;
        song.replayGainAlbumGain = embeddedMetadata.replayGainAlbumGain;
        song.replayGainAlbumPeak = embeddedMetadata.replayGainAlbumPeak;
    } catch (error) {
        console.warn(`[LocalMusic][Import] Failed to hydrate metadata for ${song.fileName}:`, error);
    }

    return song;
}

async function populateRepresentativeCovers(songs: LocalSong[]): Promise<void> {
    const folderGroups = new Map<string, LocalSong[]>();
    const albumGroups = new Map<string, LocalSong[]>();

    songs.forEach(song => {
        const existingFolderSongs = folderGroups.get(song.folderName || '') || [];
        existingFolderSongs.push(song);
        folderGroups.set(song.folderName || '', existingFolderSongs);

        const albumKey = getImportedAlbumKey(song);
        if (albumKey) {
            const existingAlbumSongs = albumGroups.get(albumKey) || [];
            existingAlbumSongs.push(song);
            albumGroups.set(albumKey, existingAlbumSongs);
        }
    });

    const coverExtractionCache = new Map<string, Promise<Blob | undefined>>();

    const tryLoadCover = async (song: LocalSong): Promise<Blob | undefined> => {
        if (isBlob(song.embeddedCover)) {
            return song.embeddedCover;
        }

        if (!coverExtractionCache.has(song.id)) {
            coverExtractionCache.set(song.id, (async () => {
                const fileHandle = fileHandleMap.get(song.id) || song.fileHandle;
                if (!fileHandle) {
                    return undefined;
                }

                try {
                    const file = await fileHandle.getFile();
                    const metadata = await extractEmbeddedMetadata(file, true);
                    return metadata.cover;
                } catch (error) {
                    console.warn(`[LocalMusic] Failed to extract cover for ${song.fileName}:`, error);
                    return undefined;
                }
            })());
        }

        return coverExtractionCache.get(song.id)!;
    };

    const ensureGroupCover = async (groupSongs: LocalSong[]) => {
        if (groupSongs.some(song => isBlob(song.embeddedCover))) {
            return;
        }

        const sortedSongs = [...groupSongs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        for (const song of sortedSongs) {
            const cover = await tryLoadCover(song);
            if (cover) {
                song.embeddedCover = cover;
                return;
            }
        }
    };

    await mapWithConcurrency(Array.from(folderGroups.values()), IMPORT_CONCURRENCY, ensureGroupCover);
    await mapWithConcurrency(Array.from(albumGroups.values()), IMPORT_CONCURRENCY, ensureGroupCover);
}

// Copies an album's representative imported cover to sibling tracks without fetching more artwork.
function propagateImportedAlbumCovers(songs: LocalSong[]): number {
    const albumGroups = new Map<string, LocalSong[]>();

    songs.forEach(song => {
        const albumKey = getImportedAlbumKey(song);
        if (!albumKey) {
            return;
        }

        const albumSongs = albumGroups.get(albumKey) || [];
        albumSongs.push(song);
        albumGroups.set(albumKey, albumSongs);
    });

    let propagatedCount = 0;
    albumGroups.forEach(groupSongs => {
        const representativeCover = [...groupSongs]
            .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
            .find(song => isBlob(song.embeddedCover))?.embeddedCover;

        if (!representativeCover) {
            return;
        }

        groupSongs.forEach(song => {
            if (!isBlob(song.embeddedCover)) {
                song.embeddedCover = representativeCover;
                propagatedCount += 1;
            }
        });
    });

    return propagatedCount;
}

async function populateRepresentativeCoversInBackground(rootFolderName: string, songs: LocalSong[]) {
    const coverStartedAt = performance.now();

    try {
        await populateRepresentativeCovers(songs);
        const propagatedCoverCount = propagateImportedAlbumCovers(songs);
        const songsWithEmbeddedCover = songs.filter(song => isBlob(song.embeddedCover)).length;
        await saveLocalSongs(songs.filter(song => isBlob(song.embeddedCover)));
        console.log(`[LocalMusic][Import] Background cover extraction for "${rootFolderName}" finished with ${songsWithEmbeddedCover}/${songs.length} songs carrying embedded covers, propagated to ${propagatedCoverCount} sibling tracks in ${formatImportDuration(performance.now() - coverStartedAt)}.`);
        notifyLocalMusicUpdated();
    } catch (error) {
        console.error(`[LocalMusic][Import] Background cover extraction failed for "${rootFolderName}":`, error);
    }
}

function getPriorityRepresentativeCoverCandidateIds(songs: LocalSong[]): Set<string> {
    const candidateIds = new Set<string>();
    const folderGroups = new Map<string, LocalSong[]>();
    const albumGroups = new Map<string, LocalSong[]>();

    songs.forEach(song => {
        const folderKey = song.folderName || '';
        const folderSongs = folderGroups.get(folderKey) || [];
        folderSongs.push(song);
        folderGroups.set(folderKey, folderSongs);

        const albumKey = getImportedAlbumKey(song);
        if (albumKey) {
            const albumSongs = albumGroups.get(albumKey) || [];
            albumSongs.push(song);
            albumGroups.set(albumKey, albumSongs);
        }
    });

    const collectGroupCandidate = (groupSongs: LocalSong[]) => {
        const sortedSongs = [...groupSongs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        const existingPreferredSong = sortedSongs.find(song => isBlob(song.embeddedCover) || song.onlineMetadata?.coverUrl);
        if (!existingPreferredSong && sortedSongs[0]) {
            candidateIds.add(sortedSongs[0].id);
        }
    };

    folderGroups.forEach(collectGroupCandidate);
    albumGroups.forEach(collectGroupCandidate);

    return candidateIds;
}

async function hydrateImportedSongsInBackground(rootFolderName: string, songs: LocalSong[]) {
    const hydrationStartedAt = performance.now();
    const pendingBatch: LocalSong[] = [];
    let savedCount = 0;
    let nextIndex = 0;
    let flushInFlight: Promise<void> | null = null;
    const priorityCoverCandidateIds = getPriorityRepresentativeCoverCandidateIds(songs);

    notifyLocalMusicScanProgress({
        active: true,
        folderName: rootFolderName,
        totalSongs: songs.length,
        completedSongs: 0
    });

    const flushBatch = async (forceNotify = false) => {
        if (pendingBatch.length === 0) {
            return;
        }

        const batch = pendingBatch.splice(0, pendingBatch.length);
        const previousFlush = flushInFlight;
        const currentFlush = (async () => {
            if (previousFlush) {
                await previousFlush;
            }
            await saveLocalSongs(batch);
            savedCount += batch.length;
            if (forceNotify || savedCount % HYDRATION_REFRESH_EVERY === 0 || savedCount === songs.length) {
                notifyLocalMusicUpdated();
            }
            notifyLocalMusicScanProgress({
                active: true,
                folderName: rootFolderName,
                totalSongs: songs.length,
                completedSongs: savedCount
            });
            console.log(`[LocalMusic][Import] Background metadata hydration saved ${savedCount}/${songs.length} songs for "${rootFolderName}".`);
        })();
        flushInFlight = currentFlush;
        await currentFlush;
        if (flushInFlight === currentFlush) {
            flushInFlight = null;
        }
    };

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= songs.length) {
                return;
            }

            let hydratedSong = await hydrateSongMetadata(songs[currentIndex]);
            let resolvedCover = false;

            if (priorityCoverCandidateIds.has(hydratedSong.id)) {
                priorityCoverCandidateIds.delete(hydratedSong.id);
                if (!isBlob(hydratedSong.embeddedCover)) {
                    hydratedSong = await ensureLocalSongEmbeddedCover(hydratedSong);
                    resolvedCover = isBlob(hydratedSong.embeddedCover);
                }
            }

            pendingBatch.push(hydratedSong);

            if ((pendingBatch.length >= HYDRATION_BATCH_SIZE || resolvedCover) && !flushInFlight) {
                void flushBatch();
            }
        }
    };

    const workerCount = Math.min(IMPORT_CONCURRENCY, songs.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await flushBatch(true);
    if (flushInFlight) {
        await flushInFlight;
    }

    notifyLocalMusicScanProgress({
        active: false,
        folderName: rootFolderName,
        totalSongs: songs.length,
        completedSongs: songs.length
    });
    console.log(`[LocalMusic][Import] Background metadata hydration for "${rootFolderName}" finished in ${formatImportDuration(performance.now() - hydrationStartedAt)}.`);
}


// Import folder using File System Access API (if supported)
export async function importFolder(expectedRootName?: string): Promise<LocalSong[]> {
    try {
        const dirHandle = await getImportDirectoryHandle(expectedRootName);
        if (!dirHandle) {
            return [];
        }
        const importStartedAt = performance.now();

        let rootFolderName = expectedRootName || dirHandle.name;
        let isRescanningExistingRoot = Boolean(expectedRootName);

        // If the picked directory is already imported, rescan the existing root instead of duplicating it.
        if (!expectedRootName) {
            const existingRootName = await findImportedRootForHandle(dirHandle);
            if (existingRootName) {
                rootFolderName = existingRootName;
                isRescanningExistingRoot = true;
                console.log(`[LocalMusic][Import] Directory "${dirHandle.name}" already imported as "${rootFolderName}", rescanning existing root.`);
            }
        }

        // If it's a new import (no expectedRootName), ensure the root folder name is unique
        if (!expectedRootName && !isRescanningExistingRoot) {
            const allSongs = await getLocalSongs();

            // Collect existing root folder names (the part before the first '/')
            const existingRootFolders = new Set(
                allSongs
                    .map(s => s.folderName)
                    .filter(Boolean)
                    .map(name => name!.split('/')[0])
            );

            let originalRootName = rootFolderName;
            let counter = 1;
            while (existingRootFolders.has(rootFolderName)) {
                counter++;
                rootFolderName = `${originalRootName} (${counter})`;
            }
        }

        const traversalStartedAt = performance.now();
        const allSongs = await getLocalSongs();
        const existingRootSongs = allSongs.filter(song =>
            song.folderName === rootFolderName || (song.folderName && song.folderName.startsWith(`${rootFolderName}/`))
        );
        const previousSnapshot = await getLocalLibrarySnapshot(rootFolderName);
        const diffPlan = await collectImportDiffPlan(rootFolderName, dirHandle, existingRootSongs, previousSnapshot);
        console.log(`[LocalMusic][Import] Traversed ${diffPlan.relevantFileCount} relevant files in ${formatImportDuration(performance.now() - traversalStartedAt)}.`);

        // Save directory handle for persistence after a successful scan plan is built
        try {
            const { getDirHandles, saveDirHandles } = await import('./db');
            const dirHandles = await getDirHandles();
            dirHandles[rootFolderName] = dirHandle;
            await saveDirHandles(dirHandles);
            console.log(`[LocalMusic] Saved directory handle for ${rootFolderName}`);
        } catch (e) {
            console.error('[LocalMusic] Failed to save directory handle:', e);
        }

        const lyricIndexStartedAt = performance.now();
        console.log(`[LocalMusic][Import] Indexed ${diffPlan.lrcMap.size} lyric files, ${diffPlan.tlrcMap.size} translated lyric files, and ${diffPlan.coverMap.size} folder cover files in ${formatImportDuration(performance.now() - lyricIndexStartedAt)}.`);
        console.log(`[LocalMusic][Import] Snapshot diff for "${rootFolderName}": ${diffPlan.changedEntries.length} changed/new audio files, ${diffPlan.reusedSongs.length} unchanged audio files, ${diffPlan.removedSongs.length} removed audio files.`);

        // Second pass: Process audio files with limited concurrency
        const metadataStartedAt = performance.now();
        const existingSongsByPath = new Map(existingRootSongs.map(song => [song.filePath, song]));
        const coverBlobCache = new Map<string, Promise<Blob | undefined>>();
        const processedSongs = await mapWithConcurrency(diffPlan.changedEntries, IMPORT_CONCURRENCY, async (entry) => {
            try {
                return await buildImportedSong(
                    entry,
                    diffPlan.lrcMap,
                    diffPlan.tlrcMap,
                    diffPlan.coverMap,
                    coverBlobCache,
                    false,
                    existingSongsByPath.get(entry.relativePath)
                );
            } catch (error) {
                console.error(`Failed to import file ${entry.relativePath}:`, error);
                return {
                    song: null,
                    metrics: {
                        getFileMs: 0,
                        lyricReadMs: 0,
                        coverReadMs: 0,
                        parseMetadataMs: 0,
                        durationFallbackMs: 0,
                        usedDurationFallback: false
                    }
                };
            }
        });

        const songsToPersist = processedSongs
            .map(result => result.song)
            .filter((song): song is LocalSong => song !== null);
        const aggregateMetrics = processedSongs.reduce((acc, result) => {
            acc.getFileMs += result.metrics.getFileMs;
            acc.lyricReadMs += result.metrics.lyricReadMs;
            acc.coverReadMs += result.metrics.coverReadMs;
            acc.parseMetadataMs += result.metrics.parseMetadataMs;
            acc.durationFallbackMs += result.metrics.durationFallbackMs;
            acc.durationFallbackCount += result.metrics.usedDurationFallback ? 1 : 0;
            return acc;
        }, {
            getFileMs: 0,
            lyricReadMs: 0,
            coverReadMs: 0,
            parseMetadataMs: 0,
            durationFallbackMs: 0,
            durationFallbackCount: 0
        });
        console.log(`[LocalMusic][Import] Prepared ${songsToPersist.length} changed audio files with concurrency=${IMPORT_CONCURRENCY} in ${formatImportDuration(performance.now() - metadataStartedAt)}.`);
        console.log(
            `[LocalMusic][Import] Preparation breakdown: getFile=${formatImportDuration(aggregateMetrics.getFileMs)}, ` +
            `lyrics=${formatImportDuration(aggregateMetrics.lyricReadMs)}, ` +
            `folderCover=${formatImportDuration(aggregateMetrics.coverReadMs)}, ` +
            `parseBlob=${formatImportDuration(aggregateMetrics.parseMetadataMs)}, ` +
            `durationFallback=${formatImportDuration(aggregateMetrics.durationFallbackMs)} ` +
            `(${aggregateMetrics.durationFallbackCount} files).`
        );

        if (diffPlan.removedSongs.length > 0) {
            for (const song of diffPlan.removedSongs) {
                fileHandleMap.delete(song.id);
                await dbDeleteLocalSong(song.id);
            }
        }

        const importedSongs = [...diffPlan.reusedSongs];
        try {
            const persistStartedAt = performance.now();
            await saveLocalSongs(songsToPersist);
            await saveLocalLibrarySnapshot(diffPlan.snapshot);
            console.log(`[LocalMusic][Import] Persisted ${songsToPersist.length} changed songs in ${formatImportDuration(performance.now() - persistStartedAt)}.`);
            importedSongs.push(...songsToPersist);
        } catch (saveError) {
            console.error('Failed to save imported songs:', saveError);
            songsToPersist.forEach(song => fileHandleMap.delete(song.id));
        }

        console.log(`[LocalMusic][Import] Finished importing "${rootFolderName}" with ${importedSongs.length}/${diffPlan.totalAudioFiles} available songs in ${formatImportDuration(performance.now() - importStartedAt)}.`);
        notifyLocalMusicUpdated();
        void hydrateImportedSongsInBackground(rootFolderName, songsToPersist).then(() =>
            populateRepresentativeCoversInBackground(rootFolderName, songsToPersist)
        );

        return importedSongs;
    } catch (error) {
        if ((error as Error).name === 'AbortError') {
            // User cancelled the picker
            return [];
        }
        throw error;
    }
}

// Helper function to normalize title for comparison
function normalizeTitle(title: string): string {
    return normalizeLyricMatchText(title).replace(/\s+/g, '');
}

// Helper function to check if two titles match
function isTitleMatch(localTitle: string, searchTitle: string): boolean {
    const normalizedLocal = normalizeTitle(localTitle);
    const normalizedSearch = normalizeTitle(searchTitle);

    // Check for exact match first
    if (normalizedLocal === normalizedSearch) {
        return true;
    }

    // Check if either title contains the other (for fuzzy matching)
    // This helps when local file is "Title-Artist" but search result is just "Title"
    if (normalizedLocal.includes(normalizedSearch) || normalizedSearch.includes(normalizedLocal)) {
        // Additional check: the shorter one should be at least 50% of the longer one
        // to avoid matching "a" with "abc"
        const minLength = Math.min(normalizedLocal.length, normalizedSearch.length);
        const maxLength = Math.max(normalizedLocal.length, normalizedSearch.length);
        if (minLength / maxLength >= 0.5) {
            return true;
        }
    }

    return false;
}

// Match lyrics for a local song using search API
// If the song has local lyrics, this function will only fetch cover/metadata and skip online lyrics
export async function matchLyrics(song: LocalSong): Promise<LyricData | null> {
    if (song.matchedIsPureMusic && !shouldRefreshLocalSongLyricsFromMetadata(song)) {
        return null;
    }
    try {
        const catalog = await getLocalLibraryCatalogSnapshot();
        const resolvedMetadata = resolveLocalSongMetadata(song.id, catalog);
        const matchContext = buildLocalSongLyricMatchContext(song, {
            artistNames: resolvedMetadata.artists.map(artist => artist.name),
            albumName: resolvedMetadata.album?.name,
        });
        const searchQuery = buildLyricSearchQuery(matchContext.title, matchContext.artist, matchContext.album);
        const hasLocalOrEmbeddedLyrics = Boolean(
            (song.hasLocalLyrics && song.localLyricsContent)
            || (song.hasEmbeddedLyrics && song.embeddedLyricsContent)
        );

        console.log(`[LocalMusic] Searching lyrics for: "${searchQuery}"`);

        // A selected GridView metadata identity is authoritative and must not be replaced by lyric fallback metadata.
        if (!hasLocalOrEmbeddedLyrics) {
            const settings = useSettingsUiStore.getState();
            const shouldUseBestLyric = settings.enableAlternativeLyricSources && settings.autoUseBestLyric;
            if (shouldUseBestLyric || matchContext.metadataCandidate) {
                const bestMatch = await autoMatchBestLyric(
                    matchContext.title,
                    matchContext.artist,
                    matchContext.durationMs,
                    {
                        album: matchContext.album,
                        preferredSource: shouldUseBestLyric ? settings.preferredAlternativeLyricSource : undefined,
                        metadataCandidate: matchContext.metadataCandidate,
                        exactMatchOnly: Boolean(matchContext.metadataCandidate && !shouldUseBestLyric),
                    },
                );

                if (bestMatch && 'isPureMusic' in bestMatch) {
                    song.matchedIsPureMusic = true;
                    song.matchedLyrics = undefined;
                    song.matchedLyricsSongId = bestMatch.id ?? matchContext.metadataCandidate?.songId;
                    song.matchedLyricsSource = bestMatch.source ?? matchContext.metadataCandidate?.source;
                    await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song });
                    return null;
                }

                if (bestMatch && 'lyrics' in bestMatch) {
                    song.matchedLyricsSongId = bestMatch.id;
                    song.matchedLyricsSource = bestMatch.source;
                    song.matchedLyricsProviderPlatform = bestMatch.matchedLyricsProviderPlatform;
                    song.matchedLyrics = bestMatch.lyrics;
                    song.matchedIsPureMusic = false;

                    if (matchContext.metadataCandidate) {
                        await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song });
                        return bestMatch.lyrics;
                    }

                    if (bestMatch.source === 'netease' || (bestMatch.source === 'amll' && bestMatch.matchedLyricsProviderPlatform === 'ncm')) {
                        try {
                            const detailRes = await neteaseApi.getSongDetail(bestMatch.id as number);
                            const nSong = detailRes.songs?.[0];
                            if (nSong) {
                                const coverUrl = nSong.al?.picUrl || nSong.album?.picUrl;
                                await applyMatchedMetadata(song.id, {
                                    source: 'netease',
                                    songId: bestMatch.id,
                                    title: nSong.name,
                                    artists: nSong.ar || nSong.artists,
                                    album: nSong.al || nSong.album,
                                    coverUrl: coverUrl?.replace('http:', 'https:'),
                                }, {
                                    songPatch: {
                                        ...song,
                                        useOnlineCover: Boolean(coverUrl && !isBlob(song.embeddedCover)),
                                    },
                                    protectOrigins: ['manual', 'manual-match', 'split'],
                                });
                                return bestMatch.lyrics;
                            }
                        } catch (error) {
                            console.error('[LocalMusic] Failed to fetch NetEase song detail for metadata:', error);
                        }
                    }
                    await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song });
                    return bestMatch.lyrics;
                }
            }
        } else if (matchContext.metadataCandidate) {
            return null;
        }

        // Search on Netease
        const searchRes = await neteaseApi.cloudSearch(searchQuery);

        if (!searchRes.result?.songs || searchRes.result.songs.length === 0) {
            console.warn(`[LocalMusic] No search results for: "${searchQuery}"`);
            return null;
        }

        // Try to find a song with matching title
        const localTitle = matchContext.title;
        const matchedSong = (searchRes.result.songs as SongResult[]).find(candidate => isTitleMatch(localTitle, candidate.name));

        // If no exact title match found, return null to trigger manual selection
        if (!matchedSong) {
            console.log(`[LocalMusic] No exact title match found for: "${localTitle}". Manual selection required.`);
            return null;
        }

        console.log(`[LocalMusic] Found exact title match: ${matchedSong.name} by ${matchedSong.ar?.map(a => a.name).join(', ')}`);

        // Check if we should skip lyrics fetching (local or embedded lyrics take priority)
        if ((song.hasLocalLyrics && song.localLyricsContent) || (song.hasEmbeddedLyrics && song.embeddedLyricsContent)) {
            console.log(`[LocalMusic] Local/embedded lyrics exist, skipping online lyrics fetch. Only fetching cover/metadata.`);

            // Only update metadata and cover, preserve local lyrics
            const coverUrl = matchedSong.al?.picUrl || matchedSong.album?.picUrl;
            await applyMatchedMetadata(song.id, {
                source: 'netease',
                songId: matchedSong.id,
                title: matchedSong.name,
                artists: matchedSong.ar || matchedSong.artists,
                album: matchedSong.al || matchedSong.album,
                coverUrl: coverUrl?.replace('http:', 'https:'),
            }, {
                songPatch: { ...song, useOnlineCover: Boolean(coverUrl && !isBlob(song.embeddedCover)) },
                protectOrigins: ['manual', 'manual-match', 'split'],
            });

            // Return null to indicate no NEW lyrics were fetched (local lyrics are used)
            return null;
        }

        // Fetch lyrics (only when NO local lyrics)
        const lyricRes = await neteaseApi.getLyric(matchedSong.id);
        const processed = await processNeteaseLyrics(
            {
                type: 'netease',
                ...lyricRes
            },
            { songId: matchedSong.id }
        );

        song.matchedLyricsSongId = matchedSong.id;
        song.matchedLyricsSource = 'netease';
        song.matchedLyrics = processed.lyrics || undefined;
        song.matchedIsPureMusic = processed.isPureMusic;

        if (matchContext.metadataCandidate) {
            await applyMatchedMetadata(song.id, {}, { lyricsOnly: true, songPatch: song });
            return processed.lyrics;
        }

        const coverUrl = matchedSong.al?.picUrl || matchedSong.album?.picUrl;
        await applyMatchedMetadata(song.id, {
            source: 'netease',
            songId: matchedSong.id,
            title: matchedSong.name,
            artists: matchedSong.ar || matchedSong.artists,
            album: matchedSong.al || matchedSong.album,
            coverUrl: coverUrl?.replace('http:', 'https:'),
        }, {
            songPatch: { ...song, useOnlineCover: Boolean(coverUrl && !isBlob(song.embeddedCover)) },
            protectOrigins: ['manual', 'manual-match', 'split'],
        });
        return processed.lyrics;
    } catch (error) {
        console.error('[LocalMusic] Failed to match lyrics:', error);
        return null;
    }
}

// Delete local song
export async function deleteLocalSong(id: string): Promise<void> {
    // Remove fileHandle from memory
    fileHandleMap.delete(id);
    await dbDeleteLocalSong(id);
}

function getRootFolderName(song: LocalSong): string | null {
    const pathLike = song.filePath || song.folderName;
    if (!pathLike) return null;

    const [rootFolderName] = pathLike.split('/');
    return rootFolderName || null;
}

async function resolveFileHandleFromDirHandle(
    dirHandle: FileSystemDirectoryHandle,
    relativePathFromRoot: string
): Promise<FileSystemFileHandle> {
    const pathSegments = relativePathFromRoot.split('/').filter(Boolean);
    if (pathSegments.length === 0) {
        throw new Error('Cannot resolve a file handle from an empty path.');
    }

    const fileName = pathSegments[pathSegments.length - 1];
    const directorySegments = pathSegments.slice(0, -1);

    let currentDir = dirHandle;
    for (const segment of directorySegments) {
        currentDir = await currentDir.getDirectoryHandle(segment);
    }

    return await currentDir.getFileHandle(fileName);
}

async function recoverFileHandleFromPersistedDirectory(song: LocalSong): Promise<FileSystemFileHandle | null> {
    const rootFolderName = getRootFolderName(song);
    if (!rootFolderName || !song.filePath) {
        return null;
    }

    const dirHandles = await getDirHandles();
    const rootDirHandle = dirHandles[rootFolderName];
    if (!rootDirHandle) {
        return null;
    }

    const permissionAwareHandle = rootDirHandle as FileSystemDirectoryHandle & {
        queryPermission: (descriptor: { mode: 'read' | 'readwrite'; }) => Promise<PermissionState>;
    };
    const permission = await permissionAwareHandle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') {
        return null;
    }

    const relativePathFromRoot = song.filePath.startsWith(`${rootFolderName}/`)
        ? song.filePath.slice(rootFolderName.length + 1)
        : song.filePath;

    try {
        const recoveredHandle = await resolveFileHandleFromDirHandle(rootDirHandle, relativePathFromRoot);
        fileHandleMap.set(song.id, recoveredHandle);
        song.fileHandle = recoveredHandle;
        await saveLocalSong(song);
        return recoveredHandle;
    } catch (error) {
        console.warn(`[LocalMusic] Failed to recover file handle for ${song.filePath}:`, error);
        return null;
    }
}

async function getAccessibleFileHandle(song: LocalSong): Promise<FileSystemFileHandle | null> {
    let fileHandle = fileHandleMap.get(song.id);

    if (!fileHandle && song.fileHandle) {
        fileHandle = song.fileHandle;
        fileHandleMap.set(song.id, fileHandle);
    }

    if (fileHandle) {
        return fileHandle;
    }

    return await recoverFileHandleFromPersistedDirectory(song);
}

async function cleanupDirHandleIfUnused(rootFolderName: string): Promise<void> {
    const allSongs = await getLocalSongs();
    const stillUsed = allSongs.some(song => {
        const songRoot = getRootFolderName(song);
        return songRoot === rootFolderName;
    });

    if (!stillUsed) {
        await deleteDirHandle(rootFolderName);
        await deleteLocalLibrarySnapshot(rootFolderName);
        console.log(`[LocalMusic] Removed persisted directory handle for ${rootFolderName}`);
    }
}

// Get audio blob from local song using fileHandle
// Returns blob URL if fileHandle exists, null otherwise
export async function getAudioFromLocalSong(song: LocalSong): Promise<string | null> {
    const fileHandle = await getAccessibleFileHandle(song);

    if (fileHandle) {
        try {
            const file = await fileHandle.getFile();
            return createSafeObjectUrl(file);
        } catch (error) {
            console.error('[LocalMusic] Failed to get file from handle:', error);
            // File may have been moved or the stored handle may have become stale.
            fileHandleMap.delete(song.id);
        }
    }

    const recoveredHandle = await recoverFileHandleFromPersistedDirectory(song);
    if (recoveredHandle) {
        try {
            const file = await recoveredHandle.getFile();
            return createSafeObjectUrl(file);
        } catch (error) {
            console.error('[LocalMusic] Failed to get file from recovered directory handle:', error);
            fileHandleMap.delete(song.id);
        }
    }

    // No accessible handle available - permission may need to be restored or the file moved.
    console.warn(`[LocalMusic] No accessible handle for song ${song.id}. Permission restore or re-import is required.`);
    return null;
}

export async function ensureLocalSongEmbeddedCover(song: LocalSong): Promise<LocalSong> {
    if (isBlob(song.embeddedCover)) {
        return song;
    }

    if (!embeddedCoverRequestMap.has(song.id)) {
        embeddedCoverRequestMap.set(song.id, (async () => {
            const fileHandle = await getAccessibleFileHandle(song);
            if (!fileHandle) {
                return song;
            }

            try {
                const file = await fileHandle.getFile();
                const metadata = await extractEmbeddedMetadata(file, true);
                if (!metadata.cover) {
                    return song;
                }

                const updatedSong: LocalSong = {
                    ...song,
                    embeddedCover: metadata.cover,
                    fileHandle
                };
                Object.assign(song, updatedSong);
                await saveLocalSong(updatedSong);
                return updatedSong;
            } catch (error) {
                console.warn(`[LocalMusic] Failed to ensure embedded cover for ${song.fileName}:`, error);
                fileHandleMap.delete(song.id);

                try {
                    const recoveredHandle = await recoverFileHandleFromPersistedDirectory(song);
                    if (!recoveredHandle) {
                        return song;
                    }

                    const file = await recoveredHandle.getFile();
                    const metadata = await extractEmbeddedMetadata(file, true);
                    if (!metadata.cover) {
                        return song;
                    }

                    const updatedSong: LocalSong = {
                        ...song,
                        embeddedCover: metadata.cover,
                        fileHandle: recoveredHandle
                    };
                    Object.assign(song, updatedSong);
                    await saveLocalSong(updatedSong);
                    return updatedSong;
                } catch (recoveryError) {
                    console.warn(`[LocalMusic] Failed to recover embedded cover for ${song.fileName}:`, recoveryError);
                    return song;
                }
            } finally {
                embeddedCoverRequestMap.delete(song.id);
            }
        })());
    }

    return await embeddedCoverRequestMap.get(song.id)!;
}

// Get audio blob from File object (for file input imports)
export async function getAudioFromFile(file: File): Promise<string> {
    const url = createSafeObjectUrl(file);
    if (!url) throw new TypeError('Local audio source must be a File or Blob');
    return url;
}

// Delete songs by their specific IDs
export async function deleteSongsByIds(songIds: string[]): Promise<void> {
    songIds.forEach(id => {
        fileHandleMap.delete(id);
        embeddedCoverRequestMap.delete(id);
    });
    await dbDeleteLocalSongs(songIds);
    await removeDeletedSongIdsFromPlaylists(songIds);
    notifyLocalMusicUpdated();
    console.log(`[LocalMusic] Deleted ${songIds.length} songs by ID`);
}

// Resync folder: refresh an imported folder in place using the persisted root handle
export async function resyncFolder(folderName: string): Promise<LocalSong[] | null> {
    // Only root imports have persisted directory handles. Derived child folders
    // should resync through their imported root folder handle.
    const rootFolderName = folderName.split('/')[0] || folderName;
    const importedSongs = await importFolder(rootFolderName);

    // If user cancelled (empty array), return null to indicate cancellation
    if (importedSongs.length === 0) {
        return null;
    }

    return importedSongs;
}

function getLocalSongRootFolderName(song: LocalSong): string | null {
    const sourcePath = song.folderName || song.filePath;
    const rootFolderName = sourcePath.split('/')[0]?.trim();
    return rootFolderName || null;
}

// Resyncs all imported local roots once, even when the song list contains nested folders.
export async function resyncAllFolders(): Promise<LocalSong[] | null> {
    const allSongs = await getLocalSongs();
    const rootFolderNames = Array.from(new Set(
        allSongs
            .map(getLocalSongRootFolderName)
            .filter((rootFolderName): rootFolderName is string => Boolean(rootFolderName))
    ));

    if (rootFolderNames.length === 0) {
        return null;
    }

    const importedSongs: LocalSong[] = [];
    for (const rootFolderName of rootFolderNames) {
        const rootSongs = await importFolder(rootFolderName);
        importedSongs.push(...rootSongs);
    }

    return importedSongs;
}

// Delete all songs from a specific folder (and its nested children)
export async function deleteFolderSongs(folderName: string): Promise<void> {
    // Get all local songs
    const allSongs = await getLocalSongs();

    // Filter songs that belong to this folder OR are nested under it
    const songsToDelete = allSongs.filter(song =>
        song.folderName === folderName || (song.folderName && song.folderName.startsWith(`${folderName}/`))
    );

    const songIdsToDelete = songsToDelete.map(song => song.id);
    songIdsToDelete.forEach(id => {
        fileHandleMap.delete(id);
        embeddedCoverRequestMap.delete(id);
    });
    await dbDeleteLocalSongs(songIdsToDelete);
    await removeDeletedSongIdsFromPlaylists(songIdsToDelete);

    const rootFolderName = folderName.split('/')[0];
    await cleanupDirHandleIfUnused(rootFolderName);

    notifyLocalMusicUpdated();
    console.log(`[LocalMusic] Deleted ${songsToDelete.length} songs from folder tree: ${folderName}`);
}
