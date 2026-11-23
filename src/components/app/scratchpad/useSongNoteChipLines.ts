import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAllSongNotes } from '../../song-notes/useSongNotesStore';
import { songNoteChipLine } from './commentCards';

// src/components/app/scratchpad/useSongNoteChipLines.ts
// 速记簿、播放历史、播放队列三页的卡片和行上那一小行（这首的标签与评论数，只是显示）：歌的 key → 那一行字。
// 没写过评论、没打标签的歌不在表里。数据和「时刻」页、首页标签页签同一份（useAllSongNotes，同一个版本只读一次库）。

export const useSongNoteChipLines = (enabled = true): ReadonlyMap<string, string> => {
    const { t } = useTranslation();
    const { rows, tags } = useAllSongNotes(enabled);
    return useMemo(() => {
        const tagMap = new Map(tags.map(tag => [tag.key, tag]));
        const lines = new Map<string, string>();
        for (const row of rows) {
            const line = songNoteChipLine(row, tagMap, t);
            if (line) lines.set(row.key, line);
        }
        return lines;
    }, [rows, t, tags]);
};
