import React from 'react';
import type { RowComponentProps } from 'react-window';
import type { LibraryDirectoryItem } from '../../core/directory/directory.contract';
import type { LibraryHomeCard } from '../../core/home/homeModel.contract';
import type { LibraryDirectoryRow } from '../../core/directory/directoryTree';
import { resolveDirectoryFolderLabel } from '../../core/directory/directoryItems';
import { resolveDirectoryNodeSelection } from '../../core/directory/directoryBatch';
import { isDirectoryItemHidden, isHideableDirectoryItem } from '../../core/directory/directoryVisibility';

// src/library/suites/tui/LibraryTuiHomeRow.tsx
// TUI 首页目录的一行：焦点 / 选中标记、名称（本地文件夹按目录树缩进，可展开的节点带 ▾ / ▸）、类型、曲目数、
// 说明，等宽排列。文件夹的说明格放路径（虚拟的「全部歌曲」放它的名称，规则见 core/directory/directoryItems）；
// 树上对不上条目的节点（没有直属歌曲的上层文件夹、被忽略的文件夹）只用来表达层级。单击移动焦点，双击打开
// （节点是展开 / 折叠）；可隐藏的条目行尾有 [隐藏] / [取消隐藏]。

/** TUI 目录里的一项：目录条目（与 GridMap 同一个映射）带着它背后的首页卡片（打开时用）。 */
export type LibraryTuiDirectoryEntry = LibraryDirectoryItem & { card: LibraryHomeCard };

export const LIBRARY_TUI_HOME_ROW_HEIGHT = 28;
export const LIBRARY_TUI_HOME_COLUMNS = 'grid-cols-[2ch_2ch_minmax(0,3fr)_9ch_6ch_minmax(0,2fr)_10ch]';

export type LibraryTuiHomeRowProps = {
    rows: LibraryDirectoryRow<LibraryTuiDirectoryEntry>[];
    /** 筛选、隐藏视图之后的条目（树节点的选中状态按它算）。 */
    displayItems: LibraryTuiDirectoryEntry[];
    focusedRow: number;
    selectedIds: ReadonlySet<string>;
    hiddenIds: ReadonlySet<string>;
    /** 这个目录有批量：显示选中标记。 */
    showSelection: boolean;
    accentBackground: string;
    accentColor: string;
    typeLabel: (type: string | undefined) => string;
    ignoredLabel: string;
    hiddenLabel: string;
    hideLabel: string;
    unhideLabel: string;
    onFocusRow: (row: number) => void;
    onActivateRow: (row: number) => void;
    /** 没有给时不显示隐藏按钮。 */
    onToggleHidden?: (item: LibraryTuiDirectoryEntry) => void;
};

const cell = 'truncate whitespace-pre';

const selectionMark = (row: LibraryDirectoryRow<LibraryTuiDirectoryEntry>, props: LibraryTuiHomeRowProps): string => {
    if (!props.showSelection) return ' ';
    if (row.kind === 'item') return props.selectedIds.has(String(row.item.id)) ? '*' : ' ';
    const selection = resolveDirectoryNodeSelection(row.node.path, props.displayItems, props.selectedIds);
    if (selection.state === 'all') return '*';
    return selection.state === 'none' ? ' ' : '~';
};

const LibraryTuiHomeRow = (props: RowComponentProps<LibraryTuiHomeRowProps>): React.ReactElement | null => {
    const { index, style, rows, focusedRow, hiddenIds, accentBackground, accentColor, typeLabel, onFocusRow, onActivateRow, onToggleHidden } = props;
    const row = rows[index];
    if (!row) return null;

    const isFocused = index === focusedRow;
    const item = row.kind === 'item' ? row.item : null;
    const hidden = item ? isDirectoryItemHidden(item, hiddenIds) : false;
    const hideable = item ? isHideableDirectoryItem(item) : false;
    const indent = '  '.repeat(row.depth);
    const fold = row.expandable ? (row.expanded ? '▾ ' : '▸ ') : (row.node ? '  ' : '');
    const name = row.kind === 'node' || row.node ? (row.node?.name ?? '') : item?.name ?? '';
    const ignored = row.kind === 'node' && row.node.ignored;
    const description = item
        ? (item.type === 'folder' ? resolveDirectoryFolderLabel(item) : item.description ?? '')
        : ignored ? props.ignoredLabel : row.node?.path ?? '';
    const trackCount = item ? item.trackCount : row.node?.totalTrackCount;

    return (
        <div
            role="option"
            aria-selected={isFocused}
            data-tui-home-row={index}
            data-tui-home-key={row.key}
            data-library-entry={item ? String(item.id) : undefined}
            data-tui-hidden={hidden || undefined}
            style={{
                ...style,
                backgroundColor: isFocused ? accentBackground : undefined,
                opacity: hidden || ignored ? 0.5 : row.kind === 'node' ? 0.75 : undefined,
            }}
            onClick={() => onFocusRow(index)}
            onDoubleClick={() => onActivateRow(index)}
            className={`grid cursor-default select-none ${LIBRARY_TUI_HOME_COLUMNS} items-center gap-x-3 px-4 text-[13px]`}
        >
            <span style={{ color: isFocused ? accentColor : undefined }}>{isFocused ? '>' : ' '}</span>
            <span style={{ color: accentColor }}>{selectionMark(row, props)}</span>
            <span className={`${cell} ${ignored ? 'line-through' : ''}`}>
                {`${indent}${fold}${name}`}
                {hidden ? <span className="opacity-70">{`  (${props.hiddenLabel})`}</span> : null}
            </span>
            <span className={`${cell} opacity-60`}>{typeLabel(item ? item.type : 'folder')}</span>
            <span className="tabular-nums opacity-60">{trackCount ?? ''}</span>
            <span className={`${cell} opacity-55`}>{description}</span>
            <span>
                {hideable && onToggleHidden && item ? (
                    <button
                        type="button"
                        data-tui-toggle-hidden
                        title={hidden ? props.unhideLabel : props.hideLabel}
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggleHidden(item);
                        }}
                        className="opacity-50 hover:opacity-100"
                    >
                        {`[${hidden ? props.unhideLabel : props.hideLabel}]`}
                    </button>
                ) : null}
            </span>
        </div>
    );
};

export default LibraryTuiHomeRow;
