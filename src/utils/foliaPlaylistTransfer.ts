import type { SongResult } from '../types';
import type { FoliaPlaylistEntry, FoliaPlaylistOrigin } from '../types/foliaPlaylist';
import { getPlaybackSongKey, isStagePlaybackSong } from './appPlaybackGuards';
import { toStoredSongSnapshot } from './songSnapshot';

// src/utils/foliaPlaylistTransfer.ts
// 把平台歌单转存成 Folia 歌单、以及之后「从原歌单刷新」的纯规则（不碰数据库、不问音源）。
// 存储在 src/services/foliaPlaylist/foliaPlaylistService.ts；「对应歌曲」是调用方先问好了传进来的
// （counterparts：原歌的 key → 目标音源的那首）。
//
// 条目上的两个标记：
// - fromOrigin：这一条是跟着原歌单来的（转存时带进来，或刷新时加的）。用户自己加进这张歌单的没有它。
// - originalKey：换了音源的条目记着原歌单里是哪首。一条条目在原歌单那边的身份是 `originalKey ?? key`。
//
// 刷新的规则（保守，只加不删）：
// - 原歌单里现在有的歌：歌单里已经有它（按原歌的 key 找，或按它在目标音源的那首的 key 找）就留着那一条，
//   还没换音源、现在能换的顺手换掉；没有的加进来（能换就换）。
// - 认下来的那一条如果是用户自己加的（没有 fromOrigin）：这一次只打上标记，不换音源、不挪位置；
//   从下一次刷新起它才跟着原歌单走。第 1 步存下的旧转存歌单（条目上都没有标记）也是这样过渡的。
// - 原歌单里已经没有的歌：留在歌单里，位置不动，只把 fromOrigin 去掉（从此算用户自己的，不再跟着原歌单）。
// - 用户自己加的条目：原样留着，位置不动。
// - 顺序：原歌单的歌（留下的和新加的）之间按原歌单现在的顺序排，先填跟着原歌单的旧条目原来占的那些位置，填不下的排在最后。
//   歌单里只有原歌单的歌时，结果就是原歌单的顺序。
// - 同一个 key 在歌单里只有一条：换音源会撞上已有条目时不换；新加的歌撞上已有条目时不加。

/**
 * 要转存的集合里一首能放进歌单的都没有（比如全是舞台歌）：不建歌单。`rejected` 是不收的首数。
 */
export class FoliaNothingToSaveError extends Error {
    readonly rejected: number;

    constructor(rejected: number) {
        super('None of the songs can go into a playlist');
        this.name = 'FoliaNothingToSaveError';
        this.rejected = rejected;
    }
}

export interface FoliaTransferCounts {
    /** 换成目标音源来播的条目数。 */
    swapped: number;
    /** 没换的条目数（没有目标音源、目标音源没有对应的、或这首本来就不是能问的来源）。 */
    notSwapped: number;
    /** 传进来的歌里重复的（同一首，或换完之后和别的条目是同一首）。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
}

export interface FoliaRefreshCounts {
    /** 原歌单里新出现、加进歌单的。 */
    added: number;
    /** 这次换成目标音源来播的（新加的和原来没换的都算）。 */
    swapped: number;
    /** 原歌单里已经没有、留在歌单里改算用户自己的。 */
    detached: number;
    /** 原歌单里的歌因为和歌单里已有的条目重复而没加的。 */
    duplicates: number;
    /** 不收的：舞台歌。 */
    rejected: number;
}

export type FoliaCounterparts = ReadonlyMap<string, SongResult>;

/** 一条条目在原歌单那边的身份。 */
export const getFoliaEntryOriginKey = (entry: Pick<FoliaPlaylistEntry, 'key' | 'originalKey'>): string => entry.originalKey ?? entry.key;

