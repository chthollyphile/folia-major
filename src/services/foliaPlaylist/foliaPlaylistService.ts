import type { LocalSong, SongResult } from '../../types';
import type {
    FoliaPlayViaUnavailable,
    FoliaPlaylist,
    FoliaPlaylistAddResult,
    FoliaPlaylistEntry,
    FoliaPlaylistOrigin,
    FoliaPlaylistSummary,
    FoliaRefreshFromOriginResult,
    FoliaSaveCollectionInput,
    FoliaSaveCollectionResult,
} from '../../types/foliaPlaylist';
import { appendFoliaPlaylistEntries, foliaLocalSongKey } from '../../utils/foliaPlaylistEntries';
import {
    buildFoliaTransferEntries,
    FoliaNothingToSaveError,
    foliaOriginNeedsConfirmation,
    refreshFoliaPlaylistEntries,
    toFoliaCounterparts,
    type FoliaCounterparts,
} from '../../utils/foliaPlaylistTransfer';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { appDatabase } from '../appDatabase';
import type { FoliaPlaylistRow } from './foliaPlaylistDatabase';
import { buildLocalEntrySong, createFoliaPlaylistId } from './foliaPlaylistRows';
import {
    appendEntryRows,
    createPlaylistRows,
    deletePlaylistRows,
    ensureFoliaPlaylistStorage,
    fromEntryRow,
    putPlaylistRow,
    readEntryKeys,
    readEntryRow,
    readEntryRows,
    readExistingKeys,
    readPlaylistRow,
    readPlaylistRows,
    removeEntryRows,
    reorderEntryRows,
    reorderPlaylistRows,
    repairLocalEntryRows,
    replaceEntryRows,
    toSummary,
    writeFoliaPlaylists,
    type FoliaWrite,
} from './foliaPlaylistStorage';
import { resolveCanonicalLocalSongId } from './localSongDuplicates';

// src/services/foliaPlaylist/foliaPlaylistService.ts
// Folia 聚合歌单的读写。存在 FoliaPlaylistsDB 里，按条目存（foliaPlaylistDatabase.ts、foliaPlaylistStorage.ts）：
// 歌单一行摘要，条目一条一行。所以加一首歌、点一次红心写的是一行条目加一行摘要，和歌单多大无关；
// 界面常驻的是摘要（getFoliaPlaylistSummaries），条目在打开歌单、整张播放、排序、导出时才读（getFoliaPlaylist）。
// 每个写操作是一个读写事务，现状在事务里读，所以并发的写（连点红心、两个窗口）不会互相盖掉。
// 第一次读写之前把旧结构搬过来，并保证有一张「我喜欢的音乐」（foliaPlaylistStorage.ts）。

export { FoliaPlaylistsNewerVersionError, resetFoliaPlaylistStorage, subscribeFoliaPlaylists, type FoliaPlaylistsChange } from './foliaPlaylistStorage';

// ---- 读 ----

/**
 * 全部歌单的摘要，按显示的先后（「我喜欢的音乐」一定有）。读的时候顺手把本地歌的条目对着曲库修一遍
 * （要读整张曲库表）；repair: false 不修——歌单自己的写引起的重读用它，曲库没变就没有要修的。
 */
export const getFoliaPlaylistSummaries = async (options: { repair?: boolean } = {}): Promise<FoliaPlaylistSummary[]> => {
    if (options.repair === false) await ensureFoliaPlaylistStorage();
    else await repairLocalEntryRows();
    return (await readPlaylistRows()).map(toSummary);
};

export const getFoliaPlaylistSummary = async (playlistId: string): Promise<FoliaPlaylistSummary | null> => {
    await ensureFoliaPlaylistStorage();
    const row = await readPlaylistRow(playlistId);
    return row ? toSummary(row) : null;
};

const withEntries = async (row: FoliaPlaylistRow): Promise<FoliaPlaylist> => {
    const { entryCount: _entryCount, coverUrl: _coverUrl, coverLocalSongIds: _coverLocalSongIds, ...info } = toSummary(row);
    return { ...info, entries: (await readEntryRows(row.id)).map(fromEntryRow) };
};

