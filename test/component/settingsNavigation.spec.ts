import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/settingsNavigation.spec.ts
// 设置侧栏的分组结构、页眉里的本页目录和 scrollspy 只在真实浏览器里成立：IntersectionObserver、
// 平滑滚动的中间态、以及窄屏时菜单按钮抽屉的开合与焦点都不是单测能覆盖的。
// 探针见 dev/probes/settingsNavigation.probe.tsx。

const content = (page: Page) => page.locator('[data-probe-content]');
const contentsEntry = (page: Page, label: string) => page.locator('header').getByRole('button', { name: label, exact: true });

const scrollTop = (page: Page) => content(page).evaluate(node => node.scrollTop);

/** The entry of the header's contents line that is marked as the group in view. */
const activeContentsLabel = (page: Page): Promise<string | null> => page.evaluate(() => (
    document.querySelector('header button[aria-current="true"]')?.textContent?.trim() ?? null
));

test.describe('settings navigation - wide layout', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('groups the categories under their headings', async ({ mount, page }) => {
        await mount('settingsNavigation');

        for (const heading of ['Interface', 'Music', 'App', 'Advanced']) {
            await expect(page.getByText(heading, { exact: true })).toBeVisible();
        }
    });

    test('lists categories only in the side list and the groups of the page in the header', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(contentsEntry(page, 'Alpha Section')).toBeVisible();
        await expect(contentsEntry(page, 'Echo Section')).toBeVisible();
        await expect(page.locator('aside').getByRole('button', { name: 'Alpha Section' })).toHaveCount(0);
        await expect(page.locator('aside').getByRole('button', { name: 'settingsPagePlayer', exact: true })).toBeVisible();
    });

    test('slots a late-arriving section into its document position', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(contentsEntry(page, 'Bravo Late Section')).toBeVisible();
        await expect(page.locator('[data-settings-anchor="importExportTitle"]')).toBeVisible();

        const labels = await page.locator('header button:not([aria-label])').allTextContents();
        expect(labels).toEqual(['Alpha Section', 'Bravo Section', 'Bravo Late Section', 'Charlie Section', 'Delta Section', 'Echo Section']);
    });

    test('scrolls to a section when its contents entry is clicked', async ({ mount, page }) => {
        await mount('settingsNavigation');

        expect(await scrollTop(page)).toBe(0);
        await contentsEntry(page, 'Delta Section').click();

        await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);
        // The destination stays marked; a smooth scroll must not light up what it passes through.
        expect(await activeContentsLabel(page)).toBe('Delta Section');
    });

    test('follows the scroll position back to the first section', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await contentsEntry(page, 'Echo Section').click();
        await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);

        await content(page).evaluate(node => node.scrollTo({ top: 0 }));
        await expect.poll(() => activeContentsLabel(page)).toBe('Alpha Section');
    });

    test('selects the final section once the column bottoms out', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await content(page).evaluate(node => node.scrollTo({ top: node.scrollHeight }));
        await expect.poll(() => activeContentsLabel(page)).toBe('Echo Section');
    });

    test('keeps the close button in the page header', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(page.locator('header').getByRole('button', { name: 'Close', exact: true })).toBeVisible();
        await expect(page.getByTestId('settings-close')).toHaveCount(0);
    });
});

test.describe('settings navigation - narrow layout', () => {
    test.use({ viewport: { width: 375, height: 720 } });

    const navToggle = (page: Page) => page.getByTestId('settings-nav-toggle');
    const drawer = (page: Page) => page.getByTestId('settings-nav-drawer');

    test('puts the menu button and the search field on top instead of a strip of categories', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(navToggle(page)).toBeVisible();
        await expect(page.getByRole('searchbox')).toBeVisible();
        // 分类不在顶栏上：抽屉没开时整个侧栏都不在文档里。
        await expect(page.locator('aside')).toHaveCount(0);
        // 页内目录还在页眉里。
        await expect(contentsEntry(page, 'Alpha Section')).toBeVisible();
    });

    test('keeps the close button at the right end of the top bar, and only there', async ({ mount, page }) => {
        await mount('settingsNavigation');

        const closeButton = page.getByTestId('settings-close');
        await expect(closeButton).toBeVisible();
        // 页眉里不再有第二颗关闭按钮：紧凑档只有顶栏这一颗。
        await expect(page.locator('header').getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);

        const [searchBox, closeBox, barBox] = await Promise.all([
            page.getByRole('searchbox').boundingBox(),
            closeButton.boundingBox(),
            navToggle(page).boundingBox(),
        ]);
        if (!searchBox || !closeBox || !barBox) throw new Error('the top bar is not laid out');
        // 菜单按钮在左、搜索框居中、关闭按钮在搜索框右边。
        expect(barBox.x).toBeLessThan(searchBox.x);
        expect(closeBox.x).toBeGreaterThan(searchBox.x + searchBox.width - 1);
        // 竖直方向同一条线上，不叠到第二行。
        expect(Math.abs(closeBox.y - barBox.y)).toBeLessThan(2);
    });

    test('opens the wide side list from the menu button, without a search field', async ({ mount, page }) => {
        await mount('settingsNavigation');
        await navToggle(page).click();

        await expect(drawer(page)).toBeVisible();
        // 抽屉里是宽屏那个侧栏：分组标题、分类、底部的 Help 都在。
        for (const heading of ['Interface', 'Music', 'App', 'Advanced']) {
            await expect(drawer(page).getByText(heading, { exact: true })).toBeVisible();
        }
        await expect(drawer(page).getByRole('button', { name: 'settingsPagePlayer', exact: true })).toBeVisible();
        // 底部那颗是 Help（文案随语言走，只看它在最后一位）。
        await expect(drawer(page).locator('nav button').last()).toBeVisible();
        // 搜索框只留在顶栏上，抽屉里没有第二个。
        await expect(drawer(page).getByRole('searchbox')).toHaveCount(0);
    });

    test('closes the drawer after a category is chosen', async ({ mount, page }) => {
        await mount('settingsNavigation');
        await navToggle(page).click();
        await drawer(page).getByRole('button', { name: 'settingsPagePlayer', exact: true }).click();

        await expect(drawer(page)).toHaveCount(0);
        // 焦点回到打开它的那颗按钮，不留在刚收起的抽屉里。
        await expect(navToggle(page)).toBeFocused();
    });

    test('closes the drawer on Escape without closing the page behind it', async ({ mount, page }) => {
        await mount('settingsNavigation');
        await navToggle(page).click();
        await expect(drawer(page)).toBeVisible();

        await page.keyboard.press('Escape');

        await expect(drawer(page)).toHaveCount(0);
        await expect(page.locator('header h2')).toBeVisible();
    });
});
