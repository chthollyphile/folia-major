import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ListPlus, Maximize2, Minimize2, NotebookPen, Play, Star, Trash2, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { groupScratchpadEntries, scratchpadGroupKey, useScratchpadStore, type ScratchpadEntry, type ScratchpadTab } from '../../../stores/useScratchpadStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useScratchpadSettingsStore } from '../../../stores/useScratchpadSettingsStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { canAddScratchpadSongToPlaylist, scratchpadSourceLabel, type ScratchpadAction } from './scratchpadModel';
import ScratchpadList, { sourceGroupButtons, type ScratchpadPanelActions } from './ScratchpadList';
import ScratchpadCanvas, { type CanvasGroup } from './ScratchpadCanvas';
import ScratchpadHistory from './ScratchpadHistory';
import ScratchpadQueue from './ScratchpadQueue';
import ScratchpadGreeting from './ScratchpadGreeting';
import './scratchpad.css';

// src/components/app/scratchpad/ScratchpadHost.tsx
// 速记簿的界面：左缘的把手和从左边滑出的抽屉（设计稿 plan/scratchpad-spec.md）。抽屉非模态——不加遮罩、不抢焦点，
// 开着时背后照常能逛、能往里收。内容与开合在 useScratchpadStore；播放动作由 App 交进来（和资料库同一个播放端口），
// 这里只决定什么按钮做什么：单条的「播放」插进当前队列，不换队列；唯一会换掉队列的是底部明写了的「替换队列播放」。
// 平时是按来源分组的列表（ScratchpadList）；展开成画布（ScratchpadCanvas）后每首是一张能拖动整理、能框选的卡片。
// 另外两页：播放历史（ScratchpadHistory）与当前的播放队列（ScratchpadQueue）；展开后也是卡片画布（框选、多选），
// 历史上穿一条时间轴、能删记录，队列上穿一条带箭头的线、能选中几张一起拖动换位置。

/** App 交给速记簿的播放动作。 */
export type ScratchpadPlayback = {
    /** 插进当前队列并播放（已在队列里就直接跳过去），不换队列。 */
    playNow: (song: SongResult) => void;
    /** 按应用的入队规则加一首（本地 / Navidrome / 在线各走各的入队路径）。 */
    enqueue: (song: SongResult) => void;
    enqueueAll: (songs: SongResult[]) => void;
    /** 换掉队列，从第一首播起。 */
    replaceQueue: (songs: SongResult[]) => void;
};

/** App 交给速记簿「播放队列」页的动作（身份稳定，执行时读最新的队列）。 */
export type ScratchpadQueuePort = {
    /** 播放队列里的这一首（不换队列、不跳页）。 */
    playSong: (song: SongResult) => void;
    /** 整个换成这个顺序（拖动排序、批量的下一首播放 / 移到末尾 / 移除）：写 store、持久化、按需重新预取。 */
    setOrder: (order: SongResult[]) => void;
};

type ScratchpadHostProps = {
    isDaylight: boolean;
    playback: ScratchpadPlayback;
    queue: ScratchpadQueuePort;
    /** 播放页「隐藏 UI」时（与底部播放条同一个条件）：左缘的把手与感应带藏起来。开着的抽屉不受影响，Ctrl / ⌘ + J 照常能开合。 */
    isHandleHidden?: boolean;
};

/** 页签的先后（换页动画的方向、方向键换页都按它）。 */
const TABS: readonly ScratchpadTab[] = ['notes', 'history', 'queue'];

/** 清空的第二下要在这么久之内点，过了就复原。 */
const CLEAR_CONFIRM_MS = 3000;

/** 焦点在抽屉里时这些键归抽屉：不让它们冒到 window 上被资料库墙（方向键移焦、Enter 打开）或播放页（方向键快进）接走。
 *  只拦冒泡，不 preventDefault：按钮照常响应 Enter / 空格，画布照常翻页滚动。 */
