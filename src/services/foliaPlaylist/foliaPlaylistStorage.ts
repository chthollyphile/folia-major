import Dexie from 'dexie';
import type { FoliaPlaylist, FoliaPlaylistEntry, FoliaPlaylistSummary } from '../../types/foliaPlaylist';
import { getFoliaEntryLocalSongId } from '../../utils/foliaPlaylistEntries';
import { appDatabase } from '../appDatabase';
import { announceFoliaPlaylistsChange, listenFoliaPlaylistsBroadcast } from './foliaPlaylistBroadcast';
import {
    FOLIA_PLAYLISTS_STATE_KEY,
    foliaPlaylistsDatabase as db,
    type FoliaPlaylistEntryRow,
    type FoliaPlaylistRow,
    type FoliaPlaylistsStateRow,
} from './foliaPlaylistDatabase';
import { appendPositions, planReorder, renumberedPositions } from './foliaPlaylistPositions';
import {
    FAVORITE_PLAYLIST_NAME,
    FOLIA_PLAYLISTS_META_KEY,
    FOLIA_PLAYLIST_ROW_PREFIX,
    buildLocalEntry,
    buildLocalRepairIndex,
    createFoliaPlaylistId,
    parseFoliaPlaylistRow,
    parseFoliaPlaylistsMeta,
} from './foliaPlaylistRows';
import { LEGACY_LOCAL_PLAYLISTS_CACHE_KEY, convertLegacyLocalPlaylists } from './localPlaylistMigration';
import { getDuplicateImportSongKey } from './localSongDuplicates';

// src/services/foliaPlaylist/foliaPlaylistStorage.ts
// Folia 聚合歌单在 FoliaPlaylistsDB 里的读写（表的形状见 foliaPlaylistDatabase.ts）。上面一层的
// foliaPlaylistService.ts 是给界面用的操作；这里是它们共用的几样：准备好存储（把旧结构搬过来）、写事务、
// 往一张歌单追加 / 移除 / 重排条目、摘要上的条目数与自动封面、对着曲库修本地歌的条目。
//
// 并发：每个写操作是这个库上的一个读写事务（playlists + entries + meta），要看的现状（歌单在不在、条目在不在、
// 最后一个位置号）都在事务里读。IndexedDB 让同一批表上的读写事务一个接一个跑——同一个窗口里连点、另一个窗口
// （遥控窗口等）同时在写都一样——所以两个写不会互相盖掉，也不会拿到同一个位置号。事务里只等这个库的操作：
// 曲库、音源那边要读的东西先在事务外面读好（等别的库或网络会让事务提前提交）。

/** 这一版写的存储版本。meta.version 比它大：是更新的 Folia 写的，这一版只读不写。 */
export const FOLIA_PLAYLISTS_STORAGE_VERSION = 1;
/** 自动封面只看歌单最前面这么多条。 */
export const FOLIA_COVER_SCAN_ENTRIES = 500;
/** 摘要里最多记这么多首本地歌的 id（自动封面从它们里挑）。 */
export const FOLIA_COVER_LOCAL_SONG_LIMIT = 200;

/** 歌单是更新版本的 Folia 写的，这一版不敢改它。 */
export class FoliaPlaylistsNewerVersionError extends Error {
    constructor() {
        super('Folia playlists were written by a newer version; this version only reads them');
        this.name = 'FoliaPlaylistsNewerVersionError';
    }
}

/**
 * 一次写改了什么：哪些歌单的条目或摘要变了；歌单的增删、先后变了（list）。
 * remote：是别的窗口写的（经 foliaPlaylistBroadcast.ts 传来，几次写可能并成了一次）。all：只知道有改动、
 * 不知道是哪几张（话看不懂、点名太多），听的人把每张都当成变了。本窗口的写两样都没有。
 */
export type FoliaPlaylistsChange = { playlistIds: readonly string[]; list: boolean; remote?: true; all?: true };

const listeners = new Set<(change: FoliaPlaylistsChange) => void>();

const notifyChanged = (change: FoliaPlaylistsChange) => {
    listeners.forEach(listener => {
        try {
            listener(change);
        } catch (error) {
            console.warn('[FoliaPlaylist] A change listener threw', error);
        }
    });
};

