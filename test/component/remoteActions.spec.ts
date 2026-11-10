import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// test/component/remoteActions.spec.ts
// The remote window (602 x 184, electron/remoteControlWindowGeometry.cjs) shows mod buttons only
// in More -> Mods; that tab exists only while a mod adds a button.
test.use({ viewport: { width: 602, height: 184 } });

// Without the pointer in the window the card is the sleeve: keys folded, the progress line lying over
// them. A person's pointer is in the window before it presses a key, so put it there first.
const openSheet = async (page: Page) => {
    await page.mouse.move(301, 92);
    await expect(page.locator('.remote-window')).toHaveAttribute('data-sleeve', 'false');
    // The keys slide back in from the sleeve; measure them once they are at rest.
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map(animation => animation.finished.catch(() => undefined))));
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.locator('.remote-sheet')).toHaveCSS('transform', 'none');
};
const openMods = async (page: Page, name = 'Mods') => {
    await openSheet(page);
    await page.getByRole('tab', { name, exact: true }).click();
};

for (const daylight of [false, true]) {
    test(`append actions preserve native geometry (${daylight ? 'light' : 'dark'})`, async ({ mount, page }, testInfo) => {
        await mount('remoteActions');
        await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
        if (daylight) await page.evaluate(() => window.remoteActionsProbe.daylight());
        await openSheet(page);
        const readNative = () => page.evaluate(() => Array.from(document.querySelectorAll('main button:not([data-remote-action]):not([role="tab"])')).map((button) => ({ html: button.outerHTML, rect: [button.getBoundingClientRect().x, button.getBoundingClientRect().y, button.getBoundingClientRect().width, button.getBoundingClientRect().height] })));
        const before = await readNative();
        await expect(page.locator('[data-folium-slot="remote-actions"]')).toHaveCount(0);
        await expect(page.getByRole('tab', { name: 'Mods', exact: true })).toHaveCount(0);
        await page.evaluate(() => window.remoteActionsProbe.enable());
        await page.getByRole('tab', { name: 'Mods', exact: true }).click();
        const button = page.getByRole('button', { name: 'Demo like', exact: true });
        await expect(button).toBeVisible();
        const area = await page.locator('[data-folium-slot="remote-actions"]').boundingBox();
        const sheet = await page.locator('.remote-sheet').boundingBox();
        expect(area!.x + area!.width).toBeLessThanOrEqual(602);
        expect(area!.y + area!.height).toBeLessThanOrEqual(sheet!.y + sheet!.height);
        const keys = await page.locator('.remote-key').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
        for (const top of keys) expect(top).toBeGreaterThanOrEqual(area!.y + area!.height);
        expect(await button.boundingBox()).toMatchObject({ width: 32, height: 32 });
        const native = page.getByRole('button', { name: 'Previous', exact: true });
        await native.hover();
        const background = await native.evaluate(async (node) => {
            await Promise.all(node.getAnimations().map(animation => animation.finished));
            return getComputedStyle(node).backgroundColor;
        });
        await button.hover();
        await expect(button).toHaveCSS('background-color', background);
        await expect(button.locator('svg')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`remote-actions-${daylight ? 'light' : 'dark'}.png`) });
        await page.getByRole('tab', { name: 'Main window', exact: true }).click();
        expect(await readNative()).toEqual(before);
        await page.evaluate(() => window.remoteActionsProbe.disable());
        await expect(page.locator('[data-folium-slot="remote-actions"]')).toHaveCount(0);
        await expect(page.getByRole('tab', { name: 'Mods', exact: true })).toHaveCount(0);
        expect(await readNative()).toEqual(before);
    });
}

