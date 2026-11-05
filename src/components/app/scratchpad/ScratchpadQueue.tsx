import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Check, ListEnd, ListMusic, ListStart, NotebookPen, Star, Trash2 } from 'lucide-react';
import type { SongResult } from '../../../types';
import { selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { collectToScratchpad, scratchpadGroupKey, useScratchpadStore } from '../../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { applyQueueBatchOperation } from '../../../utils/queueBatchOperations';
import type { QueueBatchAction } from '../../command-palette/queueQuery';
import { moveBlockToIndex } from './queueOrder';
import { THREAD_SPACING } from './canvasLayout';
import { scratchpadSourceLabel, type ScratchpadAction } from './scratchpadModel';
import ScratchpadSongTable from './ScratchpadSongTable';
import ScratchpadCanvas, { type CanvasGroup } from './ScratchpadCanvas';
import type { CanvasEntry } from './ScratchpadCard';
import { useQueueOrderDraft } from './useQueueOrderDraft';
import type { ScratchpadQueuePort } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadQueue.tsx
// 速记簿的第三页：当前的播放队列（直接读 usePlaybackStore）。正在播放的那首有记号，打开时滚到它。
// 点一首就播放它（不换队列、不跳页）；行内按钮：下一首播放、移到末尾、加入速记簿、移除。
// 展开后是和速记簿一样的卡片画布（ScratchpadCanvas）：框选、Ctrl / Shift 点选，浮动菜单里下一首播放、移到末尾、加入速记簿、
// 收藏到歌单、移出队列；选中几张一起拖动换位置。一条带箭头的线按播放的先后穿过所有卡片，放过的那一段淡一些。
// 拖动松手只改草稿，停手一会儿才一次写进队列（useQueueOrderDraft），免得 Lattice 这些跟着队列重排的画面连着重渲染。
// 正在播放的那首（显示的那首与内部 currentSong，automix 交叉淡入时两首不同）不能移除，与墙面工具的队列浮岛一致。
// 外部舞台播放（activePlaybackContext 是 stage）与私人 FM 时只读：只能点歌播放（FM 时照旧按 FM 播）、收进速记簿或歌单。

type ScratchpadQueueProps = {
    queue: ScratchpadQueuePort;
    expanded: boolean;
    /** 画布里没有选择时按 Esc：收回窄的列表。 */
    onCollapse: () => void;
};

/** 画布上只有一组：整个队列。 */
const QUEUE_GROUP_KEY = 'queue';

/** 此刻 store 里的队列（批量操作没改动顺序时，判断草稿要不要单独写进去）。 */
const playQueueOf = () => usePlaybackStore.getState().playQueue;

const BATCH_STATUS_KEYS: Record<QueueBatchAction, string> = {
    remove: 'status.queueBatchRemoved',
    next: 'status.queueBatchMovedNext',
    end: 'status.queueBatchMovedEnd',
};

/** 行 id 按播放键记（开播时正在播的那首会换成新对象，id 不能跟着对象变），同一首排了几次再带上第几次。 */
const rowIdsOf = (order: readonly SongResult[]) => {
    const seen = new Map<string, number>();
    return order.map(song => {
        const key = getPlaybackSongKey(song);
        const occurrence = seen.get(key) ?? 0;
        seen.set(key, occurrence + 1);
        return `${key}#${occurrence}`;
    });
};

const ScratchpadQueue: React.FC<ScratchpadQueueProps> = ({ queue, expanded, onCollapse }) => {
    const { t } = useTranslation();
    const { playQueue, currentSong, displaySong, readOnly } = usePlaybackStore(useShallow(state => ({
        playQueue: state.playQueue,
        currentSong: state.currentSong,
        displaySong: selectDisplaySong(state),
        readOnly: state.activePlaybackContext === 'stage' || state.isFmMode,
    })));
    const notes = useScratchpadStore(state => state.entries);
    const collectedKeys = useMemo(() => new Set(notes.map(entry => entry.key)), [notes]);

    const draft = useQueueOrderDraft(playQueue, queue.setOrder);
    const order = draft.order;
    const displayKey = displaySong ? getPlaybackSongKey(displaySong) : null;
    const playingKey = currentSong ? getPlaybackSongKey(currentSong) : null;

    const rows = useMemo<CanvasEntry[]>(() => {
        const ids = rowIdsOf(order);
        const currentIndex = displayKey === null ? -1 : order.findIndex(song => getPlaybackSongKey(song) === displayKey);
        return order.map((song, index) => ({
            key: ids[index],
            song,
            meta: [getSongArtistLabel(song), scratchpadSourceLabel(song, t)].filter(Boolean).join(' · '),
            isCurrent: displayKey !== null && getPlaybackSongKey(song) === displayKey,
            // 画布上排在当前这首之前（已经放过）的灰掉（用户定，2026-11-05）；收起时的列表不画这个。
            isDimmed: currentIndex >= 0 && index < currentIndex,
        }));
    }, [displayKey, order, t]);
    const focusIndex = useMemo(() => rows.findIndex(row => row.isCurrent), [rows]);

    // 行内按钮与菜单在事件里读这一刻的值（身份稳定，行不因为它们重渲染）。
    const latest = useRef({ rows, order, currentSong, displayKey, playingKey, readOnly, collectedKeys, draft, queue, t });
    latest.current = { rows, order, currentSong, displayKey, playingKey, readOnly, collectedKeys, draft, queue, t };

    const isLocked = useCallback((song: SongResult) => {
        const key = getPlaybackSongKey(song);
        return key === latest.current.displayKey || key === latest.current.playingKey;
    }, []);

    /** 下一首播放、移到末尾、移除：在界面上看到的顺序（含没提交的草稿）上算，一次写进队列。 */
    const runBatch = useCallback((action: QueueBatchAction, targets: CanvasEntry[]) => {
        const { rows: currentRows, order: currentOrder, currentSong: playing, queue: port, draft: currentDraft, t: translate } = latest.current;
        const indexOf = new Map(currentRows.map((row, index) => [row.key, index]));
        const indices = targets
            .filter(row => action !== 'remove' || !isLocked(row.song))
            .map(row => indexOf.get(row.key) ?? -1)
            .filter(index => index >= 0);
        const result = applyQueueBatchOperation({ queue: currentOrder, targetIndices: indices, currentSong: playing, action });
        if (result.affectedCount === 0) return;
        // 算的是草稿顺序：草稿就此作废，由这一次写入一起带进队列（只写一次）。
        currentDraft.discard();
        if (result.changed) port.setOrder(result.nextQueue);
        else if (currentOrder !== playQueueOf()) port.setOrder(currentOrder);
        console.info('[Scratchpad] queue batch', { action, count: result.affectedCount });
        setStatusMessage({
            type: 'success',
            text: translate(BATCH_STATUS_KEYS[action], { count: result.affectedCount }),
            nonce: Date.now(),
            durationMs: 1600,
        });
    }, [isLocked]);

    const play = useCallback((row: CanvasEntry) => {
        // 有没提交的草稿先提交：播放按的是队列里的这一首。
        latest.current.draft.flush();
        latest.current.queue.playSong(row.song);
    }, []);

    const collect = useCallback((songs: SongResult[]) => {
        collectToScratchpad(songs, { label: latest.current.t('scratchpad.originQueue') });
    }, []);

    const rowActions = useCallback((row: CanvasEntry): ScratchpadAction[] => {
        const { readOnly: locked, collectedKeys: collected, t: translate } = latest.current;
        const actions: ScratchpadAction[] = [];
        if (!locked) {
            // 正在播的那首（显示的与内部的）没有「下一首播放」：对它是空操作，交叉淡入时还会把淡出的那首排回来再放一遍。
            if (!isLocked(row.song)) {
                actions.push({ id: 'play-next', label: translate('scratchpad.playNext'), icon: ListStart, run: () => runBatch('next', [row]) });
            }
            actions.push({ id: 'move-to-end', label: translate('scratchpad.moveToEnd'), icon: ListEnd, run: () => runBatch('end', [row]) });
        }
        actions.push(collected.has(getPlaybackSongKey(row.song))
            ? { id: 'collected', label: translate('scratchpad.alreadyInOne'), icon: Check, run: () => undefined, disabled: true }
            : { id: 'collect', label: translate('scratchpad.collect'), icon: NotebookPen, run: () => collect([row.song]) });
        if (!locked) {
            const cannotRemove = isLocked(row.song);
            actions.push({
                id: 'remove-from-queue',
                label: translate('scratchpad.removeFromQueue'),
                title: cannotRemove ? translate('scratchpad.cannotRemoveCurrent') : undefined,
                icon: Trash2,
                run: () => runBatch('remove', [row]),
                disabled: cannotRemove,
            });
        }
        return actions;
        // collectedKeys 与 readOnly 变了要重画行内按钮：放进依赖换掉函数身份。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collect, isLocked, runBatch, collectedKeys, readOnly]);

    const selectionActions = useCallback((selected: CanvasEntry[]): ScratchpadAction[] => {
        const { readOnly: locked, t: translate } = latest.current;
        const songs = selected.map(row => row.song);
        const sameSource = new Set(songs.map(scratchpadGroupKey)).size === 1;
        const canSave = sameSource && songs.every(canOpenPlaylistPickerFor);
        const actions: ScratchpadAction[] = [];
        if (!locked) {
            actions.push(
                { id: 'play-next', label: translate('scratchpad.playNext'), icon: ListStart, run: () => runBatch('next', selected.filter(row => !isLocked(row.song))) },
                { id: 'move-to-end', label: translate('scratchpad.moveToEnd'), icon: ListEnd, run: () => runBatch('end', selected) },
            );
        }
        actions.push(
            { id: 'collect', label: translate('scratchpad.collect'), icon: NotebookPen, run: () => collect(songs) },
            {
                id: 'save-to-playlist',
                label: translate('scratchpad.addToPlaylist'),
                title: sameSource ? undefined : translate('scratchpad.mixedSourcesHint'),
                icon: Star,
                run: () => openAddSongsToPlaylist(songs),
                disabled: !canSave,
            },
        );
        if (!locked) {
            actions.push({ id: 'remove-from-queue', label: translate('scratchpad.removeFromQueue'), icon: Trash2, run: () => runBatch('remove', selected) });
        }
        return actions;
    }, [collect, isLocked, runBatch]);

    // 画布松手：选中的几张整块插到其余卡片之间第 targetIndex 个位置，只改草稿。
    const reorder = useCallback((_groupKey: string, keys: string[], targetIndex: number) => {
        const { rows: currentRows, order: currentOrder, draft: currentDraft } = latest.current;
        const indexOf = new Map(currentRows.map((row, index) => [row.key, index]));
        const next = moveBlockToIndex(currentOrder, keys.map(key => indexOf.get(key) ?? -1), targetIndex);
        if (next !== currentOrder) currentDraft.place(next);
    }, []);
    const hold = useCallback(() => latest.current.draft.hold(), []);
    const resume = useCallback(() => latest.current.draft.resume(), []);
    const remove = useCallback((selected: CanvasEntry[]) => runBatch('remove', selected), [runBatch]);

    // 画布上的那一组：线从第一首穿到最后一首，正在播的那首之前（放过的）那一段淡一些。
    const canvasGroups = useMemo<CanvasGroup[]>(() => [{
        key: QUEUE_GROUP_KEY,
        label: t('scratchpad.queue'),
        entries: rows,
        thread: { kind: 'flow', playedThrough: focusIndex },
    }], [focusIndex, rows, t]);

    if (rows.length === 0) {
        return (
            <div className="scratchpad-empty" data-testid="scratchpad-queue-empty">
                <ListMusic aria-hidden="true" />
                <p>{t('scratchpad.queueEmpty')}</p>
            </div>
        );
    }

    if (expanded) {
        return (
            <ScratchpadCanvas
                groups={canvasGroups}
                hint={t(readOnly ? 'scratchpad.queueCanvasHintReadOnly' : 'scratchpad.queueCanvasHint', { mod: PRIMARY_MODIFIER_LABEL })}
                ariaLabel={t('scratchpad.queue')}
                testId="scratchpad-queue"
                playLabel={t('scratchpad.playFromQueue')}
                onPlay={play}
                onMove={readOnly ? undefined : reorder}
                onDragStart={hold}
                onDragEnd={resume}
                onDelete={readOnly ? undefined : remove}
                selectionActions={selectionActions}
                onEscape={onCollapse}
                spacing={THREAD_SPACING}
                focusKey={focusIndex >= 0 ? rows[focusIndex].key : undefined}
            />
        );
    }

    return (
        <ScratchpadSongTable
            rows={rows}
            primaryLabel={t('scratchpad.playFromQueue')}
            onActivate={play}
            rowActions={rowActions}
            focusIndex={focusIndex}
            ariaLabel={t('scratchpad.queue')}
            testId="scratchpad-queue"
        />
    );
};

export default ScratchpadQueue;
