import { describe, expect, it } from 'vitest';
import type { LibraryDirectoryNode } from '@/library/core/directory/directory.contract';
import type { LibraryHomeCard } from '@/library/core/home/homeModel.contract';
import { getWallSlot } from '@/components/wall/wallSlots';
import {
    createHomeItemCache,
    cycleHomeSeamTab,
    cycleHomeTab,
    projectDirectoryRows,
    projectHomeSeamTabs,
    projectHomeShortcuts,
    projectHomeWallItems,
    resolveHomeWallMode,
    resolveSelectAllState,
    toHomeEntry,
} from '@/library/suites/bravais/bravaisHomeProjection';
import { resolveBravaisHomeKey } from '@/library/suites/bravais/bravaisHomeKeys';
import { resolveSeamTarget } from '@/library/suites/bravais/bravaisSeamTarget';
import { resolveEscapeStep, type BravaisKeyInput } from '@/library/suites/bravais/bravaisKeyboardModel';
import {
    planWallWave,
    WALL_WAVE_EXIT_TOTAL_MS,
    WALL_WAVE_IN_MS,
    WALL_WAVE_MAX_DELAY_MS,
    WALL_WAVE_OUT_MS,
} from '@/library/suites/bravais/bravaisWallWave';

// test/unit/library/bravais/bravaisHomeModels.test.ts
// B9 首页的纯规则：墙的模式与过滤身份（本地四行切换、管理隐藏、批量模式都整面翻；只有批量与「只看隐藏」退化为有限
// 拼贴）、磁贴的标记（眼睛、已隐藏、选中 / 未选中、FM 直接播放）与投影缓存、目录树的三态与「仅本层」、全选框、
// F6 切页签、首页的批量按键与 Esc 阶梯的视图一级、换页签的整墙出场 / 入场计划；特殊集合的标记与缝里的直达入口。

const metrics = { cellSize: 128, gap: 8 };
const labels = { kindLabel: (kind: string) => `[${kind}]`, trackCount: (count: number) => `${count} tracks` };
const card = (id: string, type?: string, extra: Partial<LibraryHomeCard> = {}): LibraryHomeCard => ({ id, name: `Card ${id}`, type, ...extra });

describe('resolveHomeWallMode', () => {
    it('keeps browse and manage infinite and falls back to a finite collage for batch and hidden-only', () => {
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'browse', batch: false, query: '' }))
            .toEqual({ mode: 'infinite', filterKey: 'playlist' });
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'manage', batch: false, query: '' }))
            .toEqual({ mode: 'infinite', filterKey: 'playlist|manage' });
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'manage-hidden-only', batch: false, query: '' }))
            .toEqual({ mode: 'finite', filterKey: 'playlist|hidden-only' });
        expect(resolveHomeWallMode({ section: 'folders', visibilityMode: 'browse', batch: true, query: ' alpha ' }))
            .toEqual({ mode: 'finite', filterKey: 'folders|batch|alpha' });
    });

    it('filters any tab into a finite collage keyed by the words, in browse and manage alike', () => {
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'browse', batch: false, query: ' jazz ' }))
            .toEqual({ mode: 'finite', filterKey: 'playlist|browse|filter|jazz' });
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'manage', batch: false, query: 'jazz' }))
            .toEqual({ mode: 'finite', filterKey: 'playlist|manage|filter|jazz' });
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'manage-hidden-only', batch: false, query: 'jazz' }))
            .toEqual({ mode: 'finite', filterKey: 'playlist|hidden-only|jazz' });
        expect(resolveHomeWallMode({ section: 'playlist', visibilityMode: 'browse', batch: false, query: '   ' }))
            .toEqual({ mode: 'infinite', filterKey: 'playlist' });
    });

    it('changes the filter identity when the local row changes, so the whole wall flips', () => {
        const folders = resolveHomeWallMode({ section: 'folders', visibilityMode: 'browse', batch: false, query: '' });
        const albums = resolveHomeWallMode({ section: 'albums', visibilityMode: 'browse', batch: false, query: '' });
        expect(folders.mode).toBe(albums.mode);
        expect(folders.filterKey).not.toBe(albums.filterKey);
    });
});