let listeningToOtherWindows = false;

/**
 * 歌单被改了就叫一声：本窗口的写操作提交之后，或者别的窗口说它写了（change.remote）。返回取消订阅的函数。
 * 听的人只该去读；别的窗口传来的改动不会再往外传。
 */
export const subscribeFoliaPlaylists = (listener: (change: FoliaPlaylistsChange) => void): (() => void) => {
    listeners.add(listener);
    if (!listeningToOtherWindows) {
        listeningToOtherWindows = true;
        // 只转给本窗口的订阅者（notifyChanged），不经 writeFoliaPlaylists，所以不会再发回频道上。
        listenFoliaPlaylistsBroadcast(change => notifyChanged({
            playlistIds: change.playlistIds,
            list: change.list,
            remote: true,
            ...(change.all ? { all: true as const } : {}),
        }));
    }
    return () => {
        listeners.delete(listener);
    };
};

// ---- 行与对外形状之间 ----

const rangeOf = (playlistId: string): [[string, unknown], [string, unknown]] => [[playlistId, Dexie.minKey], [playlistId, Dexie.maxKey]];

/** 一张歌单的条目行，按歌单里的顺序。 */
const entryRowsInOrder = (playlistId: string) => db.entries.where('[playlistId+pos]').between(...rangeOf(playlistId));

export const toEntryRow = (playlistId: string, entry: FoliaPlaylistEntry, pos: number): FoliaPlaylistEntryRow => {
    const localSongId = getFoliaEntryLocalSongId(entry);
    // 条目上原来带着的这三个字段不信（它们只属于行）。
    const { playlistId: _playlistId, pos: _pos, localSongId: _localSongId, ...rest } = entry as FoliaPlaylistEntryRow;
    return { ...rest, playlistId, pos, ...(localSongId !== null ? { localSongId } : {}) };
};

export const fromEntryRow = (row: FoliaPlaylistEntryRow): FoliaPlaylistEntry => {
    const { playlistId: _playlistId, pos: _pos, localSongId: _localSongId, ...entry } = row;
    return entry;
};

export const toSummary = (row: FoliaPlaylistRow): FoliaPlaylistSummary => {
    const { rank: _rank, coverKey: _coverKey, ...summary } = row;
    return summary;
};

const byRank = (first: FoliaPlaylistRow, second: FoliaPlaylistRow): number => (
    first.rank - second.rank || first.createdAt - second.createdAt || first.id.localeCompare(second.id)
);

// ---- 准备好存储：把旧结构搬过来 ----
// 旧结构是 KineticPlayerDB 的 api_cache 里的行：`folia_playlists_meta`（先后与迁移标记）和一张歌单一行的
// `folia_playlist:<id>`（条目都在这一行里）；更早的是 `local_playlists` 一行（本地歌单）。
// 搬的规则：
// - meta 行里有 importedAt 就不再搬（搬完之后用户删掉的歌单不会被带回来）；
// - 「一张歌单一行」的旧结构：先记一笔「开始搬了」（importStartedAt），然后一张歌单一个事务——事务里先看标记
//   （另一个窗口可能已经搬完了）、再看这张在不在，在就跳过。所以搬到一半断了（关窗口、崩了），下次从头再来，
//   已经搬好的不会重复；全部搬完才写 importedAt。一张一个事务是因为一张歌单可以有几万条，不想把全部歌单
//   压在一个事务里；
// - 更早的 local_playlists：都是本地歌的引用，很小，全部歌单连同 importedAt 在一个事务里写，要么都搬了要么都没搬
//   （那里面没有 id 的歌单每次换算都会拿到新 id，分开搬的话断了重来会重复）；
// - meta 行没了、库里却有歌单（不该发生）：当成搬过了，只把标记补上，不重新搬——重新搬会把用户删掉的歌单带回来。
//   这个判断和补标记在同一个事务里做：另一个窗口正搬到一半时（它先写了 importStartedAt，meta 行在），这边不会
//   误以为标记丢了而把「搬完了」写上去、让那个窗口停手；
// - 搬到一半断了、又回到旧版本改了或删了已经搬过的歌单，再升回来：接着搬的时候已经在的不动，所以那张保持断之前的
//   样子（删掉的还在、改动看不到）。只有「中断之后、搬完之前回旧版本」才会这样，接受；
// - 旧的行只读，搬完不删、不改（旧行留着不影响这一版；清不清由以后的版本定）。
// 搬完之前不放行任何读写（ensureFoliaPlaylistStorage），界面看不到搬了一半的样子。

