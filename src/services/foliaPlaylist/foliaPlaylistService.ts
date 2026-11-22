import type { LocalSong, SongResult } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistAddResult, FoliaPlaylistOrigin } from '../../types/foliaPlaylist';
import {
    appendFoliaPlaylistEntries,
    foliaLocalSongKey,
    removeFoliaPlaylistEntries as removeEntriesByKey,
    reorderFoliaPlaylistEntries as reorderEntriesByKey,
} from '../../utils/foliaPlaylistEntries';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { appDatabase } from '../appDatabase';
import {
    FAVORITE_PLAYLIST_NAME,
    FOLIA_PLAYLISTS_META_KEY,
    FOLIA_PLAYLISTS_VERSION,
    FOLIA_PLAYLIST_ROW_PREFIX,
    buildLocalEntrySong,
    buildLocalRepairIndex,
    createFoliaPlaylistId,
    foliaPlaylistRowKey,
    orderFoliaPlaylists,
    parseFoliaPlaylistRow,
    parseFoliaPlaylistsMeta,
    repairLocalEntries,
    type FoliaPlaylistsMeta,
} from './foliaPlaylistRows';
import { LEGACY_LOCAL_PLAYLISTS_CACHE_KEY, convertLegacyLocalPlaylists } from './localPlaylistMigration';
import { resolveCanonicalLocalSongId } from './localSongDuplicates';

// src/services/foliaPlaylist/foliaPlaylistService.ts
// Folia 聚合歌单的读写。存的形状见 foliaPlaylistRows.ts。
// 每个操作都在一个 api_cache + local_music 的读写事务里做完（读、修补、改、写），IndexedDB 让同一张表上的读写事务
// 一个接一个跑，所以并发的写（连点红心、两个窗口）不会互相盖掉。事务里只等数据库的操作，不等别的。
// 第一次读的时候把旧的本地歌单并进来（localPlaylistMigration.ts），并保证有一张「我喜欢的音乐」。

type PlaylistState = {
    meta: FoliaPlaylistsMeta;
    /** meta 那一行里这个版本不认识的字段：写回去时原样带上。 */
    metaExtras: Record<string, unknown>;
    playlists: FoliaPlaylist[];
    /** 这次事务里写过东西。 */
    dirty: boolean;
    /** 存的是更新的版本写的（meta.version 比这一版认识的大）：只读，不迁移、不修补、不写。 */
    readOnly: boolean;
};

/** 歌单是更新版本的 Folia 写的，这一版不敢改它。 */
export class FoliaPlaylistsNewerVersionError extends Error {
    constructor() {
        super('Folia playlists were written by a newer version; this version only reads them');
        this.name = 'FoliaPlaylistsNewerVersionError';
    }
}

const assertWritable = (state: PlaylistState): void => {
    if (state.readOnly) throw new FoliaPlaylistsNewerVersionError();
};

const table = () => appDatabase.api_cache;

const listeners = new Set<() => void>();

/** 歌单被改了（本窗口里的写操作提交之后）就叫一声；返回取消订阅的函数。 */
export const subscribeFoliaPlaylists = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const notifyChanged = () => {
    listeners.forEach(listener => {
        try {
            listener();
        } catch (error) {
            console.warn('[FoliaPlaylist] A change listener threw', error);
        }
    });
};

const writePlaylist = async (state: PlaylistState, playlist: FoliaPlaylist): Promise<void> => {
    assertWritable(state);
    await table().put({ key: foliaPlaylistRowKey(playlist.id), data: playlist, timestamp: Date.now() });
    state.dirty = true;
};

const writeMeta = async (state: PlaylistState): Promise<void> => {
    assertWritable(state);
    state.meta = { ...state.meta, order: state.playlists.map(playlist => playlist.id) };
    await table().put({ key: FOLIA_PLAYLISTS_META_KEY, data: { ...state.metaExtras, ...state.meta }, timestamp: Date.now() });
    state.dirty = true;
};

// 旧的本地歌单并进来：只在还没有任何歌单行、meta 里也没有迁移标记时做一次（见 readState）。
// 整个在调用方的事务里：中途出错事务回滚，什么都没写，下次再试；旧的那一行只读。
const migrateLocalPlaylists = async (state: PlaylistState): Promise<void> => {
    const legacyRow = await table().get(LEGACY_LOCAL_PLAYLISTS_CACHE_KEY);
    const localSongs = legacyRow ? await appDatabase.local_music.toArray() : [];
    const converted = convertLegacyLocalPlaylists(legacyRow?.data, localSongs);
    let migrated = 0;
    for (const playlist of converted.playlists) {
        state.playlists.push(playlist);
        await writePlaylist(state, playlist);
        migrated += 1;
    }
    state.meta = { ...state.meta, localPlaylistsMigratedAt: Date.now(), localPlaylistsMigratedCount: migrated };
    await writeMeta(state);
    console.info('[FoliaPlaylist] Local playlists migrated', {
        found: Array.isArray(legacyRow?.data) ? legacyRow.data.length : 0,
        migrated,
        droppedSongs: converted.droppedSongCount,
        skipped: converted.skippedPlaylistCount,
    });
};

