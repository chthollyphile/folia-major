import type { LocalSong, SongResult } from '../../types';
import { getLocalSongs } from '../../services/db';
import { buildFoliaLocalMatchIndex, songOfFoliaFileSong, type FoliaFileSong } from '../../services/foliaPlaylist/foliaPlaylistFile';
import { downloadText, navidromeUrls } from '../../services/foliaPlaylist/foliaPlaylistFileIo';
import { buildLocalEntrySong } from '../../services/foliaPlaylist/foliaPlaylistRows';
import { omni } from '../../services/onlineMusic/omni';
import type { OmniRequestRunner } from '../../types/onlineMusic';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { formatLocalDateTimeStamp } from '../../utils/downloadFileName';
import {
    SONG_NOTES_FILE_EXTENSION,
    SONG_NOTES_FILE_MAX_BYTES,
    SONG_NOTES_FILE_MAX_SONGS,
    musicNotesImportOf,
    readSongNotesFileText,
    serializeSongNotesFile,
    type MusicNotesSong,
    type ResolvedSongNotesImport,
    type SongNotesFileError,
    type SongNotesFileExport,
    type SongNotesImport,
    type SongNotesImportSong,
} from './songNotesFile';
import { readMusicNotesModRecords } from './musicNotesModDatabase';
import { importSongNotes, listSongNoteKeys, readAllSongNotesForExport, type SongNoteResult, type SongNotesImportResult } from './songNotesService';

// src/components/song-notes/songNotesFileIo.ts
// 「时刻」的导出、导入接上存储与界面：下载文件、读文件、只读地打开「音乐笔记」模组的库、在曲库里认本地歌、补在线歌的快照。
// 规则在 songNotesFile.ts（纯函数），写库在 songNotesService.importSongNotes。设置 · 存储与备份「备份与导入」里的几行用它。
//
// 导入分两步：先读、认歌（不碰网络，给确认框里的数），确认之后才补快照、写库。

/** 导出全部时刻并下载。读不出库回 null。 */
export const exportSongNotesFile = async (): Promise<SongNotesFileExport | 'too-large' | null> => {
    const data = await readAllSongNotesForExport();
    if (!data) return null;
    const exported = serializeSongNotesFile(data, data.rows.some(row => row.key.startsWith('local:')) ? await getLocalSongs() : []);
    // 读不回来的文件不导出（读入有上限）。
    if (exported.exportedCount > SONG_NOTES_FILE_MAX_SONGS || exported.content.length > SONG_NOTES_FILE_MAX_BYTES) return 'too-large';
    downloadText(exported.content, `folia-notes-${formatLocalDateTimeStamp()}${SONG_NOTES_FILE_EXTENSION}`, 'application/json;charset=utf-8');
    return exported;
};

/** 准备好、等确认的一次导入。`fromMod`：在线歌只有身份和歌名，写库前要补快照。 */
export type PreparedSongNotesImport = ResolvedSongNotesImport & { fromMod: boolean };

const mergeDuplicates = (songs: ReadonlyArray<SongNotesImportSong<SongResult>>): SongNotesImportSong<SongResult>[] => {
    const byKey = new Map<string, SongNotesImportSong<SongResult>>();
    for (const item of songs) {
        const key = getPlaybackSongKey(item.song);
        const previous = byKey.get(key);
        if (!previous) {
            byKey.set(key, { ...item, tags: [...item.tags], comments: [...item.comments] });
            continue;
        }
        previous.tags.push(...item.tags);
        previous.comments.push(...item.comments);
        previous.updatedAt = Math.max(previous.updatedAt, item.updatedAt);
    }
    return [...byKey.values()];
};

const resolveFolia = (data: SongNotesImport<FoliaFileSong>, localSongs: readonly LocalSong[]): PreparedSongNotesImport => {
    const index = buildFoliaLocalMatchIndex(localSongs);
    const urls = navidromeUrls();
    const unmatchedTitles: string[] = [];
    let unmatched = 0;
    const songs = data.songs.flatMap((item) => {
        const song = songOfFoliaFileSong(item.song, index, urls);
        if (song) return [{ ...item, song }];
        unmatched += 1;
        if (unmatchedTitles.length < 5 && item.song.source === 'local') unmatchedTitles.push(item.song.title || item.song.local.fileName || '');
        return [];
    });
    return { ...data, songs: mergeDuplicates(songs), unmatched, unmatchedTitles, fromMod: false };
};

/** 模组的在线歌只有身份和名字：先拼一个最小的快照（播放时按来源再解析），写库前再试着补全。 */
const minimalOnlineSong = (song: Extract<MusicNotesSong, { kind: 'online' }>): SongResult => ({
    id: song.mediaId,
    name: song.title,
    artists: song.artist ? [{ id: 0, name: song.artist }] : [],
    album: { id: 0, name: song.album ?? '' },
    durationMs: 0,
    sourceRef: { kind: 'online', providerId: song.providerId, mediaId: song.mediaId },
});