let readOnly = false;
let ready: Promise<void> | null = null;

const coverOf = (entries: readonly FoliaPlaylistEntry[]): Pick<FoliaPlaylistRow, 'coverUrl' | 'coverKey' | 'coverLocalSongIds'> => {
    const localSongIds: string[] = [];
    let coverUrl: string | undefined;
    let coverKey: string | undefined;
    for (const entry of entries.slice(0, FOLIA_COVER_SCAN_ENTRIES)) {
        const localSongId = getFoliaEntryLocalSongId(entry);
        if (localSongId !== null) {
            if (localSongIds.length < FOLIA_COVER_LOCAL_SONG_LIMIT) localSongIds.push(localSongId);
        } else if (coverUrl === undefined) {
            const url = (entry.song as { album?: { coverUrl?: unknown } } | undefined)?.album?.coverUrl;
            if (typeof url === 'string' && url) {
                coverUrl = url;
                coverKey = entry.key;
            }
        }
    }
    return {
        ...(coverUrl !== undefined ? { coverUrl, coverKey } : {}),
        ...(localSongIds.length > 0 ? { coverLocalSongIds: localSongIds } : {}),
    };
};

/** 一张完整的歌单变成它的摘要行与条目行（搬旧结构、建带着第一批歌的歌单时用）。 */
const rowsOfPlaylist = (playlist: FoliaPlaylist, rank: number): { row: FoliaPlaylistRow; entries: FoliaPlaylistEntryRow[] } => {
    const { entries, ...info } = playlist;
    // 旧行上要是带着这几个字段（不该有），以这里算的为准。
    const { coverUrl: _coverUrl, coverKey: _coverKey, coverLocalSongIds: _coverLocalSongIds, ...rest } = info as FoliaPlaylistRow;
    const positions = renumberedPositions(entries.length);
    return {
        row: { ...rest, rank, entryCount: entries.length, ...coverOf(entries) },
        entries: entries.map((entry, index) => toEntryRow(playlist.id, entry, positions[index])),
    };
};

// 搬一张（在调用方的事务里）：同一个 id 的歌单已经在了就不动它。
const putImportedPlaylist = async (playlist: FoliaPlaylist, rank: number): Promise<void> => {
    if (await db.playlists.get(playlist.id)) return;
    const { row, entries } = rowsOfPlaylist(playlist, rank);
    await db.playlists.put(row);
    await db.entries.bulkPut(entries);
};

// 搬一张，自己一个事务：返回 false 表示标记已经在了（别的窗口搬完了），不用再搬后面的。
const importOnePlaylist = (playlist: FoliaPlaylist, rank: number): Promise<boolean> => (
    db.transaction('rw', db.playlists, db.entries, db.meta, async () => {
        const state = await db.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
        if (state?.importedAt !== undefined) return false;
        await putImportedPlaylist(playlist, rank);
        return true;
    })
);

// 写「搬完了」的标记（在调用方的事务里；已经有了就不动）。
const putImportedMark = async (importedFrom: FoliaPlaylistsStateRow['importedFrom'], importedCount: number): Promise<void> => {
    const state = await db.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
    if (state?.importedAt !== undefined) return;
    await db.meta.put({
        ...state,
        key: FOLIA_PLAYLISTS_STATE_KEY,
        version: FOLIA_PLAYLISTS_STORAGE_VERSION,
        importedAt: Date.now(),
        importedFrom,
        importedCount,
    });
};

