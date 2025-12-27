import { LocalSong, LyricData } from '../types';
import { saveLocalSong, deleteLocalSong as dbDeleteLocalSong } from './db';
import { neteaseApi } from './netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';
import { parseBlob } from 'music-metadata-browser';

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



// Import folder using File System Access API (if supported)
export async function importFolder(): Promise<LocalSong[]> {
    // Check if File System Access API is supported
    if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API not supported in this browser');
    }

    try {
        // @ts-ignore - showDirectoryPicker is not in all TypeScript definitions
        const dirHandle = await window.showDirectoryPicker();
        const importedSongs: LocalSong[] = [];

        const entries: any[] = [];
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
            entries.push(entry);
        }

        const lrcMap = new Map<string, FileSystemFileHandle>();
        const tlrcMap = new Map<string, FileSystemFileHandle>();

        // First pass: Index lyric files
        for (const entry of entries) {
            if (entry.kind === 'file') {
                const name = entry.name;
                if (name.toLowerCase().endsWith('.t.lrc')) {
                    const baseName = name.slice(0, -6);
                    lrcMap.set(baseName + '.t', entry as FileSystemFileHandle); // Store as .t specific or just separate map?
                    // actually let's use tlrcMap
                    tlrcMap.set(baseName, entry as FileSystemFileHandle);
                } else if (name.toLowerCase().endsWith('.lrc')) {
                    const baseName = name.slice(0, -4);
                    lrcMap.set(baseName, entry as FileSystemFileHandle);
                }
            }
        }

        // Second pass: Process audio files
        for (const entry of entries) {
            if (entry.kind === 'file') {
                // @ts-ignore
                const file = await entry.getFile();

                // Check if it's an audio file
                if (!file.type.startsWith('audio/')) {
                    continue;
                }

                const metadata = extractMetadataFromFilename(file.name);
                const duration = await getAudioDuration(file);

                // Check for local lyrics
                // Filename without extension
                const baseName = file.name.substring(0, file.name.lastIndexOf('.'));

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
                } = {};

                try {
                    const parsed = await parseBlob(file);
                    embeddedMetadata = {
                        title: parsed.common.title,
                        artist: parsed.common.artist,
                        album: parsed.common.album,
                        cover: parsed.common.picture?.[0] ? new Blob([parsed.common.picture[0].data as any], { type: parsed.common.picture[0].format }) : undefined,
                        bitrate: parsed.format.bitrate
                    };
                } catch (e) {
                    console.warn(`[LocalMusic] Failed to parse metadata for ${file.name}:`, e);
                }

                const songId = generateId();
                const localSong: LocalSong = {
                    id: songId,
                    fileName: file.name,
                    filePath: file.name, // Store filename
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
                    folderName: dirHandle.name,

                    // Local Lyrics
                    hasLocalLyrics: !!localLyricsContent,
                    localLyricsContent,
                    hasLocalTranslationLyrics: !!localTranslationLyricsContent,
                    localTranslationLyricsContent
                };

                // Store fileHandle in memory (cannot persist to IndexedDB)
                // @ts-ignore - FileSystemFileHandle type may not be in all TypeScript definitions
                fileHandleMap.set(songId, entry as FileSystemFileHandle);
                // @ts-ignore
                localSong.fileHandle = entry as FileSystemFileHandle;

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

        // Check if we should skip lyrics fetching (local lyrics take priority)
        if (song.hasLocalLyrics && song.localLyricsContent) {
            console.log(`[LocalMusic] Local lyrics exist, skipping online lyrics fetch. Only fetching cover/metadata.`);

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
export async function resyncFolder(oldSongIds: string[]): Promise<LocalSong[] | null> {
    // First, prompt user to select the folder again to get fresh handles
    const importedSongs = await importFolder();

    // If user cancelled (empty array), return null to indicate cancellation
    // Don't delete anything
    if (importedSongs.length === 0) {
        return null;
    }

    // User confirmed - delete old songs by their IDs
    // This happens AFTER import so new songs have different IDs
    // and won't be affected by the deletion
    await deleteSongsByIds(oldSongIds);

    return importedSongs;
}

// Delete all songs from a specific folder
export async function deleteFolderSongs(folderName: string): Promise<void> {
    const { getLocalSongs } = await import('./db');

    // Get all local songs
    const allSongs = await getLocalSongs();

    // Filter songs that belong to this folder
    const songsToDelete = allSongs.filter(song => song.folderName === folderName);

    // Delete each song
    for (const song of songsToDelete) {
        await deleteLocalSong(song.id);
    }

    console.log(`[LocalMusic] Deleted ${songsToDelete.length} songs from folder: ${folderName}`);
}

