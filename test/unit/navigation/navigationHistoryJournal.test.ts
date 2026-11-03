import { describe, expect, it } from 'vitest';
import type { CollectionNavigationSnapshot, GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import {
    createNavigationHistoryJournal,
    findCollectionTraversal,
    findLayerBaseIndex,
    type NavigationHistoryState,
} from '@/hooks/navigationHistoryJournal';

// test/unit/navigation/navigationHistoryJournal.test.ts
// N1 的历史日志：appHistoryIndex → 记录，push 截掉前进部分、replace / popstate 只更新那一条、别的会话的记录清空日志；
// 以及面包屑跳层时「要后退几步」的查找（只在同一次集合浏览里找，遇到空位或别的浏览就交给兜底）。

const SESSION = 'test-session';

const online = (type: 'album' | 'artist' | 'playlist', id: string) => ({
    source: 'online',
    providerId: 'netease',
    id,
    name: `${type} ${id}`,
    type,
} as unknown as GridViewCollectionDescriptor);

const root = online('playlist', 'root');
const skyline = online('album', 'skyline');
const polaris = online('artist', 'polaris');

const snap = (origin: CollectionNavigationSnapshot['origin'], ...stack: GridViewCollectionDescriptor[]): CollectionNavigationSnapshot => ({ origin, stack });

const entry = (
    appHistoryIndex: number,
    view: NavigationHistoryState['view'],
    collection: CollectionNavigationSnapshot | null = null,
    session = SESSION,
): NavigationHistoryState => ({ view, search: null, collection, appHistoryIndex, appHistorySession: session });

/** 依次 push 的一串记录（下标从 0 起）。 */
const journalOf = (...states: Array<[NavigationHistoryState['view'], CollectionNavigationSnapshot | null]>) => {
    const journal = createNavigationHistoryJournal(SESSION);
    states.forEach(([view, collection], index) => {
        const state = entry(index, view, collection);
        if (index === 0) journal.reset(state);
        else journal.record(state, 'push');
    });
    return journal;
};

describe('navigation history journal', () => {
    it('records pushes and truncates the forward part on a push', () => {
        const journal = createNavigationHistoryJournal(SESSION);
        journal.reset(entry(0, 'home'));
        journal.record(entry(1, 'home', snap('home', root)), 'push');
        journal.record(entry(2, 'home', snap('home', root, skyline)), 'push');
        // 浏览器后退到 1（popstate），再压一条：2 被替换，原来的前进部分丢掉。
        journal.observe(entry(1, 'home', snap('home', root)));
        journal.record(entry(2, 'home', snap('home', root, polaris)), 'push');
        expect(journal.entries().map(state => state?.collection?.stack.length ?? 0)).toEqual([0, 1, 2]);
        expect(journal.get(2)?.collection?.stack[1]).toBe(polaris);

        journal.record(entry(3, 'player', snap('home', root, polaris)), 'push');
        journal.observe(entry(1, 'home', snap('home', root)));
        journal.record(entry(2, 'lattice'), 'push');
        expect(journal.entries()).toHaveLength(3);
        expect(journal.get(3)).toBeUndefined();
    });

    it('updates one entry on replace and keeps the forward part', () => {
        const journal = journalOf(['home', null], ['home', snap('home', root)], ['home', snap('home', root, skyline)]);
        journal.observe(entry(1, 'home', snap('home', root)));
        journal.record(entry(1, 'player', snap('home', root)), 'replace');
        expect(journal.get(1)?.view).toBe('player');
        expect(journal.entries()).toHaveLength(3);
    });

    it('syncs an entry written by someone else when it shows up (popstate or before a push)', () => {
        const journal = journalOf(['home', null], ['home', snap('home', root)]);
        // 例如 suite 自己的面板记录：沿用当前记录的形状，index 加一。
        journal.observe({ ...entry(2, 'home', snap('home', root)), panel: 'x' } as NavigationHistoryState);
        expect(journal.get(2)?.collection?.stack).toEqual([root]);
    });

    it('drops everything when a record from another page session (before a reload) or without state shows up', () => {
        const journal = journalOf(['home', null], ['home', snap('home', root)], ['home', snap('home', root, skyline)]);
        journal.observe(entry(1, 'home', snap('home', root), 'previous-session'));
        expect(journal.entries()).toEqual([]);

        const second = journalOf(['home', null], ['home', snap('home', root)]);
        second.observe({ appHistoryIndex: 1, view: 'home' });
        expect(second.entries()).toEqual([]);
        second.reset(entry(0, 'home'));
        second.observe(null);
        expect(second.entries()).toEqual([]);
    });
});

describe('findCollectionTraversal', () => {
    it('finds how many entries back the shallower layer is', () => {
        const journal = journalOf(
            ['home', null],
            ['home', snap('home', root)],
            ['home', snap('home', root, skyline)],
            ['home', snap('home', root, skyline, polaris)],
        );
        const from = snap('home', root, skyline, polaris);
        expect(findCollectionTraversal(journal, 3, from, snap('home', root, skyline))).toBe(1);
        expect(findCollectionTraversal(journal, 3, from, snap('home', root))).toBe(2);
    });

    it('closing everything lands on the entry before the root (where back from the root would go)', () => {
        const journal = journalOf(
            ['home', null],
            ['home', snap('home', root)],
            ['home', snap('home', root, skyline)],
        );
        expect(findCollectionTraversal(journal, 2, snap('home', root, skyline), null)).toBe(2);
        expect(findCollectionTraversal(journal, 1, snap('home', root), null)).toBe(1);
    });

    it('steps over player entries of the same visit', () => {
        // 在 Skyline 打开播放页，再从播放页回到首页（压了一条新的 home 记录）。
        const journal = journalOf(
            ['home', null],
            ['home', snap('home', root)],
            ['home', snap('home', root, skyline)],
            ['player', snap('home', root, skyline)],
            ['home', snap('home', root, skyline)],
            ['home', snap('home', root, skyline, polaris)],
        );
        const from = snap('home', root, skyline, polaris);
        // 最近的那条 home 记录：退 1 步，而不是一路退回 2。
        expect(findCollectionTraversal(journal, 5, from, snap('home', root, skyline))).toBe(1);
        expect(findCollectionTraversal(journal, 5, from, snap('home', root))).toBe(4);
    });

    it('lands on the player when the root was opened from it', () => {
        const journal = journalOf(
            ['home', null],
            ['player', snap('home', online('album', 'earlier'))],
            ['home', snap('player', root)],
            ['home', snap('player', root, skyline)],
        );
        expect(findCollectionTraversal(journal, 3, snap('player', root, skyline), null)).toBe(2);
    });

    it('gives up (fallback) on a gap, on another visit, or when the current entry is not the current stack', () => {
        const from = snap('home', root, skyline, polaris);
        const target = snap('home', root);

        // 刷新之后：日志里只有当前这一条。
        const afterReload = createNavigationHistoryJournal(SESSION);
        afterReload.reset(entry(3, 'home', from));
        expect(findCollectionTraversal(afterReload, 3, from, target)).toBeNull();

        // 中间夹着别的浏览（例如 Lattice 关掉了集合层）：不跨过去找上一次浏览里的同一层。
        const otherVisit = journalOf(
            ['home', null],
            ['home', snap('home', root)],
            ['lattice', null],
            ['home', snap('home', root, skyline)],
            ['home', from],
        );
        expect(findCollectionTraversal(otherVisit, 4, from, target)).toBeNull();

        // 当前记录不是当前的栈（例如 store 被单独改过）：历史与 store 对不上，不能 go。
        const mismatch = journalOf(['home', null], ['home', snap('home', root)], ['home', snap('home', root, skyline)]);
        expect(findCollectionTraversal(mismatch, 2, from, target)).toBeNull();

        // 根在日志的第一条：整个关掉时不知道它前面是什么。
        const rootFirst = createNavigationHistoryJournal(SESSION);
        rootFirst.reset(entry(0, 'home', snap('home', root)));
        expect(findCollectionTraversal(rootFirst, 0, snap('home', root), null)).toBeNull();
    });

    it('never returns zero steps', () => {
        const journal = journalOf(['home', null], ['home', snap('home', root)]);
        expect(findCollectionTraversal(journal, 1, snap('home', root), snap('home', root))).toBeNull();
    });
});

// 合并进 bravais：suite 在一层之上自己 pushState 的面板记录（bravais 列表面板：同一个栈、view 为 home、index + 1）
// 属于那一层。跳层与折叠往返都落在那一层的第一条记录上，不落在面板记录上。
describe('suite panel entries above a layer', () => {
    it('finds the first entry of the layer, stopping at another stack, another view or a gap', () => {
        const journal = journalOf(
            ['home', null],
            ['home', snap('home', root)],
            ['home', snap('home', root)],
            ['home', snap('home', root, skyline)],
            ['player', snap('home', root, skyline)],
            ['home', snap('home', root, skyline)],
            ['home', snap('home', root, skyline)],
        );
        expect(findLayerBaseIndex(journal, 2)).toBe(1);
        expect(findLayerBaseIndex(journal, 1)).toBe(1);
        expect(findLayerBaseIndex(journal, 3)).toBe(3);
        // 播放页记录打断：从播放页回来压的那条 home 记录才是这一层的第一条。
        expect(findLayerBaseIndex(journal, 6)).toBe(5);
        expect(findLayerBaseIndex(journal, 4)).toBe(4);
        expect(findLayerBaseIndex(journal, 9)).toBe(9);

        const gap = createNavigationHistoryJournal(SESSION);
        gap.reset(entry(3, 'home', snap('home', root)));
        gap.observe(entry(4, 'home', snap('home', root)));
        expect(findLayerBaseIndex(gap, 4)).toBe(3);
    });

    it('lands a jump on the first entry of the target layer, not on its panel entry', () => {
        // 根 → 根上开面板 → Skyline（压栈时面板保留）→ Skyline 上开面板。
        const journal = journalOf(
            ['home', null],
            ['home', snap('home', root)],
            ['home', snap('home', root)],
            ['home', snap('home', root, skyline)],
            ['home', snap('home', root, skyline)],
        );
        const from = snap('home', root, skyline);
        expect(findCollectionTraversal(journal, 4, from, snap('home', root))).toBe(3);
        expect(findCollectionTraversal(journal, 3, from, snap('home', root))).toBe(2);
        // 整个关掉：落到根之前那一条，而不是根的第一条（面板记录之下）。
        expect(findCollectionTraversal(journal, 4, from, null)).toBe(4);
    });
});
