import type { TFunction } from 'i18next';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { formatNoteAt, type SongNoteRow, type SongNoteTag } from '../../song-notes/songNotesModel';

// src/components/app/scratchpad/commentCards.ts
// 速记簿「时刻」页共用的小函数：目录卡上写什么（总览第四行、展开整页）、标签怎么显示、展开整页怎么按标签分组，
// 以及另外三页卡片上那一小行标签。

/** 一个标签显示成什么：有写法用写法，没有（标签表里丢了）就用 key。 */
export const tagLabel = (key: string, tags: ReadonlyMap<string, SongNoteTag>): string => tags.get(key)?.name ?? key;

/** 计数：「3 条」，挂着时刻的另写「· 2 处」。 */
export const commentCountsLabel = (row: Pick<SongNoteRow, 'commentCount' | 'timedCount'>, t: TFunction): string => {
    const parts = [t('songNotes.commentCount', { count: row.commentCount })];
    if (row.timedCount > 0) parts.push(t('songNotes.timedCount', { count: row.timedCount }));
    return parts.join(' · ');
};

/** 目录卡上的字：歌手、前两个标签、最新一条评论（只是一道刻痕时写「标记在 01:47」）、计数。 */
export const catalogCardFields = (row: SongNoteRow, tags: ReadonlyMap<string, SongNoteTag>, t: TFunction) => {
    const latest = row.latestComment;
    const quote = latest?.text || (latest?.at !== undefined ? t('songNotes.markOnly', { at: formatNoteAt(latest.at) }) : '');
    return {
        meta: getSongArtistLabel(row.song),
        tagLine: row.tags.slice(0, 2).map(key => `#${tagLabel(key, tags)}`).join('  '),
        quote,
        counts: row.commentCount > 0 ? commentCountsLabel(row, t) : t('songNotes.tagsOnly', { count: row.tags.length }),
    };
};

/** 「未加标签」那一组的 key（标签的 key 是规整后的小写字，不会以 \u0000 开头）。 */
export const UNTAGGED_GROUP_KEY = '\u0000untagged';

/** 展开整页里的一组：一个标签（tagKey 为 null 的是「未加标签」）和这组里的歌。 */
export type SongNoteTagGroup = { key: string; tagKey: string | null; name: string; rows: SongNoteRow[] };

/**
 * 按标签分组：标签按先后（标签表里丢了的排在最后，用 key 当名字），组里的歌按打上这个标签的先后（用户定：不能手动排）；
 * 一首歌有几个标签就出现在几组里。没打标签的歌放在最后一组，新评论过的在前。matches 给了就只留搜到的歌，空组不要。
 */
export const buildSongNoteTagGroups = (
    rows: readonly SongNoteRow[],
    tags: readonly SongNoteTag[],
    matches: ReadonlySet<string> | null,
    untaggedName: string,
): SongNoteTagGroup[] => {
    const kept = matches ? rows.filter(row => matches.has(row.key)) : [...rows];
    const byTag = new Map<string, SongNoteRow[]>();
    const untagged: SongNoteRow[] = [];
    for (const row of kept) {
        if (row.tags.length === 0) untagged.push(row);
        for (const key of row.tags) {
            const list = byTag.get(key);
            if (list) list.push(row);
            else byTag.set(key, [row]);
        }
    }
    const known = new Set(tags.map(tag => tag.key));
    const order = [...tags.map(tag => ({ key: tag.key, name: tag.name })), ...[...byTag.keys()].filter(key => !known.has(key)).map(key => ({ key, name: key }))];
    const groups: SongNoteTagGroup[] = [];
    for (const tag of order) {
        const list = byTag.get(tag.key);
        if (!list || list.length === 0) continue;
        const sorted = [...list].sort((a, b) => (a.tagAddedAt[tag.key] ?? a.updatedAt) - (b.tagAddedAt[tag.key] ?? b.updatedAt));
        groups.push({ key: tag.key, tagKey: tag.key, name: tag.name, rows: sorted });
    }
    if (untagged.length > 0) {
        groups.push({ key: UNTAGGED_GROUP_KEY, tagKey: null, name: untaggedName, rows: [...untagged].sort((a, b) => b.updatedAt - a.updatedAt) });
    }
    return groups;
};

/** 另外三页卡片、行上的那一小行：前两个标签、评论数（「#夜车 #City Pop · 3 条」）。没写过评论、没打标签的歌是空的。 */
export const songNoteChipLine = (row: SongNoteRow | undefined, tags: ReadonlyMap<string, SongNoteTag>, t: TFunction): string => {
    if (!row) return '';
    const parts = row.tags.slice(0, 2).map(key => `#${tagLabel(key, tags)}`);
    if (row.tags.length > 2) parts.push(`+${row.tags.length - 2}`);
    const head = parts.join(' ');
    if (row.commentCount === 0) return head;
    const count = t('songNotes.commentCount', { count: row.commentCount });
    return head ? `${head} · ${count}` : count;
};
