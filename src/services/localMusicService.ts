import { LocalSong, LyricData } from '../types';
import { saveLocalSong, deleteLocalSong as dbDeleteLocalSong, saveDirHandles, getDirHandles } from './db';
import { neteaseApi } from './netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';
import { parseBlob } from 'music-metadata';

interface ParsedLyricLine {
    text?: string;
    timestamp?: number;
}

interface ParsedLyricTag {
    id?: string;
    value?: unknown;
    text?: string;
    language?: string;
    descriptor?: string;
    syncText?: ParsedLyricLine[];
    timeStampFormat?: number;
}

interface LyricCandidate {
    text: string;
    isTranslation: boolean;
    hasTimeline: boolean;
}

// In-memory storage for FileSystemFileHandle (cannot be persisted to IndexedDB)
// Maps song ID to FileSystemFileHandle
const fileHandleMap = new Map<string, FileSystemFileHandle>();

// Generate UUID for local songs
function generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Extract basic metadata from filename
// Expected format: "Artist - Title.mp3", "Artist-Title.mp3", or "Title.mp3"
function extractMetadataFromFilename(fileName: string): { title?: string; artist?: string; } {
    // 去掉扩展名
    let nameWithoutExt = fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');

    // 忽略前导数字和点
    nameWithoutExt = nameWithoutExt.replace(/^[\d\.]+/, '');

    // 再去除一开始的空格
    nameWithoutExt = nameWithoutExt.replace(/^\s+/, '');

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
        const url = URL.createObjectURL(file);

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

function formatLrcTimestamp(timestampMs: number): string {
    const safeTimestamp = Math.max(0, Math.floor(timestampMs));
    const minutes = Math.floor(safeTimestamp / 60000);
    const seconds = Math.floor((safeTimestamp % 60000) / 1000);
    const centiseconds = Math.floor((safeTimestamp % 1000) / 10);
    return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
}

function syncTextToLrc(syncText: ParsedLyricLine[] | undefined, timeStampFormat?: number): string | undefined {
    if (!syncText || syncText.length === 0) {
        return undefined;
    }

    if (timeStampFormat && timeStampFormat !== 2) {
        return undefined;
    }

    const lines = syncText
        .filter(line => typeof line?.timestamp === 'number' && typeof line?.text === 'string' && line.text.trim())
        .map(line => `${formatLrcTimestamp(line.timestamp!)}${line.text!.trim()}`);

    return lines.length > 0 ? `${lines.join('\n')}\n` : undefined;
}

function hasTimelineMarkers(text: string): boolean {
    return /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(text);
}

function normalizeLyricCandidateText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function isTranslationLyricTag(tag: ParsedLyricTag): boolean {
    const language = tag.language?.toLowerCase();
    const descriptor = tag.descriptor?.toLowerCase() || '';
    const id = tag.id?.toLowerCase() || '';

    return language === 'chi' ||
        language === 'zho' ||
        descriptor.includes('translation') ||
        descriptor.includes('trans') ||
        descriptor.includes('译') ||
        id.includes('translation') ||
        id.includes('trans');
}

function extractLyricText(tag: ParsedLyricTag): { text?: string; hasTimeline: boolean } {
    const directSyncText = syncTextToLrc(tag.syncText, tag.timeStampFormat);
    if (directSyncText) {
        return { text: directSyncText, hasTimeline: true };
    }

    const value = tag.value as ParsedLyricTag | string | undefined;
    if (typeof value === 'string' && value.trim()) {
        return { text: value, hasTimeline: hasTimelineMarkers(value) };
    }

    if (value && typeof value === 'object') {
        const nestedSyncText = syncTextToLrc(value.syncText, value.timeStampFormat);
        if (nestedSyncText) {
            return { text: nestedSyncText, hasTimeline: true };
        }

        if (typeof value.text === 'string' && value.text.trim()) {
            return { text: value.text, hasTimeline: hasTimelineMarkers(value.text) };
        }
    }

    if (typeof tag.text === 'string' && tag.text.trim()) {
        return { text: tag.text, hasTimeline: hasTimelineMarkers(tag.text) };
    }

    return { text: undefined, hasTimeline: false };
}



// Import folder using File System Access API (if supported)
export async function importFolder(expectedRootName?: string): Promise<LocalSong[]> {
    // Check if File System Access API is supported
    if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API not supported in this browser');
    }

    try {
        // @ts-ignore - showDirectoryPicker is not in all TypeScript definitions
        const dirHandle = await window.showDirectoryPicker();
        const importedSongs: LocalSong[] = [];
        
        let rootFolderName = expectedRootName || dirHandle.name;

        // If it's a new import (no expectedRootName), ensure the root folder name is unique
        if (!expectedRootName) {
            const { getLocalSongs } = await import('./db');
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

        // Save directory handle for persistence
        try {
            const { getDirHandles, saveDirHandles } = await import('./db');
            const dirHandles = await getDirHandles();
            dirHandles[rootFolderName] = dirHandle;
            await saveDirHandles(dirHandles);
            console.log(`[LocalMusic] Saved directory handle for ${rootFolderName}`);
        } catch (e) {
            console.error('[LocalMusic] Failed to save directory handle:', e);
        }

        const entries: { handle: FileSystemFileHandle, folderName: string, relativePath: string }[] = [];

        async function traverseDirectory(handle: FileSystemDirectoryHandle, currentPath: string) {
            // @ts-ignore
            for await (const entry of handle.values()) {
                if (entry.kind === 'file') {
                    entries.push({
                        handle: entry as FileSystemFileHandle,
                        folderName: currentPath,
                        relativePath: `${currentPath}/${entry.name}`
                    });
                } else if (entry.kind === 'directory') {
                    await traverseDirectory(entry as FileSystemDirectoryHandle, `${currentPath}/${entry.name}`);
                }
            }
        }

        await traverseDirectory(dirHandle, rootFolderName);

        const lrcMap = new Map<string, FileSystemFileHandle>();
        const tlrcMap = new Map<string, FileSystemFileHandle>();

        // First pass: Index lyric files
        for (const entry of entries) {
            const name = entry.handle.name;
            const fullPath = entry.relativePath;
            if (name.toLowerCase().endsWith('.t.lrc')) {
                const baseName = fullPath.slice(0, -6);
                tlrcMap.set(baseName, entry.handle);
            } else if (name.toLowerCase().endsWith('.lrc')) {
                const baseName = fullPath.slice(0, -4);
                lrcMap.set(baseName, entry.handle);
            }
        }

        // Second pass: Process audio files
        for (const entry of entries) {
            const fileHandle = entry.handle;
            const file = await fileHandle.getFile();

            // Check if it's an audio file
            if (!file.type.startsWith('audio/')) {
                continue;
            }

            const metadata = extractMetadataFromFilename(file.name);
            const duration = await getAudioDuration(file);

            // Check for local lyrics using the relative path (to prevent cross-folder collisions)
            const lastDotIndex = entry.relativePath.lastIndexOf('.');
            const baseName = lastDotIndex !== -1 ? entry.relativePath.substring(0, lastDotIndex) : entry.relativePath;

            let localLyricsContent: string | undefined;
            let localTranslationLyricsContent: string | undefined;

            if (lrcMap.has(baseName)) {
                    try {
                        const lrcFileHandle = lrcMap.get(baseName)!;
                        // @ts-ignore
                        const lrcFile = await lrcFileHandle.getFile();
                        localLyricsContent = await lrcFile.text();
                        console.log(`[LocalMusic] Found local lyric for ${file.name}`);
                    } catch (e) {
                        console.error(`[LocalMusic] Failed to read local lyric for ${file.name}`, e);
                    }
                }

                if (tlrcMap.has(baseName)) {
                    try {
                        const tlrcFileHandle = tlrcMap.get(baseName)!;
                        // @ts-ignore
                        const tlrcFile = await tlrcFileHandle.getFile();
                        localTranslationLyricsContent = await tlrcFile.text();
                        console.log(`[LocalMusic] Found local translation lyric for ${file.name}`);
                    } catch (e) {
                        console.error(`[LocalMusic] Failed to read local translation lyric for ${file.name}`, e);
                    }
                }

                let embeddedMetadata: {
                    title?: string;
                    artist?: string;
                    album?: string;
                    cover?: Blob;
                    bitrate?: number;
                    lyrics?: string;
                    translationLyrics?: string;
                    replayGain?: number;
                } = {};

                try {
                    const parsed = await parseBlob(file);
                    // DEBUG: dump lyrics-related fields
                    console.log(`[LocalMusic DEBUG] ${file.name} parsed.common keys:`, Object.keys(parsed.common));
                    console.log(`[LocalMusic DEBUG] ${file.name} parsed.common.lyrics:`, parsed.common.lyrics);
                    console.log(`[LocalMusic DEBUG] ${file.name} parsed.native keys:`, Object.keys(parsed.native || {}));
                    // Check native tags for lyrics in different formats
                    for (const [format, tags] of Object.entries(parsed.native || {})) {
                        const lyricTags = (tags as any[]).filter((t: any) => 
                            t.id?.toLowerCase().includes('lyric') || 
                            t.id?.toLowerCase().includes('uslt') ||
                            t.id?.toLowerCase().includes('sylt')
                        );
                        if (lyricTags.length > 0) {
                            console.log(`[LocalMusic DEBUG] ${file.name} native[${format}] lyrics tags:`, lyricTags);
                        }
                    }
                    // Extract original and translation from multiple USLT/LYRICS tags
                    let originalLyric: string | undefined;
                    let translationLyric: string | undefined;

                    const collectLyricCandidates = (tags: ParsedLyricTag[]): LyricCandidate[] => {
                        const lyricCandidates: LyricCandidate[] = [];

                        const addLyricCandidate = (tag: ParsedLyricTag) => {
                        const { text, hasTimeline } = extractLyricText(tag);
                        if (typeof text === 'string' && text.trim()) {
                            const normalizedText = normalizeLyricCandidateText(text);
                            if (lyricCandidates.some(c => c.text === normalizedText)) return;
                            lyricCandidates.push({
                                text: normalizedText,
                                isTranslation: isTranslationLyricTag(tag),
                                hasTimeline
                            });
                        }
                        };

                        tags.forEach(tag => addLyricCandidate(tag));
                        return lyricCandidates;
                    };

                    const commonCandidates = collectLyricCandidates((parsed.common.lyrics || []) as ParsedLyricTag[]);

                    let lyricCandidates = commonCandidates;
                    if (lyricCandidates.length === 0) {
                        const nativeLyricTags: ParsedLyricTag[] = [];
                        for (const tags of Object.values(parsed.native || {})) {
                            (tags as ParsedLyricTag[]).forEach(t => {
                                const id = t.id?.toLowerCase() || '';
                                if (id.includes('lyric') || id.includes('uslt') || id.includes('sylt')) {
                                    nativeLyricTags.push(t);
                                }
                            });
                        }
                        lyricCandidates = collectLyricCandidates(nativeLyricTags);
                    }

                    if (lyricCandidates.length > 0) {
                        const withTimeline = lyricCandidates.filter(c => c.hasTimeline);
                        const source = withTimeline.length > 0 ? withTimeline : lyricCandidates;

                        const translation = source.find(c => c.isTranslation);
                        if (translation) {
                            translationLyric = translation.text;
                            originalLyric = source.find(c => !c.isTranslation)?.text || source[0].text;
                        } else {
                            originalLyric = source[0].text;
                            if (source.length > 1) {
                                translationLyric = source[1].text;
                            }
                        }
                    }

                    embeddedMetadata = {
                        title: parsed.common.title,
                        artist: parsed.common.artist,
                        album: parsed.common.album,
                        cover: parsed.common.picture?.[0] ? new Blob([parsed.common.picture[0].data as any], { type: parsed.common.picture[0].format }) : undefined,
                        bitrate: parsed.format.bitrate,
                        lyrics: originalLyric,
                        translationLyrics: translationLyric,
                        replayGain: parsed.format.trackGain
                    };
                } catch (e) {
                    console.warn(`[LocalMusic] Failed to parse metadata for ${file.name}:`, e);
                }

                const songId = generateId();
                const localSong: LocalSong = {
                    id: songId,
                    fileName: file.name,
                    filePath: entry.relativePath, // Store full relative path
                    duration,
                    fileSize: file.size,
                    mimeType: file.type,
                    bitrate: embeddedMetadata.bitrate || 0,
                    addedAt: Date.now(),
                    // Prioritize embedded metadata, fallback to filename parsing
                    title: embeddedMetadata.title || metadata.title,
                    artist: embeddedMetadata.artist || metadata.artist,
                    album: embeddedMetadata.album,

                    // Store embedded metadata specifically
                    embeddedTitle: embeddedMetadata.title,
                    embeddedArtist: embeddedMetadata.artist,
                    embeddedAlbum: embeddedMetadata.album,
                    embeddedCover: embeddedMetadata.cover,

                    hasManualLyricSelection: false,
                    folderName: entry.folderName, // Used for nested grouping

                    // Local Lyrics
                    hasLocalLyrics: !!localLyricsContent,
                    localLyricsContent,
                    hasLocalTranslationLyrics: !!localTranslationLyricsContent,
                    localTranslationLyricsContent,
                    hasEmbeddedLyrics: !!embeddedMetadata.lyrics,
                    embeddedLyricsContent: embeddedMetadata.lyrics,
                    hasEmbeddedTranslationLyrics: !!embeddedMetadata.translationLyrics,
                    embeddedTranslationLyricsContent: embeddedMetadata.translationLyrics,
                    replayGain: embeddedMetadata.replayGain
                };

                // Store fileHandle in memory
                fileHandleMap.set(songId, fileHandle);
                localSong.fileHandle = fileHandle;

                try {
                    await saveLocalSong(localSong);
                    importedSongs.push(localSong);
                } catch (saveError) {
                    // If save fails for one file, log error but continue with other files
                    console.error(`Failed to save song ${localSong.fileName}:`, saveError);
                    // Remove fileHandle from memory since we couldn't save
                    fileHandleMap.delete(songId);
                }
        }

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
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, '') // Remove punctuation except Chinese characters
        .replace(/\s+/g, ''); // Remove all whitespace
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
    try {
        // Build search query from metadata
        const searchQuery = song.artist
            ? `${song.artist} ${song.title}`
            : song.title || song.fileName;

        console.log(`[LocalMusic] Searching lyrics for: "${searchQuery}"`);

        // Search on Netease
        const searchRes = await neteaseApi.cloudSearch(searchQuery);

        if (!searchRes.result?.songs || searchRes.result.songs.length === 0) {
            console.warn(`[LocalMusic] No search results for: "${searchQuery}"`);
            return null;
        }

        // Try to find a song with matching title
        const localTitle = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        let matchedSong = searchRes.result.songs.find(s => isTitleMatch(localTitle, s.name));

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
            song.matchedSongId = matchedSong.id;
            song.matchedArtists = matchedSong.ar?.map(a => a.name).join(', ');
            song.matchedAlbumId = matchedSong.al?.id || matchedSong.album?.id;
            song.matchedAlbumName = matchedSong.al?.name || matchedSong.album?.name;
            // DO NOT set song.matchedLyrics - keep local lyrics

            const coverUrl = matchedSong.al?.picUrl || matchedSong.album?.picUrl;
            if (coverUrl) {
                song.matchedCoverUrl = coverUrl.replace('http:', 'https:');
            }
            await saveLocalSong(song);

            // Return null to indicate no NEW lyrics were fetched (local lyrics are used)
            return null;
        }

        // Fetch lyrics (only when NO local lyrics)
        const lyricRes = await neteaseApi.getLyric(matchedSong.id);
        const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
        const mainLrc = lyricRes.lrc?.lyric;
        const ytlrc = lyricRes.ytlrc?.lyric || lyricRes.lrc?.ytlrc?.lyric;
        const tlyric = lyricRes.tlyric?.lyric || "";

        const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;

        let parsedLyrics: LyricData | null = null;
        if (yrcLrc) {
            parsedLyrics = parseYRC(yrcLrc, transLrc);
        } else if (mainLrc) {
            parsedLyrics = parseLRC(mainLrc, transLrc);
        }

        // Add chorus detection
        if (parsedLyrics && !lyricRes.pureMusic && !lyricRes.lrc?.pureMusic && mainLrc) {
            const chorusLines = detectChorusLines(mainLrc);
            if (chorusLines.size > 0) {
                const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
                const effects: ('bars' | 'circles' | 'beams')[] = ['bars', 'circles', 'beams'];

                chorusLines.forEach(text => {
                    const randomEffect = effects[Math.floor(Math.random() * effects.length)];
                    effectMap.set(text, randomEffect);
                });

                parsedLyrics.lines.forEach(line => {
                    const text = line.fullText.trim();
                    if (chorusLines.has(text)) {
                        line.isChorus = true;
                        line.chorusEffect = effectMap.get(text);
                    }
                });
            }
        }

        if (parsedLyrics) {
            // Update local song with matched info
            song.matchedSongId = matchedSong.id;
            song.matchedArtists = matchedSong.ar?.map(a => a.name).join(', ');
            song.matchedAlbumId = matchedSong.al?.id || matchedSong.album?.id;
            song.matchedAlbumName = matchedSong.al?.name || matchedSong.album?.name;
            song.matchedLyrics = parsedLyrics;
            // Get cover URL from matched song
            const coverUrl = matchedSong.al?.picUrl || matchedSong.album?.picUrl;
            if (coverUrl) {
                song.matchedCoverUrl = coverUrl.replace('http:', 'https:');
            }
            await saveLocalSong(song);
        }

        return parsedLyrics;
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

// Get audio blob from local song using fileHandle
// Returns blob URL if fileHandle exists, null otherwise
export async function getAudioFromLocalSong(song: LocalSong): Promise<string | null> {
    // Try to get fileHandle from memory first
    let fileHandle = fileHandleMap.get(song.id);

    // If not in memory, try to use the one stored in song object (if available)
    if (!fileHandle && song.fileHandle) {
        fileHandle = song.fileHandle;
        fileHandleMap.set(song.id, fileHandle);
    }

    // If fileHandle exists, use it
    if (fileHandle) {
        try {
            const file = await fileHandle.getFile();
            return URL.createObjectURL(file);
        } catch (error) {
            console.error('[LocalMusic] Failed to get file from handle:', error);
            // File may have been moved or deleted
            fileHandleMap.delete(song.id);
            return null;
        }
    }

    // No fileHandle available - file may have been moved or deleted
    console.warn(`[LocalMusic] No fileHandle for song ${song.id}. File must be re-imported.`);
    return null;
}

// Get audio blob from File object (for file input imports)
export async function getAudioFromFile(file: File): Promise<string> {
    return URL.createObjectURL(file);
}

// Delete songs by their specific IDs
export async function deleteSongsByIds(songIds: string[]): Promise<void> {
    for (const id of songIds) {
        await deleteLocalSong(id);
    }
    console.log(`[LocalMusic] Deleted ${songIds.length} songs by ID`);
}

// Resync folder: Delete old songs by ID, then prompt for new import
export async function resyncFolder(folderName: string): Promise<LocalSong[] | null> {
    const { getLocalSongs } = await import('./db');
    
    // Identify old songs to delete before import
    const allSongs = await getLocalSongs();
    const oldSongsToDelete = allSongs.filter(song => 
        song.folderName === folderName || (song.folderName && song.folderName.startsWith(`${folderName}/`))
    );

    // Prompt user to select the folder again to get fresh handles
    // Pass folderName so it overwrites instead of creating a duplicated name like "Music (2)"
    const importedSongs = await importFolder(folderName);

    // If user cancelled (empty array), return null to indicate cancellation
    // Don't delete anything
    if (importedSongs.length === 0) {
        return null;
    }

    // User confirmed - delete old songs by their specific IDs
    for (const song of oldSongsToDelete) {
        await deleteLocalSong(song.id);
    }
    
    console.log(`[LocalMusic] Deleted ${oldSongsToDelete.length} old songs from folder tree: ${folderName}`);

    return importedSongs;
}

// Delete all songs from a specific folder (and its nested children)
export async function deleteFolderSongs(folderName: string): Promise<void> {
    const { getLocalSongs } = await import('./db');

    // Get all local songs
    const allSongs = await getLocalSongs();

    // Filter songs that belong to this folder OR are nested under it
    const songsToDelete = allSongs.filter(song => 
        song.folderName === folderName || (song.folderName && song.folderName.startsWith(`${folderName}/`))
    );

    // Delete each song
    for (const song of songsToDelete) {
        await deleteLocalSong(song.id);
    }

    console.log(`[LocalMusic] Deleted ${songsToDelete.length} songs from folder tree: ${folderName}`);
}
