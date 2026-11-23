import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeCard } from '../../library/core/home/homeModel.contract';
import { getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import { getSizedCoverUrl } from '../../utils/coverUrl';
import { useAllSongNotes } from './useSongNotesStore';

// src/components/song-notes/useSongNoteTagCards.ts
// 首页 Folia 组「标签」页签的卡片：一个标签一张（按标签的先后），封面取这个标签下最早打上的那首，写「#标签」和几首。
// 点开去速记簿「时刻」展开整页的那一组（songNoteNavigation 的 openSongNoteTag，调用方接）。网格与 Bravais 共用。

/** 卡片 raw 里带着标签的 key（打开时用）。 */
export type SongNoteTagCardRaw = { songNoteTag: string };

export const songNoteTagOfCard = (card: Pick<LibraryHomeCard, 'raw'>): string | null => {
    const raw = card.raw as Partial<SongNoteTagCardRaw> | undefined;
    return typeof raw?.songNoteTag === 'string' ? raw.songNoteTag : null;
};

/** 卡片封面的边长（px，取最近的一档缩略图）。 */
const COVER_PX = 512;

export const useSongNoteTagCards = (enabled = true): LibraryHomeCard[] => {
    const { t } = useTranslation();
    const { rows, tags } = useAllSongNotes(enabled);
    return useMemo(() => tags.flatMap(tag => {
        const tagged = rows.filter(row => row.tags.includes(tag.key));
        if (tagged.length === 0) return [];
        const first = [...tagged].sort((a, b) => (a.tagAddedAt[tag.key] ?? a.updatedAt) - (b.tagAddedAt[tag.key] ?? b.updatedAt))
            .find(row => getSongCoverUrl(row.song)) ?? tagged[0];
        const cover = getSongCoverUrl(first.song);
        const raw: SongNoteTagCardRaw = { songNoteTag: tag.key };
        return [{
            id: `song-note-tag:${tag.key}`,
            name: `#${tag.name}`,
            type: 'tag',
            coverUrl: cover ? getSizedCoverUrl(cover, COVER_PX) || cover : undefined,
            description: t('home.foliaTagDescription'),
            trackCount: tagged.length,
            raw,
        }];
    }), [rows, t, tags]);
};
