import { describe, expect, it } from 'vitest';
import { collectWallSlots, getWallSlot } from '@/components/wall/wallSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { createBravaisDisplay, diffDisplays, resolveSlotItem, type BravaisDisplay } from '@/library/suites/bravais/bravaisDisplay';
import { canReuseFinitePlan, planBravaisFinite, rubberBand } from '@/library/suites/bravais/bravaisFiniteWall';
import { findDisplayItemSlot, findInfiniteItemSlot } from '@/library/suites/bravais/bravaisItemSlots';
import { detectRemovedEntries, maskRemovedEntries } from '@/library/suites/bravais/bravaisRemoval';
import { reduceBravaisForm, type BravaisFormState } from '@/library/suites/bravais/bravaisFormModel';
import {
    describeMutationResult,
    projectCollectionStatus,
    resolveWallPeriodCount,
    type CollectionStatusInput,
} from '@/library/suites/bravais/bravaisCollectionStatus';
import { resolvePanelWidth, resolveSeamTarget } from '@/library/suites/bravais/bravaisSeamTarget';
import { decideDataUpdate } from '@/library/suites/bravais/bravaisDisplayUpdate';
import { resolveBravaisKey } from '@/library/suites/bravais/bravaisKeyboardModel';

// test/unit/library/bravais/bravaisCollectionModels.test.ts
// B7 集合页的纯规则：双模式（有限拼贴的严格 rank、清空后翻回无限拼贴且起点偏移保留）、补页期间的循环周期（新页只让
// 新 slot 翻牌）、反查某一项在墙上的 slot、remove-entry 的两段翻牌（先翻成墙面、再 rank 前移）、表单态状态机、
// 状态投影（错误与空分开）与缝的开口目标（表单 > 面板 > 过滤临时展开 > 等级）。

