import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ListPlus, NotebookPen, Play, Star, Trash2 } from 'lucide-react';
import type { SongResult } from '../../../types';
import { groupScratchpadEntries, scratchpadGroupKey, useScratchpadStore, type ScratchpadEntry, type ScratchpadTab } from '../../../stores/useScratchpadStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useScratchpadSettingsStore } from '../../../stores/useScratchpadSettingsStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { canAddScratchpadSongToPlaylist, scratchpadSourceLabel, scratchpadTips, type ScratchpadAction } from './scratchpadModel';
import ScratchpadList, { sourceGroupButtons, type ScratchpadPanelActions } from './ScratchpadList';
import ScratchpadCanvas, { type CanvasGroup, type CanvasSide } from './ScratchpadCanvas';
import ScratchpadHistory from './ScratchpadHistory';
import ScratchpadQueue from './ScratchpadQueue';
import ScratchpadEdge from './ScratchpadEdge';
import ScratchpadPanel from './ScratchpadPanel';
import ScratchpadSheet, { ScratchpadBandActions } from './ScratchpadSheet';
import ScratchpadOverview from './ScratchpadOverview';
import { NOTE_SPACING } from './canvasLayout';
import { SCRATCHPAD_TABS, scratchpadLookVars } from './scratchpadLook';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { SCRATCHPAD_TILT_DEG } from './scratchpadTilt';
import { useSlimOrder } from './scratchpadPaper';
import './scratchpad.css';

// src/components/app/scratchpad/ScratchpadHost.tsx
// 速记簿的界面：左缘的把手和从左边滑出的抽屉（设计稿 plan/scratchpad-spec.md）。抽屉非模态——不加遮罩、不抢焦点，
// 开着时背后照常能逛、能往里收。内容与开合在 useScratchpadStore；播放动作由 App 交进来（和资料库同一个播放端口），
// 这里只决定什么按钮做什么：单条的「播放」插进当前队列，不换队列；唯一会换掉队列的是底部明写了的「替换队列播放」。
// 抽屉平时是左缘的面板（ScratchpadPanel：顶上这一页的米白信息条、底部另外两页的细纸带、放大的问候，Bravais 样式，计划见 plan/scratchpad-bravais-plan.md），
// 里面是按来源分组的列表（ScratchpadList）；展开整页（ScratchpadSheet，设计稿 F：倾斜的纸、横贯的信息条）后
// 是卡片画布（ScratchpadCanvas），每首是一张能拖动整理、能框选的笔记本卡。
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
    /** 打乱队列（与命令「打乱播放队列」同一个动作：正在播的那首留在最前；私人 FM、外部舞台时不做）。 */
    shuffle: () => void;
};

type ScratchpadHostProps = {
    isDaylight: boolean;
    playback: ScratchpadPlayback;
    queue: ScratchpadQueuePort;
    /** 播放页「隐藏 UI」时（与底部播放条同一个条件）：左缘的把手与感应带藏起来。开着的抽屉不受影响，Ctrl / ⌘ + J 照常能开合。 */
    isHandleHidden?: boolean;
};

/** 页签的先后（换页动画的方向、方向键换页都按它）。 */
const TABS = SCRATCHPAD_TABS;

/** 各页的全名（展开整页里那一页区域的名字）。 */
const PAGE_TITLE_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.history', queue: 'scratchpad.queue' };

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

/**
 * 墙上不算空白的地方：点它们照旧是它们的事，左缘面板不收（见「点空白处收起」）。海报与 Bravais 的瓷砖是 article；
 * 弹窗、菜单、列表框里的点击也不算。
 */
const NOT_BLANK_SELECTOR = [
    'button', 'a[href]', 'input', 'textarea', 'select', 'label', 'summary', 'video', 'audio', 'article',
    '[contenteditable]:not([contenteditable="false"])', '[draggable="true"]',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]',
    '[role="tab"]', '[role="checkbox"]', '[role="switch"]', '[role="slider"]', '[role="radio"]', '[role="gridcell"]', '[role="row"]',
    '[role="treeitem"]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]', '[aria-modal="true"]',
].join(', ');