describe('projectHomeWallItems', () => {
    const entries = [card('a', 'playlist'), card('b', 'cloud'), card('fm', 'radio'), card('al', 'album')].map(toHomeEntry);
    const hidden = new Set(['a']);
    const isDirect = (target: LibraryHomeCard) => target.id === 'fm';

    it('marks hideable cards and only shows hidden ones as dimmed in the manage view', () => {
        const browse = projectHomeWallItems(entries, { hiddenIds: hidden, visibilityMode: 'browse', selectedIds: null, isDirect, source: 'online' }, labels);
        expect(browse.map(item => [item.key, Boolean(item.hideable), Boolean(item.hidden), Boolean(item.dimmed)])).toEqual([
            ['card:playlist:a', true, false, false],
            ['card:cloud:b', true, false, false],
            ['card:radio:fm', true, false, false],
            ['card:album:al', false, false, false],
        ]);
        expect(browse[2].direct).toBe(true);
        const manage = projectHomeWallItems(entries, { hiddenIds: hidden, visibilityMode: 'manage', selectedIds: null, isDirect, source: 'online' }, labels);
        expect(manage.filter(item => item.dimmed).map(item => item.key)).toEqual(['card:playlist:a']);
        expect(manage[0].hidden).toBe(true);
    });

    it('dims every card that is not selected in batch mode and ticks the selected ones', () => {
        const folders = [card('x', 'folder'), card('y', 'folder')].map(toHomeEntry);
        const items = projectHomeWallItems(folders, { hiddenIds: new Set(), visibilityMode: 'browse', selectedIds: new Set(['y']), isDirect, source: 'local' }, labels);
        expect(items.map(item => [Boolean(item.selected), Boolean(item.dimmed)])).toEqual([[false, true], [true, false]]);
    });

    it('reuses the previous object for a card whose flags did not change', () => {
        const cache = createHomeItemCache();
        const options = { hiddenIds: new Set<string>(), visibilityMode: 'browse' as const, isDirect, source: 'local' as const };
        const folders = [card('x', 'folder'), card('y', 'folder')].map(toHomeEntry);
        const first = projectHomeWallItems(folders, { ...options, selectedIds: new Set<string>() }, labels, cache);
        const second = projectHomeWallItems(folders, { ...options, selectedIds: new Set(['y']) }, labels, cache);
        expect(second[0]).toBe(first[0]);
        expect(second[1]).not.toBe(first[1]);
    });

    it('moves the track count onto the spine for collections, but not for the personal FM stream', () => {
        const cards = [
            card('a', 'playlist', { trackCount: 12, description: 'Curator' }),
            card('daily_recommendations', 'daily_recommendations', { trackCount: 30, description: 'Today' }),
            card('fm', 'radio', { trackCount: 5, description: 'FM' }),
            card('x', 'folder', { trackCount: 3 }),
            card('r', 'artist', { trackCount: 9, description: 'Artists' }),
        ].map(toHomeEntry);
        const items = projectHomeWallItems(cards, { hiddenIds: new Set(), visibilityMode: 'browse', selectedIds: null, isDirect, source: 'online' }, labels);
        expect(items.map(item => [item.trackCountLabel ?? null, item.subtitle])).toEqual([
            ['12 tracks', 'Curator'],
            ['30 tracks', 'Today'],
            [null, '5 tracks · FM'],
            ['3 tracks', ''],
            [null, '9 tracks · Artists'],
        ]);
    });

    it('marks special collections by identity and leaves ordinary cards alone', () => {
        const online = [
            card('liked', 'playlist', { raw: { isLiked: true } }),
            card('plain', 'playlist', { name: 'My Liked Music' }),
            card('personal_fm', 'radio'),
        ].map(toHomeEntry);
        const items = projectHomeWallItems(online, { hiddenIds: new Set(), visibilityMode: 'browse', selectedIds: null, isDirect, source: 'online' }, labels);
        expect(items.map(item => item.special ?? null)).toEqual(['liked', null, 'personal-fm']);
        // 类型标签的文字照旧是种类。
        expect(items.map(item => item.badge)).toEqual(['[playlist]', '[playlist]', '[feed]']);
        const local = [card('folder-__all-songs__', 'folder', { isVirtual: true }), card('folder-x', 'folder')].map(toHomeEntry);
        expect(projectHomeWallItems(local, { hiddenIds: new Set(), visibilityMode: 'browse', selectedIds: null, isDirect, source: 'local' }, labels)
            .map(item => item.special ?? null)).toEqual(['all-songs', null]);
    });
});

