import { describe, expect, it, vi } from 'vitest';
import {
    buildCoreSurfaceParams,
    buildGridSurfaceState,
    runGridSurfaceAction,
    type CoreSurfaceInputs,
    type GridSurfaceParams,
} from '../../../src/library/core/collection/collectionSurface';
import { EMPTY_COLLECTION_MUTATION_SNAPSHOT } from '../../../src/library/core/collection/mutations/collectionMutationCapabilities';
import { resolveLibrarySurfaceActions } from '../../../src/library/registry';
import type { CollectionMutationController, CollectionMutationSnapshot } from '../../../src/library/core/collection/mutations/mutations.contract';
import type { LibraryCapability } from '../../../src/library/core/shared/capability.contract';

// test/unit/command-palette/gridSurfaceHandle.test.ts
// 分支规则只写在这里一处，命令侧只问 availableActions。所以「哪个分支给哪些动作」必须由测试兜住：
// 写歪了不会报错，只会让某条命令在不该出现的地方出现，或者在该出现的地方消失。

const params = (overrides: Partial<GridSurfaceParams> = {}): GridSurfaceParams => ({
    hasInfoPanel: false,
    hasTrackList: false,
    supportsLocalTrackSorting: false,
    canResyncFolder: false,
    canResyncAllFolders: false,
    canOrganizeSongInfo: false,
    canExportPlaylist: false,
    canEditEntity: false,
    canSetCover: false,
    canEditPlaylist: false,
    canToggleSubscribe: false,
    canReloadOnlineCollection: false,
    isSourceActionPending: false,
    isSubscribing: false,
    filteredTrackCount: 0,
    isFilterActive: false,
    sortField: 'fileName',
    sortDirection: 'asc',
    isInfoPanelOpen: false,
    isTrackListOpen: false,
    isEditMode: false,
    playFiltered: vi.fn(),
    enqueueFiltered: vi.fn(),
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    toggleInfoPanel: vi.fn(),
    toggleTrackList: vi.fn(),
    resyncFolder: vi.fn(),
    resyncAllFolders: vi.fn(),
    organizeSongInfo: vi.fn(),
    exportPlaylist: vi.fn(),
    editEntity: vi.fn(),
    setCover: vi.fn(),
    toggleEditMode: vi.fn(),
    toggleSubscribe: vi.fn(),
    reloadOnlineCollection: vi.fn(),
    ...overrides,
});

describe('grid surface state', () => {
    it('offers nothing on a grid with no tracks and no branch', () => {
        expect(buildGridSurfaceState(params()).availableActions).toEqual([]);
    });

    it('offers the two playback actions only once something is left to act on', () => {
        expect(buildGridSurfaceState(params({ filteredTrackCount: 3 })).availableActions)
            .toEqual(['play-filtered', 'enqueue-filtered']);
    });

    it('offers sorting only where local track sorting applies', () => {
        const sorting = buildGridSurfaceState(params({ supportsLocalTrackSorting: true })).availableActions;

        expect(sorting).toContain('sort-file-name');
        expect(sorting).toContain('sort-toggle-direction');
        expect(buildGridSurfaceState(params()).availableActions).not.toContain('sort-file-name');
    });

    // 按钮在 isSourceActionPending 时是 disabled 的，命令必须跟着一起退场，
    // 否则可以在重扫进行中再触发一次重扫。
    it('withdraws the disk and network actions while a source action is running', () => {
        const busy = buildGridSurfaceState(params({
            canResyncFolder: true,
            canExportPlaylist: true,
            canEditPlaylist: true,
            isSourceActionPending: true,
        })).availableActions;

        expect(busy).toEqual([]);
    });

    it('offers reloading only for online collections that are not already loading', () => {
        expect(buildGridSurfaceState(params({ canReloadOnlineCollection: true })).availableActions)
            .toEqual(['reload-online-collection']);
        expect(buildGridSurfaceState(params()).availableActions).not.toContain('reload-online-collection');
    });

    // 订阅按钮在切换进行中是 disabled 的；命令同样退场。
    it('offers toggling the subscription only where subscribing applies and none is in flight', () => {
        expect(buildGridSurfaceState(params({ canToggleSubscribe: true })).availableActions).toEqual(['toggle-subscribe']);
        expect(buildGridSurfaceState(params({ canToggleSubscribe: true, isSubscribing: true })).availableActions).toEqual([]);
        expect(buildGridSurfaceState(params()).availableActions).not.toContain('toggle-subscribe');
    });
});

