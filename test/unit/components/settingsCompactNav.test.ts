import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/components/settingsCompactNav.test.ts
// 设置弹窗紧凑档（窄于 768px）的导航约定：顶上一行是菜单按钮 + 搜索框 + 关闭按钮（按这个顺序），分类不再
// 横排成一条；菜单按钮打开的是宽屏那个侧栏，只是不带搜索框。布局本身要浏览器里的媒体查询才看得出来，
// 这里核对的是几条最容易悄悄回退的结构。

const read = (relativePath: string): string => readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf8');

const NAV = 'src/components/modal/settings/navigation/SettingsCompactNav.tsx';
const SIDE_LIST = 'src/components/modal/settings/navigation/SettingsSideList.tsx';

describe('settings navigation in the compact window', () => {
    it('keeps the wide side list on wide screens and swaps in the menu bar below 768px', () => {
        const modal = read('src/components/modal/SettingsModal.tsx');
        expect(modal).toContain("useMediaQuery('(min-width: 768px)')");
        // 两个分支都钉住：宽屏是侧栏本身，紧凑档换成顶栏 + 抽屉。
        expect(modal).toMatch(/isWideSettingsLayout \? \(\s*<SettingsSideList/);
        expect(modal).toMatch(/\) : \(\s*<SettingsCompactNav/);
    });

    it('puts the menu button to the left of the search field, and the close button to its right', () => {
        const nav = read(NAV);
        const menuAt = nav.indexOf('<MenuIcon size={16} />');
        const searchAt = nav.indexOf('<SettingsSearchField');
        const closeAt = nav.indexOf('data-testid="settings-close"');
        expect(menuAt).toBeGreaterThan(-1);
        expect(searchAt).toBeGreaterThan(menuAt);
        expect(closeAt).toBeGreaterThan(searchAt);
    });

    it('moves the close button off the page header in the compact window only', () => {
        const modal = read('src/components/modal/SettingsModal.tsx');
        // 页眉上的那颗只在宽屏画；紧凑档由顶栏右端负责。
        expect(modal).toContain('showClose={isWideSettingsLayout}');
        // 顶栏那颗要真的关掉整个设置。
        expect(read(NAV)).toMatch(/onClick=\{onClose\}/);
    });

    it('opens the wide side list in the drawer, without the search field', () => {
        const nav = read(NAV);
        expect(nav).toContain('<SettingsSideList');
        expect(nav).toContain('showSearch={false}');
    });

    it('no longer lays the categories out as a sideways strip', () => {
        const sideList = read(SIDE_LIST);
        expect(sideList).not.toContain('overflow-x-auto');
        expect(sideList).not.toContain('useDragToScroll');
        // 搜索框成为可选项而不是常驻：抽屉里那一个由顶栏负责。
        expect(sideList).toContain('showSearch = true');
    });
});
