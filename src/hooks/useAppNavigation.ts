import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalLibraryGroup } from '../types';
import {
    type SearchReturnView,
    type SearchSource,
    useSearchNavigationStore,
} from '../stores/useSearchNavigationStore';
import {
    type CollectionNavigationOrigin,
    type CollectionNavigationSnapshot,
    notifyCollectionPop,
    useCollectionNavigationStore,
} from '../stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '../library/core/collection/collection.contract';
import { collectionHashPath } from '../library/core/collection/collectionIdentity';
import { resolveCollectionPopTo } from '../library/core/collection/collectionNavigation';
import {
    APP_HISTORY_SESSION,
    createNavigationHistoryJournal,
    findCollectionTraversal,
    findLayerBaseIndex,
    type NavigationHistoryState,
} from './navigationHistoryJournal';
import { useAppViewStore } from '../stores/useAppViewStore';
import type { AppView, LatticeSource } from '../stores/useAppViewStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { resolvePlaybackSurface, usePlaybackEntryViewStore, type PlaybackEntryView } from '../stores/usePlaybackEntryViewStore';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import i18n from '../i18n/config';

// src/hooks/useAppNavigation.ts

type ViewState = AppView;

type LocalMusicNavigationState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: 'home' | 'player' | null;
    focusedFolderIndex: number;
    focusedAlbumIndex: number;
    focusedArtistIndex: number;
    focusedPlaylistIndex: number;
};

export type { NavigationHistoryState };

const LAST_APP_VIEW_KEY = 'last_app_view';
const OPEN_PLAYER_ON_LAUNCH_KEY = 'open_player_on_launch';

const buildHistoryState = (
    view: ViewState,
    search: NavigationHistoryState['search'] = null,
    collection: NavigationHistoryState['collection'] = null,
    appHistoryIndex = 0,
): NavigationHistoryState => ({
    view,
    search,
    collection,
    appHistoryIndex,
    appHistorySession: APP_HISTORY_SESSION,
});

const getAppHistoryIndex = (state: unknown): number => {
    if (!state || typeof state !== 'object') return 0;
    const index = (state as Partial<NavigationHistoryState>).appHistoryIndex;
    return typeof index === 'number' && Number.isFinite(index) && index >= 0 ? index : 0;
};

export const shouldNavigatePlayerBackThroughHistory = (
    state: NavigationHistoryState | null,
): boolean => state?.view === 'player' && getAppHistoryIndex(state) > 0;

export const shouldReplacePlayerNavigation = (
    state: NavigationHistoryState | null,
): boolean => state?.view === 'player';

export const resolvePlayerCapsuleNavigationTarget = (
    view: ViewState,
    playbackEntryView: PlaybackEntryView,
    isFmMode: boolean,
): 'player' | 'lattice' | null => {
    if (view === 'lattice') return null;
    // fb3：「留在原处」没有自己的视图，显式要求进入播放视图（胶囊、启动、bravais 的「进入」）时去播放页。
    return resolvePlaybackSurface(playbackEntryView) === 'lattice' && !isFmMode ? 'lattice' : 'player';
};

const getSearchHistorySnapshot = (): NavigationHistoryState['search'] => {
    const searchState = useSearchNavigationStore.getState();
    return searchState.isSearchOpen
        ? {
            // 记下的是搜出当前结果的词：恢复时按它查缓存，输入框里没提交的字查不到。
            query: searchState.submittedQuery,
            sourceTab: searchState.searchSourceTab,
            kind: searchState.searchKind,
            returnView: searchState.searchReturnView,
        }
        : null;
};

/**
 * Which view a launch lands on. "Open player on launch" means "open the playback surface", so it
 * follows the stored playback entry preference and reuses the capsule's Lattice rule: Lattice only
 * when it can actually show something (non-empty queue, not FM), otherwise the player.
 */