const readState = async (): Promise<PlaylistState> => {
    const metaRow = await table().get(FOLIA_PLAYLISTS_META_KEY);
    const meta = parseFoliaPlaylistsMeta(metaRow?.data);
    const metaExtras = metaRow?.data && typeof metaRow.data === 'object' ? { ...(metaRow.data as Record<string, unknown>) } : {};
    const rows = await table().where(':id').startsWith(FOLIA_PLAYLIST_ROW_PREFIX).toArray();
    const playlists = orderFoliaPlaylists(
        rows.flatMap(row => {
            const playlist = parseFoliaPlaylistRow(row.data);
            // 读不出来的行不动它（不删、不改），只说一声，方便排查。
            if (!playlist) console.warn('[FoliaPlaylist] Skipped an unreadable playlist row', row.key);
            return playlist ?? [];
        }),
        meta.order,
    );
    const readOnly = meta.version > FOLIA_PLAYLISTS_VERSION;
    const state: PlaylistState = { meta, metaExtras, playlists, dirty: false, readOnly };
    if (readOnly) return state;

    if (typeof meta.localPlaylistsMigratedAt !== 'number') {
        if (rows.length > 0) {
            // 迁移、建「我喜欢的音乐」和写标记是同一个事务：已经有歌单行却没有标记，只能是 meta 那一行坏了或丢了。
            // 这时不再迁（再迁会把迁移之后用户删掉的旧歌单又带回来），只把标记补上；顺序按建的时间。
            console.warn('[FoliaPlaylist] The meta row was lost or damaged; restored it without migrating again');
            state.meta = { ...state.meta, localPlaylistsMigratedAt: Date.now() };
            await writeMeta(state);
        } else {
            await migrateLocalPlaylists(state);
        }
    }

    if (!state.playlists.some(playlist => playlist.isFavorite)) {
        const now = Date.now();
        const favorite: FoliaPlaylist = {
            id: createFoliaPlaylistId(),
            name: FAVORITE_PLAYLIST_NAME,
            createdAt: now,
            updatedAt: now,
            isFavorite: true,
            entries: [],
        };
        state.playlists.unshift(favorite);
        await writePlaylist(state, favorite);
        await writeMeta(state);
    }

    return state;
};

// 本地歌的条目对着曲库修一遍（删掉曲库里没有的、重复导入的副本换成 canonical），改了的歌单写回去。
const repairAgainstLocalLibrary = async (state: PlaylistState, removedSongIds: readonly string[] = []): Promise<void> => {
    if (state.readOnly) return;
    const hasLocalEntries = state.playlists.some(playlist => playlist.entries.some(entry => entry.key.startsWith('local:')));
    if (!hasLocalEntries) return;
    const { validSongById, canonicalByDuplicateKey } = buildLocalRepairIndex(await appDatabase.local_music.toArray(), removedSongIds);
    for (let index = 0; index < state.playlists.length; index += 1) {
        const playlist = state.playlists[index];
        const repaired = repairLocalEntries(playlist.entries, validSongById, canonicalByDuplicateKey);
        if (!repaired.changed) continue;
        const next = { ...playlist, entries: repaired.entries };
        state.playlists[index] = next;
        await writePlaylist(state, next);
    }
};

const withPlaylistTransaction = async <T>(operation: (state: PlaylistState) => Promise<T> | T): Promise<T> => {
    const { value, dirty } = await appDatabase.transaction('rw', appDatabase.api_cache, appDatabase.local_music, async () => {
        const state = await readState();
        const result = await operation(state);
        return { value: result, dirty: state.dirty };
    });
    // 事务提交之后才叫：听的人马上去读，读到的就是写完的样子。
    if (dirty) notifyChanged();
    return value;
};

// 改一张歌单：updater 返回 null 表示不改。
const updatePlaylist = (
    playlistId: string,
    updater: (playlist: FoliaPlaylist) => FoliaPlaylist | null,
): Promise<FoliaPlaylist | null> => withPlaylistTransaction(async state => {
    const index = state.playlists.findIndex(playlist => playlist.id === playlistId);
    if (index === -1) return null;
    const update = updater(state.playlists[index]);
    if (!update) return null;
    const next = { ...update, updatedAt: Date.now() };
    state.playlists[index] = next;
    await writePlaylist(state, next);
    return next;
});