const resolveMod = (data: SongNotesImport<MusicNotesSong>, localSongs: readonly LocalSong[]): PreparedSongNotesImport => {
    const byId = new Map(localSongs.map(song => [song.id, song]));
    const unmatchedTitles: string[] = [];
    let unmatched = 0;
    const songs = data.songs.flatMap((item) => {
        if (item.song.kind === 'online') return [{ ...item, song: minimalOnlineSong(item.song) }];
        // 模组记本地歌用的就是曲库里的 id（sourceRef.mediaId 与 localRef.songId 是同一个），只在这台设备上认得。
        const local = byId.get(item.song.songId);
        if (local) return [{ ...item, song: buildLocalEntrySong(local) }];
        unmatched += 1;
        if (unmatchedTitles.length < 5) unmatchedTitles.push(item.song.title);
        return [];
    });
    return { ...data, songs: mergeDuplicates(songs), unmatched, unmatchedTitles, fromMod: true };
};

const localSongsFor = async (needed: boolean): Promise<LocalSong[]> => (needed ? getLocalSongs() : []);

export type SongNotesFileRead = { ok: true; prepared: PreparedSongNotesImport } | { ok: false; error: SongNotesFileError | 'unreadable' };

/** 读一个文件（自己的格式或模组导出的 JSON），认好歌，等确认。不写任何东西。 */
export const readSongNotesFile = async (file: File): Promise<SongNotesFileRead> => {
    if (file.size > SONG_NOTES_FILE_MAX_BYTES) return { ok: false, error: 'too-large' };
    try {
        const reading = readSongNotesFileText(await file.text());
        if (reading.kind === 'error') return { ok: false, error: reading.error };
        if (reading.kind === 'folia') {
            const localSongs = await localSongsFor(reading.data.songs.some(item => item.song.source === 'local'));
            return { ok: true, prepared: resolveFolia(reading.data, localSongs) };
        }
        const localSongs = await localSongsFor(reading.data.songs.some(item => item.song.kind === 'local'));
        return { ok: true, prepared: resolveMod(reading.data, localSongs) };
    } catch (error) {
        console.warn('[SongNotes] Could not read a notes file', error);
        return { ok: false, error: 'unreadable' };
    }
};

// ---- 模组的库 ----

/** 读模组的库，认好歌，等确认。库不在回 null。 */
export const readMusicNotesModDatabase = async (): Promise<PreparedSongNotesImport | null> => {
    const read = await readMusicNotesModRecords();
    if (!read) return null;
    const data = musicNotesImportOf(read.records, read.tagOrder);
    return resolveMod(data, await localSongsFor(data.songs.some(item => item.song.kind === 'local')));
};

// ---- 确认之后 ----

/** 补快照的时限：一次请求最多等这么久，整次导入一共最多花这么久。过了时限没问到的留着最小快照（播放时再解析）。 */
const DETAIL_REQUEST_TIMEOUT_MS = 15_000;
const DETAIL_TOTAL_BUDGET_MS = 60_000;

/** 给 omni 的请求加时限：单次超时，总时长用完以后的请求一律不发。 */
const boundedRunner = (deadline: number): OmniRequestRunner => async (work) => {
    const left = Math.min(DETAIL_REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (left <= 0) throw new Error('song notes import: lookup budget used up');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('song notes import: lookup timed out')), left);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * 模组的在线歌按音源分批补快照（omni.getSongDetails）。补回来的歌 key 对不上的不用（有的音源换了 id）；
 * 音源没装、请求失败、超时的留着最小快照。`skip` 里的歌（本体已经有了，留着自己的快照）不去问。
 */
const fillOnlineDetails = async (songs: SongNotesImportSong<SongResult>[], skip: ReadonlySet<string>): Promise<void> => {
    const run = boundedRunner(Date.now() + DETAIL_TOTAL_BUDGET_MS);
    const byProvider = new Map<string, SongNotesImportSong<SongResult>[]>();
    for (const item of songs) {
        const ref = item.song.sourceRef;
        if (ref?.kind !== 'online' || skip.has(getPlaybackSongKey(item.song))) continue;
        const list = byProvider.get(ref.providerId);
        if (list) list.push(item);
        else byProvider.set(ref.providerId, [item]);
    }
    for (const [providerId, items] of byProvider) {
        if (!omni.getProviderNaming(providerId)) continue;
        try {
            const details = await omni.getSongDetails(providerId, items.map(item => (item.song.sourceRef as { mediaId: string }).mediaId), { run });
            details.forEach((detail, index) => {
                const item = items[index];
                if (detail.status === 'found' && getPlaybackSongKey(detail.song) === getPlaybackSongKey(item.song)) item.song = detail.song;
            });
        } catch (error) {
            console.warn('[SongNotes] Could not look up songs from', providerId, error);
        }
    }
};

/** 确认之后：模组来的先补快照，再写库。 */
export const applySongNotesImport = async (prepared: PreparedSongNotesImport): Promise<SongNoteResult<SongNotesImportResult>> => {
    const songs = prepared.songs.map(item => ({ ...item }));
    if (prepared.fromMod) await fillOnlineDetails(songs, await listSongNoteKeys());
    return importSongNotes({ tags: prepared.tags, songs });
};