describe('projectHomeShortcuts', () => {
    const isDirect = (target: LibraryHomeCard) => target.id === 'personal_fm';

    it('lists the special collections that exist, one per kind, in the fixed order', () => {
        const cards = [
            card('daily_recommendations', 'daily_recommendations', { name: 'Daily' }),
            card('rec', 'playlist'),
            card('personal_fm', 'radio', { name: 'FM' }),
            card('liked', 'playlist', { name: 'Liked', raw: { isLiked: true } }),
            card('liked-2', 'playlist', { raw: { isLiked: true } }),
        ];
        const shortcuts = projectHomeShortcuts(cards, { source: 'online', hiddenIds: new Set(), isDirect });
        expect(shortcuts.map(entry => [entry.special, entry.label, entry.itemKey, entry.direct])).toEqual([
            ['liked', 'Liked', 'card:playlist:liked', false],
            ['personal-fm', 'FM', 'card:radio:personal_fm', true],
            ['daily', 'Daily', 'card:daily_recommendations:daily_recommendations', false],
        ]);
        expect(projectHomeShortcuts([card('rec', 'playlist'), card('al', 'album')], { source: 'online', hiddenIds: new Set(), isDirect })).toEqual([]);
    });

    it('leaves out hidden ones and reads the identity per source', () => {
        const cards = [card('liked', 'playlist', { raw: { isLiked: true } }), card('cloud', 'cloud')];
        expect(projectHomeShortcuts(cards, { source: 'online', hiddenIds: new Set(['liked']), isDirect }).map(entry => entry.special)).toEqual(['cloud']);
        const navidrome = [card('__navi_random__', 'playlist', { isVirtual: true }), card('__navi_favorites__', 'playlist', { isVirtual: true })];
        expect(projectHomeShortcuts(navidrome, { source: 'navidrome', hiddenIds: new Set(), isDirect }).map(entry => entry.special))
            .toEqual(['navidrome-random', 'navidrome-favorites']);
        // 同样的卡在本地来源里只算一张「我喜欢」（每种一个）。
        expect(projectHomeShortcuts(navidrome, { source: 'local', hiddenIds: new Set(), isDirect }).map(entry => entry.special))
            .toEqual(['local-favorites']);
    });
});