/** 焦点在这些里面时 Esc 归它们（输入框里撤销输入法、弹窗与菜单自己关）。 */
const OWNS_ESCAPE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]';

/** 按下到松开挪了这么多就是拖（平移墙、拖东西），不算点。 */
const CLICK_SLOP_PX = 6;

const hasOpenModal = () => document.querySelector('[aria-modal="true"]') !== null;

/**
 * 左缘面板的进出（custom：toSheet 这一次是不是去展开整页，returning 是不是从展开整页回来）。
 * 去展开整页：纱淡上来时它一起淡掉，不往左滑（整页那条正从它顶上那条长出来），整页的卡片浮上来之前就没了。
 * 从展开整页回来：在原位、晚一点淡入（整页的卡片先淡掉、纱淡下去，信息条快落回它顶上那条时它才出来），
 * 不和还没收起的整页叠在一起（用户看到过的中间状态）。平时开合是从左边滑进滑出。
 */
type PanelMotionCustom = { toSheet: boolean; returning?: boolean };
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_VARIANTS = {
    away: { x: -32, opacity: 0 },
    returning: { x: 0, opacity: 0 },
    shown: (custom: PanelMotionCustom) => ({
        x: 0,
        opacity: 1,
        transition: custom.returning ? { duration: 0.18, delay: 0.18 } : { duration: 0.2, ease: PANEL_EASE },
    }),
    gone: (custom: PanelMotionCustom) => (custom.toSheet
        ? { opacity: 0, transition: { duration: 0.16, delay: 0.04 } }
        : { x: -32, opacity: 0, transition: { duration: 0.2, ease: PANEL_EASE } }),
};

/**
 * 换页时新旧两页往上走多远，以及进场 / 退场的缓动（进场与抽屉滑出同一条曲线）。和纸一样朝上走（用户要的，2026-11-07：
 * 纸带从底部升上来时列表还左右滑，对不上）：旧的一页往上淡出，新的一页从下面升上来。
 */