const metrics = { cellSize: 128, gap: 8 };
const view = { width: 1140, height: 1100, scale: 0.76 };
const items = (prefix: string, count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `${prefix}${index}`,
    kind: 'track',
    title: `${prefix}${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer = (entries: BravaisItem[], wall?: BravaisLayer['wall']): BravaisLayer => ({
    key: 'c',
    sessionKey: 'c',
    surface: 'collection',
    mode: 'infinite',
    items: entries,
    seam: { title: 'c', crumb: 'c', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
    wall,
});
const around = (center: { x: number; y: number }, radius = 1600) => collectWallSlots(
    { left: center.x - radius, right: center.x + radius, top: center.y - radius, bottom: center.y + radius },
    metrics,
);
const shownKeys = (display: BravaisDisplay, slots = around({ x: 0, y: 0 })) => slots.map(slot => resolveSlotItem(display, slot)?.key ?? null);

describe('dual mode: finite (filtering) and infinite', () => {
    const all = items('t', 60);
    const anchorX = 0;
    const center = { x: 0, y: 0 };
    const finite = planBravaisFinite({ count: all.length, anchorX, center, view });

    it('puts rank i on the i-th slot, never repeats, and leaves the rest as bare wall', () => {
        const matches = all.filter((_, index) => index % 7 === 0);
        const display = { ...createBravaisDisplay(layer(matches), null), finite };
        matches.forEach((item, rank) => expect(resolveSlotItem(display, finite.order[rank])?.key).toBe(item.key));
        expect(resolveSlotItem(display, finite.order[matches.length])).toBeNull();
        const shown = shownKeys(display).filter(Boolean);
        expect(new Set(shown).size).toBe(shown.length);
    });

    it('narrowing keeps the plan: only the count of ranks with content changes', () => {
        expect(canReuseFinitePlan(finite, { anchorX, count: all.length })).toBe(true);
        expect(canReuseFinitePlan(finite, { anchorX: anchorX + 1000, count: all.length })).toBe(false);
        expect(canReuseFinitePlan(finite, { anchorX, count: finite.capacity + 1 })).toBe(false);
        expect(canReuseFinitePlan(null, { anchorX, count: 1 })).toBe(false);
    });

    it('turns back into the infinite wall with the start tile still showing item 1', () => {
        const start = getWallSlot(1, 0, 4, metrics)!;
        const infinite = createBravaisDisplay(layer(all), start.key);
        const filtered = { ...createBravaisDisplay(layer(all.slice(0, 3)), start.key), finite };
        const back = createBravaisDisplay(layer(all), filtered.startSlotKey);
        expect(resolveSlotItem(back, start)?.key).toBe('t0');
        expect(shownKeys(back)).toEqual(shownKeys(infinite));
        // 进出有限态：屏内内容变了的 slot 都翻（从缝开始错开由 planFlip 决定）。
        expect(diffDisplays(infinite, filtered, around(center)).filter(change => change.from !== change.to).length).toBeGreaterThan(0);
    });

    it('resists a drag past the range edge without accumulating', () => {
        expect(rubberBand(50, 0, 100)).toBe(50);
        expect(rubberBand(120, 0, 100)).toBeCloseTo(107);
        expect(rubberBand(-20, 0, 100)).toBeCloseTo(-7);
    });
});

describe('background paging keeps the infinite period', () => {
    const start = getWallSlot(0, 0, 0, metrics)!;
    const slots = around({ x: 0, y: 0 });

    it('fills only the slots that were bare wall when a page arrives', () => {
        const before = createBravaisDisplay(layer(items('t', 150), { periodCount: 400 }), start.key);
        const after = createBravaisDisplay(layer(items('t', 300), { periodCount: 400 }), start.key);
        const changes = diffDisplays(before, after, slots).filter(change => change.from !== change.to);
        expect(changes.length).toBeGreaterThan(0);
        expect(changes.every(change => change.from === null)).toBe(true);
        expect(resolveSlotItem(after, start)?.key).toBe('t0');
    });

    it('without the period every page reshuffles the wall (the B6 behaviour)', () => {
        const before = createBravaisDisplay(layer(items('t', 150)), start.key);
        const after = createBravaisDisplay(layer(items('t', 300)), start.key);
        const changes = diffDisplays(before, after, slots).filter(change => change.from !== change.to);
        expect(changes.some(change => change.from !== null)).toBe(true);
    });

    it('uses the upstream total only while syncing or interrupted', () => {
        expect(resolveWallPeriodCount({ itemCount: 150, totalCount: 400, sync: { status: 'syncing' } })).toBe(400);
        expect(resolveWallPeriodCount({ itemCount: 150, totalCount: 400, sync: { status: 'interrupted', message: '', offset: 150 } })).toBe(400);
        expect(resolveWallPeriodCount({ itemCount: 398, totalCount: 400, sync: { status: 'none' } })).toBe(398);
        expect(resolveWallPeriodCount({ itemCount: 20, totalCount: undefined, sync: { status: 'syncing' } })).toBe(20);
        expect(resolveWallPeriodCount({ itemCount: 20, totalCount: 10, sync: { status: 'syncing' } })).toBe(20);
    });
});

describe('finding an item on the wall', () => {
    it('round-trips every item of an infinite wall to a slot that shows it, near the given point', () => {
        for (const count of [5, 12, 37, 400]) {
            const start = getWallSlot(3, -2, 7, metrics)!;
            const display = createBravaisDisplay(layer(items('t', count)), start.key);
            const near = { x: 2000, y: -900 };
            for (const index of [0, 1, Math.floor(count / 2), count - 1]) {
                const slot = findInfiniteItemSlot({ index, periodCount: count, wrapOffset: display.wrapOffset, near });
                expect(slot).not.toBeNull();
                expect(resolveSlotItem(display, slot!)?.key).toBe(`t${index}`);
            }
        }
    });

    it('picks the copy nearest to the point', () => {
        const display = createBravaisDisplay(layer(items('t', 12)), null);
        const near = { x: 9000, y: 4000 };
        const slot = findDisplayItemSlot(display, 't3', near)!;
        const farther = around(near, 2400).filter(candidate => resolveSlotItem(display, candidate)?.key === 't3');
        const distance = (candidate: { centerX: number; centerY: number }) => Math.hypot(candidate.centerX - near.x, candidate.centerY - near.y);
        expect(Math.min(...farther.map(distance))).toBeCloseTo(distance(slot));
    });

    it('uses the rank slot on a finite wall, and nothing for a hidden or missing item', () => {
        const finite = planBravaisFinite({ count: 20, anchorX: 0, center: { x: 0, y: 0 }, view });
        const display = { ...createBravaisDisplay(layer(items('t', 5)), null), finite };
        expect(findDisplayItemSlot(display, 't4', { x: 0, y: 0 })?.key).toBe(finite.order[4].key);
        expect(findDisplayItemSlot(display, 'missing', { x: 0, y: 0 })).toBeNull();
        expect(findDisplayItemSlot(maskRemovedEntries(display, new Set(['t4'])), 't4', { x: 0, y: 0 })).toBeNull();
    });
});

describe('remove-entry: wall first, then the ranks move up', () => {
    const before = items('t', 8);

    it('recognises a removal, a duplicate removal and a daily dislike, not a reload', () => {
        expect(detectRemovedEntries(before, before.filter(item => item.key !== 't2'))).toEqual(new Set(['t2']));
        expect(detectRemovedEntries(before, before.filter(item => item.key !== 't2' && item.key !== 't5'))).toEqual(new Set(['t2', 't5']));
        const daily = before.map(item => (item.key === 't0' ? { ...item, key: 'r0' } : item));
        expect(detectRemovedEntries(before, daily)).toEqual(new Set(['t0']));
        expect(detectRemovedEntries(before, before)).toBeNull();
        expect(detectRemovedEntries(before, items('u', 8))).toBeNull();
        expect(detectRemovedEntries(before, [...before.slice(1), ...items('page', 150)])).toBeNull();
        expect(detectRemovedEntries(before, [before[1], before[0], ...before.slice(3)])).toBeNull();
    });

    it('masks the removed slot first, then shifts every later rank forward by one', () => {
        const finite = planBravaisFinite({ count: before.length, anchorX: 0, center: { x: 0, y: 0 }, view });
        const old = { ...createBravaisDisplay(layer(before), null), finite };
        const removed = detectRemovedEntries(before, before.filter(item => item.key !== 't3'))!;
        const phaseOne = maskRemovedEntries(old, removed);
        const slots = finite.order.slice(0, before.length);
        const firstChanges = diffDisplays(old, phaseOne, slots).filter(change => change.from !== change.to);
        expect(firstChanges).toEqual([{ slot: finite.order[3], from: 't3', to: null }]);

        const next = { ...createBravaisDisplay(layer(before.filter(item => item.key !== 't3')), null), finite };
        const secondChanges = diffDisplays(phaseOne, next, slots).filter(change => change.from !== change.to);
        // rank 3 起每个 slot 换成原来的下一项，最后一个 rank 变成墙面；rank 0–2 不动。
        expect(secondChanges.map(change => [finite.order.indexOf(change.slot), change.to])).toEqual([
            [3, 't4'], [4, 't5'], [5, 't6'], [6, 't7'], [7, null],
        ]);
    });
});

describe('form states', () => {
    it('stays on the rename form until the rename goes through', () => {
        let state = reduceBravaisForm(null, { type: 'open-rename', initial: 'Old' });
        expect(state).toEqual({ kind: 'rename', initial: 'Old', error: null });
        state = reduceBravaisForm(state, { type: 'result', result: { ok: false, reason: 'busy' } });
        expect(state).toEqual({ kind: 'rename', initial: 'Old', error: null });
        state = reduceBravaisForm(state, { type: 'result', result: { ok: false, reason: 'failed', message: 'nope' }, errorText: 'Failed' });
        expect(state).toEqual({ kind: 'rename', initial: 'Old', error: 'Failed' });
        expect(reduceBravaisForm(state, { type: 'result', result: { ok: true } })).toBeNull();
    });

    it('undoes a nested create input before the whole picker, and cancels a confirm', () => {
        let state: BravaisFormState | null = reduceBravaisForm(null, { type: 'open-pick', scope: { kind: 'entry', entryKey: 'k' } });
        state = reduceBravaisForm(state, { type: 'start-create' });
        expect(state).toMatchObject({ kind: 'pick-playlist', creating: true });
        state = reduceBravaisForm(state, { type: 'cancel' });
        expect(state).toMatchObject({ kind: 'pick-playlist', creating: false });
        expect(reduceBravaisForm(state, { type: 'cancel' })).toBeNull();
        expect(reduceBravaisForm(reduceBravaisForm(null, { type: 'open-delete' }), { type: 'cancel' })).toBeNull();
        expect(reduceBravaisForm(null, { type: 'start-create' })).toBeNull();
    });

    it('opens the daily style picker, keeps it on a failed save, ignores start-create, and closes on success or cancel (#938)', () => {
        let state: BravaisFormState | null = reduceBravaisForm(null, { type: 'open-daily-style' });
        expect(state).toEqual({ kind: 'pick-daily-style', error: null });
        expect(reduceBravaisForm(state, { type: 'start-create' })).toBe(state);
        state = reduceBravaisForm(state, { type: 'result', result: { ok: false, reason: 'failed' }, errorText: 'Failed' });
        expect(state).toEqual({ kind: 'pick-daily-style', error: 'Failed' });
        expect(reduceBravaisForm(state, { type: 'result', result: { ok: true } })).toBeNull();
        expect(reduceBravaisForm(state, { type: 'cancel' })).toBeNull();
    });
});

describe('status projection', () => {
    const labels = {
        loading: 'loading',
        notPublic: 'not public',
        loadFailed: (message: string) => `failed: ${message}`,
        empty: 'empty',
        noMatch: 'no match',
        retry: 'retry',
        clearFilter: 'clear',
        syncProgress: (counts: { loaded: string; total: string } | null) => (counts ? `${counts.loaded}/${counts.total}` : 'loading'),
        syncInterrupted: (counts: { loaded: string; total: string } | null) => (counts ? `stopped ${counts.loaded}/${counts.total}` : 'stopped'),
        syncFailedHint: (message: string) => `hint: ${message}`,
    };
    const handlers = { reload: () => {}, clearFilter: () => {}, resumeSync: () => {} };
    const base: CollectionStatusInput = {
        status: 'ready', error: null, sync: { status: 'none' }, loadedCount: 0, totalCount: undefined,
        itemCount: 0, matchCount: 0, isFilterActive: false,
    };
    const project = (input: Partial<CollectionStatusInput>) => projectCollectionStatus({ ...base, ...input }, labels, handlers, null);

    it('never mixes an error with an empty collection', () => {
        expect(project({ status: 'error', error: { kind: 'generic', message: 'x' } }).status).toMatchObject({ tone: 'error', text: 'failed: x', action: { id: 'retry' } });
        expect(project({ status: 'error', error: { kind: 'not-public' } }).status).toMatchObject({ tone: 'error', text: 'not public' });
        expect(project({}).status).toEqual({ tone: 'empty', text: 'empty' });
        expect(project({ status: 'error', error: { kind: 'not-public' } }).loading).toBe(false);
    });

    it('breathes while the first page loads, says no match when the filter empties the wall', () => {
        expect(project({ status: 'loading' })).toMatchObject({ loading: true, status: { tone: 'loading' } });
        expect(project({ status: null })).toMatchObject({ loading: true });
        expect(project({ itemCount: 5, isFilterActive: true }).status).toMatchObject({ tone: 'no-match', action: { id: 'clear-filter' } });
        expect(project({ itemCount: 5, matchCount: 2, isFilterActive: true }).status).toBeUndefined();
    });

    it('shows background progress, and an interrupted sync as a resume action', () => {
        expect(project({ itemCount: 150, sync: { status: 'syncing' } }).sync).toEqual({ state: 'syncing', label: 'loading' });
        const counts = { loaded: '150', total: '400' };
        const interrupted = projectCollectionStatus({ ...base, itemCount: 150, sync: { status: 'interrupted', message: 'boom', offset: 150 } }, labels, handlers, counts);
        expect(interrupted.sync).toMatchObject({ state: 'interrupted', label: 'stopped 150/400', title: 'hint: boom' });
        expect(interrupted.sync?.onResume).toBe(handlers.resumeSync);
    });

    it('turns action results into notices, silent on ok and busy', () => {
        const notice = { limitReached: 'limit', dislikeFailed: 'dislike failed', failed: 'failed', stale: 'stale', unsupported: 'no' };
        expect(describeMutationResult({ ok: true }, notice)).toBeNull();
        expect(describeMutationResult({ ok: false, reason: 'busy' }, notice)).toBeNull();
        expect(describeMutationResult({ ok: false, reason: 'limit-reached' }, notice)).toEqual({ text: 'limit', tone: 'info' });
        expect(describeMutationResult({ ok: false, reason: 'failed' }, notice, { isDailyRemoval: true })).toEqual({ text: 'dislike failed', tone: 'error' });
        expect(describeMutationResult({ ok: false, reason: 'failed', message: 'x' }, notice)).toEqual({ text: 'failed · x', tone: 'error' });
    });
});

describe('seam target', () => {
    it('opens a form at full width, a panel at min(420, viewport − 52), and holds full while filtering', () => {
        const base = { surface: 'collection' as const, level: 'spine' as const, viewportWidth: 1440 };
        expect(resolveSeamTarget({ ...base, formOpen: true, panelOpen: true })).toEqual({ width: 300, variant: 'form' });
        expect(resolveSeamTarget({ ...base, panelOpen: true })).toEqual({ width: 420, variant: 'panel' });
        expect(resolveSeamTarget({ ...base, viewportWidth: 400, panelOpen: true })).toEqual({ width: 348, variant: 'panel' });
        expect(resolveSeamTarget({ ...base, level: 'hidden', panelOpen: true })).toEqual({ width: 0, variant: 'none' });
        expect(resolveSeamTarget({ ...base, filterOpen: true })).toEqual({ width: 300, variant: 'full' });
        expect(resolveSeamTarget({ ...base, level: 'hidden', filterOpen: true })).toEqual({ width: 300, variant: 'full' });
        expect(resolveSeamTarget(base)).toEqual({ width: 64, variant: 'spine' });
        // B9：首页的目录树面板与列表面板同一种开口。
        expect(resolveSeamTarget({ ...base, surface: 'home', panelOpen: true, level: 'full' })).toEqual({ width: 420, variant: 'panel' });
        expect(resolvePanelWidth(120)).toBe(160);
    });
});

describe('same-layer data updates', () => {
    const base = layer(items('t', 6));

    it('refreshes without flipping when only the seam or the marks changed', () => {
        const display = createBravaisDisplay(base, null);
        expect(decideDataUpdate(display, { ...base, nowPlayingKey: 't1' })).toEqual({ kind: 'refresh' });
    });

    it('flips from the seam edges when the filter or the mode changes, and spots a removal', () => {
        const display = createBravaisDisplay(base, null);
        expect(decideDataUpdate(display, { ...base, mode: 'finite', items: base.items.slice(0, 2), wall: { filterKey: 'a' } })).toEqual({ kind: 'filter' });
        const filtered = createBravaisDisplay({ ...base, mode: 'finite', wall: { filterKey: 'a' } }, null);
        expect(decideDataUpdate(filtered, { ...base, mode: 'finite', wall: { filterKey: 'ab' } })).toEqual({ kind: 'filter' });
        expect(decideDataUpdate(display, { ...base, items: base.items.filter(item => item.key !== 't2') }))
            .toEqual({ kind: 'removal', removed: new Set(['t2']) });
        expect(decideDataUpdate(display, { ...base, items: items('t', 9) })).toEqual({ kind: 'update' });
    });

    it('reads End as the last item key', () => {
        expect(resolveBravaisKey({ key: 'End', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false })).toEqual({ type: 'last' });
    });
});