const importLegacyStructure = async (): Promise<void> => {
    const cache = appDatabase.api_cache;
    const metaRow = await cache.get(FOLIA_PLAYLISTS_META_KEY);
    const oldMeta = parseFoliaPlaylistsMeta(metaRow?.data);
    const rowKeys = await cache.where(':id').startsWith(FOLIA_PLAYLIST_ROW_PREFIX).primaryKeys();
    let importedFrom: FoliaPlaylistsStateRow['importedFrom'] = 'nothing';
    let importedCount = 0;

    if (rowKeys.length > 0 || typeof oldMeta.localPlaylistsMigratedAt === 'number') {
        // 已经是「一张歌单一行」的结构：一行一行读（不把全部歌单一起读进内存），按旧 meta 里的先后排。
        importedFrom = 'folia-rows';
        await db.transaction('rw', db.playlists, db.entries, db.meta, async () => {
            const state = await db.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
            if (state) return;
            await db.meta.put({ key: FOLIA_PLAYLISTS_STATE_KEY, version: FOLIA_PLAYLISTS_STORAGE_VERSION, importStartedAt: Date.now() });
        });
        const rankOf = new Map(oldMeta.order.map((id, index) => [id, index]));
        for (const rowKey of rowKeys) {
            const playlist = parseFoliaPlaylistRow((await cache.get(rowKey))?.data);
            if (!playlist) {
                // 读不出来的行不搬也不动它，只说一声，方便排查。
                console.warn('[FoliaPlaylist] Skipped an unreadable playlist row', rowKey);
                continue;
            }
            // 旧 meta 没提到的行（不该有）排在后面，彼此按建的时间。
            if (!await importOnePlaylist(playlist, rankOf.get(playlist.id) ?? oldMeta.order.length)) return;
            importedCount += 1;
        }
    } else {
        // 更早的本地歌单（local_playlists 一行）：换算成歌单再搬。那一行只读。
        const legacyRow = await cache.get(LEGACY_LOCAL_PLAYLISTS_CACHE_KEY);
        if (legacyRow) {
            const converted = convertLegacyLocalPlaylists(legacyRow.data, await appDatabase.local_music.toArray());
            const moved = await db.transaction('rw', db.playlists, db.entries, db.meta, async () => {
                const state = await db.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
                if (state?.importedAt !== undefined) return false;
                for (const [index, playlist] of converted.playlists.entries()) await putImportedPlaylist(playlist, index);
                await putImportedMark('local-playlists', converted.playlists.length);
                return true;
            });
            if (moved) {
                console.info('[FoliaPlaylist] Local playlists migrated', {
                    found: Array.isArray(legacyRow.data) ? legacyRow.data.length : 0,
                    migrated: converted.playlists.length,
                    droppedSongs: converted.droppedSongCount,
                    skipped: converted.skippedPlaylistCount,
                });
            }
            return;
        }
    }

    await db.transaction('rw', db.playlists, db.entries, db.meta, async () => putImportedMark(importedFrom, importedCount));
    if (importedCount > 0) console.info('[FoliaPlaylist] Moved playlists into per-entry storage', { from: importedFrom, playlists: importedCount });
};

// 保证有一张「我喜欢的音乐」，排在最前。在事务里看有没有，两个窗口同时启动也只会建出一张。
const ensureFavorite = (): Promise<void> => db.transaction('rw', db.playlists, db.entries, db.meta, async () => {
    const rows = await db.playlists.toArray();
    if (rows.some(row => row.isFavorite)) return;
    const now = Date.now();
    await db.playlists.put({
        id: createFoliaPlaylistId(),
        name: FAVORITE_PLAYLIST_NAME,
        createdAt: now,
        updatedAt: now,
        isFavorite: true,
        rank: rows.reduce((least, row) => Math.min(least, row.rank), 0) - 1,
        entryCount: 0,
    });
});

const prepare = async (): Promise<void> => {
    const state = await db.meta.get(FOLIA_PLAYLISTS_STATE_KEY);
    readOnly = (state?.version ?? FOLIA_PLAYLISTS_STORAGE_VERSION) > FOLIA_PLAYLISTS_STORAGE_VERSION;
    // 更新的版本写的：不搬、不建、不修，只读。
    if (readOnly) return;
    if (state?.importedAt === undefined) {
        // 标记那一行没了、歌单却在（不该发生）：当成搬过了，只补标记。在事务里重新看一遍再定——上面那次读之后
        // 另一个窗口可能刚开始搬（meta 行有了 importStartedAt、第一张歌单也进来了），那不是「标记丢了」。
        const lostMark = await db.transaction('rw', db.playlists, db.entries, db.meta, async () => {
            if (await db.meta.get(FOLIA_PLAYLISTS_STATE_KEY)) return false;
            if (await db.playlists.count() === 0) return false;
            await putImportedMark('nothing', 0);
            return true;
        });
        if (!lostMark) await importLegacyStructure();
    }
    await ensureFavorite();
};

