import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Lock, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useQueueUi } from '../../hooks/useQueueUi';
import { QueueUiComponents } from '../shared/QueueUiAdditions';
import type { WallToolsHost } from './wallToolsHost';

// src/components/wall/WallToolsQueueIslandHeader.tsx
// 队列浮岛（WallToolsQueueIsland）的头部：「播放队列 · N 首」、存为本地歌单、清空。
// - 存为本地歌单用头部内联输入框（不用 TextInputDialog：它没有 portal、z-[200]，会卡在 dock 的层级里，还会和点外部关闭、
//   Esc 冲突）：Enter 保存并弹提示，失败也提示、焦点回到输入框（保存中输入框禁用会丢焦点）；Esc 取消。
// - 清空两步确认：第一次点后 3 秒内按钮变成「再点一次清空」并经浮岛的 aria-live 播报，再点才清空；Esc 撤回。
//   进入确认态后 400ms 内的点击、以及双击里的第二击（event.detail > 1）都不算「再点一次」：双击不能绕过确认。
// Esc 在 document 捕获阶段处理（先于面板在 document 上的冒泡监听收起面板）；拖拽中让给浮岛撤拖拽。
// 外部舞台播放（只读）时不给保存与清空，只挂一把锁说明原因。

/** 清空的两步确认窗口（ms）。 */
const CLEAR_CONFIRM_MS = 3000;
/** 进入确认态之后这么久（ms）以内的点击不算确认（双击、手抖连点）。 */
const CLEAR_CONFIRM_GUARD_MS = 400;

type WallToolsQueueIslandHeaderProps = {
    isDaylight?: boolean;
    host: WallToolsHost;
    count: number;
    readOnly: boolean;
    /** 当前队列能不能存成本地歌单（utils/queueReorder 的 canSaveQueueAsLocalPlaylist）。 */
    canSave: boolean;
    /** 经浮岛的 aria-live 播报一句。 */
    announce: (text: string) => void;
    /** 浮岛此刻在拖拽：Esc 先撤拖拽，这里不接。 */
    isDragging: () => boolean;
};

export function WallToolsQueueIslandHeader({ host, count, readOnly, canSave, announce, isDragging, isDaylight = false }: WallToolsQueueIslandHeaderProps) {
    const { t } = useTranslation();
    const queue = usePlaybackStore(state => state.playQueue);
    const { headerContent } = useQueueUi(queue, 'wall');
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

    // Esc：内联输入或清空待确认时只撤这一步（拖拽中让给浮岛）。
    useEffect(() => {
        if (!naming && !clearPending) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || isDragging()) return;
            if (naming) stopNaming();
            else stopClearPending();
            event.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [clearPending, isDragging, naming, stopClearPending, stopNaming]);

    // 队列空了（清空完、别处清掉）就没有待确认这回事。
    useEffect(() => {
        if (count === 0 && clearPending) stopClearPending();
    }, [clearPending, count, stopClearPending]);

    const clearLabel = clearPending ? t('wallTools.queueClearConfirm') : t('wallTools.queueClear');

    return (
        <header className="lattice-tools-island-header">
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
            {!naming && <QueueUiComponents components={headerContent} isDaylight={isDaylight} />}
        </header>
    );
}
