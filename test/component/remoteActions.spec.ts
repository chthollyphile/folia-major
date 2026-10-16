import { test, expect } from './fixtures';

// test/component/remoteActions.spec.ts
test.use({ viewport: { width: 450, height: 230 } });

for (const daylight of [false, true]) {
    test(`append actions preserve native geometry (${daylight ? 'light' : 'dark'})`, async ({ mount, page }, testInfo) => {
        await mount('remoteActions');
        await expect(page.getByTitle('Next', { exact: true })).toBeVisible();
        if (daylight) await page.evaluate(() => window.remoteActionsProbe.daylight());
        await expect(page.getByTitle('Next', { exact: true }).locator('xpath=../../..')).toHaveCSS('transform', 'none');
        const readNative = () => page.evaluate(() => Array.from(document.querySelectorAll('main button:not([data-remote-action])')).map((button) => ({ html: button.outerHTML, rect: [button.getBoundingClientRect().x, button.getBoundingClientRect().y, button.getBoundingClientRect().width, button.getBoundingClientRect().height] })));
        const before = await readNative();
        await expect(page.locator('[data-folium-slot="remote-actions"]')).toHaveCount(0);
        await page.evaluate(() => window.remoteActionsProbe.enable());
        const button = page.getByRole('button', { name: 'Demo like', exact: true });
        await expect(button).toBeVisible();
        expect(await readNative()).toEqual(before);
        const area = await page.locator('[data-folium-slot="remote-actions"]').boundingBox();
        expect(area!.y + area!.height).toBeLessThanOrEqual(230);
        for (const native of before) expect(native.rect[1] + native.rect[3]).toBeLessThanOrEqual(area!.y);
        const native = page.getByTitle('Video export', { exact: true });
        expect(await button.boundingBox()).toMatchObject({ width: 28, height: 28 });
        await native.hover();
        const background = await native.evaluate(async (node) => {
            await Promise.all(node.getAnimations().map(animation => animation.finished));
            return getComputedStyle(node).backgroundColor;
        });
        await button.hover();
        await expect(button).toHaveCSS('background-color', background);
        await expect(button.locator('svg')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`remote-actions-${daylight ? 'light' : 'dark'}.png`) });
        await page.evaluate(() => window.remoteActionsProbe.disable());
        await expect(page.locator('[data-folium-slot="remote-actions"]')).toHaveCount(0);
        expect(await readNative()).toEqual(before);
    });
}

test('real sample accepts repeated clicks and Enter/Space, with hover/focus counts', async ({ mount, page }) => {
    await mount('remoteActions');
    await page.evaluate(() => window.remoteActionsProbe.enable());
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
    await page.mouse.move(440, 220);
    await button.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(count).toHaveCSS('opacity', '1');
    expect(await page.evaluate(() => window.remoteActionsProbe.results)).toEqual([true, true, true, true]);
    expect(await page.evaluate(() => window.remoteActionsProbe.commands.map(command => command.type))).toEqual(Array(4).fill('remote-action'));
    await page.getByTitle('Next', { exact: true }).click();
    expect(await page.evaluate(() => window.remoteActionsProbe.commands.at(-1)?.type)).toBe('next');
});

test('remote locale resolves label maps, and disabling/re-enabling restores the sample', async ({ mount, page }) => {
    await mount('remoteActions'); await page.evaluate(() => window.remoteActionsProbe.enable());
    await page.getByRole('button', { name: 'Demo like', exact: true }).click();
    await page.evaluate(() => window.remoteActionsProbe.language('zh-CN'));
    const button = page.getByRole('button', { name: '示例点赞', exact: true });
    await expect(button).toHaveAttribute('title', '示例点赞');
    await expect(button.locator('[data-remote-action-count]')).toHaveText('1');
    await page.evaluate(() => window.remoteActionsProbe.disable());
    await expect(page.locator('[data-folium-slot="remote-actions"]')).toHaveCount(0);
    await page.evaluate(() => window.remoteActionsProbe.enable());
    await expect(button.locator('[data-remote-action-count]')).toHaveText('0');
    await button.click();
    await expect(button.locator('[data-remote-action-count]')).toHaveText('1');
});

test('stale track actions fail while session actions survive a song change or no song', async ({ mount, page }) => {
    await mount('remoteActions'); await page.evaluate(() => window.remoteActionsProbe.enable());
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

test('actions stay in an internally scrolling area and off other native panels', async ({ mount, page }) => {
    await mount('remoteActions'); await page.evaluate(() => { window.remoteActionsProbe.enable(); window.remoteActionsProbe.many(); });
    const area = page.locator('[data-folium-slot="remote-actions"]');
    const last = page.getByRole('button', { name: 'Extra 29', exact: true });
    await last.click();
    expect(await area.evaluate((node) => node.scrollWidth > node.clientWidth && node.scrollLeft > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(450);
    await page.getByTitle('Video export', { exact: true }).click();
    await expect(area).toBeHidden();
    await page.getByTitle('Back', { exact: true }).click({ force: true });
    await expect(area).toBeVisible();
    await page.getByTitle('Transparent controls', { exact: true }).click();
    await expect(area).toBeHidden();
});


test('empty external sessions keep permitted navigation available without enabling local playback', async ({ mount, page }) => {
    await mount('remoteActions');
    await page.evaluate(() => { window.remoteActionsProbe.track(null); window.remoteActionsProbe.sessionNavigation(true); });
    const next = page.getByTitle('Next', { exact: true });
    const previous = page.getByTitle('Previous', { exact: true });
    await expect(next).toBeEnabled();
    await expect(previous).toBeEnabled();
    await expect(page.getByTitle('Play', { exact: true })).toBeDisabled();
    await expect(page.getByRole('slider')).toBeDisabled();
    await expect(page.getByTitle('Loop off', { exact: true })).toBeDisabled();
    await next.click();
    await previous.click();
    expect(await page.evaluate(() => window.remoteActionsProbe.commands.map(command => command.type))).toEqual(['next', 'previous']);
    await page.evaluate(() => window.remoteActionsProbe.hostDisabled(true));
    await expect(next).toBeDisabled();
    await expect(previous).toBeDisabled();
    await page.evaluate(() => window.remoteActionsProbe.hostDisabled(false));
    await expect(next).toBeEnabled();
    await expect(previous).toBeEnabled();
    await page.evaluate(() => window.remoteActionsProbe.sessionNavigation(false));
    await expect(next).toBeDisabled();
    await expect(previous).toBeDisabled();
    await page.evaluate(() => window.remoteActionsProbe.sessionNavigation(null));
    await expect(next).toBeDisabled();
    await expect(previous).toBeDisabled();
});