/** 一张歌单连同全部条目（打开歌单、整张播放、排序、导出时用；读出来的不常驻）。 */
export const getFoliaPlaylist = async (playlistId: string): Promise<FoliaPlaylist | null> => {
    await ensureFoliaPlaylistStorage();
    const row = await readPlaylistRow(playlistId);
    return row ? withEntries(row) : null;
};

/**
 * 全部歌单连同全部条目。只给单测和排查用：界面不要叫它（它把所有条目一次读进内存）——
 * 列表用 getFoliaPlaylistSummaries，一张歌单的内容用 getFoliaPlaylist。
 */
export const getFoliaPlaylists = async (): Promise<FoliaPlaylist[]> => {
    await repairLocalEntryRows();
    return Promise.all((await readPlaylistRows()).map(withEntries));
};

/** 一张歌单里全部条目的 key（不读条目本身）：红心的点亮状态、「已在歌单里」要的只是它。 */
export const getFoliaPlaylistEntryKeys = async (playlistId: string): Promise<string[]> => {
    await ensureFoliaPlaylistStorage();
    return readEntryKeys(playlistId);
};

/** keys 里哪些已经在这张歌单里（走主键，不用读整张）。 */
export const findFoliaPlaylistEntryKeys = async (playlistId: string, keys: readonly string[]): Promise<Set<string>> => {
    await ensureFoliaPlaylistStorage();
    return readExistingKeys(playlistId, keys);
};

// ---- 写 ----

const favoriteRow = async (): Promise<FoliaPlaylistRow | undefined> => (await readPlaylistRows()).find(row => row.isFavorite);

const dedupeByKey = (entries: readonly FoliaPlaylistEntry[]): FoliaPlaylistEntry[] => {
    const seen = new Set<string>();
    return entries.filter(entry => (seen.has(entry.key) ? false : Boolean(seen.add(entry.key))));
};

const createWithEntries = (
    write: FoliaWrite,
    name: string,
    entries: readonly FoliaPlaylistEntry[],
    origin: FoliaPlaylistOrigin | undefined,
    now: number,
): Promise<FoliaPlaylistRow> => {
    // 新建的歌单不会一出生就「确认过出处」：confirmedAt 只有 confirmFoliaPlaylistOrigin 写。
    const { confirmedAt: _confirmedAt, ...cleanOrigin } = origin ?? {};
    return createPlaylistRows(write, {
        id: createFoliaPlaylistId(),
        name,
        createdAt: now,
        updatedAt: now,
        ...(origin ? { origin: cleanOrigin as FoliaPlaylistOrigin } : {}),
        entries: dedupeByKey(entries),
    });
};

/** 建一张歌单，可以带上第一批歌（任何来源，一批里可以有多个来源）。名字是空的会抛错。 */
export const createFoliaPlaylist = (
    name: string,
    songs: readonly SongResult[] = [],
    options: { origin?: FoliaPlaylistOrigin } = {},
): Promise<FoliaPlaylistSummary> => {
    const trimmedName = name.trim();
    if (!trimmedName) return Promise.reject(new Error('Playlist name is empty'));
    return writeFoliaPlaylists(async write => {
        const now = Date.now();
        return toSummary(await createWithEntries(write, trimmedName, appendFoliaPlaylistEntries([], songs, now).entries, options.origin, now));
    });
};

/**
 * 用现成的条目建一张歌单（从 JSON 文件读入时用：条目带着原来的加入时间、换过来源的记号、跟着原歌单的标记）。
 * 条目由调用方校验好；这里只保证同一个 key 只留第一条。名字是空的会抛错。
 * 带出处的话，出处一定标成「文件说的、还没确认」（fromFile，没有 confirmedAt），不管调用方给的是什么样。
 */
export const createFoliaPlaylistFromEntries = (
    name: string,
    entries: readonly FoliaPlaylistEntry[],
    options: { origin?: FoliaPlaylistOrigin } = {},
): Promise<FoliaPlaylistSummary> => {
    const trimmedName = name.trim();
    if (!trimmedName) return Promise.reject(new Error('Playlist name is empty'));
    const origin: FoliaPlaylistOrigin | undefined = options.origin ? { ...options.origin, fromFile: true } : undefined;
    return writeFoliaPlaylists(async write => toSummary(await createWithEntries(write, trimmedName, entries, origin, Date.now())));
};

