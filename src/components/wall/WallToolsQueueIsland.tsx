import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { List, useListRef } from 'react-window';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { isTextEntryTarget } from '../../utils/keyboardTargets';
import { canSaveQueueAsLocalPlaylist } from '../../utils/queueReorder';
import { buildQueueSearchIndex } from '../command-palette/queueSearchIndex';
import { normalizeSearchText, splitWords } from '../command-palette/search/normalize';
import { QUEUE_ISLAND_ROW_HEIGHT } from './queueDragGeometry';
import { useQueueDragReorder } from './useQueueDragReorder';
import { WallToolsQueueIslandHeader } from './WallToolsQueueIslandHeader';
import { WallToolsQueueRow, type QueueIslandRowActions, type QueueIslandRowProps } from './WallToolsQueueRow';
import type { WallToolsHost } from './wallToolsHost';
import './WallToolsQueueIsland.css';

// src/components/wall/WallToolsQueueIsland.tsx
// 墙面工具面板（WallToolsButton，bravais 与 Lattice 共用）上方的队列浮岛：由快捷排的「队列」格开合（偏好记在
// useLatticeSettingsStore.wallToolsQueueIslandOpen），和面板一起出现、一起收起，私人 FM 下不显示。
// 队列数据直接读 usePlaybackStore（playQueue、currentSong、activePlaybackContext），动作全部经宿主（wallToolsHost）。
// 「当前歌」标记与打开时的居中用显示歌曲（selectDisplaySong：automix 交叉淡入时仍是正在淡出、听得见的那首），与播放页、
// Lattice 一致；显示的那首与内部 currentSong（淡入的那首）都不能从浮岛移除（与 Electron 舞台的 remove 拒绝移除当前曲目
// 一致，也免得移除后预取窗口落空），这两行不给「移除」与「下一首播放」（后者对当前那首本来就是空操作）。
// - 头部（WallToolsQueueIslandHeader）：「播放队列 · N 首」、搜索（内联输入框）、存为本地歌单（内联输入框）、清空（两步确认）。
// - 搜索：与遥控窗口的队列搜索同一条规则（命令面板的队列索引，输入的每个词都在一首歌的检索文字里才算匹配），列表只留匹配的行，
//   行号（列表里的位置）经 matches 映射回队列下标，动作都按队列下标走。筛选中不能拖拽排序、不能 Alt+↑↓（挪的是筛掉的行之间的
//   相对位置，看不出挪到了哪），其余照常。浮岛高度仍按整个队列算，打字时不跳。新的搜索词从顶上看起，清掉搜索词时把当前歌曲
//   滚回正中。搜索框里 ↓ 进第一行、Enter 播放第一首匹配；第一行上 ↑ 回到搜索框。
// - 列表：react-window 虚拟列表，行组件 WallToolsQueueRow；点行播放不跳页；悬停 / 聚焦行出现下一首播放、移到末尾、移除；
//   手柄拖拽排序（useQueueDragReorder）；键盘 Enter 播放、Alt+↑↓ 挪一位并播报、Delete 移除、↑↓ 在行之间移焦，
//   用掉的按键都 preventDefault（bravais 的 window 按键监听认 defaultPrevented）。Delete 在浮岛里（只读时、当前行上、
//   焦点在悬停动作按钮或头部按钮上）一律被浮岛消费，不会漏到 bravais 的批量移除；文字输入框里的 Delete 照常删字。
// - 滚动：打开后先在 layout 阶段同步量出列表的真实高度，量到之后再把当前歌曲滚到正中；切歌时 smart 平滑滚动，拖拽中跳过。
// - Esc 分层：拖拽中只撤拖拽；内联输入（命名、搜索）/ 清空待确认时只撤这一步；否则交给面板（WallToolsSurface 一起收起面板与浮岛）。
// - 外部舞台播放（activePlaybackContext === 'stage'）时只读：只能点歌播放。

/** 头部高度（px）；浮岛高度 = 上下边框 + 头部 + 最多 8 行，至少 112px（窗口矮时由 CSS 只压缩浮岛）。 */
const ISLAND_HEADER_HEIGHT = 36;
const ISLAND_MAX_VISIBLE_ROWS = 8;
const ISLAND_MIN_HEIGHT = 112;
/** 浮岛上下各 1px 边框（border-box：高度里要把它们算上，否则 2–8 首时列表少 2px，出滚动条、末行被裁）。 */
const ISLAND_BORDER_HEIGHT = 2;