test('real sample accepts repeated clicks and Enter/Space, with hover/focus counts', async ({ mount, page }) => {
    await mount('remoteActions');
    await page.evaluate(() => window.remoteActionsProbe.enable());
    await openMods(page);
    const button = page.getByRole('button', { name: 'Demo like', exact: true });
    const count = button.locator('[data-remote-action-count]');
    await expect(button.locator('svg.lucide-thumbs-up')).toBeVisible();
    await expect(count).toHaveCSS('opacity', '0');
    await button.click(); await button.click();
    await expect(count).toHaveText('2');
    await expect(count).toHaveCSS('opacity', '1');
    await button.press('Enter'); await button.press('Space');
    await expect(count).toHaveText('4');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(10, 10);
    await button.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(count).toHaveCSS('opacity', '1');
    expect(await page.evaluate(() => window.remoteActionsProbe.results)).toEqual([true, true, true, true]);
    expect(await page.evaluate(() => window.remoteActionsProbe.commands.map(command => command.type))).toEqual(Array(4).fill('remote-action'));
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    expect(await page.evaluate(() => window.remoteActionsProbe.commands.at(-1)?.type)).toBe('next');
});

test('remote locale resolves label maps, and disabling/re-enabling restores the sample', async ({ mount, page }) => {
    await mount('remoteActions'); await page.evaluate(() => window.remoteActionsProbe.enable());
    await openMods(page);
    await page.getByRole('button', { name: 'Demo like', exact: true }).click();
    await page.evaluate(() => window.remoteActionsProbe.language('zh-CN'));
    await expect(page.getByRole('tab', { name: '模组', exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: '示例点赞', exact: true });
    await expect(button).toHaveAttribute('title', '示例点赞');
    await expect(button.locator('[data-remote-action-count]')).toHaveText('1');
    await page.evaluate(() => window.remoteActionsProbe.disable());
    await expect(page.locator('[data-folium-slot="remote-actions"]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '模组', exact: true })).toHaveCount(0);
    await page.evaluate(() => window.remoteActionsProbe.enable());
    await expect(button.locator('[data-remote-action-count]')).toHaveText('0');
    await button.click();
    await expect(button.locator('[data-remote-action-count]')).toHaveText('1');
});

test('stale track actions fail while session actions survive a song change or no song', async ({ mount, page }) => {
    await mount('remoteActions'); await page.evaluate(() => window.remoteActionsProbe.enable());
    await openMods(page);
    await page.evaluate(() => window.remoteActionsProbe.track(null, true));
    await page.getByRole('button', { name: 'Demo like', exact: true }).click();
    expect(await page.evaluate(() => window.remoteActionsProbe.results)).toEqual([false]);
    await page.getByRole('button', { name: 'Stop demo preview', exact: true }).click();
    expect(await page.evaluate(() => window.remoteActionsProbe.results)).toEqual([false, true]);
    await page.evaluate(() => window.remoteActionsProbe.flush());
    await expect(page.getByRole('button', { name: 'Demo like', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Stop demo preview', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.remoteActionsProbe.log)).toEqual(['remote.actions demo preview stopped']);
});

test('actions stay in an internally scrolling area and only in the Mods tab', async ({ mount, page }) => {
    await mount('remoteActions'); await page.evaluate(() => { window.remoteActionsProbe.enable(); window.remoteActionsProbe.many(); });
    await openMods(page);
    const area = page.locator('[data-folium-slot="remote-actions"]');
    const last = page.getByRole('button', { name: 'Extra 29', exact: true });
    await last.click();
    expect(await area.evaluate((node) => node.scrollWidth > node.clientWidth && node.scrollLeft > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(602);
    await page.getByRole('tab', { name: 'Export video', exact: true }).click();
    await expect(area).toHaveCount(0);
    await page.getByRole('tab', { name: 'Mods', exact: true }).click();
    await expect(area).toBeVisible();
    await page.getByRole('tab', { name: 'Main window', exact: true }).click();
    await expect(area).toHaveCount(0);
    await page.getByRole('tab', { name: 'Mods', exact: true }).click();
    await expect(area).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('.remote-sheet')).toHaveCount(0);
    await expect(area).toHaveCount(0);
});
