import type { GridSurfaceActionId, GridSurfaceState } from '../../../types/gridCommandSurface';
import type { LocalSongFolderSortDirection, LocalSongFolderSortField } from '../../../utils/localSongSorting';
import type { CollectionMutationController, CollectionMutationSnapshot } from './mutations/mutations.contract';
import type { LibraryActionId, LibraryDeclaredActions } from '../suite/suite.contract';

// src/library/core/collection/collectionSurface.ts
// Turns a collection view's branch flags and handlers into the flat contract the command palette reads.
// (Moved from components/folia-grid/gridSurfaceHandle.ts: a list renderer publishes the same handle.)
//
// Pure on purpose: the branch rules are the same booleans the buttons are already gated on
// (GridView's isLocalFolderCollection, supportsLocalTrackSorting, canEditPlaylist ...), so keeping
// them here rather than in a second set of `isAvailable` predicates is what stops a command from
// offering something the panel would refuse.
//
// 命令分两半（P2.3）：core 动作（播放 / 入队范围、排序、重新拉取、来源维护、订阅……）由
// buildCoreSurfaceParams 从集合视图、集合动作与变更控制器的快照构建，任何 renderer 对同一集合状态发布同一组；
// renderer 动作（网格的信息面板、曲目侧栏、编辑模式）由 renderer 自己补。两半都再按 suite 的声明过滤。

/**
 * core 那一半，已经解析成平的布尔与回调。renderer 不手写它：用 buildCoreSurfaceParams 从快照构建
 * （单测为了覆盖分支规则会直接构造）。
 */
export type CoreSurfaceParams = {
    /** Branch gating — mirrors the conditions the matching buttons render under. */
    supportsLocalTrackSorting: boolean;
    canResyncFolder: boolean;
    canResyncAllFolders: boolean;
    canOrganizeSongInfo: boolean;
    canExportPlaylist: boolean;
    canEditEntity: boolean;
    /** 本地文件夹 / 专辑 / 歌单能设自定义封面（只打开对话框，不随来源动作禁用）。 */
    canSetCover: boolean;
    /** 能订阅 / 取消订阅（在线歌单、专辑）；切换进行中由 isSubscribing 挡掉。 */
    canToggleSubscribe: boolean;
    /** Online collection that can be fetched again past its cache; false while a load is running. */
    canReloadOnlineCollection: boolean;
    /** A source action is in flight; the disk and network actions grey out, exactly as the buttons do. */
    isSourceActionPending: boolean;
    /** 订阅切换进行中（订阅按钮此时禁用）。 */
    isSubscribing: boolean;
    /**
     * 渲染这个 surface 的 suite 声明的动作（见 core/suite/suite.contract）。给了就只发布声明过的——
     * 分支规则判定「这个集合能不能做」，声明决定「这套 UI 做不做」，命令面板看到的是两者的交集。
     * 不给（直接挂组件的探针与单测）时不过滤。
     */
    declaredActions?: LibraryDeclaredActions;

    filteredTrackCount: number;
    isFilterActive: boolean;
    sortField: LocalSongFolderSortField;
    sortDirection: LocalSongFolderSortDirection;

    playFiltered: () => void;
    enqueueFiltered: () => void;
    /** 收进速记簿；没有时（宿主没给 collectTracks）不发布 collect-filtered。 */
    collectFiltered?: () => void;
    setSortField: (field: LocalSongFolderSortField) => void;
    setSortDirection: (direction: LocalSongFolderSortDirection) => void;
    resyncFolder: () => void;
    resyncAllFolders: () => void;
    organizeSongInfo: () => void;
    exportPlaylist: () => void;
    editEntity: () => void;
    setCover: () => void;
    toggleSubscribe: () => void;
    reloadOnlineCollection: () => void;
};

/** renderer 那一半：suite 自己的局部动作（extraActions）。没有这些面板的 renderer 不给。 */
export type RendererSurfaceParams = {
    hasInfoPanel: boolean;
    hasTrackList: boolean;
    /** 编辑模式的开关（= 变更分支的 canEditPlaylist）；编辑模式本身属于 renderer。 */
    canEditPlaylist: boolean;
    isInfoPanelOpen: boolean;
    isTrackListOpen: boolean;
    isEditMode: boolean;
    toggleInfoPanel: () => void;
    toggleTrackList: () => void;
    toggleEditMode: () => void;
};

export type GridSurfaceParams = CoreSurfaceParams & RendererSurfaceParams;

/**
 * core 动作的输入，与渲染形态无关：
 * - 集合视图（useCollectionView）：当前范围有多少首、筛选是否生效；本地排序（视图规则）与当前选择；
 * - 集合动作（useCollectionActions，或网格里等价的播放回调）：播放 / 入队范围、重新拉取及其可用性；
 * - 变更控制器（宿主创建、renderer 订阅）：来源维护与订阅的能力、进行中标记读快照，执行调控制器。
 */