/** 改名。「我喜欢的音乐」不能改、名字是空的不改、歌单不存在：都返回 null。 */
export const renameFoliaPlaylist = (playlistId: string, name: string): Promise<FoliaPlaylistSummary | null> => {
    const trimmedName = name.trim();
    return writeFoliaPlaylists(async write => {
        const row = await readPlaylistRow(playlistId);
        if (!row || row.isFavorite || !trimmedName) return null;
        const next = { ...row, name: trimmedName, updatedAt: Date.now() };
        await putPlaylistRow(write, next);
        return toSummary(next);
    });
};

export const canDeleteFoliaPlaylist = (playlist: Pick<FoliaPlaylistSummary, 'isFavorite'> | null | undefined): boolean => (
    Boolean(playlist && !playlist.isFavorite)
);

/** 删一张歌单。「我喜欢的音乐」不能删、歌单不存在：返回 false。 */
export const deleteFoliaPlaylist = (playlistId: string): Promise<boolean> => writeFoliaPlaylists(async write => {
    const row = await readPlaylistRow(playlistId);
    if (!row || !canDeleteFoliaPlaylist(row)) return false;
    await deletePlaylistRows(write, playlistId);
    return true;
});

/** 往歌单里加歌（任何来源，一批里可以有多个来源）；同一个 key 已经在里面的不重复加。歌单不存在时 playlist 是 null。 */
export const addSongsToFoliaPlaylist = (
    playlistId: string,
    songs: readonly SongResult[],
): Promise<{ playlist: FoliaPlaylistSummary | null; result: FoliaPlaylistAddResult }> => writeFoliaPlaylists(async write => {
    const row = await readPlaylistRow(playlistId);
    if (!row) return { playlist: null, result: { added: 0, duplicates: 0, rejected: 0 } };
    const now = Date.now();
    // 一批里重复的、舞台歌先在这里筛掉；已经在歌单里的由追加那一步对着库筛。
    const batch = appendFoliaPlaylistEntries([], songs, now);
    const appended = await appendEntryRows(write, row, batch.entries, { now });
    return {
        playlist: toSummary(appended.row),
        result: { added: appended.added, duplicates: batch.result.duplicates + appended.duplicates, rejected: batch.result.rejected },
    };
});

/** 按 key 移除条目。歌单不存在、一条都不在里面：null。 */
export const removeFoliaPlaylistEntries = (playlistId: string, keys: readonly string[]): Promise<FoliaPlaylistSummary | null> => (
    writeFoliaPlaylists(async write => {
        const row = await readPlaylistRow(playlistId);
        const next = row ? await removeEntryRows(write, row, keys) : null;
        return next ? toSummary(next) : null;
    })
);

/**
 * 重排一张歌单里的歌：orderedKeys 是 expectedKeys 的一个排列，expectedKeys 是草稿开始时歌单的顺序。
 * 歌单在这期间被改过（顺序对不上）或不是排列：不写，返回 null。
 */
export const reorderFoliaPlaylistEntries = (
    playlistId: string,
    orderedKeys: readonly string[],
    expectedKeys: readonly string[],
): Promise<FoliaPlaylistSummary | null> => writeFoliaPlaylists(async write => {
    const row = await readPlaylistRow(playlistId);
    const next = row ? await reorderEntryRows(write, row, orderedKeys, expectedKeys) : null;
    return next ? toSummary(next) : null;
});

/** 重排歌单本身的先后：orderedIds 必须是现有歌单 id 的一个排列，否则不写，返回 false。 */
export const reorderFoliaPlaylists = (orderedIds: readonly string[]): Promise<boolean> => (
    writeFoliaPlaylists(write => reorderPlaylistRows(write, orderedIds))
);

// 「我喜欢的音乐」里放进一首（song）或去掉一个 key，在调用方的事务里。没有变化时不写。
const writeFavorite = async (write: FoliaWrite, song: SongResult | null, removeKey: string | null): Promise<FoliaPlaylistSummary | null> => {
    const favorite = await favoriteRow();
    if (!favorite) return null;
    if (song) {
        const now = Date.now();
        return toSummary((await appendEntryRows(write, favorite, appendFoliaPlaylistEntries([], [song], now).entries, { now })).row);
    }
    return toSummary((removeKey ? await removeEntryRows(write, favorite, [removeKey]) : null) ?? favorite);
};

