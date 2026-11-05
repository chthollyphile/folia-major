import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { Music2, Play } from 'lucide-react';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import type { CanvasEntry } from './ScratchpadCard';
import type { ScratchpadAction } from './scratchpadModel';

// src/components/app/scratchpad/ScratchpadSongTable.tsx
// 速记簿「播放队列」页收起时（抽屉窄的时候）的列表：虚拟列表（队列可能有上千首），一行一首，点标题做主动作
// （播放这首），悬停 / 聚焦出行内按钮。展开后换成卡片画布（ScratchpadCanvas），多选、框选、拖动排序都在那边。

/** 一行的高度（px），与 .scratchpad-row 一致。 */
export const SONG_TABLE_ROW_HEIGHT = 52;

type ScratchpadSongTableProps = {
    rows: CanvasEntry[];
    /** 主动作的名字（标题按钮的悬停提示、行内第一颗按钮）。 */
    primaryLabel: string;
    onActivate: (row: CanvasEntry) => void;
    /** 行内按钮（主动作之外的）。 */
    rowActions: (row: CanvasEntry) => ScratchpadAction[];
    /** 打开时滚到这一行（居中）；之后它变了时平滑跟过去。 */
    focusIndex?: number;
    ariaLabel: string;
    testId: string;
};

type SongTableRowProps = {
    rows: CanvasEntry[];
    primaryLabel: string;
    rowActions: (row: CanvasEntry) => ScratchpadAction[];
    onActivate: (row: CanvasEntry) => void;
};

function SongTableRowView({ ariaAttributes, index, style, rows, primaryLabel, rowActions, onActivate }: RowComponentProps<SongTableRowProps>) {
    const row = rows[index];
    const [coverFailed, setCoverFailed] = useState(false);
    const coverUrl = getSongCoverUrl(row.song);
    return (
        <div
            {...ariaAttributes}
            style={style}
            className={`scratchpad-row scratchpad-table-row${row.isCurrent ? ' is-current' : ''}`}
            data-scratchpad-table-row={row.key}
        >
            <span className="scratchpad-cover" aria-hidden="true">
                {coverUrl && !coverFailed
                    ? <img src={coverUrl} alt="" loading="lazy" decoding="async" onError={() => setCoverFailed(true)} />
                    : <span className="grid h-full w-full place-items-center opacity-50"><Music2 size={16} /></span>}
            </span>
            <button type="button" className="scratchpad-song" title={primaryLabel} onClick={() => onActivate(row)}>
                <span className="scratchpad-name">{row.song.name}</span>
                <span className="scratchpad-meta">{row.meta ?? getSongArtistLabel(row.song)}</span>
            </button>
            <span className="scratchpad-row-actions">
                <button
                    type="button"
                    className="scratchpad-icon-button"
                    data-scratchpad-action="play"
                    title={primaryLabel}
                    aria-label={primaryLabel}
                    onClick={() => onActivate(row)}
                >
                    <Play aria-hidden="true" />
                </button>
                {rowActions(row).map(({ id, label, title, icon: Icon, run, disabled }) => (
                    <button
                        key={id}
                        type="button"
                        className="scratchpad-icon-button"
                        data-scratchpad-action={id}
                        title={title ?? label}
                        aria-label={label}
                        disabled={disabled}
                        onClick={event => {
                            // 鼠标点的：这一行可能马上挪走或消失，焦点别留在按钮上露出聚焦框。
                            if (event.detail > 0) event.currentTarget.blur();
                            run();
                        }}
                    >
                        <Icon aria-hidden="true" />
                    </button>
                ))}
            </span>
        </div>
    );
}

const rowKeyOf = (index: number, props: SongTableRowProps) => props.rows[index]?.key ?? index;

const ScratchpadSongTable: React.FC<ScratchpadSongTableProps> = ({ rows, primaryLabel, onActivate, rowActions, focusIndex, ariaLabel, testId }) => {
    const listRef = useListRef(null);

    // 打开时把正在播放的那一首滚到正中；之后它变了（切歌）平滑跟过去。行数变了（入队）不把列表拽回去。
    // 打开那一下自己算、自己滚：react-window 的滚动容器在第一次渲染之后才挂到它的 ref 上（第一次 layout effect 里
    // listRef.current.element 还是 null，scrollToRow 什么都不做），它量的容器高度也晚一步才有。所以等到容器在、量得出高度
    // 的那一帧再滚，滚成了才算打开过。
    const didInitialScrollRef = useRef(false);
    useLayoutEffect(() => {
        if (focusIndex === undefined || focusIndex < 0 || focusIndex >= rows.length) return;
        if (!didInitialScrollRef.current) {
            let frame = 0;
            let tries = 0;
            const scrollToFocus = () => {
                const element = listRef.current?.element;
                if (!element || element.clientHeight === 0) {
                    if (tries < 30) {
                        tries += 1;
                        frame = requestAnimationFrame(scrollToFocus);
                    }
                    return;
                }
                didInitialScrollRef.current = true;
                element.scrollTop = Math.max(0, focusIndex * SONG_TABLE_ROW_HEIGHT - (element.clientHeight - SONG_TABLE_ROW_HEIGHT) / 2);
            };
            scrollToFocus();
            return () => cancelAnimationFrame(frame);
        }
        listRef.current?.scrollToRow({ index: focusIndex, align: 'smart', behavior: 'smooth' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusIndex]);

    const rowProps = useMemo<SongTableRowProps>(() => ({ rows, primaryLabel, rowActions, onActivate }), [onActivate, primaryLabel, rowActions, rows]);

    return (
        <div className="scratchpad-table" data-testid={testId}>
            <List
                listRef={listRef}
                aria-label={ariaLabel}
                rowCount={rows.length}
                rowHeight={SONG_TABLE_ROW_HEIGHT}
                rowComponent={SongTableRowView}
                rowProps={rowProps}
                rowKey={rowKeyOf}
                overscanCount={6}
                className="scratchpad-list scratchpad-table-scroll"
            />
        </div>
    );
};

export default ScratchpadSongTable;
