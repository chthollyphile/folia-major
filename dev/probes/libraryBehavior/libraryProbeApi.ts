import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { useGridSurfaceStore } from '../../../src/stores/useGridSurfaceStore';
import { useCollectionNavigationStore } from '../../../src/stores/useCollectionNavigationStore';
import { useLibrarySuiteStore } from '../../../src/library/core/suite/useLibrarySuiteStore';
import { useLibraryArtistSurfaceStore } from '../../../src/library/core/artist/useLibraryArtistSurfaceStore';
import { useLibraryBrowseSessionStore } from '../../../src/library/core/shared/useLibraryBrowseSessionStore';
import { switchLibrarySuite } from '../../../src/library/app/switchLibrarySuite';
import { listLibrarySuites, resolveLibrarySurface } from '../../../src/library/registry';
import type { LibrarySuiteId } from '../../../src/library/core/suite/suite.contract';
import { collectionKey } from '../../../src/library/core/collection/collectionIdentity';
import type { LibraryProbeApi } from './probeApi';
import { clearProbeCalls, clearProbeRequests, getProbeLog } from './probeLog';
import {
    addProbeFault,
    clearProbeFaults,
    holdProbeMutations,
    holdProbePaging,
    onlineArtistFixtureTarget,
    onlineFixtureTarget,
    releaseProbeMutations,
    releaseProbePaging,
    setProbeLatency,
} from './fakeProviders';
import { probeRefreshGate } from './probeGates';
import {
    heldNavidromeResponses,
    holdNavidromeEndpoint,
    releaseNavidromeEndpoint,
    renameNavidromeArtist,
} from './navidromeShim';
import { seedProbeQueue } from './probeSurfaceCallbacks';
import { openArtistAlbum, openArtistPanel, readArtistFocus, readArtistGridFocus, readArtistView, reloadArtist } from './artistProbeView';

// dev/probes/libraryBehavior/libraryProbeApi.ts
// 把探针的驱动接口挂到 window 上。查询、动作都经由真实的注册点（命令筛选、grid surface），
// 用的是命令面板同一条通道，所以它测到的就是命令面板能做到的事。

type HarnessBindings = Pick<LibraryProbeApi, 'sandbox' | 'fixtures' | 'ready' | 'open' | 'back' | 'push' | 'pushArtist' | 'openArtist' | 'refreshLocal'>;

const setSuite = (suite: LibrarySuiteId) => {
    const stack = useCollectionNavigationStore.getState().snapshot?.stack ?? [];
    switchLibrarySuite(collectionKey(stack[stack.length - 1]), suite);
};
const currentSuite = () => useLibrarySuiteStore.getState().suite;

/** 安装 `window.__libraryProbe`，返回卸载函数。 */
export const installLibraryProbeApi = (bindings: HarnessBindings): (() => void) => {
    const api: LibraryProbeApi = {
        ...bindings,
        stack: () => useCollectionNavigationStore.getState().snapshot?.stack.map(collection => collection.name) ?? [],
        setQuery: (query) => {
            const filter = useAppViewStore.getState().commandFilter;
            if (!filter) return false;
            filter.setQuery(query);
            return true;
        },
        getQuery: () => useAppViewStore.getState().commandFilter?.getQuery() ?? null,
        browseSession: (sessionKey) => {
            const session = useLibraryBrowseSessionStore.getState().sessions[sessionKey];
            return session ? { query: session.query, focusedEntryKey: session.focusedEntryKey } : null;
        },
        surface: () => useGridSurfaceStore.getState().gridSurface?.getState() ?? null,
        runSurface: (action) => {
            const surface = useGridSurfaceStore.getState().gridSurface;
            if (!surface || !surface.getState().availableActions.includes(action)) return false;
            surface.run(action);
            return true;
        },
        setSuite,
        suite: currentSuite,
        setRenderer: setSuite,
        renderer: currentSuite,
        suites: () => listLibrarySuites().map(suite => suite.id),
        resolveSurface: (surface) => {
            const resolved = resolveLibrarySurface(surface, currentSuite());
            return { suiteId: resolved.suiteId, isFallback: resolved.isFallback, declaredActions: resolved.declaredActions };
        },
        holdPages: fixtureId => holdProbePaging(onlineFixtureTarget(fixtureId)),
        releasePages: fixtureId => releaseProbePaging(onlineFixtureTarget(fixtureId)),
        holdRefresh: kind => probeRefreshGate(kind).hold(),
        releaseRefresh: kind => probeRefreshGate(kind).release(),
        holdMutations: holdProbeMutations,
        releaseMutations: releaseProbeMutations,
        stackDescriptors: () => (useCollectionNavigationStore.getState().snapshot?.stack ?? []).map(collection => ({
            source: collection.source,
            ...(collection.source === 'online' ? { providerId: collection.providerId } : {}),
            type: collection.type,
            id: String(collection.id),
            name: collection.name,
            ...(collection.source === 'local' && collection.entityId ? { entityId: collection.entityId } : {}),
        })),
        artist: readArtistView,
        openArtistAlbum,
        openArtistPanel,
        reloadArtist,
        artistFocus: readArtistFocus,
        artistGridFocus: readArtistGridFocus,
        artistSurface: () => useLibraryArtistSurfaceStore.getState().artistSurface?.getState() ?? null,
        runArtistSurface: action => useLibraryArtistSurfaceStore.getState().artistSurface?.run(action) ?? false,
        artistTarget: onlineArtistFixtureTarget,
        addFault: addProbeFault,
        clearFaults: clearProbeFaults,
        setLatency: setProbeLatency,
        holdPagesOf: holdProbePaging,
        releasePagesOf: releaseProbePaging,
        holdNavidrome: holdNavidromeEndpoint,
        releaseNavidrome: releaseNavidromeEndpoint,
        heldNavidrome: heldNavidromeResponses,
        renameNavidromeArtist,
        seedQueue: seedProbeQueue,
        calls: () => getProbeLog().calls,
        requests: () => getProbeLog().requests,
        clearLog: () => {
            clearProbeCalls();
            clearProbeRequests();
        },
    };
    window.__libraryProbe = api;
    return () => {
        if (window.__libraryProbe === api) {
            delete window.__libraryProbe;
        }
    };
};
