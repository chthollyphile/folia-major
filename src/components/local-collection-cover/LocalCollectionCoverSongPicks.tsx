import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import { buildLocalSongCoverPicks } from '../../library/core/collection/cover/localCollectionCover';
import { getLocalCoverAssetUrl } from '../../services/localCoverAssetUrl';
import { getSizedCoverUrl } from '../../utils/coverUrl';

// src/components/local-collection-cover/LocalCollectionCoverSongPicks.tsx
// 集合封面对话框里「用一首歌的封面」的列表：集合里每张不同的歌曲封面一行（同一张封面的歌合成一行，记着几首），
// 点一行就用那首歌的封面。没有封面的歌不列。

const THUMBNAIL_SIZE = 256;

type LocalCollectionCoverSongPicksProps = {
    songs: LocalSong[];
    disabled: boolean;
    onPick: (song: LocalSong) => void;
};

const LocalCollectionCoverSongPicks: React.FC<LocalCollectionCoverSongPicksProps> = ({ songs, disabled, onPick }) => {
    const { t } = useTranslation();
    const picks = useMemo(() => buildLocalSongCoverPicks(songs, getLocalCoverAssetUrl, THUMBNAIL_SIZE), [songs]);
    const songsById = useMemo(() => new Map(songs.map(song => [song.id, song])), [songs]);

    return (
        <>
            <div className="mb-2 shrink-0 text-[13px] text-[color:var(--st-t2)]">{t('localCollectionCover.pickSong')}</div>
            {picks.length > 0 ? (
                // The list scrolls; the lines above it stay.
                <div className="st-card st-scroll min-h-0 overflow-y-auto rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]">
                    {picks.map(pick => (
                        <button
                            key={pick.songId}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                                const song = songsById.get(pick.songId);
                                if (song) onPick(song);
                            }}
                            className="st-row st-focus-inside st-t-fast relative flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors enabled:hover:bg-[var(--st-fill)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <img
                                src={getSizedCoverUrl(pick.coverUrl, THUMBNAIL_SIZE)}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="h-10 w-10 shrink-0 rounded-md bg-[var(--st-fill)] object-cover"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm leading-5">{pick.title}</div>
                                <div className="truncate text-xs leading-[18px] text-[color:var(--st-t2)]">
                                    {t('localCollectionCover.songCount', { count: pick.songCount })}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="py-8 text-center text-[13px] text-[color:var(--st-t3)]">{t('localCollectionCover.noSongCovers')}</div>
            )}
        </>
    );
};

export default LocalCollectionCoverSongPicks;
