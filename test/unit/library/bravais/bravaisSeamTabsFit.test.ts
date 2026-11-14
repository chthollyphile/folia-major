import { describe, expect, it } from 'vitest';
import { resolveSeamTabsFit } from '@/library/suites/bravais/useBravaisSeamTabsFit';

// test/unit/library/bravais/bravaisSeamTabsFit.test.ts
// 首页窄缝的退让顺序：带标题 + 入口 → 不带标题 + 入口 → 不带标题、入口挪进菜单 → 缩成一个字（入口仍在菜单里）。
// 级别只看副本的高，与此刻是哪一级无关。方案 C：工具格上面的本页一组也进阶梯，入口能留时先一行行让，入口进菜单后再一行行让，
// 都让完才缩成一个字。

const sizes = { pad: 18, titledHead: 400, bareHead: 370, withShortcuts: 300, withoutShortcuts: 220 };

describe('resolveSeamTabsFit', () => {
    it('gives way in order: the title, then the jump-ins, then the full tab names', () => {
        expect(resolveSeamTabsFit({ ...sizes, available: 718 })).toEqual({ level: 'titled', shortcuts: true, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...sizes, available: 717 })).toEqual({ level: 'untitled', shortcuts: true, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...sizes, available: 688 })).toEqual({ level: 'untitled', shortcuts: true, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...sizes, available: 687 })).toEqual({ level: 'untitled', shortcuts: false, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...sizes, available: 608 })).toEqual({ level: 'untitled', shortcuts: false, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...sizes, available: 607 })).toEqual({ level: 'short', shortcuts: false, pageRows: 0 });
    });

    it('without jump-ins the two copies are the same and the old order holds', () => {
        const bare = { ...sizes, withShortcuts: 220 };
        expect(resolveSeamTabsFit({ ...bare, available: 638 })).toEqual({ level: 'titled', shortcuts: true, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...bare, available: 608 })).toEqual({ level: 'untitled', shortcuts: true, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...bare, available: 607 })).toEqual({ level: 'short', shortcuts: false, pageRows: 0 });
    });

    it('lets the page tools give way row by row around the jump-ins, all before the tab names shorten', () => {
        // 本页一组 0 / 1 / 2 行占的高。
        const page = { ...sizes, pageHeights: [0, 55, 103] };
        expect(resolveSeamTabsFit({ ...page, available: 821 })).toEqual({ level: 'titled', shortcuts: true, pageRows: 2 });
        expect(resolveSeamTabsFit({ ...page, available: 820 })).toEqual({ level: 'untitled', shortcuts: true, pageRows: 2 });
        expect(resolveSeamTabsFit({ ...page, available: 790 })).toEqual({ level: 'untitled', shortcuts: true, pageRows: 1 });
        expect(resolveSeamTabsFit({ ...page, available: 742 })).toEqual({ level: 'untitled', shortcuts: false, pageRows: 2 });
        expect(resolveSeamTabsFit({ ...page, available: 663 })).toEqual({ level: 'untitled', shortcuts: false, pageRows: 1 });
        expect(resolveSeamTabsFit({ ...page, available: 608 })).toEqual({ level: 'untitled', shortcuts: false, pageRows: 0 });
        expect(resolveSeamTabsFit({ ...page, available: 607 })).toEqual({ level: 'short', shortcuts: false, pageRows: 0 });
    });
});