describe('grid surface dispatch', () => {
    it('maps each sort command to its field', () => {
        const sorting = params({ supportsLocalTrackSorting: true });

        runGridSurfaceAction('sort-album-track', sorting);

        expect(sorting.setSortField).toHaveBeenCalledWith('albumTrack');
    });

    it('flips the direction rather than setting a fixed one', () => {
        const descending = params({ supportsLocalTrackSorting: true, sortDirection: 'desc' });

        runGridSurfaceAction('sort-toggle-direction', descending);

        expect(descending.setSortDirection).toHaveBeenCalledWith('asc');
    });

    // 快捷键、固定槽位和一个开着没关的面板都能打到已经消失的分支上。
    it('refuses an action the current branch does not offer', () => {
        const noSorting = params();

        runGridSurfaceAction('sort-file-name', noSorting);
        runGridSurfaceAction('play-filtered', noSorting);

        expect(noSorting.setSortField).not.toHaveBeenCalled();
        expect(noSorting.playFiltered).not.toHaveBeenCalled();
    });

    it('runs toggle-subscribe only while it is offered', () => {
        const subscribable = params({ canToggleSubscribe: true });
        runGridSurfaceAction('toggle-subscribe', subscribable);
        expect(subscribable.toggleSubscribe).toHaveBeenCalledTimes(1);

        const busy = params({ canToggleSubscribe: true, isSubscribing: true });
        runGridSurfaceAction('toggle-subscribe', busy);
        expect(busy.toggleSubscribe).not.toHaveBeenCalled();
    });
});

// ---- 同一份集合状态，两套 suite ----
// core 动作由 buildCoreSurfaceParams 从同一份控制器快照构建：网格与 TUI 只差在各自的声明（registry 里的真实 entry）
// 和网格补上的局部动作。P2.4 起 TUI 声明了全部 core 命令（重扫、订阅……），两边发布的 core 动作相同。

const READY: LibraryCapability = { supported: true, enabled: true, pending: false };

const snapshotWith = (
    capabilities: Partial<CollectionMutationSnapshot['capabilities']>,
    overrides: Partial<CollectionMutationSnapshot> = {},
): CollectionMutationSnapshot => ({
    ...EMPTY_COLLECTION_MUTATION_SNAPSHOT,
    ...overrides,
    capabilities: { ...EMPTY_COLLECTION_MUTATION_SNAPSHOT.capabilities, ...capabilities },
});

const fakeController = (snapshot: CollectionMutationSnapshot) => {
    const ok = async () => ({ ok: true as const });
    return {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        update: vi.fn(),
        removeEntry: vi.fn(ok),
        toggleSubscribe: vi.fn(ok),
        rename: vi.fn(ok),
        deleteCollection: vi.fn(ok),
        resyncFolder: vi.fn(ok),
        resyncAllFolders: vi.fn(ok),
        exportPlaylist: vi.fn(ok),
        addToPlaylist: vi.fn(ok),
        createPlaylist: vi.fn(ok),
        editEntity: vi.fn(ok),
        setCover: vi.fn(ok),
        organizeSongInfo: vi.fn(ok),
        matchSong: vi.fn(ok),
        setDailyDate: vi.fn(ok),
        showDailyStyle: vi.fn(ok),
        setDailyStyle: vi.fn(ok),
        loadDailyStyleGroups: vi.fn(),
        dispose: vi.fn(),
    } satisfies CollectionMutationController;
};

const coreInputs = (
    snapshot: CollectionMutationSnapshot,
    mutations: CollectionMutationController | null,
    overrides: Partial<CoreSurfaceInputs> = {},
): CoreSurfaceInputs => ({
    filteredTrackCount: 4,
    isFilterActive: false,
    supportsLocalTrackSorting: false,
    sortField: 'fileName',
    sortDirection: 'asc',
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    canReloadOnlineCollection: true,
    playFiltered: vi.fn(),
    enqueueFiltered: vi.fn(),
    reloadOnlineCollection: vi.fn(),
    mutationSnapshot: snapshot,
    mutations,
    ...overrides,
});

/** 两套 suite 用各自在 registry 里的声明发布同一份集合状态；网格再补它的局部动作。 */
const publishBoth = (inputs: CoreSurfaceInputs) => {
    const grid = buildGridSurfaceState(buildCoreSurfaceParams(
        { ...inputs, declaredActions: resolveLibrarySurfaceActions('collection', 'grid') },
        {
            hasInfoPanel: true,
            hasTrackList: true,
            canEditPlaylist: false,
            isInfoPanelOpen: false,
            isTrackListOpen: false,
            isEditMode: false,
            toggleInfoPanel: vi.fn(),
            toggleTrackList: vi.fn(),
            toggleEditMode: vi.fn(),
        },
    )).availableActions;
    const tui = buildGridSurfaceState(buildCoreSurfaceParams(
        { ...inputs, declaredActions: resolveLibrarySurfaceActions('collection', 'tui') },
    )).availableActions;
    return { grid, tui };
};

const GRID_LOCAL_ACTIONS = ['toggle-info-panel', 'toggle-track-list', 'toggle-edit-mode'];

