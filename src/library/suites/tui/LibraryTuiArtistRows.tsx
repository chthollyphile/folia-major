import React from 'react';
import type { RowComponentProps } from 'react-window';
import type { SongResult } from '../../../types';
import type { LibraryArtistAlbum } from '../../core/artist/artist.contract';
import type { TrackArtistLink } from '../../core/shared/trackLinks';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { formatTime } from '../../../utils/appPlaybackHelpers';

// src/library/suites/tui/LibraryTuiArtistRows.tsx
// TUI 歌手页的两种行：热门歌曲（序号、歌名、歌手、专辑、时长、[+]）与专辑（名字、年份）。等宽排列，单击移动焦点，
// 双击播放 / 打开；歌曲行上的歌手名与专辑名在能解析出目录引用时是按钮，点了打开嵌套的歌手页 / 专辑。

export const LIBRARY_TUI_ARTIST_ROW_HEIGHT = 28;
export const LIBRARY_TUI_ARTIST_SONG_COLUMNS = 'grid-cols-[2ch_4ch_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_6ch_4ch]';
export const LIBRARY_TUI_ARTIST_ALBUM_COLUMNS = 'grid-cols-[2ch_6ch_minmax(0,1fr)_6ch]';

const cell = 'truncate whitespace-pre';
const linkClass = 'hover:underline hover:opacity-100';

/** 一首热门歌曲在行上要显示的东西（链接由调用方按「声明 ∩ 能力」与目录引用规则算好）。 */
export type LibraryTuiArtistSongRowProps = {
    song: SongResult;
    index: number;
    entryKey: string;
    isFocused: boolean;
    accentBackground: string;
    accentColor: string;
    enqueueLabel: string;
    unavailableLabel: string;
    videoLabel: string;
    artistLinks: TrackArtistLink[];
    /** 能打开专辑时给出打开它的回调。 */
    onOpenAlbum?: () => void;
    onOpenArtist?: (link: TrackArtistLink) => void;
    onFocus: () => void;
    onPlay: () => void;
    onEnqueue?: () => void;
};

export const LibraryTuiArtistSongRow: React.FC<LibraryTuiArtistSongRowProps> = ({
    song,
    index,
    entryKey,
    isFocused,
    accentBackground,
    accentColor,
    enqueueLabel,
    unavailableLabel,
    videoLabel,
    artistLinks,
    onOpenAlbum,
    onOpenArtist,
    onFocus,
    onPlay,
    onEnqueue,
}) => {
    const unavailable = isSongUnavailable(song);
    const tag = unavailable ? unavailableLabel : song.isVideo ? videoLabel : '';
    return (
        <div
            role="option"
            aria-selected={isFocused}
            data-tui-artist-song={index}
            data-library-entry={entryKey}
            style={{
                height: LIBRARY_TUI_ARTIST_ROW_HEIGHT,
                backgroundColor: isFocused ? accentBackground : undefined,
                opacity: unavailable ? 0.45 : undefined,
            }}
            onClick={onFocus}
            onDoubleClick={onPlay}
            className={`grid cursor-default select-none ${LIBRARY_TUI_ARTIST_SONG_COLUMNS} items-center gap-x-3 px-4 text-[13px]`}
        >
            <span style={{ color: isFocused ? accentColor : undefined }}>{isFocused ? '>' : ' '}</span>
            <span className="tabular-nums opacity-50">{String(index + 1).padStart(2, '0')}</span>
            <span className={cell}>
                {song.name}
                {tag ? <span className="opacity-70">{`  (${tag})`}</span> : null}
            </span>
            <span className={`${cell} opacity-70`}>
                {artistLinks.map((link, linkIndex) => (
                    <React.Fragment key={`${link.artist.id ?? 'artist'}-${linkIndex}`}>
                        {linkIndex > 0 ? ', ' : ''}
                        {link.targetId !== undefined && onOpenArtist ? (
                            <button
                                type="button"
                                data-tui-link="artist"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenArtist(link);
                                }}
                                className={linkClass}
                            >
                                {link.artist.name}
                            </button>
                        ) : link.artist.name}
                    </React.Fragment>
                ))}
            </span>
            <span className={`${cell} opacity-55`}>
                {onOpenAlbum ? (
                    <button
                        type="button"
                        data-tui-link="album"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenAlbum();
                        }}
                        className={linkClass}
                    >
                        {song.album?.name || ''}
                    </button>
                ) : song.album?.name || ''}
            </span>
            <span className="tabular-nums opacity-55">{formatTime((song.durationMs || 0) / 1000)}</span>
            <span>
                {onEnqueue ? (
                    <button
                        type="button"
                        title={enqueueLabel}
                        aria-label={enqueueLabel}
                        onClick={(event) => {
                            event.stopPropagation();
                            onEnqueue();
                        }}
                        className="opacity-50 hover:opacity-100 disabled:opacity-20"
                        disabled={unavailable}
                    >
                        [+]
                    </button>
                ) : null}
            </span>
        </div>
    );
};

/** 专辑列表（react-window）的行参数。 */
export type LibraryTuiArtistAlbumRowProps = {
    albums: readonly LibraryArtistAlbum[];
    entryKeys: readonly string[];
    focusedRow: number;
    accentBackground: string;
    accentColor: string;
    onFocusRow: (row: number) => void;
    onOpenRow?: (row: number) => void;
};

const albumYear = (album: LibraryArtistAlbum) => (album.publishedAt ? new Date(album.publishedAt).getFullYear().toString() : '');

export const LibraryTuiArtistAlbumRow = ({
    index,
    style,
    albums,
    entryKeys,
    focusedRow,
    accentBackground,
    accentColor,
    onFocusRow,
    onOpenRow,
}: RowComponentProps<LibraryTuiArtistAlbumRowProps>): React.ReactElement | null => {
    const album = albums[index];
    if (!album) return null;
    const isFocused = index === focusedRow;
    return (
        <div
            role="option"
            aria-selected={isFocused}
            data-tui-artist-album={index}
            data-library-entry={entryKeys[index]}
            style={{ ...style, backgroundColor: isFocused ? accentBackground : undefined }}
            onClick={() => onFocusRow(index)}
            onDoubleClick={() => onOpenRow?.(index)}
            className={`grid cursor-default select-none ${LIBRARY_TUI_ARTIST_ALBUM_COLUMNS} items-center gap-x-3 px-4 text-[13px]`}
        >
            <span style={{ color: isFocused ? accentColor : undefined }}>{isFocused ? '>' : ' '}</span>
            <span className="tabular-nums opacity-50">{String(index + 1).padStart(4, '0')}</span>
            <span className={cell}>{album.name}</span>
            <span className="tabular-nums opacity-55">{albumYear(album)}</span>
        </div>
    );
};