/** 存储准备好（旧结构搬完、有「我喜欢的音乐」）之后才 resolve。每个读写操作都先等它；失败了下次再试。 */
export const ensureFoliaPlaylistStorage = (): Promise<void> => {
    ready ??= prepare().catch((error: unknown) => {
        ready = null;
        throw error;
    });
    return ready;
};

/**
 * 把歌单的存储整个清掉（「清除全部数据」；单测之间）。之后第一次读写会重新准备。
 * keepData：数据留着，只忘掉「已经准备好了」——下一次读写像刚打开应用那样重新准备（单测里模拟重开）。
 */
export const resetFoliaPlaylistStorage = async (options: { keepData?: boolean } = {}): Promise<void> => {
    ready = null;
    readOnly = false;
    if (options.keepData) return;
    await db.delete();
    await db.open();
};

// ---- 写事务 ----

export type FoliaWrite = {
    /** 条目或摘要变了的歌单。 */
    touched: Set<string>;
    /** 歌单的增删、先后变了。 */
    list: boolean;
};

/** 一个写操作：一个读写事务。事务提交之后才叫听的人（本窗口的，和经频道告诉别的窗口的；他们马上去读，读到的就是写完的样子）。 */
export const writeFoliaPlaylists = async <T>(operation: (write: FoliaWrite) => Promise<T>): Promise<T> => {
    await ensureFoliaPlaylistStorage();
    if (readOnly) throw new FoliaPlaylistsNewerVersionError();
    const write: FoliaWrite = { touched: new Set(), list: false };
    // 作用域函数必须本身是 async 函数：Dexie 只在这种时候才跟着原生 await 把事务带下去。写成返回 promise 的普通函数，
    // operation 里隔了两层 async 的读写就落到事务外面去了（不再一个接一个，也不再一起成败）。
    const value = await db.transaction('rw', db.playlists, db.entries, db.meta, async () => operation(write));
    if (write.touched.size > 0 || write.list) {
        const change = { playlistIds: [...write.touched], list: write.list };
        notifyChanged(change);
        // 别的窗口：只说哪几张变了，它们自己去读。
        announceFoliaPlaylistsChange(change);
    }
    return value;
};

export const isFoliaPlaylistStorageReadOnly = (): boolean => readOnly;

/** 摘要行写回去（updatedAt 由调用方定）。 */
export const putPlaylistRow = async (write: FoliaWrite, row: FoliaPlaylistRow): Promise<void> => {
    await db.playlists.put(row);
    write.touched.add(row.id);
};

/** 自动封面要的东西重新找一遍：读歌单最前面的一段。 */
export const withFreshCover = async (row: FoliaPlaylistRow): Promise<FoliaPlaylistRow> => {
    const head = await entryRowsInOrder(row.id).limit(FOLIA_COVER_SCAN_ENTRIES).toArray();
    const { coverUrl: _coverUrl, coverKey: _coverKey, coverLocalSongIds: _coverLocalSongIds, ...rest } = row;
    return { ...rest, ...coverOf(head) };
};

// ---- 读 ----

export const readPlaylistRows = async (): Promise<FoliaPlaylistRow[]> => (await db.playlists.toArray()).sort(byRank);

export const readPlaylistRow = (playlistId: string): Promise<FoliaPlaylistRow | undefined> => db.playlists.get(playlistId);

export const readEntryRows = (playlistId: string): Promise<FoliaPlaylistEntryRow[]> => entryRowsInOrder(playlistId).toArray();

/** 一张歌单里全部条目的 key（不读条目本身；不保证顺序）。 */
export const readEntryKeys = async (playlistId: string): Promise<string[]> => (
    (await db.entries.where('[playlistId+key]').between(...rangeOf(playlistId)).primaryKeys()).map(([, key]) => key)
);