describe('projectDirectoryRows', () => {
    const node = (path: string, depth: number, children: LibraryDirectoryNode[] = [], extra: Partial<LibraryDirectoryNode> = {}): LibraryDirectoryNode => ({
        id: path, name: path.split('/').at(-1)!, path, rootPath: path.split('/')[0], depth,
        directTrackCount: 2, totalTrackCount: 2, children, ...extra,
    });
    const trees = [node('Music', 0, [node('Music/Alpha', 1, [node('Music/Alpha/Live', 2)]), node('Music/Beta', 1)], { directTrackCount: 0, totalTrackCount: 6 })];
    const folder = (path: string) => ({ ...toHomeEntry(card(`f:${path}`, 'folder', { name: path })), path });
    const displayItems = [toHomeEntry(card('all', 'folder', { isVirtual: true, name: 'All Songs' })), folder('Music/Alpha'), folder('Music/Alpha/Live'), folder('Music/Beta')];
    const rowLabels = {
        ignored: 'ignored',
        direct: (count: number) => `direct ${count}`,
        selection: (selected: number, total: number) => `${selected}/${total}`,
        tracks: (count: number) => `${count} tracks`,
    };
    const project = (selected: string[], collapsed: string[] = []) => projectDirectoryRows({
        displayItems,
        trees,
        query: '',
        collapsedIds: new Set(collapsed),
        selectedIds: new Set(selected),
        labels: rowLabels,
    });

    it('puts the virtual All Songs first and counts tri-state selection over the subtree', () => {
        const { rows } = project(['f:Music/Alpha/Live']);
        expect(rows.map(row => [row.key, row.depth, row.selection])).toEqual([
            ['item:all', 0, 'none'],
            ['node:Music', 0, 'partial'],
            ['item:f:Music/Alpha', 1, 'partial'],
            ['item:f:Music/Alpha/Live', 2, 'all'],
            ['item:f:Music/Beta', 1, 'none'],
        ]);
        expect(rows[1]).toMatchObject({ rootPath: 'Music', detail: '1/3' });
        expect(rows[3].detail).toBe('1/1');
    });

    it('cycles a folder with subfolders through the whole subtree, nothing and its own tracks only', () => {
        const none = project([]);
        expect(none.targets.get('item:f:Music/Alpha')).toEqual({ ids: ['f:Music/Alpha'], selected: true });
        const direct = project(['f:Music/Alpha']);
        expect(direct.rows.find(row => row.key === 'item:f:Music/Alpha')).toMatchObject({ selection: 'direct', detail: 'direct 2' });
        expect(direct.targets.get('item:f:Music/Alpha')).toEqual({ ids: ['f:Music/Alpha', 'f:Music/Alpha/Live'], selected: true });
        const all = project(['f:Music/Alpha', 'f:Music/Alpha/Live']);
        expect(all.targets.get('item:f:Music/Alpha')).toEqual({ ids: ['f:Music/Alpha', 'f:Music/Alpha/Live'], selected: false });
        expect(all.targets.get('item:all')).toEqual({ ids: ['all'], selected: true });
    });

    it('folds collapsed nodes and lists flat sections without a tree', () => {
        expect(project([], ['Music']).rows.map(row => row.key)).toEqual(['item:all', 'node:Music']);
        const flat = projectDirectoryRows({
            displayItems: [toHomeEntry(card('al1', 'album', { trackCount: 3 }))],
            query: '',
            collapsedIds: new Set(),
            selectedIds: new Set(['al1']),
            labels: rowLabels,
        });
        expect(flat.rows).toEqual([expect.objectContaining({ key: 'item:al1', selection: 'all', detail: '3 tracks', expandable: false })]);
        expect(flat.targets.get('item:al1')).toEqual({ ids: ['al1'], selected: false });
    });

    it('offers restore on ignored folders and no root actions on them', () => {
        const ignoredTrees = [node('Old', 0, [], { ignored: true })];
        const { rows } = projectDirectoryRows({ displayItems: [], trees: ignoredTrees, query: '', collapsedIds: new Set(), selectedIds: new Set(), labels: rowLabels });
        expect(rows).toEqual([expect.objectContaining({ key: 'node:Old', ignored: true, ignoredPath: 'Old', detail: 'ignored', selectable: false })]);
        expect(rows[0].rootPath).toBeUndefined();
    });
});