/** 调用方问回来的答案（和 songs 一一对应）整理成「原歌的 key → 对应的那首」。 */
export const toFoliaCounterparts = (
    songs: readonly SongResult[],
    answers: readonly (SongResult | null | undefined)[],
): Map<string, SongResult> => {
    const counterparts = new Map<string, SongResult>();
    songs.forEach((song, index) => {
        const answer = answers[index];
        if (!answer || isStagePlaybackSong(song) || isStagePlaybackSong(answer)) return;
        const key = getPlaybackSongKey(song);
        if (getPlaybackSongKey(answer) !== key && !counterparts.has(key)) counterparts.set(key, answer);
    });
    return counterparts;
};

const originEntry = (song: SongResult, counterpart: SongResult | undefined, addedAt: number): FoliaPlaylistEntry => {
    const originKey = getPlaybackSongKey(song);
    return counterpart
        ? { key: getPlaybackSongKey(counterpart), song: toStoredSongSnapshot(counterpart), addedAt, originalKey: originKey, fromOrigin: true }
        : { key: originKey, song: toStoredSongSnapshot(song), addedAt, fromOrigin: true };
};

/** 转存：原歌单的歌按原来的顺序变成条目，有对应的换成目标音源的那首并记下原来是哪首。 */
export const buildFoliaTransferEntries = (
    songs: readonly SongResult[],
    counterparts: FoliaCounterparts = new Map(),
    now: number = Date.now(),
): { entries: FoliaPlaylistEntry[]; counts: FoliaTransferCounts } => {
    const counts: FoliaTransferCounts = { swapped: 0, notSwapped: 0, duplicates: 0, rejected: 0 };
    const entries: FoliaPlaylistEntry[] = [];
    const playKeys = new Set<string>();
    const originKeys = new Set<string>();
    for (const song of songs) {
        if (isStagePlaybackSong(song)) {
            counts.rejected += 1;
            continue;
        }
        const originKey = getPlaybackSongKey(song);
        if (originKeys.has(originKey)) {
            counts.duplicates += 1;
            continue;
        }
        originKeys.add(originKey);
        const counterpart = counterparts.get(originKey);
        // 换过去会和已有条目是同一首（两首原歌对应到同一首）：这首不换，照原样留。
        const swap = counterpart && !playKeys.has(getPlaybackSongKey(counterpart)) ? counterpart : undefined;
        const entry = originEntry(song, swap, now);
        if (playKeys.has(entry.key)) {
            counts.duplicates += 1;
            continue;
        }
        playKeys.add(entry.key);
        entries.push(entry);
        if (swap) counts.swapped += 1;
        else counts.notSwapped += 1;
    }
    return { entries, counts };
};