const PAGE_RISE_PX = 24;
const PAGE_LEAVE_PX = 14;
const PAGE_EASE_IN = [0.22, 1, 0.36, 1] as const;
const PAGE_EASE_OUT = [0.4, 0, 1, 1] as const;
const PAGE_VARIANTS = {
    enter: (calm: boolean) => ({ opacity: 0, y: calm ? 0 : PAGE_RISE_PX }),
    center: (calm: boolean) => ({ opacity: 1, y: 0, transition: { duration: calm ? 0.12 : 0.24, ease: PAGE_EASE_IN } }),
    exit: (calm: boolean) => ({ opacity: 0, y: calm ? 0 : -PAGE_LEAVE_PX, transition: { duration: calm ? 0.08 : 0.12, ease: PAGE_EASE_OUT } }),
};

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
    // 把手常驻时的样子（米白小条 / 细竖线 / 小圆点 / 几何体），指针进来一律展开成完整的米白标签。
    const handleStyle = useScratchpadSettingsStore(state => state.handleStyle);
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
            mark: 'circle',
            // 笔记本卡的第二行：歌手 · 从哪收来的（斜体，scratchpad.css）。
            entries: group.entries.map(entry => ({
                ...entry,
                meta: [getSongArtistLabel(entry.song), entry.origin?.label].filter(Boolean).join(' · '),
            })),
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

    // Esc 收起：焦点在抽屉里的时候在这里（焦点在外面时见下面「左缘面板浮在墙上」那一段）。画布开着时先收回列表（画布自己先处理
    // 选择与拖动）；焦点交还给把手，别掉到 body 上。
    const focusHandleRef = useRef(false);
    // 画布被 Esc 收回列表时，焦点落到展开按钮上（画布一卸载焦点就掉到 body，下一下 Esc 就没人接了）。
    const toggleCanvasRef = useRef<HTMLButtonElement>(null);
    const collapseCanvas = useCallback(() => {
        setExpanded(false);
        requestAnimationFrame(() => toggleCanvasRef.current?.focus());
    }, [setExpanded]);
    /**
     * Tab / Shift + Tab 换到下一页 / 上一页（首尾相接）。左缘面板里焦点落到这一页上（#scratchpad-panel，读屏念出页名）：
     * 原来那页的按钮卸掉以后焦点不至于掉到 body。展开整页里新挂上的画布自己接焦点；三行总览开着时不换（总览里三页都在，换了也看不出来）。
     */
    const showOverviewRef = useRef(false);
    const cycleTab = useCallback((direction: 1 | -1) => {
        if (showOverviewRef.current) return;
        const { tab: current, isExpanded: expanded } = useScratchpadStore.getState();
        const next = TABS[(TABS.indexOf(current) + direction + TABS.length) % TABS.length];
        setTab(next);
        if (!expanded) requestAnimationFrame(() => document.getElementById('scratchpad-panel')?.focus({ preventScroll: true }));
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
    // 展开整页盖住了墙：点的那颗按钮跟着浮动板、跟着删空的那一页一起卸掉，焦点落到 body 时，按键也归速记簿——
    // Esc 收回侧栏，其余抽屉键把焦点交还给这一页（画布、总览或整页本身），不让它们落到墙上（墙的键盘在 window 上听，
    // 所以这里在捕获阶段先接住）。Tab 交给上面那个换页。
    const drawerRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!isOpen || !isExpanded || isCovered) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const active = document.activeElement;
            if ((active && active !== document.body) || isTabCycleKey(event)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                collapseCanvas();
                return;
            }
            if (!DRAWER_KEYS.has(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            drawerRef.current?.querySelector<HTMLElement>('.scratchpad-canvas, .scratchpad-overview, .scratchpad-f')?.focus({ preventScroll: true });
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [collapseCanvas, isCovered, isExpanded, isOpen]);
    // 左缘面板浮在墙上（用户要的，2026-11-06）：Esc 先收起它，点墙上的空白处也收起它。
    // Esc：焦点在面板里由 handleKeyDown 管（收起后焦点交还把手）；这里管焦点在面板外的时候——刚用把手或 Ctrl / ⌘ + J 打开
    // （焦点落在 body）、点过墙上别处。焦点在输入框、弹窗、菜单里，或有模态弹窗开着时，Esc 是它们的。捕获阶段先接住，墙不再收到这一下。
    // 空白处：按下时就看准（处理函数可能在点击里把节点换掉），不在速记簿里、不是墙上可以点的东西（NOT_BLANK_SELECTOR）；
    // 松开时没挪开、没被谁接走（点击冒到 window 上、没 preventDefault）才收。
    useEffect(() => {
        if (!isOpen || isExpanded || isCovered) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
            const active = document.activeElement;
            if (active?.closest('.scratchpad-root') || active?.closest(OWNS_ESCAPE_SELECTOR) || hasOpenModal()) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        };
        let press: { x: number; y: number } | null = null;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            const blank = event.button === 0 && event.isPrimary && target instanceof Element
                && !target.closest('.scratchpad-root') && !target.closest(NOT_BLANK_SELECTOR) && !hasOpenModal();
            press = blank ? { x: event.clientX, y: event.clientY } : null;
        };
        const onClick = (event: MouseEvent) => {
            const start = press;
            press = null;
            if (!start || event.button !== 0 || event.defaultPrevented) return;
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
            setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('click', onClick);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('click', onClick);
        };
    }, [isCovered, isExpanded, isOpen, setOpen]);

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

    // 底部按钮是 F 的方角描边按钮：最常用的「全部入队」实心，清空单独靠右（点两下才清，第二下前写明）。
    const footer = entries.length > 0 && (
        <footer className="scratchpad-footer">
            <button type="button" className="scratchpad-pill is-solid" onClick={() => playback.enqueueAll(songs)}>
                <ListPlus aria-hidden="true" />
                <span>{t('scratchpad.enqueueAll')}</span>
            </button>
            <button type="button" className="scratchpad-pill" onClick={() => playback.replaceQueue(songs)}>
                <Play aria-hidden="true" />
                <span>{t('scratchpad.replaceQueue')}</span>
            </button>
            <span className="scratchpad-footer-spacer" />
            <button
                type="button"
                className={`scratchpad-pill${confirmingClear ? ' is-confirming' : ' is-icon'}`}
                title={t('scratchpad.clear')}
                aria-label={confirmingClear ? undefined : t('scratchpad.clear')}
                onClick={handleClear}
            >
                <Trash2 aria-hidden="true" />
                {confirmingClear && <span>{t('scratchpad.confirmClear')}</span>}
            </button>
        </footer>
    );

    const calm = useReducedMotionFor('uiMicroMotion');
    // 展开整页那张纸转 4°（设计稿 6°，用户嫌斜改小，2026-11-06）；降低动态效果时不转（同歌手页）。
    const tilt = calm ? 0 : SCRATCHPAD_TILT_DEG;
    // 面板这一次是怎么来、怎么走的（PANEL_VARIANTS）：从展开整页收回来时在原位晚一点淡入，去展开整页时淡掉，都不滑。
    const wasExpandedRef = useRef(isExpanded);
    const panelReturns = wasExpandedRef.current && !isExpanded;
    useEffect(() => {
        wasExpandedRef.current = isExpanded;
    }, [isExpanded]);
    // 展开整页的信息条上「‹ 三行总览」换到三行总览；收回侧栏之后再展开，回到这一页（不回总览）。
    const [showOverview, setShowOverview] = useState(false);
    showOverviewRef.current = isExpanded && showOverview;
    useEffect(() => {
        if (!isExpanded) setShowOverview(false);
    }, [isExpanded]);
    const openPage = useCallback((next: ScratchpadTab) => {
        setTab(next);
        setShowOverview(false);
    }, [setTab]);
    const notesSide = useMemo<CanvasSide>(() => ({
        jumpLabel: t('scratchpad.jumpTo'),
        tipsLabel: t('scratchpad.tipsTitle'),
        mark: 'circle',
        tips: scratchpadTips('notes', t, PRIMARY_MODIFIER_LABEL),
    }), [t]);
    // 构成主义的纸、墨与跟主题强调色走的点缀色（scratchpadLook）交给样式表：边缘标签、面板与展开页都读这些变量。
    // 不接墙上的「海报聚焦叠色」（2026-11-06 接过，11-07 用户让展开整页与面板都去掉）。
    const lookVars = useMemo(() => scratchpadLookVars(isDaylight) as React.CSSProperties, [isDaylight]);
    // 底部两条细纸带的上下次序：面板与展开整页共用，展开、收起时每条落在对面同一格。
    const slimOrder = useSlimOrder(TABS, tab);

    // 页签下面的那一页（列表、画布或播放历史）：左缘面板与展开后的画布共用。
    const tabPanel = (
        <div
            className="scratchpad-panel"
            // 一块有名字的区域（没有页签：信息条与细纸带换页）。Tab 换页后焦点落在这里（cycleTab）。
            role="region"
            id="scratchpad-panel"
            tabIndex={-1}
            aria-label={t(PAGE_TITLE_KEYS[tab])}
        >
            {/* 换页：旧的一页往上淡出，新的一页从下面升上来（PAGE_VARIANTS）。先退后进（mode wait），
                两页不同时在场，列表与画布各自的尺寸量得准。降级动效时只淡入淡出。 */}
            <AnimatePresence initial={false} mode="wait" custom={calm}>
                <motion.div
                    key={tab}
                    className="scratchpad-panel-page"
                    data-page={tab}
                    custom={calm}
                    variants={PAGE_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                >
                    {tab === 'history' ? (
                        <>
                            {!isExpanded && <p className="scratchpad-hint">{t('scratchpad.historyHint')}</p>}
                            <ScratchpadHistory playback={playback} expanded={isExpanded} onCollapse={collapseCanvas} />
                        </>
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
                                <>
                                    <ScratchpadBandActions>{footer}</ScratchpadBandActions>
                                    <ScratchpadCanvas
                                        groups={canvasGroups}
                                        freshKeys={freshKeys}
                                        variant="note"
                                        spacing={NOTE_SPACING}
                                        tilt={tilt}
                                        side={notesSide}
                                        ariaLabel={t('scratchpad.title')}
                                        playLabel={t('scratchpad.play')}
                                        onPlay={actions.play}
                                        onMove={actions.move}
                                        onDelete={removeEntries}
                                        selectionActions={notesSelectionActions}
                                        onEscape={collapseCanvas}
                                    />
                                </>
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
    );

    return (
        <div
            className={`scratchpad-root${isDaylight ? ' is-daylight' : ''}${isCovered ? ' is-covered' : ''}${calm ? ' is-calm' : ''}`}
            style={lookVars}
        >
            {!isOpen && !isHandleHidden && showHandle && (
                <ScratchpadEdge
                    handleStyle={handleStyle}
                    position={handlePosition}
                    count={entries.length}
                    pulsing={pulsing}
                    title={t('scratchpad.title')}
                    label={handleLabel}
                    hint={handleTitle}
                    onToggle={toggleOpen}
                    handleRef={handleRef}
                />
            )}

            {/* 左缘的面板与展开整页各是一层：展开、收回时两层同时在场——展开时纱淡上来，这一页的信息条从面板顶上那条长出来、
                纸转过去，面板在纱底下待一会儿再淡掉；收回时信息条缩回面板顶上那条、纸转回来、纱淡掉，面板已经在原位等着
                （ScratchpadSheet 的文件头）。 */}
            <AnimatePresence custom={{ toSheet: isExpanded } satisfies PanelMotionCustom}>
                {isOpen && !isExpanded && (
                    <motion.aside
                        key="scratchpad-panel"
                        className="scratchpad-drawer is-panel"
                        data-page={tab}
                        data-testid="scratchpad-drawer"
                        data-ponder="scratchpad"
                        aria-label={t('scratchpad.title')}
                        custom={{ toSheet: isExpanded, returning: panelReturns && !calm } satisfies PanelMotionCustom}
                        variants={PANEL_VARIANTS}
                        initial={panelReturns && !calm ? 'returning' : 'away'}
                        animate="shown"
                        exit="gone"
                        onKeyDown={handleKeyDown}
                    >
                        <ScratchpadPanel
                            tab={tab}
                            notesCount={entries.length}
                            queueCount={queueLength}
                            slimOrder={slimOrder}
                            onSelectTab={setTab}
                            onClose={() => setOpen(false)}
                            expandLabel={expandLabel}
                            expandDisabled={tab === 'notes' && entries.length === 0}
                            onExpand={() => setExpanded(true)}
                            expandRef={toggleCanvasRef}
                        >
                            {tabPanel}
                        </ScratchpadPanel>
                    </motion.aside>
                )}
            </AnimatePresence>
            <AnimatePresence>
                {isOpen && isExpanded && (
                    <motion.aside
                        ref={drawerRef}
                        key="scratchpad-sheet"
                        className="scratchpad-drawer is-expanded"
                        data-page={tab}
                        data-testid="scratchpad-drawer"
                        data-ponder="scratchpad"
                        aria-label={t('scratchpad.title')}
                        // 整页自己不淡入：纱、纸、信息条各管各的（ScratchpadSheet）。收回时等信息条落回面板顶上那条、纸转回来，
                        // 最后一下才淡掉（那时条与面板那条叠在一处，看不出来）；也给里面各层的退场兜个底。
                        exit={{ opacity: 0, transition: { duration: calm ? 0.12 : 0.08, delay: calm ? 0 : 0.42 } }}
                        onKeyDown={handleKeyDown}
                    >
                        <ScratchpadSheet
                            tab={tab}
                            notesCount={entries.length}
                            queueCount={queueLength}
                            tilt={tilt}
                            calm={calm}
                            slimOrder={slimOrder}
                            onOpenPage={openPage}
                            onCollapse={collapseCanvas}
                            collapseLabel={t('scratchpad.collapseCanvas')}
                            onShowOverview={() => setShowOverview(true)}
                            overview={showOverview ? ((sheetWidth, viewHeight) => (
                                <ScratchpadOverview
                                    playback={playback}
                                    queue={queue}
                                    tilt={tilt}
                                    sheetWidth={sheetWidth}
                                    viewHeight={viewHeight}
                                    onOpenPage={openPage}
                                    onEscape={collapseCanvas}
                                />
                            )) : null}
                        >
                            {tabPanel}
                        </ScratchpadSheet>
                    </motion.aside>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ScratchpadHost;