describe('select-all and tabs', () => {
    it('reads the select-all box from the selected and shown counts', () => {
        expect(resolveSelectAllState(0, 5)).toBe('none');
        expect(resolveSelectAllState(2, 5)).toBe('partial');
        expect(resolveSelectAllState(5, 5)).toBe('all');
    });

    it('cycles to the next available tab and wraps, skipping disabled ones', () => {
        const tabs = [{ key: 'playlist' }, { key: 'radio', disabledReason: 'no' }, { key: 'albums' }, { key: 'local' }] as const;
        expect(cycleHomeTab(tabs, 'playlist', 1)).toBe('albums');
        expect(cycleHomeTab(tabs, 'playlist', -1)).toBe('local');
        expect(cycleHomeTab(tabs, 'local', 1)).toBe('playlist');
        expect(cycleHomeTab([{ key: 'playlist' }, { key: 'radio', disabledReason: 'no' }], 'playlist', 1)).toBeNull();
    });

    it('starts from the ends when the current tab is hidden (not in the list)', () => {
        const tabs = [{ key: 'radio' }, { key: 'albums' }, { key: 'local' }] as const;
        expect(cycleHomeTab(tabs, 'playlist', -1)).toBe('local');
        expect(cycleHomeTab(tabs, 'playlist', 1)).toBe('radio');
    });

    // 宿主交来的扩展页签（模组的首页页面）：排在原生页签后面，选中态以宿主为准，F6 也把它们排进来（与网格的 Tab 一致）。
    const nativeTabs = [
        { key: 'playlist', label: 'Playlists' },
        { key: 'radio', label: 'Radio', disabledReason: 'no' },
        { key: 'local', label: 'Local' },
    ] as const;
    const extra = (id: string, active = false) => ({ id, label: id.toUpperCase(), active });

    it('projects contributed pages after native tabs and lets an open page take the selection', () => {
        expect(projectHomeSeamTabs(nativeTabs, 'local')).toEqual([
            { key: 'playlist', label: 'Playlists', active: false, disabled: false },
            { key: 'radio', label: 'Radio', active: false, disabled: true },
            { key: 'local', label: 'Local', active: true, disabled: false },
        ]);
        const closed = projectHomeSeamTabs(nativeTabs, 'local', [extra('mod:a'), extra('mod:b')]);
        expect(closed.filter(tab => tab.active).map(tab => tab.key)).toEqual(['local']);
        expect(closed.slice(3)).toEqual([
            { key: 'mod:a', label: 'MOD:A', active: false, disabled: false },
            { key: 'mod:b', label: 'MOD:B', active: false, disabled: false },
        ]);
        const open = projectHomeSeamTabs(nativeTabs, 'local', [extra('mod:a'), extra('mod:b', true)]);
        expect(open.filter(tab => tab.active).map(tab => tab.key)).toEqual(['mod:b']);
    });

    it('cycles F6 through native tabs and contributed pages, starting from the open page', () => {
        const extras = [extra('mod:a'), extra('mod:b')];
        expect(cycleHomeSeamTab(nativeTabs, 'local', extras, 1)).toBe('mod:a');
        expect(cycleHomeSeamTab(nativeTabs, 'playlist', extras, -1)).toBe('mod:b');
        expect(cycleHomeSeamTab(nativeTabs, 'playlist', extras, 1)).toBe('local');
        // 页面开着时从它算起，而不是从底下的原生页签。
        const open = [extra('mod:a', true), extra('mod:b')];
        expect(cycleHomeSeamTab(nativeTabs, 'playlist', open, 1)).toBe('mod:b');
        expect(cycleHomeSeamTab(nativeTabs, 'playlist', open, -1)).toBe('local');
        expect(cycleHomeSeamTab(nativeTabs, 'playlist', [extra('mod:a', false), extra('mod:b', true)], 1)).toBe('playlist');
        // 没有扩展页签时与 cycleHomeTab 相同。
        expect(cycleHomeSeamTab(nativeTabs, 'local', [], 1)).toBe('playlist');
        expect(cycleHomeSeamTab([{ key: 'playlist' }], 'playlist', [], 1)).toBeNull();
    });
});

