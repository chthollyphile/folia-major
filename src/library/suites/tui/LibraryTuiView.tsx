import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsPresent } from 'framer-motion';
import { List, useListRef } from 'react-window';
import { useTranslation } from 'react-i18next';
import type { LibraryActionId, LibraryCollectionSurfaceProps } from '../../core/suite/suite.contract';
import type { LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import { resolveDeclaredMutationActions } from '../../core/suite/librarySuites';
import { collectionKey } from '../../core/collection/collectionIdentity';
import { buildCoreSurfaceParams, buildGridSurfaceState, runGridSurfaceAction } from '../../core/collection/collectionSurface';
import { useCollectionResourceState } from '../../core/collection/resource/useCollectionResourceState';
import { useCollectionView } from '../../core/collection/useCollectionView';
import { useCollectionActions } from '../../core/collection/mutations/useCollectionActions';
import { useCommittedQuery } from '../../core/shared/useCommittedQuery';
import { useLibrarySessionQuery } from '../../core/shared/useLibrarySessionQuery';
import { useCollectionMutationSnapshot } from '../../core/collection/mutations/useCollectionMutations';
import { resolveTrackAlbumLink, resolveTrackArtistLinks, type TrackArtistLink } from '../../core/shared/trackLinks';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { useGridCommandFilter } from '../../../hooks/useGridCommandFilter';
import { useGridSurfaceRegistration } from '../../../hooks/useGridSurfaceRegistration';
import { useLocalTrackSortStore } from '../../core/directory/useLocalTrackSortStore';
import { colorWithAlpha } from '../../../components/visualizer/colorMix';
import LibraryTuiHeader from './LibraryTuiHeader';
import LibraryTuiRow, { LIBRARY_TUI_COLUMNS, LIBRARY_TUI_ROW_HEIGHT, type LibraryTuiRowProps } from './LibraryTuiRow';
import LibraryTuiPrompt, { type LibraryTuiPromptRequest } from './LibraryTuiPrompt';
import { useLibraryTuiFocus } from './useLibraryTuiFocus';
import { useLibraryTuiKeyboard } from './useLibraryTuiKeyboard';

// src/library/suites/tui/LibraryTuiView.tsx
// 集合详情的第二个 renderer：终端风格的等宽列表。它只做展示和按键映射——曲目、筛选、排序、
// 播放范围与动作全部来自与网格相同的 Library Core（资源、浏览会话、useCollectionView、
// useCollectionActions），并向命令面板注册同一个 surface，只是没有信息面板、侧栏与编辑模式。
// 这里不引用网格、六边形视口或转场的任何实现。

// 宿主交给任何 suite 的集合 surface 输入（core/suite/suite.contract）。变更（删条目 / 不喜欢、订阅、改名、删除集合、
// 每日推荐日期、手动匹配）都经宿主传来的变更控制器，与网格是同一个实例、同一份快照；TUI 只是换了入口：
// Delete 键、状态栏上的 [★] / [改名] / [删除]、行上的 [i]，以及命令面板（core 动作与网格同源，
// 发布哪些由 entry.ts 的声明决定）。按钮只在「声明 ∩ 控制器能力」时出现。
const LibraryTuiView: React.FC<LibraryCollectionSurfaceProps> = ({
    collection,
    resource,
    playback: port,
    mutations,
    localSongs,
    theme,
    isDaylight,
    isInteractive,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
    onStatusMessage,
    declaredActions,
}) => {
    const { t } = useTranslation();
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    const listRegionRef = useRef<HTMLDivElement>(null);
    const listRef = useListRef(null);
    const sessionKey = collectionKey(collection);

    const { snapshot } = useCollectionResourceState(resource);
    const tracks = useMemo(() => snapshot?.tracks ?? [], [snapshot?.tracks]);
    const { query, setQuery, port: queryPort } = useLibrarySessionQuery(sessionKey);
    // 筛选框贴在列表区域上；会话里已有筛选时首次可交互就把它带出来（与网格一致）。
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port: queryPort,
        anchorRef: listRegionRef,
        reopenIfFiltered: true,
    });
    const mutationSnapshot = useCollectionMutationSnapshot(mutations);
    const committedQuery = useCommittedQuery(query);

    // 与网格同一条规则：只有本地文件夹（含「全部歌曲」）按本地排序。
    const supportsLocalTrackSorting = collection.source === 'local' && collection.type === 'folder';
    const sortField = useLocalTrackSortStore(state => state.field);
    const sortDirection = useLocalTrackSortStore(state => state.direction);
    const setSortField = useLocalTrackSortStore(state => state.setField);
    const setSortDirection = useLocalTrackSortStore(state => state.setDirection);
    const localSongsById = useMemo(() => new Map(localSongs?.map(song => [song.id, song])), [localSongs]);
    const localSort = useMemo(() => (
        supportsLocalTrackSorting ? { songsById: localSongsById, field: sortField, direction: sortDirection } : null
    ), [localSongsById, sortDirection, sortField, supportsLocalTrackSorting]);

    const view = useCollectionView({ tracks, committedQuery, localSort });
    const actions = useCollectionActions({ resource, snapshot, view, port, collectionType: collection.type });
    const focus = useLibraryTuiFocus(sessionKey, view, committedQuery);
    const trackAtRow = (row: number) => {
        const displayIndex = focus.rowDisplayIndexes[row];
        return displayIndex === undefined ? undefined : view.displayTracks[displayIndex];
    };

    // 命令面板能对这个集合做的事：只有核心动作（播放 / 入队范围、重新拉取、本地排序、来源维护、订阅），
    // 与网格同一个构建函数、同一份控制器快照，再按 entry.ts 的声明过滤；TUI 没有 renderer 局部动作。
    const surfaceParams = buildCoreSurfaceParams({
        declaredActions,
        supportsLocalTrackSorting,
        canReloadOnlineCollection: actions.capabilities.reload.enabled,
        filteredTrackCount: view.contextTracks.length,
        isFilterActive: view.isFilterActive,
        sortField,
        sortDirection,
        playFiltered: actions.playScope,
        enqueueFiltered: actions.enqueueScope,
        setSortField,
        setSortDirection,
        reloadOnlineCollection: actions.reload,
        mutationSnapshot,
        mutations,
    });
    useGridSurfaceRegistration({
        isInteractive: isActive,
        getState: () => buildGridSurfaceState(surfaceParams),
        run: action => runGridSurfaceAction(action, surfaceParams),
    });

    // 变更动作：suite 声明了、控制器也说这个集合支持（声明 ∩ 能力），才有入口。
    const mutationCapabilities = mutationSnapshot.capabilities;
    const offeredMutations = useMemo(
        () => new Set(mutations ? resolveDeclaredMutationActions(declaredActions, mutationCapabilities) : []),
        [declaredActions, mutationCapabilities, mutations],
    );
    const offers = (action: LibraryActionId) => offeredMutations.has(action);
    const canRemoveEntry = offers('remove-entry');
    const isDailyRecommendations = mutationSnapshot.branches.isDailyRecommendationsCollection;
    const displayTitle = mutationSnapshot.renamedTo ?? collection.name;
    const pendingKeys = useMemo(() => new Set(mutationSnapshot.pendingEntryKeys), [mutationSnapshot.pendingEntryKeys]);
    const [prompt, setPrompt] = useState<LibraryTuiPromptRequest | null>(null);

    // 删除的结果可能在 TUI 卸载之后才回来（控制器属于集合会话）：那时什么都不用做。
    const isMountedRef = useRef(false);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // 删焦点条目（每日推荐是「不喜欢并换一首」）。控制器在上游确认后直接提交给资源，TUI 没有退出动画，
    // 不需要按住展示；焦点在条目消失时落到原位置的下一行。进行中再按一次由控制器挡掉（busy，不发第二个请求）。
    // 结果文案与网格一致：次数用完提示一次，每日推荐失败报错；其它失败由控制器经端口报出。
    const removeFocused = useCallback(async () => {
        if (!mutations || !canRemoveEntry) return;
        const row = focus.focusedRow;
        const entryKey = focus.rowKeys[row];
        const displayIndex = focus.rowDisplayIndexes[row];
        const track = displayIndex === undefined ? undefined : view.displayTracks[displayIndex];
        if (!entryKey || !track) return;
        focus.markRemoval(row);
        let result: LibraryMutationResult;
        try {
            result = await mutations.removeEntry({ entryKey, track });
        } catch (error) {
            console.error('Failed to remove track in LibraryTuiView', error);
            result = { ok: false, reason: 'failed' };
        }
        if (!isMountedRef.current || result.ok) return;
        // busy：第一次的请求还在路上，它的焦点标记要留着。
        if (result.reason !== 'busy') focus.clearRemoval(entryKey);
        if (result.reason === 'limit-reached') {
            onStatusMessage?.({ type: 'info', text: t('home.noMoreDailyRecommendations'), nonce: Date.now() });
        } else if (result.reason === 'failed' && isDailyRecommendations) {
            onStatusMessage?.({ type: 'error', text: t('home.dislikeRecommendationFailed'), nonce: Date.now() });
        }
    }, [canRemoveEntry, focus, isDailyRecommendations, mutations, onStatusMessage, t, view.displayTracks]);

    const canMatchSong = offers('match-song');
    const matchRow = (row: number) => {
        const track = trackAtRow(row);
        if (track && canMatchSong) void mutations?.matchSong(track);
    };

    const isLocalFolder = mutationSnapshot.branches.isLocalFolderCollection;
    const openRenamePrompt = () => setPrompt({ kind: 'rename', initialValue: displayTitle });
    const openDeletePrompt = () => setPrompt({
        kind: 'confirm-delete',
        // 文件夹沿用网格确认框的说明（子文件夹与根文件夹的后果不同）。
        message: isLocalFolder
            ? t(collection.name.replace(/\\/g, '/').includes('/') ? 'localMusic.deleteSubfolderMessage' : 'localMusic.deleteRootFolderMessage', { folderName: collection.name })
            : t('libraryTui.confirmDelete', { name: displayTitle }),
    });
    // 改名没改成就留在提示里（与网格留在编辑模式一致）；删除先收起提示，成功才返回上一层。
    const submitPrompt = async (value: string) => {
        if (!prompt || !mutations) return;
        if (prompt.kind === 'rename') {
            const result = await mutations.rename(value);
            if (isMountedRef.current && result.ok) setPrompt(null);
            return;
        }
        setPrompt(null);
        const result = await mutations.deleteCollection();
        if (isMountedRef.current && result.ok) onBack();
    };

    // 行上的专辑 / 歌手：suite 声明了 open-album / open-artist、且这一行能解析出目录引用（core/shared/trackLinks，
    // 与网格卡片上的链接同一条规则）才能打开。压入下一层之前把焦点写回会话：返回时焦点回到这一行。
    const canOpenAlbum = declaredActions.actions.includes('open-album');
    const canOpenArtist = declaredActions.actions.includes('open-artist');
    const openAlbumAt = (row: number) => {
        const track = trackAtRow(row);
        const link = track && canOpenAlbum ? resolveTrackAlbumLink(track, canResolveSongCatalogRef) : null;
        if (!track || !link) return;
        focus.focusRow(row);
        focus.persistFocus(row);
        onOpenAlbum(link.targetId, { ...link.album }, track);
    };
    const openArtistAt = (row: number, link?: TrackArtistLink) => {
        const track = trackAtRow(row);
        if (!track || !canOpenArtist) return;
        // 键盘没有指定哪一位歌手：打开这一行上第一个能打开的。
        const target = link ?? resolveTrackArtistLinks(track, canResolveSongCatalogRef).find(candidate => candidate.targetId !== undefined);
        if (!target || target.targetId === undefined) return;
        focus.focusRow(row);
        focus.persistFocus(row);
        onOpenArtist(target.targetId, { ...target.artist }, track);
    };

    const playRow = (row: number) => {
        const track = trackAtRow(row);
        if (!track) return;
        focus.focusRow(row);
        focus.persistFocus(row);
        actions.playTrack(track);
    };
    const enqueueRow = (row: number) => {
        const track = trackAtRow(row);
        if (track) actions.enqueueTrack(track);
    };

    useLibraryTuiKeyboard({
        isActive,
        isFiltering,
        rowCount: focus.rowDisplayIndexes.length,
        pageSize: Math.max(1, Math.floor((listRegionRef.current?.clientHeight ?? 560) / LIBRARY_TUI_ROW_HEIGHT) - 1),
        moveFocus: focus.moveFocus,
        onPlayFocused: () => playRow(focus.focusedRow),
        onEnqueueFocused: () => enqueueRow(focus.focusedRow),
        onPlayScope: actions.playScope,
        onEnqueueScope: actions.enqueueScope,
        onDeleteFocused: () => void removeFocused(),
        onOpenAlbumFocused: () => openAlbumAt(focus.focusedRow),
        onOpenArtistFocused: () => openArtistAt(focus.focusedRow),
        isPromptOpen: prompt !== null,
        // 先收起行内提示；与网格一致：再撤掉筛选，最后离开。
        onEscape: () => (prompt ? setPrompt(null) : query ? setQuery('') : onBack()),
    });

    // 等 react-window 量好视口再定位：刚挂载（例如从网格切过来）时列表还没有高度。
    useEffect(() => {
        if (focus.focusedRow < 0) return;
        const frame = window.requestAnimationFrame(() => {
            listRef.current?.scrollToRow({ index: focus.focusedRow, align: 'smart', behavior: 'instant' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focus.focusedRow, focus.rowDisplayIndexes.length, listRef]);

    const accentColor = theme.accentColor || 'currentColor';
    const rowProps = useMemo<LibraryTuiRowProps>(() => ({
        tracks: view.displayTracks,
        rowDisplayIndexes: focus.rowDisplayIndexes,
        rowKeys: focus.rowKeys,
        focusedRow: focus.focusedRow,
        pendingKeys,
        accentBackground: colorWithAlpha(accentColor, isDaylight ? 0.16 : 0.22),
        accentColor,
        enqueueLabel: t('libraryTui.enqueue'),
        unavailableLabel: t('status.songUnavailableTag'),
        videoLabel: t('status.songVideoTag'),
        matchLabel: t('localMusic.manualMetadataMatch'),
        onFocusRow: focus.focusRow,
        onPlayRow: playRow,
        onEnqueueRow: enqueueRow,
        onMatchRow: canMatchSong ? matchRow : undefined,
        onOpenAlbumRow: canOpenAlbum ? openAlbumAt : undefined,
        onOpenArtistRow: canOpenArtist ? openArtistAt : undefined,
    // playRow / enqueueRow / matchRow / openAlbumAt / openArtistAt 每次渲染都是新函数，但它们只读当前的 focus、view 与控制器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [accentColor, canMatchSong, canOpenAlbum, canOpenArtist, focus.focusRow, focus.focusedRow, focus.rowDisplayIndexes, focus.rowKeys, isDaylight, pendingKeys, t, view.displayTracks]);

    const isEmpty = focus.rowDisplayIndexes.length === 0;
    const isLoading = !snapshot || snapshot.status === 'idle' || snapshot.status === 'loading';
    const emptyText = snapshot?.error && !view.isFilterActive
        ? (snapshot.error.kind === 'not-public' ? t('playlist.loadNotPublic') : t('playlist.loadFailed', { error: snapshot.error.message }))
        : isLoading
            ? t('playlist.loading')
            : view.isFilterActive ? t('home.gridSearchNoResults') : t('home.loadingLibrary');

    // 顶上让出桌面版自绘标题栏的拖拽区（h-8，z-[9999] 盖在整个窗口最上面），否则页头那一行（[← Back]、订阅、改名）
    // 点不到；与 TUI 首页的 pt-8 一致（网格的集合页把按钮放在 top-5 往下，按钮中心同样避开了这一条）。
    return (
        <div
            data-library-renderer="tui"
            data-ponder-page-scope="none"
            data-library-surface="collection"
            className="fixed inset-0 z-[110] flex flex-col overflow-hidden pt-8 font-mono"
            style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
        >
            <LibraryTuiHeader
                collection={collection}
                title={displayTitle}
                snapshot={snapshot}
                mutations={{
                    snapshot: mutationSnapshot,
                    showSubscribe: offers('subscribe'),
                    showRename: offers('rename'),
                    showDelete: offers('delete-collection'),
                    showDailyDate: offers('daily-date'),
                    onToggleSubscribe: () => void mutations?.toggleSubscribe(),
                    onRename: openRenamePrompt,
                    onDelete: openDeletePrompt,
                    onDailyDate: (date, afresh) => void mutations?.setDailyDate(date, { afresh }),
                }}
                query={query}
                scopeCount={view.contextTracks.length}
                reload={actions.capabilities.reload}
                accentColor={accentColor}
                // 状态栏的 [← Back] 是显式的返回按钮 = 完成（宿主清会话与布局记录）；Esc 走 onBack，离开但保留。
                onBack={onDone}
                onReload={actions.reload}
                onResumeSync={actions.resumeSync}
            />
            <div className={`grid shrink-0 ${LIBRARY_TUI_COLUMNS} gap-x-3 border-b border-current/10 px-4 py-1 text-[11px] uppercase tracking-wider opacity-45`}>
                <span />
                <span>{t('libraryTui.columnIndex')}</span>
                <span>{t('libraryTui.columnTitle')}</span>
                <span>{t('libraryTui.columnArtist')}</span>
                <span>{t('libraryTui.columnAlbum')}</span>
                <span>{t('libraryTui.columnTime')}</span>
                <span />
            </div>
            <div ref={listRegionRef} role="listbox" aria-label={collection.name} className="relative min-h-0 flex-1">
                {isEmpty ? (
                    <div className="px-4 py-6 text-[13px] opacity-50" data-tui-empty>{emptyText}</div>
                ) : (
                    <List
                        listRef={listRef}
                        rowCount={focus.rowDisplayIndexes.length}
                        rowHeight={LIBRARY_TUI_ROW_HEIGHT}
                        rowComponent={LibraryTuiRow}
                        rowProps={rowProps}
                        overscanCount={6}
                        className="custom-scrollbar"
                        style={{ height: '100%', width: '100%' }}
                    />
                )}
            </div>
            {prompt && (
                <LibraryTuiPrompt
                    key={prompt.kind}
                    request={prompt}
                    pending={mutationSnapshot.sourceActionPending}
                    accentColor={accentColor}
                    onSubmit={value => void submitPrompt(value)}
                    onCancel={() => setPrompt(null)}
                />
            )}
            <footer className="shrink-0 border-t border-current/10 px-4 py-1.5 text-[11px] opacity-50">
                {t('libraryTui.hints')}
                {canRemoveEntry && ` · ${t(isDailyRecommendations ? 'libraryTui.hintDislike' : 'libraryTui.hintRemove')}`}
                {(canOpenAlbum || canOpenArtist) && ` · ${t('libraryTui.hintOpenLinks')}`}
            </footer>
        </div>
    );
};

export default LibraryTuiView;
