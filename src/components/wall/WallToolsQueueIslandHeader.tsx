import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Save, Search, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import type { WallToolsHost } from './wallToolsHost';

// src/components/wall/WallToolsQueueIslandHeader.tsx
// 队列浮岛（WallToolsQueueIsland）的头部：「播放队列 · N 首」、搜索、存为本地歌单、清空。
// - 搜索：放大镜按钮展开成盖住整个头部的拱门形搜索框（自动聚焦，关闭按钮在框里），开着时不给存歌单与清空（免得以为只作用于
//   筛出的歌）；筛选本身、搜索框里的 ↓ / Enter 由浮岛处理。关闭（× 或 Esc）清掉搜索词，焦点回到放大镜按钮。
//   展开 / 收起：搜索框叠在头部那一行上面（绝对定位），clip-path 从放大镜按钮那一小块胶囊长到整个拱门、收起时缩回去；
//   底下那一行（标题与按钮）同时淡出 / 淡入，淡出后 visibility: hidden，不留在 Tab 顺序里。收起时的落点在关闭那一刻重新量
//   （经 AnimatePresence 的 custom 交给正在退场的框）。降级动效（uiMicroMotion）时直接出现、消失。
// - 存为本地歌单用头部内联输入框（不用 TextInputDialog：它没有 portal、z-[200]，会卡在 dock 的层级里，还会和点外部关闭、
//   Esc 冲突）：Enter 保存并弹提示，失败也提示、焦点回到输入框（保存中输入框禁用会丢焦点）；Esc 取消。
// - 清空两步确认：第一次点后 3 秒内按钮变成「再点一次清空」并经浮岛的 aria-live 播报，再点才清空；Esc 撤回。
//   进入确认态后 400ms 内的点击、以及双击里的第二击（event.detail > 1）都不算「再点一次」：双击不能绕过确认。
// Esc 在 document 捕获阶段处理（先于面板在 document 上的冒泡监听收起面板）；拖拽中让给浮岛撤拖拽。
// 外部舞台播放（只读）时不给保存与清空，只挂一把锁说明原因；搜索照常。

/** 清空的两步确认窗口（ms）。 */
const CLEAR_CONFIRM_MS = 3000;
/** 进入确认态之后这么久（ms）以内的点击不算确认（双击、手抖连点）。 */
const CLEAR_CONFIRM_GUARD_MS = 400;

/** 搜索框与头部左右边缘的距离（px），与 CSS 的 .lattice-tools-island-search 一致。 */
const SEARCH_FIELD_INSET = 6;
/** 搜索框完全展开时的裁切：整个拱门。 */
const SEARCH_OPEN_CLIP = 'inset(0px 0px 0px 0px round 14px 14px 6px 6px)';
/** 展开快、收起略快一点；缓动与遥控窗口队列展开的 settle 相同。 */
const SEARCH_OPEN_TRANSITION = { duration: 0.26, ease: [0.32, 0.72, 0, 1] } as const;
const SEARCH_CLOSE_TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.2, 1] } as const;

/** 搜索框收拢时的裁切：只露出放大镜按钮那一块（量不到按钮时收向右端）。 */
const measureSearchClosedClip = (header: HTMLElement | null, button: HTMLElement | null) => {
    if (!header) return SEARCH_OPEN_CLIP;
    const headerRect = header.getBoundingClientRect();
    const fieldLeft = headerRect.left + SEARCH_FIELD_INSET;
    const fieldRight = headerRect.right - SEARCH_FIELD_INSET;
    const buttonRect = button?.getBoundingClientRect();
    const hasButton = Boolean(buttonRect && buttonRect.width > 0);
    const left = hasButton ? buttonRect!.left - fieldLeft : fieldRight - fieldLeft - 28;
    const right = hasButton ? fieldRight - buttonRect!.right : 0;
    const round = (value: number) => Math.max(0, Math.round(value));
    return `inset(0px ${round(right)}px 0px ${round(left)}px round 12px 12px 12px 12px)`;
};

type WallToolsQueueIslandHeaderProps = {
    host: WallToolsHost;
    count: number;
    readOnly: boolean;
    /** 当前队列能不能存成本地歌单（utils/queueReorder 的 canSaveQueueAsLocalPlaylist）。 */
    canSave: boolean;
    /** 经浮岛的 aria-live 播报一句。 */
    announce: (text: string) => void;
    /** 浮岛此刻在拖拽：Esc 先撤拖拽，这里不接。 */
    isDragging: () => boolean;
    /** 搜索：状态在浮岛（列表要按它筛选），这里只画输入框和开关。 */
    search: QueueIslandSearch;
};