// 红心按一下：在不在是在事务里按主键读那一行，所以连按两下一定是一进一出。
const toggleFavorite = async (write: FoliaWrite, key: string, song: SongResult): Promise<boolean> => {
    const favorite = await favoriteRow();
    if (!favorite) return false;
    const liked = Boolean(await readEntryRow(favorite.id, key));
    await (liked ? writeFavorite(write, null, key) : writeFavorite(write, song, null));
    return !liked;
};

/** 把一首歌（任何来源）放进或移出「我喜欢的音乐」。本地歌用下面的 setLocalSongFavorite。 */
export const setFoliaSongFavorite = (song: SongResult, shouldFavorite: boolean): Promise<FoliaPlaylistSummary | null> => (
    writeFoliaPlaylists(write => (shouldFavorite ? writeFavorite(write, song, null) : writeFavorite(write, null, getPlaybackSongKey(song))))
);

/**
 * 红心按一下：在「我喜欢的音乐」里就移出，不在就放进，返回按完之后在不在。在不在是在事务里读的，
 * 所以连按两下一定是一进一出（界面上那份要等重读，按它算会两下都算成「放进」）。
 */
export const toggleFoliaSongFavorite = (song: SongResult): Promise<boolean> => (
    writeFoliaPlaylists(write => toggleFavorite(write, getPlaybackSongKey(song), song))
);

// ---- 转存平台歌单、从原歌单刷新 ----
// 规则在 utils/foliaPlaylistTransfer.ts。问音源（「对应歌曲」）和读原歌单都在事务外面做完，事务里只把算好的
// 结果套到歌单此刻的条目上：等的那段时间里用户改了歌单（加歌、删歌、重排），改动都还在。

/** 问目标音源「这些歌你有没有对应的」；答案和 songs 一一对应。宿主的装配是 services/onlineMusic/songCounterparts.ts。 */
export type FoliaCounterpartResolver = (
    targetSourceId: string,
    songs: readonly SongResult[],
) => Promise<{
    songs: readonly (SongResult | null)[];
    unavailable?: Exclude<FoliaPlayViaUnavailable, 'failed'>;
    /** 实际拿去问的歌数，和其中因为超时、抛错而没问成的。 */
    asked?: number;
    failed?: number;
}>;

export interface FoliaTransferDeps {
    resolveCounterparts: FoliaCounterpartResolver;
}

/** 用户在读原歌单、问音源的那段时间里取消了：还没动笔，什么都不写。 */
const throwIfTransferAborted = (signal: AbortSignal | undefined): void => {
    if (signal?.aborted) throw new DOMException('The transfer was cancelled', 'AbortError');
};

// 问不成（抛错）不挡住转存或刷新：当成一首都没有。
const askCounterparts = async (
    playVia: string | undefined,
    songs: readonly SongResult[],
    deps: FoliaTransferDeps,
): Promise<{ counterparts: FoliaCounterparts; unavailable?: FoliaPlayViaUnavailable; failed?: number }> => {
    if (!playVia || songs.length === 0) return { counterparts: new Map() };
    try {
        const answer = await deps.resolveCounterparts(playVia, songs);
        // 拿去问的全都没问成（超时、抛错）：和「问了、没有对应的」不是一回事，说出来。
        const allFailed = (answer.asked ?? 0) > 0 && answer.failed === answer.asked;
        const unavailable: FoliaPlayViaUnavailable | undefined = answer.unavailable ?? (allFailed ? 'failed' : undefined);
        // 只问成一部分：没问成的有几首单独记下（它们照原样留着）。
        const failed = !unavailable && (answer.failed ?? 0) > 0 ? answer.failed : undefined;
        return { counterparts: toFoliaCounterparts(songs, answer.songs), ...(unavailable ? { unavailable } : {}), ...(failed ? { failed } : {}) };
    } catch (error) {
        console.warn(`[FoliaPlaylist] Asking "${playVia}" for counterparts failed`, error);
        return { counterparts: new Map(), unavailable: 'failed' };
    }
};

