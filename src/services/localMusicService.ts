import { LocalSong, LyricData } from '../types';
import { saveLocalSong, deleteLocalSong as dbDeleteLocalSong } from './db';
import { neteaseApi } from './netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';

// In-memory storage for FileSystemFileHandle (cannot be persisted to IndexedDB)
// Maps song ID to FileSystemFileHandle
const fileHandleMap = new Map<string, FileSystemFileHandle>();

// In-memory storage for File objects (for files imported via <input type="file">)
// Maps song ID to File object (only available during current session)
const fileObjectMap = new Map<string, File>();

// Generate UUID for local songs
function generateId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Extract basic metadata from filename
// Expected format: "Artist - Title.mp3" or "Title.mp3"
function extractMetadataFromFilename(fileName: string): { title?: string; artist?: string; } {
    const nameWithoutExt = fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
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

// Import files from file input
export async function importFiles(files: FileList): Promise<LocalSong[]> {
    const importedSongs: LocalSong[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Check if it's an audio file
        if (!file.type.startsWith('audio/')) {
            console.warn(`Skipping non-audio file: ${file.name}`);
            continue;
        }

        const metadata = extractMetadataFromFilename(file.name);
        const duration = await getAudioDuration(file);

        const songId = generateId();
        const localSong: LocalSong = {
            id: songId,
            fileName: file.name,
            filePath: file.name, // In browser, we use filename as reference
            duration,
            fileSize: file.size,
            mimeType: file.type,
            addedAt: Date.now(),
            title: metadata.title,
            artist: metadata.artist,
            hasManualLyricSelection: false
        };

        // Save File object to memory for immediate playback (only available during current session)
        fileObjectMap.set(songId, file);

        // Save to IndexedDB
        await saveLocalSong(localSong);
        importedSongs.push(localSong);
    }

    return importedSongs;
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
                    hasManualLyricSelection: false
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
    // Remove fileHandle and File object from memory
    fileHandleMap.delete(id);
    fileObjectMap.delete(id);
    await dbDeleteLocalSong(id);
}

// Get audio blob from local song using fileHandle or File object
// Returns blob URL if fileHandle or File object exists, null otherwise
export async function getAudioFromLocalSong(song: LocalSong): Promise<string | null> {
    // Try to get fileHandle from memory first (for files imported via folder)
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

    // Try to get File object from memory (for files imported via <input type="file">)
    const fileObject = fileObjectMap.get(song.id);
    if (fileObject) {
        return URL.createObjectURL(fileObject);
    }

    // No fileHandle or File object available - user needs to re-select the file
    // This happens for files imported via <input type="file"> after page refresh
    console.warn(`[LocalMusic] No fileHandle or File object for song ${song.id}. File must be re-selected.`);
    return null;
}

// Get audio blob from File object (for file input imports)
export async function getAudioFromFile(file: File): Promise<string> {
    return URL.createObjectURL(file);
}
