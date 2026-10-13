import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/queueUiWall.spec.ts
// Actual native wall controls remain mounted; extensions append and preserve queue occurrence indexes.
const island = (page: Page) => page.getByRole('region', { name: 'Play queue', exact: true });
const row = (page: Page, index: number) => island(page).locator(`[data-queue-index="${index}"]`);
const chrome = (page: Page) => page.locator('[data-probe-lattice]');
const logs = (page: Page) => page.locator('.lattice-root').getAttribute('data-extension-calls');
const toggle = async (page: Page) => {
    // Keyboard activation leaves the wall panel open; a pointer click outside would close it.
    await page.locator('[data-probe-enable]').focus();
    await page.keyboard.press('Space');
};
const mountProbe = async (mount: (id: string) => Promise<Locator>, page: Page) => {
    await page.addInitScript(() => localStorage.setItem('wall_tools_queue_island_open', 'true'));
    await mount('queueUiWall');
    await page.getByRole('button', { name: 'Wall tools', exact: true }).click();
    await expect(row(page, 2)).toBeVisible();
};

test.describe('append-only wall queue UI', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('native quick actions and exact row/header markup return after unload', async ({ mount, page }) => {
        await mountProbe(mount, page);
        const panel = page.getByRole('menu', { name: 'Wall tools', exact: true });
        expect(await panel.locator('[data-wall-tools-quick]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-wall-tools-quick')))).toEqual([
            'locate-playing', 'shuffle-queue', 'generate-theme', 'queue', 'go-home', 'open-player',
        ]);
        const nativeHeader = await island(page).locator('header').innerHTML();
        const nativeRows = await island(page).locator('.lattice-tools-island-row').evaluateAll(nodes => nodes.map(node => node.outerHTML));
        const nativeChrome = await chrome(page).innerHTML();
        await toggle(page);
        await expect(island(page).getByRole('button', { name: 'Fixture sync', exact: true })).toBeVisible();
        await expect(row(page, 0).getByText('Recommender 0', { exact: true })).toBeVisible();
        await toggle(page);
        await expect.poll(() => island(page).locator('header').innerHTML()).toBe(nativeHeader);
        await expect.poll(() => island(page).locator('.lattice-tools-island-row').evaluateAll(nodes => nodes.map(node => node.outerHTML))).toEqual(nativeRows);
        await expect.poll(() => chrome(page).innerHTML()).toBe(nativeChrome);
    });

    test('duplicate rows and an expanded poster use their own queue indexes', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await toggle(page);
        await row(page, 0).hover();
        await row(page, 0).getByRole('button', { name: 'Vote 0', exact: true }).click();
        await row(page, 2).hover();
        await row(page, 2).getByRole('button', { name: 'Vote 2', exact: true }).click();
        // The poster represents index 2 although its song object and media ID also occur at index 0.
        await chrome(page).getByRole('button', { name: 'Vote 2', exact: true }).click();
        await expect.poll(() => logs(page)).toBe('["vote:wall:0","vote:wall:2","vote:lattice:2"]');
        await expect(page.locator('.lattice-root')).toHaveAttribute('data-native-calls', '0');
        await expect(chrome(page).locator('[data-action]')).toHaveCount(4);
    });

    test('all three text lines fit the unchanged 40px island row without overlaps', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await toggle(page);
        const target = row(page, 1);
        await expect(target).toHaveCSS('height', '40px');
        const fit = await target.evaluate(element => {
            const outer = element.getBoundingClientRect();
            const overline = element.querySelector('.lattice-tools-island-overline')!.getBoundingClientRect();
            const title = element.querySelector('.lattice-tools-island-title')!.getBoundingClientRect();
            const artist = element.querySelector('.lattice-tools-island-artist')!.getBoundingClientRect();
            return overline.top >= outer.top && overline.bottom <= title.top + 0.5
                && title.bottom <= artist.top + 0.5 && artist.bottom <= outer.bottom;
        });
        expect(fit).toBe(true);
        await expect(target.locator('.lattice-tools-island-artist')).toHaveText('Example artist');
    });

    test('contributed counts appear only on hover or focus without changing button width', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await toggle(page);
        const vote = chrome(page).getByRole('button', { name: 'Vote 2', exact: true });
        const count = vote.getByText('15', { exact: true });
        await page.mouse.move(0, 0);
        await expect(count).toHaveCSS('visibility', 'hidden');
        const before = (await vote.boundingBox())!.width;
        await vote.hover();
        await expect(count).toHaveCSS('visibility', 'visible');
        expect((await vote.boundingBox())!.width).toBe(before);
        const buttonBox = (await vote.boundingBox())!;
        const countBox = (await count.boundingBox())!;
        expect(countBox.y).toBeGreaterThanOrEqual(buttonBox.y);
        expect(countBox.x + countBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
        await page.mouse.move(0, 0);
        await vote.focus();
        await expect(count).toHaveCSS('visibility', 'visible');
        expect((await vote.boundingBox())!.width).toBe(before);
    });
});