/** 从原歌单刷新：见文件头的规则。`changed` 为 false 时 entries 就是传进来的那个数组。 */
export const refreshFoliaPlaylistEntries = (
    entries: readonly FoliaPlaylistEntry[],
    originSongs: readonly SongResult[],
    counterparts: FoliaCounterparts = new Map(),
    now: number = Date.now(),
): { entries: FoliaPlaylistEntry[]; counts: FoliaRefreshCounts; changed: boolean } => {
    const counts: FoliaRefreshCounts = { added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0 };
    const indexByOriginKey = new Map<string, number>();
    const indexByKey = new Map<string, number>();
    entries.forEach((entry, index) => {
        // 跟着原歌单来的条目优先：同一首原歌，用户又手动加了一条没换音源的，认原来那条。
        const originKey = getFoliaEntryOriginKey(entry);
        const known = indexByOriginKey.get(originKey);
        if (known === undefined || (entry.fromOrigin && !entries[known].fromOrigin)) indexByOriginKey.set(originKey, index);
        indexByKey.set(entry.key, index);
    });

    // 现在歌单里用着的 key（换音源、加歌之前都要看会不会撞上）。
    const usedKeys = new Set(entries.map(entry => entry.key));
    // 被原歌单里的歌认领了的旧条目：旧下标 → 刷新之后的那一条。
    const claimed = new Map<number, FoliaPlaylistEntry>();
    // 原歌单的顺序：认领的旧条目（记下标）和新加的条目。这一次才认下的用户条目不在里面（它不挪位置）。
    const ordered: Array<{ index: number } | { entry: FoliaPlaylistEntry }> = [];
    const adopted = new Set<number>();
    const seenOriginKeys = new Set<string>();

    for (const song of originSongs) {
        if (isStagePlaybackSong(song)) {
            counts.rejected += 1;
            continue;
        }
        const originKey = getPlaybackSongKey(song);
        if (seenOriginKeys.has(originKey)) continue;
        seenOriginKeys.add(originKey);
        const counterpart = counterparts.get(originKey);
        const counterpartKey = counterpart ? getPlaybackSongKey(counterpart) : null;

        let index = indexByOriginKey.get(originKey);
        if (index !== undefined && claimed.has(index)) index = undefined;
        // 歌单里没有这首原歌，但已经有它在目标音源的那首（用户自己加的）：就认那一条。
        let viaCounterpart = false;
        if (index === undefined && counterpartKey !== null) {
            const other = indexByKey.get(counterpartKey);
            if (other !== undefined && !claimed.has(other)) {
                index = other;
                viaCounterpart = true;
            }
        }

        if (index !== undefined) {
            const old = entries[index];
            let next = old;
            if (!old.fromOrigin) {
                // 用户自己加的条目：只认下来，不换音源、不挪位置。
                next = { ...old, ...(viaCounterpart ? { originalKey: originKey } : {}), fromOrigin: true };
                adopted.add(index);
            } else if (counterpart && counterpartKey !== null && old.originalKey === undefined && !usedKeys.has(counterpartKey)) {
                // 还没换音源、现在能换：换掉，加进歌单的时间不变。
                next = { ...old, key: counterpartKey, song: toStoredSongSnapshot(counterpart), originalKey: originKey, fromOrigin: true };
                usedKeys.delete(old.key);
                usedKeys.add(counterpartKey);
                counts.swapped += 1;
            }
            claimed.set(index, next);
            if (!adopted.has(index)) ordered.push({ index });
            continue;
        }

        const swap = counterpart && counterpartKey !== null && !usedKeys.has(counterpartKey) ? counterpart : undefined;
        const entry = originEntry(song, swap, now);
        if (usedKeys.has(entry.key)) {
            counts.duplicates += 1;
            continue;
        }
        usedKeys.add(entry.key);
        ordered.push({ entry });
        counts.added += 1;
        if (swap) counts.swapped += 1;
    }

    // 认领的旧条目原来占的位置，按原歌单的顺序重新填（新加的也排在这个顺序里）；没被认领的条目位置不动。
    const queue = ordered.map(item => ('index' in item ? claimed.get(item.index) as FoliaPlaylistEntry : item.entry));
    let cursor = 0;
    const next: FoliaPlaylistEntry[] = entries.map((entry, index) => {
        if (adopted.has(index)) return claimed.get(index) as FoliaPlaylistEntry;
        if (claimed.has(index)) {
            const filled = queue[cursor];
            cursor += 1;
            return filled;
        }
        if (!entry.fromOrigin) return entry;
        // 原歌单里已经没有了：留着，改算用户自己的。
        counts.detached += 1;
        const { fromOrigin: _fromOrigin, ...detached } = entry;
        return detached;
    });
    next.push(...queue.slice(cursor));

    const changed = next.length !== entries.length || next.some((entry, index) => entry !== entries[index]);
    return changed ? { entries: next, counts, changed } : { entries: entries as FoliaPlaylistEntry[], counts, changed };
};

/**
 * 这张歌单的出处是不是还要用户确认一次才能拿去「从原歌单更新」：出处是读入的文件说的（fromFile），而且还没确认过。
 * 自己转存来的歌单没有 fromFile，不用问。
 */
export const foliaOriginNeedsConfirmation = (origin: Pick<FoliaPlaylistOrigin, 'fromFile' | 'confirmedAt'> | null | undefined): boolean => (
    Boolean(origin?.fromFile) && !(typeof origin?.confirmedAt === 'number' && origin.confirmedAt > 0)
);
