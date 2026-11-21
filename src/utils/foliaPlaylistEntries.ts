import type { SongResult } from '../types';
import type { FoliaPlaylist, FoliaPlaylistAddResult, FoliaPlaylistEntry } from '../types/foliaPlaylist';
import { getPlaybackSongKey, getPlaybackSourceRef, isStagePlaybackSong } from './appPlaybackGuards';
import { toStoredSongSnapshot } from './songSnapshot';

// src/utils/foliaPlaylistEntries.ts
// Folia 聚合歌单条目的纯规则：加歌去重、移除、重排，以及从条目里认出本地歌。存储在 src/services/foliaPlaylist/。

const LOCAL_KEY_PREFIX = 'local:';

/** 本地歌在歌单里的 key（和 getPlaybackSongKey 对本地歌给出的一样）。 */
export const foliaLocalSongKey = (songId: string): string => `${LOCAL_KEY_PREFIX}${songId}`;

/** 条目是本地歌时给出它的 songId，否则 null。 */
export const getFoliaEntryLocalSongId = (entry: Pick<FoliaPlaylistEntry, 'key'>): string | null => (
    entry.key.startsWith(LOCAL_KEY_PREFIX) ? entry.key.slice(LOCAL_KEY_PREFIX.length) : null
);

/** 歌单里的本地歌 id，按歌单里的顺序；别的来源的条目跳过。 */
export const getFoliaPlaylistLocalSongIds = (playlist: Pick<FoliaPlaylist, 'entries'>): string[] => (
    playlist.entries.flatMap(entry => getFoliaEntryLocalSongId(entry) ?? [])
);

/** 条目来自哪里：在线歌是 `online:<音源 id>`，本地、Navidrome 各一种（和速记簿的分组键一样）。 */
export const getFoliaEntrySourceKey = (entry: Pick<FoliaPlaylistEntry, 'song'>): string => {
    const source = getPlaybackSourceRef(entry.song);
    return source.kind === 'online' ? `online:${source.providerId}` : source.kind;
};

/** 把 songs 追加到 entries 后面：已在里面的、舞台歌不收。一批里可以有多个来源。 */
export const appendFoliaPlaylistEntries = (
    entries: readonly FoliaPlaylistEntry[],
    songs: readonly SongResult[],
    now: number = Date.now(),
): { entries: FoliaPlaylistEntry[]; result: FoliaPlaylistAddResult } => {
    const keys = new Set(entries.map(entry => entry.key));
    const next = [...entries];
    const result: FoliaPlaylistAddResult = { added: 0, duplicates: 0, rejected: 0 };
    for (const song of songs) {
        if (isStagePlaybackSong(song)) {
            result.rejected += 1;
            continue;
        }
        const key = getPlaybackSongKey(song);
        if (keys.has(key)) {
            result.duplicates += 1;
            continue;
        }
        keys.add(key);
        next.push({ key, song: toStoredSongSnapshot(song), addedAt: now });
        result.added += 1;
    }
    return { entries: next, result };
};

export const removeFoliaPlaylistEntries = (
    entries: readonly FoliaPlaylistEntry[],
    keys: readonly string[],
): FoliaPlaylistEntry[] => {
    const drop = new Set(keys);
    return entries.filter(entry => !drop.has(entry.key));
};

/**
 * 重排：orderedKeys 必须是 expectedKeys 的一个排列，而且歌单现在的顺序就是 expectedKeys（草稿没过期）；
 * 否则返回 null。这样排序不会加歌、丢歌或弄出重复。
 */
export const reorderFoliaPlaylistEntries = (
    entries: readonly FoliaPlaylistEntry[],
    orderedKeys: readonly string[],
    expectedKeys: readonly string[],
): FoliaPlaylistEntry[] | null => {
    if (entries.length !== expectedKeys.length || entries.some((entry, index) => entry.key !== expectedKeys[index])) {
        return null;
    }
    const byKey = new Map(entries.map(entry => [entry.key, entry]));
    if (orderedKeys.length !== entries.length || new Set(orderedKeys).size !== orderedKeys.length) return null;
    const next: FoliaPlaylistEntry[] = [];
    for (const key of orderedKeys) {
        const entry = byKey.get(key);
        if (!entry) return null;
        next.push(entry);
    }
    return next;
};