export const readEntryRow = (playlistId: string, key: string): Promise<FoliaPlaylistEntryRow | undefined> => db.entries.get([playlistId, key]);

// 一次问这么多个 key 以内：一个一个按主键查；再多就把这张歌单的 key 全读出来对（一次 getAllKeys，比几千次查找快）。
const EXISTING_KEYS_LOOKUP_LIMIT = 32;

/** keys 里哪些已经在这张歌单里（走主键，不读条目本身）。 */
export const readExistingKeys = async (playlistId: string, keys: readonly string[]): Promise<Set<string>> => {
    if (keys.length === 0) return new Set();
    if (keys.length > EXISTING_KEYS_LOOKUP_LIMIT) {
        const asked = new Set(keys);
        return new Set((await readEntryKeys(playlistId)).filter(key => asked.has(key)));
    }
    const found = await db.entries.where('[playlistId+key]').anyOf(keys.map(key => [playlistId, key])).primaryKeys();
    return new Set(found.map(([, key]) => key));
};

// ---- 改一张歌单的条目（都在调用方的写事务里） ----

/**
 * 把条目追加到歌单最后：已经在里面的（同一个 key）不加。写的只是新加的那几行和摘要那一行。
 * `isNew`：歌单是这个事务里刚建的，里面一定没有，不用查。entries 里的 key 由调用方保证两两不同。
 */
export const appendEntryRows = async (
    write: FoliaWrite,
    row: FoliaPlaylistRow,
    entries: readonly FoliaPlaylistEntry[],
    options: { isNew?: boolean; now?: number } = {},
): Promise<{ row: FoliaPlaylistRow; added: number; duplicates: number }> => {
    const existing = options.isNew ? new Set<string>() : await readExistingKeys(row.id, entries.map(entry => entry.key));
    const fresh = entries.filter(entry => !existing.has(entry.key));
    if (fresh.length === 0) return { row, added: 0, duplicates: entries.length };
    const last = options.isNew ? undefined : await entryRowsInOrder(row.id).last();
    const positions = appendPositions(last?.pos ?? null, fresh.length);
    await db.entries.bulkAdd(fresh.map((entry, index) => toEntryRow(row.id, entry, positions[index])));

    // 新加的落在「最前面一段」里时，自动封面要的东西跟着补（不用回头读）。
    const coverLocalSongIds = [...(row.coverLocalSongIds ?? [])];
    let { coverUrl, coverKey } = row;
    fresh.slice(0, Math.max(0, FOLIA_COVER_SCAN_ENTRIES - row.entryCount)).forEach(entry => {
        const picked = coverOf([entry]);
        if (picked.coverLocalSongIds && coverLocalSongIds.length < FOLIA_COVER_LOCAL_SONG_LIMIT) coverLocalSongIds.push(...picked.coverLocalSongIds);
        if (coverUrl === undefined && picked.coverUrl !== undefined) ({ coverUrl, coverKey } = picked);
    });
    const next: FoliaPlaylistRow = {
        ...row,
        entryCount: row.entryCount + fresh.length,
        updatedAt: options.now ?? Date.now(),
        ...(coverUrl !== undefined ? { coverUrl, coverKey } : {}),
        ...(coverLocalSongIds.length > 0 ? { coverLocalSongIds } : {}),
    };
    await putPlaylistRow(write, next);
    return { row: next, added: fresh.length, duplicates: entries.length - fresh.length };
};

/** 按 key 移除条目：删的只是那几行，再写摘要那一行。一条都不在里面时返回 null（什么都没写）。 */
export const removeEntryRows = async (write: FoliaWrite, row: FoliaPlaylistRow, keys: readonly string[]): Promise<FoliaPlaylistRow | null> => {
    const existing = await readExistingKeys(row.id, [...new Set(keys)]);
    if (existing.size === 0) return null;
    await db.entries.bulkDelete([...existing].map((key): [string, string] => [row.id, key]));
    const counted: FoliaPlaylistRow = { ...row, entryCount: Math.max(0, row.entryCount - existing.size), updatedAt: Date.now() };
    // 移走的可能是自动封面用着的那几条：歌单不大（整张都在「最前面一段」里）或者正好移走了它们，就重找。
    const coverLocalKeys = new Set((row.coverLocalSongIds ?? []).map(songId => `local:${songId}`));
    const touchesCover = row.entryCount <= FOLIA_COVER_SCAN_ENTRIES
        || [...existing].some(key => key === row.coverKey || coverLocalKeys.has(key));
    const next = touchesCover ? await withFreshCover(counted) : counted;
    await putPlaylistRow(write, next);
    return next;
};