export const resolveStartupView = ({
    openPlayerOnLaunch,
    playbackEntryView,
    isFmMode,
    queueLength,
}: {
    openPlayerOnLaunch: boolean;
    playbackEntryView: PlaybackEntryView;
    isFmMode: boolean;
    queueLength: number;
}): 'home' | 'player' | 'lattice' => {
    if (!openPlayerOnLaunch) return 'home';
    if (queueLength <= 0) return 'player';
    return resolvePlayerCapsuleNavigationTarget('home', playbackEntryView, isFmMode) ?? 'player';
};

/** Whether a launch wanted Lattice but had to start on the player because the queue was not restored yet. */
export const isStartupLatticeDeferred = ({
    openPlayerOnLaunch,
    playbackEntryView,
    isFmMode,
}: {
    openPlayerOnLaunch: boolean;
    playbackEntryView: PlaybackEntryView;
    isFmMode: boolean;
}): boolean => openPlayerOnLaunch && playbackEntryView === 'lattice' && !isFmMode;

// The last session is restored asynchronously (IndexedDB), so the queue is still empty when the
// startup view is chosen; a deferred Lattice launch waits at most this long for it.
const STARTUP_LATTICE_RESTORE_WINDOW_MS = 10000;

const getStartupView = (): ViewState => resolveStartupView({
    openPlayerOnLaunch: localStorage.getItem(OPEN_PLAYER_ON_LAUNCH_KEY) === 'true',
    playbackEntryView: usePlaybackEntryViewStore.getState().playbackEntryView,
    isFmMode: usePlaybackStore.getState().isFmMode,
    queueLength: usePlaybackStore.getState().playQueue.length,
});

const LOCAL_MUSIC_LAST_ROW_KEY = 'folia_local_music_last_row';

// 折叠往返（history.back()）与面包屑跳层（history.go(-k)）是异步的：popstate 到来之前 store 还是退回前的栈，这时
// 再点一次会按旧栈再算一遍、多退几步。等 popstate 期间新的压栈 / 跳层都忽略；popstate 一直不来（理论上不会）时
// 最多等这么久。应用内返回不受它限制（连按返回本来就该一层层退）。
const COLLECTION_TRAVERSAL_TIMEOUT_MS = 1000;

export const blockLatticeNavigationInFm = (): boolean => {
    if (!usePlaybackStore.getState().isFmMode) return false;
    setStatusMessage({ type: 'info', text: i18n.t('status.latticeUnavailableInFm') });
    return true;
};

