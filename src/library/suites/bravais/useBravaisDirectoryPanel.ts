import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    LibraryDirectoryBatchActionId,
    LibraryDirectoryBatchCapabilities,
    LibraryDirectoryBatchConfig,
    LibraryDirectoryBatchContext,
} from '../../core/directory/directory.contract';
import type { LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import { canRunDirectoryBatchAction } from '../../core/directory/directoryBatch';
import type { BravaisDirectoryPanel, BravaisHomeBatch } from './bravaisHomeModels';
import { projectDirectoryRows, resolveSelectAllState, type BravaisHomeEntry } from './bravaisHomeProjection';
import type { BravaisSeamForm } from './bravaisSeamModels';
import { useBravaisMutationNotice } from './useBravaisMutationNotice';

// src/library/suites/bravais/useBravaisDirectoryPanel.ts
// 目录树面板（GridMap 的批量模式）的模型与动作（设计稿 §5「目录树」、§10.5）：树的行与三态（core 的纯规则，见
// bravaisHomeProjection）、展开 / 收起、全选、底部批量操作与根节点行的悬停操作；建歌单（输入）、移除所选与移除根（确认）
// 在面板底部翻成表单态，没做成就停在表单态并显示原因。批量动作经 core 的批量控制器（useLibraryDirectoryActions 给的
// run），结果判别式在面板底部提示几秒（useBravaisMutationNotice），不走 toast。墙上的批量动作（点卡片切换选中、
// Insert / Ctrl+A / Ctrl+Enter / Delete）也从这里出。

type DirectoryForm = { id: 'create-playlist' } | { id: 'remove' } | { id: 'remove-root'; path: string };
type DirectoryFormState = { form: DirectoryForm; error: string | null };

export type BravaisDirectoryPanelInput = {
    directoryKey: string;
    batchConfig: LibraryDirectoryBatchConfig | undefined;
    /** 面板开着（= 批量模式）。 */
    panelOpen: boolean;
    title: string;
    /** 筛选之后显示的条目（墙上与树上同一份）。 */
    displayItems: readonly BravaisHomeEntry[];
    query: string;
    selectedIds: ReadonlySet<string>;
    context: LibraryDirectoryBatchContext<BravaisHomeEntry>;
    capabilities: LibraryDirectoryBatchCapabilities | null;
    run: (action: LibraryDirectoryBatchActionId, arg?: string) => Promise<LibraryMutationResult>;
    setSelected: (ids: readonly string[], selected: boolean) => void;
    toggleSelected: (id: string) => void;
    replaceSelection: (ids: readonly string[]) => void;
    /** 面板没开时先打开它（命令面板的全选 / 移除可以从关着的面板发起）。 */
    openPanel: () => void;
};

const NO_COLLAPSED: ReadonlySet<string> = new Set();

export const useBravaisDirectoryPanel = (input: BravaisDirectoryPanelInput) => {
    const { t } = useTranslation();
    const notice = useBravaisMutationNotice();
    const { directoryKey, batchConfig, panelOpen, displayItems, query, selectedIds, context, capabilities, run } = input;
    const [formState, setFormState] = useState<DirectoryFormState | null>(null);
    const [collapsed, setCollapsed] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: directoryKey, ids: NO_COLLAPSED });
    const collapsedIds = collapsed.key === directoryKey ? collapsed.ids : NO_COLLAPSED;
    const latest = useRef(input);
    latest.current = input;

    // 面板关上（退出批量模式）或换了目录：表单态一起收起。
    useEffect(() => {
        if (!panelOpen) setFormState(null);
    }, [panelOpen]);
    useEffect(() => setFormState(null), [directoryKey]);

    const labels = useMemo(() => ({
        ignored: t('home.gridFolderIgnored'),
        direct: (count: number) => t('home.gridFolderTreeDirectSelection', { count }),
        selection: (selected: number, total: number) => t('home.gridFolderTreeSelectionCount', { selected, total }),
        tracks: (count: number) => t('home.gridFolderTrackCount', { count }),
    }), [t]);
    const selectionType = batchConfig?.selectionType ?? null;
    const trees = selectionType === 'folders' ? batchConfig?.directoryTrees : undefined;
    const projected = useMemo(() => (panelOpen && selectionType
        ? projectDirectoryRows({ displayItems, trees, query, collapsedIds, selectedIds, labels })
        : null), [collapsedIds, displayItems, labels, panelOpen, query, selectedIds, selectionType, trees]);
    const projectedRef = useRef(projected);
    projectedRef.current = projected;

    /** 跑一个批量动作：失败与限制类在面板底部提示。 */
    const runAction = useCallback((action: LibraryDirectoryBatchActionId, arg?: string) => (
        notice.run(() => latest.current.run(action, arg))
    ), [notice]);

    const openForm = useCallback((form: DirectoryForm) => {
        latest.current.openPanel();
        setFormState({ form, error: null });
    }, []);
    const cancelForm = useCallback(() => setFormState(null), []);

    const canRun = useCallback((action: LibraryDirectoryBatchActionId) => {
        const current = latest.current.capabilities;
        return Boolean(current && canRunDirectoryBatchAction(current, action));
    }, []);

    const batch = useMemo<BravaisHomeBatch | null>(() => (panelOpen && batchConfig ? {
        toggle: itemKey => {
            const entry = latest.current.displayItems.find(candidate => candidate.itemKey === itemKey);
            if (entry) latest.current.toggleSelected(String(entry.id));
        },
        selectAll: () => latest.current.replaceSelection(latest.current.displayItems.map(entry => String(entry.id))),
        play: enqueue => {
            if (canRun(enqueue ? 'enqueue' : 'play')) void runAction(enqueue ? 'enqueue' : 'play');
        },
        requestRemove: () => {
            if (canRun('remove')) openForm({ id: 'remove' });
        },
    } : null), [batchConfig, canRun, openForm, panelOpen, runAction]);

    const submitForm = useCallback(async (value: string) => {
        const current = formState?.form;
        if (!current) return;
        if (current.id === 'create-playlist') {
            const name = value.trim();
            if (!name) return;
            const result = await runAction('create-playlist', name);
            if (!result) return;
            if (result.ok) setFormState(null);
            else if (result.reason !== 'busy') setFormState(state => (state ? { ...state, error: notice.describe(result) ?? null } : state));
            return;
        }
        setFormState(null);
        if (current.id === 'remove') void runAction('remove');
        else void runAction('remove-root', current.path);
    }, [formState, notice, runAction]);

    const trackCount = context.trackIds.length;
    const pending = Boolean(capabilities?.pending);
    const form = useMemo<BravaisSeamForm | null>(() => {
        if (!formState) return null;
        const { form: current, error } = formState;
        const cancel = t('libraryBravaisCollection.cancel');
        if (current.id === 'create-playlist') {
            return {
                formId: 'create-playlist',
                state: { kind: 'rename', initial: '', error },
                pending,
                labels: {
                    title: t('localMusic.createPlaylist'),
                    message: t('home.gridFolderCreatePlaylistDescription', { count: trackCount }),
                    submit: t('localMusic.createPlaylist'),
                    cancel,
                    placeholder: t('home.gridFolderPlaylistNamePlaceholder'),
                },
                onSubmit: value => void submitForm(value),
                onCancel: cancelForm,
            };
        }
        const isRoot = current.id === 'remove-root';
        return {
            formId: current.id,
            state: { kind: 'confirm-delete', error },
            pending,
            labels: {
                title: t(isRoot ? 'home.gridFolderRemoveRootTitle' : 'home.gridFolderRemoveSelectedTitle'),
                message: isRoot
                    ? t('home.gridFolderRemoveRootDescription', { path: current.path })
                    : t('home.gridFolderRemoveSelectedDescription', { count: trackCount }),
                submit: t(isRoot ? 'home.gridFolderRemoveRoot' : 'home.gridFolderRemoveSelected'),
                cancel,
            },
            onSubmit: value => void submitForm(value),
            onCancel: cancelForm,
        };
    }, [cancelForm, formState, pending, submitForm, t, trackCount]);

    const panel = useMemo<BravaisDirectoryPanel | null>(() => {
        if (!projected || !batchConfig || !capabilities) return null;
        const actions = capabilities.actions;
        const selected = context.items.length;
        return {
            title: input.title,
            summary: t(`home.gridBatchSelectionSummary.${batchConfig.selectionType}`, {
                selected,
                total: displayItems.length,
                tracks: trackCount,
            }),
            crumb: t('libraryBravaisHome.directoryCrumb'),
            rows: projected.rows,
            emptyLabel: query ? t('home.gridSearchNoResults') : t('home.gridFolderTreeEmpty'),
            selectAll: {
                state: resolveSelectAllState(selected, displayItems.length),
                label: t('home.gridFolderSelectAll'),
                toggle: () => {
                    const shown = latest.current.displayItems;
                    const all = shown.length > 0 && latest.current.context.items.length >= shown.length;
                    latest.current.replaceSelection(all ? [] : shown.map(entry => String(entry.id)));
                },
            },
            onToggleRow: rowKey => {
                const target = projectedRef.current?.targets.get(rowKey);
                if (target && target.ids.length > 0) latest.current.setSelected(target.ids, target.selected);
            },
            onToggleExpanded: rowKey => {
                const row = projectedRef.current?.rows.find(candidate => candidate.key === rowKey);
                const nodeId = row?.nodeId;
                if (!row?.expandable || !nodeId) return;
                // 收起的节点按节点 id 记（core 的 resolveDirectoryRows 认它），换了目录就从全部展开开始。
                setCollapsed(previous => {
                    const ids = new Set(previous.key === latest.current.directoryKey ? previous.ids : NO_COLLAPSED);
                    if (ids.has(nodeId)) ids.delete(nodeId); else ids.add(nodeId);
                    return { key: latest.current.directoryKey, ids };
                });
            },
            ...(actions.includes('rescan-root') ? {
                roots: {
                    busyPath: capabilities.pending?.rootPath ?? null,
                    disabled: pending,
                    rescanLabel: t('home.gridFolderRescanRoot'),
                    removeLabel: t('home.gridFolderRemoveRoot'),
                    clearIgnoreLabel: t('home.gridFolderClearIgnore'),
                    rescan: path => void runAction('rescan-root', path),
                    remove: path => openForm({ id: 'remove-root', path }),
                    clearIgnore: path => void runAction('clear-ignore', path),
                },
            } : {}),
            actions: [
                { id: 'play' as const, label: t('playlist.playFilteredTracks', { count: trackCount }), disabled: !canRunDirectoryBatchAction(capabilities, 'play'), run: () => void runAction('play') },
                { id: 'enqueue' as const, label: t('playlist.addFilteredTracksToQueue', { count: trackCount }), disabled: !canRunDirectoryBatchAction(capabilities, 'enqueue'), run: () => void runAction('enqueue') },
                { id: 'create-playlist' as const, label: t('localMusic.createPlaylist'), disabled: !canRunDirectoryBatchAction(capabilities, 'create-playlist'), run: () => openForm({ id: 'create-playlist' }) },
                ...(actions.includes('remove')
                    ? [{ id: 'remove' as const, label: t('home.gridFolderRemoveSelected'), danger: true, disabled: !canRunDirectoryBatchAction(capabilities, 'remove'), run: () => openForm({ id: 'remove' }) }]
                    : []),
                ...(selectedIds.size > 0
                    ? [{ id: 'clear' as const, label: t('libraryBravaisHome.clearSelection'), disabled: false, run: () => latest.current.replaceSelection([]) }]
                    : []),
            ],
            form,
            notice: notice.notice,
        };
    }, [batchConfig, capabilities, context.items.length, displayItems.length, form, input.title, notice.notice, openForm, pending, projected, query, runAction, selectedIds.size, t, trackCount]);

    return {
        panel,
        batch,
        hasForm: formState !== null,
        cancelForm,
        /** 命令面板的「移除所选」：与面板按钮同一个确认态。 */
        requestRemove: () => openForm({ id: 'remove' }),
        runAction,
    };
};
