import { describe, expect, it, vi } from 'vitest';
import {
    buildCoreSurfaceParams,
    buildGridSurfaceState,
    GRID_SURFACE_ACTION_SOURCES,
    isGridSurfaceActionDeclared,
    runGridSurfaceAction,
    type GridSurfaceParams,
} from '@/library/core/collection/collectionSurface';
import { LIBRARY_ACTION_IDS } from '@/library/core/suite/librarySuites';
import { EMPTY_COLLECTION_MUTATION_SNAPSHOT } from '@/library/core/collection/mutations/collectionMutationCapabilities';
import type { LibraryDeclaredActions } from '@/library/core/suite/suite.contract';
import { resolveCollectionSyncCounts } from '@/library/core/collection/collectionProgress';

// test/unit/library/core/collectionSurface.test.ts
// 只有核心动作的 renderer（没有信息面板、侧栏、编辑模式）注册到命令面板时，
// 面板只能给出它真能做到的那几件事。

const core = (overrides: Partial<Parameters<typeof buildCoreSurfaceParams>[0]> = {}) => buildCoreSurfaceParams({
    supportsLocalTrackSorting: false,
    canReloadOnlineCollection: true,
    filteredTrackCount: 3,
    isFilterActive: false,
    sortField: 'fileName',
    sortDirection: 'asc',
    playFiltered: vi.fn(),
    enqueueFiltered: vi.fn(),
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    reloadOnlineCollection: vi.fn(),
    mutationSnapshot: EMPTY_COLLECTION_MUTATION_SNAPSHOT,
    mutations: null,
    ...overrides,
});

describe('core collection surface', () => {
    it('offers only play, enqueue and reload for an online collection', () => {
        expect(buildGridSurfaceState(core()).availableActions).toEqual([
            'play-filtered',
            'enqueue-filtered',
            'reload-online-collection',
        ]);
    });

    it('adds the local sort actions when the collection supports them', () => {
        expect(buildGridSurfaceState(core({ supportsLocalTrackSorting: true, canReloadOnlineCollection: false })).availableActions)
            .toEqual(['play-filtered', 'enqueue-filtered', 'sort-file-name', 'sort-modified-date', 'sort-album-track', 'sort-toggle-direction']);
    });

    it('refuses renderer-only actions and dispatches core ones', () => {
        const params = core();
        runGridSurfaceAction('toggle-info-panel', params);
        runGridSurfaceAction('toggle-edit-mode', params);
        runGridSurfaceAction('play-filtered', params);
        expect(params.playFiltered).toHaveBeenCalledTimes(1);
    });

    it('publishes collect-filtered only when the host can collect, the scope has songs and the suite declares it', () => {
        const collectFiltered = vi.fn();
        expect(buildGridSurfaceState(core()).availableActions).not.toContain('collect-filtered');
        expect(buildGridSurfaceState(core({ collectFiltered, filteredTrackCount: 0 })).availableActions).not.toContain('collect-filtered');
        const undeclared: LibraryDeclaredActions = { actions: ['play-scope', 'enqueue-scope'], extraActions: [] };
        expect(buildGridSurfaceState(core({ collectFiltered, declaredActions: undeclared })).availableActions).not.toContain('collect-filtered');

        const params = core({ collectFiltered });
        expect(buildGridSurfaceState(params).availableActions).toContain('collect-filtered');
        runGridSurfaceAction('collect-filtered', params);
        expect(collectFiltered).toHaveBeenCalledTimes(1);
    });
});

/** 网格那样什么分支都打开的参数：每个命令都可用，好看出声明过滤掉了哪些。 */
const everything = (declaredActions?: LibraryDeclaredActions): GridSurfaceParams => ({
    ...core({ supportsLocalTrackSorting: true }),
    hasInfoPanel: true,
    hasTrackList: true,
    canResyncFolder: true,
    canResyncAllFolders: true,
    canOrganizeSongInfo: true,
    canExportPlaylist: true,
    canEditEntity: true,
    canSetCover: true,
    canEditPlaylist: true,
    canToggleSubscribe: true,
    toggleInfoPanel: vi.fn(),
    resyncFolder: vi.fn(),
    toggleSubscribe: vi.fn(),
    collectFiltered: vi.fn(),
    declaredActions,
});