export const queueIslandHeight = (rowCount: number) => Math.max(
    ISLAND_MIN_HEIGHT,
    ISLAND_BORDER_HEIGHT + ISLAND_HEADER_HEIGHT + Math.min(rowCount, ISLAND_MAX_VISIBLE_ROWS) * QUEUE_ISLAND_ROW_HEIGHT,
);

/** 按行数算出的列表理想高度（还没量到真实高度时先用它）。 */
const idealListHeight = (rowCount: number) => queueIslandHeight(rowCount) - ISLAND_BORDER_HEIGHT - ISLAND_HEADER_HEIGHT;

/** 与面板一起打开时浮岛晚出现的那一拍（秒）：面板入场 0.2s，浮岛在它走了一小半时才开始浮现。 */
const TRAIL_PANEL_DELAY = 0.09;

/** 搜索命中的队列下标（按队列顺序）；搜索词为空时是 null（不筛选，行号就是队列下标）。 */
const filterQueue = (searchTexts: readonly string[], query: string): number[] | null => {
    const words = splitWords(normalizeSearchText(query));
    if (words.length === 0) return null;
    const matches: number[] = [];
    searchTexts.forEach((text, index) => {
        if (words.every(word => text.includes(word))) matches.push(index);
    });
    return matches;
};

export function WallToolsQueueIsland({ id, host, trailsPanel = false }: { id: string; host: WallToolsHost; trailsPanel?: boolean }) {
    const { t } = useTranslation();
    const playQueue = usePlaybackStore(state => state.playQueue);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const displaySong = usePlaybackStore(selectDisplaySong);
    // 外部舞台播放（activePlaybackContext === 'stage'）时只读。它包含了「正在播放」舞台（isNowPlayingStageActive 是
    // stage 且来源为 now-playing）——那时应用的 clearQueue / shuffleQueue 都是空操作，浮岛也就不给清空与编辑。
    const readOnly = usePlaybackStore(state => state.activePlaybackContext === 'stage');
    const currentSongKey = displaySong ? getPlaybackSongKey(displaySong) : null;
    const playingSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const currentIndex = useMemo(
        () => (currentSongKey ? playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey) : -1),
        [currentSongKey, playQueue],
    );
    const canSave = useMemo(
        () => !readOnly && canSaveQueueAsLocalPlaylist(currentSong, playQueue),
        [currentSong, playQueue, readOnly],
    );

    // 搜索：searching 是输入框开着，query 是输入的词；检索文字只在开着搜索时按队列建一份。
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState('');
    const searchTexts = useMemo(
        () => (searching ? buildQueueSearchIndex(playQueue).map(entry => entry.searchText) : []),
        [playQueue, searching],
    );
    const matches = useMemo(() => (searching ? filterQueue(searchTexts, query) : null), [query, searchTexts, searching]);
    const filtering = matches !== null;
    const rowCount = matches ? matches.length : playQueue.length;
    /** 当前歌曲在列表里的行号（被筛掉了就是 -1）。 */
    const currentRow = matches ? matches.indexOf(currentIndex) : currentIndex;

    const listRef = useListRef(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    // 列表的像素高度：自己量列表外框（窗口矮时浮岛会被压缩），以数字交给 react-window——它拿到的是确定的高度，
    // 打开那一帧的居中滚动就不会落在「还没量完、高度当 0」的那一刻。量到之前先用按行数算出的理想高度。
    const [measuredListHeight, setMeasuredListHeight] = useState<number | null>(null);
    const [announcement, setAnnouncement] = useState({ text: '', nonce: 0 });

    // 行动作与按键处理读这里（身份稳定的 actions 对象，行不因为它重渲染）。
    const latest = useRef({ playQueue, matches, host, readOnly, currentRow, currentSongKey, playingSongKey, t });
    latest.current = { playQueue, matches, host, readOnly, currentRow, currentSongKey, playingSongKey, t };

    /** 第 row 行（列表里的位置）对应的队列下标（不筛选时就是 row）。 */
    const queueIndexAt = useCallback((row: number) => {
        const rows = latest.current.matches;
        return rows ? rows[row] ?? -1 : row;
    }, []);

    /** 第 index 行是不是正在播放（显示的那首或内部 currentSong）：这两行不能移除、不能「下一首播放」。 */
    const isPlayingRow = useCallback((index: number) => {
        const song = latest.current.playQueue[index];
        if (!song) return false;
        const key = getPlaybackSongKey(song);
        return key === latest.current.currentSongKey || key === latest.current.playingSongKey;
    }, []);

    /** 播报一句（每次换一个子节点，同一句连说两次读屏也会再读）。 */
    const announce = useCallback((text: string) => {
        setAnnouncement(previous => ({ text, nonce: previous.nonce + 1 }));
    }, []);

    /** 把第 row 行（列表里的位置）滚进视口并把焦点放到它的主按钮上（那一行可能要等滚动后才挂载，最多再等两帧）。 */
    const focusRow = useCallback((row: number) => {
        const list = listRef.current;
        const { matches: rows, playQueue: queue } = latest.current;
        if (!list || row < 0 || row >= (rows ? rows.length : queue.length)) return;
        list.scrollToRow({ index: row, align: 'auto', behavior: 'instant' });
        let attempts = 3;
        const tryFocus = () => {
            const button = list.element?.querySelector<HTMLButtonElement>(`[data-queue-row="${row}"] .lattice-tools-island-song`);
            if (button) button.focus({ preventScroll: true });
            else if (--attempts > 0) requestAnimationFrame(tryFocus);
        };
        requestAnimationFrame(tryFocus);
    }, [listRef]);

    const moveSong = useCallback((from: number, to: number) => {
        const { host: currentHost, t: translate, readOnly: locked } = latest.current;
        // 拖拽 / Alt+↑↓ 提交的这一刻再查一次：拖到一半外部舞台接管了播放，就不再改队列。
        if (locked) return;
        currentHost.moveQueueSong(from, to);
        announce(translate('wallTools.queueMoved', { position: to + 1 }));
    }, [announce]);

    const keyAt = useCallback((index: number) => {
        const song = latest.current.playQueue[index];
        return song ? getPlaybackSongKey(song) : null;
    }, []);

    const reorder = useQueueDragReorder({
        captureRef: frameRef,
        getScrollElement: () => listRef.current?.element ?? null,
        rowCount: playQueue.length,
        keyAt,
        onDrop: moveSong,
    });
    const { drag, beginDrag, ghostRef, cancel: cancelDrag, isDragging } = reorder;

    /** 行上的按键（row 是列表里的位置）：Enter 播放、↑↓ 移焦（搜索框开着时第一行再 ↑ 回到搜索框）、Alt+↑↓ 挪一位
     *  （筛选中不行）、Delete 移除；用掉的都 preventDefault。 */
    const handleRowKeyDown = useCallback((row: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
        const { playQueue: queue, matches: rows, host: currentHost, readOnly: locked } = latest.current;
        const { key, altKey, shiftKey } = event;
        const index = queueIndexAt(row);
        const visibleCount = rows ? rows.length : queue.length;
        if (key === 'Enter' && !altKey && !shiftKey) {
            event.preventDefault();
            const song = queue[index];
            if (song) currentHost.playQueueSong(song);
            return;
        }
        if ((key === 'ArrowUp' || key === 'ArrowDown') && !shiftKey) {
            event.preventDefault();
            const target = row + (key === 'ArrowUp' ? -1 : 1);
            if (target < 0 && !altKey) {
                searchInputRef.current?.focus();
                return;
            }
            if (target < 0 || target >= visibleCount) return;
            if (altKey) {
                if (locked || rows) return;
                moveSong(index, target);
            }
            focusRow(target);
            return;
        }
        if (key === 'Delete') {
            // 不管能不能删都消费掉（只读、当前行也一样），免得落到 bravais 的批量移除。
            event.preventDefault();
            if (altKey || shiftKey || locked || isPlayingRow(index)) return;
            currentHost.removeQueueSong(index);
            // 删的是最后剩下的一行（多半是筛出的唯一一首）：焦点回搜索框，别掉到 body 上把方向键交给墙。
            const nextRow = Math.min(row, visibleCount - 2);
            if (nextRow < 0) searchInputRef.current?.focus();
            else focusRow(nextRow);
        }
    }, [focusRow, isPlayingRow, moveSong, queueIndexAt]);

    const actions = useMemo<QueueIslandRowActions>(() => ({
        play: index => {
            const song = latest.current.playQueue[index];
            if (song) latest.current.host.playQueueSong(song);
        },
        playNext: index => {
            if (!latest.current.readOnly && !isPlayingRow(index)) latest.current.host.playQueueSongNext(index);
        },
        moveToEnd: index => {
            if (!latest.current.readOnly) latest.current.host.moveQueueSongToEnd(index);
        },
        remove: index => {
            if (!latest.current.readOnly && !isPlayingRow(index)) latest.current.host.removeQueueSong(index);
        },
        keyDown: handleRowKeyDown,
        beginDrag: (index, event) => {
            if (!latest.current.readOnly && !latest.current.matches) beginDrag(index, event);
        },
    }), [beginDrag, handleRowKeyDown, isPlayingRow]);

    const labels = useMemo<QueueIslandRowProps['labels']>(() => ({
        unavailable: t('status.songUnavailableTag'),
        video: t('status.songVideoTag'),
        playNext: t('queue.playNext'),
        moveToEnd: t('queue.moveToEnd'),
        remove: t('queue.remove'),
        dragHandle: t('wallTools.queueDragHandle'),
    }), [t]);

    const rowProps = useMemo<QueueIslandRowProps>(
        () => ({ playQueue, matches, currentSongKey, playingSongKey, readOnly, drag, actions, labels }),
        [actions, currentSongKey, drag, labels, matches, playQueue, playingSongKey, readOnly],
    );

    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        // 先同步量一次（layout 阶段，绘制前）：打开时的居中滚动用真实高度，而不是测量前按行数算的理想高度
        // （窗口矮、浮岛被压缩时两者不同，居中会偏）。之后的变化交给 ResizeObserver。
        const initialHeight = Math.round(frame.clientHeight);
        setMeasuredListHeight(previous => (previous === initialHeight ? previous : initialHeight));
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(entries => {
            const height = Math.round(entries[entries.length - 1].contentRect.height);
            setMeasuredListHeight(previous => (previous === height ? previous : height));
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    // 打开后、量到列表真实高度之后，等一帧（react-window 拿到自己的元素）再把当前歌曲滚到正中；只做一次。
    const hasMeasured = measuredListHeight !== null;
    const centeredRef = useRef(false);
    useEffect(() => {
        if (!hasMeasured || centeredRef.current) return undefined;
        const frame = requestAnimationFrame(() => {
            centeredRef.current = true;
            const row = latest.current.currentRow;
            if (row >= 0) listRef.current?.scrollToRow({ index: row, align: 'center', behavior: 'instant' });
        });
        return () => cancelAnimationFrame(frame);
    }, [hasMeasured, listRef]);

    // 切歌：smart 平滑滚动（已经在视口里就不动）；拖拽中跳过。
    const scrolledKeyRef = useRef(currentSongKey);
    useEffect(() => {
        if (scrolledKeyRef.current === currentSongKey) return;
        scrolledKeyRef.current = currentSongKey;
        if (currentRow < 0 || isDragging()) return;
        listRef.current?.scrollToRow({ index: currentRow, align: 'smart', behavior: 'smooth' });
    }, [currentRow, currentSongKey, isDragging, listRef]);

    // 搜索词变了：新的搜索从顶上看起；清掉搜索词（或关掉搜索）时把当前歌曲滚回正中。打开时的那一次居中由上面负责。
    const filterKey = matches ? normalizeSearchText(query) : null;
    const filterKeyRef = useRef(filterKey);
    useEffect(() => {
        if (filterKeyRef.current === filterKey) return;
        filterKeyRef.current = filterKey;
        // 拖拽中改了搜索词（按住手柄的同时打字）：落点按的是换过的列表，撤掉这次拖拽。
        if (isDragging()) cancelDrag();
        if (!centeredRef.current) return;
        const row = latest.current.currentRow;
        if (filterKey !== null) listRef.current?.scrollToRow({ index: 0, align: 'start', behavior: 'instant' });
        else if (row >= 0) listRef.current?.scrollToRow({ index: row, align: 'center', behavior: 'instant' });
    }, [cancelDrag, filterKey, isDragging, listRef]);

    /** 搜索框里的按键：↓ 进第一行，Enter 播放第一首匹配。 */
    const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        const { matches: rows, playQueue: queue, host: currentHost } = latest.current;
        if (event.key === 'ArrowDown' && (rows ? rows.length : queue.length) > 0) {
            event.preventDefault();
            focusRow(0);
        } else if (event.key === 'Enter' && rows && rows.length > 0) {
            event.preventDefault();
            const song = queue[rows[0]];
            if (song) currentHost.playQueueSong(song);
        }
    }, [focusRow]);

    const closeSearch = useCallback(() => {
        setSearching(false);
        setQuery('');
    }, []);
    const search = useMemo(() => ({
        open: searching,
        query,
        inputRef: searchInputRef,
        onOpen: () => setSearching(true),
        onClose: closeSearch,
        onQueryChange: setQuery,
        onKeyDown: handleSearchKeyDown,
    }), [closeSearch, handleSearchKeyDown, query, searching]);

    // Esc：拖拽中只撤拖拽（捕获阶段，先于头部与面板的监听）。
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || !isDragging()) return;
            cancelDrag();
            event.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [cancelDrag, dragging, isDragging]);

    const count = playQueue.length;
    const ghostSong = drag ? playQueue[drag.from] : undefined;

    return (
        <motion.section
            id={id}
            role="region"
            aria-label={t('wallTools.queueIsland')}
            className="lattice-tools-island"
            data-queue-island=""
            data-queue-readonly={readOnly || undefined}
            data-queue-filtering={filtering || undefined}
            style={{ height: queueIslandHeight(count) }}
            onKeyDown={event => {
                // Delete 在浮岛里一律消费（行上的按键处理之外：悬停动作按钮、头部按钮、只读时），文字输入框里照常删字。
                if (event.key === 'Delete' && !isTextEntryTarget(event.target)) event.preventDefault();
            }}
            initial={{ opacity: 0, scale: 0.96, originX: 1, originY: 1 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: 'easeOut', delay: trailsPanel ? TRAIL_PANEL_DELAY : 0 } }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
        >
            <WallToolsQueueIslandHeader
                host={host}
                count={count}
                readOnly={readOnly}
                canSave={canSave}
                announce={announce}
                isDragging={isDragging}
                search={search}
            />
            <div ref={frameRef} className={drag ? 'lattice-tools-island-list is-dragging' : 'lattice-tools-island-list'}>
                {count === 0 ? (
                    <p className="lattice-tools-island-empty">{t('queue.empty')}</p>
                ) : rowCount === 0 ? (
                    <p className="lattice-tools-island-empty">{t('wallTools.queueNoMatch')}</p>
                ) : (
                    <List
                        listRef={listRef}
                        aria-label={t('wallTools.queueIsland')}
                        rowCount={rowCount}
                        rowHeight={QUEUE_ISLAND_ROW_HEIGHT}
                        rowComponent={WallToolsQueueRow}
                        rowProps={rowProps}
                        overscanCount={4}
                        className="lattice-tools-island-scroll custom-scrollbar"
                        style={{ height: measuredListHeight ?? idealListHeight(count) }}
                    />
                )}
                {ghostSong && (
                    <div ref={ghostRef} className="lattice-tools-island-ghost" aria-hidden="true">
                        <GripVertical />
                        <span className="lattice-tools-island-text">
                            <span className="lattice-tools-island-name">{ghostSong.name}</span>
                            <span className="lattice-tools-island-artist">{getSongArtistLabel(ghostSong)}</span>
                        </span>
                    </div>
                )}
            </div>
            <div className="sr-only" role="status" aria-live="polite" data-queue-island-live="">
                <span key={announcement.nonce}>{announcement.text}</span>
            </div>
        </motion.section>
    );
}
