import { afterEach, describe, expect, it } from 'vitest';
import bravais from '@/library/suites/bravais/entry';
import type { LibraryNavigationCrumb } from '@/library/core/suite/suite.contract';
import type { BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { buildBravaisCrumbs, type BravaisCrumbsInput } from '@/library/suites/bravais/bravaisCrumbs';
import { isSourceOrigin, layerMatchesNavigation, resolveShiftKind } from '@/library/suites/bravais/bravaisShift';
import { resolveBravaisReducedTransitions } from '@/library/suites/bravais/bravaisMotion';
import { recordPushOrigin, resetBravaisTransitions } from '@/library/suites/bravais/bravaisTransitions';
import { setBravaisPendingOrigin, useBravaisStageStore } from '@/library/suites/bravais/bravaisStageStore';
import { useBravaisUiStore } from '@/library/suites/bravais/bravaisUiStore';

// test/unit/library/bravais/bravaisNavigationTransitions.test.ts
// B11 导航与转场收尾的纯规则：
// - 面包屑：根 / 中间层给 onPopTo 的 depth（按位置，栈有重复项时点哪一项退哪一层），中间层多于 1 层时折成「…」，
//   展开后全部可点；面板开着时当前层可点（关面板）；trail 对不上正在画的层时退回不可点的「…」。
// - 换层种类：push / back / replace，加上来源是搜索 / 播放页的整墙入场（enter）与回到来源的整墙出场（exit）；
//   「同一个键、深度变了」只有 store 的层正是导航栈顶时才算换层。
// - 降低动态效果：lattice 或 collectionMorph 任一降级。
// - transitions：reset 丢掉起点与移除起点；beforePush 只在这一层还没记起点时用键盘焦点补上；entry 的钩子装上之前是空操作。

const crumb = (key: string, name = key): LibraryNavigationCrumb => ({ key, name, type: 'album' });

const input = (overrides: Partial<BravaisCrumbsInput>): BravaisCrumbsInput => ({
    rootLabel: 'Library',
    depth: 1,
    trail: [crumb('a', 'A')],
    layerKey: 'a',
    currentLabel: 'A now',
    expanded: false,
    ...overrides,
});

const layer = (key: string, surface: BravaisLayer['surface'] = 'collection'): BravaisLayer => ({
    key,
    sessionKey: key,
    surface,
    mode: 'infinite',
    items: [],
    seam: { title: key, crumb: key, meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
});

afterEach(() => {
    setBravaisPendingOrigin(null);
    useBravaisUiStore.setState({ removalOrigin: null });
});

describe('bravais breadcrumbs', () => {
    it('a root collection: the root jumps to depth 0, the current layer is plain text', () => {
        expect(buildBravaisCrumbs(input({}))).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'current', label: 'A now', closesPanel: false },
        ]);
    });

    it('one middle layer stays visible and jumps to its position', () => {
        expect(buildBravaisCrumbs(input({ depth: 2, trail: [crumb('a', 'A'), crumb('b', 'B')], layerKey: 'b', currentLabel: 'B' }))).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'layer', label: 'A', depth: 1 },
            { kind: 'current', label: 'B', closesPanel: false },
        ]);
    });

    it('folds all but the nearest middle layer, and the expanded trail lists every position (duplicates included)', () => {
        const trail = [crumb('a', 'A'), crumb('b', 'B'), crumb('a', 'A'), crumb('c', 'C')];
        const folded = buildBravaisCrumbs(input({ depth: 4, trail, layerKey: 'c', currentLabel: 'C' }));
        expect(folded).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'more', hidden: [{ label: 'A', depth: 1 }, { label: 'B', depth: 2 }] },
            { kind: 'layer', label: 'A', depth: 3 },
            { kind: 'current', label: 'C', closesPanel: false },
        ]);
        const expanded = buildBravaisCrumbs(input({ depth: 4, trail, layerKey: 'c', currentLabel: 'C', expanded: true }));
        expect(expanded.filter(item => item.kind === 'layer')).toEqual([
            { kind: 'layer', label: 'A', depth: 1 },
            { kind: 'layer', label: 'B', depth: 2 },
            { kind: 'layer', label: 'A', depth: 3 },
        ]);
        expect(expanded.some(item => item.kind === 'more')).toBe(false);
    });

    it('with a panel open the current layer closes it and the panel is the last crumb', () => {
        const crumbs = buildBravaisCrumbs(input({ depth: 2, trail: [crumb('a'), crumb('b')], layerKey: 'b', currentLabel: 'B', panelLabel: 'List' }));
        expect(crumbs.slice(-2)).toEqual([
            { kind: 'current', label: 'B', closesPanel: true },
            { kind: 'panel', label: 'List' },
        ]);
    });

    it('falls back to a plain ellipsis when the trail does not describe the drawn layer (mid seam flip, no trail)', () => {
        const stale = buildBravaisCrumbs(input({ depth: 3, trail: [crumb('a'), crumb('b'), crumb('c')], layerKey: 'b', currentLabel: 'B' }));
        expect(stale).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'more', hidden: [] },
            { kind: 'current', label: 'B', closesPanel: false },
        ]);
        expect(buildBravaisCrumbs(input({ depth: 1, trail: undefined }))).toHaveLength(2);
    });
});