export function useAppNavigation() {
    // The view itself lives in useAppViewStore so that consumers far from here can read it
    // without being handed it; this hook stays the only writer.
    const currentView = useAppViewStore(state => state.view);
    const setCurrentView = useAppViewStore(state => state.setView);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    // 应用历史记录的内存日志（N1）：面包屑跳层（popCollectionTo）据此算出要后退几步。寿命与这个 hook 相同（App 只挂一份）。
    const [historyJournal] = useState(createNavigationHistoryJournal);
    const pendingTraversalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [navidromeFocusedAlbumIndex, setNavidromeFocusedAlbumIndex] = useState(0);
    const [localMusicState, setLocalMusicState] = useState<LocalMusicNavigationState>(() => {
        let savedRow = 0;
        try {
            const saved = localStorage.getItem(LOCAL_MUSIC_LAST_ROW_KEY);
            if (saved !== null) {
                const parsed = parseInt(saved, 10);
                if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
                    savedRow = parsed;
                }
            }
        } catch (e) {
            console.warn('[useAppNavigation] Failed to restore local music last row:', e);
        }
        return {
            activeRow: savedRow as LocalMusicNavigationState['activeRow'],
            selectedGroup: null,
            detailStack: [],
            detailOriginView: null,
            focusedFolderIndex: 0,
            focusedAlbumIndex: 0,
            focusedArtistIndex: 0,
            focusedPlaylistIndex: 0,
        };
    });

    useEffect(() => {
        try {
            localStorage.setItem(LOCAL_MUSIC_LAST_ROW_KEY, localMusicState.activeRow.toString());
        } catch (e) {
            console.warn('[useAppNavigation] Failed to save local music last row:', e);
        }
    }, [localMusicState.activeRow]);

    /** 折叠往返 / 跳层的历史后退已经落地（popstate）或等不来了：放开压栈与跳层。 */
    const finishCollectionTraversal = useCallback(() => {
        if (pendingTraversalRef.current !== null) clearTimeout(pendingTraversalRef.current);
        pendingTraversalRef.current = null;
    }, []);

    /** 发出一次历史后退之前调用：在它的 popstate 落地之前忽略新的压栈与跳层。 */
    const beginCollectionTraversal = useCallback(() => {
        finishCollectionTraversal();
        pendingTraversalRef.current = setTimeout(finishCollectionTraversal, COLLECTION_TRAVERSAL_TIMEOUT_MS);
    }, [finishCollectionTraversal]);

    const restoreHistoryState = useCallback((state: NavigationHistoryState) => {
        localStorage.setItem(LAST_APP_VIEW_KEY, state.view);
        // Before the view: the wall reads what it shows when it is put up.
        if (state.view === 'lattice') useAppViewStore.getState().setLatticeSource(state.latticeSource ?? 'queue');
        setCurrentView(state.view);
        useCollectionNavigationStore.getState().restore(state.collection ?? null);
        if (state.search) {
            useSearchNavigationStore.getState().restoreSearch(state.search);
        } else {
            useSearchNavigationStore.getState().hideSearchOverlay();
        }
    }, [setCurrentView]);

    const pushNavigationState = useCallback(({
        view,
        replace = false,
        hash,
        search = null,
        collection = null,
        latticeSource,
    }: {
        view: ViewState;
        replace?: boolean;
        hash?: string;
        search?: NavigationHistoryState['search'];
        collection?: NavigationHistoryState['collection'];
        latticeSource?: LatticeSource;
    }) => {
        const currentHistoryIndex = getAppHistoryIndex(window.history.state);
        const nextState: NavigationHistoryState = {
            ...buildHistoryState(
                view,
                search,
                collection,
                replace ? currentHistoryIndex : currentHistoryIndex + 1,
            ),
            ...(latticeSource === 'explore' ? { latticeSource } : {}),
        };
        const method = replace ? window.history.replaceState.bind(window.history) : window.history.pushState.bind(window.history);
        // 当前记录可能是别处直接 pushState 写的（例如 suite 自己的面板记录），压栈前先把它同步进日志。
        if (!replace) historyJournal.observe(window.history.state);
        method(nextState, '', hash ?? window.location.hash);
        historyJournal.record(nextState, replace ? 'replace' : 'push');
        restoreHistoryState(nextState);
    }, [historyJournal, restoreHistoryState]);

    const resetLocalNavigationContext = useCallback(() => {
        setLocalMusicState(prev => ({
            ...prev,
            activeRow: 0,
            selectedGroup: null,
            detailStack: [],
            detailOriginView: null,
        }));
    }, []);

    useEffect(() => {
        const initialView = getStartupView();
        const initialState = buildHistoryState(initialView);
        window.history.replaceState(
            initialState,
            '',
            initialView === 'player' ? '#player' : initialView === 'lattice' ? '#lattice' : (window.location.pathname + window.location.search),
        );
        historyJournal.reset(initialState);
        restoreHistoryState(initialState);
        resetLocalNavigationContext();

        // A Lattice launch cannot be decided up front: the queue arrives after the session restore.
        // Start on the player (as before) and swap to Lattice in place once the queue lands, but only
        // if the listener has not moved on, so this never overrides a navigation they made.
        let unsubscribeDeferredLattice: (() => void) | null = null;
        let deferredLatticeTimer: ReturnType<typeof setTimeout> | null = null;
        const cancelDeferredLattice = () => {
            unsubscribeDeferredLattice?.();
            unsubscribeDeferredLattice = null;
            if (deferredLatticeTimer !== null) clearTimeout(deferredLatticeTimer);
            deferredLatticeTimer = null;
        };
        const startupOptions = {
            openPlayerOnLaunch: localStorage.getItem(OPEN_PLAYER_ON_LAUNCH_KEY) === 'true',
            playbackEntryView: usePlaybackEntryViewStore.getState().playbackEntryView,
            isFmMode: usePlaybackStore.getState().isFmMode,
        };
        if (initialView === 'player' && isStartupLatticeDeferred(startupOptions)) {
            const tryUpgrade = () => {
                const playback = usePlaybackStore.getState();
                const historyState = window.history.state as NavigationHistoryState | null;
                const stillOnStartupEntry = useAppViewStore.getState().view === 'player'
                    && historyState?.view === 'player'
                    && getAppHistoryIndex(historyState) === 0;
                if (!stillOnStartupEntry || playback.isFmMode) {
                    cancelDeferredLattice();
                    return;
                }
                if (playback.playQueue.length === 0) return;
                cancelDeferredLattice();
                const target = resolveStartupView({
                    ...startupOptions,
                    isFmMode: playback.isFmMode,
                    queueLength: playback.playQueue.length,
                });
                if (target !== 'lattice') return;
                const upgradedState = buildHistoryState('lattice');
                window.history.replaceState(upgradedState, '', '#lattice');
                historyJournal.record(upgradedState, 'replace');
                restoreHistoryState(upgradedState);
            };
            unsubscribeDeferredLattice = usePlaybackStore.subscribe(tryUpgrade);
            deferredLatticeTimer = setTimeout(cancelDeferredLattice, STARTUP_LATTICE_RESTORE_WINDOW_MS);
        }

        const handlePopState = (event: PopStateEvent) => {
            finishCollectionTraversal();
            const state = event.state as NavigationHistoryState | null;
            if (!state) {
                const fallbackState = buildHistoryState(getStartupView());
                window.history.replaceState(fallbackState, '', fallbackState.view === 'player' ? '#player' : fallbackState.view === 'lattice' ? '#lattice' : '#home');
                historyJournal.reset(fallbackState);
                restoreHistoryState(fallbackState);
                return;
            }
            historyJournal.observe(state);
            // 历史后退弹掉集合层时（浏览器后退，或应用内返回走的 history.back()），先在 store 变化之前通知：
            // 集合宿主据此让渲染这一层的 suite 跑 beforeBack（网格的反向移形换影），和应用内返回一致。
            notifyCollectionPop(state.collection ?? null);
            restoreHistoryState(state);
        };

        window.addEventListener('popstate', handlePopState);
        return () => {
            cancelDeferredLattice();
            finishCollectionTraversal();
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    const navigateToPlayer = useCallback(() => {
        const collection = useCollectionNavigationStore.getState().snapshot;
        const search = getSearchHistorySnapshot();
        const historyState = window.history.state as NavigationHistoryState | null;
        pushNavigationState({
            view: 'player',
            replace: shouldReplacePlayerNavigation(historyState),
            hash: '#player',
            search,
            collection,
        });
    }, [pushNavigationState]);

    useEffect(() => {
        if (!isFmMode || currentView !== 'lattice') return;
        // A wall of the explore page's entries shows no queue, so FM has nothing to take it down for.
        if (useAppViewStore.getState().latticeSource === 'explore') return;
        const collection = useCollectionNavigationStore.getState().snapshot;
        const search = getSearchHistorySnapshot();
        // FM owns and extends its queue dynamically, so replace a stale Lattice entry instead of
        // leaving it in browser history where Back would immediately reopen an unsupported view.
        pushNavigationState({ view: 'player', replace: true, hash: '#player', search, collection });
    }, [currentView, isFmMode, pushNavigationState]);

    const navigateToHome = useCallback(() => {
        if (useAppViewStore.getState().view === 'home') {
            return;
        }
        const collection = useCollectionNavigationStore.getState().snapshot;
        const search = getSearchHistorySnapshot();
        pushNavigationState({
            view: 'home',
            hash: collection?.stack.length
                ? collectionHashPath(collection.stack[collection.stack.length - 1])
                : '#home',
            search,
            collection,
        });
    }, [pushNavigationState]);

    // `source`: the home header's pill, pressed on the explore tab, asks for the explore page's
    // entries. Every other way in shows the play queue. (Several callers are click handlers and
    // hand over the event: whatever is not 'explore' is the queue.)
    const navigateToLattice = useCallback((source?: LatticeSource) => {
        const latticeSource: LatticeSource = source === 'explore' ? 'explore' : 'queue';
        // FM owns its queue and extends it as it plays, so the wall cannot show it. The explore
        // page's entries are no queue: that wall opens in FM too.
        if (latticeSource === 'queue' && blockLatticeNavigationInFm()) return;
        if (useAppViewStore.getState().view === 'lattice') return;
        useSearchNavigationStore.getState().hideSearchOverlay();
        // A wall opened anew starts where an opening starts, not on the tile an earlier one was left on.
        useAppViewStore.getState().setLatticeReturnTileId(null);
        pushNavigationState({
            view: 'lattice',
            hash: '#lattice',
            latticeSource,
        });
    }, [pushNavigationState]);

    /**
     * Where starting a song lands. Reads the stored preference rather than each caller deciding,
     * so every "play this" path agrees on one answer.
     *
     * Only redirects when the listener is arriving from somewhere else. Player and Lattice are both
     * playback surfaces, and this also runs on auto-advance — moving someone from the one they are
     * watching to the other because a track ended would be the setting reaching too far.
     *
     * FM falls back to the player silently: Lattice cannot show an FM queue, and the usual
     * "unavailable in FM" toast would be noise when nobody asked to open it.
     */
    const navigateToPlaybackView = useCallback(() => {
        const view = useAppViewStore.getState().view;
        if (view === 'lattice') return;
        const entryView = usePlaybackEntryViewStore.getState().playbackEntryView;
        // fb3「留在原处」：播放不带人去任何地方——资料库的卡片 / 墙自己显示正在播放（暂停 / 继续）。
        // 已经在播放页上（例如自动切歌）时照旧走下面的 navigateToPlayer，与另外两个值一致。
        if (entryView === 'stay' && view !== 'player') return;
        if (entryView === 'lattice' && view !== 'player' && !usePlaybackStore.getState().isFmMode) {
            navigateToLattice();
            return;
        }
        navigateToPlayer();
    }, [navigateToLattice, navigateToPlayer]);

    const navigateFromPlayerCapsule = useCallback(() => {
        const target = resolvePlayerCapsuleNavigationTarget(
            useAppViewStore.getState().view,
            usePlaybackEntryViewStore.getState().playbackEntryView,
            usePlaybackStore.getState().isFmMode,
        );
        if (target === 'lattice') {
            navigateToLattice();
        } else if (target === 'player') {
            navigateToPlayer();
        }
    }, [navigateToLattice, navigateToPlayer]);

    const navigateBackFromLattice = useCallback(() => {
        const state = window.history.state as NavigationHistoryState | null;
        if (state?.view === 'lattice' && getAppHistoryIndex(state) > 0) {
            window.history.back();
            return;
        }
        navigateToHome();
    }, [navigateToHome]);

    const navigateDirectHome = useCallback((options?: { clearContext?: boolean; }) => {
        const clearContext = options?.clearContext ?? true;
        if (clearContext) {
            resetLocalNavigationContext();
        }
        useSearchNavigationStore.getState().hideSearchOverlay();
        useCollectionNavigationStore.getState().clear();
        pushNavigationState({
            view: 'home',
            replace: true,
            hash: window.location.pathname + window.location.search,
        });
    }, [pushNavigationState, resetLocalNavigationContext]);

    const navigateBackFromPlayer = useCallback(() => {
        const historyState = window.history.state as NavigationHistoryState | null;
        if (shouldNavigatePlayerBackThroughHistory(historyState)) {
            window.history.back();
            return;
        }
        navigateDirectHome();
    }, [navigateDirectHome]);

    const navigateToSearch = useCallback(({
        query,
        sourceTab,
        replace = false,
        returnView = 'home',
    }: {
        query: string;
        sourceTab: SearchSource;
        replace?: boolean;
        returnView?: SearchReturnView;
    }) => {
        useCollectionNavigationStore.getState().clear();
        // 搜索先提交、再压历史：种类按提交时定下的记（来源搜不到的种类已退回单曲）。
        const search = { query, sourceTab, kind: useSearchNavigationStore.getState().searchKind, returnView };
        pushNavigationState({
            view: 'home',
            replace,
            hash: `#search/${encodeURIComponent(query)}`,
            search,
        });
    }, [pushNavigationState]);

    const closeSearchView = useCallback(() => {
        const searchReturnView = useSearchNavigationStore.getState().searchReturnView;
        useSearchNavigationStore.getState().hideSearchOverlay();
        pushNavigationState({
            view: searchReturnView,
            replace: true,
            hash: searchReturnView === 'player'
                ? '#player'
                : window.location.pathname + window.location.search,
        });
    }, [pushNavigationState]);

    const navigateToCollection = useCallback((
        collection: GridViewCollectionDescriptor,
        origin: CollectionNavigationOrigin,
    ) => {
        const snapshot = useCollectionNavigationStore.getState().openRoot(collection, origin);
        const search = origin === 'search' ? getSearchHistorySnapshot() : null;
        pushNavigationState({
            view: 'home',
            hash: collectionHashPath(collection),
            search,
            collection: snapshot,
        });
    }, [pushNavigationState]);

    /**
     * 把集合栈退到 to（更浅的一层；null 是整个关掉），浏览器历史同步退回（N1，popCollectionTo 用）。
     *
     * 只改 store、或者再写一条截短的记录都不够：下一次浏览器后退会回到前面那条带着长栈的记录，退掉的层又被恢复出来。
     * 所以先在历史日志里找 to 对应的那条记录，history.go(-k) 退过去；之后与浏览器后退完全同路：popstate →
     * notifyCollectionPop（一次弹多层，宿主让 suite 只跑一次 beforeBack）→ restoreHistoryState。
     * 找不到（刷新后日志为空、记录被别处改写过……）时兜底：先通知弹栈，再压一条截短的记录。已知限制：兜底之后的
     * 浏览器后退可能回到跳层之前的位置。
     */
    const traverseCollectionTo = useCallback((to: CollectionNavigationSnapshot | null) => {
        const from = useCollectionNavigationStore.getState().snapshot;
        if (!from) return;
        historyJournal.observe(window.history.state);
        const steps = findCollectionTraversal(historyJournal, getAppHistoryIndex(window.history.state), from, to);
        if (steps !== null) {
            beginCollectionTraversal();
            window.history.go(-steps);
            return;
        }

        notifyCollectionPop(to);
        if (to) {
            pushNavigationState({
                view: 'home',
                hash: collectionHashPath(to.stack[to.stack.length - 1]),
                search: to.origin === 'search' ? getSearchHistorySnapshot() : null,
                collection: to,
            });
            return;
        }
        // 整个关掉：落回根集合打开之前的地方（与没有历史记录时从根返回一致：播放器打开的回播放器）。
        const search = from.origin === 'search' ? getSearchHistorySnapshot() : null;
        const view: ViewState = from.origin === 'player' ? 'player' : 'home';
        pushNavigationState({
            view,
            hash: view === 'player'
                ? '#player'
                : search ? `#search/${encodeURIComponent(search.query)}` : '#home',
            search,
            collection: null,
        });
    }, [beginCollectionTraversal, historyJournal, pushNavigationState]);

    /**
     * 应用内返回一层（返回按钮、Escape，以及折叠往返）：当前历史记录带集合就 history.back()，之后与浏览器后退同路
     * （popstate → 弹栈通知 → 恢复）；没有历史记录时手动弹一层，同样先通知再改 store。返回值是走了哪条路。
     */
    const popCollectionLayer = useCallback((options?: { leaveLayer?: boolean }): 'history' | 'local' | 'none' => {
        const snapshot = useCollectionNavigationStore.getState().snapshot;
        if (!snapshot) {
            return 'none';
        }
        if (window.history.state?.collection) {
            // leaveLayer（折叠往返）：当前层之上若压着 suite 自己的面板记录（同一个栈，例如 bravais 的列表面板），
            // 连它们一起退，落到上一层；只退一步会只关掉面板、留在这一层。应用内返回不传——返回先关面板。
            const index = getAppHistoryIndex(window.history.state);
            if (options?.leaveLayer) historyJournal.observe(window.history.state);
            const steps = options?.leaveLayer ? index - findLayerBaseIndex(historyJournal, index) + 1 : 1;
            if (steps > 1) window.history.go(-steps);
            else window.history.back();
            return 'history';
        }

        const nextStack = snapshot.stack.slice(0, -1);
        if (nextStack.length > 0) {
            const next = { ...snapshot, stack: nextStack };
            notifyCollectionPop(next);
            useCollectionNavigationStore.getState().restore(next);
            return 'local';
        }
        notifyCollectionPop(null);
        useCollectionNavigationStore.getState().clear();
        if (snapshot.origin === 'player') {
            setCurrentView('player');
        }
        return 'local';
    }, [historyJournal, setCurrentView]);

    const pushCollection = useCallback((collection: GridViewCollectionDescriptor) => {
        if (pendingTraversalRef.current !== null) return;
        const decision = useCollectionNavigationStore.getState().push(collection);
        if (decision.kind === 'back') {
            // 要进入的正好是上一层（歌手 ↔ 专辑来回点）：当作一次应用内返回，而不是再压一层（N1 折叠紧邻往返）。
            // beforeBack 由弹栈通知跑一次（宿主在这条路上不跑 beforePush / beforeBack）。
            if (popCollectionLayer({ leaveLayer: true }) === 'history') beginCollectionTraversal();
            return;
        }
        if (decision.kind !== 'push') {
            return;
        }
        const snapshot = decision.snapshot;
        pushNavigationState({
            view: 'home',
            hash: collectionHashPath(collection),
            search: snapshot.origin === 'search' ? getSearchHistorySnapshot() : null,
            collection: snapshot,
        });
    }, [beginCollectionTraversal, popCollectionLayer, pushNavigationState]);

    /**
     * 跳到集合栈的第 depth 层（面包屑点击用）：depth 是保留的层数，与 LibraryNavigationContext.depth 同一种量；
     * 0 表示整个关掉。不比当前浅的 depth 什么都不做；栈里有重复的集合时按位置算（点哪一项就退到哪一层）。
     * 走浏览器历史（history.go(-k)），beforeBack 由 popstate 的弹栈通知触发一次，调用方（宿主 / suite）不要自己
     * 再跑 beforeBack。上一次跳层 / 折叠的 popstate 还没落地时忽略。
     */
    const popCollectionTo = useCallback((depth: number) => {
        if (pendingTraversalRef.current !== null) return;
        const to = resolveCollectionPopTo(useCollectionNavigationStore.getState().snapshot, depth);
        if (to === undefined) return;
        traverseCollectionTo(to);
    }, [traverseCollectionTo]);

    const backCollection = useCallback(() => {
        popCollectionLayer();
    }, [popCollectionLayer]);

    return {
        currentView,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        localMusicState,
        setLocalMusicState,
        navigateToPlayer,
        navigateToPlaybackView,
        navigateFromPlayerCapsule,
        navigateToHome,
        navigateToLattice,
        navigateBackFromLattice,
        navigateBackFromPlayer,
        navigateDirectHome,
        navigateToSearch,
        closeSearchView,
        navigateToCollection,
        pushCollection,
        popCollectionTo,
        backCollection,
    };
}