/**
 * 重排：orderedKeys 必须是 expectedKeys 的一个排列，而且歌单现在的顺序就是 expectedKeys（草稿没过期）；否则不写，
 * 返回 null。只重写挪了地方的条目（换位置号）；空隙不够时整张重新编号（见 foliaPlaylistPositions.ts）。
 * 核对顺序要每一条现在的位置号，所以这一步把这张歌单的条目读一遍（一次 getAll；位置号在索引的键里，但一次把
 * 索引的键全读出来浏览器没有现成的办法，只能一条一条走游标，比读整行还慢）。读出来的只在这个事务里用。
 */
export const reorderEntryRows = async (
    write: FoliaWrite,
    row: FoliaPlaylistRow,
    orderedKeys: readonly string[],
    expectedKeys: readonly string[],
): Promise<FoliaPlaylistRow | null> => {
    if (orderedKeys.length !== expectedKeys.length) return null;
    const rows = await entryRowsInOrder(row.id).toArray();
    if (rows.length !== expectedKeys.length || rows.some((entry, index) => entry.key !== expectedKeys[index])) return null;
    const known = new Set(expectedKeys);
    if (new Set(orderedKeys).size !== orderedKeys.length || orderedKeys.some(key => !known.has(key))) return null;
    const plan = planReorder(rows.map(entry => ({ key: entry.key, position: entry.pos })), orderedKeys);
    if (plan.positions.size > 0) {
        await db.entries.bulkPut(rows.flatMap((entry) => {
            const pos = plan.positions.get(entry.key);
            return pos === undefined ? [] : [{ ...entry, pos }];
        }));
    }
    const next = await withFreshCover({ ...row, updatedAt: Date.now() });
    await putPlaylistRow(write, next);
    return next;
};

/**
 * 把一张歌单的条目换成 after（「从原歌单更新」用：规则是纯函数，对着全部条目算）。before 是事务里读到的现在的行，
 * after 的前 before.length 条和 before 一一对应（同一个位置上可能换了一条），后面的是新加的。只写变了的行。
 */
export const replaceEntryRows = async (
    write: FoliaWrite,
    row: FoliaPlaylistRow,
    before: readonly FoliaPlaylistEntryRow[],
    beforeEntries: readonly FoliaPlaylistEntry[],
    after: readonly FoliaPlaylistEntry[],
    patch: Partial<FoliaPlaylistRow>,
): Promise<FoliaPlaylistRow> => {
    const drop: Array<[string, string]> = [];
    const put: FoliaPlaylistEntryRow[] = [];
    before.forEach((old, index) => {
        const entry = after[index];
        if (entry === beforeEntries[index]) return;
        if (entry.key !== old.key) drop.push([row.id, old.key]);
        put.push(toEntryRow(row.id, entry, old.pos));
    });
    const appended = after.slice(before.length);
    const positions = appendPositions(before.length > 0 ? before[before.length - 1].pos : null, appended.length);
    appended.forEach((entry, index) => put.push(toEntryRow(row.id, entry, positions[index])));
    // 先删后写：同一批里两条互相换了 key 时不会撞上。
    await db.entries.bulkDelete(drop);
    await db.entries.bulkPut(put);
    const next = await withFreshCover({ ...row, ...patch, entryCount: after.length });
    await putPlaylistRow(write, next);
    return next;
};

/** 建一张歌单（连同第一批条目）。排在最后。 */
export const createPlaylistRows = async (write: FoliaWrite, playlist: FoliaPlaylist): Promise<FoliaPlaylistRow> => {
    const rows = await db.playlists.toArray();
    const { row, entries } = rowsOfPlaylist(playlist, rows.reduce((most, each) => Math.max(most, each.rank), -1) + 1);
    await db.playlists.put(row);
    await db.entries.bulkAdd(entries);
    write.touched.add(row.id);
    write.list = true;
    return row;
};