/** 全部歌单，按显示的先后（「我喜欢的音乐」一定有）。读的时候顺手把本地歌的条目对着曲库修一遍。 */
export const getFoliaPlaylists = (): Promise<FoliaPlaylist[]> => withPlaylistTransaction(async state => {
    await repairAgainstLocalLibrary(state);
    return state.playlists;
});

export const getFoliaPlaylist = (playlistId: string): Promise<FoliaPlaylist | null> => withPlaylistTransaction(state => (
    state.playlists.find(playlist => playlist.id === playlistId) ?? null
));

export const getFavoriteFoliaPlaylist = (): Promise<FoliaPlaylist> => withPlaylistTransaction(state => (
    // readState 保证了有。
    state.playlists.find(playlist => playlist.isFavorite) as FoliaPlaylist
));

/** 建一张歌单，可以带上第一批歌（任何来源，一批里可以有多个来源）。名字是空的会抛错。 */
export const createFoliaPlaylist = (
    name: string,
    songs: readonly SongResult[] = [],
    options: { origin?: FoliaPlaylistOrigin } = {},
): Promise<FoliaPlaylist> => {
    const trimmedName = name.trim();
    // 在事务外面就拒绝：事务里抛错会连同这次读到的迁移一起回滚。
    if (!trimmedName) return Promise.reject(new Error('Playlist name is empty'));
    return withPlaylistTransaction(async state => {
        const now = Date.now();
        const playlist: FoliaPlaylist = {
            id: createFoliaPlaylistId(),
            name: trimmedName,
            createdAt: now,
            updatedAt: now,
            ...(options.origin ? { origin: options.origin } : {}),
            entries: appendFoliaPlaylistEntries([], songs, now).entries,
        };
        state.playlists.push(playlist);
        await writePlaylist(state, playlist);
        await writeMeta(state);
        return playlist;
    });
};

/** 改名。「我喜欢的音乐」不能改、名字是空的不改、歌单不存在：都返回 null。 */
export const renameFoliaPlaylist = (playlistId: string, name: string): Promise<FoliaPlaylist | null> => {
    const trimmedName = name.trim();
    return updatePlaylist(playlistId, playlist => (
        playlist.isFavorite || !trimmedName ? null : { ...playlist, name: trimmedName }
    ));
};

export const canDeleteFoliaPlaylist = (playlist: Pick<FoliaPlaylist, 'isFavorite'> | null | undefined): boolean => (
    Boolean(playlist && !playlist.isFavorite)
);

/** 删一张歌单。「我喜欢的音乐」不能删、歌单不存在：返回 false。 */
export const deleteFoliaPlaylist = (playlistId: string): Promise<boolean> => withPlaylistTransaction(async state => {
    const target = state.playlists.find(playlist => playlist.id === playlistId);
    if (!target || !canDeleteFoliaPlaylist(target)) return false;
    state.playlists = state.playlists.filter(playlist => playlist.id !== playlistId);
    await table().delete(foliaPlaylistRowKey(playlistId));
    await writeMeta(state);
    return true;
});

/** 往歌单里加歌（任何来源，一批里可以有多个来源）；同一个 key 已经在里面的不重复加。歌单不存在时 playlist 是 null。 */
export const addSongsToFoliaPlaylist = async (
    playlistId: string,
    songs: readonly SongResult[],
): Promise<{ playlist: FoliaPlaylist | null; result: FoliaPlaylistAddResult }> => {
    let result: FoliaPlaylistAddResult = { added: 0, duplicates: 0, rejected: 0 };
    let current: FoliaPlaylist | null = null;
    const updated = await updatePlaylist(playlistId, playlist => {
        current = playlist;
        const appended = appendFoliaPlaylistEntries(playlist.entries, songs);
        result = appended.result;
        return appended.result.added > 0 ? { ...playlist, entries: appended.entries } : null;
    });
    return { playlist: updated ?? current, result };
};