export type CoreSurfaceInputs = {
    declaredActions?: LibraryDeclaredActions;

    filteredTrackCount: number;
    isFilterActive: boolean;
    supportsLocalTrackSorting: boolean;
    sortField: LocalSongFolderSortField;
    sortDirection: LocalSongFolderSortDirection;
    setSortField: (field: LocalSongFolderSortField) => void;
    setSortDirection: (direction: LocalSongFolderSortDirection) => void;

    /** 重新拉取此刻可用（useCollectionActions 的 capabilities.reload.enabled）。 */
    canReloadOnlineCollection: boolean;
    playFiltered: () => void;
    enqueueFiltered: () => void;
    /** 收进速记簿（useCollectionActions 的 collectScope）；宿主不支持时不给。 */
    collectFiltered?: () => void;
    reloadOnlineCollection: () => void;

    /** renderer 订阅到的控制器快照（没有控制器时是 EMPTY_COLLECTION_MUTATION_SNAPSHOT：什么都不支持）。 */
    mutationSnapshot: CollectionMutationSnapshot;
    /** 控制器本身；null 时变更命令一律不发布，执行也什么都不做。 */
    mutations: CollectionMutationController | null;
};

const noop = () => {};

/** 没有信息面板、曲目侧栏、编辑模式的 renderer（例如 TUI）用的 renderer 部分：一律没有。 */
export const NO_RENDERER_SURFACE_ACTIONS: RendererSurfaceParams = Object.freeze({
    hasInfoPanel: false,
    hasTrackList: false,
    canEditPlaylist: false,
    isInfoPanelOpen: false,
    isTrackListOpen: false,
    isEditMode: false,
    toggleInfoPanel: noop,
    toggleTrackList: noop,
    toggleEditMode: noop,
});

/**
 * 集合 surface 的完整参数：core 动作从视图、集合动作与变更控制器快照构建，renderer 只补自己的局部动作
 * （不给就是没有）。同一份集合状态下，任何 renderer 得到的 core 动作完全相同，再各按自己的声明过滤。
 *
 * 变更命令逐字对应按钮：能力的 supported 决定出不出现，进行中（sourceActionPending / subscribing）由
 * buildGridSurfaceState 统一挡掉——结果与 capabilities.*.enabled 相同。没有控制器时一律不发布。
 */
export const buildCoreSurfaceParams = (
    inputs: CoreSurfaceInputs,
    renderer: RendererSurfaceParams = NO_RENDERER_SURFACE_ACTIONS,
): GridSurfaceParams => {
    const { mutationSnapshot: snapshot, mutations } = inputs;
    const capabilities = snapshot.capabilities;
    const hasController = mutations !== null;
    return {
        ...renderer,
        declaredActions: inputs.declaredActions,

        supportsLocalTrackSorting: inputs.supportsLocalTrackSorting,
        canReloadOnlineCollection: inputs.canReloadOnlineCollection,
        canResyncFolder: hasController && capabilities.resyncFolder.supported,
        canResyncAllFolders: hasController && capabilities.resyncAllFolders.supported,
        canOrganizeSongInfo: hasController && capabilities.organizeSongInfo.supported,
        canExportPlaylist: hasController && capabilities.exportPlaylist.supported,
        canEditEntity: hasController && capabilities.editEntity.supported,
        canSetCover: hasController && capabilities.setCover.supported,
        canToggleSubscribe: hasController && capabilities.subscribe.supported,
        isSourceActionPending: snapshot.sourceActionPending,
        isSubscribing: snapshot.subscribing,

        filteredTrackCount: inputs.filteredTrackCount,
        isFilterActive: inputs.isFilterActive,
        sortField: inputs.sortField,
        sortDirection: inputs.sortDirection,

        playFiltered: inputs.playFiltered,
        enqueueFiltered: inputs.enqueueFiltered,
        collectFiltered: inputs.collectFiltered,
        setSortField: inputs.setSortField,
        setSortDirection: inputs.setSortDirection,
        reloadOnlineCollection: inputs.reloadOnlineCollection,
        // 结果不在这里处理，与面板按钮一致（失败由控制器经端口的 statusMessage 报出）。
        resyncFolder: () => void mutations?.resyncFolder(),
        resyncAllFolders: () => void mutations?.resyncAllFolders(),
        organizeSongInfo: () => void mutations?.organizeSongInfo(),
        exportPlaylist: () => void mutations?.exportPlaylist(),
        editEntity: () => void mutations?.editEntity(),
        setCover: () => void mutations?.setCover(),
        toggleSubscribe: () => void mutations?.toggleSubscribe(),
    };
};

/**
 * 每个命令面板动作来自哪里：core 的语义动作（LibraryActionId），或 suite 自己的局部动作。
 * 既有命令 ID 不变；这张表只决定「suite 没声明时不发布」。
 */
