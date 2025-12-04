import { LocalSong, LyricData } from '../types';
import { saveLocalSong, deleteLocalSong as dbDeleteLocalSong } from './db';
import { neteaseApi } from './netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';

// In-memory storage for FileSystemFileHandle (cannot be persisted to IndexedDB)
// Maps song ID to FileSystemFileHandle
const fileHandleMap = new Map<string, FileSystemFileHandle>();

// Generate UUID for local songs
function generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Extract basic metadata from filename
// Expected format: "Artist - Title.mp3" or "Title.mp3"
function extractMetadataFromFilename(fileName: string): { title?: string; artist?: string; } {
    // 去掉扩展名
    let nameWithoutExt = fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');

    // 忽略前导数字和点
    nameWithoutExt = nameWithoutExt.replace(/^[\d\.]+/, '');

    // 再去除一开始的空格
    nameWithoutExt = nameWithoutExt.replace(/^\s+/, '');

    // 分割艺术家和标题
    const parts = nameWithoutExt.split(' - ');
    if (parts.length === 2) {
        return {
            artist: parts[0].trim(),
            title: parts[1].trim()
        };
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

        // Iterate through directory
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                const file = await entry.getFile();

                // Check if it's an audio file
                if (!file.type.startsWith('audio/')) {
                    continue;
                }

                const metadata = extractMetadataFromFilename(file.name);
                const duration = await getAudioDuration(file);

                const songId = generateId();
                const localSong: LocalSong = {
                    id: songId,
                    fileName: file.name,
                    filePath: file.name, // Store filename
                    duration,
                    fileSize: file.size,
                    mimeType: file.type,
                    addedAt: Date.now(),
                    title: metadata.title,
                    artist: metadata.artist,
                    hasManualLyricSelection: false,
                    folderName: dirHandle.name
                };

                // Store fileHandle in memory (cannot persist to IndexedDB)
                // @ts-ignore - FileSystemFileHandle type may not be in all TypeScript definitions
                fileHandleMap.set(songId, entry as FileSystemFileHandle);
                localSong.fileHandle = entry as FileSystemFileHandle;

                await saveLocalSong(localSong);
                importedSongs.push(localSong);
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

// Match lyrics for a local song using search API
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

        // Get the first result (best match)
        const matchedSong = searchRes.result.songs[0];
        console.log(`[LocalMusic] Found match: ${matchedSong.name} by ${matchedSong.ar?.map(a => a.name).join(', ')}`);

        // Fetch lyrics
        const lyricRes = await neteaseApi.getLyric(matchedSong.id);
        const mainLrc = lyricRes.lrc?.lyric;
        const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
        const transLrc = lyricRes.tlyric?.lyric || "";

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

// Resync folder: Delete all songs and prompt re-import
export async function resyncFolder(folderName: string): Promise<LocalSong[]> {
    // First, delete all songs from this folder
    await deleteFolderSongs(folderName);

    // Then prompt user to select the folder again to get fresh handles
    return await importFolder();
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

