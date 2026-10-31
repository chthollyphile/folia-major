import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult, UnifiedSong } from '../../../types';
import type { LibraryActionId, LibraryCollectionSurfaceProps } from '../../core/suite/suite.contract';
import type { CollectionMutationController, CollectionMutationSnapshot, LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import type { CollectionResourceSnapshot } from '../../core/shared/resource.contract';
import { resolveCollectionSyncCounts } from '../../core/collection/collectionProgress';
import { resolveCollectionDescription } from '../../core/collection/collectionDescription';
import type { CollectionActions } from '../../core/collection/mutations/useCollectionActions';
import type { CollectionView } from '../../core/collection/useCollectionView';
import type { LocalSongFolderSortDirection, LocalSongFolderSortField } from '../../../utils/localSongSorting';
import { projectCollectionStatus, resolveWallPeriodCount } from './bravaisCollectionStatus';
import type { BravaisLayerEntries, BravaisLayerWall, BravaisSeamCollection, BravaisSeamFilter, BravaisSeamMenuItem } from './bravaisSeamModels';
import type { useBravaisCollectionForms } from './useBravaisCollectionForms';
import type { useBravaisMutationNotice } from './useBravaisMutationNotice';

// src/library/suites/bravais/useBravaisCollectionSeam.ts
// 集合层在缝与墙上的投影（设计稿 §10.2 / §10.6）：缝里标题下的描述、收藏星标、补页进度 / 续传、状态行、过滤输入位、每日推荐的日期步进、
// 「⋯ 更多」与表单态；墙的内容规则（补页期间的循环周期、有限拼贴的规划条目数、过滤身份、首屏呼吸）；列表面板的排序
// 与聚焦卡「⋯」的条目动作。入口只在「suite 声明 ∩ 控制器能力」时出现（与 TUI、网格同一条规则）。
// 回调一律经 latest ref 读最新的视图、动作与控制器，层描述只在显示的东西变了时换身份。

type Forms = ReturnType<typeof useBravaisCollectionForms>;
type Notice = ReturnType<typeof useBravaisMutationNotice>;

export type BravaisCollectionSeamInput = {
    collection: LibraryCollectionSurfaceProps['collection'];
    mutations: LibraryCollectionSurfaceProps['mutations'];
    snapshot: CollectionResourceSnapshot | null;
    mutationSnapshot: CollectionMutationSnapshot;
    view: CollectionView;
    actions: CollectionActions;
    /** 「声明 ∩ 能力」的变更动作，与只看声明的动作。 */
    offers: (action: LibraryActionId) => boolean;
    declares: (action: LibraryActionId) => boolean;
    displayTitle: string;
    itemCount: number;
    matchCount: number;
    query: string;
    /** 墙与范围实际用的过滤词（防抖、组词按住之后）。 */
    committedQuery: string;
    setQuery: (query: string) => void;
    sort: {
        supported: boolean;
        field: LocalSongFolderSortField;
        direction: LocalSongFolderSortDirection;
        setField: (field: LocalSongFolderSortField) => void;
        setDirection: (direction: LocalSongFolderSortDirection) => void;
    };
    trackByKey: ReadonlyMap<string, SongResult>;
    forms: Forms;
    notice: Notice;
};

const isLocalSong = (track: SongResult | undefined) => Boolean((track as UnifiedSong | undefined)?.localRef?.songId);

export const useBravaisCollectionSeam = (input: BravaisCollectionSeamInput) => {
    const { t } = useTranslation();
    const latest = useRef(input);
    latest.current = input;
    const { collection, snapshot, mutationSnapshot: mutation, view, actions, offers, declares, forms, notice } = input;
    const branches = mutation.branches;
    const isDaily = branches.isDailyRecommendationsCollection;
    const isLocalFolder = branches.isLocalFolderCollection;
    const pending = mutation.sourceActionPending;
    const isLoading = !snapshot || snapshot.status === 'idle' || snapshot.status === 'loading';
    const totalCount = snapshot?.detail?.trackCount ?? collection.trackCount;
    const sync = snapshot?.sync ?? { status: 'none' as const };

    // 状态行与补页进度（错误与空分开；中断时整行是「续传」）。
    const counts = resolveCollectionSyncCounts(snapshot?.tracks.length ?? 0, totalCount);
    const projection = projectCollectionStatus(
        {
            status: snapshot?.status ?? null,
            error: snapshot?.error ?? null,
            sync,
            loadedCount: snapshot?.tracks.length ?? 0,
            totalCount,
            itemCount: input.itemCount,
            matchCount: input.matchCount,
            isFilterActive: view.isFilterActive,
        },
        {
            loading: t('playlist.loading'),
            notPublic: t('playlist.loadNotPublic'),
            loadFailed: message => t('playlist.loadFailed', { error: message }),
            empty: t('home.loadingLibrary'),
            noMatch: t('home.gridSearchNoResults'),
            retry: t('ui.retry'),
            clearFilter: t('libraryBravaisCollection.clearFilter'),
            syncProgress: value => (value ? t('playlist.syncProgress', value) : t('playlist.loading')),
            syncInterrupted: value => `${value ? t('playlist.syncInterruptedProgress', value) : t('playlist.syncInterrupted')} · ${t('ui.retry')}`,
            syncFailedHint: message => t('playlist.syncFailedHint', { error: message }),
        },
        {
            reload: actions.capabilities.reload.supported && declares('reload') ? () => latest.current.actions.reload() : undefined,
            clearFilter: () => latest.current.setQuery(''),
            resumeSync: () => latest.current.actions.resumeSync(),
        },
        counts,
    );
    const status = projection.status;
    const syncLine = projection.sync && (projection.sync.onResume && !declares('resume-sync') ? { ...projection.sync, onResume: undefined } : projection.sync);

    // 「⋯ 更多」：低频的集合动作（重新拉取、改名、加入歌单、重扫、整理、导出、实体信息、设置封面、删除）。
    const menu = useMemo<BravaisSeamMenuItem[]>(() => {
        const items: BravaisSeamMenuItem[] = [];
        const runMutation = (action: (controller: CollectionMutationController) => Promise<LibraryMutationResult>) => () => {
            const controller = latest.current.mutations;
            if (controller) void latest.current.notice.run(() => action(controller));
        };
        if (declares('reload') && actions.capabilities.reload.supported) {
            items.push({ id: 'reload', label: t('playlist.reload'), disabled: !actions.capabilities.reload.enabled, run: () => latest.current.actions.reload() });
        }
        if (offers('rename')) items.push({ id: 'rename', label: t('libraryBravaisCollection.rename'), disabled: pending, run: forms.openRename });
        if (offers('add-to-playlist')) {
            items.push({
                id: 'add-to-playlist',
                label: t('localMusic.addToPlaylist'),
                disabled: pending || view.playableTracks.length === 0,
                run: () => latest.current.forms.openPick({ kind: 'collection' }),
            });
        }
        // 收进速记簿（core 的 collect-scope）：当前范围，过滤时只收匹配项，不动队列。
        if (declares('collect-scope') && actions.capabilities.collect) {
            items.push({
                id: 'collect-scratchpad',
                label: t('scratchpad.collectScope'),
                disabled: view.contextTracks.length === 0,
                run: () => latest.current.actions.collectScope(),
            });
        }
        if (offers('resync-folder')) items.push({ id: 'resync-folder', label: t('localMusic.reimport'), disabled: pending, run: runMutation(c => c.resyncFolder()) });
        if (offers('resync-all-folders')) items.push({ id: 'resync-all-folders', label: t('localMusic.reimport'), disabled: pending, run: runMutation(c => c.resyncAllFolders()) });
        if (offers('organize-song-info')) items.push({ id: 'organize-song-info', label: t('localMusic.organizeSongInfo'), run: runMutation(c => c.organizeSongInfo()) });
        if (offers('export-playlist')) items.push({ id: 'export-playlist', label: t('localMusic.exportPlaylist'), disabled: pending, run: runMutation(c => c.exportPlaylist()) });
        if (offers('edit-entity')) {
            items.push({
                id: 'edit-entity',
                label: t('localMusic.entityInfo', { kind: collection.type === 'album' ? t('localMusic.albumLabel') : t('localMusic.artistLabel') }),
                run: runMutation(c => c.editEntity()),
            });
        }
        if (offers('set-cover')) items.push({ id: 'set-cover', label: t('localCollectionCover.menuLabel'), run: runMutation(c => c.setCover()) });
        if (offers('delete-collection')) {
            items.push({
                id: 'delete-collection',
                label: isLocalFolder ? t('localMusic.delete') : t('localMusic.deletePlaylist'),
                danger: true,
                disabled: pending,
                run: forms.openDelete,
            });
        }
        return items;
    }, [actions.capabilities.collect, actions.capabilities.reload, collection.type, declares, forms.openDelete, forms.openRename, isLocalFolder, offers, pending, t, view.contextTracks.length, view.playableTracks.length]);

    // 每日推荐的日期步进：‹ 更早 · 日期 · 更近 ›，今天还能「刷新今天」。换日期就是换内容：整面翻牌，不换层。
    const daily = useMemo<BravaisSeamCollection['daily']>(() => {
        if (!offers('daily-date')) return undefined;
        const dates = ['', ...mutation.dailyHistoryDates];
        const index = Math.max(0, dates.indexOf(mutation.dailyDate));
        const setDate = (date: string, afresh = false) => () => {
            const controller = latest.current.mutations;
            if (controller) void latest.current.notice.run(() => controller.setDailyDate(date, { afresh }));
        };
        return {
            label: mutation.dailyDate || t('home.todayRecommendations'),
            ariaLabel: t('home.recommendationDate'),
            disabled: isLoading,
            onPrevious: index + 1 < dates.length ? setDate(dates[index + 1]) : undefined,
            onNext: index > 0 ? setDate(dates[index - 1]) : undefined,
            refreshLabel: t('home.refreshRecommendations'),
            onRefresh: mutation.dailyDate ? undefined : setDate('', true),
        };
    }, [isLoading, mutation.dailyDate, mutation.dailyHistoryDates, offers, t]);

    const subscribe = useMemo<BravaisSeamCollection['subscribe']>(() => {
        if (!offers('subscribe')) return undefined;
        const isAlbum = branches.isOnlineAlbum;
        const subscribed = Boolean(mutation.subscribed);
        return {
            subscribed,
            pending: mutation.subscribing,
            title: subscribed
                ? t(isAlbum ? 'options.unsubscribeAlbum' : 'options.unsubscribePlaylist')
                : t(isAlbum ? 'options.subscribeAlbum' : 'options.subscribePlaylist'),
            onToggle: () => {
                const controller = latest.current.mutations;
                if (controller) void latest.current.notice.run(() => controller.toggleSubscribe());
            },
        };
    }, [branches.isOnlineAlbum, mutation.subscribed, mutation.subscribing, offers, t]);

    const matchLabel = t('libraryBravaisCollection.matchCount', { matches: input.matchCount, total: input.itemCount });
    // 缝里的过滤输入位（「过滤当前页」）：读写的就是浏览会话的 query。
    const filter = useMemo<BravaisSeamFilter | undefined>(() => (declares('filter') ? {
        query: input.query,
        placeholder: t('libraryBravais.filterPlaceholder'),
        matchLabel,
        clearLabel: t('libraryBravaisCollection.clearFilter'),
        setQuery: (query: string) => latest.current.setQuery(query),
    } : undefined), [declares, input.query, matchLabel, t]);

    // 表单态（改名、删除确认、加入歌单选择 / 新建）。
    const formState = forms.state;
    const playlists = mutation.availablePlaylists;
    const form = useMemo<BravaisSeamCollection['form']>(() => {
        if (!formState) return null;
        const cancel = t('libraryBravaisCollection.cancel');
        const base = { state: formState, pending, onSubmit: (value: string) => void forms.submit(value), onCancel: forms.cancel };
        if (formState.kind === 'rename') {
            return { ...base, labels: { title: t('libraryBravaisCollection.renameTitle'), submit: t('libraryBravaisCollection.save'), cancel, placeholder: t('libraryBravaisCollection.rename') } };
        }
        if (formState.kind === 'confirm-delete') {
            const folderMessage = collection.name.replace(/\\/g, '/').includes('/') ? 'localMusic.deleteSubfolderMessage' : 'localMusic.deleteRootFolderMessage';
            return {
                ...base,
                labels: {
                    title: isLocalFolder ? t('localMusic.deleteFolderTitle') : t('libraryTui.confirmDelete', { name: input.displayTitle }),
                    message: isLocalFolder ? t(folderMessage, { folderName: collection.name }) : undefined,
                    submit: isLocalFolder ? t('localMusic.deleteFromLibrary') : t('localMusic.delete'),
                    cancel,
                },
            };
        }
        return {
            ...base,
            labels: {
                title: t('localMusic.addToPlaylist'),
                submit: t('localMusic.createPlaylist'),
                cancel,
                placeholder: t('localMusic.enterPlaylistName'),
                createLabel: offers('create-playlist') ? t('libraryBravaisCollection.createPlaylistEntry') : undefined,
                empty: t('libraryBravaisCollection.noPlaylists'),
            },
            playlists: playlists.map(playlist => ({ id: String(playlist.id), name: playlist.name })),
            onPick: (id: string) => {
                const target = latest.current.mutationSnapshot.availablePlaylists.find(playlist => String(playlist.id) === id);
                if (target) void forms.pick(target.id);
            },
            onStartCreate: offers('create-playlist') ? forms.startCreate : undefined,
        };
    }, [collection.name, formState, forms, input.displayTitle, isLocalFolder, offers, pending, playlists, t]);

    // 标题下的描述：详情盖在集合描述上（与网格信息面板同一条规则），空的不给。
    const description = resolveCollectionDescription(collection, snapshot?.detail);
    const seamCollection = useMemo<BravaisSeamCollection>(() => ({
        description,
        subscribe,
        sync: syncLine,
        status,
        notice: notice.notice,
        daily,
        menu,
        moreLabel: t('libraryBravaisCollection.more'),
        listLabel: t('libraryBravaisCollection.list'),
        form,
    // status / syncLine 是每次渲染新算的小对象：按它们的文案比较，免得层描述白换身份。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [daily, description, form, menu, notice.notice, status?.tone, status?.text, subscribe, syncLine?.state, syncLine?.label, t]);

    // 墙的内容规则：补页期间的循环周期（新页只翻新 slot）、有限拼贴的规划条目数、过滤身份、首屏呼吸。
    const periodCount = resolveWallPeriodCount({ itemCount: input.itemCount, totalCount, sync });
    const wall = useMemo<BravaisLayerWall>(() => ({
        periodCount,
        planCount: periodCount,
        filterKey: view.isFilterActive ? input.committedQuery : '',
        loading: projection.loading,
    }), [input.committedQuery, periodCount, projection.loading, view.isFilterActive]);

    // 列表面板与聚焦卡「⋯」。
    const sortInput = input.sort;
    const entries = useMemo<BravaisLayerEntries>(() => ({
        hasPanel: true,
        panelTitle: t('libraryBravaisCollection.panelTitle'),
        listCrumb: t('libraryBravaisCollection.listCrumb'),
        sort: sortInput.supported && declares('sort') ? {
            field: sortInput.field,
            fields: [
                { value: 'fileName', label: t('localMusic.sortByFileName') },
                { value: 'fileLastModified', label: t('localMusic.sortByModifiedDate') },
                { value: 'albumTrack', label: t('localMusic.sortByAlbumTrack') },
            ],
            direction: sortInput.direction,
            directionLabel: sortInput.direction === 'asc' ? t('localMusic.sortAscending') : t('localMusic.sortDescending'),
            setField: field => latest.current.sort.setField(field as LocalSongFolderSortField),
            toggleDirection: () => latest.current.sort.setDirection(latest.current.sort.direction === 'asc' ? 'desc' : 'asc'),
        } : undefined,
        menuFor: key => {
            const { offers: has, trackByKey } = latest.current;
            const track = trackByKey.get(key);
            if (!track) return [];
            const entryMenu = [];
            if (has('remove-entry')) {
                entryMenu.push(isDaily
                    ? { id: 'remove-entry', label: t('libraryBravaisCollection.dislike') }
                    : { id: 'remove-entry', label: t('libraryBravaisCollection.removeEntry'), danger: true });
            }
            if (has('match-song') && isLocalSong(track)) entryMenu.push({ id: 'match-song', label: t('localMusic.manualMetadataMatch') });
            if (has('add-to-playlist')) entryMenu.push({ id: 'add-to-playlist', label: t('localMusic.addToPlaylist') });
            return entryMenu;
        },
        onMenuAction: (key, actionId) => {
            const { mutations: controller, trackByKey, notice: notices } = latest.current;
            const track = trackByKey.get(key);
            if (!controller || !track) return;
            if (actionId === 'remove-entry') void notices.run(() => controller.removeEntry({ entryKey: key, track }), { isDailyRemoval: isDaily });
            else if (actionId === 'match-song') void notices.run(() => controller.matchSong(track));
            else if (actionId === 'add-to-playlist') latest.current.forms.openPick({ kind: 'entry', entryKey: key });
        },
        hasQuery: Boolean(input.query),
        clearQuery: () => latest.current.setQuery(''),
        hasForm: Boolean(formState),
        cancelForm: forms.cancel,
    }), [declares, formState, forms.cancel, input.query, isDaily, sortInput.direction, sortInput.field, sortInput.supported, t]);

    return { seamCollection, filter, wall, entries, matchLabel };
};