export const GRID_SURFACE_ACTION_SOURCES: Readonly<Record<GridSurfaceActionId, { action: LibraryActionId } | { extra: string }>> = {
    'play-filtered': { action: 'play-scope' },
    'enqueue-filtered': { action: 'enqueue-scope' },
    'collect-filtered': { action: 'collect-scope' },
    'sort-file-name': { action: 'sort' },
    'sort-modified-date': { action: 'sort' },
    'sort-album-track': { action: 'sort' },
    'sort-toggle-direction': { action: 'sort' },
    'toggle-info-panel': { extra: 'toggle-info-panel' },
    'toggle-track-list': { extra: 'toggle-track-list' },
    'resync-folder': { action: 'resync-folder' },
    'resync-all-folders': { action: 'resync-all-folders' },
    'organize-song-info': { action: 'organize-song-info' },
    'export-playlist': { action: 'export-playlist' },
    'edit-entity': { action: 'edit-entity' },
    'set-cover': { action: 'set-cover' },
    'toggle-edit-mode': { extra: 'toggle-edit-mode' },
    'reload-online-collection': { action: 'reload' },
    'toggle-subscribe': { action: 'subscribe' },
};

/** 这个命令面板动作是否在 suite 的声明里。 */
export const isGridSurfaceActionDeclared = (action: GridSurfaceActionId, declared: LibraryDeclaredActions): boolean => {
    const source = GRID_SURFACE_ACTION_SOURCES[action];
    return 'action' in source ? declared.actions.includes(source.action) : declared.extraActions.includes(source.extra);
};

const SORT_FIELD_BY_ACTION: Partial<Record<GridSurfaceActionId, LocalSongFolderSortField>> = {
    'sort-file-name': 'fileName',
    'sort-modified-date': 'fileLastModified',
    'sort-album-track': 'albumTrack',
};

export const buildGridSurfaceState = (params: GridSurfaceParams): GridSurfaceState => {
    const hasTracks = params.filteredTrackCount > 0;
    const canRunSourceAction = !params.isSourceActionPending;

    const availableActions: GridSurfaceActionId[] = [];
    if (hasTracks) {
        availableActions.push('play-filtered', 'enqueue-filtered');
        if (params.collectFiltered) availableActions.push('collect-filtered');
    }
    if (params.supportsLocalTrackSorting) {
        availableActions.push('sort-file-name', 'sort-modified-date', 'sort-album-track', 'sort-toggle-direction');
    }
    if (params.hasInfoPanel) {
        availableActions.push('toggle-info-panel');
    }
    if (params.hasTrackList) {
        availableActions.push('toggle-track-list');
    }
    if (params.canResyncFolder && canRunSourceAction) {
        availableActions.push('resync-folder');
    }
    if (params.canResyncAllFolders && canRunSourceAction) {
        availableActions.push('resync-all-folders');
    }
    if (params.canOrganizeSongInfo) {
        availableActions.push('organize-song-info');
    }
    if (params.canExportPlaylist && canRunSourceAction) {
        availableActions.push('export-playlist');
    }
    if (params.canEditEntity) {
        availableActions.push('edit-entity');
    }
    if (params.canSetCover) {
        availableActions.push('set-cover');
    }
    if (params.canEditPlaylist && canRunSourceAction) {
        availableActions.push('toggle-edit-mode');
    }
    if (params.canReloadOnlineCollection) {
        availableActions.push('reload-online-collection');
    }
    // 订阅按钮在切换进行中禁用，命令跟着退场。
    if (params.canToggleSubscribe && !params.isSubscribing) {
        availableActions.push('toggle-subscribe');
    }
    const declared = params.declaredActions;

    return {
        availableActions: declared
            ? availableActions.filter(action => isGridSurfaceActionDeclared(action, declared))
            : availableActions,
        filteredTrackCount: params.filteredTrackCount,
        isFilterActive: params.isFilterActive,
        sortField: params.sortField,
        sortDirection: params.sortDirection,
        isInfoPanelOpen: params.isInfoPanelOpen,
        isTrackListOpen: params.isTrackListOpen,
        isEditMode: params.isEditMode,
    };
};

/**
 * Runs one published action, refusing anything the current branch does not offer.
 *
 * The guard is not redundant with the palette's gating: `executeShortcut`, a pinned slot and a
 * stale open palette can all reach a command whose branch has since gone away.
 */
export const runGridSurfaceAction = (action: GridSurfaceActionId, params: GridSurfaceParams): void => {
    if (!buildGridSurfaceState(params).availableActions.includes(action)) {
        return;
    }

    const sortField = SORT_FIELD_BY_ACTION[action];
    if (sortField) {
        params.setSortField(sortField);
        return;
    }

    switch (action) {
        case 'play-filtered': return params.playFiltered();
        case 'enqueue-filtered': return params.enqueueFiltered();
        case 'collect-filtered': return params.collectFiltered?.();
        case 'sort-toggle-direction': return params.setSortDirection(params.sortDirection === 'asc' ? 'desc' : 'asc');
        case 'toggle-info-panel': return params.toggleInfoPanel();
        case 'toggle-track-list': return params.toggleTrackList();
        case 'resync-folder': return params.resyncFolder();
        case 'resync-all-folders': return params.resyncAllFolders();
        case 'organize-song-info': return params.organizeSongInfo();
        case 'export-playlist': return params.exportPlaylist();
        case 'edit-entity': return params.editEntity();
        case 'set-cover': return params.setCover();
        case 'toggle-edit-mode': return params.toggleEditMode();
        case 'reload-online-collection': return params.reloadOnlineCollection();
        case 'toggle-subscribe': return params.toggleSubscribe();
        default: return;
    }
};
