import type { TFunction } from 'i18next';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { formatNoteAt, type SongNoteRow, type SongNoteTag } from '../../song-notes/songNotesModel';

// src/components/app/scratchpad/commentCards.ts
// 速记簿「评论」页共用的小函数：目录卡上写什么（总览第四行、展开整页）、标签怎么显示。

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
