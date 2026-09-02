import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/settingsNavigation.spec.ts
// 设置侧栏的分组结构、二级锚点目录和 scrollspy 只在真实浏览器里成立：IntersectionObserver、
// 平滑滚动的中间态、以及 Tailwind v4 `space-x` 对隐藏兄弟节点的处理都不是单测能覆盖的。
// 探针见 dev/probes/settingsNavigation.probe.tsx。

const content = (page: Page) => page.locator('[data-probe-content]');
const tocItem = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });

const scrollTop = (page: Page) => content(page).evaluate(node => node.scrollTop);

/** The highlighted table-of-contents entry, identified by the accent bar this component renders. */
const activeTocLabel = async (page: Page): Promise<string | null> => content(page).evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>('button')];
    const active = buttons.find(button => {
        const bar = button.querySelector<HTMLElement>('span[style*="opacity: 1"]');
        return Boolean(bar) && button.textContent !== null;
    });
    return active?.textContent?.trim() ?? null;
});

test.describe('settings navigation - wide layout', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('groups the sections under their headings', async ({ mount, page }) => {
        await mount('settingsNavigation');

        for (const heading of ['Appearance', 'Controls', 'Connections & Data', 'System']) {
            await expect(page.getByText(heading, { exact: true })).toBeVisible();
        }
    });

    test('expands a table of contents for the active section only', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(tocItem(page, 'Alpha Section')).toBeVisible();
        await expect(tocItem(page, 'Echo Section')).toBeVisible();
    });

    test('slots a late-arriving section into its document position', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(tocItem(page, 'Bravo Late Section')).toBeVisible();

        const labels = await page.evaluate(() => (
            [...document.querySelectorAll('[data-settings-anchor]')].map(node => node.getAttribute('data-settings-anchor'))
        ));
        expect(labels).toEqual(['alpha', 'bravo', 'bravoLate', 'charlie', 'delta', 'echo']);
    });

    test('scrolls to a section when its table of contents entry is clicked', async ({ mount, page }) => {
        await mount('settingsNavigation');

        expect(await scrollTop(page)).toBe(0);
        await tocItem(page, 'Delta Section').click();

        await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);
        // The destination stays highlighted; a smooth scroll must not light up what it passes through.
        expect(await activeTocLabel(page)).toBe('Delta Section');
    });

    test('follows the scroll position back to the first section', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await tocItem(page, 'Echo Section').click();
        await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);

        await content(page).evaluate(node => node.scrollTo({ top: 0 }));
        await expect.poll(() => activeTocLabel(page)).toBe('Alpha Section');
    });

    test('selects the final section once the column bottoms out', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await content(page).evaluate(node => node.scrollTo({ top: node.scrollHeight }));
        await expect.poll(() => activeTocLabel(page)).toBe('Echo Section');
    });
});

test.describe('settings navigation - narrow layout', () => {
    test.use({ viewport: { width: 375, height: 720 } });

    test('keeps the chip strip flat, with no grouping and no table of contents', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(page.getByText('Appearance', { exact: true })).toHaveCount(0);
        await expect(tocItem(page, 'Alpha Section')).toHaveCount(0);
    });

    test('spaces adjacent chips exactly 8px apart', async ({ mount, page }) => {
        await mount('settingsNavigation');

        // Tailwind v4 drops the :not([hidden]) guard on space-x, so a hidden group heading rendered
        // as a sibling would silently add a margin here. This pins the strip's real spacing.
        const gap = await page.evaluate(() => {
            const strip = document.querySelector('.space-x-2');
            if (!strip) return null;
            const [first, second] = [...strip.children].map(child => child.getBoundingClientRect());
            return second && first ? Math.round(second.left - first.right) : null;
        });

        expect(gap).toBe(8);
    });
});
