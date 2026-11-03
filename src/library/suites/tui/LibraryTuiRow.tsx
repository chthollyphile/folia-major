import React from 'react';
import type { RowComponentProps } from 'react-window';
import type { SongResult, UnifiedSong } from '../../../types';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { formatTime } from '../../../utils/appPlaybackHelpers';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { resolveTrackAlbumLink, resolveTrackArtistLinks, type TrackArtistLink } from '../../core/shared/trackLinks';

// src/library/suites/tui/LibraryTuiRow.tsx
// TUI 的一行：序号、歌名、歌手、专辑、时长，等宽排列。单击移动焦点，双击播放，[+] 入队；
// 本地歌在集合支持时多一个 [i]（手动匹配在线信息，打开宿主挂载的对话框）。删除请求还没回来的行标 `~` 并变淡。
// 歌手名与专辑名在能解析出目录引用时是按钮（P4.4，规则与网格卡片同一份：core/shared/trackLinks），点了打开嵌套的
// 歌手页 / 专辑；样式与歌手页歌曲行上的链接一致（data-tui-link）。

export const LIBRARY_TUI_ROW_HEIGHT = 28;

export type LibraryTuiRowProps = {
    tracks: SongResult[];
    rowDisplayIndexes: number[];
    /** 每行的条目键（与网格卡片 id 同一格式）。 */
    rowKeys: string[];
    focusedRow: number;
    /** 删除请求还没回来的条目键。 */
    pendingKeys: ReadonlySet<string>;
    accentBackground: string;
    accentColor: string;
    enqueueLabel: string;
    unavailableLabel: string;
    videoLabel: string;
    matchLabel: string;
    onFocusRow: (row: number) => void;
    onPlayRow: (row: number) => void;
    onEnqueueRow: (row: number) => void;
    /** 集合支持手动匹配时才给；只对本地歌显示。 */
    onMatchRow?: (row: number) => void;
    /** suite 声明了 open-album 才给：能解析出专辑目录引用的行把专辑名画成按钮。 */
    onOpenAlbumRow?: (row: number) => void;
    /** suite 声明了 open-artist 才给：能解析出目录引用的歌手名画成按钮。 */
    onOpenArtistRow?: (row: number, link: TrackArtistLink) => void;
};

export const LIBRARY_TUI_COLUMNS = 'grid-cols-[2ch_6ch_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_6ch_7ch]';

const cell = 'truncate whitespace-pre';
const linkClass = 'hover:underline hover:opacity-100';

const LibraryTuiRow = ({
    index,
    style,
    tracks,
    rowDisplayIndexes,
    rowKeys,
    focusedRow,
    pendingKeys,
    accentBackground,
    accentColor,
    enqueueLabel,
    unavailableLabel,
    videoLabel,
    matchLabel,
    onFocusRow,
    onPlayRow,
    onEnqueueRow,
    onMatchRow,
    onOpenAlbumRow,
    onOpenArtistRow,
}: RowComponentProps<LibraryTuiRowProps>): React.ReactElement | null => {
    const displayIndex = rowDisplayIndexes[index];
    const track = displayIndex === undefined ? undefined : tracks[displayIndex];
    if (!track) return null;

    const isFocused = index === focusedRow;
    const unavailable = isSongUnavailable(track);
    const tag = unavailable ? unavailableLabel : track.isVideo ? videoLabel : '';
    const entryKey = rowKeys[index];
    const isPending = pendingKeys.has(entryKey);
    const canMatch = Boolean(onMatchRow && (track as UnifiedSong).localRef?.songId);
    const artistLinks = onOpenArtistRow ? resolveTrackArtistLinks(track, canResolveSongCatalogRef) : [];
    const hasArtistLink = artistLinks.some(link => link.targetId !== undefined);
    const albumName = track.album?.name || '';
    const canOpenAlbum = Boolean(onOpenAlbumRow && albumName && resolveTrackAlbumLink(track, canResolveSongCatalogRef));
    return (
        <div
            role="option"
            aria-selected={isFocused}
            data-tui-row={index}
            data-library-entry={entryKey}
            data-tui-pending={isPending || undefined}
            aria-busy={isPending || undefined}
            style={{
                ...style,
                backgroundColor: isFocused ? accentBackground : undefined,
                opacity: unavailable || isPending ? 0.45 : undefined,
            }}
            onClick={() => onFocusRow(index)}
            onDoubleClick={() => onPlayRow(index)}
            className={`grid cursor-default select-none ${LIBRARY_TUI_COLUMNS} items-center gap-x-3 px-4 text-[13px]`}
        >
            <span style={{ color: isFocused ? accentColor : undefined }}>{isPending ? '~' : isFocused ? '>' : ' '}</span>
            <span className="tabular-nums opacity-50">{String(displayIndex + 1).padStart(4, '0')}</span>
            <span className={cell}>
                {track.name}
                {tag ? <span className="opacity-70">{`  (${tag})`}</span> : null}
            </span>
            <span className={`${cell} opacity-70`}>
                {hasArtistLink ? artistLinks.map((link, linkIndex) => (
                    <React.Fragment key={`${link.artist.id ?? 'artist'}-${linkIndex}`}>
                        {linkIndex > 0 ? ', ' : ''}
                        {link.targetId !== undefined ? (
                            <button
                                type="button"
                                data-tui-link="artist"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenArtistRow?.(index, link);
                                }}
                                className={linkClass}
                            >
                                {link.artist.name}
                            </button>
                        ) : link.artist.name}
                    </React.Fragment>
                )) : getSongArtistLabel(track)}
            </span>
            <span className={`${cell} opacity-55`}>
                {canOpenAlbum ? (
                    <button
                        type="button"
                        data-tui-link="album"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenAlbumRow?.(index);
                        }}
                        className={linkClass}
                    >
                        {albumName}
                    </button>
                ) : albumName}
            </span>
            <span className="tabular-nums opacity-55">{formatTime((track.durationMs || 0) / 1000)}</span>
            <span className="flex gap-x-1">
                {canMatch ? (
                    <button
                        type="button"
                        title={matchLabel}
                        aria-label={matchLabel}
                        data-tui-match
                        onClick={(event) => {
                            event.stopPropagation();
                            onMatchRow?.(index);
                        }}
                        className="opacity-50 hover:opacity-100"
                    >
                        [i]
                    </button>
                ) : <span className="w-[3ch]" />}
                <button
                    type="button"
                    title={enqueueLabel}
                    aria-label={enqueueLabel}
                    onClick={(event) => {
                        event.stopPropagation();
                        onEnqueueRow(index);
                    }}
                    className="opacity-50 hover:opacity-100 disabled:opacity-20"
                    disabled={unavailable}
                >
                    [+]
                </button>
            </span>
        </div>
    );
};

export default LibraryTuiRow;