describe('home keys', () => {
    const key = (input: Partial<BravaisKeyInput> & { key: string }): BravaisKeyInput => ({
        shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...input,
    });

    it('maps F6 and the TUI directory keys, and ignores key repeat', () => {
        expect(resolveBravaisHomeKey(key({ key: 'F6' }))).toEqual({ type: 'cycle-tab', delta: 1 });
        expect(resolveBravaisHomeKey(key({ key: 'F6', shiftKey: true }))).toEqual({ type: 'cycle-tab', delta: -1 });
        expect(resolveBravaisHomeKey(key({ key: 'Insert' }))).toEqual({ type: 'batch-toggle' });
        expect(resolveBravaisHomeKey(key({ key: 'a', ctrlKey: true }))).toEqual({ type: 'batch-select-all' });
        expect(resolveBravaisHomeKey(key({ key: 'A', metaKey: true }))).toEqual({ type: 'batch-select-all' });
        expect(resolveBravaisHomeKey(key({ key: 'Enter', ctrlKey: true }))).toEqual({ type: 'batch-play', enqueue: false });
        expect(resolveBravaisHomeKey(key({ key: 'Enter', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'batch-play', enqueue: true });
        expect(resolveBravaisHomeKey(key({ key: 'Delete' }))).toEqual({ type: 'batch-remove' });
        expect(resolveBravaisHomeKey(key({ key: 'Delete', repeat: true }))).toBeNull();
        expect(resolveBravaisHomeKey(key({ key: 'a' }))).toBeNull();
        expect(resolveBravaisHomeKey(key({ key: 'Insert', altKey: true }))).toBeNull();
    });

    it('leaves the hidden view after the panel and before the query on the Escape ladder', () => {
        const base = { hasFocusCard: false, hasKeyboardFocus: false, canGoBack: false };
        expect(resolveEscapeStep({ ...base, hasViewMode: true, hasQuery: true })).toBe('view');
        expect(resolveEscapeStep({ ...base, hasPanel: true, hasViewMode: true })).toBe('panel');
        expect(resolveEscapeStep({ ...base, hasKeyboardFocus: true, hasViewMode: true })).toBe('keyboard-focus');
    });
});

describe('planWallWave', () => {
    const slots = [getWallSlot(0, 0, 0, metrics), getWallSlot(0, 0, 5, metrics), getWallSlot(3, 2, 0, metrics), getWallSlot(9, 9, 0, metrics)]
        .map(slot => slot!);
    const viewport = { left: 0, top: 0, right: 9000, bottom: 4000 };

    it('lifts the far tiles first and lands the near ones first, after the whole wall has left', () => {
        const plan = planWallWave({
            changes: slots.map(slot => ({ slot, from: 'a', to: 'b' })),
            viewport,
            visible: viewport,
            metrics,
        });
        expect(plan.swaps.map(swap => swap.key)).toEqual([slots[3].key]);
        const [corner, ...rest] = plan.steps;
        expect(corner.key).toBe(slots[0].key);
        expect(corner.outDelay).toBe(WALL_WAVE_MAX_DELAY_MS);
        expect(corner.inDelay).toBe(WALL_WAVE_EXIT_TOTAL_MS);
        for (const step of rest) {
            expect(step.outDelay).toBeLessThan(corner.outDelay);
            expect(step.inDelay).toBeGreaterThan(corner.inDelay);
        }
        for (const step of plan.steps) expect(step.inDelay).toBeGreaterThanOrEqual(step.outDelay + WALL_WAVE_OUT_MS);
        expect(plan.durationMs).toBe(Math.max(...plan.steps.map(step => step.inDelay)) + WALL_WAVE_IN_MS);
    });

    it('leaves unchanged slots alone and keeps the tiles nearest the corner within the budget', () => {
        const plan = planWallWave({
            changes: [{ slot: slots[0], from: null, to: null }, ...slots.slice(1, 3).map(slot => ({ slot, from: 'a', to: 'b' }))],
            viewport,
            visible: viewport,
            metrics,
            maxTiles: 1,
        });
        expect(plan.steps.map(step => step.key)).toEqual([slots[1].key]);
        expect(plan.swaps.map(swap => swap.key)).toEqual([slots[2].key]);
        expect(planWallWave({ changes: [], viewport, visible: viewport, metrics }).durationMs).toBe(0);
    });
});

describe('home seam target', () => {
    it('widens the narrow home seam into the search box, folded excepted, and opens the directory panel', () => {
        const base = { surface: 'home' as const, level: 'full' as const, viewportWidth: 1440 };
        expect(resolveSeamTarget(base)).toEqual({ width: 120, variant: 'home' });
        expect(resolveSeamTarget({ ...base, searchOpen: true })).toEqual({ width: 300, variant: 'search' });
        expect(resolveSeamTarget({ ...base, level: 'spine', searchOpen: true })).toEqual({ width: 300, variant: 'search' });
        expect(resolveSeamTarget({ ...base, level: 'hidden', searchOpen: true })).toEqual({ width: 0, variant: 'none' });
        expect(resolveSeamTarget({ ...base, panelOpen: true, searchOpen: true })).toEqual({ width: 420, variant: 'panel' });
        expect(resolveSeamTarget({ ...base, surface: 'collection', searchOpen: true })).toEqual({ width: 300, variant: 'full' });
    });

    it('opens the search box with a slash', () => {
        expect(resolveBravaisHomeKey({ key: '/', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false }))
            .toEqual({ type: 'open-search' });
        expect(resolveBravaisHomeKey({ key: '/', shiftKey: false, altKey: false, ctrlKey: true, metaKey: false, repeat: false })).toBeNull();
    });
});