export const deletePlaylistRows = async (write: FoliaWrite, playlistId: string): Promise<void> => {
    await db.entries.where('[playlistId+key]').between(...rangeOf(playlistId)).delete();
    await db.playlists.delete(playlistId);
    write.touched.add(playlistId);
    write.list = true;
};

/** 歌单之间的先后：orderedIds 必须是现有歌单 id 的一个排列，否则不写，返回 false。只写先后变了的行。 */
export const reorderPlaylistRows = async (write: FoliaWrite, orderedIds: readonly string[]): Promise<boolean> => {
    const rows = await db.playlists.toArray();
    const byId = new Map(rows.map(row => [row.id, row]));
    if (orderedIds.length !== byId.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !byId.has(id))) return false;
    const changed = orderedIds.flatMap((id, index) => {
        const row = byId.get(id) as FoliaPlaylistRow;
        return row.rank === index ? [] : [{ ...row, rank: index }];
    });
    await db.playlists.bulkPut(changed);
    write.list = true;
    return true;
};

// ---- 对着曲库修本地歌的条目 ----

/**
 * 曲库里已经没有的本地歌，它的条目删掉；重复导入的副本换成 canonical 那一条（歌单里已经有 canonical 的，留排在前面
 * 的那个位置）。先只读索引里的键看有没有要修的（歌单里引用了哪些本地歌），没有就什么都不写；要修的时候只读写
 * 那几行。removedSongIds：曲库刚删掉的歌（曲库那边的删除可能还没落盘）。
 */
export const repairLocalEntryRows = async (removedSongIds: readonly string[] = []): Promise<void> => {
    await ensureFoliaPlaylistStorage();
    if (readOnly) return;
    // 歌单里引用了哪些本地歌：读 localSongId 索引指到的主键（一次 getAllKeys，只有本地歌的行在这个索引里），
    // 本地歌的条目 key 里就是歌的 id。不读条目本身。
    const localKeys = await db.entries.orderBy('localSongId').primaryKeys();
    if (localKeys.length === 0) return;
    const referenced = [...new Set(localKeys.flatMap(([, key]) => getFoliaEntryLocalSongId({ key }) ?? []))];
    const { validSongById, canonicalByDuplicateKey } = buildLocalRepairIndex(await appDatabase.local_music.toArray(), removedSongIds);
    const canonicalIdOf = (songId: string): string | null => {
        const song = validSongById.get(songId);
        if (!song) return null;
        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalId = duplicateKey ? canonicalByDuplicateKey.get(duplicateKey) || songId : songId;
        return validSongById.has(canonicalId) ? canonicalId : songId;
    };
    const stale = referenced.filter(songId => canonicalIdOf(songId) !== songId);
    if (stale.length === 0) return;

    await writeFoliaPlaylists(async write => {
        const rows = (await db.entries.where('localSongId').anyOf(stale).toArray()).sort((first, second) => first.pos - second.pos);
        const removedByPlaylist = new Map<string, number>();
        for (const row of rows) {
            const canonicalId = canonicalIdOf(row.localSongId as string);
            const canonicalSong = canonicalId === null ? undefined : validSongById.get(canonicalId);
            await db.entries.delete([row.playlistId, row.key]);
            let removed = 1;
            if (canonicalSong) {
                const replacement = buildLocalEntry(canonicalSong, row.addedAt);
                const existing = await db.entries.get([row.playlistId, replacement.key]);
                // 歌单里已经有 canonical 的那条：留排在前面的那个位置。
                if (!existing || existing.pos > row.pos) {
                    await db.entries.put(toEntryRow(row.playlistId, existing ? fromEntryRow(existing) : replacement, row.pos));
                    removed = existing ? 1 : 0;
                }
            }
            removedByPlaylist.set(row.playlistId, (removedByPlaylist.get(row.playlistId) ?? 0) + removed);
        }
        for (const [playlistId, removed] of removedByPlaylist) {
            const row = await db.playlists.get(playlistId);
            if (!row) continue;
            await putPlaylistRow(write, await withFreshCover({ ...row, entryCount: Math.max(0, row.entryCount - removed) }));
        }
    });
};
