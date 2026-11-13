import { describe, expect, it } from 'vitest';
import { pickQuickCells, planQuickCells, quickPriority, quickSlotsForWidth } from '@/library/suites/bravais/bravaisSeamQuickCells';

// test/unit/library/bravais/bravaisSeamQuickCells.test.ts
// 信息条动作格（方案 C）：固定格之后按优先级从「⋯」里补，「⋯」占一格；删除这类不给优先级的永远在「⋯」里；
// 全都放得下、「⋯」里也不剩别的时不画「⋯」。格数按宽度量。

const item = (id: string) => ({ id, priority: quickPriority(id) });

describe('planQuickCells', () => {
    const playlist = ['rename', 'add-to-playlist', 'collect-scratchpad', 'export-playlist', 'set-cover', 'delete-collection'].map(item);

    it('fills the free cells by priority and keeps the rest in the menu, in their menu order', () => {
        // 竖条 6 格：星标、列表两个固定格，「⋯」一格，剩三格给加入歌单、速记簿、改名。
        const plan = planQuickCells(playlist, 6, 2, true);
        expect(plan.promoted.map(entry => entry.id)).toEqual(['add-to-playlist', 'collect-scratchpad', 'rename']);
        expect(plan.rest.map(entry => entry.id)).toEqual(['export-playlist', 'set-cover', 'delete-collection']);
        expect(plan.more).toBe(true);
    });

    it('never promotes an item without a priority, so the menu stays for it', () => {
        const plan = planQuickCells(playlist, 20, 0, false);
        expect(plan.promoted.map(entry => entry.id)).not.toContain('delete-collection');
        expect(plan.rest.map(entry => entry.id)).toEqual(['delete-collection']);
        expect(plan.more).toBe(true);
    });

    it('drops the menu when everything fits and nothing else lives there', () => {
        const plan = planQuickCells([item('reload'), item('edit-entity')], 3, 1, false);
        expect(plan.promoted.map(entry => entry.id)).toEqual(['reload', 'edit-entity']);
        expect(plan.more).toBe(false);
        // 有「折叠信息条」时「⋯」照样要占一格。
        expect(planQuickCells([item('reload'), item('edit-entity')], 3, 1, true).promoted.map(entry => entry.id)).toEqual(['reload']);
    });

    it('promotes everything before the first measurement, and nothing when there is no room', () => {
        expect(planQuickCells(playlist, null, 2, true).promoted).toHaveLength(5);
        expect(planQuickCells(playlist, 2, 2, true)).toMatchObject({ promoted: [], more: true });
    });
});

describe('pickQuickCells', () => {
    it('takes at most the given count by priority', () => {
        const home = ['home-import-playlist', 'home-refresh-folders', 'manage-hidden', 'home-import-folder', 'directory'].map(item);
        const { promoted, rest } = pickQuickCells(home, 2);
        expect(promoted.map(entry => entry.id)).toEqual(['directory', 'home-import-folder']);
        expect(rest.map(entry => entry.id)).toEqual(['home-import-playlist', 'home-refresh-folders', 'manage-hidden']);
    });
});

describe('quickSlotsForWidth', () => {
    it('counts how many cells and gaps fit', () => {
        // 竖条内容宽 256：36px 格、6px 间距正好六格。
        expect(quickSlotsForWidth(256, 36, 6)).toBe(6);
        expect(quickSlotsForWidth(245, 36, 6)).toBe(5);
        expect(quickSlotsForWidth(0, 36, 6)).toBe(0);
        expect(quickSlotsForWidth(100, 0, 6)).toBe(0);
    });
});
