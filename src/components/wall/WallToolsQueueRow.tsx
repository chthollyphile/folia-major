import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { RowComponentProps } from 'react-window';
import { GripVertical, ListEnd, ListPlus, Trash2 } from 'lucide-react';
import type { SongResult } from '../../types';
import { getSongTag, isSongUnavailable } from '../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { queueRowShift } from './queueDragGeometry';
import type { QueueDrag } from './useQueueDragReorder';

// src/components/wall/WallToolsQueueRow.tsx
// 队列浮岛（WallToolsQueueIsland）的一行（40px）：拖动手柄、主按钮（标题 + 歌手，点了播放、不跳页；当前歌曲有标记，
// 不可用的歌带标签）、悬停 / 聚焦时出现的三个动作（下一首播放、移到末尾、移除）。外部舞台播放时只读：没有手柄和动作。
// 正在播放的那一行（显示的那首或内部 currentSong）只有「移到末尾」：不能移除（与 Electron 舞台的 remove 一致），
// 「下一首播放」对它是空操作。
// 放在浮岛外面（理由同 panelTab/QueueTab 的 QueueRow）：切歌、拖拽只改 rowProps 里的数据，行不重挂，悬停中的动作按钮不闪。
// 拖拽中每一行按 rowProps 的 drag（from / to）自己算让开的位移（queueRowShift），自动滚动中途才挂载的行也对得上；
// 被拖的那一行留在原位但不显示（由浮岛画的幽灵行代替）。
// 搜索筛选中（matches 不为 null）第 index 行显示队列里第 matches[index] 首，没有手柄（筛选中不拖拽排序）。

/** 行要调的动作（浮岛给一份身份稳定的对象，行不因为它重渲染）。除了 keyDown，参数都是队列下标。 */
export type QueueIslandRowActions = {
    play: (index: number) => void;
    playNext: (index: number) => void;
    moveToEnd: (index: number) => void;
    remove: (index: number) => void;
    /** 主按钮上的按键（Enter / Alt+↑↓ / Delete / ↑↓），由浮岛统一处理；row 是列表里的位置。 */
    keyDown: (row: number, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
    /** 手柄上按下指针：交给 useQueueDragReorder。 */
    beginDrag: (index: number, event: ReactPointerEvent<HTMLElement>) => void;
};

export type QueueIslandRowProps = {
    playQueue: SongResult[];
    /** 搜索命中的队列下标（列表第 n 行是队列第 matches[n] 首）；不筛选时为 null。 */
    matches: number[] | null;
    /** 显示歌曲（selectDisplaySong）的 key：画「当前」标记。 */
    currentSongKey: string | null;
    /** 内部 currentSong 的 key（automix 交叉淡入时是淡入的那首，和显示的那首不同）：它也不能移除。 */
    playingSongKey: string | null;
    /** 外部舞台播放：只能点歌播放，不能编辑队列。 */
    readOnly: boolean;
    drag: QueueDrag | null;
    actions: QueueIslandRowActions;
    labels: {
        unavailable: string;
        video: string;
        playNext: string;
        moveToEnd: string;
        remove: string;
        dragHandle: string;
    };
};

export function WallToolsQueueRow({
    index: row,
    style,
    ariaAttributes,
    playQueue,
    matches,
    currentSongKey,
    playingSongKey,
    readOnly,
    drag,
    actions,
    labels,
}: RowComponentProps<QueueIslandRowProps>): ReactElement | null {
    const index = matches ? matches[row] ?? -1 : row;
    const song = playQueue[index];
    if (!song) return null;
    const songKey = getPlaybackSongKey(song);
    const isCurrent = songKey === currentSongKey;
    const isUnavailable = isSongUnavailable(song);
    const tag = getSongTag(song, labels);
    const shift = drag ? queueRowShift(index, drag.from, drag.to) : 0;
    const className = [
        'lattice-tools-island-row',
        isCurrent ? 'is-current' : '',
        isUnavailable ? 'is-unavailable' : '',
        drag ? 'is-dragging' : '',
        drag?.from === index ? 'is-drag-source' : '',
    ].filter(Boolean).join(' ');
    const isPlaying = isCurrent || songKey === playingSongKey;
    const rowActions = readOnly ? [] : [
        ...(isPlaying ? [] : [{ id: 'play-next', label: labels.playNext, icon: ListPlus, run: actions.playNext }]),
        { id: 'move-to-end', label: labels.moveToEnd, icon: ListEnd, run: actions.moveToEnd },
        ...(isPlaying ? [] : [{ id: 'remove', label: labels.remove, icon: Trash2, run: actions.remove }]),
    ];

    return (
        <div
            {...ariaAttributes}
            // 让开的位移叠在 react-window 自己的定位（translateY）后面。
            style={shift ? { ...style, transform: `${style.transform ?? ''} translateY(${shift}px)` } : style}
            className={className}
            data-queue-row={row}
            data-queue-index={index}
            data-queue-key={songKey}
        >
            {!readOnly && !matches && (
                <span
                    className="lattice-tools-island-handle"
                    role="presentation"
                    title={labels.dragHandle}
                    onPointerDown={event => actions.beginDrag(index, event)}
                >
                    <GripVertical aria-hidden="true" />
                </span>
            )}
            <button
                type="button"
                className="lattice-tools-island-song"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => actions.play(index)}
                onKeyDown={event => actions.keyDown(row, event)}
            >
                <span className="lattice-tools-island-marker" aria-hidden="true" />
                <span className="lattice-tools-island-text">
                    <span className="lattice-tools-island-title">
                        <span className="lattice-tools-island-name">{song.name}</span>
                        {tag && <span className="lattice-tools-island-tag">{tag}</span>}
                    </span>
                    <span className="lattice-tools-island-artist">{getSongArtistLabel(song)}</span>
                </span>
            </button>
            {rowActions.length > 0 && (
                <span className="lattice-tools-island-row-actions">
                    {rowActions.map(({ id, label, icon: Icon, run }) => (
                        <button
                            key={id}
                            type="button"
                            className="lattice-tools-island-row-action"
                            data-queue-row-action={id}
                            title={label}
                            aria-label={label}
                            onClick={event => {
                                // 鼠标点的：行的内容马上会变（挪走 / 删掉），焦点别留在这颗按钮上露出聚焦框。
                                if (event.detail > 0) event.currentTarget.blur();
                                run(index);
                            }}
                        >
                            <Icon aria-hidden="true" />
                        </button>
                    ))}
                </span>
            )}
        </div>
    );
}