export type QueueIslandSearch = {
    open: boolean;
    query: string;
    inputRef: RefObject<HTMLInputElement | null>;
    onOpen: () => void;
    /** 收起搜索框并清掉搜索词。 */
    onClose: () => void;
    onQueryChange: (query: string) => void;
    /** 搜索框里的按键（↓ 进第一行、Enter 播放第一首匹配）。 */
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
};

export function WallToolsQueueIslandHeader({ host, count, readOnly, canSave, announce, isDragging, search }: WallToolsQueueIslandHeaderProps) {
    const { t } = useTranslation();
    const reduceMotion = useReducedMotionFor('uiMicroMotion');
    const headerRef = useRef<HTMLElement>(null);
    const searchButtonRef = useRef<HTMLButtonElement>(null);
    /** 搜索框收拢时的裁切（展开前、收起前各量一次）。 */
    const [searchClosedClip, setSearchClosedClip] = useState(SEARCH_OPEN_CLIP);
    const saveButtonRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [naming, setNaming] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [saving, setSaving] = useState(false);
    const [clearPending, setClearPending] = useState(false);
    const clearTimerRef = useRef<number | null>(null);
    /** 进入清空确认态的时刻（performance.now()）。 */
    const clearPendingSinceRef = useRef(0);

    const stopClearPending = useCallback(() => {
        if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
        setClearPending(false);
    }, []);
    useEffect(() => () => {
        if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    }, []);

    const handleClear = (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (clearPending) {
            // 双击的第二击、或刚进入确认态就跟上来的点击：不算确认。
            if (event.detail > 1 || performance.now() - clearPendingSinceRef.current < CLEAR_CONFIRM_GUARD_MS) return;
            stopClearPending();
            host.clearQueue();
            return;
        }
        clearPendingSinceRef.current = performance.now();
        setClearPending(true);
        announce(t('wallTools.queueClearConfirm'));
        clearTimerRef.current = window.setTimeout(() => {
            clearTimerRef.current = null;
            setClearPending(false);
        }, CLEAR_CONFIRM_MS);
    };

    /** 收起内联输入，焦点回到「存为本地歌单」按钮。 */
    const stopNaming = useCallback(() => {
        setNaming(false);
        setDraftName('');
        requestAnimationFrame(() => saveButtonRef.current?.focus({ preventScroll: true }));
    }, []);

    const submitName = async () => {
        const name = draftName.trim();
        if (!name || saving) return;
        setSaving(true);
        try {
            await host.saveQueueAsPlaylist(name);
            setStatusMessage({ type: 'success', text: t('wallTools.queueSaved', { name }), nonce: Date.now() });
            stopNaming();
        } catch (error) {
            console.error('[WallToolsQueueIsland] Failed to save the queue as a local playlist', error);
            setStatusMessage({ type: 'error', text: t('wallTools.queueSaveFailed'), nonce: Date.now() });
        } finally {
            setSaving(false);
        }
    };

    // 保存失败（saving 回到 false 而输入框还在）：焦点还给输入框，接着改名或 Esc。成功时 stopNaming 已经收起了输入框。
    const wasSavingRef = useRef(false);
    useEffect(() => {
        const wasSaving = wasSavingRef.current;
        wasSavingRef.current = saving;
        if (wasSaving && !saving && naming) inputRef.current?.focus({ preventScroll: true });
    }, [naming, saving]);

    const { open: searching, onClose: closeSearch } = search;
    /** 收起搜索框，焦点回到放大镜按钮。 */
    const stopSearching = useCallback(() => {
        setSearchClosedClip(measureSearchClosedClip(headerRef.current, searchButtonRef.current));
        closeSearch();
        requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
    }, [closeSearch]);

    // Esc：内联输入（命名、搜索）或清空待确认时只撤这一步（拖拽中让给浮岛）。
    useEffect(() => {
        if (!naming && !searching && !clearPending) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || isDragging()) return;
            if (naming) stopNaming();
            else if (searching) stopSearching();
            else stopClearPending();
            event.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [clearPending, isDragging, naming, searching, stopClearPending, stopNaming, stopSearching]);

    // 队列空了（清空完、别处清掉）就没有待确认这回事。
    useEffect(() => {
        if (count === 0 && clearPending) stopClearPending();
    }, [clearPending, count, stopClearPending]);

    const clearLabel = clearPending ? t('wallTools.queueClearConfirm') : t('wallTools.queueClear');

    return (
        <header ref={headerRef} className={searching ? 'lattice-tools-island-header is-searching' : 'lattice-tools-island-header'}>
            <div className="lattice-tools-island-header-row">
                {naming ? (
                    <input
                        ref={inputRef}
                        className="lattice-tools-island-input"
                        type="text"
                        value={draftName}
                        autoFocus
                        disabled={saving}
                        aria-label={t('localMusic.enterPlaylistName')}
                        placeholder={t('localMusic.enterPlaylistName')}
                        onChange={event => setDraftName(event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            void submitName();
                        }}
                    />
                ) : (
                    <span className="lattice-tools-island-heading">{t('wallTools.queueCount', { count })}</span>
                )}
                {readOnly && (
                    <span className="lattice-tools-island-note" title={t('wallTools.queueStageReadOnly')}>
                        <Lock aria-hidden="true" />
                        <span className="sr-only">{t('wallTools.queueStageReadOnly')}</span>
                    </span>
                )}
                {!naming && count > 0 && (
                    <button
                        ref={searchButtonRef}
                        type="button"
                        className="lattice-tools-island-header-action"
                        data-queue-island-action="search"
                        aria-label={t('wallTools.queueSearch')}
                        title={t('wallTools.queueSearch')}
                        onClick={event => {
                            stopClearPending();
                            setSearchClosedClip(measureSearchClosedClip(headerRef.current, event.currentTarget));
                            search.onOpen();
                        }}
                    >
                        <Search aria-hidden="true" />
                    </button>
                )}
                {canSave && !readOnly && !naming && (
                    <button
                        ref={saveButtonRef}
                        type="button"
                        className="lattice-tools-island-header-action"
                        data-queue-island-action="save"
                        aria-label={t('wallTools.queueSave')}
                        title={t('wallTools.queueSave')}
                        onClick={() => {
                            stopClearPending();
                            setNaming(true);
                        }}
                    >
                        <Save aria-hidden="true" />
                    </button>
                )}
                {!readOnly && !naming && count > 0 && (
                    <button
                        type="button"
                        className={clearPending ? 'lattice-tools-island-header-action is-confirming' : 'lattice-tools-island-header-action'}
                        data-queue-island-action="clear"
                        aria-label={clearLabel}
                        title={clearLabel}
                        onClick={handleClear}
                    >
                        <Trash2 aria-hidden="true" />
                        {clearPending && <span aria-hidden="true">{clearLabel}</span>}
                    </button>
                )}
            </div>
            <AnimatePresence custom={searchClosedClip}>
                {searching && (
                    // 搜索框是拱门形，放大镜和关闭按钮都在框里；上、左、右与浮岛边缘等距，上面两个角与浮岛的圆角同心。
                    <motion.div
                        key="search"
                        className="lattice-tools-island-search"
                        custom={searchClosedClip}
                        variants={{
                            closed: (clip: string) => ({
                                clipPath: clip,
                                opacity: 0,
                                transition: reduceMotion ? { duration: 0 } : { ...SEARCH_CLOSE_TRANSITION, opacity: { duration: 0.12, delay: 0.08 } },
                            }),
                            open: {
                                clipPath: SEARCH_OPEN_CLIP,
                                opacity: 1,
                                transition: reduceMotion ? { duration: 0 } : { ...SEARCH_OPEN_TRANSITION, opacity: { duration: 0.1 } },
                            },
                        }}
                        initial="closed"
                        animate="open"
                        exit="closed"
                    >
                        <Search aria-hidden="true" />
                        <input
                            ref={search.inputRef}
                            className="lattice-tools-island-search-input"
                            type="text"
                            value={search.query}
                            autoFocus
                            spellCheck={false}
                            data-queue-island-search=""
                            aria-label={t('wallTools.queueSearch')}
                            placeholder={t('wallTools.queueSearchPlaceholder', { count })}
                            onChange={event => search.onQueryChange(event.currentTarget.value)}
                            onKeyDown={search.onKeyDown}
                        />
                        <button
                            type="button"
                            className="lattice-tools-island-search-close"
                            data-queue-island-action="close-search"
                            aria-label={t('wallTools.queueSearchClose')}
                            title={t('wallTools.queueSearchClose')}
                            onClick={stopSearching}
                        >
                            <X aria-hidden="true" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
}