/**
 * 把一张平台歌单转存成 Folia 歌单。歌由调用方读好传进来，顺序就是歌单里的顺序。
 * 选了「改由某个音源播放」（playVia）：逐首问那个音源有没有对应的，有的换成它的歌并记下原来是哪首（originalKey），
 * 没有的照原样存。目标音源问不成（没装、停用、没配好……）时歌单照样建、全部照原样存，原因在结果里。
 * 传进来的歌一首都放不进歌单（全是舞台歌）时不建歌单，抛 FoliaNothingToSaveError。
 */
export const saveCollectionAsFoliaPlaylist = async (
    input: FoliaSaveCollectionInput,
    deps: FoliaTransferDeps,
): Promise<{ playlist: FoliaPlaylistSummary; result: FoliaSaveCollectionResult }> => {
    const trimmedName = input.name.trim();
    if (!trimmedName) throw new Error('Playlist name is empty');
    if (!input.origin.sourceId || !input.origin.collectionId) throw new Error('Playlist origin is incomplete');
    const playVia = input.playVia && input.playVia !== input.origin.sourceId ? input.playVia : undefined;
    const { counterparts, unavailable, failed } = await askCounterparts(playVia, input.songs, deps);
    throwIfTransferAborted(input.signal);
    // 一首都收不进：不建一张空歌单。
    const savable = buildFoliaTransferEntries(input.songs, counterparts);
    if (input.songs.length > 0 && savable.entries.length === 0) throw new FoliaNothingToSaveError(savable.counts.rejected);
    return writeFoliaPlaylists(async write => {
        const now = Date.now();
        const { entries, counts } = buildFoliaTransferEntries(input.songs, counterparts, now);
        // 出处照字段重新拼：自己转存来的歌单不带 fromFile / confirmedAt，「从原歌单更新」不用问。
        const origin: FoliaPlaylistOrigin = {
            sourceId: input.origin.sourceId,
            collectionId: input.origin.collectionId,
            name: input.origin.name,
            savedAt: now,
            ...(playVia ? { playVia } : {}),
            ...(input.origin.collectionType ? { collectionType: input.origin.collectionType } : {}),
            ...(input.origin.collectionData !== undefined ? { collectionData: input.origin.collectionData } : {}),
        };
        const row = await createWithEntries(write, trimmedName, entries, origin, now);
        // 没问成的首数按传进来的条数算，同一首歌出现几次就算几次；落成的条目是去重后的，不让它比「没换的」还多。
        const playViaFailed = Math.min(failed ?? 0, counts.notSwapped);
        return { playlist: toSummary(row), result: { ...counts, ...(unavailable ? { playViaUnavailable: unavailable } : {}), ...(playViaFailed > 0 ? { playViaFailed } : {}) } };
    });
};

/** 歌单的出处是读入的文件说的，用户还没确认过：不去读那张歌单。 */
export class FoliaOriginUnconfirmedError extends Error {
    constructor() {
        super('The origin of this playlist came from a file and has not been confirmed');
        this.name = 'FoliaOriginUnconfirmedError';
    }
}

/**
 * 用户确认了「可以向这个音源读这张歌单」：记在歌单的出处上（confirmedAt），以后「从原歌单更新」不再问。
 * shown 是确认时界面上写给用户看的那个出处：歌单上的出处已经不是它了（歌单被换了、删了）就不记，返回 false。
 * 本来就不用确认的（自己转存来的、确认过的）什么都不写，返回 true。
 */
export const confirmFoliaPlaylistOrigin = (
    playlistId: string,
    shown: Pick<FoliaPlaylistOrigin, 'sourceId' | 'collectionId'>,
): Promise<boolean> => writeFoliaPlaylists(async write => {
    const row = await readPlaylistRow(playlistId);
    if (!row?.origin || row.origin.sourceId !== shown.sourceId || row.origin.collectionId !== shown.collectionId) return false;
    if (!foliaOriginNeedsConfirmation(row.origin)) return true;
    const now = Date.now();
    await putPlaylistRow(write, { ...row, origin: { ...row.origin, confirmedAt: now }, updatedAt: now });
    console.info('[FoliaPlaylist] The user confirmed an origin that came from a file', { playlistId, sourceId: row.origin.sourceId });
    return true;
});

