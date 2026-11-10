import type { AppView, LatticeSource } from '../stores/useAppViewStore';
import type { SearchKind, SearchReturnView, SearchSource } from '../stores/useSearchNavigationStore';
import type { CollectionNavigationSnapshot } from '../library/core/collection/collection.contract';
import {
    isSameCollectionPath,
    isSameCollectionVisit,
} from '../library/core/collection/collectionNavigation';

// src/hooks/navigationHistoryJournal.ts
// 应用历史记录的内存日志（N1）：appHistoryIndex → 那条记录的 NavigationHistoryState。浏览器不让页面读别的历史记录，
// 而面包屑跳层（popCollectionTo）要知道「退回那一层要后退几步」（history.go(-k)），所以 useAppNavigation 每写一条
// 记录（push / replace）、每次 popstate、启动时都同步一份到这里。纯逻辑、不碰 window，单测直接喂记录。
// 折叠紧邻往返不用它：那是一次普通的应用内返回（history.back()）。
// 例外（合并进 bravais 时补）：当前层之上压着 suite 自己的面板记录时，折叠往返要连它一起越过（findLayerBaseIndex），
// 否则 history.back() 只关掉面板、留在这一层。
//
// 日志只信同一个页面会话写的记录（appHistorySession）：刷新之后，旧会话留下的记录 index 会与新会话重叠，
// 落到那种记录上（浏览器后退回到刷新前）就清空日志，之后找不到对应记录的跳层走兜底。

export type NavigationHistoryState = {
    view: AppView;
    /** `kind`：搜的是单曲、专辑还是歌单；旧记录没有它。 */
    search?: { query: string; sourceTab: SearchSource; kind?: SearchKind; returnView?: SearchReturnView; } | null;
    collection?: CollectionNavigationSnapshot | null;
    /** Set on a 'lattice' entry that shows the explore page's entries; one without it shows the play queue. */
    latticeSource?: LatticeSource;
    appHistoryIndex: number;
    /** 写这条记录的页面会话（每次加载页面一个新值）；旧记录没有它。 */
    appHistorySession?: string;
};

/** 本次页面加载的会话标记，写进每一条应用历史记录。 */
export const APP_HISTORY_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type NavigationHistoryJournal = {
    /** 应用自己 pushState / replaceState 之后记下这一条；push 同时丢掉它之后的前进部分（浏览器也丢了）。 */
    record: (state: NavigationHistoryState, mode: 'push' | 'replace') => void;
    /**
     * 当前记录换成了 state（popstate 落到它，或别处直接 pushState 之后我们第一次看到它）：同一会话的就记下，
     * 不是（刷新前的旧记录、没有状态）就清空日志——它周围的 index 已经对不上了。
     */
    observe: (state: unknown) => void;
    /** 清空，只留 state 这一条（启动、无状态记录被替换时）。 */
    reset: (state: NavigationHistoryState) => void;
    get: (index: number) => NavigationHistoryState | undefined;
    /** 日志的副本（下标即 appHistoryIndex，空位是没见过的记录）；给单测与调试用。 */
    entries: () => Array<NavigationHistoryState | undefined>;
};

const isValidIndex = (index: unknown): index is number => (
    typeof index === 'number' && Number.isInteger(index) && index >= 0
);

/** 创建一份日志；session 默认是本次页面加载的会话（单测传自己的）。 */
export const createNavigationHistoryJournal = (session: string = APP_HISTORY_SESSION): NavigationHistoryJournal => {
    let entries: Array<NavigationHistoryState | undefined> = [];
    const isOwn = (state: unknown): state is NavigationHistoryState => (
        Boolean(state)
        && typeof state === 'object'
        && (state as NavigationHistoryState).appHistorySession === session
        && isValidIndex((state as NavigationHistoryState).appHistoryIndex)
    );
    return {
        record: (state, mode) => {
            if (!isOwn(state)) {
                entries = [];
                return;
            }
            const index = state.appHistoryIndex;
            if (mode === 'push') entries.length = Math.min(entries.length, index);
            entries[index] = state;
        },
        observe: (state) => {
            if (!isOwn(state)) {
                entries = [];
                return;
            }
            entries[state.appHistoryIndex] = state;
        },
        reset: (state) => {
            entries = [];
            if (isOwn(state)) entries[state.appHistoryIndex] = state;
        },
        get: (index) => (isValidIndex(index) ? entries[index] : undefined),
        entries: () => Array.from({ length: entries.length }, (_, index) => entries[index]),
    };
};

/**
 * index 那条记录所在「这一层」的第一条记录：往回连着的、view 都是 home、集合栈与它逐层一致的记录算同一层。
 * suite 在一层之上自己 pushState 的记录（bravais 的列表面板：在当前记录上加标记、appHistoryIndex + 1，栈不变）就是
 * 这种——退出这一层（折叠往返）、跳到这一层（面包屑）时都以第一条为准，不落在面板记录上。播放页等别的 view 的记录、
 * 日志空位都会打断。index 那条不是 home 或不在日志里时原样返回。
 */
export const findLayerBaseIndex = (
    journal: Pick<NavigationHistoryJournal, 'get'>,
    index: number,
): number => {
    const current = journal.get(index);
    if (!current || current.view !== 'home') return index;
    let base = index;
    for (let previous = journal.get(base - 1); previous; previous = journal.get(base - 1)) {
        if (previous.view !== 'home' || !isSameCollectionPath(previous.collection, current.collection)) break;
        base -= 1;
    }
    return base;
};

/**
 * 从 from（当前集合栈，日志里当前那条记录必须正是它）退到 to 要后退几步；找不到返回 null，调用方走兜底。
 *
 * 从当前记录往回找，只在同一次集合浏览里找（同 origin、同一个根；中间的播放页记录带着同一份栈，也算），
 * 遇到日志空位或别的浏览就停：
 * - to 是更浅的一层：最近一条「view 为 home、快照与 to 是同一个位置」的记录（再往回越过同一层的面板记录，见
 *   findLayerBaseIndex）；
 * - to 为 null（整个关掉）：根集合那条记录的前一条，也就是从根返回时 history.back() 会落到的那条。
 */
export const findCollectionTraversal = (
    journal: Pick<NavigationHistoryJournal, 'get'>,
    currentIndex: number,
    from: CollectionNavigationSnapshot,
    to: CollectionNavigationSnapshot | null,
): number | null => {
    const current = journal.get(currentIndex);
    if (!current || !isSameCollectionPath(current.collection, from)) return null;
    const landing = to ?? { origin: from.origin, stack: from.stack.slice(0, 1) };
    for (let index = currentIndex; index >= 0; index -= 1) {
        const entry = journal.get(index);
        if (!entry || !isSameCollectionVisit(entry.collection, from)) return null;
        if (entry.view !== 'home' || !isSameCollectionPath(entry.collection, landing)) continue;
        if (to && index === currentIndex) return null;
        // 落在那一层的第一条记录上（越过 suite 在它之上写的面板记录）。
        const base = findLayerBaseIndex(journal, index);
        if (to) return currentIndex - base;
        // 整个关掉：落到根之前那一条（它必须在日志里，否则不知道那里是什么）。
        return base > 0 && journal.get(base - 1) ? currentIndex - base + 1 : null;
    }
    return null;
};