describe('core surface actions across suites', () => {
    it('publishes the same core actions from the same snapshot where both suites declare them', () => {
        const snapshot = snapshotWith({ subscribe: READY });
        const { grid, tui } = publishBoth(coreInputs(snapshot, fakeController(snapshot), { supportsLocalTrackSorting: true }));

        const gridCore = grid.filter(action => !GRID_LOCAL_ACTIONS.includes(action));
        expect(gridCore).toEqual([
            'play-filtered',
            'enqueue-filtered',
            'sort-file-name',
            'sort-modified-date',
            'sort-album-track',
            'sort-toggle-direction',
            'reload-online-collection',
            'toggle-subscribe',
        ]);
        // TUI 声明了全部 core 命令：同一份快照下两边发布的 core 动作完全相同，差的只是网格的局部动作。
        expect(tui).toEqual(gridCore);
    });

    it('takes the source maintenance commands from the controller capabilities, gated by its pending flag', () => {
        const snapshot = snapshotWith({
            resyncFolder: READY,
            organizeSongInfo: READY,
            exportPlaylist: READY,
            editEntity: READY,
        });
        const { grid, tui } = publishBoth(coreInputs(snapshot, fakeController(snapshot), { canReloadOnlineCollection: false }));
        expect(grid).toEqual(expect.arrayContaining(['resync-folder', 'organize-song-info', 'export-playlist', 'edit-entity']));
        expect(tui).toEqual(grid.filter(action => !GRID_LOCAL_ACTIONS.includes(action)));
        expect(tui).toEqual(expect.arrayContaining(['resync-folder', 'organize-song-info', 'export-playlist', 'edit-entity']));

        const busy = snapshotWith(snapshot.capabilities, { sourceActionPending: true });
        const whileBusy = publishBoth(coreInputs(busy, fakeController(busy), { canReloadOnlineCollection: false })).grid;
        // 与按钮一致：重扫、导出在进行中禁用；整理、编辑实体只是打开对话框，不禁用。
        expect(whileBusy).not.toContain('resync-folder');
        expect(whileBusy).not.toContain('export-playlist');
        expect(whileBusy).toEqual(expect.arrayContaining(['organize-song-info', 'edit-entity']));
    });

    it('follows capabilities.subscribe for toggle-subscribe', () => {
        const unsupported = EMPTY_COLLECTION_MUTATION_SNAPSHOT;
        expect(publishBoth(coreInputs(unsupported, fakeController(unsupported))).grid).not.toContain('toggle-subscribe');

        const subscribing = snapshotWith({ subscribe: { supported: true, enabled: false, pending: true, reason: 'pending' } }, { subscribing: true });
        expect(publishBoth(coreInputs(subscribing, fakeController(subscribing))).grid).not.toContain('toggle-subscribe');

        const ready = snapshotWith({ subscribe: READY });
        const { grid, tui } = publishBoth(coreInputs(ready, fakeController(ready)));
        expect(grid).toContain('toggle-subscribe');
        // TUI 自 P2.4 起声明 subscribe：与网格一样发布。
        expect(tui).toContain('toggle-subscribe');
    });

    it('publishes no mutation command without a controller, whatever the snapshot says', () => {
        const snapshot = snapshotWith({ subscribe: READY, resyncFolder: READY, exportPlaylist: READY });
        const { grid } = publishBoth(coreInputs(snapshot, null));
        expect(grid).not.toContain('toggle-subscribe');
        expect(grid).not.toContain('resync-folder');
        expect(grid).not.toContain('export-playlist');
    });

    it('runs the published mutation commands on the controller', () => {
        const snapshot = snapshotWith({ subscribe: READY, resyncFolder: READY, exportPlaylist: READY });
        const controller = fakeController(snapshot);
        const surface = buildCoreSurfaceParams({
            ...coreInputs(snapshot, controller),
            declaredActions: resolveLibrarySurfaceActions('collection', 'grid'),
        });

        runGridSurfaceAction('toggle-subscribe', surface);
        runGridSurfaceAction('resync-folder', surface);
        runGridSurfaceAction('export-playlist', surface);
        // TUI 也声明了 subscribe：经它的 surface 执行的是同一个控制器动作。
        runGridSurfaceAction('toggle-subscribe', buildCoreSurfaceParams({
            ...coreInputs(snapshot, controller),
            declaredActions: resolveLibrarySurfaceActions('collection', 'tui'),
        }));
        // 没声明 subscribe 的 suite 即使 core 允许也不执行。
        const tuiActions = resolveLibrarySurfaceActions('collection', 'tui');
        runGridSurfaceAction('toggle-subscribe', buildCoreSurfaceParams({
            ...coreInputs(snapshot, controller),
            declaredActions: { actions: tuiActions.actions.filter(action => action !== 'subscribe'), extraActions: [] },
        }));

        expect(controller.toggleSubscribe).toHaveBeenCalledTimes(2);
        expect(controller.resyncFolder).toHaveBeenCalledTimes(1);
        expect(controller.exportPlaylist).toHaveBeenCalledTimes(1);
    });
});