describe('suite-declared actions on the command surface', () => {
    it('maps every command to a core action id or a suite-local action', () => {
        for (const source of Object.values(GRID_SURFACE_ACTION_SOURCES)) {
            if ('action' in source) expect(LIBRARY_ACTION_IDS).toContain(source.action);
            else expect(source.extra).toMatch(/^toggle-/);
        }
    });

    it('publishes everything the branch allows when no declaration is given', () => {
        expect(buildGridSurfaceState(everything()).availableActions).toHaveLength(Object.keys(GRID_SURFACE_ACTION_SOURCES).length);
    });

    it('publishes only declared actions: the declaration intersects the core capability', () => {
        const declared: LibraryDeclaredActions = { actions: ['play-scope', 'enqueue-scope', 'sort', 'reload'], extraActions: [] };
        expect(buildGridSurfaceState(everything(declared)).availableActions).toEqual([
            'play-filtered',
            'enqueue-filtered',
            'sort-file-name',
            'sort-modified-date',
            'sort-album-track',
            'sort-toggle-direction',
            'reload-online-collection',
        ]);
        // 声明了但 core 此刻不允许的，照样不出现。
        expect(buildGridSurfaceState({ ...everything(declared), filteredTrackCount: 0 }).availableActions)
            .not.toContain('play-filtered');
    });

    it('gates suite-local actions by extraActions', () => {
        const declared: LibraryDeclaredActions = { actions: ['resync-folder'], extraActions: ['toggle-info-panel'] };
        expect(buildGridSurfaceState(everything(declared)).availableActions).toEqual(['toggle-info-panel', 'resync-folder']);
        expect(isGridSurfaceActionDeclared('toggle-edit-mode', declared)).toBe(false);
        expect(isGridSurfaceActionDeclared('toggle-info-panel', declared)).toBe(true);
    });

    it('refuses to run an undeclared action even when the branch would allow it', () => {
        const params = everything({ actions: ['play-scope'], extraActions: [] });
        runGridSurfaceAction('resync-folder', params);
        runGridSurfaceAction('toggle-info-panel', params);
        runGridSurfaceAction('play-filtered', params);
        expect(params.resyncFolder).not.toHaveBeenCalled();
        expect(params.toggleInfoPanel).not.toHaveBeenCalled();
        expect(params.playFiltered).toHaveBeenCalledTimes(1);
    });

    it('maps toggle-subscribe to the subscribe action', () => {
        expect(GRID_SURFACE_ACTION_SOURCES['toggle-subscribe']).toEqual({ action: 'subscribe' });
        const declared: LibraryDeclaredActions = { actions: ['subscribe'], extraActions: [] };
        expect(buildGridSurfaceState(everything(declared)).availableActions).toEqual(['toggle-subscribe']);
        expect(buildGridSurfaceState(everything({ actions: ['play-scope'], extraActions: [] })).availableActions)
            .not.toContain('toggle-subscribe');
    });

    it('lets a core-only surface pass its declaration through buildCoreSurfaceParams', () => {
        const params = core({ declaredActions: { actions: ['play-scope', 'enqueue-scope'], extraActions: [] } });
        expect(buildGridSurfaceState(params).availableActions).toEqual(['play-filtered', 'enqueue-filtered']);
    });
});

describe('collection sync counts', () => {
    it('reports loaded / total only when the total is known', () => {
        expect(resolveCollectionSyncCounts(1500, 3000)).toEqual({ loaded: (1500).toLocaleString(), total: (3000).toLocaleString() });
        expect(resolveCollectionSyncCounts(10, undefined)).toBeNull();
        expect(resolveCollectionSyncCounts(10, 0)).toBeNull();
    });
});