const DRAWER_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace',
]);

/** 抽屉里换页签的键：Tab 往后、Shift + Tab 往前（带 Ctrl / Alt / ⌘ 的留给系统和应用）。 */
const isTabCycleKey = (event: KeyboardEvent | React.KeyboardEvent) => (
    event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey
);

/** 换页时新旧两页各滑动多远，以及进场 / 退场的缓动（进场与抽屉滑出同一条曲线）。 */
const PAGE_SLIDE_PX = 28;
const PAGE_EASE_IN = [0.22, 1, 0.36, 1] as const;
const PAGE_EASE_OUT = [0.4, 0, 1, 1] as const;

const ScratchpadHost: React.FC<ScratchpadHostProps> = ({ isDaylight, playback, queue, isHandleHidden = false }) => {
    const { t } = useTranslation();
    const { entries, isOpen, tab, isExpanded, isCovered, addNonce, setOpen, toggleOpen, setExpanded, setTab, clear } = useScratchpadStore(useShallow(state => ({
        entries: state.entries,
        isOpen: state.isOpen,
        tab: state.tab,
        isExpanded: state.isExpanded,
        isCovered: state.isCovered,
        addNonce: state.addNonce,
        setOpen: state.setOpen,
        toggleOpen: state.toggleOpen,
        setExpanded: state.setExpanded,
        setTab: state.setTab,
        clear: state.clear,
    })));
    const groups = useMemo(() => groupScratchpadEntries(entries), [entries]);
    const queueLength = usePlaybackStore(state => state.playQueue.length);
    // 设置里能把把手整个藏起来（抽屉照常用 Ctrl / ⌘ + J、命令面板开合），也能把它挪到左缘的别的高度。
    const showHandle = useScratchpadSettingsStore(state => state.showHandle);
    const handlePosition = useScratchpadSettingsStore(state => state.handlePosition);
    const listRef = useRef<HTMLDivElement>(null);
    const [confirmingClear, setConfirmingClear] = useState(false);

    // 新收进来的行：和上一批条目比出来，闪一下底色；列表开着时滚到第一条新行。
    const seenKeysRef = useRef<Set<string>>(new Set(entries.map(entry => entry.key)));
    const [freshKeys, setFreshKeys] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        const seen = seenKeysRef.current;
        const fresh = new Set(entries.filter(entry => !seen.has(entry.key)).map(entry => entry.key));
        seenKeysRef.current = new Set(entries.map(entry => entry.key));
        if (fresh.size > 0) setFreshKeys(fresh);
    }, [entries]);
    // 高亮的时钟跟着这一批走，不跟着条目：期间又删、又挪也照样到点清掉。
    useEffect(() => {
        if (freshKeys.size === 0) return;
        const timer = window.setTimeout(() => setFreshKeys(new Set()), 1400);
        return () => window.clearTimeout(timer);
    }, [freshKeys]);
    // 只在来了新的一批时滚过去（不因为之后的删除、挪动再跳回来）。
    useEffect(() => {
        if (!isOpen || isExpanded || freshKeys.size === 0) return;
        const first = useScratchpadStore.getState().entries.find(entry => freshKeys.has(entry.key));
        if (!first) return;
        listRef.current?.querySelector(`[data-scratchpad-key="${CSS.escape(first.key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [freshKeys, isExpanded, isOpen]);

    // 把手闪一下：每收进一批（addNonce 变了）都闪。
    const [pulsing, setPulsing] = useState(false);
    useEffect(() => {
        if (addNonce === 0) return;
        setPulsing(true);
        const timer = window.setTimeout(() => setPulsing(false), 900);
        return () => window.clearTimeout(timer);
    }, [addNonce]);

    useEffect(() => {
        if (!confirmingClear) return;
        const timer = window.setTimeout(() => setConfirmingClear(false), CLEAR_CONFIRM_MS);
        return () => window.clearTimeout(timer);
    }, [confirmingClear]);
    useEffect(() => {
        if (!isOpen) setConfirmingClear(false);
    }, [isOpen]);

    // 动作身份稳定（行与卡片 memo 着）：执行时读最新的播放动作与翻译。
    const latest = useRef({ playback, t });
    latest.current = { playback, t };
    const actions = useMemo<ScratchpadPanelActions>(() => ({
        play: entry => latest.current.playback.playNow(entry.song),
        enqueue: list => {
            if (list.length === 1) latest.current.playback.enqueue(list[0].song);
            else if (list.length > 1) latest.current.playback.enqueueAll(list.map(entry => entry.song));
        },
        addToPlaylist: list => {
            if (list.length > 0) openAddSongsToPlaylist(list.map(entry => entry.song));
        },
        remove: keys => useScratchpadStore.getState().remove(keys),
        move: (groupKey, keys, targetIndex) => useScratchpadStore.getState().move(groupKey, keys, targetIndex),
        sourceLabel: song => scratchpadSourceLabel(song, latest.current.t),
        canAddToPlaylist: canAddScratchpadSongToPlaylist,
    }), []);

    // 画布上的组：来源一组，组头是整组入队、整组加入歌单。
    const canvasGroups = useMemo<CanvasGroup<ScratchpadEntry>[]>(() => groups.map(group => {
        const sample = group.entries[0].song;
        return {
            key: group.key,
            label: actions.sourceLabel(sample),
            entries: group.entries,
            buttons: sourceGroupButtons(t, actions.canAddToPlaylist(sample), () => actions.enqueue(group.entries), () => actions.addToPlaylist(group.entries)),
        };
    }), [actions, groups, t]);
    const removeEntries = useCallback((list: ScratchpadEntry[]) => actions.remove(list.map(entry => entry.key)), [actions]);
    // 选中后的菜单：入队、加入歌单（选中的都来自同一组、那个来源允许时）、移出速记簿。
    const notesSelectionActions = useCallback((list: ScratchpadEntry[]): ScratchpadAction[] => {
        const groupKeys = new Set(list.map(entry => scratchpadGroupKey(entry.song)));
        const sameGroup = groupKeys.size === 1;
        return [
            { id: 'enqueue', label: t('scratchpad.enqueue'), icon: ListPlus, run: () => actions.enqueue(list) },
            {
                id: 'add-to-playlist',
                label: t('scratchpad.addToPlaylist'),
                title: sameGroup ? undefined : t('scratchpad.mixedSourcesHint'),
                icon: Star,
                run: () => actions.addToPlaylist(list),
                disabled: !sameGroup || list.length === 0 || !actions.canAddToPlaylist(list[0].song),
            },
            { id: 'remove', label: t('scratchpad.removeSelected'), icon: Trash2, run: () => actions.remove(list.map(entry => entry.key)) },
        ];
    }, [actions, t]);

    // 「全部」按界面上看到的顺序（按组），与画布里全选后入队一致。
    const songs = useMemo(() => groups.flatMap(group => group.entries.map(entry => entry.song)), [groups]);
    const handleClear = () => {
        if (!confirmingClear) {
            setConfirmingClear(true);
            return;
        }
        setConfirmingClear(false);
        clear();
    };

    // Esc 收起：只管焦点在抽屉里的时候（抽屉非模态，别的地方的 Esc 是别人的）。画布开着时先收回列表（画布自己先处理
    // 选择与拖动）；焦点交还给把手，别掉到 body 上。
    const focusHandleRef = useRef(false);
    // 画布被 Esc 收回列表时，焦点落到展开按钮上（画布一卸载焦点就掉到 body，下一下 Esc 就没人接了）。
    const toggleCanvasRef = useRef<HTMLButtonElement>(null);
    const collapseCanvas = useCallback(() => {
        setExpanded(false);
        requestAnimationFrame(() => toggleCanvasRef.current?.focus());
    }, [setExpanded]);
    /** Tab / Shift + Tab 换到下一页 / 上一页（首尾相接），焦点跟到新页签上：原来那页的按钮卸掉以后焦点不至于掉到 body。 */
    const cycleTab = useCallback((direction: 1 | -1) => {
        const current = useScratchpadStore.getState().tab;
        const next = TABS[(TABS.indexOf(current) + direction + TABS.length) % TABS.length];
        setTab(next);
        requestAnimationFrame(() => document.getElementById(`scratchpad-tab-${next}`)?.focus());
    }, [setTab]);
    // 抽屉开着、焦点不在任何地方（刚用把手或 Ctrl / ⌘ + J 打开，把手一卸掉焦点就落在 body）时，Tab 也归抽屉换页；
    // 焦点在别处（资料库、输入框）时 Tab 照常走焦点。
    useEffect(() => {
        if (!isOpen || isCovered) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || !isTabCycleKey(event)) return;
            const active = document.activeElement;
            if (active && active !== document.body) return;
            event.preventDefault();
            cycleTab(event.shiftKey ? -1 : 1);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [cycleTab, isCovered, isOpen]);

    const handleKeyDown = (event: React.KeyboardEvent) => {
        // 抽屉里 Tab 不走焦点，换页签（用户定，2026-11-05）；按钮之间用方向键和鼠标。
        if (isTabCycleKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            cycleTab(event.shiftKey ? -1 : 1);
            return;
        }
        if (DRAWER_KEYS.has(event.key)) {
            event.stopPropagation();
            return;
        }
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        if (isExpanded) {
            collapseCanvas();
            return;
        }
        focusHandleRef.current = true;
        setOpen(false);
    };
    const handleRef = useCallback((node: HTMLButtonElement | null) => {
        if (!node || !focusHandleRef.current) return;
        focusHandleRef.current = false;
        node.focus();
    }, []);

    const handleLabel = isOpen ? t('scratchpad.close') : t('scratchpad.open');
    // 悬停提示带上开合的快捷键（命令面板的 scratchpad-toggle，Ctrl / ⌘ + J）。
    const handleTitle = `${handleLabel} (${PRIMARY_MODIFIER_LABEL} + J)`;
    const expandLabel = isExpanded ? t('scratchpad.collapseCanvas') : t('scratchpad.expandCanvas');

    const footer = entries.length > 0 && (
        <footer className="scratchpad-footer">
            <button type="button" className="scratchpad-pill" onClick={() => playback.enqueueAll(songs)}>
                <ListPlus aria-hidden="true" />
                <span>{t('scratchpad.enqueueAll')}</span>
            </button>
            <button type="button" className="scratchpad-pill" onClick={() => playback.replaceQueue(songs)}>
                <Play aria-hidden="true" />
                <span>{t('scratchpad.replaceQueue')}</span>
            </button>
            <button
                type="button"
                className={`scratchpad-pill${confirmingClear ? ' is-confirming' : ''}`}
                style={{ flex: confirmingClear ? '1.4 1 0' : '0 0 auto' }}
                title={t('scratchpad.clear')}
                onClick={handleClear}
            >
                <Trash2 aria-hidden="true" />
                {confirmingClear && <span>{t('scratchpad.confirmClear')}</span>}
            </button>
        </footer>
    );

    // 换页的动画：往右边的页签走时方向是 1，往左是 -1（和上一页比）。
    const calm = useReducedMotionFor('uiMicroMotion');
    const previousTabRef = useRef(tab);
    const pageDirectionRef = useRef(1);
    if (previousTabRef.current !== tab) {
        pageDirectionRef.current = TABS.indexOf(tab) > TABS.indexOf(previousTabRef.current) ? 1 : -1;
        previousTabRef.current = tab;
    }
    const pageDirection = pageDirectionRef.current;
    const pageVariants = useMemo(() => ({
        enter: (direction: number) => ({ opacity: 0, x: calm ? 0 : direction * PAGE_SLIDE_PX }),
        center: { opacity: 1, x: 0, transition: { duration: calm ? 0.12 : 0.2, ease: PAGE_EASE_IN } },
        exit: (direction: number) => ({
            opacity: 0,
            x: calm ? 0 : -direction * PAGE_SLIDE_PX,
            transition: { duration: calm ? 0.08 : 0.12, ease: PAGE_EASE_OUT },
        }),
    }), [calm]);

    // 页签之间用左右方向键（以及 Home / End）换，焦点跟着换到新页签上；Tab / Shift + Tab 在整个抽屉里都是换页（handleKeyDown）。
    const handleTabsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const index = TABS.indexOf(tab);
        const next = event.key === 'Home' ? TABS[0]
            : event.key === 'End' ? TABS[TABS.length - 1]
                : event.key === 'ArrowLeft' ? TABS[Math.max(0, index - 1)]
                    : event.key === 'ArrowRight' ? TABS[Math.min(TABS.length - 1, index + 1)]
                        : null;
        if (!next) return;
        event.preventDefault();
        setTab(next);
        requestAnimationFrame(() => document.getElementById(`scratchpad-tab-${next}`)?.focus());
    };

    return (
        <div className={`scratchpad-root${isDaylight ? ' is-daylight' : ''}${isCovered ? ' is-covered' : ''}${calm ? ' is-calm' : ''}`}>
            {!isOpen && !isHandleHidden && showHandle && (
                <div
                    className={`scratchpad-edge${entries.length > 0 ? ' has-entries' : ''}`}
                    style={{ '--scratchpad-edge-position': handlePosition } as React.CSSProperties}
                    data-ponder="scratchpad"
                >
                    <button
                        ref={handleRef}
                        type="button"
                        className={`scratchpad-handle${pulsing ? ' is-pulsing' : ''}`}
                        data-testid="scratchpad-handle"
                        title={handleTitle}
                        aria-label={handleLabel}
                        aria-expanded={false}
                        onClick={toggleOpen}
                    >
                        <NotebookPen aria-hidden="true" />
                        {entries.length > 0 && <span className="scratchpad-handle-count">{entries.length}</span>}
                    </button>
                </div>
            )}

            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        key="scratchpad-drawer"
                        className={`scratchpad-drawer${isExpanded ? ' is-expanded' : ''}`}
                        data-testid="scratchpad-drawer"
                        data-ponder="scratchpad"
                        aria-label={t('scratchpad.title')}
                        initial={{ x: -32, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -32, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        onKeyDown={handleKeyDown}
                    >
                        <header className="scratchpad-header">
                            <div className="scratchpad-heading">
                                {/* 页签上面一句按时段换的问候，三页都有：窄的抽屉里是短版，展开成画布时是长版。 */}
                                <ScratchpadGreeting long={isExpanded} />
                                {/* 三页：速记簿本身、播放历史、播放队列。 */}
                                <div className="scratchpad-tabs" role="tablist" aria-label={t('scratchpad.title')} onKeyDown={handleTabsKeyDown}>
                                    <button
                                        type="button"
                                        role="tab"
                                        id="scratchpad-tab-notes"
                                        className="scratchpad-tab"
                                        data-scratchpad-tab="notes"
                                        aria-selected={tab === 'notes'}
                                        aria-controls="scratchpad-panel"
                                        tabIndex={tab === 'notes' ? 0 : -1}
                                        onClick={() => setTab('notes')}
                                    >
                                        <span>{t('scratchpad.title')}</span>
                                        <span className="scratchpad-tab-count">{t('scratchpad.count', { count: entries.length })}</span>
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        id="scratchpad-tab-history"
                                        className="scratchpad-tab"
                                        data-scratchpad-tab="history"
                                        aria-selected={tab === 'history'}
                                        aria-controls="scratchpad-panel"
                                        tabIndex={tab === 'history' ? 0 : -1}
                                        onClick={() => setTab('history')}
                                    >
                                        <span>{t('scratchpad.historyTab')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        id="scratchpad-tab-queue"
                                        className="scratchpad-tab"
                                        data-scratchpad-tab="queue"
                                        aria-selected={tab === 'queue'}
                                        aria-controls="scratchpad-panel"
                                        tabIndex={tab === 'queue' ? 0 : -1}
                                        onClick={() => setTab('queue')}
                                    >
                                        <span>{t('scratchpad.queue')}</span>
                                        <span className="scratchpad-tab-count">{t('scratchpad.count', { count: queueLength })}</span>
                                    </button>
                                </div>
                            </div>
                            {/* 三页都能展开成卡片画布：速记簿按来源分组，播放历史一天一组穿一条时间轴，播放队列穿一条带箭头的线。 */}
                            <button
                                ref={toggleCanvasRef}
                                type="button"
                                className="scratchpad-icon-button"
                                data-scratchpad-action="toggle-canvas"
                                disabled={tab === 'notes' && entries.length === 0 && !isExpanded}
                                title={expandLabel}
                                aria-label={expandLabel}
                                aria-pressed={isExpanded}
                                onClick={() => setExpanded(!isExpanded)}
                            >
                                {isExpanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                            </button>
                            <button
                                type="button"
                                className="scratchpad-icon-button"
                                title={t('scratchpad.close')}
                                aria-label={t('scratchpad.close')}
                                onClick={() => setOpen(false)}
                            >
                                <X aria-hidden="true" />
                            </button>
                        </header>
                        <div
                            className="scratchpad-panel"
                            role="tabpanel"
                            id="scratchpad-panel"
                            aria-labelledby={`scratchpad-tab-${tab}`}
                        >
                            {/* 换页：往右边的页签走，新的一页从右边滑进来、旧的往左边让开；往回走反过来。先退后进（mode wait），
                                两页不同时在场，列表与画布各自的尺寸量得准。降级动效时只淡入淡出。 */}
                            <AnimatePresence initial={false} mode="wait" custom={pageDirection}>
                                <motion.div
                                    key={tab}
                                    className="scratchpad-panel-page"
                                    custom={pageDirection}
                                    variants={pageVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                >
                                    {tab === 'history' ? (
                                        <ScratchpadHistory playback={playback} expanded={isExpanded} onCollapse={collapseCanvas} />
                                    ) : tab === 'queue' ? (
                                        <>
                                            {!isExpanded && <p className="scratchpad-hint">{t('scratchpad.queueHint')}</p>}
                                            <ScratchpadQueue queue={queue} expanded={isExpanded} onCollapse={collapseCanvas} />
                                        </>
                                    ) : (
                                        <>
                                            {!isExpanded && <p className="scratchpad-hint">{t('scratchpad.hint')}</p>}
                                            {entries.length === 0 ? (
                                                <div className="scratchpad-empty">
                                                    <NotebookPen aria-hidden="true" />
                                                    <p>{t('scratchpad.empty')}</p>
                                                </div>
                                            ) : isExpanded ? (
                                                <ScratchpadCanvas
                                                    groups={canvasGroups}
                                                    freshKeys={freshKeys}
                                                    hint={t('scratchpad.canvasHint', { mod: PRIMARY_MODIFIER_LABEL })}
                                                    ariaLabel={t('scratchpad.title')}
                                                    playLabel={t('scratchpad.play')}
                                                    onPlay={actions.play}
                                                    onMove={actions.move}
                                                    onDelete={removeEntries}
                                                    selectionActions={notesSelectionActions}
                                                    onEscape={collapseCanvas}
                                                    footer={footer}
                                                />
                                            ) : (
                                                <>
                                                    <ScratchpadList groups={groups} freshKeys={freshKeys} actions={actions} listRef={listRef} />
                                                    {footer}
                                                </>
                                            )}
                                        </>
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ScratchpadHost;