/**
 * 从原歌单刷新一张转存来的歌单。原歌单现在的歌由 fetchOriginSongs 去读（调用方给，读不到就抛错，什么都不写）。
 * 新来的歌按上次选的目标音源（origin.playVia）换；options.playVia 给了就改用它并记下来（null：从此不换）。
 * 歌单不存在、不是转存来的：null。出处是读入的文件说的而用户还没确认过（confirmFoliaPlaylistOrigin）：
 * 抛 FoliaOriginUnconfirmedError，不去读、不写。用户自己加的条目和原歌单里已经没有的歌都留着（规则见 utils/foliaPlaylistTransfer.ts）。
 * 规则是对着全部条目算的，所以这一步在事务里把这张歌单的条目读全；写回去的只是变了的行。
 */
export const refreshFoliaPlaylistFromOrigin = async (
    playlistId: string,
    fetchOriginSongs: (origin: FoliaPlaylistOrigin) => Promise<readonly SongResult[]>,
    deps: FoliaTransferDeps,
    options: { playVia?: string | null; signal?: AbortSignal } = {},
): Promise<{ playlist: FoliaPlaylistSummary; result: FoliaRefreshFromOriginResult } | null> => {
    const before = await getFoliaPlaylistSummary(playlistId);
    const origin = before?.origin;
    if (!before || !origin) return null;
    // 文件说的出处：没确认之前不向那个音源发任何请求。
    if (foliaOriginNeedsConfirmation(origin)) throw new FoliaOriginUnconfirmedError();
    const originSongs = await fetchOriginSongs(origin);
    const chosen = options.playVia === undefined ? origin.playVia : options.playVia ?? undefined;
    const playVia = chosen && chosen !== origin.sourceId ? chosen : undefined;
    if (originSongs.length === 0) {
        return { playlist: before, result: { added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0, originEmpty: true } };
    }
    const { counterparts, unavailable, failed } = await askCounterparts(playVia, originSongs, deps);
    throwIfTransferAborted(options.signal);

    return writeFoliaPlaylists(async write => {
        const row = await readPlaylistRow(playlistId);
        // 等的时候歌单被删了，或被换成了别的来源（不该发生）：不动它。
        if (!row?.origin || row.origin.sourceId !== origin.sourceId || row.origin.collectionId !== origin.collectionId) return null;
        // 出处在这期间变回了没确认的样子（不该发生）：不写。
        if (foliaOriginNeedsConfirmation(row.origin)) return null;
        const now = Date.now();
        const rows = await readEntryRows(playlistId);
        const entries = rows.map(fromEntryRow);
        const refreshed = refreshFoliaPlaylistEntries(entries, originSongs, counterparts, now);
        const { playVia: _playVia, ...originRest } = row.origin;
        const next = await replaceEntryRows(write, row, rows, entries, refreshed.entries, {
            origin: { ...originRest, refreshedAt: now, ...(playVia ? { playVia } : {}) },
            updatedAt: now,
        });
        return { playlist: toSummary(next), result: { ...refreshed.counts, ...(unavailable ? { playViaUnavailable: unavailable } : {}), ...(failed ? { playViaFailed: failed } : {}) } };
    });
};

// ---- 本地曲库这一侧 ----
// 曲库在另一个库里（KineticPlayerDB），和歌单不在一个事务里：先读曲库，再开歌单的事务。两步之间曲库要是删了
// 这首歌，写进去的那一条会在下一次读歌单列表时被修掉（repairLocalEntryRows）。

/** 用曲库里的记录建一张歌单（M3U 导入、从曲库页批量建、把全是本地歌的队列存成歌单）。 */
export const createFoliaPlaylistFromLocalSongs = (name: string, songs: readonly LocalSong[] = []): Promise<FoliaPlaylistSummary> => (
    createFoliaPlaylist(name, songs.map(buildLocalEntrySong))
);

export const addLocalSongsToFoliaPlaylist = (playlistId: string, songs: readonly LocalSong[]) => (
    addSongsToFoliaPlaylist(playlistId, songs.map(buildLocalEntrySong))
);

// 重复导入组里 canonical 的那条（歌单里留的是它）。
const canonicalLocalSongOf = async (song: LocalSong): Promise<LocalSong> => {
    const localSongs = await appDatabase.local_music.toArray();
    const canonicalSongId = resolveCanonicalLocalSongId(song.id, localSongs);
    return localSongs.find(candidate => candidate.id === canonicalSongId) ?? song;
};