/** 按 key 移除条目。 */
export const removeFoliaPlaylistEntries = (playlistId: string, keys: readonly string[]): Promise<FoliaPlaylist | null> => (
    updatePlaylist(playlistId, playlist => {
        const entries = removeEntriesByKey(playlist.entries, keys);
        return entries.length === playlist.entries.length ? null : { ...playlist, entries };
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
): Promise<FoliaPlaylist | null> => updatePlaylist(playlistId, playlist => {
    const entries = reorderEntriesByKey(playlist.entries, orderedKeys, expectedKeys);
    return entries ? { ...playlist, entries } : null;
});

/** 重排歌单本身的先后：orderedIds 必须是现有歌单 id 的一个排列，否则不写，返回 false。 */
export const reorderFoliaPlaylists = (orderedIds: readonly string[]): Promise<boolean> => withPlaylistTransaction(async state => {
    const byId = new Map(state.playlists.map(playlist => [playlist.id, playlist]));
    if (orderedIds.length !== byId.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !byId.has(id))) {
        return false;
    }
    state.playlists = orderedIds.map(id => byId.get(id) as FoliaPlaylist);
    await writeMeta(state);
    return true;
});

// 「我喜欢的音乐」里加一首或去掉一个 key，在调用方的事务里。没有变化时不写。
const writeFavorite = async (state: PlaylistState, song: SongResult | null, removeKey: string | null): Promise<FoliaPlaylist | null> => {
    const index = state.playlists.findIndex(playlist => playlist.isFavorite);
    if (index === -1) return null;
    const favorite = state.playlists[index];
    const entries = song
        ? appendFoliaPlaylistEntries(favorite.entries, [song]).entries
        : removeEntriesByKey(favorite.entries, removeKey ? [removeKey] : []);
    if (entries.length === favorite.entries.length) return favorite;
    const next = { ...favorite, entries, updatedAt: Date.now() };
    state.playlists[index] = next;
    await writePlaylist(state, next);
    return next;
};

/** 把一首歌（任何来源）放进或移出「我喜欢的音乐」。本地歌用下面的 setLocalSongFavorite。 */
export const setFoliaSongFavorite = (song: SongResult, shouldFavorite: boolean): Promise<FoliaPlaylist | null> => (
    withPlaylistTransaction(state => (
        shouldFavorite ? writeFavorite(state, song, null) : writeFavorite(state, null, getPlaybackSongKey(song))
    ))
);

// ---- 本地曲库这一侧 ----

/** 用曲库里的记录建一张歌单（M3U 导入、从曲库页批量建、把全是本地歌的队列存成歌单）。 */
export const createFoliaPlaylistFromLocalSongs = (name: string, songs: readonly LocalSong[] = []): Promise<FoliaPlaylist> => (
    createFoliaPlaylist(name, songs.map(buildLocalEntrySong))
);

export const addLocalSongsToFoliaPlaylist = (playlistId: string, songs: readonly LocalSong[]) => (
    addSongsToFoliaPlaylist(playlistId, songs.map(buildLocalEntrySong))
);

/**
 * 本地歌的红心：进或出「我喜欢的音乐」。先换算成重复导入组里 canonical 的那条（歌单里留的是它）。
 * 读曲库、找歌单、写在同一个事务里。
 */
export const setLocalSongFavorite = (song: LocalSong, shouldFavorite: boolean): Promise<FoliaPlaylist | null> => (
    withPlaylistTransaction(async state => {
        const localSongs = await appDatabase.local_music.toArray();
        const canonicalSongId = resolveCanonicalLocalSongId(song.id, localSongs);
        const canonicalSong = localSongs.find(candidate => candidate.id === canonicalSongId) ?? song;
        return shouldFavorite
            ? writeFavorite(state, buildLocalEntrySong(canonicalSong), null)
            : writeFavorite(state, null, foliaLocalSongKey(canonicalSongId));
    })
);

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
): Promise<{ playlist: FoliaPlaylist | null; result: FoliaPlaylistAddResult }> => {
    const { prepared, missing } = await prepareSongsForFoliaPlaylist(songs);
    const { playlist, result } = await addSongsToFoliaPlaylist(playlistId, prepared);
    return { playlist, result: { ...result, rejected: result.rejected + missing } };
};

/** 用界面上拿到的歌新建一张歌单（收藏框的「新建歌单」、把队列存成歌单）。一首都收不进时不建，抛错。 */
export const createFoliaPlaylistFromPickedSongs = async (
    name: string,
    songs: readonly SongResult[],
): Promise<{ playlist: FoliaPlaylist; result: FoliaPlaylistAddResult }> => {
    const { prepared, missing } = await prepareSongsForFoliaPlaylist(songs);
    const counted = appendFoliaPlaylistEntries([], prepared).result;
    if (songs.length > 0 && counted.added === 0) throw new Error('None of the songs can go into a playlist');
    const playlist = await createFoliaPlaylist(name, prepared);
    return { playlist, result: { ...counted, added: playlist.entries.length, rejected: counted.rejected + missing } };
};

/** 本地曲库删了歌：每张歌单里那一行直接删掉。 */
export const removeDeletedLocalSongsFromFoliaPlaylists = async (songIds: readonly string[]): Promise<void> => {
    if (songIds.length === 0) return;
    await withPlaylistTransaction(state => repairAgainstLocalLibrary(state, songIds));
};