describe('bravais shift kinds', () => {
    it('push / back / replace by depth when the collection was opened from the home', () => {
        expect(resolveShiftKind({ fromDepth: 0, toDepth: 1, fromOrigin: null, toOrigin: 'home' })).toBe('push');
        expect(resolveShiftKind({ fromDepth: 2, toDepth: 1, fromOrigin: 'home', toOrigin: 'home' })).toBe('back');
        expect(resolveShiftKind({ fromDepth: 1, toDepth: 0, fromOrigin: 'home', toOrigin: null })).toBe('back');
        expect(resolveShiftKind({ fromDepth: 0, toDepth: 0, fromOrigin: null, toOrigin: null })).toBe('replace');
    });

    it('enters and exits the whole wall when the source is the search page or the player', () => {
        for (const origin of ['search', 'player'] as const) {
            expect(isSourceOrigin(origin)).toBe(true);
            expect(resolveShiftKind({ fromDepth: 0, toDepth: 1, fromOrigin: null, toOrigin: origin })).toBe('enter');
            expect(resolveShiftKind({ fromDepth: 1, toDepth: 0, fromOrigin: origin, toOrigin: null })).toBe('exit');
            expect(resolveShiftKind({ fromDepth: 3, toDepth: 0, fromOrigin: origin, toOrigin: null })).toBe('exit');
            // 在来源打开的栈里往深处走、往回退一层，仍是普通的 push / back。
            expect(resolveShiftKind({ fromDepth: 1, toDepth: 2, fromOrigin: origin, toOrigin: origin })).toBe('push');
            expect(resolveShiftKind({ fromDepth: 2, toDepth: 1, fromOrigin: origin, toOrigin: origin })).toBe('back');
        }
        expect(isSourceOrigin('home')).toBe(false);
        expect(isSourceOrigin(null)).toBe(false);
    });

    it('a same-key layer counts as a shift only when it is the top of the navigation', () => {
        const trail = [crumb('a'), crumb('b'), crumb('a')];
        expect(layerMatchesNavigation(layer('a'), { depth: 1, trail: trail.slice(0, 1) })).toBe(true);
        expect(layerMatchesNavigation(layer('a'), { depth: 3, trail })).toBe(true);
        // 换层交接的那一拍：store 里还是上一层（b），导航已经到了第 3 层（a）。
        expect(layerMatchesNavigation(layer('b'), { depth: 3, trail })).toBe(false);
        expect(layerMatchesNavigation(layer('home:playlist', 'home'), { depth: 0, trail: [] })).toBe(true);
        // 探针没有首页层：深度 0 时 store 还是集合层，不算。
        expect(layerMatchesNavigation(layer('a'), { depth: 0, trail: [] })).toBe(false);
        expect(layerMatchesNavigation(layer('a'), { depth: 1 })).toBe(false);
    });
});

describe('bravais reduced transitions', () => {
    const state = (surfaces: { lattice?: boolean; collectionMorph?: boolean }, followSystem = false, system = false) => ({
        reducedMotionSurfaces: {
            lattice: false,
            transitionOverlay: false,
            collectionMorph: false,
            monetBackground: false,
            uiMicroMotion: false,
            settingsScroll: false,
            ...surfaces,
        },
        followSystemReducedMotion: followSystem,
        systemPrefersReducedMotion: system,
    });

    it('fades when either the queue wall or the collection transition is reduced', () => {
        expect(resolveBravaisReducedTransitions(state({}))).toBe(false);
        expect(resolveBravaisReducedTransitions(state({ lattice: true }))).toBe(true);
        expect(resolveBravaisReducedTransitions(state({ collectionMorph: true }))).toBe(true);
        expect(resolveBravaisReducedTransitions(state({}, true, true))).toBe(true);
        expect(resolveBravaisReducedTransitions(state({}, false, true))).toBe(false);
    });
});

describe('bravais transitions', () => {
    it('declares beforePush and reset only (no beforeBack, Overlay or backdrop)', () => {
        expect(Object.keys(bravais.transitions ?? {}).sort()).toEqual(['beforePush', 'reset']);
    });

    it('reset through the manifest drops the pending origin and the removal origin', () => {
        setBravaisPendingOrigin({ fromLayerKey: 'a', slotKey: '0,0,0' });
        useBravaisUiStore.setState({ removalOrigin: { layerKey: 'a', slotKey: '0,0,1' } });
        bravais.transitions!.reset!();
        expect(useBravaisStageStore.getState().pendingOrigin).toBeNull();
        expect(useBravaisUiStore.getState().removalOrigin).toBeNull();
        resetBravaisTransitions();
        expect(useBravaisStageStore.getState().pendingOrigin).toBeNull();
    });

    it('beforePush keeps an origin the tile click already recorded on this layer, otherwise uses the keyboard focus', () => {
        setBravaisPendingOrigin({ fromLayerKey: 'a', slotKey: 'clicked' });
        recordPushOrigin('a', 'focused');
        expect(useBravaisStageStore.getState().pendingOrigin).toEqual({ fromLayerKey: 'a', slotKey: 'clicked' });

        setBravaisPendingOrigin({ fromLayerKey: 'other', slotKey: 'stale' });
        recordPushOrigin('a', 'focused');
        expect(useBravaisStageStore.getState().pendingOrigin).toEqual({ fromLayerKey: 'a', slotKey: 'focused' });

        setBravaisPendingOrigin({ fromLayerKey: 'other', slotKey: 'stale' });
        recordPushOrigin('a', null);
        expect(useBravaisStageStore.getState().pendingOrigin).toBeNull();

        recordPushOrigin(null, 'focused');
        expect(useBravaisStageStore.getState().pendingOrigin).toBeNull();
    });
});