/** 本地歌的红心：进或出「我喜欢的音乐」。先换算成重复导入组里 canonical 的那条。 */
export const setLocalSongFavorite = async (song: LocalSong, shouldFavorite: boolean): Promise<FoliaPlaylistSummary | null> => {
    const canonicalSong = await canonicalLocalSongOf(song);
    return writeFoliaPlaylists(write => (
        shouldFavorite
            ? writeFavorite(write, buildLocalEntrySong(canonicalSong), null)
            : writeFavorite(write, null, foliaLocalSongKey(canonicalSong.id))
    ));
};

// ---- 界面这一侧：歌是界面上拿到的（播放用的形状），一批里可以混着各个来源 ----

/**
 * 界面上拿到的歌 → 歌单里存的那份：本地歌换成曲库记录的快照（重复导入的换成 canonical 那条，歌单里留的是它），
 * 别的来源原样。曲库里已经找不到的本地歌不收，计进 missing。
 */
const prepareSongsForFoliaPlaylist = async (songs: readonly SongResult[]): Promise<{ prepared: SongResult[]; missing: number }> => {
    const localIdOf = (song: SongResult) => (song as SongResult & { localRef?: { songId?: string } }).localRef?.songId;
    if (!songs.some(localIdOf)) return { prepared: [...songs], missing: 0 };
    const localSongs = await appDatabase.local_music.toArray();
    const byId = new Map(localSongs.map(song => [song.id, song]));
    const prepared: SongResult[] = [];
    let missing = 0;
    for (const song of songs) {
        const localId = localIdOf(song);
        if (!localId) {
            prepared.push(song);
            continue;
        }
        const record = byId.get(resolveCanonicalLocalSongId(localId, localSongs)) ?? byId.get(localId);
        if (record) prepared.push(buildLocalEntrySong(record));
        else missing += 1;
    }
    return { prepared, missing };
};

/** 收藏框、速记簿、队列往一张歌单里加歌：任何来源，返回加了几首、几首已在里面、几首没收。 */
export const addPickedSongsToFoliaPlaylist = async (
    playlistId: string,
    songs: readonly SongResult[],
): Promise<{ playlist: FoliaPlaylistSummary | null; result: FoliaPlaylistAddResult }> => {
    const { prepared, missing } = await prepareSongsForFoliaPlaylist(songs);
    const { playlist, result } = await addSongsToFoliaPlaylist(playlistId, prepared);
    return { playlist, result: { ...result, rejected: result.rejected + missing } };
};

/** 用界面上拿到的歌新建一张歌单（收藏框的「新建歌单」、把队列存成歌单）。一首都收不进时不建，抛错。 */
export const createFoliaPlaylistFromPickedSongs = async (
    name: string,
    songs: readonly SongResult[],
): Promise<{ playlist: FoliaPlaylistSummary; result: FoliaPlaylistAddResult }> => {
    const { prepared, missing } = await prepareSongsForFoliaPlaylist(songs);
    const counted = appendFoliaPlaylistEntries([], prepared).result;
    if (songs.length > 0 && counted.added === 0) throw new Error('None of the songs can go into a playlist');
    const playlist = await createFoliaPlaylist(name, prepared);
    return { playlist, result: { ...counted, added: playlist.entryCount, rejected: counted.rejected + missing } };
};

/** 本地歌的红心按一下（见 toggleFoliaSongFavorite）：按 canonical 的那条算在不在，返回按完之后在不在。 */
export const toggleLocalSongFavorite = async (song: LocalSong): Promise<boolean> => {
    const canonicalSong = await canonicalLocalSongOf(song);
    return writeFoliaPlaylists(write => toggleFavorite(write, foliaLocalSongKey(canonicalSong.id), buildLocalEntrySong(canonicalSong)));
};

/** 本地曲库删了歌：每张歌单里那一行直接删掉。 */
export const removeDeletedLocalSongsFromFoliaPlaylists = async (songIds: readonly string[]): Promise<void> => {
    if (songIds.length === 0) return;
    await repairLocalEntryRows(songIds);
};
